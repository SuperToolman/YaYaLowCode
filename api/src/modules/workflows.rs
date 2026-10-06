//! Runtime for approval-process automations.
//!
//! Process definitions share the automation graph store, but their lifecycle is deliberately
//! separate from trigger automations: a process can stop at a human task and resume later.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, TransactionTrait,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    infrastructure::entities::{
        automation_flow_entity, automation_flow_version_entity, form_definition_entity,
        workflow_action_entity, workflow_comment_entity, workflow_instance_entity,
        workflow_notification_entity, workflow_task_entity,
    },
    modules::{automations, forms::find_form_definition},
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
    if instance.submitter != user.display_name {
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
    if instance.submitter != user.display_name {
        return Err(AppError::Forbidden(
            "only the submitter can resume this workflow".to_string(),
        ));
    }
    if instance.status != "paused" {
        return Err(AppError::BadRequest(
            "only paused workflows can be resumed".to_string(),
        ));
    }
    let mut active: workflow_instance_entity::ActiveModel = instance.clone().into();
    active.status = Set("running".to_string());
    active.paused_by = Set(None);
    active.paused_at = Set(None);
    active.pause_reason = Set(None);
    active.updated_at = Set(Utc::now().into());
    active.update(&txn).await?;
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

pub(crate) async fn list_workflow_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let items = workflow_notification_entity::Entity::find()
        .filter(
            Condition::any()
                .add(workflow_notification_entity::Column::RecipientUserId.eq(user.id))
                .add(workflow_notification_entity::Column::Recipient.eq(&user.display_name)),
        )
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
        json!({ "unread": unread, "items": items.into_iter().map(|item| json!({ "id": item.notification_uuid, "type": item.notification_type, "title": item.title, "content": item.content, "appId": app_ids.get(&item.form_uuid), "formUuid": item.form_uuid, "recordUuid": item.record_uuid, "readAt": item.read_at, "createdAt": item.created_at })).collect::<Vec<_>>() }),
    )))
}

pub(crate) async fn get_notification_preferences() -> Json<ApiResponse<Value>> {
    let settings = load_notification_settings().unwrap_or_default();
    Json(success_response(
        "notification preferences loaded",
        json!({
            "inAppEnabled": settings.in_app_enabled,
            "pollIntervalSeconds": settings.poll_interval_seconds,
        }),
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
    if notification.recipient_user_id != Some(user.id)
        && notification.recipient != user.display_name
    {
        return Err(AppError::Forbidden(
            "notification belongs to another user".to_string(),
        ));
    }
    let mut active: workflow_notification_entity::ActiveModel = notification.into();
    active.read_at = Set(Some(Utc::now().into()));
    active.update(&state.db).await?;
    Ok(Json(success_response("流程通知已读", json!({}))))
}

pub(crate) async fn list_workflow_comments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    ensure_workflow_record_display_permission(&headers, &state, &form_uuid).await?;
    let comments = workflow_comment_entity::Entity::find()
        .filter(workflow_comment_entity::Column::FormUuid.eq(form_uuid))
        .filter(workflow_comment_entity::Column::RecordUuid.eq(record_uuid))
        .order_by_asc(workflow_comment_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "获取流程评论成功",
        json!({ "items": comments.into_iter().map(|comment| json!({ "id": comment.comment_uuid, "author": comment.author, "content": comment.content, "createdAt": comment.created_at })).collect::<Vec<_>>() }),
    )))
}

pub(crate) async fn create_workflow_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<WorkflowCommentRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
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
        author_user_id: Set(user.id),
        author: Set(user.display_name),
        content: Set(content.to_string()),
        created_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "流程评论已发布",
        json!({ "id": comment.comment_uuid, "author": comment.author, "content": comment.content, "createdAt": comment.created_at }),
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
            .filter(workflow_instance_entity::Column::Submitter.eq(&user.display_name))
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
            .filter(
                Condition::any()
                    .add(workflow_task_entity::Column::AssigneeUserId.eq(user.id))
                    .add(workflow_task_entity::Column::Assignee.eq(&user.display_name)),
            );
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
                    || instance.current_node_key.as_deref() != Some(task.node_key.as_str()))
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
            "workflow definition is disabled; new records cannot be submitted".to_string(),
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
    txn.commit().await?;
    if let Err(error) = advance(&state, &flow, &instance, &updated.record_data).await {
        fail_instance(&state, &instance, "workflow advancement failed").await?;
        return Err(error);
    }
    Ok(Json(success_response(
        "流程已提交",
        json!({ "instanceId": instance.instance_uuid }),
    )))
}

