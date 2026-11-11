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
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::platform::authorization;
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;
mod model_catalog;

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelRouteResponse {
    pub id: String,
    pub provider_type: String,
    pub name: String,
    pub api_base_url: String,
    pub model: String,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default = "default_reasoning_protocol")]
    pub reasoning_protocol: String,
    pub default_reasoning_effort: String,
    pub enabled: bool,
    pub is_default: bool,
    pub api_key_configured: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(crate) struct ModelRouteRequest {
    #[serde(default = "default_provider_type")]
    pub provider_type: String,
    pub name: String,
    pub api_base_url: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default = "default_reasoning_protocol")]
    pub reasoning_protocol: String,
    #[serde(default = "default_effort")]
    pub default_reasoning_effort: String,
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
    pub thinking_enabled: bool,
    pub reasoning_protocol: String,
    pub default_reasoning_effort: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeModelRouteQuery {
    pub route_id: Option<String>,
    pub model: Option<String>,
}

fn default_reasoning_protocol() -> String {
    "openai".into()
}
fn default_provider_type() -> String { "chat".into() }
fn default_effort() -> String { "auto".into() }

fn default_enabled() -> bool {
    true
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestModelRouteRequest {
    #[serde(default)]
    pub provider_kind: String,
    pub api_base_url: String,
    pub api_key: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestModelRouteResponse {
    pub success: bool,
    pub message: String,
    pub latency_ms: u64,
    pub models: Vec<String>,
}

pub(crate) async fn test_model_route(
    state: State<AppState>, headers: HeaderMap, path: Path<String>, payload: Json<TestModelRouteRequest>,
) -> Result<Json<ApiResponse<TestModelRouteResponse>>, AppError> {
    query_model_catalog(state, headers, path, payload).await
}

pub(crate) async fn fetch_model_route_models(
    state: State<AppState>, headers: HeaderMap, path: Path<String>, payload: Json<TestModelRouteRequest>,
) -> Result<Json<ApiResponse<TestModelRouteResponse>>, AppError> {
    query_model_catalog(state, headers, path, payload).await
}

async fn query_model_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TestModelRouteRequest>,
) -> Result<Json<ApiResponse<TestModelRouteResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user).await?.to_string();
    let route = list_raw(&state, &tenant, &user.id.to_string()).await?
        .into_iter().find(|route| route.id == id)
        .ok_or_else(|| AppError::NotFound("model route not found".into()))?;
    let base = payload.api_base_url.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(base)
        .map_err(|_| AppError::BadRequest("请输入有效的服务地址".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::BadRequest("服务地址须为不带账号、查询参数和片段的 HTTP(S) 地址".into()));
    }
    let key = match payload.api_key.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
        Some(key) => key.to_owned(),
        None if route.encrypted_api_key.is_empty() => String::new(),
        None => decrypt(&route.encrypted_api_key)?,
    };
    Ok(Json(success_response("connection test completed", model_catalog::fetch(base, &key, &payload.provider_kind).await?)))
}

#[cfg(test)]
mod connection_tests {
    use super::*;

    #[test]
    fn rejects_legacy_multi_model_payloads() {
        let legacy = serde_json::json!({"name":"provider","apiBaseUrl":"https://example.com/v1","models":["a","b"],"defaultChatModel":"a"});
        assert!(serde_json::from_value::<ModelRouteRequest>(legacy).is_err());
        let request = |model: &str| serde_json::from_value::<ModelRouteRequest>(serde_json::json!({"name":"provider","apiBaseUrl":"https://example.com/v1","model":model,"enabled":false})).unwrap();
        assert!(validate(&request("model-a"), false).is_ok());
        assert!(validate(&request("model-a,model-b"), false).is_err());
    }

