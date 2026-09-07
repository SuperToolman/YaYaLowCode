use crate::platform::authorization;
use crate::platform::prelude::*;
use crate::shared::*;
use axum::http::{HeaderMap, StatusCode};

pub(crate) async fn list_navigation_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiNavigationItem>>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    let grants = authorization::grants(&headers, &state).await?;
    let visible_items = filter_navigation_items_by_grants(items, &grants);

    Ok(Json(success_response(
        "获取导航成功",
        visible_items
            .into_iter()
            .map(ApiNavigationItem::from)
            .collect(),
    )))
}

/// Navigation is a discovery surface, so a form must not be returned unless the
/// current user may display it. Keep groups only when they contain a visible item.
fn filter_navigation_items_by_grants(
    items: Vec<app_navigation_entity::Model>,
    grants: &HashSet<String>,
) -> Vec<app_navigation_entity::Model> {
    if grants.contains("*") {
        return items;
    }

    let mut visible_ids = items
        .iter()
        .filter(|item| match item.item_type.as_str() {
            "form" => item
                .target_form_uuid
                .as_ref()
                .is_some_and(|form_uuid| grants.contains(&format!("form:{form_uuid}:display"))),
            "group" => false,
            _ => true,
        })
        .map(|item| item.id)
        .collect::<HashSet<_>>();

    // Groups can be nested. Repeatedly retain a parent once it has a visible child.
    loop {
        let added = items
            .iter()
            .filter(|item| {
                item.item_type == "group"
                    && !visible_ids.contains(&item.id)
                    && items.iter().any(|child| {
                        child.parent_id == Some(item.id) && visible_ids.contains(&child.id)
                    })
            })
            .map(|item| item.id)
            .collect::<Vec<_>>();
        if added.is_empty() {
            break;
        }
        visible_ids.extend(added);
    }

    items
        .into_iter()
        .filter(|item| visible_ids.contains(&item.id))
        .collect()
}

pub(crate) async fn create_navigation_group(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<CreateNavigationGroupRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiNavigationItem>>), AppError> {
    let created = create_navigation_group_definition(&state.db, &app_id, payload).await?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建分组成功",
            ApiNavigationItem::from(created),
        )),
    ))
}

pub(crate) async fn create_navigation_group_definition(
    db: &DatabaseConnection,
    app_id: &str,
    payload: CreateNavigationGroupRequest,
) -> Result<app_navigation_entity::Model, AppError> {
    ensure_system_navigation_for_app(db, app_id).await?;
    let now = Utc::now();
    let title = payload.title.trim();

    if title.is_empty() {
        return Err(AppError::NotFound("group title required".to_string()));
    }

    let parent_uuid = resolve_group_parent_id(db, app_id, payload.parent_id.as_deref()).await?;
    if let Some(existing) = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(app_navigation_entity::Column::ItemType.eq("group"))
        .filter(app_navigation_entity::Column::ParentId.eq(parent_uuid))
        .filter(app_navigation_entity::Column::Title.eq(title.to_string()))
        .one(db)
        .await?
    {
        return Ok(existing);
    }
    let sort_order = next_navigation_sort_order(db, app_id, parent_uuid).await?;
    let group_slug = build_group_slug(title);

    let created = app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id.to_string()),
        item_type: Set("group".to_string()),
        target_form_uuid: Set(None),
        title: Set(title.to_string()),
        path_slug: Set(group_slug),
        sort_order: Set(sort_order),
        is_default_entry: Set(false),
        parent_id: Set(parent_uuid),
        visibility_rule: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(db)
    .await?;

    normalize_navigation_orders(db, app_id).await?;
    Ok(created)
}

