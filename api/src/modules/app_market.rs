//! First-generation application marketplace release snapshots.
//!
//! Snapshots intentionally contain structure only. Runtime records, users,
//! credentials, and instance-specific physical table names are never exported.

mod contracts;
pub(crate) use contracts::*;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use chrono::Utc;
use sea_orm::{DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read, Write};
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

fn installation_package_root() -> PathBuf {
    root().join("installed-packages")
}

fn persist_installation_package(
    installation_id: Uuid,
    release_id: &str,
    bytes: &[u8],
    manifest: &Value,
) -> Result<Value, AppError> {
    fs::create_dir_all(installation_package_root()).map_err(AppError::Server)?;
    let path = installation_package_root().join(format!("{installation_id}-{release_id}.zip"));
    fs::write(&path, bytes).map_err(AppError::Server)?;
    Ok(json!({
        "packagePath": path.to_string_lossy(),
        "manifest": manifest,
        "resourceSummary": {"forms": 0}
    }))
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

async fn sync_to_operation_center(
    submission: &MarketSubmission,
    package: Vec<u8>,
) -> Result<bool, AppError> {
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
                .is_in(form_ids.clone()),
        )
        .all(&state.db)
        .await?;
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(&app_id))
        .all(&state.db)
        .await?;
    let views = if form_ids.is_empty() {
        Vec::new()
    } else {
        crate::infrastructure::entities::form_view_entity::Entity::find()
            .filter(
                crate::infrastructure::entities::form_view_entity::Column::FormUuid
                    .is_in(form_ids.clone()),
            )
            .all(&state.db)
            .await?
    };
    if flows.iter().any(flow_has_external_connector_dependency) {
        return Err(AppError::BadRequest(
            "应用包含外部连接器/HTTP 自动化；当前市场版本尚不支持凭证绑定，无法发布".into(),
        ));
    }
    let mut snapshot = json!({
        "formatVersion": 2,
        "application": { "id": app.route_app_id, "name": app.name, "description": app.description, "icon": app.icon, "color": app.color },
        "navigation": navigation.iter().map(|n| json!({"id":n.id,"itemType":n.item_type,"targetFormUuid":n.target_form_uuid,"title":n.title,"pathSlug":n.path_slug,"sortOrder":n.sort_order,"isDefaultEntry":n.is_default_entry,"parentId":n.parent_id})).collect::<Vec<_>>(),
        "forms": forms.iter().map(|f| json!({"formUuid":f.form_uuid,"name":f.name,"slug":f.slug,"formType":f.form_type,"version":f.current_schema_version})).collect::<Vec<_>>(),
        "schemas": schemas.iter().map(|s| json!({"formUuid":s.form_uuid,"version":s.version,"schema":s.schema_json})).collect::<Vec<_>>(),
        "storageDefinitions": storage.iter().map(|s| json!({"formUuid":s.form_uuid,"storageMode":s.storage_mode,"columnMapping":s.column_mapping_json,"compiledSchemaVersion":s.compiled_schema_version})).collect::<Vec<_>>(),
        "automations": flows.iter().map(|f| json!({"flowUuid":f.flow_uuid,"name":f.name,"description":f.description,"status":f.status,"currentVersion":f.current_version,"flowType":f.flow_type,"triggerFormUuid":f.trigger_form_uuid,"triggerConfig":f.trigger_config,"nodes":f.nodes_json,"edges":f.edges_json})).collect::<Vec<_>>(),
        "excludes": ["records", "workflowInstances", "users", "credentials", "instancePhysicalTableNames", "secrets"]
    });

    let mut resources = vec![
        ("application.json", snapshot["application"].clone()),
        ("navigation.json", snapshot["navigation"].clone()),
        ("forms/index.json", snapshot["forms"].clone()),
        ("schemas/index.json", snapshot["schemas"].clone()),
        (
            "storage-definitions/index.json",
            snapshot["storageDefinitions"].clone(),
        ),
        ("automations/index.json", snapshot["automations"].clone()),
        ("views/index.json", json!(views.iter().map(|view| json!({"formUuid":view.form_uuid,"viewUuid":view.view_uuid,"name":view.name,"config":view.config_json})).collect::<Vec<_>>())),
        ("connectors/index.json", json!([])),
        ("permission-templates.json", json!([])),
    ];
    resources.sort_by_key(|(name, _)| *name);
    let mut checksums = serde_json::Map::new();
    for (name, value) in &resources {
        let contents =
            serde_json::to_vec(value).map_err(|e| AppError::BadRequest(e.to_string()))?;
        checksums.insert(
            (*name).to_string(),
            json!(format!("{:x}", Sha256::digest(contents))),
        );
    }
    let version = load(&app.route_app_id)
        .and_then(|item| {
            item.version
                .split('.')
                .nth(2)
                .and_then(|value| value.parse::<u64>().ok())
        })
        .map(|patch| format!("1.0.{}", patch + 1))
        .unwrap_or_else(default_version);
    let manifest = json!({
        "formatVersion": 2, "packageType": "yaya-application", "publisherAppId": app.route_app_id,
        "version": version, "platformCompatibility": {"min":"0.2.0", "max":"0.2.x"},
        "createdAt": Utc::now().timestamp(), "checksums": checksums,
        "dependencies": {"plugins":[], "skills":[], "connectors":[]}
    });
    let mut package = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    package
        .start_file("manifest.json", options)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    package
        .write_all(&serde_json::to_vec(&manifest).map_err(|e| AppError::BadRequest(e.to_string()))?)
        .map_err(AppError::Server)?;
    for (name, value) in resources {
        package
            .start_file(name, options)
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        package
            .write_all(
                &serde_json::to_vec(&value).map_err(|e| AppError::BadRequest(e.to_string()))?,
            )
            .map_err(AppError::Server)?;
    }
    let bytes = package
        .finish()
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .into_inner();
    snapshot = json!({"formatVersion":2,"manifest":manifest,"packageSha256":format!("{:x}", Sha256::digest(&bytes)),"resourceSummary":{"forms":forms.len(),"automations":flows.len(),"navigation":navigation.len()}});
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
    let synced = sync_to_operation_center(&submission, bytes).await?;
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
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MarketProduct>>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let (mut catalogue, publisher_subject) = load_market_catalogue().await?;
    sync_publisher_source_apps(&state, &publisher_subject, &catalogue).await?;
    if let Some(products) = catalogue.as_array_mut() {
        for product in products {
            product["publisherOwned"] =
                json!(product["publisherSubject"].as_str() == Some(publisher_subject.as_str()));
        }
    }
    Ok(Json(success_response("应用市场已读取", contract_payload(catalogue)?)))
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
    .await.and_then(typed_market_response)
}

