//! V3 application marketplace: dependency packages and installation lifecycle.
//!
//! Snapshots intentionally contain structure only. Runtime records, users,
//! credentials, and instance-specific physical table names are never exported.

mod contracts;
mod commerce;
pub(crate) use commerce::*;
mod installation;
mod protocol;
mod publication;
pub(crate) mod reset;
mod scanner;
mod publication_access;
pub(crate) use publication_access::{PublicationCapabilities, publication_capabilities};
pub(crate) use contracts::*;
pub(crate) use installation::*;
pub(crate) use publication::{ExportPackageRequest, PublishRequest, export_package, get, submit, list_submissions, retry_submission};
pub(crate) use scanner::{preflight, PublicationScopeRequest};

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use chrono::Utc;
use sea_orm::{DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::platform::authorization;
use crate::platform::config::load_platform_license_settings;
use crate::platform::form_storage::sync_current_storage_plan;
use crate::platform::license::validate_license_token;
use crate::platform::prelude::*;
use crate::shared::success_response;

#[derive(Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketSubmission {
    pub submission_id: String,
    pub app_id: String,
    pub app_name: String,
    #[serde(default = "default_version")]
    pub version: String,
    pub status: String,
    pub submitted_by: String,
    #[serde(default)]
    pub applicant_subject: String,
    pub submitted_at: i64,
    pub snapshot: Value,
    #[serde(default)]
    pub product_id: Option<String>,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub review_reason: String,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

fn root() -> PathBuf {
    std::env::var_os("YAYA_MARKET_RELEASES_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("YAYA_API_RUNTIME_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("runtime"))
                .join("state/application-releases")
        })
}

fn path(app_id: &str) -> PathBuf {
    root().join(format!("{app_id}.json"))
}

fn load(app_id: &str) -> Option<MarketSubmission> {
    fs::read_to_string(path(app_id))
        .ok()
        .and_then(|v| serde_json::from_str(&v).ok())
}

fn save(value: &MarketSubmission) -> Result<(), AppError> {
    save_in(&root(), value)
}

fn save_in(directory: &std::path::Path, value: &MarketSubmission) -> Result<(), AppError> {
    fs::create_dir_all(directory).map_err(AppError::Server)?;
    let target = directory.join(format!("{}.json", value.app_id));
    let history = directory.join("history");
    fs::create_dir_all(&history).map_err(AppError::Server)?;
    if let Some(previous) = fs::read(&target).ok().and_then(|bytes|serde_json::from_slice::<MarketSubmission>(&bytes).ok()) {
        let previous_path = history.join(format!("{}.json", previous.submission_id));
        if previous.submission_id != value.submission_id && !previous_path.exists() { write_submission(&previous_path, &previous)?; }
    }
    write_submission(&history.join(format!("{}.json", value.submission_id)), value)?;
    write_submission(&target, value)
}

fn write_submission(target: &std::path::Path, value: &MarketSubmission) -> Result<(), AppError> {
    let temporary = target.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|e| AppError::BadRequest(e.to_string()))?,
    )
    .map_err(AppError::Server)?;
    if target.exists() {
        fs::remove_file(&target).map_err(AppError::Server)?;
    }
    fs::rename(temporary, target).map_err(AppError::Server)
}

async fn sync_to_operation_center(
    submission: &MarketSubmission,
    package: Vec<u8>,
) -> Result<MarketSubmission, AppError> {
    protocol::read(&package).map_err(AppError::BadRequest)?;
    let Some(settings) = load_platform_license_settings() else {
        return Err(AppError::BadRequest("请先配置运营管理平台".into()));
    };
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let url = format!(
        "{}/api/application-submissions",
        settings.license_center_url.trim_end_matches('/')
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| AppError::Server(std::io::Error::other(e)))?
        .post(url)
        .bearer_auth(&settings.license)
        .multipart(
            reqwest::multipart::Form::new()
                .text(
                    "metadata",
                    serde_json::to_string(submission)
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                )
                .part(
                    "package",
                    reqwest::multipart::Part::bytes(package)
                        .file_name("application.zip")
                        .mime_str("application/zip")
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                ),
        )
        .send()
        .await
        .map_err(|_| {
            AppError::BadRequest("运营管理平台暂时不可访问，申请已保存在本地待同步".into())
        })?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|_| AppError::BadRequest(format!("运营管理平台响应读取失败（HTTP {status}）")))?;
    let payload = serde_json::from_str::<serde_json::Value>(&response_text).map_err(|_| {
        let detail = response_text.trim().chars().take(160).collect::<String>();
        AppError::BadRequest(format!(
            "运营管理平台返回了无效的申请结果（HTTP {status}）：{detail}"
        ))
    })?;
    if !status.is_success() || payload.get("code").and_then(|v| v.as_i64()).unwrap_or(-1) != 0 {
        return Err(AppError::BadRequest(
            payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("运营管理平台拒绝了上线申请")
                .to_string(),
        ));
    }
    serde_json::from_value(payload["data"].clone()).map_err(|e| AppError::BadRequest(e.to_string()))
}

