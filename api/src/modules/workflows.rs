//! Runtime for approval-process automations.
//!
//! Process definitions share the automation graph store, but their lifecycle is deliberately
//! separate from trigger automations: a process can stop at a human task and resume later.

use axum::{extract::{Path, State}, http::HeaderMap, Json};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    infrastructure::entities::{
        automation_flow_entity, automation_flow_version_entity, workflow_action_entity, workflow_instance_entity,
        workflow_task_entity,
    },
    modules::{automations, forms::find_form_definition},
    platform::{api::ApiResponse, authorization, error::AppError, records::RecordRepository, runtime::AppState},
    shared::success_response,
};

#[derive(serde::Deserialize)]
pub(crate) struct WorkflowTaskActionRequest {
    pub(crate) comment: Option<String>,
}

pub(crate) async fn submit_workflow_record(
    State(state): State<AppState>, headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    ensure_workflow_form(&definition.form_type)?;
    let repository = RecordRepository::new(&state.db);
    let record = repository.find(&form_uuid, &record_uuid).await?;
    if record.record_data.get("workflowApprovalStatus").and_then(Value::as_str) != Some("saved") {
        return Err(AppError::BadRequest("only saved workflow records can be submitted".to_string()));
    }
    let mut flow = process_flow(&state, &form_uuid).await?;
    let flow_version = flow.current_version;
    apply_instance_flow_snapshot(&state, &mut flow, flow_version).await?;
    let now = Utc::now();
    let instance = workflow_instance_entity::ActiveModel {
        id: Set(Uuid::new_v4()), instance_uuid: Set(format!("WFI-{}", Uuid::new_v4().simple().to_string().to_uppercase())),
        form_uuid: Set(form_uuid.clone()), record_uuid: Set(record_uuid), process_flow_id: Set(flow.id),
        flow_version: Set(flow.current_version), status: Set("running".to_string()), current_node_key: Set(Some("trigger-1".to_string())),
        submitter: Set(user.display_name.clone()), started_at: Set(now.into()), completed_at: Set(None), created_at: Set(now.into()), updated_at: Set(now.into()),
    }.insert(&state.db).await?;
    write_action(&state, instance.id, None, "submit", &user.display_name, None).await?;
    let updated = update_record_state(&state, &record, &user.display_name, "reviewing", "running", "表单提交时").await?;
    advance(&state, &flow, &instance, &updated.record_data).await?;
    Ok(Json(success_response("流程已提交", json!({ "instanceId": instance.instance_uuid }))))
}

pub(crate) async fn get_workflow_record_runtime(
    State(state): State<AppState>, Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let instance = workflow_instance_entity::Entity::find()
        .filter(workflow_instance_entity::Column::FormUuid.eq(form_uuid))
        .filter(workflow_instance_entity::Column::RecordUuid.eq(record_uuid))
        .order_by_desc(workflow_instance_entity::Column::StartedAt)
        .one(&state.db).await?;
    let Some(instance) = instance else { return Ok(Json(success_response("流程运行态为空", json!({ "instance": null, "tasks": [], "actions": [] })))); };
    let tasks = workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(instance.id)).order_by_asc(workflow_task_entity::Column::CreatedAt).all(&state.db).await?;
    let actions = workflow_action_entity::Entity::find().filter(workflow_action_entity::Column::InstanceId.eq(instance.id)).order_by_asc(workflow_action_entity::Column::CreatedAt).all(&state.db).await?;
    Ok(Json(success_response("获取流程运行态成功", json!({
        "instance": { "id": instance.instance_uuid, "status": instance.status, "currentNodeKey": instance.current_node_key, "flowVersion": instance.flow_version, "submitter": instance.submitter, "startedAt": instance.started_at, "completedAt": instance.completed_at },
        "tasks": tasks.into_iter().map(|task| json!({ "id": task.task_uuid, "nodeKey": task.node_key, "nodeLabel": task.node_label, "taskType": task.task_type, "assignee": task.assignee, "status": task.status, "comment": task.comment, "completedBy": task.completed_by, "completedAt": task.completed_at })).collect::<Vec<_>>(),
        "actions": actions.into_iter().map(|action| json!({ "action": action.action, "operator": action.operator, "comment": action.comment, "createdAt": action.created_at })).collect::<Vec<_>>(),
    }))))
}

