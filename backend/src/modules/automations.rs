use crate::modules::forms;
use crate::modules::forms::dto::RestoreVersionRequest;
use crate::platform::automation_runs::{
    RetrySource, create_automation_run, create_automation_run_node_log, finalize_automation_run,
    finalize_automation_run_node_log,
};
use crate::platform::prelude::*;
use crate::platform::records::RecordRepository;
use crate::shared::*;
use axum::http::StatusCode;

pub(crate) async fn list_automation_flows(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<ApiAutomationFlowList>>, AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_desc(automation_flow_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    let total = flows.len() as i64;
    let enabled = flows.iter().filter(|flow| flow.status == "enabled").count() as i64;
    let paused = flows.iter().filter(|flow| flow.status == "paused").count() as i64;
    let draft = flows.iter().filter(|flow| flow.status == "draft").count() as i64;

    Ok(Json(success_response(
        "获取集成自动化列表成功",
        ApiAutomationFlowList {
            items: flows.into_iter().map(ApiAutomationFlow::from).collect(),
            total,
            enabled,
            paused,
            draft,
        },
    )))
}

pub(crate) async fn create_automation_flow(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<CreateAutomationFlowRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAutomationFlow>>), AppError> {
    AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let payload = payload
        .map(|Json(value)| value)
        .unwrap_or(CreateAutomationFlowRequest {
            name: None,
            description: None,
            trigger_form_uuid: None,
            trigger_event: None,
            operator: None,
        });
    let now = Utc::now();
    let operator = normalize_operator(payload.operator);
    let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
    let trigger_event = normalize_automation_trigger_event(
        payload.trigger_event.as_deref().unwrap_or("after_create"),
    )?;

    if let Some(form_uuid) = trigger_form_uuid.as_deref() {
        ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
    }

    let txn = state.db.begin().await?;
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set(generate_automation_flow_uuid()),
        app_route_app_id: Set(app_id),
        name: Set(normalize_optional_text(payload.name)
            .unwrap_or_else(|| format!("未命名自动化 {}", now.format("%m%d%H%M")))),
        description: Set(normalize_optional_text(payload.description)),
        status: Set("draft".to_string()),
        current_version: Set(1),
        trigger_form_uuid: Set(trigger_form_uuid),
        trigger_event: Set(trigger_event),
        trigger_config: Set(json!({})),
        nodes_json: Set(json!([])),
        edges_json: Set(json!([])),
        created_by: Set(operator.clone()),
        updated_by: Set(operator),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;

    create_automation_snapshot(&txn, &flow, None).await?;
    txn.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建集成自动化成功",
            ApiAutomationFlow::from(flow),
        )),
    ))
}

pub(crate) async fn get_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiAutomationFlowDetail>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    Ok(Json(success_response(
        "获取集成自动化详情成功",
        ApiAutomationFlowDetail::from(flow),
    )))
}

pub(crate) async fn list_automation_flow_versions(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAutomationFlowVersionSummary>>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let versions = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .order_by_desc(automation_flow_version_entity::Column::Version)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取自动化版本列表成功",
        versions
            .into_iter()
            .map(ApiAutomationFlowVersionSummary::from)
            .collect(),
    )))
}

pub(crate) async fn restore_automation_flow_version(
    State(state): State<AppState>,
    Path((flow_uuid, version)): Path<(String, i32)>,
    payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiAutomationFlowDetail>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let snapshot = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow version not found".to_string()))?;

    let now = Utc::now();
    let next_version = flow.current_version + 1;
    let change_summary = payload
        .and_then(|Json(value)| value.change_log)
        .unwrap_or_else(|| format!("restored from v{version}"));

    let mut active_model: automation_flow_entity::ActiveModel = flow.into();
    active_model.name = Set(snapshot.name.clone());
    active_model.description = Set(snapshot.description.clone());
    active_model.status = Set(snapshot.status.clone());
    active_model.current_version = Set(next_version);
    active_model.trigger_form_uuid = Set(snapshot.trigger_form_uuid.clone());
    active_model.trigger_event = Set(snapshot.trigger_event.clone());
    active_model.trigger_config = Set(snapshot.trigger_config.clone());
    active_model.nodes_json = Set(snapshot.nodes_json.clone());
    active_model.edges_json = Set(snapshot.edges_json.clone());
    active_model.updated_by = Set(snapshot.created_by.clone());
    active_model.updated_at = Set(now.into());

    let txn = state.db.begin().await?;
    let updated = active_model.update(&txn).await?;
    create_automation_snapshot(&txn, &updated, Some(change_summary)).await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "恢复自动化版本成功",
        ApiAutomationFlowDetail::from(updated),
    )))
}

pub(crate) async fn list_automation_flow_runs(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAutomationRun>>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let runs = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .order_by_desc(automation_run_entity::Column::StartedAt)
        .all(&state.db)
        .await?;
    let run_ids = runs.iter().map(|item| item.id).collect::<Vec<_>>();
    let node_logs = if run_ids.is_empty() {
        Vec::new()
    } else {
        AutomationRunNodeEntity::find()
            .filter(automation_run_node_entity::Column::RunId.is_in(run_ids))
            .order_by_asc(automation_run_node_entity::Column::StartedAt)
            .all(&state.db)
            .await?
    };
    let mut node_map: HashMap<Uuid, Vec<ApiAutomationRunNode>> = HashMap::new();
    for node in node_logs {
        node_map
            .entry(node.run_id)
            .or_default()
            .push(ApiAutomationRunNode::from(node));
    }

    Ok(Json(success_response(
        "获取自动化运行日志成功",
        runs.into_iter()
            .map(|run| ApiAutomationRun {
                id: run.run_uuid.clone(),
                flow_version: run.flow_version,
                trigger_event: run.trigger_event.clone(),
                trigger_payload: run.trigger_payload.clone(),
                status: run.status.clone(),
                retry_source: run.retry_source.clone(),
                retry_run_uuid: run.retry_run_uuid.clone(),
                retry_node_key: run.retry_node_key.clone(),
                error_message: run.error_message.clone(),
                started_at: run.started_at.to_rfc3339(),
                finished_at: run.finished_at.map(|value| value.to_rfc3339()),
                duration_ms: calculate_duration_ms(run.started_at, run.finished_at),
                nodes: node_map.remove(&run.id).unwrap_or_default(),
            })
            .collect::<Vec<_>>(),
    )))
}

