//! Durable approvals. Session -> run -> confirmation is the lock order everywhere.
use crate::{
    domain::{Scope, ToolCall},
    store::{Lease, Store, event, exec, fingerprint, id, js, rows},
};
use anyhow::{Context, Result, bail};
use sea_orm::{ConnectionTrait, DatabaseTransaction};
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn resolve(
    tx: &impl ConnectionTrait,
    scope: &Scope,
    session: Uuid,
    confirmation: Uuid,
    approve: bool,
) -> Result<()> {
    let run = rows(tx,"SELECT jsonb_build_object('run_id',c.run_id)::text data FROM agent_v2_confirmations c JOIN agent_v2_sessions s ON s.id=c.session_id WHERE c.id=$1::uuid AND c.session_id=$2::uuid AND c.tenant_id=$3::uuid AND c.owner_user_id=$4::uuid AND c.employee_id=s.employee_id AND s.tenant_id=c.tenant_id AND s.owner_user_id=c.owner_user_id",vec![id(confirmation),id(session),id(scope.tenant_id),id(scope.user_id)]).await?.pop().context("confirmation not found")?;
    let run_id = Uuid::parse_str(run["run_id"].as_str().context("run id")?)?;
    let active=rows(tx,"SELECT row_to_json(r)::text data FROM agent_v2_runs r WHERE id=$1::uuid AND status='waiting_confirmation' FOR UPDATE",vec![id(run_id)]).await?;
    let c=rows(tx,"SELECT row_to_json(c)::text data FROM agent_v2_confirmations c WHERE id=$1::uuid FOR UPDATE",vec![id(confirmation)]).await?.pop().context("confirmation not found")?;
    let desired = if approve { "approved" } else { "rejected" };
    if c["status"] == desired || (approve && c["status"] == "executed") {
        return Ok(());
    }
    if active.is_empty() || c["status"] != "pending" {
        bail!("confirmation conflict")
    }
    let updated=rows(tx,"UPDATE agent_v2_confirmations SET status=CASE WHEN expires_at<=now() THEN 'expired' ELSE $2 END,failure=CASE WHEN expires_at<=now() THEN jsonb_build_object('status','expired','executed',false) WHEN $2='rejected' THEN jsonb_build_object('status','rejected','executed',false) ELSE failure END,resolved_by=$3::uuid,resolved_at=now() WHERE id=$1::uuid RETURNING row_to_json(agent_v2_confirmations)::text data",vec![id(confirmation),desired.into(),id(scope.user_id)]).await?.pop().context("confirmation update")?;
    exec(tx,"INSERT INTO agent_v2_tool_audit(id,confirmation_id,actor_user_id,action,outcome) VALUES($1::uuid,$2::uuid,$3::uuid,regexp_replace($4,'^platform_',''),$5)",vec![id(Uuid::new_v4()),id(confirmation),id(scope.user_id),c["tool_name"].as_str().unwrap_or_default().into(),updated["status"].as_str().unwrap_or_default().into()]).await?;
    exec(tx,"UPDATE agent_v2_runs SET status='queued',available_at=now(),updated_at=now() WHERE id=$1::uuid",vec![id(run_id)]).await?;
    event(
        tx,
        session,
        Some(run_id),
        "confirmation.resolved",
        json!({"confirmationId":confirmation,"status":updated["status"]}),
    )
    .await?;
    event(
        tx,
        session,
        Some(run_id),
        "run.queued",
        json!({"reason":"confirmation_resolved"}),
    )
    .await?;
    Ok(())
}

