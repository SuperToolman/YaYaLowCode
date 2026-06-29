mod app_entity;
mod app_navigation_entity;
mod automation_flow_entity;
mod automation_flow_version_entity;
mod automation_run_entity;
mod automation_run_node_entity;
mod automation_node_entity;
mod automation_edge_entity;
mod config;
mod form_definition_entity;
mod form_record_entity;
mod form_schema_entity;
mod migrator;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;

use app_entity::Entity as AppEntity;
use app_navigation_entity::Entity as AppNavigationEntity;
use automation_edge_entity::Entity as AutomationEdgeEntity;
use automation_flow_entity::Entity as AutomationFlowEntity;
use automation_flow_version_entity::Entity as AutomationFlowVersionEntity;
use automation_run_entity::Entity as AutomationRunEntity;
use automation_run_node_entity::Entity as AutomationRunNodeEntity;
use automation_node_entity::Entity as AutomationNodeEntity;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use config::AppConfig;
use form_definition_entity::Entity as FormDefinitionEntity;
use form_record_entity::Entity as FormRecordEntity;
use form_schema_entity::Entity as FormSchemaEntity;
use sea_orm::entity::prelude::*;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use sea_orm_migration::MigratorTrait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: DatabaseConnection,
}

#[derive(Clone)]
struct AutomationExecutionContext {
    outputs: HashMap<String, Value>,
    operator: String,
    run_id: Option<Uuid>,
}

#[derive(Clone, Copy)]
enum RetrySource {
    Flow,
    Node,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ApiResponse<T>
where
    T: Serialize,
{
    code: i32,
    message: String,
    data: Option<T>,
    time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiApp {
    id: String,
    name: String,
    desc: String,
    icon: String,
    badge: Option<String>,
    color: String,
    status: String,
    created_at: String,
    owner: String,
    records: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiFormSummary {
    id: String,
    name: String,
    category: String,
    count: Option<i32>,
    status: String,
    latest_schema_version: i32,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiSchemaPayload {
    form_uuid: String,
    schema: Value,
    version: i32,
    draft_version: i32,
    published_version: i32,
    latest_version: i32,
    published: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiFormVersionSummary {
    version: i32,
    published: bool,
    is_current_draft: bool,
    is_current_published: bool,
    change_log: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiNavigationItem {
    id: String,
    item_type: String,
    target_form_uuid: Option<String>,
    title: String,
    path_slug: String,
    sort_order: i32,
    is_default_entry: bool,
    parent_id: Option<String>,
    visibility_rule: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiFormRecord {
    id: String,
    form_uuid: String,
    schema_version: i32,
    data: Value,
    created_by: String,
    updated_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiFormRecordList {
    items: Vec<ApiFormRecord>,
    total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationFlow {
    id: String,
    app_id: String,
    name: String,
    description: Option<String>,
    status: String,
    current_version: i32,
    trigger_form_uuid: Option<String>,
    trigger_event: String,
    trigger_label: String,
    nodes_count: usize,
    created_by: String,
    updated_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationFlowDetail {
    id: String,
    app_id: String,
    name: String,
    description: Option<String>,
    status: String,
    current_version: i32,
    trigger_form_uuid: Option<String>,
    trigger_event: String,
    trigger_label: String,
    trigger_config: Value,
    nodes: Value,
    edges: Value,
    nodes_count: usize,
    created_by: String,
    updated_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationFlowVersionSummary {
    version: i32,
    name: String,
    status: String,
    created_by: String,
    created_at: String,
    change_summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationFlowList {
    items: Vec<ApiAutomationFlow>,
    total: i64,
    enabled: i64,
    paused: i64,
    draft: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationRunNode {
    id: String,
    node_key: String,
    node_kind: String,
    node_label: String,
    status: String,
    input: Value,
    output: Option<Value>,
    error_message: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    duration_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiAutomationRun {
    id: String,
    flow_version: i32,
    trigger_event: String,
    trigger_payload: Value,
    status: String,
    retry_source: Option<String>,
    retry_run_uuid: Option<String>,
    retry_node_key: Option<String>,
    error_message: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    duration_ms: Option<i64>,
    nodes: Vec<ApiAutomationRunNode>,
}

#[derive(Debug, Deserialize)]
struct CreateAppRequest {
    name: Option<String>,
    owner: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateAppRequest {
    name: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SaveSchemaRequest {
    schema: Value,
    change_log: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestoreVersionRequest {
    change_log: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateFormRecordRequest {
    data: Value,
    operator: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateFormRecordRequest {
    data: Value,
    operator: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAutomationFlowRequest {
    name: Option<String>,
    description: Option<String>,
    trigger_form_uuid: Option<String>,
    trigger_event: Option<String>,
    operator: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAutomationFlowRequest {
    name: Option<String>,
    description: Option<String>,
    status: Option<String>,
    trigger_form_uuid: Option<String>,
    trigger_event: Option<String>,
    trigger_config: Option<Value>,
    nodes: Option<Value>,
    edges: Option<Value>,
    change_summary: Option<String>,
    operator: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateNavigationGroupRequest {
    title: String,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReorderNavigationRequest {
    item_id: String,
    target_item_id: String,
    placement: String,
}

#[derive(Debug, Deserialize)]
struct GetSchemaQuery {
    scope: Option<String>,
    version: Option<i32>,
}

#[derive(Debug)]
enum AppError {
    Database(DbErr),
    NotFound(String),
    BadRequest(String),
    Address(std::net::AddrParseError),
    Server(std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::Database(err) => {
                error!("database error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "database error")),
                )
                    .into_response()
            }
            Self::NotFound(message) => {
                (StatusCode::NOT_FOUND, Json(error_response(404, message))).into_response()
            }
            Self::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(error_response(400, message))).into_response()
            }
            Self::Address(err) => {
                error!("address parse error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "server configuration error")),
                )
                    .into_response()
            }
            Self::Server(err) => {
                error!("server error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "server error")),
                )
                    .into_response()
            }
        }
    }
}

impl From<DbErr> for AppError {
    fn from(value: DbErr) -> Self {
        Self::Database(value)
    }
}

impl From<std::net::AddrParseError> for AppError {
    fn from(value: std::net::AddrParseError) -> Self {
        Self::Address(value)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Server(value)
    }
}

#[tokio::main]
async fn main() -> Result<(), AppError> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=info,tower_http=info".into()),
        )
        .init();

    let config = AppConfig::from_env();
    let db = Database::connect(&config.database_url).await?;

    migrator::Migrator::up(&db, None).await?;
    ensure_form_tables(&db).await?;
    ensure_automation_tables(&db).await?;
    ensure_system_navigation_items(&db).await?;

    let state = AppState { db };
    let app = Router::new()
        .route("/healthz", get(health_check))
        .route("/api/apps", get(list_apps).post(create_app))
        .route("/api/apps/{app_id}", patch(update_app).delete(delete_app))
        .route(
            "/api/apps/{app_id}/navigation",
            get(list_navigation_items).patch(reorder_navigation_item),
        )
        .route(
            "/api/apps/{app_id}/navigation/groups",
            post(create_navigation_group),
        )
        .route(
            "/api/apps/{app_id}/forms",
            get(list_forms).post(create_form),
        )
        .route(
            "/api/apps/{app_id}/automations",
            get(list_automation_flows).post(create_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}",
            get(get_automation_flow)
                .patch(update_automation_flow)
                .delete(delete_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}/versions",
            get(list_automation_flow_versions),
        )
        .route(
            "/api/automations/{flow_uuid}/versions/{version}/restore",
            post(restore_automation_flow_version),
        )
        .route(
            "/api/automations/{flow_uuid}/runs",
            get(list_automation_flow_runs),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/retry",
            post(retry_automation_flow_run),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/nodes/{node_key}/retry",
            post(retry_automation_flow_run_node),
        )
        .route("/api/forms/{form_uuid}/schema", get(get_form_schema))
        .route(
            "/api/forms/{form_uuid}/records",
            get(list_form_records).post(create_form_record),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}",
            patch(update_form_record).delete(delete_form_record),
        )
        .route("/api/forms/{form_uuid}/versions", get(list_form_versions))
        .route(
            "/api/forms/{form_uuid}/versions/{version}",
            get(get_form_version),
        )
        .route("/api/forms/{form_uuid}/publish", post(publish_form_schema))
        .route(
            "/api/forms/{form_uuid}/versions/{version}/restore",
            post(restore_form_version),
        )
        .route(
            "/api/forms/{form_uuid}/schema/draft",
            post(save_form_schema),
        )
        .route("/api/forms/{form_uuid}", axum::routing::delete(delete_form))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    info!("backend listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await.map_err(AppError::from)
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn list_apps(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ApiApp>>>, AppError> {
    let items = AppEntity::find()
        .order_by_desc(app_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取应用列表成功",
        items.into_iter().map(ApiApp::from).collect(),
    )))
}

async fn create_app(
    State(state): State<AppState>,
    payload: Option<Json<CreateAppRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiApp>>), AppError> {
    let payload = payload
        .map(|Json(value)| value)
        .unwrap_or(CreateAppRequest {
            name: None,
            owner: None,
        });
    let now = Utc::now();
    let route_app_id = generate_route_app_id();
    let app_name = payload
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("未命名应用 {}", now.format("%m%d%H%M")));
    let owner_name = payload
        .owner
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "管理员".to_string());

    let active_model = app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set(route_app_id),
        name: Set(app_name),
        description: Set("空白应用".to_string()),
        icon: Set("general".to_string()),
        badge: Set(None),
        color: Set("bg-[#edf4ff] text-[#3b82f6]".to_string()),
        status: Set("paused".to_string()),
        owner_name: Set(owner_name),
        records_count: Set(0),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    };

    let created = active_model.insert(&state.db).await?;
    ensure_system_navigation_for_app(&state.db, &created.route_app_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response("创建应用成功", ApiApp::from(created))),
    ))
}

async fn update_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<UpdateAppRequest>,
) -> Result<Json<ApiResponse<ApiApp>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let mut active_model: app_entity::ActiveModel = app.into();
    let now = Utc::now();

    if let Some(name) = payload.name {
        let next_name = name.trim();
        if !next_name.is_empty() {
            active_model.name = Set(next_name.to_string());
        }
    }

    if let Some(status) = payload.status {
        if matches!(status.as_str(), "enabled" | "paused") {
            active_model.status = Set(status);
        }
    }

    active_model.updated_at = Set(now.into());
    let updated = active_model.update(&state.db).await?;

    Ok(Json(success_response(
        "更新应用成功",
        ApiApp::from(updated),
    )))
}

async fn delete_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let form_uuids = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|item| item.form_uuid)
        .collect::<Vec<_>>();

    let txn = state.db.begin().await?;

    for form_uuid in form_uuids {
        FormRecordEntity::delete_many()
            .filter(form_record_entity::Column::FormUuid.eq(form_uuid.clone()))
            .exec(&txn)
            .await?;
        FormSchemaEntity::delete_many()
            .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
            .exec(&txn)
            .await?;
        FormDefinitionEntity::delete_many()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
            .exec(&txn)
            .await?;
    }

    AppNavigationEntity::delete_many()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .exec(&txn)
        .await?;

    let flow_ids = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app.route_app_id.clone()))
        .all(&txn)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();

    if !flow_ids.is_empty() {
        AutomationFlowVersionEntity::delete_many()
            .filter(automation_flow_version_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationNodeEntity::delete_many()
            .filter(automation_node_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationEdgeEntity::delete_many()
            .filter(automation_edge_entity::Column::FlowId.is_in(flow_ids))
            .exec(&txn)
            .await?;
    }

    AutomationFlowEntity::delete_many()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app.route_app_id.clone()))
        .exec(&txn)
        .await?;

    AppEntity::delete_many()
        .filter(app_entity::Column::Id.eq(app.id))
        .exec(&txn)
        .await?;

    txn.commit().await?;

    Ok(Json(success_response(
        "删除应用成功",
        json!({ "deleted": true }),
    )))
}

async fn list_forms(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiFormSummary>>>, AppError> {
    let forms = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_desc(form_definition_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取表单列表成功",
        forms.into_iter().map(ApiFormSummary::from).collect(),
    )))
}

async fn list_automation_flows(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<ApiAutomationFlowList>>, AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_desc(automation_flow_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    let total = flows.len() as i64;
    let enabled = flows.iter().filter(|flow| flow.status == "enabled").count() as i64;
    let paused = flows.iter().filter(|flow| flow.status == "paused").count() as i64;
    let draft = flows.iter().filter(|flow| flow.status == "draft").count() as i64;

    Ok(Json(success_response(
        "获取集成自动化列表成功",
        ApiAutomationFlowList {
            items: flows.into_iter().map(ApiAutomationFlow::from).collect(),
            total,
            enabled,
            paused,
            draft,
        },
    )))
}

async fn create_automation_flow(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    payload: Option<Json<CreateAutomationFlowRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAutomationFlow>>), AppError> {
    AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let payload = payload
        .map(|Json(value)| value)
        .unwrap_or(CreateAutomationFlowRequest {
            name: None,
            description: None,
            trigger_form_uuid: None,
            trigger_event: None,
            operator: None,
        });
    let now = Utc::now();
    let operator = normalize_operator(payload.operator);
    let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
    let trigger_event = normalize_automation_trigger_event(
        payload.trigger_event.as_deref().unwrap_or("after_create"),
    )?;

    if let Some(form_uuid) = trigger_form_uuid.as_deref() {
        ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
    }

    let txn = state.db.begin().await?;
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set(generate_automation_flow_uuid()),
        app_route_app_id: Set(app_id),
        name: Set(normalize_optional_text(payload.name)
            .unwrap_or_else(|| format!("未命名自动化 {}", now.format("%m%d%H%M")))),
        description: Set(normalize_optional_text(payload.description)),
        status: Set("draft".to_string()),
        current_version: Set(1),
        trigger_form_uuid: Set(trigger_form_uuid),
        trigger_event: Set(trigger_event),
        trigger_config: Set(json!({})),
        nodes_json: Set(json!([])),
        edges_json: Set(json!([])),
        created_by: Set(operator.clone()),
        updated_by: Set(operator),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;

    create_automation_snapshot(&txn, &flow, None).await?;
    txn.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建集成自动化成功",
            ApiAutomationFlow::from(flow),
        )),
    ))
}

async fn get_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiAutomationFlowDetail>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    Ok(Json(success_response(
        "获取集成自动化详情成功",
        ApiAutomationFlowDetail::from(flow),
    )))
}

async fn list_automation_flow_versions(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAutomationFlowVersionSummary>>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let versions = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .order_by_desc(automation_flow_version_entity::Column::Version)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取自动化版本列表成功",
        versions
            .into_iter()
            .map(ApiAutomationFlowVersionSummary::from)
            .collect(),
    )))
}

