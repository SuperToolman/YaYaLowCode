use super::*;
use crate::platform::records::StoredFormRecord;
use axum::http::StatusCode;
use sha2::{Digest, Sha256};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResolveButtonFillRequest {
    pub record_id: String,
    pub target_record_id: Option<String>,
    pub page: Option<u64>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubmitButtonFillRequest {
    pub record_id: String,
    pub target_record_id: Option<String>,
    pub operation: String,
    pub request_id: Uuid,
    pub configuration_version: String,
    pub data: Value,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedButtonFill {
    pub operation: String,
    pub target_record: Option<forms::ApiFormRecord>,
    pub candidates: Vec<forms::ApiFormRecord>,
    pub total: usize,
    pub page: u64,
    pub page_size: u64,
    pub initial_values: Value,
    pub configuration_version: String,
}

fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn stale() -> AppError {
    AppError::Conflict("填写目标或按钮配置已变化，请重新加载后操作".into())
}

pub(super) async fn validate_association(
    state: &AppState,
    button: &ApiCustomButton,
    source: &str,
) -> Result<(), AppError> {
    if button.action_config.target_form_uuid == source {
        if !button.action_config.association_rules.is_empty() {
            return Err(bad("同表填写配置已失效，请重新配置"));
        }
        return Ok(());
    }
    let rules = &button.action_config.association_rules;
    if rules.is_empty() {
        return Err(bad("需重新配置：请补充关联实例条件"));
    }
    let form = forms::find_form_definition(&state.db, source).await?;
    let keys = valid_condition_fields(&schema(state, source).await?, form.form_type == "workflow");
    for rule in rules.iter().filter(|r| r.is_group != Some(true)) {
        if rule.value_type.as_deref() == Some("field")
            && ![Some("hasValue"), Some("noValue")].contains(&rule.operator.as_deref())
            && !rule
                .source_field_key
                .as_ref()
                .is_some_and(|key| keys.contains(key))
        {
            return Err(bad("关联条件来源字段已失效，请重新配置"));
        }
    }
    Ok(())
}

fn writable_ids(schema: &Value) -> HashSet<String> {
    schema["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| WRITABLE_TYPES.contains(&f["type"].as_str().unwrap_or("")))
        .filter(|f| {
            !SYSTEM_FIELDS.contains(&f["id"].as_str().unwrap_or(""))
                && !WORKFLOW_FIELDS.contains(&f["id"].as_str().unwrap_or(""))
        })
        .filter(|f| {
            f["props"]["isReadOnly"] != true
                && f["props"]["isHidden"] != true
                && f["props"]["isDisabled"] != true
        })
        .filter_map(|f| f["id"].as_str().map(str::to_owned))
        .collect()
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(s) => s.trim().into(),
        Value::Null => String::new(),
        _ => value.to_string(),
    }
}
fn has_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        _ => true,
    }
}
fn typed_value(raw: &str, field: Option<&Value>) -> Result<Value, AppError> {
    let kind = field
        .and_then(|f| f["type"].as_str())
        .unwrap_or("singleLineText");
    match kind {
        "number" => serde_json::from_str::<Value>(raw)
            .ok()
            .filter(Value::is_number)
            .ok_or_else(|| bad("关联条件数字格式无效")),
        "member" if field.is_none_or(|f| f["props"]["memberMultiple"] != true) => Ok(json!(raw)),
        "countryCity" | "richText" => serde_json::from_str::<Value>(raw)
            .ok()
            .filter(Value::is_object)
            .ok_or_else(|| bad("关联条件需要有效的结构化值")),
        "checkbox" | "multiSelect" | "member" | "department" | "dateRange" | "attachment"
        | "imageUpload" | "subform" => {
            if let Ok(value) = serde_json::from_str::<Value>(raw) {
                if value.is_array() {
                    return Ok(value);
                }
            }
            if ["checkbox", "multiSelect", "member", "department"].contains(&kind) {
                Ok(json!(
                    raw.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                ))
            } else {
                Err(bad("关联条件需要有效的数组值"))
            }
        }
        _ => Ok(json!(raw)),
    }
}

