//! Storage-neutral form-record persistence used by forms and automation nodes.
//!
//! Every form owns a physical table. Business modules only exchange the canonical
//! `StoredFormRecord` shape and never construct table names or SQL themselves.

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, QueryResult, Statement,
    TransactionSession, TransactionTrait, Value as SeaValue, sea_query::Expr,
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
use crate::platform::record_validation::{field_checks, local_errors};
use crate::shared::{generate_record_uuid, normalize_record_payload};
use std::collections::BTreeMap;

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
    automation_run: Option<Uuid>,
    branch_id: Option<Uuid>,
}

impl<'a, C> RecordRepository<'a, C>
where
    C: ConnectionTrait,
{
    pub(crate) fn new(db: &'a C) -> Self {
        Self {
            db,
            automation_run: None,
            branch_id: None,
        }
    }

    /// Counts all stored main rows, including recycled rows that a structural
    /// deletion also removes. A never-materialized or logical detail form owns no table.
    pub(crate) async fn count_for_deletion(&self, form_uuid: &str) -> Result<i64, AppError> {
        if load_storage_definition(self.db, form_uuid).await?.is_none() {
            return Ok(0);
        }
        let plan = self.storage_plan(form_uuid).await?;
        let row = self
            .db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                format!("SELECT COUNT(*) AS total FROM \"{}\"", plan.main_table),
            ))
            .await?
            .ok_or_else(|| AppError::BadRequest("record count unavailable".into()))?;
        Ok(row.try_get("", "total")?)
    }

    pub(crate) fn for_automation_run(db: &'a C, run_id: Uuid, branch_id: Option<Uuid>) -> Self {
        Self {
            db,
            automation_run: Some(run_id),
            branch_id,
        }
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
        let records = rows
            .into_iter()
            .map(|row| stored_record_from_row(&row, form_uuid).map_err(AppError::from))
            .collect::<Result<Vec<_>, _>>()?;
        self.overlay_automation_changes(form_uuid, records).await
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
        let records = self.overlay_automation_changes(form_uuid, records).await?;
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
        self.query_page_for_creators(form_uuid, request, field_kinds, page, page_size, None)
            .await
    }

    pub(crate) async fn query_page_for_creators(
        &self,
        form_uuid: &str,
        request: &forms::QueryFormRecordsRequest,
        field_kinds: &HashMap<String, QueryFieldKind>,
        page: u64,
        page_size: u64,
        creators: Option<&[String]>,
    ) -> Result<(Vec<StoredFormRecord>, i64), AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let source_sql = format!(
            "SELECT {} FROM \"{}\" WHERE deleted_at IS NULL",
            base_select_columns(&plan),
            plan.main_table,
        );
        let mut values = Vec::<SeaValue>::new();
        let mut predicates = Vec::<String>::new();

        if let Some(creators) = creators {
            let placeholders = creators
                .iter()
                .map(|creator| {
                    values.push(creator.clone().into());
                    format!("${}", values.len())
                })
                .collect::<Vec<_>>();
            predicates.push(if placeholders.is_empty() {
                "FALSE".into()
            } else {
                format!("created_by IN ({})", placeholders.join(","))
            });
        }

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

    pub(crate) async fn aggregate_for_creators(
        &self,
        form_uuid: &str,
        request: &forms::QueryFormRecordsRequest,
        field_kinds: &HashMap<String, QueryFieldKind>,
        creators: Option<&[String]>,
        operation: &str,
        field: Option<&str>,
        group: Option<&str>,
    ) -> Result<Vec<Value>, AppError> {
        let plan = self.storage_plan(form_uuid).await?;
        let source_sql = format!(
            "SELECT {} FROM \"{}\" WHERE deleted_at IS NULL",
            base_select_columns(&plan),
            plan.main_table,
        );
        let mut values = Vec::<SeaValue>::new();
        let mut predicates = Vec::<String>::new();

        if let Some(creators) = creators {
            let placeholders = creators
                .iter()
                .map(|creator| {
                    values.push(creator.clone().into());
                    format!("${}", values.len())
                })
                .collect::<Vec<_>>();
            predicates.push(if placeholders.is_empty() {
                "FALSE".into()
            } else {
                format!("created_by IN ({})", placeholders.join(","))
            });
        }

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

        let group_expression = group
            .map(|field| {
                query_field_expression(
                    field,
                    *field_kinds.get(field).unwrap_or(&QueryFieldKind::Text),
                    &mut values,
                )
            })
            .unwrap_or_else(|| "NULL::text".into());
        let metric = if operation == "count" {
            "COUNT(*)".into()
        } else {
            let field =
                field.ok_or_else(|| AppError::BadRequest("aggregate field required".into()))?;
            if !matches!(field_kinds.get(field), Some(QueryFieldKind::Number)) {
                return Err(AppError::BadRequest(
                    "numeric aggregate field required".into(),
                ));
            }
            let function = match operation {
                "sum" => "SUM",
                "avg" => "AVG",
                "min" => "MIN",
                "max" => "MAX",
                _ => return Err(AppError::BadRequest("unsupported aggregate".into())),
            };
            format!(
                "{}({})",
                function,
                query_field_expression(field, QueryFieldKind::Number, &mut values)
            )
        };
        let group_clause = if group.is_some() {
            " GROUP BY 1 ORDER BY 1"
        } else {
            ""
        };
        let sql = format!(
            "SELECT jsonb_build_object('group',group_value,'value',metric)::text data FROM (SELECT {group_expression} group_value,{metric} metric FROM ({source_sql}) source WHERE {where_sql}{group_clause} LIMIT 201) grouped"
        );
        yaya_agent_v2::store::rows(self.db, &sql, values)
            .await
            .map_err(|_| AppError::BadRequest("aggregate query failed".into()))
    }

    pub(crate) async fn find(
        &self,
        form_uuid: &str,
        record_uuid: &str,
    ) -> Result<StoredFormRecord, AppError> {
        self.find_with_lock(form_uuid, record_uuid, false).await
    }

    pub(crate) async fn find_for_update(
        &self,
        form_uuid: &str,
        record_uuid: &str,
    ) -> Result<StoredFormRecord, AppError> {
        self.find_with_lock(form_uuid, record_uuid, true).await
    }

    async fn find_with_lock(
        &self,
        form_uuid: &str,
        record_uuid: &str,
        lock: bool,
    ) -> Result<StoredFormRecord, AppError> {
        if let Some(run_id) = self.automation_run {
            let staged = self
                .db
                .query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT operation,record_id,schema_version,record_data,created_by,updated_by,record_created_at,record_updated_at FROM automation_execution_record_changes WHERE run_id=$1 AND form_uuid=$2 AND record_uuid=$3",
                    vec![run_id.into(), form_uuid.to_string().into(), record_uuid.to_string().into()],
                ))
                .await?;
            if let Some(row) = staged {
                if row.try_get::<String>("", "operation")? == "delete" {
                    return Err(AppError::NotFound("record not found".to_string()));
                }
                return Ok(StoredFormRecord {
                    id: row.try_get("", "record_id")?,
                    record_uuid: record_uuid.to_string(),
                    form_uuid: form_uuid.to_string(),
                    schema_version: row.try_get("", "schema_version")?,
                    record_data: row.try_get("", "record_data")?,
                    created_by: row.try_get("", "created_by")?,
                    updated_by: row.try_get("", "updated_by")?,
                    created_at: row.try_get("", "record_created_at")?,
                    updated_at: row.try_get("", "record_updated_at")?,
                });
            }
        }
        let plan = self.storage_plan(form_uuid).await?;
        let row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "SELECT {} FROM \"{}\" WHERE record_uuid = $1 AND deleted_at IS NULL{}",
                    base_select_columns(&plan),
                    plan.main_table,
                    if lock { " FOR UPDATE" } else { "" }
                ),
                vec![SeaValue::String(Some(record_uuid.to_string()))],
            ))
            .await?
            .ok_or_else(|| AppError::NotFound("record not found".to_string()))?;
        Ok(stored_record_from_row(&row, form_uuid)?)
    }

    pub(crate) async fn validate_values(
        &self,
        form_uuid: &str,
        data: &Value,
        exclude: Option<&str>,
    ) -> Result<BTreeMap<String, String>, AppError> {
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
            .one(self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("form not found".into()))?;
        let schema = forms::load_schema_version_for_connection(
            self.db,
            form_uuid,
            definition.current_schema_version,
        )
        .await?;
        self.validate_schema_values(form_uuid, &schema.schema_json, data, exclude)
            .await
    }

    pub(crate) async fn validate_schema_values(
        &self,
        form_uuid: &str,
        schema: &Value,
        data: &Value,
        exclude: Option<&str>,
    ) -> Result<BTreeMap<String, String>, AppError> {
        let checks = field_checks(schema, data);
        let mut errors = local_errors(&checks);
        if !checks.iter().any(|check| check.unique) {
            return Ok(errors);
        }
        let plan = self.storage_plan(form_uuid).await?;
        for check in checks.iter().filter(|check| check.unique) {
            for (key, value) in &check.values {
                let Some(text) = value.as_str().filter(|v| !v.trim().is_empty()) else {
                    continue;
                };
                let row = self.db.query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    format!("SELECT EXISTS (SELECT 1 FROM (SELECT record_uuid, {} AS data FROM \"{}\" WHERE deleted_at IS NULL) records WHERE ($3::text IS NULL OR record_uuid <> $3) AND jsonb_path_exists(data, $1::jsonpath, jsonb_build_object('value', $2::text))) AS duplicate", reconstructed_record_expression(&plan), plan.main_table),
                    vec![SeaValue::String(Some(check.path.clone())), SeaValue::String(Some(text.to_owned())), SeaValue::String(exclude.map(str::to_owned))],
                )).await?.ok_or_else(|| AppError::BadRequest("去重查询失败".into()))?;
                if row.try_get::<bool>("", "duplicate")? {
                    errors.insert(key.clone(), format!("{}已存在，不允许重复", check.label));
                }
            }
        }
        Ok(errors)
    }

    pub(crate) async fn lock_validation_scope(&self, form_uuid: &str) -> Result<(), AppError> {
        self.db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                vec![SeaValue::String(Some(format!(
                    "record-validation:{form_uuid}"
                )))],
            ))
            .await?;
        Ok(())
    }

    /// Guard a button request before synchronous hooks run. A concurrent retry
    /// must retry later rather than execute the hooks a second time.
    pub(crate) async fn lock_button_submission(&self, identity: &str) -> Result<(), AppError> {
        let row = self
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
                vec![SeaValue::String(Some(format!(
                    "button-submission:{identity}"
                )))],
            ))
            .await?
            .ok_or_else(|| AppError::Conflict("无法获取提交锁，请重试".into()))?;
        if !row.try_get::<bool>("", "acquired")? {
            return Err(AppError::Conflict("该请求正在提交，请稍后重试".into()));
        }
        Ok(())
    }

    async fn enforce_values(
        &self,
        form_uuid: &str,
        data: &Value,
        exclude: Option<&str>,
    ) -> Result<(), AppError> {
        let errors = self.validate_values(form_uuid, data, exclude).await?;
        if let Some(error) = errors.values().next() {
            return Err(AppError::BadRequest(error.clone()));
        }
        Ok(())
    }

    async fn overlay_automation_changes(
        &self,
        form_uuid: &str,
        mut records: Vec<StoredFormRecord>,
    ) -> Result<Vec<StoredFormRecord>, AppError> {
        let Some(run_id) = self.automation_run else {
            return Ok(records);
        };
        let rows = self
            .db
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT operation,record_uuid,record_id,schema_version,record_data,created_by,updated_by,record_created_at,record_updated_at FROM automation_execution_record_changes WHERE run_id=$1 AND form_uuid=$2",
                vec![run_id.into(), form_uuid.to_string().into()],
            ))
            .await?;
        for row in rows {
            let record_uuid: String = row.try_get("", "record_uuid")?;
            let existing = records
                .iter()
                .position(|record| record.record_uuid == record_uuid);
            if row.try_get::<String>("", "operation")? == "delete" {
                if let Some(index) = existing {
                    records.remove(index);
                }
                continue;
            }
            let staged = StoredFormRecord {
                id: row.try_get("", "record_id")?,
                record_uuid,
                form_uuid: form_uuid.to_string(),
                schema_version: row.try_get("", "schema_version")?,
                record_data: row.try_get("", "record_data")?,
                created_by: row.try_get("", "created_by")?,
                updated_by: row.try_get("", "updated_by")?,
                created_at: row.try_get("", "record_created_at")?,
                updated_at: row.try_get("", "record_updated_at")?,
            };
            if let Some(index) = existing {
                records[index] = staged;
            } else {
                records.push(staged);
            }
        }
        Ok(records)
    }

    pub(crate) async fn insert(
        &self,
        definition: &form_definition_entity::Model,
        data: Value,
        operator: &str,
        now: DateTime<Utc>,
    ) -> Result<StoredFormRecord, AppError>
    where
        C: TransactionTrait,
    {
        self.insert_with_record_uuid(definition, data, operator, now, None)
            .await
    }

    pub(crate) async fn insert_with_record_uuid(
        &self,
        definition: &form_definition_entity::Model,
        data: Value,
        operator: &str,
        now: DateTime<Utc>,
        record_uuid: Option<&str>,
    ) -> Result<StoredFormRecord, AppError>
    where
        C: TransactionTrait,
    {
        if let Some(run_id) = self.automation_run {
            let record_uuid = record_uuid
                .map(str::to_owned)
                .unwrap_or_else(generate_record_uuid);
            let record_data = normalize_record_payload(data);
            self.lock_automation_record(run_id, &definition.form_uuid, &record_uuid)
                .await?;
            self.enforce_values(&definition.form_uuid, &record_data, None)
                .await?;
            let id = Uuid::new_v4();
            let now = now;
            self.db
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "INSERT INTO automation_execution_record_changes(run_id,form_uuid,record_uuid,record_id,operation,schema_version,base_data,record_data,created_by,updated_by,record_created_at,record_updated_at,branch_id,changed_fields,operator) VALUES($1,$2,$3,$4,'upsert',$5,NULL,$6,$7,$7,$8,$8,$9,$10,$7)",
                    vec![
                        run_id.into(),
                        definition.form_uuid.clone().into(),
                        record_uuid.clone().into(),
                        id.into(),
                        definition.current_schema_version.into(),
                        SeaValue::Json(Some(Box::new(record_data.clone()))),
                        operator.to_string().into(),
                        now.into(),
                        self.branch_id.into(),
                        SeaValue::Json(Some(Box::new(serde_json::json!(record_data.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default())))),
                    ],
                ))
                .await?;
            return Ok(StoredFormRecord {
                id,
                record_uuid,
                form_uuid: definition.form_uuid.clone(),
                schema_version: definition.current_schema_version,
                record_data,
                created_by: operator.to_string(),
                updated_by: operator.to_string(),
                created_at: now,
                updated_at: now,
            });
        }
        let txn = self.db.begin().await?;
        let repository = RecordRepository::new(&txn);
        repository
            .lock_validation_scope(&definition.form_uuid)
            .await?;
        repository
            .enforce_values(&definition.form_uuid, &data, None)
            .await?;
        let record = repository
            .insert_validated(definition, data, operator, now, record_uuid)
            .await?;
        txn.commit().await?;
        Ok(record)
    }

    async fn insert_validated(
        &self,
        definition: &form_definition_entity::Model,
        data: Value,
        operator: &str,
        now: DateTime<Utc>,
        record_uuid: Option<&str>,
    ) -> Result<StoredFormRecord, AppError> {
        let schema = forms::load_schema_version_for_connection(
            self.db,
            &definition.form_uuid,
            definition.current_schema_version,
        )
        .await?;
        let plan = self.storage_plan(&definition.form_uuid).await?;
        let record_data = normalize_record_payload(data);
        let id = Uuid::new_v4();
        let record_uuid = record_uuid
            .map(str::to_owned)
            .unwrap_or_else(generate_record_uuid);
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
    ) -> Result<StoredFormRecord, AppError>
    where
        C: TransactionTrait,
    {
        if let Some(run_id) = self.automation_run {
            let record_data = normalize_record_payload(data);
            self.lock_automation_record(run_id, &record.form_uuid, &record.record_uuid)
                .await?;
            let current = self
                .db
                .query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT base_data,record_data,branch_id,changed_fields FROM automation_execution_record_changes WHERE run_id=$1 AND form_uuid=$2 AND record_uuid=$3 FOR UPDATE",
                    vec![run_id.into(), record.form_uuid.clone().into(), record.record_uuid.clone().into()],
                ))
                .await?;
            let now = now;
            if let Some(current) = current {
                let base_data: Option<Value> = current.try_get("", "base_data")?;
                let staged_data: Value = current.try_get("", "record_data")?;
                let prior_branch: Option<Uuid> = current.try_get("", "branch_id")?;
                let prior_fields: Vec<String> = current
                    .try_get::<Value>("", "changed_fields")?
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect();
                let base = base_data.as_ref().unwrap_or(&staged_data);
                let changes = changed_top_level_fields(base, &record_data);
                if prior_branch != self.branch_id
                    && changes.iter().any(|field| prior_fields.contains(field))
                {
                    return Err(AppError::Conflict(format!(
                        "parallel branches updated the same field on record {}",
                        record.record_uuid
                    )));
                }
                let mut merged = staged_data;
                apply_top_level_changes(&mut merged, &record_data, &changes);
                let mut changed_fields = prior_fields;
                for field in changes {
                    if !changed_fields.contains(&field) {
                        changed_fields.push(field);
                    }
                }
                self.enforce_values(&record.form_uuid, &merged, Some(&record.record_uuid))
                    .await?;
                self.db
                    .execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "UPDATE automation_execution_record_changes SET operation='upsert',record_data=$4,updated_by=$5,record_updated_at=$6,changed_fields=$7,updated_at=NOW() WHERE run_id=$1 AND form_uuid=$2 AND record_uuid=$3",
                        vec![run_id.into(),record.form_uuid.clone().into(),record.record_uuid.clone().into(),SeaValue::Json(Some(Box::new(merged.clone()))),operator.to_string().into(),now.into(),SeaValue::Json(Some(Box::new(serde_json::json!(changed_fields))))],
                    ))
                    .await?;
                return Ok(StoredFormRecord {
                    record_data: merged,
                    updated_by: operator.to_string(),
                    updated_at: now,
                    ..record.clone()
                });
            }
            self.enforce_values(&record.form_uuid, &record_data, Some(&record.record_uuid))
                .await?;
            let changes = changed_top_level_fields(&record.record_data, &record_data);
            self.db
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "INSERT INTO automation_execution_record_changes(run_id,form_uuid,record_uuid,record_id,operation,schema_version,base_data,record_data,base_updated_at,created_by,updated_by,record_created_at,record_updated_at,branch_id,changed_fields,operator) VALUES($1,$2,$3,$4,'upsert',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$10)",
                    vec![run_id.into(),record.form_uuid.clone().into(),record.record_uuid.clone().into(),record.id.into(),record.schema_version.into(),SeaValue::Json(Some(Box::new(record.record_data.clone()))),SeaValue::Json(Some(Box::new(record_data.clone()))),record.updated_at.into(),record.created_by.clone().into(),operator.to_string().into(),record.created_at.into(),now.into(),self.branch_id.into(),SeaValue::Json(Some(Box::new(serde_json::json!(changes))))],
                ))
                .await?;
            return Ok(StoredFormRecord {
                record_data,
                updated_by: operator.to_string(),
                updated_at: now,
                ..record.clone()
            });
        }
        let txn = self.db.begin().await?;
        let repository = RecordRepository::new(&txn);
        repository.lock_validation_scope(&record.form_uuid).await?;
        repository
            .enforce_values(&record.form_uuid, &data, Some(&record.record_uuid))
            .await?;
        let record = repository
            .update_validated(record, data, operator, now)
            .await?;
        txn.commit().await?;
        Ok(record)
    }

    async fn update_validated(
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
        if let Some(run_id) = self.automation_run {
            let mut affected = 0;
            for record in records {
                self.lock_automation_record(run_id, &record.form_uuid, &record.record_uuid)
                    .await?;
                let staged = self
                    .db
                    .query_one_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "SELECT base_data FROM automation_execution_record_changes WHERE run_id=$1 AND form_uuid=$2 AND record_uuid=$3 FOR UPDATE",
                        vec![run_id.into(),record.form_uuid.clone().into(),record.record_uuid.clone().into()],
                    ))
                    .await?;
                if staged.as_ref().is_some_and(|row| {
                    row.try_get::<Option<Value>>("", "base_data")
                        .ok()
                        .flatten()
                        .is_none()
                }) {
                    self.db.execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "DELETE FROM automation_execution_record_changes WHERE run_id=$1 AND form_uuid=$2 AND record_uuid=$3",
                        vec![run_id.into(),record.form_uuid.clone().into(),record.record_uuid.clone().into()],
                    )).await?;
                } else {
                    self.db.execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "INSERT INTO automation_execution_record_changes(run_id,form_uuid,record_uuid,record_id,operation,schema_version,base_data,record_data,base_updated_at,created_by,updated_by,record_created_at,record_updated_at,branch_id,operator) VALUES($1,$2,$3,$4,'delete',$5,$6,NULL,$7,$8,$9,$10,$11,$12,$9) ON CONFLICT(run_id,form_uuid,record_uuid) DO UPDATE SET operation='delete',record_data=NULL,branch_id=EXCLUDED.branch_id,operator=EXCLUDED.operator,updated_at=NOW()",
                        vec![run_id.into(),record.form_uuid.clone().into(),record.record_uuid.clone().into(),record.id.into(),record.schema_version.into(),SeaValue::Json(Some(Box::new(record.record_data.clone()))),record.updated_at.into(),record.created_by.clone().into(),record.updated_by.clone().into(),record.created_at.into(),record.updated_at.into(),self.branch_id.into()],
                    )).await?;
                }
                affected += 1;
            }
            return Ok(affected);
        }
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

    async fn lock_automation_record(
        &self,
        run_id: Uuid,
        form_uuid: &str,
        record_uuid: &str,
    ) -> Result<(), AppError> {
        self.db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                vec![format!("automation-record:{run_id}:{form_uuid}:{record_uuid}").into()],
            ))
            .await?;
        Ok(())
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