async fn restore_automation_flow_version(
    State(state): State<AppState>,
    Path((flow_uuid, version)): Path<(String, i32)>,
    payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiAutomationFlowDetail>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let snapshot = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow version not found".to_string()))?;

    let now = Utc::now();
    let next_version = flow.current_version + 1;
    let change_summary = payload
        .and_then(|Json(value)| value.change_log)
        .unwrap_or_else(|| format!("restored from v{version}"));

    let mut active_model: automation_flow_entity::ActiveModel = flow.into();
    active_model.name = Set(snapshot.name.clone());
    active_model.description = Set(snapshot.description.clone());
    active_model.status = Set(snapshot.status.clone());
    active_model.current_version = Set(next_version);
    active_model.trigger_form_uuid = Set(snapshot.trigger_form_uuid.clone());
    active_model.trigger_event = Set(snapshot.trigger_event.clone());
    active_model.trigger_config = Set(snapshot.trigger_config.clone());
    active_model.nodes_json = Set(snapshot.nodes_json.clone());
    active_model.edges_json = Set(snapshot.edges_json.clone());
    active_model.updated_by = Set(snapshot.created_by.clone());
    active_model.updated_at = Set(now.into());

    let txn = state.db.begin().await?;
    let updated = active_model.update(&txn).await?;
    create_automation_snapshot(&txn, &updated, Some(change_summary)).await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "恢复自动化版本成功",
        ApiAutomationFlowDetail::from(updated),
    )))
}

async fn list_automation_flow_runs(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAutomationRun>>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let runs = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .order_by_desc(automation_run_entity::Column::StartedAt)
        .all(&state.db)
        .await?;
    let run_ids = runs.iter().map(|item| item.id).collect::<Vec<_>>();
    let node_logs = if run_ids.is_empty() {
        Vec::new()
    } else {
        AutomationRunNodeEntity::find()
            .filter(automation_run_node_entity::Column::RunId.is_in(run_ids))
            .order_by_asc(automation_run_node_entity::Column::StartedAt)
            .all(&state.db)
            .await?
    };
    let mut node_map: HashMap<Uuid, Vec<ApiAutomationRunNode>> = HashMap::new();
    for node in node_logs {
        node_map.entry(node.run_id).or_default().push(ApiAutomationRunNode::from(node));
    }

    Ok(Json(success_response(
        "获取自动化运行日志成功",
        runs.into_iter()
            .map(|run| ApiAutomationRun {
                id: run.run_uuid.clone(),
                flow_version: run.flow_version,
                trigger_event: run.trigger_event.clone(),
                trigger_payload: run.trigger_payload.clone(),
                status: run.status.clone(),
                retry_source: run.retry_source.clone(),
                retry_run_uuid: run.retry_run_uuid.clone(),
                retry_node_key: run.retry_node_key.clone(),
                error_message: run.error_message.clone(),
                started_at: run.started_at.to_rfc3339(),
                finished_at: run.finished_at.map(|value| value.to_rfc3339()),
                duration_ms: calculate_duration_ms(run.started_at, run.finished_at),
                nodes: node_map.remove(&run.id).unwrap_or_default(),
            })
            .collect::<Vec<_>>(),
    )))
}

async fn retry_automation_flow_run(
    State(state): State<AppState>,
    Path((flow_uuid, run_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    retry_automation_run_internal(&state.db, &flow_uuid, &run_uuid, None).await?;
    Ok(Json(success_response(
        "自动化已重新触发",
        json!({ "retried": true }),
    )))
}

async fn retry_automation_flow_run_node(
    State(state): State<AppState>,
    Path((flow_uuid, run_uuid, node_key)): Path<(String, String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    retry_automation_run_internal(&state.db, &flow_uuid, &run_uuid, Some(node_key)).await?;
    Ok(Json(success_response(
        "错误节点已发起重试",
        json!({ "retried": true }),
    )))
}

async fn update_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
    Json(payload): Json<UpdateAutomationFlowRequest>,
) -> Result<Json<ApiResponse<ApiAutomationFlow>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let now = Utc::now();
    let app_id = flow.app_route_app_id.clone();
    let flow_id = flow.id;
    let next_version = flow.current_version + 1;
    let existing_nodes_json = flow.nodes_json.clone();
    let existing_edges_json = flow.edges_json.clone();
    let mut active_model: automation_flow_entity::ActiveModel = flow.into();
    let mut should_create_version = false;
    let mut next_nodes_json = existing_nodes_json.clone();
    let mut next_edges_json = existing_edges_json.clone();
    let mut nodes_updated = false;
    let mut edges_updated = false;

    if let Some(name) = payload.name {
        let next_name = name.trim();
        if !next_name.is_empty() {
            active_model.name = Set(next_name.to_string());
            should_create_version = true;
        }
    }

    if payload.description.is_some() {
        active_model.description = Set(normalize_optional_text(payload.description));
        should_create_version = true;
    }

    if let Some(status) = payload.status {
        active_model.status = Set(normalize_automation_status(&status)?);
        should_create_version = true;
    }

    if let Some(trigger_event) = payload.trigger_event {
        active_model.trigger_event = Set(normalize_automation_trigger_event(&trigger_event)?);
        should_create_version = true;
    }

    if payload.trigger_form_uuid.is_some() {
        let trigger_form_uuid = normalize_optional_text(payload.trigger_form_uuid);
        if let Some(form_uuid) = trigger_form_uuid.as_deref() {
            ensure_form_belongs_to_app(&state.db, &app_id, form_uuid).await?;
        }
        active_model.trigger_form_uuid = Set(trigger_form_uuid);
        should_create_version = true;
    }

    if let Some(trigger_config) = payload.trigger_config {
        active_model.trigger_config = Set(normalize_json_object(trigger_config));
        should_create_version = true;
    }

    if let Some(nodes) = payload.nodes {
        next_nodes_json = normalize_automation_nodes(nodes)?;
        should_create_version = true;
        nodes_updated = true;
    }

    if let Some(edges) = payload.edges {
        next_edges_json = normalize_automation_edges(edges)?;
        should_create_version = true;
        edges_updated = true;
    }

    validate_automation_graph(&next_nodes_json, &next_edges_json)?;
    ensure_automation_node_forms_belong_to_app(&state.db, &app_id, &next_nodes_json).await?;

    if nodes_updated {
        active_model.nodes_json = Set(next_nodes_json);
    }

    if edges_updated {
        active_model.edges_json = Set(next_edges_json);
    }

    if let Some(operator) = normalize_optional_text(payload.operator) {
        active_model.updated_by = Set(operator);
    }

    active_model.updated_at = Set(now.into());
    if should_create_version {
        active_model.current_version = Set(next_version);
    }
    let txn = state.db.begin().await?;
    let updated = active_model.update(&txn).await?;
    if should_create_version {
        create_automation_snapshot(&txn, &updated, payload.change_summary).await?;
    } else {
        sync_automation_graph_tables(&txn, flow_id, updated.current_version, &updated.nodes_json, &updated.edges_json).await?;
    }
    txn.commit().await?;

    Ok(Json(success_response(
        "更新集成自动化成功",
        ApiAutomationFlow::from(updated),
    )))
}

async fn delete_automation_flow(
    State(state): State<AppState>,
    Path(flow_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;

    let txn = state.db.begin().await?;
    AutomationFlowVersionEntity::delete_many()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationNodeEntity::delete_many()
        .filter(automation_node_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationEdgeEntity::delete_many()
        .filter(automation_edge_entity::Column::FlowId.eq(flow.id))
        .exec(&txn)
        .await?;
    AutomationFlowEntity::delete_many()
        .filter(automation_flow_entity::Column::Id.eq(flow.id))
        .exec(&txn)
        .await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "删除集成自动化成功",
        json!({ "deleted": true, "id": flow_uuid }),
    )))
}

async fn list_navigation_items(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiNavigationItem>>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取导航成功",
        items.into_iter().map(ApiNavigationItem::from).collect(),
    )))
}

async fn create_navigation_group(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<CreateNavigationGroupRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiNavigationItem>>), AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    let now = Utc::now();
    let title = payload.title.trim();

    if title.is_empty() {
        return Err(AppError::NotFound("group title required".to_string()));
    }

    let parent_uuid =
        resolve_group_parent_id(&state.db, &app_id, payload.parent_id.as_deref()).await?;
    let sort_order = next_navigation_sort_order(&state.db, &app_id, parent_uuid).await?;
    let group_slug = build_group_slug(title);

    let created = app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id.clone()),
        item_type: Set("group".to_string()),
        target_form_uuid: Set(None),
        title: Set(title.to_string()),
        path_slug: Set(group_slug),
        sort_order: Set(sort_order),
        is_default_entry: Set(false),
        parent_id: Set(parent_uuid),
        visibility_rule: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    normalize_navigation_orders(&state.db, &app_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建分组成功",
            ApiNavigationItem::from(created),
        )),
    ))
}

async fn reorder_navigation_item(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<ReorderNavigationRequest>,
) -> Result<Json<ApiResponse<Vec<ApiNavigationItem>>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    apply_navigation_reorder(&state.db, &app_id, &payload).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "更新导航顺序成功",
        items.into_iter().map(ApiNavigationItem::from).collect(),
    )))
}

async fn create_form(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormSummary>>), AppError> {
    let now = Utc::now();
    let form_uuid = generate_form_uuid();
    let form_name = "未命名表单".to_string();
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;
    let existing_form_count = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .filter(app_navigation_entity::Column::ItemType.eq("form"))
        .count(&state.db)
        .await? as i32;
    let has_default_entry = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .filter(app_navigation_entity::Column::IsDefaultEntry.eq(true))
        .count(&state.db)
        .await?
        > 0;
    let is_default_entry = !has_default_entry;
    let slug = build_form_slug(existing_form_count);
    let sort_order = next_navigation_sort_order(&state.db, &app_id, None).await?;
    let initial_schema = build_blank_schema(&form_uuid, &form_name);

    let definition = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id),
        form_uuid: Set(form_uuid.clone()),
        name: Set(form_name),
        slug: Set(slug),
        status: Set("draft".to_string()),
        draft_schema_version: Set(1),
        published_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(definition.app_route_app_id.clone()),
        item_type: Set("form".to_string()),
        target_form_uuid: Set(Some(definition.form_uuid.clone())),
        title: Set(definition.name.clone()),
        path_slug: Set(definition.slug.clone()),
        sort_order: Set(sort_order),
        is_default_entry: Set(is_default_entry),
        parent_id: Set(None),
        visibility_rule: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid),
        version: Set(1),
        schema_json: Set(initial_schema),
        change_log: Set(Some("initial version".to_string())),
        published: Set(true),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建表单成功",
            ApiFormSummary::from(definition),
        )),
    ))
}

