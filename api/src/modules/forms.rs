use crate::infrastructure::entities::form_detail_definition_entity;
use crate::infrastructure::entities::form_storage_definition_entity;
use crate::infrastructure::entities::form_view_entity;
use crate::infrastructure::entities::{iam_user_entity, organization_unit_entity};
use crate::modules::automations;
use crate::modules::navigation::{
    ensure_system_navigation_for_app, next_navigation_sort_order, normalize_navigation_orders,
    sync_navigation_title,
};
use crate::platform::authorization;
use crate::platform::form_storage::{delete_storage_definition, sync_published_storage_plan};
use crate::platform::prelude::*;
use crate::platform::records::{RecordRepository, StoredFormRecord};
use crate::shared::*;
use axum::http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FormViewResponse {
    pub(crate) view_uuid: String,
    pub(crate) name: String,
    pub(crate) config: Value,
    pub(crate) updated_at: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveFormViewRequest {
    pub(crate) name: String,
    pub(crate) config: Value,
}

pub(crate) async fn list_form_views(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<FormViewResponse>>>, AppError> {
    let views = form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq(form_uuid))
        .order_by_desc(form_view_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "form views loaded",
        views.into_iter().map(view_response).collect(),
    )))
}
pub(crate) async fn create_form_view(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Json(payload): Json<SaveFormViewRequest>,
) -> Result<Json<ApiResponse<FormViewResponse>>, AppError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("view name is required".to_string()));
    }
    let now = Utc::now();
    let created = form_view_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid),
        view_uuid: Set(format!(
            "VIEW-{}",
            Uuid::new_v4().simple().to_string().to_uppercase()
        )),
        name: Set(name.to_string()),
        config_json: Set(payload.config),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "form view created",
        view_response(created),
    )))
}
pub(crate) async fn update_form_view(
    State(state): State<AppState>,
    Path((form_uuid, view_uuid)): Path<(String, String)>,
    Json(payload): Json<SaveFormViewRequest>,
) -> Result<Json<ApiResponse<FormViewResponse>>, AppError> {
    if view_uuid == "default" {
        let now = Utc::now();
        let default_view = form_view_entity::Entity::find()
            .filter(form_view_entity::Column::FormUuid.eq(&form_uuid))
            .filter(form_view_entity::Column::ViewUuid.eq("default"))
            .one(&state.db)
            .await?;
        let saved = if let Some(view) = default_view {
            let mut active: form_view_entity::ActiveModel = view.into();
            active.config_json = Set(payload.config);
            active.updated_at = Set(now.into());
            active.update(&state.db).await?
        } else {
            form_view_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                form_uuid: Set(form_uuid),
                view_uuid: Set("default".to_string()),
                name: Set("全部数据".to_string()),
                config_json: Set(payload.config),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(&state.db)
            .await?
        };
        return Ok(Json(success_response(
            "default form view updated",
            view_response(saved),
        )));
    }
    let view = form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq(form_uuid))
        .filter(form_view_entity::Column::ViewUuid.eq(view_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("view not found".to_string()))?;
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("view name is required".to_string()));
    }
    let mut active: form_view_entity::ActiveModel = view.into();
    active.name = Set(name.to_string());
    active.config_json = Set(payload.config);
    active.updated_at = Set(Utc::now().into());
    let updated = active.update(&state.db).await?;
    Ok(Json(success_response(
        "form view updated",
        view_response(updated),
    )))
}
pub(crate) async fn delete_form_view(
    State(state): State<AppState>,
    Path((form_uuid, view_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    if view_uuid == "default" {
        return Err(AppError::BadRequest(
            "default view cannot be deleted".to_string(),
        ));
    }
    let result = form_view_entity::Entity::delete_many()
        .filter(form_view_entity::Column::FormUuid.eq(form_uuid))
        .filter(form_view_entity::Column::ViewUuid.eq(&view_uuid))
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound("view not found".to_string()));
    }
    Ok(Json(success_response(
        "form view deleted",
        json!({ "viewUuid": view_uuid }),
    )))
}
fn view_response(view: form_view_entity::Model) -> FormViewResponse {
    FormViewResponse {
        view_uuid: view.view_uuid,
        name: view.name,
        config: view.config_json,
        updated_at: view.updated_at.to_rfc3339(),
    }
}

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

pub(crate) async fn get_app_field_outline(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<ApiAppFieldOutline>>, AppError> {
    let app = AppEntity::find()
        .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("app not found".to_string()))?;
    let forms = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .order_by_desc(form_definition_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let form_uuids = forms
        .iter()
        .map(|form| form.form_uuid.clone())
        .collect::<Vec<_>>();
    let schemas = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.is_in(form_uuids.clone()))
        .all(&state.db)
        .await?;
    let schemas_by_key = schemas
        .into_iter()
        .map(|schema| ((schema.form_uuid.clone(), schema.version), schema))
        .collect::<HashMap<_, _>>();
    let storage_by_form = form_storage_definition_entity::Entity::find()
        .filter(form_storage_definition_entity::Column::FormUuid.is_in(form_uuids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|storage| (storage.form_uuid.clone(), storage))
        .collect::<HashMap<_, _>>();

    let outlined_forms = forms
        .into_iter()
        .map(|form| {
            let schema = schemas_by_key.get(&(form.form_uuid.clone(), form.draft_schema_version));
            let fields = schema
                .and_then(|item| item.schema_json.get("fields"))
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(outline_field).collect())
                .unwrap_or_default();
            let storage = storage_by_form.get(&form.form_uuid);
            ApiFieldOutlineForm {
                form_uuid: form.form_uuid,
                name: form.name,
                form_type: form.form_type,
                status: form.status,
                schema_version: form.draft_schema_version,
                physical_table: storage.map(|item| item.physical_table.clone()),
                compiled_schema_version: storage.map(|item| item.compiled_schema_version),
                fields,
            }
        })
        .collect();

    Ok(Json(success_response(
        "获取应用字段大纲成功",
        ApiAppFieldOutline {
            app_id,
            app_name: app.name,
            forms: outlined_forms,
        },
    )))
}