pub(crate) async fn preflight_market_application(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product_id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallPreflight>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let detail = market_request(
        "GET",
        &format!("/api/market/applications/{product_id}"),
        None,
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("市场应用详情为空".into()))?;
    let release_id = detail["releaseId"].as_str().unwrap_or_default();
    let already_installed = AppEntity::find()
        .filter(app_entity::Column::OnlineReleaseId.eq(Some(release_id.to_string())))
        .one(&state.db)
        .await?
        .is_some();
    Ok(Json(success_response(
        "安装预检完成", contract_payload(json!({
            "productId": product_id,
            "releaseId": release_id,
            "version": detail["version"],
            "resourceSummary": detail["resourceSummary"],
            "alreadyInstalled": already_installed,
            "blockingIssues": if already_installed { vec!["当前发布版本已安装"] } else { Vec::<&str>::new() },
            "connectorBindingRequired": false
        }))?,
    )))
}

pub(crate) async fn install_market_application(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product_id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallResponse>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "需要 market.apps.manage 权限才能安装市场应用".into(),
        ));
    }
    let _ = authorization::current_user(&headers, &state).await?;
    let detail = market_request(
        "GET",
        &format!("/api/market/applications/{product_id}"),
        None,
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("市场应用详情为空".into()))?;
    let release_id = detail["releaseId"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("市场应用缺少发布版本".into()))?
        .to_string();
    let ticket = market_request(
        "POST",
        &format!("/api/market/applications/{product_id}/download-ticket"),
        Some(json!({})),
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("下载票据为空".into()))?;
    let ticket = ticket["ticket"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("下载票据无效".into()))?;
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    let bytes = reqwest::Client::new()
        .get(format!(
            "{}/api/market/downloads/{ticket}",
            settings.license_center_url.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|_| AppError::BadRequest("应用包下载失败".into()))?
        .bytes()
        .await
        .map_err(|_| AppError::BadRequest("应用包读取失败".into()))?
        .to_vec();
    let files = read_v2_package(&bytes)?;
    let manifest = files
        .get("manifest.json")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let application = files
        .get("application.json")
        .ok_or_else(|| AppError::BadRequest("应用包缺少 application.json".into()))?;
    let forms = files
        .get("forms/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let schemas = files
        .get("schemas/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let navigation = files
        .get("navigation.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let automations = files
        .get("automations/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let views = files
        .get("views/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let installation_id = Uuid::new_v4();
    let local_app_id = format!("app_{}", Uuid::new_v4().simple());
    let now = Utc::now();
    let txn = state.db.begin().await?;
    txn.execute_unprepared(&format!("INSERT INTO market_installations (installation_id,product_id,release_id,local_app_id,status,installed_at,updated_at) VALUES ('{installation_id}','{}','{}','{}','installing',NOW(),NOW())", product_id.replace('\'', "''"), release_id.replace('\'', "''"), local_app_id)).await?;
    app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set(local_app_id.clone()),
        name: Set(application["name"]
            .as_str()
            .unwrap_or("市场应用")
            .to_string()),
        description: Set(application["description"]
            .as_str()
            .unwrap_or("")
            .to_string()),
        icon: Set(application["icon"]
            .as_str()
            .unwrap_or("general")
            .to_string()),
        badge: Set(None),
        color: Set(application["color"]
            .as_str()
            .unwrap_or("primary")
            .to_string()),
        creator_user_id: Set(None),
        deployment_type: Set("market".to_string()),
        online_version: Set(Some(
            detail["version"].as_str().unwrap_or("1.0.0").to_string(),
        )),
        online_release_id: Set(Some(release_id.clone())),
        owner_name: Set("应用市场".to_string()),
        records_count: Set(0),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    txn.execute_unprepared(&format!("INSERT INTO market_installation_resources (installation_id,resource_type,source_id,local_id) VALUES ('{installation_id}','application','{}','{}')", application["id"].as_str().unwrap_or_default().replace('\'', "''"), local_app_id)).await?;
    let mut form_map = HashMap::new();
    for form in &forms {
        if let Some(source) = form["formUuid"].as_str() {
            let local = Uuid::new_v4().to_string();
            form_map.insert(source.to_string(), local.clone());
            form_definition_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                app_route_app_id: Set(local_app_id.clone()),
                form_uuid: Set(local.clone()),
                name: Set(form["name"].as_str().unwrap_or("未命名表单").to_string()),
                slug: Set(format!("form-{}", &local[..8])),
                form_type: Set(form["formType"].as_str().unwrap_or("form").to_string()),
                current_schema_version: Set(form["version"].as_i64().unwrap_or(1) as i32),
                latest_schema_version: Set(form["version"].as_i64().unwrap_or(1) as i32),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(&txn)
            .await?;
            txn.execute_unprepared(&format!("INSERT INTO market_installation_resources (installation_id,resource_type,source_id,local_id) VALUES ('{installation_id}','form','{}','{}')", source.replace('\'', "''"), local)).await?;
        }
    }
    for schema in &schemas {
        if let Some(source) = schema["formUuid"].as_str() {
            if let Some(local) = form_map.get(source) {
                let rewritten_schema = rewrite_form_references(schema["schema"].clone(), &form_map);
                form_schema_entity::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    form_uuid: Set(local.clone()),
                    version: Set(schema["version"].as_i64().unwrap_or(1) as i32),
                    schema_json: Set(rewritten_schema.clone()),
                    change_log: Set(Some("installed from application market".to_string())),
                    created_at: Set(now.into()),
                    updated_at: Set(now.into()),
                }
                .insert(&txn)
                .await?;
                sync_current_storage_plan(
                    &txn,
                    local,
                    schema["version"].as_i64().unwrap_or(1) as i32,
                    &rewritten_schema,
                )
                .await?;
            }
        }
    }
    for view in &views {
        if let Some(source) = view["formUuid"].as_str() {
            if let Some(local) = form_map.get(source) {
                let local_view_id = Uuid::new_v4().to_string();
                crate::infrastructure::entities::form_view_entity::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    form_uuid: Set(local.clone()),
                    view_uuid: Set(local_view_id.clone()),
                    name: Set(view["name"].as_str().unwrap_or("视图").to_string()),
                    config_json: Set(rewrite_form_references(view["config"].clone(), &form_map)),
                    created_at: Set(now.into()),
                    updated_at: Set(now.into()),
                }
                .insert(&txn)
                .await?;
                txn.execute_unprepared(&format!("INSERT INTO market_installation_resources (installation_id,resource_type,source_id,local_id) VALUES ('{installation_id}','view','{}','{}')", view["viewUuid"].as_str().unwrap_or_default().replace('\'', "''"), local_view_id)).await?;
            }
        }
    }
    for item in &navigation {
        let target = item["targetFormUuid"]
            .as_str()
            .and_then(|id| form_map.get(id))
            .cloned();
        let navigation_id = Uuid::new_v4();
        app_navigation_entity::ActiveModel {
            id: Set(navigation_id),
            app_route_app_id: Set(local_app_id.clone()),
            item_type: Set(item["itemType"].as_str().unwrap_or("form").to_string()),
            target_form_uuid: Set(target),
            title: Set(item["title"].as_str().unwrap_or("导航").to_string()),
            path_slug: Set(format!("nav-{}", Uuid::new_v4().simple())),
            sort_order: Set(item["sortOrder"].as_i64().unwrap_or(0) as i32),
            is_default_entry: Set(item["isDefaultEntry"].as_bool().unwrap_or(false)),
            parent_id: Set(None),
            visibility_rule: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;
        txn.execute_unprepared(&format!("INSERT INTO market_installation_resources (installation_id,resource_type,source_id,local_id) VALUES ('{installation_id}','navigation','{}','{}')", item["id"].as_str().unwrap_or_default().replace('\'', "''"), navigation_id)).await?;
    }
    for flow in &automations {
        let flow_id = Uuid::new_v4();
        let local_flow_uuid = Uuid::new_v4().to_string();
        automation_flow_entity::ActiveModel {
            id: Set(flow_id),
            flow_uuid: Set(local_flow_uuid.clone()),
            app_route_app_id: Set(local_app_id.clone()),
            name: Set(flow["name"].as_str().unwrap_or("自动化").to_string()),
            description: Set(flow["description"].as_str().map(str::to_string)),
            status: Set("paused".to_string()),
            current_version: Set(flow["currentVersion"].as_i64().unwrap_or(1) as i32),
            flow_type: Set(flow["flowType"].as_str().unwrap_or("trigger").to_string()),
            trigger_form_uuid: Set(flow["triggerFormUuid"]
                .as_str()
                .and_then(|id| form_map.get(id))
                .cloned()),
            trigger_config: Set(flow["triggerConfig"].clone()),
            nodes_json: Set(rewrite_form_references(flow["nodes"].clone(), &form_map)),
            edges_json: Set(rewrite_form_references(flow["edges"].clone(), &form_map)),
            created_by: Set("application-market".to_string()),
            updated_by: Set("application-market".to_string()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;
        txn.execute_unprepared(&format!("INSERT INTO market_installation_resources (installation_id,resource_type,source_id,local_id) VALUES ('{installation_id}','automation','{}','{}')", flow["flowUuid"].as_str().unwrap_or_default().replace('\'', "''"), local_flow_uuid)).await?;
    }
    let package_snapshot =
        persist_installation_package(installation_id, &release_id, &bytes, &manifest)?;
    let snapshot_json = serde_json::to_string(&package_snapshot)
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .replace('\'', "''");
    let package_sha256 = format!("{:x}", Sha256::digest(&bytes));
    txn.execute_unprepared(&format!("INSERT INTO market_installation_versions (installation_id,release_id,version,package_sha256,package_bytes,snapshot_json,applied_at) VALUES ('{installation_id}','{}','{}','{}',NULL,'{}'::jsonb,NOW())", release_id.replace('\'', "''"), detail["version"].as_str().unwrap_or("0.0.0").replace('\'', "''"), package_sha256, snapshot_json)).await?;
    txn.execute_unprepared(&format!("INSERT INTO market_installation_events (id,installation_id,event_type,detail_json,created_at) VALUES ('{}','{installation_id}','installed','{}'::jsonb,NOW())", Uuid::new_v4(), json!({"releaseId":release_id,"version":detail["version"]}).to_string().replace('\'', "''"))).await?;
    txn.execute_unprepared(&format!("UPDATE market_installations SET status='installed',updated_at=NOW() WHERE installation_id='{installation_id}'")).await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "应用市场安装完成", contract_payload(json!({"installationId":installation_id,"localAppId":local_app_id,"releaseId":release_id,"disabledAutomations":automations.len()}))?,
    )))
}

pub(crate) async fn list_market_installations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MarketInstallation>>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let rows = state.db.query_all_raw(Statement::from_string(DatabaseBackend::Postgres, "SELECT installation_id::text,product_id,release_id,local_app_id,status,installed_at::text,updated_at::text,archived_at::text,legacy_mapping FROM market_installations ORDER BY updated_at DESC".to_string())).await?;
    let mut values = Vec::new();
    for row in rows {
        let installation_id: String = row.try_get("", "installation_id")?;
        let versions = state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT release_id,version,applied_at::text FROM market_installation_versions WHERE installation_id=$1 ORDER BY applied_at DESC", vec![installation_id.clone().into()])).await?
            .into_iter().map(|version| Ok(json!({"releaseId":version.try_get::<String>("", "release_id")?, "version":version.try_get::<String>("", "version")?, "appliedAt":version.try_get::<String>("", "applied_at")?}))).collect::<Result<Vec<_>, sea_orm::DbErr>>()?;
        let events = state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT event_type,detail_json,created_at::text FROM market_installation_events WHERE installation_id=$1 ORDER BY created_at DESC LIMIT 20", vec![installation_id.clone().into()])).await?
            .into_iter().map(|event| Ok(json!({"eventType":event.try_get::<String>("", "event_type")?, "detail":event.try_get::<Value>("", "detail_json")?, "createdAt":event.try_get::<String>("", "created_at")?}))).collect::<Result<Vec<_>, sea_orm::DbErr>>()?;
        values.push(json!({
            "installationId": installation_id,
            "productId": row.try_get::<String>("", "product_id")?,
            "releaseId": row.try_get::<String>("", "release_id")?,
            "localAppId": row.try_get::<String>("", "local_app_id")?,
            "status": row.try_get::<String>("", "status")?,
            "installedAt": row.try_get::<String>("", "installed_at")?,
            "updatedAt": row.try_get::<String>("", "updated_at")?,
            "archivedAt": row.try_get::<Option<String>>("", "archived_at")?,
            "legacyMapping": row.try_get::<bool>("", "legacy_mapping")?,
            "versions": versions,
            "events": events,
        }));
    }
    Ok(Json(success_response("已安装市场应用已读取", contract_payload(values)?)))
}

async fn load_installation(
    db: &DatabaseConnection,
    installation_id: &str,
) -> Result<(String, String, String, String, bool), AppError> {
    let row = db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT product_id,release_id,local_app_id,status,legacy_mapping FROM market_installations WHERE installation_id=$1", vec![installation_id.into()])).await?
        .ok_or_else(|| AppError::NotFound("市场安装记录不存在".into()))?;
    Ok((
        row.try_get("", "product_id")?,
        row.try_get("", "release_id")?,
        row.try_get("", "local_app_id")?,
        row.try_get("", "status")?,
        row.try_get("", "legacy_mapping")?,
    ))
}

async fn record_installation_event(
    db: &DatabaseConnection,
    installation_id: &str,
    event_type: &str,
    detail: Value,
) -> Result<(), AppError> {
    let detail = serde_json::to_string(&detail).map_err(|e| AppError::BadRequest(e.to_string()))?;
    db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "INSERT INTO market_installation_events (id,installation_id,event_type,detail_json,created_at) VALUES ($1,$2,$3,$4::jsonb,NOW())", vec![Uuid::new_v4().into(), installation_id.into(), event_type.into(), detail.into()])).await?;
    Ok(())
}