async fn delete_form(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;

    FormRecordEntity::delete_many()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&state.db)
        .await?;

    FormSchemaEntity::delete_many()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&state.db)
        .await?;

    AppNavigationEntity::delete_many()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.clone())))
        .exec(&state.db)
        .await?;

    AutomationFlowEntity::delete_many()
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(Some(form_uuid.clone())))
        .exec(&state.db)
        .await?;

    FormDefinitionEntity::delete_many()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .exec(&state.db)
        .await?;

    let records_count = FormRecordEntity::find()
        .filter(form_record_entity::Column::AppRouteAppId.eq(definition.app_route_app_id.clone()))
        .count(&state.db)
        .await? as i64;

    if let Some(app) = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(definition.app_route_app_id))
        .one(&state.db)
        .await?
    {
        let now = Utc::now();
        let mut active_model: app_entity::ActiveModel = app.into();
        active_model.records_count = Set(records_count);
        active_model.updated_at = Set(now.into());
        active_model.update(&state.db).await?;
    }

    Ok(Json(success_response(
        "删除表单成功",
        json!({ "deleted": true }),
    )))
}

async fn get_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Query(query): Query<GetSchemaQuery>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let version = resolve_schema_version(&definition, &query);
    let schema = load_schema_version(&state.db, &form_uuid, version).await?;

    Ok(Json(success_response(
        "获取表单 Schema 成功",
        build_schema_payload(&definition, schema),
    )))
}

async fn list_form_records(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiFormRecordList>>, AppError> {
    find_form_definition(&state.db, &form_uuid).await?;

    let items = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    let total = items.len() as i64;

    Ok(Json(success_response(
        "获取表单数据成功",
        ApiFormRecordList {
            items: items.into_iter().map(ApiFormRecord::from).collect(),
            total,
        },
    )))
}

async fn create_form_record(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Json(payload): Json<CreateFormRecordRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormRecord>>), AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let now = Utc::now();
    let operator = normalize_operator(payload.operator);
    let trigger_data = normalize_record_payload(payload.data);

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_create",
        &trigger_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation before create failed: {err:?}");
    }

    let record = insert_form_record(
        &state.db,
        &definition,
        trigger_data,
        &operator,
        now,
    )
    .await?;

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_create",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation after create failed: {err:?}");
    }

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "提交表单数据成功",
            ApiFormRecord::from(record),
        )),
    ))
}

async fn update_form_record(
    State(state): State<AppState>,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<UpdateFormRecordRequest>,
) -> Result<Json<ApiResponse<ApiFormRecord>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let record = find_form_record(&state.db, &form_uuid, &record_uuid).await?;
    let operator = normalize_operator(payload.operator);
    let next_data = normalize_record_payload(payload.data);
    let changed_fields = collect_changed_fields(&record.record_data, &next_data);

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_update",
        &next_data,
        &operator,
        Some(&changed_fields),
    )
    .await
    {
        error!("run automation before update failed: {err:?}");
    }

    let now = Utc::now();
    let mut active_model: form_record_entity::ActiveModel = record.into();
    active_model.record_data = Set(next_data.clone());
    active_model.updated_by = Set(operator.clone());
    active_model.updated_at = Set(now.into());
    let updated = active_model.update(&state.db).await?;

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_update",
        &updated.record_data,
        &operator,
        Some(&changed_fields),
    )
    .await
    {
        error!("run automation after update failed: {err:?}");
    }

    Ok(Json(success_response(
        "更新表单数据成功",
        ApiFormRecord::from(updated),
    )))
}

async fn delete_form_record(
    State(state): State<AppState>,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let record = find_form_record(&state.db, &form_uuid, &record_uuid).await?;
    let operator = "管理员".to_string();

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_delete",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation before delete failed: {err:?}");
    }

    FormRecordEntity::delete_many()
        .filter(form_record_entity::Column::Id.eq(record.id))
        .exec(&state.db)
        .await?;
    decrement_app_records_count(&state.db, &definition.app_route_app_id, 1, Utc::now()).await?;

    if let Err(err) = execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_delete",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation after delete failed: {err:?}");
    }

    Ok(Json(success_response(
        "删除表单数据成功",
        json!({ "deleted": true, "recordId": record_uuid }),
    )))
}

async fn save_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Json(payload): Json<SaveSchemaRequest>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;

    let next_version = definition.latest_schema_version + 1;
    let now = Utc::now();
    let next_name = payload
        .schema
        .get("formName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名表单")
        .to_string();

    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid.clone()),
        version: Set(next_version),
        schema_json: Set(payload.schema.clone()),
        change_log: Set(payload.change_log.clone()),
        published: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.name = Set(next_name);
    definition_active.draft_schema_version = Set(next_version);
    definition_active.latest_schema_version = Set(next_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    sync_navigation_title(
        &state.db,
        &form_uuid,
        &updated_definition.name,
        &updated_definition.slug,
        now,
    )
    .await?;

    Ok(Json(success_response(
        "保存表单 Schema 成功",
        ApiSchemaPayload {
            form_uuid,
            schema: payload.schema,
            version: next_version,
            draft_version: updated_definition.draft_schema_version,
            published_version: updated_definition.published_schema_version,
            latest_version: updated_definition.latest_schema_version,
            published: false,
        },
    )))
}

async fn list_form_versions(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiFormVersionSummary>>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let versions = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_schema_entity::Column::Version)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取表单版本成功",
        versions
            .into_iter()
            .map(|item| ApiFormVersionSummary {
                version: item.version,
                published: item.published,
                is_current_draft: item.version == definition.draft_schema_version,
                is_current_published: item.version == definition.published_schema_version,
                change_log: item.change_log,
                created_at: item.created_at.to_rfc3339(),
            })
            .collect(),
    )))
}

async fn get_form_version(
    State(state): State<AppState>,
    Path((form_uuid, version)): Path<(String, i32)>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let schema = load_schema_version(&state.db, &form_uuid, version).await?;

    Ok(Json(success_response(
        "获取指定版本 Schema 成功",
        build_schema_payload(&definition, schema),
    )))
}

async fn publish_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let now = Utc::now();
    let draft_version = definition.draft_schema_version;

    if let Some(current_published) = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .filter(form_schema_entity::Column::Published.eq(true))
        .one(&state.db)
        .await?
    {
        let mut published_active: form_schema_entity::ActiveModel = current_published.into();
        published_active.published = Set(false);
        published_active.updated_at = Set(now.into());
        published_active.update(&state.db).await?;
    }

    let draft_schema = load_schema_version(&state.db, &form_uuid, draft_version).await?;
    let mut draft_active: form_schema_entity::ActiveModel = draft_schema.clone().into();
    draft_active.published = Set(true);
    draft_active.updated_at = Set(now.into());
    let published_schema = draft_active.update(&state.db).await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.published_schema_version = Set(draft_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    Ok(Json(success_response(
        "发布表单版本成功",
        build_schema_payload(&updated_definition, published_schema),
    )))
}

async fn restore_form_version(
    State(state): State<AppState>,
    Path((form_uuid, version)): Path<(String, i32)>,
    payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let source_schema = load_schema_version(&state.db, &form_uuid, version).await?;
    let now = Utc::now();
    let next_version = definition.latest_schema_version + 1;
    let next_name = source_schema
        .schema_json
        .get("formName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名表单")
        .to_string();
    let change_log = payload
        .and_then(|Json(value)| value.change_log)
        .unwrap_or_else(|| format!("restored from v{version}"));

    let restored_schema = form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid.clone()),
        version: Set(next_version),
        schema_json: Set(source_schema.schema_json.clone()),
        change_log: Set(Some(change_log)),
        published: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.name = Set(next_name);
    definition_active.draft_schema_version = Set(next_version);
    definition_active.latest_schema_version = Set(next_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    sync_navigation_title(
        &state.db,
        &form_uuid,
        &updated_definition.name,
        &updated_definition.slug,
        now,
    )
    .await?;

    Ok(Json(success_response(
        "恢复表单版本成功",
        build_schema_payload(&updated_definition, restored_schema),
    )))
}

impl From<app_entity::Model> for ApiApp {
    fn from(value: app_entity::Model) -> Self {
        Self {
            id: value.route_app_id,
            name: value.name,
            desc: value.description,
            icon: value.icon,
            badge: value.badge,
            color: value.color,
            status: value.status,
            created_at: format_date(value.created_at),
            owner: value.owner_name,
            records: value.records_count,
        }
    }
}

impl From<form_definition_entity::Model> for ApiFormSummary {
    fn from(value: form_definition_entity::Model) -> Self {
        Self {
            id: value.form_uuid,
            name: value.name,
            category: "group".to_string(),
            count: None,
            status: value.status,
            latest_schema_version: value.latest_schema_version,
            created_at: format_date(value.created_at),
        }
    }
}

impl From<app_navigation_entity::Model> for ApiNavigationItem {
    fn from(value: app_navigation_entity::Model) -> Self {
        Self {
            id: value.id.to_string(),
            item_type: value.item_type,
            target_form_uuid: value.target_form_uuid,
            title: value.title,
            path_slug: value.path_slug,
            sort_order: value.sort_order,
            is_default_entry: value.is_default_entry,
            parent_id: value.parent_id.map(|item| item.to_string()),
            visibility_rule: value.visibility_rule,
        }
    }
}

impl From<form_record_entity::Model> for ApiFormRecord {
    fn from(value: form_record_entity::Model) -> Self {
        Self {
            id: value.record_uuid,
            form_uuid: value.form_uuid,
            schema_version: value.schema_version,
            data: value.record_data,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}

impl From<automation_flow_entity::Model> for ApiAutomationFlow {
    fn from(value: automation_flow_entity::Model) -> Self {
        let nodes_count = value
            .nodes_json
            .as_array()
            .map(|items| items.len())
            .unwrap_or(0);

        Self {
            id: value.flow_uuid,
            app_id: value.app_route_app_id,
            name: value.name,
            description: value.description,
            status: value.status,
            current_version: value.current_version,
            trigger_form_uuid: value.trigger_form_uuid,
            trigger_label: automation_trigger_label(&value.trigger_event).to_string(),
            trigger_event: value.trigger_event,
            nodes_count,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}

impl From<automation_flow_entity::Model> for ApiAutomationFlowDetail {
    fn from(value: automation_flow_entity::Model) -> Self {
        let nodes_count = value
            .nodes_json
            .as_array()
            .map(|items| items.len())
            .unwrap_or(0);

        Self {
            id: value.flow_uuid,
            app_id: value.app_route_app_id,
            name: value.name,
            description: value.description,
            status: value.status,
            current_version: value.current_version,
            trigger_form_uuid: value.trigger_form_uuid,
            trigger_event: value.trigger_event.clone(),
            trigger_label: automation_trigger_label(&value.trigger_event).to_string(),
            trigger_config: value.trigger_config,
            nodes: value.nodes_json,
            edges: value.edges_json,
            nodes_count,
            created_by: value.created_by,
            updated_by: value.updated_by,
            created_at: value.created_at.to_rfc3339(),
            updated_at: value.updated_at.to_rfc3339(),
        }
    }
}

impl From<automation_flow_version_entity::Model> for ApiAutomationFlowVersionSummary {
    fn from(value: automation_flow_version_entity::Model) -> Self {
        Self {
            version: value.version,
            name: value.name,
            status: value.status,
            created_by: value.created_by,
            created_at: value.created_at.to_rfc3339(),
            change_summary: value.change_summary,
        }
    }
}

impl From<automation_run_node_entity::Model> for ApiAutomationRunNode {
    fn from(value: automation_run_node_entity::Model) -> Self {
        Self {
            id: value.id.to_string(),
            node_key: value.node_key,
            node_kind: value.node_kind,
            node_label: value.node_label,
            status: value.status,
            input: value.input_json,
            output: value.output_json,
            error_message: value.error_message,
            started_at: value.started_at.to_rfc3339(),
            finished_at: value.finished_at.map(|item| item.to_rfc3339()),
            duration_ms: calculate_duration_ms(value.started_at, value.finished_at),
        }
    }
}

fn format_date(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%d").to_string()
}

fn calculate_duration_ms(
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
) -> Option<i64> {
    finished_at.map(|value| (value - started_at).num_milliseconds().max(0))
}

fn generate_route_app_id() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("APP_{}", &raw[..20])
}

fn generate_form_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("FORM-{}", &raw[..28])
}

fn generate_record_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("REC-{}", &raw[..28])
}

fn generate_automation_run_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("RUN-{}", &raw[..28])
}

fn generate_automation_flow_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("AUTO-{}", &raw[..27])
}

async fn insert_form_record<C>(
    db: &C,
    definition: &form_definition_entity::Model,
    data: Value,
    operator: &str,
    now: DateTime<Utc>,
) -> Result<form_record_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    let schema =
        load_schema_version_for_connection(db, &definition.form_uuid, definition.published_schema_version)
            .await?;

    let record = form_record_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        record_uuid: Set(generate_record_uuid()),
        app_route_app_id: Set(definition.app_route_app_id.clone()),
        form_uuid: Set(definition.form_uuid.clone()),
        schema_version: Set(schema.version),
        record_data: Set(normalize_record_payload(data)),
        created_by: Set(operator.to_string()),
        updated_by: Set(operator.to_string()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;

    increment_app_records_count(db, &definition.app_route_app_id, now).await?;
    Ok(record)
}