fn outline_field(field: &Value) -> Option<ApiFieldOutlineField> {
    let id = field.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let props = field.get("props");
    let label = props
        .and_then(|value| value.get("label"))
        .and_then(Value::as_str)
        .or_else(|| field.get("label").and_then(Value::as_str))
        .unwrap_or(id)
        .to_string();
    Some(ApiFieldOutlineField {
        id: id.to_string(),
        label,
        component_type: field
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        parent_group_id: field
            .get("parentGroupId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}
pub(crate) async fn create_form(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<CreateFormRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormSummary>>), AppError> {
    let form_type = normalize_form_type(payload.form_type.as_deref())?;
    let definition = create_blank_form(&state.db, &app_id, None, form_type).await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建表单成功",
            ApiFormSummary::from(definition),
        )),
    ))
}

pub(crate) async fn create_detail_form(
    State(state): State<AppState>,
    Path(source_form_uuid): Path<String>,
    Json(payload): Json<CreateDetailFormRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiDetailForm>>), AppError> {
    let source = find_form_definition(&state.db, &source_form_uuid).await?;
    if source.form_type == "detail" {
        return Err(AppError::BadRequest(
            "a detail form cannot own another detail form".to_string(),
        ));
    }
    let schema = load_schema_version(
        &state.db,
        &source_form_uuid,
        source.published_schema_version,
    )
    .await?;
    let subform_id = payload.subform_field_id.trim();
    let subform = schema
        .schema_json
        .get("fields")
        .and_then(Value::as_array)
        .and_then(|fields| {
            fields.iter().find(|field| {
                field.get("id").and_then(Value::as_str) == Some(subform_id)
                    && field.get("type").and_then(Value::as_str) == Some("subform")
            })
        })
        .ok_or_else(|| {
            AppError::BadRequest("subform field not found in the published schema".to_string())
        })?;
    if form_detail_definition_entity::Entity::find()
        .filter(form_detail_definition_entity::Column::SourceFormUuid.eq(source_form_uuid.clone()))
        .filter(form_detail_definition_entity::Column::SubformFieldId.eq(subform_id.to_string()))
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(AppError::BadRequest(
            "a detail form already exists for this subform".to_string(),
        ));
    }
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            subform
                .get("label")
                .and_then(Value::as_str)
                .map(|value| format!("{}明细", value))
        })
        .unwrap_or_else(|| "子表明细".to_string());
    let primary_display_field_id = validate_detail_display_field_id(
        &schema.schema_json,
        payload.primary_display_field_id.as_deref(),
    )?
    .or_else(|| Some("instanceId".to_string()));
    let secondary_display_field_id = validate_detail_display_field_id(
        &schema.schema_json,
        payload.secondary_display_field_id.as_deref(),
    )?
    .or_else(|| Some("submitter".to_string()));
    if primary_display_field_id.is_some() && primary_display_field_id == secondary_display_field_id
    {
        return Err(AppError::BadRequest(
            "primary and secondary display fields must be different".to_string(),
        ));
    }
    let now = Utc::now();
    let detail_uuid = generate_form_uuid();
    let txn = state.db.begin().await?;
    let _definition = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(source.app_route_app_id.clone()),
        form_uuid: Set(detail_uuid.clone()),
        name: Set(title.clone()),
        slug: Set(detail_uuid.to_lowercase()),
        form_type: Set("detail".to_string()),
        status: Set("published".to_string()),
        draft_schema_version: Set(1),
        published_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    // The source schema is flat and marks child controls with parentGroupId. A generated
    // detail form has no subform container of its own, so promote those controls to roots.
    // Its layout is intentionally vertical: source subforms use columns as table columns,
    // while a detail form edits one row and therefore needs one field per form row.
    let child_fields = schema
        .schema_json
        .get("fields")
        .and_then(Value::as_array)
        .map(|fields| {
            fields
                .iter()
                .filter(|field| {
                    field.get("parentGroupId").and_then(Value::as_str) == Some(subform_id)
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let detail_schema = normalize_detail_schema(
        serde_json::json!({"formName": title, "columns": 1, "rows": child_fields.len().max(1), "fields": child_fields, "pageProps": {"detailSourceFormUuid": source_form_uuid, "detailSubformFieldId": subform_id, "detailPrimaryDisplayFieldId": primary_display_field_id, "detailSecondaryDisplayFieldId": secondary_display_field_id}}),
    );
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(detail_uuid.clone()),
        version: Set(1),
        schema_json: Set(detail_schema),
        change_log: Set(Some("generated detail form".to_string())),
        published: Set(true),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    form_detail_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        detail_form_uuid: Set(detail_uuid.clone()),
        source_form_uuid: Set(source_form_uuid.clone()),
        subform_field_id: Set(subform_id.to_string()),
        title: Set(title.clone()),
        primary_display_field_id: Set(primary_display_field_id.clone()),
        secondary_display_field_id: Set(secondary_display_field_id.clone()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    let parent = app_navigation_entity::Entity::find()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(source_form_uuid.clone())))
        .one(&txn)
        .await?;
    let sort_order = next_navigation_sort_order(
        &state.db,
        &source.app_route_app_id,
        parent.as_ref().map(|item| item.id),
    )
    .await?;
    app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(source.app_route_app_id),
        item_type: Set("form".to_string()),
        target_form_uuid: Set(Some(detail_uuid.clone())),
        title: Set(title.clone()),
        path_slug: Set(detail_uuid.to_lowercase()),
        sort_order: Set(sort_order),
        is_default_entry: Set(false),
        parent_id: Set(parent.map(|item| item.id)),
        visibility_rule: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;
    txn.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "detail form created",
            ApiDetailForm {
                detail_form_uuid: detail_uuid,
                source_form_uuid,
                subform_field_id: subform_id.to_string(),
                title,
                primary_display_field_id,
                secondary_display_field_id,
            },
        )),
    ))
}

