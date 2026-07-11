mod app_entity;
mod app_navigation_entity;
mod automation_flow_entity;
mod automation_flow_version_entity;
mod automation_run_entity;
mod automation_run_node_entity;
mod automation_node_entity;
mod automation_edge_entity;
mod automations;
mod config;
mod apps;
mod forms;
mod navigation;
mod shared;
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
    sea_query::Expr,
    ActiveValue::Set, ColumnTrait, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait, Value as SeaValue,
};
use sea_orm_migration::MigratorTrait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::*;
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
    navigation::ensure_system_navigation_items(&db).await?;

    let state = AppState { db };
    let app = Router::new()
        .route("/healthz", get(health_check))
        .route("/api/apps", get(apps::list_apps).post(apps::create_app))
        .route("/api/apps/{app_id}", patch(apps::update_app).delete(apps::delete_app))
        .route(
            "/api/apps/{app_id}/navigation",
            get(navigation::list_navigation_items).patch(navigation::reorder_navigation_item),
        )
        .route(
            "/api/apps/{app_id}/navigation/groups",
            post(navigation::create_navigation_group),
        )
        .route(
            "/api/apps/{app_id}/forms",
            get(forms::list_forms).post(forms::create_form),
        )
        .route(
            "/api/apps/{app_id}/automations",
            get(automations::list_automation_flows).post(automations::create_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}",
            get(automations::get_automation_flow)
                .patch(automations::update_automation_flow)
                .delete(automations::delete_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}/versions",
            get(automations::list_automation_flow_versions),
        )
        .route(
            "/api/automations/{flow_uuid}/versions/{version}/restore",
            post(automations::restore_automation_flow_version),
        )
        .route(
            "/api/automations/{flow_uuid}/runs",
            get(automations::list_automation_flow_runs),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/retry",
            post(automations::retry_automation_flow_run),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/nodes/{node_key}/retry",
            post(automations::retry_automation_flow_run_node),
        )
        .route("/api/forms/{form_uuid}/schema", get(forms::get_form_schema))
        .route(
            "/api/forms/{form_uuid}/records",
            get(forms::list_form_records).post(forms::create_form_record),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}",
            patch(forms::update_form_record).delete(forms::delete_form_record),
        )
        .route("/api/forms/{form_uuid}/versions", get(forms::list_form_versions))
        .route(
            "/api/forms/{form_uuid}/versions/{version}",
            get(forms::get_form_version),
        )
        .route("/api/forms/{form_uuid}/publish", post(forms::publish_form_schema))
        .route(
            "/api/forms/{form_uuid}/versions/{version}/restore",
            post(forms::restore_form_version),
        )
        .route(
            "/api/forms/{form_uuid}/schema/draft",
            post(forms::save_form_schema),
        )
        .route("/api/forms/{form_uuid}", axum::routing::delete(forms::delete_form))
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
        forms::load_schema_version_for_connection(
            db,
            &definition.form_uuid,
            definition.published_schema_version,
        )
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
        created_at: Set(now),
        updated_at: Set(now),
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
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(db)
        .await?;

    if app.is_some() {
        AppEntity::update_many()
            .col_expr(
                app_entity::Column::RecordsCount,
                sea_orm::ExprTrait::add(Expr::col(app_entity::Column::RecordsCount), 1),
            )
            .col_expr(app_entity::Column::UpdatedAt, Expr::value(now))
            .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
            .exec(db)
            .await?;
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
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
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
    active_model.finished_at = Set(Some(now));
    active_model.updated_at = Set(now);
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
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
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
    active_model.finished_at = Set(Some(now));
    active_model.updated_at = Set(now);
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

    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(db)
        .await?;

    if app.is_some() {
        AppEntity::update_many()
            .col_expr(
                app_entity::Column::RecordsCount,
                Expr::cust_with_values(
                    r#"GREATEST("records_count" - $1, 0)"#,
                    vec![SeaValue::BigInt(Some(count))],
                ),
            )
            .col_expr(app_entity::Column::UpdatedAt, Expr::value(now))
            .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
            .exec(db)
            .await?;
    }

    Ok(())
}


async fn ensure_system_navigation_for_app(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    navigation::ensure_system_navigation_for_app(db, app_id).await
}

async fn next_navigation_sort_order(
    db: &DatabaseConnection,
    app_id: &str,
    parent_id: Option<Uuid>,
) -> Result<i32, AppError> {
    navigation::next_navigation_sort_order(db, app_id, parent_id).await
}

async fn normalize_navigation_orders(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    navigation::normalize_navigation_orders(db, app_id).await
}

async fn sync_navigation_title(
    db: &DatabaseConnection,
    form_uuid: &str,
    name: &str,
    slug: &str,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    navigation::sync_navigation_title(db, form_uuid, name, slug, now).await
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
