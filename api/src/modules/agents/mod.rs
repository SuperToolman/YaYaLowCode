pub(crate) mod dto;

use axum::http::HeaderMap;
use axum::http::StatusCode;
use sea_orm::sea_query::Expr;
use sea_orm::{ActiveModelTrait, IntoActiveModel};
use std::collections::HashSet;

use crate::infrastructure::entities::{
    agent_pending_action_entity, agent_pending_action_entity::Entity as AgentPendingActionEntity,
};
use crate::modules::forms::{
    create_blank_form, dto::CreateDetailFormRequest, validate_schema_for_form_type,
};
use crate::platform::authorization;
use crate::platform::prelude::*;
use crate::shared::success_response;

pub(crate) use self::dto::{
    AgentPageContext, ApiAgentSession, ApiPendingAgentAction, CreateAgentSessionRequest,
    CreatePendingAgentActionRequest, UpdateAgentSessionRequest,
};

/// Permission checks for approved platform mutations, kept outside Agent execution.
struct PlatformActionAccess {
    grants: HashSet<String>,
}

impl PlatformActionAccess {
    fn new(grants: HashSet<String>) -> Self {
        Self { grants }
    }
    fn has(&self, permission: String) -> bool {
        self.grants.contains("*") || self.grants.contains(&permission)
    }
    fn require_app_access(&self, app_id: &str) -> Result<(), String> {
        if self.grants.contains("*")
            || self.grants.contains("apps.manage")
            || self.has(format!("app:{app_id}:display"))
        {
            Ok(())
        } else {
            Err("application visibility permission denied".to_string())
        }
    }
    fn can_create_form(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:create_form"))
    }
    fn can_edit_form(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:edit_form"))
    }
    fn can_publish_form(&self, form_uuid: &str) -> bool {
        self.has(format!("form:{form_uuid}:publish"))
    }
    fn can_delete_form(&self, form_uuid: &str) -> bool {
        self.has(format!("form:{form_uuid}:delete_form"))
    }
    fn can_manage_navigation_groups(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:create_group"))
    }
    fn can_manage_automations(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:automation"))
    }
}

pub(crate) async fn list_agent_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApiAgentSession>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let sessions = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(user.id)))
        .order_by_desc(agent_session_entity::Column::IsPinned)
        .order_by_desc(agent_session_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let mut response = Vec::with_capacity(sessions.len());
    for session in sessions {
        response.push(ApiAgentSession::from(session));
    }
    Ok(Json(success_response("agent sessions loaded", response)))
}

pub(crate) async fn create_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<CreateAgentSessionRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAgentSession>>), AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access = PlatformActionAccess::new(authorization::grants(&headers, &state).await?);
    let payload = payload.map(|Json(value)| value);
    let context = payload.and_then(|value| value.context).unwrap_or_default();
    if let Some(app_id) = context.app_id.as_deref() {
        access
            .require_app_access(app_id)
            .map_err(AppError::Forbidden)?;
    }
    validate_context_resources(&state.db, &context).await?;
    let now = Utc::now();
    let session = agent_session_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        session_uuid: Set(format!("ASESSION-{}", Uuid::new_v4().simple())),
        agent_id: Set("cordis-runtime".to_string()),
        owner_user_id: Set(Some(user.id)),
        title: Set("新对话".to_string()),
        source: Set("cordis".to_string()),
        is_pinned: Set(false),
        app_route_app_id: Set(context.app_id.clone()),
        context_json: Set(serde_json::to_value(context).unwrap_or_else(|_| json!({}))),
        status: Set("active".to_string()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "agent session created",
            ApiAgentSession::from(session),
        )),
    ))
}

pub(crate) async fn update_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<UpdateAgentSessionRequest>,
) -> Result<Json<ApiResponse<ApiAgentSession>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let mut active: agent_session_entity::ActiveModel = session.into();
    if let Some(title) = payload.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::BadRequest(
                "agent session title is required".to_string(),
            ));
        }
        active.title = Set(truncate_title(title));
    }
    if let Some(is_pinned) = payload.is_pinned {
        active.is_pinned = Set(is_pinned);
    }
    active.updated_at = Set(Utc::now().into());
    let updated = active.update(&state.db).await?;
    Ok(Json(success_response(
        "agent session updated",
        ApiAgentSession::from(updated),
    )))
}

