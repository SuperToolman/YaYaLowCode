use std::collections::{BTreeMap, HashMap};
use std::path::Path as FilePath;

use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infrastructure::entities::location_entity;
use crate::infrastructure::entities::location_entity::Entity as LocationEntity;
use crate::platform::authorization;
use crate::platform::prelude::*;
use crate::shared::success_response;
use sea_orm::{ExprTrait, QuerySelect, sea_query::Expr};

const DEFAULT_LIMIT: u64 = 100;
const MAX_LIMIT: u64 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocationsQuery {
    pub parent_code: Option<String>,
    pub depth: Option<i16>,
    pub query: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocationResponse {
    pub id: Uuid,
    pub code: String,
    pub parent_id: Option<Uuid>,
    pub depth: i16,
    pub kind: String,
    pub name: String,
    pub labels: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportLocationsRequest {
    pub locations: Vec<LocationImportItem>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocationImportItem {
    pub code: String,
    pub parent_code: Option<String>,
    pub kind: String,
    pub name: String,
    pub labels: BTreeMap<String, String>,
    pub source: Option<String>,
    pub source_id: Option<String>,
    pub sort_order: Option<i32>,
}

pub(crate) async fn list_locations(
    State(state): State<AppState>,
    Query(query): Query<ListLocationsQuery>,
) -> Result<Json<ApiResponse<Vec<LocationResponse>>>, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let mut select = LocationEntity::find();
    match query
        .parent_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(parent_code) => {
            let parent = LocationEntity::find()
                .filter(location_entity::Column::Code.eq(parent_code))
                .one(&state.db)
                .await?;
            let Some(parent) = parent else {
                return Ok(Json(success_response("获取地区目录成功", Vec::new())));
            };
            select = select.filter(location_entity::Column::ParentId.eq(parent.id))
        }
        None => select = select.filter(location_entity::Column::ParentId.is_null()),
    }
    if let Some(depth) = query.depth {
        if depth < 1 {
            return Err(AppError::BadRequest("invalid location depth".to_string()));
        }
        select = select.filter(location_entity::Column::Depth.eq(depth));
    }
    if let Some(search) = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(
            location_entity::Column::Name
                .contains(search)
                .or(location_entity::Column::Code.contains(search))
                .or(Expr::cust_with_values(
                    "CAST(labels AS TEXT) ILIKE $1",
                    [format!("%{search}%")],
                )),
        );
    }
    let items = select
        .order_by_asc(location_entity::Column::SortOrder)
        .order_by_asc(location_entity::Column::Name)
        .limit(limit)
        .all(&state.db)
        .await?
        .into_iter()
        .map(LocationResponse::from)
        .collect();
    Ok(Json(success_response("获取地区目录成功", items)))
}

pub(crate) async fn import_locations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ImportLocationsRequest>,
) -> Result<Json<ApiResponse<usize>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") && !grants.contains("apps.manage") {
        return Err(AppError::Forbidden(
            "location catalog import requires apps.manage".to_string(),
        ));
    }
    if payload.locations.len() > 10_000 {
        return Err(AppError::BadRequest(
            "location import batch exceeds 10000 items".to_string(),
        ));
    }

    let imported_count = payload.locations.len();
    let now = Utc::now();
    let transaction = state.db.begin().await?;
    for item in payload.locations {
        persist_location(&transaction, item, now).await?;
    }
    transaction.commit().await?;
    Ok(Json(success_response("导入地区目录成功", imported_count)))
}

pub(crate) async fn import_catalog_directory(
    db: &DatabaseConnection,
    directory: &FilePath,
) -> Result<usize, AppError> {
    ensure_location_catalog_schema(db).await?;
    let tree_path = directory.join("locations.json");
    if tokio::fs::try_exists(&tree_path).await.unwrap_or(false) {
        return import_tree_catalog(db, &tree_path).await;
    }
    Err(AppError::BadRequest(format!(
        "location catalog is missing {}. Generate and validate the tree catalog before importing.",
        tree_path.display()
    )))
}

