//! Runtime for approval-process automations.
//!
//! Human-task business rules for the common persistent execution service.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, TransactionTrait,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    infrastructure::entities::{
        automation_flow_entity, automation_flow_version_entity, form_definition_entity,
        iam_user_entity, iam_user_role_entity, workflow_action_entity, workflow_comment_entity,
        workflow_instance_entity, workflow_notification_entity, workflow_task_entity,
    },
    modules::forms::find_form_definition,
    platform::{
        api::ApiResponse, authorization, config::load_notification_settings, error::AppError,
        records::RecordRepository, runtime::AppState,
    },
    shared::success_response,
};

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkflowTaskActionRequest {
    pub(crate) comment: Option<String>,
    #[serde(rename = "cardVersion")]
    pub(crate) card_version: Option<i32>,
    #[serde(rename = "messageId")]
    pub(crate) message_id: Option<String>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkflowExecutionRequest {
    pub(crate) data: Value,
    pub(crate) comment: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTaskListQuery {
    pub(crate) app_id: Option<String>,
    pub(crate) scope: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkflowCommentRequest {
    pub(crate) content: String,
}
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkflowPauseRequest {
    pub(crate) reason: Option<String>,
}

pub(crate) async fn pause_workflow_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<WorkflowPauseRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let latest = latest_workflow_instance(&state, &form_uuid, &record_uuid).await?;
    let txn = state.db.begin().await?;
    let instance = workflow_instance_entity::Entity::find_by_id(latest.id)
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    ensure_current_instance(&txn, &instance).await?;
    if instance.submitter_user_id != Some(user.id) {
        return Err(AppError::Forbidden(
            "only the submitter can pause this workflow".to_string(),
        ));
    }
    if instance.status != "running" {
        return Err(AppError::BadRequest(
            "only running workflows can be paused".to_string(),
        ));
    }
    let now = Utc::now();
    let mut active: workflow_instance_entity::ActiveModel = instance.clone().into();
    active.status = Set("paused".to_string());
    active.paused_by = Set(Some(user.display_name.clone()));
    active.paused_at = Set(Some(now.into()));
    active.pause_reason = Set(payload
        .reason
        .clone()
        .filter(|value| !value.trim().is_empty()));
    active.updated_at = Set(now.into());
    active.update(&txn).await?;
    execution::set_run_state(&txn, instance.id, "paused").await?;
    write_action(
        &txn,
        instance.id,
        None,
        "pause",
        &user.display_name,
        payload.reason,
    )
    .await?;
    let record = RecordRepository::new(&txn)
        .find(&form_uuid, &record_uuid)
        .await?;
    update_record_state(
        &txn,
        &record,
        &user.display_name,
        "reviewing",
        "paused",
        "流程已暂停",
    )
    .await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "流程已暂停",
        json!({ "instanceId": instance.instance_uuid }),
    )))
}

pub(crate) async fn resume_workflow_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let latest = latest_workflow_instance(&state, &form_uuid, &record_uuid).await?;
    let txn = state.db.begin().await?;
    let instance = workflow_instance_entity::Entity::find_by_id(latest.id)
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    ensure_current_instance(&txn, &instance).await?;
    if instance.submitter_user_id != Some(user.id) {
        return Err(AppError::Forbidden(
            "only the submitter can resume this workflow".to_string(),
        ));
    }
    if instance.status != "paused" {
        return Err(AppError::BadRequest(
            "only paused workflows can be resumed".to_string(),
        ));
    }
    let mut flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("process flow not found".into()))?;
    apply_instance_flow_snapshot(&txn, &mut flow, instance.flow_version).await?;
    let mut active: workflow_instance_entity::ActiveModel = instance.clone().into();
    active.status = Set("running".to_string());
    active.paused_by = Set(None);
    active.paused_at = Set(None);
    active.pause_reason = Set(None);
    active.updated_at = Set(Utc::now().into());
    active.update(&txn).await?;
    execution::set_run_state(&txn, instance.id, "queued").await?;
    write_action(&txn, instance.id, None, "resume", &user.display_name, None).await?;
    let record = RecordRepository::new(&txn)
        .find(&form_uuid, &record_uuid)
        .await?;
    update_record_state(
        &txn,
        &record,
        &user.display_name,
        "reviewing",
        "running",
        instance.current_node_key.as_deref().unwrap_or("流程处理中"),
    )
    .await?;
    txn.commit().await?;
    {
        if let Err(error) = execution::resume_queued(&state, &flow, &instance).await {
            fail_instance(&state, &instance, &format!("{error:?}")).await?;
            return Err(error);
        }
    }
    Ok(Json(success_response(
        "流程已恢复",
        json!({ "instanceId": instance.instance_uuid }),
    )))
}

