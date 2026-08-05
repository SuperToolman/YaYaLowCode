mod capabilities;
pub(crate) mod dto;
mod plugins;
mod runner;
mod tools;

use std::convert::Infallible;
use std::time::Duration;

use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::Sse;
use axum::response::sse::{Event, KeepAlive};
use futures_util::StreamExt;
use rig_core::completion::Message;
use sea_orm::sea_query::Expr;
use sea_orm::{ActiveModelTrait, IntoActiveModel};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::infrastructure::entities::agent_definition_entity::Entity as AgentDefinitionEntity;
use crate::modules::agent_config::resolve_database_agent_runtime;
use crate::modules::forms::{
    create_blank_form, dto::CreateDetailFormRequest, validate_schema_for_form_type,
};
use crate::modules::settings::load_platform_agent_assistant_settings;
use crate::platform::authorization;
use crate::platform::config::AgentDefinition;
use crate::platform::prelude::*;
use crate::shared::success_response;

pub(crate) use self::dto::{
    AgentPageContext, ApiAgentMessage, ApiAgentRunTrace, ApiAgentRunTraceStep, ApiAgentSession,
    ApiAvailableAgent, ApiPendingAgentAction, AvailableAgentsQuery, CreateAgentSessionRequest,
    SendAgentMessageRequest, UpdateAgentSessionRequest,
};
use self::runner::execute_agent_run;

