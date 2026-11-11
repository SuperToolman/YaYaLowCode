use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use serde_json::{Value, json};
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Checkpoint, Command, ContentPart, Scope, ToolCall},
    store::{SavedToolResult, Store, exec, id, rows},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; creates and drops an isolated schema"]
async fn durable_commands_fencing_recovery_and_isolation() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("agent_v2_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut opts = ConnectOptions::new(url);
    opts.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(opts).await.unwrap();
    db.execute_unprepared("CREATE TABLE iam_users(id uuid PRIMARY KEY)")
        .await
        .unwrap();
    db.execute_unprepared(concat!(
        include_str!("../schema.sql"),
        "\n",
        include_str!("../upgrade_confirmations.sql"),
        "\n",
        include_str!("../upgrade_policy.sql"),
        "\n",
        include_str!("../upgrade_binding.sql"),
        "\n",
        include_str!("../upgrade_workspace.sql"),
        "\n",
        include_str!("../upgrade_executions.sql"),
        "\n",
        include_str!("../upgrade_long_tasks.sql"), "\n", include_str!("../upgrade_session_directory.sql"), "\n", include_str!("../upgrade_session_deletion.sql"), "\n", include_str!("../upgrade_forks.sql")
    ))
    .await
    .unwrap();
    let result = tokio::spawn(verify(Store { db })).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify(store: Store) {
    let scope = Scope {
        tenant_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
    };
    exec(
        &store.db,
        "INSERT INTO iam_users(id) VALUES($1::uuid)",
        vec![id(scope.user_id)],
    )
    .await
    .unwrap();
    let session = store.create_session(&scope, "employee-a").await.unwrap();
    let sid = Uuid::parse_str(session["id"].as_str().unwrap()).unwrap();
    let second = store.create_session(&scope, "employee-b").await.unwrap();
    assert_ne!(session["id"], second["id"]);
    assert!(
        store
            .session(
                &Scope {
                    user_id: Uuid::new_v4(),
                    ..scope.clone()
                },
                sid
            )
            .await
            .is_err()
    );
    assert!(
        store
            .session(
                &Scope {
                    tenant_id: Uuid::new_v4(),
                    ..scope.clone()
                },
                sid
            )
            .await
            .is_err()
    );
    let key = Uuid::new_v4();
    let prompt = |text: &str| Command::Prompt {
        client_command_id: key,
        parts: vec![ContentPart::Text { text: text.into() }],
    };
    let first = store.submit(&scope, sid, &prompt("hello")).await.unwrap();
    assert_eq!(
        first,
        store.submit(&scope, sid, &prompt("hello")).await.unwrap()
    );
    assert!(store.submit(&scope, sid, &prompt("changed")).await.is_err());
    assert_eq!(store.messages(sid).await.unwrap().len(), 1);
    let (a, b) = tokio::join!(
        store.claim(Uuid::new_v4(), 30),
        store.claim(Uuid::new_v4(), 30)
    );
    let mut claims = [a.unwrap(), b.unwrap()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(claims.len(), 1);
    let stale = claims.pop().unwrap();
    let call = ToolCall {
        id: "echo-1".into(),
        name: "diagnostic_echo".into(),
        arguments: json!({"text":"hi"}),
    };
    assert!(store.tool_start(&stale, &call).await.unwrap().is_none());
    store
        .tool_end(
            &stale,
            &call.id,
            json!({"text":"hi"}),
            &Checkpoint::default(),
        )
        .await
        .unwrap();
    exec(
        &store.db,
        "UPDATE agent_v2_runs SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
        vec![id(stale.run_id)],
    )
    .await
    .unwrap();
    let recovered = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    assert_eq!(recovered.epoch, stale.epoch + 1);
    assert!(store.append(&stale, "invalid", json!({})).await.is_err());
    assert!(
        store
            .finish(&stale, "completed", "stale", None)
            .await
            .is_err()
    );
    assert!(matches!(
        store.tool_start(&recovered, &call).await.unwrap(),
        Some(SavedToolResult::Completed(value)) if value == json!({"text":"hi"})
    ));
    let failed_call = ToolCall {
        id: "echo-failed".into(),
        name: "diagnostic_echo".into(),
        arguments: json!({"text":"fails"}),
    };
    assert!(
        store
            .tool_start(&recovered, &failed_call)
            .await
            .unwrap()
            .is_none()
    );
    let failure = json!({"ok":false,"error":{"code":"tool_access_denied","message":"denied"}});
    store
        .tool_failed(
            &recovered,
            &failed_call.id,
            failure.clone(),
            &Checkpoint::default(),
        )
        .await
        .unwrap();
    assert!(matches!(
        store.tool_start(&recovered, &failed_call).await.unwrap(),
        Some(SavedToolResult::Failed(value)) if value == failure
    ));
    store
        .replay_tool_result(
            &recovered,
            &failed_call.id,
            "failed",
            &Checkpoint::default(),
        )
        .await
        .unwrap();
    assert!(
        store
            .tool_end(
                &recovered,
                &failed_call.id,
                json!({"incorrect":"success"}),
                &Checkpoint::default()
            )
            .await
            .is_err()
    );
    let failed_state = rows(&store.db, "SELECT jsonb_build_object('status',status,'result',result)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid AND call_id=$2", vec![id(recovered.run_id), failed_call.id.clone().into()]).await.unwrap().remove(0);
    assert_eq!(failed_state["status"], "failed");
    assert_eq!(failed_state["result"], failure);
    store
        .finish(&recovered, "completed", "answer", None)
        .await
        .unwrap();
    assert_eq!(store.messages(sid).await.unwrap().len(), 2);
    let next = Command::Prompt {
        client_command_id: Uuid::new_v4(),
        parts: vec![ContentPart::Text {
            text: "next".into(),
        }],
    };
    store.submit(&scope, sid, &next).await.unwrap();
    let active = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Cancel {
                client_command_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
    assert!(store.heartbeat(&active, 30).await.is_err());
    assert!(store.append(&active, "invalid", json!({})).await.is_err());
    store
        .finish(&active, "completed", "must not publish", None)
        .await
        .unwrap();
    assert_eq!(
        store.run(active.run_id).await.unwrap()["status"],
        "cancelled"
    );
    let events = store.events(sid, 0).await.unwrap();
    for (i, event) in events.iter().enumerate() {
        assert_eq!(event["seq"], json!(i + 1));
    }
    let replay = store.events(sid, 2).await.unwrap();
    assert!(
        replay
            .iter()
            .all(|event| event["seq"].as_i64().unwrap() > 2)
    );
    let other = Uuid::parse_str(second["id"].as_str().unwrap()).unwrap();
    assert_eq!(store.events(other, 0).await.unwrap().len(), 1);
    let count: Value = yaya_agent_v2::store::rows(
        &store.db,
        "SELECT jsonb_build_object('n',count(*))::text data FROM agent_v2_outbox",
        vec![],
    )
    .await
    .unwrap()
    .remove(0);
    assert_eq!(count["n"].as_u64().unwrap(), events.len() as u64 + 1);
}