async fn latest_workflow_instance(
    state: &AppState,
    form_uuid: &str,
    record_uuid: &str,
) -> Result<workflow_instance_entity::Model, AppError> {
    workflow_instance_entity::Entity::find()
        .filter(workflow_instance_entity::Column::FormUuid.eq(form_uuid))
        .filter(workflow_instance_entity::Column::RecordUuid.eq(record_uuid))
        .order_by_desc(workflow_instance_entity::Column::StartedAt)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowNotificationResponse {
    pub(crate) id: String, pub(crate) r#type: String, pub(crate) title: String,
    pub(crate) content: String, pub(crate) app_id: Option<String>,
    pub(crate) form_uuid: String, pub(crate) record_uuid: String,
    pub(crate) read_at: Option<String>, pub(crate) created_at: String,
}
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct WorkflowNotificationListResponse {
    pub(crate) unread: usize, pub(crate) items: Vec<WorkflowNotificationResponse>,
}
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowNotificationPreferences { pub(crate) in_app_enabled: bool, pub(crate) poll_interval_seconds: u32 }

pub(crate) async fn list_workflow_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<WorkflowNotificationListResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let items = workflow_notification_entity::Entity::find()
        .filter(workflow_notification_entity::Column::RecipientUserId.eq(user.id))
        .order_by_desc(workflow_notification_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let unread = items.iter().filter(|item| item.read_at.is_none()).count();
    let form_uuids = items
        .iter()
        .map(|item| item.form_uuid.clone())
        .collect::<Vec<_>>();
    let app_ids = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.is_in(form_uuids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|form| (form.form_uuid, form.app_route_app_id))
        .collect::<HashMap<_, _>>();
    Ok(Json(success_response(
        "获取流程通知成功",
        WorkflowNotificationListResponse { unread, items: items.into_iter().map(|item| WorkflowNotificationResponse {
            id: item.notification_uuid, r#type: item.notification_type, title: item.title, content: item.content,
            app_id: app_ids.get(&item.form_uuid).cloned(), form_uuid: item.form_uuid, record_uuid: item.record_uuid,
            read_at: item.read_at.map(|time| time.to_rfc3339()), created_at: item.created_at.to_rfc3339(),
        }).collect() },
    )))
}

pub(crate) async fn get_notification_preferences() -> Json<ApiResponse<WorkflowNotificationPreferences>> {
    let settings = load_notification_settings().unwrap_or_default();
    Json(success_response(
        "notification preferences loaded",
        WorkflowNotificationPreferences { in_app_enabled: settings.in_app_enabled, poll_interval_seconds: settings.poll_interval_seconds },
    ))
}

pub(crate) async fn read_workflow_notification(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(notification_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let notification = workflow_notification_entity::Entity::find()
        .filter(workflow_notification_entity::Column::NotificationUuid.eq(notification_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow notification not found".to_string()))?;
    if notification.recipient_user_id != Some(user.id) {
        return Err(AppError::Forbidden(
            "notification belongs to another user".to_string(),
        ));
    }
    let mut active: workflow_notification_entity::ActiveModel = notification.into();
    active.read_at = Set(Some(Utc::now().into()));
    active.update(&state.db).await?;
    Ok(Json(success_response("流程通知已读", json!({}))))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowCommentResponse {
    pub(crate) id: String,
    pub(crate) author: String,
    pub(crate) content: String,
    pub(crate) created_at: String,
}
impl From<workflow_comment_entity::Model> for WorkflowCommentResponse {
    fn from(comment: workflow_comment_entity::Model) -> Self {
        Self { id: comment.comment_uuid, author: comment.author, content: comment.content, created_at: comment.created_at.to_rfc3339() }
    }
}
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct WorkflowCommentListResponse { pub(crate) items: Vec<WorkflowCommentResponse> }
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowActionResponse {
    pub(crate) action: String, pub(crate) operator: String,
    pub(crate) comment: Option<String>, pub(crate) created_at: String,
}

pub(crate) async fn list_workflow_comments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<WorkflowCommentListResponse>>, AppError> {
    ensure_workflow_record_display_permission(&headers, &state, &form_uuid).await?;
    let comments = workflow_comment_entity::Entity::find()
        .filter(workflow_comment_entity::Column::FormUuid.eq(form_uuid))
        .filter(workflow_comment_entity::Column::RecordUuid.eq(record_uuid))
        .order_by_asc(workflow_comment_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "获取流程评论成功",
        WorkflowCommentListResponse { items: comments.into_iter().map(Into::into).collect() },
    )))
}

pub(crate) async fn create_workflow_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<WorkflowCommentRequest>,
) -> Result<Json<ApiResponse<WorkflowCommentResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    ensure_workflow_form(&definition.form_type)?;
    ensure_workflow_record_display_permission(&headers, &state, &form_uuid).await?;
    RecordRepository::new(&state.db)
        .find(&form_uuid, &record_uuid)
        .await?;
    let content = payload.content.trim();
    if content.is_empty() || content.chars().count() > 2_000 {
        return Err(AppError::BadRequest(
            "comment must contain 1 to 2000 characters".to_string(),
        ));
    }
    let now = Utc::now();
    let comment = workflow_comment_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        comment_uuid: Set(format!(
            "WFC-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        form_uuid: Set(form_uuid),
        record_uuid: Set(record_uuid),
        author_user_id: Set(Some(user.id)),
        author: Set(user.display_name),
        content: Set(content.to_string()),
        created_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "流程评论已发布",
        WorkflowCommentResponse::from(comment),
    )))
}

pub(crate) async fn list_workflow_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WorkflowTaskListQuery>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let scope = query.scope.as_str();
    if !matches!(scope, "todo" | "processed" | "created" | "copied") {
        return Err(AppError::BadRequest(
            "unsupported workflow task scope".to_string(),
        ));
    }

    let mut flows_query = automation_flow_entity::Entity::find()
        .filter(automation_flow_entity::Column::FlowType.eq("process"));
    if let Some(app_id) = query
        .app_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        flows_query = flows_query.filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id));
    }
    let flows = flows_query.all(&state.db).await?;
    let flow_ids = flows.iter().map(|flow| flow.id).collect::<Vec<_>>();
    if flow_ids.is_empty() {
        return Ok(Json(success_response(
            "获取流程任务成功",
            json!({ "items": [] }),
        )));
    }
    let flows_by_id = flows
        .into_iter()
        .map(|flow| (flow.id, flow))
        .collect::<HashMap<_, _>>();

    let instances = if scope == "created" {
        workflow_instance_entity::Entity::find()
            .filter(workflow_instance_entity::Column::ProcessFlowId.is_in(flow_ids))
            .filter(workflow_instance_entity::Column::SubmitterUserId.eq(user.id))
            .order_by_desc(workflow_instance_entity::Column::StartedAt)
            .all(&state.db)
            .await?
    } else {
        let mut task_query = workflow_task_entity::Entity::find()
            .filter(
                workflow_task_entity::Column::InstanceId.in_subquery(
                    workflow_instance_entity::Entity::find()
                        .select_only()
                        .column(workflow_instance_entity::Column::Id)
                        .filter(workflow_instance_entity::Column::ProcessFlowId.is_in(flow_ids))
                        .into_query(),
                ),
            )
            .filter(workflow_task_entity::Column::AssigneeUserId.eq(user.id));
        task_query = match scope {
            "todo" => task_query
                .filter(workflow_task_entity::Column::Status.eq("pending"))
                .filter(workflow_task_entity::Column::TaskType.ne("copy")),
            "processed" => task_query.filter(workflow_task_entity::Column::Status.is_in([
                "approved",
                "rejected",
                "completed",
            ])),
            "copied" => task_query.filter(workflow_task_entity::Column::TaskType.eq("copy")),
            _ => unreachable!(),
        };
        let tasks = task_query
            .order_by_desc(workflow_task_entity::Column::UpdatedAt)
            .all(&state.db)
            .await?;
        let instance_ids = tasks
            .iter()
            .map(|task| task.instance_id)
            .collect::<Vec<_>>();
        let instances_by_id = workflow_instance_entity::Entity::find()
            .filter(workflow_instance_entity::Column::Id.is_in(instance_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|instance| (instance.id, instance))
            .collect::<HashMap<_, _>>();
        let form_names = load_workflow_form_names(&state, instances_by_id.values()).await?;
        let items = tasks.into_iter().filter_map(|task| {
            let instance = instances_by_id.get(&task.instance_id)?;
            if scope == "todo"
                && (!matches!(instance.status.as_str(), "running" | "paused")
                    || (task.branch_token_id.is_none() && instance.current_node_key.as_deref() != Some(task.node_key.as_str())))
            {
                return None;
            }
            let flow = flows_by_id.get(&instance.process_flow_id)?;
            Some(json!({
                "id": task.task_uuid,
                "appId": flow.app_route_app_id,
                "taskType": task.task_type,
                "status": task.status,
                "formUuid": instance.form_uuid,
                "formName": form_names.get(&instance.form_uuid).cloned().unwrap_or_else(|| "审批表单".to_string()),
                "recordUuid": instance.record_uuid,
                "instanceId": instance.instance_uuid,
                "flowName": flow.name,
                "nodeLabel": task.node_label,
                "submitter": instance.submitter,
                "createdAt": task.created_at,
                "updatedAt": task.updated_at,
                "completedAt": task.completed_at,
            }))
        }).collect::<Vec<_>>();
        return Ok(Json(success_response(
            "获取流程任务成功",
            json!({ "items": items }),
        )));
    };

    let form_names = load_workflow_form_names(&state, instances.iter()).await?;
    let items = instances.into_iter().filter_map(|instance| {
        let flow = flows_by_id.get(&instance.process_flow_id)?;
        Some(json!({
            "id": instance.instance_uuid,
            "appId": flow.app_route_app_id,
            "taskType": "created",
            "status": instance.status,
            "formUuid": instance.form_uuid,
            "formName": form_names.get(&instance.form_uuid).cloned().unwrap_or_else(|| "审批表单".to_string()),
            "recordUuid": instance.record_uuid,
            "instanceId": instance.instance_uuid,
            "flowName": flow.name,
            "nodeLabel": instance.current_node_key,
            "submitter": instance.submitter,
            "createdAt": instance.started_at,
            "updatedAt": instance.updated_at,
            "completedAt": instance.completed_at,
        }))
    }).collect::<Vec<_>>();
    Ok(Json(success_response(
        "获取流程任务成功",
        json!({ "items": items }),
    )))
}

