//! Compiles published form Schemas and manages per-form physical storage metadata.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

use crate::AppError;
use crate::infrastructure::entities::{
    form_definition_entity::Entity as FormDefinitionEntity, form_schema_entity,
    form_schema_entity::Entity as FormSchemaEntity, form_storage_definition_entity,
    form_storage_definition_entity::Entity as FormStorageDefinitionEntity,
};

pub(crate) const DYNAMIC_TABLE_STORAGE_MODE: &str = "dynamic_table";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FormStoragePlan {
    pub(crate) form_uuid: String,
    pub(crate) main_table: String,
    pub(crate) fields: Vec<FieldStoragePlan>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FieldStoragePlan {
    pub(crate) field_id: String,
    pub(crate) component_type: String,
    pub(crate) target: StorageTarget,
    pub(crate) column_name: Option<String>,
    pub(crate) sql_type: Option<String>,
    pub(crate) child_table: Option<String>,
    #[serde(default)]
    pub(crate) indexed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StorageTarget {
    Column,
    ExtensionJson,
    ChildTable,
    ChildColumn,
    ChildExtension,
    Virtual,
}

pub(crate) fn compile_form_storage_plan(
    form_uuid: &str,
    schema: &Value,
) -> Result<FormStoragePlan, AppError> {
    let fields = schema
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("form schema fields must be an array".to_string()))?;
    let main_table = build_table_name("form_data", form_uuid);
    let mut plans = Vec::with_capacity(fields.len());
    let mut field_ids = HashSet::with_capacity(fields.len());
    let subform_ids = fields
        .iter()
        .filter(|field| field.get("type").and_then(Value::as_str) == Some("subform"))
        .filter_map(|field| field.get("id").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<HashSet<_>>();
    let indexed_field_ids = schema
        .get("pageProps")
        .and_then(|page_props| page_props.get("indexedFieldIds"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<HashSet<_>>();

    for field in fields {
        let field_id = field
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::BadRequest("form field id is required".to_string()))?;
        if !field_ids.insert(field_id.to_string()) {
            return Err(AppError::BadRequest(format!(
                "form field id {field_id} is duplicated"
            )));
        }
        let component_type = field
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let indexed = indexed_field_ids.contains(field_id);
        if indexed && !is_indexable_component(component_type) {
            return Err(AppError::BadRequest(format!(
                "field {field_id} does not support a database index"
            )));
        }
        let parent_subform_id = field
            .get("parentGroupId")
            .and_then(Value::as_str)
            .filter(|parent_id| subform_ids.contains(*parent_id));
        let (base_target, sql_type) = storage_mapping(component_type);
        let target = if parent_subform_id.is_some() {
            if matches!(base_target, StorageTarget::Column) {
                StorageTarget::ChildColumn
            } else {
                StorageTarget::ChildExtension
            }
        } else {
            base_target
        };
        let column_name = matches!(target, StorageTarget::Column | StorageTarget::ChildColumn)
            .then(|| build_column_name(&format!("{field_id}_{}", sql_type.unwrap_or("JSONB"))));
        let child_table = if matches!(target, StorageTarget::ChildTable) {
            Some(build_table_name(&main_table, field_id))
        } else {
            parent_subform_id.map(|parent_id| build_table_name(&main_table, parent_id))
        };

        plans.push(FieldStoragePlan {
            field_id: field_id.to_string(),
            component_type: component_type.to_string(),
            target,
            column_name,
            sql_type: sql_type.map(ToString::to_string),
            child_table,
            indexed,
        });
    }

    Ok(FormStoragePlan {
        form_uuid: form_uuid.to_string(),
        main_table,
        fields: plans,
    })
}

pub(crate) async fn sync_published_storage_plan<C>(
    db: &C,
    form_uuid: &str,
    schema_version: i32,
    schema: &Value,
) -> Result<FormStoragePlan, AppError>
where
    C: ConnectionTrait,
{
    let plan = compile_form_storage_plan(form_uuid, schema)?;
    let mapping = serde_json::to_value(&plan).map_err(|error| {
        AppError::BadRequest(format!("failed to serialize form storage plan: {error}"))
    })?;
    let now = Utc::now();
    let existing = load_storage_definition(db, form_uuid).await?;
    let should_backfill_child_rows = existing
        .as_ref()
        .is_some_and(|definition| definition.compiled_schema_version != schema_version);
    ensure_dynamic_table(db, &plan, should_backfill_child_rows).await?;

    if let Some(existing) = existing {
        let previous_plan = deserialize_storage_plan(&existing)?;
        drop_removed_indexes(db, &previous_plan, &plan).await?;
        drop_removed_child_tables(db, &previous_plan, &plan).await?;
        let mut active: form_storage_definition_entity::ActiveModel = existing.into();
        active.storage_mode = Set(DYNAMIC_TABLE_STORAGE_MODE.to_string());
        active.physical_table = Set(plan.main_table.clone());
        active.compiled_schema_version = Set(schema_version);
        active.column_mapping_json = Set(mapping);
        active.updated_at = Set(now);
        active.update(db).await?;
    } else {
        form_storage_definition_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            form_uuid: Set(form_uuid.to_string()),
            storage_mode: Set(DYNAMIC_TABLE_STORAGE_MODE.to_string()),
            physical_table: Set(plan.main_table.clone()),
            compiled_schema_version: Set(schema_version),
            column_mapping_json: Set(mapping),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;
    }

    Ok(plan)
}

async fn drop_removed_indexes<C>(
    db: &C,
    previous: &FormStoragePlan,
    next: &FormStoragePlan,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let next_indexes = index_descriptors(next)
        .into_iter()
        .map(|(_, index_name, _)| index_name)
        .collect::<HashSet<_>>();
    for (_, index_name, _) in index_descriptors(previous)
        .into_iter()
        .filter(|(_, index_name, _)| !next_indexes.contains(index_name))
    {
        db.execute_unprepared(&format!("DROP INDEX IF EXISTS \"{index_name}\""))
            .await?;
    }
    Ok(())
}

async fn drop_removed_child_tables<C>(
    db: &C,
    previous: &FormStoragePlan,
    next: &FormStoragePlan,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let next_tables = next
        .fields
        .iter()
        .filter(|field| matches!(field.target, StorageTarget::ChildTable))
        .filter_map(|field| field.child_table.as_deref())
        .collect::<HashSet<_>>();
    for child_table in previous
        .fields
        .iter()
        .filter(|field| matches!(field.target, StorageTarget::ChildTable))
        .filter_map(|field| field.child_table.as_deref())
        .filter(|table| !next_tables.contains(table))
    {
        if !is_safe_identifier(child_table) {
            return Err(AppError::BadRequest(
                "stored child table name is invalid".to_string(),
            ));
        }
        let function_name = build_table_name("sync_child", child_table);
        db.execute_unprepared(&format!(
            "DROP TABLE IF EXISTS \"{}\" CASCADE; DROP FUNCTION IF EXISTS \"{}\"() CASCADE;",
            child_table, function_name
        ))
        .await?;
    }
    Ok(())
}

pub(crate) async fn ensure_all_form_dynamic_storage<C>(db: &C) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let definitions = FormDefinitionEntity::find().all(db).await?;
    for definition in definitions {
        let schema = FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(definition.published_schema_version))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("published form schema not found".to_string()))?;
        sync_published_storage_plan(
            db,
            &definition.form_uuid,
            definition.published_schema_version,
            &schema.schema_json,
        )
        .await?;
    }
    Ok(())
}

