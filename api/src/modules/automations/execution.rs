//! Persistent execution service shared by every trigger adapter.
use super::engine::{AtomicStep, Cursor, Runtime, StepResult, Transition};
use super::*;
use crate::infrastructure::entities::workflow_instance_entity;
use crate::modules::workflows;
use sea_orm::{DatabaseTransaction, DbBackend, Statement};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct TriggerSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_uuid: Option<String>,
    pub kind: String,
    pub event: String,
    pub event_id: String,
    pub form_uuid: Option<String>,
    pub record_uuid: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ExecutionIdentity {
    pub user_id: Option<Uuid>,
    pub display_name: String,
    pub operator: String,
}
#[derive(Clone, Copy)]
pub(crate) enum ExecutionPolicy {
    Before,
    Inline,
    Background,
}
impl ExecutionPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Before => "before",
            Self::Inline => "inline",
            Self::Background => "background",
        }
    }
}
pub(crate) struct StartExecutionRequest<'a> {
    pub flow: &'a automation_flow_entity::Model,
    pub source: TriggerSource,
    pub identity: ExecutionIdentity,
    pub policy: ExecutionPolicy,
    pub input: &'a Value,
    pub instance_id: Option<Uuid>,
    pub start_node: &'a str,
    pub outputs: Option<HashMap<String, Value>>,
    pub retry_source: Option<RetrySource>,
    pub retry_run: Option<&'a str>,
}
pub(crate) async fn sql<C: ConnectionTrait>(
    db: &C,
    query: &str,
    args: Vec<sea_orm::Value>,
) -> Result<sea_orm::ExecResult, AppError> {
    Ok(db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            query,
            args,
        ))
        .await?)
}
pub(crate) async fn load_version<C: ConnectionTrait>(
    db: &C,
    flow: &automation_flow_entity::Model,
    version: i32,
) -> Result<automation_flow_entity::Model, AppError> {
    let snapshot = AutomationFlowVersionEntity::find()
        .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
        .filter(automation_flow_version_entity::Column::Version.eq(version))
        .one(db)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(format!("execution definition version {version} is missing"))
        })?;
    let mut result = flow.clone();
    result.current_version = version;
    result.nodes_json = snapshot.nodes_json;
    result.edges_json = snapshot.edges_json;
    result.trigger_config = snapshot.trigger_config;
    result.trigger_form_uuid = snapshot.trigger_form_uuid;
    Ok(result)
}
// Caller owns the transaction: business changes and execution creation commit together.
pub(crate) async fn start_execution(
    db: &DatabaseTransaction,
    request: StartExecutionRequest<'_>,
) -> Result<Uuid, AppError> {
    let event_key = format!("{}:{}", request.source.event_id, request.flow.id);
    sql(
        db,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        vec![event_key.clone().into()],
    )
    .await?;
    if let Some(existing) = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT run_id FROM automation_execution_runs WHERE event_key=$1",
            vec![event_key.into()],
        ))
        .await?
    {
        return Ok(existing.try_get("", "run_id")?);
    }
    let version = load_version(db, request.flow, request.flow.current_version).await;
    let (flow, validation) = match version {
        Ok(flow) => {
            let validation = validate_execution_definition(&flow);
            (flow, validation)
        }
        Err(error) if matches!(request.policy, ExecutionPolicy::Background) => {
            (request.flow.clone(), Err(error))
        }
        Err(error) => return Err(error),
    };
    if request.source.kind == "button"
        && automation_trigger_events(&flow.trigger_config) == ["button_click"]
        && request.source.form_uuid.as_deref() != flow.trigger_form_uuid.as_deref()
    {
        return Err(AppError::BadRequest(
            "按钮来源表单与自动化来源表单不匹配".into(),
        ));
    }
    let run = create_automation_run(
        db,
        &flow,
        &request.source.event,
        request.input,
        request.retry_source,
        request.retry_run,
        (request.start_node != "trigger-1").then_some(request.start_node),
    )
    .await?;
    sql(
        db,
        "UPDATE automation_flow_runs SET workflow_instance_id=$2,status='queued' WHERE id=$1",
        vec![run.id.into(), request.instance_id.into()],
    )
    .await?;
    sql(db, "INSERT INTO automation_execution_runs(run_id,source,identity,policy,event_key,definition) VALUES($1,$2,$3,$4,$5,$6)",
        vec![run.id.into(), json!(request.source).into(), json!(request.identity).into(), request.policy.as_str().into(),
            format!("{}:{}", request.source.event_id, flow.id).into(),
            json!({"nodes":flow.nodes_json,"edges":flow.edges_json,"triggerConfig":flow.trigger_config,"triggerFormUuid":flow.trigger_form_uuid}).into()]).await?;
    if let Err(error) = validation {
        finalize_automation_run(db, run.id, "failed", Some(format!("{error:?}"))).await?;
        if !matches!(request.policy, ExecutionPolicy::Background) {
            return Err(error);
        }
        return Ok(run.id);
    }
    let cursor = Cursor {
        id: Uuid::new_v4(),
        node: request.start_node.into(),
        depth: 0,
        log_id: None,
        parallel_group: None,
        context: AutomationExecutionContext {
            outputs: request
                .outputs
                .unwrap_or_else(|| HashMap::from([("trigger-1".into(), request.input.clone())])),
            operator: request.identity.operator,
            run_id: Some(run.id),
        },
    };
    insert_token(db, run.id, request.instance_id, None, &cursor).await?;
    Ok(run.id)
}
async fn insert_token<C: ConnectionTrait>(
    db: &C,
    run: Uuid,
    instance: Option<Uuid>,
    parent: Option<Uuid>,
    cursor: &Cursor,
) -> Result<(), AppError> {
    sql(db,"INSERT INTO automation_execution_tokens(id,run_id,instance_id,parent_token_id,node_key,status,outputs,depth,parallel_group) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8)",
        vec![cursor.id.into(),run.into(),instance.into(),parent.into(),cursor.node.clone().into(),json!(cursor.context.outputs).into(),(cursor.depth as i32).into(),cursor.parallel_group.into()]).await?;
    Ok(())
}