pub(crate) async fn retry_automation_flow_run(
    State(state): State<AppState>,
    Path((flow_uuid, run_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    retry_automation_run_internal(&state.db, &flow_uuid, &run_uuid, None).await?;
    Ok(Json(success_response(
        "自动化已重新触发",
        json!({ "retried": true }),
    )))
}

pub(crate) async fn retry_automation_flow_run_node(
    State(state): State<AppState>,
    Path((flow_uuid, run_uuid, node_key)): Path<(String, String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    retry_automation_run_internal(&state.db, &flow_uuid, &run_uuid, Some(node_key)).await?;
    Ok(Json(success_response(
        "错误节点已发起重试",
        json!({ "retried": true }),
    )))
}

pub(crate) async fn update_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
    Json(payload): Json<UpdateAutomationFlowRequest>,
) -> Result<Json<ApiResponse<ApiAutomationFlow>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let now = Utc::now();
    let app_id = flow.app_route_app_id.clone();
    let flow_id = flow.id;
    let next_version = flow.current_version + 1;
    let existing_nodes_json = flow.nodes_json.clone();
    let existing_edges_json = flow.edges_json.clone();
    let mut active_model: automation_flow_entity::ActiveModel = flow.into();
    let mut should_create_version = false;
    let mut next_nodes_json = existing_nodes_json.clone();
    let mut next_edges_json = existing_edges_json.clone();
    let mut nodes_updated = false;
    let mut edges_updated = false;

    if let Some(name) = payload.name {
        let next_name = name.trim();
        if !next_name.is_empty() {
            active_model.name = Set(next_name.to_string());
            should_create_version = true;
        }
    }

    if payload.description.is_some() {
        active_model.description = Set(normalize_optional_text(payload.description));
        should_create_version = true;
    }

    if let Some(status) = payload.status {
        active_model.status = Set(normalize_automation_status(&status)?);
        should_create_version = true;
    }

    if let Some(trigger_event) = payload.trigger_event {
        active_model.trigger_event = Set(normalize_automation_trigger_event(&trigger_event)?);
        should_create_version = true;
    }

    if payload.trigger_form_uuid.is_some() {
        let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
        if let Some(form_uuid) = trigger_form_uuid.as_deref() {
            ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
        }
        active_model.trigger_form_uuid = Set(trigger_form_uuid);
        should_create_version = true;
    }

    if let Some(trigger_config) = payload.trigger_config {
        active_model.trigger_config = Set(normalize_json_object(trigger_config));
        should_create_version = true;
    }

    if let Some(nodes) = payload.nodes {
        next_nodes_json = normalize_automation_nodes(nodes)?;
        should_create_version = true;
        nodes_updated = true;
    }

    if let Some(edges) = payload.edges {
        next_edges_json = normalize_automation_edges(edges)?;
        should_create_version = true;
        edges_updated = true;
    }

    validate_automation_graph(&next_nodes_json, &next_edges_json)?;
    ensure_automation_node_forms_belong_to_app(&state.db, &app_id, &next_nodes_json).await?;

    if nodes_updated {
        active_model.nodes_json = Set(next_nodes_json);
    }

    if edges_updated {
        active_model.edges_json = Set(next_edges_json);
    }

    if let Some(operator) = normalize_optional_text(payload.operator) {
        active_model.updated_by = Set(operator);
    }

    active_model.updated_at = Set(now.into());
    if should_create_version {
        active_model.current_version = Set(next_version);
    }
    let txn = state.db.begin().await?;
    let updated = active_model.update(&txn).await?;
    if should_create_version {
        create_automation_snapshot(&txn, &updated, payload.change_summary).await?;
    } else {
        sync_automation_graph_tables(
            &txn,
            flow_id,
            updated.current_version,
            &updated.nodes_json,
            &updated.edges_json,
        )
        .await?;
    }
    txn.commit().await?;

    Ok(Json(success_response(
        "更新集成自动化成功",
        ApiAutomationFlow::from(updated),
    )))
}

pub(crate) async fn delete_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let txn = state.db.begin().await?;
    AutomationFlowVersionEntity::delete_many()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationNodeEntity::delete_many()
        .filter(automation_node_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationEdgeEntity::delete_many()
        .filter(automation_edge_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationFlowEntity::delete_many()
        .filter(automation_flow_entity::Column::Id.eq(flow.id))
        .exec(&txn)
        .await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "删除集成自动化成功",
        json!({ "deleted": true, "id": flow_uuid }),
    )))
}

pub(crate) async fn execute_automation_flows_for_event(
    db: &DatabaseConnection,
    definition: &form_definition_entity::Model,
    event: &str,
    trigger_payload: &Value,
    operator: &str,
    changed_fields: Option<&HashSet<String>>,
) -> Result<(), AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(
            automation_flow_entity::Column::AppRouteAppId.eq(definition.app_route_app_id.clone()),
        )
        .filter(
            automation_flow_entity::Column::TriggerFormUuid.eq(Some(definition.form_uuid.clone())),
        )
        .filter(automation_flow_entity::Column::TriggerEvent.eq(event))
        .filter(automation_flow_entity::Column::Status.eq("enabled"))
        .all(db)
        .await?;

    for flow in flows {
        if !flow_matches_changed_fields(&flow.trigger_config, changed_fields) {
            continue;
        }
        if let Err(err) =
            execute_automation_flow(db, &flow, trigger_payload, operator, None, None, None).await
        {
            error!(
                "execute automation flow failed, flow={}: {err:?}",
                flow.flow_uuid
            );
        }
    }

    Ok(())
}

