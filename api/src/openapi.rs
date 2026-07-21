use axum::Json;
use serde_json::Value;
use std::path::Path;
use utoipa::OpenApi;

use crate::modules::agent_config::{
    AgentRequest, KnowledgeBaseRequest, PlatformToolResponse, PluginRequest, ProfileRequest,
    ProviderRequest, ProviderResponse, SkillFileRequest, SkillFileResponse, SkillRequest,
};
use crate::modules::agents::{ApiAgentMessage, ApiAgentSession, CreateAgentSessionRequest};
use crate::modules::apps::{ApiApp, CreateAppRequest, UpdateAppRequest};
use crate::modules::automations::{
    ApiAutomationFlow, ApiAutomationFlowDetail, ApiAutomationFlowList,
    ApiAutomationFlowVersionSummary, ApiAutomationRun, CreateAutomationFlowRequest,
    UpdateAutomationFlowRequest,
};
use crate::modules::dingtalk::{
    AccessTokenResponse, ClearDingTalkDataResponse, DepartmentSyncResponse, UserSyncResponse,
};
use crate::modules::forms::{
    ApiAppFieldOutline, ApiFormRecord, ApiFormRecordList, ApiFormSummary, ApiFormVersionSummary,
    ApiSchemaPayload, CreateFormRecordRequest, FormViewResponse, RestoreVersionRequest,
    SaveFormViewRequest, SaveSchemaRequest, UpdateFormRecordRequest,
};
use crate::modules::identity::{
    CreateLocalRoleRequest, CreateLocalUserRequest, DingTalkLoginUserResponse,
    OrganizationUnitResponse, RoleResponse, UpdateLocalRoleRequest, UpdateUserRequest,
    UserResponse,
};
use crate::modules::navigation::{
    ApiNavigationItem, CreateNavigationGroupRequest, ReorderNavigationRequest,
    SetDefaultNavigationEntryRequest,
};
use crate::modules::settings::{
    RolePermissionsResponse, UpdateIdentitySourceSettingsRequest, UpdateRolePermissionsRequest,
};
use crate::platform::api::ApiResponse;
use crate::platform::config::IdentitySourceSettings;
use crate::platform::config::{
    AgentConfigProfile, AgentDefinition, AgentKnowledgeBaseDefinition, AgentPluginDefinition,
    AgentSkillDefinition,
};

macro_rules! endpoint {
    ($name:ident, $method:ident, $path:literal, $operation_id:literal) => {
        #[allow(dead_code)]
        #[utoipa::path(
            $method,
            path = $path,
            operation_id = $operation_id,
            responses((status = 200, description = "Successful response"))
        )]
        fn $name() {}
    };
    ($name:ident, $method:ident, $path:literal, $operation_id:literal, $($params:tt),+) => {
        #[allow(dead_code)]
        #[utoipa::path(
            $method,
            path = $path,
            operation_id = $operation_id,
            params($($params),+),
            responses((status = 200, description = "Successful response"))
        )]
        fn $name() {}
    };
}

macro_rules! typed_endpoint {
    ($name:ident, $method:ident, $path:literal, $operation_id:literal, $params:tt, $response:ty) => {
        #[allow(dead_code)]
        #[utoipa::path($method, path = $path, operation_id = $operation_id, params $params, responses((status = 200, body = $response)))]
        fn $name() {}
    };
    ($name:ident, $method:ident, $path:literal, $operation_id:literal, $params:tt, $request:ty, $response:ty) => {
        #[allow(dead_code)]
        #[utoipa::path($method, path = $path, operation_id = $operation_id, params $params, request_body = $request, responses((status = 200, body = $response)))]
        fn $name() {}
    };
}

endpoint!(health_check, get, "/healthz", "healthCheck");
endpoint!(
    get_database_settings,
    get,
    "/api/settings/database",
    "getDatabaseSettings"
);
endpoint!(
    update_database_settings,
    put,
    "/api/settings/database",
    "updateDatabaseSettings"
);
endpoint!(
    get_agent_settings,
    get,
    "/api/settings/agent",
    "getAgentSettings"
);
endpoint!(
    update_agent_settings,
    put,
    "/api/settings/agent",
    "updateAgentSettings"
);

