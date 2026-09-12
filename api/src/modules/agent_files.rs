use crate::{
    modules::agents::find_owned_session,
    platform::{authorization, error::AppError, runtime::AppState},
    shared::success_response,
};
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, HeaderMap, HeaderValue},
    response::Response,
    Json,
};
use chrono::Utc;
use sea_orm::{ConnectionTrait, DbBackend, Statement, Value as SeaValue};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

#[derive(Deserialize)]
pub(crate) struct LinkRequest {
    #[serde(alias = "fileId")]
    pub file_id: Uuid,
    pub role: String,
    #[serde(alias = "messageSeq")]
    pub message_seq: Option<i64>,
    #[serde(alias = "runId")]
    pub run_id: Option<String>,
}

fn root() -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var("YAYA_AGENT_WORKSPACE_ROOT")
            .unwrap_or_else(|_| "../agent/runtime/workspaces".into()),
    )
}
fn seg(v: &str) -> String {
    v.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}
fn workspace(user: &str, agent: &str, session: &str) -> std::path::PathBuf {
    root().join(seg(user)).join(seg(agent)).join(seg(session))
}
fn name(v: &str) -> String {
    std::path::Path::new(v)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("upload")
        .chars()
        .take(255)
        .collect()
}
#[derive(Deserialize)]
pub(crate) struct OutputRequest {
    pub path: String,
    pub name: Option<String>,
    pub mime_type: Option<String>,
}

pub(crate) async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<crate::platform::api::ApiResponse<serde_json::Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let mut field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("file is required".into()))?;
    let original = name(field.file_name().unwrap_or("upload"));
    let mime = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    if matches!(
        std::path::Path::new(&original)
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.to_ascii_lowercase())
            .as_deref(),
        Some("exe" | "dll" | "bat" | "cmd" | "sh" | "ps1")
    ) {
        return Err(AppError::BadRequest("this file type is not allowed".into()));
    }
    let id = Uuid::new_v4();
    let storage_key = id.to_string();
    let dir = workspace(
        &user.id.to_string(),
        &session.agent_id,
        &session.session_uuid,
    );
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(&storage_key);
    let mut file = tokio::fs::File::create(&path).await?;
    let mut size: i64 = 0;
    let mut hasher = Sha256::new();
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        size += chunk.len() as i64;
        if size > 1_073_741_824 {
            return Err(AppError::BadRequest("file exceeds workspace limit".into()));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    file.sync_all().await?;
    let checksum = format!("{:x}", hasher.finalize());
    let duplicate = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id FROM agent_files WHERE session_id=$1 AND owner_user_id=$2 AND kind='input' AND checksum=$3 AND byte_size=$4 LIMIT 1",
            vec![
                SeaValue::Uuid(Some(session.id)),
                SeaValue::Uuid(Some(user.id)),
                SeaValue::String(Some(checksum.clone())),
                SeaValue::BigInt(Some(size)),
            ],
        ))
        .await?
        .is_some();
    if duplicate {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::BadRequest("相同文件已上传到当前会话".into()));
    }
    let now = Utc::now();
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres, "INSERT INTO agent_files (id,session_id,owner_user_id,agent_id,original_name,storage_key,mime_type,byte_size,checksum,kind,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'input',$10)", vec![SeaValue::Uuid(Some(id)),SeaValue::Uuid(Some(session.id)),SeaValue::Uuid(Some(user.id)),SeaValue::String(Some(session.agent_id)),SeaValue::String(Some(original.clone())),SeaValue::String(Some(storage_key)),SeaValue::String(Some(mime.clone())),SeaValue::BigInt(Some(size)),SeaValue::String(Some(checksum.clone())),SeaValue::ChronoDateTimeUtc(Some(now))])).await?;
    Ok(Json(success_response(
        "agent file uploaded",
        serde_json::json!({"id":id,"name":original,"size":size,"mimeType":mime,"checksum":checksum}),
    )))
}

