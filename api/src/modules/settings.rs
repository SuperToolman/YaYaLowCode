//! Local platform settings persisted by the Rust backend.

use axum::Json;
use axum::extract::Path;
use axum::http::StatusCode;
use sea_orm::Database;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::platform::config::{
    AgentSettings, DatabaseSettings, DingTalkSettings, IdentitySourceSettings, RbacPermissionSettings,
    load_agent_settings, load_database_settings, load_identity_source_settings,
    load_rbac_permission_settings, save_agent_settings, save_database_settings,
    save_identity_source_settings, save_rbac_permission_settings,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::platform::authorization;
use crate::shared::success_response;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseSettingsResponse {
    host: String,
    port: u16,
    database: String,
    username: String,
    password_configured: bool,
}

#[derive(Deserialize)]
pub(crate) struct UpdateDatabaseSettingsRequest {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentSettingsResponse {
    enabled: bool,
    provider: String,
    api_base_url: String,
    api_key_configured: bool,
    chat_model: String,
    embedding_model: String,
    temperature: f64,
    max_steps: usize,
    system_prompt: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAgentSettingsRequest {
    enabled: bool,
    provider: String,
    api_base_url: String,
    api_key: Option<String>,
    chat_model: String,
    embedding_model: String,
    temperature: f64,
    max_steps: usize,
    system_prompt: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateIdentitySourceSettingsRequest {
    dingtalk: DingTalkSettings,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateRolePermissionsRequest {
    grants: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RolePermissionsResponse {
    role_id: String,
    grants: Vec<String>,
}

pub(crate) async fn get_database_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<DatabaseSettingsResponse>>, AppError> {
    let settings = load_database_settings().unwrap_or_else(default_database_settings);
    let response = DatabaseSettingsResponse {
        host: settings.host,
        port: settings.port,
        database: settings.database,
        username: settings.username,
        password_configured: !settings.password.is_empty(),
    };

    Ok(Json(success_response("database settings loaded", response)))
}

pub(crate) async fn update_database_settings(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<UpdateDatabaseSettingsRequest>,
) -> Result<(StatusCode, Json<ApiResponse<DatabaseSettingsResponse>>), AppError> {
    let previous = load_database_settings();
    let password = payload
        .password
        .filter(|value| !value.is_empty())
        .or_else(|| previous.as_ref().map(|settings| settings.password.clone()))
        .ok_or_else(|| AppError::BadRequest("database password is required".to_string()))?;
    let settings = DatabaseSettings {
        host: payload.host.trim().to_string(),
        port: payload.port,
        database: payload.database.trim().to_string(),
        username: payload.username.trim().to_string(),
        password,
    };
    settings.validate().map_err(AppError::BadRequest)?;

    Database::connect(settings.to_database_url())
        .await
        .map_err(|error| AppError::BadRequest(format!("database connection failed: {error}")))?;
    save_database_settings(&settings).map_err(AppError::Server)?;
    state.schedule_restart().map_err(AppError::Server)?;

    let response = DatabaseSettingsResponse {
        host: settings.host,
        port: settings.port,
        database: settings.database,
        username: settings.username,
        password_configured: true,
    };

    Ok((
        StatusCode::ACCEPTED,
        Json(success_response(
            "database settings saved; backend is restarting",
            response,
        )),
    ))
}

pub(crate) async fn get_agent_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<AgentSettingsResponse>>, AppError> {
    let settings = load_agent_settings().unwrap_or_else(default_agent_settings);
    Ok(Json(success_response(
        "agent settings loaded",
        AgentSettingsResponse::from(&settings),
    )))
}

pub(crate) async fn update_agent_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Json(payload): Json<UpdateAgentSettingsRequest>,
) -> Result<Json<ApiResponse<AgentSettingsResponse>>, AppError> {
    let previous = load_agent_settings().unwrap_or_else(default_agent_settings);
    let settings = AgentSettings {
        enabled: payload.enabled,
        provider: payload.provider.trim().to_string(),
        api_base_url: payload
            .api_base_url
            .trim()
            .trim_end_matches('/')
            .to_string(),
        api_key: payload
            .api_key
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(previous.api_key),
        chat_model: payload.chat_model.trim().to_string(),
        embedding_model: payload.embedding_model.trim().to_string(),
        temperature: payload.temperature,
        max_steps: payload.max_steps,
        system_prompt: payload.system_prompt.trim().to_string(),
    };
    settings.validate().map_err(AppError::BadRequest)?;
    save_agent_settings(&settings).map_err(AppError::Server)?;

    Ok(Json(success_response(
        "agent settings saved",
        AgentSettingsResponse::from(&settings),
    )))
}

pub(crate) async fn get_identity_source_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<IdentitySourceSettings>>, AppError> {
    let settings = load_identity_source_settings().unwrap_or_else(default_identity_source_settings);
    Ok(Json(success_response(
        "identity source settings loaded",
        settings,
    )))
}

pub(crate) async fn get_internal_identity_source_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<ApiResponse<IdentitySourceSettings>>, AppError> {
    authorization::require_internal(&headers)?;
    let settings = load_identity_source_settings().unwrap_or_else(default_identity_source_settings);
    Ok(Json(success_response(
        "identity source settings loaded",
        settings,
    )))
}

pub(crate) async fn update_identity_source_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Json(payload): Json<UpdateIdentitySourceSettingsRequest>,
) -> Result<Json<ApiResponse<IdentitySourceSettings>>, AppError> {
    let settings = IdentitySourceSettings {
        dingtalk: DingTalkSettings {
            app_id: payload.dingtalk.app_id.trim().to_string(),
            agent_id: payload.dingtalk.agent_id.trim().to_string(),
            client_id: payload.dingtalk.client_id.trim().to_string(),
            client_secret: payload.dingtalk.client_secret.trim().to_string(),
            access_token: payload.dingtalk.access_token.trim().to_string(),
            access_token_expires_at: payload.dingtalk.access_token_expires_at,
            sync_enabled: payload.dingtalk.sync_enabled,
            sync_interval_minutes: payload.dingtalk.sync_interval_minutes,
            include_child_departments: payload.dingtalk.include_child_departments,
            disable_departed_users: payload.dingtalk.disable_departed_users,
            allow_jit_provisioning: payload.dingtalk.allow_jit_provisioning,
        },
    };
    settings.validate().map_err(AppError::BadRequest)?;
    save_identity_source_settings(&settings).map_err(AppError::Server)?;

    Ok(Json(success_response(
        "identity source settings saved",
        settings,
    )))
}

pub(crate) async fn get_role_permissions(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Path(role_id): Path<String>,
) -> Result<Json<ApiResponse<RolePermissionsResponse>>, AppError> {
    let settings = load_rbac_permission_settings().unwrap_or_default();
    let grants = if role_id == "00000000-0000-4000-8000-000000000002" {
        vec!["*".to_string()]
    } else {
        settings.grants.get(&role_id).cloned().unwrap_or_default()
    };
    Ok(Json(success_response(
        "role permissions loaded",
        RolePermissionsResponse { role_id, grants },
    )))
}

pub(crate) async fn update_role_permissions(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Path(role_id): Path<String>,
    Json(payload): Json<UpdateRolePermissionsRequest>,
) -> Result<Json<ApiResponse<RolePermissionsResponse>>, AppError> {
    let role_id = role_id.trim().to_string();
    if role_id.is_empty() {
        return Err(AppError::BadRequest("role id is required".to_string()));
    }
    if role_id == "00000000-0000-4000-8000-000000000002" {
        return Err(AppError::BadRequest("system administrator permissions cannot be modified".to_string()));
    }
    let mut settings: RbacPermissionSettings = load_rbac_permission_settings().unwrap_or_default();
    let mut grants = payload
        .grants
        .into_iter()
        .map(|grant| grant.trim().to_string())
        .filter(|grant| !grant.is_empty())
        .collect::<Vec<_>>();
    grants.sort();
    grants.dedup();
    settings.grants.insert(role_id.clone(), grants.clone());
    save_rbac_permission_settings(&settings).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "role permissions saved",
        RolePermissionsResponse { role_id, grants },
    )))
}

impl From<&AgentSettings> for AgentSettingsResponse {
    fn from(settings: &AgentSettings) -> Self {
        Self {
            enabled: settings.enabled,
            provider: settings.provider.clone(),
            api_base_url: settings.api_base_url.clone(),
            api_key_configured: !settings.api_key.is_empty(),
            chat_model: settings.chat_model.clone(),
            embedding_model: settings.embedding_model.clone(),
            temperature: settings.temperature,
            max_steps: settings.max_steps,
            system_prompt: settings.system_prompt.clone(),
        }
    }
}

fn default_database_settings() -> DatabaseSettings {
    DatabaseSettings {
        host: "localhost".to_string(),
        port: 5432,
        database: "yaya_low_code".to_string(),
        username: "postgres".to_string(),
        password: String::new(),
    }
}

pub(crate) fn default_agent_settings() -> AgentSettings {
    AgentSettings {
        enabled: false,
        provider: "openai-compatible".to_string(),
        api_base_url: "https://api.openai.com/v1".to_string(),
        api_key: String::new(),
        chat_model: "gpt-4.1-mini".to_string(),
        embedding_model: "text-embedding-3-small".to_string(),
        temperature: 0.2,
        max_steps: 8,
        system_prompt: "你是 YaYa 低代码平台助手。帮助用户理解表单、自动化和应用结构。当前只允许使用只读工具，不得声称已经修改任何数据。".to_string(),
    }
}

pub(crate) fn default_identity_source_settings() -> IdentitySourceSettings {
    IdentitySourceSettings {
        dingtalk: DingTalkSettings {
            app_id: String::new(),
            agent_id: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            access_token: String::new(),
            access_token_expires_at: None,
            sync_enabled: false,
            sync_interval_minutes: 720,
            include_child_departments: true,
            disable_departed_users: true,
            allow_jit_provisioning: false,
        },
    }
}
