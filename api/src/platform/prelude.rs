//! Explicit shared imports for internal business modules.
//!
//! Keeping this boundary outside `main.rs` prevents feature modules from depending on
//! binary-entrypoint imports while avoiding repetitive ORM boilerplate.

pub(crate) use std::collections::{HashMap, HashSet};
pub(crate) use std::future::Future;
pub(crate) use std::pin::Pin;

pub(crate) use axum::Json;
pub(crate) use axum::extract::{Path, Query, State};
pub(crate) use chrono::{DateTime, Utc};
pub(crate) use sea_orm::entity::prelude::*;
pub(crate) use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
pub(crate) use serde::Serialize;
pub(crate) use serde_json::{Value, json};
pub(crate) use tracing::{error, info};
pub(crate) use uuid::Uuid;

pub(crate) use crate::infrastructure::entities::{
    agent_message_entity, agent_message_entity::Entity as AgentMessageEntity, agent_run_entity,
    agent_session_entity, agent_session_entity::Entity as AgentSessionEntity, app_entity,
    app_entity::Entity as AppEntity, app_navigation_entity,
    app_navigation_entity::Entity as AppNavigationEntity, automation_edge_entity,
    automation_edge_entity::Entity as AutomationEdgeEntity, automation_flow_entity,
    automation_flow_entity::Entity as AutomationFlowEntity, automation_flow_version_entity,
    automation_flow_version_entity::Entity as AutomationFlowVersionEntity, automation_node_entity,
    automation_node_entity::Entity as AutomationNodeEntity, automation_run_entity,
    automation_run_entity::Entity as AutomationRunEntity, automation_run_node_entity,
    automation_run_node_entity::Entity as AutomationRunNodeEntity, form_definition_entity,
    form_definition_entity::Entity as FormDefinitionEntity, form_schema_entity,
    form_schema_entity::Entity as FormSchemaEntity,
};
pub(crate) use crate::platform::api::ApiResponse;
pub(crate) use crate::platform::error::AppError;
pub(crate) use crate::platform::runtime::AppState;
