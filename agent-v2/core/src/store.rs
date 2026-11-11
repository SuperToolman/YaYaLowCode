//! PostgreSQL owns commands, leases and replayable events. No in-memory state is authoritative.
use crate::domain::{Checkpoint, Command, ContentPart, Scope};
use anyhow::{Context, Result, bail};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, DatabaseTransaction, Statement,
    TransactionTrait, Value as SqlValue,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn stmt(sql: &str, values: Vec<SqlValue>) -> Statement {
    Statement::from_sql_and_values(DatabaseBackend::Postgres, sql, values)
}
pub fn id(value: Uuid) -> SqlValue {
    value.to_string().into()
}
pub fn js(value: Value) -> SqlValue {
    value.into()
}
pub async fn rows(
    db: &impl ConnectionTrait,
    sql: &str,
    values: Vec<SqlValue>,
) -> Result<Vec<Value>> {
    db.query_all_raw(stmt(sql, values))
        .await?
        .into_iter()
        .map(|r| {
            let raw: String = r.try_get("", "data")?;
            Ok(serde_json::from_str(&raw)?)
        })
        .collect()
}
pub async fn exec(db: &impl ConnectionTrait, sql: &str, values: Vec<SqlValue>) -> Result<u64> {
    Ok(db.execute_raw(stmt(sql, values)).await?.rows_affected())
}

pub fn safe_tool_failure(code: &str) -> Value {
    let (code, message) = match code {
        "tool_access_denied" | "execution_access_denied" => {
            (code, "当前用户或 AI 员工未获此操作授权。")
        }
        "invalid_tool_arguments" => (code, "工具参数无效。"),
        "platform_tool_unavailable" => (code, "平台工具暂时不可用。"),
        "platform_tool_rejected" => (code, "平台工具拒绝了此请求。"),
        "unsupported_tool" => (code, "当前平台尚未实现此工具。"),
        _ => ("tool_execution_failed", "工具执行失败。"),
    };
    json!({"ok":false,"error":{"code":code,"message":message}})
}

#[derive(Clone)]
pub struct Store {
    pub db: DatabaseConnection,
}

#[derive(Clone, Debug)]
pub struct Lease {
    pub run_id: Uuid,
    pub session_id: Uuid,
    pub owner: Uuid,
    pub epoch: i64,
    pub cancelled: bool,
}

/// A previously persisted tool result must keep its original outcome when a
/// worker resumes a checkpoint that still contains the call.
#[derive(Clone, Debug)]
pub enum SavedToolResult {
    Completed(Value),
    Failed(Value),
}