async fn import_tree_catalog(db: &DatabaseConnection, path: &FilePath) -> Result<usize, AppError> {
    let contents = tokio::fs::read_to_string(path).await.map_err(|error| {
        AppError::BadRequest(format!("unable to read location tree catalog: {error}"))
    })?;
    let catalog: Vec<LocationImportItem> = serde_json::from_str(&contents).map_err(|error| {
        AppError::BadRequest(format!("invalid location tree catalog JSON: {error}"))
    })?;
    if catalog.len() > 500_000 {
        return Err(AppError::BadRequest(
            "location tree catalog is too large".to_string(),
        ));
    }
    let transaction = db.begin().await?;
    // A validated tree catalog is authoritative. Replacing it in one transaction
    // removes legacy flat rows and prevents stale nodes from surviving an import.
    LocationEntity::delete_many().exec(&transaction).await?;
    let now = Utc::now();
    let mut imported = 0;
    let mut inserted = HashMap::with_capacity(catalog.len());
    for item in catalog {
        let code = item.code.trim();
        let name = item.name.trim();
        let kind = item.kind.trim();
        if code.is_empty() || name.is_empty() || kind.is_empty() {
            return Err(AppError::BadRequest(
                "invalid location tree item".to_string(),
            ));
        }
        let parent = item
            .parent_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|parent_code| {
                inserted.get(parent_code).copied().ok_or_else(|| {
                    AppError::BadRequest(format!(
                        "location tree catalog has a missing or out-of-order parent: {parent_code}"
                    ))
                })
            })
            .transpose()?;
        let id = Uuid::new_v4();
        let depth = parent.map(|(_, depth)| depth + 1).unwrap_or(1);
        let labels = item
            .labels
            .into_iter()
            .filter_map(|(locale, label)| {
                let locale = locale.trim().to_string();
                let label = label.trim().to_string();
                (!locale.is_empty() && !label.is_empty()).then_some((locale, label))
            })
            .collect::<BTreeMap<_, _>>();
        let model = location_entity::ActiveModel {
            id: Set(id),
            code: Set(code.to_string()),
            parent_id: Set(parent.map(|(parent_id, _)| parent_id)),
            depth: Set(depth),
            kind: Set(kind.to_string()),
            name: Set(name.to_string()),
            labels: Set(serde_json::to_value(labels).unwrap_or_else(|_| json!({}))),
            source: Set(item.source.unwrap_or_else(|| "manual".to_string())),
            source_id: Set(item.source_id),
            sort_order: Set(item.sort_order.unwrap_or(0)),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        };
        model.insert(&transaction).await?;
        inserted.insert(code.to_string(), (id, depth));
        imported += 1;
    }
    transaction.commit().await?;
    Ok(imported)
}

pub(crate) async fn ensure_location_catalog_schema(
    db: &DatabaseConnection,
) -> Result<(), AppError> {
    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS locations (
            id UUID PRIMARY KEY,
            code VARCHAR(255) NOT NULL UNIQUE,
            parent_id UUID NULL REFERENCES locations(id) ON DELETE CASCADE,
            depth SMALLINT NOT NULL,
            kind VARCHAR(24) NOT NULL,
            name TEXT NOT NULL,
            labels JSONB NOT NULL DEFAULT '{}'::jsonb,
            source VARCHAR(64) NOT NULL DEFAULT 'manual',
            source_id VARCHAR(255) NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        );",
    )
    .await?;
    db.execute_unprepared("ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id UUID NULL")
        .await?;
    db.execute_unprepared("ALTER TABLE locations ADD COLUMN IF NOT EXISTS depth SMALLINT")
        .await?;
    db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_locations_parent_depth_sort ON locations (parent_id, depth, sort_order, name)").await?;
    Ok(())
}

/// Older installations may already have the original parent_code table while
/// its migration history has advanced. Add the new columns before migrations
/// so the conversion migration can be retried safely. Fresh databases are
/// left to the normal migration chain.
pub(crate) async fn prepare_legacy_location_catalog_schema(
    db: &DatabaseConnection,
) -> Result<(), AppError> {
    db.execute_unprepared(
        "DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'parent_code') THEN
             ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id UUID NULL;
             ALTER TABLE locations ADD COLUMN IF NOT EXISTS depth SMALLINT;
           END IF;
         END $$",
    )
    .await?;
    Ok(())
}

