use crate::modules::automations;
use crate::modules::navigation::{
    ensure_system_navigation_for_app, next_navigation_sort_order, normalize_navigation_orders,
    sync_navigation_title,
};
use crate::platform::prelude::*;
use crate::platform::records::{decrement_app_records_count, insert_form_record};
use crate::shared::*;
use axum::http::StatusCode;

pub(crate) async fn list_forms(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiFormSummary>>>, AppError> {
    let forms = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_desc(form_definition_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取表单列表成功",
        forms.into_iter().map(ApiFormSummary::from).collect(),
    )))
}
pub(crate) async fn create_form(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormSummary>>), AppError> {
    let now = Utc::now();
    let form_uuid = generate_form_uuid();
    let form_name = "未命名表单".to_string();
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;
    let existing_form_count = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .filter(app_navigation_entity::Column::ItemType.eq("form"))
        .count(&state.db)
        .await? as i32;
    let has_default_entry = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .filter(app_navigation_entity::Column::IsDefaultEntry.eq(true))
        .count(&state.db)
        .await?
        > 0;
    let is_default_entry = !has_default_entry;
    let slug = build_form_slug(existing_form_count);
    let sort_order = next_navigation_sort_order(&state.db, &app_id, None).await?;
    let initial_schema = build_blank_schema(&form_uuid, &form_name);

    let definition = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id),
        form_uuid: Set(form_uuid.clone()),
        name: Set(form_name),
        slug: Set(slug),
        status: Set("draft".to_string()),
        draft_schema_version: Set(1),
        published_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(definition.app_route_app_id.clone()),
        item_type: Set("form".to_string()),
        target_form_uuid: Set(Some(definition.form_uuid.clone())),
        title: Set(definition.name.clone()),
        path_slug: Set(definition.slug.clone()),
        sort_order: Set(sort_order),
        is_default_entry: Set(is_default_entry),
        parent_id: Set(None),
        visibility_rule: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid),
        version: Set(1),
        schema_json: Set(initial_schema),
        change_log: Set(Some("initial version".to_string())),
        published: Set(true),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建表单成功",
            ApiFormSummary::from(definition),
        )),
    ))
}

pub(crate) async fn delete_form(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;

    FormRecordEntity::delete_many()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&state.db)
        .await?;

    FormSchemaEntity::delete_many()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&state.db)
        .await?;

    AppNavigationEntity::delete_many()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.clone())))
        .exec(&state.db)
        .await?;

    AutomationFlowEntity::delete_many()
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(Some(form_uuid.clone())))
        .exec(&state.db)
        .await?;

    FormDefinitionEntity::delete_many()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .exec(&state.db)
        .await?;

    let records_count = FormRecordEntity::find()
        .filter(form_record_entity::Column::AppRouteAppId.eq(definition.app_route_app_id.clone()))
        .count(&state.db)
        .await? as i64;

    if let Some(app) = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(definition.app_route_app_id))
        .one(&state.db)
        .await?
    {
        let now = Utc::now();
        let mut active_model: app_entity::ActiveModel = app.into();
        active_model.records_count = Set(records_count);
        active_model.updated_at = Set(now.into());
        active_model.update(&state.db).await?;
    }

    Ok(Json(success_response(
        "删除表单成功",
        json!({ "deleted": true }),
    )))
}

pub(crate) async fn get_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Query(query): Query<GetSchemaQuery>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let version = resolve_schema_version(&definition, &query);
    let schema = load_schema_version(&state.db, &form_uuid, version).await?;

    Ok(Json(success_response(
        "获取表单 Schema 成功",
        build_schema_payload(&definition, schema),
    )))
}

pub(crate) async fn list_form_records(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiFormRecordList>>, AppError> {
    find_form_definition(&state.db, &form_uuid).await?;

    let items = FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_record_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    let total = items.len() as i64;

    Ok(Json(success_response(
        "获取表单数据成功",
        ApiFormRecordList {
            items: items.into_iter().map(ApiFormRecord::from).collect(),
            total,
        },
    )))
}

pub(crate) async fn create_form_record(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Json(payload): Json<CreateFormRecordRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormRecord>>), AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let now = Utc::now();
    let operator = normalize_operator(payload.operator);
    let trigger_data = normalize_record_payload(payload.data);

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_create",
        &trigger_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation before create failed: {err:?}");
    }

    let record = insert_form_record(&state.db, &definition, trigger_data, &operator, now).await?;

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_create",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation after create failed: {err:?}");
    }

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "提交表单数据成功",
            ApiFormRecord::from(record),
        )),
    ))
}