async fn execute_add_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("add-data target form is required".to_string()))?;
    let target_definition = forms::find_form_definition(db, &target_form_uuid).await?;
    let rows = json_array_items(&config.get("rows").cloned().unwrap_or_else(|| json!([])));
    let now = Utc::now();

    if config
        .get("recordMode")
        .and_then(Value::as_str)
        .unwrap_or("single")
        == "multiple"
    {
        let source_node_id =
            read_json_string(config.get("multipleSourceNodeId")).unwrap_or_default();
        let source_items = context
            .outputs
            .get(&source_node_id)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut inserted = Vec::new();
        for source_item in source_items {
            let mut scoped_outputs = context.outputs.clone();
            scoped_outputs.insert(
                source_node_id.clone(),
                Value::Array(vec![source_item.clone()]),
            );
            let row_data = build_record_data_from_rows(&rows, &scoped_outputs);
            let record = RecordRepository::new(db)
                .insert(&target_definition, row_data, &context.operator, now)
                .await?;
            inserted.push(record.record_data);
        }
        return Ok(Value::Array(inserted));
    }

    let row_data = build_record_data_from_rows(&rows, &context.outputs);
    let record = RecordRepository::new(db)
        .insert(&target_definition, row_data, &context.operator, now)
        .await?;
    info!(
        "automation add-data executed: flow={}, form={}, record={}",
        flow.flow_uuid, target_form_uuid, record.record_uuid
    );
    Ok(record.record_data)
}

async fn execute_get_one_node(
    db: &DatabaseConnection,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let source_mode = config
        .get("sourceMode")
        .and_then(Value::as_str)
        .unwrap_or("form");
    if source_mode == "data-node" {
        let source_node_id = read_json_string(config.get("dataNodeId")).unwrap_or_default();
        if let Some(value) = context.outputs.get(&source_node_id) {
            return Ok(match value {
                Value::Array(items) => items.first().cloned().unwrap_or(Value::Null),
                _ => value.clone(),
            });
        }
        return Ok(Value::Null);
    }

    let form_uuid = read_json_string(config.get("formUuid")).unwrap_or_default();
    if form_uuid.is_empty() {
        return Ok(Value::Null);
    }

    let records = RecordRepository::new(db).list(&form_uuid).await?;
    let matched = filter_records_by_expression(records, config.get("filterExpression"), context);
    Ok(matched
        .into_iter()
        .next()
        .map(|item| item.record_data)
        .unwrap_or(Value::Null))
}

async fn execute_get_many_node(
    db: &DatabaseConnection,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let source_mode = config
        .get("sourceMode")
        .and_then(Value::as_str)
        .unwrap_or("form");
    if source_mode == "data-node" {
        let source_node_id = read_json_string(config.get("dataNodeId")).unwrap_or_default();
        if let Some(value) = context.outputs.get(&source_node_id) {
            return Ok(match value {
                Value::Array(_) => value.clone(),
                Value::Null => Value::Array(vec![]),
                _ => Value::Array(vec![value.clone()]),
            });
        }
        return Ok(Value::Array(vec![]));
    }

    let form_uuid = read_json_string(config.get("formUuid")).unwrap_or_default();
    if form_uuid.is_empty() {
        return Ok(Value::Array(vec![]));
    }

    let records = RecordRepository::new(db).list(&form_uuid).await?;
    let matched = filter_records_by_expression(records, config.get("filterExpression"), context);
    Ok(Value::Array(
        matched.into_iter().map(|item| item.record_data).collect(),
    ))
}

async fn execute_update_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("update-data target form is required".to_string()))?;
    let rows = json_array_items(&config.get("rows").cloned().unwrap_or_else(|| json!([])));
    let repository = RecordRepository::new(db);
    let records = repository.list(&target_form_uuid).await?;
    let matched = filter_records_by_expression(records, config.get("matchRule"), context);
    let patch = build_record_data_from_rows(&rows, &context.outputs);
    let now = Utc::now();
    let mut updated_items = Vec::new();

    for record in matched {
        let merged = merge_record_payload(record.record_data.clone(), &patch);
        let updated = repository
            .update(&record, merged, &context.operator, now)
            .await?;
        updated_items.push(updated.record_data);
    }

    info!(
        "automation update-data executed: flow={}, form={}, count={}",
        flow.flow_uuid,
        target_form_uuid,
        updated_items.len()
    );
    Ok(Value::Array(updated_items))
}

async fn execute_delete_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("delete-data target form is required".to_string()))?;
    let definition = forms::find_form_definition(db, &target_form_uuid).await?;
    let repository = RecordRepository::new(db);
    let records = repository.list(&target_form_uuid).await?;
    let matched = filter_records_by_expression(records, config.get("matchRule"), context);
    let deleted_count = matched.len() as i64;
    let deleted_payloads = matched
        .iter()
        .map(|item| item.record_data.clone())
        .collect::<Vec<_>>();

    repository.delete_many(&matched).await?;

    if deleted_count > 0 {
        repository
            .decrement_app_records_count(&definition.app_route_app_id, deleted_count, Utc::now())
            .await?;
    }

    info!(
        "automation delete-data executed: flow={}, form={}, count={}",
        flow.flow_uuid, target_form_uuid, deleted_count
    );
    Ok(Value::Array(deleted_payloads))
}

