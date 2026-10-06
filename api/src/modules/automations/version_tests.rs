use super::*;
use sea_orm::{ConnectOptions, Database, Schema, PaginatorTrait};
use sea_orm_migration::{MigratorTrait, SchemaManager};

fn update_request(value: Value) -> UpdateAutomationFlowRequest {
    serde_json::from_value(value).unwrap()
}

#[tokio::test]
#[ignore = "requires AUTOMATION_TEST_DATABASE_URL; creates and removes an isolated schema"]
async fn automation_version_lifecycle_database() {
    let url = std::env::var("AUTOMATION_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("automation_test_{}", Uuid::new_v4().simple());
    admin.execute_unprepared(&format!("CREATE SCHEMA {schema_name}")).await.unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&schema_name).sqlx_logging(false).max_connections(8);
    let db = Database::connect(options).await.unwrap();
    let builder = db.get_database_backend();
    let schema = Schema::new(builder);
    for statement in [
        schema.create_table_from_entity(AppEntity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationNodeEntity),
        schema.create_table_from_entity(AutomationEdgeEntity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db, None, 1, shutdown);
    let result = tokio::spawn(async move { verify_lifecycle(state).await }).await;
    admin.execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE")).await.unwrap();
    result.unwrap();
}

async fn verify_lifecycle(state: AppState) {
    let now = Utc::now();
    app_entity::ActiveModel {
        id: Set(Uuid::new_v4()), route_app_id: Set("version-test".into()),
        name: Set("Version test".into()), description: Set(String::new()),
        icon: Set(String::new()), badge: Set(None), color: Set(String::new()),
        creator_user_id: Set(None), deployment_type: Set("local".into()),
        online_version: Set(None), online_release_id: Set(None), owner_name: Set("test".into()),
        records_count: Set(0), created_at: Set(now.into()), updated_at: Set(now.into()),
    }.insert(&state.db).await.unwrap();
    let flow = create_automation_definition(&state, "version-test", None).await.unwrap();
    assert_eq!(flow.status, "paused");
    assert_eq!(flow.current_version, 1);
    state.db.execute_unprepared(
        "UPDATE automation_flows SET status = 'draft'; UPDATE automation_flow_versions SET status = 'draft'; ALTER TABLE automation_flows ALTER COLUMN status SET DEFAULT 'draft';"
    ).await.unwrap();
    let migration = crate::infrastructure::migrator::Migrator::migrations()
        .into_iter().find(|migration| migration.name().contains("remove_automation_draft")).unwrap();
    migration.up(&SchemaManager::new(&state.db)).await.unwrap();
    assert_eq!(AutomationFlowEntity::find_by_id(flow.id).one(&state.db).await.unwrap().unwrap().status, "paused");
    assert_eq!(AutomationFlowVersionEntity::find().one(&state.db).await.unwrap().unwrap().status, "paused");
    let id = flow.flow_uuid;
    let unchanged = update_automation_definition(&state, &id, update_request(json!({}))).await.unwrap();
    assert_eq!(unchanged.current_version, 1);
    let started = update_automation_definition(&state, &id, update_request(json!({"status":"enabled"}))).await.unwrap();
    assert_eq!(started.current_version, 1);
    assert_eq!(started.status, "enabled");
    assert!(update_automation_definition(&state, &id, update_request(json!({"status":"draft"}))).await.is_err());

    let graph = json!([{"id":"trigger-1", "data":{"kind":"trigger"}}]);
    let v2 = update_automation_definition(&state, &id, update_request(json!({"nodes":graph,"edges":[]}))).await.unwrap();
    assert_eq!(v2.current_version, 2);
    let unchanged = update_automation_definition(&state, &id, update_request(json!({
        "name":v2.name,"status":"paused", "triggerEvents":["after_create"],
        "triggerConfig":v2.trigger_config, "nodes":graph,"edges":[],
    }))).await.unwrap();
    assert_eq!(unchanged.current_version, 2);
    assert_eq!(unchanged.status, "paused");
    for version in 3..=5 {
        let saved = update_automation_definition(&state, &id, update_request(json!({
            "nodes":[{"id":"trigger-1","position":{"x":version,"y":0},"data":{"kind":"trigger"}}],
        }))).await.unwrap();
        assert_eq!(saved.current_version, version);
    }
    update_automation_definition(&state, &id, update_request(json!({"status":"enabled"}))).await.unwrap();
    let Json(switched) = restore_automation_flow_version(State(state.clone()), Path((id.clone(), 3)), None).await.unwrap();
    assert_eq!(switched.data.unwrap().current_version, 3);
    let selected = update_automation_definition(&state, &id, update_request(json!({}))).await.unwrap();
    assert_eq!(selected.current_version, 3);
    assert_eq!(selected.status, "enabled");
    assert_eq!(selected.nodes_json[0]["position"]["x"], json!(3.0));
    assert_eq!(AutomationFlowVersionEntity::find().count(&state.db).await.unwrap(), 5);
    let v6 = update_automation_definition(&state, &id, update_request(json!({"name":"Edited v3"}))).await.unwrap();
    assert_eq!(v6.current_version, 6);

    // Identical concurrent saves serialize on the definition row, creating only one version.
    let (a, b) = tokio::join!(
        update_automation_definition(&state, &id, update_request(json!({"name":"Concurrent"}))),
        update_automation_definition(&state, &id, update_request(json!({"name":"Concurrent"}))),
    );
    assert_eq!(a.unwrap().current_version, 7);
    assert_eq!(b.unwrap().current_version, 7);
    assert_eq!(AutomationFlowVersionEntity::find().count(&state.db).await.unwrap(), 7);
}