pub(crate) async fn load_storage_definition<C>(
    db: &C,
    form_uuid: &str,
) -> Result<Option<form_storage_definition_entity::Model>, AppError>
where
    C: ConnectionTrait,
{
    Ok(FormStorageDefinitionEntity::find()
        .filter(form_storage_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .one(db)
        .await?)
}

pub(crate) fn deserialize_storage_plan(
    definition: &form_storage_definition_entity::Model,
) -> Result<FormStoragePlan, AppError> {
    serde_json::from_value(definition.column_mapping_json.clone()).map_err(|error| {
        AppError::BadRequest(format!("invalid compiled form storage plan: {error}"))
    })
}

pub(crate) async fn delete_storage_definition<C>(db: &C, form_uuid: &str) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    if let Some(definition) = load_storage_definition(db, form_uuid).await? {
        if !is_safe_identifier(&definition.physical_table) {
            return Err(AppError::BadRequest(
                "stored dynamic table name is invalid".to_string(),
            ));
        }
        let plan = deserialize_storage_plan(&definition)?;
        for child_table in plan
            .fields
            .iter()
            .filter(|field| matches!(field.target, StorageTarget::ChildTable))
            .filter_map(|field| field.child_table.as_deref())
        {
            if !is_safe_identifier(child_table) {
                return Err(AppError::BadRequest(
                    "stored child table name is invalid".to_string(),
                ));
            }
            let function_name = build_table_name("sync_child", child_table);
            db.execute_unprepared(&format!(
                "DROP TABLE IF EXISTS \"{}\" CASCADE; DROP FUNCTION IF EXISTS \"{}\"() CASCADE;",
                child_table, function_name
            ))
            .await?;
        }
        db.execute_unprepared(&format!(
            "DROP TABLE IF EXISTS \"{}\" CASCADE",
            definition.physical_table
        ))
        .await?;
    }

    FormStorageDefinitionEntity::delete_many()
        .filter(form_storage_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .exec(db)
        .await?;
    Ok(())
}

async fn ensure_dynamic_table<C>(
    db: &C,
    plan: &FormStoragePlan,
    should_backfill_child_rows: bool,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    if !is_safe_identifier(&plan.main_table) {
        return Err(AppError::BadRequest(
            "compiled dynamic table name is invalid".to_string(),
        ));
    }
    let created_at_index = build_table_name("idx_created_at", &plan.main_table);

    db.execute_unprepared(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS "{}" (
            id UUID PRIMARY KEY,
            record_uuid VARCHAR(40) NOT NULL UNIQUE,
            schema_version INTEGER NOT NULL,
            extension_data JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            created_by VARCHAR(80) NOT NULL,
            updated_by VARCHAR(80) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "{}"
            ON "{}" (created_at DESC);
        ALTER TABLE "{}"
            ADD COLUMN IF NOT EXISTS extension_data JSONB NOT NULL DEFAULT '{{}}'::jsonb;
        "#,
        plan.main_table, created_at_index, plan.main_table, plan.main_table
    ))
    .await?;

    for field in &plan.fields {
        if !matches!(field.target, StorageTarget::Column) {
            continue;
        }
        let (Some(column_name), Some(sql_type)) =
            (field.column_name.as_deref(), field.sql_type.as_deref())
        else {
            continue;
        };
        if !is_safe_identifier(column_name) || !matches!(sql_type, "TEXT" | "NUMERIC" | "DATE") {
            return Err(AppError::BadRequest(
                "compiled dynamic column definition is invalid".to_string(),
            ));
        }
        db.execute_unprepared(&format!(
            "ALTER TABLE \"{}\" ADD COLUMN IF NOT EXISTS \"{}\" {}",
            plan.main_table, column_name, sql_type
        ))
        .await?;
    }

    ensure_child_tables(db, plan, should_backfill_child_rows).await?;
    for (table, index_name, column_name) in index_descriptors(plan) {
        db.execute_unprepared(&format!(
            "CREATE INDEX IF NOT EXISTS \"{}\" ON \"{}\" (\"{}\")",
            index_name, table, column_name
        ))
        .await?;
    }

    Ok(())
}

async fn ensure_child_tables<C>(
    db: &C,
    plan: &FormStoragePlan,
    should_backfill_child_rows: bool,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    for container in plan
        .fields
        .iter()
        .filter(|field| matches!(field.target, StorageTarget::ChildTable))
    {
        let Some(child_table) = container.child_table.as_deref() else {
            continue;
        };
        if !is_safe_identifier(child_table) {
            return Err(AppError::BadRequest(
                "compiled child table name is invalid".to_string(),
            ));
        }
        let parent_index = build_table_name("idx_parent", child_table);
        db.execute_unprepared(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS "{}" (
                id BIGSERIAL PRIMARY KEY,
                parent_record_uuid VARCHAR(40) NOT NULL
                    REFERENCES "{}" (record_uuid) ON DELETE CASCADE,
                row_index INTEGER NOT NULL,
                row_data JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                UNIQUE (parent_record_uuid, row_index)
            );
            CREATE INDEX IF NOT EXISTS "{}"
                ON "{}" (parent_record_uuid, row_index);
            "#,
            child_table, plan.main_table, parent_index, child_table
        ))
        .await?;

        let child_fields = plan
            .fields
            .iter()
            .filter(|field| field.child_table.as_deref() == Some(child_table))
            .filter(|field| !matches!(field.target, StorageTarget::ChildTable))
            .collect::<Vec<_>>();
        for child_field in child_fields
            .iter()
            .filter(|field| matches!(field.target, StorageTarget::ChildColumn))
        {
            let (Some(column_name), Some(sql_type)) = (
                child_field.column_name.as_deref(),
                child_field.sql_type.as_deref(),
            ) else {
                continue;
            };
            if !is_safe_identifier(column_name) || !matches!(sql_type, "TEXT" | "NUMERIC" | "DATE")
            {
                return Err(AppError::BadRequest(
                    "compiled child column definition is invalid".to_string(),
                ));
            }
            db.execute_unprepared(&format!(
                "ALTER TABLE \"{}\" ADD COLUMN IF NOT EXISTS \"{}\" {}",
                child_table, column_name, sql_type
            ))
            .await?;
        }

        ensure_child_sync_trigger(db, plan, container, child_table, &child_fields).await?;
        if should_backfill_child_rows {
            backfill_child_table(db, plan, container).await?;
        }
    }
    Ok(())
}