async fn execute_http_request_node(
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let method = read_json_string(config.get("method"))
        .unwrap_or_else(|| "POST".to_string())
        .to_uppercase();
    let url = render_text_template(
        &read_json_string(config.get("url")).unwrap_or_default(),
        &context.outputs,
    );
    if url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "http-request url is required".to_string(),
        ));
    }

    let client = reqwest::Client::new();
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| AppError::BadRequest("invalid http-request method".to_string()))?;
    let mut request = client.request(method, &url);

    let headers_text = render_text_template(
        &read_json_string(config.get("headersText")).unwrap_or_default(),
        &context.outputs,
    );
    if !headers_text.trim().is_empty() {
        let headers_value: Value = serde_json::from_str(&headers_text).map_err(|_| {
            AppError::BadRequest("http-request headers must be valid json".to_string())
        })?;
        if let Some(headers) = headers_value.as_object() {
            for (key, value) in headers {
                request = request.header(key, normalize_scalar(value));
            }
        }
    }

    let body_text = render_text_template(
        &read_json_string(config.get("bodyTemplate")).unwrap_or_default(),
        &context.outputs,
    );
    if !body_text.trim().is_empty() {
        request = request.body(body_text.clone());
    }

    let response = request
        .send()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request failed: {err}")))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request read failed: {err}")))?;

    let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
    Ok(json!({
        "status": status,
        "body": payload,
    }))
}

async fn create_automation_snapshot<C>(
    db: &C,
    flow: &automation_flow_entity::Model,
    change_summary: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let snapshot = automation_flow_version_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_id: Set(flow.id),
        version: Set(flow.current_version),
        name: Set(flow.name.clone()),
        description: Set(flow.description.clone()),
        status: Set(flow.status.clone()),
        trigger_form_uuid: Set(flow.trigger_form_uuid.clone()),
        trigger_event: Set(flow.trigger_event.clone()),
        trigger_config: Set(flow.trigger_config.clone()),
        nodes_json: Set(flow.nodes_json.clone()),
        edges_json: Set(flow.edges_json.clone()),
        change_summary: Set(normalize_optional_text(change_summary)),
        created_by: Set(flow.updated_by.clone()),
        created_at: Set(flow.updated_at),
    };
    snapshot.insert(db).await?;
    sync_automation_graph_tables(
        db,
        flow.id,
        flow.current_version,
        &flow.nodes_json,
        &flow.edges_json,
    )
    .await
}

async fn sync_automation_graph_tables<C>(
    db: &C,
    flow_id: Uuid,
    version: i32,
    nodes_json: &Value,
    edges_json: &Value,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    AutomationNodeEntity::delete_many()
        .filter(automation_node_entity::Column::FlowId.eq(flow_id))
        .filter(automation_node_entity::Column::Version.eq(version))
        .exec(db)
        .await?;
    AutomationEdgeEntity::delete_many()
        .filter(automation_edge_entity::Column::FlowId.eq(flow_id))
        .filter(automation_edge_entity::Column::Version.eq(version))
        .exec(db)
        .await?;

    let now = Utc::now();
    for item in json_array_items(nodes_json) {
        let raw = item.clone();
        let data = raw
            .get("data")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let position = raw
            .get("position")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let config_json = data.get("config").cloned().unwrap_or_else(|| json!({}));
        let node = automation_node_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            flow_id: Set(flow_id),
            version: Set(version),
            node_key: Set(read_json_string(raw.get("id"))
                .unwrap_or_else(|| format!("node-{}", Uuid::new_v4()))),
            node_kind: Set(
                read_json_string(data.get("kind")).unwrap_or_else(|| "unknown".to_string())
            ),
            label: Set(
                read_json_string(data.get("label")).unwrap_or_else(|| "未命名节点".to_string())
            ),
            description: Set(read_json_string(data.get("description"))),
            position_x: Set(read_json_number(position.get("x")).unwrap_or(0.0)),
            position_y: Set(read_json_number(position.get("y")).unwrap_or(0.0)),
            config_json: Set(normalize_json_object(config_json)),
            raw_json: Set(raw),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        };
        node.insert(db).await?;
    }

    for item in json_array_items(edges_json) {
        let raw = item.clone();
        let edge = automation_edge_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            flow_id: Set(flow_id),
            version: Set(version),
            edge_key: Set(read_json_string(raw.get("id"))
                .unwrap_or_else(|| format!("edge-{}", Uuid::new_v4()))),
            source_node_key: Set(read_json_string(raw.get("source")).unwrap_or_default()),
            target_node_key: Set(read_json_string(raw.get("target")).unwrap_or_default()),
            source_handle: Set(read_json_string(raw.get("sourceHandle"))),
            target_handle: Set(read_json_string(raw.get("targetHandle"))),
            raw_json: Set(raw),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        };
        edge.insert(db).await?;
    }

    Ok(())
}

async fn ensure_automation_node_forms_belong_to_app(
    db: &DatabaseConnection,
    app_id: &str,
    nodes_json: &Value,
) -> Result<(), AppError> {
    let mut form_ids = HashSet::new();

    for item in json_array_items(nodes_json) {
        let data = item.get("data").and_then(Value::as_object);
        let kind = data
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let config = data
            .and_then(|value| value.get("config"))
            .and_then(Value::as_object);

        match kind {
            "get-one" | "get-many" => {
                if let Some(form_uuid) = config
                    .and_then(|value| value.get("formUuid"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    form_ids.insert(form_uuid.to_string());
                }
            }
            "add-data" | "update-data" | "delete-data" => {
                if let Some(form_uuid) = config
                    .and_then(|value| value.get("targetFormUuid"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    form_ids.insert(form_uuid.to_string());
                }
            }
            _ => {}
        }
    }

    for form_uuid in form_ids {
        ensure_form_belongs_to_app(db, app_id, &form_uuid).await?;
    }

    Ok(())
}

fn normalize_automation_node_kind(kind: &str) -> Result<String, AppError> {
    let normalized = kind.trim();
    if matches!(
        normalized,
        "trigger"
            | "condition"
            | "add-data"
            | "update-data"
            | "get-one"
            | "get-many"
            | "delete-data"
            | "http-request"
    ) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation node kind".to_string(),
        ))
    }
}

