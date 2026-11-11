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
            branch_id: None,
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
    sql(db,"INSERT INTO automation_execution_tokens(id,run_id,instance_id,parent_token_id,node_key,status,outputs,depth,parallel_group,parallel_branch_id) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9)",
        vec![cursor.id.into(),run.into(),instance.into(),parent.into(),cursor.node.clone().into(),json!(cursor.context.outputs).into(),(cursor.depth as i32).into(),cursor.parallel_group.into(),cursor.context.branch_id.into()]).await?;
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
        let query = format!(
            "SELECT r.status FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND e.owner=$2 AND e.fence=$3 AND e.lease_until>clock_timestamp() FOR SHARE OF e,r"
        );
        let row = db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                &query,
                vec![self.run.into(), self.owner.into(), self.fence.into()],
            ))
            .await?;
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
                let group_id = parallel.then_some(cursor.id);
                for target in targets {
                    let child_id = Uuid::new_v4();
                    let child = Cursor {
                        id: child_id,
                        node: target,
                        log_id: None,
                        parallel_group: group_id.or(cursor.parallel_group),
                        context: AutomationExecutionContext {
                            branch_id: parallel.then_some(child_id).or(cursor.context.branch_id),
                            ..cursor.context.clone()
                        },
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
                if let Some(group_id) = group_id {
                    let expected = children
                        .iter()
                        .filter_map(|child| child.context.branch_id)
                        .collect::<Vec<_>>();
                    let join_node = engine::parallel_join_node(&self.flow, &children);
                    sql(db,"INSERT INTO automation_execution_parallel_groups(id,run_id,parent_group,parent_branch_id,fork_token_id,status,expected_branches,join_node_key) VALUES($1,$2,$3,$4,$5,'running',$6,$7)",vec![group_id.into(),self.run.into(),cursor.parallel_group.into(),cursor.context.branch_id.into(),cursor.id.into(),json!(expected).into(),join_node.into()]).await?;
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
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let label = node
            .pointer("/data/label")
            .and_then(Value::as_str)
            .unwrap_or(&cursor.node);
        let input = json!(cursor.context.outputs);
        let log = crate::platform::automation_runs::create_branch_node_log(
            db,
            self.run,
            cursor.id,
            &cursor.node,
            kind,
            label,
            input,
        )
        .await?;
        let visit = Uuid::new_v4();
        sql(db,"UPDATE automation_flow_run_nodes SET visit_id=$2,attempt=COALESCE((SELECT attempt FROM automation_execution_tokens WHERE id=$3),1) WHERE id=$1",vec![log.into(),visit.into(),cursor.id.into()]).await?;
        sql(db,"UPDATE automation_execution_tokens SET visit_id=$2,status='running',depth=$3,updated_at=NOW() WHERE id=$1",vec![cursor.id.into(),visit.into(),(cursor.depth as i32).into()]).await?;
        cursor.log_id = Some(log);
        Ok(())
    }
    async fn finalize_node_log(
        &self,
        db: &DatabaseTransaction,
        log_id: Uuid,
        status: &str,
        output: Option<Value>,
        error: Option<String>,
    ) -> Result<(), AppError> {
        crate::platform::automation_runs::finalize_automation_run_node_log(
            db, log_id, status, output, error,
        )
        .await
    }
    async fn step(&self, cursor: &mut Cursor, node: &Value) -> Result<AtomicStep, AppError> {
        if node.pointer("/data/kind").and_then(Value::as_str) == Some("http-request") {
            return self.step_http_request(cursor, node).await;
        }
        let txn = self.state.db.begin().await?;
        let result = self.step_in_transaction(&txn, cursor, node).await;
        if result.is_ok() {
            txn.commit().await?;
        }
        result
    }

    async fn step_http_request(
        &self,
        cursor: &mut Cursor,
        node: &Value,
    ) -> Result<AtomicStep, AppError> {
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
            .ok_or_else(|| AppError::NotFound("automation run not found".into()))?;
        if run.status == "paused" {
            return Ok(AtomicStep::Stopped);
        }
        self.log(&txn, cursor, node).await?;
        let effect_id = start_external_effect(&txn, self.run, cursor, &config).await?;
        txn.commit().await?;

        let output = execute_http_request_node(&config, &cursor.context).await;
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(AtomicStep::Stopped);
        }
        match output {
            Ok(value) => {
                cursor.context.outputs.insert(cursor.node.clone(), value);
                complete_external_effect(
                    &txn,
                    effect_id,
                    self.run,
                    cursor,
                    &config,
                    cursor.context.outputs.get(&cursor.node).cloned(),
                )
                .await?;
            }
            Err(error) => {
                sql(&txn,"UPDATE automation_execution_external_effects SET status='uncertain',error_message=$2,updated_at=NOW() WHERE id=$1",vec![effect_id.into(),format!("{error:?}").into()]).await?;
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
                cursor.log_id = None;
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
        Ok(step)
    }

    async fn step_in_transaction(
        &self,
        txn: &DatabaseTransaction,
        cursor: &mut Cursor,
        node: &Value,
    ) -> Result<AtomicStep, AppError> {
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let config = node
            .pointer("/data/config")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if !self.guard(txn).await? {
            return Ok(AtomicStep::Stopped);
        }
        let run = AutomationRunEntity::find_by_id(self.run)
            .one(txn)
            .await?
            .unwrap();
        if run.status == "paused" {
            return Ok(AtomicStep::Stopped);
        }
        self.log(txn, cursor, node).await?;
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
            let effect_id = start_external_effect(txn, self.run, cursor, &config).await?;
            let output = execute_http_request_node(&config, &cursor.context).await;
            if !self.guard(txn).await? {
                return Ok(AtomicStep::Stopped);
            }
            match output {
                Ok(value) => {
                    cursor.context.outputs.insert(cursor.node.clone(), value);
                    complete_external_effect(
                        txn,
                        effect_id,
                        self.run,
                        cursor,
                        &config,
                        cursor.context.outputs.get(&cursor.node).cloned(),
                    )
                    .await?;
                }
                Err(error) => {
                    sql(txn,"UPDATE automation_execution_external_effects SET status='uncertain',error_message=$2,updated_at=NOW() WHERE id=$1",vec![effect_id.into(),format!("{error:?}").into()]).await?;
                    sql(txn,"UPDATE automation_execution_tokens SET status='needs_attention',error_message=$2 WHERE id=$1",vec![cursor.id.into(),format!("{error:?}").into()]).await?;
                    self.finalize_node_log(
                        txn,
                        cursor.log_id.unwrap(),
                        "needs_attention",
                        None,
                        Some(format!("{error:?}")),
                    )
                    .await?;
                    return Ok(AtomicStep::Stopped);
                }
            }
            self.finalize_node_log(
                txn,
                cursor.log_id.unwrap(),
                "success",
                cursor.context.outputs.get(&cursor.node).cloned(),
                None,
            )
            .await?;
            let step = self.advance(txn, cursor, node).await?;
            cursor.log_id = None;
            return Ok(step);
        }
        if matches!(kind, "approval" | "executor" | "copy") {
            let instance = self.instance.as_ref().ok_or_else(|| {
                AppError::BadRequest("human node requires workflow business binding".into())
            })?;
            let output =
                workflows::execute_human_node(txn, self.state, instance, cursor, node).await?;
            if let Some(output) = output {
                cursor.context.outputs.insert(cursor.node.clone(), output);
            } else {
                save_token(txn, cursor, "waiting").await?;
                crate::platform::automation_runs::wait_node_log(txn, cursor.log_id.unwrap())
                    .await?;
                cursor.log_id = None;
                return Ok(AtomicStep::Stopped);
            }
        } else {
            execute_shared_node(
                txn,
                &self.flow,
                &cursor.node,
                kind,
                &config,
                &mut cursor.context,
            )
            .await?;
        }
        self.finalize_node_log(
            txn,
            cursor.log_id.unwrap(),
            "success",
            cursor.context.outputs.get(&cursor.node).cloned(),
            None,
        )
        .await?;
        let step = self.advance(txn, cursor, node).await?;
        cursor.log_id = None;
        Ok(step)
    }
}
async fn start_external_effect(
    txn: &DatabaseTransaction,
    run_id: Uuid,
    cursor: &Cursor,
    config: &Value,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    let compensation = config
        .get("compensationRequest")
        .filter(|value| value.is_object())
        .map(|request| json!({"request": request, "outputs": cursor.context.outputs}));
    sql(txn, "INSERT INTO automation_execution_external_effects(id,run_id,token_id,node_key,status,compensation,request_config,request_context) VALUES($1,$2,$3,$4,'requesting',$5,$6,$7)", vec![id.into(), run_id.into(), cursor.id.into(), cursor.node.clone().into(), compensation.into(), config.clone().into(), json!(cursor.context.outputs).into()]).await?;
    Ok(id)
}

async fn complete_external_effect(
    txn: &DatabaseTransaction,
    effect_id: Uuid,
    run_id: Uuid,
    cursor: &Cursor,
    config: &Value,
    output: Option<Value>,
) -> Result<(), AppError> {
    let compensation = config
        .get("compensationRequest")
        .filter(|value| value.is_object())
        .map(|request| json!({"request": request, "outputs": cursor.context.outputs}));
    sql(txn, "UPDATE automation_execution_external_effects SET status='completed',compensation=$2,result_json=$3,request_config=$4,request_context=$5,updated_at=NOW() WHERE id=$1 AND run_id=$6", vec![effect_id.into(), compensation.into(), output.into(), config.clone().into(), json!(cursor.context.outputs).into(), run_id.into()]).await?;
    Ok(())
}

pub(crate) async fn save_token<C: ConnectionTrait>(
    db: &C,
    cursor: &Cursor,
    status: &str,
) -> Result<(), AppError> {
    sql(db,"UPDATE automation_execution_tokens SET node_key=$2,status=$3,outputs=$4,depth=$5,parallel_group=$6,parallel_branch_id=$7,updated_at=NOW() WHERE id=$1",
        vec![cursor.id.into(),cursor.node.clone().into(),status.into(),json!(cursor.context.outputs).into(),(cursor.depth as i32).into(),cursor.parallel_group.into(),cursor.context.branch_id.into()]).await?;
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
        } else if let (Some(log), Err(error)) = (working.log_id, &result) {
            crate::platform::automation_runs::finalize_automation_run_node_log(
                &self.state.db,
                log,
                "failed",
                None,
                Some(format!("{error:?}")),
            )
            .await?;
        }
        result.map(Some)
    }
    async fn claim(&self, cursor: &mut Cursor) -> Result<bool, AppError> {
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(false);
        }
        let row=txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
            "SELECT node_key,outputs,depth,status,parallel_group,parallel_branch_id FROM automation_execution_tokens WHERE id=$1 AND run_id=$2 FOR UPDATE",
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
        cursor.context.branch_id = row.try_get("", "parallel_branch_id")?;
        txn.commit().await?;
        Ok(true)
    }
    async fn ready(&self, cursor: &mut Cursor) -> Result<bool, AppError> {
        let Some(group_id) = cursor.parallel_group else {
            return Ok(true);
        };
        let Some(branch_id) = cursor.context.branch_id else {
            return Err(AppError::BadRequest(
                "parallel token is missing branch identity".into(),
            ));
        };
        let txn = self.state.db.begin().await?;
        if !self.guard(&txn).await? {
            return Ok(false);
        }
        let row = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT expected_branches,arrived_branches,parent_group,parent_branch_id,join_node_key FROM automation_execution_parallel_groups WHERE id=$1 AND run_id=$2 FOR UPDATE",
                vec![group_id.into(), self.run.into()],
            ))
            .await?;
        let Some(row) = row else {
            txn.commit().await?;
            return Ok(true);
        };
        let join_node: Option<String> = row.try_get("", "join_node_key")?;
        if join_node.as_deref() != Some(cursor.node.as_str()) {
            txn.commit().await?;
            return Ok(true);
        }
        let expected: Value = row.try_get("", "expected_branches")?;
        let mut arrived: Value = row.try_get("", "arrived_branches")?;
        let expected = expected
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>();
        let arrived_items = arrived
            .as_array_mut()
            .ok_or_else(|| AppError::BadRequest("parallel join state is invalid".into()))?;
        if !arrived_items
            .iter()
            .any(|item| item.as_str() == Some(&branch_id.to_string()))
        {
            arrived_items.push(json!(branch_id));
        }
        let all_arrived = expected.iter().all(|expected_id| {
            arrived_items
                .iter()
                .any(|item| item.as_str() == Some(expected_id))
        });
        sql(&txn,"UPDATE automation_execution_tokens SET status='waiting_join',updated_at=NOW() WHERE id=$1 AND status='queued'",vec![cursor.id.into()]).await?;
        sql(&txn,"UPDATE automation_execution_parallel_groups SET status='joining',arrived_branches=$2,updated_at=NOW() WHERE id=$1",vec![group_id.into(),arrived.clone().into()]).await?;
        if !all_arrived {
            txn.commit().await?;
            return Ok(false);
        }
        let rows = txn
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id,outputs FROM automation_execution_tokens WHERE run_id=$1 AND parallel_group=$2 AND node_key=$3 AND status='waiting_join' ORDER BY sequence FOR UPDATE",
                vec![self.run.into(), group_id.into(), cursor.node.clone().into()],
            ))
            .await?;
        let mut merged = HashMap::<String, Value>::new();
        let mut token_ids = Vec::new();
        for token in rows {
            let outputs: HashMap<String, Value> =
                serde_json::from_value(token.try_get("", "outputs")?)
                    .map_err(|_| AppError::BadRequest("invalid parallel branch outputs".into()))?;
            for (key, value) in outputs {
                if merged.get(&key).is_some_and(|existing| existing != &value) {
                    return Err(AppError::Conflict(format!(
                        "parallel branches produced conflicting output for node {key}"
                    )));
                }
                merged.insert(key, value);
            }
            token_ids.push(token.try_get::<Uuid>("", "id")?);
        }
        let parent_group: Option<Uuid> = row.try_get("", "parent_group")?;
        let parent_branch: Option<Uuid> = row.try_get("", "parent_branch_id")?;
        for token_id in &token_ids {
            if *token_id != cursor.id {
                sql(&txn,"UPDATE automation_execution_tokens SET status='completed',updated_at=NOW() WHERE id=$1",vec![(*token_id).into()]).await?;
            }
        }
        cursor.context.outputs = merged;
        cursor.parallel_group = parent_group;
        cursor.context.branch_id = parent_branch;
        sql(&txn,"UPDATE automation_execution_tokens SET status='queued',outputs=$2,parallel_group=$3,parallel_branch_id=$4,updated_at=NOW() WHERE id=$1",vec![cursor.id.into(),json!(cursor.context.outputs).into(),parent_group.into(),parent_branch.into()]).await?;
        sql(&txn,"UPDATE automation_execution_parallel_groups SET status='completed',merged_outputs=$2,updated_at=NOW() WHERE id=$1",vec![group_id.into(),json!(cursor.context.outputs).into()]).await?;
        txn.commit().await?;
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
        let existing = txn.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 FROM automation_flow_run_nodes WHERE run_id=$1 AND branch_id=$2 AND status='failed' ORDER BY created_at DESC LIMIT 1",
            vec![self.run.into(), cursor.id.into()],
        )).await?;
        if existing.is_some() {
            sql(
                &txn,
                "UPDATE automation_execution_tokens SET visit_id=$2 WHERE id=$1",
                vec![cursor.id.into(), Uuid::new_v4().into()],
            )
            .await?;
        } else {
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
        }
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
        "SELECT e.fence FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND r.status IN ('queued','running','waiting','waiting_join') AND (e.owner IS NULL OR e.lease_until<NOW()) FOR UPDATE OF e,r SKIP LOCKED",vec![run.into()])).await?;
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
    let result = async {
            validate_execution_definition(&runtime.flow)?;
            validate_execution_sources(&state.db,&runtime.flow).await?;
            let rows=state.db.query_all_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT id,parallel_group,parallel_branch_id FROM automation_execution_tokens WHERE run_id=$1 AND status='queued' ORDER BY sequence",vec![run.into()])).await?;
            let mut groups:Vec<(Option<Uuid>,Vec<Cursor>)>=Vec::new();
            for row in rows {
                let cursor=Cursor{id:row.try_get("","id")?,parallel_group:row.try_get("","parallel_group")?,node:String::new(),depth:0,log_id:None,
                    context:AutomationExecutionContext{outputs:HashMap::new(),operator:identity.operator.clone(),run_id:Some(run),branch_id:row.try_get("","parallel_branch_id")?}};
                if cursor.parallel_group.is_some()&&groups.last().is_some_and(|(g,_)|*g==cursor.parallel_group){groups.last_mut().unwrap().1.push(cursor);}
                else{groups.push((cursor.parallel_group,vec![cursor]));}
            }
            let mut error=None;
            for (parallel,cursors) in groups{if let Err(e)=engine::schedule(&runtime,cursors,parallel.is_some()).await{if error.is_none(){error=Some(e);}}}
            error.map_or(Ok(()),Err)
        }
        .await;
    finalize_execution(&runtime, result.as_ref().err()).await?;
    result
}
async fn finalize_execution(
    runtime: &PersistentRuntime<'_>,
    error: Option<&AppError>,
) -> Result<(), AppError> {
    let failed_token = runtime
        .state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id FROM automation_execution_tokens WHERE run_id=$1 AND status='failed' LIMIT 1",
            vec![runtime.run.into()],
        ))
        .await?
        .is_some();
    let compensation_attention = if error.is_some() || failed_token {
        // Do not let a stale worker compensate after its lease has been
        // taken over. The effect rows also have their own claim guard below,
        // but this check prevents a stale worker from starting compensation
        // in the normal path.
        let owner_valid = runtime.state.db.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 FROM automation_execution_runs WHERE run_id=$1 AND owner=$2 AND fence=$3 AND lease_until>NOW()",
            vec![runtime.run.into(), runtime.owner.into(), runtime.fence.into()],
        )).await?.is_some();
        if owner_valid {
            compensate_external_effects(&runtime.state, runtime.run).await?
        } else {
            return Ok(());
        }
    } else {
        false
    };
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
    let mut status = if compensation_attention || statuses.iter().any(|s| s == "needs_attention") {
        "needs_attention"
    } else if error.is_some() || statuses.iter().any(|s| s == "failed") {
        "failed"
    } else if statuses.iter().all(|s| s == "completed") {
        "success"
    } else if statuses.iter().any(|s| s == "queued") {
        "queued"
    } else if statuses.iter().any(|s| s == "waiting_join") {
        "waiting_join"
    } else {
        "waiting"
    };
    let mut final_error = error.map(|e| format!("{e:?}"));
    let mut compensate_after_commit = false;
    if status == "success" {
        sql(&txn, "SAVEPOINT automation_business_commit", vec![]).await?;
        if let Err(commit_error) =
            crate::platform::records::commit_automation_run(&txn, runtime.run).await
        {
            sql(
                &txn,
                "ROLLBACK TO SAVEPOINT automation_business_commit",
                vec![],
            )
            .await?;
            sql(&txn, "RELEASE SAVEPOINT automation_business_commit", vec![]).await?;
            status = "compensating";
            compensate_after_commit = true;
            final_error = Some(format!("{commit_error:?}"));
            sql(
                &txn,
                "DELETE FROM automation_execution_record_changes WHERE run_id=$1",
                vec![runtime.run.into()],
            )
            .await?;
        } else {
            sql(&txn, "RELEASE SAVEPOINT automation_business_commit", vec![]).await?;
        }
    } else if status == "failed" {
        sql(
            &txn,
            "DELETE FROM automation_execution_record_changes WHERE run_id=$1",
            vec![runtime.run.into()],
        )
        .await?;
    }
    if matches!(status, "success" | "failed") {
        if status == "failed" {
            sql(&txn,"UPDATE automation_execution_tokens SET status='cancelled' WHERE run_id=$1 AND status IN ('queued','running','waiting','waiting_join')",vec![runtime.run.into()]).await?;
            sql(&txn,"UPDATE automation_execution_parallel_groups SET status='failed',updated_at=NOW() WHERE run_id=$1 AND status IN ('running','joining')",vec![runtime.run.into()]).await?;
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
        finalize_automation_run(&txn, runtime.run, status, final_error.clone()).await?;
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
    if compensate_after_commit {
        let needs_attention = compensate_external_effects(&runtime.state, runtime.run).await?;
        let txn = runtime.state.db.begin().await?;
        let final_status = if needs_attention {
            "needs_attention"
        } else {
            "failed"
        };
        if !needs_attention {
            if let Some(instance) = &runtime.instance {
                workflows::skip_pending_tasks(
                    &txn,
                    instance,
                    None,
                    "业务数据提交冲突，流程已回滚",
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
        finalize_automation_run(&txn, runtime.run, final_status, final_error).await?;
        txn.commit().await?;
    }
    Ok(())
}

pub(crate) async fn compensate_external_effects(
    state: &AppState,
    run_id: Uuid,
) -> Result<bool, AppError> {
    let rows = state
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id,compensation FROM automation_execution_external_effects WHERE run_id=$1 AND status IN ('completed','compensating','failed') ORDER BY sequence DESC",
            vec![run_id.into()],
        ))
        .await?;
    let mut needs_attention = false;
    let unresolved = state.db.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT 1 FROM automation_execution_external_effects WHERE run_id=$1 AND status IN ('manual','uncertain') LIMIT 1",
        vec![run_id.into()],
    )).await?.is_some();
    needs_attention |= unresolved;
    for row in rows {
        let effect_id: Uuid = row.try_get("", "id")?;
        let compensation: Option<Value> = row.try_get("", "compensation")?;
        let Some(compensation) = compensation else {
            sql(
                &state.db,
                "UPDATE automation_execution_external_effects SET status='manual',error_message='no compensation configured',updated_at=NOW() WHERE id=$1 AND status IN ('completed','compensating','failed')",
                vec![effect_id.into()],
            )
            .await?;
            needs_attention = true;
            continue;
        };
        let request = compensation.get("request").cloned().unwrap_or(Value::Null);
        let outputs: HashMap<String, Value> = serde_json::from_value(
            compensation
                .get("outputs")
                .cloned()
                .unwrap_or_else(|| json!({})),
        )
        .map_err(|_| AppError::BadRequest("invalid compensation output snapshot".into()))?;
        let context = AutomationExecutionContext {
            outputs,
            operator: "系统补偿".into(),
            run_id: Some(run_id),
            branch_id: None,
        };
        // Claim the effect before calling the remote endpoint. Recovery and
        // administrator retries can run concurrently, so only the caller
        // that transitions the row to `compensating` may issue the request.
        let claimed = state.db.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE automation_execution_external_effects SET status='compensating',error_message=NULL,updated_at=NOW() WHERE id=$1 AND (status IN ('completed','failed') OR (status='compensating' AND updated_at < NOW() - INTERVAL '30 seconds')) RETURNING id",
            vec![effect_id.into()],
        )).await?.is_some();
        if !claimed {
            continue;
        }
        let result = super::execute_http_request_node(&request, &context).await;
        match result {
            Ok(_) => {
                sql(
                    &state.db,
                    "UPDATE automation_execution_external_effects SET status='compensated',updated_at=NOW() WHERE id=$1",
                    vec![effect_id.into()],
                )
                .await?;
            }
            Err(error) => {
                sql(
                    &state.db,
                    "UPDATE automation_execution_external_effects SET status='failed',error_message=$2,updated_at=NOW() WHERE id=$1",
                    vec![effect_id.into(), format!("{error:?}").into()],
                )
                .await?;
                needs_attention = true;
            }
        }
    }
    Ok(needs_attention)
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
                        "SELECT e.run_id FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE e.policy<>'before' AND r.status IN ('queued','running','waiting_join') AND e.owner IS NULL AND EXISTS(SELECT 1 FROM automation_execution_tokens t WHERE t.run_id=e.run_id AND t.status='queued') ORDER BY r.created_at LIMIT 32".to_string())).await;
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
        "SELECT e.run_id,e.policy,r.status FROM automation_execution_runs e JOIN automation_flow_runs r ON r.id=e.run_id WHERE ((e.owner IS NOT NULL AND e.lease_until<NOW()) OR (e.owner IS NULL AND r.status='running') OR (r.status='compensating' AND (e.owner IS NULL OR e.lease_until<NOW()))) AND r.status IN ('running','queued','compensating') FOR UPDATE OF e,r SKIP LOCKED".to_string())).await?;
    let mut compensating_runs = Vec::new();
    for row in rows {
        let run: Uuid = row.try_get("", "run_id")?;
        let policy: String = row.try_get("", "policy")?;
        let run_status: String = row.try_get("", "status")?;
        sql(&txn,"UPDATE automation_execution_runs SET owner=NULL,lease_until=NULL,fence=fence+1 WHERE run_id=$1",vec![run.into()]).await?;
        sql(&txn,"UPDATE automation_execution_external_effects SET status='uncertain',error_message=COALESCE(error_message,'worker lease expired while external request was in flight'),updated_at=NOW() WHERE run_id=$1 AND status='requesting'",vec![run.into()]).await?;
        if run_status == "compensating" {
            compensating_runs.push(run);
            continue;
        }
        if policy == "before" {
            sql(&txn,"UPDATE automation_execution_tokens SET status='failed',error_message='synchronous caller interrupted' WHERE run_id=$1 AND status NOT IN ('completed','cancelled')",vec![run.into()]).await?;
            sql(
                &txn,
                "DELETE FROM automation_execution_record_changes WHERE run_id=$1",
                vec![run.into()],
            )
            .await?;
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
    for run in compensating_runs {
        let needs_attention = compensate_external_effects(state, run).await?;
        let txn = state.db.begin().await?;
        let status = if needs_attention {
            "needs_attention"
        } else {
            "failed"
        };
        if !needs_attention {
            sql(
                &txn,
                "DELETE FROM automation_execution_record_changes WHERE run_id=$1",
                vec![run.into()],
            )
            .await?;
            let row = txn
                .query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT workflow_instance_id FROM automation_flow_runs WHERE id=$1",
                    vec![run.into()],
                ))
                .await?;
            let instance_id: Option<Uuid> = row
                .map(|row| row.try_get("", "workflow_instance_id"))
                .transpose()?;
            if let Some(instance_id) = instance_id {
                if let Some(instance) = workflow_instance_entity::Entity::find_by_id(instance_id)
                    .one(&txn)
                    .await?
                {
                    workflows::skip_pending_tasks(
                        &txn,
                        &instance,
                        None,
                        "外部副作用补偿完成，流程已回滚",
                        Utc::now(),
                        None,
                    )
                    .await?;
                    workflows::complete_instance(
                        &txn,
                        &instance,
                        "failed",
                        "reviewing",
                        "failed",
                        "执行失败",
                        "系统",
                    )
                    .await?;
                }
            }
        }
        finalize_automation_run(&txn, run, status, Some("外部副作用补偿恢复完成".into())).await?;
        txn.commit().await?;
    }
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
