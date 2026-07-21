use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, Method};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Deserialize;
use std::collections::HashSet;
use uuid::Uuid;

use crate::infrastructure::entities::{
    automation_flow_entity, form_definition_entity, iam_role_entity, iam_user_entity,
    iam_user_role_entity,
};
use crate::platform::{
    config::load_rbac_permission_settings, error::AppError, prelude::ApiResponse, runtime::AppState,
};
use crate::shared::success_response;

#[derive(Deserialize)]
struct Claims {
    sub: String,
}

pub(crate) async fn authenticate(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let user_id = authenticated_user_id(headers)?;
    let user = iam_user_entity::Entity::find_by_id(user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::Forbidden("authentication required".into()))?;
    if user.status != "active" {
        return Err(AppError::Forbidden("user account is disabled".into()));
    }
    Ok(())
}

pub(crate) async fn grants(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<HashSet<String>, AppError> {
    authenticate(headers, state).await?;
    let user_id = authenticated_user_id(headers)?;
    let bindings = iam_user_role_entity::Entity::find()
        .filter(iam_user_role_entity::Column::UserId.eq(user_id))
        .all(&state.db)
        .await?;
    let role_ids = bindings
        .into_iter()
        .map(|binding| binding.role_id)
        .collect::<Vec<_>>();
    let roles = iam_role_entity::Entity::find()
        .filter(iam_role_entity::Column::Id.is_in(role_ids))
        .filter(iam_role_entity::Column::Status.eq("active"))
        .all(&state.db)
        .await?;

    if roles
        .iter()
        .any(|role| role.external_id == "system-administrator")
    {
        return Ok(HashSet::from(["*".into()]));
    }

    let settings = load_rbac_permission_settings().unwrap_or_default();
    let mut grants = HashSet::new();
    for role in roles {
        if let Some(values) = settings.grants.get(&role.id.to_string()) {
            grants.extend(values.iter().cloned());
        }
    }
    Ok(grants)
}

pub(crate) async fn get_grants(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<String>>>, AppError> {
    let mut values = grants(&headers, &state)
        .await?
        .into_iter()
        .collect::<Vec<_>>();
    values.sort();
    Ok(Json(success_response(
        "current user permissions loaded",
        values,
    )))
}

pub(crate) fn require_internal(headers: &HeaderMap) -> Result<(), AppError> {
    let provided = headers
        .get("x-yaya-internal-token")
        .and_then(|value| value.to_str().ok());
    let expected = std::env::var("BACKEND_INTERNAL_TOKEN")
        .or_else(|_| std::env::var("AUTH_TOKEN_SECRET"))
        .unwrap_or_else(|_| "yaya-development-token-secret".to_string());
    if provided == Some(expected.as_str()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "internal authentication required".into(),
        ))
    }
}

pub(crate) async fn authorize_request(
    headers: &HeaderMap,
    state: &AppState,
    method: &Method,
    path: &str,
) -> Result<(), AppError> {
    let grants = grants(headers, state).await?;
    if grants.contains("*") {
        return Ok(());
    }

    let permission = required_permission(state, method, path).await?;
    let Some(permission) = permission else {
        return Ok(());
    };
    let has_permission = grants.contains(&permission)
        || (permission == "apps.access"
            && (grants.contains("apps.manage")
                || grants
                    .iter()
                    .any(|grant| grant.starts_with("app:") && grant.ends_with(":display"))));
    if !has_permission {
        Err(AppError::Forbidden("permission denied".into()))
    } else if let Some(app_display_permission) =
        required_app_display_permission(state, &permission).await?
    {
        if grants.contains(&app_display_permission) {
            Ok(())
        } else {
            Err(AppError::Forbidden(
                "application visibility permission denied".into(),
            ))
        }
    } else {
        Ok(())
    }
}

/// Application visibility is the parent boundary for application and form actions.
async fn required_app_display_permission(
    state: &AppState,
    permission: &str,
) -> Result<Option<String>, AppError> {
    if let Some(app_permission) = permission.strip_prefix("app:") {
        let (app_id, _) = app_permission
            .rsplit_once(':')
            .ok_or_else(|| AppError::BadRequest("invalid application permission".to_string()))?;
        return Ok(Some(format!("app:{app_id}:display")));
    }

    let Some(form_permission) = permission.strip_prefix("form:") else {
        return Ok(None);
    };
    let (form_uuid, _) = form_permission
        .rsplit_once(':')
        .ok_or_else(|| AppError::BadRequest("invalid form permission".to_string()))?;
    let form = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
    Ok(Some(format!("app:{}:display", form.app_route_app_id)))
}

