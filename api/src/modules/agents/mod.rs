mod action_executor;
mod action_policy;
pub(crate) mod dto;

use axum::http::HeaderMap;
use axum::http::StatusCode;
use base64::Engine;
use sea_orm::Condition;
use sea_orm::sea_query::{Expr, Order};
use sea_orm::{ActiveModelTrait, ConnectionTrait, DbBackend, QuerySelect, Statement};
use std::fs;
use std::path::{Path as FsPath, PathBuf};

use self::action_policy::{PlatformActionAccess, is_supported_transaction};
use crate::infrastructure::entities::{
    agent_session_runtime_summary_entity,
    agent_session_runtime_summary_entity::Entity as AgentSessionRuntimeSummaryEntity,
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

/// Consume the one-time native Workbench reset marker. The workspace root is
/// exclusively owned by Agent sessions, so only its children are removed.
pub(crate) async fn cleanup_native_workbench_reset(
    db: &DatabaseConnection,
) -> Result<(), AppError> {
    let Some(marker) = db.query_one_raw(Statement::from_string(
        DbBackend::Postgres,
        "SELECT workspace_cleanup_completed FROM agent_runtime_reset_markers WHERE version = 'native-workbench-v1'".to_string(),
    )).await? else {
        return Ok(());
    };
    if marker.try_get::<bool>("", "workspace_cleanup_completed")? {
        return Ok(());
    }
    let root = PathBuf::from(&crate::platform::config::agent_workspace_settings().root);
    let canonical_root = root.canonicalize().unwrap_or(root.clone());
    if canonical_root.as_os_str().is_empty() || canonical_root.parent().is_none() {
        return Err(AppError::Server(std::io::Error::other(
            "invalid agent workspace root",
        )));
    }
    if canonical_root.exists() {
        for entry in fs::read_dir(&canonical_root).map_err(AppError::Server)? {
            let path = entry.map_err(AppError::Server)?.path();
            if !is_within(&canonical_root, &path) {
                return Err(AppError::Server(std::io::Error::other(
                    "agent workspace cleanup escaped root",
                )));
            }
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(AppError::Server)?;
            } else {
                fs::remove_file(path).map_err(AppError::Server)?;
            }
        }
    }
    // Mark completion only after every workspace child has been removed. A
    // failed cleanup remains retryable on the next API startup.
    db.execute_raw(Statement::from_string(
        DbBackend::Postgres,
        "UPDATE agent_runtime_reset_markers SET workspace_cleanup_completed = TRUE WHERE version = 'native-workbench-v1'".to_string(),
    )).await?;
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
    AgentPageContext, AgentWorkbenchSessionsQuery, ApiAgentRuntimeSummary, ApiAgentSession,
    ApiAgentTransaction, ApiAgentWorkbenchSession, ApiAgentWorkbenchSessionPage,
    CreateAgentSessionRequest, CreateAgentTransactionRequest, ReconcileAgentSessionRequest,
    RuntimeSessionAccessQuery, UpdateAgentSessionRequest, UpsertAgentRuntimeSummaryRequest,
};

const TERMINAL_RUN_STATUSES: [&str; 4] = ["idle", "completed", "stopped", "failed"];
const VALID_RUN_STATUSES: [&str; 8] = [
    "idle",
    "queued",
    "running",
    "waiting_approval",
    "completed",
    "stopped",
    "failed",
    "unknown",
];

fn is_active_run_status(status: &str) -> bool {
    matches!(status, "running" | "queued" | "waiting_approval")
}

/// Runtime summaries are a lossy directory projection. A retry from the same
/// generation must never overwrite a newer event, while a new generation is a
/// deliberate reset and may restart its sequence at zero.
fn should_apply_runtime_summary(
    existing_generation: &str,
    existing_last_seq: i64,
    incoming_generation: &str,
    incoming_last_seq: i64,
) -> bool {
    existing_generation != incoming_generation || incoming_last_seq > existing_last_seq
}

struct DirectoryCursor {
    is_pinned: bool,
    active_rank: i32,
    last_activity_at: chrono::DateTime<Utc>,
    session_uuid: String,
}

pub(crate) async fn list_agent_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApiAgentSession>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let grants = authorization::grants(&headers, &state).await?;
    let sessions = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(user.id)))
        .filter(agent_session_entity::Column::Status.eq("active"))
        .order_by_desc(agent_session_entity::Column::IsPinned)
        .order_by_desc(agent_session_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let mut response = Vec::with_capacity(sessions.len());
    for session in sessions {
        if !grants.contains("*") && !grants.contains(&format!("agent:{}:use", session.agent_id)) {
            continue;
        }
        response.push(ApiAgentSession::from(session));
    }
    Ok(Json(success_response("agent sessions loaded", response)))
}