pub(crate) struct PersistentRuntime<'a> {
    state: &'a AppState,
    flow: automation_flow_entity::Model,
    run: Uuid,
    owner: Uuid,
    fence: i64,
    instance: Option<workflow_instance_entity::Model>,
}
impl PersistentRuntime<'_> {
    // Shared row lock allows sibling nodes to overlap, but fences lease takeover and pause.
    async fn guard(&self, db: &DatabaseTransaction) -> Result<bool, AppError> {
        if let Some(instance) = &self.instance {
            db.query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id FROM workflow_instances WHERE id=$1 FOR SHARE",
                vec![instance.id.into()],
            ))
            .await?;
        }
        let row=db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
            "SELECT r.status FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND e.owner=$2 AND e.fence=$3 AND e.lease_until>NOW() FOR SHARE OF e,r",
            vec![self.run.into(),self.owner.into(),self.fence.into()])).await?;
        Ok(row.is_some_and(|r| {
            r.try_get::<String>("", "status")
                .is_ok_and(|s| matches!(s.as_str(), "running" | "paused"))
        }))
    }
    async fn advance(
        &self,
        db: &DatabaseTransaction,
        cursor: &mut Cursor,
        node: &Value,
    ) -> Result<AtomicStep, AppError> {
        match engine::transition(&self.flow, node, &cursor.context) {
            Transition::End => {
                save_token(db, cursor, "completed").await?;
                Ok(AtomicStep::Stopped)
            }
            Transition::Continue(next) => {
                cursor.node = next;
                save_token(db, cursor, "queued").await?;
                Ok(AtomicStep::Continue)
            }
            Transition::Split { targets, parallel } => {
                let mut children = Vec::new();
                for target in targets {
                    let child = Cursor {
                        id: Uuid::new_v4(),
                        node: target,
                        log_id: None,
                        parallel_group: parallel.then_some(cursor.id),
                        ..cursor.clone()
                    };
                    insert_token(
                        db,
                        self.run,
                        self.instance.as_ref().map(|i| i.id),
                        Some(cursor.id),
                        &child,
                    )
                    .await?;
                    children.push(child);
                }
                save_token(db, cursor, "completed").await?;
                Ok(AtomicStep::Split { children, parallel })
            }
        }
    }
    async fn log(
        &self,
        db: &DatabaseTransaction,
        cursor: &mut Cursor,
        node: &Value,
    ) -> Result<(), AppError> {
        let log = crate::platform::automation_runs::create_branch_node_log(
            db,
            self.run,
            cursor.id,
            &cursor.node,
            node.pointer("/data/kind")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            node.pointer("/data/label")
                .and_then(Value::as_str)
                .unwrap_or(&cursor.node),
            json!(cursor.context.outputs),
        )
        .await?;
        let visit = Uuid::new_v4();
        sql(db,"UPDATE automation_flow_run_nodes SET visit_id=$2,attempt=COALESCE((SELECT attempt FROM automation_execution_tokens WHERE id=$3),1) WHERE id=$1",vec![log.into(),visit.into(),cursor.id.into()]).await?;
        sql(db,"UPDATE automation_execution_tokens SET visit_id=$2,status='running',depth=$3,updated_at=NOW() WHERE id=$1",vec![cursor.id.into(),visit.into(),(cursor.depth as i32).into()]).await?;
        cursor.log_id = Some(log);
        Ok(())
    }
    async fn step(&self, cursor: &mut Cursor, node: &Value) -> Result<AtomicStep, AppError> {
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let config = node
            .pointer("/data/config")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(AtomicStep::Stopped);
        }
        let run = AutomationRunEntity::find_by_id(self.run)
            .one(&txn)
            .await?
            .unwrap();
        if run.status == "paused" {
            return Ok(AtomicStep::Stopped);
        }
        self.log(&txn, cursor, node).await?;
        if kind == "trigger" && self.flow.trigger_form_uuid.is_some() {
            let source_form_uuid = self.flow.trigger_form_uuid.as_deref().unwrap();
            let source_record = cursor
                .context
                .outputs
                .get("trigger-1")
                .cloned()
                .unwrap_or(Value::Null);
            cursor
                .context
                .outputs
                .insert("__buttonSourceFormUuid".into(), json!(source_form_uuid));
            for query in self
                .flow
                .nodes_json
                .as_array()
                .into_iter()
                .flatten()
                .filter(|candidate| {
                    matches!(
                        candidate.pointer("/data/kind").and_then(Value::as_str),
                        Some("get-one" | "get-many")
                    ) && candidate
                        .pointer("/data/config/sourceMode")
                        .and_then(Value::as_str)
                        == Some("trigger")
                })
            {
                let id = query.get("id").and_then(Value::as_str).unwrap_or_default();
                cursor
                    .context
                    .outputs
                    .insert(id.to_string(), source_record.clone());
            }
            cursor
                .context
                .outputs
                .insert("trigger-1".into(), source_record);
        }
        if kind == "http-request" {
            txn.commit().await?;
            let output = execute_http_request_node(&config, &cursor.context).await;
            let txn = self.state.db.begin().await?;
            if !self.guard(&txn).await? {
                return Ok(AtomicStep::Stopped);
            }
            match output {
                Ok(value) => {
                    cursor.context.outputs.insert(cursor.node.clone(), value);
                }
                Err(error) => {
                    sql(&txn,"UPDATE automation_execution_tokens SET status='needs_attention',error_message=$2 WHERE id=$1",vec![cursor.id.into(),format!("{error:?}").into()]).await?;
                    finalize_automation_run_node_log(
                        &txn,
                        cursor.log_id.unwrap(),
                        "needs_attention",
                        None,
                        Some(format!("{error:?}")),
                    )
                    .await?;
                    txn.commit().await?;
                    return Ok(AtomicStep::Stopped);
                }
            }
            finalize_automation_run_node_log(
                &txn,
                cursor.log_id.unwrap(),
                "success",
                cursor.context.outputs.get(&cursor.node).cloned(),
                None,
            )
            .await?;
            let step = self.advance(&txn, cursor, node).await?;
            txn.commit().await?;
            cursor.log_id = None;
            return Ok(step);
        }
        if matches!(kind, "approval" | "executor" | "copy") {
            let instance = self.instance.as_ref().ok_or_else(|| {
                AppError::BadRequest("human node requires workflow business binding".into())
            })?;
            let output =
                workflows::execute_human_node(&txn, self.state, instance, cursor, node).await?;
            if let Some(output) = output {
                cursor.context.outputs.insert(cursor.node.clone(), output);
            } else {
                save_token(&txn, cursor, "waiting").await?;
                crate::platform::automation_runs::wait_node_log(&txn, cursor.log_id.unwrap())
                    .await?;
                txn.commit().await?;
                cursor.log_id = None;
                return Ok(AtomicStep::Stopped);
            }
        } else {
            execute_shared_node(
                &txn,
                &self.flow,
                &cursor.node,
                kind,
                &config,
                &mut cursor.context,
            )
            .await?;
        }
        finalize_automation_run_node_log(
            &txn,
            cursor.log_id.unwrap(),
            "success",
            cursor.context.outputs.get(&cursor.node).cloned(),
            None,
        )
        .await?;
        let step = self.advance(&txn, cursor, node).await?;
        txn.commit().await?;
        cursor.log_id = None;
        Ok(step)
    }
}
pub(crate) async fn save_token<C: ConnectionTrait>(
    db: &C,
    cursor: &Cursor,
    status: &str,
) -> Result<(), AppError> {
    sql(db,"UPDATE automation_execution_tokens SET node_key=$2,status=$3,outputs=$4,depth=$5,updated_at=NOW() WHERE id=$1",
        vec![cursor.id.into(),cursor.node.clone().into(),status.into(),json!(cursor.context.outputs).into(),(cursor.depth as i32).into()]).await?;
    Ok(())
}
impl Runtime for PersistentRuntime<'_> {
    fn db(&self) -> &DatabaseConnection {
        &self.state.db
    }
    fn flow(&self) -> &automation_flow_entity::Model {
        &self.flow
    }
    async fn atomic_step(
        &self,
        cursor: &mut Cursor,
        node: &Value,
    ) -> Result<Option<AtomicStep>, AppError> {
        let mut working = cursor.clone();
        let result = self.step(&mut working, node).await;
        if result.is_ok() {
            *cursor = working;
        }
        result.map(Some)
    }
    async fn claim(&self, cursor: &mut Cursor) -> Result<bool, AppError> {
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(false);
        }
        let row=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
            "SELECT node_key,outputs,depth,status FROM automation_execution_tokens WHERE id=$1 AND run_id=$2 FOR UPDATE",
            vec![cursor.id.into(),self.run.into()])).await?;
        let Some(row) = row else { return Ok(false) };
        if row.try_get::<String>("", "status")? != "queued" {
            return Ok(false);
        }
        cursor.node = row.try_get("", "node_key")?;
        cursor.depth = row.try_get::<i32>("", "depth")? as usize;
        cursor.context.outputs = serde_json::from_value(row.try_get("", "outputs")?)
            .map_err(|_| AppError::BadRequest("invalid execution outputs".into()))?;
        cursor.context.run_id = Some(self.run);
        txn.commit().await?;
        Ok(true)
    }
    async fn ready(&self, _: &Cursor) -> Result<bool, AppError> {
        Ok(true)
    }
    async fn checkpoint(&self, _: &Cursor) -> Result<bool, AppError> {
        Ok(true)
    }
    async fn human(&self, _: &Cursor, _: &Value) -> Result<StepResult, AppError> {
        unreachable!("atomic step handles all nodes")
    }
    async fn split(&self, _: &Cursor, _: &[String], _: bool) -> Result<Vec<Cursor>, AppError> {
        unreachable!("atomic step handles transitions")
    }
    async fn finish(&self, cursor: &Cursor) -> Result<(), AppError> {
        let txn = self.state.db.begin().await?;
        if self.guard(&txn).await? {
            save_token(&txn, cursor, "completed").await?;
        }
        txn.commit().await?;
        Ok(())
    }
    async fn failed(&self, cursor: &Cursor, error: &AppError) -> Result<(), AppError> {
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(());
        }
        let external=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT id FROM automation_flow_run_nodes WHERE run_id=$1 AND branch_id=$2 AND node_kind='http-request' AND status='running'",vec![self.run.into(),cursor.id.into()])).await?.is_some();
        if external {
            sql(&txn,"UPDATE automation_execution_tokens SET status='needs_attention',error_message=$2 WHERE id=$1",vec![cursor.id.into(),format!("{error:?}").into()]).await?;
            sql(&txn,"UPDATE automation_flow_run_nodes SET status='needs_attention',error_message=$3 WHERE run_id=$1 AND branch_id=$2 AND status='running'",vec![self.run.into(),cursor.id.into(),format!("{error:?}").into()]).await?;
            txn.commit().await?;
            return Ok(());
        }
        sql(&txn,"UPDATE automation_execution_tokens SET status='failed' ,error_message=$2 WHERE id=$1 AND status NOT IN ('completed','cancelled','needs_attention')",vec![cursor.id.into(),format!("{error:?}").into()]).await?;
        // A failed transaction may have rolled back the original log.
        let kind = self
            .flow
            .nodes_json
            .as_array()
            .into_iter()
            .flatten()
            .find(|n| n["id"].as_str() == Some(&cursor.node))
            .and_then(|n| n.pointer("/data/kind"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let log = crate::platform::automation_runs::create_branch_node_log(
            &txn,
            self.run,
            cursor.id,
            &cursor.node,
            kind,
            "执行失败",
            json!(cursor.context.outputs),
        )
        .await?;
        sql(
            &txn,
            "UPDATE automation_flow_run_nodes SET visit_id=$2 WHERE id=$1",
            vec![log.into(), Uuid::new_v4().into()],
        )
        .await?;
        finalize_automation_run_node_log(&txn, log, "failed", None, Some(format!("{error:?}")))
            .await?;
        txn.commit().await?;
        Ok(())
    }
}

