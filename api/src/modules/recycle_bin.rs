use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{Duration, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, Statement, Value as SeaValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::entities::{form_definition_entity, form_storage_definition_entity};
use crate::platform::{
    config::{RecycleBinSettings, load_recycle_bin_settings, save_recycle_bin_settings},
    error::AppError,
    form_storage::{deserialize_storage_plan, is_safe_identifier},
    prelude::AppState,
    records::RecordRepository,
};
use crate::shared::success_response;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecycleBinEntry {
    id: String,
    form_uuid: String,
    record_uuid: String,
    source_form_name: String,
    form_type: String,
    deleted_at: String,
    expires_at: String,
    record_data: Value,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateRecycleBinSettingsRequest {
    retention_days: u16,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListRecycleBinQuery {
    pub(crate) form_uuid: Option<String>,
}

pub(crate) async fn record_deleted<C: ConnectionTrait>(
    db: &C,
    form_uuid: &str,
    record_uuid: &str,
    form_name: &str,
    form_type: &str,
    data: &Value,
    detail: Option<(&str, &str, usize)>,
) -> Result<(), AppError> {
    let (source, field, index) = detail
        .map(|(a, b, c)| (Some(a.to_string()), Some(b.to_string()), Some(c as i32)))
        .unwrap_or((None, None, None));
    db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO form_recycle_bin_entries (id, form_uuid, record_uuid, source_form_name, form_type, record_data, deleted_at, detail_source_form_uuid, detail_subform_field_id, detail_row_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (form_uuid, record_uuid) DO UPDATE SET record_data=EXCLUDED.record_data, deleted_at=EXCLUDED.deleted_at".to_string(),
        vec![SeaValue::Uuid(Some(Uuid::new_v4())), SeaValue::String(Some(form_uuid.to_string())), SeaValue::String(Some(record_uuid.to_string())), SeaValue::String(Some(form_name.to_string())), SeaValue::String(Some(form_type.to_string())), SeaValue::Json(Some(Box::new(data.clone()))), SeaValue::ChronoDateTimeUtc(Some(Utc::now())), SeaValue::String(source), SeaValue::String(field), SeaValue::Int(index)]
    )).await?;
    Ok(())
}

async fn purge_expired<C: ConnectionTrait>(db: &C) -> Result<u64, AppError> {
    let settings = load_recycle_bin_settings();
    let cutoff = Utc::now() - Duration::days(settings.retention_days as i64);
    let result = db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM form_recycle_bin_entries WHERE deleted_at < $1".to_string(),
            vec![SeaValue::ChronoDateTimeUtc(Some(cutoff))],
        ))
        .await?;
    Ok(result.rows_affected())
}

