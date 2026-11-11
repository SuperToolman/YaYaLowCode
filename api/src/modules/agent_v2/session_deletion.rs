//! Durable owner-scoped archive deletion. Business effects are not reversed.
use super::*;
use sea_orm::TransactionTrait;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use yaya_agent_v2::store::exec;
static CLEANUP_WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route("/api/agent/v2/archived-sessions/actions", post(action))
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveAction {
    pub session_ids: Vec<Uuid>,
    pub action: ArchiveOperation,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ArchiveOperation {
    Restore,
    Delete,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveActionItem {
    pub session_id: Uuid,
    pub status: String,
    pub error: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct ArchiveActionResult {
    pub items: Vec<ArchiveActionItem>,
}

#[utoipa::path(post,path="/api/agent/v2/archived-sessions/actions",operation_id="agentV2ArchiveAction",request_body=ArchiveAction,responses((status=200,body=ArchiveActionResult)))]
pub(crate) async fn action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ArchiveAction>,
) -> Result<Json<ArchiveActionResult>, AppError> {
    let (scope, grants) = principal(&state, &headers).await?;
    if input.session_ids.is_empty()
        || input.session_ids.len() > 100
        || input.session_ids.iter().collect::<HashSet<_>>().len() != input.session_ids.len()
    {
        return Err(AppError::BadRequest("每次请选择 1—100 个不同会话".into()));
    }
    let mut items = Vec::new();
    for sid in input.session_ids {
        let result = change(&state, &scope, &grants, sid, &input.action).await;
        items.push(match result {
            Ok(status) => ArchiveActionItem {
                session_id: sid,
                status,
                error: None,
            },
            Err(error) => ArchiveActionItem {
                session_id: sid,
                status: "failed".into(),
                error: Some(
                    match error {
                        AppError::NotFound(_) => "会话不存在或无权访问",
                        AppError::Forbidden(_) => "员工使用权已失效",
                        AppError::Conflict(ref message) => match message.as_str() {
                            "session not archived" => "此会话已恢复，归档列表将刷新",
                            "deletion pending" => "会话已受理删除，不能再恢复",
                            "session execution unknown" => {
                                "脚本执行结果待核对，暂不能彻底删除；请先核对执行记录"
                            }
                            _ => "会话状态已变化，请刷新后重试",
                        },
                        _ => "操作失败，请刷新后重试",
                    }
                    .into(),
                ),
            },
        });
    }
    CLEANUP_WAKE.notify_waiters();
    Ok(Json(ArchiveActionResult { items }))
}
async fn change(
    state: &AppState,
    scope: &Scope,
    grants: &HashSet<String>,
    sid: Uuid,
    operation: &ArchiveOperation,
) -> Result<String, AppError> {
    let tx = state.db.begin().await?;
    let current=rows(&tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid FOR UPDATE",vec![id(sid),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.pop();
    let Some(current) = current else {
        let done=rows(&tx,"SELECT jsonb_build_object('status',status)::text data FROM agent_v2_session_deletions WHERE session_id=$1::uuid AND tenant_id=$2::uuid AND user_id=$3::uuid",vec![id(sid),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?;
        return if matches!(operation, ArchiveOperation::Delete) && !done.is_empty() {
            Ok(done[0]["status"].as_str().unwrap_or("queued").into())
        } else {
            Err(AppError::NotFound("session not found".into()))
        };
    };
    let employee_id = current["employee_id"].as_str().unwrap_or("");
    // Managing personal archived data does not require an expired employee to be reinstalled.
    if !employee_allowed(grants, employee_id) {
        return Err(AppError::Forbidden("employee denied".into()));
    }
    if current["archived_at"].is_null() {
        return Err(AppError::Conflict("session not archived".into()));
    }
    match operation {
        ArchiveOperation::Restore => {
            if !current["deletion_requested_at"].is_null() {
                return Err(AppError::Conflict("deletion pending".into()));
            }
            employee(grants, employee_id).await?;
            exec(&tx,"UPDATE agent_v2_sessions SET archived_at=NULL,metadata_version=metadata_version+1 WHERE id=$1::uuid",vec![id(sid)]).await.map_err(map_store)?;
            yaya_agent_v2::store::event(
                &tx,
                sid,
                None,
                "session.updated",
                json!({"archived":false}),
            )
            .await
            .map_err(map_store)?;
        }
        ArchiveOperation::Delete => {
            if !current["deletion_requested_at"].is_null() {
                let prior=rows(&tx,"SELECT jsonb_build_object('status',status)::text data FROM agent_v2_session_deletions WHERE session_id=$1::uuid",vec![id(sid)]).await.map_err(map_store)?;
                if let Some(prior) = prior.first() {
                    if prior["status"] != "failed" {
                        return Ok(prior["status"].as_str().unwrap_or("queued").into());
                    }
                }
            }
            let unknown=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_executions WHERE session_id=$1::uuid AND status='outcome_unknown' LIMIT 1",vec![id(sid)]).await.map_err(map_store)?;
            if !unknown.is_empty() {
                return Err(AppError::Conflict("session execution unknown".into()));
            }
            // Repair old archived sessions too. Accept deletion while cancellation
            // drains; cleanup cannot claim the session until execution has stopped.
            if current["deletion_requested_at"].is_null() {
                Store::submit_in_transaction(&tx, scope, sid, &Command::Cancel {
                    client_command_id: Uuid::new_v4(),
                }).await.map_err(map_store)?;
            }
            exec(&tx,"UPDATE agent_v2_sessions SET deletion_requested_at=COALESCE(deletion_requested_at,now()) WHERE id=$1::uuid",vec![id(sid)]).await.map_err(map_store)?;
            exec(&tx,"INSERT INTO agent_v2_session_deletions(session_id,tenant_id,user_id,employee_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'queued') ON CONFLICT(session_id) DO UPDATE SET status=CASE WHEN agent_v2_session_deletions.status='failed' THEN 'queued' ELSE agent_v2_session_deletions.status END,error_code=NULL,updated_at=now()",vec![id(sid),id(scope.tenant_id),id(scope.user_id),employee_id.into()]).await.map_err(map_store)?;
        }
    }
    tx.commit().await?;
    Ok(if matches!(operation, ArchiveOperation::Restore) {
        "restored"
    } else {
        "queued"
    }
    .into())
}

async fn cleanup_one(state: &AppState) -> Result<bool, AppError> {
    // Only fail the deletion job: keep executions and files intact until stop is confirmed.
    exec(&state.db,"UPDATE agent_v2_session_deletions d SET status='failed',error_code='session_cleanup_stop_unconfirmed',updated_at=now() WHERE d.status='queued' AND d.updated_at<now()-interval '5 minutes' AND (EXISTS(SELECT 1 FROM agent_v2_runs r WHERE r.session_id=d.session_id AND r.status NOT IN('completed','failed','cancelled')) OR EXISTS(SELECT 1 FROM agent_v2_executions e WHERE e.session_id=d.session_id AND e.status IN('queued','running')))",vec![]).await.map_err(map_store)?;
    // Claim in a short transaction. updated_at is the fencing token; interrupted
    // claims become eligible after five minutes. No database lock spans file I/O.
    let tx = state.db.begin().await?;
    let job=rows(&tx,"WITH candidate AS (SELECT session_id FROM agent_v2_session_deletions pending WHERE (status='queued' OR (status='running' AND updated_at<now()-interval '5 minutes')) AND NOT EXISTS(SELECT 1 FROM agent_v2_runs r WHERE r.session_id=pending.session_id AND r.status NOT IN('completed','failed','cancelled')) AND NOT EXISTS(SELECT 1 FROM agent_v2_executions e WHERE e.session_id=pending.session_id AND e.status IN('queued','running')) ORDER BY created_at,session_id LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE agent_v2_session_deletions d SET status='running',error_code=NULL,updated_at=clock_timestamp() FROM candidate c WHERE d.session_id=c.session_id RETURNING row_to_json(d)::text data",vec![]).await.map_err(map_store)?.pop();
    tx.commit().await?;
    let Some(job) = job else { return Ok(false) };
    let sid = job["session_id"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("invalid cleanup session".into()))?;
    let token = job["updated_at"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("invalid cleanup token".into()))?;
    let result=executions::service(reqwest::Method::POST,"/sessions/delete",Some(&json!({"deploymentId":job["tenant_id"],"userId":job["user_id"],"employeeId":job["employee_id"],"sessionId":job["session_id"]}))).await;
    if result.as_ref().ok().is_none_or(|v| v["deleted"] != true) {
        let code = match &result {
            Err(AppError::BadRequest(message)) if message.starts_with("session_cleanup_") => {
                message.as_str()
            }
            Err(AppError::BadRequest(message)) if message == "script_executor_unavailable" => {
                "session_cleanup_executor_unavailable"
            }
            _ => "execution_cleanup_failed",
        };
        mark_failed(state, sid, token, code).await?;
        return Ok(true);
    }
    let tx = state.db.begin().await?;
    // Same session -> deletion lock order as the user action path.
    let _ = rows(
        &tx,
        "SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid FOR UPDATE",
        vec![sid.into()],
    )
    .await
    .map_err(map_store)?;
    let current=rows(&tx,"SELECT row_to_json(d)::text data FROM agent_v2_session_deletions d WHERE session_id=$1::uuid AND status='running' AND updated_at=$2::timestamptz FOR UPDATE",vec![sid.into(),token.into()]).await.map_err(map_store)?;
    if current.is_empty() {
        return Ok(true);
    }
    let purge_result:Result<(),AppError>=async {
 // Remove request contents as well as result references, including submissions which created a new session.
 exec(&tx,"DELETE FROM agent_v2_staged_files WHERE submission_id IN(SELECT id FROM agent_v2_submissions WHERE session_id=$1::uuid OR result->>'sessionId'=$1::text)",vec![sid.into()]).await.map_err(map_store)?;
 exec(&tx,"UPDATE agent_v2_submissions SET session_id=NULL,payload='{\"deleted\":true}'::jsonb,result=NULL,status='abandoned' WHERE session_id=$1::uuid OR result->>'sessionId'=$1::text",vec![sid.into()]).await.map_err(map_store)?;
 for sql in [
  "DELETE FROM agent_v2_outbox WHERE event_id IN(SELECT event_id FROM agent_v2_events WHERE session_id=$1::uuid)",
  "DELETE FROM agent_v2_events WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_tool_audit WHERE confirmation_id IN(SELECT id FROM agent_v2_confirmations WHERE session_id=$1::uuid)",
  "DELETE FROM agent_v2_effects WHERE effect_key IN(SELECT id FROM agent_v2_confirmations WHERE session_id=$1::uuid)",
  "DELETE FROM agent_v2_confirmations WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_files WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_executions WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_tool_invocations WHERE run_id IN(SELECT id FROM agent_v2_runs WHERE session_id=$1::uuid)",
  "DELETE FROM agent_v2_steps WHERE run_id IN(SELECT id FROM agent_v2_runs WHERE session_id=$1::uuid)",
  "DELETE FROM agent_v2_messages WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_runs WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_commands WHERE session_id=$1::uuid",
  "DELETE FROM agent_v2_sessions WHERE id=$1::uuid"
 ] {exec(&tx,sql,vec![sid.into()]).await.map_err(map_store)?;}
 exec(&tx,"UPDATE agent_v2_session_deletions SET status='completed',error_code=NULL,updated_at=now() WHERE session_id=$1::uuid",vec![sid.into()]).await.map_err(map_store)?;
 Ok(())
 }.await;
    if let Err(error) = purge_result {
        tx.rollback().await?;
        mark_failed(state, sid, token, "database_cleanup_failed").await?;
        tracing::error!(error=?error,"Session database cleanup failed; execution files already removed");
        return Ok(true);
    }
    tx.commit().await?;
    Ok(true)
}
async fn mark_failed(state: &AppState, sid: &str, token: &str, code: &str) -> Result<(), AppError> {
    exec(&state.db,"UPDATE agent_v2_session_deletions SET status='failed',error_code=$3,updated_at=now() WHERE session_id=$1::uuid AND status='running' AND updated_at=$2::timestamptz",vec![sid.into(),token.into(),code.into()]).await.map_err(map_store)?;
    Ok(())
}
pub(crate) fn start_cleanup(state: AppState) {
    // A small fixed pool drains existing work immediately. Across API instances,
    // SKIP LOCKED and the persisted claim token prevent double database purges.
    for _ in 0..3 {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                match cleanup_one(&state).await {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(error) => {
                        tracing::error!(error=?error,"AgentV2 session cleanup failed; interrupted claim retained for recovery")
                    }
                }
                tokio::select! {_=CLEANUP_WAKE.notified()=>{},_=tokio::time::sleep(Duration::from_secs(2))=>{}}
            }
        });
    }
}
