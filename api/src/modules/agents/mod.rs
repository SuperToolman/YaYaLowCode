mod action_executor;
mod action_policy;
pub(crate) mod dto;

use axum::http::HeaderMap;
use axum::http::StatusCode;
use sea_orm::ActiveModelTrait;
use sea_orm::sea_query::Expr;
use std::fs;
use std::path::{Path as FsPath, PathBuf};

use self::action_policy::{PlatformActionAccess, is_supported_transaction};
use crate::infrastructure::entities::{
    agent_transaction_entity, agent_transaction_entity::Entity as AgentTransactionEntity,
};
use crate::modules::forms::dto::{CreateDetailFormRequest, SaveSchemaRequest};
use crate::platform::authorization;
use crate::platform::prelude::*;
use crate::shared::success_response;

/// Remove workspaces for sessions archived beyond the configured retention
/// window. This is intentionally run at API startup so single-instance
/// deployments do not require a separate scheduler.
pub(crate) async fn cleanup_expired_agent_workspaces(
    db: &DatabaseConnection,
) -> Result<(), AppError> {
    let settings = crate::platform::config::agent_workspace_settings();
    let cutoff = Utc::now() - chrono::Duration::days(i64::from(settings.retention_days));
    let sessions = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::Status.eq("archived"))
        .filter(agent_session_entity::Column::ArchivedAt.lt(cutoff))
        .all(db)
        .await?;
    let root = PathBuf::from(&settings.root)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&settings.root));
    for session in sessions {
        if let Some(user_id) = session.owner_user_id {
            let workspace = root
                .join(safe_segment(&user_id.to_string()))
                .join(safe_segment(&session.agent_id))
                .join(safe_segment(&session.session_uuid));
            if is_within(&root, &workspace) && workspace.exists() {
                fs::remove_dir_all(&workspace).map_err(AppError::Server)?;
            }
        }
    }
    Ok(())
}

fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}
fn is_within(root: &FsPath, path: &FsPath) -> bool {
    path == root || path.starts_with(root)
}

pub(crate) use self::dto::{
    AgentPageContext, ApiAgentSession, ApiAgentTransaction, CreateAgentSessionRequest,
    CreateAgentTransactionRequest, RuntimeSessionAccessQuery, UpdateAgentSessionRequest,
};

pub(crate) async fn list_agent_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApiAgentSession>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let sessions = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(user.id)))
        .filter(agent_session_entity::Column::Status.eq("active"))
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

/// Internal runtime guard for the separate DSH process. The platform database
/// remains the source of truth for the user/employee/session relationship.
pub(crate) async fn runtime_session_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Query(query): Query<RuntimeSessionAccessQuery>,
) -> Result<Json<ApiResponse<ApiAgentSession>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    if let Some(agent_id) = query
        .agent_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if session.agent_id != agent_id {
            return Err(AppError::Forbidden(
                "agent session belongs to a different AI employee".to_string(),
            ));
        }
    }
    Ok(Json(success_response(
        "agent session access granted",
        ApiAgentSession::from(session),
    )))
}

