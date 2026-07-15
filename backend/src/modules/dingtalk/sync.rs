use std::collections::{HashMap, HashSet};

use chrono::Utc;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Serialize;
use uuid::Uuid;

use crate::infrastructure::entities::{
    iam_external_identity_entity, iam_organization_membership_entity, iam_role_entity,
    iam_user_entity, iam_user_role_entity, organization_unit_entity,
};
use crate::platform::error::AppError;

use super::dto::{DingTalkDepartment, DingTalkUser};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DepartmentSyncResponse {
    total: usize,
    created: usize,
    updated: usize,
    disabled: usize,
    synchronized_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserSyncResponse {
    total: usize,
    created: usize,
    updated: usize,
    disabled: usize,
    memberships: usize,
    roles: usize,
    role_bindings: usize,
    synchronized_at: String,
}

pub(super) async fn save_departments(
    db: &DatabaseConnection,
    departments: Vec<DingTalkDepartment>,
) -> Result<DepartmentSyncResponse, AppError> {
    let now = Utc::now();
    let mut created = 0;
    let mut updated = 0;
    let external_ids = departments
        .iter()
        .map(|department| department.dept_id.to_string())
        .collect::<HashSet<_>>();

    for department in &departments {
        let external_id = department.dept_id.to_string();
        let parent_external_id =
            (department.parent_id > 1).then(|| department.parent_id.to_string());
        let raw_json = serde_json::to_value(department).unwrap_or_else(|_| serde_json::json!({}));
        let existing = organization_unit_entity::Entity::find()
            .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
            .filter(organization_unit_entity::Column::ExternalId.eq(external_id.clone()))
            .one(db)
            .await?;

        if let Some(existing) = existing {
            let mut active: organization_unit_entity::ActiveModel = existing.into();
            active.parent_external_id = Set(parent_external_id);
            active.name = Set(department.name.clone());
            active.sort_order = Set(department.order);
            active.status = Set("active".to_string());
            active.raw_json = Set(raw_json);
            active.updated_at = Set(now.into());
            organization_unit_entity::Entity::update(active)
                .exec(db)
                .await?;
            updated += 1;
        } else {
            organization_unit_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                source_type: Set("dingtalk".to_string()),
                external_id: Set(external_id),
                parent_external_id: Set(parent_external_id),
                name: Set(department.name.clone()),
                sort_order: Set(department.order),
                status: Set("active".to_string()),
                raw_json: Set(raw_json),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(db)
            .await?;
            created += 1;
        }
    }

    let existing_units = organization_unit_entity::Entity::find()
        .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
        .all(db)
        .await?;
    let mut disabled = 0;
    for unit in existing_units {
        if !external_ids.contains(&unit.external_id) && unit.status != "inactive" {
            let mut active: organization_unit_entity::ActiveModel = unit.into();
            active.status = Set("inactive".to_string());
            active.updated_at = Set(now.into());
            organization_unit_entity::Entity::update(active)
                .exec(db)
                .await?;
            disabled += 1;
        }
    }

    Ok(DepartmentSyncResponse {
        total: departments.len(),
        created,
        updated,
        disabled,
        synchronized_at: now.to_rfc3339(),
    })
}

pub(super) async fn save_users(
    db: &DatabaseConnection,
    users: Vec<DingTalkUser>,
) -> Result<UserSyncResponse, AppError> {
    let now = Utc::now();
    let organization_units = organization_unit_entity::Entity::find()
        .filter(organization_unit_entity::Column::SourceType.eq("dingtalk"))
        .filter(organization_unit_entity::Column::Status.eq("active"))
        .all(db)
        .await?;
    let organization_map = organization_units
        .into_iter()
        .map(|unit| (unit.external_id, unit.id))
        .collect::<HashMap<_, _>>();
    let synchronized_user_ids = users
        .iter()
        .map(|user| user.userid.clone())
        .collect::<HashSet<_>>();
    let mut synchronized_role_ids = HashSet::new();
    let mut created = 0;
    let mut updated = 0;
    let mut membership_count = 0;
    let mut role_binding_count = 0;

    for user in &users {
        let raw_json = serde_json::to_value(user).unwrap_or_else(|_| serde_json::json!({}));
        let identity = iam_external_identity_entity::Entity::find()
            .filter(iam_external_identity_entity::Column::Provider.eq("dingtalk"))
            .filter(iam_external_identity_entity::Column::ExternalUserId.eq(user.userid.clone()))
            .one(db)
            .await?;

        let user_id = if let Some(identity) = identity {
            let user_id = identity.user_id;
            if let Some(existing_user) =
                iam_user_entity::Entity::find_by_id(user_id).one(db).await?
            {
                let mut active: iam_user_entity::ActiveModel = existing_user.into();
                apply_user_fields(&mut active, user, &organization_map, now);
                iam_user_entity::Entity::update(active).exec(db).await?;
            }
            let mut identity_active: iam_external_identity_entity::ActiveModel = identity.into();
            identity_active.union_id = Set(optional_text(&user.unionid));
            identity_active.raw_json = Set(raw_json);
            identity_active.updated_at = Set(now.into());
            iam_external_identity_entity::Entity::update(identity_active)
                .exec(db)
                .await?;
            updated += 1;
            user_id
        } else {
            let user_id = Uuid::new_v4();
            let mut user_active = iam_user_entity::ActiveModel {
                id: Set(user_id),
                display_name: Set(String::new()),
                mobile: Set(None),
                state_code: Set(None),
                telephone: Set(None),
                email: Set(None),
                avatar_url: Set(None),
                job_number: Set(None),
                title: Set(None),
                work_place: Set(None),
                remark: Set(None),
                hired_at: Set(None),
                manager_external_user_id: Set(None),
                primary_organization_unit_id: Set(None),
                senior: Set(false),
                is_admin: Set(false),
                is_boss: Set(false),
                real_authed: Set(false),
                extension_json: Set(serde_json::json!({})),
                status: Set("active".to_string()),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            };
            apply_user_fields(&mut user_active, user, &organization_map, now);
            user_active.insert(db).await?;
            iam_external_identity_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(user_id),
                provider: Set("dingtalk".to_string()),
                external_user_id: Set(user.userid.clone()),
                union_id: Set(optional_text(&user.unionid)),
                raw_json: Set(raw_json),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(db)
            .await?;
            created += 1;
            user_id
        };

        iam_organization_membership_entity::Entity::delete_many()
            .filter(iam_organization_membership_entity::Column::UserId.eq(user_id))
            .exec(db)
            .await?;
        for (index, department_id) in user.dept_id_list.iter().enumerate() {
            let Some(organization_unit_id) = organization_map.get(&department_id.to_string())
            else {
                continue;
            };
            iam_organization_membership_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(user_id),
                organization_unit_id: Set(*organization_unit_id),
                is_primary: Set(index == 0),
                created_at: Set(now.into()),
            }
            .insert(db)
            .await?;
            membership_count += 1;
        }

        iam_user_role_entity::Entity::delete_many()
            .filter(iam_user_role_entity::Column::UserId.eq(user_id))
            .exec(db)
            .await?;
        for role in &user.role_list {
            if role.id == 0 || role.name.trim().is_empty() {
                continue;
            }
            let external_role_id = role.id.to_string();
            synchronized_role_ids.insert(external_role_id.clone());
            let existing_role = iam_role_entity::Entity::find()
                .filter(iam_role_entity::Column::SourceType.eq("dingtalk"))
                .filter(iam_role_entity::Column::ExternalId.eq(external_role_id.clone()))
                .one(db)
                .await?;
            let role_id = if let Some(existing_role) = existing_role {
                let role_id = existing_role.id;
                let mut active: iam_role_entity::ActiveModel = existing_role.into();
                active.name = Set(role.name.trim().to_string());
                active.group_name = Set(optional_text(&role.group_name));
                active.status = Set("active".to_string());
                active.updated_at = Set(now.into());
                iam_role_entity::Entity::update(active).exec(db).await?;
                role_id
            } else {
                let role_id = Uuid::new_v4();
                iam_role_entity::ActiveModel {
                    id: Set(role_id),
                    source_type: Set("dingtalk".to_string()),
                    external_id: Set(external_role_id),
                    name: Set(role.name.trim().to_string()),
                    group_name: Set(optional_text(&role.group_name)),
                    status: Set("active".to_string()),
                    created_at: Set(now.into()),
                    updated_at: Set(now.into()),
                }
                .insert(db)
                .await?;
                role_id
            };
            iam_user_role_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(user_id),
                role_id: Set(role_id),
                created_at: Set(now.into()),
            }
            .insert(db)
            .await?;
            role_binding_count += 1;
        }
    }

    let identities = iam_external_identity_entity::Entity::find()
        .filter(iam_external_identity_entity::Column::Provider.eq("dingtalk"))
        .all(db)
        .await?;
    let mut disabled = 0;
    for identity in identities {
        if synchronized_user_ids.contains(&identity.external_user_id) {
            continue;
        }
        if let Some(user) = iam_user_entity::Entity::find_by_id(identity.user_id)
            .one(db)
            .await?
            && user.status != "inactive"
        {
            let mut active: iam_user_entity::ActiveModel = user.into();
            active.status = Set("inactive".to_string());
            active.updated_at = Set(now.into());
            iam_user_entity::Entity::update(active).exec(db).await?;
            disabled += 1;
        }
    }

    let existing_roles = iam_role_entity::Entity::find()
        .filter(iam_role_entity::Column::SourceType.eq("dingtalk"))
        .all(db)
        .await?;
    for role in existing_roles {
        if !synchronized_role_ids.contains(&role.external_id) && role.status != "inactive" {
            let mut active: iam_role_entity::ActiveModel = role.into();
            active.status = Set("inactive".to_string());
            active.updated_at = Set(now.into());
            iam_role_entity::Entity::update(active).exec(db).await?;
        }
    }

    Ok(UserSyncResponse {
        total: users.len(),
        created,
        updated,
        disabled,
        memberships: membership_count,
        roles: synchronized_role_ids.len(),
        role_bindings: role_binding_count,
        synchronized_at: now.to_rfc3339(),
    })
}

