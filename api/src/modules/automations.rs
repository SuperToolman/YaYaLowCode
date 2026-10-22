use crate::modules::forms;
use crate::modules::forms::dto::RestoreVersionRequest;
use crate::platform::automation_runs::{
    RetrySource, create_automation_run, finalize_automation_run, finalize_automation_run_node_log,
};
use crate::platform::prelude::*;
use crate::platform::records::{RecordRepository, StoredFormRecord};
use crate::shared::*;
use axum::http::StatusCode;
use sea_orm::{QuerySelect, TransactionSession, sea_query::LockType};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolveExecutionRequest {
    pub action: String,
    #[serde(default)]
    pub accept_duplicate_risk: bool,
}

pub(crate) async fn retry_automation_visit(
    State(state): State<AppState>,
    Path((flow_uuid, run_uuid, log_id)): Path<(String, String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    retry_visit(&state, &flow_uuid, &run_uuid, &log_id, false).await?;
    Ok(Json(success_response(
        "已重试该节点访问及其下游",
        json!({}),
    )))
}
async fn retry_visit(
    state: &AppState,
    flow_uuid: &str,
    run_uuid: &str,
    log_id: &str,
    allow_attention: bool,
) -> Result<(), AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("flow missing".into()))?;
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .filter(automation_run_entity::Column::RunUuid.eq(run_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("run missing".into()))?;
    if run.workflow_instance_id.is_some() {
        return Err(AppError::BadRequest("人工流程不能使用普通节点重试".into()));
    }
    if run.status == "needs_attention" && !allow_attention {
        return Err(AppError::BadRequest(
            "请通过管理员核实操作处理不确定结果".into(),
        ));
    }
    if !matches!(
        run.status.as_str(),
        "failed" | "success" | "needs_attention"
    ) {
        return Err(AppError::BadRequest("运行尚未结束".into()));
    }
    let id = Uuid::parse_str(log_id).map_err(|_| AppError::BadRequest("invalid log ID".into()))?;
    let log = AutomationRunNodeEntity::find_by_id(id)
        .filter(automation_run_node_entity::Column::RunId.eq(run.id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("visit missing".into()))?;
    let flow = execution::load_version(&state.db, &flow, run.flow_version).await?;
    let outputs = serde_json::from_value(log.input_json)
        .map_err(|_| AppError::BadRequest("invalid visit input".into()))?;
    execute_automation_flow_from_snapshot(
        &state.db,
        &flow,
        &run.trigger_event,
        &run.trigger_payload,
        "管理员",
        &log.node_key,
        outputs,
        &run.run_uuid,
    )
    .await
}
pub(crate) async fn resolve_automation_execution(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((flow_uuid, run_uuid)): Path<(String, String)>,
    Json(payload): Json<ResolveExecutionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    use crate::platform::authorization;
    let user = authorization::current_user(&headers, &state).await?;
    if !user.is_admin && !user.is_boss {
        return Err(AppError::Forbidden("仅管理员可核实外部调用结果".into()));
    }
    if !matches!(payload.action.as_str(), "cancel" | "retry")
        || payload.action == "retry" && !payload.accept_duplicate_risk
    {
        return Err(AppError::BadRequest(
            "重试必须明确接受重复副作用风险".into(),
        ));
    }
    let txn = state.db.begin().await?;
    let lookup = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::RunUuid.eq(&run_uuid))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("run missing".into()))?;
    if let Some(id) = lookup.workflow_instance_id {
        crate::infrastructure::entities::workflow_instance_entity::Entity::find_by_id(id)
            .lock_exclusive()
            .one(&txn)
            .await?;
    }
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::RunUuid.eq(&run_uuid))
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("run missing".into()))?;
    let flow = AutomationFlowEntity::find_by_id(run.flow_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("flow missing".into()))?;
    if flow.flow_uuid != flow_uuid || run.status != "needs_attention" {
        return Err(AppError::BadRequest("运行不是待核实状态".into()));
    }
    execution::sql(&txn,"INSERT INTO automation_execution_audits(id,run_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",vec![Uuid::new_v4().into(),run.id.into(),user.id.into(),payload.action.clone().into(),json!({"acceptDuplicateRisk":payload.accept_duplicate_risk}).into()]).await?;
    if payload.action == "cancel" {
        execution::sql(&txn,"UPDATE automation_execution_tokens SET status='cancelled' WHERE run_id=$1 AND status<>'completed'",vec![run.id.into()]).await?;
        if let Some(instance_id) = run.workflow_instance_id {
            let instance =
                crate::infrastructure::entities::workflow_instance_entity::Entity::find_by_id(
                    instance_id,
                )
                .one(&txn)
                .await?
                .ok_or_else(|| AppError::NotFound("instance missing".into()))?;
            crate::modules::workflows::skip_pending_tasks(
                &txn,
                &instance,
                None,
                "管理员取消执行",
                Utc::now(),
                None,
            )
            .await?;
            crate::modules::workflows::complete_instance(
                &txn,
                &instance,
                "cancelled",
                "reviewing",
                "cancelled",
                "已取消",
                "管理员",
            )
            .await?;
        }
        finalize_automation_run(&txn, run.id, "cancelled", Some("管理员核实后取消".into())).await?;
    } else {
        // Continue this exact token; completed siblings and artificial waits are untouched.
        execution::sql(&txn,"UPDATE automation_execution_tokens SET status='queued',attempt=attempt+1,error_message=NULL WHERE run_id=$1 AND status='needs_attention'",vec![run.id.into()]).await?;
        execution::sql(
            &txn,
            "UPDATE automation_flow_runs SET status='queued',error_message=NULL WHERE id=$1",
            vec![run.id.into()],
        )
        .await?;
    }
    txn.commit().await?;
    Ok(Json(success_response(
        "已记录核实处理",
        json!({"runId":run_uuid}),
    )))
}

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

    Ok(Json(success_response(
        "获取集成自动化列表成功",
        ApiAutomationFlowList {
            items: flows.into_iter().map(ApiAutomationFlow::from).collect(),
            total,
            enabled,
            paused,
        },
    )))
}

pub(crate) async fn create_automation_flow(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Result<
        Option<Json<CreateAutomationFlowRequest>>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<(StatusCode, Json<ApiResponse<ApiAutomationFlow>>), AppError> {
    let payload = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let flow =
        create_automation_definition(&state, &app_id, payload.map(|Json(value)| value)).await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建集成自动化成功",
            ApiAutomationFlow::from(flow),
        )),
    ))
}

pub(crate) async fn create_button_automation_for_form(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(form_uuid): Path<String>,
    Json(payload): Json<CreateButtonAutomationRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAutomationFlow>>), AppError> {
    let form = forms::find_form_definition(&state.db, &form_uuid).await?;
    if !["normal", "workflow"].contains(&form.form_type.as_str()) {
        return Err(AppError::BadRequest(
            "按钮触发来源必须为普通或流程表单".into(),
        ));
    }
    let grants = crate::platform::authorization::grants(&headers, &state).await?;
    if !grants.contains("*")
        && (!grants.contains(&format!("app:{}:automation", form.app_route_app_id))
            || !grants.contains(&format!("app:{}:edit_form", form.app_route_app_id)))
    {
        return Err(AppError::Forbidden("无权为当前表单创建按钮自动化".into()));
    }
    let name = payload.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::BadRequest("请填写自动化名称（最多100字）".into()));
    }
    let payload = CreateAutomationFlowRequest {
        name: Some(name.into()),
        description: None,
        trigger_form_uuid: Some(form_uuid),
        trigger_events: Some(vec!["button_click".into()]),
        operator: Some(
            crate::platform::authorization::current_user(&headers, &state)
                .await?
                .display_name,
        ),
    };
    let flow = create_automation_definition(&state, &form.app_route_app_id, Some(payload)).await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建按钮触发自动化成功",
            ApiAutomationFlow::from(flow),
        )),
    ))
}