/// The archive is deliberately separate from the Workbench directory: it is
/// an owner-scoped settings surface, not another session state in chat UI.
pub(crate) async fn list_archived_agent_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApiAgentSession>>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let sessions = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(user.id)))
        .filter(agent_session_entity::Column::Status.eq("archived"))
        .order_by_desc(agent_session_entity::Column::ArchivedAt)
        .order_by_desc(agent_session_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "archived agent sessions loaded",
        sessions.into_iter().map(ApiAgentSession::from).collect(),
    )))
}

/// Cursor-paginated session directory for the native DSH workbench. Runtime
/// state is read from a compact projection instead of opening every DSH log.
pub(crate) async fn list_agent_workbench_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AgentWorkbenchSessionsQuery>,
) -> Result<Json<ApiResponse<ApiAgentWorkbenchSessionPage>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let limit = query.limit.unwrap_or(40).clamp(1, 100);
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_directory_cursor)
        .transpose()?;
    let mut filters = Condition::all()
        .add(agent_session_entity::Column::OwnerUserId.eq(Some(user.id)))
        .add(agent_session_entity::Column::Status.eq("active"));
    let grants = authorization::grants(&headers, &state).await?;
    if !grants.contains("*") {
        let employees = grants
            .iter()
            .filter_map(|grant| {
                grant
                    .strip_prefix("agent:")
                    .and_then(|rest| rest.strip_suffix(":use"))
            })
            .map(str::to_string)
            .collect::<Vec<_>>();
        filters = filters.add(agent_session_entity::Column::AgentId.is_in(employees));
    }
    if let Some(agent_id) = query
        .agent_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        filters = filters.add(agent_session_entity::Column::AgentId.eq(agent_id));
    }
    if let Some(run_status) = query
        .run_status
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if !VALID_RUN_STATUSES.contains(&run_status) {
            return Err(AppError::BadRequest("invalid agent run status".to_string()));
        }
        filters =
            filters.add(agent_session_runtime_summary_entity::Column::RunStatus.eq(run_status));
    }
    if let Some(search) = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if search.len() > 160 {
            return Err(AppError::BadRequest(
                "agent session search is too long".to_string(),
            ));
        }
        filters = filters.add(agent_session_entity::Column::Title.contains(search));
    }
    if let Some(cursor) = cursor.as_ref() {
        let cursor_rank_condition = if cursor.active_rank == 1 {
            agent_session_runtime_summary_entity::Column::RunStatus.is_in([
                "running",
                "queued",
                "waiting_approval",
            ])
        } else {
            agent_session_runtime_summary_entity::Column::RunStatus.is_not_in([
                "running",
                "queued",
                "waiting_approval",
            ])
        };
        let mut after_cursor = Condition::any()
            .add(agent_session_entity::Column::IsPinned.lt(cursor.is_pinned))
            .add(
                Condition::all()
                    .add(agent_session_entity::Column::IsPinned.eq(cursor.is_pinned))
                    .add(cursor_rank_condition.clone())
                    .add(
                        agent_session_runtime_summary_entity::Column::LastActivityAt
                            .lt(cursor.last_activity_at),
                    ),
            )
            .add(
                Condition::all()
                    .add(agent_session_entity::Column::IsPinned.eq(cursor.is_pinned))
                    .add(cursor_rank_condition)
                    .add(
                        agent_session_runtime_summary_entity::Column::LastActivityAt
                            .eq(cursor.last_activity_at),
                    )
                    .add(agent_session_entity::Column::SessionUuid.gt(cursor.session_uuid.clone())),
            );
        if cursor.active_rank == 1 {
            after_cursor = after_cursor.add(
                Condition::all()
                    .add(agent_session_entity::Column::IsPinned.eq(cursor.is_pinned))
                    .add(
                        agent_session_runtime_summary_entity::Column::RunStatus.is_not_in([
                            "running",
                            "queued",
                            "waiting_approval",
                        ]),
                    ),
            );
        }
        filters = filters.add(after_cursor);
    }
    let rows = AgentSessionRuntimeSummaryEntity::find()
        .find_also_related(AgentSessionEntity)
        .filter(filters)
        .order_by_desc(agent_session_entity::Column::IsPinned)
        .order_by(Expr::cust("CASE WHEN agent_session_runtime_summaries.run_status IN ('running', 'queued', 'waiting_approval') THEN 1 ELSE 0 END"), Order::Desc)
        .order_by_desc(agent_session_runtime_summary_entity::Column::LastActivityAt)
        .order_by_asc(agent_session_entity::Column::SessionUuid)
        .limit(limit + 1)
        .all(&state.db)
        .await?;
    let has_next = rows.len() > limit as usize;
    let rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let next_cursor = if has_next {
        rows.last().and_then(|(summary, session)| {
            session.as_ref().map(|session| {
                encode_directory_cursor(
                    session.is_pinned,
                    if is_active_run_status(&summary.run_status) {
                        1
                    } else {
                        0
                    },
                    summary.last_activity_at,
                    &session.session_uuid,
                )
            })
        })
    } else {
        None
    };
    let items = rows
        .into_iter()
        .filter_map(|(summary, session)| {
            session.map(|session| ApiAgentWorkbenchSession {
                session: ApiAgentSession::from(session),
                runtime: runtime_summary_response(summary),
            })
        })
        .collect();
    Ok(Json(success_response(
        "agent workbench sessions loaded",
        ApiAgentWorkbenchSessionPage { items, next_cursor },
    )))
}