async fn increment_app_records_count<C>(
    db: &C,
    app_id: &str,
    now: DateTime<Utc>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    if let Some(app) = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(db)
        .await?
    {
        let next_records_count = app.records_count + 1;
        let mut active_model: app_entity::ActiveModel = app.into();
        active_model.records_count = Set(next_records_count);
        active_model.updated_at = Set(now.into());
        active_model.update(db).await?;
    }

    Ok(())
}

async fn create_automation_run<C>(
    db: &C,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    retry_source: Option<RetrySource>,
    retry_run_uuid: Option<&str>,
    retry_node_key: Option<&str>,
) -> Result<automation_run_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    let now = Utc::now();
    automation_run_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        run_uuid: Set(generate_automation_run_uuid()),
        flow_id: Set(flow.id),
        flow_version: Set(flow.current_version),
        trigger_event: Set(flow.trigger_event.clone()),
        trigger_payload: Set(trigger_data.clone()),
        status: Set("running".to_string()),
        retry_source: Set(retry_source.map(retry_source_label)),
        retry_run_uuid: Set(retry_run_uuid.map(ToString::to_string)),
        retry_node_key: Set(retry_node_key.map(ToString::to_string)),
        error_message: Set(None),
        started_at: Set(now.into()),
        finished_at: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await
    .map_err(AppError::from)
}

async fn finalize_automation_run<C>(
    db: &C,
    run_id: Uuid,
    status: &str,
    error_message: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::Id.eq(run_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run not found".to_string()))?;
    let now = Utc::now();
    let mut active_model: automation_run_entity::ActiveModel = run.into();
    active_model.status = Set(status.to_string());
    active_model.error_message = Set(error_message);
    active_model.finished_at = Set(Some(now.into()));
    active_model.updated_at = Set(now.into());
    active_model.update(db).await?;
    Ok(())
}

async fn create_automation_run_node_log<C>(
    db: &C,
    run_id: Uuid,
    node_key: &str,
    node_kind: &str,
    node_label: &str,
    input_json: Value,
) -> Result<Uuid, AppError>
where
    C: ConnectionTrait,
{
    let now = Utc::now();
    let id = Uuid::new_v4();
    automation_run_node_entity::ActiveModel {
        id: Set(id),
        run_id: Set(run_id),
        node_key: Set(node_key.to_string()),
        node_kind: Set(node_kind.to_string()),
        node_label: Set(node_label.to_string()),
        status: Set("running".to_string()),
        input_json: Set(input_json),
        output_json: Set(None),
        error_message: Set(None),
        started_at: Set(now.into()),
        finished_at: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;
    Ok(id)
}

async fn finalize_automation_run_node_log<C>(
    db: &C,
    log_id: Uuid,
    status: &str,
    output_json: Option<Value>,
    error_message: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let log = AutomationRunNodeEntity::find()
        .filter(automation_run_node_entity::Column::Id.eq(log_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run node log not found".to_string()))?;
    let now = Utc::now();
    let mut active_model: automation_run_node_entity::ActiveModel = log.into();
    active_model.status = Set(status.to_string());
    active_model.output_json = Set(output_json);
    active_model.error_message = Set(error_message);
    active_model.finished_at = Set(Some(now.into()));
    active_model.updated_at = Set(now.into());
    active_model.update(db).await?;
    Ok(())
}

async fn decrement_app_records_count<C>(
    db: &C,
    app_id: &str,
    count: i64,
    now: DateTime<Utc>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    if count <= 0 {
        return Ok(());
    }

    if let Some(app) = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(db)
        .await?
    {
        let next_records_count = (app.records_count - count).max(0);
        let mut active_model: app_entity::ActiveModel = app.into();
        active_model.records_count = Set(next_records_count);
        active_model.updated_at = Set(now.into());
        active_model.update(db).await?;
    }

    Ok(())
}

async fn execute_automation_flows_for_event(
    db: &DatabaseConnection,
    definition: &form_definition_entity::Model,
    trigger_event: &str,
    trigger_data: &Value,
    operator: &str,
    changed_fields: Option<&HashSet<String>>,
) -> Result<(), AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(definition.app_route_app_id.clone()))
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(Some(definition.form_uuid.clone())))
        .filter(automation_flow_entity::Column::TriggerEvent.eq(trigger_event))
        .filter(automation_flow_entity::Column::Status.eq("enabled"))
        .all(db)
        .await?;

    for flow in flows {
        if !flow_matches_changed_fields(&flow.trigger_config, changed_fields) {
            continue;
        }
        if let Err(err) = execute_automation_flow(db, &flow, trigger_data, operator, None, None, None).await {
            error!("execute automation flow failed, flow={}: {err:?}", flow.flow_uuid);
        }
    }

    Ok(())
}

async fn execute_automation_flow(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    operator: &str,
    retry_source: Option<RetrySource>,
    retry_run_uuid: Option<&str>,
    retry_node_key: Option<&str>,
) -> Result<(), AppError> {
    let run = create_automation_run(
        db,
        flow,
        trigger_data,
        retry_source,
        retry_run_uuid,
        retry_node_key,
    )
    .await?;
    let nodes = json_array_items(&flow.nodes_json);
    let edges = json_array_items(&flow.edges_json);
    if nodes.is_empty() {
        finalize_automation_run(db, run.id, "success", None).await?;
        return Ok(());
    }

    let (node_map, outgoing_map) = build_automation_graph(nodes, edges);

    let mut context = AutomationExecutionContext {
        outputs: HashMap::from([("trigger-1".to_string(), trigger_data.clone())]),
        operator: operator.to_string(),
        run_id: Some(run.id),
    };
    let mut path = HashSet::new();
    let result = if let Some(node_key) = retry_node_key {
        execute_automation_from_node(
            db,
            flow,
            node_key,
            &node_map,
            &outgoing_map,
            &mut context,
            &mut path,
        )
        .await
    } else {
        execute_automation_children(
            db,
            flow,
            "trigger-1",
            &node_map,
            &outgoing_map,
            &mut context,
            &mut path,
        )
        .await
    };

    match &result {
        Ok(_) => finalize_automation_run(db, run.id, "success", None).await?,
        Err(err) => finalize_automation_run(db, run.id, "failed", Some(format!("{err:?}"))).await?,
    }

    result
}

async fn execute_automation_flow_from_snapshot(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    trigger_data: &Value,
    operator: &str,
    start_node_key: &str,
    outputs_snapshot: HashMap<String, Value>,
    retry_run_uuid: &str,
) -> Result<(), AppError> {
    let run = create_automation_run(
        db,
        flow,
        trigger_data,
        Some(RetrySource::Node),
        Some(retry_run_uuid),
        Some(start_node_key),
    )
    .await?;
    let nodes = json_array_items(&flow.nodes_json);
    let edges = json_array_items(&flow.edges_json);
    let (node_map, outgoing_map) = build_automation_graph(nodes, edges);

    let mut context = AutomationExecutionContext {
        outputs: outputs_snapshot,
        operator: operator.to_string(),
        run_id: Some(run.id),
    };
    let mut path = HashSet::new();
    let result = execute_automation_from_node(
        db,
        flow,
        start_node_key,
        &node_map,
        &outgoing_map,
        &mut context,
        &mut path,
    )
    .await;

    match &result {
        Ok(_) => finalize_automation_run(db, run.id, "success", None).await?,
        Err(err) => finalize_automation_run(db, run.id, "failed", Some(format!("{err:?}"))).await?,
    }

    result
}

fn build_automation_graph(
    nodes: Vec<Value>,
    edges: Vec<Value>,
) -> (HashMap<String, Value>, HashMap<String, Vec<String>>) {
    let node_map = nodes
        .iter()
        .filter_map(|item| read_json_string(item.get("id")).map(|id| (id, item.clone())))
        .collect::<HashMap<_, _>>();
    let mut outgoing_map: HashMap<String, Vec<String>> = HashMap::new();
    for edge in edges {
        let Some(source) = read_json_string(edge.get("source")) else {
            continue;
        };
        let Some(target) = read_json_string(edge.get("target")) else {
            continue;
        };
        outgoing_map.entry(source).or_default().push(target);
    }
    (node_map, outgoing_map)
}

fn execute_automation_children<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node_id: &'a str,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<String>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let Some(target_ids) = outgoing_map.get(node_id) else {
            return Ok(());
        };
        let mut normal_nodes = Vec::new();
        let mut condition_nodes = Vec::new();

        for target_id in target_ids {
            let Some(target_node) = node_map.get(target_id) else {
                continue;
            };
            let kind = target_node
                .get("data")
                .and_then(|value| value.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if kind == "condition" {
                condition_nodes.push(target_node.clone());
            } else {
                normal_nodes.push(target_node.clone());
            }
        }

        for target_node in normal_nodes {
            execute_automation_node(db, flow, &target_node, node_map, outgoing_map, context, path).await?;
        }

        if !condition_nodes.is_empty() {
            condition_nodes.sort_by_key(|node| {
                node.get("data")
                    .and_then(|value| value.get("config"))
                    .and_then(|value| value.get("priority"))
                    .and_then(Value::as_i64)
                    .unwrap_or(1)
            });

            for target_node in condition_nodes {
                if evaluate_condition_node(&target_node, context) {
                    execute_automation_node(db, flow, &target_node, node_map, outgoing_map, context, path)
                        .await?;
                    break;
                }
            }
        }

        Ok(())
    })
}

fn execute_automation_from_node<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node_key: &'a str,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<String>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let node = node_map
            .get(node_key)
            .ok_or_else(|| AppError::NotFound("automation retry node not found".to_string()))?
            .clone();
        execute_automation_node(db, flow, &node, node_map, outgoing_map, context, path).await
    })
}

