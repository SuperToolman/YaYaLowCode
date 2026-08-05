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
use std::collections::HashMap;
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
                    "SELECT {} FROM \"{}\" WHERE deleted_at IS NULL ORDER BY created_at DESC",
                    base_select_columns(&plan),
                    plan.main_table
                ),
            ))
            .await?;
        rows.into_iter()
            .map(|row| stored_record_from_row(&row, form_uuid).map_err(AppError::from))
            .collect()
    }

    pub(crate) async fn list_page(
        &self,
        form_uuid: &str,
        page: u64,
        page_size: u64,
    ) -> Result<(Vec<StoredFormRecord>, i64), AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let offset = ((page - 1) * page_size) as i64;
        let rows = self
            .db
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "SELECT {} FROM \"{}\" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2",
                    base_select_columns(&plan),
                    plan.main_table
                ),
                vec![
                    SeaValue::BigInt(Some(page_size as i64)),
                    SeaValue::BigInt(Some(offset)),
                ],
            ))
            .await?;
        let total_row = self
            .db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                format!(
                    "SELECT COUNT(*) AS total FROM \"{}\" WHERE deleted_at IS NULL",
                    plan.main_table
                ),
            ))
            .await?
            .ok_or_else(|| {
                AppError::Server(std::io::Error::other("record count query returned no row"))
            })?;
        let total = total_row.try_get("", "total")?;
        let records = rows
            .into_iter()
            .map(|row| stored_record_from_row(&row, form_uuid).map_err(AppError::from))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((records, total))
    }

    pub(crate) async fn query_page(
        &self,
        form_uuid: &str,
        request: &forms::QueryFormRecordsRequest,
        field_kinds: &HashMap<String, QueryFieldKind>,
        page: u64,
        page_size: u64,
    ) -> Result<(Vec<StoredFormRecord>, i64), AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let source_sql = format!(
            "SELECT {} FROM \"{}\" WHERE deleted_at IS NULL",
            base_select_columns(&plan),
            plan.main_table,
        );
        let mut values = Vec::<SeaValue>::new();
        let mut predicates = Vec::<String>::new();

        for filter in &request.filters {
            let field_kind = field_kinds
                .get(&filter.field_id)
                .copied()
                .unwrap_or(QueryFieldKind::Text);
            let expression = query_field_expression(&filter.field_id, field_kind, &mut values);
            let predicate = match filter.operator {
                forms::RecordFilterOperator::IsEmpty => format!("NULLIF({expression}, '') IS NULL"),
                forms::RecordFilterOperator::IsNotEmpty => {
                    format!("NULLIF({expression}, '') IS NOT NULL")
                }
                forms::RecordFilterOperator::In => {
                    let items = filter
                        .value
                        .as_ref()
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if items.is_empty() {
                        "FALSE".to_string()
                    } else {
                        let placeholders = items
                            .into_iter()
                            .map(|item| {
                                values.push(SeaValue::String(Some(query_value_text(&item))));
                                query_value_placeholder(field_kind, values.len())
                            })
                            .collect::<Vec<_>>();
                        format!("{expression} IN ({})", placeholders.join(", "))
                    }
                }
                operator => {
                    let value = filter
                        .value
                        .as_ref()
                        .map(query_value_text)
                        .unwrap_or_default();
                    values.push(SeaValue::String(Some(value)));
                    let placeholder = query_value_placeholder(field_kind, values.len());
                    match operator {
                        forms::RecordFilterOperator::Eq => format!("{expression} = {placeholder}"),
                        forms::RecordFilterOperator::Neq => {
                            format!("{expression} IS DISTINCT FROM {placeholder}")
                        }
                        forms::RecordFilterOperator::Contains => {
                            format!("COALESCE({expression}, '') ILIKE '%' || {placeholder} || '%'")
                        }
                        forms::RecordFilterOperator::Gt => format!("{expression} > {placeholder}"),
                        forms::RecordFilterOperator::Gte => {
                            format!("{expression} >= {placeholder}")
                        }
                        forms::RecordFilterOperator::Lt => format!("{expression} < {placeholder}"),
                        forms::RecordFilterOperator::Lte => {
                            format!("{expression} <= {placeholder}")
                        }
                        forms::RecordFilterOperator::In
                        | forms::RecordFilterOperator::IsEmpty
                        | forms::RecordFilterOperator::IsNotEmpty => unreachable!(),
                    }
                }
            };
            predicates.push(predicate);
        }

        let where_sql = if predicates.is_empty() {
            "TRUE".to_string()
        } else {
            predicates.join(" AND ")
        };
        let count_values = values.clone();
        let count_sql =
            format!("SELECT COUNT(*) AS total FROM ({source_sql}) AS source WHERE {where_sql}");
        let total_row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                count_sql,
                count_values,
            ))
            .await?
            .ok_or_else(|| {
                AppError::Server(std::io::Error::other("record query count returned no row"))
            })?;
        let total = total_row.try_get("", "total")?;

        let mut order_parts = Vec::new();
        for sort in &request.sorts {
            let expression = query_field_expression(
                &sort.field_id,
                field_kinds
                    .get(&sort.field_id)
                    .copied()
                    .unwrap_or(QueryFieldKind::Text),
                &mut values,
            );
            let direction = match sort.direction {
                forms::RecordSortDirection::Asc => "ASC",
                forms::RecordSortDirection::Desc => "DESC",
            };
            order_parts.push(format!("{expression} {direction} NULLS LAST"));
        }
        if order_parts.is_empty() {
            order_parts.push("created_at DESC".to_string());
        }

        values.push(SeaValue::BigInt(Some(page_size as i64)));
        let limit_placeholder = values.len();
        values.push(SeaValue::BigInt(Some(((page - 1) * page_size) as i64)));
        let offset_placeholder = values.len();
        let query_sql = format!(
            "SELECT * FROM ({source_sql}) AS source WHERE {where_sql} ORDER BY {} LIMIT ${limit_placeholder} OFFSET ${offset_placeholder}",
            order_parts.join(", "),
        );
        let rows = self
            .db
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                query_sql,
                values,
            ))
            .await?;
        let records = rows
            .into_iter()
            .map(|row| stored_record_from_row(&row, form_uuid).map_err(AppError::from))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((records, total))
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
                    "SELECT {} FROM \"{}\" WHERE record_uuid = $1 AND deleted_at IS NULL",
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

        // The form type is table-level metadata duplicated onto every row so child-table
        // projections can be identified without joining form_definitions.
        self.db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "UPDATE \"{}\" SET form_type = $1 WHERE id = $2",
                    plan.main_table
                ),
                vec![
                    SeaValue::String(Some(definition.form_type.clone())),
                    SeaValue::Uuid(Some(id)),
                ],
            ))
            .await?;

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

    pub(crate) async fn soft_delete(
        &self,
        record: &StoredFormRecord,
        now: DateTime<Utc>,
    ) -> Result<(), AppError> {
        let plan = self.storage_plan(&record.form_uuid).await?;
        self.db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "UPDATE \"{}\" SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL",
                    plan.main_table
                ),
                vec![
                    SeaValue::ChronoDateTimeUtc(Some(now)),
                    SeaValue::Uuid(Some(record.id)),
                ],
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum QueryFieldKind {
    Text,
    Number,
    DateTime,
}