pub(crate) async fn create_automation_definition(
    state: &AppState,
    app_id: &str,
    payload: Option<CreateAutomationFlowRequest>,
) -> Result<automation_flow_entity::Model, AppError> {
    AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let payload = payload.unwrap_or(CreateAutomationFlowRequest {
        name: None,
        description: None,
        trigger_form_uuid: None,
        trigger_events: None,
        operator: None,
    });
    let now = Utc::now();
    let operator = normalize_operator(payload.operator);
    let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
    let trigger_events =
        normalize_automation_trigger_events(payload.trigger_events.unwrap_or_default())?;
    if trigger_events == ["button_click"] && trigger_form_uuid.is_none() {
        return Err(AppError::BadRequest(
            "按钮触发自动化必须绑定来源表单".into(),
        ));
    }
    if trigger_events.iter().any(|event| event == "form_submit") {
        return Err(AppError::BadRequest(
            "process flows are created only with workflow forms".to_string(),
        ));
    }

    if let Some(form_uuid) = trigger_form_uuid.as_deref() {
        ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
    }

    let txn = state.db.begin().await?;
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set(generate_automation_flow_uuid()),
        app_route_app_id: Set(app_id.to_string()),
        name: Set(normalize_optional_text(payload.name)
            .unwrap_or_else(|| format!("未命名自动化 {}", now.format("%m%d%H%M")))),
        description: Set(normalize_optional_text(payload.description)),
        status: Set("paused".to_string()),
        current_version: Set(1),
        flow_type: Set("trigger".to_string()),
        trigger_form_uuid: Set(trigger_form_uuid),
        trigger_config: Set(with_automation_trigger_events(
            normalize_automation_trigger_config(json!({}), &trigger_events)?,
            &trigger_events,
        )),
        nodes_json: Set(json!([
            {
                "id": "trigger-1",
                "type": "workflow",
                "position": { "x": 120.0, "y": 80.0 },
                "data": {
                    "kind": "trigger",
                    "label": "自动化触发时",
                    "description": "自动化触发入口",
                    "config": {}
                }
            }
        ])),
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

    Ok(flow)
}

pub(crate) async fn create_process_flow_for_form<C>(
    db: &C,
    app_id: &str,
    form_uuid: &str,
    form_name: &str,
) -> Result<automation_flow_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    let now = Utc::now();
    let (nodes, edges) = create_process_flow_template();
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set(generate_automation_flow_uuid()),
        app_route_app_id: Set(app_id.to_string()),
        name: Set(format!("{}审批流程", form_name)),
        description: Set(Some("流程表单内置审批流程".to_string())),
        status: Set("enabled".to_string()),
        current_version: Set(1),
        flow_type: Set("process".to_string()),
        trigger_form_uuid: Set(Some(form_uuid.to_string())),
        trigger_config: Set(json!({ "rootLabel": "表单提交时", "triggerEvents": ["form_submit"] })),
        nodes_json: Set(nodes),
        edges_json: Set(edges),
        created_by: Set("管理员".to_string()),
        updated_by: Set("管理员".to_string()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;
    create_automation_snapshot(db, &flow, Some("流程表单创建时自动生成".to_string())).await?;
    Ok(flow)
}

pub(crate) async fn ensure_process_flow_for_form<C>(
    db: &C,
    app_id: &str,
    form_uuid: &str,
    form_name: &str,
) -> Result<automation_flow_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    if let Some(flow) = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id))
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(form_uuid))
        .filter(automation_flow_entity::Column::FlowType.eq("process"))
        .one(db)
        .await?
    {
        return Ok(flow);
    }

    create_process_flow_for_form(db, app_id, form_uuid, form_name).await
}

fn create_process_flow_template() -> (Value, Value) {
    (
        json!([
            { "id": "trigger-1", "type": "workflow", "position": { "x": 120.0, "y": 80.0 }, "data": { "kind": "trigger", "label": "表单提交时", "description": "流程表单提交后启动审批", "config": {} } },
            { "id": "approval-1", "type": "workflow", "position": { "x": 120.0, "y": 260.0 }, "data": { "kind": "approval", "label": "审批人", "description": "由审批人流程审批", "config": { "assigneeIds": [], "assigneeMode": "self", "roleIds": [], "approvalMode": null } } }
        ]),
        json!([{ "id": "edge-trigger-approval", "source": "trigger-1", "target": "approval-1", "sourceHandle": null, "targetHandle": null }]),
    )
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
    _payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiAutomationFlowDetail>>, AppError> {
    let txn = state.db.begin().await?;
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .lock(LockType::Update)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let snapshot = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow version not found".to_string()))?;

    if snapshot.trigger_form_uuid != flow.trigger_form_uuid
        || automation_trigger_events(&snapshot.trigger_config)
            != automation_trigger_events(&flow.trigger_config)
    {
        ensure_no_button_references(&txn, &flow.flow_uuid).await?;
    }
    let mut restored = flow.clone();
    restored.trigger_form_uuid = snapshot.trigger_form_uuid.clone();
    restored.nodes_json = snapshot.nodes_json.clone();
    restored.edges_json = snapshot.edges_json.clone();
    restored.trigger_config = snapshot.trigger_config.clone();
    validate_execution_definition(&restored)?;
    validate_execution_sources(&state.db, &restored).await?;
    let now = Utc::now();

    let mut active_model: automation_flow_entity::ActiveModel = flow.into();
    active_model.name = Set(snapshot.name.clone());
    active_model.description = Set(snapshot.description.clone());
    active_model.current_version = Set(version);
    active_model.trigger_form_uuid = Set(restored.trigger_form_uuid.clone());
    active_model.trigger_config = Set(snapshot.trigger_config.clone());
    active_model.nodes_json = Set(snapshot.nodes_json.clone());
    active_model.edges_json = Set(snapshot.edges_json.clone());
    active_model.updated_at = Set(now.into());

    let updated = active_model.update(&txn).await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "切换自动化版本成功",
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
    let instance_ids = runs
        .iter()
        .filter_map(|run| run.workflow_instance_id)
        .collect::<Vec<_>>();
    let instance_names = if instance_ids.is_empty() {
        HashMap::new()
    } else {
        use crate::infrastructure::entities::workflow_instance_entity;
        workflow_instance_entity::Entity::find()
            .filter(workflow_instance_entity::Column::Id.is_in(instance_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|instance| (instance.id, instance.instance_uuid))
            .collect::<HashMap<_, _>>()
    };
    let metadata=state.db.query_all_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,"SELECT e.run_id,e.source,e.policy FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE r.flow_id=$1",vec![flow.id.into()])).await?;
    let metadata = metadata
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<Uuid>("", "run_id")?,
                (
                    row.try_get::<Value>("", "source")?,
                    row.try_get::<String>("", "policy")?,
                ),
            ))
        })
        .collect::<Result<HashMap<_, _>, sea_orm::DbErr>>()?;
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
                execution_policy: metadata.get(&run.id).map(|(_, policy)| policy.clone()),
                trigger_source: metadata.get(&run.id).map(|(source, _)| source.clone()),
                allowed_actions: if run.status == "needs_attention" {
                    vec!["resolve".into()]
                } else if run.workflow_instance_id.is_none()
                    && matches!(run.status.as_str(), "failed" | "success")
                {
                    vec!["retry".into()]
                } else {
                    vec![]
                },
                workflow_instance_id: run
                    .workflow_instance_id
                    .and_then(|id| instance_names.get(&id).cloned()),
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
    payload: Result<Json<UpdateAutomationFlowRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<ApiAutomationFlow>>, AppError> {
    let Json(payload) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let updated = update_automation_definition(&state, &flow_uuid, payload).await?;
    Ok(Json(success_response(
        "更新集成自动化成功",
        ApiAutomationFlow::from(updated),
    )))
}