typed_endpoint!(
    list_providers,
    get,
    "/api/agent/providers",
    "listProviders",
    (),
    ApiResponse<Vec<ProviderResponse>>
);
typed_endpoint!(
    create_provider,
    post,
    "/api/agent/providers",
    "createProvider",
    (),
    ProviderRequest,
    ApiResponse<ProviderResponse>
);
typed_endpoint!(
    update_provider,
    put,
    "/api/agent/providers/{id}",
    "updateProvider",
    (("id" = String, Path)),
    ProviderRequest,
    ApiResponse<ProviderResponse>
);
endpoint!(
    delete_provider,
    delete,
    "/api/agent/providers/{id}",
    "deleteProvider",
    ("id" = String, Path)
);
typed_endpoint!(
    list_profiles,
    get,
    "/api/agent/config-profiles",
    "listConfigProfiles",
    (),
    ApiResponse<Vec<AgentConfigProfile>>
);
typed_endpoint!(
    create_profile,
    post,
    "/api/agent/config-profiles",
    "createConfigProfile",
    (),
    ProfileRequest,
    ApiResponse<AgentConfigProfile>
);
typed_endpoint!(
    update_profile,
    put,
    "/api/agent/config-profiles/{id}",
    "updateConfigProfile",
    (("id" = String, Path)),
    ProfileRequest,
    ApiResponse<AgentConfigProfile>
);
endpoint!(
    delete_profile,
    delete,
    "/api/agent/config-profiles/{id}",
    "deleteConfigProfile",
    ("id" = String, Path)
);
endpoint!(list_personas, get, "/api/agent/personas", "listPersonas");
typed_endpoint!(
    list_agents,
    get,
    "/api/agents",
    "listAgents",
    (),
    ApiResponse<Vec<AgentDefinition>>
);
typed_endpoint!(
    create_agent,
    post,
    "/api/agents",
    "createAgent",
    (),
    AgentRequest,
    ApiResponse<AgentDefinition>
);
typed_endpoint!(
    update_agent,
    put,
    "/api/agents/{id}",
    "updateAgent",
    (("id" = String, Path)),
    AgentRequest,
    ApiResponse<AgentDefinition>
);
endpoint!(
    delete_agent,
    delete,
    "/api/agents/{id}",
    "deleteAgent",
    ("id" = String, Path)
);
typed_endpoint!(
    list_plugins,
    get,
    "/api/agent/plugins",
    "listPlugins",
    (),
    ApiResponse<Vec<AgentPluginDefinition>>
);
typed_endpoint!(
    create_plugin,
    post,
    "/api/agent/plugins",
    "createPlugin",
    (),
    PluginRequest,
    ApiResponse<AgentPluginDefinition>
);
typed_endpoint!(
    update_plugin,
    put,
    "/api/agent/plugins/{id}",
    "updatePlugin",
    (("id" = String, Path)),
    PluginRequest,
    ApiResponse<AgentPluginDefinition>
);
endpoint!(
    delete_plugin,
    delete,
    "/api/agent/plugins/{id}",
    "deletePlugin",
    ("id" = String, Path)
);
typed_endpoint!(
    list_skills,
    get,
    "/api/agent/skills",
    "listSkills",
    (),
    ApiResponse<Vec<AgentSkillDefinition>>
);
typed_endpoint!(
    create_skill,
    post,
    "/api/agent/skills",
    "createSkill",
    (),
    SkillRequest,
    ApiResponse<AgentSkillDefinition>
);
typed_endpoint!(
    update_skill,
    put,
    "/api/agent/skills/{id}",
    "updateSkill",
    (("id" = String, Path)),
    SkillRequest,
    ApiResponse<AgentSkillDefinition>
);
endpoint!(
    delete_skill,
    delete,
    "/api/agent/skills/{id}",
    "deleteSkill",
    ("id" = String, Path)
);
typed_endpoint!(
    get_skill_file,
    get,
    "/api/agent/skills/{id}/file",
    "getSkillFile",
    (("id" = String, Path)),
    ApiResponse<SkillFileResponse>
);
typed_endpoint!(
    update_skill_file,
    put,
    "/api/agent/skills/{id}/file",
    "updateSkillFile",
    (("id" = String, Path)),
    SkillFileRequest,
    ApiResponse<SkillFileResponse>
);
typed_endpoint!(
    list_platform_tools,
    get,
    "/api/agent/platform-tools",
    "listPlatformTools",
    (),
    ApiResponse<Vec<PlatformToolResponse>>
);
typed_endpoint!(
    list_knowledge_bases,
    get,
    "/api/agent/knowledge-bases",
    "listKnowledgeBases",
    (),
    ApiResponse<Vec<AgentKnowledgeBaseDefinition>>
);
typed_endpoint!(
    create_knowledge_base,
    post,
    "/api/agent/knowledge-bases",
    "createKnowledgeBase",
    (),
    KnowledgeBaseRequest,
    ApiResponse<AgentKnowledgeBaseDefinition>
);
typed_endpoint!(
    update_knowledge_base,
    put,
    "/api/agent/knowledge-bases/{id}",
    "updateKnowledgeBase",
    (("id" = String, Path)),
    KnowledgeBaseRequest,
    ApiResponse<AgentKnowledgeBaseDefinition>
);
endpoint!(
    delete_knowledge_base,
    delete,
    "/api/agent/knowledge-bases/{id}",
    "deleteKnowledgeBase",
    ("id" = String, Path)
);