fn apply_user_fields(
    active: &mut iam_user_entity::ActiveModel,
    user: &DingTalkUser,
    organization_map: &HashMap<String, Uuid>,
    now: chrono::DateTime<Utc>,
) {
    active.display_name = Set(if user.name.trim().is_empty() {
        user.userid.clone()
    } else {
        user.name.trim().to_string()
    });
    active.mobile = Set(optional_text(&user.mobile));
    active.state_code = Set(optional_text(&user.state_code));
    active.telephone = Set(optional_text(&user.telephone));
    active.email = Set(optional_text(if user.email.is_empty() {
        &user.org_email
    } else {
        &user.email
    }));
    active.avatar_url = Set(optional_text(&user.avatar));
    active.job_number = Set(optional_text(&user.job_number));
    active.title = Set(optional_text(&user.title));
    active.work_place = Set(optional_text(&user.work_place));
    active.remark = Set(optional_text(&user.remark));
    active.hired_at = Set((user.hired_date > 0)
        .then(|| chrono::DateTime::<Utc>::from_timestamp_millis(user.hired_date))
        .flatten());
    active.manager_external_user_id = Set(optional_text(&user.manager_userid));
    active.primary_organization_unit_id = Set(user
        .dept_id_list
        .first()
        .and_then(|department_id| organization_map.get(&department_id.to_string()))
        .copied());
    active.senior = Set(user.senior);
    active.is_admin = Set(user.admin);
    active.is_boss = Set(user.boss);
    active.real_authed = Set(user.real_authed);
    active.extension_json = Set(serde_json::json!({
        "extension": normalize_extension(&user.extension),
        "leaderInDept": user.leader_in_dept.clone(),
        "departmentOrderList": user.dept_order_list.clone(),
        "extraFields": user.extra_fields.clone(),
    }));
    active.status = Set(if user.active {
        "active".to_string()
    } else {
        "inactive".to_string()
    });
    active.updated_at = Set(now.into());
}

fn optional_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn normalize_extension(value: &serde_json::Value) -> serde_json::Value {
    if let Some(content) = value.as_str() {
        serde_json::from_str(content).unwrap_or_else(|_| value.clone())
    } else {
        value.clone()
    }
}