fn normalize_automation_node_config(kind: &str, config: Value) -> Result<Value, AppError> {
    let config = normalize_json_object(config);
    let object = config.as_object().cloned().unwrap_or_default();

    let normalized = match kind {
        "trigger" => json!({
            "changedFieldsText": read_json_string(object.get("changedFieldsText")),
        }),
        "condition" => {
            if object
                .get("branches")
                .and_then(Value::as_array)
                .map(|branches| !branches.is_empty())
                .unwrap_or(false)
            {
                json!({
                    "branches": normalize_condition_branches(
                        object.get("branches").cloned().unwrap_or_else(|| json!([])),
                    )?,
                })
            } else {
                json!({
                    "mode": normalize_condition_mode(object.get("mode").and_then(Value::as_str)),
                    "priority": normalize_condition_priority(object.get("priority").and_then(Value::as_i64)),
                    "rules": normalize_branch_rules(object.get("rules").cloned().unwrap_or_else(|| json!([])))?,
                    "expression": read_json_string(object.get("expression")),
                    "hitLabel": read_json_string(object.get("hitLabel")),
                })
            }
        }
        "get-one" | "get-many" => json!({
            "sourceMode": normalize_data_source_mode(object.get("sourceMode").and_then(Value::as_str)),
            "formUuid": read_json_string(object.get("formUuid")),
            "dataNodeId": read_json_string(object.get("dataNodeId")),
            "relatedFormPlaceholder": read_json_string(object.get("relatedFormPlaceholder")),
            "filterExpression": read_json_string(object.get("filterExpression")),
            "fieldSelection": read_json_string(object.get("fieldSelection")),
        }),
        "add-data" => json!({
            "targetMode": normalize_add_target_mode(object.get("targetMode").and_then(Value::as_str)),
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "recordMode": normalize_add_record_mode(object.get("recordMode").and_then(Value::as_str)),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "multipleSourceMode": normalize_multiple_source_mode(object.get("multipleSourceMode").and_then(Value::as_str)),
            "multipleSourceNodeId": read_json_string(object.get("multipleSourceNodeId")),
            "multipleFormula": read_json_string(object.get("multipleFormula")),
        }),
        "update-data" | "delete-data" | "http-request" => json!({
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "matchRule": read_json_string(object.get("matchRule")),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "bodyTemplate": read_json_string(object.get("bodyTemplate")),
            "method": read_json_string(object.get("method")),
            "url": read_json_string(object.get("url")),
            "headersText": read_json_string(object.get("headersText")),
        }),
        _ => json!({}),
    };

    Ok(normalized)
}

fn normalize_branch_rules(data: Value) -> Result<Value, AppError> {
    let items = normalize_json_array(data);
    let mut seen_ids = HashSet::new();
    let mut rules = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("branch rule must be object".to_string()))?;
        let rule_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("branch rule id is required".to_string()))?;

        if !seen_ids.insert(rule_id.clone()) {
            return Err(AppError::BadRequest(
                "branch rule id must be unique".to_string(),
            ));
        }

        let operator = normalize_branch_rule_operator(raw.get("operator").and_then(Value::as_str));
        rules.push(json!({
            "id": rule_id,
            "parentId": read_json_string(raw.get("parentId")),
            "fieldKey": read_json_string(raw.get("fieldKey")),
            "operator": operator,
            "valueType": if raw.get("valueType").and_then(Value::as_str) == Some("field") { "field" } else { "value" },
            "rawValue": if matches!(operator, "hasValue" | "noValue") {
                None::<String>
            } else {
                read_json_string(raw.get("rawValue"))
            },
            "sourceFieldKey": read_json_string(raw.get("sourceFieldKey")),
        }));
    }

    Ok(Value::Array(rules))
}

fn normalize_condition_branches(data: Value) -> Result<Value, AppError> {
    let items = normalize_json_array(data);
    let mut seen_ids = HashSet::new();
    let mut branches = Vec::new();

    for (index, item) in json_array_items(&items).into_iter().enumerate() {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("condition branch must be object".to_string()))?;
        let branch_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("condition branch id is required".to_string()))?;
        if !seen_ids.insert(branch_id.clone()) {
            return Err(AppError::BadRequest(
                "condition branch id must be unique".to_string(),
            ));
        }

        branches.push(json!({
            "id": branch_id,
            "name": read_json_string(raw.get("name")).unwrap_or_else(|| format!("条件分支 {}", index + 1)),
            "mode": normalize_condition_mode(raw.get("mode").and_then(Value::as_str)),
            "priority": normalize_condition_priority(
                raw.get("priority").and_then(Value::as_i64).or(Some((index + 1) as i64)),
            ),
            "rules": normalize_branch_rules(raw.get("rules").cloned().unwrap_or_else(|| json!([])))?,
            "expression": read_json_string(raw.get("expression")),
            "hitLabel": read_json_string(raw.get("hitLabel")),
        }));
    }

    Ok(Value::Array(branches))
}

