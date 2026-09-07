//! Tenant/user-scoped model routes. AI employee templates remain operation-owned;
//! each user controls their own encrypted provider route within their tenant.

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, OsRng, rand_core::RngCore},
};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::{Json, http::StatusCode};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::platform::authorization;
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelRouteResponse {
    pub id: String,
    pub name: String,
    pub api_base_url: String,
    pub default_chat_model: String,
    pub models: Vec<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub api_key_configured: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelRouteRequest {
    pub name: String,
    pub api_base_url: String,
    pub api_key: Option<String>,
    pub default_chat_model: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeModelRoute {
    pub id: String,
    pub api_base_url: String,
    pub api_key: String,
    pub chat_model: String,
}

fn default_enabled() -> bool {
    true
}

pub(crate) async fn list_model_routes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ModelRouteResponse>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user)
        .await?
        .to_string();
    Ok(Json(success_response(
        "model routes loaded",
        list(&state, &tenant, user.id.to_string()).await?,
    )))
}

pub(crate) async fn create_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ModelRouteRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ModelRouteResponse>>), AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user)
        .await?
        .to_string();
    validate(&payload, true)?;
    let rows = list_raw(&state, &tenant, &user.id.to_string()).await?;
    let is_default = payload.is_default || rows.is_empty();
    if is_default {
        clear_default(&state, &tenant, None).await?;
    }
    let id = format!("model-{}", Uuid::new_v4().simple());
    execute(&state, "INSERT INTO byom_model_routes (id, tenant_id, created_by_user_id, name, api_base_url, encrypted_api_key, default_chat_model, models, enabled, is_default) VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10)", vec![
        value(&id), value(&tenant), value(&user.id.to_string()), value(payload.name.trim()), value(payload.api_base_url.trim().trim_end_matches('/')), value(&encrypt(payload.api_key.as_deref().unwrap_or_default())?), value(payload.default_chat_model.trim()), value(&serde_json::to_string(&models(&payload)) .map_err(|e| AppError::BadRequest(e.to_string()))?), bool_value(payload.enabled), bool_value(is_default),
    ]).await?;
    let route = list_raw(&state, &tenant, &user.id.to_string())
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .expect("inserted route must be readable");
    Ok((
        StatusCode::CREATED,
        Json(success_response("model route created", route.public())),
    ))
}

pub(crate) async fn update_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ModelRouteRequest>,
) -> Result<Json<ApiResponse<ModelRouteResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user)
        .await?
        .to_string();
    validate(&payload, false)?;
    let current = list_raw(&state, &tenant, &user.id.to_string())
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("model route not found".to_string()))?;
    if payload.is_default {
        clear_default(&state, &tenant, Some(&id)).await?;
    }
    let encrypted_key = match payload
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        Some(key) => encrypt(key)?,
        None => current.encrypted_api_key,
    };
    execute(&state, "UPDATE byom_model_routes SET name = $1, api_base_url = $2, encrypted_api_key = $3, default_chat_model = $4, models = $5::jsonb, enabled = $6, is_default = $7, updated_at = now() WHERE id = $8 AND tenant_id = $9::uuid AND created_by_user_id = $10::uuid", vec![
        value(payload.name.trim()), value(payload.api_base_url.trim().trim_end_matches('/')), value(&encrypted_key), value(payload.default_chat_model.trim()), value(&serde_json::to_string(&models(&payload)).map_err(|e| AppError::BadRequest(e.to_string()))?), bool_value(payload.enabled), bool_value(payload.is_default), value(&id), value(&tenant), value(&user.id.to_string()),
    ]).await?;
    let route = list_raw(&state, &tenant, &user.id.to_string())
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .expect("updated route must be readable");
    Ok(Json(success_response(
        "model route updated",
        route.public(),
    )))
}

pub(crate) async fn delete_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user)
        .await?
        .to_string();
    execute(&state, "DELETE FROM byom_model_routes WHERE id = $1 AND tenant_id = $2::uuid AND created_by_user_id = $3::uuid", vec![value(&id), value(&tenant), value(&user.id.to_string())]).await?;
    Ok(Json(success_response(
        "model route deleted",
        serde_json::json!({ "id": id }),
    )))
}