pub(crate) async fn update_navigation_group(
    State(state): State<AppState>,
    Path((app_id, group_id)): Path<(String, String)>,
    Json(payload): Json<UpdateNavigationGroupRequest>,
) -> Result<Json<ApiResponse<ApiNavigationItem>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    let group_uuid = Uuid::parse_str(group_id.trim())
        .map_err(|_| AppError::NotFound("navigation group not found".to_string()))?;
    let group = AppNavigationEntity::find_by_id(group_uuid)
        .one(&state.db)
        .await?
        .filter(|item| item.app_route_app_id == app_id && item.item_type == "group")
        .ok_or_else(|| AppError::NotFound("navigation group not found".to_string()))?;
    let title = payload.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("group title required".to_string()));
    }
    let parent_id =
        resolve_group_parent_id(&state.db, &app_id, payload.parent_id.as_deref()).await?;
    if parent_id == Some(group.id) {
        return Err(AppError::BadRequest(
            "group cannot be its own parent".to_string(),
        ));
    }
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
        .all(&state.db)
        .await?;
    if parent_id.is_some_and(|id| collect_navigation_descendants(&items, group.id).contains(&id)) {
        return Err(AppError::BadRequest(
            "group cannot be moved into its descendant".to_string(),
        ));
    }
    let parent_changed = group.parent_id != parent_id;
    let sort_order = if parent_changed {
        next_navigation_sort_order(&state.db, &app_id, parent_id).await?
    } else {
        group.sort_order
    };
    let mut active: app_navigation_entity::ActiveModel = group.into();
    active.title = Set(title.to_string());
    active.path_slug = Set(build_group_slug(title));
    active.parent_id = Set(parent_id);
    active.sort_order = Set(sort_order);
    active.updated_at = Set(Utc::now().into());
    let updated = active.update(&state.db).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;
    Ok(Json(success_response(
        "更新分组成功",
        ApiNavigationItem::from(updated),
    )))
}

pub(crate) async fn delete_navigation_group(
    State(state): State<AppState>,
    Path((app_id, group_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<DeleteNavigationGroupResponse>>, AppError> {
    let result = delete_navigation_group_definition(&state.db, &app_id, &group_id).await?;
    Ok(Json(success_response("删除分组成功", result)))
}

pub(crate) async fn delete_navigation_group_definition(
    db: &DatabaseConnection,
    app_id: &str,
    group_id: &str,
) -> Result<DeleteNavigationGroupResponse, AppError> {
    ensure_system_navigation_for_app(db, app_id).await?;
    let group_uuid = Uuid::parse_str(group_id.trim())
        .map_err(|_| AppError::NotFound("navigation group not found".to_string()))?;
    let group = AppNavigationEntity::find_by_id(group_uuid)
        .one(db)
        .await?
        .filter(|item| item.app_route_app_id == app_id && item.item_type == "group")
        .ok_or_else(|| AppError::NotFound("navigation group not found".to_string()))?;
    let children = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(app_navigation_entity::Column::ParentId.eq(Some(group.id)))
        .all(db)
        .await?;
    let reparented_items = children.len();
    for child in children {
        let mut active: app_navigation_entity::ActiveModel = child.into();
        active.parent_id = Set(group.parent_id);
        active.updated_at = Set(Utc::now().into());
        active.update(db).await?;
    }
    let title = group.title.clone();
    group.delete(db).await?;
    normalize_navigation_orders(db, app_id).await?;
    Ok(DeleteNavigationGroupResponse {
        id: group_id.to_string(),
        title,
        reparented_items,
    })
}

pub(crate) async fn reorder_navigation_item(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<ReorderNavigationRequest>,
) -> Result<Json<ApiResponse<Vec<ApiNavigationItem>>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    apply_navigation_reorder(&state.db, &app_id, &payload).await?;
    normalize_navigation_orders(&state.db, &app_id).await?;

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(success_response(
        "更新导航顺序成功",
        items.into_iter().map(ApiNavigationItem::from).collect(),
    )))
}

pub(crate) async fn move_form_navigation(
    State(state): State<AppState>,
    Path((app_id, form_uuid)): Path<(String, String)>,
    Json(payload): Json<MoveFormNavigationRequest>,
) -> Result<Json<ApiResponse<ApiNavigationItem>>, AppError> {
    move_form_navigation_to_group(
        &state.db,
        &app_id,
        &form_uuid,
        payload.parent_group_id.as_deref(),
    )
    .await?;
    let item = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .filter(app_navigation_entity::Column::ItemType.eq("form"))
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid)))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("form navigation item not found".to_string()))?;
    Ok(Json(success_response(
        "移动表单成功",
        ApiNavigationItem::from(item),
    )))
}

