use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use sea_orm::{EntityTrait, QueryOrder};
use serde::Serialize;

use crate::infrastructure::entities::{
    iam_external_identity_entity, iam_organization_membership_entity, iam_role_entity,
    iam_user_entity, iam_user_role_entity, organization_unit_entity,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationUnitResponse {
    id: String,
    source_type: String,
    external_id: String,
    parent_external_id: Option<String>,
    name: String,
    status: String,
    member_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserResponse {
    id: String,
    display_name: String,
    mobile: Option<String>,
    state_code: Option<String>,
    telephone: Option<String>,
    email: Option<String>,
    job_number: Option<String>,
    title: Option<String>,
    work_place: Option<String>,
    remark: Option<String>,
    hired_at: Option<String>,
    tenure_months: Option<i64>,
    manager_name: Option<String>,
    primary_department: Option<String>,
    senior: bool,
    is_admin: bool,
    is_boss: bool,
    real_authed: bool,
    extension_json: serde_json::Value,
    status: String,
    source_type: String,
    departments: Vec<String>,
    roles: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoleResponse {
    id: String,
    source_type: String,
    external_id: String,
    name: String,
    group_name: Option<String>,
    status: String,
    member_count: usize,
}

pub(crate) async fn list_organization_units(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<OrganizationUnitResponse>>>, AppError> {
    let units = organization_unit_entity::Entity::find()
        .order_by_asc(organization_unit_entity::Column::SortOrder)
        .order_by_asc(organization_unit_entity::Column::Name)
        .all(&state.db)
        .await?;
    let memberships = iam_organization_membership_entity::Entity::find()
        .all(&state.db)
        .await?;
    let mut member_counts = HashMap::<_, usize>::new();
    for membership in memberships {
        *member_counts
            .entry(membership.organization_unit_id)
            .or_default() += 1;
    }
    Ok(Json(success_response(
        "organization units loaded",
        units
            .into_iter()
            .map(|unit| OrganizationUnitResponse {
                id: unit.id.to_string(),
                source_type: unit.source_type,
                external_id: unit.external_id,
                parent_external_id: unit.parent_external_id,
                name: unit.name,
                status: unit.status,
                member_count: member_counts.get(&unit.id).copied().unwrap_or(0),
            })
            .collect(),
    )))
}

pub(crate) async fn list_users(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<UserResponse>>>, AppError> {
    let users = iam_user_entity::Entity::find()
        .order_by_asc(iam_user_entity::Column::DisplayName)
        .all(&state.db)
        .await?;
    let identities = iam_external_identity_entity::Entity::find()
        .all(&state.db)
        .await?;
    let memberships = iam_organization_membership_entity::Entity::find()
        .all(&state.db)
        .await?;
    let units = organization_unit_entity::Entity::find()
        .all(&state.db)
        .await?;
    let user_roles = iam_user_role_entity::Entity::find().all(&state.db).await?;
    let roles = iam_role_entity::Entity::find().all(&state.db).await?;

    let sources = identities
        .iter()
        .map(|identity| (identity.user_id, identity.provider.clone()))
        .collect::<HashMap<_, _>>();
    let users_by_external_id = identities
        .iter()
        .map(|identity| (identity.external_user_id.clone(), identity.user_id))
        .collect::<HashMap<_, _>>();
    let user_names = users
        .iter()
        .map(|user| (user.id, user.display_name.clone()))
        .collect::<HashMap<_, _>>();
    let unit_names = units
        .into_iter()
        .map(|unit| (unit.id, unit.name))
        .collect::<HashMap<_, _>>();
    let role_names = roles
        .into_iter()
        .map(|role| (role.id, role.name))
        .collect::<HashMap<_, _>>();
    let mut departments_by_user = HashMap::<_, Vec<String>>::new();
    for membership in memberships {
        if let Some(name) = unit_names.get(&membership.organization_unit_id) {
            departments_by_user
                .entry(membership.user_id)
                .or_default()
                .push(name.clone());
        }
    }
    let mut roles_by_user = HashMap::<_, Vec<String>>::new();
    for binding in user_roles {
        if let Some(name) = role_names.get(&binding.role_id) {
            roles_by_user
                .entry(binding.user_id)
                .or_default()
                .push(name.clone());
        }
    }

    Ok(Json(success_response(
        "users loaded",
        users
            .into_iter()
            .map(|user| UserResponse {
                id: user.id.to_string(),
                display_name: user.display_name,
                mobile: user.mobile,
                state_code: user.state_code,
                telephone: user.telephone,
                email: user.email,
                job_number: user.job_number,
                title: user.title,
                work_place: user.work_place,
                remark: user.remark,
                hired_at: user.hired_at.as_ref().map(|value| value.to_rfc3339()),
                tenure_months: user.hired_at.as_ref().map(|value| {
                    let days = chrono::Utc::now()
                        .signed_duration_since(value.to_owned())
                        .num_days()
                        .max(0);
                    days / 30
                }),
                manager_name: user
                    .manager_external_user_id
                    .as_ref()
                    .and_then(|external_id| users_by_external_id.get(external_id))
                    .and_then(|user_id| user_names.get(user_id))
                    .cloned(),
                primary_department: user
                    .primary_organization_unit_id
                    .and_then(|organization_id| unit_names.get(&organization_id).cloned()),
                senior: user.senior,
                is_admin: user.is_admin,
                is_boss: user.is_boss,
                real_authed: user.real_authed,
                extension_json: user.extension_json,
                status: user.status,
                source_type: sources
                    .get(&user.id)
                    .cloned()
                    .unwrap_or_else(|| "local".to_string()),
                departments: departments_by_user.remove(&user.id).unwrap_or_default(),
                roles: roles_by_user.remove(&user.id).unwrap_or_default(),
            })
            .collect(),
    )))
}

pub(crate) async fn list_roles(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<RoleResponse>>>, AppError> {
    let roles = iam_role_entity::Entity::find()
        .order_by_asc(iam_role_entity::Column::Name)
        .all(&state.db)
        .await?;
    let bindings = iam_user_role_entity::Entity::find().all(&state.db).await?;
    let mut member_counts = HashMap::<_, usize>::new();
    for binding in bindings {
        *member_counts.entry(binding.role_id).or_default() += 1;
    }

    Ok(Json(success_response(
        "roles loaded",
        roles
            .into_iter()
            .map(|role| RoleResponse {
                id: role.id.to_string(),
                source_type: role.source_type,
                external_id: role.external_id,
                name: role.name,
                group_name: role.group_name,
                status: role.status,
                member_count: member_counts.get(&role.id).copied().unwrap_or(0),
            })
            .collect(),
    )))
}