pub(crate) async fn delete_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<StatusCode, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    AgentSessionEntity::delete_by_id(session.id)
        .exec(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn confirm_pending_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, action_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access = PlatformActionAccess::new(authorization::grants(&headers, &state).await?);
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let action = AgentPendingActionEntity::find()
        .filter(agent_pending_action_entity::Column::SessionId.eq(session.id))
        .filter(agent_pending_action_entity::Column::ActionUuid.eq(&action_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("pending action not found".to_string()))?;
    if action.status != "pending" || action.expires_at < Utc::now() {
        return Err(AppError::BadRequest(
            "pending action is no longer available".to_string(),
        ));
    }
    let claimed = AgentPendingActionEntity::update_many()
        .filter(agent_pending_action_entity::Column::Id.eq(action.id))
        .filter(agent_pending_action_entity::Column::Status.eq("pending"))
        .filter(agent_pending_action_entity::Column::ExpiresAt.gte(Utc::now()))
        .col_expr(
            agent_pending_action_entity::Column::Status,
            Expr::value("executing"),
        )
        .col_expr(
            agent_pending_action_entity::Column::ConfirmedAt,
            Expr::value(Utc::now()),
        )
        .exec(&state.db)
        .await?;
    if claimed.rows_affected != 1 {
        return Err(AppError::BadRequest(
            "pending action was already handled".to_string(),
        ));
    }
    let execution = async {
    let result = match action.action_type.as_str() {
        "create_automation_draft" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_manage_automations(app_id) { return Err(AppError::Forbidden("automation permission denied".to_string())); }
            let (_, Json(created)) = crate::modules::automations::create_automation_flow(
                State(state.clone()), Path(app_id.to_string()), Some(Json(crate::modules::automations::dto::CreateAutomationFlowRequest {
                    name: action.payload_json.get("name").and_then(Value::as_str).map(str::to_string),
                    description: action.payload_json.get("description").and_then(Value::as_str).map(str::to_string),
                    trigger_form_uuid: action.payload_json.get("triggerFormUuid").and_then(Value::as_str).map(str::to_string),
                    trigger_event: action.payload_json.get("triggerEvent").and_then(Value::as_str).map(str::to_string), trigger_events: None, operator: Some(user.display_name.clone()),
                }))
            ).await?;
            let Json(updated) = crate::modules::automations::update_automation_flow(
                State(state.clone()), Path(created.data.as_ref().ok_or_else(|| AppError::BadRequest("automation draft missing".to_string()))?.id.clone()), Json(crate::modules::automations::dto::UpdateAutomationFlowRequest {
                    name: None, description: None, status: None, trigger_form_uuid: None, trigger_event: None, trigger_events: None, trigger_config: None,
                    nodes: Some(action.payload_json.get("nodes").cloned().ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?), edges: Some(action.payload_json.get("edges").cloned().ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?), change_summary: Some("Agent confirmed automation draft".to_string()), operator: Some(user.display_name.clone()),
                })
            ).await?;
            let flow = updated.data.ok_or_else(|| AppError::BadRequest("automation update missing".to_string()))?;
            json!({"id": flow.id, "name": flow.name, "status": flow.status, "flowType": flow.flow_type})
        }
        "delete_automation" => {
            let automation_id = action.payload_json.get("automationId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let flow = AutomationFlowEntity::find()
                .filter(automation_flow_entity::Column::FlowUuid.eq(automation_id))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
            if flow.flow_type == "process" { return Err(AppError::BadRequest("process workflow automation cannot be deleted by Agent".to_string())); }
            access.require_app_access(&flow.app_route_app_id).map_err(AppError::Forbidden)?;
            if !access.can_manage_automations(&flow.app_route_app_id) { return Err(AppError::Forbidden("automation permission denied".to_string())); }
            let name = flow.name.clone();
            let _ = crate::modules::automations::delete_automation_flow(
                State(state.clone()),
                Path(automation_id.to_string()),
            ).await?;
            json!({"id": automation_id, "name": name, "deleted": true})
        }
        "create_form_draft" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let name = action.payload_json.get("name").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_create_form(app_id) { return Err(AppError::Forbidden("form creation permission denied".to_string())); }
            let form_type = action.payload_json.get("formType").and_then(Value::as_str).unwrap_or("normal");
            if !matches!(form_type, "normal" | "workflow" | "defined") { return Err(AppError::BadRequest("invalid form type".to_string())); }
            let parent_group_id = action.payload_json.get("parentGroupId").and_then(Value::as_str);
            let form = create_blank_form(&state.db, app_id, Some(name.to_string()), form_type, parent_group_id).await?;
            json!({"id": form.form_uuid, "appId": form.app_route_app_id, "name": form.name, "formType": form.form_type, "status": form.status, "parentGroupId": parent_group_id})
        }
        "move_form_to_group" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let form_uuid = action.payload_json.get("formUuid").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let parent_group_id = action.payload_json.get("parentGroupId").and_then(Value::as_str);
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_edit_form(app_id) { return Err(AppError::Forbidden("form edit permission denied".to_string())); }
            let form = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
                .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
            crate::modules::navigation::move_form_navigation_to_group(
                &state.db,
                app_id,
                form_uuid,
                parent_group_id,
            ).await?;
            json!({"formUuid": form.form_uuid, "name": form.name, "parentGroupId": parent_group_id})
        }
        "create_navigation_group" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let title = action.payload_json.get("title").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let parent_id = action.payload_json.get("parentGroupId").and_then(Value::as_str).map(ToString::to_string);
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_manage_navigation_groups(app_id) { return Err(AppError::Forbidden("navigation group permission denied".to_string())); }
            let (_, Json(response)) = crate::modules::navigation::create_navigation_group(
                State(state.clone()),
                Path(app_id.to_string()),
                Json(crate::modules::navigation::CreateNavigationGroupRequest { title: title.to_string(), parent_id }),
            ).await?;
            let group = response.data.ok_or_else(|| AppError::BadRequest("navigation group response missing data".to_string()))?;
            json!({"id": group.id, "name": group.title, "parentId": group.parent_id})
        }
        "delete_navigation_group" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let group_id = action.payload_json.get("groupId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_manage_navigation_groups(app_id) { return Err(AppError::Forbidden("navigation group permission denied".to_string())); }
            let Json(response) = crate::modules::navigation::delete_navigation_group(
                State(state.clone()),
                Path((app_id.to_string(), group_id.to_string())),
            ).await?;
            let result = response.data.ok_or_else(|| AppError::BadRequest("navigation group response missing data".to_string()))?;
            json!({"id": result.id, "name": result.title, "deleted": true, "reparentedItems": result.reparented_items})
        }
        "create_detail_form_draft" => {
            let source_form_uuid = action.payload_json.get("sourceFormUuid").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let subform_field_id = action.payload_json.get("subformFieldId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let definition = FormDefinitionEntity::find().filter(form_definition_entity::Column::FormUuid.eq(source_form_uuid)).one(&state.db).await?
                .ok_or_else(|| AppError::NotFound("source form not found".to_string()))?;
            access.require_app_access(&definition.app_route_app_id).map_err(AppError::Forbidden)?;
            if !access.can_create_form(&definition.app_route_app_id) { return Err(AppError::Forbidden("form creation permission denied".to_string())); }
            let (_, Json(response)) = crate::modules::forms::create_detail_form(
                State(state.clone()),
                Path(source_form_uuid.to_string()),
                Json(CreateDetailFormRequest {
                    subform_field_id: subform_field_id.to_string(),
                    title: action.payload_json.get("title").and_then(Value::as_str).map(ToString::to_string),
                    primary_display_field_id: action.payload_json.get("primaryDisplayFieldId").and_then(Value::as_str).map(ToString::to_string),
                    secondary_display_field_id: action.payload_json.get("secondaryDisplayFieldId").and_then(Value::as_str).map(ToString::to_string),
                }),
            ).await?;
            let detail = response.data.ok_or_else(|| AppError::BadRequest("detail form response missing data".to_string()))?;
            json!({"id": detail.detail_form_uuid, "sourceFormUuid": detail.source_form_uuid, "subformFieldId": detail.subform_field_id, "title": detail.title, "status": "published"})
        }
        "save_form_schema_draft" => {
            let form_uuid = action.payload_json.get("formUuid").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let schema = action.payload_json.get("schema").cloned().ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let definition = FormDefinitionEntity::find().filter(form_definition_entity::Column::FormUuid.eq(form_uuid)).one(&state.db).await?
                .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
            access.require_app_access(&definition.app_route_app_id).map_err(AppError::Forbidden)?;
            if !access.can_edit_form(&definition.app_route_app_id) { return Err(AppError::Forbidden("form edit permission denied".to_string())); }
            validate_schema_for_form_type(&definition.form_type, &schema)?;
            let now = Utc::now(); let version = definition.latest_schema_version + 1;
            form_schema_entity::ActiveModel { id: Set(Uuid::new_v4()), form_uuid: Set(form_uuid.to_string()), version: Set(version), schema_json: Set(schema), change_log: Set(Some("Agent confirmed schema draft".to_string())), published: Set(false), created_at: Set(now.into()), updated_at: Set(now.into()) }.insert(&state.db).await?;
            let mut form: form_definition_entity::ActiveModel = definition.into_active_model();
            form.draft_schema_version = Set(version); form.latest_schema_version = Set(version); form.updated_at = Set(now.into()); form.update(&state.db).await?;
            json!({"formUuid": form_uuid, "version": version, "status": "draft"})
        }
        "publish_form" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let form_uuid = action.payload_json.get("formUuid").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_publish_form(form_uuid) { return Err(AppError::Forbidden("form publish permission denied".to_string())); }
            let Json(response) = crate::modules::forms::publish_form_schema(State(state.clone()), Path(form_uuid.to_string())).await?;
            let published = response.data.ok_or_else(|| AppError::BadRequest("publish response missing data".to_string()))?;
            json!({"formUuid": published.form_uuid, "version": published.version, "published": true})
        }
        "delete_form" => {
            let app_id = action.payload_json.get("appId").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let form_uuid = action.payload_json.get("formUuid").and_then(Value::as_str).ok_or_else(|| AppError::BadRequest("invalid pending action".to_string()))?;
            let name = action.payload_json.get("name").and_then(Value::as_str).unwrap_or("表单");
            access.require_app_access(app_id).map_err(AppError::Forbidden)?;
            if !access.can_delete_form(form_uuid) { return Err(AppError::Forbidden("form delete permission denied".to_string())); }
            let _ = crate::modules::forms::delete_form(State(state.clone()), Path(form_uuid.to_string())).await?;
            json!({"formUuid": form_uuid, "name": name, "deleted": true})
        }
        _ => return Err(AppError::BadRequest("unsupported pending action".to_string())),
    };
    Ok::<Value, AppError>(result)
    }.await;
    let mut active: agent_pending_action_entity::ActiveModel = action.into();
    match execution {
        Ok(result) => {
            active.status = Set("completed".to_string());
            active.completed_at = Set(Some(Utc::now().into()));
            active.update(&state.db).await?;
            Ok(Json(success_response("pending action completed", result)))
        }
        Err(error) => {
            active.status = Set("failed".to_string());
            active.error_message = Set(Some(format!("{error:?}")));
            active.completed_at = Set(Some(Utc::now().into()));
            active.update(&state.db).await?;
            Err(error)
        }
    }
}