pub(crate) async fn list_detail_forms(
    State(state): State<AppState>,
    Path(source_form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiDetailForm>>>, AppError> {
    find_form_definition(&state.db, &source_form_uuid).await?;
    let details = form_detail_definition_entity::Entity::find()
        .filter(form_detail_definition_entity::Column::SourceFormUuid.eq(source_form_uuid))
        .order_by_asc(form_detail_definition_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "detail forms loaded",
        details
            .into_iter()
            .map(|detail| ApiDetailForm {
                detail_form_uuid: detail.detail_form_uuid,
                source_form_uuid: detail.source_form_uuid,
                subform_field_id: detail.subform_field_id,
                title: detail.title,
                primary_display_field_id: detail.primary_display_field_id,
                secondary_display_field_id: detail.secondary_display_field_id,
            })
            .collect(),
    )))
}

fn validate_detail_display_field_id(
    schema: &Value,
    field_id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(field_id) = field_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let displayable_builtin = matches!(
        field_id,
        "instanceId"
            | "instanceTitle"
            | "submitter"
            | "submitterOrganization"
            | "createdAt"
            | "updatedAt"
            | "workflowApprovalStatus"
            | "workflowInstanceStatus"
            | "workflowCurrentApprovalNode"
            | "workflowSubmitter"
    );
    let displayable_form_field = schema
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|field| {
            let field_type = field
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            field.get("id").and_then(Value::as_str) == Some(field_id)
                && !matches!(
                    field_type,
                    "subform"
                        | "description"
                        | "groupContainer"
                        | "button"
                        | "link"
                        | "html"
                        | "tsx"
                )
        });
    if displayable_builtin || displayable_form_field {
        Ok(Some(field_id.to_string()))
    } else {
        Err(AppError::BadRequest(
            "detail display field must be a visible source form field".to_string(),
        ))
    }
}

pub(crate) async fn create_blank_form(
    db: &DatabaseConnection,
    app_id: &str,
    requested_name: Option<String>,
    form_type: &str,
) -> Result<form_definition_entity::Model, AppError> {
    let now = Utc::now();
    let form_uuid = generate_form_uuid();
    let form_name = requested_name
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.trim().to_string())
        .unwrap_or_else(|| "未命名表单".to_string());
    ensure_system_navigation_for_app(db, app_id).await?;
    normalize_navigation_orders(db, app_id).await?;
    let existing_form_count = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .filter(app_navigation_entity::Column::ItemType.eq("form"))
        .count(db)
        .await? as i32;
    let has_default_entry = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .filter(app_navigation_entity::Column::IsDefaultEntry.eq(true))
        .count(db)
        .await?
        > 0;
    let is_default_entry = !has_default_entry;
    let slug = build_form_slug(existing_form_count);
    let sort_order = next_navigation_sort_order(db, app_id, None).await?;
    let initial_schema = build_blank_schema(&form_uuid, &form_name);

    let txn = db.begin().await?;
    let definition = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id.to_string()),
        form_uuid: Set(form_uuid.clone()),
        name: Set(form_name),
        slug: Set(slug),
        form_type: Set(form_type.to_string()),
        status: Set("draft".to_string()),
        draft_schema_version: Set(1),
        published_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
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
    .insert(&txn)
    .await?;

    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form_uuid.clone()),
        version: Set(1),
        schema_json: Set(initial_schema.clone()),
        change_log: Set(Some("initial version".to_string())),
        published: Set(true),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&txn)
    .await?;

    if form_type == "workflow" {
        automations::create_process_flow_for_form(
            &txn,
            app_id,
            &definition.form_uuid,
            &definition.name,
        )
        .await?;
    }

    sync_published_storage_plan(&txn, &form_uuid, 1, &initial_schema).await?;
    txn.commit().await?;

    Ok(definition)
}

