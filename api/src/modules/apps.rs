use crate::infrastructure::entities::iam_user_entity;
use crate::modules::navigation::ensure_system_navigation_for_app;
use crate::platform::authorization;
use crate::platform::form_storage::delete_storage_definition;
use crate::platform::prelude::*;
use crate::platform::records::RecordRepository;
use crate::shared::*;
use axum::http::HeaderMap;
use axum::http::StatusCode;

pub(crate) async fn list_apps(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApiApp>>>, AppError> {
    let items = AppEntity::find()
        .order_by_desc(app_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    let grants = authorization::grants(&headers, &state).await?;
    let all = grants.contains("*") || grants.contains("apps.manage");
    let mut responses = Vec::new();
    for app in items {
        if all || grants.contains(&format!("app:{}:display", app.route_app_id)) {
            responses.push(app_response(&state.db, app).await?);
        }
    }

    Ok(Json(success_response("获取应用列表成功", responses)))
}

pub(crate) async fn create_app(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<CreateAppRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiApp>>), AppError> {
    let payload = payload
        .map(|Json(value)| value)
        .unwrap_or(CreateAppRequest { name: None });
    let now = Utc::now();
    let route_app_id = generate_route_app_id();
    let app_name = payload
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("未命名应用 {}", now.format("%m%d%H%M")));
    let owner = authorization::current_user(&headers, &state).await?;
    let owner_name = owner.display_name.clone();

    let active_model = app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set(route_app_id),
        name: Set(app_name),
        description: Set("空白应用".to_string()),
        icon: Set("general".to_string()),
        badge: Set(None),
        color: Set("primary".to_string()),
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
        Json(success_response(
            "创建应用成功",
            app_response(&state.db, created).await?,
        )),
    ))
}

pub(crate) async fn get_app(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<ApiApp>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    Ok(Json(success_response(
        "获取应用成功",
        app_response(&state.db, app).await?,
    )))
}

pub(crate) async fn update_app(
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
        app_response(&state.db, updated).await?,
    )))
}

async fn app_response(db: &DatabaseConnection, app: app_entity::Model) -> Result<ApiApp, AppError> {
    let owner_avatar_url = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::DisplayName.eq(app.owner_name.clone()))
        .one(db)
        .await?
        .and_then(|user| user.avatar_url);
    let mut response = ApiApp::from(app);
    response.owner_avatar_url = owner_avatar_url;
    Ok(response)
}

pub(crate) async fn delete_app(
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
    let record_repository = RecordRepository::new(&txn);

    for form_uuid in form_uuids {
        record_repository.delete_by_form(&form_uuid).await?;
        delete_storage_definition(&txn, &form_uuid).await?;
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
pub(crate) mod dto;

pub(crate) use dto::*;