/// The DSH Host writes this projection after a canonical event is durable.
/// It requires both the user's normal session access and the runtime secret.
pub(crate) async fn upsert_agent_runtime_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
    Json(payload): Json<UpsertAgentRuntimeSummaryRequest>,
) -> Result<Json<ApiResponse<ApiAgentRuntimeSummary>>, AppError> {
    require_agent_runtime_secret(&headers)?;
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_session(&state.db, &session_uuid, user.id).await?;
    let summary = update_runtime_summary(&state.db, session.id, payload).await?;
    Ok(Json(success_response(
        "agent runtime summary updated",
        runtime_summary_response(summary),
    )))
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

/// Reconciles a DSH-created session into the Rust ownership boundary. The
/// caller must prove both the user's access and the host runtime credential.
pub(crate) async fn reconcile_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ReconcileAgentSessionRequest>,
) -> Result<Json<ApiResponse<ApiAgentSession>>, AppError> {
    require_agent_runtime_secret(&headers)?;
    let user = authorization::current_user(&headers, &state).await?;
    let session_uuid = payload.session_uuid.trim();
    if session_uuid.is_empty() || session_uuid.len() > 160 {
        return Err(AppError::BadRequest("invalid agent session id".to_string()));
    }
    let parent = match payload
        .parent_session_uuid
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(parent_uuid) => Some(find_owned_session(&state.db, parent_uuid, user.id).await?),
        None => None,
    };
    if let Some(existing) = AgentSessionEntity::find()
        .filter(agent_session_entity::Column::SessionUuid.eq(session_uuid))
        .one(&state.db)
        .await?
    {
        if existing.owner_user_id != Some(user.id) {
            return Err(AppError::Forbidden(
                "agent session belongs to another user".to_string(),
            ));
        }
        let grants = authorization::grants(&headers, &state).await?;
        if !grants.contains("*") && !grants.contains(&format!("agent:{}:use", existing.agent_id)) {
            return Err(AppError::Forbidden("无权使用此 AI 员工".into()));
        }
        return Ok(Json(success_response(
            "agent session reconciled",
            ApiAgentSession::from(existing),
        )));
    }
    let agent_id = payload
        .agent_id
        .filter(|value| !value.trim().is_empty())
        .or_else(|| parent.as_ref().map(|value| value.agent_id.clone()))
        .unwrap_or_else(|| "cordis-default".to_string());
    let actor_grants = authorization::grants(&headers, &state).await?;
    if !actor_grants.contains("*") && !actor_grants.contains(&format!("agent:{agent_id}:use")) {
        return Err(AppError::Forbidden("无权使用此 AI 员工".into()));
    }
    let context = payload
        .context
        .or_else(|| {
            parent
                .as_ref()
                .and_then(|value| serde_json::from_value(value.context_json.clone()).ok())
        })
        .unwrap_or_default();
    validate_context_resources(&state.db, &context).await?;
    let now = Utc::now();
    let title = payload
        .title
        .as_deref()
        .map(truncate_title)
        .unwrap_or_else(|| "新对话".to_string());
    let session = agent_session_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        session_uuid: Set(session_uuid.to_string()),
        parent_session_id: Set(parent.map(|value| value.id)),
        agent_id: Set(agent_id),
        owner_user_id: Set(Some(user.id)),
        title: Set(title),
        source: Set("dsh".to_string()),
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
    agent_session_runtime_summary_entity::ActiveModel {
        session_id: Set(session.id),
        event_generation: Set("initial".to_string()),
        last_event_seq: Set(-1),
        run_status: Set("idle".to_string()),
        phase: Set(None),
        last_tool_name: Set(None),
        last_error: Set(None),
        pending_approval_count: Set(0),
        unread_activity_version: Set(0),
        last_activity_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "agent session reconciled",
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
    let requested_agent_id = payload
        .as_ref()
        .and_then(|value| value.agent_id.as_deref())
        .filter(|value| !value.trim().is_empty())
        .map(str::trim);
    // A native DSH session is always bound to a licensed, installed employee.
    // Do this before writing agent_sessions so a missing/default legacy id
    // cannot leave an unusable workbench row behind.
    let Json(runtime_employees) = crate::modules::settings::list_runtime_ai_employees().await?;
    let actor_grants = authorization::grants(&headers, &state).await?;
    let available_employees = runtime_employees
        .data
        .unwrap_or_default()
        .into_iter()
        .filter(|employee| {
            actor_grants.contains("*")
                || actor_grants.contains(&format!("agent:{}:use", employee.id))
        })
        .collect::<Vec<_>>();
    let agent_id = match requested_agent_id {
        Some(agent_id)
            if available_employees
                .iter()
                .any(|employee| employee.id == agent_id) =>
        {
            agent_id.to_string()
        }
        Some(_) => {
            return Err(AppError::BadRequest(
                "AI 员工未安装、已过期或无权使用".to_string(),
            ));
        }
        None => available_employees
            .first()
            .map(|employee| employee.id.clone())
            .ok_or_else(|| {
                AppError::BadRequest(
                    "没有可用的已安装 AI 员工，请先在 AI 员工市场安装并授权".to_string(),
                )
            })?,
    };
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
        parent_session_id: Set(None),
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
    let now = Utc::now();
    agent_session_runtime_summary_entity::ActiveModel {
        session_id: Set(session.id),
        event_generation: Set("initial".to_string()),
        last_event_seq: Set(-1),
        run_status: Set("idle".to_string()),
        phase: Set(None),
        last_tool_name: Set(None),
        last_error: Set(None),
        pending_approval_count: Set(0),
        unread_activity_version: Set(0),
        last_activity_at: Set(now.into()),
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

    let runtime = AgentSessionRuntimeSummaryEntity::find_by_id(session.id)
        .one(&state.db)
        .await?;
    if runtime
        .as_ref()
        .is_some_and(|summary| !TERMINAL_RUN_STATUSES.contains(&summary.run_status.as_str()))
    {
        return Err(AppError::BadRequest(
            "stop the active agent run before archiving this session".to_string(),
        ));
    }

    // Mark as archived only after the runtime is terminal. The DSH Host owns
    // cancellation so deleting a session never removes a live workspace.
    let mut active: agent_session_entity::ActiveModel = session.clone().into();
    active.status = Set("archived".to_string());
    active.archived_at = Set(Some(Utc::now().into()));
    active.is_pinned = Set(false);
    active.updated_at = Set(Utc::now().into());
    active.update(&state.db).await?;

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn restore_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<Json<ApiResponse<ApiAgentSession>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_archived_session(&state.db, &session_uuid, user.id).await?;
    let mut active: agent_session_entity::ActiveModel = session.into();
    active.status = Set("active".to_string());
    active.archived_at = Set(None);
    active.updated_at = Set(Utc::now().into());
    let restored = active.update(&state.db).await?;
    Ok(Json(success_response(
        "agent session restored",
        ApiAgentSession::from(restored),
    )))
}

pub(crate) async fn purge_archived_agent_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_uuid): Path<String>,
) -> Result<StatusCode, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let session = find_owned_archived_session(&state.db, &session_uuid, user.id).await?;
    remove_session_workspace(&session)?;
    session.delete(&state.db).await?;
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