pub(crate) async fn reverse_workflow_record(
    State(state): State<AppState>, headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    ensure_workflow_form(&definition.form_type)?;
    let repository = RecordRepository::new(&state.db);
    let record = repository.find(&form_uuid, &record_uuid).await?;
    if record.record_data.get("workflowApprovalStatus").and_then(Value::as_str) != Some("approved") {
        return Err(AppError::BadRequest("only approved workflow records can be reversed".to_string()));
    }
    let updated = update_record_state(&state, &record, &user.display_name, "saved", "in_progress", "待提交").await?;
    Ok(Json(success_response("反审成功", json!({ "recordId": updated.record_uuid }))))
}

pub(crate) async fn approve_workflow_task(
    State(state): State<AppState>, headers: HeaderMap, Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowTaskActionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> { complete_task(state, headers, task_uuid, payload.comment, true).await }

pub(crate) async fn reject_workflow_task(
    State(state): State<AppState>, headers: HeaderMap, Path(task_uuid): Path<String>,
    Json(payload): Json<WorkflowTaskActionRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> { complete_task(state, headers, task_uuid, payload.comment, false).await }

async fn complete_task(state: AppState, headers: HeaderMap, task_uuid: String, comment: Option<String>, approved: bool) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let task = workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::TaskUuid.eq(task_uuid)).one(&state.db).await?
        .ok_or_else(|| AppError::NotFound("workflow task not found".to_string()))?;
    if task.status != "pending" { return Err(AppError::BadRequest("workflow task is already completed".to_string())); }
    if task.assignee_user_id.map(|id| id != user.id).unwrap_or(task.assignee != user.display_name) { return Err(AppError::Forbidden("workflow task is assigned to another user".to_string())); }
    let instance = workflow_instance_entity::Entity::find_by_id(task.instance_id).one(&state.db).await?
        .ok_or_else(|| AppError::NotFound("workflow instance not found".to_string()))?;
    let now = Utc::now();
    let mut active: workflow_task_entity::ActiveModel = task.clone().into();
    active.status = Set(if approved { "approved" } else { "rejected" }.to_string()); active.comment = Set(comment.clone()); active.completed_by = Set(Some(user.display_name.clone())); active.completed_at = Set(Some(now.into())); active.updated_at = Set(now.into()); active.update(&state.db).await?;
    write_action(&state, instance.id, Some(task.id), if approved { "approve" } else { "reject" }, &user.display_name, comment).await?;
    let repository = RecordRepository::new(&state.db); let record = repository.find(&instance.form_uuid, &instance.record_uuid).await?;
    if !approved {
        complete_instance(&state, &instance, "rejected", "rejected", "completed", "已拒绝", &user.display_name).await?;
        return Ok(Json(success_response("流程已拒绝", json!({ "instanceId": instance.instance_uuid }))));
    }
    let pending = workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(instance.id)).filter(workflow_task_entity::Column::NodeKey.eq(task.node_key.clone())).filter(workflow_task_entity::Column::Status.eq("pending")).count(&state.db).await?;
    if pending == 0 {
        let mut flow = automation_flow_entity::Entity::find_by_id(instance.process_flow_id).one(&state.db).await?.ok_or_else(|| AppError::NotFound("process flow not found".to_string()))?;
        apply_instance_flow_snapshot(&state, &mut flow, instance.flow_version).await?;
        advance_from(&state, &flow, &instance, &record.record_data, &task.node_key).await?;
    }
    Ok(Json(success_response("任务已同意", json!({ "instanceId": instance.instance_uuid }))))
}