typed_endpoint!(
    get_identity_source_settings,
    get,
    "/api/settings/identity-source",
    "getIdentitySourceSettings",
    (),
    ApiResponse<IdentitySourceSettings>
);
typed_endpoint!(
    update_identity_source_settings,
    put,
    "/api/settings/identity-source",
    "updateIdentitySourceSettings",
    (),
    UpdateIdentitySourceSettingsRequest,
    ApiResponse<IdentitySourceSettings>
);
endpoint!(
    get_internal_identity_source_settings,
    get,
    "/api/internal/identity-source",
    "getInternalIdentitySourceSettings"
);
typed_endpoint!(
    get_role_permissions,
    get,
    "/api/settings/permissions/{roleId}",
    "getRolePermissions",
    (("roleId" = String, Path)),
    ApiResponse<RolePermissionsResponse>
);
typed_endpoint!(
    update_role_permissions,
    put,
    "/api/settings/permissions/{roleId}",
    "updateRolePermissions",
    (("roleId" = String, Path)),
    UpdateRolePermissionsRequest,
    ApiResponse<RolePermissionsResponse>
);
typed_endpoint!(
    refresh_dingtalk_access_token,
    post,
    "/api/settings/identity-source/dingtalk/access-token",
    "refreshDingTalkAccessToken",
    (),
    ApiResponse<AccessTokenResponse>
);
typed_endpoint!(
    sync_dingtalk_departments,
    post,
    "/api/settings/identity-source/dingtalk/sync-departments",
    "syncDingTalkDepartments",
    (),
    ApiResponse<DepartmentSyncResponse>
);
typed_endpoint!(
    sync_dingtalk_users,
    post,
    "/api/settings/identity-source/dingtalk/sync-users",
    "syncDingTalkUsers",
    (),
    ApiResponse<UserSyncResponse>
);
typed_endpoint!(
    clear_dingtalk_data,
    post,
    "/api/settings/identity-source/dingtalk/clear",
    "clearDingTalkData",
    (),
    ApiResponse<ClearDingTalkDataResponse>
);