pub(crate) async fn list_available_agents(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AvailableAgentsQuery>,
) -> Result<Json<ApiResponse<Vec<ApiAvailableAgent>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access =
        tools::AgentAccessScope::for_user(authorization::grants(&headers, &state).await?, user.id);
    let default_agent_id = load_platform_agent_assistant_settings(&state.db)
        .await?
        .navigation_agent_id;
    let rows = AgentDefinitionEntity::find().all(&state.db).await?;
    let mut agents = rows
        .into_iter()
        .map(|row| {
            serde_json::from_value::<AgentDefinition>(row.configuration_json)
                .map_err(|error| AppError::BadRequest(format!("invalid stored agent: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|agent| {
            agent.enabled
                && match agent.scope_type.as_str() {
                    "platform" => true,
                    "application" => agent.scope_ref_id.as_deref() == query.app_id.as_deref(),
                    "business" => agent.scope_ref_id.as_deref() == query.business_id.as_deref(),
                    _ => false,
                }
                && (default_agent_id.as_deref() == Some(agent.id.as_str())
                    || access.require_agent_use(&agent.id).is_ok())
        })
        .map(|agent| ApiAvailableAgent {
            id: agent.id,
            name: agent.name,
            description: agent.description,
        })
        .collect::<Vec<_>>();
    agents.sort_by(|left, right| {
        let left_default = default_agent_id.as_deref() == Some(left.id.as_str());
        let right_default = default_agent_id.as_deref() == Some(right.id.as_str());
        right_default
            .cmp(&left_default)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(Json(success_response("available agents loaded", agents)))
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
        response.push(to_api_session(&state, session).await);
    }
    Ok(Json(success_response("agent sessions loaded", response)))
}

pub(crate) async fn create_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<CreateAgentSessionRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAgentSession>>), AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access =
        tools::AgentAccessScope::for_user(authorization::grants(&headers, &state).await?, user.id);
    let payload = payload.map(|Json(value)| value);
    let requested_agent_id = payload.as_ref().and_then(|value| value.agent_id.clone());
    let source =
        normalize_session_source(payload.as_ref().and_then(|value| value.source.as_deref()));
    let context = payload.and_then(|value| value.context).unwrap_or_default();
    if let Some(app_id) = context.app_id.as_deref() {
        access
            .require_app_access(app_id)
            .map_err(AppError::Forbidden)?;
    }
    validate_context_resources(&state.db, &context).await?;
    let runtime = if source == "general" {
        let navigation_agent_id = load_platform_agent_assistant_settings(&state.db)
            .await?
            .navigation_agent_id
            .ok_or_else(|| {
                AppError::BadRequest("请先在 Agent 协助设置中配置平台导航助手".to_string())
            })?;
        let selected_agent_id = requested_agent_id
            .as_deref()
            .unwrap_or(&navigation_agent_id);
        if selected_agent_id != navigation_agent_id {
            access
                .require_agent_use(selected_agent_id)
                .map_err(AppError::Forbidden)?;
        }
        resolve_database_agent_runtime(
            &state,
            Some(selected_agent_id),
            context.app_id.as_deref(),
            context.business_id.as_deref(),
        )
        .await
    } else {
        resolve_database_agent_runtime(
            &state,
            requested_agent_id.as_deref(),
            context.app_id.as_deref(),
            context.business_id.as_deref(),
        )
        .await
    }
    .map_err(AppError::BadRequest)?;
    if source != "general" {
        access
            .require_agent_use(&runtime.agent_id)
            .map_err(AppError::Forbidden)?;
    }
    runtime
        .validate_scope(context.app_id.as_deref(), context.business_id.as_deref())
        .map_err(AppError::Forbidden)?;
    if !runtime.settings.enabled {
        return Err(AppError::BadRequest("agent is disabled".to_string()));
    }
    let now = Utc::now();
    let session = agent_session_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        session_uuid: Set(format!("ASESSION-{}", Uuid::new_v4().simple())),
        agent_id: Set(runtime.agent_id),
        owner_user_id: Set(Some(user.id)),
        title: Set("新对话".to_string()),
        source: Set(source.to_string()),
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
            to_api_session(&state, session).await,
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
        to_api_session(&state, updated).await,
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

pub(crate) async fn get_agent_run_trace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, run_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<ApiAgentRunTrace>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let run = AgentRunEntity::find()
        .filter(agent_run_entity::Column::SessionId.eq(session.id))
        .filter(agent_run_entity::Column::RunUuid.eq(run_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("agent run not found".to_string()))?;
    let steps = AgentRunStepEntity::find()
        .filter(agent_run_step_entity::Column::RunId.eq(run.id))
        .filter(agent_run_step_entity::Column::StepType.eq("tool"))
        .order_by_asc(agent_run_step_entity::Column::StepIndex)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|step| ApiAgentRunTraceStep {
            index: step.step_index,
            tool: step.name,
            arguments: step.input_json,
            summary: json!({ "status": step.status }),
            status: step.status,
        })
        .collect();
    Ok(Json(success_response(
        "agent run trace loaded",
        ApiAgentRunTrace {
            run_id: run.run_uuid,
            status: run.status,
            started_at: run.started_at.to_rfc3339(),
            completed_at: run.completed_at.map(|value| value.to_rfc3339()),
            steps,
        },
    )))
}

pub(crate) async fn confirm_pending_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, action_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access =
        tools::AgentAccessScope::for_user(authorization::grants(&headers, &state).await?, user.id);
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

pub(crate) async fn list_agent_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAgentMessage>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let messages = AgentMessageEntity::find()
        .filter(agent_message_entity::Column::SessionId.eq(session.id))
        .order_by_asc(agent_message_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent messages loaded",
        messages.into_iter().map(ApiAgentMessage::from).collect(),
    )))
}