pub(crate) async fn preflight_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
) -> Result<Json<ApiResponse<MarketUpgradePreflight>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let (product_id, release_id, _app_id, status, legacy) =
        load_installation(&state.db, &installation_id).await?;
    let detail = market_request(
        "GET",
        &format!("/api/market/applications/{product_id}"),
        None,
    )
    .await?
    .0
    .data
    .unwrap_or_else(|| json!({}));
    let target_release_id = detail["releaseId"].as_str().unwrap_or_default();
    let app_mapping = state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT 1 FROM market_installation_resources WHERE installation_id=$1 AND resource_type='application'", vec![installation_id.clone().into()])).await?.is_some();
    let mut blockers = Vec::new();
    if legacy || !app_mapping {
        blockers.push("此安装由旧版安装器创建，资源映射不完整；请归档后重新安装".to_string());
    }
    if status != "installed" {
        blockers.push("应用当前未处于已安装状态".to_string());
    }
    if blockers.is_empty() && release_id != target_release_id {
        let (_, bytes) = download_current_market_package(&product_id).await?;
        blockers.extend(release_blocking_issues(&state, &installation_id, &bytes).await?);
    }
    Ok(Json(success_response(
        "安装升级预检完成", contract_payload(json!({"installationId":installation_id,"currentReleaseId":release_id,"targetReleaseId":target_release_id,"targetVersion":detail["version"],"upToDate":release_id==target_release_id,"blockingIssues":blockers,"canUpgrade":blockers.is_empty() && release_id != target_release_id}))?,
    )))
}