/// Resolve source references once. Matching and default derivation share typed values.
fn resolve_rules(
    rules: &[ButtonConditionRule],
    source: &Value,
    schema: &Value,
) -> Result<(Vec<Value>, HashMap<String, Value>), AppError> {
    let mut resolved = Vec::new();
    let mut expected = HashMap::new();
    for rule in rules {
        let mut value = json!(rule);
        if rule.is_group != Some(true)
            && ![Some("hasValue"), Some("noValue")].contains(&rule.operator.as_deref())
        {
            let field = schema["fields"].as_array().and_then(|fields| {
                fields
                    .iter()
                    .find(|f| f["id"].as_str() == rule.field_key.as_deref())
            });
            let data = if rule.value_type.as_deref() == Some("field") {
                let data = source
                    .get(rule.source_field_key.as_deref().unwrap_or(""))
                    .cloned()
                    .unwrap_or(Value::Null);
                if !has_value(&data) {
                    return Err(bad("关联条件引用的当前记录字段无值，请先补全来源数据"));
                }
                if rule.operator.as_deref().unwrap_or("eq") == "eq" {
                    typed_value(&scalar(&data), field)?
                } else {
                    data
                }
            } else if rule.operator.as_deref().unwrap_or("eq") == "eq" {
                typed_value(rule.raw_value.as_deref().unwrap_or(""), field)?
            } else {
                json!(rule.raw_value.as_deref().unwrap_or(""))
            };
            value["valueType"] = json!("value");
            value["rawValue"] = json!(scalar(&data));
            expected.insert(rule.id.clone(), data);
        }
        resolved.push(value);
    }
    Ok((resolved, expected))
}

// None marks a conflicting assignment, which must survive AND merges.
type Defaults = HashMap<String, Option<Value>>;
fn merge_defaults(mut left: Defaults, right: Defaults, or: bool) -> Defaults {
    if or {
        left.retain(|key, value| value.is_some() && right.get(key) == Some(value));
    } else {
        for (key, value) in right {
            left.entry(key)
                .and_modify(|previous| {
                    if *previous != value {
                        *previous = None;
                    }
                })
                .or_insert(value);
        }
    }
    left
}
fn defaults_group(
    rules: &[ButtonConditionRule],
    parent: Option<&str>,
    expected: &HashMap<String, Value>,
) -> Defaults {
    let siblings = rules
        .iter()
        .filter(|r| r.parent_id.as_deref().filter(|s| !s.is_empty()) == parent)
        .collect::<Vec<_>>();
    let or = siblings
        .first()
        .is_some_and(|r| r.logical_operator.as_deref() == Some("or"));
    let mut result = None;
    for rule in siblings {
        let children = rules
            .iter()
            .filter(|r| r.parent_id.as_deref() == Some(&rule.id))
            .collect::<Vec<_>>();
        let leaf =
            if rule.operator.as_deref().unwrap_or("eq") == "eq" && rule.is_group != Some(true) {
                rule.field_key
                    .as_ref()
                    .zip(expected.get(&rule.id))
                    .map(|(key, value)| HashMap::from([(key.clone(), Some(value.clone()))]))
                    .unwrap_or_default()
            } else {
                Defaults::new()
            };
        let next = if rule.is_group == Some(true) {
            defaults_group(rules, Some(&rule.id), expected)
        } else if let Some(first) = children.first() {
            merge_defaults(
                leaf,
                defaults_group(rules, Some(&rule.id), expected),
                first.logical_operator.as_deref() == Some("or"),
            )
        } else {
            leaf
        };
        result = Some(match result {
            None => next,
            Some(previous) => merge_defaults(previous, next, or),
        });
    }
    result.unwrap_or_default()
}

async fn rule_data<C: ConnectionTrait>(
    db: &C,
    record: &StoredFormRecord,
    rules: &[Value],
) -> Result<Value, AppError> {
    let mut data = automations::record_data_with_automation_identity(record.clone());
    if rules.iter().any(|r| {
        r["fieldKey"] == "submitterOrganization" || r["sourceFieldKey"] == "submitterOrganization"
    }) {
        use crate::infrastructure::entities::{
            iam_user_entity as user, organization_unit_entity as unit,
        };
        let author = user::Entity::find()
            .filter(user::Column::DisplayName.eq(&record.created_by))
            .one(db)
            .await?;
        let organization =
            if let Some(id) = author.and_then(|user| user.primary_organization_unit_id) {
                unit::Entity::find_by_id(id)
                    .one(db)
                    .await?
                    .map(|unit| unit.name)
            } else {
                None
            };
        data["submitterOrganization"] = json!(organization);
    }
    Ok(data)
}

fn replay(
    record: StoredFormRecord,
    values: &serde_json::Map<String, Value>,
) -> Result<(StatusCode, Json<ApiResponse<forms::ApiFormRecord>>), AppError> {
    if values
        .iter()
        .any(|(key, value)| record.record_data.get(key) != Some(value))
    {
        return Err(AppError::Conflict(
            "该请求标识已用于其他填写数据，请重新加载后提交".into(),
        ));
    }
    Ok((
        StatusCode::OK,
        Json(success_response(
            "该请求已提交",
            forms::ApiFormRecord::from(record),
        )),
    ))
}

