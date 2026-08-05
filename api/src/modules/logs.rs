use axum::{Json, extract::Query};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::platform::logging;
use crate::platform::prelude::{ApiResponse, AppError};
use crate::shared::success_response;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformLogQuery {
    level: Option<String>,
    limit: Option<u64>,
    offset: Option<u64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformLogResponse {
    id: String,
    occurred_at: DateTime<Utc>,
    level: String,
    target: String,
    message: String,
    fields: serde_json::Value,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformLogListResponse {
    records: Vec<PlatformLogResponse>,
    total_count: usize,
    total_size_bytes: u64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearPlatformLogsResponse {
    cleared_size_bytes: u64,
}

pub(crate) async fn list_platform_logs(
    Query(query): Query<PlatformLogQuery>,
) -> Result<Json<ApiResponse<PlatformLogListResponse>>, AppError> {
    let level = query
        .level
        .as_deref()
        .map(str::trim)
        .filter(|level| !level.is_empty());
    if let Some(level) = level {
        if !matches!(level, "debug" | "info" | "warn" | "error") {
            return Err(AppError::BadRequest("invalid log level".to_string()));
        }
    }
    let limit = query.limit.unwrap_or(200).clamp(1, 500) as usize;
    let offset = query.offset.unwrap_or(0).min(100_000) as usize;
    let (records, total_count) = logging::list_events(level, offset, limit).await;
    Ok(Json(success_response(
        "platform logs loaded",
        PlatformLogListResponse {
            records: records
                .into_iter()
                .map(|record| PlatformLogResponse {
                    id: record.id.to_string(),
                    occurred_at: record.occurred_at,
                    level: record.level,
                    target: record.target,
                    message: record.message,
                    fields: record.fields,
                })
                .collect(),
            total_count,
            total_size_bytes: logging::total_size_bytes().await,
        },
    )))
}

pub(crate) async fn clear_platform_logs()
-> Result<Json<ApiResponse<ClearPlatformLogsResponse>>, AppError> {
    let cleared_size_bytes = logging::clear_events().await.map_err(AppError::from)?;
    Ok(Json(success_response(
        "platform logs cleared",
        ClearPlatformLogsResponse { cleared_size_bytes },
    )))
}
