//! First-generation application marketplace release snapshots.
//!
//! Snapshots intentionally contain structure only. Runtime records, users,
//! credentials, and instance-specific physical table names are never exported.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::Utc;
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
    fs::create_dir_all(root()).map_err(AppError::Server)?;
    let target = path(&value.app_id);
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

async fn sync_to_operation_center(submission: &MarketSubmission) -> Result<bool, AppError> {
    let Some(settings) = load_platform_license_settings() else {
        return Ok(false);
    };
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let url = format!(
        "{}/api/application-submissions",
        settings.license_center_url.trim_end_matches('/')
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Server(std::io::Error::other(e)))?
        .post(url)
        .bearer_auth(&settings.license)
        .json(submission)
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
    Ok(true)
}

pub(crate) async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<MarketSubmission>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".into()))?;
    let grants = authorization::grants(&headers, &state).await?;
    let user = authorization::current_user(&headers, &state).await?;
    if !grants.contains("*")
        && app.creator_user_id != Some(user.id)
        && !(app.creator_user_id.is_none() && app.owner_name == user.display_name)
    {
        return Err(AppError::Forbidden(
            "只有应用创建者或系统管理员可以提交上线".into(),
        ));
    }
    let forms = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(&app_id))
        .all(&state.db)
        .await?;
    let form_ids: Vec<String> = forms.iter().map(|f| f.form_uuid.clone()).collect();
    let schemas = if form_ids.is_empty() {
        Vec::new()
    } else {
        FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.is_in(form_ids.clone()))
            .all(&state.db)
            .await?
    };
    let navigation = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(&app_id))
        .all(&state.db)
        .await?;
    let storage = crate::infrastructure::entities::form_storage_definition_entity::Entity::find()
        .filter(
            crate::infrastructure::entities::form_storage_definition_entity::Column::FormUuid
                .is_in(form_ids),
        )
        .all(&state.db)
        .await?;
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(&app_id))
        .all(&state.db)
        .await?;
    let mut snapshot = json!({
        "formatVersion": 1,
        "application": { "id": app.route_app_id, "name": app.name, "description": app.description, "icon": app.icon, "color": app.color },
        "navigation": navigation.iter().map(|n| json!({"id":n.id,"itemType":n.item_type,"targetFormUuid":n.target_form_uuid,"title":n.title,"pathSlug":n.path_slug,"sortOrder":n.sort_order,"isDefaultEntry":n.is_default_entry,"parentId":n.parent_id})).collect::<Vec<_>>(),
        "forms": forms.iter().map(|f| json!({"formUuid":f.form_uuid,"name":f.name,"slug":f.slug,"formType":f.form_type,"version":f.current_schema_version})).collect::<Vec<_>>(),
        "schemas": schemas.iter().map(|s| json!({"formUuid":s.form_uuid,"version":s.version,"schema":s.schema_json})).collect::<Vec<_>>(),
        "storageDefinitions": storage.iter().map(|s| json!({"formUuid":s.form_uuid,"storageMode":s.storage_mode,"columnMapping":s.column_mapping_json,"compiledSchemaVersion":s.compiled_schema_version})).collect::<Vec<_>>(),
        "automations": flows.iter().map(|f| json!({"flowUuid":f.flow_uuid,"name":f.name,"description":f.description,"status":f.status,"currentVersion":f.current_version,"flowType":f.flow_type,"triggerFormUuid":f.trigger_form_uuid,"triggerEvent":f.trigger_event,"triggerConfig":f.trigger_config,"nodes":f.nodes_json,"edges":f.edges_json})).collect::<Vec<_>>(),
        "excludes": ["records", "workflowInstances", "users", "credentials", "instancePhysicalTableNames", "secrets"]
    });

    let mut package = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    for (name, value) in [
        (
            "manifest.json",
            json!({"formatVersion": 1, "packageType": "yaya-application"}),
        ),
        ("application.json", snapshot["application"].clone()),
        ("navigation.json", snapshot["navigation"].clone()),
        ("forms/index.json", snapshot["forms"].clone()),
        ("schemas/index.json", snapshot["schemas"].clone()),
        (
            "storage-definitions/index.json",
            snapshot["storageDefinitions"].clone(),
        ),
        ("automations/index.json", snapshot["automations"].clone()),
    ] {
        package
            .start_file(name, options)
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        package
            .write_all(
                serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| "{}".into())
                    .as_bytes(),
            )
            .map_err(AppError::Server)?;
    }
    let bytes = package
        .finish()
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .into_inner();
    snapshot["packageBase64"] = json!(BASE64.encode(bytes));
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    let claims = validate_license_token(&settings.license)
        .map_err(|_| AppError::BadRequest("平台许可证无效或已过期，无法提交上线申请".into()))?;
    if claims.subject.trim().is_empty() {
        return Err(AppError::BadRequest(
            "平台许可证未包含申请主体，无法提交上线申请".into(),
        ));
    }
    let applicant_subject = claims.subject;
    let version = load(&app.route_app_id)
        .and_then(|item| {
            item.version
                .split('.')
                .nth(2)
                .and_then(|value| value.parse::<u64>().ok())
        })
        .map(|patch| format!("1.0.{}", patch + 1))
        .unwrap_or_else(default_version);
    let submission = MarketSubmission {
        submission_id: format!("sub_{}", Uuid::new_v4().simple()),
        app_id: app.route_app_id,
        app_name: app.name,
        version,
        status: "pending_review".into(),
        submitted_by: user.display_name,
        applicant_subject,
        submitted_at: Utc::now().timestamp(),
        snapshot,
    };
    save(&submission)?;
    let synced = sync_to_operation_center(&submission).await?;
    let message = if synced {
        "应用上线申请已提交并同步至运营管理平台"
    } else {
        "应用上线申请已保存，待配置运营管理平台后同步"
    };
    Ok(Json(success_response(message, submission)))
}

pub(crate) async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Option<MarketSubmission>>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    Ok(Json(success_response("应用上线申请已读取", load(&app_id))))
}

/// Reads the approved catalogue through the deployment's licensed operation center.
pub(crate) async fn list_market(
    State(_state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let _ = authorization::current_user(&headers, &_state).await?;
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
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
    Ok(Json(success_response(
        "应用市场已读取",
        payload["data"].clone(),
    )))
}

/// Pull approved releases and mark matching local applications as online.
pub(crate) async fn sync_approved(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
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
        .map_err(|_| AppError::BadRequest("运营管理平台返回了无效的应用版本数据".into()))?;
    if !status.is_success() || payload["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(AppError::BadRequest(
            payload["message"]
                .as_str()
                .unwrap_or("应用版本同步失败")
                .into(),
        ));
    }
    let mut updated = 0;
    if let Some(releases) = payload["data"].as_array() {
        for release in releases {
            if release["applicantSubject"].as_str() != Some(claims.subject.as_str())
                || release["status"].as_str() != Some("approved")
            {
                continue;
            }
            let Some(app_id) = release["appId"].as_str() else {
                continue;
            };
            let Some(app) = AppEntity::find()
                .filter(app_entity::Column::RouteAppId.eq(app_id))
                .one(&state.db)
                .await?
            else {
                continue;
            };
            let mut active: app_entity::ActiveModel = app.into();
            active.deployment_type = Set("online".to_string());
            active.online_version = Set(release["version"].as_str().map(str::to_string));
            active.online_release_id = Set(release["submissionId"].as_str().map(str::to_string));
            active.update(&state.db).await?;
            updated += 1;
        }
    }
    Ok(Json(success_response(
        "应用线上版本已同步",
        json!({ "updated": updated }),
    )))
}