async fn matching_records<C: ConnectionTrait>(
    db: &C,
    target: &str,
    rules: &[Value],
) -> Result<Vec<StoredFormRecord>, AppError> {
    let repository = RecordRepository::new(db);
    let mut records = Vec::new();
    let mut page = 1;
    loop {
        let (items, total) = repository.list_page(target, page, 100).await?;
        for record in items {
            if automations::expression::evaluate_record_rule_group(
                rules,
                None,
                &rule_data(db, &record, rules).await?,
            ) {
                records.push(record);
            }
        }
        if page * 100 >= total as u64 {
            break;
        }
        page += 1;
    }
    Ok(records)
}

async fn authorize_write(
    state: &AppState,
    headers: &HeaderMap,
    target: &str,
    id: Option<&str>,
) -> Result<(), AppError> {
    let method = if id.is_some() {
        Method::PATCH
    } else {
        Method::POST
    };
    let path = id
        .map(|id| format!("/api/forms/{target}/records/{id}"))
        .unwrap_or_else(|| format!("/api/forms/{target}/records"));
    authorization::authorize_request(headers, state, &method, &path).await?;
    Ok(())
}

async fn ensure_workflow_editable(
    state: &AppState,
    headers: &HeaderMap,
    record: &StoredFormRecord,
) -> Result<(), AppError> {
    let form = forms::find_form_definition(&state.db, &record.form_uuid).await?;
    if form.form_type == "workflow" && record.record_data["workflowApprovalStatus"] != "saved" {
        use crate::infrastructure::entities::{
            workflow_instance_entity as instance, workflow_task_entity as task,
        };
        if record.record_data["workflowApprovalStatus"] == "reviewing" {
            let user = authorization::current_user(headers, state).await?;
            if let Some(instance) = instance::Entity::find()
                .filter(instance::Column::FormUuid.eq(&record.form_uuid))
                .filter(instance::Column::RecordUuid.eq(&record.record_uuid))
                .filter(instance::Column::Status.eq("running"))
                .one(&state.db)
                .await?
            {
                if task::Entity::find()
                    .filter(task::Column::InstanceId.eq(instance.id))
                    .filter(task::Column::TaskType.eq("execution"))
                    .filter(task::Column::Status.eq("pending"))
                    .filter(task::Column::AssigneeUserId.eq(user.id))
                    .one(&state.db)
                    .await?
                    .is_some()
                {
                    return Ok(());
                }
            }
        }
        return Err(bad(
            "当前流程实例不可编辑，仅保存状态或当前待办执行人可编辑",
        ));
    }
    Ok(())
}

pub(crate) async fn resolve_view_button_fill(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, view_uuid, button_uuid)): Path<(String, String, String)>,
    Json(payload): Json<ResolveButtonFillRequest>,
) -> Result<Json<ApiResponse<ResolvedButtonFill>>, AppError> {
    let button = check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    if button.action_type != "fill_form" {
        return Err(bad("该按钮不支持填写"));
    }
    let config = &button.action_config;
    let source = RecordRepository::new(&state.db)
        .find(&form_uuid, &payload.record_id)
        .await?;
    let target_schema = schema(&state, &config.target_form_uuid).await?;
    let (rules, expected) = resolve_rules(
        &config.association_rules,
        &rule_data(
            &state.db,
            &source,
            &config
                .association_rules
                .iter()
                .map(|r| json!(r))
                .collect::<Vec<_>>(),
        )
        .await?,
        &target_schema,
    )?;
    let records = if form_uuid == config.target_form_uuid {
        vec![source]
    } else {
        matching_records(&state.db, &config.target_form_uuid, &rules).await?
    };
    let total = records.len();
    let selected = if let Some(id) = payload.target_record_id.as_deref() {
        Some(
            records
                .iter()
                .find(|record| record.record_uuid == id)
                .ok_or_else(stale)?
                .clone(),
        )
    } else if total == 1 {
        records.first().cloned()
    } else {
        None
    };
    if let Some(record) = &selected {
        authorize_write(
            &state,
            &headers,
            &config.target_form_uuid,
            Some(&record.record_uuid),
        )
        .await?;
        ensure_workflow_editable(&state, &headers, record).await?;
    } else {
        authorize_write(
            &state,
            &headers,
            &config.target_form_uuid,
            if total == 0 { None } else { Some("candidate") },
        )
        .await?;
    }
    let writable = writable_ids(&target_schema);
    let defaults: serde_json::Map<String, Value> =
        defaults_group(&config.association_rules, None, &expected)
            .into_iter()
            .filter_map(|(key, value)| {
                value
                    .filter(|_| writable.contains(&key))
                    .map(|value| (key, value))
            })
            .collect();
    let page = payload
        .page
        .unwrap_or(1)
        .clamp(1, (total as u64).div_ceil(20).max(1));
    let candidates = if selected.is_none() && total > 1 {
        records
            .into_iter()
            .skip(((page - 1) * 20) as usize)
            .take(20)
            .map(forms::ApiFormRecord::from)
            .collect()
    } else {
        vec![]
    };
    Ok(Json(success_response(
        "填写目标已解析",
        ResolvedButtonFill {
            operation: if selected.is_some() {
                "update"
            } else if total == 0 {
                "create"
            } else {
                "select"
            }
            .into(),
            initial_values: selected
                .as_ref()
                .map(|record| record.record_data.clone())
                .unwrap_or(Value::Object(defaults)),
            target_record: selected.map(forms::ApiFormRecord::from),
            candidates,
            total,
            page,
            page_size: 20,
            configuration_version: button.updated_at,
        },
    )))
}

