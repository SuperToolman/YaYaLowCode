use super::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

fn duplicate_diagnostics(bundle: &Value) -> Vec<Value> {
    let mut seen = BTreeMap::new();
    let mut issues = Vec::new();
    for member in bundle["members"].as_array().into_iter().flatten() {
        for (table, key) in protocol::TABLES {
            let label = match *table {
                "apps" => "应用",
                "form_definitions" => "表单",
                "form_schemas" => "表单字段结构",
                "form_views" => "表单视图",
                "app_navigation_items" => "导航菜单",
                "automation_flows" => "集成自动化",
                "app_custom_buttons" => "自定义按钮",
                _ => "明细表单配置",
            };
            for (position, row) in member["resources"][*table]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let Ok(id) = protocol::resource_identity(table, key, row) else {
                    continue;
                };
                let path = format!("/resources/{table}/{position}");
                let resource_name = row["name"]
                    .as_str()
                    .or_else(|| row["title"].as_str())
                    .unwrap_or("未命名配置");
                let form = row["form_uuid"]
                    .as_str()
                    .and_then(|id| {
                        member["resources"]["form_definitions"]
                            .as_array()?
                            .iter()
                            .find(|f| f["form_uuid"] == id)
                    })
                    .and_then(|f| f["name"].as_str());
                let location = form
                    .map(|name| format!("表单「{name}」 → {label}「{resource_name}」"))
                    .unwrap_or_else(|| format!("{label}「{resource_name}」"));
                if let Some((previous_app, previous_path)) = seen.insert(
                    (String::from(*table), id),
                    (member["appId"].clone(), path.clone()),
                ) {
                    issues.push(json!({"appId":member["appId"],"path":path,"message":format!("{location}在打包清单中出现重复配置"),"location":location,"suggestion":"请联系管理员检查该配置的重复保存或导出收集逻辑；不要删除表单或业务数据。","resourceId":row[*key],"previousAppId":previous_app,"previousPath":previous_path}));
                }
            }
        }
    }
    issues
}

/// Resolve source names from the captured snapshot, never from array indexes shown to users.
fn diagnostic_location(member: &Value, path: &str) -> String {
    let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
    if parts.len() < 3 || parts[0] != "resources" {
        return "应用发布设置".into();
    }
    let table = parts[1];
    let row = member
        .pointer(&format!("/resources/{}/{}", table, parts[2]))
        .unwrap_or(&Value::Null);
    let name = |value: &Value| -> Option<String> {
        ["label", "name", "title"].iter().find_map(|key| {
            value[*key]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
        })
    };
    let form = row["form_uuid"]
        .as_str()
        .and_then(|id| {
            member["resources"]["form_definitions"]
                .as_array()?
                .iter()
                .find(|f| f["form_uuid"] == id)
        })
        .and_then(name);
    let mut labels = Vec::new();
    if let Some(form) = form {
        labels.push(format!("表单「{form}」"));
    }
    let label = match table {
        "form_schemas" => "表单设计",
        "form_definitions" => "表单",
        "form_views" => "视图",
        "automation_flows" => "集成自动化",
        "app_custom_buttons" => "自定义按钮",
        "app_navigation_items" => "导航菜单",
        "form_detail_definitions" => "明细表单设置",
        _ => "应用设置",
    };
    if table != "form_schemas" {
        labels.push(
            name(row)
                .map(|n| format!("{label}「{n}」"))
                .unwrap_or_else(|| {
                    format!(
                        "{label}（第 {} 项）",
                        parts[2].parse::<usize>().unwrap_or(0) + 1
                    )
                }),
        );
    } else if labels.is_empty() {
        labels.push("表单设计（所属表单名称不可用）".into());
    }
    // Walk every ancestor so fields nested in sections/subtables retain their full location.
    for i in 3..parts.len().saturating_sub(1) {
        if !matches!(parts[i], "fields" | "children" | "nodes_json") {
            continue;
        }
        if let Ok(index) = parts[i + 1].parse::<usize>() {
            let pointer = format!("/{}", parts[..=i + 1].join("/"));
            if let Some(item) = member.pointer(&pointer) {
                let kind = if parts[i] == "nodes_json" {
                    "节点"
                } else {
                    "字段"
                };
                let item_name = if parts[i] == "nodes_json" {
                    name(&item["data"]).or_else(|| name(item))
                } else {
                    name(item)
                };
                labels.push(
                    item_name
                        .map(|n| format!("{kind}「{n}」（第 {} 项）", index + 1))
                        .unwrap_or_else(|| format!("未命名{kind}（第 {} 项）", index + 1)),
                );
            }
        }
    }
    let setting = match parts.last().copied().unwrap_or("") {
        "associationFormId" => "关联表单",
        "associationAppId" => "关联应用",
        "targetFormUuid" | "target_form_uuid" => "目标表单",
        "triggerFormUuid" | "trigger_form_uuid" => "触发表单",
        "sourceFormUuid" | "source_form_uuid" => "来源表单",
        "detailFormUuid" | "detail_form_uuid" | "detailSourceFormUuid" => "明细表单",
        "formUuid" | "form_uuid" => "所选表单",
        "viewUuid" => "所选视图",
        "automationId" | "flowUuid" | "processFlowId" => "调用的自动化",
        "buttonId" => "调用的按钮",
        "parent_id" => "上级导航",
        _ => "配置项",
    };
    labels.push(setting.into());
    labels.join(" → ")
}

