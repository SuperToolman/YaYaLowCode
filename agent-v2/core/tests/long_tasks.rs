use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use serde_json::json;
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Checkpoint, Command, ContentPart, Scope},
    store::{Store, exec, id},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; isolated schema"]
async fn unbounded_usage_recovery_fifo_and_fencing() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("v2_long_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    db.execute_unprepared(concat!(
        "CREATE TABLE iam_users(id uuid PRIMARY KEY);",
        include_str!("../schema.sql"),
        include_str!("../upgrade_confirmations.sql"),
        include_str!("../upgrade_policy.sql"),
        include_str!("../upgrade_binding.sql"),
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
    let sid = Uuid::parse_str(
        store.create_session(&scope, "test").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let prompt = || Command::Prompt {
        client_command_id: Uuid::new_v4(),
        parts: vec![ContentPart::Text {
            text: "long test".into(),
        }],
    };
    store.submit(&scope, sid, &prompt()).await.unwrap();
    let lease = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
    // Historical cap columns remain for compatibility but no longer govern execution.
    exec(&store.db,"UPDATE agent_v2_runs SET model_limit=1,model_requests=1000,budget_ms=1,active_since=now()-interval '13 hours' WHERE id=$1::uuid",vec![id(lease.run_id)]).await.unwrap();
    let (a, b) = tokio::join!(
        store.record_model_request(&lease),
        store.record_model_request(&lease)
    );
    a.unwrap();
    b.unwrap();
    let observed = store.run(lease.run_id).await.unwrap();
    assert_eq!(observed["model_requests"], 1002);
    assert_eq!(observed["status"], "running");
    let cp = Checkpoint {
        step: 51,
        ..Default::default()
    };
    store
        .checkpoint(&lease, &cp, "test.checkpoint", json!({}))
        .await
        .unwrap();
    exec(
        &store.db,
        "UPDATE agent_v2_runs SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
        vec![id(lease.run_id)],
    )
    .await
    .unwrap();
    let mut recovered = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
    assert_eq!(recovered.run_id, lease.run_id);
    assert_eq!(
        store.run(recovered.run_id).await.unwrap()["checkpoint"]["step"],
        51
    );
    assert!(store.record_model_request(&lease).await.is_err());
    // Historical technical/budget pauses are automatically reclaimed, never
    // terminal failures or unknown script outcomes.
    for reason in [
        "budget_exhausted",
        "context_unshrinkable",
        "context_compaction_failed",
        "no_progress",
    ] {
        store.suspend(&recovered, "paused", reason).await.unwrap();
        recovered = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
    }
    assert_eq!(recovered.run_id, lease.run_id);
    store.submit(&scope, sid, &prompt()).await.unwrap();
    assert!(
        store.claim(Uuid::new_v4(), 30).await.unwrap().is_none(),
        "FIFO still blocks later runs"
    );
    store
        .suspend(&recovered, "manual_review", "outcome_unknown")
        .await
        .unwrap();
    assert!(store.claim(Uuid::new_v4(), 30).await.unwrap().is_none());
    let resume = Command::Resume {
        client_command_id: Uuid::new_v4(),
        run_id: recovered.run_id,
    };
    assert!(store.submit(&scope, sid, &resume).await.is_err());
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
    assert_eq!(
        store.run(recovered.run_id).await.unwrap()["status"],
        "cancelled"
    );
    assert!(store.claim(Uuid::new_v4(), 30).await.unwrap().is_none());
    let events = store.events(sid, 0).await.unwrap();
    assert!(
        events
            .iter()
            .any(|e| e["type"] == "run.resumed" && e["payload"]["automatic"] == true)
    );
    assert!(
        exec(
            &store.db,
            "UPDATE agent_v2_runs SET lease_epoch=lease_epoch+1 WHERE id=$1::uuid",
            vec![id(lease.run_id)]
        )
        .await
        .is_err()
    );
    store
        .db
        .execute_unprepared(include_str!("../upgrade_long_tasks.sql"))
        .await
        .unwrap();
    assert_eq!(
        store.run(recovered.run_id).await.unwrap()["status"],
        "cancelled"
    );
}