fn execute_automation_node<'a>(
    db: &'a DatabaseConnection,
    flow: &'a automation_flow_entity::Model,
    node: &'a Value,
    node_map: &'a HashMap<String, Value>,
    outgoing_map: &'a HashMap<String, Vec<String>>,
    context: &'a mut AutomationExecutionContext,
    path: &'a mut HashSet<String>,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        let node_id = read_json_string(node.get("id"))
            .ok_or_else(|| AppError::BadRequest("automation node id missing".to_string()))?;
        if !path.insert(node_id.clone()) {
            return Ok(());
        }

        let data = node
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::BadRequest("automation node data missing".to_string()))?;
        let kind = data
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let label = data
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("未命名节点");
        let config = data.get("config").cloned().unwrap_or_else(|| json!({}));
        let node_log_id = if let Some(run_id) = context.run_id {
            Some(
                create_automation_run_node_log(
                    db,
                    run_id,
                    &node_id,
                    kind,
                    label,
                    json!(context.outputs),
                )
                .await?,
            )
        } else {
            None
        };

        let execution_result: Result<(), AppError> = match kind {
            "condition" => Ok(()),
            "add-data" => {
                let output = execute_add_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "get-one" => {
                let output = execute_get_one_node(db, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "get-many" => {
                let output = execute_get_many_node(db, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "update-data" => {
                let output = execute_update_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "delete-data" => {
                let output = execute_delete_data_node(db, flow, &config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            "http-request" => {
                let output = execute_http_request_node(&config, context).await?;
                context.outputs.insert(node_id.clone(), output);
                Ok(())
            }
            _ => Ok(()),
        };

        if let Some(log_id) = node_log_id {
            match &execution_result {
                Ok(_) => {
                    finalize_automation_run_node_log(
                        db,
                        log_id,
                        "success",
                        context.outputs.get(&node_id).cloned(),
                        None,
                    )
                    .await?;
                }
                Err(err) => {
                    finalize_automation_run_node_log(
                        db,
                        log_id,
                        "failed",
                        None,
                        Some(format!("{err:?}")),
                    )
                    .await?;
                }
            }
        }
        execution_result?;

        let result =
            execute_automation_children(db, flow, &node_id, node_map, outgoing_map, context, path)
                .await;
        path.remove(&node_id);
        result
    })
}

fn evaluate_condition_node(node: &Value, context: &AutomationExecutionContext) -> bool {
    let config = node
        .get("data")
        .and_then(|value| value.get("config"))
        .and_then(Value::as_object);
    let mode = config
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str)
        .unwrap_or("all");

    match mode {
        "rules" => evaluate_branch_rules(
            config
                .and_then(|value| value.get("rules"))
                .cloned()
                .unwrap_or_else(|| json!([])),
            context,
        ),
        "expression" => config
            .and_then(|value| value.get("expression"))
            .and_then(Value::as_str)
            .map(|value| evaluate_context_expression(value, context))
            .unwrap_or(false),
        _ => true,
    }
}

fn evaluate_branch_rules(rules: Value, context: &AutomationExecutionContext) -> bool {
    for item in json_array_items(&rules) {
        if !evaluate_branch_rule(&item, context) {
            return false;
        }
    }
    true
}

fn evaluate_branch_rule(rule: &Value, context: &AutomationExecutionContext) -> bool {
    let field_key = read_json_string(rule.get("fieldKey")).unwrap_or_default();
    let operator = read_json_string(rule.get("operator")).unwrap_or_else(|| "eq".to_string());
    let expected = read_json_string(rule.get("rawValue")).unwrap_or_default();
    let actual_values = resolve_source_field_values(&context.outputs, &field_key);

    match operator.as_str() {
        "hasValue" => actual_values.iter().any(value_has_content),
        "noValue" => actual_values.is_empty() || actual_values.iter().all(|value| !value_has_content(value)),
        "neq" => actual_values.is_empty() || actual_values.iter().all(|value| normalize_scalar(value) != expected),
        "inAny" => {
            let expected_items = parse_multi_values(&expected);
            actual_values.iter().any(|value| expected_items.contains(&normalize_scalar(value)))
        }
        "notInAny" => {
            let expected_items = parse_multi_values(&expected);
            actual_values.is_empty()
                || actual_values
                    .iter()
                    .all(|value| !expected_items.contains(&normalize_scalar(value)))
        }
        _ => actual_values.iter().any(|value| normalize_scalar(value) == expected),
    }
}

fn resolve_source_field_values(outputs: &HashMap<String, Value>, source_field_key: &str) -> Vec<Value> {
    let Some((node_id, field_id)) = source_field_key.split_once(':') else {
        return Vec::new();
    };
    let Some(source) = outputs.get(node_id) else {
        return Vec::new();
    };

    match source {
        Value::Object(map) => map.get(field_id).cloned().into_iter().collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get(field_id).cloned())
            .collect(),
        _ => Vec::new(),
    }
}

async fn execute_add_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("add-data target form is required".to_string()))?;
    let target_definition = find_form_definition(db, &target_form_uuid).await?;
    let rows = json_array_items(&config.get("rows").cloned().unwrap_or_else(|| json!([])));
    let now = Utc::now();

    if config.get("recordMode").and_then(Value::as_str).unwrap_or("single") == "multiple" {
        let source_node_id = read_json_string(config.get("multipleSourceNodeId")).unwrap_or_default();
        let source_items = context
            .outputs
            .get(&source_node_id)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut inserted = Vec::new();
        for source_item in source_items {
            let mut scoped_outputs = context.outputs.clone();
            scoped_outputs.insert(source_node_id.clone(), Value::Array(vec![source_item.clone()]));
            let row_data = build_record_data_from_rows(&rows, &scoped_outputs);
            let record = insert_form_record(db, &target_definition, row_data, &context.operator, now).await?;
            inserted.push(record.record_data);
        }
        return Ok(Value::Array(inserted));
    }

    let row_data = build_record_data_from_rows(&rows, &context.outputs);
    let record = insert_form_record(db, &target_definition, row_data, &context.operator, now).await?;
    info!("automation add-data executed: flow={}, form={}, record={}", flow.flow_uuid, target_form_uuid, record.record_uuid);
    Ok(record.record_data)
}

async fn execute_get_one_node(
    db: &DatabaseConnection,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let source_mode = config.get("sourceMode").and_then(Value::as_str).unwrap_or("form");
    if source_mode == "data-node" {
        let source_node_id = read_json_string(config.get("dataNodeId")).unwrap_or_default();
        if let Some(value) = context.outputs.get(&source_node_id) {
            return Ok(match value {
                Value::Array(items) => items.first().cloned().unwrap_or(Value::Null),
                _ => value.clone(),
            });
        }
        return Ok(Value::Null);
    }

    let form_uuid = read_json_string(config.get("formUuid")).unwrap_or_default();
    if form_uuid.is_empty() {
        return Ok(Value::Null);
    }

    let records = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let matched = filter_records_by_expression(records, config.get("filterExpression"), context);
    Ok(matched
        .into_iter()
        .next()
        .map(|item| item.record_data)
        .unwrap_or(Value::Null))
}

async fn execute_get_many_node(
    db: &DatabaseConnection,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let source_mode = config.get("sourceMode").and_then(Value::as_str).unwrap_or("form");
    if source_mode == "data-node" {
        let source_node_id = read_json_string(config.get("dataNodeId")).unwrap_or_default();
        if let Some(value) = context.outputs.get(&source_node_id) {
            return Ok(match value {
                Value::Array(_) => value.clone(),
                Value::Null => Value::Array(vec![]),
                _ => Value::Array(vec![value.clone()]),
            });
        }
        return Ok(Value::Array(vec![]));
    }

    let form_uuid = read_json_string(config.get("formUuid")).unwrap_or_default();
    if form_uuid.is_empty() {
        return Ok(Value::Array(vec![]));
    }

    let records = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let matched = filter_records_by_expression(records, config.get("filterExpression"), context);
    Ok(Value::Array(matched.into_iter().map(|item| item.record_data).collect()))
}

async fn execute_update_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("update-data target form is required".to_string()))?;
    let rows = json_array_items(&config.get("rows").cloned().unwrap_or_else(|| json!([])));
    let records = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(target_form_uuid.clone()))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let matched = filter_records_by_expression(records, config.get("matchRule"), context);
    let patch = build_record_data_from_rows(&rows, &context.outputs);
    let now = Utc::now();
    let mut updated_items = Vec::new();

    for record in matched {
        let merged = merge_record_payload(record.record_data.clone(), &patch);
        let mut active_model: form_record_entity::ActiveModel = record.into();
        active_model.record_data = Set(merged.clone());
        active_model.updated_by = Set(context.operator.clone());
        active_model.updated_at = Set(now.into());
        let updated = active_model.update(db).await?;
        updated_items.push(updated.record_data);
    }

    info!(
        "automation update-data executed: flow={}, form={}, count={}",
        flow.flow_uuid,
        target_form_uuid,
        updated_items.len()
    );
    Ok(Value::Array(updated_items))
}

async fn execute_delete_data_node(
    db: &DatabaseConnection,
    flow: &automation_flow_entity::Model,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let target_form_uuid = read_json_string(config.get("targetFormUuid"))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("delete-data target form is required".to_string()))?;
    let definition = find_form_definition(db, &target_form_uuid).await?;
    let records = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(target_form_uuid.clone()))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let matched = filter_records_by_expression(records, config.get("matchRule"), context);
    let deleted_count = matched.len() as i64;
    let deleted_payloads = matched.iter().map(|item| item.record_data.clone()).collect::<Vec<_>>();

    for record in matched {
        FormRecordEntity::delete_many()
            .filter(form_record_entity::Column::Id.eq(record.id))
            .exec(db)
            .await?;
    }

    if deleted_count > 0 {
        decrement_app_records_count(db, &definition.app_route_app_id, deleted_count, Utc::now()).await?;
    }

    info!(
        "automation delete-data executed: flow={}, form={}, count={}",
        flow.flow_uuid,
        target_form_uuid,
        deleted_count
    );
    Ok(Value::Array(deleted_payloads))
}

async fn execute_http_request_node(
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Value, AppError> {
    let method = read_json_string(config.get("method"))
        .unwrap_or_else(|| "POST".to_string())
        .to_uppercase();
    let url = render_text_template(
        &read_json_string(config.get("url")).unwrap_or_default(),
        &context.outputs,
    );
    if url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "http-request url is required".to_string(),
        ));
    }

    let client = reqwest::Client::new();
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| AppError::BadRequest("invalid http-request method".to_string()))?;
    let mut request = client.request(method, &url);

    let headers_text = render_text_template(
        &read_json_string(config.get("headersText")).unwrap_or_default(),
        &context.outputs,
    );
    if !headers_text.trim().is_empty() {
        let headers_value: Value = serde_json::from_str(&headers_text)
            .map_err(|_| AppError::BadRequest("http-request headers must be valid json".to_string()))?;
        if let Some(headers) = headers_value.as_object() {
            for (key, value) in headers {
                request = request.header(key, normalize_scalar(value));
            }
        }
    }

    let body_text = render_text_template(
        &read_json_string(config.get("bodyTemplate")).unwrap_or_default(),
        &context.outputs,
    );
    if !body_text.trim().is_empty() {
        request = request.body(body_text.clone());
    }

    let response = request
        .send()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request failed: {err}")))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|err| AppError::BadRequest(format!("http-request read failed: {err}")))?;

    let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
    Ok(json!({
        "status": status,
        "body": payload,
    }))
}

fn build_record_data_from_rows(rows: &[Value], outputs: &HashMap<String, Value>) -> Value {
    let mut result = serde_json::Map::new();

    for row in rows {
        let field_id = read_json_string(row.get("fieldId")).unwrap_or_default();
        if field_id.is_empty() {
            continue;
        }
        let value_type = read_json_string(row.get("valueType")).unwrap_or_else(|| "value".to_string());
        let next_value = match value_type.as_str() {
            "field" => resolve_source_field_values(
                outputs,
                &read_json_string(row.get("sourceFieldKey")).unwrap_or_default(),
            )
            .into_iter()
            .next()
            .unwrap_or(Value::Null),
            "formula" => Value::String(read_json_string(row.get("formula")).unwrap_or_default()),
            _ => read_json_value(row.get("rawValue")),
        };
        result.insert(field_id, next_value);
    }

    Value::Object(result)
}

fn filter_records_by_expression(
    records: Vec<form_record_entity::Model>,
    expression: Option<&Value>,
    context: &AutomationExecutionContext,
) -> Vec<form_record_entity::Model> {
    let expression = read_json_string(expression).unwrap_or_default();
    if expression.trim().is_empty() {
        return records;
    }

    records
        .into_iter()
        .filter(|record| evaluate_record_expression(&expression, &record.record_data, context))
        .collect()
}

fn evaluate_context_expression(
    expression: &str,
    context: &AutomationExecutionContext,
) -> bool {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return false;
    }
    evaluate_record_expression(trimmed, &json!({}), context)
}

fn evaluate_record_expression(
    expression: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> bool {
    let clauses = expression
        .split("&&")
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if clauses.is_empty() {
        return true;
    }

    clauses
        .into_iter()
        .all(|clause| evaluate_record_clause(clause, record_data, context))
}

fn evaluate_record_clause(
    clause: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> bool {
    let (operator, lhs, rhs) = if let Some((lhs, rhs)) = clause.split_once("!=") {
        ("!=", lhs.trim(), rhs.trim())
    } else if let Some((lhs, rhs)) = clause.split_once("==") {
        ("==", lhs.trim(), rhs.trim())
    } else {
        return false;
    };

    let left_values = resolve_expression_operand(lhs, record_data, context);
    let right_values = resolve_expression_operand(rhs, record_data, context);

    if operator == "!=" {
        left_values.iter().all(|left| {
            right_values.is_empty() || right_values.iter().all(|right| normalize_scalar(left) != normalize_scalar(right))
        })
    } else {
        left_values.iter().any(|left| {
            right_values.iter().any(|right| normalize_scalar(left) == normalize_scalar(right))
        })
    }
}

fn resolve_expression_operand(
    operand: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> Vec<Value> {
    let trimmed = operand.trim();
    if trimmed.is_empty() {
        return vec![Value::String(String::new())];
    }

    if let Some(token) = trimmed
        .strip_prefix("{{")
        .and_then(|value| value.strip_suffix("}}"))
    {
        return resolve_source_field_values(&context.outputs, token);
    }

    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        return vec![Value::String(trimmed[1..trimmed.len() - 1].to_string())];
    }

    if let Ok(number) = trimmed.parse::<i64>() {
        return vec![Value::Number(number.into())];
    }

    if let Ok(number) = trimmed.parse::<f64>() {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return vec![Value::Number(number)];
        }
    }

    if trimmed == "true" || trimmed == "false" {
        return vec![Value::Bool(trimmed == "true")];
    }

    match record_data {
        Value::Object(map) => map.get(trimmed).cloned().into_iter().collect(),
        _ => vec![Value::String(trimmed.to_string())],
    }
}

fn render_text_template(template: &str, outputs: &HashMap<String, Value>) -> String {
    let mut result = String::new();
    let mut remaining = template;

    while let Some(start) = remaining.find("{{") {
        result.push_str(&remaining[..start]);
        let after_start = &remaining[start + 2..];
        if let Some(end) = after_start.find("}}") {
            let token = &after_start[..end];
            let value = resolve_source_field_values(outputs, token)
                .into_iter()
                .next()
                .map(|item| normalize_scalar(&item))
                .unwrap_or_default();
            result.push_str(&value);
            remaining = &after_start[end + 2..];
        } else {
            result.push_str(&remaining[start..]);
            remaining = "";
            break;
        }
    }

    result.push_str(remaining);
    result
}

fn merge_record_payload(current: Value, patch: &Value) -> Value {
    let mut next = current.as_object().cloned().unwrap_or_default();
    if let Some(patch_map) = patch.as_object() {
        for (key, value) in patch_map {
            next.insert(key.clone(), value.clone());
        }
    }
    Value::Object(next)
}

fn normalize_scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(inner) => inner.to_string(),
        Value::Number(inner) => inner.to_string(),
        Value::String(inner) => inner.trim().to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn parse_multi_values(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(inner) => !inner.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    }
}