async fn find_owned_archived_session(
    db: &DatabaseConnection,
    session_uuid: &str,
    owner_user_id: Uuid,
) -> Result<agent_session_entity::Model, AppError> {
    AgentSessionEntity::find()
        .filter(agent_session_entity::Column::SessionUuid.eq(session_uuid))
        .filter(agent_session_entity::Column::OwnerUserId.eq(Some(owner_user_id)))
        .filter(agent_session_entity::Column::Status.eq("archived"))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("archived agent session not found".to_string()))
}

fn remove_session_workspace(session: &agent_session_entity::Model) -> Result<(), AppError> {
    let Some(user_id) = session.owner_user_id else {
        return Ok(());
    };
    let root = PathBuf::from(&crate::platform::config::agent_workspace_settings().root);
    let canonical_root = root.canonicalize().unwrap_or(root);
    let workspace = canonical_root
        .join(safe_segment(&user_id.to_string()))
        .join(safe_segment(&session.agent_id))
        .join(safe_segment(&session.session_uuid));
    if !is_within(&canonical_root, &workspace) {
        return Err(AppError::Server(std::io::Error::other(
            "agent workspace purge escaped root",
        )));
    }
    if workspace.exists() {
        fs::remove_dir_all(workspace).map_err(AppError::Server)?;
    }
    Ok(())
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

fn parse_directory_cursor(value: &str) -> Result<DirectoryCursor, AppError> {
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::BadRequest("invalid agent session cursor".to_string()))?;
    let decoded = String::from_utf8(decoded)
        .map_err(|_| AppError::BadRequest("invalid agent session cursor".to_string()))?;
    let mut parts = decoded.splitn(4, '|');
    let is_pinned = match parts.next() {
        Some("1") => true,
        Some("0") => false,
        _ => {
            return Err(AppError::BadRequest(
                "invalid agent session cursor".to_string(),
            ));
        }
    };
    let active_rank = parts
        .next()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|value| *value == 0 || *value == 1)
        .ok_or_else(|| AppError::BadRequest("invalid agent session cursor".to_string()))?;
    let last_activity_at = parts
        .next()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| AppError::BadRequest("invalid agent session cursor".to_string()))?;
    let session_uuid = parts
        .next()
        .filter(|value| !value.is_empty() && value.len() <= 160)
        .ok_or_else(|| AppError::BadRequest("invalid agent session cursor".to_string()))?
        .to_string();
    Ok(DirectoryCursor {
        is_pinned,
        active_rank,
        last_activity_at,
        session_uuid,
    })
}

