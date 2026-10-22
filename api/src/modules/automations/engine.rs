//! One graph driver for event runs and durable human workflows.
use super::*;
#[cfg(test)]
use std::sync::Mutex;

#[derive(Clone)]
pub(crate) struct Cursor {
    pub id: Uuid,
    pub node: String,
    pub context: AutomationExecutionContext,
    pub depth: usize,
    pub log_id: Option<Uuid>,
    pub parallel_group: Option<Uuid>,
}

pub(crate) enum AtomicStep {
    Continue,
    Split {
        children: Vec<Cursor>,
        parallel: bool,
    },
    Stopped,
}

pub(crate) enum StepResult {
    Continue,
    Waiting,
}

pub(crate) enum Transition {
    Continue(String),
    Split {
        targets: Vec<String>,
        parallel: bool,
    },
    End,
}

pub(crate) trait Runtime: Sync {
    fn atomic_step(
        &self,
        _cursor: &mut Cursor,
        _node: &Value,
    ) -> impl Future<Output = Result<Option<AtomicStep>, AppError>> + Send {
        async { Ok(None) }
    }
    fn db(&self) -> &DatabaseConnection;
    fn flow(&self) -> &automation_flow_entity::Model;
    fn claim(&self, cursor: &mut Cursor) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn ready(&self, cursor: &Cursor) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn human(
        &self,
        cursor: &Cursor,
        node: &Value,
    ) -> impl Future<Output = Result<StepResult, AppError>> + Send;
    fn checkpoint(&self, cursor: &Cursor) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn split(
        &self,
        cursor: &Cursor,
        targets: &[String],
        parallel: bool,
    ) -> impl Future<Output = Result<Vec<Cursor>, AppError>> + Send;
    fn finish(&self, cursor: &Cursor) -> impl Future<Output = Result<(), AppError>> + Send;
    fn failed(
        &self,
        cursor: &Cursor,
        error: &AppError,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
}

pub(crate) fn transition(
    flow: &automation_flow_entity::Model,
    node: &Value,
    context: &AutomationExecutionContext,
) -> Transition {
    let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
    let kind = node
        .pointer("/data/kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let handles = match kind {
        "condition" => Some(
            select_condition_branch_handle(node, context)
                .flatten()
                .into_iter()
                .collect::<HashSet<_>>(),
        ),
        "parallel-condition" => Some(select_parallel_condition_branch_handles(node, context)),
        _ => None,
    };
    let targets = flow
        .edges_json
        .as_array()
        .into_iter()
        .flatten()
        .filter(|edge| edge.get("source").and_then(Value::as_str) == Some(id))
        .filter(|edge| {
            handles.as_ref().is_none_or(|handles| {
                edge.get("sourceHandle")
                    .and_then(Value::as_str)
                    .is_some_and(|h| handles.contains(h))
            })
        })
        .filter_map(|edge| {
            edge.get("target")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    match targets.len() {
        0 => Transition::End,
        1 => Transition::Continue(targets[0].clone()),
        _ => Transition::Split {
            targets,
            parallel: kind == "parallel-condition",
        },
    }
}

pub(crate) fn drive<'a, R: Runtime + 'a>(
    runtime: &'a R,
    mut cursor: Cursor,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        if !runtime.claim(&mut cursor).await? {
            return Ok(());
        }
        let result = async {
            loop {
                if !runtime.ready(&cursor).await? {
                    return Ok(());
                }
                if cursor.node.is_empty() {
                    return runtime.finish(&cursor).await;
                }
                if cursor.depth >= 128 {
                    return Err(AppError::BadRequest(
                        "automation graph traversal exceeded limit".into(),
                    ));
                }
                cursor.depth += 1;
                let node = runtime
                    .flow()
                    .nodes_json
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|node| {
                        node.get("id").and_then(Value::as_str) == Some(cursor.node.as_str())
                    })
                    .ok_or_else(|| {
                        AppError::BadRequest(format!("automation node not found: {}", cursor.node))
                    })?;
                if let Some(step) = runtime.atomic_step(&mut cursor, node).await? {
                    match step {
                        AtomicStep::Continue => continue,
                        AtomicStep::Split { children, parallel } => {
                            return schedule(runtime, children, parallel).await;
                        }
                        AtomicStep::Stopped => return Ok(()),
                    }
                }
                let kind = node
                    .pointer("/data/kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                cursor.log_id = if let Some(run_id) = cursor.context.run_id {
                    Some(
                        crate::platform::automation_runs::create_branch_node_log(
                            runtime.db(),
                            run_id,
                            cursor.id,
                            &cursor.node,
                            kind,
                            node.pointer("/data/label")
                                .and_then(Value::as_str)
                                .unwrap_or(&cursor.node),
                            json!(cursor.context.outputs),
                        )
                        .await?,
                    )
                } else {
                    None
                };
                if matches!(kind, "approval" | "executor" | "copy") {
                    if matches!(runtime.human(&cursor, node).await?, StepResult::Waiting) {
                        return Ok(());
                    }
                } else {
                    execute_shared_node(
                        runtime.db(),
                        runtime.flow(),
                        &cursor.node,
                        kind,
                        &node
                            .pointer("/data/config")
                            .cloned()
                            .unwrap_or_else(|| json!({})),
                        &mut cursor.context,
                    )
                    .await?;
                }
                if let Some(log) = cursor.log_id.take() {
                    finalize_automation_run_node_log(
                        runtime.db(),
                        log,
                        "success",
                        cursor.context.outputs.get(&cursor.node).cloned(),
                        None,
                    )
                    .await?;
                }
                match transition(runtime.flow(), node, &cursor.context) {
                    Transition::End => return runtime.finish(&cursor).await,
                    Transition::Continue(next) => {
                        cursor.node = next;
                        if !runtime.checkpoint(&cursor).await? {
                            return Ok(());
                        }
                    }
                    Transition::Split { targets, parallel } => {
                        let children = runtime.split(&cursor, &targets, parallel).await?;
                        return schedule(runtime, children, parallel).await;
                    }
                }
            }
        }
        .await;
        if let Err(error) = &result {
            if let Some(log) = cursor.log_id {
                finalize_automation_run_node_log(
                    runtime.db(),
                    log,
                    "failed",
                    None,
                    Some(format!("{error:?}")),
                )
                .await?;
            }
            runtime.failed(&cursor, error).await?;
        }
        result
    })
}

