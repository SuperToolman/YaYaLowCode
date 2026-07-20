//! Storage-neutral form-record persistence used by forms and automation nodes.
//!
//! Every published form owns a physical table. Business modules only exchange the canonical
//! `StoredFormRecord` shape and never construct table names or SQL themselves.

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, QueryResult, Statement,
    Value as SeaValue, sea_query::Expr,
};
use serde_json::Value;
use uuid::Uuid;

use crate::AppError;
use crate::infrastructure::entities::{
    app_entity, app_entity::Entity as AppEntity, form_definition_entity,
};
use crate::modules::forms;
use crate::platform::form_storage::{
    DYNAMIC_TABLE_STORAGE_MODE, FormStoragePlan, StorageTarget, deserialize_storage_plan,
    is_safe_identifier, load_storage_definition,
};
use crate::shared::{generate_record_uuid, normalize_record_payload};

#[derive(Clone, Debug)]
pub(crate) struct StoredFormRecord {
    pub(crate) id: Uuid,
    pub(crate) record_uuid: String,
    pub(crate) form_uuid: String,
    pub(crate) schema_version: i32,
    pub(crate) record_data: Value,
    pub(crate) created_by: String,
    pub(crate) updated_by: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

pub(crate) struct RecordRepository<'a, C>
where
    C: ConnectionTrait,
{
    db: &'a C,
}

impl<'a, C> RecordRepository<'a, C>
where
    C: ConnectionTrait,
{
    pub(crate) fn new(db: &'a C) -> Self {
        Self { db }
    }

    pub(crate) async fn list(&self, form_uuid: &str) -> Result<Vec<StoredFormRecord>, AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let rows = self
            .db
            .query_all_raw(Statement::from_string(
                DbBackend::Postgres,
                format!(
                    "SELECT {} FROM \"{}\" ORDER BY created_at DESC",
                    base_select_columns(&plan),
                    plan.main_table
                ),
            ))
            .await?;
        rows.into_iter()
            .map(|row| stored_record_from_row(&row, form_uuid).map_err(AppError::from))
            .collect()
    }