impl Store {
    pub async fn confirmations(&self, scope: &Scope, session: Uuid) -> Result<Vec<Value>> {
        self.session(scope, session).await?;
        rows(&self.db,"SELECT (to_jsonb(c)||jsonb_build_object('result',COALESCE(e.result,c.failure)))::text data FROM agent_v2_confirmations c LEFT JOIN agent_v2_effects e ON e.effect_key=c.id WHERE c.session_id=$1::uuid ORDER BY c.created_at,c.id",vec![id(session)]).await
    }
    pub async fn request_confirmation(
        &self,
        lease: &Lease,
        call: &ToolCall,
        version: &str,
        preview: Value,
        ttl_seconds: i32,
    ) -> Result<Value> {
        let tx = self.fence(lease, false).await?;
        let result = self
            .request_confirmation_in(&tx, lease, call, version, preview, ttl_seconds)
            .await?;
        tx.commit().await?;
        Ok(result)
    }
    /// The broker captures the resource version and human preview under these
    /// same locks, so they cannot describe different committed resource states.
    pub async fn request_confirmation_in(
        &self,
        tx: &DatabaseTransaction,
        lease: &Lease,
        call: &ToolCall,
        version: &str,
        preview: Value,
        ttl_seconds: i32,
    ) -> Result<Value> {
        rows(tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid FOR UPDATE",vec![id(lease.session_id)]).await?;
        if rows(tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_runs WHERE id=$1::uuid AND session_id=$2::uuid AND lease_owner=$3::uuid AND lease_epoch=$4 AND lease_until>now() AND status='running' FOR UPDATE",vec![id(lease.run_id),id(lease.session_id),id(lease.owner),lease.epoch.into()]).await?.is_empty(){bail!("lease lost or cancelled")}
        let previous=rows(tx,"SELECT row_to_json(c)::text data FROM agent_v2_confirmations c WHERE run_id=$1::uuid AND call_id=$2 FOR UPDATE",vec![id(lease.run_id),call.id.clone().into()]).await?.pop();
        if let Some(old) = previous {
            if old["tool_name"] != call.name
                || old["arguments_hash"] != fingerprint(&call.arguments)
            {
                bail!("confirmation conflict")
            }
            return Ok(old);
        }
        let confirmation = Uuid::new_v4();
        let row=rows(tx,"INSERT INTO agent_v2_confirmations(id,session_id,run_id,tenant_id,owner_user_id,employee_id,call_id,tool_name,arguments,arguments_hash,resource_version,preview,status,expires_at,policy_version) SELECT $1::uuid,s.id,r.id,s.tenant_id,s.owner_user_id,s.employee_id,$4,$5,$6,$7,$8,$9,'pending',now()+make_interval(secs=>$10),$13 FROM agent_v2_sessions s JOIN agent_v2_runs r ON r.session_id=s.id WHERE s.id=$2::uuid AND r.id=$3::uuid AND r.lease_owner=$11::uuid AND r.lease_epoch=$12 AND r.lease_until>now() RETURNING row_to_json(agent_v2_confirmations)::text data",vec![id(confirmation),id(lease.session_id),id(lease.run_id),call.id.clone().into(),call.name.clone().into(),js(call.arguments.clone()),fingerprint(&call.arguments).into(),version.into(),js(preview.clone()),ttl_seconds.clamp(1,86400).into(),id(lease.owner),lease.epoch.into(),(crate::tools::POLICY_VERSION as i32).into()]).await?.pop().context("confirmation insert")?;
        exec(tx,"UPDATE agent_v2_runs SET status='waiting_confirmation',active_ms=active_ms+COALESCE((EXTRACT(EPOCH FROM(now()-active_since))*1000)::bigint,0),active_since=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1::uuid",vec![id(lease.run_id)]).await?;
        event(tx,lease.session_id,Some(lease.run_id),"confirmation.requested",json!({"confirmationId":confirmation,"callId":call.id,"toolName":call.name,"preview":preview,"expiresAt":row["expires_at"]})).await?;
        event(
            tx,
            lease.session_id,
            Some(lease.run_id),
            "run.waiting_confirmation",
            json!({"confirmationId":confirmation}),
        )
        .await?;
        Ok(row)
    }
    pub async fn expire_confirmations(&self) -> Result<()> {
        // Resolve through the same session-first protocol as browser decisions/cancellation.
        let expired=rows(&self.db,"SELECT jsonb_build_object('id',c.id,'session_id',s.id,'tenant_id',s.tenant_id,'user_id',s.owner_user_id)::text data FROM agent_v2_confirmations c JOIN agent_v2_sessions s ON s.id=c.session_id WHERE c.status='pending' AND c.expires_at<=now() LIMIT 100",vec![]).await?;
        for c in expired {
            let scope = Scope {
                tenant_id: Uuid::parse_str(c["tenant_id"].as_str().context("tenant")?)?,
                user_id: Uuid::parse_str(c["user_id"].as_str().context("user")?)?,
            };
            let session = Uuid::parse_str(c["session_id"].as_str().context("session")?)?;
            let confirmation = Uuid::parse_str(c["id"].as_str().context("confirmation")?)?;
            // Submit uses an owned session lock, dedupe and a durable command.
            let _ = self
                .submit(
                    &scope,
                    session,
                    &crate::domain::Command::Confirm {
                        client_command_id: confirmation,
                        confirmation_id: confirmation,
                        approve: false,
                    },
                )
                .await;
        }
        Ok(())
    }
}