pub(crate) async fn link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<LinkRequest>,
) -> Result<Json<crate::platform::api::ApiResponse<serde_json::Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    if !matches!(
        payload.role.as_str(),
        "user_input" | "assistant_output" | "tool_output"
    ) {
        return Err(AppError::BadRequest("invalid file link role".into()));
    }
    let exists = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 FROM agent_files WHERE id=$1 AND session_id=$2 AND owner_user_id=$3",
            vec![
                SeaValue::Uuid(Some(payload.file_id)),
                SeaValue::Uuid(Some(session.id)),
                SeaValue::Uuid(Some(user.id)),
            ],
        ))
        .await?
        .is_some();
    if !exists {
        return Err(AppError::NotFound("file not found".into()));
    }
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,"INSERT INTO agent_file_links (id,file_id,session_id,message_seq,run_id,role,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",vec![SeaValue::Uuid(Some(Uuid::new_v4())),SeaValue::Uuid(Some(payload.file_id)),SeaValue::Uuid(Some(session.id)),SeaValue::BigInt(payload.message_seq),SeaValue::String(payload.run_id),SeaValue::String(Some(payload.role)),SeaValue::ChronoDateTimeUtc(Some(Utc::now()))])).await?;
    Ok(Json(success_response(
        "agent file linked",
        serde_json::json!({"fileId":payload.file_id}),
    )))
}

pub(crate) async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<crate::platform::api::ApiResponse<Vec<serde_json::Value>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let kind = query.get("kind").cloned();
    let (sql, values) = if let Some(kind) = kind {
        (
            "SELECT id,original_name,storage_key,mime_type,byte_size,checksum,kind,created_at FROM agent_files WHERE session_id=$1 AND owner_user_id=$2 AND kind=$3 AND NOT (kind='output' AND storage_key LIKE '.attachments/%') ORDER BY created_at",
            vec![
                SeaValue::Uuid(Some(session.id)),
                SeaValue::Uuid(Some(user.id)),
                SeaValue::String(Some(kind)),
            ],
        )
    } else {
        (
            "SELECT id,original_name,storage_key,mime_type,byte_size,checksum,kind,created_at FROM agent_files WHERE session_id=$1 AND owner_user_id=$2 AND NOT (kind='output' AND storage_key LIKE '.attachments/%') ORDER BY created_at",
            vec![
                SeaValue::Uuid(Some(session.id)),
                SeaValue::Uuid(Some(user.id)),
            ],
        )
    };
    let rows = state
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?;
      let data: Vec<_> = rows.into_iter().map(|r| serde_json::json!({"id":r.try_get::<Uuid>("","id").unwrap_or_default(),"name":r.try_get::<String>("","original_name").unwrap_or_default(),"storageKey":r.try_get::<String>("","storage_key").unwrap_or_default(),"mimeType":r.try_get::<String>("","mime_type").unwrap_or_default(),"size":r.try_get::<i64>("","byte_size").unwrap_or_default(),"kind":r.try_get::<String>("","kind").unwrap_or_default(),"checksum":r.try_get::<String>("","checksum").unwrap_or_default(),"createdAt":r.try_get::<chrono::DateTime<Utc>>("","created_at").map(|v| v.to_rfc3339()).unwrap_or_default()})).collect();
    Ok(Json(success_response("agent files loaded", data)))
}

pub(crate) async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let id = Uuid::parse_str(&file_id).map_err(|_| AppError::NotFound("file not found".into()))?;
    let row=state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT original_name,mime_type,byte_size,storage_key FROM agent_files WHERE id=$1 AND session_id=$2 AND owner_user_id=$3",vec![SeaValue::Uuid(Some(id)),SeaValue::Uuid(Some(session.id)),SeaValue::Uuid(Some(user.id))])).await?.ok_or_else(||AppError::NotFound("file not found".into()))?;
    let path = workspace(
        &user.id.to_string(),
        &session.agent_id,
        &session.session_uuid,
    )
    .join(row.try_get::<String>("", "storage_key")?);
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::NotFound("stored file not found".into()))?;
    let actual_size = file
        .metadata()
        .await
        .map_err(|_| AppError::NotFound("stored file metadata unavailable".into()))?
        .len();
    if actual_size == 0 {
        return Err(AppError::NotFound("stored file is empty".into()));
    }
    let mime = row.try_get::<String>("", "mime_type")?;
    let name = row.try_get::<String>("", "original_name")?;
    let disposition = content_disposition(&name);
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, mime)
        // Use the size observed from the opened file. A stale or zero DB
        // byte_size must never cause an otherwise valid stream to be framed
        // as an empty HTTP response.
        .header(header::CONTENT_LENGTH, actual_size)
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from_stream(ReaderStream::new(file)))
        .unwrap())
}