pub(crate) async fn update_automation_definition(
    state: &AppState,
    flow_uuid: &str,
    payload: UpdateAutomationFlowRequest,
) -> Result<automation_flow_entity::Model, AppError> {
    let txn = state.db.begin().await?;
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.to_string()))
        .lock(LockType::Update)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let now = Utc::now();
    let app_id = flow.app_route_app_id.clone();
    let is_process_flow = flow.flow_type == "process";
    let process_form_uuid = flow.trigger_form_uuid.clone();
    let existing_nodes_json = flow.nodes_json.clone();
    let existing_edges_json = flow.edges_json.clone();
    let existing_trigger_events = automation_trigger_events(&flow.trigger_config);
    let mut active_model: automation_flow_entity::ActiveModel = flow.clone().into();
    let mut next_nodes_json = existing_nodes_json.clone();
    let mut next_edges_json = existing_edges_json.clone();
    let mut nodes_updated = false;
    let mut edges_updated = false;

    if let Some(name) = payload.name {
        if is_process_flow {
            return Err(AppError::BadRequest(
                "流程表单的自动化名称由表单名称自动同步，不能单独修改".to_string(),
            ));
        }
        let next_name = name.trim();
        if !next_name.is_empty() {
            active_model.name = Set(next_name.to_string());
        }
    }

    if payload.description.is_some() {
        active_model.description = Set(normalize_optional_text(payload.description));
    }

    let starting = payload.status.as_deref() == Some("enabled");
    if let Some(status) = payload.status {
        active_model.status = Set(normalize_automation_status(&status)?);
    }

    let requested_trigger_events = payload
        .trigger_events
        .map(normalize_automation_trigger_events)
        .transpose()?;
    if requested_trigger_events.is_none()
        && !flow
            .trigger_config
            .get("triggerEvents")
            .is_some_and(Value::is_array)
    {
        return Err(AppError::BadRequest(
            "旧自动化定义不受支持，请重新配置 triggerEvents".into(),
        ));
    }
    if requested_trigger_events
        .as_ref()
        .is_some_and(|events| is_process_flow && events.as_slice() != ["form_submit"])
    {
        return Err(AppError::BadRequest(
            "process flow trigger is fixed to form_submit".into(),
        ));
    }

    let requested_form_uuid = payload
        .trigger_form_uuid
        .as_ref()
        .map(|value| normalize_optional_text(Some(value.clone())))
        .unwrap_or_else(|| flow.trigger_form_uuid.clone());
    if requested_trigger_events
        .as_ref()
        .is_some_and(|events| events.as_slice() == ["button_click"])
        && requested_form_uuid.is_none()
    {
        return Err(AppError::BadRequest(
            "按钮触发自动化必须绑定来源表单".into(),
        ));
    }

    if payload.trigger_form_uuid.is_some() {
        let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
        if is_process_flow && trigger_form_uuid != process_form_uuid {
            return Err(AppError::BadRequest(
                "process flow is bound to its workflow form".to_string(),
            ));
        }
        if let Some(form_uuid) = trigger_form_uuid.as_deref() {
            ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
        }
        active_model.trigger_form_uuid = Set(trigger_form_uuid);
    }

    if let Some(trigger_config) = payload.trigger_config {
        active_model.trigger_config = Set(normalize_json_object(trigger_config));
    }

    let effective_trigger_events = if let Some(trigger_events) = requested_trigger_events.as_ref() {
        let trigger_config = active_model.trigger_config.clone().unwrap();
        active_model.trigger_config = Set(with_automation_trigger_events(
            trigger_config,
            trigger_events,
        ));
        trigger_events.clone()
    } else {
        existing_trigger_events
    };

    if !is_process_flow {
        let trigger_config = active_model.trigger_config.clone().unwrap();
        active_model.trigger_config = Set(with_automation_trigger_events(
            normalize_automation_trigger_config(trigger_config, &effective_trigger_events)?,
            &effective_trigger_events,
        ));
    }

    if let Some(nodes) = payload.nodes {
        graph::validate_current_protocol(&nodes, &active_model.trigger_config.clone().unwrap())?;
        next_nodes_json = normalize_automation_nodes(nodes)?;
        nodes_updated = true;
    }

    if let Some(edges) = payload.edges {
        next_edges_json = normalize_automation_edges(edges)?;
        edges_updated = true;
    }

    // Older freshly-created flows persisted an empty graph. Give them the same
    // valid entry node as newly-created flows when the user starts them.
    if starting
        && json_array_items(&next_nodes_json).is_empty()
        && json_array_items(&next_edges_json).is_empty()
    {
        next_nodes_json = json!([{
            "id": "trigger-1",
            "type": "workflow",
            "position": { "x": 120.0, "y": 80.0 },
            "data": {
                "kind": "trigger",
                "label": "自动化触发时",
                "description": "自动化触发入口",
                "config": {}
            }
        }]);
        nodes_updated = true;
    }

    if nodes_updated || edges_updated {
        validate_automation_graph(&next_nodes_json, &next_edges_json)?;
    }
    graph::validate_current_protocol(
        &next_nodes_json,
        &active_model.trigger_config.clone().unwrap(),
    )?;
    validate_flow_node_kinds(
        &next_nodes_json,
        if is_process_flow {
            "process"
        } else {
            "trigger"
        },
    )?;
    if is_process_flow {
        validate_process_reachable_approval(&next_nodes_json, &next_edges_json)?;
        validate_process_human_node_configs(&next_nodes_json)?;
    }
    if starting {
        validate_automation_graph(&next_nodes_json, &next_edges_json)?;
    }
    ensure_automation_node_forms_belong_to_app(&state.db, &app_id, &next_nodes_json).await?;
    let validation_source = active_model.trigger_form_uuid.clone().unwrap();
    if effective_trigger_events == ["button_click"] && validation_source.is_none() {
        return Err(AppError::BadRequest(
            "按钮触发自动化必须绑定来源表单".into(),
        ));
    }
    get_data::validate_get_nodes(
        &state.db,
        &next_nodes_json,
        &next_edges_json,
        validation_source.as_deref(),
    )
    .await?;

    if active_model.trigger_form_uuid.clone().unwrap() != flow.trigger_form_uuid
        || effective_trigger_events != automation_trigger_events(&flow.trigger_config)
    {
        ensure_no_button_references(&txn, &flow.flow_uuid).await?;
    }
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
    let should_create_version = automation_schema(&flow)
        != json!({
            "name": active_model.name.clone().unwrap(),
            "description": active_model.description.clone().unwrap(),
            "triggerFormUuid": active_model.trigger_form_uuid.clone().unwrap(),
            "triggerConfig": active_model.trigger_config.clone().unwrap(),
            "nodes": active_model.nodes_json.clone().unwrap(),
            "edges": active_model.edges_json.clone().unwrap(),
        });
    if should_create_version {
        // The selected version can be older than the newest historical version.
        let latest = AutomationFlowVersionEntity::find()
            .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
            .order_by_desc(automation_flow_version_entity::Column::Version)
            .one(&txn)
            .await?;
        let next_version = latest
            .map_or(flow.current_version, |v| v.version)
            .checked_add(1)
            .ok_or_else(|| AppError::BadRequest("automation version limit reached".to_string()))?;
        active_model.current_version = Set(next_version);
    }
    let updated = active_model.update(&txn).await?;
    if should_create_version {
        create_automation_snapshot(&txn, &updated, payload.change_summary).await?;
    }
    txn.commit().await?;

    Ok(updated)
}

#[cfg(test)]
#[path = "automations/version_tests.rs"]
mod version_tests;

fn automation_schema(flow: &automation_flow_entity::Model) -> Value {
    json!({
        "name": flow.name,
        "description": flow.description,
        "triggerFormUuid": flow.trigger_form_uuid,
        "triggerConfig": flow.trigger_config,
        "nodes": flow.nodes_json,
        "edges": flow.edges_json,
    })
}

pub(crate) async fn delete_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    delete_automation_definition(&state, &flow_uuid).await?;
    Ok(Json(success_response(
        "删除集成自动化成功",
        json!({ "deleted": true, "id": flow_uuid }),
    )))
}

pub(crate) async fn delete_automation_definition(
    state: &AppState,
    flow_uuid: &str,
) -> Result<(), AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.to_string()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    if flow.flow_type == "process" {
        return Err(AppError::BadRequest(
            "workflow form process automation is managed by its form and cannot be deleted"
                .to_string(),
        ));
    }

    let txn = state.db.begin().await?;
    AutomationFlowEntity::find_by_id(flow.id)
        .lock_exclusive()
        .one(&txn)
        .await?;
    ensure_no_button_references(&txn, &flow.flow_uuid).await?;
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

    Ok(())
}

