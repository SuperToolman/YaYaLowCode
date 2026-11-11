use sea_orm::{ConnectOptions, ConnectionTrait, Database, TransactionTrait};
use uuid::Uuid;
use yaya_agent_v2::domain::{Command, ContentPart, Scope};
use yaya_agent_v2::store::{Store, exec, id, rows};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; isolated old-schema upgrade"]
async fn upgrade_existing_runs_and_fresh_schema() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("agent_v2_upgrade_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move {
        db.execute_unprepared("CREATE TABLE iam_users(id uuid PRIMARY KEY)").await.unwrap();
        db.execute_unprepared(concat!(include_str!("../schema.sql"), "\n", include_str!("../upgrade_confirmations.sql"),"\n",include_str!("../upgrade_policy.sql"),"\n",include_str!("../upgrade_binding.sql"),"\n",include_str!("../upgrade_workspace.sql"),"\n",include_str!("../upgrade_executions.sql"),"\n",include_str!("../upgrade_long_tasks.sql"), "\n", include_str!("../upgrade_session_directory.sql"), "\n", include_str!("../upgrade_session_deletion.sql"), "\n", include_str!("../upgrade_forks.sql"))).await.unwrap();
        // Upgrade must also run on freshly initialized databases, repeatedly.
        for _ in 0..2 {
            let tx = db.begin().await.unwrap();
            tx.execute_unprepared(include_str!("../upgrade_queue_seq.sql")).await.unwrap();
            tx.commit().await.unwrap();
        }
        let scope = Scope { user_id: Uuid::new_v4(), tenant_id: Uuid::new_v4() };
        exec(&db, "INSERT INTO iam_users(id) VALUES($1::uuid)", vec![id(scope.user_id)]).await.unwrap();
        let store = Store { db: db.clone() };
        let session = Uuid::parse_str(store.create_session(&scope,"test").await.unwrap()["id"].as_str().unwrap()).unwrap();
        for _ in 0..2 {
            store.submit(&scope,session,&Command::Prompt {client_command_id:Uuid::new_v4(),parts:vec![ContentPart::Text{text:"test".into()}]}).await.unwrap();
        }
        db.execute_unprepared("ALTER TABLE agent_v2_runs DROP COLUMN queue_seq CASCADE; UPDATE agent_v2_sessions SET next_seq=0;").await.unwrap();
        let tx = db.begin().await.unwrap();
        tx.execute_unprepared(include_str!("../upgrade_queue_seq.sql")).await.unwrap();
        tx.commit().await.unwrap();
        let upgraded = rows(&db,"SELECT row_to_json(x)::text data FROM (SELECT queue_seq FROM agent_v2_runs ORDER BY queue_seq) x",vec![]).await.unwrap();
        assert_eq!(upgraded.len(),2);
        assert_eq!(upgraded[0]["queue_seq"],1);
        assert_eq!(upgraded[1]["queue_seq"],2);
        store.submit(&scope,session,&Command::Prompt {client_command_id:Uuid::new_v4(),parts:vec![ContentPart::Text{text:"after upgrade".into()}]}).await.unwrap();
        assert!(store.claim(Uuid::new_v4(),30).await.unwrap().is_some());
        assert_eq!(store.messages(session).await.unwrap().len(),3);
    }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}
