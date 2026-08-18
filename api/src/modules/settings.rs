//! Local platform settings persisted by the Rust backend.

use axum::Json;
use axum::extract::Path;
use axum::http::StatusCode;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DbBackend, Statement, TransactionTrait,
    Value as SeaValue,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;

use crate::platform::authorization;
use crate::platform::config::{
    CommunicationModuleSettings, DatabaseSettings, DingTalkSettings, IdentitySourceSettings,
    NotificationSettings, ValkeySettings, database_url_from_env, load_communication_settings,
    load_database_settings, load_identity_source_settings, load_installed_ai_employee_packages,
    load_installed_ai_employees, load_notification_settings, load_platform_license_settings,
    load_valkey_settings, remove_installed_ai_employee_package, runtime_database_settings,
    save_communication_settings, save_database_settings, save_identity_source_settings,
    save_installed_ai_employee_package, save_installed_ai_employees, save_notification_settings,
    save_valkey_settings,
};
use crate::platform::license::{
    PlatformAiEmployeeEntitlement, PlatformLicenseStatus, apply_latest_license_remotely,
    license_allows_database_configuration, license_has_module, license_module_expires_at,
    license_status, mark_license_running_remotely, validate_license_center_url,
    validate_license_remotely, validate_license_token,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiEmployeeMarketItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub price_cents: i64,
    pub billing_cycle: String,
    pub version: String,
    pub installed_version: Option<String>,
    pub latest_package_version: String,
    pub installed_package_version: Option<String>,
    pub owned: bool,
    pub installed: bool,
    pub expires_at: Option<i64>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketPurchaseReceipt {
    pub order_id: String,
    pub order_no: String,
    pub license_id: String,
    pub status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationMarketProduct {
    id: String,
    title: String,
    description: String,
    category: String,
    price_cents: i64,
    billing_cycle: String,
    version: String,
}

#[derive(Deserialize)]
struct OperationMarketEnvelope<T> {
    #[serde(default)]
    code: i32,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiEmployeeInstallationStatus {
    employee_id: String,
    installed: bool,
}

fn require_local_deployment() -> Result<(), AppError> {
    if license_allows_database_configuration() {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "数据库配置仅对本地部署许可证开放".to_string(),
        ))
    }
}
use crate::shared::success_response;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseSettingsResponse {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    connection_status: String,
    connection_error: Option<String>,
    managed_by_environment: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateDatabaseSettingsRequest {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseConnectionTestResponse {
    connected: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValkeySettingsResponse {
    enabled: bool,
    host: String,
    port: u16,
    database: u8,
    username: String,
    password: String,
    cache_ttl_hours: u8,
    connection_status: String,
    connection_error: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateValkeySettingsRequest {
    enabled: bool,
    host: String,
    port: u16,
    database: u8,
    username: String,
    password: Option<String>,
    cache_ttl_hours: u8,
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
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivatePlatformLicenseRequest {
    pub(crate) license_center_url: String,
    pub(crate) license: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationStorageStatsResponse {
    conversation_count: i64,
    message_count: i64,
    attachment_count: i64,
    message_bytes: i64,
    attachment_bytes: i64,
    total_bytes: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationCleanupResponse {
    deleted_messages: u64,
    deleted_files: u64,
}

pub(crate) async fn get_platform_license_status() -> Json<ApiResponse<PlatformLicenseStatus>> {
    let mut status = license_status();
    if status.valid {
        match validate_license_remotely().await {
            Err(reason) => {
                status.valid = false;
                status.reason = Some(reason);
                status.platform_status = "expired".to_string();
                status
                    .module_statuses
                    .values_mut()
                    .for_each(|module_status| *module_status = "expired".to_string());
            }
            Ok(Some(update)) => {
                status.update_available = true;
                status.latest_license_id = Some(update.license_id);
                status.latest_issued_at = update.issued_at;
            }
            Ok(None) => {}
        }
    }
    Json(success_response("platform license status loaded", status))
}

pub(crate) async fn apply_latest_platform_license(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<PlatformLicenseStatus>>, AppError> {
    if !apply_latest_license_remotely()
        .await
        .map_err(AppError::BadRequest)?
    {
        return Err(AppError::BadRequest("当前已经是最新许可证".to_string()));
    }
    let status = license_status();
    if status.valid && license_has_module("communication") {
        crate::infrastructure::legacy_bootstrap::ensure_communication_tables(&state.db).await?;
    }
    Ok(Json(success_response("平台许可证已更新", status)))
}

pub(crate) async fn get_ai_employee_market()
-> Result<Json<ApiResponse<Vec<AiEmployeeMarketItem>>>, AppError> {
    let status = license_status();
    // Keep the local signature untouched, but use the newer signed payload for
    // market ownership while the user is deciding whether to apply it.
    let pending_claims = if status.valid {
        validate_license_remotely()
            .await
            .ok()
            .flatten()
            .and_then(|update| validate_license_token(&update.license).ok())
    } else {
        None
    };
    let operation_url = status
        .license_center_url
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".to_string()))?;
    let url = format!(
        "{}/api/market/ai-employees",
        operation_url.trim_end_matches('/')
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| AppError::Server(std::io::Error::other(error)))?
        .get(url)
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台暂时不可访问".to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "运营管理平台拒绝了市场目录请求".to_string(),
        ));
    }
    let products = response
        .json::<OperationMarketEnvelope<Vec<OperationMarketProduct>>>()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的市场目录".to_string()))?
        .data
        .unwrap_or_default();
    let installed_ids = load_installed_ai_employees();
    let installed_packages = load_installed_ai_employee_packages();
    let items = products
        .into_iter()
        .map(|product| {
            let entitlement = pending_claims
                .as_ref()
                .and_then(|claims| {
                    claims
                        .ai_employees
                        .iter()
                        .find(|item| item.id == product.id)
                })
                .or_else(|| {
                    status
                        .ai_employees
                        .iter()
                        .find(|item| item.id == product.id)
                });
            let owned = status.valid
                && entitlement
                    .is_some_and(|item| item.expires_at >= chrono::Utc::now().timestamp());
            let installed_package_version = installed_packages
                .get(&product.id)
                .and_then(|package| package.get("templateVersion"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            AiEmployeeMarketItem {
                // Preserve the local installation state after an entitlement expires so the
                // client can surface it as expired and still allow the administrator to remove it.
                installed: installed_ids.contains(&product.id),
                installed_version: installed_package_version.clone(),
                installed_package_version,
                latest_package_version: product.version.clone(),
                expires_at: entitlement.map(|value| value.expires_at),
                owned,
                id: product.id,
                title: product.title,
                description: product.description,
                category: product.category,
                price_cents: product.price_cents,
                billing_cycle: product.billing_cycle,
                version: product.version,
            }
        })
        .collect();
    Ok(Json(success_response("AI 员工市场已读取", items)))
}

pub(crate) async fn install_ai_employee(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(employee_id): Path<String>,
) -> Result<Json<ApiResponse<AiEmployeeInstallationStatus>>, AppError> {
    license_status()
        .ai_employees
        .into_iter()
        .find(|entitlement| {
            entitlement.id == employee_id
                && entitlement.expires_at >= chrono::Utc::now().timestamp()
        })
        .ok_or_else(|| AppError::Forbidden("当前许可证未包含该 AI 员工，无法安装".to_string()))?;
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".to_string()))?;
    let entitlement = fetch_owned_ai_employee_package(
        &settings.license_center_url,
        &settings.license,
        &employee_id,
    )
    .await?;
    sync_ai_employee_skill_packages(
        &state,
        &settings.license_center_url,
        &settings.license,
        &entitlement,
    )
    .await?;
    save_installed_ai_employee_package(
        &employee_id,
        serde_json::to_value(&entitlement)
            .map_err(|error| AppError::Server(std::io::Error::other(error)))?,
    )
    .map_err(AppError::Server)?;
    crate::modules::agent_config::sync_installed_ai_employee_runtime(&state, &entitlement).await?;
    let mut installed = load_installed_ai_employees();
    installed.insert(employee_id.clone());
    save_installed_ai_employees(&installed).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "AI 员工已安装",
        AiEmployeeInstallationStatus {
            employee_id,
            installed: true,
        },
    )))
}

pub(crate) async fn uninstall_ai_employee(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(employee_id): Path<String>,
) -> Result<Json<ApiResponse<AiEmployeeInstallationStatus>>, AppError> {
    let mut installed = load_installed_ai_employees();
    if !installed.remove(&employee_id) {
        return Err(AppError::NotFound("该 AI 员工尚未安装".to_string()));
    }
    save_installed_ai_employees(&installed).map_err(AppError::Server)?;
    remove_installed_ai_employee_package(&employee_id).map_err(AppError::Server)?;
    crate::modules::agent_config::disable_installed_ai_employee_runtime(&state, &employee_id)
        .await?;
    Ok(Json(success_response(
        "AI 员工已移除",
        AiEmployeeInstallationStatus {
            employee_id,
            installed: false,
        },
    )))
}

async fn fetch_owned_ai_employee_package(
    operation_url: &str,
    license: &str,
    employee_id: &str,
) -> Result<PlatformAiEmployeeEntitlement, AppError> {
    let url = format!(
        "{}/api/market/ai-employees/{}/package",
        operation_url.trim_end_matches('/'),
        employee_id
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AppError::Server(std::io::Error::other(error)))?
        .get(url)
        .bearer_auth(license)
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台暂时不可访问".to_string()))?;
    let status = response.status();
    let payload = response
        .json::<OperationMarketEnvelope<PlatformAiEmployeeEntitlement>>()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的 AI 员工安装包".to_string()))?;
    if !status.is_success() || payload.code != 0 {
        return Err(AppError::BadRequest(if payload.message.trim().is_empty() {
            "运营管理平台拒绝了 AI 员工同步请求".to_string()
        } else {
            payload.message
        }));
    }
    payload
        .data
        .ok_or_else(|| AppError::BadRequest("运营管理平台未返回 AI 员工安装包".to_string()))
}

async fn sync_ai_employee_skill_packages(
    state: &AppState,
    operation_url: &str,
    license: &str,
    entitlement: &PlatformAiEmployeeEntitlement,
) -> Result<(), AppError> {
    for skill in &entitlement.skills {
        let archive = fetch_owned_ai_employee_skill_archive(
            operation_url,
            license,
            &entitlement.id,
            &skill.id,
        )
        .await?;
        crate::modules::agent_config::install_ai_employee_skill_package(state, skill, &archive)
            .await?;
    }
    Ok(())
}

async fn fetch_owned_ai_employee_skill_archive(
    operation_url: &str,
    license: &str,
    employee_id: &str,
    skill_id: &str,
) -> Result<Vec<u8>, AppError> {
    let url = format!(
        "{}/api/market/ai-employees/{}/skills/{}/archive",
        operation_url.trim_end_matches('/'),
        employee_id,
        skill_id,
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| AppError::Server(std::io::Error::other(error)))?
        .get(url)
        .bearer_auth(license)
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台 Skill 文件包暂时不可访问".to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest("运营管理平台拒绝了 AI 员工 Skill 文件包请求".to_string()));
    }
    let archive = response
        .bytes()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的 AI 员工 Skill 文件包".to_string()))?;
    if archive.is_empty() {
        return Err(AppError::BadRequest("运营管理平台返回了空的 AI 员工 Skill 文件包".to_string()));
    }
    Ok(archive.to_vec())
}

pub(crate) async fn test_purchase_ai_employee(
    Path(employee_id): Path<String>,
) -> Result<Json<ApiResponse<MarketPurchaseReceipt>>, AppError> {
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".to_string()))?;
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let mut url = reqwest::Url::parse(&settings.license_center_url)
        .map_err(|_| AppError::BadRequest("运营管理平台地址无效".to_string()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::BadRequest("运营管理平台地址无效".to_string()))?
        .extend([
            "api",
            "market",
            "ai-employees",
            employee_id.trim(),
            "test-purchase",
        ]);
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AppError::Server(std::io::Error::other(error)))?
        .post(url)
        .bearer_auth(&settings.license)
        .send()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台暂时不可访问".to_string()))?;
    let status = response.status();
    let payload = response
        .json::<OperationMarketEnvelope<MarketPurchaseReceipt>>()
        .await
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的购买结果".to_string()))?;
    if !status.is_success() || payload.code != 0 {
        return Err(AppError::BadRequest(payload.message));
    }
    let receipt = payload
        .data
        .ok_or_else(|| AppError::BadRequest("运营管理平台未返回订单信息".to_string()))?;
    Ok(Json(success_response("测试支付已完成", receipt)))
}

pub(crate) async fn activate_platform_license(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<ActivatePlatformLicenseRequest>,
) -> Result<Json<ApiResponse<PlatformLicenseStatus>>, AppError> {
    let license_center_url =
        validate_license_center_url(&payload.license_center_url).map_err(AppError::BadRequest)?;
    validate_license_token(payload.license.trim()).map_err(AppError::BadRequest)?;
    let settings = crate::platform::config::PlatformLicenseSettings {
        license_center_url,
        license: payload.license.trim().to_string(),
        activated_at: chrono::Utc::now().to_rfc3339(),
    };
    crate::platform::config::save_platform_license_settings(&settings).map_err(AppError::Server)?;
    if let Err(error) = validate_license_remotely().await {
        let _ = std::fs::remove_file(
            std::env::var_os("YAYA_LICENSE_SETTINGS_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from("runtime/state/license.json")),
        );
        return Err(AppError::BadRequest(error));
    }
    mark_license_running_remotely()
        .await
        .map_err(AppError::BadRequest)?;
    let status = license_status();
    if status.valid && license_has_module("communication") {
        crate::infrastructure::legacy_bootstrap::ensure_communication_tables(&state.db).await?;
    }
    Ok(Json(success_response("平台许可证已激活", status)))
}

pub(crate) async fn get_communication_module_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<CommunicationModuleSettings>>, AppError> {
    let settings = communication_settings_with_license();
    Ok(Json(success_response(
        "communication module settings loaded",
        settings,
    )))
}

pub(crate) async fn update_communication_module_settings(
    Json(payload): Json<CommunicationModuleSettings>,
) -> Result<Json<ApiResponse<CommunicationModuleSettings>>, AppError> {
    ensure_communication_installed()?;
    if !(1..=200).contains(&payload.max_file_upload_mb) {
        return Err(AppError::BadRequest(
            "聊天文件最大上传大小应在 1 至 200 MB 之间".into(),
        ));
    }
    if payload.retention_days > 3650 {
        return Err(AppError::BadRequest(
            "聊天数据保留天数不能超过 3650 天".into(),
        ));
    }
    let allowed_file_extensions = normalize_extensions(&payload.allowed_file_extensions)?;
    let settings = CommunicationModuleSettings {
        installed: true,
        license_id: license_status().license_id,
        expires_at: license_module_expires_at("communication"),
        max_file_upload_mb: payload.max_file_upload_mb,
        retention_days: payload.retention_days,
        allowed_file_extensions,
        websocket_enabled: payload.websocket_enabled,
        allow_file_messages: payload.allow_file_messages,
    };
    save_communication_settings(&settings).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "communication settings saved",
        settings,
    )))
}

pub(crate) async fn get_communication_storage_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<CommunicationStorageStatsResponse>>, AppError> {
    ensure_communication_installed()?;
    let row = state.db.query_one_raw(Statement::from_string(
        DbBackend::Postgres,
        "SELECT (SELECT COUNT(*) FROM communication_conversations)::BIGINT AS conversation_count, (SELECT COUNT(*) FROM communication_messages)::BIGINT AS message_count, (SELECT COALESCE(SUM(octet_length(content)), 0) FROM communication_messages)::BIGINT AS message_bytes, (SELECT COUNT(DISTINCT a.file_id) FROM communication_message_attachments a)::BIGINT AS attachment_count, (SELECT COALESCE(SUM(f.byte_size), 0) FROM uploaded_files f WHERE EXISTS (SELECT 1 FROM communication_message_attachments a WHERE a.file_id = f.id))::BIGINT AS attachment_bytes".to_string(),
    )).await?.ok_or_else(|| AppError::Server(std::io::Error::other("communication storage statistics unavailable")))?;
    let message_bytes = row.try_get::<i64>("", "message_bytes")?;
    let attachment_bytes = row.try_get::<i64>("", "attachment_bytes")?;
    Ok(Json(success_response(
        "communication storage statistics loaded",
        CommunicationStorageStatsResponse {
            conversation_count: row.try_get("", "conversation_count")?,
            message_count: row.try_get("", "message_count")?,
            attachment_count: row.try_get("", "attachment_count")?,
            message_bytes,
            attachment_bytes,
            total_bytes: message_bytes.saturating_add(attachment_bytes),
        },
    )))
}

pub(crate) async fn cleanup_communication_data(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<CommunicationCleanupResponse>>, AppError> {
    ensure_communication_installed()?;
    let retention_days = communication_settings_with_license().retention_days;
    if retention_days == 0 {
        return Err(AppError::BadRequest(
            "当前配置为永久保留，不能执行过期数据清理".into(),
        ));
    }
    let cutoff = chrono::Utc::now() - chrono::Duration::days(i64::from(retention_days));
    let transaction = state.db.begin().await?;
    let candidates = transaction.query_all_raw(Statement::from_sql_and_values(DbBackend::Postgres, "SELECT DISTINCT f.id, f.storage_key FROM uploaded_files f JOIN communication_message_attachments a ON a.file_id = f.id JOIN communication_messages m ON m.id = a.message_id WHERE m.created_at < $1", vec![SeaValue::ChronoDateTimeUtc(Some(cutoff))])).await?;
    let deleted_messages = transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM communication_messages WHERE created_at < $1",
            vec![SeaValue::ChronoDateTimeUtc(Some(cutoff))],
        ))
        .await?
        .rows_affected();
    let mut deleted_files = 0;
    let mut storage_keys = Vec::new();
    for candidate in candidates {
        let file_id = candidate.try_get("", "id")?;
        let storage_key: String = candidate.try_get("", "storage_key")?;
        let result = transaction.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres, "DELETE FROM uploaded_files f WHERE f.id = $1 AND NOT EXISTS (SELECT 1 FROM communication_message_attachments a WHERE a.file_id = f.id)", vec![SeaValue::Uuid(Some(file_id))])).await?;
        if result.rows_affected() > 0 {
            deleted_files += 1;
            storage_keys.push(storage_key);
        }
    }
    transaction.commit().await?;
    let root = std::env::var("YAYA_UPLOAD_DIR").unwrap_or_else(|_| "runtime/uploads".to_string());
    for storage_key in storage_keys {
        let _ = tokio::fs::remove_file(std::path::Path::new(&root).join(storage_key)).await;
    }
    Ok(Json(success_response(
        "communication expired data cleaned",
        CommunicationCleanupResponse {
            deleted_messages,
            deleted_files,
        },
    )))
}

