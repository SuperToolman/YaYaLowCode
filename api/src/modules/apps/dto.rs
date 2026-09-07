//! Application-domain API request and response models.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infrastructure::entities::app_entity;
use crate::platform::config::ApplicationBusinessContext;
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
    pub(crate) created_at: String,
    pub(crate) owner: String,
    pub(crate) owner_avatar_url: Option<String>,
    pub(crate) records: i64,
    pub(crate) deployment_type: String,
    pub(crate) online_version: Option<String>,
    pub(crate) online_release_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateAppRequest {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) icon: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdateAppRequest {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) icon: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateApplicationBusinessContextRequest {
    pub(crate) business_overview: String,
    pub(crate) terminology: String,
    pub(crate) process_description: String,
    pub(crate) analysis_guidance: String,
}

impl From<UpdateApplicationBusinessContextRequest> for ApplicationBusinessContext {
    fn from(value: UpdateApplicationBusinessContextRequest) -> Self {
        Self {
            business_overview: value.business_overview,
            terminology: value.terminology,
            process_description: value.process_description,
            analysis_guidance: value.analysis_guidance,
        }
    }
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
            created_at: format_date(value.created_at),
            owner: value.owner_name,
            owner_avatar_url: None,
            records: value.records_count,
            deployment_type: value.deployment_type,
            online_version: value.online_version,
            online_release_id: value.online_release_id,
        }
    }
}