pub(crate) async fn send_agent_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<SendAgentMessageRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let content = payload.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest(
            "agent message is required".to_string(),
        ));
    }
    let user = authorization::current_user(&headers, &state).await?;
    let access =
        tools::AgentAccessScope::for_user(authorization::grants(&headers, &state).await?, user.id);
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    if session.source == "general" {
        let navigation_agent_id = load_platform_agent_assistant_settings(&state.db)
            .await?
            .navigation_agent_id
            .ok_or_else(|| {
                AppError::BadRequest("请先在 Agent 协助设置中配置平台导航助手".to_string())
            })?;
        if session.agent_id != navigation_agent_id {
            return Err(AppError::BadRequest(
                "平台导航助手已变更，请新建会话后继续".to_string(),
            ));
        }
    }
    let runtime = resolve_database_agent_runtime(&state, Some(&session.agent_id), None, None)
        .await
        .map_err(AppError::BadRequest)?;
    runtime.settings.validate().map_err(AppError::BadRequest)?;
    if !runtime.settings.enabled {
        return Err(AppError::BadRequest("agent is disabled".to_string()));
    }
    let approval_mode = payload
        .approval_mode
        .as_deref()
        .unwrap_or(&runtime.approval_mode)
        .to_string();
    if !matches!(
        approval_mode.as_str(),
        "request_approval" | "approve_on_behalf" | "full_access"
    ) {
        return Err(AppError::BadRequest(
            "invalid Agent approval mode".to_string(),
        ));
    }
    if approval_mode != "request_approval" {
        let mut stale_actions = AgentPendingActionEntity::update_many()
            .filter(agent_pending_action_entity::Column::SessionId.eq(session.id))
            .filter(agent_pending_action_entity::Column::Status.eq("pending"));
        if approval_mode == "approve_on_behalf" {
            stale_actions =
                stale_actions.filter(agent_pending_action_entity::Column::ActionType.is_not_in([
                    "delete_automation",
                    "delete_navigation_group",
                    "delete_form",
                ]));
        }
        stale_actions
            .col_expr(
                agent_pending_action_entity::Column::Status,
                Expr::value("cancelled"),
            )
            .col_expr(
                agent_pending_action_entity::Column::ErrorMessage,
                Expr::value("superseded by current approval mode"),
            )
            .col_expr(
                agent_pending_action_entity::Column::CompletedAt,
                Expr::value(Utc::now()),
            )
            .exec(&state.db)
            .await?;
    }
    let access = access.with_action_execution(
        state.clone(),
        headers.clone(),
        session.session_uuid.clone(),
        approval_mode.clone(),
    );

    let history_models = AgentMessageEntity::find()
        .filter(agent_message_entity::Column::SessionId.eq(session.id))
        .order_by_asc(agent_message_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let mut history = history_models
        .into_iter()
        .filter_map(|message| {
            if message.content.trim().is_empty()
                || message.metadata_json.get("pendingActionId").is_some()
            {
                return None;
            }
            match message.role.as_str() {
                "user" => Some(Message::user(message.content)),
                "assistant" => Some(Message::assistant(message.content)),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    const MAX_AGENT_HISTORY_MESSAGES: usize = 60;
    if history.len() > MAX_AGENT_HISTORY_MESSAGES {
        history.drain(..history.len() - MAX_AGENT_HISTORY_MESSAGES);
    }
    let context = payload
        .context
        .or_else(|| serde_json::from_value::<AgentPageContext>(session.context_json.clone()).ok())
        .unwrap_or_default();
    if let Some(app_id) = context.app_id.as_deref() {
        access
            .require_app_access(app_id)
            .map_err(AppError::Forbidden)?;
    }
    validate_context_resources(&state.db, &context).await?;
    runtime
        .validate_scope(context.app_id.as_deref(), context.business_id.as_deref())
        .map_err(AppError::Forbidden)?;
    let now = Utc::now();

    agent_message_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        message_uuid: Set(format!("AMSG-{}", Uuid::new_v4().simple())),
        session_id: Set(session.id),
        role: Set("user".to_string()),
        content: Set(content.clone()),
        metadata_json: Set(json!({ "context": context })),
        created_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;

    let run = agent_run_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        run_uuid: Set(format!("ARUN-{}", Uuid::new_v4().simple())),
        session_id: Set(session.id),
        status: Set("running".to_string()),
        model: Set(runtime.settings.chat_model.clone()),
        prompt_tokens: Set(0),
        completion_tokens: Set(0),
        error_message: Set(None),
        started_at: Set(now.into()),
        completed_at: Set(None),
    }
    .insert(&state.db)
    .await?;

    let mut session_active: agent_session_entity::ActiveModel = session.clone().into();
    session_active.context_json = Set(serde_json::to_value(&context).unwrap_or_else(|_| json!({})));
    session_active.app_route_app_id = Set(context.app_id.clone());
    session_active.updated_at = Set(now.into());
    session_active.update(&state.db).await?;

    let (event_tx, event_rx) = mpsc::channel::<Event>(64);
    let db = state.db.clone();
    tokio::spawn(async move {
        let _ = event_tx
            .send(
                Event::default()
                    .event("message.started")
                    .data(json!({ "runId": run.run_uuid }).to_string()),
            )
            .await;
        match execute_agent_run(
            db.clone(),
            run.id,
            session.id,
            runtime,
            access,
            context,
            approval_mode,
            content.clone(),
            history,
            event_tx.clone(),
        )
        .await
        {
            Ok(output) => {
                let completed_at = Utc::now();
                let assistant_message = agent_message_entity::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    message_uuid: Set(format!("AMSG-{}", Uuid::new_v4().simple())),
                    session_id: Set(session.id),
                    role: Set("assistant".to_string()),
                    content: Set(output.content.clone()),
                    metadata_json: Set(json!({ "runId": run.run_uuid })),
                    created_at: Set(completed_at.into()),
                }
                .insert(&db)
                .await;

                let persisted_message = match assistant_message {
                    Ok(message) => Some(message),
                    Err(e) => {
                        error!("Failed to persist assistant message: {e}");
                        let _ = event_tx
                            .send(Event::default().event("message.persist_failed").data(
                                json!({ "error": format!("助手消息持久化失败: {e}") }).to_string(),
                            ))
                            .await;
                        None
                    }
                };

                let mut run_active: agent_run_entity::ActiveModel = run.clone().into();
                run_active.status = Set("completed".to_string());
                run_active.prompt_tokens = Set(output.prompt_tokens);
                run_active.completion_tokens = Set(output.completion_tokens);
                run_active.completed_at = Set(Some(completed_at.into()));
                let _ = run_active.update(&db).await;

                let mut session_active: agent_session_entity::ActiveModel = session.into();
                if session_active.title.as_ref() == "新对话" {
                    session_active.title = Set(truncate_title(&content));
                }
                session_active.updated_at = Set(completed_at.into());
                let _ = session_active.update(&db).await;

                if let Some(message) = persisted_message {
                    let _ = event_tx
                        .send(
                            Event::default().event("message.completed").data(
                                json!({
                                    "message": ApiAgentMessage::from(message),
                                    "usage": {
                                        "promptTokens": output.prompt_tokens,
                                        "completionTokens": output.completion_tokens,
                                    }
                                })
                                .to_string(),
                            ),
                        )
                        .await;
                }
                let _ = event_tx
                    .send(Event::default().event("run.completed").data("{}"))
                    .await;
            }
            Err(error) => {
                let completed_at = Utc::now();
                let mut run_active: agent_run_entity::ActiveModel = run.into();
                run_active.status = Set("failed".to_string());
                run_active.error_message = Set(Some(error.clone()));
                run_active.completed_at = Set(Some(completed_at.into()));
                let _ = run_active.update(&db).await;
                let _ = event_tx
                    .send(
                        Event::default()
                            .event("run.failed")
                            .data(json!({ "message": error }).to_string()),
                    )
                    .await;
            }
        }
    });

    let stream = ReceiverStream::new(event_rx).map(Ok::<Event, Infallible>);
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
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

fn normalize_session_source(value: Option<&str>) -> &'static str {
    match value.unwrap_or("general") {
        "schema_analysis" => "schema_analysis",
        "form_fill" => "form_fill",
        _ => "general",
    }
}

async fn to_api_session(state: &AppState, session: agent_session_entity::Model) -> ApiAgentSession {
    let mut api_session = ApiAgentSession::from(session.clone());
    api_session.model_provider =
        resolve_database_agent_runtime(state, Some(&session.agent_id), None, None)
            .await
            .ok()
            .map(|runtime| {
                format!(
                    "{} · {}",
                    runtime.settings.provider, runtime.settings.chat_model
                )
            });
    api_session
}