fn normalize_form_type(form_type: Option<&str>) -> Result<&str, AppError> {
    match form_type.unwrap_or("normal").trim() {
        "" | "normal" => Ok("normal"),
        "workflow" => Ok("workflow"),
        // A defined page has the same record and storage lifecycle as a normal form.
        // Its additional HTML/TSX nodes are UI-only and are deliberately not workflows.
        "defined" => Ok("defined"),
        _ => Err(AppError::BadRequest("unsupported form type".to_string())),
    }
}

fn validate_schema_for_form_type(form_type: &str, schema: &Value) -> Result<(), AppError> {
    let Some(fields) = schema.get("fields").and_then(Value::as_array) else {
        return Err(AppError::BadRequest(
            "form schema fields must be an array".to_string(),
        ));
    };

    for field in fields {
        let component_type = field.get("type").and_then(Value::as_str).unwrap_or("");
        if component_type != "html" && component_type != "tsx" {
            continue;
        }
        if form_type != "defined" {
            return Err(AppError::BadRequest(
                "html and tsx components are only available in defined forms".to_string(),
            ));
        }
        let props = field.get("props").unwrap_or(&Value::Null);
        if props
            .get("code")
            .and_then(Value::as_str)
            .is_some_and(|code| code.len() > 262_144)
        {
            return Err(AppError::BadRequest(
                "custom component source exceeds 256 KiB".to_string(),
            ));
        }
        let origins = props
            .get("allowedResourceOrigins")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if origins.len() > 32 {
            return Err(AppError::BadRequest(
                "a custom component may allow at most 32 external origins".to_string(),
            ));
        }
        for origin in origins {
            let Some(origin) = origin.as_str() else {
                return Err(AppError::BadRequest(
                    "custom component resource origins must be strings".to_string(),
                ));
            };
            if !origin.starts_with("https://") || origin[8..].contains('/') {
                return Err(AppError::BadRequest(
                    "custom component resource origins must be HTTPS origins".to_string(),
                ));
            }
        }
    }

    let assets = schema
        .get("pageProps")
        .and_then(|page_props| page_props.get("assets"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !assets.is_empty() && form_type != "defined" {
        return Err(AppError::BadRequest(
            "page assets are only available in defined forms".to_string(),
        ));
    }
    if assets.len() > 32 {
        return Err(AppError::BadRequest(
            "a defined form may register at most 32 page assets".to_string(),
        ));
    }
    let mut asset_ids = std::collections::HashSet::new();
    for asset in assets {
        let id = asset.get("id").and_then(Value::as_str).unwrap_or("");
        let valid_id = !id.is_empty()
            && id.len() <= 64
            && id.chars().enumerate().all(|(index, character)| {
                (character.is_ascii_alphanumeric() || character == '_' || character == '-')
                    && (index > 0 || character.is_ascii_alphabetic())
            });
        if !valid_id || !asset_ids.insert(id.to_string()) {
            return Err(AppError::BadRequest(
                "page asset ids must be unique identifiers".to_string(),
            ));
        }
        let asset_type = asset.get("type").and_then(Value::as_str).unwrap_or("");
        if !matches!(asset_type, "script" | "style") {
            return Err(AppError::BadRequest(
                "page asset type must be script or style".to_string(),
            ));
        }
        let url = asset.get("url").and_then(Value::as_str).unwrap_or("");
        if !url.starts_with("https://") || url.len() > 2048 || url.chars().any(char::is_whitespace)
        {
            return Err(AppError::BadRequest(
                "page assets must use HTTPS URLs".to_string(),
            ));
        }
        if asset_type == "script" {
            let integrity = asset.get("integrity").and_then(Value::as_str).unwrap_or("");
            if integrity.is_empty()
                || !integrity.split_whitespace().all(|value| {
                    value.starts_with("sha256-")
                        || value.starts_with("sha384-")
                        || value.starts_with("sha512-")
                })
            {
                return Err(AppError::BadRequest(
                    "script page assets require a valid SRI integrity hash".to_string(),
                ));
            }
        }
    }
    Ok(())
}

pub(crate) async fn get_form(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiFormSummary>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    Ok(Json(success_response(
        "获取表单详情成功",
        ApiFormSummary::from(definition),
    )))
}

pub(crate) async fn ensure_workflow_process_flow(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<automations::dto::ApiAutomationFlow>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    if definition.form_type != "workflow" {
        return Err(AppError::BadRequest(
            "process automation is only available for workflow forms".to_string(),
        ));
    }

    let flow = automations::ensure_process_flow_for_form(
        &state.db,
        &definition.app_route_app_id,
        &definition.form_uuid,
        &definition.name,
    )
    .await?;

    Ok(Json(success_response(
        "流程自动化已就绪",
        automations::dto::ApiAutomationFlow::from(flow),
    )))
}

pub(crate) async fn delete_form(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;

    let txn = state.db.begin().await?;
    // Detail forms are logical mappings. They never own a dynamic storage definition or
    // physical table, so deleting one must only remove its metadata, schema and navigation.
    if definition.form_type == "detail" {
        app_navigation_entity::Entity::delete_many()
            .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.clone())))
            .exec(&txn)
            .await?;
        form_detail_definition_entity::Entity::delete_many()
            .filter(form_detail_definition_entity::Column::DetailFormUuid.eq(form_uuid.clone()))
            .exec(&txn)
            .await?;
        FormSchemaEntity::delete_many()
            .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
            .exec(&txn)
            .await?;
        FormDefinitionEntity::delete_many()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
            .exec(&txn)
            .await?;
        txn.commit().await?;
        return Ok(Json(success_response(
            "删除明细表单成功",
            json!({ "deleted": true }),
        )));
    }
    // A source form owns all generated detail definitions. Remove their navigation entries
    // and schemas with the source so no orphaned logical forms remain.
    let detail_form_uuids = form_detail_definition_entity::Entity::find()
        .filter(form_detail_definition_entity::Column::SourceFormUuid.eq(form_uuid.clone()))
        .all(&txn)
        .await?
        .into_iter()
        .map(|item| item.detail_form_uuid)
        .collect::<Vec<_>>();
    if !detail_form_uuids.is_empty() {
        app_navigation_entity::Entity::delete_many()
            .filter(app_navigation_entity::Column::TargetFormUuid.is_in(detail_form_uuids.clone()))
            .exec(&txn)
            .await?;
        FormSchemaEntity::delete_many()
            .filter(form_schema_entity::Column::FormUuid.is_in(detail_form_uuids.clone()))
            .exec(&txn)
            .await?;
        FormDefinitionEntity::delete_many()
            .filter(form_definition_entity::Column::FormUuid.is_in(detail_form_uuids))
            .exec(&txn)
            .await?;
    }
    form_detail_definition_entity::Entity::delete_many()
        .filter(form_detail_definition_entity::Column::SourceFormUuid.eq(form_uuid.clone()))
        .exec(&txn)
        .await?;
    let record_repository = RecordRepository::new(&txn);
    let deleted_record_count = record_repository.delete_by_form(&form_uuid).await?;
    record_repository
        .decrement_app_records_count(
            &definition.app_route_app_id,
            deleted_record_count as i64,
            Utc::now(),
        )
        .await?;
    delete_storage_definition(&txn, &form_uuid).await?;

    FormSchemaEntity::delete_many()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&txn)
        .await?;

    form_view_entity::Entity::delete_many()
        .filter(form_view_entity::Column::FormUuid.eq(form_uuid.clone()))
        .exec(&txn)
        .await?;

    AppNavigationEntity::delete_many()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.clone())))
        .exec(&txn)
        .await?;

    let flow_ids = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(Some(form_uuid.clone())))
        .all(&txn)
        .await?
        .into_iter()
        .map(|flow| flow.id)
        .collect::<Vec<_>>();
    if !flow_ids.is_empty() {
        let run_ids = AutomationRunEntity::find()
            .filter(automation_run_entity::Column::FlowId.is_in(flow_ids.clone()))
            .all(&txn)
            .await?
            .into_iter()
            .map(|run| run.id)
            .collect::<Vec<_>>();
        if !run_ids.is_empty() {
            AutomationRunNodeEntity::delete_many()
                .filter(automation_run_node_entity::Column::RunId.is_in(run_ids))
                .exec(&txn)
                .await?;
        }
        AutomationRunEntity::delete_many()
            .filter(automation_run_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationFlowVersionEntity::delete_many()
            .filter(automation_flow_version_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationNodeEntity::delete_many()
            .filter(automation_node_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationEdgeEntity::delete_many()
            .filter(automation_edge_entity::Column::FlowId.is_in(flow_ids.clone()))
            .exec(&txn)
            .await?;
        AutomationFlowEntity::delete_many()
            .filter(automation_flow_entity::Column::Id.is_in(flow_ids))
            .exec(&txn)
            .await?;
    }

    FormDefinitionEntity::delete_many()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .exec(&txn)
        .await?;
    txn.commit().await?;

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
    Query(query): Query<ListFormRecordsQuery>,
) -> Result<Json<ApiResponse<ApiFormRecordList>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    if definition.form_type == "detail" {
        let detail = load_detail_definition(&state.db, &form_uuid).await?;
        let source_records = RecordRepository::new(&state.db)
            .list(&detail.source_form_uuid)
            .await?;
        let mut items = Vec::new();
        for source in source_records {
            for (row_index, row) in source
                .record_data
                .get(&detail.subform_field_id)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                items.push(ApiFormRecord {
                    id: detail_record_id(&source.record_uuid, row_index),
                    form_uuid: form_uuid.clone(),
                    schema_version: source.schema_version,
                    data: row.as_object().cloned().unwrap_or_default().into(),
                    created_by: source.created_by.clone(),
                    created_by_user_id: None,
                    created_by_avatar_url: None,
                    submitter_organization: None,
                    updated_by: source.updated_by.clone(),
                    created_at: source.created_at.to_rfc3339(),
                    updated_at: source.updated_at.to_rfc3339(),
                });
            }
        }
        let total = items.len() as i64;
        return Ok(Json(success_response(
            "获取明细数据成功",
            ApiFormRecordList {
                items,
                total,
                page: 1,
                page_size: total as u64,
            },
        )));
    }

    let repository = RecordRepository::new(&state.db);
    let (items, total, page, page_size) = match (query.page, query.page_size) {
        (None, None) => {
            let items = repository.list(&form_uuid).await?;
            let page_size = items.len() as u64;
            (items, page_size as i64, 1, page_size)
        }
        (page, page_size) => {
            let (page, page_size) = normalize_record_pagination(page, page_size);
            let (items, total) = repository.list_page(&form_uuid, page, page_size).await?;
            (items, total, page, page_size)
        }
    };

    let submitter_profiles = load_submitter_profiles(
        &state.db,
        items.iter().map(|record| record.created_by.as_str()),
    )
    .await?;

    Ok(Json(success_response(
        "获取表单数据成功",
        ApiFormRecordList {
            items: items
                .into_iter()
                .map(|record| form_record_response(record, &submitter_profiles))
                .collect(),
            total,
            page,
            page_size,
        },
    )))
}