pub(crate) async fn archive_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallationStatus>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "需要 market.apps.manage 权限才能归档市场应用".into(),
        ));
    }
    let (_product, _release, app_id, status, _) =
        load_installation(&state.db, &installation_id).await?;
    if status == "archived" {
        return Ok(Json(success_response(
            "市场应用已归档", contract_payload(json!({"installationId":installation_id,"status":"archived"}))?,
        )));
    }
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .all(&state.db)
        .await?;
    let txn = state.db.begin().await?;
    for flow in flows {
        let mut active: automation_flow_entity::ActiveModel = flow.into();
        active.status = Set("paused".to_string());
        active.update(&txn).await?;
    }
    txn.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "UPDATE market_installations SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE installation_id=$1", vec![installation_id.clone().into()])).await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE apps SET deployment_type='market_archived',updated_at=NOW() WHERE route_app_id=$1",
        vec![app_id.into()],
    ))
    .await?;
    txn.commit().await?;
    record_installation_event(&state.db, &installation_id, "archived", json!({})).await?;
    Ok(Json(success_response(
        "市场应用已归档", contract_payload(json!({"installationId":installation_id,"status":"archived"}))?,
    )))
}

pub(crate) async fn restore_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallationStatus>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "需要 market.apps.manage 权限才能恢复市场应用".into(),
        ));
    }
    let (_product, _release, app_id, status, _) =
        load_installation(&state.db, &installation_id).await?;
    if status != "archived" {
        return Err(AppError::BadRequest("只有已归档应用可以恢复".into()));
    }
    state.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "UPDATE market_installations SET status='installed',archived_at=NULL,updated_at=NOW() WHERE installation_id=$1", vec![installation_id.clone().into()])).await?;
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE apps SET deployment_type='market',updated_at=NOW() WHERE route_app_id=$1",
            vec![app_id.into()],
        ))
        .await?;
    record_installation_event(&state.db, &installation_id, "restored", json!({})).await?;
    Ok(Json(success_response(
        "市场应用已恢复", contract_payload(json!({"installationId":installation_id,"status":"installed"}))?,
    )))
}

