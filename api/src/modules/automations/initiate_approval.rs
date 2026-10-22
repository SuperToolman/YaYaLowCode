//! Creates a saved workflow-form record. Submission remains a user action.
use super::*;
use crate::infrastructure::entities::iam_user_entity;

pub(super) async fn validate_target<C: ConnectionTrait>(
    db: &C,
    config: &Value,
    required: bool,
) -> Result<Option<form_definition_entity::Model>, AppError> {
    let Some(id) =
        read_json_string(config.get("targetFormUuid")).filter(|id| !id.trim().is_empty())
    else {
        return if required {
            Err(AppError::BadRequest("请选择流程表单".into()))
        } else {
            Ok(None)
        };
    };
    let form = forms::find_form_definition(db, &id).await?;
    if form.form_type != "workflow" {
        return Err(AppError::BadRequest("发起审批只能填写流程表单".into()));
    }
    if read_json_string(config.get("targetAppId")).as_deref()
        != Some(form.app_route_app_id.as_str())
    {
        return Err(AppError::BadRequest(
            "流程表单所属应用不匹配，请重新选择".into(),
        ));
    }
    Ok(Some(form))
}

fn writable_fields(fields: &[Value]) -> Vec<Value> {
    fields
        .iter()
        .filter(|field| {
            if matches!(
                field["type"].as_str(),
                Some("subform" | "groupContainer" | "description" | "html" | "tsx" | "button")
            ) {
                return false;
            }
            let mut parent = field["parentGroupId"].as_str();
            let mut visited = HashSet::new();
            while let Some(id) = parent.filter(|id| !id.is_empty()) {
                if !visited.insert(id) {
                    return false;
                }
                let Some(ancestor) = fields.iter().find(|item| item["id"].as_str() == Some(id))
                else {
                    break;
                };
                if ancestor["type"] == "subform" {
                    return false;
                }
                parent = ancestor["parentGroupId"].as_str();
            }
            true
        })
        .cloned()
        .collect()
}

fn resolve_initiator(config: &Value, data: &Value, fields: &[Value]) -> Result<Uuid, AppError> {
    let value = if config["initiatorMode"].as_str() == Some("field") {
        let field = read_json_string(config.get("initiatorFieldId"))
            .ok_or_else(|| AppError::BadRequest("请选择发起人成员字段".into()))?;
        if !fields
            .iter()
            .any(|item| item["id"].as_str() == Some(&field) && item["type"] == "member")
        {
            return Err(AppError::BadRequest(
                "发起人字段必须为流程表单的成员字段".into(),
            ));
        }
        let value = &data[&field];
        if let Some(items) = value.as_array() {
            if items.len() != 1 {
                return Err(AppError::BadRequest(
                    "发起人成员字段必须恰好包含一位成员".into(),
                ));
            }
            items[0].as_str()
        } else {
            value.as_str()
        }
    } else {
        config["initiatorId"].as_str()
    };
    value
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| AppError::BadRequest("发起人必须为一位有效成员".into()))
}

pub(super) async fn execute<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let form = validate_target(db, config, true).await?.unwrap();
    let schema =
        forms::load_schema_version_for_connection(db, &form.form_uuid, form.current_schema_version)
            .await?;
    let fields = writable_fields(&json_array_items(&schema.schema_json["fields"]));
    let rows = json_array_items(&config["rows"]);
    let mut data = build_record_data_from_rows(&rows, &context.outputs);
    for row in &rows {
        if !fields.iter().any(|field| field["id"] == row["fieldId"]) {
            return Err(AppError::BadRequest("字段映射包含失效的目标字段".into()));
        }
    }
    for field in &fields {
        if field["props"]["isRequired"] == true {
            let id = field["id"].as_str().unwrap_or_default();
            if !expression::value_has_content(&data[id]) {
                return Err(AppError::BadRequest(format!(
                    "流程表单必填字段未填写: {id}"
                )));
            }
        }
    }
    let initiator = resolve_initiator(config, &data, &fields)?;
    let user = iam_user_entity::Entity::find_by_id(initiator)
        .filter(iam_user_entity::Column::Status.eq("active"))
        .one(db)
        .await?
        .ok_or_else(|| AppError::BadRequest("发起人成员不存在或已停用".into()))?;
    forms::initialize_workflow_record(&mut data, &user.display_name);
    let record = RecordRepository::new(db)
        .insert(&form, data, &user.display_name, Utc::now())
        .await?;
    Ok(record_data_with_automation_identity(record))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grouped_members_remain_writable_but_subtable_members_do_not() {
        let fields = writable_fields(&[
            json!({"id":"group","type":"groupContainer"}),
            json!({"id":"owner","type":"member","parentGroupId":"group"}),
            json!({"id":"sub","type":"subform"}),
            json!({"id":"child","type":"member","parentGroupId":"sub"}),
        ]);
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0]["id"], "owner");
    }
    #[test]
    fn available_to_both_flow_types_and_preserves_draft_semantics() {
        let node = json!([{"id":"draft","data":{"kind":"initiate-approval","config":{}}}]);
        assert!(validate_flow_node_kinds(&node, "trigger").is_ok());
        assert!(validate_flow_node_kinds(&node, "process").is_ok());
        let mut data = build_record_data_from_rows(
            &[json!({"fieldId":"title","valueType":"field","sourceFieldKey":"trigger-1:title"})],
            &HashMap::from([("trigger-1".into(), json!({"title":"申请"}))]),
        );
        forms::initialize_workflow_record(&mut data, "指定人员");
        assert_eq!(data["title"], "申请");
        assert_eq!(data["workflowApprovalStatus"], "saved");
        assert_eq!(data["workflowInstanceStatus"], "not_started");
        assert_eq!(data["workflowSubmitter"], "指定人员");
        assert_eq!(data["workflowCurrentApprovalNode"], "待提交");
    }
    #[test]
    fn resolves_exactly_one_target_member_and_rejects_invalid_sources() {
        let id = Uuid::new_v4();
        let fields = vec![
            json!({"id":"owner","type":"member"}),
            json!({"id":"text","type":"singleLineText"}),
        ];
        let config = json!({"initiatorMode":"field","initiatorFieldId":"owner"});
        assert_eq!(
            resolve_initiator(&config, &json!({"owner":id.to_string()}), &fields).unwrap(),
            id
        );
        assert_eq!(
            resolve_initiator(&config, &json!({"owner":[id.to_string()]}), &fields).unwrap(),
            id
        );
        assert!(resolve_initiator(&config, &json!({"owner":[]}), &fields).is_err());
        assert!(
            resolve_initiator(
                &config,
                &json!({"owner":[id.to_string(),id.to_string()]}),
                &fields
            )
            .is_err()
        );
        assert!(
            resolve_initiator(
                &json!({"initiatorMode":"field","initiatorFieldId":"text"}),
                &json!({"text":id.to_string()}),
                &fields
            )
            .is_err()
        );
        assert_eq!(
            resolve_initiator(
                &json!({"initiatorMode":"member","initiatorId":id.to_string()}),
                &json!({}),
                &fields
            )
            .unwrap(),
            id
        );
    }
}