pub(crate) async fn create_pending_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<CreatePendingAgentActionRequest>,
) -> Result<Json<ApiResponse<ApiPendingAgentAction>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    if payload.action_type.trim().is_empty() || payload.summary.trim().is_empty() {
        return Err(AppError::BadRequest(
            "pending action type and summary are required".to_string(),
        ));
    }
    if !is_supported_pending_action(&payload.action_type) {
        return Err(AppError::BadRequest(
            "unsupported pending action type".to_string(),
        ));
    }
    let now = Utc::now();
    let expires_at = payload
        .expires_at
        .as_deref()
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value).map(|date| date.with_timezone(&Utc))
        })
        .transpose()
        .map_err(|_| AppError::BadRequest("invalid pending action expiry".to_string()))?
        .unwrap_or_else(|| now + chrono::Duration::hours(24));
    if expires_at <= now {
        return Err(AppError::BadRequest(
            "pending action expiry must be in the future".to_string(),
        ));
    }
    let action_uuid = format!("AACT-{}", Uuid::new_v4().simple());
    let action = agent_pending_action_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        action_uuid: Set(action_uuid.clone()),
        session_id: Set(session.id),
        action_type: Set(payload.action_type),
        payload_json: Set(payload.payload),
        summary: Set(payload.summary),
        status: Set("pending".to_string()),
        expires_at: Set(expires_at.into()),
        confirmed_at: Set(None),
        error_message: Set(None),
        created_at: Set(now.into()),
        completed_at: Set(None),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "pending action created",
        ApiPendingAgentAction {
            id: action.action_uuid,
            action_type: action.action_type,
            summary: action.summary,
            status: action.status,
            created_at: crate::shared::format_datetime(action.created_at),
            expires_at: crate::shared::format_datetime(action.expires_at),
        },
    )))
}