fn communication_settings_with_license() -> CommunicationModuleSettings {
    let status = license_status();
    let mut settings = load_communication_settings().unwrap_or_default();
    settings.installed = status.valid && license_has_module("communication");
    settings.license_id = status.license_id;
    settings.expires_at = license_module_expires_at("communication");
    settings
}

fn ensure_communication_installed() -> Result<(), AppError> {
    if communication_settings_with_license().installed {
        Ok(())
    } else {
        Err(AppError::Forbidden("通讯模块未安装".into()))
    }
}

fn normalize_extensions(value: &str) -> Result<String, AppError> {
    let mut extensions = Vec::new();
    for item in value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let extension = item.trim_start_matches('.').to_ascii_lowercase();
        if extension.is_empty()
            || extension.len() > 20
            || !extension
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Err(AppError::BadRequest(
                "允许的文件类型应为以逗号分隔的扩展名，例如 pdf,docx,png".into(),
            ));
        }
        if !extensions.contains(&extension) {
            extensions.push(extension);
        }
    }
    Ok(extensions.join(","))
}
pub(crate) async fn get_notification_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<NotificationSettings>>, AppError> {
    Ok(Json(success_response(
        "notification settings loaded",
        load_notification_settings().unwrap_or_default(),
    )))
}

pub(crate) async fn update_notification_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Json(payload): Json<NotificationSettings>,
) -> Result<Json<ApiResponse<NotificationSettings>>, AppError> {
    let settings = NotificationSettings {
        dingtalk_webhook_url: payload.dingtalk_webhook_url.trim().to_string(),
        email_from_address: payload.email_from_address.trim().to_string(),
        ..payload
    };
    settings.validate().map_err(AppError::BadRequest)?;
    save_notification_settings(&settings).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "notification settings saved",
        settings,
    )))
}

