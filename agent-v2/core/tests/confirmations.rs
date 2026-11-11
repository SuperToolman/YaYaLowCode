use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use serde_json::json;
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Checkpoint, Command, ContentPart, Scope, ToolCall},
    store::{SavedToolResult, Store, exec, id, js},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; isolated schema"]
async fn approval_fifo_dedupe_expiry_cancellation_and_fencing() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("v2_confirm_{}", Uuid::new_v4().simple());
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
    let session = store.create_session(&scope, "employee").await.unwrap();
    let sid = Uuid::parse_str(session["id"].as_str().unwrap()).unwrap();
    let prompt = || Command::Prompt {
        client_command_id: Uuid::new_v4(),
        parts: vec![ContentPart::Text {
            text: "test".into(),
        }],
    };
    store.submit(&scope, sid, &prompt()).await.unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let call = ToolCall {
        id: "call".into(),
        name: "platform_create_app".into(),
        arguments: json!({"name":"test"}),
    };
    let cp = Checkpoint {
        progress_fingerprints: vec![],
        progress_warning: None,
        progress_warning_seen: false,
        pending_calls: vec![call.clone()],
        ..Default::default()
    };
    store
        .checkpoint(&lease, &cp, "test", json!({}))
        .await
        .unwrap();
    let c = store
        .request_confirmation(&lease, &call, "v1", json!({"name":"test"}), 1800)
        .await
        .unwrap();
    assert_eq!(
        store.run(lease.run_id).await.unwrap()["status"],
        "waiting_confirmation"
    );
    assert!(store.heartbeat(&lease, 30).await.is_err());
    store.submit(&scope, sid, &prompt()).await.unwrap();
    assert!(
        store.claim(Uuid::new_v4(), 30).await.unwrap().is_none(),
        "waiting approval blocks later session work"
    );
    let cid = Uuid::parse_str(c["id"].as_str().unwrap()).unwrap();
    let approve = Command::Confirm {
        client_command_id: Uuid::new_v4(),
        confirmation_id: cid,
        approve: true,
    };
    let first = store.submit(&scope, sid, &approve).await.unwrap();
    assert_eq!(first, store.submit(&scope, sid, &approve).await.unwrap());
    assert!(
        store
            .submit(
                &scope,
                sid,
                &Command::Confirm {
                    client_command_id: Uuid::new_v4(),
                    confirmation_id: cid,
                    approve: false
                }
            )
            .await
            .is_err()
    );
    let resumed = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    assert_eq!(resumed.run_id, lease.run_id);
    assert!(resumed.epoch > lease.epoch);
    assert!(
        store
            .tool_end(&lease, "call", json!({}), &cp)
            .await
            .is_err()
    );
    store
        .finish(&resumed, "completed", "done", None)
        .await
        .unwrap();
    let next = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let c = store
        .request_confirmation(&next, &call, "v1", json!({}), 1800)
        .await
        .unwrap();
    exec(
        &store.db,
        "UPDATE agent_v2_confirmations SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
        vec![id(Uuid::parse_str(c["id"].as_str().unwrap()).unwrap())],
    )
    .await
    .unwrap();
    store.expire_confirmations().await.unwrap();
    let expired = store.confirmations(&scope, sid).await.unwrap();
    assert!(expired.iter().any(|c| c["status"] == "expired"));
    assert!(
        expired.iter().find(|c| c["status"] == "expired").unwrap()["result"]["executed"] == false
    );
    let next = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store
        .finish(&next, "completed", "expired", None)
        .await
        .unwrap();
    store.submit(&scope, sid, &prompt()).await.unwrap();
    let next = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store
        .request_confirmation(&next, &call, "v1", json!({}), 1800)
        .await
        .unwrap();
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
    assert_eq!(store.run(next.run_id).await.unwrap()["status"], "cancelled");
    assert!(
        store
            .confirmations(&scope, sid)
            .await
            .unwrap()
            .iter()
            .any(|c| c["status"] == "cancelled" && c["result"]["executed"] == false)
    );
    assert!(
        store
            .confirmations(
                &Scope {
                    tenant_id: scope.tenant_id,
                    user_id: Uuid::new_v4()
                },
                sid
            )
            .await
            .is_err()
    );
    // Approved execution failures remain visible after refresh, and never turn
    // into approved-but-hanging confirmations.
    store.submit(&scope, sid, &prompt()).await.unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store.tool_start(&lease, &call).await.unwrap();
    let c = store
        .request_confirmation(&lease, &call, "v1", json!({}), 1800)
        .await
        .unwrap();
    let cid = Uuid::parse_str(c["id"].as_str().unwrap()).unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Confirm {
                client_command_id: Uuid::new_v4(),
                confirmation_id: cid,
                approve: true,
            },
        )
        .await
        .unwrap();
    let resumed = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let failure = yaya_agent_v2::store::safe_tool_failure("tool_access_denied");
    store
        .tool_failed(&resumed, &call.id, failure.clone(), &Checkpoint::default())
        .await
        .unwrap();
    let failed = store
        .confirmations(&scope, sid)
        .await
        .unwrap()
        .into_iter()
        .find(|item| item["id"] == cid.to_string())
        .unwrap();
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["result"], failure);
    store
        .finish(&resumed, "completed", "denied", None)
        .await
        .unwrap();

    store.submit(&scope, sid, &prompt()).await.unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store.tool_start(&lease, &call).await.unwrap();
    let c = store
        .request_confirmation(&lease, &call, "v1", json!({}), 1800)
        .await
        .unwrap();
    let cid = Uuid::parse_str(c["id"].as_str().unwrap()).unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Confirm {
                client_command_id: Uuid::new_v4(),
                confirmation_id: cid,
                approve: true,
            },
        )
        .await
        .unwrap();
    let resumed = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store
        .finish(&resumed, "failed", "", Some("employee_content_changed"))
        .await
        .unwrap();
    let failed = store
        .confirmations(&scope, sid)
        .await
        .unwrap()
        .into_iter()
        .find(|item| item["id"] == cid.to_string())
        .unwrap();
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["result"]["error"], "employee_content_changed");

    // Recover the business effect committed before a dead Worker's checkpoint.
    store.submit(&scope, sid, &prompt()).await.unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store.tool_start(&lease, &call).await.unwrap();
    let c = store
        .request_confirmation(&lease, &call, "v1", json!({}), 1800)
        .await
        .unwrap();
    let cid = Uuid::parse_str(c["id"].as_str().unwrap()).unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Confirm {
                client_command_id: Uuid::new_v4(),
                confirmation_id: cid,
                approve: true,
            },
        )
        .await
        .unwrap();
    let resumed = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let tx = store.fence(&resumed, false).await.unwrap();
    exec(
        &tx,
        "INSERT INTO agent_v2_effects(effect_key,result) VALUES($1::uuid,$2)",
        vec![id(cid), js(json!({"created":"once"}))],
    )
    .await
    .unwrap();
    exec(
        &tx,
        "UPDATE agent_v2_confirmations SET status='executed' WHERE id=$1::uuid",
        vec![id(cid)],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    exec(
        &store.db,
        "UPDATE agent_v2_runs SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
        vec![id(resumed.run_id)],
    )
    .await
    .unwrap();
    let recovered = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    for _ in 0..2 {
        assert!(
            matches!(store.tool_start(&recovered,&call).await.unwrap(),Some(SavedToolResult::Completed(value)) if value==json!({"created":"once"}))
        );
    }
    assert!(
        store
            .tool_failed(&recovered, &call.id, failure, &Checkpoint::default())
            .await
            .is_err()
    );
    let events = store.events(sid, 0).await.unwrap();
    assert_eq!(events.iter().filter(|e|e["run_id"]==recovered.run_id.to_string()&&e["type"]=="tool.completed").count(),1);
    store
        .replay_tool_result(&recovered, &call.id, "completed", &Checkpoint::default())
        .await
        .unwrap();
    store
        .finish(&recovered, "completed", "once", None)
        .await
        .unwrap();
}