pub(crate) async fn cancel_pending_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, action_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let updated = AgentPendingActionEntity::update_many()
        .filter(agent_pending_action_entity::Column::SessionId.eq(session.id))
        .filter(agent_pending_action_entity::Column::ActionUuid.eq(&action_uuid))
        .filter(agent_pending_action_entity::Column::Status.eq("pending"))
        .col_expr(
            agent_pending_action_entity::Column::Status,
            Expr::value("cancelled"),
        )
        .col_expr(
            agent_pending_action_entity::Column::CompletedAt,
            Expr::value(Utc::now()),
        )
        .exec(&state.db)
        .await?;
    if updated.rows_affected != 1 {
        return Err(AppError::BadRequest(
            "pending action cannot be cancelled".to_string(),
        ));
    }
    Ok(Json(success_response(
        "pending action cancelled",
        json!({ "id": action_uuid }),
    )))
}

pub(crate) async fn list_pending_actions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiPendingAgentAction>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let actions = AgentPendingActionEntity::find()
        .filter(agent_pending_action_entity::Column::SessionId.eq(session.id))
        .filter(agent_pending_action_entity::Column::Status.eq("pending"))
        .filter(agent_pending_action_entity::Column::ExpiresAt.gte(Utc::now()))
        .order_by_desc(agent_pending_action_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "pending actions loaded",
        actions
            .into_iter()
            .map(|action| ApiPendingAgentAction {
                id: action.action_uuid,
                action_type: action.action_type,
                summary: action.summary,
                status: action.status,
                created_at: crate::shared::format_datetime(action.created_at),
                expires_at: crate::shared::format_datetime(action.expires_at),
            })
            .collect(),
    )))
}