pub(crate) async fn get_database_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<DatabaseSettingsResponse>>, AppError> {
    require_local_deployment()?;
    let (settings, database_url) = match runtime_database_settings() {
        Some((settings, database_url)) => (settings, Some(database_url)),
        None => (
            load_database_settings().unwrap_or_else(default_database_settings),
            None,
        ),
    };
    let response = database_settings_response(settings, database_url.as_deref()).await;

    Ok(Json(success_response("database settings loaded", response)))
}

pub(crate) async fn update_database_settings(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<UpdateDatabaseSettingsRequest>,
) -> Result<(StatusCode, Json<ApiResponse<DatabaseSettingsResponse>>), AppError> {
    require_local_deployment()?;
    if database_url_from_env().is_some() {
        return Err(AppError::BadRequest(
            "数据库连接由部署环境 DATABASE_URL 管理，不能从设置页覆盖".to_string(),
        ));
    }
    let previous = load_database_settings();
    let password = payload
        .password
        .or_else(|| previous.as_ref().map(|settings| settings.password.clone()))
        .unwrap_or_default();
    let settings = DatabaseSettings {
        host: payload.host.trim().to_string(),
        port: payload.port,
        database: payload.database.trim().to_string(),
        username: payload.username.trim().to_string(),
        password,
    };
    settings.validate().map_err(AppError::BadRequest)?;

    verify_database_connection(&settings)
        .await
        .map_err(|error| AppError::BadRequest(format!("database connection failed: {error}")))?;
    save_database_settings(&settings).map_err(AppError::Server)?;
    state.schedule_restart().map_err(AppError::Server)?;

    let response = database_settings_response(settings, None).await;

    Ok((
        StatusCode::ACCEPTED,
        Json(success_response(
            "database settings saved; backend is restarting",
            response,
        )),
    ))
}