async fn load_workflow_form_names<'a>(
    state: &AppState,
    instances: impl Iterator<Item = &'a workflow_instance_entity::Model>,
) -> Result<HashMap<String, String>, AppError> {
    let form_uuids = instances
        .map(|instance| instance.form_uuid.clone())
        .collect::<Vec<_>>();
    Ok(form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.is_in(form_uuids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|form| (form.form_uuid, form.name))
        .collect())
}

pub(crate) async fn submit_workflow_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    ensure_workflow_form(&definition.form_type)?;
    let mut flow = process_flow(&state, &form_uuid).await?;
    if flow.status != "enabled" {
        return Err(AppError::BadRequest(
            "不存在正在启动的流程，请先在流程编排页面启动该流程后再提交".to_string(),
        ));
    }
    let flow_version = flow.current_version;
    apply_instance_flow_snapshot(&state.db, &mut flow, flow_version).await?;
    let txn = state.db.begin().await?;
    let record = RecordRepository::new(&txn)
        .find_for_update(&form_uuid, &record_uuid)
        .await?;
    if record
        .record_data
        .get("workflowApprovalStatus")
        .and_then(Value::as_str)
        != Some("saved")
    {
        return Err(AppError::BadRequest(
            "only saved workflow records can be submitted".to_string(),
        ));
    }
    let now = Utc::now();
    let instance = workflow_instance_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        instance_uuid: Set(format!(
            "WFI-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        form_uuid: Set(form_uuid.clone()),
        record_uuid: Set(record_uuid),
        process_flow_id: Set(flow.id),
        flow_version: Set(flow.current_version),
        status: Set("running".to_string()),
        current_node_key: Set(Some("trigger-1".to_string())),
        submitter: Set(user.display_name.clone()),
        submitter_user_id: Set(Some(user.id)),
        started_at: Set(now.into()),
        completed_at: Set(None),
        paused_by: Set(None),
        paused_at: Set(None),
        pause_reason: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    write_action(&txn, instance.id, None, "submit", &user.display_name, None).await?;
    let updated = update_record_state(
        &txn,
        &record,
        &user.display_name,
        "reviewing",
        "running",
        "表单提交时",
    )
    .await?;
    let run_id = execution::start_in(&txn, &flow, &instance, &updated.record_data).await?;
    txn.commit().await?;
    if let Err(error) =
        crate::modules::automations::execution::drive_execution(&state, run_id).await
    {
        fail_instance(&state, &instance, &format!("{error:?}")).await?;
        return Err(error);
    }
    Ok(Json(success_response(
        "流程已提交",
        json!({ "instanceId": instance.instance_uuid }),
    )))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowRuntimeResponse {
    pub(crate) run_id: Option<String>,
    pub(crate) instance: Option<Value>,
    pub(crate) tasks: Vec<Value>,
    pub(crate) actions: Vec<WorkflowActionResponse>,
}

pub(crate) async fn get_workflow_record_runtime(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<WorkflowRuntimeResponse>>, AppError> {
    ensure_workflow_record_display_permission(&headers, &state, &form_uuid).await?;
    let instance = workflow_instance_entity::Entity::find()
        .filter(workflow_instance_entity::Column::FormUuid.eq(form_uuid))
        .filter(workflow_instance_entity::Column::RecordUuid.eq(record_uuid))
        .order_by_desc(workflow_instance_entity::Column::StartedAt)
        .one(&state.db)
        .await?;
    let Some(instance) = instance else {
        return Ok(Json(success_response(
            "流程运行态为空",
            WorkflowRuntimeResponse {
                run_id: None,
                instance: None,
                tasks: vec![],
                actions: vec![],
            },
        )));
    };
    let tasks = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
        .order_by_asc(workflow_task_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let actions = workflow_action_entity::Entity::find()
        .filter(workflow_action_entity::Column::InstanceId.eq(instance.id))
        .order_by_asc(workflow_action_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let run = crate::infrastructure::entities::automation_run_entity::Entity::find()
        .filter(
            crate::infrastructure::entities::automation_run_entity::Column::WorkflowInstanceId
                .eq(instance.id),
        )
        .one(&state.db)
        .await?;
    Ok(Json(success_response(
        "获取流程运行态成功",
        WorkflowRuntimeResponse {
            run_id: run.map(|run| run.run_uuid),
            instance: Some(json!({ "id": instance.instance_uuid, "status": instance.status, "currentNodeKey": instance.current_node_key, "flowVersion": instance.flow_version, "submitter": instance.submitter, "startedAt": instance.started_at, "completedAt": instance.completed_at })),
            tasks: tasks.into_iter().map(|task| json!({ "id": task.task_uuid, "nodeKey": task.node_key, "nodeLabel": task.node_label, "taskType": task.task_type, "assignee": task.assignee, "status": task.status, "comment": task.comment, "completedBy": task.completed_by, "completedAt": task.completed_at })).collect(),
            actions: actions.into_iter().map(|action| WorkflowActionResponse { action: action.action, operator: action.operator, comment: action.comment, created_at: action.created_at.to_rfc3339() }).collect(),
        },
    )))
}

/// Record detail, comments and history must follow the same form + application
/// visibility boundary as normal form reads, rather than merely accepting a JWT.
async fn ensure_workflow_record_display_permission(
    headers: &HeaderMap,
    state: &AppState,
    form_uuid: &str,
) -> Result<(), AppError> {
    let grants = authorization::grants(headers, state).await?;
    if grants.contains("*") {
        return Ok(());
    }
    let definition = find_form_definition(&state.db, form_uuid).await?;
    if grants.contains(&format!("form:{form_uuid}:display"))
        && grants.contains(&format!("app:{}:display", definition.app_route_app_id))
    {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "form record display permission denied".to_string(),
        ))
    }
}

pub(crate) async fn reverse_workflow_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    ensure_workflow_form(&definition.form_type)?;
    let repository = RecordRepository::new(&state.db);
    let record = repository.find(&form_uuid, &record_uuid).await?;
    if record
        .record_data
        .get("workflowApprovalStatus")
        .and_then(Value::as_str)
        != Some("approved")
    {
        return Err(AppError::BadRequest(
            "only approved workflow records can be reversed".to_string(),
        ));
    }
    let updated = update_record_state(
        &state.db,
        &record,
        &user.display_name,
        "saved",
        "not_started",
        "待提交",
    )
    .await?;
    Ok(Json(success_response(
        "反审成功",
        json!({ "recordId": updated.record_uuid }),
    )))
}

pub(crate) async fn approve_workflow_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowTaskActionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    complete_task(
        state,
        headers,
        task_uuid,
        payload.comment,
        true,
        None,
        payload.card_version,
        payload.message_id,
    )
    .await
}

pub(crate) async fn reject_workflow_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowTaskActionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    complete_task(
        state,
        headers,
        task_uuid,
        payload.comment,
        false,
        None,
        payload.card_version,
        payload.message_id,
    )
    .await
}