pub(crate) async fn set_default_navigation_entry(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<SetDefaultNavigationEntryRequest>,
) -> Result<Json<ApiResponse<ApiNavigationItem>>, AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    let form_uuid = payload
        .form_uuid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let system_page_slug = payload
        .system_page_slug
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let target = match (form_uuid, system_page_slug) {
        (Some(_), Some(_)) => {
            return Err(AppError::NotFound(
                "only one default navigation target may be specified".to_string(),
            ));
        }
        (Some(form_uuid), None) => AppNavigationEntity::find()
            .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .filter(app_navigation_entity::Column::ItemType.eq("form"))
            .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.to_string())))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("form navigation item not found".to_string()))?,
        (None, Some(system_page_slug)) => AppNavigationEntity::find()
            .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .filter(app_navigation_entity::Column::ItemType.eq("system"))
            .filter(app_navigation_entity::Column::PathSlug.eq(system_page_slug))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("system navigation item not found".to_string()))?,
        (None, None) => AppNavigationEntity::find()
            .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .filter(app_navigation_entity::Column::ItemType.eq("system"))
            .filter(app_navigation_entity::Column::PathSlug.eq("todo"))
            .one(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound("system todo navigation item not found".to_string())
            })?,
    };

    let now = Utc::now();
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id))
        .all(&state.db)
        .await?;

    for item in items {
        let should_be_default = item.id == target.id;
        if item.is_default_entry != should_be_default {
            let mut active_model: app_navigation_entity::ActiveModel = item.into();
            active_model.is_default_entry = Set(should_be_default);
            active_model.updated_at = Set(now.into());
            active_model.update(&state.db).await?;
        }
    }

    let mut updated_target: app_navigation_entity::ActiveModel = target.into();
    updated_target.is_default_entry = Set(true);
    updated_target.updated_at = Set(now.into());
    let updated = updated_target.update(&state.db).await?;

    Ok(Json(success_response(
        "更新默认入口成功",
        ApiNavigationItem::from(updated),
    )))
}

pub(crate) async fn sync_navigation_title(
    db: &DatabaseConnection,
    form_uuid: &str,
    name: &str,
    slug: &str,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if let Some(navigation_item) = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.to_string())))
        .one(db)
        .await?
    {
        let mut navigation_active: app_navigation_entity::ActiveModel = navigation_item.into();
        navigation_active.title = Set(name.to_string());
        navigation_active.path_slug = Set(slug.to_string());
        navigation_active.updated_at = Set(now.into());
        navigation_active.update(db).await?;
    }

    Ok(())
}

const SYSTEM_NAV_ITEMS: [(&str, &str, bool); 4] = [
    ("todo", "待我处理", true),
    ("processed", "我处理的", false),
    ("created", "我创建的", false),
    ("copied", "抄送我的", false),
];

pub(crate) async fn ensure_system_navigation_items(
    db: &DatabaseConnection,
) -> Result<(), AppError> {
    let apps = AppEntity::find().all(db).await?;

    for app in apps {
        ensure_system_navigation_for_app(db, &app.route_app_id).await?;
    }

    Ok(())
}

pub(crate) async fn ensure_system_navigation_for_app(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    let now = Utc::now();

    for (index, (slug, title, is_default_entry)) in SYSTEM_NAV_ITEMS.iter().enumerate() {
        let existing = AppNavigationEntity::find()
            .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
            .filter(app_navigation_entity::Column::PathSlug.eq((*slug).to_string()))
            .one(db)
            .await?;

        if let Some(item) = existing {
            let mut active_model: app_navigation_entity::ActiveModel = item.into();
            active_model.item_type = Set("system".to_string());
            active_model.title = Set((*title).to_string());
            active_model.sort_order = Set(index as i32);
            active_model.updated_at = Set(now.into());
            active_model.update(db).await?;
            continue;
        }

        app_navigation_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            app_route_app_id: Set(app_id.to_string()),
            item_type: Set("system".to_string()),
            target_form_uuid: Set(None),
            title: Set((*title).to_string()),
            path_slug: Set((*slug).to_string()),
            sort_order: Set(index as i32),
            is_default_entry: Set(*is_default_entry),
            parent_id: Set(None),
            visibility_rule: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(db)
        .await?;
    }

    Ok(())
}

pub(crate) async fn resolve_group_parent_id(
    db: &DatabaseConnection,
    app_id: &str,
    parent_id: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    let Some(parent_id) = parent_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let parent_uuid = Uuid::parse_str(parent_id)
        .map_err(|_| AppError::NotFound("parent group not found".to_string()))?;
    let parent_item = AppNavigationEntity::find_by_id(parent_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("parent group not found".to_string()))?;

    if parent_item.app_route_app_id != app_id || parent_item.item_type != "group" {
        return Err(AppError::NotFound("parent group not found".to_string()));
    }

    Ok(Some(parent_uuid))
}