typed_endpoint!(
    list_organization_units,
    get,
    "/api/identity/organization-units",
    "listOrganizationUnits",
    (),
    ApiResponse<Vec<OrganizationUnitResponse>>
);
typed_endpoint!(
    list_users,
    get,
    "/api/identity/users",
    "listUsers",
    (),
    ApiResponse<Vec<UserResponse>>
);
typed_endpoint!(
    create_local_user,
    post,
    "/api/identity/users",
    "createLocalUser",
    (),
    CreateLocalUserRequest,
    ApiResponse<DingTalkLoginUserResponse>
);
typed_endpoint!(
    local_login,
    post,
    "/api/identity/local-login",
    "localLogin",
    (),
    crate::modules::identity::LocalLoginRequest,
    ApiResponse<DingTalkLoginUserResponse>
);
typed_endpoint!(
    update_user,
    put,
    "/api/identity/users/{userId}",
    "updateUser",
    (("userId" = String, Path)),
    UpdateUserRequest,
    ApiResponse<UserResponse>
);
endpoint!(
    delete_user,
    delete,
    "/api/identity/users/{userId}",
    "deleteUser",
    ("userId" = String, Path)
);
typed_endpoint!(
    resolve_dingtalk_login,
    post,
    "/api/identity/dingtalk/session",
    "resolveDingTalkLogin",
    (),
    crate::modules::identity::DingTalkLoginRequest,
    ApiResponse<DingTalkLoginUserResponse>
);
typed_endpoint!(
    list_roles,
    get,
    "/api/identity/roles",
    "listRoles",
    (),
    ApiResponse<Vec<RoleResponse>>
);
typed_endpoint!(
    create_local_role,
    post,
    "/api/identity/roles",
    "createLocalRole",
    (),
    CreateLocalRoleRequest,
    ApiResponse<RoleResponse>
);
typed_endpoint!(
    update_local_role,
    put,
    "/api/identity/roles/{roleId}",
    "updateLocalRole",
    (("roleId" = String, Path)),
    UpdateLocalRoleRequest,
    ApiResponse<RoleResponse>
);
endpoint!(
    delete_local_role,
    delete,
    "/api/identity/roles/{roleId}",
    "deleteLocalRole",
    ("roleId" = String, Path)
);

typed_endpoint!(
    list_agent_sessions,
    get,
    "/api/agent/sessions",
    "listAgentSessions",
    (),
    ApiResponse<Vec<ApiAgentSession>>
);
typed_endpoint!(
    create_agent_session,
    post,
    "/api/agent/sessions",
    "createAgentSession",
    (),
    CreateAgentSessionRequest,
    ApiResponse<ApiAgentSession>
);
typed_endpoint!(
    list_agent_messages,
    get,
    "/api/agent/sessions/{sessionId}/messages",
    "listAgentMessages",
    (("sessionId" = String, Path)),
    ApiResponse<Vec<ApiAgentMessage>>
);
endpoint!(
    send_agent_message,
    post,
    "/api/agent/sessions/{sessionId}/messages",
    "sendAgentMessage",
    ("sessionId" = String, Path)
);

