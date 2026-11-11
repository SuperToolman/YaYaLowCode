use axum::{
    Json, Router,
    extract::State,
    response::IntoResponse,
    routing::{get, post},
};
use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use serde_json::{Value, json};
use std::{
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::process::{Child, Command};
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Command as UserCommand, ContentPart, Scope},
    store::{Store, exec, id},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; kills only child Workers in an isolated schema"]
async fn kill_worker_at_four_persistence_boundaries() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("agent_v2_process_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url.clone());
    options.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    db.execute_unprepared("CREATE TABLE iam_users(id uuid PRIMARY KEY)")
        .await
        .unwrap();
    db.execute_unprepared(concat!(
        include_str!("../../core/schema.sql"),
        "\n",
        include_str!("../../core/upgrade_confirmations.sql"),
        "\n",
        include_str!("../../core/upgrade_policy.sql"),
        "\n",
        include_str!("../../core/upgrade_binding.sql"),
        "
",
        include_str!("../../core/upgrade_workspace.sql"),
        "
",
        include_str!("../../core/upgrade_submissions.sql"),
        "\n",
        include_str!("../../core/upgrade_executions.sql")
    ))
    .await
    .unwrap();
    let result = tokio::spawn(verify(Store { db }, url, schema.clone())).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn provider(
    State(stage): State<Arc<AtomicUsize>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let has_tool = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["role"] == "tool");
    if stage.load(Ordering::SeqCst) == 2 || (stage.load(Ordering::SeqCst) == 4 && has_tool) {
        while stage.load(Ordering::SeqCst) != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    let (delta, reason) = if has_tool {
        (json!({"content":"recovered"}), "stop")
    } else {
        (
            json!({"tool_calls":[{"index":0,"id":"echo-1","function":{"name":"diagnostic_echo","arguments":"{\"text\":\"recovery\"}"}}]}),
            "tool_calls",
        )
    };
    (
        [("content-type", "text/event-stream")],
        format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":delta,"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":reason}]})
        ),
    )
}
fn worker(url: &str, base: &str, schema: &str) -> Child {
    let separator = if url.contains('?') { '&' } else { '?' };
    Command::new(env!("CARGO_BIN_EXE_yaya-agent-v2-worker"))
        .env(
            "DATABASE_URL",
            format!("{url}{separator}options=-csearch_path%3D{schema}"),
        )
        .env("YAYA_AGENT_V2_API_URL", base)
        .env(
            "YAYA_AGENT_V2_WORKER_SECRET",
            "integration-worker-secret-01234567890123456789",
        )
        .env("YAYA_AGENT_V2_LEASE_SECONDS", "6")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}
async fn verify(store: Store, url: String, schema: String) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let stage = Arc::new(AtomicUsize::new(0));
    let gate = stage.clone();
    let model_base = base.clone();
    let app=Router::new().route("/v1/chat/completions",post(provider)).with_state(stage.clone())
        .route("/api/internal/agent-v2/runs/{id}/context",get(move||{let gate=gate.clone();let model_base=model_base.clone();async move {
            while gate.load(Ordering::SeqCst)==1 {tokio::time::sleep(Duration::from_millis(5)).await;}
            Json(json!({"employee_id":"test","system_prompt":"Use echo","allowed_tools":["diagnostic_echo"],"model":{"id":"test","api_base_url":format!("{model_base}/v1"),"api_key":"test","chat_model":"test"}}))
        }}));
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let scope = Scope {
        tenant_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
    };
    exec(
        &store.db,
        "INSERT INTO iam_users VALUES($1::uuid)",
        vec![id(scope.user_id)],
    )
    .await
    .unwrap();
    for boundary in 1..=4 {
        stage.store(boundary, Ordering::SeqCst);
        let session = store.create_session(&scope, "test").await.unwrap();
        let sid = Uuid::parse_str(session["id"].as_str().unwrap()).unwrap();
        let accepted = store
            .submit(
                &scope,
                sid,
                &UserCommand::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts: vec![ContentPart::Text {
                        text: "test".into(),
                    }],
                },
            )
            .await
            .unwrap();
        let run = Uuid::parse_str(accepted["runId"].as_str().unwrap()).unwrap();
        let mut first = worker(&url, &base, &schema);
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let events = store.events(sid, 0).await.unwrap();
                let kind = match boundary {
                    1 => "run.started",
                    2 => "step.started",
                    3 => "tool.started",
                    _ => "tool.completed",
                };
                if events.iter().any(|e| e["type"] == kind) {
                    break;
                }
                assert!(
                    first.try_wait().unwrap().is_none(),
                    "worker exited at boundary {boundary}"
                );
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .expect("boundary was never reached");
        first.kill().await.unwrap();
        first.wait().await.unwrap();
        stage.store(0, Ordering::SeqCst);
        exec(
            &store.db,
            "UPDATE agent_v2_runs SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
            vec![id(run)],
        )
        .await
        .unwrap();
        let mut second = worker(&url, &base, &schema);
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let row = store.run(run).await.unwrap();
                if row["status"] == "completed" {
                    break;
                }
                assert_ne!(
                    row["status"], "failed",
                    "recovery failed at boundary {boundary}"
                );
                assert!(
                    second.try_wait().unwrap().is_none(),
                    "recovery worker exited"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("recovery timed out");
        second.kill().await.unwrap();
        second.wait().await.unwrap();
        assert_eq!(store.messages(sid).await.unwrap().len(), 2);
        assert_eq!(
            store
                .events(sid, 0)
                .await
                .unwrap()
                .iter()
                .filter(|e| e["type"] == "tool.completed")
                .count(),
            1
        );
    }
    server.abort();
}
