//! Human-readable, frozen descriptions of the exact platform mutation.
use super::*;
use crate::platform::{prelude::*, records::RecordRepository};
use yaya_agent_v2::{
    domain::ToolCall,
    store::{fingerprint, rows},
};

fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, AppError> {
    args[key]
        .as_str()
        .ok_or_else(|| bad("missing preview argument"))
}
fn change(label: &str, before: Value, after: Value) -> Value {
    json!({"label":label,"before":before,"after":after})
}
fn impact(label: &str, count: i64, description: &str) -> Value {
    json!({"label":label,"count":count,"description":description})
}

pub(super) async fn build(db: &impl ConnectionTrait, call: &ToolCall) -> Result<Value, AppError> {
    let args = &call.arguments;
    let mut changes = vec![];
    let mut impacts = vec![];
    let mut warnings = vec![];
    let mut design_baseline = Value::Null;
    let mut resource = json!({"kind":"application","id":args["appId"],"name":args["name"]});
    if let Some(app_id) = args["appId"].as_str() {
        let app = AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("application not found".into()))?;
        resource = json!({"kind":"application","id":app_id,"name":app.name});
    }
    let title = match call.name.as_str() {
        "platform_create_app" => {
            for (key, label) in [
                ("name", "应用名称"),
                ("description", "应用描述"),
                ("icon", "应用图标"),
            ] {
                if let Some(value) = args.get(key) {
                    changes.push(change(label, Value::Null, value.clone()))
                }
            }
            "创建应用"
        }
        "platform_update_app" => {
            let app = AppEntity::find()
                .filter(app_entity::Column::RouteAppId.eq(arg(args, "appId")?))
                .one(db)
                .await?
                .ok_or_else(|| bad("application missing"))?;
            for (key, label, before) in [
                ("name", "应用名称", json!(app.name)),
                ("description", "应用描述", json!(app.description)),
                ("icon", "应用图标", json!(app.icon)),
            ] {
                if let Some(after) = args.get(key) {
                    if &before != after {
                        changes.push(change(label, before, after.clone()))
                    }
                }
            }
            "编辑应用"
        }
        "platform_delete_app" => {
            let app_id = arg(args, "appId")?;
            let forms = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
                .all(db)
                .await?;
            let mut records = 0;
            for form in &forms {
                records += RecordRepository::new(db)
                    .count_for_deletion(&form.form_uuid)
                    .await?;
            }
            let navigation = AppNavigationEntity::find()
                .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
                .all(db)
                .await?;
            let flows = AutomationFlowEntity::find()
                .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id))
                .all(db)
                .await?;
            impacts.push(impact(
                "表单",
                forms.len() as i64,
                "包括逻辑明细表；表单定义、版本和视图将删除",
            ));
            impacts.push(impact("主记录", records, "包括已回收记录及其子表数据"));
            impacts.push(impact(
                "导航项",
                navigation.len() as i64,
                "分组和表单导航将删除",
            ));
            impacts.push(impact(
                "自动化与流程定义",
                flows.len() as i64,
                "相关运行、流程实例和配置随应用清理",
            ));
            warnings.push("此操作会删除应用业务数据和资源权限，不能通过 Agent 撤销。用户会话本身保留，仅解除旧应用关联。");
            "删除应用"
        }
        "platform_create_form" => {
            changes.push(change("表单名称", Value::Null, args["name"].clone()));
            changes.push(change(
                "表单类型",
                Value::Null,
                args.get("formType").cloned().unwrap_or(json!("normal")),
            ));
            changes.push(change(
                "目标分组",
                Value::Null,
                args["parentGroupId"].clone(),
            ));
            "创建表单"
        }
        "platform_delete_form"
        | "platform_save_form_schema"
        | "platform_apply_design_patch"
        | "platform_move_form_to_group" => {
            let form =
                crate::modules::forms::find_form_definition(db, arg(args, "formUuid")?).await?;
            resource = json!({"kind":"form","id":form.form_uuid,"name":form.name,"appId":form.app_route_app_id,"version":form.current_schema_version});
            if call.name == "platform_delete_form" {
                let detail=rows(db,"SELECT jsonb_build_object('id',detail_form_uuid)::text data FROM form_detail_definitions WHERE source_form_uuid=$1",vec![form.form_uuid.clone().into()]).await.map_err(super::map_store)?;
                impacts.push(impact(
                    "主记录",
                    RecordRepository::new(db)
                        .count_for_deletion(&form.form_uuid)
                        .await?,
                    "包括已回收记录及子表数据；逻辑明细表删除只移除其定义",
                ));
                impacts.push(impact(
                    "关联明细表定义",
                    detail.len() as i64,
                    "由本表生成的明细表定义、Schema 与导航一起清理",
                ));
                warnings.push("表单版本、视图及导航会被清理；已有引用可能使业务校验拒绝删除。");
                "删除表单"
            } else if super::design::is_write(&call.name) {
                let prepared = super::design::prepare(db, call).await?;
                changes.extend(schema_changes(&prepared.base, &prepared.target));
                design_baseline = prepared.baseline;
                warnings.push("保存后立即成为当前版本；没有独立的发布步骤。字段结构变更可能影响已有记录和流程。");
                "保存表单设计"
            } else {
                let old = AppNavigationEntity::find()
                    .filter(
                        app_navigation_entity::Column::TargetFormUuid
                            .eq(Some(form.form_uuid.clone())),
                    )
                    .one(db)
                    .await?;
                changes.push(change(
                    "父分组",
                    old.map(|n| json!(n.parent_id)).unwrap_or(Value::Null),
                    args["parentGroupId"].clone(),
                ));
                "移动表单"
            }
        }
        "platform_create_detail_form" => {
            let form =
                crate::modules::forms::find_form_definition(db, arg(args, "sourceFormUuid")?)
                    .await?;
            resource = json!({"kind":"form","id":form.form_uuid,"name":form.name,"appId":form.app_route_app_id});
            changes.push(change(
                "子表字段",
                Value::Null,
                args["subformFieldId"].clone(),
            ));
            changes.push(change("明细表标题", Value::Null, args["title"].clone()));
            warnings.push("新增逻辑明细表入口，数据仍来自主表指定子表，不复制或提交业务记录。");
            "创建明细表"
        }
        "platform_create_navigation_group" => {
            changes.push(change("分组名称", Value::Null, args["title"].clone()));
            changes.push(change("父分组", Value::Null, args["parentGroupId"].clone()));
            "创建导航分组"
        }
        "platform_delete_navigation_group" => {
            let group=rows(db,"SELECT row_to_json(n)::text data FROM app_navigation_items n WHERE id::text=$1 AND app_route_app_id=$2 AND item_type='group'",vec![arg(args,"groupId")?.into(),arg(args,"appId")?.into()]).await.map_err(super::map_store)?.pop().ok_or_else(||AppError::NotFound("navigation group not found".into()))?;
            let children=rows(db,"SELECT jsonb_build_object('id',id)::text data FROM app_navigation_items WHERE parent_id::text=$1 AND app_route_app_id=$2",vec![arg(args,"groupId")?.into(),arg(args,"appId")?.into()]).await.map_err(super::map_store)?;
            resource = json!({"kind":"navigation_group","id":group["id"],"name":group["title"],"appId":args["appId"]});
            impacts.push(impact(
                "直属子项",
                children.len() as i64,
                "保留并移动到被删除分组的父级；不删除表单和记录",
            ));
            changes.push(change(
                "子项新父级",
                group["id"].clone(),
                group["parent_id"].clone(),
            ));
            "删除导航分组"
        }
        "platform_create_automation" => {
            super::development::validate_automation(db,call).await?;
            changes.push(change("自动化名称", Value::Null, args["name"].clone()));
            changes.push(change(
                "触发表单",
                Value::Null,
                args["triggerFormUuid"].clone(),
            ));
            changes.push(change(
                "触发事件",
                Value::Null,
                args["triggerEvents"].clone(),
            ));
            impacts.push(impact(
                "节点",
                args["nodes"].as_array().map_or(0, |n| n.len() as i64),
                "创建并原子保存完整图定义",
            ));
            impacts.push(impact(
                "连线",
                args["edges"].as_array().map_or(0, |n| n.len() as i64),
                "由平台图校验检查",
            ));
            changes.push(change("完整节点配置",Value::Null,args["nodes"].clone()));
            changes.push(change("完整连线",Value::Null,args["edges"].clone()));
            warnings.push("保存为暂停状态，不启用、不执行；纯设计校验不代表真实业务运行通过。");
            "创建自动化"
        }
        "platform_update_automation" => {
            super::development::validate_automation(db,call).await?;
            let flow=AutomationFlowEntity::find().filter(automation_flow_entity::Column::FlowUuid.eq(arg(args,"automationId")?)).one(db).await?.ok_or_else(||bad("automation unavailable"))?;
            resource=json!({"kind":"automation","id":flow.flow_uuid,"name":flow.name,"appId":flow.app_route_app_id,"version":flow.current_version});
            changes.push(change("节点与配置",flow.nodes_json,args["nodes"].clone()));
            changes.push(change("连线",flow.edges_json,args["edges"].clone()));
            if let Some(name)=args.get("name"){changes.push(change("名称",json!(flow.name),name.clone()));}
            if let Some(description)=args.get("description"){changes.push(change("说明",json!(flow.description),description.clone()));}
            warnings.push("仅修改已暂停的集成自动化；不启用、不试运行，也不修改审批流程。");
            "修改自动化"
        }
        "platform_delete_automation" => {
            let flow = AutomationFlowEntity::find()
                .filter(automation_flow_entity::Column::FlowUuid.eq(arg(args, "automationId")?))
                .one(db)
                .await?
                .ok_or_else(|| AppError::NotFound("automation not found".into()))?;
            if flow.flow_type == "process" {
                return Err(bad("workflow process is managed by its form"));
            }
            let buttons=rows(db,"SELECT jsonb_build_object('id',id)::text data FROM app_custom_buttons WHERE action_type='run_automation' AND action_config->>'automationId'=$1",vec![flow.flow_uuid.clone().into()]).await.map_err(super::map_store)?;
            resource = json!({"kind":"automation","id":flow.flow_uuid,"name":flow.name,"appId":flow.app_route_app_id,"version":flow.current_version});
            impacts.push(impact(
                "自定义按钮引用",
                buttons.len() as i64,
                "解除其自动化 ID 绑定；不删除按钮",
            ));
            warnings.push(
                "删除定义、图节点、连线和版本。已有运行引用按平台事务约束处理，失败时整体回滚。",
            );
            "删除自动化"
        }
        _ => return Err(bad("write preview is not implemented")),
    };
    Ok(
        json!({"version":1,"title":title,"action":call.name,"resource":resource,"changes":changes,"impacts":impacts,"warnings":warnings,"parametersHash":fingerprint(args),"productContract":crate::modules::development_contracts::identity(),"requiresConfirmation":true,"designBaseline":design_baseline}),
    )
}

