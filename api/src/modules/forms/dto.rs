//! Form-definition, schema, and record API models.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::entities::form_definition_entity;
use crate::platform::records::StoredFormRecord;
use crate::shared::format_date;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiFormSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) category: String,
    pub(crate) count: Option<i32>,
    pub(crate) status: String,
    pub(crate) latest_schema_version: i32,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiSchemaPayload {
    pub(crate) form_uuid: String,
    pub(crate) schema: Value,
    pub(crate) version: i32,
    pub(crate) draft_version: i32,
    pub(crate) published_version: i32,
    pub(crate) latest_version: i32,
    pub(crate) published: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiFormVersionSummary {
    pub(crate) version: i32,
    pub(crate) published: bool,
    pub(crate) is_current_draft: bool,
    pub(crate) is_current_published: bool,
    pub(crate) change_log: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiFormRecord {
    pub(crate) id: String,
    pub(crate) form_uuid: String,
    pub(crate) schema_version: i32,
    pub(crate) data: Value,
    pub(crate) created_by: String,
    pub(crate) updated_by: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiFormRecordList {
    pub(crate) items: Vec<ApiFormRecord>,
    pub(crate) total: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveSchemaRequest {
    pub(crate) schema: Value,
    pub(crate) change_log: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RestoreVersionRequest {
    pub(crate) change_log: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateFormRecordRequest {
    pub(crate) data: Value,
    pub(crate) operator: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateFormRecordRequest {
    pub(crate) data: Value,
    pub(crate) operator: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GetSchemaQuery {
    pub(crate) scope: Option<String>,
    pub(crate) version: Option<i32>,
}

impl From<form_definition_entity::Model> for ApiFormSummary {
    fn from(value: form_definition_entity::Model) -> Self {
        Self {
            id: value.form_uuid,
            name: value.name,
            category: "group".to_string(),
            count: None,
            status: value.status,
            latest_schema_version: value.latest_schema_version,
            created_at: format_date(value.created_at),
        }
    }
}

impl From<StoredFormRecord> for ApiFormRecord {
    fn from(value: StoredFormRecord) -> Self {
        Self {
            id: value.record_uuid,
            form_uuid: value.form_uuid,
            schema_version: value.schema_version,
            data: value.record_data,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}