pub(crate) async fn create_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<CreateAgentSessionRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAgentSession>>), AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access = PlatformActionAccess::new(authorization::grants(&headers, &state).await?);
    let payload = payload.map(|Json(value)| value);
    let agent_id = payload
        .as_ref()
        .and_then(|value| value.agent_id.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("cordis-default")
        .to_string();
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
        agent_id: Set(agent_id),
        owner_user_id: Set(Some(user.id)),
        title: Set("新对话".to_string()),
        source: Set("cordis".to_string()),
        is_pinned: Set(false),
        app_route_app_id: Set(context.app_id.clone()),
        context_json: Set(serde_json::to_value(context).unwrap_or_else(|_| json!({}))),
        status: Set("active".to_string()),
        archived_at: Set(None),
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

    // Mark as archived in database
    let mut active: agent_session_entity::ActiveModel = session.clone().into();
    active.status = Set("archived".to_string());
    active.archived_at = Set(Some(Utc::now().into()));
    active.is_pinned = Set(false);
    active.updated_at = Set(Utc::now().into());
    active.update(&state.db).await?;

    // Immediately clean up workspace to free disk space
    if let Some(user_id) = session.owner_user_id {
        let settings = crate::platform::config::agent_workspace_settings();
        let root = std::path::PathBuf::from(&settings.root);
        let workspace = root
            .join(safe_segment(&user_id.to_string()))
            .join(safe_segment(&session.agent_id))
            .join(safe_segment(&session.session_uuid));

        if workspace.exists() && is_within(&root, &workspace) {
            let _ = std::fs::remove_dir_all(&workspace);
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn execute_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, action_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let access = PlatformActionAccess::new(authorization::grants(&headers, &state).await?);
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let action = AgentTransactionEntity::find()
        .filter(agent_transaction_entity::Column::SessionId.eq(session.id))
        .filter(agent_transaction_entity::Column::ActionUuid.eq(&action_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("transaction not found".to_string()))?;
    if action.status != "pending" || action.expires_at < Utc::now() {
        return Err(AppError::BadRequest(
            "transaction is no longer available".to_string(),
        ));
    }
    // Enforce the employee's action policy again at the Rust trust boundary.
    // The Host check is only a UX guard and must not be authoritative.
    if session.agent_id != "cordis-default" && session.agent_id != "cordis-runtime" {
        let Json(runtime_response) = crate::modules::settings::list_runtime_ai_employees().await?;
        let employee = runtime_response
            .data
            .and_then(|employees| {
                employees
                    .into_iter()
                    .find(|item| item.id == session.agent_id)
            })
            .ok_or_else(|| AppError::Forbidden("AI employee is not available".to_string()))?;
        if !employee
            .allowed_tools
            .iter()
            .any(|tool| tool == &action.action_type)
        {
            return Err(AppError::Forbidden(
                "AI employee does not allow this platform action".to_string(),
            ));
        }
    }
    let claimed = AgentTransactionEntity::update_many()
        .filter(agent_transaction_entity::Column::Id.eq(action.id))
        .filter(agent_transaction_entity::Column::Status.eq("pending"))
        .filter(agent_transaction_entity::Column::ExpiresAt.gte(Utc::now()))
        .col_expr(
            agent_transaction_entity::Column::Status,
            Expr::value("executing"),
        )
        .col_expr(
            agent_transaction_entity::Column::ConfirmedAt,
            Expr::value(Utc::now()),
        )
        .exec(&state.db)
        .await?;
    if claimed.rows_affected != 1 {
        return Err(AppError::BadRequest(
            "transaction was already handled".to_string(),
        ));
    }
    let execution = action_executor::execute_action(
        state.clone(),
        headers.clone(),
        user.display_name.clone(),
        access,
        action.clone(),
    )
    .await;
    let mut active: agent_transaction_entity::ActiveModel = action.into();
    match execution {
        Ok(result) => {
            active.status = Set("completed".to_string());
            active.completed_at = Set(Some(Utc::now().into()));
            active.update(&state.db).await?;
            Ok(Json(success_response("transaction completed", result)))
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

pub(crate) async fn create_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<CreateAgentTransactionRequest>,
) -> Result<Json<ApiResponse<ApiAgentTransaction>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    if payload.action_type.trim().is_empty() || payload.summary.trim().is_empty() {
        return Err(AppError::BadRequest(
            "transaction type and summary are required".to_string(),
        ));
    }
    if !is_supported_transaction(&payload.action_type) {
        return Err(AppError::BadRequest(
            "unsupported transaction type".to_string(),
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
        .map_err(|_| AppError::BadRequest("invalid transaction expiry".to_string()))?
        .unwrap_or_else(|| now + chrono::Duration::hours(24));
    if expires_at <= now {
        return Err(AppError::BadRequest(
            "transaction expiry must be in the future".to_string(),
        ));
    }
    let action_uuid = format!("AACT-{}", Uuid::new_v4().simple());
    let action = agent_transaction_entity::ActiveModel {
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
        "transaction created",
        ApiAgentTransaction {
            id: action.action_uuid,
            action_type: action.action_type,
            summary: action.summary,
            status: action.status,
            created_at: crate::shared::format_datetime(action.created_at),
            expires_at: crate::shared::format_datetime(action.expires_at),
        },
    )))
}

pub(crate) async fn cancel_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((session_uuid, action_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let updated = AgentTransactionEntity::update_many()
        .filter(agent_transaction_entity::Column::SessionId.eq(session.id))
        .filter(agent_transaction_entity::Column::ActionUuid.eq(&action_uuid))
        .filter(agent_transaction_entity::Column::Status.eq("pending"))
        .col_expr(
            agent_transaction_entity::Column::Status,
            Expr::value("cancelled"),
        )
        .col_expr(
            agent_transaction_entity::Column::CompletedAt,
            Expr::value(Utc::now()),
        )
        .exec(&state.db)
        .await?;
    if updated.rows_affected != 1 {
        return Err(AppError::BadRequest(
            "transaction cannot be cancelled".to_string(),
        ));
    }
    Ok(Json(success_response(
        "transaction cancelled",
        json!({ "id": action_uuid }),
    )))
}

pub(crate) async fn list_transactions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAgentTransaction>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let actions = AgentTransactionEntity::find()
        .filter(agent_transaction_entity::Column::SessionId.eq(session.id))
        .filter(agent_transaction_entity::Column::Status.eq("pending"))
        .filter(agent_transaction_entity::Column::ExpiresAt.gte(Utc::now()))
        .order_by_desc(agent_transaction_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "transactions loaded",
        actions
            .into_iter()
            .map(|action| ApiAgentTransaction {
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

pub(crate) async fn find_owned_session(
    db: &DatabaseConnection,
    session_uuid: &str,
    owner_user_id: Uuid,
) -> Result<agent_session_entity::Model, AppError> {
    AgentSessionEntity::find()
        .filter(agent_session_entity::Column::SessionUuid.eq(session_uuid))
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(owner_user_id)))
        .filter(agent_session_entity::Column::Status.eq("active"))
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
