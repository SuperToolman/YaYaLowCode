use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, header},
    response::Response,
};
use chrono::Utc;
use sea_orm::{ConnectionTrait, DbBackend, Statement, Value as SeaValue};
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    platform::{authorization, error::AppError, runtime::AppState},
    shared::success_response,
};

const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadedFileResponse {
    file_id: String,
    name: String,
    size: i64,
    mime_type: String,
}

pub(crate) async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<axum::Json<crate::platform::api::ApiResponse<UploadedFileResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let field = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("invalid upload payload: {error}")))?
        .ok_or_else(|| AppError::BadRequest("file is required".to_string()))?;
    let name = sanitize_file_name(field.file_name().unwrap_or("upload")).to_string();
    let mime_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = field
        .bytes()
        .await
        .map_err(|error| AppError::BadRequest(format!("cannot read file: {error}")))?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest("file is empty".to_string()));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::BadRequest(
            "file exceeds the 20 MB limit".to_string(),
        ));
    }

    let id = Uuid::new_v4();
    let date = Utc::now().format("%Y/%m/%d").to_string();
    let storage_key = format!("{date}/{id}");
    let root = std::env::var("YAYA_UPLOAD_DIR").unwrap_or_else(|_| "data/uploads".to_string());
    let path = std::path::PathBuf::from(&root).join(&storage_key);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Server(std::io::Error::other("invalid upload path")))?;
    tokio::fs::create_dir_all(parent).await?;
    let mut target = tokio::fs::File::create(&path).await?;
    target.write_all(&bytes).await?;
    target.flush().await?;

    let now = Utc::now();
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO uploaded_files (id, storage_key, original_name, mime_type, byte_size, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        vec![SeaValue::Uuid(Some(id)), SeaValue::String(Some(storage_key)), SeaValue::String(Some(name.clone())), SeaValue::String(Some(mime_type.clone())), SeaValue::BigInt(Some(bytes.len() as i64)), SeaValue::String(Some(user.id.to_string())), SeaValue::ChronoDateTimeUtc(Some(now))]
    )).await?;
    Ok(axum::Json(success_response(
        "文件上传成功",
        UploadedFileResponse {
            file_id: id.to_string(),
            name,
            size: bytes.len() as i64,
            mime_type,
        },
    )))
}

pub(crate) async fn download_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
) -> Result<Response, AppError> {
    let id =
        Uuid::parse_str(&file_id).map_err(|_| AppError::NotFound("file not found".to_string()))?;
    let row = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT storage_key, original_name, mime_type FROM uploaded_files WHERE id = $1",
            vec![SeaValue::Uuid(Some(id))],
        ))
        .await?
        .ok_or_else(|| AppError::NotFound("file not found".to_string()))?;
    let storage_key: String = row.try_get("", "storage_key")?;
    let name: String = row.try_get("", "original_name")?;
    let mime_type: String = row.try_get("", "mime_type")?;
    let root = std::env::var("YAYA_UPLOAD_DIR").unwrap_or_else(|_| "data/uploads".to_string());
    let bytes = tokio::fs::read(std::path::PathBuf::from(root).join(storage_key))
        .await
        .map_err(|_| AppError::NotFound("stored file not found".to_string()))?;
    let disposition = format!("attachment; filename=\"{}\"", name.replace('"', "_"));
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, mime_type)
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&disposition).unwrap_or(HeaderValue::from_static("attachment")),
        )
        .body(Body::from(bytes))
        .unwrap())
}

fn sanitize_file_name(name: &str) -> String {
    let value = std::path::Path::new(name)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("upload")
        .trim();
    if value.is_empty() {
        "upload".to_string()
    } else {
        value.chars().take(255).collect()
    }
}