async fn persist_location<C: ConnectionTrait>(
    db: &C,
    item: LocationImportItem,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    let code = item.code.trim();
    let name = item.name.trim();
    let kind = item.kind.trim();
    if code.is_empty() || name.is_empty() || kind.is_empty() {
        return Err(AppError::BadRequest(
            "invalid location import item".to_string(),
        ));
    }
    let parent_code = item
        .parent_code
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let parent = match parent_code.as_deref() {
        Some(parent_code) => {
            LocationEntity::find()
                .filter(location_entity::Column::Code.eq(parent_code))
                .one(db)
                .await?
        }
        None => None,
    };
    if parent_code.is_some() && parent.is_none() {
        return Err(AppError::BadRequest(
            "location parent was not found".to_string(),
        ));
    }
    if parent
        .as_ref()
        .is_some_and(|location| location.code == code)
    {
        return Err(AppError::BadRequest(
            "location cannot be its own parent".to_string(),
        ));
    }
    let existing = LocationEntity::find()
        .filter(location_entity::Column::Code.eq(code))
        .one(db)
        .await?;
    if let Some(existing) = existing.as_ref() {
        if existing.parent_id != parent.as_ref().map(|location| location.id)
            && LocationEntity::find()
                .filter(location_entity::Column::ParentId.eq(existing.id))
                .one(db)
                .await?
                .is_some()
        {
            return Err(AppError::BadRequest(
                "cannot move a location that already has children".to_string(),
            ));
        }
    }
    // An update may move a node. Walk the proposed parent's ancestors so it
    // cannot be moved beneath one of its own descendants.
    if let (Some(existing), Some(parent)) = (existing.as_ref(), parent.as_ref()) {
        let mut ancestor = Some(parent.clone());
        while let Some(current) = ancestor {
            if current.id == existing.id {
                return Err(AppError::BadRequest(
                    "location parent would create a cycle".to_string(),
                ));
            }
            ancestor = match current.parent_id {
                Some(parent_id) => {
                    LocationEntity::find()
                        .filter(location_entity::Column::Id.eq(parent_id))
                        .one(db)
                        .await?
                }
                None => None,
            };
        }
    }
    let depth = parent
        .as_ref()
        .map(|location| location.depth + 1)
        .unwrap_or(1);
    let labels = item
        .labels
        .into_iter()
        .filter_map(|(locale, label)| {
            let locale = locale.trim().to_string();
            let label = label.trim().to_string();
            (!locale.is_empty() && !label.is_empty()).then_some((locale, label))
        })
        .collect::<BTreeMap<_, _>>();
    let model = location_entity::ActiveModel {
        id: Set(existing
            .as_ref()
            .map(|row| row.id)
            .unwrap_or_else(Uuid::new_v4)),
        code: Set(code.to_string()),
        parent_id: Set(parent.as_ref().map(|location| location.id)),
        depth: Set(depth),
        kind: Set(kind.to_string()),
        name: Set(name.to_string()),
        labels: Set(serde_json::to_value(labels).unwrap_or_else(|_| json!({}))),
        source: Set(item.source.unwrap_or_else(|| "manual".to_string())),
        source_id: Set(item.source_id),
        sort_order: Set(item.sort_order.unwrap_or(0)),
        created_at: Set(existing
            .as_ref()
            .map(|row| row.created_at)
            .unwrap_or(now)
            .into()),
        updated_at: Set(now.into()),
    };
    if existing.is_some() {
        model.update(db).await?;
    } else {
        model.insert(db).await?;
    }
    Ok(())
}

impl From<location_entity::Model> for LocationResponse {
    fn from(value: location_entity::Model) -> Self {
        Self {
            id: value.id,
            code: value.code,
            parent_id: value.parent_id,
            depth: value.depth,
            kind: value.kind,
            name: value.name,
            labels: serde_json::from_value(value.labels).unwrap_or_default(),
        }
    }
}