/// Build an RFC 6266-compatible disposition without putting non-ASCII bytes
/// directly into an HTTP header. The ASCII filename keeps older clients
/// working while filename* preserves the original UTF-8 name.
fn content_disposition(name: &str) -> HeaderValue {
    let fallback: String = name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-' | ' ') {
                value
            } else {
                '_'
            }
        })
        .collect();
    let fallback = if fallback.trim().is_empty() {
        "download".to_string()
    } else {
        fallback
    };
    let encoded = name
        .as_bytes()
        .iter()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b'-' | b' ') {
                vec![*byte as char]
            } else {
                let hex = format!("%{:02X}", byte);
                hex.chars().collect()
            }
        })
        .collect::<String>();
    HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        fallback.replace('"', "_"),
        encoded
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("attachment; filename=\"download\""))
}

pub(crate) async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, file_id)): Path<(String, String)>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let id = Uuid::parse_str(&file_id).map_err(|_| AppError::NotFound("file not found".into()))?;
    let row=state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT storage_key FROM agent_files WHERE id=$1 AND session_id=$2 AND owner_user_id=$3",vec![SeaValue::Uuid(Some(id)),SeaValue::Uuid(Some(session.id)),SeaValue::Uuid(Some(user.id))])).await?.ok_or_else(||AppError::NotFound("file not found".into()))?;
    let key = row.try_get::<String>("", "storage_key")?;
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM agent_files WHERE id=$1",
            vec![SeaValue::Uuid(Some(id))],
        ))
        .await?;
    let session_workspace = workspace(
        &user.id.to_string(),
        &session.agent_id,
        &session.session_uuid,
    );
    let _ = tokio::fs::remove_file(session_workspace.join(key)).await;
    // The DSH host materializes a tool-readable copy for binary attachments.
    // Remove copies for this id as well when the user deletes the attachment.
    let attachments = session_workspace.join(".attachments");
    if let Ok(mut entries) = tokio::fs::read_dir(&attachments).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == id.to_string() || file_name.starts_with(&format!("{}.", id)) {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub(crate) async fn register_output(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<OutputRequest>,
) -> Result<Json<crate::platform::api::ApiResponse<serde_json::Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let rel = std::path::Path::new(&payload.path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::BadRequest("invalid output path".into()));
    }
    let path = workspace(
        &user.id.to_string(),
        &session.agent_id,
        &session.session_uuid,
    )
    .join(rel);
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| AppError::NotFound("output file not found".into()))?;
    if !meta.is_file() {
        return Err(AppError::BadRequest("output path is not a file".into()));
    }
    let already_input = state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT 1 FROM agent_files WHERE session_id=$1 AND owner_user_id=$2 AND kind='input' AND storage_key=$3",vec![SeaValue::Uuid(Some(session.id)),SeaValue::Uuid(Some(user.id)),SeaValue::String(Some(payload.path.clone()))])).await?.is_some();
    if already_input {
        return Err(AppError::BadRequest(
            "input files cannot be registered as output".into(),
        ));
    }
    let id = Uuid::new_v4();
    let now = Utc::now();
    let display = payload.name.unwrap_or_else(|| name(&payload.path));
    let mime = payload
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".into());
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,"INSERT INTO agent_files (id,session_id,owner_user_id,agent_id,original_name,storage_key,mime_type,byte_size,checksum,kind,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'output',$10) ON CONFLICT (storage_key) DO NOTHING",vec![SeaValue::Uuid(Some(id)),SeaValue::Uuid(Some(session.id)),SeaValue::Uuid(Some(user.id)),SeaValue::String(Some(session.agent_id)),SeaValue::String(Some(display.clone())),SeaValue::String(Some(payload.path)),SeaValue::String(Some(mime)),SeaValue::BigInt(Some(meta.len() as i64)),SeaValue::String(Some("runtime".into())),SeaValue::ChronoDateTimeUtc(Some(now))])).await?;
    Ok(Json(success_response(
        "agent output registered",
        serde_json::json!({"id":id,"name":display,"size":meta.len(),"kind":"output"}),
    )))
}

#[cfg(test)]
mod tests {
    use super::content_disposition;

    #[test]
    fn content_disposition_supports_utf8_names() {
        let value = content_disposition("模板_步骤2_2000套_修复后核验.xlsx");
        let text = value.to_str().expect("header value must be ASCII");
        assert!(text.starts_with("attachment; filename=\""));
        assert!(text.contains(".xlsx\"; filename*=UTF-8''"));
        assert!(text.contains("filename*=UTF-8''"));
        assert!(text.contains("%E6%A8%A1%E6%9D%BF"));
    }
}