pub(crate) async fn complete_workflow_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowExecutionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    complete_task(
        state,
        headers,
        task_uuid,
        payload.comment,
        true,
        Some(payload.data),
        None,
        None,
    )
    .await
}

async fn complete_task(
    state: AppState,
    headers: HeaderMap,
    task_uuid: String,
    comment: Option<String>,
    approved: bool,
    data: Option<Value>,
    card_version: Option<i32>,
    message_id: Option<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let task_lookup = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::TaskUuid.eq(task_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow task not found".to_string()))?;
    let txn = state.db.begin().await?;
    let instance = workflow_instance_entity::Entity::find_by_id(task_lookup.instance_id)
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    let task = workflow_task_entity::Entity::find_by_id(task_lookup.id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow task not found".to_string()))?;
    let mut bound_message_id = None;
    if let Some(message_uuid) = message_id.as_deref() {
        let binding = txn.query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "SELECT b.message_id,b.business_id,b.business_type,b.status,(m.payload_json->>'version')::int AS card_version FROM im_business_message_bindings b JOIN im_messages m ON m.id=b.message_id WHERE m.message_uuid=$1",
            vec![message_uuid.into()],
        )).await?;
        let Some(binding) = binding else {
            return Err(AppError::BadRequest("审批卡片绑定不存在".into()));
        };
        bound_message_id = Some(binding.try_get::<Uuid>("", "message_id")?);
        let business_id: Uuid = binding.try_get("", "business_id")?;
        let business_type: String = binding.try_get("", "business_type")?;
        let status: String = binding.try_get("", "status")?;
        let stored_version: Option<i32> = binding.try_get("", "card_version").ok();
        if business_type != "approval"
            || business_id != task.id
            || status != "active"
            || card_version.is_none()
            || stored_version.is_none()
            || card_version != stored_version
        {
            state.im_metrics.inc("im_approval_action_conflict_count");
            tracing::warn!(userId=%user.id, taskUuid=%task.task_uuid, messageId=%message_uuid, "approval card binding conflict");
            return Err(AppError::BadRequest("审批卡片已失效或版本不匹配".into()));
        }
    }
    if task.status != "pending" {
        state.im_metrics.inc("im_approval_action_conflict_count");
        tracing::info!(userId=%user.id, taskUuid=%task.task_uuid, "approval action already completed");
        return Err(AppError::BadRequest(
            "workflow task is already completed".to_string(),
        ));
    }
    ensure_current_instance(&txn, &instance).await?;
    if task.assignee_user_id != Some(user.id) {
        return Err(AppError::Forbidden(
            "workflow task is assigned to another user".to_string(),
        ));
    }
    if instance.status != "running" || task.branch_token_id.is_none() {
        return Err(AppError::BadRequest(
            "workflow is paused or has advanced from this node".to_string(),
        ));
    }
    let common_run = execution::run_id(&txn, instance.id).await?;
    let row = txn
        .query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "SELECT status FROM automation_flow_runs WHERE id=$1 FOR UPDATE",
            vec![common_run.into()],
        ))
        .await?;
    if !row.is_some_and(|r| {
        r.try_get::<String>("", "status")
            .is_ok_and(|s| matches!(s.as_str(), "running" | "waiting" | "queued"))
    }) {
        return Err(AppError::BadRequest(
            "执行暂停或外部结果待核实，暂不能处理人工任务".into(),
        ));
    }
    let cursor = txn.query_one_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,
        "SELECT 1 FROM automation_execution_tokens WHERE id=$1 AND instance_id=$2 AND node_key=$3 AND status='waiting'",
        vec![task.branch_token_id.unwrap().into(), instance.id.into(), task.node_key.clone().into()])).await?;
    if cursor.is_none() {
        return Err(AppError::BadRequest(
            "workflow task cursor is no longer waiting".into(),
        ));
    }
    if data.is_some() && task.task_type != "execution"
        || data.is_none() && approved && task.task_type != "approval"
    {
        return Err(AppError::BadRequest(
            "task type does not support this action".to_string(),
        ));
    }
    let mut flow = {
        let mut flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id)
            .one(&txn)
            .await?
            .ok_or_else(|| AppError::NotFound("process flow not found".to_string()))?;
        apply_instance_flow_snapshot(&txn, &mut flow, instance.flow_version).await?;
        Some(flow)
    };
    if let Some(patch) = data {
        let flow = flow.as_ref().expect("approved tasks load their flow");
        let required_fields = flow
            .nodes_json
            .as_array()
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("id").and_then(Value::as_str) == Some(task.node_key.as_str())
                })
            })
            .and_then(|node| node.pointer("/data/config/requiredFieldIds"))
            .and_then(Value::as_array);
        let record = RecordRepository::new(&txn)
            .find_for_update(&instance.form_uuid, &instance.record_uuid)
            .await?;
        let next = merge_execution_data(&record.record_data, &patch, required_fields)?;
        RecordRepository::new(&txn)
            .update(&record, next, &user.display_name, Utc::now())
            .await?;
    }
    let now = Utc::now();
    let mut active: workflow_task_entity::ActiveModel = task.clone().into();
    active.status = Set(if !approved {
        "rejected"
    } else if task.task_type == "execution" {
        "completed"
    } else {
        "approved"
    }
    .to_string());
    active.comment = Set(comment.clone());
    active.completed_by = Set(Some(user.display_name.clone()));
    active.completed_at = Set(Some(now.into()));
    active.updated_at = Set(now.into());
    active.update(&txn).await?;
    if let Some(message_id) = bound_message_id {
        txn.execute_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "UPDATE im_business_message_bindings SET status=$2 WHERE message_id=$1",
            vec![
                sea_orm::Value::Uuid(Some(message_id)),
                sea_orm::Value::String(Some(if approved {
                    "approved".into()
                } else {
                    "rejected".into()
                })),
            ],
        ))
        .await?;
    }
    write_action(
        &txn,
        instance.id,
        Some(task.id),
        if !approved {
            "reject"
        } else if task.task_type == "execution" {
            "complete"
        } else {
            "approve"
        },
        &user.display_name,
        comment,
    )
    .await?;
    if !approved {
        execution::complete_human_log(&txn, &task, "rejected", &user.display_name).await?;
        skip_pending_tasks(&txn, &instance, None, "其他审批人已驳回", now, None).await?;
        complete_instance(
            &txn,
            &instance,
            "rejected",
            "rejected",
            "completed",
            "已拒绝",
            &user.display_name,
        )
        .await?;
        enqueue_result_notifications(&txn, &task, &instance, user.id, "你已拒绝该审批任务").await?;
        txn.commit().await?;
        return Ok(Json(success_response(
            "流程已拒绝",
            json!({ "instanceId": instance.instance_uuid }),
        )));
    }
    let flow = flow.take().expect("approved tasks load their flow");
    let approval_mode = flow
        .nodes_json
        .as_array()
        .and_then(|nodes| {
            nodes
                .iter()
                .find(|node| node.get("id").and_then(Value::as_str) == Some(task.node_key.as_str()))
        })
        .and_then(|node| node.pointer("/data/config/approvalMode"))
        .and_then(Value::as_str)
        .unwrap_or("all");
    if task.task_type == "approval" && approval_mode == "any" {
        skip_pending_tasks(
            &txn,
            &instance,
            Some(&task.node_key),
            "其他审批人已同意",
            now,
            task.branch_token_id,
        )
        .await?;
    }
    let mut pending_query = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
        .filter(workflow_task_entity::Column::NodeKey.eq(task.node_key.clone()))
        .filter(workflow_task_entity::Column::Status.eq("pending"));
    if let Some(token) = task.branch_token_id {
        pending_query = pending_query.filter(workflow_task_entity::Column::BranchTokenId.eq(token));
    }
    let pending = pending_query.count(&txn).await?;
    let next_data = if pending == 0 {
        execution::complete_human_log(&txn, &task, "success", &user.display_name).await?;
        let token = task
            .branch_token_id
            .ok_or_else(|| AppError::BadRequest("obsolete workflow task".into()))?;
        let claimed =
            execution::queue_human_completion(&txn, &flow, &instance, token, &task.node_key)
                .await?;
        if !claimed {
            return Err(AppError::BadRequest(
                "workflow has already advanced from this node".to_string(),
            ));
        }
        Some(
            RecordRepository::new(&txn)
                .find(&instance.form_uuid, &instance.record_uuid)
                .await?
                .record_data,
        )
    } else {
        None
    };
    enqueue_result_notifications(
        &txn,
        &task,
        &instance,
        user.id,
        if task.task_type == "execution" {
            "执行任务已完成"
        } else {
            "你已同意该审批任务"
        },
    )
    .await?;
    txn.commit().await?;
    if let Some(data) = next_data {
        let token = task
            .branch_token_id
            .ok_or_else(|| AppError::BadRequest("obsolete workflow task".into()))?;
        let result = execution::resume_branch(&state, &flow, &instance, token, &data).await;
        if let Err(error) = result {
            fail_instance(&state, &instance, &format!("{error:?}")).await?;
            return Err(error);
        }
    }
    Ok(Json(success_response(
        if task.task_type == "execution" {
            "执行任务已完成"
        } else {
            "任务已同意"
        },
        json!({ "instanceId": instance.instance_uuid }),
    )))
}