async fn backfill_child_table<C>(
    db: &C,
    plan: &FormStoragePlan,
    container: &FieldStoragePlan,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let subform_key = container.field_id.replace('\'', "''");
    db.execute_unprepared(&format!(
        "UPDATE \"{}\" SET extension_data = extension_data WHERE jsonb_typeof(extension_data -> '{}') = 'array'",
        plan.main_table, subform_key
    ))
    .await?;
    Ok(())
}

async fn ensure_child_sync_trigger<C>(
    db: &C,
    plan: &FormStoragePlan,
    container: &FieldStoragePlan,
    child_table: &str,
    child_fields: &[&FieldStoragePlan],
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    let function_name = build_table_name("sync_child", child_table);
    let trigger_name = build_table_name("trg_child", child_table);
    let subform_key = container.field_id.replace('\'', "''");
    let scalar_fields = child_fields
        .iter()
        .filter(|field| matches!(field.target, StorageTarget::ChildColumn))
        .collect::<Vec<_>>();
    let column_names = scalar_fields
        .iter()
        .filter_map(|field| field.column_name.as_deref())
        .map(|column| format!(", \"{column}\""))
        .collect::<String>();
    let column_values = scalar_fields
        .iter()
        .filter_map(|field| Some((field.field_id.as_str(), field.sql_type.as_deref()?)))
        .map(|(field_id, sql_type)| {
            format!(", {}", child_json_value_expression(field_id, sql_type))
        })
        .collect::<String>();
    let row_data_keys = scalar_fields
        .iter()
        .map(|field| format!("'{}'", field.field_id.replace('\'', "''")))
        .collect::<Vec<_>>();
    let row_data_expression = if row_data_keys.is_empty() {
        "item.value".to_string()
    } else {
        format!("item.value - ARRAY[{}]::text[]", row_data_keys.join(", "))
    };

    db.execute_unprepared(&format!(
        r#"
        CREATE OR REPLACE FUNCTION "{}"() RETURNS trigger AS $function$
        BEGIN
            DELETE FROM "{}" WHERE parent_record_uuid = NEW.record_uuid;
            INSERT INTO "{}" (parent_record_uuid, row_index, row_data{})
            SELECT NEW.record_uuid, (item.ordinality - 1)::integer, {}{}
            FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(NEW.extension_data -> '{}') = 'array'
                    THEN NEW.extension_data -> '{}'
                    ELSE '[]'::jsonb
                END
            ) WITH ORDINALITY AS item(value, ordinality);
            RETURN NEW;
        END;
        $function$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS "{}" ON "{}";
        CREATE TRIGGER "{}"
            AFTER INSERT OR UPDATE OF extension_data ON "{}"
            FOR EACH ROW EXECUTE FUNCTION "{}"();
        "#,
        function_name,
        child_table,
        child_table,
        column_names,
        row_data_expression,
        column_values,
        subform_key,
        subform_key,
        trigger_name,
        plan.main_table,
        trigger_name,
        plan.main_table,
        function_name
    ))
    .await?;
    Ok(())
}

