use axum::extract::{Request, State};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::modules::{
    agent_config, agents, apps, automations, dingtalk, files, forms, identity, locations,
    navigation, settings, workflows,
};
use crate::openapi;
use crate::platform::{authorization, error::AppError, runtime::AppState};

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

pub(crate) fn build(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health_check))
        .route("/openapi.json", get(openapi::openapi_json))
        .route(
            "/api/locations",
            get(locations::list_locations).post(locations::import_locations),
        )
        .route("/api/files/upload", post(files::upload_file))
        .route("/api/files/{file_id}/download", get(files::download_file))
        .route("/api/authorization/grants", get(authorization::get_grants))
        .route(
            "/api/settings/database",
            get(settings::get_database_settings).put(settings::update_database_settings),
        )
        .route(
            "/api/settings/database/test",
            post(settings::test_database_connection),
        )
        .route(
            "/api/settings/agent",
            get(settings::get_agent_settings).put(settings::update_agent_settings),
        )
        .route(
            "/api/settings/agent-assistant",
            get(settings::get_platform_agent_assistant_settings)
                .put(settings::update_platform_agent_assistant_settings),
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
            "/api/agent/platform-tools",
            get(agent_config::list_platform_tools),
        )
        .route(
            "/api/agents",
            get(agent_config::list_agents).post(agent_config::create_agent),
        )
        .route(
            "/api/agents/{id}",
            axum::routing::put(agent_config::update_agent).delete(agent_config::delete_agent),
        )
        .route(
            "/api/agent/plugins",
            get(agent_config::list_plugins).post(agent_config::create_plugin),
        )
        .route(
            "/api/agent/plugins/{id}",
            axum::routing::put(agent_config::update_plugin).delete(agent_config::delete_plugin),
        )
        .route(
            "/api/agent/skills",
            get(agent_config::list_skills).post(agent_config::create_skill),
        )
        .route(
            "/api/agent/skills/import",
            post(agent_config::import_skill),
        )
        .route(
            "/api/agent/skills/{id}",
            axum::routing::put(agent_config::update_skill).delete(agent_config::delete_skill),
        )
        .route(
            "/api/agent/skills/{id}/file",
            get(agent_config::get_skill_file).put(agent_config::update_skill_file),
        )
        .route(
            "/api/agent/knowledge-bases",
            get(agent_config::list_knowledge_bases).post(agent_config::create_knowledge_base),
        )
        .route(
            "/api/agent/knowledge-bases/{id}",
            axum::routing::put(agent_config::update_knowledge_base)
                .delete(agent_config::delete_knowledge_base),
        )
        .route(
            "/api/settings/identity-source",
            get(settings::get_identity_source_settings)
                .put(settings::update_identity_source_settings),
        )
        .route(
            "/api/internal/identity-source",
            get(settings::get_internal_identity_source_settings),
        )
        .route(
            "/api/settings/permissions/{role_id}",
            get(settings::get_role_permissions).put(settings::update_role_permissions),
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
            "/api/settings/identity-source/dingtalk/clear",
            post(dingtalk::clear_dingtalk_data),
        )
        .route(
            "/api/identity/organization-units",
            get(identity::list_organization_units),
        )
        .route(
            "/api/identity/users",
            get(identity::list_users).post(identity::create_local_user),
        )
        .route("/api/identity/local-login", post(identity::local_login))
        .route(
            "/api/identity/users/{user_id}",
            axum::routing::put(identity::update_user).delete(identity::delete_user),
        )
        .route(
            "/api/identity/dingtalk/session",
            post(identity::resolve_dingtalk_login),
        )
        .route(
            "/api/identity/roles",
            get(identity::list_roles).post(identity::create_local_role),
        )
        .route(
            "/api/identity/roles/{role_id}",
            axum::routing::put(identity::update_local_role).delete(identity::delete_local_role),
        )
        .route(
            "/api/agent/sessions",
            get(agents::list_agent_sessions).post(agents::create_agent_session),
        )
        .route(
            "/api/agent/sessions/{session_uuid}/messages",
            get(agents::list_agent_messages).post(agents::send_agent_message),
        )
        .route(
            "/api/agent/sessions/{session_uuid}",
            axum::routing::patch(agents::update_agent_session).delete(agents::delete_agent_session),
        )
        .route("/api/apps", get(apps::list_apps).post(apps::create_app))
        .route(
            "/api/apps/{app_id}",
            get(apps::get_app)
                .patch(apps::update_app)
                .delete(apps::delete_app),
        )
        .route(
            "/api/apps/{app_id}/navigation",
            get(navigation::list_navigation_items).patch(navigation::reorder_navigation_item),
        )
        .route(
            "/api/apps/{app_id}/navigation/default-entry",
            patch(navigation::set_default_navigation_entry),
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
            "/api/apps/{app_id}/field-outline",
            get(forms::get_app_field_outline),
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
            "/api/forms/{form_uuid}/detail-forms",
            get(forms::list_detail_forms).post(forms::create_detail_form),
        )
        .route(
            "/api/forms/{form_uuid}/workflow/process",
            post(forms::ensure_workflow_process_flow),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow",
            get(workflows::get_workflow_record_runtime),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow/submit",
            post(workflows::submit_workflow_record),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow/reverse",
            post(workflows::reverse_workflow_record),
        )
        .route(
            "/api/workflow/tasks/{task_uuid}/approve",
            post(workflows::approve_workflow_task),
        )
        .route(
            "/api/workflow/tasks/{task_uuid}/reject",
            post(workflows::reject_workflow_task),
        )
        .route(
            "/api/forms/{form_uuid}/views",
            get(forms::list_form_views).post(forms::create_form_view),
        )
        .route(
            "/api/forms/{form_uuid}/views/{view_uuid}",
            axum::routing::put(forms::update_form_view).delete(forms::delete_form_view),
        )
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
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, require_authenticated))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
}

async fn require_authenticated(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    match (request.method(), request.uri().path()) {
        (_, "/healthz")
        | (_, "/openapi.json")
        | (_, "/api/identity/local-login")
        | (_, "/api/identity/dingtalk/session")
        | (_, "/api/internal/identity-source") => {}
        _ => {
            authorization::authorize_request(
                request.headers(),
                &state,
                request.method(),
                request.uri().path(),
            )
            .await?
        }
    }
    Ok(next.run(request).await)
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}