async fn workflow_result_recipients<C: ConnectionTrait>(
    db: &C,
    task: &workflow_task_entity::Model,
    instance: &workflow_instance_entity::Model,
    operator_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    let mut ids = HashSet::new();
    ids.insert(operator_id);
    if let Some(id) = instance.submitter_user_id {
        ids.insert(id);
    }
    if let Some(id) = task.assignee_user_id {
        ids.insert(id);
    }
    let notifications = workflow_notification_entity::Entity::find()
        .filter(workflow_notification_entity::Column::InstanceId.eq(instance.id))
        .all(db)
        .await?;
    for notice in notifications {
        if let Some(id) = notice.recipient_user_id {
            ids.insert(id);
        }
    }
    let flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id)
        .one(db)
        .await?;
    if let Some(mut flow) = flow {
        apply_instance_flow_snapshot(db, &mut flow, instance.flow_version).await?;
        let node = flow.nodes_json.as_array().and_then(|nodes| {
            nodes
                .iter()
                .find(|node| node.get("id").and_then(Value::as_str) == Some(task.node_key.as_str()))
        });
        for pointer in ["/data/config/assigneeIds", "/data/config/recipientIds"] {
            if let Some(values) = node
                .and_then(|n| n.pointer(pointer))
                .and_then(Value::as_array)
            {
                for value in values.iter().filter_map(Value::as_str) {
                    if let Ok(id) = Uuid::parse_str(value) {
                        ids.insert(id);
                    }
                }
            }
        }
        if let Some(role_ids) = node
            .and_then(|n| n.pointer("/data/config/roleIds"))
            .and_then(Value::as_array)
        {
            let role_recipients = role_assignees_in(db, Some(role_ids)).await?;
            for value in role_recipients {
                if let Ok(id) = Uuid::parse_str(&value) {
                    ids.insert(id);
                }
            }
        }
    }
    let users = crate::infrastructure::entities::iam_user_entity::Entity::find()
        .filter(
            crate::infrastructure::entities::iam_user_entity::Column::Id
                .is_in(ids.iter().copied().collect::<Vec<_>>()),
        )
        .filter(crate::infrastructure::entities::iam_user_entity::Column::Status.eq("active"))
        .all(db)
        .await?;
    let valid = users
        .into_iter()
        .map(|user| user.id)
        .collect::<HashSet<_>>();
    Ok(ids.into_iter().filter(|id| valid.contains(id)).collect())
}

