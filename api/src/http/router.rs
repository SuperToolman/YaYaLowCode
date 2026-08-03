use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use std::hash::{DefaultHasher, Hash, Hasher};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::modules::{
    agent_config, agents, apps, automations, communication, dingtalk, files, forms, identity,
    locations, navigation, recycle_bin, settings, workflows,
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
        .route(
            "/api/recycle-bin",
            get(recycle_bin::list_recycle_bin).delete(recycle_bin::empty_recycle_bin),
        )
        .route(
            "/api/recycle-bin/{id}/restore",
            post(recycle_bin::restore_recycle_bin_entry),
        )
        .route(
            "/api/recycle-bin/{id}",
            axum::routing::delete(recycle_bin::delete_recycle_bin_entry),
        )
        .route(
            "/api/settings/recycle-bin",
            get(recycle_bin::get_recycle_bin_settings)
                .put(recycle_bin::update_recycle_bin_settings),
        )
        .route("/api/authorization/grants", get(authorization::get_grants))
        .route(
            "/api/settings/license",
            get(settings::get_platform_license_status).post(settings::activate_platform_license),
        )
        .route(
            "/api/settings/database",
            get(settings::get_database_settings).put(settings::update_database_settings),
        )
        .route(
            "/api/settings/database/test",
            post(settings::test_database_connection),
        )
        .route(
            "/api/settings/valkey",
            get(settings::get_valkey_settings).put(settings::update_valkey_settings),
        )
        .route(
            "/api/settings/valkey/test",
            post(settings::test_valkey_connection),
        )
        .route(
            "/api/settings/agent-assistant",
            get(settings::get_platform_agent_assistant_settings)
                .put(settings::update_platform_agent_assistant_settings),
        )
        .route(
            "/api/settings/notifications",
            get(settings::get_notification_settings).put(settings::update_notification_settings),
        )
        .route(
            "/api/settings/logs",
            get(crate::modules::logs::list_platform_logs)
                .delete(crate::modules::logs::clear_platform_logs),
        )
        .route(
            "/api/settings/communication",
            get(settings::get_communication_module_settings)
                .put(settings::update_communication_module_settings),
        )
        .route(
            "/api/settings/communication/storage",
            get(settings::get_communication_storage_stats),
        )
        .route(
            "/api/settings/communication/cleanup",
            post(settings::cleanup_communication_data),
        )
        .route(
            "/api/communication/status",
            get(communication::communication_status),
        )
        .route(
            "/api/communication/conversations",
            get(communication::list_conversations),
        )
        .route(
            "/api/communication/users",
            get(communication::list_communication_users),
        )
        .route(
            "/api/communication/conversations/direct",
            post(communication::create_direct_conversation),
        )
        .route(
            "/api/communication/conversations/groups",
            post(communication::create_group_conversation),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}",
            axum::routing::put(communication::update_group_conversation),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/owner",
            post(communication::transfer_group_owner),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/leave",
            post(communication::leave_group_conversation),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/dissolve",
            axum::routing::delete(communication::delete_group_conversation),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/messages",
            get(communication::list_messages).post(communication::send_message),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/messages/{message_uuid}/recall",
            post(communication::recall_message),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/messages/{message_uuid}/reedit",
            post(communication::reedit_message),
        )
        .route(
            "/api/communication/conversations/{conversation_uuid}/read",
            post(communication::mark_read),
        )
        .route(
            "/api/communication/ws",
            get(communication::communication_websocket),
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
        .route(
            "/api/agent/personas",
            get(agent_config::list_personas).post(agent_config::create_persona),
        )
        .route(
            "/api/agent/personas/{id}",
            axum::routing::put(agent_config::update_persona).delete(agent_config::delete_persona),
        )
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
        .route("/api/agent/skills/import", post(agent_config::import_skill))
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
            get(identity::list_organization_units).post(identity::create_local_organization_unit),
        )
        .route(
            "/api/identity/users",
            get(identity::list_users).post(identity::create_local_user),
        )
        .route(
            "/api/identity/users/initialize-local-credentials",
            post(identity::initialize_local_credentials),
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
        .route(
            "/api/agent/sessions/{session_uuid}/pending-actions/{action_uuid}/confirm",
            post(agents::confirm_pending_action),
        )
        .route(
            "/api/agent/sessions/{session_uuid}/runs/{run_uuid}/trace",
            get(agents::get_agent_run_trace),
        )
        .route(
            "/api/agent/sessions/{session_uuid}/pending-actions",
            get(agents::list_pending_actions),
        )
        .route(
            "/api/agent/sessions/{session_uuid}/pending-actions/{action_uuid}/cancel",
            post(agents::cancel_pending_action),
        )
        .route("/api/apps", get(apps::list_apps).post(apps::create_app))
        .route(
            "/api/apps/{app_id}",
            get(apps::get_app)
                .patch(apps::update_app)
                .delete(apps::delete_app),
        )
        .route(
            "/api/apps/{app_id}/business-context",
            get(apps::get_application_business_context)
                .patch(apps::update_application_business_context),
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
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow/comments",
            get(workflows::list_workflow_comments).post(workflows::create_workflow_comment),
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
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow/pause",
            post(workflows::pause_workflow_record),
        )
        .route(
            "/api/forms/{form_uuid}/records/{record_uuid}/workflow/resume",
            post(workflows::resume_workflow_record),
        )
        .route(
            "/api/workflow/tasks/{task_uuid}/approve",
            post(workflows::approve_workflow_task),
        )
        .route("/api/workflow/tasks", get(workflows::list_workflow_tasks))
        .route(
            "/api/workflow/notifications",
            get(workflows::list_workflow_notifications),
        )
        .route(
            "/api/workflow/notification-preferences",
            get(workflows::get_notification_preferences),
        )
        .route(
            "/api/workflow/notifications/{notification_uuid}/read",
            post(workflows::read_workflow_notification),
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
        .layer(TraceLayer::new_for_http().on_response(DefaultOnResponse::new().level(Level::INFO)))
        .layer(cors_layer())
}

fn cors_layer() -> CorsLayer {
    let configured = std::env::var("CORS_ALLOWED_ORIGINS").ok();
    let origins = configured
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter_map(|origin| HeaderValue::from_str(origin.trim()).ok())
        .collect::<Vec<_>>();
    if origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    }
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
        (_, "/api/communication/ws") => {}
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
    let exempt_from_license = matches!(
        request.uri().path(),
        "/healthz"
            | "/openapi.json"
            | "/api/identity/local-login"
            | "/api/identity/dingtalk/session"
            | "/api/internal/identity-source"
            | "/api/authorization/grants"
            | "/api/settings/license"
    );
    if !exempt_from_license {
        crate::platform::license::validate_license_remotely()
            .await
            .map_err(AppError::Forbidden)?;
    }
    let request_method = request.method().clone();
    let request_path = request.uri().path().to_string();
    let category = cache_category(&request_path);
    let cache_key = if request_method == Method::GET {
        if let Some((category, _)) = category {
            let version = state
                .cache_version(&format!("yaya:v1:http:{category}:version"))
                .await;
            Some((
                response_cache_key(category, version, request.uri(), request.headers()),
                state.cache_ttl_seconds(),
            ))
        } else {
            None
        }
    } else {
        None
    };
    if let Some((key, _)) = cache_key.as_ref() {
        if let Some(body) = state.cache_get_text(key).await {
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .header("x-yaya-cache", "HIT")
                .body(Body::from(body))
                .expect("cache response is valid"));
        }
    }

    let response = next.run(request).await;
    if response.status().is_success() {
        if let Some((key, ttl)) = cache_key {
            let (parts, body) = response.into_parts();
            let bytes = to_bytes(body, usize::MAX).await.unwrap_or_default();
            let body = String::from_utf8(bytes.to_vec()).unwrap_or_default();
            if !body.is_empty() {
                state.cache_set_text(&key, body.clone(), ttl).await;
            }
            return Ok(Response::from_parts(parts, Body::from(body)));
        }
        if request_is_cache_mutation(&request_method, &request_path) {
            if let Some((category, _)) = category {
                state
                    .bump_cache_version(&format!("yaya:v1:http:{category}:version"))
                    .await;
            }
        }
    }
    Ok(response)
}