pub(crate) async fn next_navigation_sort_order(
    db: &DatabaseConnection,
    app_id: &str,
    parent_id: Option<Uuid>,
) -> Result<i32, AppError> {
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(app_navigation_entity::Column::ParentId.eq(parent_id))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .all(db)
        .await?;

    if parent_id.is_none() {
        let non_system_count = items
            .into_iter()
            .filter(|item| item.item_type != "system")
            .count() as i32;
        return Ok(ROOT_NON_SYSTEM_SORT_BASE + non_system_count);
    }

    Ok(items.len() as i32)
}

const ROOT_NON_SYSTEM_SORT_BASE: i32 = 100;

pub(crate) async fn normalize_navigation_orders(
    db: &DatabaseConnection,
    app_id: &str,
) -> Result<(), AppError> {
    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .order_by_asc(app_navigation_entity::Column::CreatedAt)
        .all(db)
        .await?;
    let now = Utc::now();

    let system_order = SYSTEM_NAV_ITEMS
        .iter()
        .enumerate()
        .map(|(index, (slug, _, _))| ((*slug).to_string(), index as i32))
        .collect::<std::collections::HashMap<_, _>>();

    let mut grouped_children =
        std::collections::HashMap::<Option<Uuid>, Vec<app_navigation_entity::Model>>::new();
    for item in items {
        grouped_children
            .entry(item.parent_id)
            .or_default()
            .push(item);
    }

    if let Some(root_items) = grouped_children.get_mut(&None) {
        root_items.sort_by_key(|item| {
            if item.item_type == "system" {
                (0, *system_order.get(&item.path_slug).unwrap_or(&i32::MAX))
            } else {
                (1, item.sort_order)
            }
        });

        let mut non_system_index = 0;
        for item in root_items.iter() {
            let next_sort = if item.item_type == "system" {
                *system_order.get(&item.path_slug).unwrap_or(&0)
            } else {
                let current = ROOT_NON_SYSTEM_SORT_BASE + non_system_index;
                non_system_index += 1;
                current
            };

            if item.sort_order != next_sort
                || (item.item_type == "system" && item.parent_id.is_some())
            {
                let mut active_model: app_navigation_entity::ActiveModel = item.clone().into();
                active_model.sort_order = Set(next_sort);
                active_model.parent_id = Set(None);
                active_model.updated_at = Set(now.into());
                active_model.update(db).await?;
            }
        }
    }

    normalize_child_orders_recursive(db, &grouped_children, None, now).await
}

pub(crate) async fn normalize_child_orders_recursive(
    db: &DatabaseConnection,
    grouped_children: &std::collections::HashMap<Option<Uuid>, Vec<app_navigation_entity::Model>>,
    parent_id: Option<Uuid>,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if let Some(parent_uuid) = parent_id
        && let Some(children) = grouped_children.get(&Some(parent_uuid))
    {
        for (index, item) in children.iter().enumerate() {
            if item.sort_order != index as i32 {
                let mut active_model: app_navigation_entity::ActiveModel = item.clone().into();
                active_model.sort_order = Set(index as i32);
                active_model.updated_at = Set(now.into());
                active_model.update(db).await?;
            }

            if item.item_type == "group" {
                Box::pin(normalize_child_orders_recursive(
                    db,
                    grouped_children,
                    Some(item.id),
                    now,
                ))
                .await?;
            }
        }
    }

    if parent_id.is_none() {
        for items in grouped_children.values() {
            for item in items {
                if item.parent_id.is_some() && item.item_type == "group" {
                    Box::pin(normalize_child_orders_recursive(
                        db,
                        grouped_children,
                        Some(item.id),
                        now,
                    ))
                    .await?;
                }
            }
        }
    }

    Ok(())
}

