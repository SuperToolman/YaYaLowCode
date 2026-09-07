use axum::Json;
use serde_json::Value;
use std::path::Path;
use utoipa::OpenApi;

use crate::modules::agent_config::{
    KnowledgeBaseRequest, PluginRequest, ProviderRequest, ProviderResponse, SystemAiStatusResponse,
};
use crate::modules::agents::{
    ApiAgentSession, CreateAgentSessionRequest,
    UpdateAgentSessionRequest,
};
use crate::modules::apps::{ApiApp, CreateAppRequest, UpdateAppRequest};
use crate::modules::automations::{
    ApiAutomationFlow, ApiAutomationFlowDetail, ApiAutomationFlowList,
    ApiAutomationFlowVersionSummary, ApiAutomationRun, CreateAutomationFlowRequest,
    UpdateAutomationFlowRequest,
};
use crate::modules::communication::{
    CommunicationAvailabilityResponse, CommunicationConversationResponse,
    CommunicationMessagePageResponse, CommunicationMessageResponse, CommunicationUserResponse,
    CreateDirectConversationRequest, CreateGroupConversationRequest, MarkConversationReadRequest,
    RecallCommunicationMessageRequest, ReeditCommunicationMessageRequest,
    SendCommunicationMessageRequest, TransferGroupOwnerRequest, UpdateGroupConversationRequest,
};
use crate::modules::dingtalk::{
    AccessTokenResponse, ClearDingTalkDataResponse, DepartmentSyncResponse, UserSyncResponse,
};
use crate::modules::forms::{
    ApiAppFieldOutline, ApiDetailForm, ApiFormRecord, ApiFormRecordList, ApiFormSummary,
    ApiFormVersionSummary, ApiSchemaPayload, CreateDetailFormRequest, CreateFormRecordRequest,
    CreateFormRequest, FormBootstrapResponse, FormViewResponse, QueryFormRecordsRequest,
    RestoreVersionRequest, SaveFormViewRequest, SaveSchemaRequest, UpdateFormNameRequest,
    UpdateFormRecordRequest,
};
use crate::modules::identity::{
    CreateLocalOrganizationUnitRequest, CreateLocalRoleRequest, CreateLocalUserRequest,
    DingTalkLoginUserResponse, OrganizationUnitResponse, RoleResponse, UpdateLocalRoleRequest,
    UpdateUserRequest, UserResponse,
};
use crate::modules::locations::{ImportLocationsRequest, LocationResponse};
use crate::modules::navigation::{
    ApiNavigationItem, CreateNavigationGroupRequest, DeleteNavigationGroupResponse,
    MoveFormNavigationRequest, ReorderNavigationRequest, SetDefaultNavigationEntryRequest,
    UpdateNavigationGroupRequest,
};
use crate::modules::recycle_bin::{RecycleBinEntry, UpdateRecycleBinSettingsRequest};
use crate::modules::settings::{
    ActivatePlatformLicenseRequest, AiEmployeeMarketItem, CommunicationCleanupResponse,
    CommunicationStorageStatsResponse, DatabaseConnectionTestResponse, DatabaseSettingsResponse,
    MarketPurchaseReceipt, RolePermissionsResponse, UpdateDatabaseSettingsRequest,
    UpdateIdentitySourceSettingsRequest, UpdateRolePermissionsRequest, UpdateValkeySettingsRequest,
    ValkeySettingsResponse,
};
use crate::modules::workflows::{
    WorkflowCommentRequest, WorkflowPauseRequest, WorkflowTaskActionRequest,
};
use crate::platform::api::ApiResponse;
use crate::platform::config::IdentitySourceSettings;
use crate::platform::config::{
    AgentKnowledgeBaseDefinition, AgentPluginDefinition, CommunicationModuleSettings,
    RecycleBinSettings,
};
use crate::platform::license::PlatformLicenseStatus;

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
typed_endpoint!(
    list_recycle_bin,
    get,
    "/api/recycle-bin",
    "listRecycleBin",
    (("formUuid" = Option<String>, Query)),
    ApiResponse<Vec<RecycleBinEntry>>
);
typed_endpoint!(
    empty_recycle_bin,
    delete,
    "/api/recycle-bin",
    "emptyRecycleBin",
    (),
    ApiResponse<Value>
);
typed_endpoint!(
    restore_recycle_bin_entry,
    post,
    "/api/recycle-bin/{id}/restore",
    "restoreRecycleBinEntry",
    (("id" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    delete_recycle_bin_entry,
    delete,
    "/api/recycle-bin/{id}",
    "deleteRecycleBinEntry",
    (("id" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    get_recycle_bin_settings,
    get,
    "/api/settings/recycle-bin",
    "getRecycleBinSettings",
    (),
    ApiResponse<RecycleBinSettings>
);
typed_endpoint!(
    update_recycle_bin_settings,
    put,
    "/api/settings/recycle-bin",
    "updateRecycleBinSettings",
    (),
    UpdateRecycleBinSettingsRequest,
    ApiResponse<RecycleBinSettings>
);
endpoint!(
    get_database_settings,
    get,
    "/api/settings/database",
    "getDatabaseSettings"
);
typed_endpoint!(
    update_database_settings,
    put,
    "/api/settings/database",
    "updateDatabaseSettings",
    (),
    UpdateDatabaseSettingsRequest,
    ApiResponse<DatabaseSettingsResponse>
);
typed_endpoint!(
    test_database_connection,
    post,
    "/api/settings/database/test",
    "testDatabaseConnection",
    (),
    UpdateDatabaseSettingsRequest,
    ApiResponse<DatabaseConnectionTestResponse>
);
typed_endpoint!(
    get_valkey_settings,
    get,
    "/api/settings/valkey",
    "getValkeySettings",
    (),
    ApiResponse<ValkeySettingsResponse>
);
typed_endpoint!(
    update_valkey_settings,
    put,
    "/api/settings/valkey",
    "updateValkeySettings",
    (),
    UpdateValkeySettingsRequest,
    ApiResponse<ValkeySettingsResponse>
);
typed_endpoint!(
    test_valkey_connection,
    post,
    "/api/settings/valkey/test",
    "testValkeyConnection",
    (),
    UpdateValkeySettingsRequest,
    ApiResponse<DatabaseConnectionTestResponse>
);
typed_endpoint!(
    get_communication_module_settings,
    get,
    "/api/settings/communication",
    "getCommunicationModuleSettings",
    (),
    ApiResponse<CommunicationModuleSettings>
);
typed_endpoint!(
    update_communication_module_settings,
    put,
    "/api/settings/communication",
    "updateCommunicationModuleSettings",
    (),
    CommunicationModuleSettings,
    ApiResponse<CommunicationModuleSettings>
);
typed_endpoint!(
    get_communication_storage_stats,
    get,
    "/api/settings/communication/storage",
    "getCommunicationStorageStats",
    (),
    ApiResponse<CommunicationStorageStatsResponse>
);
typed_endpoint!(
    cleanup_communication_data,
    post,
    "/api/settings/communication/cleanup",
    "cleanupCommunicationData",
    (),
    ApiResponse<CommunicationCleanupResponse>
);
typed_endpoint!(
    get_platform_license_status,
    get,
    "/api/settings/license",
    "getPlatformLicenseStatus",
    (),
    ApiResponse<PlatformLicenseStatus>
);
typed_endpoint!(
    get_ai_employee_market,
    get,
    "/api/settings/ai-employee-market",
    "getAiEmployeeMarket",
    (),
    ApiResponse<Vec<AiEmployeeMarketItem>>
);
typed_endpoint!(
    test_purchase_ai_employee,
    post,
    "/api/settings/ai-employee-market/{employee_id}/test-purchase",
    "testPurchaseAiEmployee",
    (("employee_id" = String, Path)),
    ApiResponse<MarketPurchaseReceipt>
);
endpoint!(
    install_ai_employee,
    post,
    "/api/settings/ai-employee-market/{employee_id}/install",
    "installAiEmployee",
    ("employee_id" = String, Path)
);
typed_endpoint!(
    apply_latest_platform_license,
    post,
    "/api/settings/license/latest",
    "applyLatestPlatformLicense",
    (),
    ApiResponse<PlatformLicenseStatus>
);
typed_endpoint!(
    activate_platform_license,
    post,
    "/api/settings/license",
    "activatePlatformLicense",
    (),
    ActivatePlatformLicenseRequest,
    ApiResponse<PlatformLicenseStatus>
);
typed_endpoint!(
    communication_status,
    get,
    "/api/communication/status",
    "getCommunicationStatus",
    (),
    ApiResponse<CommunicationAvailabilityResponse>
);
typed_endpoint!(
    list_communication_conversations,
    get,
    "/api/communication/conversations",
    "listCommunicationConversations",
    (),
    ApiResponse<Vec<CommunicationConversationResponse>>
);
typed_endpoint!(
    list_communication_users,
    get,
    "/api/communication/users",
    "listCommunicationUsers",
    (("query" = Option<String>, Query)),
    ApiResponse<Vec<CommunicationUserResponse>>
);
typed_endpoint!(
    create_direct_conversation,
    post,
    "/api/communication/conversations/direct",
    "createDirectConversation",
    (),
    CreateDirectConversationRequest,
    ApiResponse<CommunicationConversationResponse>
);
typed_endpoint!(
    create_group_conversation,
    post,
    "/api/communication/conversations/groups",
    "createGroupConversation",
    (),
    CreateGroupConversationRequest,
    ApiResponse<CommunicationConversationResponse>
);
typed_endpoint!(
    update_group_conversation,
    put,
    "/api/communication/conversations/{conversationId}",
    "updateGroupConversation",
    (("conversationId" = String, Path)),
    UpdateGroupConversationRequest,
    ApiResponse<CommunicationConversationResponse>
);
typed_endpoint!(
    transfer_group_owner,
    post,
    "/api/communication/conversations/{conversationId}/owner",
    "transferGroupOwner",
    (("conversationId" = String, Path)),
    TransferGroupOwnerRequest,
    ApiResponse<CommunicationConversationResponse>
);
typed_endpoint!(
    leave_group_conversation,
    post,
    "/api/communication/conversations/{conversationId}/leave",
    "leaveGroupConversation",
    (("conversationId" = String, Path)),
    (),
    ApiResponse<Value>
);
typed_endpoint!(
    delete_group_conversation,
    delete,
    "/api/communication/conversations/{conversationId}/dissolve",
    "deleteGroupConversation",
    (("conversationId" = String, Path)),
    (),
    ApiResponse<Value>
);
typed_endpoint!(list_communication_messages, get, "/api/communication/conversations/{conversationId}/messages", "listCommunicationMessages", (("conversationId" = String, Path), ("beforeSequence" = Option<i64>, Query), ("limit" = Option<u64>, Query)), ApiResponse<CommunicationMessagePageResponse>);
typed_endpoint!(
    send_communication_message,
    post,
    "/api/communication/conversations/{conversationId}/messages",
    "sendCommunicationMessage",
    (("conversationId" = String, Path)),
    SendCommunicationMessageRequest,
    ApiResponse<CommunicationMessageResponse>
);
typed_endpoint!(
    recall_communication_message,
    post,
    "/api/communication/conversations/{conversationId}/messages/{messageId}/recall",
    "recallCommunicationMessage",
    (
        ("conversationId" = String, Path),
        ("messageId" = String, Path)
    ),
    RecallCommunicationMessageRequest,
    ApiResponse<CommunicationMessageResponse>
);
typed_endpoint!(
    reedit_communication_message,
    post,
    "/api/communication/conversations/{conversationId}/messages/{messageId}/reedit",
    "reeditCommunicationMessage",
    (
        ("conversationId" = String, Path),
        ("messageId" = String, Path)
    ),
    ReeditCommunicationMessageRequest,
    ApiResponse<CommunicationMessageResponse>
);
typed_endpoint!(
    mark_communication_conversation_read,
    post,
    "/api/communication/conversations/{conversationId}/read",
    "markCommunicationConversationRead",
    (("conversationId" = String, Path)),
    MarkConversationReadRequest,
    ApiResponse<Value>
);
typed_endpoint!(
    list_locations,
    get,
    "/api/locations",
    "listLocations",
    (("parentCode" = Option<String>, Query), ("depth" = Option<i16>, Query), ("query" = Option<String>, Query), ("limit" = Option<u64>, Query)),
    ApiResponse<Vec<LocationResponse>>
);
typed_endpoint!(
    import_locations,
    post,
    "/api/locations",
    "importLocations",
    (),
    ImportLocationsRequest,
    ApiResponse<usize>
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
    get_system_ai_status,
    get,
    "/api/agent/system-ai/status",
    "getSystemAiStatus",
    (),
    ApiResponse<SystemAiStatusResponse>
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
    create_local_organization_unit,
    post,
    "/api/identity/organization-units",
    "createLocalOrganizationUnit",
    (),
    CreateLocalOrganizationUnitRequest,
    ApiResponse<OrganizationUnitResponse>
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
    initialize_local_credentials,
    post,
    "/api/identity/users/initialize-local-credentials",
    "initializeLocalCredentials",
    (),
    ApiResponse<crate::modules::identity::InitializeLocalCredentialsResponse>
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
    update_agent_session,
    patch,
    "/api/agent/sessions/{sessionId}",
    "updateAgentSession",
    (("sessionId" = String, Path)),
    UpdateAgentSessionRequest,
    ApiResponse<ApiAgentSession>
);
endpoint!(
    delete_agent_session,
    delete,
    "/api/agent/sessions/{sessionId}",
    "deleteAgentSession",
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
    "listAppNavigation",
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
    update_navigation_group,
    patch,
    "/api/apps/{appId}/navigation/groups/{groupId}",
    "updateNavigationGroup",
    (("appId" = String, Path), ("groupId" = String, Path)),
    UpdateNavigationGroupRequest,
    ApiResponse<ApiNavigationItem>
);
typed_endpoint!(
    delete_navigation_group,
    delete,
    "/api/apps/{appId}/navigation/groups/{groupId}",
    "deleteNavigationGroup",
    (("appId" = String, Path), ("groupId" = String, Path)),
    ApiResponse<DeleteNavigationGroupResponse>
);
typed_endpoint!(
    move_form_navigation,
    patch,
    "/api/apps/{appId}/navigation/forms/{formUuid}",
    "moveFormNavigation",
    (("appId" = String, Path), ("formUuid" = String, Path)),
    MoveFormNavigationRequest,
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
typed_endpoint!(
    list_forms,
    get,
    "/api/apps/{appId}/forms",
    "listForms",
    (("appId" = String, Path)),
    ApiResponse<Vec<ApiFormSummary>>
);
typed_endpoint!(
    create_form,
    post,
    "/api/apps/{appId}/forms",
    "createForm",
    (("appId" = String, Path)),
    CreateFormRequest,
    ApiResponse<ApiFormSummary>
);
typed_endpoint!(
    ensure_workflow_process_flow,
    post,
    "/api/forms/{formUuid}/workflow/process",
    "ensureWorkflowProcessFlow",
    (("formUuid" = String, Path)),
    ApiResponse<ApiAutomationFlow>
);
typed_endpoint!(
    list_workflow_comments,
    get,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/comments",
    "listWorkflowComments",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    create_workflow_comment,
    post,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/comments",
    "createWorkflowComment",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    WorkflowCommentRequest,
    ApiResponse<Value>
);
typed_endpoint!(
    list_workflow_tasks,
    get,
    "/api/workflow/tasks",
    "listWorkflowTasks",
    (("appId" = Option<String>, Query), ("scope" = String, Query)),
    ApiResponse<Value>
);
typed_endpoint!(
    get_workflow_record_runtime,
    get,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow",
    "getWorkflowRecordRuntime",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    submit_workflow_record,
    post,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/submit",
    "submitWorkflowRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    reverse_workflow_record,
    post,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/reverse",
    "reverseWorkflowRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    pause_workflow_record,
    post,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/pause",
    "pauseWorkflowRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    WorkflowPauseRequest,
    ApiResponse<Value>
);
typed_endpoint!(
    resume_workflow_record,
    post,
    "/api/forms/{formUuid}/records/{recordUuid}/workflow/resume",
    "resumeWorkflowRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    approve_workflow_task,
    post,
    "/api/workflow/tasks/{taskUuid}/approve",
    "approveWorkflowTask",
    (("taskUuid" = String, Path)),
    WorkflowTaskActionRequest,
    ApiResponse<Value>
);
typed_endpoint!(
    reject_workflow_task,
    post,
    "/api/workflow/tasks/{taskUuid}/reject",
    "rejectWorkflowTask",
    (("taskUuid" = String, Path)),
    WorkflowTaskActionRequest,
    ApiResponse<Value>
);
typed_endpoint!(
    list_workflow_notifications,
    get,
    "/api/workflow/notifications",
    "listWorkflowNotifications",
    (),
    ApiResponse<Value>
);
typed_endpoint!(
    read_workflow_notification,
    post,
    "/api/workflow/notifications/{notificationUuid}/read",
    "readWorkflowNotification",
    (("notificationUuid" = String, Path)),
    ApiResponse<Value>
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
typed_endpoint!(
    retry_automation_flow_run,
    post,
    "/api/automations/{automationId}/runs/{runId}/retry",
    "retryAutomationFlowRun",
    (("automationId" = String, Path), ("runId" = String, Path)),
    ApiResponse<Value>
);
typed_endpoint!(
    retry_automation_flow_run_node,
    post,
    "/api/automations/{automationId}/runs/{runId}/nodes/{nodeKey}/retry",
    "retryAutomationFlowRunNode",
    (
        ("automationId" = String, Path),
        ("runId" = String, Path),
        ("nodeKey" = String, Path)
    ),
    ApiResponse<Value>
);

typed_endpoint!(get_form_schema, get, "/api/forms/{formUuid}/schema", "getFormSchema", (("formUuid" = String, Path), ("version" = Option<i32>, Query)), ApiResponse<ApiSchemaPayload>);
typed_endpoint!(
    get_form_schema_contract,
    get,
    "/api/form-schema-contract",
    "getFormSchemaContract",
    (),
    ApiResponse<serde_json::Value>
);
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
    query_form_records,
    post,
    "/api/forms/{formUuid}/records/query",
    "queryFormRecords",
    (("formUuid" = String, Path)),
    QueryFormRecordsRequest,
    ApiResponse<ApiFormRecordList>
);
typed_endpoint!(get_form_bootstrap, get, "/api/forms/{formUuid}/bootstrap", "getFormBootstrap", (("formUuid" = String, Path), ("appId" = String, Query), ("page" = Option<u64>, Query), ("pageSize" = Option<u64>, Query)), ApiResponse<FormBootstrapResponse>);
typed_endpoint!(
    list_detail_forms,
    get,
    "/api/forms/{formUuid}/detail-forms",
    "listDetailForms",
    (("formUuid" = String, Path)),
    ApiResponse<Vec<ApiDetailForm>>
);
typed_endpoint!(
    create_detail_form,
    post,
    "/api/forms/{formUuid}/detail-forms",
    "createDetailForm",
    (("formUuid" = String, Path)),
    CreateDetailFormRequest,
    ApiResponse<ApiDetailForm>
);
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
typed_endpoint!(
    delete_form_record,
    delete,
    "/api/forms/{formUuid}/records/{recordUuid}",
    "deleteFormRecord",
    (("formUuid" = String, Path), ("recordUuid" = String, Path)),
    ApiResponse<Value>
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
    "/api/forms/{formUuid}/schema",
    "saveFormSchema",
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
typed_endpoint!(
    update_form_name,
    patch,
    "/api/forms/{formUuid}",
    "updateFormName",
    (("formUuid" = String, Path)),
    UpdateFormNameRequest,
    ApiResponse<ApiSchemaPayload>
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
        list_recycle_bin,
        empty_recycle_bin,
        restore_recycle_bin_entry,
        delete_recycle_bin_entry,
        get_recycle_bin_settings,
        update_recycle_bin_settings,
        get_database_settings,
        update_database_settings,
        test_database_connection,
        get_valkey_settings,
        update_valkey_settings,
        test_valkey_connection,
        get_platform_license_status,
        get_ai_employee_market,
        test_purchase_ai_employee,
        install_ai_employee,
        activate_platform_license,
        apply_latest_platform_license,
        get_communication_module_settings,
        update_communication_module_settings,
        get_communication_storage_stats,
        cleanup_communication_data,
        communication_status,
        list_communication_conversations,
        list_communication_users,
        create_direct_conversation,
        create_group_conversation,
        update_group_conversation,
        transfer_group_owner,
        leave_group_conversation,
        delete_group_conversation,
        list_communication_messages,
        send_communication_message,
        recall_communication_message,
        reedit_communication_message,
        mark_communication_conversation_read,
        list_locations,
        import_locations,
        list_providers,
        get_system_ai_status,
        create_provider,
        update_provider,
        delete_provider,
        list_plugins,
        create_plugin,
        update_plugin,
        delete_plugin,
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
        create_local_organization_unit,
        list_users,
        create_local_user,
        initialize_local_credentials,
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
        update_agent_session,
        delete_agent_session,
        list_apps,
        create_app,
        update_app,
        delete_app,
        list_navigation_items,
        reorder_navigation_item,
        set_default_navigation_entry,
        create_navigation_group,
        update_navigation_group,
        delete_navigation_group,
        move_form_navigation,
        get_app_field_outline,
        list_forms,
        create_form,
        ensure_workflow_process_flow,
        list_workflow_comments,
        create_workflow_comment,
        list_workflow_tasks,
        get_workflow_record_runtime,
        submit_workflow_record,
        reverse_workflow_record,
        pause_workflow_record,
        resume_workflow_record,
        approve_workflow_task,
        reject_workflow_task,
        list_workflow_notifications,
        read_workflow_notification,
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
        get_form_schema_contract,
        list_form_views,
        create_form_view,
        update_form_view,
        delete_form_view,
        list_form_records,
        query_form_records,
        get_form_bootstrap,
        list_detail_forms,
        create_detail_form,
        create_form_record,
        update_form_record,
        delete_form_record,
        list_form_versions,
        get_form_version,
        restore_form_version,
        save_form_schema,
        get_form,
        update_form_name,
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
        assert!(value["paths"]["/api/forms/{formUuid}/workflow/process"]["post"].is_object());
        assert!(
            value["paths"]["/api/forms/{formUuid}/records/{recordUuid}/workflow"]["get"]
                .is_object()
        );
        assert!(
            value["paths"]["/api/forms/{formUuid}/records/{recordUuid}/workflow/submit"]["post"]
                .is_object()
        );
        assert!(value["paths"]["/api/workflow/tasks/{taskUuid}/approve"]["post"].is_object());
        assert!(value["paths"]["/api/workflow/tasks"]["get"].is_object());
        assert!(value["paths"]["/api/workflow/notifications"]["get"].is_object());
        assert!(
            value["paths"]["/api/workflow/notifications/{notificationUuid}/read"]["post"]
                .is_object()
        );
        assert!(
            value["paths"]["/api/forms/{formUuid}/records/{recordUuid}/workflow/pause"]["post"]
                .is_object()
        );
        assert!(
            value["paths"]["/api/forms/{formUuid}/records/{recordUuid}/workflow/resume"]["post"]
                .is_object()
        );
        assert!(
            value["paths"]["/api/forms/{formUuid}/records/{recordUuid}/workflow/comments"]["post"]
                .is_object()
        );
        assert!(value["paths"]["/api/locations"]["get"].is_object());
        assert!(value["paths"]["/api/locations"]["post"].is_object());
        assert!(value["paths"]["/api/apps/{appId}/field-outline"]["get"].is_object());
        assert!(value["components"]["schemas"]["FormViewResponse"].is_object());
        assert!(value["components"]["schemas"]["ApiAppFieldOutline"].is_object());
    }
}