fn normalize_record_pagination(page: Option<u64>, page_size: Option<u64>) -> (u64, u64) {
    (
        page.unwrap_or(1).max(1),
        page_size.unwrap_or(50).clamp(1, 100),
    )
}

async fn load_detail_definition(
    db: &DatabaseConnection,
    detail_form_uuid: &str,
) -> Result<form_detail_definition_entity::Model, AppError> {
    form_detail_definition_entity::Entity::find()
        .filter(
            form_detail_definition_entity::Column::DetailFormUuid.eq(detail_form_uuid.to_string()),
        )
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("detail form definition not found".to_string()))
}

fn detail_record_id(parent_record_uuid: &str, row_index: usize) -> String {
    format!("{parent_record_uuid}:{row_index}")
}

fn parse_detail_record_id(value: &str) -> Result<(String, usize), AppError> {
    let (parent, index) = value
        .rsplit_once(':')
        .ok_or_else(|| AppError::BadRequest("invalid detail record id".to_string()))?;
    Ok((
        parent.to_string(),
        index
            .parse()
            .map_err(|_| AppError::BadRequest("invalid detail row index".to_string()))?,
    ))
}

#[derive(Clone)]
struct SubmitterProfile {
    user_id: String,
    avatar_url: Option<String>,
    organization: Option<String>,
}