fn missing_reference_issue(member: &Value, kind: &str, id: &str, path: &str) -> Value {
    let target = match kind {
        "form_definitions" => "表单",
        "form_views" => "视图",
        "automation_flows" => "集成自动化",
        "app_custom_buttons" => "按钮",
        "app_navigation_items" => "导航菜单",
        "apps" => "应用",
        _ => "资源",
    };
    let location = diagnostic_location(member, path);
    let action = if path.starts_with("/resources/form_schemas/") {
        "进入上述表单的设计页面，找到该字段，在字段属性中"
    } else if path.starts_with("/resources/automation_flows/") {
        "打开上述集成自动化，找到该节点，在节点配置中"
    } else if path.starts_with("/resources/form_views/") {
        "打开上述表单的视图设置，在该视图中"
    } else if path.starts_with("/resources/app_navigation_items/") {
        "打开应用导航设置，找到上述菜单，"
    } else if path.starts_with("/resources/app_custom_buttons/") {
        "打开上述自定义按钮的配置，"
    } else {
        "打开上述位置，"
    };
    let suggestion = format!(
        "{action}重新选择有效的{target}并保存，再点击“重新预检”。目标{target}可能已被删除，无法读取其原名称；无需删除当前表单或业务数据。"
    );
    json!({"appId":member["appId"],"path":path,"resourceId":id,"message":format!("找不到此处选择的{target}"),"location":location,"suggestion":suggestion})
}