pub(crate) async fn test_database_connection(
    Json(payload): Json<UpdateDatabaseSettingsRequest>,
) -> Result<Json<ApiResponse<DatabaseConnectionTestResponse>>, AppError> {
    require_local_deployment()?;
    if database_url_from_env().is_some() {
        return Err(AppError::BadRequest(
            "数据库连接由部署环境 DATABASE_URL 管理，不能从设置页测试或覆盖".to_string(),
        ));
    }
    let settings = DatabaseSettings {
        host: payload.host.trim().to_string(),
        port: payload.port,
        database: payload.database.trim().to_string(),
        username: payload.username.trim().to_string(),
        password: payload.password.unwrap_or_default(),
    };
    settings.validate().map_err(AppError::BadRequest)?;

    verify_database_connection(&settings)
        .await
        .map_err(|error| AppError::BadRequest(format!("database connection failed: {error}")))?;

    Ok(Json(success_response(
        "database connection succeeded",
        DatabaseConnectionTestResponse { connected: true },
    )))
}

async fn database_settings_response(
    settings: DatabaseSettings,
    managed_database_url: Option<&str>,
) -> DatabaseSettingsResponse {
    let connection_result = match managed_database_url {
        Some(database_url) => verify_database_url(database_url).await,
        None => verify_database_connection(&settings).await,
    };
    match connection_result {
        Ok(()) => DatabaseSettingsResponse {
            host: settings.host,
            port: settings.port,
            database: settings.database,
            username: settings.username,
            password: settings.password,
            connection_status: "connected".to_string(),
            connection_error: None,
            managed_by_environment: managed_database_url.is_some(),
        },
        Err(error) => DatabaseSettingsResponse {
            host: settings.host,
            port: settings.port,
            database: settings.database,
            username: settings.username,
            password: settings.password,
            connection_status: "disconnected".to_string(),
            connection_error: Some(error.to_string()),
            managed_by_environment: managed_database_url.is_some(),
        },
    }
}

