//! Automation-flow API models and persistence-to-response mappings.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::entities::{
    automation_flow_entity, automation_flow_version_entity, automation_run_node_entity,
};
use crate::shared::{automation_trigger_label, calculate_duration_ms};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationFlow {
    pub(crate) id: String,
    pub(crate) app_id: String,
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) status: String,
    pub(crate) current_version: i32,
    pub(crate) trigger_form_uuid: Option<String>,
    pub(crate) trigger_event: String,
    pub(crate) trigger_label: String,
    pub(crate) nodes_count: usize,
    pub(crate) created_by: String,
    pub(crate) updated_by: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationFlowDetail {
    pub(crate) id: String,
    pub(crate) app_id: String,
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) status: String,
    pub(crate) current_version: i32,
    pub(crate) trigger_form_uuid: Option<String>,
    pub(crate) trigger_event: String,
    pub(crate) trigger_label: String,
    pub(crate) trigger_config: Value,
    pub(crate) nodes: Value,
    pub(crate) edges: Value,
    pub(crate) nodes_count: usize,
    pub(crate) created_by: String,
    pub(crate) updated_by: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationFlowVersionSummary {
    pub(crate) version: i32,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) created_by: String,
    pub(crate) created_at: String,
    pub(crate) change_summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationFlowList {
    pub(crate) items: Vec<ApiAutomationFlow>,
    pub(crate) total: i64,
    pub(crate) enabled: i64,
    pub(crate) paused: i64,
    pub(crate) draft: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationRunNode {
    pub(crate) id: String,
    pub(crate) node_key: String,
    pub(crate) node_kind: String,
    pub(crate) node_label: String,
    pub(crate) status: String,
    pub(crate) input: Value,
    pub(crate) output: Option<Value>,
    pub(crate) error_message: Option<String>,
    pub(crate) started_at: String,
    pub(crate) finished_at: Option<String>,
    pub(crate) duration_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAutomationRun {
    pub(crate) id: String,
    pub(crate) flow_version: i32,
    pub(crate) trigger_event: String,
    pub(crate) trigger_payload: Value,
    pub(crate) status: String,
    pub(crate) retry_source: Option<String>,
    pub(crate) retry_run_uuid: Option<String>,
    pub(crate) retry_node_key: Option<String>,
    pub(crate) error_message: Option<String>,
    pub(crate) started_at: String,
    pub(crate) finished_at: Option<String>,
    pub(crate) duration_ms: Option<i64>,
    pub(crate) nodes: Vec<ApiAutomationRunNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAutomationFlowRequest {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) trigger_form_uuid: Option<String>,
    pub(crate) trigger_event: Option<String>,
    pub(crate) operator: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAutomationFlowRequest {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) trigger_form_uuid: Option<String>,
    pub(crate) trigger_event: Option<String>,
    pub(crate) trigger_config: Option<Value>,
    pub(crate) nodes: Option<Value>,
    pub(crate) edges: Option<Value>,
    pub(crate) change_summary: Option<String>,
    pub(crate) operator: Option<String>,
}

impl From<automation_flow_entity::Model> for ApiAutomationFlow {
    fn from(value: automation_flow_entity::Model) -> Self {
        let nodes_count = value
            .nodes_json
            .as_array()
            .map(|items| items.len())
            .unwrap_or(0);

        Self {
            id: value.flow_uuid,
            app_id: value.app_route_app_id,
            name: value.name,
            description: value.description,
            status: value.status,
            current_version: value.current_version,
            trigger_form_uuid: value.trigger_form_uuid,
            trigger_label: automation_trigger_label(&value.trigger_event).to_string(),
            trigger_event: value.trigger_event,
            nodes_count,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}

impl From<automation_flow_entity::Model> for ApiAutomationFlowDetail {
    fn from(value: automation_flow_entity::Model) -> Self {
        let nodes_count = value
            .nodes_json
            .as_array()
            .map(|items| items.len())
            .unwrap_or(0);

        Self {
            id: value.flow_uuid,
            app_id: value.app_route_app_id,
            name: value.name,
            description: value.description,
            status: value.status,
            current_version: value.current_version,
            trigger_form_uuid: value.trigger_form_uuid,
            trigger_event: value.trigger_event.clone(),
            trigger_label: automation_trigger_label(&value.trigger_event).to_string(),
            trigger_config: value.trigger_config,
            nodes: value.nodes_json,
            edges: value.edges_json,
            nodes_count,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}

impl From<automation_flow_version_entity::Model> for ApiAutomationFlowVersionSummary {
    fn from(value: automation_flow_version_entity::Model) -> Self {
        Self {
            version: value.version,
            name: value.name,
            status: value.status,
            created_by: value.created_by,
            created_at: value.created_at.to_rfc3339(),
            change_summary: value.change_summary,
        }
    }
}

impl From<automation_run_node_entity::Model> for ApiAutomationRunNode {
    fn from(value: automation_run_node_entity::Model) -> Self {
        Self {
            id: value.id.to_string(),
            node_key: value.node_key,
            node_kind: value.node_kind,
            node_label: value.node_label,
            status: value.status,
            input: value.input_json,
            output: value.output_json,
            error_message: value.error_message,
            started_at: value.started_at.to_rfc3339(),
            finished_at: value.finished_at.map(|item| item.to_rfc3339()),
            duration_ms: calculate_duration_ms(value.started_at, value.finished_at),
        }
    }
}