pub(super) async fn capture(db: &impl ConnectionTrait, app_id: &str) -> Result<Value, AppError> {
    let mut resources = serde_json::Map::new();
    for (table, _) in protocol::TABLES {
        let predicate = match *table {
            "apps" => "t.route_app_id=$1".to_string(),
            "form_schemas" => "EXISTS(SELECT 1 FROM form_definitions f WHERE f.app_route_app_id=$1 AND f.form_uuid=t.form_uuid AND f.current_schema_version=t.version)".into(),
            "form_detail_definitions" => "EXISTS(SELECT 1 FROM form_definitions f WHERE f.app_route_app_id=$1 AND f.form_uuid=t.detail_form_uuid)".into(),
            "form_views" => "EXISTS(SELECT 1 FROM form_definitions f WHERE f.app_route_app_id=$1 AND f.form_uuid=t.form_uuid)".into(),
            _ => "t.app_route_app_id=$1".into(),
        };
        let excluded = match *table {
            "apps" => {
                "'created_at','updated_at','creator_user_id','owner_name','deployment_type','online_version','online_release_id','records_count'"
            }
            "app_navigation_items" => "'created_at','updated_at','visibility_rule'",
            "app_custom_buttons" | "automation_flows" => {
                "'created_at','updated_at','created_by','updated_by'"
            }
            _ => "'created_at','updated_at'",
        };
        let sql = format!(
            "SELECT COALESCE(jsonb_agg(to_jsonb(t)-ARRAY[{excluded}] ORDER BY t.id),'[]'::jsonb) AS value FROM {table} t WHERE {predicate}"
        );
        let value: Value = db
            .query_one_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![app_id.into()],
            ))
            .await?
            .ok_or_else(|| AppError::BadRequest("资源读取失败".into()))?
            .try_get("", "value")?;
        resources.insert(String::from(*table), value);
    }
    let storage = db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('form_uuid',s.form_uuid,'storage_mode',s.storage_mode,'compiled_schema_version',s.compiled_schema_version) ORDER BY s.form_uuid),'[]'::jsonb) AS value FROM form_storage_definitions s JOIN form_definitions f ON f.form_uuid=s.form_uuid WHERE f.app_route_app_id=$1", vec![app_id.into()])).await?.unwrap().try_get::<Value>("", "value")?;
    resources.insert("storageDefinitions".into(), storage);
    Ok(json!({"appId":app_id,"resources":resources}))
}

#[derive(Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublicationScopeRequest {
    pub selected_app_ids: Vec<String>,
}

