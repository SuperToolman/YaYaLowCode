//! Persistence for automation execution runs and per-node logs.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
};
use serde_json::Value;
use uuid::Uuid;

use crate::AppError;
use crate::infrastructure::entities::{
    automation_flow_entity, automation_run_entity,
    automation_run_entity::Entity as AutomationRunEntity, automation_run_node_entity,
    automation_run_node_entity::Entity as AutomationRunNodeEntity,
};
use crate::shared::{generate_automation_run_uuid, retry_source_label};

#[derive(Clone, Copy)]
pub(crate) enum RetrySource {
    Flow,
    Node,
}

pub(crate) async fn create_automation_run<C>(
    db: &C,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    retry_source: Option<RetrySource>,
    retry_run_uuid: Option<&str>,
    retry_node_key: Option<&str>,
) -> Result<automation_run_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    let now = Utc::now();
    automation_run_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        run_uuid: Set(generate_automation_run_uuid()),
        flow_id: Set(flow.id),
        flow_version: Set(flow.current_version),
        trigger_event: Set(flow.trigger_event.clone()),
        trigger_payload: Set(trigger_data.clone()),
        status: Set("running".to_string()),
        retry_source: Set(retry_source.map(retry_source_label)),
        retry_run_uuid: Set(retry_run_uuid.map(ToString::to_string)),
        retry_node_key: Set(retry_node_key.map(ToString::to_string)),
        error_message: Set(None),
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn finalize_automation_run<C>(
    db: &C,
    run_id: Uuid,
    status: &str,
    error_message: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::Id.eq(run_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run not found".to_string()))?;
    let now = Utc::now();
    let mut active_model: automation_run_entity::ActiveModel = run.into();
    active_model.status = Set(status.to_string());
    active_model.error_message = Set(error_message);
    active_model.finished_at = Set(Some(now));
    active_model.updated_at = Set(now);
    active_model.update(db).await?;
    Ok(())
}

pub(crate) async fn create_automation_run_node_log<C>(
    db: &C,
    run_id: Uuid,
    node_key: &str,
    node_kind: &str,
    node_label: &str,
    input_json: Value,
) -> Result<Uuid, AppError>
where
    C: ConnectionTrait,
{
    let now = Utc::now();
    let id = Uuid::new_v4();
    automation_run_node_entity::ActiveModel {
        id: Set(id),
        run_id: Set(run_id),
        node_key: Set(node_key.to_string()),
        node_kind: Set(node_kind.to_string()),
        node_label: Set(node_label.to_string()),
        status: Set("running".to_string()),
        input_json: Set(input_json),
        output_json: Set(None),
        error_message: Set(None),
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(id)
}

pub(crate) async fn finalize_automation_run_node_log<C>(
    db: &C,
    log_id: Uuid,
    status: &str,
    output_json: Option<Value>,
    error_message: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let log = AutomationRunNodeEntity::find()
        .filter(automation_run_node_entity::Column::Id.eq(log_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run node log not found".to_string()))?;
    let now = Utc::now();
    let mut active_model: automation_run_node_entity::ActiveModel = log.into();
    active_model.status = Set(status.to_string());
    active_model.output_json = Set(output_json);
    active_model.error_message = Set(error_message);
    active_model.finished_at = Set(Some(now));
    active_model.updated_at = Set(now);
    active_model.update(db).await?;
    Ok(())
}