fn child_json_value_expression(field_id: &str, sql_type: &str) -> String {
    let key = field_id.replace('\'', "''");
    match sql_type {
        "NUMERIC" => format!(
            "CASE WHEN jsonb_typeof(item.value -> '{key}') = 'number' THEN (item.value ->> '{key}')::numeric ELSE NULL END"
        ),
        "DATE" => format!(
            "CASE WHEN (item.value ->> '{key}') ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$' THEN (item.value ->> '{key}')::date ELSE NULL END"
        ),
        _ => format!("item.value ->> '{key}'"),
    }
}

fn storage_mapping(component_type: &str) -> (StorageTarget, Option<&'static str>) {
    match component_type {
        "singleLineText"
        | "multiLineText"
        | "radio"
        | "select"
        | "link"
        | "member"
        | "associationFormField"
        | "department" => (StorageTarget::Column, Some("TEXT")),
        "number" => (StorageTarget::Column, Some("NUMERIC")),
        "date" => (StorageTarget::Column, Some("DATE")),
        "checkbox" | "multiSelect" | "dateRange" | "attachment" | "imageUpload" => {
            (StorageTarget::ExtensionJson, Some("JSONB"))
        }
        "subform" => (StorageTarget::ChildTable, None),
        "groupContainer" | "description" | "button" => (StorageTarget::Virtual, None),
        _ => (StorageTarget::ExtensionJson, Some("JSONB")),
    }
}

