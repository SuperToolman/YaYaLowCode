use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Employee {
    pub id: String,
    pub title: String,
    pub description: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Session {
    pub id: Uuid,
    pub employee_id: String,
    pub title: String,
    pub tenant_id: Uuid,
    pub owner_user_id: Uuid,
    pub engine: String,
    pub next_seq: i64,
    pub created_at: String,
    pub updated_at: String,
    pub run_status: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub metadata_version: i64,
    #[serde(default)]
    pub deletion_status: Option<String>,
    #[serde(default)]
    pub deletion_error: Option<String>,
    #[serde(default)]
    pub fork_origin: Option<Value>,
    #[serde(default)]
    pub search_hits: Vec<AgentV2SearchHit>,
    #[serde(default)]
    pub token_usage: Option<AgentV2TokenUsage>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2SearchHit {
    pub id: String,
    pub role: String,
    pub excerpt: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Message {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_id: Uuid,
    pub role: String,
    pub parts: Vec<ContentPart>,
    pub created_at: String,
    pub run_status: Option<String>,
    #[serde(default)]
    pub run_progress: Option<AgentV2RunProgress>,
    #[serde(default)]
    pub token_usage: Option<AgentV2TokenUsage>,
    #[serde(default)]
    pub history_snapshot: bool,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2RunProgress {
    pub status: String,
    pub budget_ms: i64,
    pub active_ms: i64,
    pub model_limit: i32,
    pub model_requests: i32,
    pub stage: i32,
    pub pause_reason: Option<String>,
    #[serde(default)]
    pub stop_pending: bool,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Event {
    pub event_id: Uuid,
    pub session_id: Uuid,
    pub seq: i64,
    pub run_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: Value,
    pub protocol_version: i32,
    pub created_at: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Employees {
    pub items: Vec<AgentV2Employee>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Sessions {
    pub items: Vec<AgentV2Session>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Messages {
    pub items: Vec<AgentV2Message>,
    pub next_before: Option<String>,
    pub event_cursor: Option<i64>,
    pub events: Option<Vec<AgentV2Event>>,
    #[serde(default)]
    pub token_usage: Option<AgentV2TokenUsage>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub reported_requests: i64,
    pub model_requests: i64,
    pub unreported_requests: i64,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentV2CommandResult {
    pub command_id: Uuid,
    pub run_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text {
        text: String,
    },
    Image {
        #[serde(rename = "fileId")]
        file_id: Uuid,
    },
    File {
        #[serde(rename = "fileId")]
        file_id: Uuid,
    },
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSession {
    pub employee_id: String,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Prompt {
        #[serde(rename = "clientCommandId")]
        client_command_id: Uuid,
        parts: Vec<ContentPart>,
    },
    Confirm {
        #[serde(rename = "clientCommandId")]
        client_command_id: Uuid,
        #[serde(rename = "confirmationId")]
        confirmation_id: Uuid,
        approve: bool,
    },
    Resume {
        #[serde(rename = "clientCommandId")]
        client_command_id: Uuid,
        #[serde(rename = "runId")]
        run_id: Uuid,
    },
    Cancel {
        #[serde(rename = "clientCommandId")]
        client_command_id: Uuid,
    },
}

impl Command {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Prompt {
                client_command_id, ..
            }
            | Self::Confirm {
                client_command_id, ..
            }
            | Self::Resume {
                client_command_id, ..
            }
            | Self::Cancel { client_command_id } => *client_command_id,
        }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Self::Prompt { parts, .. } = self {
            if parts.is_empty() || parts.len() > 32 {
                return Err("message must contain 1 to 32 parts");
            }
            let mut size = 0;
            for part in parts {
                match part {
                    ContentPart::Text { text } => size += text.len(),
                    ContentPart::Image { .. } | ContentPart::File { .. } => {}
                }
            }
            if size > 65536
                || !parts
                    .iter()
                    .any(|p| !matches!(p, ContentPart::Text { text } if text.trim().is_empty()))
            {
                return Err("message text must contain 1 to 65536 bytes");
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Scope {
    pub tenant_id: Uuid,
    pub user_id: Uuid,
}

pub fn employee_allowed(grants: &HashSet<String>, employee: &str) -> bool {
    grants.contains("*")
        || (grants.contains("agent.window") && grants.contains(&format!("agent:{employee}:use")))
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TranscriptItem {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reasoning: String,
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Uuid>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Checkpoint {
    pub messages: Vec<TranscriptItem>,
    pub pending_calls: Vec<ToolCall>,
    pub step: i32,
    #[serde(default)]
    pub progress_fingerprints: Vec<String>,
    #[serde(default)]
    pub progress_warning: Option<String>,
    #[serde(default)]
    pub progress_warning_seen: bool,
}

#[derive(Clone, Deserialize)]
pub struct ExecutionContext {
    #[serde(default)]
    pub knowledge_scope: serde_json::Value,
    #[serde(default)]
    pub knowledge_user_id: String,
    #[serde(default)]
    pub development_contract_hash: String,
    pub employee_id: String,
    pub system_prompt: String,
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub grants: Vec<String>,
    #[serde(default)]
    pub action_grants: Vec<String>,
    #[serde(default)]
    pub employee_version: String,
    /// Immutable resource references and hashes only; never Skill configuration values.
    #[serde(default)]
    pub skill_resources: serde_json::Value,
    pub model: ModelRoute,
}

// Deliberately no Debug/Serialize: credentials must not enter events or logs.
#[derive(Clone, Deserialize)]
pub struct ModelRoute {
    pub id: String,
    pub api_base_url: String,
    pub api_key: String,
    pub chat_model: String,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default)]
    pub reasoning_protocol: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub reasoning_disabled: bool,

}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn employee_use_is_not_implied_by_window() {
        let mut grants = HashSet::from(["agent.window".into()]);
        assert!(!employee_allowed(&grants, "a"));
        grants.insert("agent:a:use".into());
        assert!(employee_allowed(&grants, "a"));
        assert!(!employee_allowed(&grants, "b"));
        assert!(employee_allowed(&HashSet::from(["*".into()]), "b"));
    }
    #[test]
    fn rejects_empty_messages() {
        for parts in [vec![], vec![ContentPart::Text { text: " ".into() }]] {
            assert!(
                Command::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts
                }
                .validate()
                .is_err()
            );
        }
    }
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Confirmation {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_id: Uuid,
    pub call_id: String,
    pub tool_name: String,
    pub preview: Value,
    pub status: String,
    pub expires_at: String,
    #[serde(default)]
    pub result: Option<Value>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentV2Confirmations {
    pub items: Vec<AgentV2Confirmation>,
}