fn encode_directory_cursor(
    is_pinned: bool,
    active_rank: i32,
    last_activity_at: chrono::DateTime<Utc>,
    session_uuid: &str,
) -> String {
    let value = format!(
        "{}|{}|{}|{}",
        if is_pinned { "1" } else { "0" },
        active_rank,
        last_activity_at.to_rfc3339(),
        session_uuid
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value)
}

fn runtime_summary_response(
    summary: agent_session_runtime_summary_entity::Model,
) -> ApiAgentRuntimeSummary {
    ApiAgentRuntimeSummary {
        event_generation: summary.event_generation,
        last_event_seq: summary.last_event_seq,
        run_status: summary.run_status,
        phase: summary.phase,
        last_tool_name: summary.last_tool_name,
        last_error: summary.last_error,
        pending_approval_count: summary.pending_approval_count,
        unread_activity_version: summary.unread_activity_version,
        last_activity_at: crate::shared::format_datetime(summary.last_activity_at),
    }
}

fn require_agent_runtime_secret(headers: &HeaderMap) -> Result<(), AppError> {
    let expected = std::env::var("AGENT_RUNTIME_SHARED_SECRET").map_err(|_| {
        AppError::Forbidden("Agent Runtime internal credential is not configured".to_string())
    })?;
    let supplied = headers
        .get("x-agent-runtime-secret")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if expected.is_empty() || supplied != expected {
        return Err(AppError::Forbidden(
            "Agent Runtime internal credential is invalid".to_string(),
        ));
    }
    Ok(())
}