pub(crate) async fn update_form_record(
    State(state): State<AppState>,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<UpdateFormRecordRequest>,
) -> Result<Json<ApiResponse<ApiFormRecord>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let record = find_form_record(&state.db, &form_uuid, &record_uuid).await?;
    let operator = normalize_operator(payload.operator);
    let next_data = normalize_record_payload(payload.data);
    let changed_fields = collect_changed_fields(&record.record_data, &next_data);

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_update",
        &next_data,
        &operator,
        Some(&changed_fields),
    )
    .await
    {
        error!("run automation before update failed: {err:?}");
    }

    let now = Utc::now();
    let mut active_model: form_record_entity::ActiveModel = record.into();
    active_model.record_data = Set(next_data.clone());
    active_model.updated_by = Set(operator.clone());
    active_model.updated_at = Set(now.into());
    let updated = active_model.update(&state.db).await?;

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_update",
        &updated.record_data,
        &operator,
        Some(&changed_fields),
    )
    .await
    {
        error!("run automation after update failed: {err:?}");
    }

    Ok(Json(success_response(
        "更新表单数据成功",
        ApiFormRecord::from(updated),
    )))
}

pub(crate) async fn delete_form_record(
    State(state): State<AppState>,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let record = find_form_record(&state.db, &form_uuid, &record_uuid).await?;
    let operator = "管理员".to_string();

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_delete",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation before delete failed: {err:?}");
    }

    FormRecordEntity::delete_many()
        .filter(form_record_entity::Column::Id.eq(record.id))
        .exec(&state.db)
        .await?;
    decrement_app_records_count(&state.db, &definition.app_route_app_id, 1, Utc::now()).await?;

    if let Err(err) = automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "after_delete",
        &record.record_data,
        &operator,
        None,
    )
    .await
    {
        error!("run automation after delete failed: {err:?}");
    }

    Ok(Json(success_response(
        "删除表单数据成功",
        json!({ "deleted": true, "recordId": record_uuid }),
    )))
}

pub(crate) async fn save_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Json(payload): Json<SaveSchemaRequest>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;

    let next_version = definition.latest_schema_version + 1;
    let now = Utc::now();
    let next_name = payload
        .schema
        .get("formName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名表单")
        .to_string();

    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid.clone()),
        version: Set(next_version),
        schema_json: Set(payload.schema.clone()),
        change_log: Set(payload.change_log.clone()),
        published: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.name = Set(next_name);
    definition_active.draft_schema_version = Set(next_version);
    definition_active.latest_schema_version = Set(next_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    sync_navigation_title(
        &state.db,
        &form_uuid,
        &updated_definition.name,
        &updated_definition.slug,
        now,
    )
    .await?;

    Ok(Json(success_response(
        "保存表单 Schema 成功",
        ApiSchemaPayload {
            form_uuid,
            schema: payload.schema,
            version: next_version,
            draft_version: updated_definition.draft_schema_version,
            published_version: updated_definition.published_schema_version,
            latest_version: updated_definition.latest_schema_version,
            published: false,
        },
    )))
}

pub(crate) async fn list_form_versions(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiFormVersionSummary>>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let versions = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_schema_entity::Column::Version)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "获取表单版本成功",
        versions
            .into_iter()
            .map(|item| ApiFormVersionSummary {
                version: item.version,
                published: item.published,
                is_current_draft: item.version == definition.draft_schema_version,
                is_current_published: item.version == definition.published_schema_version,
                change_log: item.change_log,
                created_at: item.created_at.to_rfc3339(),
            })
            .collect(),
    )))
}

pub(crate) async fn get_form_version(
    State(state): State<AppState>,
    Path((form_uuid, version)): Path<(String, i32)>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let schema = load_schema_version(&state.db, &form_uuid, version).await?;

    Ok(Json(success_response(
        "获取指定版本 Schema 成功",
        build_schema_payload(&definition, schema),
    )))
}