async fn download_current_market_package(product_id: &str) -> Result<(Value, Vec<u8>), AppError> {
    let detail = market_request(
        "GET",
        &format!("/api/market/applications/{product_id}"),
        None,
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("市场应用详情为空".into()))?;
    let ticket = market_request(
        "POST",
        &format!("/api/market/applications/{product_id}/download-ticket"),
        Some(json!({})),
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("下载票据为空".into()))?;
    let ticket = ticket["ticket"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("下载票据无效".into()))?;
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    let bytes = reqwest::Client::new()
        .get(format!(
            "{}/api/market/downloads/{ticket}",
            settings.license_center_url.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|_| AppError::BadRequest("应用包下载失败".into()))?
        .bytes()
        .await
        .map_err(|_| AppError::BadRequest("应用包读取失败".into()))?
        .to_vec();
    Ok((detail, bytes))
}

fn schema_field_types(schema: &Value) -> HashMap<String, String> {
    schema
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            Some((
                field.get("id")?.as_str()?.to_string(),
                field
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ))
        })
        .collect()
}

fn schema_fields(schema: &Value) -> HashMap<String, &Value> {
    schema
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| Some((field.get("id")?.as_str()?.to_string(), field)))
        .collect()
}

async fn release_blocking_issues(
    state: &AppState,
    installation_id: &str,
    bytes: &[u8],
) -> Result<Vec<String>, AppError> {
    let files = read_v2_package(bytes)?;
    let schemas = files
        .get("schemas/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let target = schemas
        .iter()
        .filter_map(|schema| {
            Some((
                schema.get("formUuid")?.as_str()?.to_string(),
                schema.get("schema")?.clone(),
            ))
        })
        .collect::<HashMap<_, _>>();
    let rows = state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT source_id,local_id FROM market_installation_resources WHERE installation_id=$1 AND resource_type='form'", vec![installation_id.into()])).await?;
    let mut blockers = Vec::new();
    for row in rows {
        let source: String = row.try_get("", "source_id")?;
        let local: String = row.try_get("", "local_id")?;
        let Some(next_schema) = target.get(&source) else {
            blockers.push(format!("表单 {source} 被删除；已安装资源不能删除"));
            continue;
        };
        let Some(current) = FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(&local))
            .order_by_desc(form_schema_entity::Column::Version)
            .one(&state.db)
            .await?
        else {
            continue;
        };
        let before = schema_fields(&current.schema_json);
        let after = schema_fields(next_schema);
        for (field_id, old) in before {
            let Some(next) = after.get(&field_id) else {
                blockers.push(format!("字段 {field_id} 被删除"));
                continue;
            };
            if old.get("type") != next.get("type") {
                blockers.push(format!("字段 {field_id} 类型发生变化"));
            }
            let relation = |field: &Value| {
                field
                    .get("relationFormUuid")
                    .or_else(|| field.get("relationTarget"))
                    .or_else(|| field.pointer("/config/relationFormUuid"))
                    .cloned()
            };
            if relation(old) != relation(next) {
                blockers.push(format!("字段 {field_id} 的关联目标发生变化"));
            }
        }
    }
    Ok(blockers)
}

