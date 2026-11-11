//! Durable usage observations and context checkpoints; no task execution budget.
use crate::store::{Lease, Store, event, exec, id, js, rows};
use anyhow::{Result, bail};
use sea_orm::DatabaseTransaction;
use serde_json::{Value, json};
impl Store {
    /// Usage is observational only: it never pauses or caps a task.
    pub async fn record_model_request(&self, lease: &Lease) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        exec(
            &tx,
            "UPDATE agent_v2_runs SET model_requests=model_requests+1 WHERE id=$1::uuid",
            vec![id(lease.run_id)],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn suspend(&self, lease: &Lease, status: &str, reason: &str) -> Result<()> {
        if !matches!(status, "paused" | "manual_review") {
            bail!("invalid pause state")
        }
        let tx = self.fence(lease, false).await?;
        suspend_in(&tx, lease, status, reason).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn compact_context(&self, lease: &Lease, summary: Value, through: i32) -> Result<()> {
        let tx = self.fence(lease, false).await?;
        exec(&tx,"UPDATE agent_v2_runs SET context_summary=$2,compacted_through=$3 WHERE id=$1::uuid AND compacted_through<$3",vec![id(lease.run_id),js(summary),through.into()]).await?;
        event(
            &tx,
            lease.session_id,
            Some(lease.run_id),
            "context.compacted",
            json!({"throughMessage":through,"estimate":"utf8_bytes_soft_compaction_signal"}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

async fn suspend_in(
    tx: &DatabaseTransaction,
    lease: &Lease,
    status: &str,
    reason: &str,
) -> Result<()> {
    exec(tx,"UPDATE agent_v2_runs SET status=$2,pause_reason=$3,active_ms=active_ms+COALESCE((EXTRACT(EPOCH FROM(now()-active_since))*1000)::bigint,0),active_since=CASE WHEN EXISTS(SELECT 1 FROM agent_v2_executions WHERE run_id=$1::uuid AND status IN ('queued','running') AND stop_confirmed_at IS NULL) THEN now() ELSE NULL END,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1::uuid",vec![id(lease.run_id),status.into(),reason.into()]).await?;
    let facts=rows(tx,"SELECT jsonb_build_object('modelRequests',model_requests,'modelLimit',model_limit,'activeMs',active_ms,'budgetMs',budget_ms,'stage',stage,'step',checkpoint->'step','completedTools',(SELECT count(*) FROM agent_v2_tool_invocations t WHERE t.run_id=r.id AND t.status='completed'))::text data FROM agent_v2_runs r WHERE id=$1::uuid",vec![id(lease.run_id)]).await?.pop().unwrap_or(Value::Null);
    event(
        tx,
        lease.session_id,
        Some(lease.run_id),
        &format!("run.{status}"),
        json!({"reason":reason,"completionClaimed":false,"facts":facts}),
    )
    .await?;
    Ok(())
}