pub(crate) async fn commit_automation_run<C>(db: &C, run_id: Uuid) -> Result<(), AppError>
where
    C: ConnectionTrait + TransactionTrait,
{
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT form_uuid,record_uuid,record_id,operation,schema_version,base_data,record_data,base_updated_at,created_by,updated_by,record_created_at,record_updated_at,operator FROM automation_execution_record_changes WHERE run_id=$1 ORDER BY form_uuid,record_uuid",
            vec![run_id.into()],
        ))
        .await?;
    let repository = RecordRepository::new(db);
    let mut deleted_by_app = HashMap::<String, i64>::new();
    for row in rows {
        let form_uuid: String = row.try_get("", "form_uuid")?;
        let record_uuid: String = row.try_get("", "record_uuid")?;
        let operation: String = row.try_get("", "operation")?;
        let base_data: Option<Value> = row.try_get("", "base_data")?;
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.clone()))
            .one(db)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(format!("form {form_uuid} was removed during automation"))
            })?;
        if let Some(base_data) = base_data {
            // Lock every target row for the complete commit. This closes the
            // read/validate/write window where another request could modify a
            // record between the conflict check and the update.
            let current = repository
                .find_for_update(&form_uuid, &record_uuid)
                .await
                .map_err(|_| {
                    AppError::Conflict(format!("record {record_uuid} changed during automation"))
                })?;
            let external_changes = changed_top_level_fields(&base_data, &current.record_data)
                .into_iter()
                .filter(|field| !is_workflow_control_field(field))
                .collect::<Vec<_>>();
            if !external_changes.is_empty() {
                return Err(AppError::Conflict(format!(
                    "record {record_uuid} changed outside this automation"
                )));
            }
            if operation == "delete" {
                repository
                    .delete_many(std::slice::from_ref(&current))
                    .await?;
                *deleted_by_app
                    .entry(definition.app_route_app_id.clone())
                    .or_default() += 1;
            } else {
                repository.lock_validation_scope(&form_uuid).await?;
                repository
                    .enforce_values(
                        &form_uuid,
                        &row.try_get::<Value>("", "record_data")?,
                        Some(&record_uuid),
                    )
                    .await?;
                repository
                    .update_validated(
                        &current,
                        preserve_workflow_control_fields(
                            row.try_get("", "record_data")?,
                            &current.record_data,
                        ),
                        &row.try_get::<String>("", "operator")?,
                        row.try_get("", "record_updated_at")?,
                    )
                    .await?;
            }
        } else if operation == "upsert" {
            if repository
                .find_for_update(&form_uuid, &record_uuid)
                .await
                .is_ok()
            {
                return Err(AppError::Conflict(format!(
                    "record ID {record_uuid} was created outside this automation"
                )));
            }
            repository.lock_validation_scope(&form_uuid).await?;
            repository
                .enforce_values(&form_uuid, &row.try_get::<Value>("", "record_data")?, None)
                .await?;
            repository
                .insert_validated(
                    &definition,
                    row.try_get("", "record_data")?,
                    &row.try_get::<String>("", "operator")?,
                    row.try_get("", "record_created_at")?,
                    Some(&record_uuid),
                )
                .await?;
        }
    }
    for (app_id, count) in deleted_by_app {
        repository
            .decrement_app_records_count(&app_id, count, Utc::now())
            .await?;
    }
    sql_delete_automation_changes(db, run_id).await?;
    Ok(())
}