fn query_field_expression(
    field_id: &str,
    kind: QueryFieldKind,
    values: &mut Vec<SeaValue>,
) -> String {
    match field_id {
        "id" | "recordUuid" | "instanceId" => "record_uuid".to_string(),
        "schemaVersion" => "schema_version".to_string(),
        "createdBy" | "submitter" => "created_by".to_string(),
        "updatedBy" => "updated_by".to_string(),
        "createdAt" => "created_at".to_string(),
        "updatedAt" => "updated_at".to_string(),
        _ => {
            values.push(SeaValue::String(Some(field_id.to_string())));
            let text = format!("record_data ->> ${}", values.len());
            match kind {
                QueryFieldKind::Text => text,
                QueryFieldKind::Number => format!(
                    "CASE WHEN {text} ~ '^[+-]?[0-9]+(?:\\.[0-9]+)?$' THEN ({text})::numeric END"
                ),
                QueryFieldKind::DateTime => format!(
                    "CASE WHEN {text} ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}' THEN ({text})::timestamptz END"
                ),
            }
        }
    }
}

fn query_value_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        value => value.to_string(),
    }
}

fn query_value_placeholder(kind: QueryFieldKind, index: usize) -> String {
    match kind {
        QueryFieldKind::Text => format!("${index}"),
        QueryFieldKind::Number => format!("NULLIF(${index}, '')::numeric"),
        QueryFieldKind::DateTime => format!("NULLIF(${index}, '')::timestamptz"),
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