async fn required_permission(
    state: &AppState,
    method: &Method,
    path: &str,
) -> Result<Option<String>, AppError> {
    let platform_permission = match path {
        "/api/settings/database" => Some("settings.database"),
        "/api/settings/agent" => Some("settings.agent"),
        "/api/settings/identity-source"
        | "/api/settings/identity-source/dingtalk/access-token"
        | "/api/settings/identity-source/dingtalk/sync-departments"
        | "/api/settings/identity-source/dingtalk/sync-users"
        | "/api/settings/identity-source/dingtalk/clear" => Some("settings.identity-source"),
        "/api/identity/organization-units" => Some("settings.organization"),
        "/api/identity/users" => Some("settings.users"),
        "/api/identity/roles" | "/api/settings/permissions" => Some("settings.roles"),
        _ if path.starts_with("/api/identity/users/") => Some("settings.users"),
        _ if path.starts_with("/api/identity/roles/")
            || path.starts_with("/api/settings/permissions/") =>
        {
            Some("settings.roles")
        }
        _ if path.starts_with("/api/agent/sessions") => Some("agent.window"),
        _ if path.starts_with("/api/agent/")
            || path == "/api/agents"
            || path.starts_with("/api/agents/") =>
        {
            Some("settings.agent")
        }
        _ => None,
    };
    if let Some(permission) = platform_permission {
        return Ok(Some(permission.to_string()));
    }

    let segments = path.trim_matches('/').split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        ["api", "apps"] if method == Method::GET || method == Method::HEAD => {
            Ok(Some("apps.access".to_string()))
        }
        ["api", "apps"] if method == Method::POST => Ok(Some("apps.manage".to_string())),
        ["api", "apps", app_id] if method == Method::DELETE => Ok(Some("apps.manage".to_string())),
        ["api", "apps", app_id] if method == Method::PATCH => {
            Ok(Some(format!("app:{app_id}:edit_info")))
        }
        ["api", "apps", app_id] => Ok(Some(app_permission(app_id, method))),
        ["api", "apps", _app_id, "field-outline"] => Ok(Some("designer.access".to_string())),
        ["api", "apps", app_id, "forms"] if method == Method::POST => {
            Ok(Some(format!("app:{app_id}:create_form")))
        }
        ["api", "apps", app_id, "navigation", "groups"] if method == Method::POST => {
            Ok(Some(format!("app:{app_id}:create_group")))
        }
        ["api", "apps", app_id, "automations"] => Ok(Some(format!("app:{app_id}:automation"))),
        ["api", "apps", app_id, "navigation"] | ["api", "apps", app_id, "forms"] => {
            Ok(Some(app_permission(app_id, method)))
        }
        ["api", "apps", app_id, "navigation", "groups"] => Ok(Some(app_permission(app_id, method))),
        ["api", "forms", form_uuid, "views", ..]
            if method != Method::GET && method != Method::HEAD =>
        {
            form_development_permission(state, form_uuid, "view_development").await
        }
        ["api", "forms", form_uuid, ..] => {
            if method == Method::DELETE && segments.len() == 3 {
                return form_development_permission(state, form_uuid, "delete_form").await;
            }
            if method == Method::POST && segments.get(3) == Some(&"publish") {
                return form_development_permission(state, form_uuid, "publish").await;
            }
            if method == Method::POST && segments.get(3) == Some(&"schema") {
                return form_development_permission(state, form_uuid, "edit_form").await;
            }
            let action = form_action(method, segments.get(3).copied());
            Ok(Some(format!("form:{form_uuid}:{action}")))
        }
        ["api", "automations", flow_uuid, ..] => {
            let flow = automation_flow_entity::Entity::find()
                .filter(automation_flow_entity::Column::FlowUuid.eq(*flow_uuid))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
            Ok(Some(format!("app:{}:automation", flow.app_route_app_id)))
        }
        _ => Ok(None),
    }
}

async fn form_development_permission(
    state: &AppState,
    form_uuid: &str,
    action: &str,
) -> Result<Option<String>, AppError> {
    let form = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
    Ok(Some(format!("app:{}:{action}", form.app_route_app_id)))
}

fn app_permission(app_id: &str, method: &Method) -> String {
    let action = if method == Method::GET || method == Method::HEAD {
        "display"
    } else {
        "edit"
    };
    format!("app:{app_id}:{action}")
}

fn form_action(method: &Method, resource: Option<&str>) -> &'static str {
    match method.as_str() {
        "GET" | "HEAD" => "display",
        "POST" if resource == Some("records") => "create",
        "DELETE" => "delete",
        _ => "edit",
    }
}

fn authenticated_user_id(headers: &HeaderMap) -> Result<Uuid, AppError> {
    let token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Forbidden("authentication required".into()))?;
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(
            std::env::var("AUTH_TOKEN_SECRET")
                .unwrap_or_else(|_| "yaya-development-token-secret".into())
                .as_bytes(),
        ),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| AppError::Forbidden("invalid authentication token".into()))?
    .claims;

    Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::Forbidden("invalid authentication token".into()))
}