pub(crate) async fn get_workflow_record_runtime(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
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
            json!({ "instance": null, "tasks": [], "actions": [] }),
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
    Ok(Json(success_response(
        "获取流程运行态成功",
        json!({
            "instance": { "id": instance.instance_uuid, "status": instance.status, "currentNodeKey": instance.current_node_key, "flowVersion": instance.flow_version, "submitter": instance.submitter, "startedAt": instance.started_at, "completedAt": instance.completed_at },
            "tasks": tasks.into_iter().map(|task| json!({ "id": task.task_uuid, "nodeKey": task.node_key, "nodeLabel": task.node_label, "taskType": task.task_type, "assignee": task.assignee, "status": task.status, "comment": task.comment, "completedBy": task.completed_by, "completedAt": task.completed_at })).collect::<Vec<_>>(),
            "actions": actions.into_iter().map(|action| json!({ "action": action.action, "operator": action.operator, "comment": action.comment, "createdAt": action.created_at })).collect::<Vec<_>>(),
        }),
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
    complete_task(state, headers, task_uuid, payload.comment, true, None, payload.card_version, payload.message_id).await
}

pub(crate) async fn reject_workflow_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowTaskActionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    complete_task(state, headers, task_uuid, payload.comment, false, None, payload.card_version, payload.message_id).await
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
    if let Some(message_id) = message_id.as_deref() {
        let message_id = Uuid::parse_str(message_id).map_err(|_| AppError::BadRequest("invalid messageId".into()))?;
        let binding = txn.query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "SELECT b.business_id,b.business_type,b.status,(m.payload_json->>'version')::int AS card_version FROM im_business_message_bindings b JOIN im_messages m ON m.id=b.message_id WHERE b.message_id=$1",
            vec![sea_orm::Value::Uuid(Some(message_id))],
        )).await?;
        let Some(binding) = binding else { return Err(AppError::BadRequest("审批卡片绑定不存在".into())); };
        let business_id: Uuid = binding.try_get("", "business_id")?;
        let business_type: String = binding.try_get("", "business_type")?;
        let status: String = binding.try_get("", "status")?;
        let stored_version: Option<i32> = binding.try_get("", "card_version").ok();
        if business_type != "approval" || business_id != task.id || status != "active" || card_version.is_none() || stored_version.is_none() || card_version != stored_version {
            state.im_metrics.inc("im_approval_action_conflict_count");
            tracing::warn!(userId=%user.id, taskUuid=%task.task_uuid, messageId=%message_id, "approval card binding conflict");
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
    if task
        .assignee_user_id
        .map(|id| id != user.id)
        .unwrap_or(task.assignee != user.display_name)
    {
        return Err(AppError::Forbidden(
            "workflow task is assigned to another user".to_string(),
        ));
    }
    if instance.status != "running"
        || instance.current_node_key.as_deref() != Some(task.node_key.as_str())
    {
        return Err(AppError::BadRequest(
            "workflow is paused or has advanced from this node".to_string(),
        ));
    }
    if data.is_some() && task.task_type != "execution"
        || data.is_none() && approved && task.task_type != "approval"
    {
        return Err(AppError::BadRequest(
            "task type does not support this action".to_string(),
        ));
    }
    let mut flow = if approved {
        let mut flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id)
            .one(&txn)
            .await?
            .ok_or_else(|| AppError::NotFound("process flow not found".to_string()))?;
        apply_instance_flow_snapshot(&txn, &mut flow, instance.flow_version).await?;
        Some(flow)
    } else {
        None
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
    if let Some(message_id) = message_id.as_deref().and_then(|value| Uuid::parse_str(value).ok()) {
        txn.execute_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Postgres,
            "UPDATE im_business_message_bindings SET status=$2 WHERE message_id=$1",
            vec![sea_orm::Value::Uuid(Some(message_id)), sea_orm::Value::String(Some(if approved { "approved".into() } else { "rejected".into() }))],
        )).await?;
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
        skip_pending_tasks(
            &txn,
            &instance,
            Some(&task.node_key),
            "其他审批人已驳回",
            now,
        )
        .await?;
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
        txn.commit().await?;
        let recipients = workflow_result_recipients(&state, &task, &instance, user.id).await?;
        for recipient in recipients {
            crate::modules::communication::create_system_notification_message(
                &state, recipient, Uuid::new_v4(), &Uuid::new_v4().to_string(),
                "审批结果", "你已拒绝该审批任务", "approval_result", Some(task.id),
                Some(&task.task_uuid), instance.id, &instance.form_uuid, &instance.record_uuid,
            ).await?;
        }
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
        )
        .await?;
    }
    let pending = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
        .filter(workflow_task_entity::Column::NodeKey.eq(task.node_key.clone()))
        .filter(workflow_task_entity::Column::Status.eq("pending"))
        .count(&txn)
        .await?;
    let next_data = if pending == 0 {
        if !claim_node_advance(&txn, &instance, &task.node_key).await? {
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
    txn.commit().await?;
    if let Some(data) = next_data {
        if let Err(error) = advance_from(&state, &flow, &instance, &data, &task.node_key).await {
            fail_instance(&state, &instance, "workflow advancement failed").await?;
            return Err(error);
        }
    }
    let recipients = workflow_result_recipients(&state, &task, &instance, user.id).await?;
    for recipient in recipients {
        crate::modules::communication::create_system_notification_message(
            &state, recipient, Uuid::new_v4(), &Uuid::new_v4().to_string(),
            "审批结果",
            if task.task_type == "execution" { "执行任务已完成" } else { "你已同意该审批任务" },
            "approval_result", Some(task.id), Some(&task.task_uuid), instance.id,
            &instance.form_uuid, &instance.record_uuid,
        ).await?;
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

async fn workflow_result_recipients(
    state: &AppState,
    task: &workflow_task_entity::Model,
    instance: &workflow_instance_entity::Model,
    operator_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    let mut ids = HashSet::new();
    ids.insert(operator_id);
    if let Some(id) = task.assignee_user_id { ids.insert(id); }
    let notifications = workflow_notification_entity::Entity::find()
        .filter(workflow_notification_entity::Column::InstanceId.eq(instance.id))
        .all(&state.db).await?;
    for notice in notifications {
        if let Some(id) = notice.recipient_user_id { ids.insert(id); }
    }
    let flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id)
        .one(&state.db).await?;
    if let Some(flow) = flow {
        let node = flow.nodes_json.as_array().and_then(|nodes| nodes.iter().find(|node|
            node.get("id").and_then(Value::as_str) == Some(task.node_key.as_str())));
        for pointer in ["/data/config/assigneeIds", "/data/config/assignees", "/data/config/recipientIds", "/data/config/recipients", "/data/config/executorIds", "/data/config/executors"] {
            if let Some(values) = node.and_then(|n| n.pointer(pointer)).and_then(Value::as_array) {
                for value in values.iter().filter_map(Value::as_str) {
                    if let Ok(id) = Uuid::parse_str(value) { ids.insert(id); }
                }
            }
        }
    }
    let users = crate::infrastructure::entities::iam_user_entity::Entity::find()
        .filter(crate::infrastructure::entities::iam_user_entity::Column::Id.is_in(ids.iter().copied().collect::<Vec<_>>()))
        .filter(crate::infrastructure::entities::iam_user_entity::Column::Status.eq("active"))
        .all(&state.db).await?;
    let valid = users.into_iter().map(|user| user.id).collect::<HashSet<_>>();
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

/// Atomically claims the current node before progressing it. This is the optimistic
/// concurrency guard for multi-worker deployments: only one completion request can
/// move an instance past a given node, even when "any" approvers act simultaneously.
async fn claim_node_advance<C: ConnectionTrait>(
    db: &C,
    instance: &workflow_instance_entity::Model,
    node_key: &str,
) -> Result<bool, AppError> {
    let result = workflow_instance_entity::Entity::update_many()
        .col_expr(
            workflow_instance_entity::Column::Status,
            Expr::value("advancing"),
        )
        .col_expr(
            workflow_instance_entity::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(workflow_instance_entity::Column::Id.eq(instance.id))
        .filter(workflow_instance_entity::Column::Status.eq("running"))
        .filter(workflow_instance_entity::Column::CurrentNodeKey.eq(node_key))
        .exec(db)
        .await?;
    Ok(result.rows_affected == 1)
}

async fn skip_pending_tasks<C: ConnectionTrait>(
    db: &C,
    instance: &workflow_instance_entity::Model,
    node_key: Option<&str>,
    reason: &str,
    now: DateTime<Utc>,
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
    query.exec(db).await?;
    Ok(())
}

async fn advance(
    state: &AppState,
    flow: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
    data: &Value,
) -> Result<(), AppError> {
    advance_from(state, flow, instance, data, "trigger-1").await
}
async fn advance_from(
    state: &AppState,
    flow: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
    data: &Value,
    node_key: &str,
) -> Result<(), AppError> {
    let nodes = flow.nodes_json.as_array().cloned().unwrap_or_default();
    let edges = flow.edges_json.as_array().cloned().unwrap_or_default();
    let node_by_id = nodes
        .iter()
        .filter_map(|node| node.get("id").and_then(Value::as_str).map(|id| (id, node)))
        .collect::<HashMap<_, _>>();
    let mut current = next_node(&edges, node_key, None).unwrap_or_else(|| node_key.to_string());
    let mut outputs = HashMap::from([("trigger-1".to_string(), data.clone())]);
    let mut seen = HashSet::new();
    for _ in 0..128 {
        if !seen.insert(current.clone()) {
            return fail_instance(state, instance, "workflow graph contains a cycle").await;
        }
        let Some(node) = node_by_id.get(current.as_str()) else {
            return finish_instance(
                state,
                instance,
                "completed",
                "approved",
                "completed",
                "已结束",
                "系统",
            )
            .await;
        };
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let label = node
            .pointer("/data/label")
            .and_then(Value::as_str)
            .unwrap_or("流程节点");
        match kind {
            "trigger" => {
                current = next_node(&edges, &current, None)
                    .unwrap_or_else(|| return_complete(state, instance))
            }
            "condition" => {
                let next = select_condition_edge(&edges, &current, node, data);
                let Some(next) = next else {
                    return fail_instance(state, instance, "no condition branch matched").await;
                };
                current = next;
            }
            "add-data" | "update-data" | "get-one" | "get-many" | "delete-data"
            | "http-request" => {
                let config = node
                    .pointer("/data/config")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                automations::execute_process_automation_node(
                    &state.db,
                    flow,
                    &current,
                    kind,
                    &config,
                    &mut outputs,
                    "系统",
                )
                .await?;
                current = next_node(&edges, &current, None)
                    .unwrap_or_else(|| return_complete(state, instance));
            }
            "approval" | "executor" => {
                let assignees = node
                    .pointer("/data/config/assigneeIds")
                    .or_else(|| node.pointer("/data/config/assignees"))
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|v| !v.trim().is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if assignees.is_empty() {
                    return fail_instance(state, instance, "process node has no assignee").await;
                }
                for assignee in assignees {
                    create_task(
                        state,
                        instance,
                        &current,
                        label,
                        if kind == "approval" {
                            "approval"
                        } else {
                            "execution"
                        },
                        assignee,
                    )
                    .await?;
                }
                set_instance_node(state, instance, &current).await?;
                let status = if kind == "approval" {
                    "reviewing"
                } else {
                    "reviewing"
                };
                update_record_state(
                    &state.db,
                    &RecordRepository::new(&state.db)
                        .find(&instance.form_uuid, &instance.record_uuid)
                        .await?,
                    "系统",
                    status,
                    "running",
                    label,
                )
                .await?;
                return Ok(());
            }
            "copy" => {
                for recipient in node
                    .pointer("/data/config/recipientIds")
                    .or_else(|| node.pointer("/data/config/recipients"))
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    create_task(state, instance, &current, label, "copy", recipient).await?;
                }
                current = next_node(&edges, &current, None)
                    .unwrap_or_else(|| return_complete(state, instance));
            }
            "end" => {
                return finish_instance(
                    state,
                    instance,
                    "completed",
                    "approved",
                    "completed",
                    "已结束",
                    "系统",
                )
                .await;
            }
            _ => return fail_instance(state, instance, "unsupported process node kind").await,
        }
    }
    fail_instance(state, instance, "process graph traversal exceeded limit").await
}
fn return_complete(_state: &AppState, _instance: &workflow_instance_entity::Model) -> String {
    "__end__".to_string()
}
fn next_node(edges: &[Value], source: &str, _data: Option<&Value>) -> Option<String> {
    edges
        .iter()
        .find(|edge| edge.get("source").and_then(Value::as_str) == Some(source))
        .and_then(|edge| edge.get("target"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn select_condition_edge(
    edges: &[Value],
    source: &str,
    node: &Value,
    data: &Value,
) -> Option<String> {
    let branches = node.pointer("/data/config/branches")?.as_array()?;
    let mut ordered = branches.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|branch| branch.get("priority").and_then(Value::as_i64).unwrap_or(0));
    let branch_id = ordered
        .into_iter()
        .find(|branch| workflow_condition_matches(branch, data))?
        .get("id")?
        .as_str()?;
    let handle = format!("condition-branch:{branch_id}");
    edges
        .iter()
        .find(|edge| {
            edge.get("source").and_then(Value::as_str) == Some(source)
                && edge.get("sourceHandle").and_then(Value::as_str) == Some(handle.as_str())
        })
        .and_then(|edge| edge.get("target"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn workflow_condition_matches(branch: &Value, data: &Value) -> bool {
    match branch.get("mode").and_then(Value::as_str).unwrap_or("all") {
        "all" => true,
        "expression" => branch
            .get("expression")
            .and_then(Value::as_str)
            .map(|expression| simple_condition_expression(expression, data))
            .unwrap_or(false),
        "rules" => branch
            .get("rules")
            .and_then(Value::as_array)
            .map(|rules| workflow_condition_rule_group(rules, None, data))
            .unwrap_or(false),
        _ => false,
    }
}

fn simple_condition_rule(rule: &Value, data: &Value) -> bool {
    let field = rule
        .get("fieldKey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let actual = data.get(field).map(condition_scalar).unwrap_or_default();
    let expected = if rule.get("valueType").and_then(Value::as_str) == Some("field") {
        rule.get("sourceFieldKey")
            .and_then(Value::as_str)
            .and_then(|key| data.get(key))
            .map(condition_scalar)
            .unwrap_or_default()
    } else {
        rule.get("rawValue")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    match rule.get("operator").and_then(Value::as_str).unwrap_or("eq") {
        "hasValue" => !actual.trim().is_empty(),
        "noValue" => actual.trim().is_empty(),
        "neq" => actual != expected,
        "inAny" => expected
            .split(',')
            .map(str::trim)
            .any(|value| value == actual),
        "notInAny" => expected
            .split(',')
            .map(str::trim)
            .all(|value| value != actual),
        _ => actual == expected,
    }
}

fn workflow_condition_rule_group(rules: &[Value], parent_id: Option<&str>, data: &Value) -> bool {
    let siblings = rules
        .iter()
        .filter(|rule| rule.get("parentId").and_then(Value::as_str) == parent_id)
        .collect::<Vec<_>>();
    if siblings.is_empty() {
        return true;
    }
    let logical_operator = siblings[0]
        .get("logicalOperator")
        .and_then(Value::as_str)
        .unwrap_or("and");
    siblings
        .into_iter()
        .enumerate()
        .fold(true, |result, (index, rule)| {
            let rule_id = rule.get("id").and_then(Value::as_str);
            let first_child = rule_id.and_then(|id| {
                rules
                    .iter()
                    .find(|candidate| candidate.get("parentId").and_then(Value::as_str) == Some(id))
            });
            let matches = if rule.get("isGroup").and_then(Value::as_bool) == Some(true) {
                workflow_condition_rule_group(rules, rule_id, data)
            } else if let Some(child) = first_child {
                let children_match = workflow_condition_rule_group(rules, rule_id, data);
                if child.get("logicalOperator").and_then(Value::as_str) == Some("or") {
                    simple_condition_rule(rule, data) || children_match
                } else {
                    simple_condition_rule(rule, data) && children_match
                }
            } else {
                simple_condition_rule(rule, data)
            };
            if index == 0 {
                matches
            } else if logical_operator == "or" {
                result || matches
            } else {
                result && matches
            }
        })
}

fn simple_condition_expression(expression: &str, data: &Value) -> bool {
    let expression = expression.trim();
    let (operator, left, right) = if let Some((left, right)) = expression.split_once("!=") {
        ("!=", left, right)
    } else if let Some((left, right)) = expression.split_once("==") {
        ("==", left, right)
    } else {
        return false;
    };
    let field = left
        .trim()
        .trim_start_matches("{{")
        .trim_end_matches("}}")
        .trim_start_matches("record.");
    let expected = right.trim().trim_matches(|c| c == '\'' || c == '\"');
    let actual = data.get(field).map(condition_scalar).unwrap_or_default();
    if operator == "==" {
        actual == expected
    } else {
        actual != expected
    }
}

fn condition_scalar(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string().trim_matches('\"').to_string())
}
async fn create_task(
    state: &AppState,
    instance: &workflow_instance_entity::Model,
    node_key: &str,
    label: &str,
    task_type: &str,
    assignee: &str,
) -> Result<(), AppError> {
    let now = Utc::now();
    let assignee_user_id = Uuid::parse_str(assignee).ok();
    let task = workflow_task_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        task_uuid: Set(format!(
            "WFT-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        instance_id: Set(instance.id),
        node_key: Set(node_key.to_string()),
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
    .insert(&state.db)
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
    .insert(&state.db)
    .await?;
    if let Some(recipient_user_id) = notification.recipient_user_id {
        crate::modules::communication::create_system_notification_message(
            state,
            recipient_user_id,
            notification.id,
            &notification.notification_uuid,
            &notification.title,
            &notification.content,
            &notification.notification_type,
            notification.task_id,
            notification.task_id.and_then(|id| if id == task.id { Some(task.task_uuid.as_str()) } else { None }),
            notification.instance_id,
            &notification.form_uuid,
            &notification.record_uuid,
        ).await?;
    }
    Ok(())
}
async fn set_instance_node(
    state: &AppState,
    instance: &workflow_instance_entity::Model,
    node: &str,
) -> Result<(), AppError> {
    let mut a: workflow_instance_entity::ActiveModel = instance.clone().into();
    // `claim_node_advance` temporarily marks the instance as advancing. Re-open it
    // only after the next human task has been durably created.
    a.status = Set("running".to_string());
    a.current_node_key = Set(Some(node.to_string()));
    a.updated_at = Set(Utc::now().into());
    a.update(&state.db).await?;
    Ok(())
}
async fn finish_instance(
    state: &AppState,
    instance: &workflow_instance_entity::Model,
    status: &str,
    approval: &str,
    record_status: &str,
    node: &str,
    operator: &str,
) -> Result<(), AppError> {
    let txn = state.db.begin().await?;
    let current = workflow_instance_entity::Entity::find_by_id(instance.id)
        .lock_exclusive()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    complete_instance(
        &txn,
        &current,
        status,
        approval,
        record_status,
        node,
        operator,
    )
    .await?;
    txn.commit().await?;
    Ok(())
}
async fn complete_instance<C: ConnectionTrait>(
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
    Ok(())
}
async fn fail_instance(
    state: &AppState,
    instance: &workflow_instance_entity::Model,
    _reason: &str,
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
    skip_pending_tasks(&txn, &current, None, "流程执行失败", Utc::now()).await?;
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
    txn.commit().await?;
    Ok(())
}
async fn update_record_state<C: ConnectionTrait>(
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

    #[test]
    fn condition_selects_the_first_matching_branch_by_priority() {
        let node = json!({
            "data": { "config": { "branches": [
                { "id": "high", "priority": 1, "mode": "rules", "rules": [{ "id": "r1", "fieldKey": "amount", "operator": "eq", "rawValue": "100" }] },
                { "id": "fallback", "priority": 2, "mode": "all" }
            ] } }
        });
        let edges = vec![
            json!({ "source": "condition-1", "sourceHandle": "condition-branch:high", "target": "approved" }),
            json!({ "source": "condition-1", "sourceHandle": "condition-branch:fallback", "target": "manual" }),
        ];
        assert_eq!(
            select_condition_edge(&edges, "condition-1", &node, &json!({ "amount": 100 })),
            Some("approved".to_string())
        );
        assert_eq!(
            select_condition_edge(&edges, "condition-1", &node, &json!({ "amount": 20 })),
            Some("manual".to_string())
        );
    }

    #[test]
    fn condition_rules_support_nested_or_groups_and_field_values() {
        let branch = json!({
            "mode": "rules",
            "rules": [
                { "id": "group", "isGroup": true, "logicalOperator": "and" },
                { "id": "priority", "parentId": "group", "fieldKey": "priority", "operator": "eq", "rawValue": "high", "logicalOperator": "or" },
                { "id": "same-owner", "parentId": "group", "fieldKey": "owner", "operator": "eq", "valueType": "field", "sourceFieldKey": "approver", "logicalOperator": "or" }
            ]
        });
        assert!(workflow_condition_matches(
            &branch,
            &json!({ "priority": "low", "owner": "u-1", "approver": "u-1" })
        ));
        assert!(!workflow_condition_matches(
            &branch,
            &json!({ "priority": "low", "owner": "u-1", "approver": "u-2" })
        ));
    }

    #[test]
    fn condition_expressions_compare_record_values() {
        let branch =
            json!({ "mode": "expression", "expression": "{{record.status}} == 'approved'" });
        assert!(workflow_condition_matches(
            &branch,
            &json!({ "status": "approved" })
        ));
        assert!(!workflow_condition_matches(
            &branch,
            &json!({ "status": "draft" })
        ));
    }
}