async fn find_owned_session(
    db: &DatabaseConnection,
    session_uuid: &str,
    owner_user_id: Uuid,
) -> Result<agent_session_entity::Model, AppError> {
    AgentSessionEntity::find()
        .filter(agent_session_entity::Column::SessionUuid.eq(session_uuid))
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(owner_user_id)))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("agent session not found".to_string()))
}

async fn validate_context_resources(
    db: &DatabaseConnection,
    context: &AgentPageContext,
) -> Result<(), AppError> {
    if let Some(form_uuid) = context.form_uuid.as_deref() {
        let form = FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
        if context.app_id.as_deref() != Some(form.app_route_app_id.as_str()) {
            return Err(AppError::BadRequest(
                "form context must include its owning application".to_string(),
            ));
        }
    }
    if let Some(automation_id) = context.automation_id.as_deref() {
        let automation = AutomationFlowEntity::find()
            .filter(automation_flow_entity::Column::FlowUuid.eq(automation_id))
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("automation not found".to_string()))?;
        if context.app_id.as_deref() != Some(automation.app_route_app_id.as_str()) {
            return Err(AppError::BadRequest(
                "automation context must include its owning application".to_string(),
            ));
        }
    }
    Ok(())
}

fn truncate_title(content: &str) -> String {
    let mut title = content.chars().take(36).collect::<String>();
    if content.chars().count() > 36 {
        title.push('…');
    }
    title
}

fn is_supported_pending_action(action_type: &str) -> bool {
    matches!(
        action_type,
        "create_automation_draft"
            | "delete_automation"
            | "create_form_draft"
            | "move_form_to_group"
            | "create_navigation_group"
            | "delete_navigation_group"
            | "create_detail_form_draft"
            | "save_form_schema_draft"
            | "publish_form"
            | "delete_form"
    )
}