fn config_number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
}
pub(crate) async fn drive_execution(state: &AppState, run: Uuid) -> Result<(), AppError> {
    recover_expired(state).await?;
    let owner = Uuid::new_v4();
    let lease = config_number("YAYA_EXECUTION_LEASE_SECONDS", 60) as i64;
    let txn = state.db.begin().await?;
    let claimed=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "SELECT e.fence FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND r.status IN ('queued','running','waiting') AND (e.owner IS NULL OR e.lease_until<NOW()) FOR UPDATE OF e,r SKIP LOCKED",vec![run.into()])).await?;
    let Some(claimed) = claimed else {
        return Ok(());
    };
    let fence = claimed.try_get::<i64>("", "fence")? + 1;
    sql(&txn,"UPDATE automation_execution_runs SET owner=$2,fence=$3,lease_until=NOW()+($4*INTERVAL '1 second') WHERE run_id=$1",vec![run.into(),owner.into(),fence.into(),lease.into()]).await?;
    sql(
        &txn,
        "UPDATE automation_flow_runs SET status='running',updated_at=NOW() WHERE id=$1",
        vec![run.into()],
    )
    .await?;
    txn.commit().await?;
    let db = state.db.clone();
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let heartbeat = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(
            config_number("YAYA_EXECUTION_HEARTBEAT_SECONDS", 10).min((lease as u64 / 3).max(1)),
        ));
        loop {
            tokio::select! {
                _=stopped.changed()=>break,
                _=interval.tick()=>{if sql(&db,"UPDATE automation_execution_runs SET lease_until=NOW()+($4*INTERVAL '1 second') WHERE run_id=$1 AND owner=$2 AND fence=$3 AND lease_until>NOW()",vec![run.into(),owner.into(),fence.into(),lease.into()]).await.is_err(){break;}}
            }
        }
    });
    let result = drive_claimed(state, run, owner, fence).await;
    let _ = stop.send(true);
    let _ = heartbeat.await;
    // Release only our own lease. A newer claimant is never overwritten.
    sql(&state.db,"UPDATE automation_execution_runs SET owner=NULL,lease_until=NULL WHERE run_id=$1 AND owner=$2 AND fence=$3",vec![run.into(),owner.into(),fence.into()]).await?;
    result
}
async fn drive_claimed(
    state: &AppState,
    run: Uuid,
    owner: Uuid,
    fence: i64,
) -> Result<(), AppError> {
    let run_model = AutomationRunEntity::find_by_id(run)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("execution not found".into()))?;
    let mut flow = AutomationFlowEntity::find_by_id(run_model.flow_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("execution definition missing".into()))?;
    let row = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT definition,identity FROM automation_execution_runs WHERE run_id=$1",
            vec![run.into()],
        ))
        .await?
        .unwrap();
    let definition: Value = row.try_get("", "definition")?;
    flow.current_version = run_model.flow_version;
    flow.nodes_json = definition["nodes"].clone();
    flow.edges_json = definition["edges"].clone();
    flow.trigger_config = definition["triggerConfig"].clone();
    flow.trigger_form_uuid = definition["triggerFormUuid"].as_str().map(str::to_string);
    let identity: ExecutionIdentity = serde_json::from_value(row.try_get("", "identity")?)
        .map_err(|_| AppError::BadRequest("invalid execution identity".into()))?;
    let instance = if let Some(id) = run_model.workflow_instance_id {
        workflow_instance_entity::Entity::find_by_id(id)
            .one(&state.db)
            .await?
    } else {
        None
    };
    let runtime = PersistentRuntime {
        state,
        flow,
        run,
        owner,
        fence,
        instance,
    };
    let result=async {
        validate_execution_definition(&runtime.flow)?;
        validate_execution_sources(&state.db,&runtime.flow).await?;
        let rows=state.db.query_all_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT id,parallel_group FROM automation_execution_tokens WHERE run_id=$1 AND status='queued' ORDER BY sequence",vec![run.into()])).await?;
        let mut groups:Vec<(Option<Uuid>,Vec<Cursor>)>=Vec::new();
        for row in rows {
            let cursor=Cursor{id:row.try_get("","id")?,parallel_group:row.try_get("","parallel_group")?,node:String::new(),depth:0,log_id:None,
                context:AutomationExecutionContext{outputs:HashMap::new(),operator:identity.operator.clone(),run_id:Some(run)}};
            if cursor.parallel_group.is_some()&&groups.last().is_some_and(|(g,_)|*g==cursor.parallel_group){groups.last_mut().unwrap().1.push(cursor);}
            else{groups.push((cursor.parallel_group,vec![cursor]));}
        }
        let mut error=None;
        for (parallel,cursors) in groups{if let Err(e)=engine::schedule(&runtime,cursors,parallel.is_some()).await{if error.is_none(){error=Some(e);}}}
        error.map_or(Ok(()),Err)
    }.await;
    finalize_execution(&runtime, result.as_ref().err()).await?;
    result
}
async fn finalize_execution(
    runtime: &PersistentRuntime<'_>,
    error: Option<&AppError>,
) -> Result<(), AppError> {
    let txn = runtime.state.db.begin().await?;
    if let Some(instance) = &runtime.instance {
        txn.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id FROM workflow_instances WHERE id=$1 FOR UPDATE",
            vec![instance.id.into()],
        ))
        .await?;
    }
    let row=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "SELECT r.status FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND e.owner=$2 AND e.fence=$3 AND e.lease_until>NOW() FOR UPDATE OF e,r",
        vec![runtime.run.into(),runtime.owner.into(),runtime.fence.into()])).await?;
    let Some(row) = row else { return Ok(()) };
    if row.try_get::<String>("", "status")? != "running" {
        return Ok(());
    }
    let rows = txn
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT status FROM automation_execution_tokens WHERE run_id=$1",
            vec![runtime.run.into()],
        ))
        .await?;
    let statuses = rows
        .iter()
        .map(|r| r.try_get::<String>("", "status"))
        .collect::<Result<Vec<_>, _>>()?;
    let status = if statuses.iter().any(|s| s == "needs_attention") {
        "needs_attention"
    } else if error.is_some() || statuses.iter().any(|s| s == "failed") {
        "failed"
    } else if statuses.iter().all(|s| s == "completed") {
        "success"
    } else if statuses.iter().any(|s| s == "queued") {
        "queued"
    } else {
        "waiting"
    };
    if matches!(status, "success" | "failed") {
        if status == "failed" {
            sql(&txn,"UPDATE automation_execution_tokens SET status='cancelled' WHERE run_id=$1 AND status IN ('queued','running','waiting')",vec![runtime.run.into()]).await?;
        }
        if let Some(instance) = &runtime.instance {
            if status == "success" {
                workflows::complete_instance(
                    &txn,
                    instance,
                    "completed",
                    "approved",
                    "completed",
                    "已结束",
                    "系统",
                )
                .await?;
            } else {
                workflows::skip_pending_tasks(
                    &txn,
                    instance,
                    None,
                    "流程执行失败",
                    Utc::now(),
                    None,
                )
                .await?;
                workflows::complete_instance(
                    &txn,
                    instance,
                    "failed",
                    "reviewing",
                    "failed",
                    "执行失败",
                    "系统",
                )
                .await?;
            }
        }
        finalize_automation_run(&txn, runtime.run, status, error.map(|e| format!("{e:?}"))).await?;
    } else {
        if status == "waiting" {
            if let Some(instance) = &runtime.instance {
                let waiting=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
                    "SELECT node_key FROM automation_execution_tokens WHERE run_id=$1 AND status='waiting' ORDER BY sequence LIMIT 1",vec![runtime.run.into()])).await?;
                if let Some(waiting) = waiting {
                    let node: String = waiting.try_get("", "node_key")?;
                    sql(&txn,"UPDATE workflow_instances SET current_node_key=$2,updated_at=NOW() WHERE id=$1",vec![instance.id.into(),node.clone().into()]).await?;
                    let record = RecordRepository::new(&txn)
                        .find_for_update(&instance.form_uuid, &instance.record_uuid)
                        .await?;
                    workflows::update_record_state(
                        &txn,
                        &record,
                        "系统",
                        "reviewing",
                        "running",
                        &node,
                    )
                    .await?;
                }
            }
        }
        sql(&txn,"UPDATE automation_flow_runs SET status=$2,error_message=$3,updated_at=NOW() WHERE id=$1",vec![runtime.run.into(),status.into(),(status=="needs_attention").then(||"外部调用结果不确定，请核实后处理".to_string()).into()]).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub(crate) fn start_worker(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut shutdown = state.shutdown_receiver();
        let mut interval = tokio::time::interval(Duration::from_millis(config_number(
            "YAYA_EXECUTION_POLL_MS",
            1000,
        )));
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(config_number(
            "YAYA_EXECUTION_CONCURRENCY",
            4,
        ) as usize));
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                _=shutdown.changed()=>break,
                Some(result)=tasks.join_next(),if !tasks.is_empty()=>{if let Err(e)=result{error!(?e,"execution worker task failed");}},
                _=interval.tick()=>{
                    if let Err(e)=recover_expired(&state).await{error!(?e,"execution recovery failed");continue;}
                    let notification_state=state.clone();
                    if tasks.len()<8{tasks.spawn(async move{if let Err(e)=workflows::dispatch_pending_notifications(&notification_state).await{error!(?e,"workflow notification dispatch failed");}});}
                    let rows=state.db.query_all_raw(Statement::from_string(DbBackend::Postgres,
                        "SELECT e.run_id FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.policy<>'before' AND r.status IN ('queued','running') AND e.owner IS NULL ORDER BY r.created_at LIMIT 32".to_string())).await;
                    match rows{Ok(rows)=>for row in rows{
                        let Ok(permit)=semaphore.clone().try_acquire_owned()else{break};
                        let Ok(run)=row.try_get::<Uuid>("","run_id")else{continue};let state=state.clone();
                        tasks.spawn(async move{let _permit=permit;if let Err(e)=drive_execution(&state,run).await{error!(?e,%run,"background execution failed");}});
                    },Err(e)=>error!(?e,"execution queue scan failed")}
                }
            }
        }
        while tasks.join_next().await.is_some() {}
    })
}
pub(crate) async fn recover_expired(state: &AppState) -> Result<(), AppError> {
    let txn = state.db.begin().await?;
    let rows=txn.query_all_raw(Statement::from_string(DbBackend::Postgres,
        "SELECT e.run_id,e.policy FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE ((e.owner IS NOT NULL AND e.lease_until<NOW()) OR (e.owner IS NULL AND r.status='running')) AND r.status IN ('running','queued') FOR UPDATE OF e,r SKIP LOCKED".to_string())).await?;
    for row in rows {
        let run: Uuid = row.try_get("", "run_id")?;
        let policy: String = row.try_get("", "policy")?;
        sql(&txn,"UPDATE automation_execution_runs SET owner=NULL,lease_until=NULL,fence=fence+1 WHERE run_id=$1",vec![run.into()]).await?;
        if policy == "before" {
            sql(&txn,"UPDATE automation_execution_tokens SET status='failed',error_message='synchronous caller interrupted' WHERE run_id=$1 AND status NOT IN ('completed','cancelled')",vec![run.into()]).await?;
            finalize_automation_run(
                &txn,
                run,
                "failed",
                Some("同步调用中断，不在后台重放".into()),
            )
            .await?;
        } else {
            sql(&txn,"UPDATE automation_execution_tokens t SET status='needs_attention',error_message='external result uncertain' WHERE t.run_id=$1 AND t.status='running' AND EXISTS(SELECT 1 FROM automation_flow_run_nodes n WHERE n.run_id=$1 AND n.visit_id=t.visit_id AND n.node_kind='http-request' AND n.status='running')",vec![run.into()]).await?;
            sql(&txn,"UPDATE automation_execution_tokens SET status='queued' WHERE run_id=$1 AND status='running'",vec![run.into()]).await?;
            sql(&txn,"UPDATE automation_flow_run_nodes SET status='needs_attention',error_message='external result uncertain' WHERE run_id=$1 AND status='running' AND node_kind='http-request'",vec![run.into()]).await?;
            sql(&txn,"UPDATE automation_flow_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM automation_execution_tokens WHERE run_id=$1 AND status='needs_attention') THEN 'needs_attention' ELSE 'queued' END WHERE id=$1",vec![run.into()]).await?;
        }
    }
    txn.commit().await?;
    Ok(())
}