async fn apply_nonbreaking_release(
    state: &AppState,
    installation_id: &str,
    app_id: &str,
    release_id: &str,
    version: &str,
    bytes: &[u8],
    event: &str,
) -> Result<(), AppError> {
    let files = read_v2_package(bytes)?;
    let forms = files
        .get("forms/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let schemas = files
        .get("schemas/index.json")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mappings = state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT source_id,local_id FROM market_installation_resources WHERE installation_id=$1 AND resource_type='form'", vec![installation_id.into()])).await?;
    let form_map = mappings
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<String>("", "source_id")?,
                row.try_get::<String>("", "local_id")?,
            ))
        })
        .collect::<Result<HashMap<_, _>, sea_orm::DbErr>>()?;
    for schema in &schemas {
        let source = schema["formUuid"].as_str().unwrap_or_default();
        let Some(local) = form_map.get(source) else {
            continue;
        };
        let current = FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(local))
            .order_by_desc(form_schema_entity::Column::Version)
            .one(&state.db)
            .await?;
        if let Some(current) = current {
            let before = schema_field_types(&current.schema_json);
            let after = schema_field_types(&schema["schema"]);
            for (field, previous_type) in before {
                match after.get(&field) {
                    None => {
                        return Err(AppError::BadRequest(format!(
                            "升级包含破坏性变更：字段 {field} 被删除"
                        )));
                    }
                    Some(next_type) if next_type != &previous_type => {
                        return Err(AppError::BadRequest(format!(
                            "升级包含破坏性变更：字段 {field} 类型发生变化"
                        )));
                    }
                    _ => {}
                }
            }
            let rewritten = rewrite_form_references(schema["schema"].clone(), &form_map);
            let mut active: form_schema_entity::ActiveModel = current.into();
            active.schema_json = Set(rewritten.clone());
            active.updated_at = Set(Utc::now().into());
            active.update(&state.db).await?;
            sync_current_storage_plan(
                &state.db,
                local,
                schema["version"].as_i64().unwrap_or(1) as i32,
                &rewritten,
            )
            .await?;
        }
    }
    let manifest = files
        .get("manifest.json")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let snapshot = persist_installation_package(
        Uuid::parse_str(installation_id)
            .map_err(|_| AppError::BadRequest("安装记录 ID 无效".into()))?,
        release_id,
        bytes,
        &manifest,
    )?;
    let snapshot =
        serde_json::to_string(&snapshot).map_err(|e| AppError::BadRequest(e.to_string()))?;
    state.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "INSERT INTO market_installation_versions (installation_id,release_id,version,package_sha256,snapshot_json,applied_at) VALUES ($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT(installation_id,release_id) DO UPDATE SET applied_at=excluded.applied_at", vec![installation_id.into(), release_id.into(), version.into(), format!("{:x}", Sha256::digest(bytes)).into(), snapshot.into()])).await?;
    state.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "UPDATE market_installations SET release_id=$2,status='installed',updated_at=NOW() WHERE installation_id=$1", vec![installation_id.into(), release_id.into()])).await?;
    state.db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "UPDATE apps SET online_release_id=$2,online_version=$3,updated_at=NOW() WHERE route_app_id=$1", vec![app_id.into(), release_id.into(), version.into()])).await?;
    record_installation_event(
        &state.db,
        installation_id,
        event,
        json!({"releaseId":release_id,"version":version}),
    )
    .await
}

