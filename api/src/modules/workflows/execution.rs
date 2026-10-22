//! Workflow business adapter to the common execution service.
use super::*;
use crate::infrastructure::entities::{automation_run_entity, automation_run_node_entity};
use crate::modules::automations::{
    AutomationExecutionContext,
    engine::{self, Cursor, Transition},
    execution::{
        self as common, ExecutionIdentity, ExecutionPolicy, StartExecutionRequest, TriggerSource,
    },
};
use crate::platform::automation_runs::finalize_automation_run_node_log;
use sea_orm::{DatabaseTransaction, DbBackend, Statement};
fn trigger_with_identity(data: &Value, instance: &workflow_instance_entity::Model) -> Value {
    let mut data = data.clone();
    let approval_status = data
        .get("workflowApprovalStatus")
        .and_then(Value::as_str)
        .unwrap_or("reviewing")
        .to_string();
    if let Some(object) = data.as_object_mut() {
        crate::modules::automations::inject_automation_system_fields(
            object,
            &instance.record_uuid,
            None,
            None,
            Some(instance.submitter.clone()),
        );
        object.insert("workflowApprovalStatus".into(), json!(approval_status));
        object.insert("workflowInstanceStatus".into(), json!(instance.status));
        object.insert(
            "workflowCurrentApprovalNode".into(),
            json!(instance.current_node_key),
        );
        object.insert("workflowSubmitter".into(), json!(instance.submitter));
    }
    data
}

pub(super) async fn start_in(
    db: &DatabaseTransaction,
    flow: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
    data: &Value,
) -> Result<Uuid, AppError> {
    let input = trigger_with_identity(data, instance);
    common::start_execution(
        db,
        StartExecutionRequest {
            flow,
            source: TriggerSource {
                button_uuid: None,
                view_uuid: None,
                kind: "submission".into(),
                event: "form_submit".into(),
                event_id: instance.id.to_string(),
                form_uuid: Some(instance.form_uuid.clone()),
                record_uuid: Some(instance.record_uuid.clone()),
            },
            identity: ExecutionIdentity {
                user_id: instance.submitter_user_id,
                display_name: instance.submitter.clone(),
                operator: "系统".into(),
            },
            policy: ExecutionPolicy::Inline,
            input: &input,
            instance_id: Some(instance.id),
            start_node: "trigger-1",
            outputs: None,
            retry_source: None,
            retry_run: None,
        },
    )
    .await
}
pub(super) async fn run_id<C: ConnectionTrait>(db: &C, instance: Uuid) -> Result<Uuid, AppError> {
    Ok(automation_run_entity::Entity::find()
        .filter(automation_run_entity::Column::WorkflowInstanceId.eq(instance))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("workflow run missing".into()))?
        .id)
}
pub(super) async fn set_run_state<C: ConnectionTrait>(
    db: &C,
    instance: Uuid,
    status: &str,
) -> Result<(), AppError> {
    common::sql(db,"UPDATE automation_flow_runs SET status=$2,updated_at=NOW() WHERE workflow_instance_id=$1 AND status IN ('queued','running','waiting','paused')",vec![instance.into(),status.into()]).await?;
    Ok(())
}
pub(crate) async fn complete_human_log<C: ConnectionTrait>(
    db: &C,
    task: &workflow_task_entity::Model,
    status: &str,
    actor: &str,
) -> Result<(), AppError> {
    let Some(token) = task.branch_token_id else {
        return Ok(());
    };
    let logs = automation_run_node_entity::Entity::find()
        .filter(automation_run_node_entity::Column::BranchId.eq(token))
        .filter(automation_run_node_entity::Column::NodeKey.eq(task.node_key.clone()))
        .filter(automation_run_node_entity::Column::Status.eq("waiting"))
        .all(db)
        .await?;
    let tasks = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::BranchTokenId.eq(token))
        .filter(workflow_task_entity::Column::NodeKey.eq(task.node_key.clone()))
        .all(db)
        .await?;
    let output = json!({"actor":actor,"result":status,"tasks":tasks.into_iter().map(|task|json!({"taskId":task.task_uuid,"status":task.status,"comment":task.comment,"participant":task.assignee_user_id,"completedBy":task.completed_by})).collect::<Vec<_>>()});
    crate::modules::automations::execution::sql(db,"UPDATE automation_execution_tokens SET outputs=jsonb_set(outputs,ARRAY[$2],$3) WHERE id=$1",vec![token.into(),task.node_key.clone().into(),output.clone().into()]).await?;
    for log in logs {
        finalize_automation_run_node_log(db, log.id, status, Some(output.clone()), None).await?;
    }
    db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "UPDATE im_business_message_bindings SET status='invalidated' WHERE business_type='approval' AND status='active' AND business_id IN (SELECT id FROM workflow_tasks WHERE branch_token_id=$1 AND node_key=$2 AND status <> 'pending')",
        vec![token.into(), task.node_key.clone().into()])).await?;
    Ok(())
}

