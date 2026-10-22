use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, Method};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use uuid::Uuid;

use crate::infrastructure::entities::{
    automation_flow_entity, form_definition_entity, iam_role_entity, iam_user_entity,
    iam_user_role_entity,
};
use crate::platform::{error::AppError, prelude::ApiResponse, rbac, runtime::AppState};
use crate::shared::success_response;

#[derive(Deserialize)]
struct Claims {
    sub: String,
}

pub(crate) async fn authenticate(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let user = current_user(headers, state).await?;
    if user.status != "active" {
        return Err(AppError::Forbidden("user account is disabled".into()));
    }
    Ok(())
}

pub(crate) async fn current_user(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<iam_user_entity::Model, AppError> {
    let user_id = authenticated_user_id(headers)?;
    iam_user_entity::Entity::find_by_id(user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::Forbidden("authentication required".into()))
}

/// Resolve the user's effective tenant. New accounts normally have the
/// denormalized primary organization field; older/local accounts may only
/// have an organization membership row.
pub(crate) async fn resolved_tenant_id(
    state: &AppState,
    user: &iam_user_entity::Model,
) -> Result<Uuid, AppError> {
    if let Some(id) = user.primary_organization_unit_id {
        return Ok(id);
    }
    let membership = crate::infrastructure::entities::iam_organization_membership_entity::Entity::find()
        .filter(crate::infrastructure::entities::iam_organization_membership_entity::Column::UserId.eq(user.id))
        .order_by_desc(crate::infrastructure::entities::iam_organization_membership_entity::Column::IsPrimary)
        .order_by_asc(crate::infrastructure::entities::iam_organization_membership_entity::Column::CreatedAt)
        .one(&state.db)
        .await?;
    membership
        .map(|item| item.organization_unit_id)
        .ok_or_else(|| AppError::Forbidden("tenant scope is required".to_string()))
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

    Ok(super::platform_permissions::effective(
        rbac::grants_for_roles(&state.db, roles.into_iter().map(|role| role.id).collect())
            .await?
            .into_iter()
            .filter(|grant| grant != "*"),
    ))
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

/// Stable identity contract for the external Cordis Agent runtime. The bearer
/// token is still validated here; the Agent only receives the resolved subject
/// and permission snapshot for request/session correlation.
pub(crate) async fn get_runtime_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let user = current_user(&headers, &state).await?;
    authenticate(&headers, &state).await?;
    let grants = grants(&headers, &state).await?;
    let mut grants = grants.into_iter().collect::<Vec<_>>();
    grants.sort();
    Ok(Json(success_response(
        "agent runtime identity loaded",
        json!({
            "userId": user.id.to_string(),
            "tenantId": resolved_tenant_id(&state, &user).await?.to_string(),
            "displayName": user.display_name,
            "grants": grants,
        }),
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

    // Session ownership is checked in the handler; employee access must also survive revocation.
    if let Some(session_path) = path.strip_prefix("/api/agent/sessions/") {
        let session_uuid = session_path.split('/').next().unwrap_or_default();
        if !path.ends_with("/restore") && !path.ends_with("/purge") {
            if let Some(session) =
                crate::infrastructure::entities::agent_session_entity::Entity::find()
                    .filter(
                        crate::infrastructure::entities::agent_session_entity::Column::SessionUuid
                            .eq(session_uuid),
                    )
                    .one(&state.db)
                    .await?
            {
                if !grants.contains(&format!("agent:{}:use", session.agent_id)) {
                    return Err(AppError::Forbidden("无权使用此 AI 员工".into()));
                }
            }
        }
    }
    if let Some(required) = super::platform_permissions::route_permissions(method, path) {
        if required.is_empty()
            || required
                .iter()
                .any(|permission| grants.contains(*permission))
        {
            return Ok(());
        }
        return Err(AppError::Forbidden("permission denied".into()));
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
    let segments = path.trim_matches('/').split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        // Application listing and detail visibility are filtered in the apps
        // module so that creators can still find their paused apps while
        // ordinary users only receive enabled apps with display permission.
        ["api", "apps"] if method == Method::GET || method == Method::HEAD => Ok(None),
        ["api", "apps"] if method == Method::POST => Ok(Some("apps.manage".to_string())),
        ["api", "apps", _app_id] if method == Method::DELETE || method == Method::PATCH => {
            // Ownership and system-administrator exceptions are enforced by
            // the apps module after loading the application record.
            Ok(None)
        }
        ["api", "apps", _app_id] if method == Method::GET || method == Method::HEAD => Ok(None),
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
        ["api", "forms", form_uuid, "custom-button-options"] => {
            form_development_permission(state, form_uuid, "view_development").await
        }
        [
            "api",
            "forms",
            form_uuid,
            "custom-buttons",
            "automation-options",
        ] if method == Method::GET || method == Method::HEAD => {
            form_development_permission(state, form_uuid, "view_development").await
        }
        ["api", "forms", form_uuid, "custom-buttons", ..] => {
            form_development_permission(state, form_uuid, "edit_form").await
        }
        ["api", "forms", form_uuid, "views", _, "custom-buttons", ..] => {
            Ok(Some(format!("form:{form_uuid}:display")))
        }
        ["api", "forms", form_uuid, "views", ..]
            if method != Method::GET && method != Method::HEAD =>
        {
            form_development_permission(state, form_uuid, "view_development").await
        }
        ["api", "forms", form_uuid, ..] => {
            if method == Method::DELETE && segments.len() == 3 {
                return form_development_permission(state, form_uuid, "delete_form").await;
            }
            if method == Method::POST && segments.get(3) == Some(&"schema") {
                return form_development_permission(state, form_uuid, "edit_form").await;
            }
            if method == Method::POST
                && segments.get(3) == Some(&"workflow")
                && segments.get(4) == Some(&"process")
            {
                return form_development_permission(state, form_uuid, "edit_form").await;
            }
            // The handler checks create/edit permission according to the validation body.
            if segments.get(3) == Some(&"records") && segments.get(4) == Some(&"validate") {
                return Ok(None);
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
