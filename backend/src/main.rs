mod app_entity;
mod app_navigation_entity;
mod config;
mod form_definition_entity;
mod form_record_entity;
mod form_schema_entity;
mod migrator;

use std::net::SocketAddr;

use app_entity::Entity as AppEntity;
use app_navigation_entity::Entity as AppNavigationEntity;
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
        .route("/api/forms/{form_uuid}/schema", get(get_form_schema))
        .route(
            "/api/forms/{form_uuid}/records",
            get(list_form_records).post(create_form_record),
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
    let schema =
        load_schema_version(&state.db, &form_uuid, definition.published_schema_version).await?;
    let now = Utc::now();
    let operator = payload
        .operator
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("管理员")
        .to_string();

    let record = form_record_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        record_uuid: Set(generate_record_uuid()),
        app_route_app_id: Set(definition.app_route_app_id.clone()),
        form_uuid: Set(form_uuid),
        schema_version: Set(schema.version),
        record_data: Set(normalize_record_payload(payload.data)),
        created_by: Set(operator.clone()),
        updated_by: Set(operator),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    if let Some(app) = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(definition.app_route_app_id))
        .one(&state.db)
        .await?
    {
        let next_records_count = app.records_count + 1;
        let mut active_model: app_entity::ActiveModel = app.into();
        active_model.records_count = Set(next_records_count);
        active_model.updated_at = Set(now.into());
        active_model.update(&state.db).await?;
    }

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "提交表单数据成功",
            ApiFormRecord::from(record),
        )),
    ))
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

fn format_date(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%d").to_string()
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

async fn load_schema_version(
    db: &DatabaseConnection,
    form_uuid: &str,
    version: i32,
) -> Result<form_schema_entity::Model, AppError> {
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
