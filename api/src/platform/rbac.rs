use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use std::collections::HashSet;
use uuid::Uuid;

use crate::infrastructure::entities::iam_role_permission_entity;
use crate::platform::error::AppError;

pub(crate) async fn grants_for_roles(
    db: &DatabaseConnection,
    role_ids: Vec<Uuid>,
) -> Result<HashSet<String>, AppError> {
    if role_ids.is_empty() {
        return Ok(HashSet::new());
    }
    let rows = iam_role_permission_entity::Entity::find()
        .filter(iam_role_permission_entity::Column::RoleId.is_in(role_ids))
        .all(db)
        .await?;
    Ok(rows.into_iter().map(|row| row.permission).collect())
}

pub(crate) async fn grants_for_role(
    db: &DatabaseConnection,
    role_id: Uuid,
) -> Result<Vec<String>, AppError> {
    let mut grants = grants_for_roles(db, vec![role_id])
        .await?
        .into_iter()
        .collect::<Vec<_>>();
    grants.sort();
    Ok(grants)
}

pub(crate) async fn replace_role_grants(
    db: &DatabaseConnection,
    role_id: Uuid,
    grants: Vec<String>,
) -> Result<(), AppError> {
    let transaction = db.begin().await?;
    iam_role_permission_entity::Entity::delete_many()
        .filter(iam_role_permission_entity::Column::RoleId.eq(role_id))
        .exec(&transaction)
        .await?;
    let now = Utc::now();
    for permission in grants {
        iam_role_permission_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            role_id: Set(role_id),
            permission: Set(permission),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}