/// This endpoint is for the Agent Adapter process only. It deliberately
/// returns a credential and must never be proxied by Next.js or the browser.
pub(crate) async fn runtime_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<RuntimeModelRoute>>, AppError> {
    let expected = std::env::var("AGENT_RUNTIME_SHARED_SECRET").map_err(|_| {
        AppError::Forbidden("Agent Runtime internal credential is not configured".to_string())
    })?;
    let supplied = headers
        .get("x-agent-runtime-secret")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if expected.is_empty() || supplied != expected {
        return Err(AppError::Forbidden(
            "Agent Runtime internal credential is invalid".to_string(),
        ));
    }
    let tenant = headers
        .get("x-agent-tenant-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::Forbidden("Agent tenant scope is required".to_string()))?;
    let user_id = headers
        .get("x-agent-user-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::Forbidden("Agent user scope is required".to_string()))?;
    let route = list_raw(&state, tenant, user_id)
        .await?
        .into_iter()
        .find(|item| item.enabled && item.is_default)
        .ok_or_else(|| AppError::BadRequest("请先在自有模型中配置并启用默认模型".to_string()))?;
    Ok(Json(success_response(
        "runtime model route loaded",
        RuntimeModelRoute {
            id: route.id,
            api_base_url: route.api_base_url,
            api_key: decrypt(&route.encrypted_api_key)?,
            chat_model: route.default_chat_model,
        },
    )))
}

#[derive(Clone)]
struct StoredRoute {
    id: String,
    name: String,
    api_base_url: String,
    encrypted_api_key: String,
    default_chat_model: String,
    models: Vec<String>,
    enabled: bool,
    is_default: bool,
}
impl StoredRoute {
    fn public(&self) -> ModelRouteResponse {
        ModelRouteResponse {
            id: self.id.clone(),
            name: self.name.clone(),
            api_base_url: self.api_base_url.clone(),
            default_chat_model: self.default_chat_model.clone(),
            models: self.models.clone(),
            enabled: self.enabled,
            is_default: self.is_default,
            api_key_configured: !self.encrypted_api_key.is_empty(),
        }
    }
}

async fn list(
    state: &AppState,
    tenant: &str,
    user_id: String,
) -> Result<Vec<ModelRouteResponse>, AppError> {
    Ok(list_raw(state, tenant, &user_id)
        .await?
        .iter()
        .map(StoredRoute::public)
        .collect())
}
async fn list_raw(
    state: &AppState,
    tenant: &str,
    user_id: &str,
) -> Result<Vec<StoredRoute>, AppError> {
    let statement = Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT id, name, api_base_url, encrypted_api_key, default_chat_model, models::text AS models, enabled, is_default FROM byom_model_routes WHERE tenant_id = $1::uuid AND created_by_user_id = $2::uuid ORDER BY is_default DESC, name ASC".to_string(), vec![value(tenant), value(user_id)]);
    let rows = state.db.query_all_raw(statement).await?;
    rows.into_iter()
        .map(|row| {
            Ok(StoredRoute {
                id: row.try_get("", "id")?,
                name: row.try_get("", "name")?,
                api_base_url: row.try_get("", "api_base_url")?,
                encrypted_api_key: row.try_get("", "encrypted_api_key")?,
                default_chat_model: row.try_get("", "default_chat_model")?,
                models: serde_json::from_str(&row.try_get::<String>("", "models")?)
                    .unwrap_or_default(),
                enabled: row.try_get("", "enabled")?,
                is_default: row.try_get("", "is_default")?,
            })
        })
        .collect::<Result<_, sea_orm::DbErr>>()
        .map_err(AppError::from)
}
async fn execute(state: &AppState, sql: &str, values: Vec<sea_orm::Value>) -> Result<(), AppError> {
    let statement = Statement::from_sql_and_values(DatabaseBackend::Postgres, sql, values);
    state.db.execute_raw(statement).await?;
    Ok(())
}
async fn clear_default(
    state: &AppState,
    tenant: &str,
    except: Option<&str>,
) -> Result<(), AppError> {
    let (sql, values) = if let Some(id) = except {
        (
            "UPDATE byom_model_routes SET is_default = FALSE WHERE tenant_id = $1::uuid AND is_default = TRUE AND id <> $2",
            vec![value(tenant), value(id)],
        )
    } else {
        (
            "UPDATE byom_model_routes SET is_default = FALSE WHERE tenant_id = $1::uuid AND is_default = TRUE",
            vec![value(tenant)],
        )
    };
    execute(state, sql, values).await
}
fn value(input: &str) -> sea_orm::Value {
    sea_orm::Value::String(Some(input.to_string()))
}
fn bool_value(input: bool) -> sea_orm::Value {
    sea_orm::Value::Bool(Some(input))
}
fn models(payload: &ModelRouteRequest) -> Vec<String> {
    let mut values = payload
        .models
        .iter()
        .chain(std::iter::once(&payload.default_chat_model))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}
fn validate(payload: &ModelRouteRequest, require_key: bool) -> Result<(), AppError> {
    if payload.name.trim().is_empty()
        || payload.api_base_url.trim().is_empty()
        || payload.default_chat_model.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "名称、API 地址和默认对话模型不能为空".to_string(),
        ));
    }
    if !(payload.api_base_url.starts_with("https://")
        || payload.api_base_url.starts_with("http://"))
    {
        return Err(AppError::BadRequest(
            "API 地址必须使用 HTTP 或 HTTPS".to_string(),
        ));
    }
    if require_key
        && payload
            .api_key
            .as_deref()
            .is_none_or(|key| key.trim().is_empty())
    {
        return Err(AppError::BadRequest("API 密钥不能为空".to_string()));
    }
    Ok(())
}
fn cipher() -> Result<Aes256Gcm, AppError> {
    let raw = std::env::var("YAYA_BYOM_ENCRYPTION_KEY").map_err(|_| {
        AppError::BadRequest("未配置 YAYA_BYOM_ENCRYPTION_KEY，不能保存模型密钥".to_string())
    })?;
    let key = STANDARD.decode(raw.trim()).map_err(|_| {
        AppError::BadRequest(
            "YAYA_BYOM_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥".to_string(),
        )
    })?;
    Aes256Gcm::new_from_slice(&key).map_err(|_| {
        AppError::BadRequest(
            "YAYA_BYOM_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥".to_string(),
        )
    })
}
fn encrypt(plain: &str) -> Result<String, AppError> {
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher()?
        .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
        .map_err(|_| AppError::BadRequest("模型密钥加密失败".to_string()))?;
    Ok(format!(
        "v1:{}:{}",
        STANDARD.encode(nonce),
        STANDARD.encode(encrypted)
    ))
}
fn decrypt(encoded: &str) -> Result<String, AppError> {
    let (version, payload) = encoded
        .split_once(':')
        .ok_or_else(|| AppError::BadRequest("保存的模型密钥格式无效".to_string()))?;
    if version != "v1" {
        return Err(AppError::BadRequest("保存的模型密钥格式无效".to_string()));
    }
    let (nonce, ciphertext) = payload
        .split_once(':')
        .ok_or_else(|| AppError::BadRequest("保存的模型密钥格式无效".to_string()))?;
    let nonce = STANDARD
        .decode(nonce)
        .map_err(|_| AppError::BadRequest("保存的模型密钥无法解密".to_string()))?;
    let ciphertext = STANDARD
        .decode(ciphertext)
        .map_err(|_| AppError::BadRequest("保存的模型密钥无法解密".to_string()))?;
    let plain = cipher()?
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| AppError::BadRequest("保存的模型密钥无法解密".to_string()))?;
    String::from_utf8(plain).map_err(|_| AppError::BadRequest("保存的模型密钥无效".to_string()))
}