typed_endpoint!(
    list_apps,
    get,
    "/api/apps",
    "listApps",
    (),
    ApiResponse<Vec<ApiApp>>
);
typed_endpoint!(
    create_app,
    post,
    "/api/apps",
    "createApp",
    (),
    CreateAppRequest,
    ApiResponse<ApiApp>
);
typed_endpoint!(
    update_app,
    patch,
    "/api/apps/{appId}",
    "updateApp",
    (("appId" = String, Path)),
    UpdateAppRequest,
    ApiResponse<ApiApp>
);
endpoint!(
    delete_app,
    delete,
    "/api/apps/{appId}",
    "deleteApp",
    ("appId" = String, Path)
);
typed_endpoint!(
    list_navigation_items,
    get,
    "/api/apps/{appId}/navigation",
    "listNavigationItems",
    (("appId" = String, Path)),
    ApiResponse<Vec<ApiNavigationItem>>
);
typed_endpoint!(
    reorder_navigation_item,
    patch,
    "/api/apps/{appId}/navigation",
    "reorderNavigationItem",
    (("appId" = String, Path)),
    ReorderNavigationRequest,
    ApiResponse<Vec<ApiNavigationItem>>
);
typed_endpoint!(
    set_default_navigation_entry,
    patch,
    "/api/apps/{appId}/navigation/default-entry",
    "setDefaultNavigationEntry",
    (("appId" = String, Path)),
    SetDefaultNavigationEntryRequest,
    ApiResponse<ApiNavigationItem>
);
typed_endpoint!(
    create_navigation_group,
    post,
    "/api/apps/{appId}/navigation/groups",
    "createNavigationGroup",
    (("appId" = String, Path)),
    CreateNavigationGroupRequest,
    ApiResponse<ApiNavigationItem>
);
typed_endpoint!(
    get_app_field_outline,
    get,
    "/api/apps/{appId}/field-outline",
    "getAppFieldOutline",
    (("appId" = String, Path)),
    ApiResponse<ApiAppFieldOutline>
);
endpoint!(
    list_forms,
    get,
    "/api/apps/{appId}/forms",
    "listForms",
    ("appId" = String, Path)
);
endpoint!(
    create_form,
    post,
    "/api/apps/{appId}/forms",
    "createForm",
    ("appId" = String, Path)
);
typed_endpoint!(
    list_automation_flows,
    get,
    "/api/apps/{appId}/automations",
    "listAutomationFlows",
    (("appId" = String, Path)),
    ApiResponse<ApiAutomationFlowList>
);
typed_endpoint!(
    create_automation_flow,
    post,
    "/api/apps/{appId}/automations",
    "createAutomationFlow",
    (("appId" = String, Path)),
    CreateAutomationFlowRequest,
    ApiResponse<ApiAutomationFlow>
);

typed_endpoint!(
    get_automation_flow,
    get,
    "/api/automations/{automationId}",
    "getAutomationFlow",
    (("automationId" = String, Path)),
    ApiResponse<ApiAutomationFlowDetail>
);
typed_endpoint!(
    update_automation_flow,
    patch,
    "/api/automations/{automationId}",
    "updateAutomationFlow",
    (("automationId" = String, Path)),
    UpdateAutomationFlowRequest,
    ApiResponse<ApiAutomationFlow>
);
endpoint!(
    delete_automation_flow,
    delete,
    "/api/automations/{automationId}",
    "deleteAutomationFlow",
    ("automationId" = String, Path)
);
typed_endpoint!(
    list_automation_flow_versions,
    get,
    "/api/automations/{automationId}/versions",
    "listAutomationFlowVersions",
    (("automationId" = String, Path)),
    ApiResponse<Vec<ApiAutomationFlowVersionSummary>>
);
typed_endpoint!(
    restore_automation_flow_version,
    post,
    "/api/automations/{automationId}/versions/{version}/restore",
    "restoreAutomationFlowVersion",
    (("automationId" = String, Path), ("version" = i32, Path)),
    RestoreVersionRequest,
    ApiResponse<ApiAutomationFlowDetail>
);
typed_endpoint!(
    list_automation_flow_runs,
    get,
    "/api/automations/{automationId}/runs",
    "listAutomationFlowRuns",
    (("automationId" = String, Path)),
    ApiResponse<Vec<ApiAutomationRun>>
);
endpoint!(
    retry_automation_flow_run,
    post,
    "/api/automations/{automationId}/runs/{runId}/retry",
    "retryAutomationFlowRun",
    ("automationId" = String, Path),
    ("runId" = String, Path)
);
endpoint!(
    retry_automation_flow_run_node,
    post,
    "/api/automations/{automationId}/runs/{runId}/nodes/{nodeKey}/retry",
    "retryAutomationFlowRunNode",
    ("automationId" = String, Path),
    ("runId" = String, Path),
    ("nodeKey" = String, Path)
);

