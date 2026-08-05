use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::infrastructure::entities::{agent_message_entity, agent_session_entity};
use crate::shared::format_datetime;

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPageContext {
    pub(crate) app_id: Option<String>,
    pub(crate) form_uuid: Option<String>,
    pub(crate) automation_id: Option<String>,
    pub(crate) business_id: Option<String>,
    pub(crate) route: Option<String>,
    pub(crate) form_draft_assist: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAgentSessionRequest {
    pub(crate) agent_id: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) context: Option<AgentPageContext>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvailableAgentsQuery {
    pub(crate) app_id: Option<String>,
    pub(crate) business_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAvailableAgent {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAgentSessionRequest {
    pub(crate) title: Option<String>,
    pub(crate) is_pinned: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendAgentMessageRequest {
    pub(crate) content: String,
    pub(crate) context: Option<AgentPageContext>,
    pub(crate) approval_mode: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentSession {
    pub(crate) id: String,
    pub(crate) agent_id: String,
    pub(crate) title: String,
    pub(crate) source: String,
    pub(crate) is_pinned: bool,
    pub(crate) model_provider: Option<String>,
    pub(crate) app_id: Option<String>,
    pub(crate) context: Value,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentMessage {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) metadata: Value,
    pub(crate) run_id: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentRunTrace {
    pub(crate) run_id: String,
    pub(crate) status: String,
    pub(crate) started_at: String,
    pub(crate) completed_at: Option<String>,
    pub(crate) steps: Vec<ApiAgentRunTraceStep>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentRunTraceStep {
    pub(crate) index: i32,
    pub(crate) tool: String,
    pub(crate) arguments: Value,
    pub(crate) summary: Value,
    pub(crate) status: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiPendingAgentAction {
    pub(crate) id: String,
    pub(crate) action_type: String,
    pub(crate) summary: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) expires_at: String,
}

impl From<agent_session_entity::Model> for ApiAgentSession {
    fn from(value: agent_session_entity::Model) -> Self {
        Self {
            id: value.session_uuid,
            agent_id: value.agent_id,
            title: value.title,
            source: value.source,
            is_pinned: value.is_pinned,
            model_provider: None,
            app_id: value.app_route_app_id,
            context: value.context_json,
            status: value.status,
            created_at: format_datetime(value.created_at),
            updated_at: format_datetime(value.updated_at),
        }
    }
}

impl From<agent_message_entity::Model> for ApiAgentMessage {
    fn from(value: agent_message_entity::Model) -> Self {
        let run_id = value
            .metadata_json
            .get("runId")
            .and_then(Value::as_str)
            .map(str::to_string);
        Self {
            id: value.message_uuid,
            role: value.role,
            content: value.content,
            metadata: value.metadata_json,
            run_id,
            created_at: format_datetime(value.created_at),
        }
    }
}