async fn advance(state: &AppState, flow: &automation_flow_entity::Model, instance: &workflow_instance_entity::Model, data: &Value) -> Result<(), AppError> { advance_from(state, flow, instance, data, "trigger-1").await }
async fn advance_from(state: &AppState, flow: &automation_flow_entity::Model, instance: &workflow_instance_entity::Model, data: &Value, node_key: &str) -> Result<(), AppError> {
    let nodes = flow.nodes_json.as_array().cloned().unwrap_or_default(); let edges = flow.edges_json.as_array().cloned().unwrap_or_default();
    let node_by_id = nodes.iter().filter_map(|node| node.get("id").and_then(Value::as_str).map(|id| (id, node))).collect::<HashMap<_, _>>();
    let mut current = next_node(&edges, node_key, None).unwrap_or_else(|| node_key.to_string());
    let mut outputs = HashMap::from([("trigger-1".to_string(), data.clone())]);
    let mut seen = HashSet::new();
    for _ in 0..128 {
        if !seen.insert(current.clone()) { return fail_instance(state, instance, "workflow graph contains a cycle").await; }
        let Some(node) = node_by_id.get(current.as_str()) else { return complete_instance(state, instance, "completed", "approved", "completed", "已结束", "系统").await; };
        let kind = node.pointer("/data/kind").and_then(Value::as_str).unwrap_or("");
        let label = node.pointer("/data/label").and_then(Value::as_str).unwrap_or("流程节点");
        match kind {
            "trigger" => current = next_node(&edges, &current, None).unwrap_or_else(|| return_complete(state, instance)),
            "condition" => current = next_node(&edges, &current, Some(data)).or_else(|| next_node(&edges, &current, None)).unwrap_or_else(|| return_complete(state, instance)),
            "add-data" | "update-data" | "get-one" | "get-many" | "delete-data" | "http-request" => {
                let config = node.pointer("/data/config").cloned().unwrap_or_else(|| json!({}));
                automations::execute_process_automation_node(&state.db, flow, &current, kind, &config, &mut outputs, "系统").await?;
                current = next_node(&edges, &current, None).unwrap_or_else(|| return_complete(state, instance));
            }
            "approval" | "executor" => {
                let assignees = node.pointer("/data/config/assigneeIds").or_else(|| node.pointer("/data/config/assignees")).and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).filter(|v| !v.trim().is_empty()).collect::<Vec<_>>()).unwrap_or_default();
                if assignees.is_empty() { return fail_instance(state, instance, "process node has no assignee").await; }
                for assignee in assignees { create_task(state, instance, &current, label, if kind == "approval" { "approval" } else { "execution" }, assignee).await?; }
                set_instance_node(state, instance, &current).await?;
                let status = if kind == "approval" { "reviewing" } else { "reviewing" };
                update_record_state(state, &RecordRepository::new(&state.db).find(&instance.form_uuid, &instance.record_uuid).await?, "系统", status, "running", label).await?;
                return Ok(());
            }
            "copy" => { for recipient in node.pointer("/data/config/recipientIds").or_else(|| node.pointer("/data/config/recipients")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) { create_task(state, instance, &current, label, "copy", recipient).await?; } current = next_node(&edges, &current, None).unwrap_or_else(|| return_complete(state, instance)); }
            "end" => return complete_instance(state, instance, "completed", "approved", "completed", "已结束", "系统").await,
            _ => return fail_instance(state, instance, "unsupported process node kind").await,
        }
    }
    fail_instance(state, instance, "process graph traversal exceeded limit").await
}
fn return_complete(_state: &AppState, _instance: &workflow_instance_entity::Model) -> String { "__end__".to_string() }
fn next_node(edges: &[Value], source: &str, _data: Option<&Value>) -> Option<String> { edges.iter().find(|edge| edge.get("source").and_then(Value::as_str) == Some(source)).and_then(|edge| edge.get("target")).and_then(Value::as_str).map(ToString::to_string) }
async fn create_task(state: &AppState, instance: &workflow_instance_entity::Model, node_key: &str, label: &str, task_type: &str, assignee: &str) -> Result<(), AppError> { let now=Utc::now(); let assignee_user_id=Uuid::parse_str(assignee).ok(); workflow_task_entity::ActiveModel { id:Set(Uuid::new_v4()), task_uuid:Set(format!("WFT-{}", Uuid::new_v4().simple().to_string().to_uppercase())), instance_id:Set(instance.id), node_key:Set(node_key.to_string()), node_label:Set(label.to_string()), task_type:Set(task_type.to_string()), assignee:Set(assignee.to_string()), assignee_user_id:Set(assignee_user_id), status:Set(if task_type=="copy" {"completed"} else {"pending"}.to_string()), comment:Set(None), completed_by:Set(None), completed_at:Set(None), created_at:Set(now.into()), updated_at:Set(now.into()) }.insert(&state.db).await?; Ok(()) }
async fn set_instance_node(state:&AppState, instance:&workflow_instance_entity::Model, node:&str)->Result<(),AppError>{let mut a:workflow_instance_entity::ActiveModel=instance.clone().into();a.current_node_key=Set(Some(node.to_string()));a.updated_at=Set(Utc::now().into());a.update(&state.db).await?;Ok(())}
async fn complete_instance(state:&AppState,instance:&workflow_instance_entity::Model,status:&str,approval:&str,record_status:&str,node:&str,operator:&str)->Result<(),AppError>{let mut a:workflow_instance_entity::ActiveModel=instance.clone().into();let now=Utc::now();a.status=Set(status.to_string());a.current_node_key=Set(Some(node.to_string()));a.completed_at=Set(Some(now.into()));a.updated_at=Set(now.into());a.update(&state.db).await?;let rec=RecordRepository::new(&state.db).find(&instance.form_uuid,&instance.record_uuid).await?;update_record_state(state,&rec,operator,approval,record_status,node).await?;Ok(())}
async fn fail_instance(state:&AppState,instance:&workflow_instance_entity::Model,_reason:&str)->Result<(),AppError>{complete_instance(state,instance,"failed","reviewing","failed","执行失败","系统").await}
async fn update_record_state(state:&AppState,record:&crate::platform::records::StoredFormRecord,operator:&str,approval:&str,instance_status:&str,node:&str)->Result<crate::platform::records::StoredFormRecord,AppError>{let mut data=record.record_data.clone();let values=data.as_object_mut().ok_or_else(||AppError::BadRequest("workflow record data must be an object".to_string()))?;values.insert("workflowApprovalStatus".to_string(),json!(approval));values.insert("workflowInstanceStatus".to_string(),json!(instance_status));values.insert("workflowCurrentApprovalNode".to_string(),json!(node));RecordRepository::new(&state.db).update(record,data,operator,Utc::now()).await}
async fn process_flow(state:&AppState,form_uuid:&str)->Result<automation_flow_entity::Model,AppError>{automation_flow_entity::Entity::find().filter(automation_flow_entity::Column::TriggerFormUuid.eq(form_uuid)).filter(automation_flow_entity::Column::FlowType.eq("process")).one(&state.db).await?.ok_or_else(||AppError::NotFound("workflow process definition not found".to_string()))}
async fn apply_instance_flow_snapshot(state: &AppState, flow: &mut automation_flow_entity::Model, version: i32) -> Result<(), AppError> {
    let snapshot = automation_flow_version_entity::Entity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(&state.db).await?
        .ok_or_else(|| AppError::NotFound("workflow flow version not found".to_string()))?;
    flow.nodes_json = snapshot.nodes_json;
    flow.edges_json = snapshot.edges_json;
    Ok(())
}
fn ensure_workflow_form(form_type:&str)->Result<(),AppError>{if form_type=="workflow"{Ok(())}else{Err(AppError::BadRequest("form is not a workflow form".to_string()))}}
async fn write_action(state:&AppState,instance_id:Uuid,task_id:Option<Uuid>,action:&str,operator:&str,comment:Option<String>)->Result<(),AppError>{workflow_action_entity::ActiveModel{id:Set(Uuid::new_v4()),instance_id:Set(instance_id),task_id:Set(task_id),action:Set(action.to_string()),operator:Set(operator.to_string()),comment:Set(comment),created_at:Set(Utc::now().into())}.insert(&state.db).await?;Ok(())}