async fn create_automation_snapshot<C>(
    db: &C,
    flow: &automation_flow_entity::Model,
    change_summary: Option<String>,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let snapshot = automation_flow_version_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_id: Set(flow.id),
        version: Set(flow.current_version),
        name: Set(flow.name.clone()),
        description: Set(flow.description.clone()),
        status: Set(flow.status.clone()),
        trigger_form_uuid: Set(flow.trigger_form_uuid.clone()),
        trigger_event: Set(flow.trigger_event.clone()),
        trigger_config: Set(flow.trigger_config.clone()),
        nodes_json: Set(flow.nodes_json.clone()),
        edges_json: Set(flow.edges_json.clone()),
        change_summary: Set(normalize_optional_text(change_summary)),
        created_by: Set(flow.updated_by.clone()),
        created_at: Set(flow.updated_at),
    };
    snapshot.insert(db).await?;
    sync_automation_graph_tables(db, flow.id, flow.current_version, &flow.nodes_json, &flow.edges_json)
        .await
}

async fn sync_automation_graph_tables<C>(
    db: &C,
    flow_id: Uuid,
    version: i32,
    nodes_json: &Value,
    edges_json: &Value,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    AutomationNodeEntity::delete_many()
        .filter(automation_node_entity::Column::FlowId.eq(flow_id))
        .filter(automation_node_entity::Column::Version.eq(version))
        .exec(db)
        .await?;
    AutomationEdgeEntity::delete_many()
        .filter(automation_edge_entity::Column::FlowId.eq(flow_id))
        .filter(automation_edge_entity::Column::Version.eq(version))
        .exec(db)
        .await?;

    let now = Utc::now();
    for item in json_array_items(nodes_json) {
        let raw = item.clone();
        let data = raw
            .get("data")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let position = raw
            .get("position")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let config_json = data
            .get("config")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let node = automation_node_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            flow_id: Set(flow_id),
            version: Set(version),
            node_key: Set(read_json_string(raw.get("id")).unwrap_or_else(|| format!("node-{}", Uuid::new_v4()))),
            node_kind: Set(read_json_string(data.get("kind")).unwrap_or_else(|| "unknown".to_string())),
            label: Set(read_json_string(data.get("label")).unwrap_or_else(|| "未命名节点".to_string())),
            description: Set(read_json_string(data.get("description"))),
            position_x: Set(read_json_number(position.get("x")).unwrap_or(0.0)),
            position_y: Set(read_json_number(position.get("y")).unwrap_or(0.0)),
            config_json: Set(normalize_json_object(config_json)),
            raw_json: Set(raw),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        };
        node.insert(db).await?;
    }

    for item in json_array_items(edges_json) {
        let raw = item.clone();
        let edge = automation_edge_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            flow_id: Set(flow_id),
            version: Set(version),
            edge_key: Set(read_json_string(raw.get("id")).unwrap_or_else(|| format!("edge-{}", Uuid::new_v4()))),
            source_node_key: Set(read_json_string(raw.get("source")).unwrap_or_default()),
            target_node_key: Set(read_json_string(raw.get("target")).unwrap_or_default()),
            source_handle: Set(read_json_string(raw.get("sourceHandle"))),
            target_handle: Set(read_json_string(raw.get("targetHandle"))),
            raw_json: Set(raw),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        };
        edge.insert(db).await?;
    }

    Ok(())
}

fn json_array_items(value: &Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

fn read_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToString::to_string)
}

fn read_json_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

fn read_json_value(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

fn build_form_slug(sort_order: i32) -> String {
    if sort_order == 0 {
        "overview".to_string()
    } else {
        format!("form-{}", sort_order + 1)
    }
}

fn success_response<T>(message: impl Into<String>, data: T) -> ApiResponse<T>
where
    T: Serialize,
{
    ApiResponse {
        code: 0,
        message: message.into(),
        data: Some(data),
        time: Utc::now().to_rfc3339(),
    }
}

fn error_response(code: i32, message: impl Into<String>) -> ApiResponse<Value> {
    ApiResponse {
        code,
        message: message.into(),
        data: None,
        time: Utc::now().to_rfc3339(),
    }
}

fn build_blank_schema(form_uuid: &str, form_name: &str) -> Value {
    json!({
        "formUuid": form_uuid,
        "formName": form_name,
        "columns": 6,
        "rows": 1,
        "pageProps": {
            "formulaValidations": [
                { "id": "formula-dictionary-exists", "label": "EXIST(字典项)" },
                { "id": "formula-sequence-exists", "label": "EXIST(序号)" }
            ],
            "serviceValidations": [],
            "customServiceValidations": [],
            "stopRulesOnFailure": false,
            "businessFailureRules": [],
            "integrationAutomations": [
                { "id": "integration-1", "label": "集成&自动化" }
            ],
            "serviceExecutions": [],
            "customServiceExecutions": [],
            "submitButtonText": "提交",
            "beforeSubmitActions": [],
            "afterSubmitActions": [],
            "afterDataInitActions": [],
            "dataSourceCode": ""
        },
        "fields": []
    })
}

fn normalize_record_payload(data: Value) -> Value {
    match data {
        Value::Object(_) => data,
        _ => json!({}),
    }
}

fn normalize_json_object(data: Value) -> Value {
    match data {
        Value::Object(_) => data,
        _ => json!({}),
    }
}

fn normalize_json_array(data: Value) -> Value {
    match data {
        Value::Array(_) => data,
        _ => json!([]),
    }
}

fn normalize_automation_nodes(data: Value) -> Result<Value, AppError> {
    let mut seen_node_ids = HashSet::new();
    let items = normalize_json_array(data);
    let mut nodes = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("automation node must be object".to_string()))?;
        let node_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation node id is required".to_string()))?;

        if !seen_node_ids.insert(node_id.clone()) {
            return Err(AppError::BadRequest(
                "automation node id must be unique".to_string(),
            ));
        }

        let position = raw.get("position").and_then(Value::as_object);
        let x = read_json_number(position.and_then(|value| value.get("x"))).unwrap_or(0.0);
        let y = read_json_number(position.and_then(|value| value.get("y"))).unwrap_or(0.0);
        let data = raw
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::BadRequest("automation node data is required".to_string()))?;
        let kind = normalize_automation_node_kind(
            read_json_string(data.get("kind")).as_deref().unwrap_or(""),
        )?;

        nodes.push(json!({
            "id": node_id,
            "type": read_json_string(raw.get("type")).unwrap_or_else(|| "workflow".to_string()),
            "position": { "x": x, "y": y },
            "data": {
                "kind": kind,
                "label": read_json_string(data.get("label")).unwrap_or_else(|| default_node_label(&kind).to_string()),
                "description": read_json_string(data.get("description")).unwrap_or_else(|| default_node_description(&kind).to_string()),
                "config": normalize_automation_node_config(&kind, data.get("config").cloned().unwrap_or_else(|| json!({})))?,
            },
        }));
    }

    Ok(Value::Array(nodes))
}

fn normalize_automation_edges(data: Value) -> Result<Value, AppError> {
    let mut seen_edge_ids = HashSet::new();
    let items = normalize_json_array(data);
    let mut edges = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("automation edge must be object".to_string()))?;
        let edge_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation edge id is required".to_string()))?;

        if !seen_edge_ids.insert(edge_id.clone()) {
            return Err(AppError::BadRequest(
                "automation edge id must be unique".to_string(),
            ));
        }

        let source = read_json_string(raw.get("source"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation edge source is required".to_string()))?;
        let target = read_json_string(raw.get("target"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation edge target is required".to_string()))?;

        edges.push(json!({
            "id": edge_id,
            "source": source,
            "target": target,
            "sourceHandle": read_json_string(raw.get("sourceHandle")),
            "targetHandle": read_json_string(raw.get("targetHandle")),
            "type": read_json_string(raw.get("type")).unwrap_or_else(|| "insertable".to_string()),
        }));
    }

    Ok(Value::Array(edges))
}

fn validate_automation_graph(nodes_json: &Value, edges_json: &Value) -> Result<(), AppError> {
    let node_ids = json_array_items(nodes_json)
        .into_iter()
        .filter_map(|item| read_json_string(item.get("id")))
        .collect::<HashSet<_>>();

    if !node_ids.iter().any(|id| id == "trigger-1") {
        return Err(AppError::BadRequest(
            "automation graph must include trigger node".to_string(),
        ));
    }

    for edge in json_array_items(edges_json) {
        let source = read_json_string(edge.get("source"))
            .ok_or_else(|| AppError::BadRequest("automation edge source is required".to_string()))?;
        let target = read_json_string(edge.get("target"))
            .ok_or_else(|| AppError::BadRequest("automation edge target is required".to_string()))?;

        if !node_ids.contains(&source) || !node_ids.contains(&target) {
            return Err(AppError::BadRequest(
                "automation edge references unknown node".to_string(),
            ));
        }

        if target == "trigger-1" {
            return Err(AppError::BadRequest(
                "trigger node cannot be target of edge".to_string(),
            ));
        }
    }

    Ok(())
}

async fn ensure_automation_node_forms_belong_to_app(
    db: &DatabaseConnection,
    app_id: &str,
    nodes_json: &Value,
) -> Result<(), AppError> {
    let mut form_ids = HashSet::new();

    for item in json_array_items(nodes_json) {
        let data = item.get("data").and_then(Value::as_object);
        let kind = data
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let config = data
            .and_then(|value| value.get("config"))
            .and_then(Value::as_object);

        match kind {
            "get-one" | "get-many" => {
                if let Some(form_uuid) = config
                    .and_then(|value| value.get("formUuid"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    form_ids.insert(form_uuid.to_string());
                }
            }
            "add-data" | "update-data" | "delete-data" => {
                if let Some(form_uuid) = config
                    .and_then(|value| value.get("targetFormUuid"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    form_ids.insert(form_uuid.to_string());
                }
            }
            _ => {}
        }
    }

    for form_uuid in form_ids {
        ensure_form_belongs_to_app(db, app_id, &form_uuid).await?;
    }

    Ok(())
}

fn normalize_automation_node_kind(kind: &str) -> Result<String, AppError> {
    let normalized = kind.trim();
    if matches!(
        normalized,
        "trigger"
            | "condition"
            | "add-data"
            | "update-data"
            | "get-one"
            | "get-many"
            | "delete-data"
            | "http-request"
    ) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation node kind".to_string(),
        ))
    }
}

fn normalize_automation_node_config(kind: &str, config: Value) -> Result<Value, AppError> {
    let config = normalize_json_object(config);
    let object = config.as_object().cloned().unwrap_or_default();

    let normalized = match kind {
        "trigger" => json!({
            "changedFieldsText": read_json_string(object.get("changedFieldsText")),
        }),
        "condition" => json!({
            "mode": normalize_condition_mode(object.get("mode").and_then(Value::as_str)),
            "priority": normalize_condition_priority(object.get("priority").and_then(Value::as_i64)),
            "rules": normalize_branch_rules(object.get("rules").cloned().unwrap_or_else(|| json!([])))?,
            "expression": read_json_string(object.get("expression")),
            "hitLabel": read_json_string(object.get("hitLabel")),
        }),
        "get-one" | "get-many" => json!({
            "sourceMode": normalize_data_source_mode(object.get("sourceMode").and_then(Value::as_str)),
            "formUuid": read_json_string(object.get("formUuid")),
            "dataNodeId": read_json_string(object.get("dataNodeId")),
            "relatedFormPlaceholder": read_json_string(object.get("relatedFormPlaceholder")),
            "filterExpression": read_json_string(object.get("filterExpression")),
            "fieldSelection": read_json_string(object.get("fieldSelection")),
        }),
        "add-data" => json!({
            "targetMode": normalize_add_target_mode(object.get("targetMode").and_then(Value::as_str)),
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "recordMode": normalize_add_record_mode(object.get("recordMode").and_then(Value::as_str)),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "multipleSourceMode": normalize_multiple_source_mode(object.get("multipleSourceMode").and_then(Value::as_str)),
            "multipleSourceNodeId": read_json_string(object.get("multipleSourceNodeId")),
            "multipleFormula": read_json_string(object.get("multipleFormula")),
        }),
        "update-data" | "delete-data" | "http-request" => json!({
            "targetFormUuid": read_json_string(object.get("targetFormUuid")),
            "matchRule": read_json_string(object.get("matchRule")),
            "rows": normalize_field_mapping_rows(object.get("rows").cloned().unwrap_or_else(|| json!([]))),
            "bodyTemplate": read_json_string(object.get("bodyTemplate")),
            "method": read_json_string(object.get("method")),
            "url": read_json_string(object.get("url")),
            "headersText": read_json_string(object.get("headersText")),
        }),
        _ => json!({}),
    };

    Ok(normalized)
}

fn normalize_branch_rules(data: Value) -> Result<Value, AppError> {
    let items = normalize_json_array(data);
    let mut seen_ids = HashSet::new();
    let mut rules = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("branch rule must be object".to_string()))?;
        let rule_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("branch rule id is required".to_string()))?;

        if !seen_ids.insert(rule_id.clone()) {
            return Err(AppError::BadRequest(
                "branch rule id must be unique".to_string(),
            ));
        }

        let operator = normalize_branch_rule_operator(raw.get("operator").and_then(Value::as_str));
        rules.push(json!({
            "id": rule_id,
            "parentId": read_json_string(raw.get("parentId")),
            "fieldKey": read_json_string(raw.get("fieldKey")),
            "operator": operator,
            "rawValue": if matches!(operator, "hasValue" | "noValue") {
                None::<String>
            } else {
                read_json_string(raw.get("rawValue"))
            },
        }));
    }

    Ok(Value::Array(rules))
}