fn merge_execution_data(
    current: &Value,
    patch: &Value,
    required_fields: Option<&Vec<Value>>,
) -> Result<Value, AppError> {
    let changes = patch
        .as_object()
        .ok_or_else(|| AppError::BadRequest("execution data must be an object".to_string()))?;
    let mut next = current.clone();
    let values = next.as_object_mut().ok_or_else(|| {
        AppError::BadRequest("workflow record data must be an object".to_string())
    })?;
    for (key, value) in changes {
        if !matches!(
            key.as_str(),
            "workflowApprovalStatus"
                | "workflowInstanceStatus"
                | "workflowCurrentApprovalNode"
                | "workflowSubmitter"
        ) {
            values.insert(key.clone(), value.clone());
        }
    }
    if let Some(required_fields) = required_fields {
        for field_id in required_fields.iter().filter_map(Value::as_str) {
            let missing = match values.get(field_id) {
                None | Some(Value::Null) => true,
                Some(Value::String(value)) => value.trim().is_empty(),
                Some(Value::Array(values)) => values.is_empty(),
                _ => false,
            };
            if missing {
                return Err(AppError::BadRequest(format!(
                    "required workflow field is empty: {field_id}"
                )));
            }
        }
    }
    Ok(next)
}

pub(crate) async fn skip_pending_tasks<C: ConnectionTrait>(
    db: &C,
    instance: &workflow_instance_entity::Model,
    node_key: Option<&str>,
    reason: &str,
    now: DateTime<Utc>,
    branch_token_id: Option<Uuid>,
) -> Result<(), AppError> {
    let mut query = workflow_task_entity::Entity::update_many()
        .col_expr(workflow_task_entity::Column::Status, Expr::value("skipped"))
        .col_expr(
            workflow_task_entity::Column::Comment,
            Expr::value(Some(reason.to_string())),
        )
        .col_expr(
            workflow_task_entity::Column::CompletedBy,
            Expr::value(Some("系统".to_string())),
        )
        .col_expr(
            workflow_task_entity::Column::CompletedAt,
            Expr::value(Some(now)),
        )
        .col_expr(workflow_task_entity::Column::UpdatedAt, Expr::value(now))
        .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
        .filter(workflow_task_entity::Column::Status.eq("pending"));
    if let Some(node_key) = node_key {
        query = query.filter(workflow_task_entity::Column::NodeKey.eq(node_key));
    }
    if let Some(token) = branch_token_id {
        query = query.filter(workflow_task_entity::Column::BranchTokenId.eq(token));
    }
    query.exec(db).await?;
    Ok(())
}

