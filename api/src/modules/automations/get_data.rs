//! Shared query configuration validation and candidate filtering.
use super::*;

pub(super) fn validate_query_config(config: &Value) -> Result<(), AppError> {
    let invalid = |message: &str| AppError::BadRequest(message.to_string());
    for key in ["sourceMode", "filterMode"] {
        if config
            .get(key)
            .is_some_and(|v| !v.is_null() && !v.is_string())
        {
            return Err(invalid("获取节点来源或筛选方式必须为字符串"));
        }
    }
    if !matches!(
        config
            .get("sourceMode")
            .and_then(Value::as_str)
            .unwrap_or("form"),
        "form" | "data-node" | "trigger"
    ) {
        return Err(invalid("获取节点来源配置无效"));
    }
    if config
        .get("filterExpression")
        .is_some_and(|v| !v.is_null() && v.as_str().is_none_or(|s| !s.trim().is_empty()))
    {
        return Err(invalid("获取节点不支持旧 filterExpression"));
    }
    match config
        .get("filterMode")
        .and_then(Value::as_str)
        .unwrap_or("all")
    {
        "all" => Ok(()),
        "rules" => validate_query_rules(config.get("rules"), None),
        _ => Err(invalid("获取节点筛选方式无效")),
    }
}

fn validate_query_rules(
    value: Option<&Value>,
    fields: Option<&HashSet<String>>,
) -> Result<(), AppError> {
    let invalid = || AppError::BadRequest("获取节点筛选规则不完整、字段失效或分组无效".into());
    let rules = value
        .and_then(Value::as_array)
        .filter(|r| !r.is_empty())
        .ok_or_else(invalid)?;
    let mut ids = HashSet::new();
    for rule in rules {
        let id = rule
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(invalid)?;
        if !ids.insert(id) {
            return Err(invalid());
        }
    }
    let mut leaves = 0;
    for rule in rules {
        let id = rule.get("id").and_then(Value::as_str).unwrap();
        let mut visited = HashSet::from([id]);
        let mut parent = rule
            .get("parentId")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty());
        while let Some(p) = parent {
            if !ids.contains(p) || !visited.insert(p) {
                return Err(invalid());
            }
            parent = rules
                .iter()
                .find(|r| r.get("id").and_then(Value::as_str) == Some(p))
                .and_then(|r| r.get("parentId"))
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty());
        }
        if !matches!(
            rule.get("logicalOperator")
                .and_then(Value::as_str)
                .unwrap_or("and"),
            "and" | "or"
        ) {
            return Err(invalid());
        }
        if rule.get("isGroup").and_then(Value::as_bool) == Some(true) {
            if !rules
                .iter()
                .any(|r| r.get("parentId").and_then(Value::as_str) == Some(id))
            {
                return Err(invalid());
            }
            continue;
        }
        leaves += 1;
        let field = rule
            .get("fieldKey")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(invalid)?;
        if fields.is_some_and(|f| !f.contains(field)) {
            return Err(invalid());
        }
        let operator = rule
            .get("operator")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if !matches!(
            operator,
            "eq" | "neq" | "inAny" | "notInAny" | "hasValue" | "noValue"
        ) || rule
            .get("valueType")
            .and_then(Value::as_str)
            .is_some_and(|t| t != "value")
        {
            return Err(invalid());
        }
        if !matches!(operator, "hasValue" | "noValue")
            && !rule
                .get("rawValue")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        {
            return Err(invalid());
        }
    }
    if leaves == 0 {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn automation_system_field_ids() -> HashSet<String> {
    [
        "instanceId",
        "instanceTitle",
        "submitter",
        "submitterOrganization",
        "createdAt",
        "updatedAt",
        "workflowApprovalStatus",
        "workflowInstanceStatus",
        "workflowCurrentApprovalNode",
        "workflowSubmitter",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

pub(super) fn source_form(
    nodes: &Value,
    edges: &Value,
    node_id: &str,
    trigger_form: Option<&str>,
) -> Result<String, AppError> {
    let mut current = node_id;
    let mut visited = HashSet::new();
    loop {
        if !visited.insert(current) {
            return Err(AppError::BadRequest("获取来源存在循环引用".into()));
        }
        let node = nodes
            .as_array()
            .into_iter()
            .flatten()
            .find(|n| n.get("id").and_then(Value::as_str) == Some(current))
            .ok_or_else(|| AppError::BadRequest("来源节点不存在".into()))?;
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if kind == "trigger" {
            return trigger_form
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .ok_or_else(|| AppError::BadRequest("触发表单未配置".into()));
        }
        if !matches!(kind, "get-one" | "get-many") {
            return Err(AppError::BadRequest("来源节点没有记录输出".into()));
        }
        let config = node
            .pointer("/data/config")
            .ok_or_else(|| AppError::BadRequest("获取节点未配置".into()))?;
        validate_query_config(config)?;
        if config
            .get("sourceMode")
            .and_then(Value::as_str)
            .unwrap_or("form")
            == "form"
        {
            return config
                .get("formUuid")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
                .ok_or_else(|| AppError::BadRequest("请选择来源表单".into()));
        }
        let source = config
            .get("dataNodeId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("请选择来源数据节点".into()))?;
        let mut upstream = HashSet::new();
        let mut pending = vec![current];
        while let Some(target) = pending.pop() {
            for edge in edges
                .as_array()
                .into_iter()
                .flatten()
                .filter(|e| e.get("target").and_then(Value::as_str) == Some(target))
            {
                if let Some(id) = edge.get("source").and_then(Value::as_str) {
                    if upstream.insert(id) {
                        pending.push(id);
                    }
                }
            }
        }
        if source == current || !upstream.contains(source) {
            return Err(AppError::BadRequest("只能选择上游记录节点".into()));
        }
        current = source;
    }
}

pub(super) async fn validate_subform_config<C: ConnectionTrait>(
    db: &C,
    parent: &str,
    config: &Value,
) -> Result<(), AppError> {
    let form = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(parent))
        .one(db)
        .await?
        .ok_or_else(|| AppError::BadRequest("子表所属主表不存在".into()))?;
    let schema = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(parent))
        .filter(form_schema_entity::Column::Version.eq(form.current_schema_version))
        .one(db)
        .await?
        .ok_or_else(|| AppError::BadRequest("子表所属主表结构不可用".into()))?;
    let id = config
        .get("subformFieldId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let fields = schema
        .schema_json
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("主表字段结构不可用".into()))?;
    if !fields.iter().any(|field| {
        field.get("id").and_then(Value::as_str) == Some(id)
            && field.get("type").and_then(Value::as_str) == Some("subform")
    }) {
        return Err(AppError::BadRequest(
            "所选子表不存在或不属于来源数据节点的表单".into(),
        ));
    }
    let allowed = fields
        .iter()
        .filter(|field| field.get("parentGroupId").and_then(Value::as_str) == Some(id))
        .filter(|field| {
            !matches!(
                field.get("type").and_then(Value::as_str),
                Some("groupContainer" | "button" | "subform")
            )
        })
        .filter_map(|field| field.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let mut used = HashSet::new();
    for row in config
        .get("rows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let field = row
            .get("fieldId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !allowed.contains(field) || !used.insert(field) {
            return Err(AppError::BadRequest("子表新增目标字段失效或重复".into()));
        }
    }
    Ok(())
}

pub(crate) async fn validate_get_nodes<C: ConnectionTrait>(
    db: &C,
    nodes: &Value,
    edges: &Value,
    trigger_form: Option<&str>,
) -> Result<(), AppError> {
    for node in nodes.as_array().into_iter().flatten().filter(|node| {
        node.pointer("/data/kind").and_then(Value::as_str) == Some("add-data")
            && node
                .pointer("/data/config/targetMode")
                .and_then(Value::as_str)
                == Some("subtable")
    }) {
        let config = node.pointer("/data/config").unwrap();
        let source = config
            .get("parentDataNodeId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
        let mut upstream = HashSet::new();
        let mut pending = vec![id];
        while let Some(target) = pending.pop() {
            for edge in edges
                .as_array()
                .into_iter()
                .flatten()
                .filter(|edge| edge.get("target").and_then(Value::as_str) == Some(target))
            {
                if let Some(source) = edge.get("source").and_then(Value::as_str) {
                    if upstream.insert(source) {
                        pending.push(source);
                    }
                }
            }
        }
        if source == id || !upstream.contains(source) {
            return Err(AppError::BadRequest("子表新增只能选择上游数据节点".into()));
        }
        let parent = source_form(nodes, edges, source, trigger_form)?;
        validate_subform_config(db, &parent, config).await?;
    }
    for node in nodes.as_array().into_iter().flatten().filter(|n| {
        matches!(
            n.pointer("/data/kind").and_then(Value::as_str),
            Some("get-one" | "get-many")
        )
    }) {
        let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
        let node_config = node.pointer("/data/config").unwrap();
        if node_config.get("sourceMode").and_then(Value::as_str) == Some("trigger") {
            if trigger_form.is_none() {
                return Err(AppError::BadRequest("触发节点缺少来源表单".into()));
            }
            continue;
        }
        let form_uuid = source_form(nodes, edges, id, trigger_form)?;
        let form = FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&form_uuid))
            .one(db)
            .await?
            .ok_or_else(|| AppError::BadRequest("来源表单不存在".into()))?;
        if !matches!(form.form_type.as_str(), "normal" | "workflow") {
            return Err(AppError::BadRequest("来源必须为普通或流程表单".into()));
        }
        let schema = FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(&form_uuid))
            .filter(form_schema_entity::Column::Version.eq(form.current_schema_version))
            .one(db)
            .await?
            .ok_or_else(|| AppError::BadRequest("来源表单结构不可用".into()))?;
        let mut fields = schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|f| {
                !matches!(
                    f.get("type").and_then(Value::as_str),
                    Some("groupContainer" | "button")
                )
            })
            .filter_map(|f| f.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<HashSet<_>>();
        fields.extend(automation_system_field_ids());
        let config = node.pointer("/data/config").unwrap();
        if config.get("filterMode").and_then(Value::as_str) == Some("rules") {
            validate_query_rules(config.get("rules"), Some(&fields))?;
        }
    }
    Ok(())
}

pub(super) fn filter_candidates(candidates: Vec<Value>, config: &Value) -> Vec<Value> {
    if config.get("filterMode").and_then(Value::as_str) != Some("rules") {
        return candidates;
    }
    let rules = config
        .get("rules")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    candidates
        .into_iter()
        .filter(|record| expression::evaluate_record_rule_group(rules, None, record))
        .collect()
}

pub(super) fn node_candidates(output: Option<&Value>) -> Result<Vec<Value>, AppError> {
    match output {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Object(_)) => Ok(vec![output.unwrap().clone()]),
        Some(Value::Array(items)) if items.iter().all(Value::is_object) => Ok(items.clone()),
        _ => Err(AppError::BadRequest(
            "来源节点输出必须为记录对象或列表".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(id: &str, field: &str, expected: &str) -> Value {
        json!({"id":id,"fieldKey":field,"operator":"eq","rawValue":expected,"valueType":"value","logicalOperator":"and"})
    }

    #[test]
    fn rejects_legacy_and_incomplete_rules_before_normalization() {
        for config in [
            json!({"sourceMode":"related-form"}),
            json!({"sourceMode":"invalid"}),
            json!({"filterExpression":"amount == 1"}),
            json!({"filterMode":"invalid"}),
            json!({"filterMode":"rules","rules":[]}),
            json!({"filterMode":"rules","rules":[{"id":"a"}]}),
            json!({"filterMode":"rules","rules":[{"id":"a","isGroup":true}]}),
            json!({"filterMode":"rules","rules":[{"id":"a","parentId":"a","isGroup":true}]}),
        ] {
            assert!(validate_query_config(&config).is_err(), "{config}");
            assert!(normalize_automation_node_config("get-one", config).is_err());
        }
        let mut referenced = rule("a", "amount", "1");
        referenced["valueType"] = json!("field");
        assert!(
            validate_query_config(&json!({"filterMode":"rules","rules":[referenced]})).is_err()
        );
        assert!(validate_query_config(&json!({"filterMode":"all","rules":[{}]})).is_ok());
        assert!(
            validate_query_rules(
                Some(&json!([rule("a", "removed", "1")])),
                Some(&HashSet::from(["amount".into()]))
            )
            .is_err()
        );
    }

    #[test]
    fn nested_and_or_filters_records_and_keeps_identity_and_order() {
        let mut active = rule("active", "status", "active");
        active["parentId"] = json!("group");
        active["logicalOperator"] = json!("or");
        let mut vip = rule("vip", "level", "vip");
        vip["parentId"] = json!("group");
        vip["logicalOperator"] = json!("or");
        let config = json!({"filterMode":"rules","rules":[rule("tenant","tenant","a"),
            {"id":"group","isGroup":true,"logicalOperator":"and"},active,vip]});
        validate_query_config(&config).unwrap();
        let records = vec![
            json!({"tenant":"a","status":"active","__automationRecordUuid":"1"}),
            json!({"tenant":"a","level":"vip","__automationRecordUuid":"2"}),
            json!({"tenant":"b","status":"active"}),
            json!({"tenant":"a","level":"normal"}),
        ];
        assert_eq!(filter_candidates(records.clone(), &config), records[..2]);
        assert_eq!(
            filter_candidates(records.clone(), &json!({"filterMode":"all","rules":[{}]})),
            records
        );
        assert!(filter_candidates(vec![], &config).is_empty());
    }

    #[test]
    fn resolves_query_chains_and_rejects_self_downstream_nonrecord_and_missing() {
        let nodes = json!([
            {"id":"trigger","data":{"kind":"trigger"}},
            {"id":"one","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger"}}},
            {"id":"many","data":{"kind":"get-many","config":{"sourceMode":"data-node","dataNodeId":"one"}}},
            {"id":"http","data":{"kind":"http-request"}}
        ]);
        let edges = json!([{"source":"trigger","target":"one"},{"source":"one","target":"many"},{"source":"http","target":"many"}]);
        assert_eq!(
            source_form(&nodes, &edges, "many", Some("FORM-1")).unwrap(),
            "FORM-1"
        );
        for source in ["many", "http", "missing"] {
            let mut invalid = nodes.clone();
            invalid[2]["data"]["config"]["dataNodeId"] = json!(source);
            assert!(source_form(&invalid, &edges, "many", Some("FORM-1")).is_err());
        }
        let mut invalid = nodes.clone();
        invalid[1]["data"]["config"]["dataNodeId"] = json!("many");
        assert!(source_form(&invalid, &edges, "one", Some("FORM-1")).is_err());
    }

    #[tokio::test]
    async fn node_outputs_apply_rules_before_first_or_list_and_handle_empty() {
        let db = DatabaseConnection::default();
        let config = json!({"sourceMode":"data-node","dataNodeId":"source","filterMode":"rules","rules":[rule("a","status","active")]});
        let mut context = AutomationExecutionContext {
            outputs: HashMap::new(),
            operator: "test".into(),
            run_id: None,
        };
        for empty in [Value::Null, json!([])] {
            context.outputs.insert("source".into(), empty);
            assert_eq!(
                execute_get_one_node(&db, &config, &context).await.unwrap(),
                Value::Null
            );
            assert_eq!(
                execute_get_many_node(&db, &config, &context).await.unwrap(),
                json!([])
            );
        }
        let selected = json!({"status":"active","__automationRecordUuid":"keep"});
        context.outputs.insert(
            "source".into(),
            json!([{"status":"inactive"},selected.clone(),{"status":"active"}]),
        );
        assert_eq!(
            execute_get_one_node(&db, &config, &context).await.unwrap(),
            selected
        );
        assert_eq!(
            execute_get_many_node(&db, &config, &context)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
        context.outputs.insert("source".into(), selected.clone());
        assert_eq!(
            execute_get_many_node(&db, &config, &context).await.unwrap(),
            json!([selected])
        );
        assert!(node_candidates(Some(&json!(42))).is_err());
    }
}