pub(super) async fn scan(
    state: &AppState,
    headers: &HeaderMap,
    root: &str,
    selected: &[String],
) -> Result<Value, AppError> {
    super::publication_access::require_enabled()?;
    let user = authorization::current_user(headers, state).await?;
    let grants = authorization::grants(headers, state).await?;
    super::publication_access::require_administrator(&grants)?;
    scan_selected(
        &state.db,
        user.id,
        &user.display_name,
        &grants,
        root,
        selected,
    )
    .await
}
pub(super) async fn scan_for(
    db: &DatabaseConnection,
    user_id: Uuid,
    display_name: &str,
    grants: &HashSet<String>,
    root: &str,
) -> Result<Value, AppError> {
    scan_for_members(db, user_id, display_name, grants, root, &[]).await
}
pub(super) async fn scan_for_members(
    db: &DatabaseConnection,
    user_id: Uuid,
    display_name: &str,
    grants: &HashSet<String>,
    root: &str,
    additional: &[String],
) -> Result<Value, AppError> {
    let mut selected = additional.to_vec();
    selected.push(root.to_string());
    scan_selected(db, user_id, display_name, grants, root, &selected).await
}
pub(super) async fn scan_selected(
    db: &DatabaseConnection,
    user_id: Uuid,
    display_name: &str,
    grants: &HashSet<String>,
    context: &str,
    selected: &[String],
) -> Result<Value, AppError> {
    if selected.is_empty()
        || selected.len() > 256
        || selected
            .iter()
            .any(|id| id.trim().is_empty() || id.len() > 128)
    {
        return Err(AppError::BadRequest("请选择 1–256 个有效成员应用".into()));
    }
    let selected: BTreeSet<String> = selected.iter().cloned().collect();
    let txn = db.begin().await?;
    txn.execute_unprepared("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .await?;
    let mut queue: VecDeque<String> = selected.iter().cloned().collect();
    let mut visited = BTreeSet::new();
    let mut members = BTreeMap::new();
    let mut dependencies = Vec::new();
    let mut issues = Vec::new();
    while let Some(app_id) = queue.pop_front() {
        if !visited.insert(app_id.clone()) {
            continue;
        }
        let app = AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(&app_id))
            .one(&txn)
            .await?;
        let Some(app) = app else {
            issues.push(json!({"appId":app_id,"path":"/","message":"引用的应用不存在"}));
            continue;
        };
        if !grants.contains("*")
            && app.creator_user_id != Some(user_id)
            && !(app.creator_user_id.is_none() && app.owner_name == display_name)
        {
            issues.push(json!({"appId":app_id,"path":"/","message":"没有发布此成员应用的权限"}));
            continue;
        }
        if matches!(app.deployment_type.as_str(), "market" | "market_archived") {
            issues.push(json!({"appId":app_id,"path":"/","message":"已安装市场应用不能再次发布"}));
            continue;
        }
        let mut member = capture(&txn, &app_id).await?;
        for (i, flow) in member["resources"]["automation_flows"]
            .as_array_mut()
            .into_iter()
            .flatten()
            .enumerate()
        {
            protocol::normalize_automation(flow);
            for (path, message) in protocol::automation_issues(flow) {
                issues.push(json!({"appId":app_id,"flowId":flow["flow_uuid"],"flowName":flow["name"],"path":format!("/resources/automation_flows/{i}{path}"),"message":message}));
            }
        }
        let mut refs = Vec::new();
        protocol::references(&member["resources"], "/resources", &mut refs);
        validate_configuration(&member, "", &app_id, &mut issues);
        for (kind, id, pointer) in refs {
            let owner = match kind.as_str() {
                "apps" => Some(id.clone()),
                "form_definitions" => txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT app_route_app_id AS owner FROM form_definitions WHERE form_uuid=$1",vec![id.clone().into()])).await?.map(|r|r.try_get::<String>("","owner")).transpose()?,
                "automation_flows" => txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT app_route_app_id AS owner FROM automation_flows WHERE flow_uuid=$1 OR id::text=$1",vec![id.clone().into()])).await?.map(|r|r.try_get::<String>("","owner")).transpose()?,
                "form_views" => {
                    let scoped=serde_json::from_str::<(String,String)>(&id).ok();
                    let (query,values)=if let Some((form,view))=scoped { ("SELECT f.app_route_app_id AS owner FROM form_views v JOIN form_definitions f ON f.form_uuid=v.form_uuid WHERE v.view_uuid=$1 AND v.form_uuid=$2",vec![view.into(),form.into()]) } else { ("SELECT MIN(f.app_route_app_id) AS owner FROM form_views v JOIN form_definitions f ON f.form_uuid=v.form_uuid WHERE v.view_uuid=$1 HAVING COUNT(*)=1",vec![id.clone().into()]) };
                    txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,query,values)).await?.map(|r|r.try_get::<String>("","owner")).transpose()?
                },
                "app_custom_buttons" | "app_navigation_items" => {
                    let key = if kind == "app_custom_buttons" { "button_uuid" } else { "id::text" };
                    txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,format!("SELECT app_route_app_id AS owner FROM {kind} WHERE {key}=$1"),vec![id.clone().into()])).await?.map(|r|r.try_get::<String>("","owner")).transpose()?
                },
                _ => None,
            };
            match owner {
                None => issues.push(missing_reference_issue(&member, &kind, &id, &pointer)),
                Some(owner) if owner != app_id => {
                    dependencies.push(json!({"sourceAppId":app_id,"targetAppId":owner,"resourceType":kind,"resourceId":id,"path":pointer}));
                    queue.push_back(owner);
                }
                _ => (),
            }
        }
        members.insert(app_id, member);
    }
    txn.commit().await?;
    let members: Vec<_> = members.into_values().collect();
    let mut bundle = json!({"selectedAppIds":selected,"applicationType":if members.len()==1 {"single"}else{"suite"},"members":members,"dependencies":dependencies});
    bundle["dependencies"] = json!(protocol::dependency_graph(&bundle));
    issues.extend(duplicate_diagnostics(&bundle));
    for issue in &mut issues {
        if issue["location"].is_null() {
            if let Some(member) = bundle["members"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|m| m["appId"] == issue["appId"])
            {
                issue["location"] = json!(diagnostic_location(
                    member,
                    issue["path"].as_str().unwrap_or("/")
                ));
            }
        }
    }
    if issues.is_empty() {
        if let Err(message) = protocol::resources(&bundle) {
            issues.push(json!({"appId":context,"path":"/","message":message}));
        }
    }
    let fingerprint = protocol::digest(
        &serde_json::to_vec(&bundle).map_err(|e| AppError::BadRequest(e.to_string()))?,
    );
    Ok(json!({"bundle":bundle,"fingerprint":fingerprint,"blockingIssues":issues}))
}