pub(crate) async fn submit_view_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, view_uuid, button_uuid)): Path<(String, String, String)>,
    Json(payload): Json<SubmitButtonFillRequest>,
) -> Result<(StatusCode, Json<ApiResponse<forms::ApiFormRecord>>), AppError> {
    let button = check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    if button.action_type != "fill_form" {
        return Err(bad("该按钮不支持填写"));
    }
    if button.updated_at != payload.configuration_version {
        return Err(stale());
    }
    let config = &button.action_config;
    let user = authorization::current_user(&headers, &state).await?;
    let digest = Sha256::digest(
        serde_json::to_vec(&(
            user.id,
            &form_uuid,
            &view_uuid,
            &button_uuid,
            &payload.record_id,
            payload.request_id,
        ))
        .map_err(|_| bad("请求标识无效"))?,
    );
    let new_id = format!("BFR-{}", &format!("{digest:x}")[..32]);
    let definition = forms::find_form_definition(&state.db, &config.target_form_uuid).await?;
    let target_schema = schema(&state, &config.target_form_uuid).await?;
    let values = payload
        .data
        .as_object()
        .ok_or_else(|| bad("填写数据必须为对象"))?;
    let same = form_uuid == config.target_form_uuid;
    let allowed: HashSet<String> = if same {
        config.field_ids.iter().cloned().collect()
    } else {
        writable_ids(&target_schema)
    };
    if values.keys().any(|key| !allowed.contains(key)) {
        return Err(bad("不能提交按钮配置之外或不可编辑的字段"));
    }
    authorize_write(
        &state,
        &headers,
        &config.target_form_uuid,
        payload.target_record_id.as_deref(),
    )
    .await?;
    let txn = state.db.begin().await?;
    let repository = RecordRepository::new(&txn);
    if payload.operation == "create" {
        repository.lock_button_submission(&new_id).await?;
    }
    // Run synchronous before-events before acquiring the storage scope lock. Their
    // persistent executions use separate connections and may themselves write records.
    let preliminary = if payload.operation == "update" {
        let id = payload.target_record_id.as_deref().ok_or_else(stale)?;
        let record = RecordRepository::new(&state.db)
            .find(&config.target_form_uuid, id)
            .await?;
        ensure_workflow_editable(&state, &headers, &record).await?;
        Some(record)
    } else if payload.operation == "create" && !same && payload.target_record_id.is_none() {
        None
    } else {
        return Err(stale());
    };
    if payload.operation == "create" {
        match RecordRepository::new(&state.db)
            .find(&config.target_form_uuid, &new_id)
            .await
        {
            Ok(record) => return replay(record, values),
            Err(AppError::NotFound(_)) => (),
            Err(error) => return Err(error),
        }
    }
    // Validate matching before running any before-event; repeat under the lock below.
    let source = RecordRepository::new(&state.db)
        .find(&form_uuid, &payload.record_id)
        .await?;
    let (pre_rules, _) = resolve_rules(
        &config.association_rules,
        &rule_data(
            &state.db,
            &source,
            &config
                .association_rules
                .iter()
                .map(|r| json!(r))
                .collect::<Vec<_>>(),
        )
        .await?,
        &target_schema,
    )?;
    if let Some(record) = &preliminary {
        let data = rule_data(&state.db, record, &pre_rules).await?;
        if (same && record.record_uuid != source.record_uuid)
            || (!same
                && !automations::expression::evaluate_record_rule_group(&pre_rules, None, &data))
        {
            return Err(stale());
        }
    } else if !matching_records(&state.db, &config.target_form_uuid, &pre_rules)
        .await?
        .is_empty()
    {
        return Err(stale());
    }
    let mut before_data = preliminary
        .as_ref()
        .map(|record| record.record_data.clone())
        .unwrap_or(json!({}));
    before_data
        .as_object_mut()
        .ok_or_else(|| bad("实例数据无效"))?
        .extend(values.clone());
    forms::before_form_record_write(
        &state.db,
        &definition,
        preliminary.as_ref(),
        &before_data,
        &user.display_name,
        user.id,
    )
    .await?;
    // Lock both scopes in a stable order so source edits cannot race matching.
    let mut scopes = vec![form_uuid.as_str(), config.target_form_uuid.as_str()];
    scopes.sort_unstable();
    scopes.dedup();
    for scope in scopes {
        form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(scope))
            .lock_shared()
            .one(&txn)
            .await?
            .ok_or_else(stale)?;
        repository.lock_validation_scope(scope).await?;
    }
    // Serialize with all ordinary record inserts/updates using the repository's scope lock.
    if payload.operation == "create" {
        authorize_write(&state, &headers, &config.target_form_uuid, None).await?;
        match repository.find(&config.target_form_uuid, &new_id).await {
            Ok(record) => return replay(record, values),
            Err(AppError::NotFound(_)) => (),
            Err(error) => return Err(error),
        }
    }
    let source = repository
        .find_for_update(&form_uuid, &payload.record_id)
        .await?;
    let (rules, _) = resolve_rules(
        &config.association_rules,
        &rule_data(
            &state.db,
            &source,
            &config
                .association_rules
                .iter()
                .map(|r| json!(r))
                .collect::<Vec<_>>(),
        )
        .await?,
        &target_schema,
    )?;
    let same = form_uuid == config.target_form_uuid;
    let matches = if same {
        vec![source]
    } else {
        matching_records(&txn, &config.target_form_uuid, &rules).await?
    };
    let current = match payload.operation.as_str() {
        "update" => {
            let id = payload.target_record_id.as_deref().ok_or_else(stale)?;
            let matched = matches
                .into_iter()
                .find(|record| record.record_uuid == id)
                .ok_or_else(stale)?;
            let record = repository
                .find_for_update(&config.target_form_uuid, id)
                .await
                .map_err(|error| {
                    if matches!(error, AppError::NotFound(_)) {
                        stale()
                    } else {
                        error
                    }
                })?;
            if record.updated_at != matched.updated_at {
                return Err(stale());
            }
            authorize_write(&state, &headers, &config.target_form_uuid, Some(id)).await?;
            ensure_workflow_editable(&state, &headers, &record).await?;
            Some(record)
        }
        "create" if !same && matches.is_empty() && payload.target_record_id.is_none() => None,
        _ => return Err(stale()),
    };
    if current.as_ref().map(|r| r.updated_at) != preliminary.as_ref().map(|r| r.updated_at) {
        return Err(stale());
    }
    let latest = button::Entity::find()
        .filter(button::Column::ButtonUuid.eq(&button_uuid))
        .lock_shared()
        .one(&txn)
        .await?
        .ok_or_else(stale)?;
    if latest.updated_at.to_rfc3339() != payload.configuration_version {
        return Err(stale());
    }
    form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq(&form_uuid))
        .filter(form_view_entity::Column::ViewUuid.eq(&view_uuid))
        .lock_shared()
        .one(&txn)
        .await?
        .ok_or_else(stale)?;
    check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    if schema(&state, &config.target_form_uuid).await? != target_schema
        || forms::find_form_definition(&state.db, &config.target_form_uuid)
            .await?
            .current_schema_version
            != definition.current_schema_version
    {
        return Err(stale());
    }
    let mut data = current
        .as_ref()
        .map(|record| record.record_data.clone())
        .unwrap_or(json!({}));
    data.as_object_mut()
        .ok_or_else(|| bad("实例数据无效"))?
        .extend(values.clone());
    let record = forms::write_form_record_in_transaction(
        &txn,
        &definition,
        current.as_ref(),
        data,
        &user.display_name,
        user.id,
        Some(&new_id),
    )
    .await?;
    txn.commit().await?;
    forms::invalidate_form_records_cache(&state, &config.target_form_uuid).await;
    Ok((
        if current.is_some() {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Json(success_response(
            "填写保存成功",
            forms::ApiFormRecord::from(record),
        )),
    ))
}

#[cfg(test)]
pub(crate) mod tests;