    #[tokio::test]
    #[ignore = "requires KNOWLEDGE_TEST_DATABASE_URL; all objects are isolated and rolled back"]
    async fn single_model_migration_preserves_models_and_credentials() {
        let db = sea_orm::Database::connect(std::env::var("KNOWLEDGE_TEST_DATABASE_URL").unwrap()).await.unwrap();
        let tx = db.begin().await.unwrap();
        let schema = format!("single_model_test_{}", Uuid::new_v4().simple());
        tx.execute_unprepared(&format!("CREATE SCHEMA {schema}; SET LOCAL search_path TO {schema};")).await.unwrap();
        tx.execute_unprepared("CREATE TABLE byom_model_routes(id varchar(96) PRIMARY KEY, tenant_id uuid, created_by_user_id uuid, name varchar(160), api_base_url text, encrypted_api_key text, default_chat_model text, models jsonb, enabled boolean, is_default boolean, thinking_enabled boolean, reasoning_protocol text, default_reasoning_effort text, provider_type text); INSERT INTO byom_model_routes VALUES ('original','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','provider','https://example.com/v1','encrypted-key','b','[\"a\",\"b\",\"a\"]',true,true,false,'openai','auto','chat');").await.unwrap();
        tx.execute_unprepared(include_str!("single-model-routes.sql")).await.unwrap();
        let rows = tx.query_all_raw(Statement::from_string(DatabaseBackend::Postgres, "SELECT id, model, encrypted_api_key, is_default FROM byom_model_routes ORDER BY model")).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].try_get::<String>("", "model").unwrap(), "a");
        assert!(!rows[0].try_get::<bool>("", "is_default").unwrap());
        assert_eq!(rows[1].try_get::<String>("", "id").unwrap(), "original");
        for row in rows { assert_eq!(row.try_get::<String>("", "encrypted_api_key").unwrap(), "encrypted-key"); }
        let old_columns = tx.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='byom_model_routes' AND column_name IN ('models','default_chat_model')", vec![value(&schema)])).await.unwrap();
        assert!(old_columns.is_empty());
        let aliases = tx.query_all_raw(Statement::from_string(DatabaseBackend::Postgres, "SELECT model FROM byom_model_route_aliases")).await.unwrap();
        assert_eq!(aliases.len(), 1);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn validates_models_authentication_errors_and_redirects() {
        use axum::{Router, routing::get, response::IntoResponse};
        let app = Router::new()
            .route("/valid/models", get(|headers: HeaderMap| async move {
                assert_eq!(headers.get("authorization").unwrap(), "Bearer test-secret");
                Json(serde_json::json!({"data": [{"id": "example-model"}]}))
            }))
            .route("/invalid/models", get(|| async { "<html>login</html>" }))
            .route("/denied/models", get(|| async {
                (StatusCode::UNAUTHORIZED, "upstream detail containing test-secret")
            }))
            .route("/redirect/models", get(|| async {
                (StatusCode::TEMPORARY_REDIRECT, [("location", "/valid/models")]).into_response()
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        let result = model_catalog::fetch(&format!("http://{address}/valid"), "test-secret", "").await.unwrap();
        assert!(result.success);
        assert_eq!(result.models, vec!["example-model"]);
        for path in ["invalid", "denied", "redirect"] {
            let result = model_catalog::fetch(&format!("http://{address}/{path}"), "test-secret", "").await.unwrap();
            assert!(!result.success, "{path} must not be reported as connected");
            assert!(!result.message.contains("test-secret"));
            if path == "denied" { assert!(result.message.contains("鉴权失败")); }
        }
        server.abort();
    }
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
    Json(mut payload): Json<ModelRouteRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ModelRouteResponse>>), AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant = authorization::resolved_tenant_id(&state, &user)
        .await?
        .to_string();
    validate(&payload, true)?;
    let tx = state.db.begin().await?;
    lock_provider_names(&tx, &tenant, &user.id.to_string()).await?;
    let names = tx.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT name FROM byom_model_routes WHERE tenant_id=$1::uuid AND created_by_user_id=$2::uuid",
        vec![value(&tenant),value(&user.id.to_string())])).await?;
    let names = names.iter().map(|row|row.try_get::<String>("","name")).collect::<Result<Vec<_>,_>>()?;
    let base = payload.name.trim().to_owned();
    payload.name = base.clone();
    let mut suffix = 1;
    while names.iter().any(|name| name.to_lowercase() == payload.name.to_lowercase()) {
        payload.name = format!("{base}_{suffix}");
        suffix += 1;
    }
    let rows = list_raw(&state, &tenant, &user.id.to_string()).await?;
    let is_default = payload.enabled && payload.provider_type == "chat" && (payload.is_default || !rows.iter().any(|route| route.provider_type == "chat" && route.is_default));
    if is_default {
        clear_default(&tx, &tenant, None).await?;
    }
    let id = format!("model-{}", Uuid::new_v4().simple());
    tx.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "INSERT INTO byom_model_routes (id, tenant_id, created_by_user_id, name, api_base_url, encrypted_api_key, model, enabled, is_default, thinking_enabled, reasoning_protocol, default_reasoning_effort, provider_type) VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)", vec![
        value(&id), value(&tenant), value(&user.id.to_string()), value(payload.name.trim()), value(payload.api_base_url.trim().trim_end_matches('/')), value(&match payload.api_key.as_deref().filter(|key|!key.trim().is_empty()) {Some(key)=>encrypt(key)?,None=>String::new()}), value(payload.model.trim()), bool_value(payload.enabled), bool_value(is_default), bool_value(payload.provider_type == "chat" && payload.thinking_enabled), value(&payload.reasoning_protocol), value(&payload.default_reasoning_effort), value(&payload.provider_type),
    ])).await?;
    tx.commit().await?;
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
    let tx = state.db.begin().await?;
    lock_provider_names(&tx, &tenant, &user.id.to_string()).await?;
    if tx.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT id FROM byom_model_routes WHERE tenant_id=$1::uuid AND created_by_user_id=$2::uuid AND lower(name)=lower($3) AND id<>$4",
        vec![value(&tenant),value(&user.id.to_string()),value(payload.name.trim()),value(&id)])).await?.is_some() {
        return Err(AppError::Conflict("供应商名称已存在，请使用其他名称".into()));
    }
    let current = list_raw(&state, &tenant, &user.id.to_string())
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("model route not found".to_string()))?;
    if payload.provider_type == "chat" && payload.is_default {
        clear_default(&tx, &tenant, Some(&id)).await?;
    }
    let encrypted_key = match payload
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        Some(key) => encrypt(key)?,
        None => current.encrypted_api_key,
    };
    if payload.enabled && encrypted_key.is_empty() {return Err(AppError::BadRequest("启用前请配置 API 密钥".into()));}
    tx.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres, "UPDATE byom_model_routes SET name = $1, api_base_url = $2, encrypted_api_key = $3, model = $4, enabled = $5, is_default = $6, thinking_enabled = $10, reasoning_protocol = $11, default_reasoning_effort = $12, provider_type = $13, updated_at = now() WHERE id = $7 AND tenant_id = $8::uuid AND created_by_user_id = $9::uuid", vec![
        value(payload.name.trim()), value(payload.api_base_url.trim().trim_end_matches('/')), value(&encrypted_key), value(payload.model.trim()), bool_value(payload.enabled), bool_value(payload.provider_type == "chat" && payload.is_default), value(&id), value(&tenant), value(&user.id.to_string()), bool_value(payload.provider_type == "chat" && payload.thinking_enabled), value(&payload.reasoning_protocol), value(&payload.default_reasoning_effort), value(&payload.provider_type),
    ])).await?;
    tx.commit().await?;
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

