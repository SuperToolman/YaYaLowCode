use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::modules::{apps, automations, forms, navigation, settings};
use crate::platform::runtime::AppState;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

pub(crate) fn build(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health_check))
        .route(
            "/api/settings/database",
            get(settings::get_database_settings).put(settings::update_database_settings),
        )
        .route("/api/apps", get(apps::list_apps).post(apps::create_app))
        .route(
            "/api/apps/{app_id}",
            patch(apps::update_app).delete(apps::delete_app),
        )
        .route(
            "/api/apps/{app_id}/navigation",
            get(navigation::list_navigation_items).patch(navigation::reorder_navigation_item),
        )
        .route(
            "/api/apps/{app_id}/navigation/groups",
            post(navigation::create_navigation_group),
        )
        .route(
            "/api/apps/{app_id}/forms",
            get(forms::list_forms).post(forms::create_form),
        )
        .route(
            "/api/apps/{app_id}/automations",
            get(automations::list_automation_flows).post(automations::create_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}",
            get(automations::get_automation_flow)
                .patch(automations::update_automation_flow)
                .delete(automations::delete_automation_flow),
        )
        .route(
            "/api/automations/{flow_uuid}/versions",
            get(automations::list_automation_flow_versions),
        )
        .route(
            "/api/automations/{flow_uuid}/versions/{version}/restore",
            post(automations::restore_automation_flow_version),
        )
        .route(
            "/api/automations/{flow_uuid}/runs",
            get(automations::list_automation_flow_runs),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/retry",
            post(automations::retry_automation_flow_run),
        )
        .route(
            "/api/automations/{flow_uuid}/runs/{run_uuid}/nodes/{node_key}/retry",
            post(automations::retry_automation_flow_run_node),
        )
        .route("/api/forms/{form_uuid}/schema", get(forms::get_form_schema))
        .route(
            "/api/forms/{form_uuid}/records",
            get(forms::list_form_records).post(forms::create_form_record),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}",
            patch(forms::update_form_record).delete(forms::delete_form_record),
        )
        .route(
            "/api/forms/{form_uuid}/versions",
            get(forms::list_form_versions),
        )
        .route(
            "/api/forms/{form_uuid}/versions/{version}",
            get(forms::get_form_version),
        )
        .route(
            "/api/forms/{form_uuid}/publish",
            post(forms::publish_form_schema),
        )
        .route(
            "/api/forms/{form_uuid}/versions/{version}/restore",
            post(forms::restore_form_version),
        )
        .route(
            "/api/forms/{form_uuid}/schema/draft",
            post(forms::save_form_schema),
        )
        .route(
            "/api/forms/{form_uuid}",
            axum::routing::delete(forms::delete_form),
        )
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}