pub(crate) async fn enqueue_form_event(
    db: &DatabaseTransaction,
    definition: &form_definition_entity::Model,
    event: &str,
    input: &Value,
    identity: ExecutionIdentity,
    changed_fields: Option<&HashSet<String>>,
) -> Result<(), AppError> {
    let flows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(&definition.app_route_app_id))
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(&definition.form_uuid))
        .filter(automation_flow_entity::Column::FlowType.eq("trigger"))
        .filter(automation_flow_entity::Column::Status.eq("enabled"))
        .all(db)
        .await?;
    let event_id = Uuid::new_v4().to_string();
    for flow in flows {
        if !automation_trigger_events(&flow.trigger_config)
            .iter()
            .any(|e| e == event)
            || !flow_matches_changed_fields(event, &flow.trigger_config, changed_fields)
        {
            continue;
        }
        start_execution(
            db,
            StartExecutionRequest {
                flow: &flow,
                source: TriggerSource {
                    button_uuid: None,
                    view_uuid: None,
                    kind: "form_event".into(),
                    event: event.into(),
                    event_id: event_id.clone(),
                    form_uuid: Some(definition.form_uuid.clone()),
                    record_uuid: input
                        .get("__automationRecordUuid")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                },
                identity: identity.clone(),
                policy: ExecutionPolicy::Background,
                input,
                instance_id: None,
                start_node: "trigger-1",
                outputs: None,
                retry_source: None,
                retry_run: None,
            },
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "execution_tests.rs"]
mod tests;