pub(crate) async fn list_recycle_bin(
    State(state): State<AppState>,
    Query(query): Query<ListRecycleBinQuery>,
) -> Result<Json<crate::platform::api::ApiResponse<Vec<RecycleBinEntry>>>, AppError> {
    purge_expired(&state.db).await?;
    let settings = load_recycle_bin_settings();
    let (statement, values) = if let Some(form_uuid) = query.form_uuid.filter(|value| !value.trim().is_empty()) {
        ("SELECT id, form_uuid, record_uuid, source_form_name, form_type, record_data, deleted_at FROM form_recycle_bin_entries WHERE form_uuid = $1 ORDER BY deleted_at DESC".to_string(), vec![SeaValue::String(Some(form_uuid))])
    } else {
        ("SELECT id, form_uuid, record_uuid, source_form_name, form_type, record_data, deleted_at FROM form_recycle_bin_entries ORDER BY deleted_at DESC".to_string(), vec![])
    };
    let rows = state.db.query_all_raw(Statement::from_sql_and_values(DbBackend::Postgres, statement, values)).await?;
    let entries = rows
        .into_iter()
        .map(|row| -> Result<RecycleBinEntry, AppError> {
            let deleted_at: chrono::DateTime<Utc> = row.try_get("", "deleted_at")?;
            Ok(RecycleBinEntry {
                id: row.try_get::<Uuid>("", "id")?.to_string(),
                form_uuid: row.try_get("", "form_uuid")?,
                record_uuid: row.try_get("", "record_uuid")?,
                source_form_name: row.try_get("", "source_form_name")?,
                form_type: row.try_get("", "form_type")?,
                record_data: row.try_get("", "record_data")?,
                deleted_at: deleted_at.to_rfc3339(),
                expires_at: (deleted_at + Duration::days(settings.retention_days as i64))
                    .to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(success_response("回收站数据已加载", entries)))
}

pub(crate) async fn get_recycle_bin_settings()
-> Json<crate::platform::api::ApiResponse<RecycleBinSettings>> {
    Json(success_response(
        "回收站设置已加载",
        load_recycle_bin_settings(),
    ))
}
pub(crate) async fn update_recycle_bin_settings(
    Json(payload): Json<UpdateRecycleBinSettingsRequest>,
) -> Result<Json<crate::platform::api::ApiResponse<RecycleBinSettings>>, AppError> {
    if !(1..=3650).contains(&payload.retention_days) {
        return Err(AppError::BadRequest(
            "回收站保留天数应在 1 至 3650 天之间".into(),
        ));
    }
    let settings = RecycleBinSettings {
        retention_days: payload.retention_days,
    };
    save_recycle_bin_settings(&settings).map_err(AppError::Server)?;
    Ok(Json(success_response("回收站设置已保存", settings)))
}

pub(crate) async fn restore_recycle_bin_entry(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::platform::api::ApiResponse<Value>>, AppError> {
    purge_expired(&state.db).await?;
    let entry = state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres, "SELECT form_uuid, record_uuid, record_data, detail_source_form_uuid, detail_subform_field_id, detail_row_index FROM form_recycle_bin_entries WHERE id = $1".to_string(), vec![SeaValue::Uuid(Some(Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid recycle entry id".into()))?))])).await?.ok_or_else(|| AppError::NotFound("回收站记录不存在或已过期".into()))?;
    let form_uuid: String = entry.try_get("", "form_uuid")?;
    let data: Value = entry.try_get("", "record_data")?;
    let source: Option<String> = entry.try_get("", "detail_source_form_uuid")?;
    if let Some(source_uuid) = source {
        let field: String = entry.try_get("", "detail_subform_field_id")?;
        let index: i32 = entry.try_get("", "detail_row_index")?;
        let repository = RecordRepository::new(&state.db);
        let record_uuid: String = entry.try_get("", "record_uuid")?;
        let parent_uuid = record_uuid
            .split("::")
            .next()
            .ok_or_else(|| AppError::BadRequest("invalid detail record id".into()))?;
        let parent = repository.find(&source_uuid, parent_uuid).await?;
        let mut next = parent.record_data.clone();
        let rows = next
            .get_mut(&field)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| AppError::NotFound("明细所属记录不存在".into()))?;
        rows.insert((index as usize).min(rows.len()), data);
        repository
            .update(&parent, next, "管理员", Utc::now())
            .await?;
    } else {
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.clone()))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("原表单已删除，无法恢复".into()))?;
        let storage = form_storage_definition_entity::Entity::find()
            .filter(form_storage_definition_entity::Column::FormUuid.eq(form_uuid))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("表单存储定义不存在".into()))?;
        let plan = deserialize_storage_plan(&storage)?;
        if !is_safe_identifier(&plan.main_table) {
            return Err(AppError::BadRequest("invalid storage table".into()));
        }
        state
            .db
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                format!(
                    "UPDATE \"{}\" SET deleted_at = NULL WHERE record_uuid = $1",
                    plan.main_table
                ),
                vec![SeaValue::String(Some(entry.try_get("", "record_uuid")?))],
            ))
            .await?;
        let _ = definition;
    }
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM form_recycle_bin_entries WHERE id = $1".to_string(),
            vec![SeaValue::Uuid(Some(Uuid::parse_str(&id).map_err(
                |_| AppError::BadRequest("invalid recycle entry id".into()),
            )?))],
        ))
        .await?;
    Ok(Json(success_response(
        "数据已恢复",
        json!({ "restored": true }),
    )))
}

pub(crate) async fn delete_recycle_bin_entry(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::platform::api::ApiResponse<Value>>, AppError> {
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM form_recycle_bin_entries WHERE id = $1".to_string(),
            vec![SeaValue::Uuid(Some(Uuid::parse_str(&id).map_err(
                |_| AppError::BadRequest("invalid recycle entry id".into()),
            )?))],
        ))
        .await?;
    Ok(Json(success_response(
        "回收站记录已永久删除",
        json!({ "deleted": true }),
    )))
}
pub(crate) async fn empty_recycle_bin(
    State(state): State<AppState>,
) -> Result<Json<crate::platform::api::ApiResponse<Value>>, AppError> {
    state
        .db
        .execute_unprepared("DELETE FROM form_recycle_bin_entries")
        .await?;
    Ok(Json(success_response(
        "回收站已清空",
        json!({ "deleted": true }),
    )))
}
pub(crate) async fn delete_entries_for_form<C: ConnectionTrait>(
    db: &C,
    form_uuid: &str,
) -> Result<(), AppError> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "DELETE FROM form_recycle_bin_entries WHERE form_uuid = $1 OR detail_source_form_uuid = $1"
            .to_string(),
        vec![SeaValue::String(Some(form_uuid.to_string()))],
    ))
    .await?;
    Ok(())
}