async fn load_submitter_profiles<'a>(
    db: &DatabaseConnection,
    names: impl IntoIterator<Item = &'a str>,
) -> Result<HashMap<String, SubmitterProfile>, AppError> {
    let names = names
        .into_iter()
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if names.is_empty() {
        return Ok(HashMap::new());
    }

    let users = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::DisplayName.is_in(names))
        .all(db)
        .await?;
    let organization_ids = users
        .iter()
        .filter_map(|user| user.primary_organization_unit_id)
        .collect::<Vec<_>>();
    let organization_names = organization_unit_entity::Entity::find()
        .filter(organization_unit_entity::Column::Id.is_in(organization_ids))
        .all(db)
        .await?
        .into_iter()
        .map(|unit| (unit.id, unit.name))
        .collect::<HashMap<_, _>>();

    Ok(users
        .into_iter()
        .map(|user| {
            let profile = SubmitterProfile {
                user_id: user.id.to_string(),
                avatar_url: user.avatar_url,
                organization: user
                    .primary_organization_unit_id
                    .and_then(|id| organization_names.get(&id).cloned()),
            };
            (user.display_name, profile)
        })
        .collect())
}

async fn submitter_profile(
    db: &DatabaseConnection,
    user: iam_user_entity::Model,
) -> Result<SubmitterProfile, AppError> {
    let organization = match user.primary_organization_unit_id {
        Some(id) => organization_unit_entity::Entity::find_by_id(id)
            .one(db)
            .await?
            .map(|unit| unit.name),
        None => None,
    };
    Ok(SubmitterProfile {
        user_id: user.id.to_string(),
        avatar_url: user.avatar_url,
        organization,
    })
}

fn form_record_response(
    record: StoredFormRecord,
    profiles: &HashMap<String, SubmitterProfile>,
) -> ApiFormRecord {
    let profile = profiles.get(&record.created_by);
    let mut response = ApiFormRecord::from(record);
    if let Some(profile) = profile {
        response.created_by_user_id = Some(profile.user_id.clone());
        response.created_by_avatar_url = profile.avatar_url.clone();
        response.submitter_organization = profile.organization.clone();
    }
    response
}