fn is_indexable_component(component_type: &str) -> bool {
    matches!(
        component_type,
        "singleLineText" | "number" | "radio" | "select" | "date" | "member" | "department"
    )
}

fn index_descriptors(plan: &FormStoragePlan) -> Vec<(String, String, String)> {
    plan.fields
        .iter()
        .filter(|field| field.indexed)
        .filter(|field| {
            matches!(
                field.target,
                StorageTarget::Column | StorageTarget::ChildColumn
            )
        })
        .filter_map(|field| {
            let column_name = field.column_name.clone()?;
            let table = match field.target {
                StorageTarget::Column => plan.main_table.clone(),
                StorageTarget::ChildColumn => field.child_table.clone()?,
                _ => return None,
            };
            let index_name = build_table_name("idx_field", &format!("{table}_{column_name}"));
            Some((table, index_name, column_name))
        })
        .collect()
}

fn build_column_name(field_id: &str) -> String {
    format!("f_{}", bounded_identifier(field_id, 52))
}

fn build_table_name(prefix: &str, source: &str) -> String {
    let prefix = bounded_identifier(prefix, 30);
    let remaining = 62usize.saturating_sub(prefix.len());
    format!("{prefix}_{}", bounded_identifier(source, remaining))
}

fn bounded_identifier(value: &str, max_base_len: usize) -> String {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let normalized = if normalized.is_empty() {
        "field".to_string()
    } else {
        normalized
    };
    let hash = fnv1a(value.as_bytes());
    let suffix = format!("_{hash:08x}");
    let base_limit = max_base_len.saturating_sub(suffix.len()).max(1);
    let base = normalized.chars().take(base_limit).collect::<String>();
    format!("{base}{suffix}")
}

fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x01000193)
    })
}

pub(crate) fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn compiles_scalar_complex_container_and_subform_fields() {
        let plan = compile_form_storage_plan(
            "FORM-ABC",
            &json!({
                "pageProps": { "indexedFieldIds": ["name-field", "item-name"] },
                "fields": [
                    { "id": "name-field", "type": "singleLineText" },
                    { "id": "amount", "type": "number" },
                    { "id": "files", "type": "attachment" },
                    { "id": "group", "type": "groupContainer" },
                    { "id": "items", "type": "subform" },
                    { "id": "item-name", "type": "singleLineText", "parentGroupId": "items" },
                    { "id": "item-files", "type": "attachment", "parentGroupId": "items" }
                ]
            }),
        )
        .expect("storage plan should compile");

        assert_eq!(plan.fields[0].sql_type.as_deref(), Some("TEXT"));
        assert!(plan.fields[0].indexed);
        assert_eq!(plan.fields[1].sql_type.as_deref(), Some("NUMERIC"));
        assert!(matches!(
            plan.fields[2].target,
            StorageTarget::ExtensionJson
        ));
        assert!(matches!(plan.fields[3].target, StorageTarget::Virtual));
        assert!(matches!(plan.fields[4].target, StorageTarget::ChildTable));
        assert!(plan.fields[4].child_table.is_some());
        assert!(matches!(plan.fields[5].target, StorageTarget::ChildColumn));
        assert!(plan.fields[5].indexed);
        assert!(matches!(
            plan.fields[6].target,
            StorageTarget::ChildExtension
        ));
        assert_eq!(plan.fields[5].child_table, plan.fields[4].child_table);
        assert_eq!(index_descriptors(&plan).len(), 2);
    }

    #[test]
    fn produces_stable_postgres_safe_identifiers() {
        let first = build_column_name("singleLineText-1750000000000-ABC/中文");
        let second = build_column_name("singleLineText-1750000000000-ABC/中文");
        assert_eq!(first, second);
        assert!(is_safe_identifier(&first));
    }

    #[test]
    fn subform_plan_keeps_rows_in_the_parent_extension_data() {
        let plan = compile_form_storage_plan(
            "FORM-ABC",
            &json!({
                "fields": [
                    { "id": "items", "type": "subform" },
                    { "id": "item-name", "type": "singleLineText", "parentGroupId": "items" }
                ]
            }),
        )
        .expect("storage plan should compile");

        assert!(matches!(plan.fields[0].target, StorageTarget::ChildTable));
        assert!(matches!(plan.fields[1].target, StorageTarget::ChildColumn));
    }

    #[test]
    fn rejects_duplicate_field_ids() {
        let result = compile_form_storage_plan(
            "FORM-ABC",
            &json!({
                "fields": [
                    { "id": "name", "type": "singleLineText" },
                    { "id": "name", "type": "number" }
                ]
            }),
        );

        assert!(result.is_err());
    }
}
