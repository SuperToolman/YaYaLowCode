use crate::infrastructure::entities::iam_user_entity;
use crate::modules::navigation::ensure_system_navigation_for_app;
use crate::platform::authorization;
use crate::platform::prelude::*;
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
    let current_user = authorization::current_user(&headers, &state).await?;
    // Application managers must be able to see all applications, including
    // applications that were explicitly paused. Some deployments expose the
    // administrator role as `apps.manage` without the legacy wildcard grant.
    let system_administrator = grants.contains("*") || grants.contains("apps.manage");
    let mut responses = Vec::new();
    for app in items {
        let is_owner = app.creator_user_id == Some(current_user.id)
            || (app.creator_user_id.is_none() && app.owner_name == current_user.display_name);
        let is_visible = grants.contains(&format!("app:{}:display", app.route_app_id));
        if system_administrator || is_owner || is_visible {
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
        .unwrap_or(CreateAppRequest {
            name: None,
            description: None,
            icon: None,
        });
    let owner = authorization::current_user(&headers, &state).await?;
    let created = create_app_definition(&state.db, &owner, payload).await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建应用成功",
            app_response(&state.db, created).await?,
        )),
    ))
}

pub(crate) async fn create_app_definition(
    db: &DatabaseConnection,
    owner: &iam_user_entity::Model,
    payload: CreateAppRequest,
) -> Result<app_entity::Model, AppError> {
    let now = Utc::now();
    let route_app_id = generate_route_app_id();
    let app_name = payload
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("未命名应用 {}", now.format("%m%d%H%M")));
    let description = payload
        .description
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default();
    let icon = payload
        .icon
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "general".to_string());
    let owner_name = owner.display_name.clone();

    let active_model = app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set(route_app_id),
        name: Set(app_name),
        description: Set(description),
        icon: Set(icon),
        badge: Set(None),
        color: Set("primary".to_string()),
        creator_user_id: Set(Some(owner.id)),
        deployment_type: Set("local".to_string()),
        online_version: Set(None),
        online_release_id: Set(None),
        owner_name: Set(owner_name),
        records_count: Set(0),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    };

    let created = active_model.insert(db).await?;
    ensure_system_navigation_for_app(db, &created.route_app_id).await?;
    Ok(created)
}

pub(crate) async fn get_app(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<ApiApp>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    let grants = authorization::grants(&headers, &state).await?;
    let current_user = authorization::current_user(&headers, &state).await?;
    let visible = grants.contains("*")
        || grants.contains("apps.manage")
        || app.creator_user_id == Some(current_user.id)
        || (app.creator_user_id.is_none() && app.owner_name == current_user.display_name)
        || grants.contains(&format!("app:{}:display", app.route_app_id));
    if !visible {
        return Err(AppError::NotFound("app not found".to_string()));
    }

    Ok(Json(success_response(
        "获取应用成功",
        app_response(&state.db, app).await?,
    )))
}

pub(crate) async fn update_app(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app_id): Path<String>,
    Json(payload): Json<UpdateAppRequest>,
) -> Result<Json<ApiResponse<ApiApp>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    let current_user = authorization::current_user(&headers, &state).await?;
    let app = update_app_definition(&state.db, &app_id, payload, &current_user, &grants).await?;
    Ok(Json(success_response(
        "更新应用成功",
        app_response(&state.db, app).await?,
    )))
}

pub(crate) async fn update_app_definition(
    db: &DatabaseConnection,
    app_id: &str,
    payload: UpdateAppRequest,
    current_user: &iam_user_entity::Model,
    grants: &std::collections::HashSet<String>,
) -> Result<app_entity::Model, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;
    if !grants.contains("*")
        && app.creator_user_id != Some(current_user.id)
        && !(app.creator_user_id.is_none() && app.owner_name == current_user.display_name)
    {
        return Err(AppError::Forbidden(
            "只有应用创建人可以管理该应用".to_string(),
        ));
    }
    let mut active_model: app_entity::ActiveModel = app.into();
    let now = Utc::now();

    if let Some(name) = payload.name {
        let next_name = name.trim();
        if !next_name.is_empty() {
            active_model.name = Set(next_name.to_string());
        }
    }

    if let Some(description) = payload.description {
        active_model.description = Set(description.trim().to_string());
    }

    if let Some(icon) = payload.icon {
        let next_icon = icon.trim();
        if !next_icon.is_empty() {
            active_model.icon = Set(next_icon.to_string());
        }
    }

    active_model.updated_at = Set(now.into());
    Ok(active_model.update(db).await?)
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
    headers: HeaderMap,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let current_user = authorization::current_user(&headers, &state).await?;
    let grants = authorization::grants(&headers, &state).await?;
    delete_app_definition(&state, &app_id, &current_user, &grants).await?;
    Ok(Json(success_response(
        "删除应用成功",
        json!({ "deleted": true }),
    )))
}

pub(crate) async fn delete_app_definition(
    state: &AppState,
    app_id: &str,
    current_user: &iam_user_entity::Model,
    grants: &std::collections::HashSet<String>,
) -> Result<(), AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;

    if !grants.contains("*")
        && app.creator_user_id != Some(current_user.id)
        && !(app.creator_user_id.is_none() && app.owner_name == current_user.display_name)
    {
        return Err(AppError::Forbidden(
            "只有应用创建人可以管理该应用".to_string(),
        ));
    }

    let txn = state.db.begin().await?;
    deletion::delete_app_contents(&txn, app_id).await?;
    txn.commit().await?;

    Ok(())
}
pub(crate) mod deletion;
pub(crate) mod dto;

#[cfg(test)]
mod delete_tests;

pub(crate) use dto::*;
