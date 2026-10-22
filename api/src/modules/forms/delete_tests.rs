use super::*;
use sea_orm::{ConnectOptions, Database, DbBackend, Schema, Statement};

#[tokio::test]
#[ignore = "requires AUTOMATION_TEST_DATABASE_URL; uses and removes an isolated schema"]
async fn delete_workflow_form_cleans_runtime_and_preserves_other_forms() {
    let url = std::env::var("AUTOMATION_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("form_delete_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema_name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&schema_name)
        .sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify_form_deletion(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify_form_deletion(db: DatabaseConnection) {
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(AppEntity),
        schema.create_table_from_entity(FormDefinitionEntity),
        schema.create_table_from_entity(FormSchemaEntity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
        schema.create_table_from_entity(form_detail_definition_entity::Entity),
        schema.create_table_from_entity(form_view_entity::Entity),
        schema.create_table_from_entity(AppNavigationEntity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationNodeEntity),
        schema.create_table_from_entity(AutomationEdgeEntity),
        schema.create_table_from_entity(AutomationRunEntity),
        schema.create_table_from_entity(AutomationRunNodeEntity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    // Reproduce the production constraints, including the unified engine's run -> instance FK.
    db.execute_unprepared(r#"
        CREATE TABLE workflow_instances (
            id UUID PRIMARY KEY, form_uuid TEXT NOT NULL,
            process_flow_id UUID NOT NULL REFERENCES automation_flows(id) ON DELETE RESTRICT,
            status TEXT NOT NULL
        );
        ALTER TABLE automation_flow_runs ADD FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id);
        ALTER TABLE automation_flow_runs ADD FOREIGN KEY (flow_id) REFERENCES automation_flows(id);
        ALTER TABLE automation_flow_run_nodes ADD FOREIGN KEY (run_id) REFERENCES automation_flow_runs(id);
        CREATE TABLE workflow_tasks (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_actions (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_branch_tokens (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_comments (form_uuid TEXT NOT NULL);
        CREATE TABLE form_recycle_bin_entries (form_uuid TEXT, detail_source_form_uuid TEXT);
    "#).await.unwrap();
    let now = Utc::now();
    app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set("delete-test".into()),
        name: Set("Delete test".into()),
        description: Set(String::new()),
        icon: Set(String::new()),
        badge: Set(None),
        color: Set(String::new()),
        creator_user_id: Set(None),
        deployment_type: Set("local".into()),
        online_version: Set(None),
        online_release_id: Set(None),
        owner_name: Set("test".into()),
        records_count: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let repository = RecordRepository::new(&db);
    for form_uuid in ["FORM-DELETE-TEST", "FORM-KEEP-TEST", "FORM-EMPTY-TEST"] {
        let form = form_definition_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            app_route_app_id: Set("delete-test".into()),
            form_uuid: Set(form_uuid.into()),
            name: Set(form_uuid.into()),
            slug: Set(form_uuid.into()),
            form_type: Set("workflow".into()),
            current_schema_version: Set(1),
            latest_schema_version: Set(1),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db)
        .await
        .unwrap();
        let structure = json!({"fields":[{"id":"name","type":"input","label":"Name"}]});
        form_schema_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            form_uuid: Set(form_uuid.into()),
            version: Set(1),
            schema_json: Set(structure.clone()),
            change_log: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db)
        .await
        .unwrap();
        sync_current_storage_plan(&db, form_uuid, 1, &structure)
            .await
            .unwrap();
        let flow =
            automations::ensure_process_flow_for_form(&db, "delete-test", form_uuid, form_uuid)
                .await
                .unwrap();
        if form_uuid == "FORM-EMPTY-TEST" {
            continue;
        }
        repository
            .insert(&form, json!({"name":"test"}), "test", now)
            .await
            .unwrap();
        for status in ["running", "completed"] {
            let instance_id = Uuid::new_v4();
            let run_id = Uuid::new_v4();
            db.execute_unprepared(&format!(r#"
                INSERT INTO workflow_instances VALUES ('{instance_id}', '{form_uuid}', '{}', '{status}');
                INSERT INTO automation_flow_runs
                    (id, run_uuid, flow_id, workflow_instance_id, flow_version, trigger_event, trigger_payload, status, started_at, created_at, updated_at)
                    VALUES ('{run_id}', '{run_id}', '{}', '{instance_id}', 1, 'form_submit', '{{}}', '{status}', NOW(), NOW(), NOW());
                INSERT INTO automation_flow_run_nodes
                    (id, run_id, attempt, node_key, node_kind, node_label, status, input_json, started_at, created_at, updated_at)
                    VALUES ('{}', '{run_id}', 1, 'approval-1', 'approval', 'Approval', '{status}', '{{}}', NOW(), NOW(), NOW());
                INSERT INTO workflow_tasks VALUES ('{instance_id}');
                INSERT INTO workflow_actions VALUES ('{instance_id}');
                INSERT INTO workflow_branch_tokens VALUES ('{instance_id}');
                INSERT INTO workflow_comments VALUES ('{form_uuid}');
                INSERT INTO form_recycle_bin_entries VALUES ('{form_uuid}', NULL);
            "#, flow.id, flow.id, Uuid::new_v4())).await.unwrap();
        }
    }
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    delete_form_definition(&state, "FORM-DELETE-TEST")
        .await
        .unwrap();
    delete_form_definition(&state, "FORM-EMPTY-TEST")
        .await
        .unwrap();
    assert!(
        FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::FormUuid.eq("FORM-DELETE-TEST"))
            .one(&db)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        form_storage_definition_entity::Entity::find()
            .filter(form_storage_definition_entity::Column::FormUuid.eq("FORM-DELETE-TEST"))
            .one(&db)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(repository.list("FORM-KEEP-TEST").await.unwrap().len(), 1);
    for (table, expected) in [
        ("form_definitions", 1),
        ("form_schemas", 1),
        ("automation_flows", 1),
        ("automation_flow_runs", 2),
        ("automation_flow_run_nodes", 2),
        ("workflow_instances", 2),
        ("workflow_tasks", 2),
        ("workflow_actions", 2),
        ("workflow_branch_tokens", 2),
        ("workflow_comments", 2),
        ("form_recycle_bin_entries", 2),
    ] {
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                format!("SELECT COUNT(*) AS count FROM {table}"),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<i64>("", "count").unwrap(),
            expected,
            "unexpected remaining rows in {table}"
        );
    }
}