fn validate_configuration(value: &Value, path: &str, app: &str, issues: &mut Vec<Value>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let pointer = format!("{path}/{key}");
                if let Some(message) = protocol::configuration_issue(key, child) {
                    issues.push(json!({"appId":app,"path":pointer,"message":message}));
                }
                validate_configuration(child, &pointer, app, issues);
            }
        }
        Value::Array(items) => {
            for (i, v) in items.iter().enumerate() {
                validate_configuration(v, &format!("{path}/{i}"), app, issues)
            }
        }
        _ => (),
    }
}

pub(crate) async fn preflight(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app): Path<String>,
    Json(request): Json<PublicationScopeRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let result = scan(&state, &headers, &app, &request.selected_app_ids).await?;
    let bundle = &result["bundle"];
    Ok(Json(success_response(
        "发布预检完成",
        json!({"selectedAppIds":bundle["selectedAppIds"],"fingerprint":result["fingerprint"],"applicationType":bundle["applicationType"],"members":bundle["members"].as_array().unwrap().iter().map(|m|json!({"appId":m["appId"],"name":m["resources"]["apps"][0]["name"]})).collect::<Vec<_>>(),"dependencies":bundle["dependencies"],"resourceSummary":summary(bundle),"blockingIssues":result["blockingIssues"],"configurationRequired":["安装后配置应用访问权限；自动化默认暂停"]}),
    )))
}