typed_endpoint!(get_form_schema, get, "/api/forms/{formUuid}/schema", "getFormSchema", (("formUuid" = String, Path), ("scope" = Option<String>, Query), ("version" = Option<i32>, Query)), ApiResponse<ApiSchemaPayload>);
#[utoipa::path(get, path = "/api/forms/{formUuid}/views", operation_id = "listFormViews", params(("formUuid" = String, Path)), responses((status = 200, body = ApiResponse<Vec<FormViewResponse>>)))]
#[allow(dead_code)]
fn list_form_views() {}
#[utoipa::path(post, path = "/api/forms/{formUuid}/views", operation_id = "createFormView", params(("formUuid" = String, Path)), request_body = SaveFormViewRequest, responses((status = 200, body = ApiResponse<FormViewResponse>)))]
#[allow(dead_code)]
fn create_form_view() {}
#[utoipa::path(put, path = "/api/forms/{formUuid}/views/{viewUuid}", operation_id = "updateFormView", params(("formUuid" = String, Path), ("viewUuid" = String, Path)), request_body = SaveFormViewRequest, responses((status = 200, body = ApiResponse<FormViewResponse>)))]
#[allow(dead_code)]
fn update_form_view() {}
#[utoipa::path(delete, path = "/api/forms/{formUuid}/views/{viewUuid}", operation_id = "deleteFormView", params(("formUuid" = String, Path), ("viewUuid" = String, Path)), responses((status = 200, description = "Form view deleted")))]
#[allow(dead_code)]
fn delete_form_view() {}
typed_endpoint!(list_form_records, get, "/api/forms/{formUuid}/records", "listFormRecords", (("formUuid" = String, Path), ("page" = Option<u64>, Query), ("pageSize" = Option<u64>, Query)), ApiResponse<ApiFormRecordList>);
typed_endpoint!(
    create_form_record,
    post,
    "/api/forms/{formUuid}/records",
    "createFormRecord",
    (("formUuid" = String, Path)),
    CreateFormRecordRequest,
    ApiResponse<ApiFormRecord>
);
typed_endpoint!(
    update_form_record,
    patch,
    "/api/forms/{formUuid}/records/{recordUuid}",
    "updateFormRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    UpdateFormRecordRequest,
    ApiResponse<ApiFormRecord>
);
endpoint!(
    delete_form_record,
    delete,
    "/api/forms/{formUuid}/records/{recordUuid}",
    "deleteFormRecord",
    ("formUuid" = String, Path),
    ("recordUuid" = String, Path)
);
typed_endpoint!(
    list_form_versions,
    get,
    "/api/forms/{formUuid}/versions",
    "listFormVersions",
    (("formUuid" = String, Path)),
    ApiResponse<Vec<ApiFormVersionSummary>>
);
typed_endpoint!(
    get_form_version,
    get,
    "/api/forms/{formUuid}/versions/{version}",
    "getFormVersion",
    (("formUuid" = String, Path), ("version" = i32, Path)),
    ApiResponse<ApiSchemaPayload>
);
typed_endpoint!(
    publish_form_schema,
    post,
    "/api/forms/{formUuid}/publish",
    "publishFormSchema",
    (("formUuid" = String, Path)),
    ApiResponse<ApiSchemaPayload>
);
typed_endpoint!(
    restore_form_version,
    post,
    "/api/forms/{formUuid}/versions/{version}/restore",
    "restoreFormVersion",
    (("formUuid" = String, Path), ("version" = i32, Path)),
    RestoreVersionRequest,
    ApiResponse<ApiSchemaPayload>
);
typed_endpoint!(
    save_form_schema,
    post,
    "/api/forms/{formUuid}/schema/draft",
    "saveFormSchemaDraft",
    (("formUuid" = String, Path)),
    SaveSchemaRequest,
    ApiResponse<ApiSchemaPayload>
);
typed_endpoint!(
    get_form,
    get,
    "/api/forms/{formUuid}",
    "getForm",
    (("formUuid" = String, Path)),
    ApiResponse<ApiFormSummary>
);
endpoint!(
    delete_form,
    delete,
    "/api/forms/{formUuid}",
    "deleteForm",
    ("formUuid" = String, Path)
);