pub(crate) async fn execute_automation_flows_for_event(
    db: &DatabaseConnection,
    definition: &form_definition_entity::Model,
    event: &str,
    trigger_payload: &Value,
    operator: &str,
    user_id: Option<Uuid>,
    changed_fields: Option<&HashSet<String>>,
) -> Result<(), AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(
            automation_flow_entity::Column::AppRouteAppId.eq(definition.app_route_app_id.clone()),
        )
        .filter(
            automation_flow_entity::Column::TriggerFormUuid.eq(Some(definition.form_uuid.clone())),
        )
        .filter(automation_flow_entity::Column::FlowType.eq("trigger"))
        .filter(automation_flow_entity::Column::Status.eq("enabled"))
        .all(db)
        .await?;

    let mut first_error = None;
    for flow in flows {
        validate_execution_definition(&flow)?;
        if !automation_trigger_events(&flow.trigger_config)
            .iter()
            .any(|configured_event| configured_event == event)
        {
            continue;
        }
        if !flow_matches_changed_fields(event, &flow.trigger_config, changed_fields) {
            continue;
        }
        if let Err(err) = execute_persistent_trigger(
            db,
            &flow,
            event,
            trigger_payload,
            operator,
            "trigger-1",
            None,
            None,
            None,
            user_id,
        )
        .await
        {
            error!(
                "execute automation flow failed, flow={}: {err:?}",
                flow.flow_uuid
            );
            if first_error.is_none() {
                first_error = Some(format!(
                    "automation flow {} failed: {err:?}",
                    flow.flow_uuid
                ));
            }
        }
    }

    match first_error {
        Some(message) => Err(AppError::BadRequest(message)),
        None => Ok(()),
    }
}

async fn execute_add_data_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    if config.get("targetMode").and_then(Value::as_str) == Some("subtable") {
        let source = config
            .get("parentDataNodeId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let parent_form = get_data::source_form(
            &flow.nodes_json,
            &flow.edges_json,
            source,
            flow.trigger_form_uuid.as_deref(),
        )?;
        return execute_add_subform_data(db, config, context, &parent_form).await;
    }
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
            inserted.push(record_data_with_automation_identity(record));
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
    Ok(record_data_with_automation_identity(record))
}

async fn execute_add_subform_data<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &Value,
    context: &AutomationExecutionContext,
    parent_form: &str,
) -> Result<Value, AppError> {
    let subform_id = read_json_string(config.get("subformFieldId"))
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AppError::BadRequest("请选择目标子表".into()))?;
    get_data::validate_subform_config(db, parent_form, config).await?;
    let source = config
        .get("parentDataNodeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let parents = get_data::node_candidates(context.outputs.get(source))?;
    let mut parent_ids = parents
        .iter()
        .map(|record| {
            record
                .get("__automationRecordUuid")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "来源数据节点缺少持久化主表记录 ID，创建前或删除后的记录不能新增子表"
                            .into(),
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    parent_ids.sort();
    parent_ids.dedup();
    if parent_ids.is_empty() {
        return Ok(json!([]));
    }
    let rows = json_array_items(&config.get("rows").cloned().unwrap_or_else(|| json!([])));
    let multiple = config.get("recordMode").and_then(Value::as_str) == Some("multiple");
    let multiple_items = if multiple {
        let source = read_json_string(config.get("multipleSourceNodeId")).unwrap_or_default();
        let items = context
            .outputs
            .get(&source)
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::BadRequest("多条新增的数据来源必须为数组".into()))?;
        Some((source, items))
    } else {
        None
    };
    // 锁定主记录后追加数组，复用主表更新触发器同步子表物理存储，避免并行追加覆盖。
    let txn = db.begin().await?;
    let repository = RecordRepository::new(&txn);
    let mut inserted = Vec::new();
    for parent_id in &parent_ids {
        let parent = repository.find_for_update(parent_form, parent_id).await?;
        let mut outputs = context.outputs.clone();
        let source_record = parents
            .iter()
            .find(|record| {
                record.get("__automationRecordUuid").and_then(Value::as_str)
                    == Some(parent_id.as_str())
            })
            .unwrap();
        outputs.insert(source.to_string(), source_record.clone());
        let new_rows = if let Some((multiple_source, items)) = &multiple_items {
            items
                .iter()
                .map(|item| {
                    let mut scoped = outputs.clone();
                    scoped.insert(multiple_source.clone(), json!([item]));
                    build_record_data_from_rows(&rows, &scoped)
                })
                .collect::<Vec<_>>()
        } else {
            vec![build_record_data_from_rows(&rows, &outputs)]
        };
        let mut next = parent.record_data.clone();
        let array = next
            .as_object_mut()
            .ok_or_else(|| AppError::BadRequest("主表记录必须为对象".into()))?
            .entry(subform_id.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| AppError::BadRequest("子表字段必须为数组".into()))?;
        array.extend(new_rows.clone());
        repository
            .update(&parent, next, &context.operator, Utc::now())
            .await?;
        inserted.extend(new_rows.clone());
    }
    txn.commit().await?;
    Ok(
        if parent_ids.len() == 1
            && config.get("recordMode").and_then(Value::as_str) != Some("multiple")
        {
            inserted.into_iter().next().unwrap()
        } else {
            json!(inserted)
        },
    )
}

async fn get_candidates<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Vec<Value>, AppError> {
    get_data::validate_query_config(config)?;
    let candidates = if config.get("sourceMode").and_then(Value::as_str) == Some("data-node") {
        let id = read_json_string(config.get("dataNodeId")).unwrap_or_default();
        get_data::node_candidates(context.outputs.get(&id))?
    } else if config.get("sourceMode").and_then(Value::as_str) == Some("trigger") {
        vec![
            context
                .outputs
                .get("trigger-1")
                .cloned()
                .ok_or_else(|| AppError::BadRequest("按钮触发记录不可用".into()))?,
        ]
    } else {
        let form_uuid = read_json_string(config.get("formUuid"))
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("请选择来源表单".into()))?;
        RecordRepository::new(db)
            .list(&form_uuid)
            .await?
            .into_iter()
            .map(record_data_with_automation_identity)
            .collect()
    };
    Ok(get_data::filter_candidates(candidates, config))
}

async fn execute_get_one_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    Ok(get_candidates(db, config, context)
        .await?
        .into_iter()
        .next()
        .unwrap_or(Value::Null))
}

async fn execute_get_many_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    Ok(Value::Array(get_candidates(db, config, context).await?))
}

pub(crate) fn record_data_with_automation_identity(record: StoredFormRecord) -> Value {
    let mut data = record.record_data.as_object().cloned().unwrap_or_default();
    inject_automation_system_fields(
        &mut data,
        &record.record_uuid,
        Some(record.created_at.to_rfc3339()),
        Some(record.updated_at.to_rfc3339()),
        Some(record.created_by.clone()),
    );
    Value::Object(data)
}

/// Add the stable fields exposed by the automation field picker to every
/// record output. They live alongside form data so the shared expression and
/// condition evaluators can resolve them using the same `nodeId:fieldId` key.
pub(crate) fn inject_automation_system_fields(
    data: &mut serde_json::Map<String, Value>,
    record_uuid: &str,
    created_at: Option<String>,
    updated_at: Option<String>,
    submitter: Option<String>,
) {
    data.insert(
        "__automationRecordUuid".to_string(),
        Value::String(record_uuid.to_string()),
    );
    data.entry("instanceId")
        .or_insert_with(|| Value::String(record_uuid.to_string()));
    data.entry("instanceTitle").or_insert_with(|| {
        Value::String(format!(
            "{}发起的记录",
            submitter.as_deref().unwrap_or("用户")
        ))
    });
    if let Some(value) = submitter {
        data.entry("submitter").or_insert(Value::String(value));
    }
    if let Some(value) = created_at {
        data.entry("createdAt").or_insert(Value::String(value));
    }
    if let Some(value) = updated_at {
        data.entry("updatedAt").or_insert(Value::String(value));
    }
    data.entry("submitterOrganization").or_insert(Value::Null);
}