pub(crate) async fn upgrade_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
) -> Result<Json<ApiResponse<MarketReleaseResponse>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "需要 market.apps.manage 权限才能升级市场应用".into(),
        ));
    }
    let (product_id, release_id, app_id, status, legacy) =
        load_installation(&state.db, &installation_id).await?;
    if legacy || status != "installed" {
        return Err(AppError::BadRequest(
            "此安装无法升级；请先恢复或重新安装".into(),
        ));
    }
    let (detail, bytes) = download_current_market_package(&product_id).await?;
    let target = detail["releaseId"].as_str().unwrap_or_default();
    if target == release_id {
        return Ok(Json(success_response(
            "已是当前上架版本", contract_payload(json!({"installationId":installation_id,"releaseId":release_id}))?,
        )));
    }
    let blockers = release_blocking_issues(&state, &installation_id, &bytes).await?;
    if !blockers.is_empty() {
        return Err(AppError::BadRequest(format!(
            "升级预检未通过：{}",
            blockers.join("；")
        )));
    }
    apply_nonbreaking_release(
        &state,
        &installation_id,
        &app_id,
        target,
        detail["version"].as_str().unwrap_or("0.0.0"),
        &bytes,
        "upgraded",
    )
    .await?;
    Ok(Json(success_response(
        "市场应用升级完成", contract_payload(json!({"installationId":installation_id,"releaseId":target}))?,
    )))
}

pub(crate) async fn rollback_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
    Json(request): Json<MarketRollbackRequest>,
) -> Result<Json<ApiResponse<MarketReleaseResponse>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "需要 market.apps.manage 权限才能回滚市场应用".into(),
        ));
    }
    let (_product, _current, app_id, status, legacy) =
        load_installation(&state.db, &installation_id).await?;
    if legacy || status != "installed" {
        return Err(AppError::BadRequest(
            "此安装无法回滚；请先恢复或重新安装".into(),
        ));
    }
    let target = request.release_id
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("回滚必须指定 releaseId".into()))?;
    let row = state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT version,snapshot_json::text FROM market_installation_versions WHERE installation_id=$1 AND release_id=$2", vec![installation_id.clone().into(), target.into()])).await?.ok_or_else(|| AppError::NotFound("未找到已安装的目标版本快照".into()))?;
    let version: String = row.try_get("", "version")?;
    let snapshot: String = row.try_get("", "snapshot_json")?;
    let snapshot: Value =
        serde_json::from_str(&snapshot).map_err(|_| AppError::BadRequest("版本快照无效".into()))?;
    let package_path = snapshot["packagePath"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("版本快照缺少包文件".into()))?;
    let bytes =
        fs::read(package_path).map_err(|_| AppError::NotFound("本地版本包已不存在".into()))?;
    apply_nonbreaking_release(
        &state,
        &installation_id,
        &app_id,
        target,
        &version,
        &bytes,
        "rolled_back",
    )
    .await?;
    Ok(Json(success_response(
        "市场应用已回滚", contract_payload(json!({"installationId":installation_id,"releaseId":target}))?,
    )))
}

pub(crate) async fn purge_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(installation_id): Path<String>,
) -> Result<Json<ApiResponse<MarketPurgeResponse>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden(
            "只有应用管理员可以永久清理市场应用".into(),
        ));
    }
    let (_product, _release, app_id, status, _) =
        load_installation(&state.db, &installation_id).await?;
    if status != "archived" {
        return Err(AppError::BadRequest("永久清理前必须先归档应用".into()));
    }
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("本地应用不存在".into()))?;
    if app.records_count > 0 {
        return Err(AppError::BadRequest(
            "应用仍包含业务记录，无法永久清理".into(),
        ));
    }
    let txn = state.db.begin().await?;
    crate::modules::apps::deletion::delete_app_contents(&txn, &app_id).await?;
    txn.commit().await?;
    for path in fs::read_dir(installation_package_root())
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&installation_id))
        })
    {
        let _ = fs::remove_file(path);
    }
    Ok(Json(success_response(
        "市场应用已永久清理", contract_payload(json!({"installationId":installation_id}))?,
    )))
}