pub(crate) async fn create_form_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(form_uuid): Path<String>,
    Json(payload): Json<CreateFormRecordRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiFormRecord>>), AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    if definition.form_type == "detail" {
        let detail = load_detail_definition(&state.db, &form_uuid).await?;
        let parent_record_uuid = payload
            .data
            .get("__parentRecordUuid")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| {
                AppError::BadRequest("detail record requires __parentRecordUuid".to_string())
            })?;
        let repository = RecordRepository::new(&state.db);
        let parent = repository
            .find(&detail.source_form_uuid, &parent_record_uuid)
            .await?;
        let mut next = parent.record_data.clone();
        let values = next.as_object_mut().ok_or_else(|| {
            AppError::BadRequest("parent record data must be an object".to_string())
        })?;
        let mut row = normalize_record_payload(payload.data);
        row.as_object_mut()
            .map(|object| object.remove("__parentRecordUuid"));
        values
            .entry(detail.subform_field_id.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| AppError::BadRequest("subform data must be an array".to_string()))?
            .push(row.clone());
        let operator = authorization::current_user(&headers, &state)
            .await?
            .display_name;
        let row_index = values
            .get(&detail.subform_field_id)
            .and_then(Value::as_array)
            .map(|rows| rows.len() - 1)
            .unwrap_or(0);
        repository
            .update(&parent, next, &operator, Utc::now())
            .await?;
        return Ok((
            StatusCode::CREATED,
            Json(success_response(
                "新增明细数据成功",
                ApiFormRecord {
                    id: detail_record_id(&parent_record_uuid, row_index),
                    form_uuid,
                    schema_version: parent.schema_version,
                    data: row,
                    created_by: parent.created_by,
                    created_by_user_id: None,
                    created_by_avatar_url: None,
                    submitter_organization: None,
                    updated_by: operator,
                    created_at: parent.created_at.to_rfc3339(),
                    updated_at: Utc::now().to_rfc3339(),
                },
            )),
        ));
    }
    let now = Utc::now();
    let submitter = authorization::current_user(&headers, &state).await?;
    let operator = submitter.display_name.clone();
    let mut trigger_data = normalize_record_payload(payload.data);
    if definition.form_type == "workflow" {
        initialize_workflow_record(&mut trigger_data, &submitter.display_name);
    }

    automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_create",
        &trigger_data,
        &operator,
        None,
    )
    .await?;

    let record = RecordRepository::new(&state.db)
        .insert(&definition, trigger_data, &operator, now)
        .await?;

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
            form_record_response(
                record,
                &HashMap::from([(
                    submitter.display_name.clone(),
                    submitter_profile(&state.db, submitter).await?,
                )]),
            ),
        )),
    ))
}

pub(crate) async fn update_form_record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
    Json(payload): Json<UpdateFormRecordRequest>,
) -> Result<Json<ApiResponse<ApiFormRecord>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    if definition.form_type == "detail" {
        let detail = load_detail_definition(&state.db, &form_uuid).await?;
        let (parent_uuid, row_index) = parse_detail_record_id(&record_uuid)?;
        let repository = RecordRepository::new(&state.db);
        let parent = repository
            .find(&detail.source_form_uuid, &parent_uuid)
            .await?;
        let mut next = parent.record_data.clone();
        let row = next
            .get_mut(&detail.subform_field_id)
            .and_then(Value::as_array_mut)
            .and_then(|rows| rows.get_mut(row_index))
            .ok_or_else(|| AppError::NotFound("detail row not found".to_string()))?;
        *row = normalize_record_payload(payload.data.clone());
        let operator = authorization::current_user(&headers, &state)
            .await?
            .display_name;
        let updated = repository
            .update(&parent, next, &operator, Utc::now())
            .await?;
        return Ok(Json(success_response(
            "更新明细数据成功",
            ApiFormRecord {
                id: record_uuid,
                form_uuid,
                schema_version: updated.schema_version,
                data: normalize_record_payload(payload.data),
                created_by: updated.created_by,
                created_by_user_id: None,
                created_by_avatar_url: None,
                submitter_organization: None,
                updated_by: operator,
                created_at: updated.created_at.to_rfc3339(),
                updated_at: updated.updated_at.to_rfc3339(),
            },
        )));
    }
    let repository = RecordRepository::new(&state.db);
    let record = repository.find(&form_uuid, &record_uuid).await?;
    let operator = authorization::current_user(&headers, &state)
        .await?
        .display_name;
    let mut next_data = normalize_record_payload(payload.data);
    if definition.form_type == "workflow" {
        preserve_workflow_system_fields(&record.record_data, &mut next_data)?;
    }
    let changed_fields = collect_changed_fields(&record.record_data, &next_data);

    automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_update",
        &next_data,
        &operator,
        Some(&changed_fields),
    )
    .await?;

    let updated = repository
        .update(&record, next_data.clone(), &operator, Utc::now())
        .await?;

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
        form_record_response(
            updated,
            &load_submitter_profiles(&state.db, std::iter::once(record.created_by.as_str()))
                .await?,
        ),
    )))
}

fn initialize_workflow_record(data: &mut Value, submitter: &str) {
    let Some(values) = data.as_object_mut() else {
        return;
    };
    values.insert("workflowApprovalStatus".to_string(), json!("saved"));
    values.insert("workflowInstanceStatus".to_string(), json!("in_progress"));
    values.insert("workflowCurrentApprovalNode".to_string(), json!("待提交"));
    values.insert("workflowSubmitter".to_string(), json!(submitter));
}

fn preserve_workflow_system_fields(current: &Value, next: &mut Value) -> Result<(), AppError> {
    let Some(values) = next.as_object_mut() else {
        return Ok(());
    };
    for key in [
        "workflowApprovalStatus",
        "workflowInstanceStatus",
        "workflowCurrentApprovalNode",
        "workflowSubmitter",
    ] {
        if let Some(value) = current.get(key) {
            values.insert(key.to_string(), value.clone());
        }
    }
    Ok(())
}