    pub(crate) async fn find(
        &self,
        form_uuid: &str,
        record_uuid: &str,
    ) -> Result<StoredFormRecord, AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "SELECT {} FROM \"{}\" WHERE record_uuid = $1",
                    base_select_columns(&plan),
                    plan.main_table
                ),
                vec![SeaValue::String(Some(record_uuid.to_string()))],
            ))
            .await?
            .ok_or_else(|| AppError::NotFound("record not found".to_string()))?;
        Ok(stored_record_from_row(&row, form_uuid)?)
    }

    pub(crate) async fn insert(
        &self,
        definition: &form_definition_entity::Model,
        data: Value,
        operator: &str,
        now: DateTime<Utc>,
    ) -> Result<StoredFormRecord, AppError> {
        let schema = forms::load_schema_version_for_connection(
            self.db,
            &definition.form_uuid,
            definition.published_schema_version,
        )
        .await?;
        let plan = self.storage_plan(&definition.form_uuid).await?;
        let record_data = normalize_record_payload(data);
        let id = Uuid::new_v4();
        let record_uuid = generate_record_uuid();
        let (column_names, value_expressions) = dynamic_column_sql(&plan, 4);
        let extension_expression = extension_data_expression(&plan, 4);
        let row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "INSERT INTO \"{}\" (id, record_uuid, schema_version, extension_data, created_by, updated_by, created_at, updated_at{}) VALUES ($1, $2, $3, {}, $5, $5, $6, $6{}) RETURNING {}",
                    plan.main_table,
                    column_names,
                    extension_expression,
                    value_expressions,
                    base_select_columns(&plan)
                ),
                vec![
                    SeaValue::Uuid(Some(id)),
                    SeaValue::String(Some(record_uuid)),
                    SeaValue::Int(Some(schema.version)),
                    SeaValue::Json(Some(Box::new(record_data))),
                    SeaValue::String(Some(operator.to_string())),
                    SeaValue::ChronoDateTimeUtc(Some(now)),
                ],
            ))
            .await?
            .ok_or_else(|| AppError::NotFound("inserted record not found".to_string()))?;

        self.increment_app_records_count(&definition.app_route_app_id, now)
            .await?;
        Ok(stored_record_from_row(&row, &definition.form_uuid)?)
    }

    pub(crate) async fn update(
        &self,
        record: &StoredFormRecord,
        data: Value,
        operator: &str,
        now: DateTime<Utc>,
    ) -> Result<StoredFormRecord, AppError> {
        let plan = self.storage_plan(&record.form_uuid).await?;
        let record_data = normalize_record_payload(data);
        let assignments = dynamic_column_assignments(&plan, 1);
        let row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "UPDATE \"{}\" SET extension_data = {}, updated_by = $2, updated_at = $3{} WHERE id = $4 RETURNING {}",
                    plan.main_table,
                    extension_data_expression(&plan, 1),
                    assignments,
                    base_select_columns(&plan)
                ),
                vec![
                    SeaValue::Json(Some(Box::new(record_data))),
                    SeaValue::String(Some(operator.to_string())),
                    SeaValue::ChronoDateTimeUtc(Some(now)),
                    SeaValue::Uuid(Some(record.id)),
                ],
            ))
            .await?
            .ok_or_else(|| AppError::NotFound("record not found".to_string()))?;
        Ok(stored_record_from_row(&row, &record.form_uuid)?)
    }

    pub(crate) async fn delete(&self, record: &StoredFormRecord) -> Result<(), AppError> {
        let plan = self.storage_plan(&record.form_uuid).await?;
        self.db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!("DELETE FROM \"{}\" WHERE id = $1", plan.main_table),
                vec![SeaValue::Uuid(Some(record.id))],
            ))
            .await?;
        Ok(())
    }

    pub(crate) async fn delete_many(&self, records: &[StoredFormRecord]) -> Result<u64, AppError> {
        let Some(first) = records.first() else {
            return Ok(0);
        };
        let plan = self.storage_plan(&first.form_uuid).await?;
        let placeholders = (1..=records.len())
            .map(|index| format!("${index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let values = records
            .iter()
            .map(|record| SeaValue::Uuid(Some(record.id)))
            .collect::<Vec<_>>();
        let result = self
            .db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "DELETE FROM \"{}\" WHERE id IN ({})",
                    plan.main_table, placeholders
                ),
                values,
            ))
            .await?;
        Ok(result.rows_affected())
    }

    pub(crate) async fn delete_by_form(&self, form_uuid: &str) -> Result<u64, AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let result = self
            .db
            .execute_raw(Statement::from_string(
                DbBackend::Postgres,
                format!("DELETE FROM \"{}\"", plan.main_table),
            ))
            .await?;
        Ok(result.rows_affected())
    }

    pub(crate) async fn decrement_app_records_count(
        &self,
        app_id: &str,
        count: i64,
        now: DateTime<Utc>,
    ) -> Result<(), AppError> {
        if count <= 0 {
            return Ok(());
        }

        if AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
            .one(self.db)
            .await?
            .is_some()
        {
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
                .exec(self.db)
                .await?;
        }
        Ok(())
    }

    async fn storage_plan(&self, form_uuid: &str) -> Result<FormStoragePlan, AppError> {
        let definition = load_storage_definition(self.db, form_uuid)
            .await?
            .ok_or_else(|| AppError::NotFound("form storage definition not found".to_string()))?;
        if definition.storage_mode != DYNAMIC_TABLE_STORAGE_MODE {
            return Err(AppError::BadRequest(
                "form is not configured for dynamic-table storage".to_string(),
            ));
        }
        if !is_safe_identifier(&definition.physical_table) {
            return Err(AppError::BadRequest(
                "stored dynamic table name is invalid".to_string(),
            ));
        }
        let plan = deserialize_storage_plan(&definition)?;
        if plan.main_table != definition.physical_table || !is_safe_identifier(&plan.main_table) {
            return Err(AppError::BadRequest(
                "dynamic storage metadata is inconsistent".to_string(),
            ));
        }
        Ok(plan)
    }

    async fn increment_app_records_count(
        &self,
        app_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), AppError> {
        if AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
            .one(self.db)
            .await?
            .is_some()
        {
            AppEntity::update_many()
                .col_expr(
                    app_entity::Column::RecordsCount,
                    sea_orm::ExprTrait::add(Expr::col(app_entity::Column::RecordsCount), 1),
                )
                .col_expr(app_entity::Column::UpdatedAt, Expr::value(now))
                .filter(app_entity::Column::RouteAppId.eq(app_id.to_string()))
                .exec(self.db)
                .await?;
        }
        Ok(())
    }
}

fn base_select_columns(plan: &FormStoragePlan) -> String {
    format!(
        "id, record_uuid, schema_version, {} AS record_data, created_by, updated_by, created_at, updated_at",
        reconstructed_record_expression(plan)
    )
}