fn schema_changes(previous: &Value, next: &Value) -> Vec<Value> {
    let fields = |schema: &Value| {
        schema["fields"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|field| {
                field["id"]
                    .as_str()
                    .map(|id| (id.to_owned(), field.clone()))
            })
            .collect::<std::collections::BTreeMap<_, _>>()
    };
    let before = fields(previous);
    let after = fields(next);
    let mut changes = vec![];
    for (id, field) in &after {
        if before.get(id) != Some(field) {
            changes.push(change(
                &format!("字段 {} ({id})", field["label"].as_str().unwrap_or(id)),
                before.get(id).cloned().unwrap_or(Value::Null),
                field.clone(),
            ))
        }
    }
    for (id, field) in &before {
        if !after.contains_key(id) {
            changes.push(change(
                &format!("删除字段 {id}"),
                field.clone(),
                Value::Null,
            ))
        }
    }
    for key in ["formName", "columns", "rows", "pageProps"] {
        if previous[key] != next[key] {
            changes.push(change(key, previous[key].clone(), next[key].clone()))
        }
    }
    let order = |schema: &Value| {
        json!(
            schema["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|f| f["id"].clone())
                .collect::<Vec<_>>()
        )
    };
    if order(previous) != order(next) {
        changes.push(change("字段顺序", order(previous), order(next)));
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn field_properties_layout_and_order_are_visible_in_preview() {
        let before = json!({"fields":[{"id":"a","type":"number","label":"A","colSpan":1,"props":{"minValue":0}},{"id":"b","label":"B"}],"pageProps":{}});
        let mut after = before.clone();
        after["fields"][0]["props"]["minValue"] = json!(20);
        after["fields"][0]["colSpan"] = json!(3);
        after["fields"].as_array_mut().unwrap().reverse();
        let changes = schema_changes(&before, &after);
        assert_eq!(changes[0]["before"]["props"]["minValue"], 0);
        assert_eq!(changes[0]["after"]["props"]["minValue"], 20);
        assert_eq!(changes[0]["after"]["colSpan"], 3);
        assert!(changes.iter().any(|c| c["label"] == "字段顺序"));
        assert_eq!(changes, schema_changes(&before, &after));
    }
}