async fn execute_update_data_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
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
    let update_mode = config
        .get("updateMode")
        .and_then(Value::as_str)
        .unwrap_or("form");
    let matched = if update_mode == "data-node" {
        let source_node_id = read_json_string(config.get("sourceNodeId")).unwrap_or_default();
        let source_records = context.outputs.get(&source_node_id);
        let source_record_uuids = match source_records {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|item| item.get("__automationRecordUuid"))
                .filter_map(Value::as_str)
                .collect::<std::collections::HashSet<_>>(),
            Some(item) => item
                .get("__automationRecordUuid")
                .and_then(Value::as_str)
                .into_iter()
                .collect(),
            None => std::collections::HashSet::new(),
        };

        records
            .into_iter()
            .filter(|record| source_record_uuids.contains(record.record_uuid.as_str()))
            .collect()
    } else {
        filter_records_by_rules(records, config.get("rules"))
    };
    let patch = build_record_data_from_rows(&rows, &context.outputs);
    let now = Utc::now();
    let mut updated_items = Vec::new();

    let mut matched = matched;
    matched.sort_by(|a, b| a.record_uuid.cmp(&b.record_uuid));
    for record in matched {
        let record = repository
            .find_for_update(&target_form_uuid, &record.record_uuid)
            .await?;
        let merged = merge_record_payload(record.record_data.clone(), &patch);
        let updated = repository
            .update(&record, merged, &context.operator, now)
            .await?;
        updated_items.push(record_data_with_automation_identity(updated));
    }

    info!(
        "automation update-data executed: flow={}, form={}, count={}",
        flow.flow_uuid,
        target_form_uuid,
        updated_items.len()
    );
    Ok(Value::Array(updated_items))
}

async fn execute_delete_data_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
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

    let parsed_url = reqwest::Url::parse(&url)
        .map_err(|_| AppError::BadRequest("http-request url is invalid".to_string()))?;
    #[cfg(not(test))]
    validate_http_request_url(&parsed_url).await?;
    #[cfg(test)]
    if parsed_url.host_str() != Some("127.0.0.1") {
        validate_http_request_url(&parsed_url).await?;
    }

    let client_builder = reqwest::Client::builder();
    #[cfg(test)]
    let client_builder = if parsed_url.host_str() == Some("127.0.0.1") {
        client_builder.no_proxy()
    } else {
        client_builder
    };
    let client = client_builder
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| AppError::BadRequest(format!("http-request client setup failed: {err}")))?;
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

    let mut response = request
        .send()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request failed: {err}")))?;
    let status = response.status().as_u16();
    const MAX_HTTP_RESPONSE_BYTES: usize = 1_048_576;
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_HTTP_RESPONSE_BYTES)
    {
        return Err(AppError::BadRequest(
            "http-request response exceeds the 1 MiB limit".to_string(),
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request read failed: {err}")))?
    {
        if body.len() + chunk.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(AppError::BadRequest(
                "http-request response exceeds the 1 MiB limit".to_string(),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&body).into_owned();

    let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
    Ok(json!({
        "status": status,
        "body": payload,
    }))
}

/// Shared node handlers. Human waiting is supplied by the runtime adapter.
pub(crate) async fn execute_shared_node<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    flow: &automation_flow_entity::Model,
    node_id: &str,
    kind: &str,
    config: &Value,
    context: &mut AutomationExecutionContext,
) -> Result<(), AppError> {
    let output = match kind {
        "trigger" | "condition" | "parallel-condition" => return Ok(()),
        "initiate-approval" => initiate_approval::execute(db, config, context).await?,
        "add-data" => execute_add_data_node(db, flow, config, context).await?,
        "get-one" => execute_get_one_node(db, config, context).await?,
        "get-many" => execute_get_many_node(db, config, context).await?,
        "update-data" => execute_update_data_node(db, flow, config, context).await?,
        "delete-data" => execute_delete_data_node(db, flow, config, context).await?,
        "http-request" => execute_http_request_node(config, context).await?,
        _ => {
            return Err(AppError::BadRequest(format!(
                "unsupported automation node kind: {kind}"
            )));
        }
    };
    context.outputs.insert(node_id.to_string(), output);
    Ok(())
}

async fn validate_http_request_url(url: &reqwest::Url) -> Result<(), AppError> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::BadRequest(
            "http-request url must use http or https".to_string(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::BadRequest(
            "http-request url must not contain credentials".to_string(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("http-request url host is required".to_string()))?;
    let port = url.port_or_known_default().ok_or_else(|| {
        AppError::BadRequest("http-request url must use a known port".to_string())
    })?;

    if let Ok(address) = host.parse::<IpAddr>() {
        return validate_public_http_address(address);
    }
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err(AppError::BadRequest(
            "http-request url must not target localhost".to_string(),
        ));
    }

    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| AppError::BadRequest("http-request host cannot be resolved".to_string()))?
        .map(|address| address.ip())
        .collect::<HashSet<_>>();
    if addresses.is_empty() {
        return Err(AppError::BadRequest(
            "http-request host cannot be resolved".to_string(),
        ));
    }
    for address in addresses {
        validate_public_http_address(address)?;
    }
    Ok(())
}

fn validate_public_http_address(address: IpAddr) -> Result<(), AppError> {
    let blocked = match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified()
                || address == Ipv4Addr::new(100, 64, 0, 0)
                || (address.octets()[0] == 100 && (64..=127).contains(&address.octets()[1]))
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_unicast_link_local()
                || address.is_unique_local()
                || address == Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0)
        }
    };
    if blocked {
        Err(AppError::BadRequest(
            "http-request url resolves to a private or reserved address".to_string(),
        ))
    } else {
        Ok(())
    }
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
            "initiate-approval" => {
                initiate_approval::validate_target(db, &item.pointer("/data/config").cloned().unwrap_or_else(|| json!({})), false).await?;
            }
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
                if kind == "add-data"
                    && config
                        .and_then(|value| value.get("targetMode"))
                        .and_then(Value::as_str)
                        == Some("subtable")
                {
                    continue;
                }
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
            | "initiate-approval"
            | "condition"
            | "parallel-condition"
            | "add-data"
            | "update-data"
            | "get-one"
            | "get-many"
            | "delete-data"
            | "http-request"
            | "approval"
            | "copy"
            | "executor"
    ) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation node kind".to_string(),
        ))
    }
}

fn validate_flow_node_kinds(nodes: &Value, flow_type: &str) -> Result<(), AppError> {
    let allowed: &[&str] = if flow_type == "process" {
        // Process flows use the automation nodes as well as their human-task nodes.
        &[
            "trigger",
            "condition",
            "parallel-condition",
            "initiate-approval",
            "add-data",
            "update-data",
            "get-one",
            "get-many",
            "delete-data",
            "http-request",
            "approval",
            "copy",
            "executor",
        ]
    } else {
        &[
            "trigger",
            "condition",
            "parallel-condition",
            "initiate-approval",
            "add-data",
            "update-data",
            "get-one",
            "get-many",
            "delete-data",
            "http-request",
        ]
    };
    for node in json_array_items(nodes) {
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !allowed.contains(&kind) {
            return Err(AppError::BadRequest(
                "node kind is not available for this automation type".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_process_human_node_configs(nodes: &Value) -> Result<(), AppError> {
    for node in json_array_items(nodes) {
        let node_id = node.get("id").and_then(Value::as_str).unwrap_or("unknown");
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let Some(config) = node.pointer("/data/config").and_then(Value::as_object) else {
            if matches!(kind, "approval" | "executor" | "copy") {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} is missing its human-node configuration"
                )));
            }
            continue;
        };
        let old_fields = ["assignees", "recipients", "executorIds", "executors"];
        if let Some(field) = old_fields.iter().find(|field| config.contains_key(**field)) {
            return Err(AppError::BadRequest(format!(
                "node {node_id} uses removed field {field}; configure the node again"
            )));
        }
        if kind == "approval" || kind == "executor" {
            let mode = config
                .get("assigneeMode")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    AppError::BadRequest(format!("node {node_id} must define assigneeMode"))
                })?;
            if !matches!(mode, "members" | "roles") && !(kind == "approval" && mode == "self") {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} has invalid assigneeMode"
                )));
            }
            let member_ids = config
                .get("assigneeIds")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let role_ids = config
                .get("roleIds")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            if member_ids > 0 && role_ids > 0 {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} cannot configure assigneeIds and roleIds together"
                )));
            }
            if mode == "members" && member_ids == 0 || mode == "roles" && role_ids == 0 {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} has no configured assignee"
                )));
            }
            if mode == "self" && (member_ids > 0 || role_ids > 0) {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} self mode cannot include member or role ids"
                )));
            }
            if mode == "self"
                && config
                    .get("approvalMode")
                    .map(|value| !value.is_null())
                    .unwrap_or(false)
            {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} self mode cannot configure approvalMode"
                )));
            }
        } else if kind == "copy" {
            let mode = config
                .get("recipientMode")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    AppError::BadRequest(format!("node {node_id} must define recipientMode"))
                })?;
            if !matches!(mode, "members" | "roles") {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} has invalid recipientMode"
                )));
            }
            let member_ids = config
                .get("recipientIds")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let role_ids = config
                .get("roleIds")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            if member_ids > 0 && role_ids > 0 {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} cannot configure recipientIds and roleIds together"
                )));
            }
            if mode == "members" && member_ids == 0 || mode == "roles" && role_ids == 0 {
                return Err(AppError::BadRequest(format!(
                    "node {node_id} has no configured recipient"
                )));
            }
        }
    }
    Ok(())
}

