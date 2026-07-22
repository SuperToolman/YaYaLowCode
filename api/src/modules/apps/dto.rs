//! Application-domain API request and response models.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infrastructure::entities::app_entity;
use crate::shared::format_date;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiApp {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) desc: String,
    pub(crate) icon: String,
    pub(crate) badge: Option<String>,
    pub(crate) color: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) owner: String,
    pub(crate) owner_avatar_url: Option<String>,
    pub(crate) records: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateAppRequest {
    pub(crate) name: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdateAppRequest {
    pub(crate) name: Option<String>,
    pub(crate) status: Option<String>,
}

impl From<app_entity::Model> for ApiApp {
    fn from(value: app_entity::Model) -> Self {
        Self {
            id: value.route_app_id,
            name: value.name,
            desc: value.description,
            icon: value.icon,
            badge: value.badge,
            color: value.color,
            status: value.status,
            created_at: format_date(value.created_at),
            owner: value.owner_name,
            owner_avatar_url: None,
            records: value.records_count,
        }
    }
}