pub(crate) async fn queue_human_completion(
    db: &DatabaseTransaction,
    flow: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
    token: Uuid,
    node_key: &str,
) -> Result<bool, AppError> {
    // Lock order matches the driver: common run before token.
    let run = run_id(db, instance.id).await?;
    db.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT id FROM automation_flow_runs WHERE id=$1 FOR UPDATE",
        vec![run.into()],
    ))
    .await?;
    let row=db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT outputs,depth FROM automation_execution_tokens WHERE id=$1 AND instance_id=$2 AND node_key=$3 AND status='waiting' FOR UPDATE",vec![token.into(),instance.id.into(),node_key.into()])).await?;
    let Some(row) = row else { return Ok(false) };
    let data = RecordRepository::new(db)
        .find(&instance.form_uuid, &instance.record_uuid)
        .await?
        .record_data;
    let mut cursor = Cursor {
        id: token,
        node: node_key.into(),
        depth: row.try_get::<i32>("", "depth")? as usize,
        log_id: None,
        parallel_group: None,
        context: AutomationExecutionContext {
            outputs: serde_json::from_value(row.try_get("", "outputs")?)
                .map_err(|_| AppError::BadRequest("invalid outputs".into()))?,
            operator: "系统".into(),
            run_id: Some(run),
        },
    };
    cursor
        .context
        .outputs
        .insert("trigger-1".into(), trigger_with_identity(&data, instance));
    let node = flow
        .nodes_json
        .as_array()
        .into_iter()
        .flatten()
        .find(|n| n["id"].as_str() == Some(node_key))
        .ok_or_else(|| AppError::BadRequest("human node missing".into()))?;
    match engine::transition(flow, node, &cursor.context) {
        Transition::End => {
            cursor.node.clear();
            common::save_token(db, &cursor, "queued").await?;
        }
        Transition::Continue(next) => {
            cursor.node = next;
            common::save_token(db, &cursor, "queued").await?;
        }
        Transition::Split { targets, parallel } => {
            for target in targets {
                common::sql(db,"INSERT INTO automation_execution_tokens(id,run_id,instance_id,parent_token_id,node_key,status,outputs,depth,parallel_group) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8)",vec![Uuid::new_v4().into(),run.into(),instance.id.into(),token.into(),target.into(),json!(cursor.context.outputs).into(),(cursor.depth as i32).into(),parallel.then_some(token).into()]).await?;
            }
            common::save_token(db, &cursor, "completed").await?;
        }
    }
    set_run_state(db, instance.id, "queued").await?;
    Ok(true)
}
pub(super) async fn resume_branch(
    state: &AppState,
    _: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
    _: Uuid,
    _: &Value,
) -> Result<(), AppError> {
    common::drive_execution(state, run_id(&state.db, instance.id).await?).await
}
pub(super) async fn resume_queued(
    state: &AppState,
    _: &automation_flow_entity::Model,
    instance: &workflow_instance_entity::Model,
) -> Result<(), AppError> {
    common::drive_execution(state, run_id(&state.db, instance.id).await?).await
}
pub(super) async fn close_pending_logs<C: ConnectionTrait>(
    db: &C,
    run: Uuid,
    status: &str,
    reason: &str,
) -> Result<(), AppError> {
    use crate::infrastructure::entities::automation_run_node_entity;
    let logs = automation_run_node_entity::Entity::find()
        .filter(automation_run_node_entity::Column::RunId.eq(run))
        .filter(automation_run_node_entity::Column::Status.is_in(["running", "waiting"]))
        .all(db)
        .await?;
    for log in logs {
        crate::platform::automation_runs::finalize_automation_run_node_log(
            db,
            log.id,
            status,
            None,
            Some(reason.into()),
        )
        .await?;
    }
    Ok(())
}
