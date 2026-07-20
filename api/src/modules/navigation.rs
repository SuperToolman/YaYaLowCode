use crate::platform::prelude::*;
use crate::shared::*;
use axum::http::StatusCode;

pub(crate) async fn list_navigation_items(
    State(state): State<AppState>,
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

    Ok(Json(success_response(
        "获取导航成功",
        items.into_iter().map(ApiNavigationItem::from).collect(),
    )))
}

pub(crate) async fn create_navigation_group(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(payload): Json<CreateNavigationGroupRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ApiNavigationItem>>), AppError> {
    ensure_system_navigation_for_app(&state.db, &app_id).await?;
    let now = Utc::now();
    let title = payload.title.trim();

    if title.is_empty() {
        return Err(AppError::NotFound("group title required".to_string()));
    }

    let parent_uuid =
        resolve_group_parent_id(&state.db, &app_id, payload.parent_id.as_deref()).await?;
    let sort_order = next_navigation_sort_order(&state.db, &app_id, parent_uuid).await?;
    let group_slug = build_group_slug(title);

    let created = app_navigation_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app_id.clone()),
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
    .insert(&state.db)
    .await?;

    normalize_navigation_orders(&state.db, &app_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "创建分组成功",
            ApiNavigationItem::from(created),
        )),
    ))
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
            active_model.is_default_entry = Set(*is_default_entry);
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
mod dto;

use dto::*;
