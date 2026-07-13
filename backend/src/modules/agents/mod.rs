mod dto;
mod runner;
mod tools;

use std::convert::Infallible;
use std::time::Duration;

use axum::http::StatusCode;
use axum::response::Sse;
use axum::response::sse::{Event, KeepAlive};
use futures_util::StreamExt;
use rig_core::completion::Message;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::platform::config::load_agent_settings;
use crate::platform::prelude::*;
use crate::shared::success_response;

use self::dto::{
    AgentPageContext, ApiAgentMessage, ApiAgentSession, CreateAgentSessionRequest,
    SendAgentMessageRequest,
};
use self::runner::execute_agent_run;

pub(crate) async fn list_agent_sessions(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ApiAgentSession>>>, AppError> {
    let sessions = AgentSessionEntity::find()
        .order_by_desc(agent_session_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent sessions loaded",
        sessions.into_iter().map(ApiAgentSession::from).collect(),
    )))
}

pub(crate) async fn create_agent_session(
    State(state): State<AppState>,
    payload: Option<Json<CreateAgentSessionRequest>>,
) -> Result<(StatusCode, Json<ApiResponse<ApiAgentSession>>), AppError> {
    let context = payload
        .and_then(|Json(value)| value.context)
        .unwrap_or_default();
    let now = Utc::now();
    let session = agent_session_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        session_uuid: Set(format!("ASESSION-{}", Uuid::new_v4().simple())),
        title: Set("新对话".to_string()),
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

pub(crate) async fn list_agent_messages(
    State(state): State<AppState>,
    Path(session_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiAgentMessage>>>, AppError> {
    let session = find_session(&state.db, &session_uuid).await?;
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
    Path(session_uuid): Path<String>,
    Json(payload): Json<SendAgentMessageRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let content = payload.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest(
            "agent message is required".to_string(),
        ));
    }
    let settings = load_agent_settings()
        .ok_or_else(|| AppError::BadRequest("agent is not configured".to_string()))?;
    settings.validate().map_err(AppError::BadRequest)?;
    if !settings.enabled {
        return Err(AppError::BadRequest("agent is disabled".to_string()));
    }

    let session = find_session(&state.db, &session_uuid).await?;
    let history_models = AgentMessageEntity::find()
        .filter(agent_message_entity::Column::SessionId.eq(session.id))
        .order_by_asc(agent_message_entity::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let history = history_models
        .into_iter()
        .filter_map(|message| match message.role.as_str() {
            "user" => Some(Message::user(message.content)),
            "assistant" => Some(Message::assistant(message.content)),
            _ => None,
        })
        .collect::<Vec<_>>();
    let context = payload
        .context
        .or_else(|| serde_json::from_value::<AgentPageContext>(session.context_json.clone()).ok())
        .unwrap_or_default();
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
        model: Set(settings.chat_model.clone()),
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
            settings,
            context,
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

async fn find_session(
    db: &DatabaseConnection,
    session_uuid: &str,
) -> Result<agent_session_entity::Model, AppError> {
    AgentSessionEntity::find()
        .filter(agent_session_entity::Column::SessionUuid.eq(session_uuid))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("agent session not found".to_string()))
}

fn truncate_title(content: &str) -> String {
    let mut title = content.chars().take(36).collect::<String>();
    if content.chars().count() > 36 {
        title.push('…');
    }
    title
}