fn cache_category(path: &str) -> Option<(&'static str, u64)> {
    match path {
        "/api/authorization/grants" | "/api/settings/permissions" => Some(("rbac", 60)),
        "/api/locations" => Some(("locations", 3_600)),
        _ if path.starts_with("/api/apps") => Some(("apps", 300)),
        _ if path.starts_with("/api/forms") && !path.contains("/records") => Some(("forms", 300)),
        _ if path.starts_with("/api/identity/users")
            || path.starts_with("/api/identity/roles")
            || path.starts_with("/api/identity/organization-units") =>
        {
            Some(("identity", 60))
        }
        _ if path.starts_with("/api/communication/conversations")
            || path == "/api/communication/users" =>
        {
            Some(("communication", 30))
        }
        _ if path.starts_with("/api/workflow/tasks")
            || path.starts_with("/api/workflow/notifications")
            || path.contains("/workflow/") =>
        {
            Some(("workflows", 60))
        }
        _ if path.contains("/automations") || path.starts_with("/api/automation") => {
            Some(("automations", 300))
        }
        _ if path.starts_with("/api/agent/providers")
            || path.starts_with("/api/agent/profiles")
            || path.starts_with("/api/agent/agents")
            || path.starts_with("/api/agent/plugins")
            || path.starts_with("/api/agent/skills")
            || path.starts_with("/api/agent/knowledge-bases") =>
        {
            Some(("agent-config", 300))
        }
        _ if path.starts_with("/api/agent/sessions") => Some(("agent-sessions", 60)),
        _ if matches!(
            path,
            "/api/settings/agent-assistant"
                | "/api/settings/notifications"
                | "/api/settings/communication"
        ) =>
        {
            Some(("settings", 300))
        }
        _ => None,
    }
}

fn request_is_cache_mutation(method: &Method, path: &str) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
        && cache_category(path).is_some()
}

fn response_cache_key(
    category: &str,
    version: u64,
    uri: &axum::http::Uri,
    headers: &axum::http::HeaderMap,
) -> String {
    let mut hasher = DefaultHasher::new();
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .hash(&mut hasher);
    format!(
        "yaya:v1:http:{category}:v{version}:u{:x}:{}",
        hasher.finish(),
        uri.path_and_query()
            .map(|value| value.as_str())
            .unwrap_or(uri.path())
    )
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}