pub(crate) async fn schedule<R: Runtime>(
    runtime: &R,
    children: Vec<Cursor>,
    parallel: bool,
) -> Result<(), AppError> {
    let results = if parallel {
        futures_util::future::join_all(children.into_iter().map(|cursor| drive(runtime, cursor)))
            .await
    } else {
        let mut results = Vec::new();
        for cursor in children {
            results.push(drive(runtime, cursor).await);
        }
        results
    };
    results
        .into_iter()
        .find_map(Result::err)
        .map_or(Ok(()), Err)
}

#[cfg(test)]
pub(crate) struct MemoryRuntime<'a> {
    pub db: &'a DatabaseConnection,
    pub flow: &'a automation_flow_entity::Model,
    pub outputs: Mutex<HashMap<String, Value>>,
}

#[cfg(test)]
impl Runtime for MemoryRuntime<'_> {
    fn db(&self) -> &DatabaseConnection {
        self.db
    }
    fn flow(&self) -> &automation_flow_entity::Model {
        self.flow
    }
    async fn claim(&self, _: &mut Cursor) -> Result<bool, AppError> {
        Ok(true)
    }
    async fn ready(&self, _: &Cursor) -> Result<bool, AppError> {
        Ok(true)
    }
    async fn human(&self, _: &Cursor, _: &Value) -> Result<StepResult, AppError> {
        Err(AppError::BadRequest(
            "human nodes require a process runtime".into(),
        ))
    }
    async fn checkpoint(&self, _: &Cursor) -> Result<bool, AppError> {
        Ok(true)
    }
    async fn split(
        &self,
        cursor: &Cursor,
        targets: &[String],
        parallel: bool,
    ) -> Result<Vec<Cursor>, AppError> {
        Ok(targets
            .iter()
            .map(|node| Cursor {
                id: Uuid::new_v4(),
                node: node.clone(),
                log_id: None,
                parallel_group: parallel.then_some(cursor.id),
                ..cursor.clone()
            })
            .collect())
    }
    async fn finish(&self, cursor: &Cursor) -> Result<(), AppError> {
        self.outputs
            .lock()
            .unwrap()
            .extend(cursor.context.outputs.clone());
        Ok(())
    }
    async fn failed(&self, cursor: &Cursor, _: &AppError) -> Result<(), AppError> {
        self.outputs
            .lock()
            .unwrap()
            .extend(cursor.context.outputs.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Barrier;

    struct Observed<'a> {
        inner: MemoryRuntime<'a>,
        visits: Mutex<Vec<(String, HashMap<String, Value>)>>,
        barrier: Option<Arc<Barrier>>,
    }
    impl Runtime for Observed<'_> {
        fn db(&self) -> &DatabaseConnection {
            self.inner.db()
        }
        fn flow(&self) -> &automation_flow_entity::Model {
            self.inner.flow()
        }
        async fn claim(&self, cursor: &mut Cursor) -> Result<bool, AppError> {
            self.inner.claim(cursor).await
        }
        async fn ready(&self, cursor: &Cursor) -> Result<bool, AppError> {
            self.visits
                .lock()
                .unwrap()
                .push((cursor.node.clone(), cursor.context.outputs.clone()));
            Ok(true)
        }
        async fn human(&self, cursor: &Cursor, _: &Value) -> Result<StepResult, AppError> {
            if let Some(barrier) = &self.barrier {
                barrier.wait().await;
            }
            if cursor.node == "fail" {
                Err(AppError::BadRequest("test failure".into()))
            } else {
                Ok(StepResult::Continue)
            }
        }
        async fn checkpoint(&self, cursor: &Cursor) -> Result<bool, AppError> {
            self.inner.checkpoint(cursor).await
        }
        async fn split(
            &self,
            cursor: &Cursor,
            targets: &[String],
            parallel: bool,
        ) -> Result<Vec<Cursor>, AppError> {
            self.inner.split(cursor, targets, parallel).await
        }
        async fn finish(&self, cursor: &Cursor) -> Result<(), AppError> {
            self.inner.finish(cursor).await
        }
        async fn failed(&self, cursor: &Cursor, error: &AppError) -> Result<(), AppError> {
            self.inner.failed(cursor, error).await
        }
    }
    fn flow(nodes: Value, edges: Value) -> automation_flow_entity::Model {
        let now = Utc::now();
        automation_flow_entity::Model {
            id: Uuid::new_v4(),
            flow_uuid: "test".into(),
            app_route_app_id: "test".into(),
            name: "test".into(),
            description: None,
            status: "enabled".into(),
            current_version: 1,
            flow_type: "trigger".into(),
            trigger_form_uuid: None,
            trigger_config: json!({}),
            nodes_json: nodes,
            edges_json: edges,
            created_by: "test".into(),
            updated_by: "test".into(),
            created_at: now,
            updated_at: now,
        }
    }
    fn cursor() -> Cursor {
        Cursor {
            id: Uuid::new_v4(),
            node: "trigger-1".into(),
            depth: 0,
            log_id: None,
            parallel_group: None,
            context: AutomationExecutionContext {
                outputs: HashMap::from([("trigger-1".into(), json!({"amount":100}))]),
                operator: "test".into(),
                run_id: None,
            },
        }
    }

    #[tokio::test]
    async fn ordinary_fanout_is_ordered_isolated_and_shared_targets_run_twice() {
        let flow = flow(
            json!([
                {"id":"trigger-1","data":{"kind":"trigger"}},
                {"id":"a","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}},
                {"id":"b","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"a"}}},
                {"id":"shared","data":{"kind":"copy"}}
            ]),
            json!([
                {"source":"trigger-1","target":"a"},{"source":"trigger-1","target":"b"},
                {"source":"a","target":"shared"},{"source":"b","target":"shared"}
            ]),
        );
        let db = DatabaseConnection::default();
        let runtime = Observed {
            inner: MemoryRuntime {
                db: &db,
                flow: &flow,
                outputs: Mutex::new(HashMap::new()),
            },
            visits: Mutex::new(vec![]),
            barrier: None,
        };
        drive(&runtime, cursor()).await.unwrap();
        let visits = runtime.visits.lock().unwrap();
        assert_eq!(
            visits.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            ["trigger-1", "a", "shared", "b", "shared"]
        );
        assert!(!visits[3].1.contains_key("a"));
        assert_eq!(runtime.inner.outputs.lock().unwrap()["b"], Value::Null);
    }

    #[tokio::test]
    async fn shared_driver_starts_parallel_siblings_and_waits_for_failure() {
        let flow = flow(
            json!([
                {"id":"trigger-1","data":{"kind":"parallel-condition","config":{"branches":[{"id":"a","mode":"all"},{"id":"b","mode":"all"}]}}},
                {"id":"fail","data":{"kind":"copy"}},{"id":"ok","data":{"kind":"copy"}}
            ]),
            json!([
                {"source":"trigger-1","target":"fail","sourceHandle":"condition-branch:a"},
                {"source":"trigger-1","target":"ok","sourceHandle":"condition-branch:b"}
            ]),
        );
        let db = DatabaseConnection::default();
        let runtime = Observed {
            inner: MemoryRuntime {
                db: &db,
                flow: &flow,
                outputs: Mutex::new(HashMap::new()),
            },
            visits: Mutex::new(vec![]),
            barrier: Some(Arc::new(Barrier::new(2))),
        };
        assert!(
            tokio::time::timeout(Duration::from_secs(2), drive(&runtime, cursor()))
                .await
                .unwrap()
                .is_err()
        );
        assert!(
            runtime
                .visits
                .lock()
                .unwrap()
                .iter()
                .any(|(id, _)| id == "ok")
        );
    }

    #[test]
    fn nested_rules_and_field_comparisons_use_the_common_context() {
        let context = AutomationExecutionContext {
            outputs: HashMap::from([(
                "trigger-1".into(),
                json!({"priority":"low","owner":"u1","approver":"u1"}),
            )]),
            operator: "test".into(),
            run_id: None,
        };
        let branch = json!({"mode":"rules","rules":[
            {"id":"group","isGroup":true,"logicalOperator":"and"},
            {"id":"p","parentId":"group","fieldKey":"trigger-1:priority","rawValue":"high","logicalOperator":"or"},
            {"id":"o","parentId":"group","fieldKey":"trigger-1:owner","valueType":"field","sourceFieldKey":"trigger-1:approver","logicalOperator":"or"}
        ]});
        assert!(evaluate_condition_branch(&branch, &context));
        let mut different = context;
        different.outputs.get_mut("trigger-1").unwrap()["approver"] = json!("u2");
        assert!(!evaluate_condition_branch(&branch, &different));
    }
}