pub(crate) async fn list_market(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MarketProduct>>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let (mut catalogue, publisher_subject) = load_market_catalogue().await?;
    sync_publisher_source_apps(&state, &publisher_subject, &catalogue).await?;
    if let Some(products) = catalogue.as_array_mut() {
        for product in products {
            product["publisherOwned"] = json!(product["publisherSubject"].as_str() == Some(publisher_subject.as_str()));
        }
    }
    Ok(Json(success_response(
        "应用市场已读取",
        contract_payload(catalogue)?,
    )))
}

async fn load_market_catalogue() -> Result<(Value, String), AppError> {
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    let claims = validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let url = format!(
        "{}/api/market/applications",
        settings.license_center_url.trim_end_matches('/')
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Server(std::io::Error::other(e)))?
        .get(url)
        .bearer_auth(&settings.license)
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台暂时不可访问".into()))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的应用市场数据".into()))?;
    if !status.is_success() || payload["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(AppError::BadRequest(
            payload["message"]
                .as_str()
                .unwrap_or("应用市场读取失败")
                .into(),
        ));
    }
    Ok((payload["data"].clone(), claims.subject))
}

pub(crate) async fn get_market_application(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product_id): Path<String>,
) -> Result<Json<ApiResponse<MarketProduct>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    market_request(
        "GET",
        &format!("/api/market/applications/{product_id}"),
        None,
    )
    .await
    .and_then(typed_market_response)
}

async fn market_request(
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build()
        .map_err(|e|AppError::Server(std::io::Error::other(e)))?;
    let request = match method {
        "POST" => client
            .post(format!(
                "{}{}",
                settings.license_center_url.trim_end_matches('/'),
                path
            ))
            .json(&body.unwrap_or_else(|| json!({}))),
        _ => client.get(format!(
            "{}{}",
            settings.license_center_url.trim_end_matches('/'),
            path
        )),
    }
    .bearer_auth(settings.license);
    let response = request
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台暂时不可访问".into()))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回无效数据".into()))?;
    if !status.is_success() || payload["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(AppError::BadRequest(
            payload["message"]
                .as_str()
                .unwrap_or("市场请求失败")
                .to_string(),
        ));
    }
    Ok(Json(success_response(
        "市场请求成功",
        payload["data"].clone(),
    )))
}

fn contract_payload<T: serde::de::DeserializeOwned>(
    payload: impl serde::Serialize,
) -> Result<T, AppError> {
    let value = serde_json::to_value(payload)
        .map_err(|error| AppError::Server(std::io::Error::other(error)))?;
    serde_json::from_value(value).map_err(|error| AppError::Server(std::io::Error::other(error)))
}
fn typed_market_response<T: serde::de::DeserializeOwned + serde::Serialize>(
    response: Json<ApiResponse<Value>>,
) -> Result<Json<ApiResponse<T>>, AppError> {
    let response = response.0;
    Ok(Json(ApiResponse {
        code: response.code,
        message: response.message,
        time: response.time,
        data: response.data.map(contract_payload).transpose()?,
    }))
}

pub(crate) async fn sync_approved(
    State(_state): State<AppState>,
    _headers: HeaderMap,
) -> Result<Json<ApiResponse<MarketSyncResponse>>, AppError> {
    // Product-specific publication records are authoritative; source applications remain editable.
    Ok(Json(success_response(
        "市场记录按商品管理",
        MarketSyncResponse { updated: 0 },
    )))
}
async fn sync_publisher_source_apps(
    _state: &AppState,
    _subject: &str,
    _catalogue: &Value,
) -> Result<u64, AppError> {
    Ok(0)
}


#[cfg(test)]
mod publication_history_tests {
    use super::*;
    #[test]
    fn retains_each_application_attempt_when_latest_is_replaced() {
        let directory = std::env::temp_dir().join(format!("publication-history-{}",Uuid::new_v4()));
        let mut first: MarketSubmission = serde_json::from_value(json!({"submissionId":"first","appId":"app","appName":"应用","version":"1.0.0","status":"rejected","submittedBy":"admin","submittedAt":1,"snapshot":{},"reviewReason":"补充资料"})).unwrap();
        save_in(&directory,&first).unwrap();
        first.submission_id="second".into(); first.status="pending_review".into(); first.review_reason.clear();
        save_in(&directory,&first).unwrap();
        let old: MarketSubmission=serde_json::from_slice(&fs::read(directory.join("history/first.json")).unwrap()).unwrap();
        let latest: MarketSubmission=serde_json::from_slice(&fs::read(directory.join("app.json")).unwrap()).unwrap();
        assert_eq!(old.review_reason,"补充资料");assert_eq!(old.status,"rejected");assert_eq!(latest.submission_id,"second");
        assert!(directory.join("history/second.json").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
