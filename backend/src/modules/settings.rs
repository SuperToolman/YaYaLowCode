//! Local platform settings. Credentials are persisted locally and never returned by the API.

use axum::Json;
use axum::http::StatusCode;
use sea_orm::Database;
use serde::{Deserialize, Serialize};

use crate::platform::config::{DatabaseSettings, load_database_settings, save_database_settings};
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

fn default_database_settings() -> DatabaseSettings {
    DatabaseSettings {
        host: "localhost".to_string(),
        port: 5432,
        database: "yaya_low_code".to_string(),
        username: "postgres".to_string(),
        password: String::new(),
    }
}