async fn verify_database_connection(settings: &DatabaseSettings) -> Result<(), sea_orm::DbErr> {
    verify_database_url(&settings.to_database_url()).await
}

async fn verify_database_url(database_url: &str) -> Result<(), sea_orm::DbErr> {
    let mut options = ConnectOptions::new(database_url);
    options.connect_timeout(Duration::from_secs(3));
    Database::connect(options).await.map(|_| ())
}

pub(crate) async fn get_valkey_settings(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Result<Json<ApiResponse<ValkeySettingsResponse>>, AppError> {
    require_local_deployment()?;
    let settings = load_valkey_settings().unwrap_or_else(default_valkey_settings);
    let response = valkey_settings_response(settings).await;
    Ok(Json(success_response("Valkey settings loaded", response)))
}

pub(crate) async fn update_valkey_settings(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<UpdateValkeySettingsRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ValkeySettingsResponse>>), AppError> {
    require_local_deployment()?;
    let previous = load_valkey_settings();
    let password = payload
        .password
        .or_else(|| previous.as_ref().map(|settings| settings.password.clone()))
        .unwrap_or_default();
    let settings = ValkeySettings {
        enabled: payload.enabled,
        host: payload.host.trim().to_string(),
        port: payload.port,
        database: payload.database,
        username: payload.username.trim().to_string(),
        password,
        cache_ttl_hours: payload.cache_ttl_hours,
    };
    settings.validate().map_err(AppError::BadRequest)?;
    if settings.enabled {
        verify_valkey_connection(&settings).await?;
    }
    save_valkey_settings(&settings).map_err(AppError::Server)?;
    state.schedule_restart().map_err(AppError::Server)?;
    let response = valkey_settings_response(settings).await;
    Ok((
        StatusCode::ACCEPTED,
        Json(success_response(
            "Valkey settings saved; backend is restarting",
            response,
        )),
    ))
}

pub(crate) async fn test_valkey_connection(
    Json(payload): Json<UpdateValkeySettingsRequest>,
) -> Result<Json<ApiResponse<DatabaseConnectionTestResponse>>, AppError> {
    require_local_deployment()?;
    let settings = ValkeySettings {
        enabled: payload.enabled,
        host: payload.host.trim().to_string(),
        port: payload.port,
        database: payload.database,
        username: payload.username.trim().to_string(),
        password: payload.password.unwrap_or_default(),
        cache_ttl_hours: payload.cache_ttl_hours,
    };
    settings.validate().map_err(AppError::BadRequest)?;
    if settings.enabled {
        verify_valkey_connection(&settings).await?;
    }
    Ok(Json(success_response(
        "Valkey connection succeeded",
        DatabaseConnectionTestResponse { connected: true },
    )))
}

async fn valkey_settings_response(settings: ValkeySettings) -> ValkeySettingsResponse {
    if !settings.enabled {
        return ValkeySettingsResponse {
            enabled: settings.enabled,
            host: settings.host,
            port: settings.port,
            database: settings.database,
            username: settings.username,
            password: settings.password,
            cache_ttl_hours: settings.cache_ttl_hours,
            connection_status: "disabled".to_string(),
            connection_error: None,
        };
    }
    match verify_valkey_connection(&settings).await {
        Ok(()) => ValkeySettingsResponse {
            enabled: settings.enabled,
            host: settings.host,
            port: settings.port,
            database: settings.database,
            username: settings.username,
            password: settings.password,
            cache_ttl_hours: settings.cache_ttl_hours,
            connection_status: "connected".to_string(),
            connection_error: None,
        },
        Err(error) => ValkeySettingsResponse {
            enabled: settings.enabled,
            host: settings.host,
            port: settings.port,
            database: settings.database,
            username: settings.username,
            password: settings.password,
            cache_ttl_hours: settings.cache_ttl_hours,
            connection_status: "disconnected".to_string(),
            connection_error: Some(format!("{error:?}")),
        },
    }
}

async fn verify_valkey_connection(settings: &ValkeySettings) -> Result<(), AppError> {
    let client = redis::Client::open(settings.to_valkey_url()).map_err(|error| {
        AppError::BadRequest(format!("Valkey configuration is invalid: {error}"))
    })?;
    let mut connection = tokio::time::timeout(
        Duration::from_secs(3),
        redis::aio::ConnectionManager::new(client),
    )
    .await
    .map_err(|_| AppError::BadRequest("Valkey connection timed out".to_string()))?
    .map_err(|error| AppError::BadRequest(format!("Valkey connection failed: {error}")))?;
    tokio::time::timeout(
        Duration::from_secs(3),
        redis::cmd("PING").query_async::<String>(&mut connection),
    )
    .await
    .map_err(|_| AppError::BadRequest("Valkey ping timed out".to_string()))?
    .map_err(|error| AppError::BadRequest(format!("Valkey ping failed: {error}")))?;
    Ok(())
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
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(role_id): Path<String>,
) -> Result<Json<ApiResponse<RolePermissionsResponse>>, AppError> {
    let grants = if role_id == "00000000-0000-4000-8000-000000000002" {
        vec!["*".to_string()]
    } else {
        let role_id = uuid::Uuid::parse_str(&role_id)
            .map_err(|_| AppError::NotFound("role not found".to_string()))?;
        crate::platform::rbac::grants_for_role(&state.db, role_id).await?
    };
    Ok(Json(success_response(
        "role permissions loaded",
        RolePermissionsResponse { role_id, grants },
    )))
}

pub(crate) async fn update_role_permissions(
    axum::extract::State(state): axum::extract::State<AppState>,
    Path(role_id): Path<String>,
    Json(payload): Json<UpdateRolePermissionsRequest>,
) -> Result<Json<ApiResponse<RolePermissionsResponse>>, AppError> {
    let role_id = role_id.trim().to_string();
    if role_id.is_empty() {
        return Err(AppError::BadRequest("role id is required".to_string()));
    }
    if role_id == "00000000-0000-4000-8000-000000000002" {
        return Err(AppError::BadRequest(
            "system administrator permissions cannot be modified".to_string(),
        ));
    }
    let mut grants = payload
        .grants
        .into_iter()
        .map(|grant| grant.trim().to_string())
        .filter(|grant| !grant.is_empty())
        .collect::<Vec<_>>();
    grants.sort();
    grants.dedup();
    let parsed_role_id = uuid::Uuid::parse_str(&role_id)
        .map_err(|_| AppError::BadRequest("invalid role id".to_string()))?;
    crate::platform::rbac::replace_role_grants(&state.db, parsed_role_id, grants.clone()).await?;
    Ok(Json(success_response(
        "role permissions saved",
        RolePermissionsResponse { role_id, grants },
    )))
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

fn default_valkey_settings() -> ValkeySettings {
    ValkeySettings {
        enabled: false,
        host: "127.0.0.1".to_string(),
        port: 6379,
        database: 0,
        username: String::new(),
        password: String::new(),
        cache_ttl_hours: 8,
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