fn normalize_field_mapping_rows(data: Value) -> Value {
    let items = normalize_json_array(data);
    let mut rows = Vec::new();

    for item in json_array_items(&items) {
        let Some(raw) = item.as_object() else {
            continue;
        };
        let Some(field_id) =
            read_json_string(raw.get("fieldId")).filter(|value| !value.trim().is_empty())
        else {
            continue;
        };

        let value_type = normalize_mapping_value_type(raw.get("valueType").and_then(Value::as_str));
        rows.push(json!({
            "id": read_json_string(raw.get("id")).unwrap_or_else(|| format!("row-{}-{}", field_id, Uuid::new_v4().simple())),
            "fieldId": field_id,
            "valueType": value_type,
            "rawValue": if value_type == "value" { read_json_string(raw.get("rawValue")) } else { None::<String> },
            "sourceFieldKey": if value_type == "field" { read_json_string(raw.get("sourceFieldKey")) } else { None::<String> },
            "formula": if value_type == "formula" { read_json_string(raw.get("formula")) } else { None::<String> },
        }));
    }

    Value::Array(rows)
}

fn normalize_condition_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("all").trim() {
        "rules" => "rules",
        "expression" => "expression",
        _ => "all",
    }
}

fn normalize_condition_priority(value: Option<i64>) -> i64 {
    value.unwrap_or(1).max(1)
}

fn normalize_branch_rule_operator(value: Option<&str>) -> &'static str {
    match value.unwrap_or("eq").trim() {
        "neq" => "neq",
        "inAny" => "inAny",
        "notInAny" => "notInAny",
        "hasValue" => "hasValue",
        "noValue" => "noValue",
        _ => "eq",
    }
}

fn normalize_data_source_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("form").trim() {
        "data-node" => "data-node",
        "related-form" => "related-form",
        _ => "form",
    }
}

fn normalize_add_target_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("form").trim() {
        "subtable" => "subtable",
        _ => "form",
    }
}

fn normalize_add_record_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("single").trim() {
        "multiple" => "multiple",
        _ => "single",
    }
}

fn normalize_multiple_source_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("data-node").trim() {
        "form" => "form",
        _ => "data-node",
    }
}

fn normalize_mapping_value_type(value: Option<&str>) -> &'static str {
    match value.unwrap_or("value").trim() {
        "field" => "field",
        "formula" => "formula",
        _ => "value",
    }
}

fn default_node_label(kind: &str) -> &'static str {
    match kind {
        "trigger" => "表单事件触发",
        "condition" => "条件分支",
        "add-data" => "新增数据",
        "update-data" => "更新数据",
        "get-one" => "获取单条数据",
        "get-many" => "获取多条数据",
        "delete-data" => "删除数据",
        "http-request" => "连接器",
        _ => "未命名节点",
    }
}

fn default_node_description(kind: &str) -> &'static str {
    match kind {
        "trigger" => "根据表单记录事件开始执行工作流",
        "condition" => "按优先级和条件规则控制后续走向",
        "add-data" => "向目标表单新增单条或多条数据",
        "update-data" => "根据匹配条件更新目标表单记录",
        "get-one" => "从表单、数据节点或关联表单中获取一条数据",
        "get-many" => "从表单、数据节点或关联表单中获取多条数据",
        "delete-data" => "根据匹配条件删除目标表单记录",
        "http-request" => "调用外部接口或 Webhook",
        _ => "",
    }
}

async fn execute_automation_flow(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    operator: &str,
    retry_source: Option<RetrySource>,
    retry_run_uuid: Option<&str>,
    retry_node_key: Option<&str>,
) -> Result<(), AppError> {
    let run = create_automation_run(
        db,
        flow,
        trigger_data,
        retry_source,
        retry_run_uuid,
        retry_node_key,
    )
    .await?;
    let nodes = json_array_items(&flow.nodes_json);
    let edges = json_array_items(&flow.edges_json);
    if nodes.is_empty() {
        finalize_automation_run(db, run.id, "success", None).await?;
        return Ok(());
    }

    let (node_map, outgoing_map) = build_automation_graph(nodes, edges);

    let mut context = AutomationExecutionContext {
        outputs: HashMap::from([("trigger-1".to_string(), trigger_data.clone())]),
        operator: operator.to_string(),
        run_id: Some(run.id),
    };
    let mut path = HashSet::new();
    let result = if let Some(node_key) = retry_node_key {
        execute_automation_from_node(
            db,
            flow,
            node_key,
            &node_map,
            &outgoing_map,
            &mut context,
            &mut path,
        )
        .await
    } else {
        execute_automation_children(
            db,
            flow,
            "trigger-1",
            &node_map,
            &outgoing_map,
            &mut context,
            &mut path,
        )
        .await
    };

    match &result {
        Ok(_) => finalize_automation_run(db, run.id, "success", None).await?,
        Err(err) => finalize_automation_run(db, run.id, "failed", Some(format!("{err:?}"))).await?,
    }

    result
}

async fn execute_automation_flow_from_snapshot(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    operator: &str,
    start_node_key: &str,
    outputs_snapshot: HashMap<String, Value>,
    retry_run_uuid: &str,
) -> Result<(), AppError> {
    let run = create_automation_run(
        db,
        flow,
        trigger_data,
        Some(RetrySource::Node),
        Some(retry_run_uuid),
        Some(start_node_key),
    )
    .await?;
    let nodes = json_array_items(&flow.nodes_json);
    let edges = json_array_items(&flow.edges_json);
    let (node_map, outgoing_map) = build_automation_graph(nodes, edges);

    let mut context = AutomationExecutionContext {
        outputs: outputs_snapshot,
        operator: operator.to_string(),
        run_id: Some(run.id),
    };
    let mut path = HashSet::new();
    let result = execute_automation_from_node(
        db,
        flow,
        start_node_key,
        &node_map,
        &outgoing_map,
        &mut context,
        &mut path,
    )
    .await;

    match &result {
        Ok(_) => finalize_automation_run(db, run.id, "success", None).await?,
        Err(err) => finalize_automation_run(db, run.id, "failed", Some(format!("{err:?}"))).await?,
    }

    result
}