pub(crate) async fn delete_form_record(
    State(state): State<AppState>,
    Path((form_uuid, record_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    if definition.form_type == "detail" {
        let detail = load_detail_definition(&state.db, &form_uuid).await?;
        let (parent_uuid, row_index) = parse_detail_record_id(&record_uuid)?;
        let repository = RecordRepository::new(&state.db);
        let parent = repository
            .find(&detail.source_form_uuid, &parent_uuid)
            .await?;
        let mut next = parent.record_data.clone();
        let rows = next
            .get_mut(&detail.subform_field_id)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| AppError::NotFound("detail row not found".to_string()))?;
        if row_index >= rows.len() {
            return Err(AppError::NotFound("detail row not found".to_string()));
        }
        rows.remove(row_index);
        repository
            .update(&parent, next, "管理员", Utc::now())
            .await?;
        return Ok(Json(success_response(
            "删除明细数据成功",
            json!({ "deleted": true, "recordId": record_uuid }),
        )));
    }
    let repository = RecordRepository::new(&state.db);
    let record = repository.find(&form_uuid, &record_uuid).await?;
    let operator = "管理员".to_string();

    automations::execute_automation_flows_for_event(
        &state.db,
        &definition,
        "before_delete",
        &record.record_data,
        &operator,
        None,
    )
    .await?;

    repository.delete(&record).await?;
    repository
        .decrement_app_records_count(&definition.app_route_app_id, 1, Utc::now())
        .await?;

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

    validate_schema_for_form_type(&definition.form_type, &payload.schema)?;

    let latest_schema =
        load_schema_version(&state.db, &form_uuid, definition.latest_schema_version).await?;
    if latest_schema.schema_json == payload.schema {
        return Ok(Json(success_response(
            "当前设计没有做有效变更，不进行保存。",
            build_schema_payload(&definition, latest_schema),
        )));
    }

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
    let txn = state.db.begin().await?;
    let definition = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid.clone()))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
    let now = Utc::now();
    let draft_version = definition.draft_schema_version;

    if let Some(current_published) = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid.clone()))
        .filter(form_schema_entity::Column::Published.eq(true))
        .one(&txn)
        .await?
    {
        let mut published_active: form_schema_entity::ActiveModel = current_published.into();
        published_active.published = Set(false);
        published_active.updated_at = Set(now.into());
        published_active.update(&txn).await?;
    }

    let draft_schema = load_schema_version_for_connection(&txn, &form_uuid, draft_version).await?;
    validate_schema_for_form_type(&definition.form_type, &draft_schema.schema_json)?;
    if definition.form_type != "detail" {
        sync_published_storage_plan(&txn, &form_uuid, draft_version, &draft_schema.schema_json)
            .await?;
    }
    let mut draft_active: form_schema_entity::ActiveModel = draft_schema.clone().into();
    draft_active.published = Set(true);
    draft_active.updated_at = Set(now.into());
    let published_schema = draft_active.update(&txn).await?;

    let mut definition_active: form_definition_entity::ActiveModel = definition.into();
    definition_active.published_schema_version = Set(draft_version);
    definition_active.updated_at = Set(now.into());
    let updated_definition = definition_active.update(&txn).await?;
    txn.commit().await?;

    Ok(Json(success_response(
        "发布表单版本成功",
        build_schema_payload(&updated_definition, published_schema),
    )))
}

pub(crate) async fn restore_form_version(
    State(state): State<AppState>,
    Path((form_uuid, version)): Path<(String, i32)>,
    _payload: Option<Json<RestoreVersionRequest>>,
) -> Result<Json<ApiResponse<ApiSchemaPayload>>, AppError> {
    let definition = find_form_definition(&state.db, &form_uuid).await?;
    let source_schema = load_schema_version(&state.db, &form_uuid, version).await?;

    Ok(Json(success_response(
        "读取历史版本 Schema 成功",
        build_schema_payload(&definition, source_schema),
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
        schema: if definition.form_type == "detail" {
            normalize_detail_schema(schema.schema_json)
        } else {
            schema.schema_json
        },
        version: schema.version,
        draft_version: definition.draft_schema_version,
        published_version: definition.published_schema_version,
        latest_version: definition.latest_schema_version,
        published: schema.published,
    }
}

/// Detail forms edit one child-record at a time, rather than rendering the source
/// subform's table. Preserve the source's row-first field order but make every
/// child control a full-width, independent form row.
fn normalize_detail_schema(mut schema: Value) -> Value {
    let Some(fields) = schema.get_mut("fields").and_then(Value::as_array_mut) else {
        return schema;
    };

    fields.sort_by(|left, right| {
        let left_row = left.get("row").and_then(Value::as_i64).unwrap_or(i64::MAX);
        let right_row = right.get("row").and_then(Value::as_i64).unwrap_or(i64::MAX);
        let left_column = left
            .get("column")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        let right_column = right
            .get("column")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        left_row
            .cmp(&right_row)
            .then_with(|| left_column.cmp(&right_column))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });

    for (row, field) in fields.iter_mut().enumerate() {
        if let Some(field) = field.as_object_mut() {
            field.remove("parentGroupId");
            field.insert("row".to_string(), Value::from(row));
            field.insert("column".to_string(), Value::from(0));
            field.insert("rowSpan".to_string(), Value::from(1));
            field.insert("colSpan".to_string(), Value::from(1));
        }
    }
    let row_count = fields.len().max(1);

    if let Some(schema) = schema.as_object_mut() {
        schema.insert("columns".to_string(), Value::from(1));
        schema.insert("rows".to_string(), Value::from(row_count));
    }
    schema
}
pub(crate) mod dto;

pub(crate) use dto::*;