/// Resolve a route only after the caller has authenticated the execution subject.
pub(crate) async fn resolve_subject_route(
    state: &AppState,
    tenant: &str,
    user_id: &str,
    query: RuntimeModelRouteQuery,
) -> Result<RuntimeModelRoute, AppError> {
    let mut query = query;
    if let (Some(original), Some(model)) = (&query.route_id, &query.model) {
        let alias = state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
            "SELECT a.route_id FROM byom_model_route_aliases a JOIN byom_model_routes r ON r.id=a.route_id WHERE a.original_route_id=$1 AND a.model=$2 AND r.tenant_id=$3::uuid AND r.created_by_user_id=$4::uuid",
            vec![value(original),value(model),value(tenant),value(user_id)])).await?;
        if let Some(alias) = alias { query.route_id = Some(alias.try_get("", "route_id")?); }
    }
    let routes = list_raw(state, tenant, user_id).await?;
    let route = routes
        .into_iter()
        .find(|item| {
            item.enabled
                && item.provider_type == "chat"
                && query
                    .route_id
                    .as_deref()
                    .map_or(item.is_default, |id| item.id == id)
        })
        .ok_or_else(|| AppError::BadRequest("请先在自有模型中配置并启用默认模型".to_string()))?;
    let chat_model = query.model.unwrap_or_else(|| route.model.clone());
    if chat_model != route.model {
        return Err(AppError::BadRequest("所选模型不属于该模型路由".to_string()));
    }
    Ok(RuntimeModelRoute {
        id: route.id,
        api_base_url: route.api_base_url,
        api_key: decrypt(&route.encrypted_api_key)?,
        chat_model,
        thinking_enabled: route.thinking_enabled,
        reasoning_protocol: route.reasoning_protocol,
        default_reasoning_effort: route.default_reasoning_effort,
                })
}