#[derive(Clone)]
struct AutomationGraphEdge {
    target: String,
    source_handle: Option<String>,
}

fn build_automation_graph(
    nodes: Vec<Value>,
    edges: Vec<Value>,
) -> (
    HashMap<String, Value>,
    HashMap<String, Vec<AutomationGraphEdge>>,
) {
    let node_map = nodes
        .iter()
        .filter_map(|item| read_json_string(item.get("id")).map(|id| (id, item.clone())))
        .collect::<HashMap<_, _>>();
    let mut outgoing_map: HashMap<String, Vec<AutomationGraphEdge>> = HashMap::new();
    for edge in edges {
        let Some(source) = read_json_string(edge.get("source")) else {
            continue;
        };
        let Some(target) = read_json_string(edge.get("target")) else {
            continue;
        };
        outgoing_map
            .entry(source)
            .or_default()
            .push(AutomationGraphEdge {
                target,
                source_handle: read_json_string(edge.get("sourceHandle")),
            });
    }
    (node_map, outgoing_map)
}

fn execute_automation_children<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node_id: &'a str,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<AutomationGraphEdge>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let Some(outgoing_edges) = outgoing_map.get(node_id) else {
            return Ok(());
        };
        let branch_filter = node_map
            .get(node_id)
            .and_then(|node| select_condition_branch_handle(node, context));
        let mut normal_nodes = Vec::new();
        let mut condition_nodes = Vec::new();

        for edge in outgoing_edges {
            if let Some(selected_handle) = &branch_filter {
                match selected_handle {
                    Some(handle) if edge.source_handle.as_ref() == Some(handle) => {}
                    _ => continue,
                }
            }
            let Some(target_node) = node_map.get(&edge.target) else {
                continue;
            };
            let kind = target_node
                .get("data")
                .and_then(|value| value.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if kind == "condition" {
                condition_nodes.push(target_node.clone());
            } else {
                normal_nodes.push(target_node.clone());
            }
        }

        for target_node in normal_nodes {
            execute_automation_node(
                db,
                flow,
                &target_node,
                node_map,
                outgoing_map,
                context,
                path,
            )
            .await?;
        }

        if !condition_nodes.is_empty() {
            condition_nodes.sort_by_key(|node| condition_node_priority(node));

            for target_node in condition_nodes {
                if evaluate_condition_node(&target_node, context) {
                    execute_automation_node(
                        db,
                        flow,
                        &target_node,
                        node_map,
                        outgoing_map,
                        context,
                        path,
                    )
                    .await?;
                    break;
                }
            }
        }

        Ok(())
    })
}

fn execute_automation_from_node<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node_key: &'a str,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<AutomationGraphEdge>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let node = node_map
            .get(node_key)
            .ok_or_else(|| AppError::NotFound("automation retry node not found".to_string()))?
            .clone();
        execute_automation_node(db, flow, &node, node_map, outgoing_map, context, path).await
    })
}