impl Store {
    pub async fn create_session(&self, scope: &Scope, employee: &str) -> Result<Value> {
        let session = Uuid::new_v4();
        let tx = self.db.begin().await?;
        exec(&tx, "INSERT INTO agent_v2_sessions(id,tenant_id,owner_user_id,employee_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4)", vec![id(session),id(scope.tenant_id),id(scope.user_id),employee.into()]).await?;
        event(
            &tx,
            session,
            None,
            "session.created",
            json!({"employeeId":employee}),
        )
        .await?;
        tx.commit().await?;
        self.session(scope, session).await
    }
    pub async fn session(&self, scope: &Scope, session: Uuid) -> Result<Value> {
        rows(&self.db, "SELECT (to_jsonb(s)||jsonb_build_object('run_status',(SELECT status FROM agent_v2_runs r WHERE r.session_id=s.id ORDER BY queue_seq DESC LIMIT 1)))::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid", vec![id(session),id(scope.tenant_id),id(scope.user_id)]).await?.pop().context("session not found")
    }
    pub async fn directory(&self, scope: &Scope) -> Result<Vec<Value>> {
        rows(&self.db, "SELECT row_to_json(x)::text data FROM (SELECT s.*, (SELECT status FROM agent_v2_runs r WHERE r.session_id=s.id ORDER BY queue_seq DESC LIMIT 1) run_status FROM agent_v2_sessions s WHERE tenant_id=$1::uuid AND owner_user_id=$2::uuid ORDER BY updated_at DESC,id DESC LIMIT 200) x",vec![id(scope.tenant_id),id(scope.user_id)]).await
    }
    pub async fn submit(&self, scope: &Scope, session: Uuid, command: &Command) -> Result<Value> {
        let tx = self.db.begin().await?;
        let result = Self::submit_in_transaction(&tx, scope, session, command).await?;
        tx.commit().await?;
        Ok(result)
    }
    pub async fn submit_in_transaction(
        tx: &DatabaseTransaction,
        scope: &Scope,
        session: Uuid,
        command: &Command,
    ) -> Result<Value> {
        command.validate().map_err(anyhow::Error::msg)?;
        let payload = serde_json::to_value(command)?;
        let owned = rows(tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid FOR UPDATE",vec![id(session),id(scope.tenant_id),id(scope.user_id)]).await?;
        if owned.is_empty() {
            bail!("session not found");
        }
        let existing = rows(tx,"SELECT row_to_json(c)::text data FROM agent_v2_commands c WHERE session_id=$1::uuid AND client_id=$2::uuid",vec![id(session),id(command.id())]).await?;
        if let Some(old) = existing.first() {
            if old["payload"] != payload {
                bail!("idempotency conflict");
            }
            return Ok(
                json!({"commandId":old["id"],"runId":if matches!(command,Command::Prompt{..}) {old["id"].clone()} else if let Command::Resume {run_id,..}=command {json!(run_id)} else {Value::Null}}),
            );
        }
        if !owned[0]["deletion_requested_at"].is_null() {bail!("session archived");}
        if matches!(command, Command::Prompt { .. }) && !owned[0]["archived_at"].is_null() {
            bail!("session archived");
        }
        let command_id = Uuid::new_v4();
        exec(tx,"INSERT INTO agent_v2_commands(id,session_id,client_id,payload) VALUES($1::uuid,$2::uuid,$3::uuid,$4)",vec![id(command_id),id(session),id(command.id()),js(payload)]).await?;
        match command {
            Command::Prompt { parts, .. } => {
                let mut total = 0i64;
                let mut unique = std::collections::HashSet::new();
                for part in parts {
                    let fid = match part {
                        ContentPart::Image { file_id } | ContentPart::File { file_id } => *file_id,
                        _ => continue,
                    };
                    if !unique.insert(fid) {
                        bail!("duplicate attachment");
                    }
                    let file=rows(tx,"SELECT jsonb_build_object('mime',mime_type,'size',size)::text data FROM agent_v2_files WHERE id=$1::uuid AND session_id=$2::uuid",vec![id(fid),id(session)]).await?.pop().context("attachment not found in this session")?;
                    if matches!(part, ContentPart::Image { .. })
                        && !file["mime"]
                            .as_str()
                            .is_some_and(|s| s.starts_with("image/"))
                    {
                        bail!("invalid image attachment");
                    }
                    total += file["size"].as_i64().unwrap_or(i64::MAX);
                }
                if unique.len() > 8 || total > 16 * 1024 * 1024 {
                    bail!("attachments exceed 8 files / 16 MiB message limit");
                }

                exec(tx,"INSERT INTO agent_v2_runs(id,session_id,status,queue_seq) SELECT $1::uuid,id,'queued',next_seq+1 FROM agent_v2_sessions WHERE id=$2::uuid",vec![id(command_id),id(session)]).await?;
                exec(tx,"INSERT INTO agent_v2_messages(id,session_id,run_id,role,parts) VALUES($1::uuid,$2::uuid,$3::uuid,'user',$4)",vec![id(Uuid::new_v4()),id(session),id(command_id),js(serde_json::to_value(parts)?)]).await?;
                let title: String = parts
                    .iter()
                    .filter_map(|p| match p {
                        ContentPart::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(48)
                    .collect();
                exec(tx,"UPDATE agent_v2_sessions SET title=CASE WHEN title='新对话' AND NOT title_custom THEN $2 ELSE title END WHERE id=$1::uuid",vec![id(session),if title.is_empty() {"附件消息".into()} else {title.into()}]).await?;
                event(
                    tx,
                    session,
                    Some(command_id),
                    "run.queued",
                    json!({"parts":parts}),
                )
                .await?;
            }
            Command::Confirm {
                confirmation_id,
                approve,
                ..
            } => {
                crate::confirmations::resolve(tx, scope, session, *confirmation_id, *approve)
                    .await?;
            }
            Command::Resume { run_id, .. } => {
                let run=rows(tx,"SELECT row_to_json(r)::text data FROM agent_v2_runs r WHERE id=$1::uuid AND session_id=$2::uuid FOR UPDATE",vec![id(*run_id),id(session)]).await?.pop().context("run not found")?;
                if ["queued", "running", "retry_wait"]
                    .iter()
                    .any(|s| run["status"] == *s)
                {
                    return Ok(json!({"commandId":command_id,"runId":run_id}));
                }
                let unknown=rows(tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid AND result->>'status'='outcome_unknown' LIMIT 1",vec![id(*run_id)]).await?;
                if !unknown.is_empty() {
                    bail!("unknown outcomes require manual review")
                }
                if run["status"] != "paused" {
                    bail!("task is not paused; unknown outcomes require manual review")
                }
                if run["active_since"].is_string() {
                    bail!("execution stop not yet confirmed; review records before resuming")
                }
                exec(tx,"UPDATE agent_v2_runs SET status='queued',pause_reason=NULL,checkpoint=checkpoint||'{\"progress_fingerprints\":[],\"progress_warning\":null,\"progress_warning_seen\":false}'::jsonb,available_at=now(),updated_at=now() WHERE id=$1::uuid",vec![id(*run_id)]).await?;
                event(
                    tx,
                    session,
                    Some(*run_id),
                    "run.resumed",
                    json!({"automaticBudget":false}),
                )
                .await?;
            }
            Command::Cancel { .. } => {
                let runs = rows(tx,"SELECT row_to_json(r)::text data FROM agent_v2_runs r WHERE session_id=$1::uuid AND status IN('queued','running','retry_wait','waiting_confirmation','paused','manual_review','cancel_requested') FOR UPDATE",vec![id(session)]).await?;
                let cancelled=rows(tx,"UPDATE agent_v2_confirmations SET status='cancelled',failure=jsonb_build_object('status','cancelled','executed',false),resolved_at=now() WHERE session_id=$1::uuid AND status IN('pending','approved') RETURNING jsonb_build_object('id',id,'run_id',run_id,'tool_name',tool_name)::text data",vec![id(session)]).await?;
                for confirmation in cancelled {
                    exec(tx,"INSERT INTO agent_v2_tool_audit(id,confirmation_id,actor_user_id,action,outcome) VALUES($1::uuid,$2::uuid,(SELECT owner_user_id FROM agent_v2_sessions WHERE id=$3::uuid),regexp_replace($4,'^platform_',''),'cancelled')",vec![id(Uuid::new_v4()),confirmation["id"].as_str().context("confirmation id")?.into(),id(session),confirmation["tool_name"].as_str().context("tool name")?.into()]).await?;
                    let run_id = Uuid::parse_str(
                        confirmation["run_id"]
                            .as_str()
                            .context("confirmation run")?,
                    )?;
                    event(
                        tx,
                        session,
                        Some(run_id),
                        "confirmation.resolved",
                        json!({"confirmationId":confirmation["id"],"status":"cancelled"}),
                    )
                    .await?;
                }
                for run in runs {
                    let run_id = Uuid::parse_str(run["id"].as_str().context("invalid run id")?)?;
                    let status = if run["status"] == "queued"
                        || run["status"] == "retry_wait"
                        || run["status"] == "waiting_confirmation"
                        || run["status"] == "paused"
                        || run["status"] == "manual_review"
                    {
                        "cancelled"
                    } else {
                        "cancel_requested"
                    };
                    exec(
                        tx,
                        "UPDATE agent_v2_runs SET status=$2,updated_at=now() WHERE id=$1::uuid",
                        vec![id(run_id), status.into()],
                    )
                    .await?;
                    event(
                        tx,
                        session,
                        Some(run_id),
                        if status == "cancelled" {
                            "run.cancelled"
                        } else {
                            "run.cancel_requested"
                        },
                        json!({}),
                    )
                    .await?;
                }
            }
        }
        Ok(
            json!({"commandId":command_id,"runId":if matches!(command,Command::Prompt{..}) {json!(command_id)} else if let Command::Resume {run_id,..}=command {json!(run_id)} else {Value::Null}}),
        )
    }
    pub async fn messages(&self, session: Uuid) -> Result<Vec<Value>> {
        rows(&self.db,"SELECT row_to_json(m)::text data FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.session_id=$1::uuid ORDER BY r.queue_seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END",vec![id(session)]).await
    }
    /// Page whole turns so the user/assistant pair is never split. One SQL snapshot
    /// binds persisted statuses, history and the SSE handoff cursor together.
    pub async fn message_page(&self, session: Uuid, before: Option<i64>) -> Result<Value> {
        Ok(rows(&self.db,&format!(r#"
WITH candidates AS (
 SELECT *,active_ms+COALESCE((EXTRACT(EPOCH FROM(now()-active_since))*1000)::bigint,0) elapsed_ms FROM agent_v2_runs
 WHERE session_id=$1::uuid AND ($2::bigint IS NULL OR queue_seq<$2)
 ORDER BY queue_seq DESC LIMIT 21
), selected AS (SELECT * FROM candidates ORDER BY queue_seq DESC LIMIT 20), usage_sessions AS (SELECT $1::uuid id),
{usage_records}, usage_totals AS (
 SELECT COALESCE(sum(i),0) i,COALESCE(sum(o),0) o,COALESCE(sum(COALESCE(t,i+o)),0) t,count(*) FILTER(WHERE i>0 OR o>0 OR t>0) reported FROM usage_numbers
), usage_by_run AS (
 SELECT run_id,COALESCE(sum(i),0) i,COALESCE(sum(o),0) o,COALESCE(sum(COALESCE(t,i+o)),0) t,count(*) FILTER(WHERE i>0 OR o>0 OR t>0) reported FROM usage_numbers GROUP BY run_id
), request_totals AS (
 SELECT COALESCE(sum(model_requests),0) requests FROM agent_v2_runs WHERE session_id=$1::uuid
)
SELECT jsonb_build_object(
 'token_usage',(SELECT jsonb_build_object('input_tokens',i,'output_tokens',o,'total_tokens',t,'reported_requests',reported,'model_requests',GREATEST(requests,reported),'unreported_requests',GREATEST(0,requests-reported)) FROM usage_totals CROSS JOIN request_totals),
 'items',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('run_status',r.status,'history_snapshot',r.history_snapshot,'token_usage',CASE WHEN r.history_snapshot THEN NULL ELSE (SELECT jsonb_build_object('input_tokens',COALESCE(u.i,0),'output_tokens',COALESCE(u.o,0),'total_tokens',COALESCE(u.t,0),'reported_requests',COALESCE(u.reported,0),'model_requests',GREATEST(r.model_requests,COALESCE(u.reported,0)),'unreported_requests',GREATEST(0,r.model_requests-COALESCE(u.reported,0))) FROM (SELECT 1) seed LEFT JOIN usage_by_run u ON u.run_id=r.id) END,'run_progress',CASE WHEN r.history_snapshot THEN NULL ELSE jsonb_build_object('status',r.status,'budget_ms',r.budget_ms,'active_ms',r.elapsed_ms,'model_limit',r.model_limit,'model_requests',r.model_requests,'stage',r.stage,'pause_reason',r.pause_reason,'stop_pending',r.status='paused' AND r.active_since IS NOT NULL) END) ORDER BY r.queue_seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END)
 FROM agent_v2_messages m JOIN selected r ON r.id=m.run_id WHERE m.session_id=$1::uuid),'[]'::jsonb),
 'next_before',CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT min(queue_seq)::text FROM selected) ELSE NULL END,
 'event_cursor',(SELECT next_seq FROM agent_v2_sessions WHERE id=$1::uuid),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('payload',CASE WHEN e.type='step.completed' THEN e.payload||jsonb_build_object('text',COALESCE(e.payload->>'text',(SELECT s.response_snapshot->'answer'->>'text' FROM agent_v2_steps s WHERE s.run_id=e.run_id AND s.ordinal=(e.payload->>'step')::int AND s.attempt=(e.payload->>'epoch')::int AND s.status='completed'))) ELSE e.payload END) ORDER BY e.seq) FROM agent_v2_events e JOIN selected r ON r.id=e.run_id
 WHERE e.session_id=$1::uuid AND (e.type<>'message.delta' OR r.status NOT IN ('completed','failed','cancelled'))),'[]'::jsonb)
)::text data
"#, usage_records=include_str!("token_usage_records.sql")),vec![id(session),before.into()]).await?.remove(0))
    }
    /// Aggregate only an already-authorized directory page, without loading messages/events.
    pub async fn session_token_usage(&self, sessions: &[Uuid]) -> Result<Vec<Value>> {
        rows(&self.db, &format!(r#"
WITH usage_sessions AS (SELECT value::uuid id FROM jsonb_array_elements_text($1::jsonb)),
{usage_records}, totals AS (
 SELECT session_id,COALESCE(sum(i),0) i,COALESCE(sum(o),0) o,
 COALESCE(sum(COALESCE(t,i+o)),0) t,count(*) FILTER(WHERE i>0 OR o>0 OR t>0) reported
 FROM usage_numbers GROUP BY session_id
), requests AS (
 SELECT session_id,sum(model_requests) count FROM agent_v2_runs
 WHERE session_id IN (SELECT id FROM usage_sessions) GROUP BY session_id
)
SELECT jsonb_build_object('session_id',s.id,'token_usage',jsonb_build_object(
 'input_tokens',COALESCE(u.i,0),'output_tokens',COALESCE(u.o,0),'total_tokens',COALESCE(u.t,0),
 'reported_requests',COALESCE(u.reported,0),'model_requests',GREATEST(COALESCE(r.count,0),COALESCE(u.reported,0)),
 'unreported_requests',GREATEST(0,COALESCE(r.count,0)-COALESCE(u.reported,0))))::text data
FROM usage_sessions s LEFT JOIN totals u ON u.session_id=s.id LEFT JOIN requests r ON r.session_id=s.id
"#, usage_records=include_str!("token_usage_records.sql")),vec![js(json!(sessions))]).await
    }
    pub async fn events(&self, session: Uuid, after: i64) -> Result<Vec<Value>> {
        rows(&self.db,"SELECT row_to_json(e)::text data FROM agent_v2_events e WHERE session_id=$1::uuid AND seq>$2 ORDER BY seq LIMIT 200",vec![id(session),after.into()]).await
    }
    pub async fn claim(&self, owner: Uuid, seconds: i32) -> Result<Option<Lease>> {
        let tx = self.db.begin().await?;
        exec(&tx, "SET LOCAL yaya.agent_execution_protocol = '2'", vec![]).await?;
        let candidates = rows(&tx,"SELECT row_to_json(r)::text data FROM agent_v2_runs r JOIN agent_v2_sessions s ON s.id=r.session_id WHERE ((r.status IN('queued','retry_wait') AND r.available_at<=now()) OR (r.status IN('running','cancel_requested') AND r.lease_until<now()) OR (r.status='paused' AND r.pause_reason IN('context_unshrinkable','context_compaction_failed','budget_exhausted','no_progress') AND r.active_since IS NULL AND NOT EXISTS(SELECT 1 FROM agent_v2_executions x WHERE x.run_id=r.id AND x.status IN('queued','running','outcome_unknown')))) AND NOT EXISTS(SELECT 1 FROM agent_v2_runs earlier WHERE earlier.session_id=r.session_id AND earlier.status IN('queued','retry_wait','running','waiting_confirmation','paused','manual_review','cancel_requested') AND earlier.queue_seq<r.queue_seq) ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF s,r SKIP LOCKED",vec![]).await?;
        let Some(run) = candidates.first() else {
            return Ok(None);
        };
        let run_id = Uuid::parse_str(run["id"].as_str().context("run id")?)?;
        let session_id = Uuid::parse_str(run["session_id"].as_str().context("session id")?)?;
        let cancelled = run["status"] == "cancel_requested";
        if run["status"] == "paused" {
            event(
                &tx,
                session_id,
                Some(run_id),
                "run.resumed",
                json!({"automatic":true,"reason":"automatic_execution_policy"}),
            )
            .await?;
        }
        let epoch = run["lease_epoch"].as_i64().context("lease epoch")? + 1;
        exec(&tx,"UPDATE agent_v2_runs SET status=$2,pause_reason=NULL,lease_owner=$3::uuid,lease_epoch=$4,lease_until=now()+make_interval(secs=>$5),attempt=attempt+1,active_since=COALESCE(active_since,now()),execution_protocol=2,model_requests=CASE WHEN execution_protocol=1 THEN GREATEST(model_requests,(SELECT count(*)::int FROM agent_v2_steps WHERE run_id=$1::uuid)) ELSE model_requests END,updated_at=now() WHERE id=$1::uuid",vec![id(run_id),if cancelled {"cancel_requested"} else {"running"}.into(),id(owner),epoch.into(),seconds.into()]).await?;
        event(
            &tx,
            session_id,
            Some(run_id),
            "run.started",
            json!({"attempt":run["attempt"].as_i64().unwrap_or(0)+1,"epoch":epoch}),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(Lease {
            run_id,
            session_id,
            owner,
            epoch,
            cancelled,
        }))
    }
    pub async fn heartbeat(&self, lease: &Lease, seconds: i32) -> Result<()> {
        let n=exec(&self.db,"UPDATE agent_v2_runs SET lease_until=now()+make_interval(secs=>$4) WHERE id=$1::uuid AND lease_owner=$2::uuid AND lease_epoch=$3 AND lease_until>now() AND status='running'",vec![id(lease.run_id),id(lease.owner),lease.epoch.into(),seconds.into()]).await?;
        if n != 1 {
            bail!("lease lost or cancelled")
        };
        Ok(())
    }
    pub async fn run(&self, run: Uuid) -> Result<Value> {
        rows(
            &self.db,
            "SELECT row_to_json(r)::text data FROM agent_v2_runs r WHERE id=$1::uuid",
            vec![id(run)],
        )
        .await?
        .pop()
        .context("run not found")
    }
    pub async fn checkpoint(
        &self,
        lease: &Lease,
        cp: &Checkpoint,
        kind: &str,
        payload: Value,
    ) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        exec(
            &tx,
            "UPDATE agent_v2_runs SET checkpoint=$2,updated_at=now() WHERE id=$1::uuid",
            vec![id(lease.run_id), js(serde_json::to_value(cp)?)],
        )
        .await?;
        event(&tx, lease.session_id, Some(lease.run_id), kind, payload).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn append(&self, lease: &Lease, kind: &str, payload: Value) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        event(&tx, lease.session_id, Some(lease.run_id), kind, payload).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn snapshot_context(&self, lease: &Lease, context: Value) -> Result<Value> {
        let tx = self.fence(lease, false).await?;
        let result=rows(&tx,"UPDATE agent_v2_runs SET context_snapshot=COALESCE(context_snapshot,$2) WHERE id=$1::uuid RETURNING context_snapshot::text data",vec![id(lease.run_id),js(context)]).await?.pop().context("context snapshot")?;
        tx.commit().await?;
        Ok(result)
    }
    pub async fn step_start(&self, lease: &Lease, cp: &Checkpoint, snapshot: Value) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        exec(&tx,"INSERT INTO agent_v2_steps(run_id,ordinal,attempt,status,request_snapshot) VALUES($1::uuid,$2,$3,'running',$4)",vec![id(lease.run_id),cp.step.into(),(lease.epoch as i32).into(),js(snapshot)]).await?;
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            "step.started",
            json!({"step":cp.step,"epoch":lease.epoch}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn step_end(&self, lease: &Lease, cp: &Checkpoint, response: Value) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        let text = response["answer"]["text"].clone();
        exec(&tx,"UPDATE agent_v2_steps SET status='completed',response_snapshot=$4 WHERE run_id=$1::uuid AND ordinal=$2 AND attempt=$3",vec![id(lease.run_id),(cp.step-1).into(),(lease.epoch as i32).into(),js(response)]).await?;
        exec(
            &tx,
            "UPDATE agent_v2_runs SET checkpoint=$2,consecutive_failures=0 WHERE id=$1::uuid",
            vec![id(lease.run_id), js(serde_json::to_value(cp)?)],
        )
        .await?;
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            "step.completed",
            json!({"step":cp.step-1,"epoch":lease.epoch,"text":text}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn tool_start(
        &self,
        lease: &Lease,
        call: &crate::domain::ToolCall,
    ) -> Result<Option<SavedToolResult>> {
        let tx = self.fence(lease, false).await?;
        let inserted=exec(&tx,"INSERT INTO agent_v2_tool_invocations(id,run_id,call_id,tool_name,arguments,status) VALUES($1::uuid,$2::uuid,$3,$4,$5,'running') ON CONFLICT(run_id,call_id) DO NOTHING",vec![id(Uuid::new_v4()),id(lease.run_id),call.id.clone().into(),call.name.clone().into(),js(call.arguments.clone())]).await?;
        let old=rows(&tx,"SELECT row_to_json(t)::text data FROM agent_v2_tool_invocations t WHERE run_id=$1::uuid AND call_id=$2",vec![id(lease.run_id),call.id.clone().into()]).await?.pop().context("tool invocation")?;
        if old["arguments"] != call.arguments || old["tool_name"] != call.name {
            bail!("tool call id conflict");
        }
        let mut result = match old["status"].as_str() {
            Some("completed") => Some(SavedToolResult::Completed(old["result"].clone())),
            Some("failed") => Some(SavedToolResult::Failed(old["result"].clone())),
            Some("running") => None,
            _ => bail!("invalid persisted tool invocation state"),
        };
        if inserted == 1 {
            event(
                &tx,
                lease.session_id,
                Some(lease.run_id),
                "tool.started",
                json!({"callId":call.id,"name":call.name,"arguments":call.arguments}),
            )
            .await?;
        }
        if result.is_none() {
            // The business transaction may have committed before the Worker
            // checkpoint. Its effect is authoritative, even after later revocation.
            if let Some(effect)=rows(&tx,"SELECT e.result::text data FROM agent_v2_effects e JOIN agent_v2_confirmations c ON c.id=e.effect_key WHERE c.run_id=$1::uuid AND c.call_id=$2",vec![id(lease.run_id),call.id.clone().into()]).await?.pop(){
                exec(&tx,"UPDATE agent_v2_tool_invocations SET status='completed',result=$3 WHERE run_id=$1::uuid AND call_id=$2 AND status='running'",vec![id(lease.run_id),call.id.clone().into(),js(effect.clone())]).await?;
                event(&tx,lease.session_id,Some(lease.run_id),"tool.completed",json!({"callId":call.id,"result":effect,"recovered":true})).await?;
                result=Some(SavedToolResult::Completed(effect));
            }
        }
        tx.commit().await?;
        Ok(result)
    }

    /// Advances a recovered checkpoint after replaying a terminal invocation,
    /// without changing its persisted outcome or emitting a duplicate event.
    pub async fn replay_tool_result(
        &self,
        lease: &Lease,
        call_id: &str,
        expected_status: &str,
        cp: &Checkpoint,
    ) -> Result<()> {
        if !matches!(expected_status, "completed" | "failed") {
            bail!("invalid replay status")
        }
        let tx = self.fence(lease, false).await?;
        let invocation = rows(
            &tx,
            "SELECT jsonb_build_object('status',status)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid AND call_id=$2",
            vec![id(lease.run_id), call_id.into()],
        )
        .await?
        .pop()
        .context("tool invocation")?;
        if invocation["status"] != expected_status {
            bail!("persisted tool invocation outcome changed")
        }
        exec(
            &tx,
            "UPDATE agent_v2_runs SET checkpoint=$2,updated_at=now() WHERE id=$1::uuid",
            vec![id(lease.run_id), js(serde_json::to_value(cp)?)],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn tool_end(
        &self,
        lease: &Lease,
        call_id: &str,
        result: Value,
        cp: &Checkpoint,
    ) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        let updated=exec(&tx,"UPDATE agent_v2_tool_invocations SET status='completed',result=$3 WHERE run_id=$1::uuid AND call_id=$2 AND status='running'",vec![id(lease.run_id),call_id.into(),js(result.clone())]).await?;
        if updated != 1 {
            bail!("tool invocation is not running")
        }
        exec(
            &tx,
            "UPDATE agent_v2_runs SET checkpoint=$2 WHERE id=$1::uuid",
            vec![id(lease.run_id), js(serde_json::to_value(cp)?)],
        )
        .await?;
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            "tool.completed",
            json!({"callId":call_id,"result":result}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    /// Persist a safe, user-facing tool failure before the run is failed. This
    /// makes failures replayable and lets the model see why a call was denied.
    pub async fn tool_failed(
        &self,
        lease: &Lease,
        call_id: &str,
        result: Value,
        cp: &Checkpoint,
    ) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        let updated=exec(&tx,"UPDATE agent_v2_tool_invocations SET status='failed',result=$3 WHERE run_id=$1::uuid AND call_id=$2 AND status='running'",vec![id(lease.run_id),call_id.into(),js(result.clone())]).await?;
        if updated != 1 {
            bail!("tool invocation is not running")
        }
        let confirmations=rows(&tx,"UPDATE agent_v2_confirmations c SET status='failed',failure=$3,resolved_at=now() WHERE run_id=$1::uuid AND call_id=$2 AND status='approved' AND NOT EXISTS(SELECT 1 FROM agent_v2_effects e WHERE e.effect_key=c.id) RETURNING jsonb_build_object('id',id,'tool_name',tool_name)::text data",vec![id(lease.run_id),call_id.into(),js(result.clone())]).await?;
        for confirmation in confirmations {
            event(&tx,lease.session_id,Some(lease.run_id),"confirmation.resolved",json!({"confirmationId":confirmation["id"],"status":"failed","error":result["error"]})).await?;
            exec(&tx,"INSERT INTO agent_v2_tool_audit(id,confirmation_id,actor_user_id,action,outcome) SELECT $1::uuid,$2::uuid,owner_user_id,$3,'failed' FROM agent_v2_sessions WHERE id=$4::uuid",vec![id(Uuid::new_v4()),confirmation["id"].as_str().context("confirmation id")?.into(),confirmation["tool_name"].as_str().context("tool name")?.into(),id(lease.session_id)]).await?;
        }
        exec(
            &tx,
            "UPDATE agent_v2_runs SET checkpoint=$2 WHERE id=$1::uuid",
            vec![id(lease.run_id), js(serde_json::to_value(cp)?)],
        )
        .await?;
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            "tool.failed",
            json!({"callId":call_id,"error":result["error"]}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn finish(
        &self,
        lease: &Lease,
        status: &str,
        text: &str,
        error_code: Option<&str>,
    ) -> Result<()> {
        if !["completed", "failed", "cancelled", "retry_wait"].contains(&status) {
            bail!("invalid terminal state")
        }
        let tx = self.fence(lease, true).await?;
        let current=rows(&tx,"SELECT jsonb_build_object('status',status)::text data FROM agent_v2_runs WHERE id=$1::uuid",vec![id(lease.run_id)]).await?;
        let status = if current[0]["status"] == "cancel_requested" {
            "cancelled"
        } else {
            status
        };
        exec(&tx,"UPDATE agent_v2_runs SET status=$2,error_code=$3,active_ms=active_ms+COALESCE((EXTRACT(EPOCH FROM(now()-active_since))*1000)::bigint,0),active_since=CASE WHEN $2='retry_wait' THEN now() ELSE NULL END,consecutive_failures=consecutive_failures+CASE WHEN $2 IN ('failed','retry_wait') THEN 1 ELSE 0 END,lease_until=NULL,available_at=now()+interval '3 seconds',updated_at=now() WHERE id=$1::uuid",vec![id(lease.run_id),status.into(),error_code.map(str::to_string).into()]).await?;
        if status == "failed" {
            let abandoned=rows(&tx,"UPDATE agent_v2_confirmations SET status='failed',failure=jsonb_build_object('status','failed','executed',false,'error',COALESCE($2,'run_failed')),resolved_at=now() WHERE run_id=$1::uuid AND status='approved' AND NOT EXISTS(SELECT 1 FROM agent_v2_effects e WHERE e.effect_key=agent_v2_confirmations.id) RETURNING jsonb_build_object('id',id,'tool_name',tool_name)::text data",vec![id(lease.run_id),error_code.map(str::to_string).into()]).await?;
            for confirmation in abandoned {
                event(&tx,lease.session_id,Some(lease.run_id),"confirmation.resolved",json!({"confirmationId":confirmation["id"],"status":"failed","error":{"code":error_code.unwrap_or("run_failed")}})).await?;
                exec(&tx,"INSERT INTO agent_v2_tool_audit(id,confirmation_id,actor_user_id,action,outcome) SELECT $1::uuid,$2::uuid,owner_user_id,regexp_replace($3,'^platform_',''),'failed' FROM agent_v2_sessions WHERE id=$4::uuid",vec![id(Uuid::new_v4()),confirmation["id"].as_str().context("confirmation id")?.into(),confirmation["tool_name"].as_str().context("tool name")?.into(),id(lease.session_id)]).await?;
            }
        }
        if status == "completed" {
            exec(&tx,"INSERT INTO agent_v2_messages(id,session_id,run_id,role,parts) VALUES($1::uuid,$2::uuid,$3::uuid,'assistant',$4) ON CONFLICT(run_id,role) DO NOTHING",vec![id(Uuid::new_v4()),id(lease.session_id),id(lease.run_id),js(json!([{"type":"text","text":text}]))]).await?;
        }
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            &format!("run.{status}"),
            json!({"text":if status=="completed" {text} else {""},"errorCode":error_code}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn fence(&self, lease: &Lease, allow_cancel: bool) -> Result<DatabaseTransaction> {
        let tx = self.db.begin().await?;
        rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid FOR UPDATE",vec![id(lease.session_id)]).await?;
        let guarded=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_runs WHERE id=$1::uuid AND lease_owner=$2::uuid AND lease_epoch=$3 AND lease_until>now() AND (status='running' OR ($4 AND status='cancel_requested')) FOR UPDATE",vec![id(lease.run_id),id(lease.owner),lease.epoch.into(),allow_cancel.into()]).await?;
        if guarded.is_empty() {
            bail!("lease lost or cancelled")
        };
        Ok(tx)
    }
}

pub async fn event(
    tx: &impl ConnectionTrait,
    session: Uuid,
    run: Option<Uuid>,
    kind: &str,
    payload: Value,
) -> Result<()> {
    let next=rows(tx,"UPDATE agent_v2_sessions SET next_seq=next_seq+1,updated_at=now() WHERE id=$1::uuid RETURNING jsonb_build_object('seq',next_seq)::text data",vec![id(session)]).await?;
    let seq = next
        .first()
        .and_then(|v| v["seq"].as_i64())
        .context("session sequence")?;
    let event_id = Uuid::new_v4();
    exec(tx,"INSERT INTO agent_v2_events(event_id,session_id,seq,run_id,type,payload) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6)",vec![id(event_id),id(session),seq.into(),run.map(|v|v.to_string()).into(),kind.into(),js(payload)]).await?;
    exec(
        tx,
        "INSERT INTO agent_v2_outbox(event_id) VALUES($1::uuid)",
        vec![id(event_id)],
    )
    .await?;
    Ok(())
}

pub fn fingerprint(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}