#[derive(Clone)]
struct StoredRoute {
    id: String,
    provider_type: String,
    name: String,
    api_base_url: String,
    encrypted_api_key: String,
    model: String,
    thinking_enabled: bool,
    reasoning_protocol: String,
    default_reasoning_effort: String,
    enabled: bool,
    is_default: bool,
}
impl StoredRoute {
    fn public(&self) -> ModelRouteResponse {
        ModelRouteResponse {
            id: self.id.clone(),
            provider_type: self.provider_type.clone(),
            name: self.name.clone(),
            api_base_url: self.api_base_url.clone(),
            model: self.model.clone(),
            thinking_enabled: self.thinking_enabled,
            reasoning_protocol: self.reasoning_protocol.clone(),
            default_reasoning_effort: self.default_reasoning_effort.clone(),
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
    let statement = Statement::from_sql_and_values(DatabaseBackend::Postgres, "SELECT id, name, api_base_url, encrypted_api_key, model, enabled, is_default, thinking_enabled, reasoning_protocol, default_reasoning_effort, provider_type FROM byom_model_routes WHERE tenant_id = $1::uuid AND created_by_user_id = $2::uuid ORDER BY is_default DESC, name ASC".to_string(), vec![value(tenant), value(user_id)]);
    let rows = state.db.query_all_raw(statement).await?;
    rows.into_iter()
        .map(|row| {
            Ok(StoredRoute {
                id: row.try_get("", "id")?,
                provider_type: row.try_get("", "provider_type")?,
                name: row.try_get("", "name")?,
                api_base_url: row.try_get("", "api_base_url")?,
                encrypted_api_key: row.try_get("", "encrypted_api_key")?,
                model: row.try_get("", "model")?,
                thinking_enabled: row.try_get("", "thinking_enabled")?,
                reasoning_protocol: row.try_get("", "reasoning_protocol")?,
                default_reasoning_effort: row.try_get("", "default_reasoning_effort")?,
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
async fn clear_default<C: ConnectionTrait>(
    db: &C,
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
    db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,sql,values)).await?;
    Ok(())
}
fn value(input: &str) -> sea_orm::Value {
    sea_orm::Value::String(Some(input.to_string()))
}
fn bool_value(input: bool) -> sea_orm::Value {
    sea_orm::Value::Bool(Some(input))
}
fn validate(payload: &ModelRouteRequest, require_key: bool) -> Result<(), AppError> {
    if !matches!(payload.provider_type.as_str(), "chat" | "speech_to_text" | "text_to_speech" | "judgment" | "embedding" | "reranker") {
        return Err(AppError::BadRequest("不支持的模型类型".into()));
    }
    if payload.provider_type == "chat" && !matches!(
        payload.reasoning_protocol.as_str(),
        "openai" | "deepseek" | "qwen" | "openrouter"
    ) {
        return Err(AppError::BadRequest("不支持的思考参数协议".into()));
    }
    if payload.provider_type == "chat" && payload.default_reasoning_effort != "auto" && !reasoning_efforts(&payload.reasoning_protocol).contains(&payload.default_reasoning_effort.as_str()) {
        return Err(AppError::BadRequest("思考强度与供应商协议不兼容".into()));
    }
    if payload.name.trim().is_empty()
        || payload.api_base_url.trim().is_empty()
        || (payload.enabled && payload.model.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "名称、API 地址及模型不能为空".to_string(),
        ));
    }
    if payload.model.contains([',', '，', '\n', '\r']) {
        return Err(AppError::BadRequest("每条供应商配置只支持一个模型 ID".into()));
    }
    if !(payload.api_base_url.starts_with("https://")
        || payload.api_base_url.starts_with("http://"))
    {
        return Err(AppError::BadRequest(
            "API 地址必须使用 HTTP 或 HTTPS".to_string(),
        ));
    }
    if require_key && payload.enabled
        && payload
            .api_key
            .as_deref()
            .is_none_or(|key| key.trim().is_empty())
    {
        return Err(AppError::BadRequest("API 密钥不能为空".to_string()));
    }
    Ok(())
}

async fn lock_provider_names<C: ConnectionTrait>(db:&C,tenant:&str,user:&str)->Result<(),AppError>{
    db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",vec![value(&format!("model-provider:{tenant}:{user}"))])).await?;
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
pub(crate) fn encrypt(plain: &str) -> Result<String, AppError> {
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
pub(crate) fn decrypt(encoded: &str) -> Result<String, AppError> {
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

/// Server-owned protocol options; never configured by employee or provider users.
pub(crate) fn reasoning_efforts(protocol: &str) -> &'static [&'static str] {
    match protocol {
        "qwen" => &[],
        "deepseek" => &["high", "extreme"],
        _ => &["low", "medium", "high", "ultra", "extreme"],
    }
}

/// Explicitly publish an owned connection into the platform knowledge service.
/// Already-published connections may be reused by other platform administrators.
/// Encrypted bytes stay server-side; personal chat routes remain independent.
pub(crate) async fn knowledge_connection(state:&AppState,user:Uuid,deployment:Uuid,route:&str,provider_type:&str,model:&str)->Result<(String,String,String),AppError>{
    let row=state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT name,api_base_url,encrypted_api_key FROM byom_model_routes WHERE id=$1 AND created_by_user_id=$2::uuid AND enabled AND provider_type=$4 AND model=$5 UNION ALL SELECT name,api_base_url,encrypted_api_key FROM knowledge_provider_connections WHERE route_id=$1 AND deployment_id=$3::uuid AND provider_type=$4 AND models @> jsonb_build_array($5::text) LIMIT 1",
        vec![value(route),value(&user.to_string()),value(&deployment.to_string()),value(provider_type),value(model)])).await?
        .ok_or_else(||AppError::Forbidden("请选择已发布的平台连接或自己已启用的供应商连接".into()))?;
    Ok((row.try_get("","name")?,row.try_get("","api_base_url")?,row.try_get("","encrypted_api_key")?))
}
pub(crate) async fn platform_knowledge_provider(state:&AppState,deployment:Uuid,route:&str,provider_type:&str)->Result<(String,String),AppError>{
    let row=state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT api_base_url,encrypted_api_key FROM knowledge_provider_connections WHERE deployment_id=$1::uuid AND route_id=$2 AND provider_type=$3",
        vec![value(&deployment.to_string()),value(route),value(provider_type)])).await?
        .ok_or_else(||AppError::Conflict("平台知识检索连接未配置".into()))?;
    Ok((row.try_get("","api_base_url")?,decrypt(&row.try_get::<String>("","encrypted_api_key")?)?))
}
