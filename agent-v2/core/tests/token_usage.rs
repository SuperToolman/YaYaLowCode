use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use serde_json::json;
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Command, ContentPart, Scope},
    store::{Store, event, exec, id, js},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; creates and drops an isolated schema"]
async fn directory_token_usage_matches_history_and_excludes_other_sessions() {
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
        include_str!("../upgrade_long_tasks.sql"),
        "\n",
        include_str!("../upgrade_session_directory.sql"),
        "\n",
        include_str!("../upgrade_session_deletion.sql"),
        "\n",
        include_str!("../upgrade_forks.sql")
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
    let mut sessions = Vec::new();
    for _ in 0..3 {
        let session = store.create_session(&scope, "employee-a").await.unwrap();
        sessions.push(Uuid::parse_str(session["id"].as_str().unwrap()).unwrap());
    }
    // More than a history page, with observations, a duplicate legacy snapshot,
    // an older snapshot-only request and one missing provider usage record.
    for (index, sid) in [sessions[0]; 22]
        .into_iter()
        .chain([sessions[1]])
        .enumerate()
    {
        let command = Command::Prompt {
            client_command_id: Uuid::new_v4(),
            parts: vec![ContentPart::Text {
                text: "usage fixture".into(),
            }],
        };
        let result = store.submit(&scope, sid, &command).await.unwrap();
        let run = Uuid::parse_str(result["runId"].as_str().unwrap()).unwrap();
        exec(
            &store.db,
            "UPDATE agent_v2_runs SET model_requests=1,status='completed' WHERE id=$1::uuid",
            vec![id(run)],
        )
        .await
        .unwrap();
        if index == 0 {
            exec(
                &store.db,
                "UPDATE agent_v2_runs SET model_requests=2 WHERE id=$1::uuid",
                vec![id(run)],
            )
            .await
            .unwrap();
            let tx = sea_orm::TransactionTrait::begin(&store.db).await.unwrap();
            event(
                &tx,
                sid,
                Some(run),
                "model.usage",
                json!({"inputTokens":2,"outputTokens":1,"purpose":"summary"}),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }
        if index != 21 {
            if index != 20 {
                let tx = sea_orm::TransactionTrait::begin(&store.db).await.unwrap();
                event(&tx,sid,Some(run),"model.usage",json!({"inputTokens":10,"outputTokens":5,"totalTokens":15,"purpose":"generation","step":0,"epoch":1})).await.unwrap();
                tx.commit().await.unwrap();
            }
            if index == 0 || index == 20 {
                exec(&store.db,"INSERT INTO agent_v2_steps(run_id,ordinal,attempt,status,request_snapshot,response_snapshot) VALUES($1::uuid,0,1,'completed','{}',$2)",vec![id(run),js(json!({"usage":{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}}))]).await.unwrap();
            }
        }
    }
    let summary = store
        .session_token_usage(&[sessions[0], sessions[2]])
        .await
        .unwrap();
    assert_eq!(summary.len(), 2);
    let usage = &summary
        .iter()
        .find(|r| r["session_id"] == sessions[0].to_string())
        .unwrap()["token_usage"];
    assert_eq!(
        usage,
        &json!({"input_tokens":212,"output_tokens":106,"total_tokens":318,"reported_requests":22,"model_requests":23,"unreported_requests":1})
    );
    let page = store.message_page(sessions[0], None).await.unwrap();
    assert!(page["next_before"].is_string());
    assert_eq!(&page["token_usage"], usage);
    let empty = &summary
        .iter()
        .find(|r| r["session_id"] == sessions[2].to_string())
        .unwrap()["token_usage"];
    assert_eq!(empty["reported_requests"], 0);
    assert_eq!(empty["total_tokens"], 0);
}