fn stored_record_from_row(
    row: &QueryResult,
    form_uuid: &str,
) -> Result<StoredFormRecord, sea_orm::DbErr> {
    Ok(StoredFormRecord {
        id: row.try_get("", "id")?,
        record_uuid: row.try_get("", "record_uuid")?,
        form_uuid: form_uuid.to_string(),
        schema_version: row.try_get("", "schema_version")?,
        record_data: row.try_get("", "record_data")?,
        created_by: row.try_get("", "created_by")?,
        updated_by: row.try_get("", "updated_by")?,
        created_at: row.try_get("", "created_at")?,
        updated_at: row.try_get("", "updated_at")?,
    })
}

fn dynamic_column_sql(plan: &FormStoragePlan, json_parameter: usize) -> (String, String) {
    let columns = persisted_columns(plan);
    if columns.is_empty() {
        return (String::new(), String::new());
    }
    let names = columns
        .iter()
        .map(|(_, column, _)| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let expressions = columns
        .iter()
        .map(|(field_id, _, sql_type)| json_value_expression(field_id, sql_type, json_parameter))
        .collect::<Vec<_>>()
        .join(", ");
    (format!(", {names}"), format!(", {expressions}"))
}

fn extension_data_expression(plan: &FormStoragePlan, json_parameter: usize) -> String {
    let keys = persisted_columns(plan)
        .iter()
        .map(|(field_id, _, _)| format!("'{}'", field_id.replace('\'', "''")))
        .collect::<Vec<_>>();
    if keys.is_empty() {
        format!("${json_parameter}::jsonb")
    } else {
        format!(
            "${json_parameter}::jsonb - ARRAY[{}]::text[]",
            keys.join(", ")
        )
    }
}

fn reconstructed_record_expression(plan: &FormStoragePlan) -> String {
    let pairs = persisted_columns(plan)
        .iter()
        .flat_map(|(field_id, column, _)| {
            [
                format!("'{}'", field_id.replace('\'', "''")),
                format!("\"{column}\""),
            ]
        })
        .collect::<Vec<_>>();
    if pairs.is_empty() {
        "extension_data".to_string()
    } else {
        format!(
            "extension_data || jsonb_strip_nulls(jsonb_build_object({}))",
            pairs.join(", ")
        )
    }
}

fn dynamic_column_assignments(plan: &FormStoragePlan, json_parameter: usize) -> String {
    let assignments = persisted_columns(plan)
        .iter()
        .map(|(field_id, column, sql_type)| {
            format!(
                "\"{column}\" = {}",
                json_value_expression(field_id, sql_type, json_parameter)
            )
        })
        .collect::<Vec<_>>();
    if assignments.is_empty() {
        String::new()
    } else {
        format!(", {}", assignments.join(", "))
    }
}

fn persisted_columns(plan: &FormStoragePlan) -> Vec<(&str, &str, &str)> {
    plan.fields
        .iter()
        .filter(|field| matches!(field.target, StorageTarget::Column))
        .filter_map(|field| {
            Some((
                field.field_id.as_str(),
                field.column_name.as_deref()?,
                field.sql_type.as_deref()?,
            ))
        })
        .collect()
}

fn json_value_expression(field_id: &str, sql_type: &str, parameter: usize) -> String {
    let key = field_id.replace('\'', "''");
    match sql_type {
        "NUMERIC" => format!(
            "CASE WHEN jsonb_typeof(${parameter}::jsonb -> '{key}') = 'number' THEN (${parameter}::jsonb ->> '{key}')::numeric ELSE NULL END"
        ),
        "DATE" => format!(
            "CASE WHEN (${parameter}::jsonb ->> '{key}') ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$' THEN (${parameter}::jsonb ->> '{key}')::date ELSE NULL END"
        ),
        _ => format!("${parameter}::jsonb ->> '{key}'"),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::platform::form_storage::compile_form_storage_plan;

    #[test]
    fn scalar_fields_are_removed_from_extension_and_reconstructed() {
        let plan = compile_form_storage_plan(
            "FORM-TEST",
            &json!({
                "fields": [
                    { "id": "name", "type": "singleLineText" },
                    { "id": "amount", "type": "number" },
                    { "id": "files", "type": "attachment" }
                ]
            }),
        )
        .expect("storage plan should compile");

        let extension = extension_data_expression(&plan, 4);
        let reconstructed = reconstructed_record_expression(&plan);
        assert!(extension.contains("'name'"));
        assert!(extension.contains("'amount'"));
        assert!(!extension.contains("'files'"));
        assert!(reconstructed.contains("jsonb_build_object"));
        assert!(reconstructed.contains("extension_data"));
    }

    #[test]
    fn numeric_and_date_values_use_guarded_casts() {
        assert!(json_value_expression("amount", "NUMERIC", 1).contains("jsonb_typeof"));
        assert!(json_value_expression("date", "DATE", 1).contains("::date"));
    }
}