async fn market_request(
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台地址和许可证".into()))?;
    validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let client = reqwest::Client::new();
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

fn flow_has_external_connector_dependency(flow: &automation_flow_entity::Model) -> bool {
    let nodes = flow.nodes_json.as_array().cloned().unwrap_or_default();
    nodes.iter().any(|node| {
        matches!(
            node.pointer("/data/kind").and_then(Value::as_str),
            Some("http-request" | "connector" | "integration")
        )
    })
}

fn rewrite_form_references(value: Value, form_map: &HashMap<String, String>) -> Value {
    match value {
        Value::String(value) => form_map
            .get(&value)
            .cloned()
            .map(Value::String)
            .unwrap_or(Value::String(value)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| rewrite_form_references(item, form_map))
                .collect(),
        ),
        Value::Object(items) => Value::Object(
            items
                .into_iter()
                .map(|(key, value)| (key, rewrite_form_references(value, form_map)))
                .collect(),
        ),
        value => value,
    }
}

fn read_v2_package(bytes: &[u8]) -> Result<HashMap<String, Value>, AppError> {
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(AppError::BadRequest("应用包超过 64MB 限制".into()));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| AppError::BadRequest("应用包不是有效 ZIP".into()))?;
    if archive.len() > 256 {
        return Err(AppError::BadRequest("应用包文件数量超过限制".into()));
    }
    let mut files: HashMap<String, Value> = HashMap::new();
    let mut hashes = HashMap::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| AppError::BadRequest("应用包读取失败".into()))?;
        let name = file.name().to_string();
        if name.contains("..")
            || name.starts_with('/')
            || name.starts_with('\\')
            || file.size() > 16 * 1024 * 1024
        {
            return Err(AppError::BadRequest("应用包包含不安全文件".into()));
        }
        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|_| AppError::BadRequest("应用包文件读取失败".into()))?;
        hashes.insert(name.clone(), format!("{:x}", Sha256::digest(&content)));
        files.insert(
            name,
            serde_json::from_slice(&content)
                .map_err(|_| AppError::BadRequest("应用包 JSON 无效".into()))?,
        );
    }
    let manifest = files
        .get("manifest.json")
        .ok_or_else(|| AppError::BadRequest("应用包缺少 manifest".into()))?;
    if manifest["formatVersion"].as_i64() != Some(2)
        || manifest["packageType"].as_str() != Some("yaya-application")
    {
        return Err(AppError::BadRequest("仅支持 V2 应用包".into()));
    }
    for (name, expected) in manifest["checksums"].as_object().into_iter().flatten() {
        if hashes.get(name) != expected.as_str().map(str::to_string).as_ref() {
            return Err(AppError::BadRequest(format!("应用包校验和不匹配：{name}")));
        }
    }
    Ok(files)
}

async fn sync_publisher_source_apps(
    state: &AppState,
    publisher_subject: &str,
    catalogue: &Value,
) -> Result<u64, AppError> {
    let mut updated = 0;
    for product in catalogue.as_array().into_iter().flatten() {
        if product["publisherSubject"].as_str() != Some(publisher_subject) {
            continue;
        }
        let Some(app_id) = product["publisherAppId"].as_str() else {
            continue;
        };
        let Some(app) = AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id))
            .one(&state.db)
            .await?
        else {
            continue;
        };
        // Source applications are promoted in place. Marketplace installations always use a
        // different local application ID and must continue through their own lifecycle.
        if matches!(app.deployment_type.as_str(), "market" | "market_archived") {
            continue;
        }
        let release_id = product["releaseId"].as_str().map(str::to_string);
        let version = product["version"].as_str().map(str::to_string);
        if app.deployment_type == "online"
            && app.online_release_id == release_id
            && app.online_version == version
        {
            continue;
        }
        let mut active: app_entity::ActiveModel = app.into();
        active.deployment_type = Set("online".to_string());
        active.online_release_id = Set(release_id);
        active.online_version = Set(version);
        active.updated_at = Set(Utc::now().into());
        active.update(&state.db).await?;
        updated += 1;
    }
    Ok(updated)
}

/// Pull current listings and promote only source applications owned by this license subject.
pub(crate) async fn sync_approved(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<MarketSyncResponse>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let (catalogue, publisher_subject) = load_market_catalogue().await?;
    let updated = sync_publisher_source_apps(&state, &publisher_subject, &catalogue).await?;
    Ok(Json(success_response(
        "应用线上版本已同步", contract_payload(json!({ "updated": updated }))?,
    )))
}

fn contract_payload<T: serde::de::DeserializeOwned>(payload: impl serde::Serialize) -> Result<T, AppError> {
    let value = serde_json::to_value(payload).map_err(|error| AppError::Server(std::io::Error::other(error)))?;
    serde_json::from_value(value).map_err(|error| AppError::Server(std::io::Error::other(error)))
}
fn typed_market_response<T: serde::de::DeserializeOwned + serde::Serialize>(response: Json<ApiResponse<Value>>) -> Result<Json<ApiResponse<T>>, AppError> {
    let response = response.0;
    Ok(Json(ApiResponse { code: response.code, message: response.message, time: response.time, data: response.data.map(contract_payload).transpose()? }))
}