fn normalize_field_mapping_rows(data: Value) -> Value {
    let items = normalize_json_array(data);
    let mut rows = Vec::new();

    for item in json_array_items(&items) {
        let Some(raw) = item.as_object() else {
            continue;
        };
        let Some(field_id) = read_json_string(raw.get("fieldId")).filter(|value| !value.trim().is_empty()) else {
            continue;
        };

        let value_type = normalize_mapping_value_type(raw.get("valueType").and_then(Value::as_str));
        rows.push(json!({
            "id": read_json_string(raw.get("id")).unwrap_or_else(|| format!("row-{}-{}", field_id, Uuid::new_v4().simple())),
            "fieldId": field_id,
            "valueType": value_type,
            "rawValue": if value_type == "value" { read_json_string(raw.get("rawValue")) } else { None::<String> },
            "sourceFieldKey": if value_type == "field" { read_json_string(raw.get("sourceFieldKey")) } else { None::<String> },
            "formula": if value_type == "formula" { read_json_string(raw.get("formula")) } else { None::<String> },
        }));
    }

    Value::Array(rows)
}

fn normalize_condition_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("all").trim() {
        "rules" => "rules",
        "expression" => "expression",
        _ => "all",
    }
}

fn normalize_condition_priority(value: Option<i64>) -> i64 {
    value.unwrap_or(1).max(1)
}

fn normalize_branch_rule_operator(value: Option<&str>) -> &'static str {
    match value.unwrap_or("eq").trim() {
        "neq" => "neq",
        "inAny" => "inAny",
        "notInAny" => "notInAny",
        "hasValue" => "hasValue",
        "noValue" => "noValue",
        _ => "eq",
    }
}

fn normalize_data_source_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("form").trim() {
        "data-node" => "data-node",
        "related-form" => "related-form",
        _ => "form",
    }
}

fn normalize_add_target_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("form").trim() {
        "subtable" => "subtable",
        _ => "form",
    }
}

fn normalize_add_record_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("single").trim() {
        "multiple" => "multiple",
        _ => "single",
    }
}

fn normalize_multiple_source_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or("data-node").trim() {
        "form" => "form",
        _ => "data-node",
    }
}

fn normalize_mapping_value_type(value: Option<&str>) -> &'static str {
    match value.unwrap_or("value").trim() {
        "field" => "field",
        "formula" => "formula",
        _ => "value",
    }
}

fn default_node_label(kind: &str) -> &'static str {
    match kind {
        "trigger" => "表单事件触发",
        "condition" => "条件分支",
        "add-data" => "新增数据",
        "update-data" => "更新数据",
        "get-one" => "获取单条数据",
        "get-many" => "获取多条数据",
        "delete-data" => "删除数据",
        "http-request" => "连接器",
        _ => "未命名节点",
    }
}

fn default_node_description(kind: &str) -> &'static str {
    match kind {
        "trigger" => "根据表单记录事件开始执行工作流",
        "condition" => "按优先级和条件规则控制后续走向",
        "add-data" => "向目标表单新增单条或多条数据",
        "update-data" => "根据匹配条件更新目标表单记录",
        "get-one" => "从表单、数据节点或关联表单中获取一条数据",
        "get-many" => "从表单、数据节点或关联表单中获取多条数据",
        "delete-data" => "根据匹配条件删除目标表单记录",
        "http-request" => "调用外部接口或 Webhook",
        _ => "",
    }
}

fn normalize_operator(operator: Option<String>) -> String {
    normalize_optional_text(operator).unwrap_or_else(|| "管理员".to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn retry_source_label(value: RetrySource) -> String {
    match value {
        RetrySource::Flow => "flow".to_string(),
        RetrySource::Node => "node".to_string(),
    }
}

fn normalize_automation_status(status: &str) -> Result<String, AppError> {
    let normalized = status.trim();
    if matches!(normalized, "enabled" | "paused" | "draft") {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation status".to_string(),
        ))
    }
}

fn normalize_automation_trigger_event(event: &str) -> Result<String, AppError> {
    let normalized = event.trim();
    if matches!(
        normalized,
        "before_create"
            | "after_create"
            | "before_update"
            | "after_update"
            | "before_delete"
            | "after_delete"
    ) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation trigger event".to_string(),
        ))
    }
}

fn automation_trigger_label(event: &str) -> &'static str {
    match event {
        "before_create" => "创建成功前",
        "after_create" => "创建成功后",
        "before_update" => "编辑成功前",
        "after_update" => "编辑成功后",
        "before_delete" => "删除成功前",
        "after_delete" => "删除成功后",
        _ => "未配置",
    }
}

fn build_group_slug(title: &str) -> String {
    let normalized = title
        .trim()
        .chars()
        .map(|char| match char {
            'a'..='z' | 'A'..='Z' | '0'..='9' => char.to_ascii_lowercase(),
            _ => '-',
        })
        .collect::<String>();
    let collapsed = normalized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if collapsed.is_empty() {
        format!("group-{}", Uuid::new_v4().simple())
    } else {
        format!("group-{collapsed}")
    }
}

async fn find_form_definition(
    db: &DatabaseConnection,
    form_uuid: &str,
) -> Result<form_definition_entity::Model, AppError> {
    FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))
}

async fn find_form_record(
    db: &DatabaseConnection,
    form_uuid: &str,
    record_uuid: &str,
) -> Result<form_record_entity::Model, AppError> {
    FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .filter(form_record_entity::Column::RecordUuid.eq(record_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("record not found".to_string()))
}

async fn retry_automation_run_internal(
    db: &DatabaseConnection,
    flow_uuid: &str,
    run_uuid: &str,
    node_key: Option<String>,
) -> Result<(), AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(flow_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .filter(automation_run_entity::Column::RunUuid.eq(run_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("automation run not found".to_string()))?;

    if let Some(node_key) = node_key {
        let node_log = AutomationRunNodeEntity::find()
            .filter(automation_run_node_entity::Column::RunId.eq(run.id))
            .filter(automation_run_node_entity::Column::NodeKey.eq(node_key.clone()))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("automation run node log not found".to_string()))?;
        let snapshot = node_log
            .input_json
            .as_object()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<HashMap<String, Value>>();

        execute_automation_flow_from_snapshot(
            db,
            &flow,
            &run.trigger_payload,
            "管理员",
            &node_key,
            snapshot,
            run_uuid,
        )
        .await
    } else {
        execute_automation_flow(
            db,
            &flow,
            &run.trigger_payload,
            "管理员",
            Some(RetrySource::Flow),
            Some(run_uuid),
            None,
        )
        .await
    }
}

async fn ensure_form_belongs_to_app(
    db: &DatabaseConnection,
    app_id: &str,
    form_uuid: &str,
) -> Result<(), AppError> {
    let exists = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .count(db)
        .await?
        > 0;

    if exists {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "trigger form does not belong to app".to_string(),
        ))
    }
}

fn flow_matches_changed_fields(
    trigger_config: &Value,
    changed_fields: Option<&HashSet<String>>,
) -> bool {
    let configured = trigger_config
        .get("changedFieldsText")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (configured, changed_fields) {
        (Some(field_id), Some(fields)) => fields.contains(field_id),
        (Some(_), None) => false,
        _ => true,
    }
}

fn collect_changed_fields(previous: &Value, next: &Value) -> HashSet<String> {
    let mut changed = HashSet::new();
    let previous_map = previous.as_object().cloned().unwrap_or_default();
    let next_map = next.as_object().cloned().unwrap_or_default();

    for key in previous_map.keys().chain(next_map.keys()) {
        if changed.contains(key) {
            continue;
        }
        let prev = previous_map.get(key);
        let curr = next_map.get(key);
        if prev != curr {
            changed.insert(key.clone());
        }
    }

    changed
}

async fn load_schema_version(
    db: &DatabaseConnection,
    form_uuid: &str,
    version: i32,
) -> Result<form_schema_entity::Model, AppError> {
    load_schema_version_for_connection(db, form_uuid, version).await
}

async fn load_schema_version_for_connection<C>(
    db: &C,
    form_uuid: &str,
    version: i32,
) -> Result<form_schema_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .filter(form_schema_entity::Column::Version.eq(version))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("schema not found".to_string()))
}

fn resolve_schema_version(
    definition: &form_definition_entity::Model,
    query: &GetSchemaQuery,
) -> i32 {
    if let Some(version) = query.version {
        return version;
    }

    match query.scope.as_deref() {
        Some("draft") => definition.draft_schema_version,
        Some("latest") => definition.latest_schema_version,
        Some("published") | None => definition.published_schema_version,
        Some(_) => definition.published_schema_version,
    }
}

fn build_schema_payload(
    definition: &form_definition_entity::Model,
    schema: form_schema_entity::Model,
) -> ApiSchemaPayload {
    ApiSchemaPayload {
        form_uuid: definition.form_uuid.clone(),
        schema: schema.schema_json,
        version: schema.version,
        draft_version: definition.draft_schema_version,
        published_version: definition.published_schema_version,
        latest_version: definition.latest_schema_version,
        published: schema.published,
    }
}

async fn sync_navigation_title(
    db: &DatabaseConnection,
    form_uuid: &str,
    name: &str,
    slug: &str,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if let Some(navigation_item) = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.to_string())))
        .one(db)
        .await?
    {
        let mut navigation_active: app_navigation_entity::ActiveModel = navigation_item.into();
        navigation_active.title = Set(name.to_string());
        navigation_active.path_slug = Set(slug.to_string());
        navigation_active.updated_at = Set(now.into());
        navigation_active.update(db).await?;
    }

    Ok(())
}

const SYSTEM_NAV_ITEMS: [(&str, &str, bool); 4] = [
    ("todo", "待我处理", true),
    ("processed", "我处理的", false),
    ("created", "我创建的", false),
    ("copied", "抄送我的", false),
];

async fn ensure_system_navigation_items(db: &DatabaseConnection) -> Result<(), AppError> {
    let apps = AppEntity::find().all(db).await?;

    for app in apps {
        ensure_system_navigation_for_app(db, &app.route_app_id).await?;
    }

    Ok(())
}

async fn ensure_system_navigation_for_app(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    let now = Utc::now();

    for (index, (slug, title, is_default_entry)) in SYSTEM_NAV_ITEMS.iter().enumerate() {
        let existing = AppNavigationEntity::find()
            .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
            .filter(app_navigation_entity::Column::PathSlug.eq((*slug).to_string()))
            .one(db)
            .await?;

        if let Some(item) = existing {
            let mut active_model: app_navigation_entity::ActiveModel = item.into();
            active_model.item_type = Set("system".to_string());
            active_model.title = Set((*title).to_string());
            active_model.sort_order = Set(index as i32);
            active_model.is_default_entry = Set(*is_default_entry);
            active_model.updated_at = Set(now.into());
            active_model.update(db).await?;
            continue;
        }

        app_navigation_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            app_route_app_id: Set(app_id.to_string()),
            item_type: Set("system".to_string()),
            target_form_uuid: Set(None),
            title: Set((*title).to_string()),
            path_slug: Set((*slug).to_string()),
            sort_order: Set(index as i32),
            is_default_entry: Set(*is_default_entry),
            parent_id: Set(None),
            visibility_rule: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(db)
        .await?;
    }

    Ok(())
}

async fn resolve_group_parent_id(
    db: &DatabaseConnection,
    app_id: &str,
    parent_id: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    let Some(parent_id) = parent_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let parent_uuid = Uuid::parse_str(parent_id)
        .map_err(|_| AppError::NotFound("parent group not found".to_string()))?;
    let parent_item = AppNavigationEntity::find_by_id(parent_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("parent group not found".to_string()))?;

    if parent_item.app_route_app_id != app_id || parent_item.item_type != "group" {
        return Err(AppError::NotFound("parent group not found".to_string()));
    }

    Ok(Some(parent_uuid))
}

