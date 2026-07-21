//! Navigation-domain API models.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infrastructure::entities::app_navigation_entity;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiNavigationItem {
    pub(crate) id: String,
    pub(crate) item_type: String,
    pub(crate) target_form_uuid: Option<String>,
    pub(crate) title: String,
    pub(crate) path_slug: String,
    pub(crate) sort_order: i32,
    pub(crate) is_default_entry: bool,
    pub(crate) parent_id: Option<String>,
    pub(crate) visibility_rule: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateNavigationGroupRequest {
    pub(crate) title: String,
    pub(crate) parent_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ReorderNavigationRequest {
    pub(crate) item_id: String,
    pub(crate) target_item_id: String,
    pub(crate) placement: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct SetDefaultNavigationEntryRequest {
    pub(crate) form_uuid: String,
}

impl From<app_navigation_entity::Model> for ApiNavigationItem {
    fn from(value: app_navigation_entity::Model) -> Self {
        Self {
            id: value.id.to_string(),
            item_type: value.item_type,
            target_form_uuid: value.target_form_uuid,
            title: value.title,
            path_slug: value.path_slug,
            sort_order: value.sort_order,
            is_default_entry: value.is_default_entry,
            parent_id: value.parent_id.map(|item| item.to_string()),
            visibility_rule: value.visibility_rule,
        }
    }
}