pub(crate) async fn publish_form_schema(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let now = Utc::now();
    let draft_version = definition.draft_schema_version;

    if let Some(current_published) = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .filter(form_schema_entity::Column::Published.eq(true))
        .one(&state.db)
        .await?
    {
        let mut published_active: form_schema_entity::ActiveModel = current_published.into();
        published_active.published = Set(false);
        published_active.updated_at = Set(now.into());
        published_active.update(&state.db).await?;
    }

    let draft_schema = load_schema_version(&state.db, &form_uuid, draft_version).await?;
    let mut draft_active: form_schema_entity::ActiveModel = draft_schema.clone().into();
    draft_active.published = Set(true);
    draft_active.updated_at = Set(now.into());
    let published_schema = draft_active.update(&state.db).await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.published_schema_version = Set(draft_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    Ok(Json(success_response(
        "发布表单版本成功",
        build_schema_payload(&updated_definition, published_schema),
    )))
}

pub(crate) async fn restore_form_version(
    State(state): State<AppState>,
    Path((form_uuid, version)): Path<(String, i32)>,
    payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let source_schema = load_schema_version(&state.db, &form_uuid, version).await?;
    let now = Utc::now();
    let next_version = definition.latest_schema_version + 1;
    let next_name = source_schema
        .schema_json
        .get("formName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名表单")
        .to_string();
    let change_log = payload
        .and_then(|Json(value)| value.change_log)
        .unwrap_or_else(|| format!("restored from v{version}"));

    let restored_schema = form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid.clone()),
        version: Set(next_version),
        schema_json: Set(source_schema.schema_json.clone()),
        change_log: Set(Some(change_log)),
        published: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.name = Set(next_name);
    definition_active.draft_schema_version = Set(next_version);
    definition_active.latest_schema_version = Set(next_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&state.db).await?;

    sync_navigation_title(
        &state.db,
        &form_uuid,
        &updated_definition.name,
        &updated_definition.slug,
        now,
    )
    .await?;

    Ok(Json(success_response(
        "恢复表单版本成功",
        build_schema_payload(&updated_definition, restored_schema),
    )))
}

pub(crate) async fn find_form_definition(
    db: &DatabaseConnection,
    form_uuid: &str,
) -> Result<form_definition_entity::Model, AppError> {
    FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))
}

pub(crate) async fn find_form_record(
    db: &DatabaseConnection,
    form_uuid: &str,
    record_uuid: &str,
) -> Result<form_record_entity::Model, AppError> {
    FormRecordEntity::find()
        .filter(form_record_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .filter(form_record_entity::Column::RecordUuid.eq(record_uuid.to_string()))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("record not found".to_string()))
}

pub(crate) fn collect_changed_fields(previous: &Value, next: &Value) -> HashSet<String> {
    let mut changed = HashSet::new();
    let previous_map = previous.as_object().cloned().unwrap_or_default();
    let next_map = next.as_object().cloned().unwrap_or_default();

    for key in previous_map.keys().chain(next_map.keys()) {
        if changed.contains(key) {
            continue;
        }
        let prev = previous_map.get(key);
        let curr = next_map.get(key);
        if prev != curr {
            changed.insert(key.clone());
        }
    }

    changed
}

pub(crate) async fn load_schema_version(
    db: &DatabaseConnection,
    form_uuid: &str,
    version: i32,
) -> Result<form_schema_entity::Model, AppError> {
    load_schema_version_for_connection(db, form_uuid, version).await
}

pub(crate) async fn load_schema_version_for_connection<C>(
    db: &C,
    form_uuid: &str,
    version: i32,
) -> Result<form_schema_entity::Model, AppError>
where
    C: ConnectionTrait,
{
    FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.to_string()))
        .filter(form_schema_entity::Column::Version.eq(version))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("schema not found".to_string()))
}

pub(crate) fn resolve_schema_version(
    definition: &form_definition_entity::Model,
    query: &GetSchemaQuery,
) -> i32 {
    if let Some(version) = query.version {
        return version;
    }

    match query.scope.as_deref() {
        Some("draft") => definition.draft_schema_version,
        Some("latest") => definition.latest_schema_version,
        Some("published") | None => definition.published_schema_version,
        Some(_) => definition.published_schema_version,
    }
}

pub(crate) fn build_schema_payload(
    definition: &form_definition_entity::Model,
    schema: form_schema_entity::Model,
) -> ApiSchemaPayload {
    ApiSchemaPayload {
        form_uuid: definition.form_uuid.clone(),
        schema: schema.schema_json,
        version: schema.version,
        draft_version: definition.draft_schema_version,
        published_version: definition.published_schema_version,
        latest_version: definition.latest_schema_version,
        published: schema.published,
    }
}
pub(crate) mod dto;

use dto::*;