pub(crate) async fn apply_navigation_reorder(
    db: &DatabaseConnection,
    app_id: &str,
    payload: &ReorderNavigationRequest,
) -> Result<(), AppError> {
    let item_uuid = Uuid::parse_str(payload.item_id.trim())
        .map_err(|_| AppError::NotFound("navigation item not found".to_string()))?;
    let target_uuid = Uuid::parse_str(payload.target_item_id.trim())
        .map_err(|_| AppError::NotFound("navigation item not found".to_string()))?;
    let item = AppNavigationEntity::find_by_id(item_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("navigation item not found".to_string()))?;
    let target = AppNavigationEntity::find_by_id(target_uuid)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("navigation item not found".to_string()))?;

    if item.app_route_app_id != app_id || target.app_route_app_id != app_id {
        return Err(AppError::NotFound("navigation item not found".to_string()));
    }

    if item.id == target.id {
        return Err(AppError::NotFound(
            "cannot move navigation item onto itself".to_string(),
        ));
    }

    if item.item_type == "system" {
        return Ok(());
    }

    if payload.placement == "inside" && target.item_type != "group" {
        return Err(AppError::NotFound("target group not found".to_string()));
    }

    let items = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .order_by_asc(app_navigation_entity::Column::SortOrder)
        .all(db)
        .await?;

    let descendants = collect_navigation_descendants(&items, item.id);
    if descendants.contains(&target.id) {
        return Err(AppError::NotFound(
            "cannot move item into descendant".to_string(),
        ));
    }

    let destination_parent = match payload.placement.as_str() {
        "inside" => Some(target.id),
        "before" | "after" => target.parent_id,
        _ => return Err(AppError::NotFound("invalid placement".to_string())),
    };

    let mut destination_siblings = items
        .iter()
        .filter(|candidate| candidate.parent_id == destination_parent)
        .filter(|candidate| candidate.id != item.id)
        .filter(|candidate| !(destination_parent.is_none() && candidate.item_type == "system"))
        .cloned()
        .collect::<Vec<_>>();
    destination_siblings.sort_by_key(|candidate| candidate.sort_order);

    let insertion_index = match payload.placement.as_str() {
        "inside" => destination_siblings.len(),
        "before" => destination_siblings
            .iter()
            .position(|candidate| candidate.id == target.id)
            .unwrap_or(destination_siblings.len()),
        "after" => destination_siblings
            .iter()
            .position(|candidate| candidate.id == target.id)
            .map(|index| index + 1)
            .unwrap_or(destination_siblings.len()),
        _ => destination_siblings.len(),
    };

    let now = Utc::now();
    let mut reordered_siblings = destination_siblings;
    let mut moved_item = item.clone();
    moved_item.parent_id = destination_parent;
    reordered_siblings.insert(insertion_index, moved_item);

    for (index, sibling) in reordered_siblings.into_iter().enumerate() {
        let next_sort_order = if destination_parent.is_none() {
            ROOT_NON_SYSTEM_SORT_BASE + index as i32
        } else {
            index as i32
        };

        if sibling.parent_id != destination_parent || sibling.sort_order != next_sort_order {
            let mut active_model: app_navigation_entity::ActiveModel = sibling.into();
            active_model.parent_id = Set(destination_parent);
            active_model.sort_order = Set(next_sort_order);
            active_model.updated_at = Set(now.into());
            active_model.update(db).await?;
        }
    }

    Ok(())
}

pub(crate) async fn move_form_navigation_to_group(
    db: &DatabaseConnection,
    app_id: &str,
    form_uuid: &str,
    parent_id: Option<&str>,
) -> Result<(), AppError> {
    let parent_uuid = resolve_group_parent_id(db, app_id, parent_id).await?;
    let item = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(app_id.to_string()))
        .filter(app_navigation_entity::Column::ItemType.eq("form"))
        .filter(app_navigation_entity::Column::TargetFormUuid.eq(Some(form_uuid.to_string())))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("form navigation item not found".to_string()))?;
    if item.parent_id == parent_uuid {
        return Ok(());
    }
    let sort_order = next_navigation_sort_order(db, app_id, parent_uuid).await?;
    let mut active: app_navigation_entity::ActiveModel = item.into();
    active.parent_id = Set(parent_uuid);
    active.sort_order = Set(sort_order);
    active.updated_at = Set(Utc::now().into());
    active.update(db).await?;
    normalize_navigation_orders(db, app_id).await
}

pub(crate) fn collect_navigation_descendants(
    items: &[app_navigation_entity::Model],
    root_id: Uuid,
) -> std::collections::HashSet<Uuid> {
    let mut result = std::collections::HashSet::new();
    let mut stack = vec![root_id];

    while let Some(current_id) = stack.pop() {
        for item in items
            .iter()
            .filter(|item| item.parent_id == Some(current_id))
        {
            if result.insert(item.id) {
                stack.push(item.id);
            }
        }
    }

    result
}
pub(crate) mod dto;

pub(crate) use dto::*;
