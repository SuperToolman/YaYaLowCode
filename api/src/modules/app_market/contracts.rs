//! HTTP wire contracts. Marketplace snapshots and event details remain dynamic JSON.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketResourceSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automations: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigation: Option<u64>,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, Value>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketProduct {
    pub product_id: String,
    #[serde(default)]
    pub commercial_ready: bool,
    #[serde(default)]
    pub owned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commercial_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_order_id: Option<String>,
    pub publisher_subject: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub release_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher_owned: Option<bool>,
    pub resource_summary: Option<MarketResourceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<MarketMember>>,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, Value>,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallPreflight {
    pub product_id: String,
    pub release_id: String,
    pub version: Option<String>,
    pub resource_summary: Option<MarketResourceSummary>,
    pub already_installed: bool,
    pub blocking_issues: Vec<String>,
    pub connector_binding_required: bool,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallResponse {
    pub installation_id: String,
    pub member_app_ids: Vec<String>,
    pub release_id: String,
    pub disabled_automations: usize,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallationVersion {
    pub release_id: String,
    pub version: String,
    pub applied_at: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallationEvent {
    pub event_type: String,
    pub detail: Value,
    pub created_at: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallation {
    pub installation_id: String,
    pub product_id: String,
    pub release_id: String,
    pub member_app_ids: Vec<String>,
    pub status: String,
    pub installed_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub versions: Vec<MarketInstallationVersion>,
    pub events: Vec<MarketInstallationEvent>,
    pub members: Vec<Value>,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketUpgradePreflight {
    pub installation_id: String,
    pub current_release_id: String,
    pub target_release_id: String,
    pub target_version: Option<String>,
    pub up_to_date: bool,
    pub blocking_issues: Vec<String>,
    pub can_upgrade: bool,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketInstallationStatus {
    pub installation_id: String,
    pub status: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketReleaseResponse {
    pub installation_id: String,
    pub release_id: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketPurgeResponse {
    pub installation_id: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub(crate) struct MarketSyncResponse {
    pub updated: usize,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketRollbackRequest {
    pub release_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalogue_round_trip_preserves_extensions_and_omitted_fields() {
        let value = serde_json::json!({"commercialReady":false,"owned":false,"productId":"product","publisherSubject":"publisher","name":"name","description":"description","version":"1.0.0","releaseId":"release","status":"listed","resourceSummary":{"forms":2,"futureCount":3},"futureFlag":true});
        let product: MarketProduct = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(product).unwrap(), value);
    }
    #[test]
    fn rollback_request_uses_the_existing_camel_case_field() {
        let request: MarketRollbackRequest =
            serde_json::from_value(serde_json::json!({"releaseId":"release"})).unwrap();
        assert_eq!(request.release_id.as_deref(), Some("release"));
    }
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketMember {
    pub app_id: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplicationOrderSnapshot {
    pub name: String,
    pub description: String,
    pub pricing_mode: String,
    pub price_cents: i64,
    pub currency: String,
    pub license_model: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplicationOrder {
    pub order_id: String,
    pub order_no: String,
    pub subject: String,
    pub product_id: String,
    pub status: String,
    pub amount_cents: i64,
    pub simulation: bool,
    pub owned: bool,
    pub snapshot: ApplicationOrderSnapshot,
    pub release_id: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplicationRevenue {
    pub id: String,
    pub order_id: String,
    pub product_id: String,
    pub publisher_subject: String,
    pub amount_cents: i64,
    pub platform_cents: i64,
    pub gross_cents: i64,
    pub rate_basis_points: i64,
    pub status: String,
    pub settlement_id: Option<String>,
    pub simulation: bool,
}
