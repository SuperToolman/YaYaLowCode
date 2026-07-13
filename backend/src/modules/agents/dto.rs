use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::entities::{agent_message_entity, agent_session_entity};
use crate::shared::format_date;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPageContext {
    pub(crate) app_id: Option<String>,
    pub(crate) form_uuid: Option<String>,
    pub(crate) automation_id: Option<String>,
    pub(crate) route: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAgentSessionRequest {
    pub(crate) context: Option<AgentPageContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendAgentMessageRequest {
    pub(crate) content: String,
    pub(crate) context: Option<AgentPageContext>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentSession {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) app_id: Option<String>,
    pub(crate) context: Value,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentMessage {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) metadata: Value,
    pub(crate) created_at: String,
}

impl From<agent_session_entity::Model> for ApiAgentSession {
    fn from(value: agent_session_entity::Model) -> Self {
        Self {
            id: value.session_uuid,
            title: value.title,
            app_id: value.app_route_app_id,
            context: value.context_json,
            status: value.status,
            created_at: format_date(value.created_at),
            updated_at: format_date(value.updated_at),
        }
    }
}

impl From<agent_message_entity::Model> for ApiAgentMessage {
    fn from(value: agent_message_entity::Model) -> Self {
        Self {
            id: value.message_uuid,
            role: value.role,
            content: value.content,
            metadata: value.metadata_json,
            created_at: format_date(value.created_at),
        }
    }
}