pub(super) fn summary(bundle: &Value) -> Value {
    let mut result = json!({"applications":bundle["members"].as_array().map_or(0,Vec::len)});
    for (name, table) in [
        ("forms", "form_definitions"),
        ("automations", "automation_flows"),
        ("navigation", "app_navigation_items"),
        ("views", "form_views"),
        ("buttons", "app_custom_buttons"),
    ] {
        result[name] = json!(
            bundle["members"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|m| m["resources"][table].as_array().map_or(0, Vec::len))
                .sum::<usize>()
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_reference_names_the_source_form_and_nested_field() {
        let member = json!({"appId":"customers","resources":{
            "form_definitions":[{"form_uuid":"contacts","name":"客户档案"}],
            "form_schemas":[{"form_uuid":"contacts","schema_json":{"fields":[{"label":"业务明细","children":[{"label":"供应商","props":{"associationFormId":"deleted"}}]}]}}]
        }});
        let issue = missing_reference_issue(
            &member,
            "form_definitions",
            "deleted",
            "/resources/form_schemas/0/schema_json/fields/0/children/0/props/associationFormId",
        );
        assert_eq!(issue["message"], "找不到此处选择的表单");
        assert_eq!(
            issue["location"],
            "表单「客户档案」 → 字段「业务明细」（第 1 项） → 字段「供应商」（第 1 项） → 关联表单"
        );
        assert!(
            issue["suggestion"]
                .as_str()
                .unwrap()
                .contains("重新选择有效的表单")
        );
        assert!(
            issue["suggestion"]
                .as_str()
                .unwrap()
                .contains("无法读取其原名称")
        );
        assert_eq!(issue["resourceId"], "deleted");
    }

    #[test]
    fn missing_reference_distinguishes_views_and_automation_nodes() {
        let member = json!({"appId":"customers","resources":{
            "form_definitions":[{"form_uuid":"contacts","name":"客户档案"}],
            "form_views":[{"form_uuid":"contacts","name":"待跟进客户","config":{"viewUuid":"missing"}}],
            "automation_flows":[{"name":"客户同步","nodes_json":[{"data":{"label":"读取客户","config":{"formUuid":"missing"}}}]}]
        }});
        let view = missing_reference_issue(
            &member,
            "form_views",
            "missing",
            "/resources/form_views/0/config/viewUuid",
        );
        assert_eq!(
            view["location"],
            "表单「客户档案」 → 视图「待跟进客户」 → 所选视图"
        );
        assert_eq!(view["message"], "找不到此处选择的视图");
        let flow = missing_reference_issue(
            &member,
            "form_definitions",
            "missing",
            "/resources/automation_flows/0/nodes_json/0/data/config/formUuid",
        );
        assert_eq!(
            flow["location"],
            "集成自动化「客户同步」 → 节点「读取客户」（第 1 项） → 所选表单"
        );
    }

    #[test]
    fn unnamed_fields_get_a_human_position_without_exposing_ids() {
        let member = json!({"resources":{"form_schemas":[{"schema_json":{"fields":[{"id":"technical-field","props":{"associationFormId":"deleted"}}]}}]}});
        let location = diagnostic_location(
            &member,
            "/resources/form_schemas/0/schema_json/fields/0/props/associationFormId",
        );
        assert!(location.contains("未命名字段（第 1 项）"));
        assert!(!location.contains("technical-field"));
        assert!(!location.contains("/resources/"));
    }

    #[test]
    fn duplicate_diagnostics_names_the_form_view_and_both_locations() {
        let mut bundle = protocol::tests::bundle();
        let view = bundle["members"][0]["resources"]["form_views"][0].clone();
        bundle["members"][0]["resources"]["form_views"]
            .as_array_mut()
            .unwrap()
            .push(view);
        let issues = duplicate_diagnostics(&bundle);
        assert_eq!(issues.len(), 1);
        assert!(issues[0]["message"].as_str().unwrap().contains("表单视图"));
        assert!(issues[0]["location"].as_str().unwrap().contains("视图"));
        assert_eq!(issues[0]["path"], "/resources/form_views/1");
        assert_eq!(issues[0]["previousPath"], "/resources/form_views/0");
        assert!(
            issues[0]["suggestion"]
                .as_str()
                .unwrap()
                .contains("不要删除")
        );
    }
    #[tokio::test]
    #[ignore = "requires MARKET_PREFLIGHT_APP and WORKFLOW_TEST_DATABASE_SETTINGS_PATH; read-only"]
    async fn existing_application_read_only_preflight() {
        let settings: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("WORKFLOW_TEST_DATABASE_SETTINGS_PATH").unwrap()).unwrap(),
        )
        .unwrap();
        let config: crate::platform::config::DatabaseSettings =
            serde_json::from_value(settings["database"].clone()).unwrap();
        let mut options = sea_orm::ConnectOptions::new(config.to_database_url());
        options.max_connections(1).sqlx_logging(false);
        let db = sea_orm::Database::connect(options).await.unwrap();
        db.execute_unprepared("SET default_transaction_read_only=on")
            .await
            .unwrap();
        let result = scan_for(
            &db,
            Uuid::nil(),
            "read-only verification",
            &HashSet::from(["*".into()]),
            &std::env::var("MARKET_PREFLIGHT_APP").unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(result["blockingIssues"], json!([]));
        println!(
            "Read-only preflight passed: {} members",
            result["bundle"]["members"].as_array().unwrap().len()
        );
        // Export/read validation must also accept the existing default views.
        let (_, bytes) =
            super::super::publication::build_package(&result["bundle"], "1.0.0").unwrap();
        protocol::read(&bytes).unwrap();
    }
}