pub(crate) async fn role_assignees(
    state: &AppState,
    role_ids: Option<&Vec<Value>>,
) -> Result<Vec<String>, AppError> {
    role_assignees_in(&state.db, role_ids).await
}
async fn role_assignees_in<C: ConnectionTrait>(
    db: &C,
    role_ids: Option<&Vec<Value>>,
) -> Result<Vec<String>, AppError> {
    let ids = role_ids
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let bindings = iam_user_role_entity::Entity::find()
        .filter(iam_user_role_entity::Column::RoleId.is_in(ids))
        .all(db)
        .await?;
    let user_ids = bindings
        .into_iter()
        .map(|binding| binding.user_id)
        .collect::<Vec<_>>();
    let users = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::Id.is_in(user_ids))
        .filter(iam_user_entity::Column::Status.eq("active"))
        .all(db)
        .await?;
    Ok(users.into_iter().map(|user| user.id.to_string()).collect())
}
pub(crate) async fn create_task_in<C: ConnectionTrait>(
    db: &C,
    branch_token_id: Option<Uuid>,
    instance: &workflow_instance_entity::Model,
    node_key: &str,
    label: &str,
    task_type: &str,
    assignee: &str,
) -> Result<(), AppError> {
    let now = Utc::now();
    let assignee_user_id = Some(
        Uuid::parse_str(assignee)
            .map_err(|_| AppError::BadRequest("process assignees must be user UUIDs".into()))?,
    );
    let task = workflow_task_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        task_uuid: Set(format!(
            "WFT-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        instance_id: Set(instance.id),
        node_key: Set(node_key.to_string()),
        branch_token_id: Set(branch_token_id),
        node_label: Set(label.to_string()),
        task_type: Set(task_type.to_string()),
        assignee: Set(assignee.to_string()),
        assignee_user_id: Set(assignee_user_id),
        status: Set(if task_type == "copy" {
            "completed"
        } else {
            "pending"
        }
        .to_string()),
        comment: Set(None),
        completed_by: Set(None),
        completed_at: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;
    if !load_notification_settings()
        .unwrap_or_default()
        .in_app_enabled
    {
        return Ok(());
    }
    let notification_type = if task_type == "copy" { "copy" } else { "task" };
    let notification = workflow_notification_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        notification_uuid: Set(format!(
            "WFN-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        recipient_user_id: Set(assignee_user_id),
        recipient: Set(assignee.to_string()),
        form_uuid: Set(instance.form_uuid.clone()),
        record_uuid: Set(instance.record_uuid.clone()),
        instance_id: Set(instance.id),
        task_id: Set(Some(task.id)),
        notification_type: Set(notification_type.to_string()),
        title: Set(if task_type == "copy" {
            "收到流程抄送".to_string()
        } else {
            format!("待处理：{}", label)
        }),
        content: Set(format!("{} 的流程记录已到达 {}", instance.submitter, label)),
        read_at: Set(None),
        created_at: Set(now.into()),
    }
    .insert(db)
    .await?;
    db.execute_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,
        "INSERT INTO workflow_notification_dispatch(notification_id,task_uuid) VALUES($1,$2) ON CONFLICT DO NOTHING",
        vec![notification.id.into(), task.task_uuid.clone().into()])).await?;
    Ok(())
}

async fn enqueue_result_notifications<C: ConnectionTrait>(
    db: &C,
    task: &workflow_task_entity::Model,
    instance: &workflow_instance_entity::Model,
    operator: Uuid,
    content: &str,
) -> Result<(), AppError> {
    let recipients = workflow_result_recipients(db, task, instance, operator).await?;
    for user in recipients {
        let id = Uuid::new_v4();
        workflow_notification_entity::ActiveModel {
            id: Set(id),
            notification_uuid: Set(format!("WFN-{id}")),
            recipient_user_id: Set(Some(user)),
            recipient: Set(user.to_string()),
            form_uuid: Set(instance.form_uuid.clone()),
            record_uuid: Set(instance.record_uuid.clone()),
            instance_id: Set(instance.id),
            task_id: Set(Some(task.id)),
            notification_type: Set("approval_result".into()),
            title: Set("审批结果".into()),
            content: Set(content.into()),
            read_at: Set(None),
            created_at: Set(Utc::now()),
        }
        .insert(db)
        .await?;
        crate::modules::automations::execution::sql(
            db,
            "INSERT INTO workflow_notification_dispatch(notification_id,task_uuid) VALUES($1,$2)",
            vec![id.into(), task.task_uuid.clone().into()],
        )
        .await?;
    }
    Ok(())
}

pub(crate) async fn dispatch_pending_notifications(state: &AppState) -> Result<(), AppError> {
    use sea_orm::{DbBackend, Statement};
    let rows=state.db.query_all_raw(Statement::from_string(DbBackend::Postgres,"SELECT notification_id,task_uuid FROM workflow_notification_dispatch WHERE status='pending' AND (attempts=0 OR updated_at<NOW()-(LEAST(300,attempts*5)*INTERVAL '1 second')) ORDER BY updated_at LIMIT 32".to_string())).await?;
    for row in rows {
        let id: Uuid = row.try_get("", "notification_id")?;
        let Some(n) = workflow_notification_entity::Entity::find_by_id(id)
            .one(&state.db)
            .await?
        else {
            continue;
        };
        let Some(user) = n.recipient_user_id else {
            continue;
        };
        let task_uuid: String = row.try_get("", "task_uuid")?;
        let result = crate::modules::communication::create_system_notification_message(
            state,
            user,
            id,
            &n.notification_uuid,
            &n.title,
            &n.content,
            &n.notification_type,
            n.task_id,
            Some(&task_uuid),
            n.instance_id,
            &n.form_uuid,
            &n.record_uuid,
        )
        .await;
        crate::modules::automations::execution::sql(&state.db,"UPDATE workflow_notification_dispatch SET status=$2,attempts=attempts+1,error_message=$3,updated_at=NOW() WHERE notification_id=$1",
            vec![id.into(),if result.is_ok(){"delivered"}else{"pending"}.into(),result.err().map(|e|format!("{e:?}")).into()]).await?;
    }
    Ok(())
}

pub(crate) async fn execute_human_node(
    db: &sea_orm::DatabaseTransaction,
    _state: &AppState,
    instance: &workflow_instance_entity::Model,
    cursor: &crate::modules::automations::engine::Cursor,
    node: &Value,
) -> Result<Option<Value>, AppError> {
    let kind = node
        .pointer("/data/kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let config = node
        .pointer("/data/config")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let copy = kind == "copy";
    let mode = config
        .get(if copy {
            "recipientMode"
        } else {
            "assigneeMode"
        })
        .and_then(Value::as_str)
        .unwrap_or_default();
    let assignees = if mode == "self" {
        vec![
            instance
                .submitter_user_id
                .ok_or_else(|| AppError::BadRequest("workflow submitter UUID required".into()))?
                .to_string(),
        ]
    } else if mode == "roles" {
        role_assignees_in(db, config.get("roleIds").and_then(Value::as_array)).await?
    } else {
        config
            .get(if copy { "recipientIds" } else { "assigneeIds" })
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    if assignees.is_empty() && !copy {
        return Err(AppError::BadRequest("human node has no assignee".into()));
    }
    let assignees = assignees
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    for assignee in &assignees {
        create_task_in(
            db,
            Some(cursor.id),
            instance,
            &cursor.node,
            node.pointer("/data/label")
                .and_then(Value::as_str)
                .unwrap_or(&cursor.node),
            if copy {
                "copy"
            } else if kind == "approval" {
                "approval"
            } else {
                "execution"
            },
            assignee,
        )
        .await?;
    }
    Ok(if copy {
        Some(json!({"result":"notified","participants":assignees}))
    } else {
        None
    })
}

pub(crate) async fn complete_instance<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    instance: &workflow_instance_entity::Model,
    status: &str,
    approval: &str,
    record_status: &str,
    node: &str,
    operator: &str,
) -> Result<(), AppError> {
    let mut a: workflow_instance_entity::ActiveModel = instance.clone().into();
    let now = Utc::now();
    a.status = Set(status.to_string());
    a.current_node_key = Set(Some(node.to_string()));
    a.completed_at = Set(Some(now.into()));
    a.updated_at = Set(now.into());
    a.update(db).await?;
    let rec = RecordRepository::new(db)
        .find(&instance.form_uuid, &instance.record_uuid)
        .await?;
    update_record_state(db, &rec, operator, approval, record_status, node).await?;
    use crate::infrastructure::entities::automation_run_entity;
    if let Some(run) = automation_run_entity::Entity::find()
        .filter(automation_run_entity::Column::WorkflowInstanceId.eq(instance.id))
        .one(db)
        .await?
    {
        crate::platform::automation_runs::finalize_automation_run(
            db,
            run.id,
            if status == "completed" {
                "success"
            } else {
                status
            },
            None,
        )
        .await?;
        if status != "completed" {
            execution::close_pending_logs(db, run.id, "skipped", node).await?;
            db.execute_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,
                "UPDATE automation_execution_tokens SET status='cancelled',updated_at=NOW() WHERE instance_id=$1 AND status NOT IN ('completed','failed')", vec![instance.id.into()])).await?;
            db.execute_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres,
                "UPDATE im_business_message_bindings SET status='invalidated' WHERE business_type='approval' AND status='active' AND business_id IN (SELECT id FROM workflow_tasks WHERE instance_id=$1 AND status <> 'pending')", vec![instance.id.into()])).await?;
        }
    }
    Ok(())
}
pub(crate) async fn fail_instance(
    state: &AppState,
    instance: &workflow_instance_entity::Model,
    reason: &str,
) -> Result<(), AppError> {
    let txn = state.db.begin().await?;
    let current = workflow_instance_entity::Entity::find_by_id(instance.id)
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    if matches!(current.status.as_str(), "completed" | "rejected" | "failed") {
        return Ok(());
    }
    skip_pending_tasks(&txn, &current, None, "流程执行失败", Utc::now(), None).await?;
    complete_instance(
        &txn,
        &current,
        "failed",
        "reviewing",
        "failed",
        "执行失败",
        "系统",
    )
    .await?;
    use crate::infrastructure::entities::automation_run_entity;
    if let Some(run) = automation_run_entity::Entity::find()
        .filter(automation_run_entity::Column::WorkflowInstanceId.eq(instance.id))
        .one(&txn)
        .await?
    {
        crate::platform::automation_runs::finalize_automation_run(
            &txn,
            run.id,
            "failed",
            Some(reason.into()),
        )
        .await?;
    }
    write_action(
        &txn,
        current.id,
        None,
        "execution_failed",
        "系统",
        Some(reason.into()),
    )
    .await?;
    txn.commit().await?;
    Ok(())
}
pub(crate) async fn update_record_state<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    record: &crate::platform::records::StoredFormRecord,
    operator: &str,
    approval: &str,
    instance_status: &str,
    node: &str,
) -> Result<crate::platform::records::StoredFormRecord, AppError> {
    let mut data = record.record_data.clone();
    let values = data.as_object_mut().ok_or_else(|| {
        AppError::BadRequest("workflow record data must be an object".to_string())
    })?;
    values.insert("workflowApprovalStatus".to_string(), json!(approval));
    values.insert("workflowInstanceStatus".to_string(), json!(instance_status));
    values.insert("workflowCurrentApprovalNode".to_string(), json!(node));
    RecordRepository::new(db)
        .update(record, data, operator, Utc::now())
        .await
}
async fn process_flow(
    state: &AppState,
    form_uuid: &str,
) -> Result<automation_flow_entity::Model, AppError> {
    automation_flow_entity::Entity::find()
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(form_uuid))
        .filter(automation_flow_entity::Column::FlowType.eq("process"))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow process definition not found".to_string()))
}
async fn apply_instance_flow_snapshot<C: ConnectionTrait>(
    db: &C,
    flow: &mut automation_flow_entity::Model,
    version: i32,
) -> Result<(), AppError> {
    let snapshot = automation_flow_version_entity::Entity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow flow version not found".to_string()))?;
    flow.nodes_json = snapshot.nodes_json;
    flow.edges_json = snapshot.edges_json;
    flow.trigger_config = snapshot.trigger_config;
    crate::modules::automations::validate_execution_definition(flow)?;
    crate::modules::automations::validate_execution_sources(db, flow).await?;
    Ok(())
}
fn ensure_workflow_form(form_type: &str) -> Result<(), AppError> {
    if form_type == "workflow" {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "form is not a workflow form".to_string(),
        ))
    }
}
async fn write_action<C: ConnectionTrait>(
    db: &C,
    instance_id: Uuid,
    task_id: Option<Uuid>,
    action: &str,
    operator: &str,
    comment: Option<String>,
) -> Result<(), AppError> {
    workflow_action_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        instance_id: Set(instance_id),
        task_id: Set(task_id),
        action: Set(action.to_string()),
        operator: Set(operator.to_string()),
        comment: Set(comment),
        created_at: Set(Utc::now().into()),
    }
    .insert(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_merges_only_changes_and_validates_node_fields() {
        let current = json!({"first": "A", "second": "", "workflowInstanceStatus": "running"});
        let required = vec![json!("second")];
        assert!(merge_execution_data(&current, &json!({}), Some(&required)).is_err());
        let next = merge_execution_data(
            &current,
            &json!({"second": "B", "workflowInstanceStatus": "completed"}),
            Some(&required),
        )
        .unwrap();
        assert_eq!(next["first"], "A");
        assert_eq!(next["second"], "B");
        assert_eq!(next["workflowInstanceStatus"], "running");
    }
}

pub(crate) mod execution;

async fn ensure_current_instance<C: ConnectionTrait>(
    db: &C,
    instance: &workflow_instance_entity::Model,
) -> Result<(), AppError> {
    if instance.submitter_user_id.is_none() {
        return Err(AppError::BadRequest(
            "旧审批实例不支持处理或恢复，请重新提交新流程".into(),
        ));
    }
    let cursor = db
        .query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "SELECT 1 FROM automation_execution_tokens WHERE instance_id=$1 LIMIT 1",
            vec![instance.id.into()],
        ))
        .await?;
    if cursor.is_none() {
        return Err(AppError::BadRequest(
            "审批实例缺少新执行游标，不能处理或恢复".into(),
        ));
    }
    Ok(())
}
