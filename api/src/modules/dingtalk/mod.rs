mod client;
mod dto;
mod sync;

pub(crate) use sync::{DepartmentSyncResponse, UserSyncResponse};

use axum::Json;
use axum::extract::State;
use chrono::{Duration, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde::Serialize;
use utoipa::ToSchema;

use crate::infrastructure::entities::{
    iam_external_identity_entity, iam_organization_membership_entity, iam_role_entity,
    iam_user_entity, iam_user_role_entity, organization_unit_entity,
};
use crate::modules::settings::default_identity_source_settings;
use crate::platform::config::{
    IdentitySourceSettings, load_identity_source_settings, load_rbac_permission_settings,
    save_identity_source_settings, save_rbac_permission_settings,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessTokenResponse {
    access_token: String,
    expires_in: u64,
    expires_at: String,
}

pub(crate) async fn refresh_access_token(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<AccessTokenResponse>>, AppError> {
    let mut settings =
        load_identity_source_settings().unwrap_or_else(default_identity_source_settings);
    let token = resolve_access_token(&mut settings, true).await?;

    Ok(Json(success_response(
        "dingtalk access token refreshed",
        token,
    )))
}

pub(crate) async fn sync_departments(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<sync::DepartmentSyncResponse>>, AppError> {
    let mut settings =
        load_identity_source_settings().unwrap_or_else(default_identity_source_settings);
    let token = resolve_access_token(&mut settings, false).await?;
    let departments = client::list_all_departments(&token.access_token).await?;
    let result = sync::save_departments(&state.db, departments).await?;

    Ok(Json(success_response(
        "dingtalk departments synchronized",
        result,
    )))
}

pub(crate) async fn sync_users(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<sync::UserSyncResponse>>, AppError> {
    let mut settings =
        load_identity_source_settings().unwrap_or_else(default_identity_source_settings);
    let token = resolve_access_token(&mut settings, false).await?;
    let units = organization_unit_entity::Entity::find()
        .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
        .filter(organization_unit_entity::Column::Status.eq("active"))
        .all(&state.db)
        .await?;
    let mut department_ids = vec![1_i64];
    department_ids.extend(
        units
            .iter()
            .filter_map(|unit| unit.external_id.parse::<i64>().ok()),
    );
    department_ids.sort_unstable();
    department_ids.dedup();

    let users = client::list_users_for_departments(&token.access_token, &department_ids).await?;
    let result = sync::save_users(&state.db, users).await?;

    Ok(Json(success_response(
        "dingtalk users synchronized",
        result,
    )))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearDingTalkDataResponse {
    deleted_users: usize,
    deleted_roles: usize,
    deleted_organization_units: usize,
    deleted_role_permissions: usize,
}

pub(crate) async fn clear_dingtalk_data(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<ClearDingTalkDataResponse>>, AppError> {
    let transaction = state.db.begin().await?;
    let identities = iam_external_identity_entity::Entity::find()
        .filter(iam_external_identity_entity::Column::Provider.eq("dingtalk"))
        .all(&transaction)
        .await?;
    let user_ids = identities
        .iter()
        .map(|identity| identity.user_id)
        .collect::<Vec<_>>();
    let roles = iam_role_entity::Entity::find()
        .filter(iam_role_entity::Column::SourceType.eq("dingtalk"))
        .all(&transaction)
        .await?;
    let role_ids = roles.iter().map(|role| role.id).collect::<Vec<_>>();
    let units = organization_unit_entity::Entity::find()
        .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
        .all(&transaction)
        .await?;

    if !role_ids.is_empty() {
        iam_user_role_entity::Entity::delete_many()
            .filter(iam_user_role_entity::Column::RoleId.is_in(role_ids.clone()))
            .exec(&transaction)
            .await?;
    }
    if !user_ids.is_empty() {
        iam_user_role_entity::Entity::delete_many()
            .filter(iam_user_role_entity::Column::UserId.is_in(user_ids.clone()))
            .exec(&transaction)
            .await?;
        iam_organization_membership_entity::Entity::delete_many()
            .filter(iam_organization_membership_entity::Column::UserId.is_in(user_ids.clone()))
            .exec(&transaction)
            .await?;
        iam_external_identity_entity::Entity::delete_many()
            .filter(iam_external_identity_entity::Column::Provider.eq("dingtalk"))
            .exec(&transaction)
            .await?;
        iam_user_entity::Entity::delete_many()
            .filter(iam_user_entity::Column::Id.is_in(user_ids))
            .exec(&transaction)
            .await?;
    }
    if !role_ids.is_empty() {
        iam_role_entity::Entity::delete_many()
            .filter(iam_role_entity::Column::Id.is_in(role_ids))
            .exec(&transaction)
            .await?;
    }
    organization_unit_entity::Entity::delete_many()
        .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
        .exec(&transaction)
        .await?;
    transaction.commit().await?;

    let mut permissions = load_rbac_permission_settings().unwrap_or_default();
    let deleted_role_permissions = roles
        .iter()
        .filter(|role| permissions.grants.remove(&role.id.to_string()).is_some())
        .count();
    if deleted_role_permissions > 0 {
        save_rbac_permission_settings(&permissions).map_err(AppError::Server)?;
    }

    Ok(Json(success_response(
        "dingtalk synchronized data cleared",
        ClearDingTalkDataResponse {
            deleted_users: identities.len(),
            deleted_roles: roles.len(),
            deleted_organization_units: units.len(),
            deleted_role_permissions,
        },
    )))
}

async fn resolve_access_token(
    settings: &mut IdentitySourceSettings,
    force_refresh: bool,
) -> Result<AccessTokenResponse, AppError> {
    for (label, value) in [
        ("App ID", settings.dingtalk.app_id.trim()),
        ("AgentId", settings.dingtalk.agent_id.trim()),
        ("Client ID", settings.dingtalk.client_id.trim()),
        ("Client Secret", settings.dingtalk.client_secret.trim()),
    ] {
        if value.is_empty() {
            return Err(AppError::BadRequest(format!(
                "dingtalk {label} is required"
            )));
        }
    }

    if !force_refresh
        && !settings.dingtalk.access_token.is_empty()
        && settings
            .dingtalk
            .access_token_expires_at
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .is_some_and(|value| value.with_timezone(&Utc) > Utc::now() + Duration::seconds(60))
    {
        let expires_at = settings
            .dingtalk
            .access_token_expires_at
            .clone()
            .unwrap_or_default();
        let expires_in = chrono::DateTime::parse_from_rfc3339(&expires_at)
            .map(|value| {
                (value.with_timezone(&Utc) - Utc::now())
                    .num_seconds()
                    .max(0) as u64
            })
            .unwrap_or(0);
        return Ok(AccessTokenResponse {
            access_token: settings.dingtalk.access_token.clone(),
            expires_in,
            expires_at,
        });
    }

    let token = client::request_access_token(
        settings.dingtalk.client_id.trim(),
        settings.dingtalk.client_secret.trim(),
    )
    .await?;
    let expires_at = Utc::now() + Duration::seconds(token.expire_in as i64);

    settings.dingtalk.access_token = token.access_token.clone();
    settings.dingtalk.access_token_expires_at = Some(expires_at.to_rfc3339());
    save_identity_source_settings(&settings).map_err(AppError::Server)?;

    Ok(AccessTokenResponse {
        access_token: token.access_token,
        expires_in: token.expire_in,
        expires_at: expires_at.to_rfc3339(),
    })
}
