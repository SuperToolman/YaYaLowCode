//! Cross-domain record persistence used by forms and automation nodes.

use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
    Value as SeaValue, sea_query::Expr,
};
use serde_json::Value;
use uuid::Uuid;

use crate::AppError;
use crate::infrastructure::entities::{
    app_entity, app_entity::Entity as AppEntity, form_definition_entity, form_record_entity,
};
use crate::modules::forms;
use crate::shared::{generate_record_uuid, normalize_record_payload};

pub(crate) async fn insert_form_record<C>(
    db: &C,
    definition: &form_definition_entity::Model,
    data: Value,
    operator: &str,
    now: DateTime<Utc>,
) -> Result<form_record_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    let schema = forms::load_schema_version_for_connection(
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
pub(crate) async fn decrement_app_records_count<C>(
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