#[derive(OpenApi)]
#[openapi(
    info(
        title = "YaYa Low Code API",
        version = "0.2.0-alpha.0",
        description = "Runtime-generated API contract for the YaYa Low Code backend."
    ),
    paths(
        health_check,
        get_database_settings,
        update_database_settings,
        get_agent_settings,
        update_agent_settings,
        list_providers,
        create_provider,
        update_provider,
        delete_provider,
        list_profiles,
        create_profile,
        update_profile,
        delete_profile,
        list_personas,
        list_agents,
        create_agent,
        update_agent,
        delete_agent,
        list_plugins,
        create_plugin,
        update_plugin,
        delete_plugin,
        list_skills,
        create_skill,
        update_skill,
        delete_skill,
        get_skill_file,
        update_skill_file,
        list_platform_tools,
        list_knowledge_bases,
        create_knowledge_base,
        update_knowledge_base,
        delete_knowledge_base,
        get_identity_source_settings,
        update_identity_source_settings,
        get_internal_identity_source_settings,
        get_role_permissions,
        update_role_permissions,
        refresh_dingtalk_access_token,
        sync_dingtalk_departments,
        sync_dingtalk_users,
        clear_dingtalk_data,
        list_organization_units,
        list_users,
        create_local_user,
        local_login,
        update_user,
        delete_user,
        resolve_dingtalk_login,
        list_roles,
        create_local_role,
        update_local_role,
        delete_local_role,
        list_agent_sessions,
        create_agent_session,
        list_agent_messages,
        send_agent_message,
        list_apps,
        create_app,
        update_app,
        delete_app,
        list_navigation_items,
        reorder_navigation_item,
        set_default_navigation_entry,
        create_navigation_group,
        get_app_field_outline,
        list_forms,
        create_form,
        list_automation_flows,
        create_automation_flow,
        get_automation_flow,
        update_automation_flow,
        delete_automation_flow,
        list_automation_flow_versions,
        restore_automation_flow_version,
        list_automation_flow_runs,
        retry_automation_flow_run,
        retry_automation_flow_run_node,
        get_form_schema,
        list_form_views,
        create_form_view,
        update_form_view,
        delete_form_view,
        list_form_records,
        create_form_record,
        update_form_record,
        delete_form_record,
        list_form_versions,
        get_form_version,
        publish_form_schema,
        restore_form_version,
        save_form_schema,
        get_form,
        delete_form
    )
)]
struct ApiDoc;

pub(crate) fn document() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}

pub(crate) fn export_to_file(path: &Path) -> Result<(), std::io::Error> {
    let content = serde_json::to_vec_pretty(&document()).expect("OpenAPI document is serializable");
    std::fs::write(path, content)
}

pub(crate) async fn openapi_json() -> Json<Value> {
    Json(serde_json::to_value(document()).expect("OpenAPI document is serializable"))
}

#[cfg(test)]
mod tests {
    use super::document;

    #[test]
    fn documents_current_identity_and_form_routes() {
        let value = serde_json::to_value(document()).expect("OpenAPI document is serializable");
        assert!(value["paths"]["/api/settings/identity-source/dingtalk/clear"]["post"].is_object());
        assert!(value["paths"]["/api/identity/users/{userId}"]["put"].is_object());
        assert!(value["paths"]["/api/forms/{formUuid}/views/{viewUuid}"]["delete"].is_object());
        assert!(value["paths"]["/api/apps/{appId}/field-outline"]["get"].is_object());
        assert!(value["components"]["schemas"]["FormViewResponse"].is_object());
        assert!(value["components"]["schemas"]["ApiAppFieldOutline"].is_object());
    }
}
