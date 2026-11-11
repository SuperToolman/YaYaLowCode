use super::*;
use sea_orm::{ConnectOptions, ConnectionTrait, Database};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; uses an isolated temporary schema"]
async fn retires_only_legacy_storage_and_rolls_back_unknown_dependencies() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let name = format!("retired_agent_test_{}", uuid::Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&name).sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify(db: sea_orm::DatabaseConnection) {
    use super::m20261102_000105_retire_legacy_agent_storage::Migration;
    db.execute_unprepared(
        "CREATE TABLE agent_sessions(id INT PRIMARY KEY);
        INSERT INTO agent_sessions VALUES(1);
        CREATE TABLE agent_files(id INT PRIMARY KEY, session_id INT REFERENCES agent_sessions);
        INSERT INTO agent_files VALUES(1,1);
        CREATE TABLE agent_file_links(id INT, file_id INT REFERENCES agent_files);
        CREATE TABLE agent_session_runtime_summaries(session_id INT REFERENCES agent_sessions);
        CREATE TABLE agent_transactions(session_id INT REFERENCES agent_sessions);
        CREATE TABLE agent_runs(id INT PRIMARY KEY, session_id INT REFERENCES agent_sessions);
        CREATE TABLE agent_run_steps(run_id INT REFERENCES agent_runs);
        CREATE TABLE agent_messages(session_id INT REFERENCES agent_sessions);
        CREATE TABLE agent_resources(kind TEXT);
        INSERT INTO agent_resources VALUES('skill'),('persona'),('plugin'),('knowledge_base');
        CREATE TABLE iam_role_permissions(permission TEXT);
        INSERT INTO iam_role_permissions VALUES('agent.window'),('agent:employee:use'),
            ('settings.agent-archive.view'),('settings.agent-archive.manage');
        CREATE TABLE agent_v2_sessions(id INT PRIMARY KEY);
        INSERT INTO agent_v2_sessions VALUES(7);
        CREATE TABLE agent_v2_files(id INT);
        INSERT INTO agent_v2_files VALUES(9);
        CREATE TABLE agent_model_providers(id INT);
        INSERT INTO agent_model_providers VALUES(11);
        CREATE TABLE agent_provider_models(id INT);
        INSERT INTO agent_provider_models VALUES(12);
        CREATE TABLE form_schemas(schema_json JSONB);
        INSERT INTO form_schemas VALUES ('{\"pageProps\":{\"agent\":{\"enabled\":true},\"submitButtonText\":\"Save\"}}');
        CREATE TABLE unrelated_reference(session_id INT REFERENCES agent_sessions);",
    )
    .await
    .unwrap();
    let manager = SchemaManager::new(&db);
    // Unknown inbound dependencies must fail, not be silently removed by CASCADE.
    assert!(Migration.up(&manager).await.is_err());
    assert!(manager.has_table("agent_files").await.unwrap());
    assert!(manager.has_table("agent_sessions").await.unwrap());
    assert_eq!(count(&db, "agent_resources").await, 4);
    db.execute_unprepared("DROP TABLE unrelated_reference")
        .await
        .unwrap();
    Migration.up(&manager).await.unwrap();
    Migration.up(&manager).await.unwrap(); // Safe to rerun the SQL.
    for table in [
        "agent_sessions",
        "agent_files",
        "agent_file_links",
        "agent_session_runtime_summaries",
        "agent_transactions",
        "agent_messages",
        "agent_runs",
        "agent_run_steps",
    ] {
        assert!(
            !manager.has_table(table).await.unwrap(),
            "still exists: {table}"
        );
    }
    for table in [
        "agent_v2_sessions",
        "agent_v2_files",
        "agent_model_providers",
        "agent_provider_models",
        "agent_resources",
    ] {
        assert_eq!(
            count(&db, table).await,
            1,
            "shared/V2 data changed: {table}"
        );
    }
    assert_eq!(count(&db, "iam_role_permissions").await, 2);
    let row = db
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Postgres,
            "SELECT schema_json FROM form_schemas".to_string(),
        ))
        .await
        .unwrap()
        .unwrap();
    let schema: serde_json::Value = row.try_get("", "schema_json").unwrap();
    assert!(schema["pageProps"].get("agent").is_none());
    assert_eq!(schema["pageProps"]["submitButtonText"], "Save");
    assert!(Migration.down(&manager).await.is_err());
}

async fn count(db: &sea_orm::DatabaseConnection, table: &str) -> i64 {
    db.query_one_raw(sea_orm::Statement::from_string(
        sea_orm::DbBackend::Postgres,
        format!("SELECT count(*) AS total FROM {table}"),
    ))
    .await
    .unwrap()
    .unwrap()
    .try_get("", "total")
    .unwrap()
}
