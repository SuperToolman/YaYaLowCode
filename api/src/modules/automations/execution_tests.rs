use super::*;
use crate::infrastructure::entities::{
    app_entity, form_schema_entity, form_storage_definition_entity, iam_user_entity,
    workflow_action_entity, workflow_comment_entity, workflow_notification_entity,
    workflow_task_entity,
};
use sea_orm::{ConnectOptions, Database, Schema};

#[tokio::test]
#[ignore = "requires WORKFLOW_TEST_DATABASE_SETTINGS_PATH; isolated schema"]
async fn common_execution_database_lifecycle() {
    let raw: Value = serde_json::from_slice(
        &std::fs::read(std::env::var("WORKFLOW_TEST_DATABASE_SETTINGS_PATH").unwrap()).unwrap(),
    )
    .unwrap();
    let settings: crate::platform::config::DatabaseSettings =
        serde_json::from_value(raw["database"].clone()).unwrap();
    let url = settings.to_database_url();
    let admin = Database::connect(url.clone()).await.unwrap();
    let name = format!("execution_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&name)
        .max_connections(12)
        .sqlx_logging(false);
    let mut db = Database::connect(options).await.unwrap();
    let queries = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = queries.clone();
    db.set_metric_callback(move |_| {
        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    });
    let result = tokio::spawn(async move { verify(db, queries).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}
async fn fixture_flow(
    db: &DatabaseConnection,
    kind: &str,
    nodes: Value,
    edges: Value,
) -> automation_flow_entity::Model {
    let now = Utc::now();
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set(Uuid::new_v4().to_string()),
        app_route_app_id: Set("test".into()),
        name: Set("test".into()),
        description: Set(None),
        status: Set("enabled".into()),
        current_version: Set(1),
        flow_type: Set(kind.into()),
        trigger_form_uuid: Set(Some("test-form".into())),
        trigger_config: Set(
            json!({"triggerEvents":[if kind=="process"{"form_submit"}else{"after_create"}]}),
        ),
        nodes_json: Set(nodes),
        edges_json: Set(edges),
        created_by: Set("test".into()),
        updated_by: Set("test".into()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    snapshot(db, &flow, 1).await;
    flow
}
async fn snapshot(db: &DatabaseConnection, flow: &automation_flow_entity::Model, version: i32) {
    automation_flow_version_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_id: Set(flow.id),
        version: Set(version),
        name: Set(flow.name.clone()),
        description: Set(None),
        status: Set("enabled".into()),
        trigger_form_uuid: Set(flow.trigger_form_uuid.clone()),
        trigger_config: Set(flow.trigger_config.clone()),
        nodes_json: Set(flow.nodes_json.clone()),
        edges_json: Set(flow.edges_json.clone()),
        change_summary: Set(None),
        created_by: Set("test".into()),
        created_at: Set(Utc::now()),
    }
    .insert(db)
    .await
    .unwrap();
}
async fn start(
    db: &DatabaseTransaction,
    flow: &automation_flow_entity::Model,
    policy: ExecutionPolicy,
    instance: Option<Uuid>,
) -> Uuid {
    start_execution(
        db,
        StartExecutionRequest {
            flow,
            source: TriggerSource {
                button_uuid: None,
                view_uuid: None,
                kind: "fixture".into(),
                event: if instance.is_some() {
                    "form_submit"
                } else {
                    "after_create"
                }
                .into(),
                event_id: Uuid::new_v4().to_string(),
                form_uuid: Some("test-form".into()),
                record_uuid: None,
            },
            identity: ExecutionIdentity {
                user_id: None,
                display_name: "test".into(),
                operator: "test".into(),
            },
            policy,
            input: &json!({"amount":100}),
            instance_id: instance,
            start_node: "trigger-1",
            outputs: None,
            retry_source: None,
            retry_run: None,
        },
    )
    .await
    .unwrap()
}
async fn status(db: &DatabaseConnection, id: Uuid) -> String {
    AutomationRunEntity::find_by_id(id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
        .status
}
async fn verify(db: DatabaseConnection, queries: std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    let schema = Schema::new(DbBackend::Postgres);
    for statement in [
        schema.create_table_from_entity(app_entity::Entity),
        schema.create_table_from_entity(form_definition_entity::Entity),
        schema.create_table_from_entity(form_schema_entity::Entity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
        schema.create_table_from_entity(workflow_instance_entity::Entity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationRunEntity),
        schema.create_table_from_entity(AutomationRunNodeEntity),
        schema.create_table_from_entity(workflow_task_entity::Entity),
        schema.create_table_from_entity(workflow_notification_entity::Entity),
        schema.create_table_from_entity(workflow_action_entity::Entity),
        schema.create_table_from_entity(workflow_comment_entity::Entity),
        schema.create_table_from_entity(iam_user_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let fixture_schema = include_str!("execution_schema.sql")
        .replace(
            "ALTER TABLE automation_flow_run_nodes ADD COLUMN visit_id UUID;",
            "",
        )
        .replace(
            "ALTER TABLE automation_flow_run_nodes ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;",
            "",
        );
    db.execute_unprepared(&fixture_schema).await.unwrap();
    db.execute_unprepared("CREATE TABLE workflow_branch_tokens(id UUID PRIMARY KEY,instance_id UUID);CREATE TABLE im_business_message_bindings(message_id UUID PRIMARY KEY,business_id UUID,business_type TEXT,status TEXT);CREATE TABLE im_messages(id UUID PRIMARY KEY,message_uuid TEXT,payload_json JSONB)").await.unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let worker_shutdown = shutdown.clone();
    let state = AppState::new(db, None, 1, shutdown);
    let definition = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set("test".into()),
        form_uuid: Set("test-form".into()),
        name: Set("test".into()),
        slug: Set("test".into()),
        form_type: Set("workflow".into()),
        current_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(Utc::now()),
        updated_at: Set(Utc::now()),
    }
    .insert(&state.db)
    .await
    .unwrap();
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set("test-form".into()),
        version: Set(1),
        schema_json: Set(json!({"fields":[]})),
        change_log: Set(None),
        created_at: Set(Utc::now()),
        updated_at: Set(Utc::now()),
    }
    .insert(&state.db)
    .await
    .unwrap();
    crate::platform::form_storage::sync_current_storage_plan(
        &state.db,
        "test-form",
        1,
        &json!({"fields":[]}),
    )
    .await
    .unwrap();
    let record = RecordRepository::new(&state.db)
        .insert(&definition, json!({"amount":100}), "test", Utc::now())
        .await
        .unwrap();
    let nodes = json!([{"id":"trigger-1","data":{"kind":"trigger"}},{"id":"query","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}]);
    let flow = fixture_flow(
        &state.db,
        "trigger",
        nodes,
        json!([{"source":"trigger-1","target":"query"}]),
    )
    .await;
    // Rollback cannot leak a queued execution.
    let txn = state.db.begin().await.unwrap();
    let rolled = start(&txn, &flow, ExecutionPolicy::Background, None).await;
    txn.rollback().await.unwrap();
    assert!(
        AutomationRunEntity::find_by_id(rolled)
            .one(&state.db)
            .await
            .unwrap()
            .is_none()
    );
    let txn = state.db.begin().await.unwrap();
    let run = start(&txn, &flow, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    // Publishing another version must not change a queued run.
    let mut changed = flow.clone();
    changed.nodes_json[1]["data"]["config"]["dataNodeId"] = json!("missing");
    snapshot(&state.db, &changed, 2).await;
    sql(
        &state.db,
        "UPDATE automation_flows SET current_version=2,nodes_json=$2 WHERE id=$1",
        vec![flow.id.into(), changed.nodes_json.clone().into()],
    )
    .await
    .unwrap();
    let (a, b) = tokio::join!(drive_execution(&state, run), drive_execution(&state, run));
    a.unwrap();
    b.unwrap();
    assert_eq!(status(&state.db, run).await, "success");
    let logs = AutomationRunNodeEntity::find()
        .filter(automation_run_node_entity::Column::RunId.eq(run))
        .all(&state.db)
        .await
        .unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(
        logs.iter()
            .find(|n| n.node_key == "query")
            .unwrap()
            .output_json
            .as_ref()
            .unwrap()["amount"],
        100
    );
    assert!(
        logs.iter()
            .all(|l| l.visit_id.is_some() && l.branch_id.is_some())
    );
    // Original-version and visit retry, despite the changed live definition.
    let run_model = AutomationRunEntity::find_by_id(run)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    super::super::retry_visit(
        &state,
        &flow.flow_uuid,
        &run_model.run_uuid,
        &logs
            .iter()
            .find(|l| l.node_key == "query")
            .unwrap()
            .id
            .to_string(),
        false,
    )
    .await
    .unwrap();
    // Persistent side effects and the next cursor roll back together.
    let write=fixture_flow(&state.db,"trigger",json!([{"id":"trigger-1","data":{"kind":"trigger"}},{"id":"write","data":{"kind":"add-data","config":{"targetFormUuid":"test-form","rows":[]}}}]),json!([{"source":"trigger-1","target":"write"}])).await;
    let txn = state.db.begin().await.unwrap();
    let write_run = start(&txn, &write, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    state.db.execute_unprepared("CREATE FUNCTION fail_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.node_key='write' AND NEW.status='completed' THEN RAISE EXCEPTION 'injected checkpoint failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER inject_checkpoint BEFORE UPDATE ON automation_execution_tokens FOR EACH ROW EXECUTE FUNCTION fail_checkpoint()").await.unwrap();
    assert!(drive_execution(&state, write_run).await.is_err());
    assert_eq!(
        RecordRepository::new(&state.db)
            .list("test-form")
            .await
            .unwrap()
            .len(),
        1
    );
    state
        .db
        .execute_unprepared("DROP TRIGGER inject_checkpoint ON automation_execution_tokens")
        .await
        .unwrap();
    // Artificially interrupted HTTP visit must never be replayed by recovery.
    let txn = state.db.begin().await.unwrap();
    let uncertain = start(&txn, &flow, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    let token = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id FROM automation_execution_tokens WHERE run_id=$1",
            vec![uncertain.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<Uuid>("", "id")
        .unwrap();
    let visit = Uuid::new_v4();
    let log = crate::platform::automation_runs::create_branch_node_log(
        &state.db,
        uncertain,
        token,
        "http",
        "http-request",
        "HTTP",
        json!({}),
    )
    .await
    .unwrap();
    sql(
        &state.db,
        "UPDATE automation_flow_run_nodes SET visit_id=$2 WHERE id=$1",
        vec![log.into(), visit.into()],
    )
    .await
    .unwrap();
    sql(
        &state.db,
        "UPDATE automation_execution_tokens SET status='running',visit_id=$2 WHERE id=$1",
        vec![token.into(), visit.into()],
    )
    .await
    .unwrap();
    sql(&state.db,"UPDATE automation_execution_runs SET owner=$2,lease_until=NOW()-INTERVAL '1 second' WHERE run_id=$1",vec![uncertain.into(),Uuid::new_v4().into()]).await.unwrap();
    sql(
        &state.db,
        "UPDATE automation_flow_runs SET status='running' WHERE id=$1",
        vec![uncertain.into()],
    )
    .await
    .unwrap();
    recover_expired(&state).await.unwrap();
    assert_eq!(status(&state.db, uncertain).await, "needs_attention");
    // Human outputs and queued continuation commit with task completion.
    let user = Uuid::new_v4();
    let process=fixture_flow(&state.db,"process",json!([{"id":"trigger-1","data":{"kind":"trigger"}},{"id":"custom-approval","data":{"kind":"approval","config":{"assigneeMode":"self"}}},{"id":"query","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}]),json!([{"source":"trigger-1","target":"custom-approval"},{"source":"custom-approval","target":"query"}])).await;
    let before = process.nodes_json.clone();
    assert_eq!(
        super::super::ensure_process_flow_for_form(&state.db, "test", "test-form", "test")
            .await
            .unwrap()
            .nodes_json,
        before
    );
    let instance = workflow_instance_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        instance_uuid: Set(Uuid::new_v4().to_string()),
        form_uuid: Set("test-form".into()),
        record_uuid: Set(record.record_uuid.clone()),
        process_flow_id: Set(process.id),
        flow_version: Set(1),
        status: Set("running".into()),
        current_node_key: Set(Some("trigger-1".into())),
        submitter: Set("test".into()),
        submitter_user_id: Set(Some(user)),
        started_at: Set(Utc::now()),
        completed_at: Set(None),
        paused_by: Set(None),
        paused_at: Set(None),
        pause_reason: Set(None),
        created_at: Set(Utc::now()),
        updated_at: Set(Utc::now()),
    }
    .insert(&state.db)
    .await
    .unwrap();
    let txn = state.db.begin().await.unwrap();
    let process_run = start(&txn, &process, ExecutionPolicy::Inline, Some(instance.id)).await;
    txn.commit().await.unwrap();
    drive_execution(&state, process_run).await.unwrap();
    assert_eq!(status(&state.db, process_run).await, "waiting");
    let task = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let txn = state.db.begin().await.unwrap();
    sql(
        &txn,
        "UPDATE workflow_tasks SET status='approved' WHERE id=$1",
        vec![task.id.into()],
    )
    .await
    .unwrap();
    workflows::execution::complete_human_log(&txn, &task, "success", "test")
        .await
        .unwrap();
    assert!(
        workflows::execution::queue_human_completion(
            &txn,
            &process,
            &instance,
            task.branch_token_id.unwrap(),
            &task.node_key
        )
        .await
        .unwrap()
    );
    txn.commit().await.unwrap();
    // No direct continuation call: a fresh worker drive is sufficient.
    drive_execution(&state, process_run).await.unwrap();
    assert_eq!(status(&state.db, process_run).await, "success");
    let outputs: Value = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT outputs FROM automation_execution_tokens WHERE id=$1",
            vec![task.branch_token_id.unwrap().into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "outputs")
        .unwrap();
    assert_eq!(outputs["custom-approval"]["actor"], "test");
    assert_eq!(outputs["query"]["amount"], 100);
    assert_eq!(
        workflow_instance_entity::Entity::find_by_id(instance.id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );

    // Real approval handler retains authentication, duplicate-action protection and atomic continuation.
    sql(&state.db,"INSERT INTO iam_users(id,display_name,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1,'test',false,true,false,false,'{}','active',NOW(),NOW())",vec![user.into()]).await.unwrap();
    let mut active: workflow_instance_entity::ActiveModel = instance.clone().into();
    active.id = Set(Uuid::new_v4());
    active.instance_uuid = Set(Uuid::new_v4().to_string());
    active.started_at = Set(Utc::now());
    let actual = active.insert(&state.db).await.unwrap();
    let txn = state.db.begin().await.unwrap();
    let actual_run = start(&txn, &process, ExecutionPolicy::Inline, Some(actual.id)).await;
    txn.commit().await.unwrap();
    drive_execution(&state, actual_run).await.unwrap();
    let actual_task = workflow_task_entity::Entity::find()
        .filter(workflow_task_entity::Column::InstanceId.eq(actual.id))
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let secret = std::env::var("AUTH_TOKEN_SECRET")
        .unwrap_or_else(|_| "yaya-development-token-secret".into());
    let auth = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"sub":user.to_string(),"exp":(Utc::now()+chrono::Duration::hours(1)).timestamp()}),
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("authorization", format!("Bearer {auth}").parse().unwrap());
    let _ = workflows::approve_workflow_task(
        State(state.clone()),
        headers.clone(),
        Path(actual_task.task_uuid.clone()),
        Json(workflows::WorkflowTaskActionRequest {
            comment: None,
            card_version: None,
            message_id: None,
        }),
    )
    .await
    .unwrap();
    assert_eq!(status(&state.db, actual_run).await, "success");
    assert!(
        workflows::approve_workflow_task(
            State(state.clone()),
            headers.clone(),
            Path(actual_task.task_uuid.clone()),
            Json(workflows::WorkflowTaskActionRequest {
                comment: None,
                card_version: None,
                message_id: None
            })
        )
        .await
        .is_err()
    );
    // Pause and resume use the same queue; no second human task is created.
    let mut active: workflow_instance_entity::ActiveModel = instance.clone().into();
    active.id = Set(Uuid::new_v4());
    active.instance_uuid = Set(Uuid::new_v4().to_string());
    active.started_at = Set(Utc::now());
    let paused = active.insert(&state.db).await.unwrap();
    let txn = state.db.begin().await.unwrap();
    let paused_run = start(&txn, &process, ExecutionPolicy::Inline, Some(paused.id)).await;
    txn.commit().await.unwrap();
    drive_execution(&state, paused_run).await.unwrap();
    let _ = workflows::pause_workflow_record(
        State(state.clone()),
        headers.clone(),
        Path(("test-form".into(), record.record_uuid.clone())),
        Json(workflows::WorkflowPauseRequest { reason: None }),
    )
    .await
    .unwrap();
    assert_eq!(status(&state.db, paused_run).await, "paused");
    let _ = workflows::resume_workflow_record(
        State(state.clone()),
        headers.clone(),
        Path(("test-form".into(), record.record_uuid.clone())),
    )
    .await
    .unwrap();
    assert_eq!(status(&state.db, paused_run).await, "waiting");
    assert_eq!(
        workflow_task_entity::Entity::find()
            .filter(workflow_task_entity::Column::InstanceId.eq(paused.id))
            .all(&state.db)
            .await
            .unwrap()
            .len(),
        1
    );

    // all/any approvals and whole-run rejection use the real business handlers.
    let second = Uuid::new_v4();
    sql(&state.db,"INSERT INTO iam_users(id,display_name,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1,'second',false,false,false,false,'{}','active',NOW(),NOW())",vec![second.into()]).await.unwrap();
    for mode in ["all", "any", "reject"] {
        let multi=fixture_flow(&state.db,"process",json!([
            {"id":"trigger-1","data":{"kind":"trigger"}},
            {"id":"approval","data":{"kind":"approval","config":{"assigneeMode":"members","assigneeIds":[user.to_string(),second.to_string()],"approvalMode":if mode=="any"{"any"}else{"all"}}}}
        ]),json!([{"source":"trigger-1","target":"approval"}])).await;
        let mut next: workflow_instance_entity::ActiveModel = instance.clone().into();
        next.id = Set(Uuid::new_v4());
        next.instance_uuid = Set(Uuid::new_v4().to_string());
        next.process_flow_id = Set(multi.id);
        next.started_at = Set(Utc::now());
        let next = next.insert(&state.db).await.unwrap();
        let txn = state.db.begin().await.unwrap();
        let run = start(&txn, &multi, ExecutionPolicy::Inline, Some(next.id)).await;
        txn.commit().await.unwrap();
        drive_execution(&state, run).await.unwrap();
        let tasks = workflow_task_entity::Entity::find()
            .filter(workflow_task_entity::Column::InstanceId.eq(next.id))
            .all(&state.db)
            .await
            .unwrap();
        assert_eq!(tasks.len(), 2);
        let first = tasks
            .iter()
            .find(|t| t.assignee_user_id == Some(user))
            .unwrap();
        sql(
            &state.db,
            "UPDATE automation_flow_runs SET status='needs_attention' WHERE id=$1",
            vec![run.into()],
        )
        .await
        .unwrap();
        assert!(
            workflows::approve_workflow_task(
                State(state.clone()),
                headers.clone(),
                Path(first.task_uuid.clone()),
                Json(workflows::WorkflowTaskActionRequest {
                    comment: None,
                    card_version: None,
                    message_id: None
                })
            )
            .await
            .is_err()
        );
        sql(
            &state.db,
            "UPDATE automation_flow_runs SET status='waiting' WHERE id=$1",
            vec![run.into()],
        )
        .await
        .unwrap();
        let request = workflows::WorkflowTaskActionRequest {
            comment: None,
            card_version: None,
            message_id: None,
        };
        if mode == "reject" {
            let _ = workflows::reject_workflow_task(
                State(state.clone()),
                headers.clone(),
                Path(first.task_uuid.clone()),
                Json(request),
            )
            .await
            .unwrap();
            assert_eq!(status(&state.db, run).await, "rejected");
        } else {
            let _ = workflows::approve_workflow_task(
                State(state.clone()),
                headers.clone(),
                Path(first.task_uuid.clone()),
                Json(request),
            )
            .await
            .unwrap();
            assert_eq!(
                status(&state.db, run).await,
                if mode == "any" { "success" } else { "waiting" }
            );
            if mode == "all" {
                let auth=jsonwebtoken::encode(&jsonwebtoken::Header::default(),&json!({"sub":second.to_string(),"exp":(Utc::now()+chrono::Duration::hours(1)).timestamp()}),&jsonwebtoken::EncodingKey::from_secret(secret.as_bytes())).unwrap();
                let mut second_headers = axum::http::HeaderMap::new();
                second_headers.insert("authorization", format!("Bearer {auth}").parse().unwrap());
                let _ = workflows::approve_workflow_task(
                    State(state.clone()),
                    second_headers,
                    Path(
                        tasks
                            .iter()
                            .find(|t| t.assignee_user_id == Some(second))
                            .unwrap()
                            .task_uuid
                            .clone(),
                    ),
                    Json(workflows::WorkflowTaskActionRequest {
                        comment: None,
                        card_version: None,
                        message_id: None,
                    }),
                )
                .await
                .unwrap();
                assert_eq!(status(&state.db, run).await, "success");
            }
        }
        assert_eq!(
            workflow_task_entity::Entity::find()
                .filter(workflow_task_entity::Column::InstanceId.eq(next.id))
                .filter(workflow_task_entity::Column::Status.eq("pending"))
                .count(&state.db)
                .await
                .unwrap(),
            0
        );
    }
    // Controlled HTTP response; a dropped request is counted once and not replayed.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let server = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut buf = [0; 2048];
            let mut request = Vec::new();
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                if request.windows(4).any(|b| b == b"\r\n\r\n") {
                    break;
                }
            }
            if String::from_utf8_lossy(&request).contains("/drop") {
                continue;
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").await.unwrap();
        }
    });
    let http=fixture_flow(&state.db,"trigger",json!([{"id":"trigger-1","data":{"kind":"trigger"}},{"id":"http","data":{"kind":"http-request","config":{"url":format!("http://127.0.0.1:{port}/ok"),"method":"GET"}}}]),json!([{"source":"trigger-1","target":"http"}])).await;
    let txn = state.db.begin().await.unwrap();
    let http_run = start(&txn, &http, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    drive_execution(&state, http_run).await.unwrap();
    assert_eq!(status(&state.db, http_run).await, "success");
    let mut drop = http.clone();
    drop.current_version = 2;
    drop.nodes_json[1]["data"]["config"]["url"] = json!(format!("http://127.0.0.1:{port}/drop"));
    snapshot(&state.db, &drop, 2).await;
    let txn = state.db.begin().await.unwrap();
    let drop_run = start(&txn, &drop, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    let meta = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT definition FROM automation_execution_runs WHERE run_id=$1",
            vec![drop_run.into()],
        ))
        .await
        .unwrap()
        .unwrap();
    let def: Value = meta.try_get("", "definition").unwrap();
    assert!(
        def["nodes"][1]["data"]["config"]["url"]
            .as_str()
            .unwrap()
            .ends_with("/drop")
    );
    drive_execution(&state, drop_run).await.unwrap();
    assert_eq!(status(&state.db, drop_run).await, "needs_attention");
    recover_expired(&state).await.unwrap();
    drive_execution(&state, drop_run).await.unwrap();
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    let _ = super::super::resolve_automation_execution(
        State(state.clone()),
        headers.clone(),
        Path((
            http.flow_uuid.clone(),
            AutomationRunEntity::find_by_id(drop_run)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap()
                .run_uuid,
        )),
        Json(super::super::ResolveExecutionRequest {
            action: "cancel".into(),
            accept_duplicate_risk: false,
        }),
    )
    .await
    .unwrap();
    assert_eq!(status(&state.db, drop_run).await, "cancelled");
    server.abort();
    // Multiple paths into one node remain distinct visits; nodeKey retry is ambiguous.
    let fanout=fixture_flow(&state.db,"trigger",json!([
        {"id":"trigger-1","data":{"kind":"trigger"}},
        {"id":"a","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}},
        {"id":"b","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}},
        {"id":"shared","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}
    ]),json!([{"source":"trigger-1","target":"a"},{"source":"trigger-1","target":"b"},{"source":"a","target":"shared"},{"source":"b","target":"shared"}])).await;
    let txn = state.db.begin().await.unwrap();
    let f = start(&txn, &fanout, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    drive_execution(&state, f).await.unwrap();
    let visits = AutomationRunNodeEntity::find()
        .filter(automation_run_node_entity::Column::RunId.eq(f))
        .filter(automation_run_node_entity::Column::NodeKey.eq("shared"))
        .all(&state.db)
        .await
        .unwrap();
    assert_eq!(visits.len(), 2);
    assert_ne!(visits[0].branch_id, visits[1].branch_id);
    let name = AutomationRunEntity::find_by_id(f)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .run_uuid;
    assert!(
        super::super::retry_automation_run_internal(
            &state.db,
            &fanout.flow_uuid,
            &name,
            Some("shared".into())
        )
        .await
        .is_err()
    );
    // Before executions never resume after the caller is gone.
    let txn = state.db.begin().await.unwrap();
    let interrupted = start(&txn, &flow, ExecutionPolicy::Before, None).await;
    txn.commit().await.unwrap();
    sql(&state.db,"UPDATE automation_execution_runs SET owner=$2,lease_until=NOW()-INTERVAL '1 second' WHERE run_id=$1",vec![interrupted.into(),Uuid::new_v4().into()]).await.unwrap();
    sql(
        &state.db,
        "UPDATE automation_flow_runs SET status='running' WHERE id=$1",
        vec![interrupted.into()],
    )
    .await
    .unwrap();
    recover_expired(&state).await.unwrap();
    assert_eq!(status(&state.db, interrupted).await, "failed");
    // Late owners are fenced even when a token is queued.
    let fenced = PersistentRuntime {
        state: &state,
        flow: flow.clone(),
        run: f,
        owner: Uuid::new_v4(),
        fence: 0,
        instance: None,
    };
    let txn = state.db.begin().await.unwrap();
    assert!(!fenced.guard(&txn).await.unwrap());
    txn.rollback().await.unwrap();

    // Real concurrent updates to one record preserve independent fields.
    let parallel=fixture_flow(&state.db,"trigger",json!([
        {"id":"trigger-1","data":{"kind":"trigger"}},
        {"id":"fork","data":{"kind":"parallel-condition","config":{"branches":[{"id":"a","mode":"all"},{"id":"b","mode":"all"}]}}},
        {"id":"a","data":{"kind":"update-data","config":{"targetFormUuid":"test-form","rows":[{"fieldId":"left","rawValue":"A"}]}}},
        {"id":"b","data":{"kind":"update-data","config":{"targetFormUuid":"test-form","rows":[{"fieldId":"right","rawValue":"B"}]}}}
    ]),json!([{"source":"trigger-1","target":"fork"},{"source":"fork","target":"a","sourceHandle":"condition-branch:a"},{"source":"fork","target":"b","sourceHandle":"condition-branch:b"}])).await;
    for _ in 0..3 {
        let txn = state.db.begin().await.unwrap();
        let r = start(&txn, &parallel, ExecutionPolicy::Background, None).await;
        txn.commit().await.unwrap();
        drive_execution(&state, r).await.unwrap();
        assert_eq!(status(&state.db, r).await, "success");
        let data = RecordRepository::new(&state.db)
            .find("test-form", &record.record_uuid)
            .await
            .unwrap()
            .record_data;
        assert_eq!(data["left"], "A");
        assert_eq!(data["right"], "B");
    }
    // Measure three graph shapes with query instrumentation, including startup.
    for (label, graph) in [("short", &flow), ("write", &write), ("parallel", &parallel)] {
        queries.store(0, std::sync::atomic::Ordering::SeqCst);
        let now = std::time::Instant::now();
        let memory = engine::MemoryRuntime {
            db: &state.db,
            flow: graph,
            outputs: std::sync::Mutex::new(HashMap::new()),
        };
        let input = AutomationExecutionContext {
            outputs: HashMap::from([("trigger-1".into(), json!({"amount":100}))]),
            operator: "test".into(),
            run_id: None,
        };
        engine::drive(
            &memory,
            Cursor {
                id: Uuid::new_v4(),
                node: "trigger-1".into(),
                context: input,
                depth: 0,
                log_id: None,
                parallel_group: None,
            },
        )
        .await
        .unwrap();
        let memory_ms = now.elapsed().as_secs_f64() * 1000.0;
        let memory_sql = queries.load(std::sync::atomic::Ordering::SeqCst);
        let memory_bytes = serde_json::to_vec(&*memory.outputs.lock().unwrap())
            .unwrap()
            .len();
        queries.store(0, std::sync::atomic::Ordering::SeqCst);
        let now = std::time::Instant::now();
        let txn = state.db.begin().await.unwrap();
        let r = start(&txn, graph, ExecutionPolicy::Background, None).await;
        txn.commit().await.unwrap();
        drive_execution(&state, r).await.unwrap();
        let durable_ms = now.elapsed().as_secs_f64() * 1000.0;
        let durable_sql = queries.load(std::sync::atomic::Ordering::SeqCst);
        let row=state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT COALESCE(sum(octet_length(outputs::text)),0)::bigint AS bytes FROM automation_execution_tokens WHERE run_id=$1",vec![r.into()])).await.unwrap().unwrap();
        println!(
            "PERF {label}: memory_ms={memory_ms:.2} memory_sql={memory_sql} memory_context_bytes={memory_bytes} durable_ms={durable_ms:.2} durable_sql={durable_sql} durable_token_json_bytes={}",
            row.try_get::<i64>("", "bytes").unwrap()
        );
    }
    // The real worker consumes committed queue entries; shutdown waits for work.
    let txn = state.db.begin().await.unwrap();
    let queued = start(&txn, &flow, ExecutionPolicy::Background, None).await;
    txn.commit().await.unwrap();
    let worker = start_worker(state.clone());
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if status(&state.db, queued).await == "success" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let _ = worker_shutdown.send(true);
    worker.await.unwrap();
    // Manual cleanup keeps new instances, business records, definitions and trigger history.
    let old = Uuid::new_v4();
    sql(&state.db,"INSERT INTO workflow_instances SELECT (jsonb_populate_record(NULL::workflow_instances,to_jsonb(i)||jsonb_build_object('id',$2::uuid,'instance_uuid','legacy-fixture','status','running','started_at',NOW()-INTERVAL '1 hour'))).* FROM workflow_instances i WHERE id=$1",vec![instance.id.into(),old.into()]).await.unwrap();
    sql(
        &state.db,
        "INSERT INTO workflow_branch_tokens VALUES($1,$2)",
        vec![Uuid::new_v4().into(), old.into()],
    )
    .await
    .unwrap();
    let count = AutomationRunEntity::find()
        .all(&state.db)
        .await
        .unwrap()
        .len();
    state
        .db
        .execute_unprepared(include_str!(
            "../../../../scripts/cleanup-old-workflow-instances.sql"
        ))
        .await
        .unwrap();
    assert!(
        workflow_instance_entity::Entity::find_by_id(old)
            .one(&state.db)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        workflow_instance_entity::Entity::find_by_id(instance.id)
            .one(&state.db)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        AutomationRunEntity::find()
            .all(&state.db)
            .await
            .unwrap()
            .len(),
        count
    );
    state
        .db
        .execute_unprepared(include_str!(
            "../../../../scripts/cleanup-old-workflow-instances.sql"
        ))
        .await
        .unwrap();
    assert!(
        RecordRepository::new(&state.db)
            .find("test-form", &record.record_uuid)
            .await
            .is_ok()
    );
}
