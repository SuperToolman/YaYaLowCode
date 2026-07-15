use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::modules::{agent_config, agents, apps, automations, dingtalk, forms, identity, navigation, settings};
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
        .route(
            "/api/settings/agent",
            get(settings::get_agent_settings).put(settings::update_agent_settings),
        )
        .route(
            "/api/agent/providers",
            get(agent_config::list_providers).post(agent_config::create_provider),
        )
        .route(
            "/api/agent/providers/{id}",
            axum::routing::put(agent_config::update_provider).delete(agent_config::delete_provider),
        )
        .route(
            "/api/agent/config-profiles",
            get(agent_config::list_profiles).post(agent_config::create_profile),
        )
        .route(
            "/api/agent/config-profiles/{id}",
            axum::routing::put(agent_config::update_profile).delete(agent_config::delete_profile),
        )
        .route("/api/agent/personas", get(agent_config::list_personas))
        .route(
            "/api/agents",
            get(agent_config::list_agents).post(agent_config::create_agent),
        )
        .route(
            "/api/agents/{id}",
            axum::routing::put(agent_config::update_agent).delete(agent_config::delete_agent),
        )
        .route("/api/agent/plugins", get(agent_config::list_plugins).post(agent_config::create_plugin))
        .route("/api/agent/plugins/{id}", axum::routing::put(agent_config::update_plugin).delete(agent_config::delete_plugin))
        .route("/api/agent/skills", get(agent_config::list_skills).post(agent_config::create_skill))
        .route("/api/agent/skills/{id}", axum::routing::put(agent_config::update_skill).delete(agent_config::delete_skill))
        .route("/api/agent/knowledge-bases", get(agent_config::list_knowledge_bases).post(agent_config::create_knowledge_base))
        .route("/api/agent/knowledge-bases/{id}", axum::routing::put(agent_config::update_knowledge_base).delete(agent_config::delete_knowledge_base))
        .route(
            "/api/settings/identity-source",
            get(settings::get_identity_source_settings)
                .put(settings::update_identity_source_settings),
        )
        .route(
            "/api/settings/identity-source/dingtalk/access-token",
            post(dingtalk::refresh_access_token),
        )
        .route(
            "/api/settings/identity-source/dingtalk/sync-departments",
            post(dingtalk::sync_departments),
        )
        .route(
            "/api/settings/identity-source/dingtalk/sync-users",
            post(dingtalk::sync_users),
        )
        .route(
            "/api/identity/organization-units",
            get(identity::list_organization_units),
        )
        .route("/api/identity/users", get(identity::list_users))
        .route("/api/identity/roles", get(identity::list_roles))
        .route(
            "/api/agent/sessions",
            get(agents::list_agent_sessions).post(agents::create_agent_session),
        )
        .route(
            "/api/agent/sessions/{session_uuid}/messages",
            get(agents::list_agent_messages).post(agents::send_agent_message),
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
            get(forms::get_form).delete(forms::delete_form),
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