async fn update_runtime_summary(
    db: &DatabaseConnection,
    session_id: Uuid,
    payload: UpsertAgentRuntimeSummaryRequest,
) -> Result<agent_session_runtime_summary_entity::Model, AppError> {
    let generation = payload.event_generation.trim();
    if generation.is_empty() || generation.len() > 120 {
        return Err(AppError::BadRequest(
            "invalid runtime event generation".to_string(),
        ));
    }
    if payload.last_event_seq < -1 {
        return Err(AppError::BadRequest(
            "invalid runtime event sequence".to_string(),
        ));
    }
    if !VALID_RUN_STATUSES.contains(&payload.run_status.as_str()) {
        return Err(AppError::BadRequest("invalid agent run status".to_string()));
    }
    if payload.pending_approval_count < 0 || payload.unread_activity_version < 0 {
        return Err(AppError::BadRequest(
            "invalid runtime activity counters".to_string(),
        ));
    }
    for value in [payload.phase.as_deref(), payload.last_tool_name.as_deref()] {
        if value.is_some_and(|value| value.len() > 255) {
            return Err(AppError::BadRequest(
                "runtime summary field is too long".to_string(),
            ));
        }
    }
    if payload
        .last_error
        .as_ref()
        .is_some_and(|value| value.len() > 16_000)
    {
        return Err(AppError::BadRequest(
            "runtime error is too long".to_string(),
        ));
    }
    let last_activity_at = payload
        .last_activity_at
        .as_deref()
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value).map(|value| value.with_timezone(&Utc))
        })
        .transpose()
        .map_err(|_| AppError::BadRequest("invalid runtime activity timestamp".to_string()))?
        .unwrap_or_else(Utc::now);

    let existing = AgentSessionRuntimeSummaryEntity::find_by_id(session_id)
        .one(db)
        .await?;
    if let Some(existing) = existing {
        if !should_apply_runtime_summary(
            &existing.event_generation,
            existing.last_event_seq,
            generation,
            payload.last_event_seq,
        ) {
            return Ok(existing);
        }
        let mut active: agent_session_runtime_summary_entity::ActiveModel = existing.into();
        active.event_generation = Set(generation.to_string());
        active.last_event_seq = Set(payload.last_event_seq);
        active.run_status = Set(payload.run_status);
        active.phase = Set(payload.phase);
        active.last_tool_name = Set(payload.last_tool_name);
        active.last_error = Set(payload.last_error);
        active.pending_approval_count = Set(payload.pending_approval_count);
        active.unread_activity_version = Set(payload.unread_activity_version);
        active.last_activity_at = Set(last_activity_at.into());
        active.updated_at = Set(Utc::now().into());
        return active.update(db).await.map_err(AppError::from);
    }

    agent_session_runtime_summary_entity::ActiveModel {
        session_id: Set(session_id),
        event_generation: Set(generation.to_string()),
        last_event_seq: Set(payload.last_event_seq),
        run_status: Set(payload.run_status),
        phase: Set(payload.phase),
        last_tool_name: Set(payload.last_tool_name),
        last_error: Set(payload.last_error),
        pending_approval_count: Set(payload.pending_approval_count),
        unread_activity_version: Set(payload.unread_activity_version),
        last_activity_at: Set(last_activity_at.into()),
        updated_at: Set(Utc::now().into()),
    }
    .insert(db)
    .await
    .map_err(AppError::from)
}

#[cfg(test)]
mod workbench_runtime_tests {
    use super::*;

    #[test]
    fn directory_cursor_round_trips_the_complete_sort_key() {
        let timestamp = chrono::DateTime::parse_from_rfc3339("2026-09-21T01:02:03Z")
            .unwrap()
            .with_timezone(&Utc);
        let encoded = encode_directory_cursor(true, 1, timestamp, "session-a");
        let decoded = parse_directory_cursor(&encoded).unwrap();

        assert!(decoded.is_pinned);
        assert_eq!(decoded.active_rank, 1);
        assert_eq!(decoded.last_activity_at, timestamp);
        assert_eq!(decoded.session_uuid, "session-a");
        assert!(parse_directory_cursor("not-a-cursor").is_err());
    }

    #[test]
    fn active_run_status_is_the_secondary_directory_sort_key() {
        assert!(is_active_run_status("running"));
        assert!(is_active_run_status("queued"));
        assert!(is_active_run_status("waiting_approval"));
        assert!(!is_active_run_status("completed"));
        assert!(!is_active_run_status("failed"));
    }

    #[test]
    fn runtime_summary_is_monotonic_within_a_generation_but_resets_across_generations() {
        assert!(should_apply_runtime_summary("g1", 4, "g1", 5));
        assert!(!should_apply_runtime_summary("g1", 4, "g1", 4));
        assert!(!should_apply_runtime_summary("g1", 4, "g1", 3));
        assert!(should_apply_runtime_summary("g1", 99, "g2", 0));
    }

    #[test]
    fn running_sessions_cannot_be_archived_until_terminal() {
        for status in ["queued", "running", "waiting_approval", "unknown"] {
            assert!(!TERMINAL_RUN_STATUSES.contains(&status));
        }
        for status in ["idle", "completed", "stopped", "failed"] {
            assert!(TERMINAL_RUN_STATUSES.contains(&status));
        }
    }
}