async fn next_navigation_sort_order(
    db: &DatabaseConnection,
    app_id: &str,
    parent_id: Option<Uuid>,
) -> Result<i32, AppError> {
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(app_navigation_entity::Column::ParentId.eq(parent_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .all(db)
        .await?;

    if parent_id.is_none() {
        let non_system_count = items
            .into_iter()
            .filter(|item| item.item_type != "system")
            .count() as i32;
        return Ok(ROOT_NON_SYSTEM_SORT_BASE + non_system_count);
    }

    Ok(items.len() as i32)
}

const ROOT_NON_SYSTEM_SORT_BASE: i32 = 100;

async fn normalize_navigation_orders(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let now = Utc::now();

    let system_order = SYSTEM_NAV_ITEMS
        .iter()
        .enumerate()
        .map(|(index, (slug, _, _))| ((*slug).to_string(), index as i32))
        .collect::<std::collections::HashMap<_, _>>();

    let mut grouped_children =
        std::collections::HashMap::<Option<Uuid>, Vec<app_navigation_entity::Model>>::new();
    for item in items {
        grouped_children
            .entry(item.parent_id)
            .or_default()
            .push(item);
    }

    if let Some(root_items) = grouped_children.get_mut(&None) {
        root_items.sort_by_key(|item| {
            if item.item_type == "system" {
                (0, *system_order.get(&item.path_slug).unwrap_or(&i32::MAX))
            } else {
                (1, item.sort_order)
            }
        });

        let mut non_system_index = 0;
        for item in root_items.iter() {
            let next_sort = if item.item_type == "system" {
                *system_order.get(&item.path_slug).unwrap_or(&0)
            } else {
                let current = ROOT_NON_SYSTEM_SORT_BASE + non_system_index;
                non_system_index += 1;
                current
            };

            if item.sort_order != next_sort
                || (item.item_type == "system" && item.parent_id.is_some())
            {
                let mut active_model: app_navigation_entity::ActiveModel = item.clone().into();
                active_model.sort_order = Set(next_sort);
                active_model.parent_id = Set(None);
                active_model.updated_at = Set(now.into());
                active_model.update(db).await?;
            }
        }
    }

    normalize_child_orders_recursive(db, &grouped_children, None, now).await
}

async fn normalize_child_orders_recursive(
    db: &DatabaseConnection,
    grouped_children: &std::collections::HashMap<Option<Uuid>, Vec<app_navigation_entity::Model>>,
    parent_id: Option<Uuid>,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if let Some(parent_uuid) = parent_id
        && let Some(children) = grouped_children.get(&Some(parent_uuid))
    {
        for (index, item) in children.iter().enumerate() {
            if item.sort_order != index as i32 {
                let mut active_model: app_navigation_entity::ActiveModel = item.clone().into();
                active_model.sort_order = Set(index as i32);
                active_model.updated_at = Set(now.into());
                active_model.update(db).await?;
            }

            if item.item_type == "group" {
                Box::pin(normalize_child_orders_recursive(
                    db,
                    grouped_children,
                    Some(item.id),
                    now,
                ))
                .await?;
            }
        }
    }

    if parent_id.is_none() {
        for items in grouped_children.values() {
            for item in items {
                if item.parent_id.is_some() && item.item_type == "group" {
                    Box::pin(normalize_child_orders_recursive(
                        db,
                        grouped_children,
                        Some(item.id),
                        now,
                    ))
                    .await?;
                }
            }
        }
    }

    Ok(())
}

async fn apply_navigation_reorder(
    db: &DatabaseConnection,
    app_id: &str,
    payload: &ReorderNavigationRequest,
) -> Result<(), AppError> {
    let item_uuid = Uuid::parse_str(payload.item_id.trim())
        .map_err(|_| AppError::NotFound("navigation item not found".to_string()))?;
    let target_uuid = Uuid::parse_str(payload.target_item_id.trim())
        .map_err(|_| AppError::NotFound("navigation item not found".to_string()))?;
    let item = AppNavigationEntity::find_by_id(item_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("navigation item not found".to_string()))?;
    let target = AppNavigationEntity::find_by_id(target_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("navigation item not found".to_string()))?;

    if item.app_route_app_id != app_id || target.app_route_app_id != app_id {
        return Err(AppError::NotFound("navigation item not found".to_string()));
    }

    if item.item_type == "system" {
        return Ok(());
    }

    if payload.placement == "inside" && target.item_type != "group" {
        return Err(AppError::NotFound("target group not found".to_string()));
    }

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .all(db)
        .await?;

    let descendants = collect_navigation_descendants(&items, item.id);
    if descendants.contains(&target.id) {
        return Err(AppError::NotFound(
            "cannot move item into descendant".to_string(),
        ));
    }

    let destination_parent = match payload.placement.as_str() {
        "inside" => Some(target.id),
        "before" | "after" => target.parent_id,
        _ => return Err(AppError::NotFound("invalid placement".to_string())),
    };

    let mut destination_siblings = items
        .iter()
        .filter(|candidate| candidate.parent_id == destination_parent)
        .filter(|candidate| candidate.id != item.id)
        .filter(|candidate| !(destination_parent.is_none() && candidate.item_type == "system"))
        .cloned()
        .collect::<Vec<_>>();
    destination_siblings.sort_by_key(|candidate| candidate.sort_order);

    let insertion_index = match payload.placement.as_str() {
        "inside" => destination_siblings.len(),
        "before" => destination_siblings
            .iter()
            .position(|candidate| candidate.id == target.id)
            .unwrap_or(destination_siblings.len()),
        "after" => destination_siblings
            .iter()
            .position(|candidate| candidate.id == target.id)
            .map(|index| index + 1)
            .unwrap_or(destination_siblings.len()),
        _ => destination_siblings.len(),
    };

    let now = Utc::now();
    let mut reordered_siblings = destination_siblings;
    let mut moved_item = item.clone();
    moved_item.parent_id = destination_parent;
    reordered_siblings.insert(insertion_index, moved_item);

    for (index, sibling) in reordered_siblings.into_iter().enumerate() {
        let next_sort_order = if destination_parent.is_none() {
            ROOT_NON_SYSTEM_SORT_BASE + index as i32
        } else {
            index as i32
        };

        if sibling.parent_id != destination_parent || sibling.sort_order != next_sort_order {
            let mut active_model: app_navigation_entity::ActiveModel = sibling.into();
            active_model.parent_id = Set(destination_parent);
            active_model.sort_order = Set(next_sort_order);
            active_model.updated_at = Set(now.into());
            active_model.update(db).await?;
        }
    }

    Ok(())
}

fn collect_navigation_descendants(
    items: &[app_navigation_entity::Model],
    root_id: Uuid,
) -> std::collections::HashSet<Uuid> {
    let mut result = std::collections::HashSet::new();
    let mut stack = vec![root_id];

    while let Some(current_id) = stack.pop() {
        for item in items
            .iter()
            .filter(|item| item.parent_id == Some(current_id))
        {
            if result.insert(item.id) {
                stack.push(item.id);
            }
        }
    }

    result
}

async fn ensure_form_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_definitions (
          id uuid PRIMARY KEY,
          app_route_app_id varchar(32) NOT NULL,
          form_uuid varchar(40) NOT NULL UNIQUE,
          name varchar(120) NOT NULL,
          slug varchar(80) NOT NULL,
          status varchar(24) NOT NULL,
          draft_schema_version integer NOT NULL DEFAULT 1,
          published_schema_version integer NOT NULL DEFAULT 1,
          latest_schema_version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        ALTER TABLE form_definitions
          ADD COLUMN IF NOT EXISTS draft_schema_version integer NOT NULL DEFAULT 1;
        ALTER TABLE form_definitions
          ADD COLUMN IF NOT EXISTS published_schema_version integer NOT NULL DEFAULT 1;
        UPDATE form_definitions
          SET draft_schema_version = latest_schema_version
          WHERE draft_schema_version IS NULL;
        UPDATE form_definitions
          SET published_schema_version = latest_schema_version
          WHERE published_schema_version IS NULL;
        CREATE INDEX IF NOT EXISTS idx_form_definitions_app_route_app_id
          ON form_definitions (app_route_app_id);
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_schemas (
          id uuid PRIMARY KEY,
          form_uuid varchar(40) NOT NULL,
          version integer NOT NULL,
          schema_json jsonb NOT NULL,
          change_log varchar(255),
          published boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        ALTER TABLE form_schemas
          ADD COLUMN IF NOT EXISTS change_log varchar(255);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_form_schemas_form_uuid_version
          ON form_schemas (form_uuid, version);
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS app_navigation_items (
          id uuid PRIMARY KEY,
          app_route_app_id varchar(32) NOT NULL,
          item_type varchar(24) NOT NULL,
          target_form_uuid varchar(40),
          title varchar(120) NOT NULL,
          path_slug varchar(80) NOT NULL,
          sort_order integer NOT NULL DEFAULT 0,
          is_default_entry boolean NOT NULL DEFAULT false,
          parent_id uuid,
          visibility_rule varchar(255),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_app_navigation_items_app_route_app_id
          ON app_navigation_items (app_route_app_id);
        CREATE INDEX IF NOT EXISTS idx_app_navigation_items_default_entry
          ON app_navigation_items (app_route_app_id, is_default_entry);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_navigation_items_target_form_uuid
          ON app_navigation_items (target_form_uuid)
          WHERE target_form_uuid IS NOT NULL;
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_records (
          id uuid PRIMARY KEY,
          record_uuid varchar(40) NOT NULL UNIQUE,
          app_route_app_id varchar(32) NOT NULL,
          form_uuid varchar(40) NOT NULL,
          schema_version integer NOT NULL,
          record_data jsonb NOT NULL,
          created_by varchar(80) NOT NULL,
          updated_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_form_records_form_uuid_created_at
          ON form_records (form_uuid, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_form_records_app_route_app_id
          ON form_records (app_route_app_id);
        "#,
    )
    .await?;

    Ok(())
}

async fn ensure_automation_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS automation_flows (
          id uuid PRIMARY KEY,
          flow_uuid varchar(40) NOT NULL UNIQUE,
          app_route_app_id varchar(32) NOT NULL,
          name varchar(120) NOT NULL,
          description varchar(255),
          status varchar(24) NOT NULL DEFAULT 'draft',
          current_version integer NOT NULL DEFAULT 1,
          trigger_form_uuid varchar(40),
          trigger_event varchar(32) NOT NULL DEFAULT 'after_create',
          trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          nodes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_by varchar(80) NOT NULL,
          updated_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flows_app_route_app_id
          ON automation_flows (app_route_app_id);
        CREATE INDEX IF NOT EXISTS idx_automation_flows_trigger_form_event
          ON automation_flows (trigger_form_uuid, trigger_event);
        ALTER TABLE automation_flows
          ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

        CREATE TABLE IF NOT EXISTS automation_flow_versions (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          name varchar(120) NOT NULL,
          description varchar(255),
          status varchar(24) NOT NULL,
          trigger_form_uuid varchar(40),
          trigger_event varchar(32) NOT NULL,
          trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          nodes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          change_summary varchar(255),
          created_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_flow_versions_flow_id_version
          ON automation_flow_versions (flow_id, version);

        CREATE TABLE IF NOT EXISTS automation_nodes (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          node_key varchar(96) NOT NULL,
          node_kind varchar(40) NOT NULL,
          label varchar(120) NOT NULL,
          description varchar(255),
          position_x double precision NOT NULL,
          position_y double precision NOT NULL,
          config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_nodes_flow_id_version_node_key
          ON automation_nodes (flow_id, version, node_key);

        CREATE TABLE IF NOT EXISTS automation_edges (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          edge_key varchar(96) NOT NULL,
          source_node_key varchar(96) NOT NULL,
          target_node_key varchar(96) NOT NULL,
          source_handle varchar(96),
          target_handle varchar(96),
          raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_edges_flow_id_version_edge_key
          ON automation_edges (flow_id, version, edge_key);

        CREATE TABLE IF NOT EXISTS automation_flow_runs (
          id uuid PRIMARY KEY,
          run_uuid varchar(40) NOT NULL UNIQUE,
          flow_id uuid NOT NULL,
          flow_version integer NOT NULL,
          trigger_event varchar(32) NOT NULL,
          trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          status varchar(24) NOT NULL DEFAULT 'running',
          retry_source varchar(24),
          retry_run_uuid varchar(40),
          retry_node_key varchar(96),
          error_message varchar(255),
          started_at timestamptz NOT NULL,
          finished_at timestamptz,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flow_runs_flow_id_started_at
          ON automation_flow_runs (flow_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS automation_flow_run_nodes (
          id uuid PRIMARY KEY,
          run_id uuid NOT NULL,
          node_key varchar(96) NOT NULL,
          node_kind varchar(40) NOT NULL,
          node_label varchar(120) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'running',
          input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          output_json jsonb,
          error_message varchar(255),
          started_at timestamptz NOT NULL,
          finished_at timestamptz,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flow_run_nodes_run_id_started_at
          ON automation_flow_run_nodes (run_id, started_at ASC);
        "#,
    )
    .await?;

    Ok(())
}