fn execute_automation_node<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node: &'a Value,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<AutomationGraphEdge>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let node_id = read_json_string(node.get("id"))
            .ok_or_else(|| AppError::BadRequest("automation node id missing".to_string()))?;
        if !path.insert(node_id.clone()) {
            return Ok(());
        }

        let data = node
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::BadRequest("automation node data missing".to_string()))?;
        let kind = data.get("kind").and_then(Value::as_str).unwrap_or_default();
        let label = data
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("未命名节点");
        let config = data.get("config").cloned().unwrap_or_else(|| json!({}));
        let node_log_id = if let Some(run_id) = context.run_id {
            Some(
                create_automation_run_node_log(
                    db,
                    run_id,
                    &node_id,
                    kind,
                    label,
                    json!(context.outputs),
                )
                .await?,
            )
        } else {
            None
        };

        let execution_result: Result<(), AppError> = match kind {
            "condition" => Ok(()),
            "add-data" => {
                let output = execute_add_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "get-one" => {
                let output = execute_get_one_node(db, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "get-many" => {
                let output = execute_get_many_node(db, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "update-data" => {
                let output = execute_update_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "delete-data" => {
                let output = execute_delete_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "http-request" => {
                let output = execute_http_request_node(&config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            _ => Ok(()),
        };

        if let Some(log_id) = node_log_id {
            match &execution_result {
                Ok(_) => {
                    finalize_automation_run_node_log(
                        db,
                        log_id,
                        "success",
                        context.outputs.get(&node_id).cloned(),
                        None,
                    )
                    .await?;
                }
                Err(err) => {
                    finalize_automation_run_node_log(
                        db,
                        log_id,
                        "failed",
                        None,
                        Some(format!("{err:?}")),
                    )
                    .await?;
                }
            }
        }
        execution_result?;

        let result =
            execute_automation_children(db, flow, &node_id, node_map, outgoing_map, context, path)
                .await;
        path.remove(&node_id);
        result
    })
}

fn evaluate_condition_node(node: &Value, context: &AutomationExecutionContext) -> bool {
    let config = node
        .get("data")
        .and_then(|value| value.get("config"))
        .and_then(Value::as_object);
    if let Some(branches) = config
        .and_then(|value| value.get("branches"))
        .and_then(Value::as_array)
    {
        return branches
            .iter()
            .any(|branch| evaluate_condition_branch(branch, context));
    }
    let mode = config
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str)
        .unwrap_or("all");

    match mode {
        "rules" => evaluate_branch_rules(
            config
                .and_then(|value| value.get("rules"))
                .cloned()
                .unwrap_or_else(|| json!([])),
            context,
        ),
        "expression" => config
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str)
            .map(|value| evaluate_context_expression(value, context))
            .unwrap_or(false),
        _ => true,
    }
}

fn condition_node_priority(node: &Value) -> i64 {
    let config = node.get("data").and_then(|value| value.get("config"));
    if let Some(branches) = config
        .and_then(|value| value.get("branches"))
        .and_then(Value::as_array)
    {
        return branches
            .iter()
            .filter_map(|branch| branch.get("priority").and_then(Value::as_i64))
            .min()
            .unwrap_or(1);
    }
    config
        .and_then(|value| value.get("priority"))
        .and_then(Value::as_i64)
        .unwrap_or(1)
}

fn select_condition_branch_handle(
    node: &Value,
    context: &AutomationExecutionContext,
) -> Option<Option<String>> {
    let data = node.get("data")?;
    if data.get("kind").and_then(Value::as_str) != Some("condition") {
        return None;
    }
    let branches = data
        .get("config")
        .and_then(|value| value.get("branches"))
        .and_then(Value::as_array)?;
    let mut ordered = branches.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|branch| branch.get("priority").and_then(Value::as_i64).unwrap_or(1));

    let selected = ordered
        .into_iter()
        .find(|branch| evaluate_condition_branch(branch, context))
        .and_then(|branch| read_json_string(branch.get("id")))
        .map(|branch_id| format!("condition-branch:{branch_id}"));
    Some(selected)
}

fn evaluate_condition_branch(branch: &Value, context: &AutomationExecutionContext) -> bool {
    let mode = branch.get("mode").and_then(Value::as_str).unwrap_or("all");
    match mode {
        "rules" => evaluate_branch_rules(
            branch.get("rules").cloned().unwrap_or_else(|| json!([])),
            context,
        ),
        "expression" => branch
            .get("expression")
            .and_then(Value::as_str)
            .map(|value| evaluate_context_expression(value, context))
            .unwrap_or(false),
        _ => true,
    }
}

fn evaluate_branch_rules(rules: Value, context: &AutomationExecutionContext) -> bool {
    for item in json_array_items(&rules) {
        if !evaluate_branch_rule(&item, context) {
            return false;
        }
    }
    true
}

fn evaluate_branch_rule(rule: &Value, context: &AutomationExecutionContext) -> bool {
    let field_key = read_json_string(rule.get("fieldKey")).unwrap_or_default();
    let operator = read_json_string(rule.get("operator")).unwrap_or_else(|| "eq".to_string());
    let expected = if rule.get("valueType").and_then(Value::as_str) == Some("field") {
        read_json_string(rule.get("sourceFieldKey"))
            .and_then(|field_key| {
                resolve_source_field_values(&context.outputs, &field_key)
                    .into_iter()
                    .next()
            })
            .map(|value| normalize_scalar(&value))
            .unwrap_or_default()
    } else {
        read_json_string(rule.get("rawValue")).unwrap_or_default()
    };
    let actual_values = resolve_source_field_values(&context.outputs, &field_key);

    match operator.as_str() {
        "hasValue" => actual_values.iter().any(value_has_content),
        "noValue" => {
            actual_values.is_empty() || actual_values.iter().all(|value| !value_has_content(value))
        }
        "neq" => {
            actual_values.is_empty()
                || actual_values
                    .iter()
                    .all(|value| normalize_scalar(value) != expected)
        }
        "inAny" => {
            let expected_items = parse_multi_values(&expected);
            actual_values
                .iter()
                .any(|value| expected_items.contains(&normalize_scalar(value)))
        }
        "notInAny" => {
            let expected_items = parse_multi_values(&expected);
            actual_values.is_empty()
                || actual_values
                    .iter()
                    .all(|value| !expected_items.contains(&normalize_scalar(value)))
        }
        _ => actual_values
            .iter()
            .any(|value| normalize_scalar(value) == expected),
    }
}

async fn retry_automation_run_internal(
    db: &DatabaseConnection,
    flow_uuid: &str,
    run_uuid: &str,
    node_key: Option<String>,
) -> Result<(), AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .filter(automation_run_entity::Column::RunUuid.eq(run_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run not found".to_string()))?;

    if let Some(node_key) = node_key {
        let node_log = AutomationRunNodeEntity::find()
            .filter(automation_run_node_entity::Column::RunId.eq(run.id))
            .filter(automation_run_node_entity::Column::NodeKey.eq(node_key.clone()))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("automation run node log not found".to_string()))?;
        let snapshot = node_log
            .input_json
            .as_object()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<HashMap<String, Value>>();

        execute_automation_flow_from_snapshot(
            db,
            &flow,
            &run.trigger_payload,
            "管理员",
            &node_key,
            snapshot,
            run_uuid,
        )
        .await
    } else {
        execute_automation_flow(
            db,
            &flow,
            &run.trigger_payload,
            "管理员",
            Some(RetrySource::Flow),
            Some(run_uuid),
            None,
        )
        .await
    }
}

async fn ensure_form_belongs_to_app(
    db: &DatabaseConnection,
    app_id: &str,
    form_uuid: &str,
) -> Result<(), AppError> {
    let exists = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .count(db)
        .await?
        > 0;

    if exists {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "trigger form does not belong to app".to_string(),
        ))
    }
}

fn flow_matches_changed_fields(
    trigger_config: &Value,
    changed_fields: Option<&HashSet<String>>,
) -> bool {
    let configured = trigger_config
        .get("changedFieldsText")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (configured, changed_fields) {
        (Some(field_id), Some(fields)) => fields.contains(field_id),
        (Some(_), None) => false,
        _ => true,
    }
}
mod dto;
mod expression;
mod graph;
mod runtime;

use dto::*;
use expression::*;
use graph::*;
use runtime::AutomationExecutionContext;
