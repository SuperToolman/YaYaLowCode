use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::infrastructure::entities::agent_session_entity;
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
    pub(crate) context: Option<AgentPageContext>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAgentSessionRequest {
    pub(crate) title: Option<String>,
    pub(crate) is_pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSessionAccessQuery {
    pub(crate) agent_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkbenchSessionsQuery {
    pub(crate) cursor: Option<String>,
    pub(crate) limit: Option<u64>,
    pub(crate) agent_id: Option<String>,
    pub(crate) run_status: Option<String>,
    pub(crate) query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertAgentRuntimeSummaryRequest {
    pub(crate) event_generation: String,
    pub(crate) last_event_seq: i64,
    pub(crate) run_status: String,
    pub(crate) phase: Option<String>,
    pub(crate) last_tool_name: Option<String>,
    pub(crate) last_error: Option<String>,
    pub(crate) pending_approval_count: i32,
    pub(crate) unread_activity_version: i64,
    pub(crate) last_activity_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconcileAgentSessionRequest {
    pub(crate) session_uuid: String,
    pub(crate) parent_session_uuid: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) context: Option<AgentPageContext>,
    pub(crate) title: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAgentTransactionRequest {
    pub(crate) action_type: String,
    pub(crate) payload: Value,
    pub(crate) summary: String,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentSession {
    pub(crate) id: String,
    pub(crate) agent_id: String,
    pub(crate) title: String,
    pub(crate) source: String,
    pub(crate) parent_session_id: Option<String>,
    pub(crate) is_pinned: bool,
    pub(crate) model_provider: Option<String>,
    pub(crate) app_id: Option<String>,
    pub(crate) context: Value,
    pub(crate) status: String,
    pub(crate) archived_at: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentTransaction {
    pub(crate) id: String,
    pub(crate) action_type: String,
    pub(crate) summary: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) expires_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentRuntimeSummary {
    pub(crate) event_generation: String,
    pub(crate) last_event_seq: i64,
    pub(crate) run_status: String,
    pub(crate) phase: Option<String>,
    pub(crate) last_tool_name: Option<String>,
    pub(crate) last_error: Option<String>,
    pub(crate) pending_approval_count: i32,
    pub(crate) unread_activity_version: i64,
    pub(crate) last_activity_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentWorkbenchSession {
    #[serde(flatten)]
    pub(crate) session: ApiAgentSession,
    #[serde(flatten)]
    pub(crate) runtime: ApiAgentRuntimeSummary,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiAgentWorkbenchSessionPage {
    pub(crate) items: Vec<ApiAgentWorkbenchSession>,
    pub(crate) next_cursor: Option<String>,
}

impl From<agent_session_entity::Model> for ApiAgentSession {
    fn from(value: agent_session_entity::Model) -> Self {
        Self {
            id: value.session_uuid,
            agent_id: value.agent_id,
            title: value.title,
            source: value.source,
            parent_session_id: None,
            is_pinned: value.is_pinned,
            model_provider: None,
            app_id: value.app_route_app_id,
            context: value.context_json,
            status: value.status,
            archived_at: value.archived_at.map(format_datetime),
            created_at: format_datetime(value.created_at),
            updated_at: format_datetime(value.updated_at),
        }
    }
}
