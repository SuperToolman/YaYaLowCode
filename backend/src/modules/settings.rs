//! Local platform settings. Credentials are persisted locally and never returned by the API.

use axum::Json;
use axum::http::StatusCode;
use sea_orm::Database;
use serde::{Deserialize, Serialize};

use crate::platform::config::{
    AgentSettings, DatabaseSettings, load_agent_settings, load_database_settings,
    save_agent_settings, save_database_settings,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
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