async fn sql_delete_automation_changes<C: ConnectionTrait>(
    db: &C,
    run_id: Uuid,
) -> Result<(), AppError> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "DELETE FROM automation_execution_record_changes WHERE run_id=$1",
        vec![run_id.into()],
    ))
    .await?;
    Ok(())
}

fn changed_top_level_fields(base: &Value, next: &Value) -> Vec<String> {
    let base = base.as_object();
    let next = next.as_object();
    let mut keys = base
        .into_iter()
        .flat_map(|object| object.keys())
        .chain(next.into_iter().flat_map(|object| object.keys()))
        .cloned()
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    keys.into_iter()
        .filter(|key| {
            base.and_then(|object| object.get(key)) != next.and_then(|object| object.get(key))
        })
        .collect()
}

fn is_workflow_control_field(field: &str) -> bool {
    matches!(
        field,
        "workflowApprovalStatus" | "workflowInstanceStatus" | "workflowCurrentApprovalNode"
    )
}

fn preserve_workflow_control_fields(mut staged: Value, current: &Value) -> Value {
    let Some(staged) = staged.as_object_mut() else {
        return staged;
    };
    let Some(current) = current.as_object() else {
        return Value::Object(staged.clone());
    };
    for field in [
        "workflowApprovalStatus",
        "workflowInstanceStatus",
        "workflowCurrentApprovalNode",
    ] {
        if let Some(value) = current.get(field) {
            staged.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(staged.clone())
}

fn apply_top_level_changes(current: &mut Value, desired: &Value, fields: &[String]) {
    let Some(current) = current.as_object_mut() else {
        *current = Value::Object(serde_json::Map::new());
        return apply_top_level_changes(current, desired, fields);
    };
    let Some(desired) = desired.as_object() else {
        return;
    };
    for field in fields {
        if let Some(value) = desired.get(field) {
            current.insert(field.clone(), value.clone());
        } else {
            current.remove(field);
        }
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

    #[test]
    fn parallel_updates_merge_disjoint_top_level_fields() {
        let base = json!({"name":"Acme","region":"North"});
        let name_branch = json!({"name":"Contoso","region":"North"});
        let region_branch = json!({"name":"Acme","region":"South"});
        let mut merged = base.clone();
        apply_top_level_changes(
            &mut merged,
            &name_branch,
            &changed_top_level_fields(&base, &name_branch),
        );
        apply_top_level_changes(
            &mut merged,
            &region_branch,
            &changed_top_level_fields(&base, &region_branch),
        );
        assert_eq!(merged, json!({"name":"Contoso","region":"South"}));
    }

    #[test]
    fn parallel_updates_detect_same_field_and_preserve_workflow_state() {
        let base = json!({"name":"Acme","workflowInstanceStatus":"running"});
        let first = json!({"name":"Contoso","workflowInstanceStatus":"running"});
        let second = json!({"name":"Northwind","workflowInstanceStatus":"running"});
        assert_eq!(
            changed_top_level_fields(&base, &first)
                .iter()
                .filter(|field| changed_top_level_fields(&base, &second).contains(field))
                .count(),
            1
        );
        assert!(is_workflow_control_field("workflowInstanceStatus"));
        assert_eq!(
            preserve_workflow_control_fields(
                json!({"name":"Contoso","workflowInstanceStatus":"running"}),
                &json!({"workflowInstanceStatus":"waiting"}),
            )["workflowInstanceStatus"],
            "waiting"
        );
    }
}