fn normalize_automation_node_config(kind: &str, config: Value) -> Result<Value, AppError> {
    let config = normalize_json_object(config);
    let object = config.as_object().cloned().unwrap_or_default();

    let normalized = match kind {
        "trigger" => json!({
            "changedFieldMode": if object.get("changedFieldMode").and_then(Value::as_str) == Some("specific") { "specific" } else { "any" },
            "changedFieldId": read_json_string(object.get("changedFieldId")),
        }),
        "condition" | "parallel-condition" => {
            if object
                .get("branches")
                .and_then(Value::as_array)
                .map(|branches| !branches.is_empty())
                .unwrap_or(false)
            {
                json!({
                    "branches": normalize_condition_branches(
                        object.get("branches").cloned().unwrap_or_else(|| json!([])),
                        kind != "parallel-condition",
                    )?,
                })
            } else {
                return Err(AppError::BadRequest("condition requires branches".into()));
            }
        }
        "get-one" | "get-many" => {
            get_data::validate_query_config(&Value::Object(object.clone()))?;
            json!({
                "sourceMode": if object.get("sourceMode").and_then(Value::as_str) == Some("trigger") { "trigger" } else { normalize_data_source_mode(object.get("sourceMode").and_then(Value::as_str)) },
                "formUuid": read_json_string(object.get("formUuid")),
                "dataNodeId": read_json_string(object.get("dataNodeId")),
                "filterMode": object.get("filterMode").and_then(Value::as_str).unwrap_or("all"),
                "rules": if object.get("filterMode").and_then(Value::as_str) == Some("rules") { normalize_branch_rules(object.get("rules").cloned().unwrap_or_else(|| json!([])))? } else { json!([]) },
            })
        }
        "initiate-approval" => json!({
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "targetAppId": read_json_string(object.get("targetAppId")),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "initiatorMode": if object.get("initiatorMode").and_then(Value::as_str) == Some("field") { "field" } else { "member" },
            "initiatorId": read_json_string(object.get("initiatorId")),
            "initiatorFieldId": read_json_string(object.get("initiatorFieldId")),
        }),
        "add-data" => json!({
            "subformFieldId": read_json_string(object.get("subformFieldId")),
            "parentDataNodeId": read_json_string(object.get("parentDataNodeId")),
            "targetMode": normalize_add_target_mode(object.get("targetMode").and_then(Value::as_str)),
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "recordMode": normalize_add_record_mode(object.get("recordMode").and_then(Value::as_str)),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "multipleSourceMode": normalize_multiple_source_mode(object.get("multipleSourceMode").and_then(Value::as_str)),
            "multipleSourceNodeId": read_json_string(object.get("multipleSourceNodeId")),
            "multipleFormula": read_json_string(object.get("multipleFormula")),
        }),
        "update-data" => json!({
            "updateMode": normalize_update_mode(object.get("updateMode").and_then(Value::as_str)),
            "sourceNodeId": read_json_string(object.get("sourceNodeId")),
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "rules": normalize_branch_rules(object.get("rules").cloned().unwrap_or_else(|| json!([])))?,
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "bodyTemplate": read_json_string(object.get("bodyTemplate")),
            "method": read_json_string(object.get("method")),
            "url": read_json_string(object.get("url")),
            "headersText": read_json_string(object.get("headersText")),
        }),
        "delete-data" | "http-request" => json!({
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "matchRule": read_json_string(object.get("matchRule")),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "bodyTemplate": read_json_string(object.get("bodyTemplate")),
            "method": read_json_string(object.get("method")),
            "url": read_json_string(object.get("url")),
            "headersText": read_json_string(object.get("headersText")),
        }),
        "approval" | "executor" => json!({
            "assigneeIds": object.get("assigneeIds").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
            "assigneeMode": object.get("assigneeMode").and_then(Value::as_str),
            "roleIds": object.get("roleIds").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
            "approvalMode": if object.get("assigneeMode").and_then(Value::as_str) == Some("self") { Value::Null } else if object.get("approvalMode").and_then(Value::as_str) == Some("any") { json!("any") } else { json!("all") },
            "requiredFieldIds": object.get("requiredFieldIds").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
        }),
        "copy" => json!({
            "recipientIds": object.get("recipientIds").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
            "recipientMode": object.get("recipientMode").and_then(Value::as_str),
            "roleIds": object.get("roleIds").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
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
            "isGroup": raw.get("isGroup").and_then(Value::as_bool).unwrap_or(false),
            "logicalOperator": if raw.get("logicalOperator").and_then(Value::as_str) == Some("or") { "or" } else { "and" },
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

fn normalize_condition_branches(data: Value, prioritized: bool) -> Result<Value, AppError> {
    let items = normalize_json_array(data);
    let mut seen_ids = HashSet::new();

    let mut otherwise_seen = false;
    let mut condition_branches = Vec::new();
    let mut otherwise_branch = None;
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

        let entry_mode = match raw.get("entryMode").and_then(Value::as_str) {
            Some("condition") => "condition",
            Some("otherwise") => {
                if otherwise_seen {
                    return Err(AppError::BadRequest(
                        "condition node can have only one otherwise branch".to_string(),
                    ));
                }
                otherwise_seen = true;
                "otherwise"
            }
            Some(_) => {
                return Err(AppError::BadRequest(format!(
                    "condition branch {} has invalid entryMode",
                    branch_id
                )));
            }
            None => {
                return Err(AppError::BadRequest(format!(
                    "condition branch {} requires entryMode",
                    branch_id
                )));
            }
        };
        let normalized = json!({
            "id": branch_id,
            "name": read_json_string(raw.get("name")).unwrap_or_else(|| format!("条件分支 {}", index + 1)),
            "entryMode": entry_mode,
            "mode": if entry_mode == "otherwise" { "all" } else { normalize_condition_mode(raw.get("mode").and_then(Value::as_str)) },
            "priority": normalize_condition_priority(
                raw.get("priority").and_then(Value::as_i64).or(Some((index + 1) as i64)),
            ),
            "rules": normalize_branch_rules(raw.get("rules").cloned().unwrap_or_else(|| json!([])))?,
            "expression": read_json_string(raw.get("expression")),
            "hitLabel": read_json_string(raw.get("hitLabel")),
        });
        if entry_mode == "otherwise" {
            otherwise_branch = Some(normalized);
        } else {
            condition_branches.push(normalized);
        }
    }
    if prioritized {
        condition_branches
            .sort_by_key(|branch| branch.get("priority").and_then(Value::as_i64).unwrap_or(0));
    }
    if let Some(otherwise) = otherwise_branch {
        condition_branches.push(otherwise);
    }
    for (index, branch) in condition_branches.iter_mut().enumerate() {
        if let Some(object) = branch.as_object_mut() {
            if prioritized {
                object.insert("priority".to_string(), json!((index + 1) as i64));
            } else {
                object.remove("priority");
            }
        }
    }
    Ok(Value::Array(condition_branches))
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
        "trigger" => "trigger",
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

fn normalize_update_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("form").trim() {
        "data-node" => "data-node",
        _ => "form",
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
        "parallel-condition" => "并行条件分支",
        "condition" => "条件分支",
        "initiate-approval" => "发起审批",
        "add-data" => "新增数据",
        "update-data" => "更新数据",
        "get-one" => "获取单条数据",
        "get-many" => "获取多条数据",
        "delete-data" => "删除数据",
        "http-request" => "连接器",
        "approval" => "审批人",
        "copy" => "抄送人",
        "executor" => "执行人",

        _ => "未命名节点",
    }
}

fn default_node_description(kind: &str) -> &'static str {
    match kind {
        "trigger" => "根据表单记录事件开始执行工作流",
        "parallel-condition" => "判断所有条件，并行执行满足条件的分支",
        "condition" => "按优先级和条件规则控制后续走向",
        "initiate-approval" => "填写流程表单数据，待用户手动提交",
        "add-data" => "向目标表单新增单条或多条数据",
        "update-data" => "根据匹配条件更新目标表单记录",
        "get-one" => "从表单、数据节点或关联表单中获取一条数据",
        "get-many" => "从表单、数据节点或关联表单中获取多条数据",
        "delete-data" => "根据匹配条件删除目标表单记录",
        "http-request" => "调用外部接口或 Webhook",
        "approval" => "等待审批人同意或拒绝",
        "copy" => "通知抄送人后自动继续",
        "executor" => "等待执行人完成处理",

        _ => "",
    }
}

async fn execute_automation_flow(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_event: &str,
    trigger_data: &Value,
    operator: &str,
    retry_source: Option<RetrySource>,
    retry_run_uuid: Option<&str>,
    retry_node_key: Option<&str>,
) -> Result<(), AppError> {
    execute_persistent_trigger(
        db,
        flow,
        trigger_event,
        trigger_data,
        operator,
        retry_node_key.unwrap_or("trigger-1"),
        None,
        retry_source,
        retry_run_uuid,
        None,
    )
    .await
}
async fn execute_automation_flow_from_snapshot(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_event: &str,
    trigger_data: &Value,
    operator: &str,
    start_node_key: &str,
    outputs_snapshot: HashMap<String, Value>,
    retry_run_uuid: &str,
) -> Result<(), AppError> {
    execute_persistent_trigger(
        db,
        flow,
        trigger_event,
        trigger_data,
        operator,
        start_node_key,
        Some(outputs_snapshot),
        Some(RetrySource::Node),
        Some(retry_run_uuid),
        None,
    )
    .await
}
async fn execute_persistent_trigger(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    event: &str,
    input: &Value,
    operator: &str,
    start: &str,
    outputs: Option<HashMap<String, Value>>,
    retry_source: Option<RetrySource>,
    retry_run: Option<&str>,
    user_id: Option<Uuid>,
) -> Result<(), AppError> {
    let txn = db.begin().await?;
    let run = execution::start_execution(
        &txn,
        execution::StartExecutionRequest {
            flow,
            source: execution::TriggerSource {
                button_uuid: None,
                view_uuid: None,
                kind: "form_event".into(),
                event: event.into(),
                event_id: Uuid::new_v4().to_string(),
                form_uuid: flow.trigger_form_uuid.clone(),
                record_uuid: input
                    .get("__automationRecordUuid")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            identity: execution::ExecutionIdentity {
                user_id,
                display_name: operator.into(),
                operator: operator.into(),
            },
            policy: if event.starts_with("before_") {
                execution::ExecutionPolicy::Before
            } else {
                execution::ExecutionPolicy::Inline
            },
            input,
            instance_id: None,
            start_node: start,
            outputs,
            retry_source,
            retry_run,
        },
    )
    .await?;
    txn.commit().await?;
    let (shutdown, _) = tokio::sync::watch::channel(false);
    execution::drive_execution(&AppState::new(db.clone(), None, 1, shutdown), run).await?;
    let result = AutomationRunEntity::find_by_id(run).one(db).await?.unwrap();
    if matches!(result.status.as_str(), "needs_attention" | "failed") {
        return Err(AppError::BadRequest(
            result.error_message.unwrap_or_else(|| "执行未成功".into()),
        ));
    }
    Ok(())
}
#[cfg(test)]
async fn execute_memory_graph(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    start: &str,
    context: &mut AutomationExecutionContext,
) -> Result<(), AppError> {
    let runtime = engine::MemoryRuntime {
        db,
        flow,
        outputs: std::sync::Mutex::new(context.outputs.clone()),
    };
    let result = engine::drive(
        &runtime,
        engine::Cursor {
            id: Uuid::new_v4(),
            node: start.into(),
            context: context.clone(),
            depth: 0,
            log_id: None,
            parallel_group: None,
        },
    )
    .await;
    context.outputs = runtime.outputs.into_inner().unwrap();
    result
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
        .iter()
        .find(|branch| {
            branch.get("entryMode").and_then(Value::as_str) != Some("otherwise")
                && evaluate_condition_branch(branch, context)
        })
        .or_else(|| {
            ordered
                .iter()
                .find(|branch| branch.get("entryMode").and_then(Value::as_str) == Some("otherwise"))
        })
        .and_then(|branch| read_json_string(branch.get("id")))
        .map(|branch_id| format!("condition-branch:{branch_id}"));
    Some(selected)
}

fn select_parallel_condition_branch_handles(
    node: &Value,
    context: &AutomationExecutionContext,
) -> HashSet<String> {
    let Some(branches) = node
        .pointer("/data/config/branches")
        .and_then(Value::as_array)
    else {
        return HashSet::new();
    };
    let handles = branches
        .iter()
        .filter(|branch| branch.get("entryMode").and_then(Value::as_str) != Some("otherwise"))
        .filter(|branch| evaluate_condition_branch(branch, context))
        .filter_map(|branch| read_json_string(branch.get("id")))
        .map(|id| format!("condition-branch:{id}"))
        .collect::<HashSet<_>>();
    if !handles.is_empty() {
        return handles;
    }
    branches
        .iter()
        .filter(|branch| branch.get("entryMode").and_then(Value::as_str) == Some("otherwise"))
        .filter_map(|branch| read_json_string(branch.get("id")))
        .map(|id| format!("condition-branch:{id}"))
        .collect()
}

fn evaluate_condition_branch(branch: &Value, context: &AutomationExecutionContext) -> bool {
    if branch.get("entryMode").and_then(Value::as_str) == Some("otherwise") {
        return true;
    }
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
    let rules = json_array_items(&rules);
    evaluate_branch_rule_group(&rules, None, context)
}

fn evaluate_branch_rule_group(
    rules: &[Value],
    parent_id: Option<&str>,
    context: &AutomationExecutionContext,
) -> bool {
    let siblings = rules
        .iter()
        .filter(|rule| read_json_string(rule.get("parentId")).as_deref() == parent_id)
        .collect::<Vec<_>>();

    if siblings.is_empty() {
        return true;
    }

    let group_operator = siblings[0]
        .get("logicalOperator")
        .and_then(Value::as_str)
        .unwrap_or("and");
    let mut result = true;
    for (index, rule) in siblings.into_iter().enumerate() {
        let rule_id = read_json_string(rule.get("id"));
        let child_rules = rule_id
            .as_deref()
            .map(|id| {
                rules
                    .iter()
                    .filter(|candidate| {
                        read_json_string(candidate.get("parentId")).as_deref() == Some(id)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let matches = if rule.get("isGroup").and_then(Value::as_bool) == Some(true) {
            evaluate_branch_rule_group(rules, rule_id.as_deref(), context)
        } else if child_rules.is_empty() {
            evaluate_branch_rule(rule, context)
        } else {
            let children_match = evaluate_branch_rule_group(rules, rule_id.as_deref(), context);
            if child_rules[0]
                .get("logicalOperator")
                .and_then(Value::as_str)
                == Some("or")
            {
                evaluate_branch_rule(rule, context) || children_match
            } else {
                evaluate_branch_rule(rule, context) && children_match
            }
        };

        if index == 0 {
            result = matches;
        } else if group_operator == "or" {
            result = result || matches;
        } else {
            result = result && matches;
        }
    }
    result
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
    if flow.flow_type == "process" {
        return Err(AppError::BadRequest(
            "approval runs cannot be retried through automation endpoints".into(),
        ));
    }
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .filter(automation_run_entity::Column::RunUuid.eq(run_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run not found".to_string()))?;

    if run.workflow_instance_id.is_some() || run.status == "needs_attention" {
        return Err(AppError::BadRequest(
            "请使用对应的人工或管理员处理入口".into(),
        ));
    }
    if !matches!(run.status.as_str(), "success" | "failed") {
        return Err(AppError::BadRequest("运行尚未结束".into()));
    }
    let flow = execution::load_version(db, &flow, run.flow_version).await?;
    validate_execution_definition(&flow)?;

    if let Some(node_key) = node_key {
        let node_logs = AutomationRunNodeEntity::find()
            .filter(automation_run_node_entity::Column::RunId.eq(run.id))
            .filter(automation_run_node_entity::Column::NodeKey.eq(node_key.clone()))
            .all(db)
            .await?;
        if node_logs.len() != 1 {
            return Err(AppError::Conflict(
                "节点访问不存在或有多条路径，请按日志 ID 重试".into(),
            ));
        }
        let node_log = &node_logs[0];
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
            &run.trigger_event,
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
            &run.trigger_event,
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
    event: &str,
    trigger_config: &Value,
    changed_fields: Option<&HashSet<String>>,
) -> bool {
    // The field selector refines only record edits. Create and delete events
    // have no changed-field set, so they must remain eligible when enabled.
    if !matches!(event, "before_update" | "after_update") {
        return true;
    }

    let configured = trigger_config
        .get("changedFieldId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (configured, changed_fields) {
        (Some(field_id), Some(fields)) => fields.contains(field_id),
        (Some(_), None) => false,
        _ => true,
    }
}

fn normalize_automation_trigger_config(
    config: Value,
    trigger_events: &[String],
) -> Result<Value, AppError> {
    let object = normalize_json_object(config);
    let source = object.as_object().cloned().unwrap_or_default();
    if source.contains_key("triggerEvent") {
        return Err(AppError::BadRequest(
            "旧字段 triggerEvent 不受支持，请使用 triggerEvents 数组".into(),
        ));
    }
    if source.contains_key("changedFieldsText") {
        return Err(AppError::BadRequest(
            "旧字段 changedFieldsText 不受支持".into(),
        ));
    }
    let has_update_event = trigger_events
        .iter()
        .any(|event| matches!(event.as_str(), "before_update" | "after_update"));
    let requested_field_id = read_json_string(source.get("changedFieldId"));
    let requested_specific = source.get("changedFieldMode").and_then(Value::as_str)
        == Some("specific")
        || requested_field_id.is_some();
    let (mode, changed_field_id) = if has_update_event && requested_specific {
        let field_id = requested_field_id.ok_or_else(|| {
            AppError::BadRequest("a specific changed field must be selected".to_string())
        })?;
        ("specific", Some(field_id))
    } else {
        ("any", None)
    };

    Ok(json!({
        "changedFieldMode": mode,
        "changedFieldId": changed_field_id,
    }))
}

#[cfg(test)]
mod human_node_config_tests {
    use super::*;

    fn node(kind: &str, config: Value) -> Value {
        json!({"id": format!("{kind}-1"), "data": {"kind": kind, "config": config}})
    }

    #[test]
    fn accepts_new_human_node_ranges() {
        let nodes = json!([
            node(
                "approval",
                json!({"assigneeMode":"members", "assigneeIds":["u1"], "roleIds":[]})
            ),
            node(
                "executor",
                json!({"assigneeMode":"roles", "assigneeIds":[], "roleIds":["r1"]})
            ),
            node(
                "copy",
                json!({"recipientMode":"members", "recipientIds":["u1"], "roleIds":[]})
            ),
        ]);
        assert!(validate_process_human_node_configs(&nodes).is_ok());
    }

    #[test]
    fn accepts_self_approval_without_ids() {
        let nodes = json!([node(
            "approval",
            json!({"assigneeMode":"self", "assigneeIds":[], "roleIds":[]})
        )]);
        assert!(validate_process_human_node_configs(&nodes).is_ok());
    }

    #[test]
    fn rejects_removed_fields_missing_modes_and_mixed_ranges() {
        assert!(
            validate_process_human_node_configs(&json!([node(
                "approval",
                json!({"assigneeMode":"members", "assignees":["u1"]})
            )]))
            .is_err()
        );
        assert!(
            validate_process_human_node_configs(&json!([node(
                "approval",
                json!({"assigneeIds":["u1"], "roleIds":[]})
            )]))
            .is_err()
        );
        assert!(
            validate_process_human_node_configs(&json!([node(
                "copy",
                json!({"recipientMode":"members", "recipientIds":["u1"], "roleIds":["r1"]})
            )]))
            .is_err()
        );
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::net::IpAddr;

    use serde_json::json;

    use super::{
        flow_matches_changed_fields, normalize_automation_node_config, validate_public_http_address,
    };

    #[test]
    fn executor_keeps_stage_required_fields() {
        let config = normalize_automation_node_config(
            "executor",
            json!({"assigneeIds": ["user-1"], "requiredFieldIds": ["second", "  "]}),
        )
        .unwrap();
        assert_eq!(config["requiredFieldIds"], json!(["second"]));
    }

    #[test]
    fn blocks_private_http_targets() {
        for address in ["127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "fc00::1"] {
            assert!(validate_public_http_address(address.parse::<IpAddr>().unwrap()).is_err());
        }
        assert!(validate_public_http_address("8.8.8.8".parse::<IpAddr>().unwrap()).is_ok());
    }

    #[test]
    fn field_monitoring_applies_only_to_update_events() {
        let config = json!({ "changedFieldMode": "specific", "changedFieldId": "is_default" });
        let changed = HashSet::from(["name".to_string()]);

        assert!(flow_matches_changed_fields("before_create", &config, None));
        assert!(flow_matches_changed_fields("after_delete", &config, None));
        assert!(!flow_matches_changed_fields(
            "before_update",
            &config,
            Some(&changed)
        ));
    }
}
pub(crate) mod dto;
pub(crate) mod engine;
pub(crate) mod execution;
pub(crate) mod expression;
mod graph;
mod runtime;

pub(crate) use dto::*;
use expression::*;
use graph::*;
pub(crate) use runtime::AutomationExecutionContext;

#[cfg(test)]
#[path = "automations/parallel_condition_tests.rs"]
mod parallel_condition_tests;
#[cfg(test)]
#[path = "automations/subform_tests.rs"]
mod subform_tests;

mod get_data;
mod initiate_approval;

#[cfg(test)]
#[path = "automations/get_data_database_tests.rs"]
mod get_data_database_tests;

pub(crate) fn validate_execution_definition(
    flow: &automation_flow_entity::Model,
) -> Result<(), AppError> {
    if automation_trigger_events(&flow.trigger_config) == ["button_click"]
        && flow
            .trigger_form_uuid
            .as_deref()
            .is_none_or(|source| source.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "按钮触发自动化必须绑定来源表单".into(),
        ));
    }
    graph::validate_current_protocol(&flow.nodes_json, &flow.trigger_config)?;
    validate_automation_graph(&flow.nodes_json, &flow.edges_json)?;
    validate_flow_node_kinds(&flow.nodes_json, &flow.flow_type)?;
    if flow.flow_type == "process" {
        if automation_trigger_events(&flow.trigger_config) != ["form_submit"] {
            return Err(AppError::BadRequest(
                "process trigger must be form_submit".into(),
            ));
        }
        validate_process_reachable_approval(&flow.nodes_json, &flow.edges_json)?;
        validate_process_human_node_configs(&flow.nodes_json)?;
    } else if automation_trigger_events(&flow.trigger_config)
        .iter()
        .any(|event| event == "form_submit")
    {
        return Err(AppError::BadRequest(
            "trigger flows cannot use form_submit".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn validate_execution_sources<C: ConnectionTrait>(
    db: &C,
    flow: &automation_flow_entity::Model,
) -> Result<(), AppError> {
    get_data::validate_get_nodes(
        db,
        &flow.nodes_json,
        &flow.edges_json,
        flow.trigger_form_uuid.as_deref(),
    )
    .await
}

pub(crate) async fn ensure_no_button_references<C: ConnectionTrait>(
    db: &C,
    flow_uuid: &str,
) -> Result<(), AppError> {
    let row = db.query_one_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,
        "SELECT 1 FROM app_custom_buttons WHERE action_type='run_automation' AND action_config->>'automationId'=$1 LIMIT 1", vec![flow_uuid.into()])).await?;
    if row.is_some() {
        return Err(AppError::BadRequest(
            "自动化已被自定义按钮绑定，请先解除绑定".into(),
        ));
    }
    Ok(())
}
