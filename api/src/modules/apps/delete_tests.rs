use super::*;
use crate::infrastructure::entities::{form_storage_definition_entity, form_view_entity};
use crate::platform::form_storage::sync_current_storage_plan;
use crate::platform::records::RecordRepository;
use sea_orm::{ConnectOptions, Database, DbBackend, Schema, Statement};

#[tokio::test]
#[ignore = "requires AUTOMATION_TEST_DATABASE_URL; creates and removes an isolated schema"]
async fn delete_application_cleans_owned_graph_and_rolls_back_on_failure() {
    let url = std::env::var("AUTOMATION_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("app_delete_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema_name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&schema_name)
        .sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify_application_deletion(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn count(db: &DatabaseConnection, table: &str) -> i64 {
    db.query_one_raw(Statement::from_string(
        DbBackend::Postgres,
        format!("SELECT COUNT(*) AS count FROM {table}"),
    ))
    .await
    .unwrap()
    .unwrap()
    .try_get("", "count")
    .unwrap()
}

async fn verify_application_deletion(db: DatabaseConnection) {
    let schema = Schema::new(DbBackend::Postgres);
    for statement in [
        schema.create_table_from_entity(AppEntity),
        schema.create_table_from_entity(FormDefinitionEntity),
        schema.create_table_from_entity(FormSchemaEntity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
        schema.create_table_from_entity(form_view_entity::Entity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationRunEntity),
        schema.create_table_from_entity(AutomationRunNodeEntity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    // Real restrictive/cascading edges, including engine snapshots, tokens, and task links.
    db.execute_unprepared(r#"
        CREATE TABLE workflow_instances (id UUID PRIMARY KEY, form_uuid TEXT NOT NULL,
            process_flow_id UUID NOT NULL REFERENCES automation_flows(id) ON DELETE RESTRICT);
        ALTER TABLE automation_flow_runs ADD FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id);
        ALTER TABLE automation_flow_runs ADD FOREIGN KEY (flow_id) REFERENCES automation_flows(id);
        ALTER TABLE automation_flow_run_nodes ADD FOREIGN KEY (run_id) REFERENCES automation_flow_runs(id);
        CREATE TABLE automation_execution_runs (run_id UUID REFERENCES automation_flow_runs(id) ON DELETE CASCADE);
        CREATE TABLE automation_execution_audits (run_id UUID REFERENCES automation_flow_runs(id) ON DELETE CASCADE);
        CREATE TABLE automation_execution_tokens (id UUID PRIMARY KEY, run_id UUID REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
            instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
            parent_token_id UUID REFERENCES automation_execution_tokens(id));
        CREATE TABLE workflow_tasks (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
            branch_token_id UUID REFERENCES automation_execution_tokens(id) ON DELETE SET NULL);
        CREATE TABLE workflow_actions (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_branch_tokens (instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_notifications (id UUID PRIMARY KEY, instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE);
        CREATE TABLE workflow_notification_dispatch (notification_id UUID REFERENCES workflow_notifications(id) ON DELETE CASCADE);
        CREATE TABLE workflow_comments (form_uuid TEXT NOT NULL);
        CREATE TABLE form_recycle_bin_entries (form_uuid TEXT, detail_source_form_uuid TEXT);
        CREATE TABLE form_detail_definitions (detail_form_uuid TEXT, source_form_uuid TEXT);
        CREATE TABLE app_custom_buttons (app_route_app_id TEXT REFERENCES apps(route_app_id) ON DELETE CASCADE);
        CREATE TABLE app_navigation_items (app_route_app_id TEXT);
        CREATE TABLE iam_role_permissions (permission TEXT);
        CREATE TABLE agent_sessions (app_route_app_id TEXT);
        CREATE TABLE automation_flow_versions (flow_id UUID REFERENCES automation_flows(id));
        CREATE TABLE automation_nodes (flow_id UUID REFERENCES automation_flows(id));
        CREATE TABLE automation_edges (flow_id UUID REFERENCES automation_flows(id));
        CREATE TABLE market_installations (installation_id UUID PRIMARY KEY, local_app_id TEXT);
        CREATE TABLE market_installation_resources (installation_id UUID);
        CREATE TABLE market_installation_versions (installation_id UUID);
        CREATE TABLE market_installation_events (installation_id UUID);
    "#).await.unwrap();

    let mut storage_tables = Vec::new();
    for app_id in ["app_delete", "appXdelete"] {
        db.execute_unprepared(&format!(r#"
            INSERT INTO apps (id,route_app_id,name,description,icon,color,deployment_type,owner_name,records_count,created_at,updated_at)
                VALUES (gen_random_uuid(),'{app_id}','Test','','','','local','test',0,NOW(),NOW());
            INSERT INTO form_definitions (id,app_route_app_id,form_uuid,name,slug,form_type,current_schema_version,latest_schema_version,created_at,updated_at)
                SELECT gen_random_uuid(),'{app_id}','{app_id}_' || kind,kind,kind,kind,1,1,NOW(),NOW()
                FROM unnest(ARRAY['basic','workflow','detail','empty']) kind;
            INSERT INTO form_schemas (id,form_uuid,version,schema_json,created_at,updated_at)
                SELECT gen_random_uuid(),form_uuid,1,'{{}}',NOW(),NOW() FROM form_definitions WHERE app_route_app_id='{app_id}';
            INSERT INTO form_views (id,form_uuid,view_uuid,name,config_json,created_at,updated_at)
                SELECT gen_random_uuid(),form_uuid,'default','View','{{}}',NOW(),NOW() FROM form_definitions WHERE app_route_app_id='{app_id}';
            INSERT INTO form_detail_definitions VALUES ('{app_id}_detail','{app_id}_basic');
            INSERT INTO form_recycle_bin_entries VALUES ('{app_id}_detail','{app_id}_basic');
            INSERT INTO workflow_comments VALUES ('{app_id}_workflow');
            INSERT INTO app_custom_buttons VALUES ('{app_id}'),('{app_id}');
            INSERT INTO app_navigation_items VALUES ('{app_id}');
            INSERT INTO agent_sessions VALUES ('{app_id}');
            INSERT INTO iam_role_permissions VALUES ('app:{app_id}:display'),('form:{app_id}_basic:display');
            INSERT INTO market_installations VALUES (gen_random_uuid(),'{app_id}');
            INSERT INTO market_installation_resources SELECT installation_id FROM market_installations WHERE local_app_id='{app_id}';
            INSERT INTO market_installation_versions SELECT installation_id FROM market_installations WHERE local_app_id='{app_id}';
            INSERT INTO market_installation_events SELECT installation_id FROM market_installations WHERE local_app_id='{app_id}';
            INSERT INTO automation_flows (id,flow_uuid,app_route_app_id,name,status,current_version,flow_type,trigger_form_uuid,trigger_config,nodes_json,edges_json,created_by,updated_by,created_at,updated_at)
                SELECT gen_random_uuid(),'{app_id}_' || kind,'{app_id}',kind,'enabled',1,kind,
                    CASE WHEN kind='process' THEN '{app_id}_workflow' WHEN kind='trigger' THEN '{app_id}_basic' ELSE NULL END,
                    '{{}}','[]','[]','test','test',NOW(),NOW() FROM unnest(ARRAY['process','trigger','unbound']) kind;
            INSERT INTO workflow_instances SELECT gen_random_uuid(),'{app_id}_workflow',id FROM automation_flows WHERE app_route_app_id='{app_id}' AND flow_type='process';
            INSERT INTO automation_flow_versions SELECT id FROM automation_flows WHERE app_route_app_id='{app_id}';
            INSERT INTO automation_nodes SELECT id FROM automation_flows WHERE app_route_app_id='{app_id}';
            INSERT INTO automation_edges SELECT id FROM automation_flows WHERE app_route_app_id='{app_id}';
            INSERT INTO automation_flow_runs (id,run_uuid,flow_id,workflow_instance_id,flow_version,trigger_event,trigger_payload,status,started_at,created_at,updated_at)
                SELECT gen_random_uuid(),gen_random_uuid()::text,f.id,i.id,1,'button_click','{{}}',s,NOW(),NOW(),NOW()
                FROM automation_flows f LEFT JOIN workflow_instances i ON i.process_flow_id=f.id CROSS JOIN unnest(ARRAY['running','success']) s
                WHERE f.app_route_app_id='{app_id}';
            INSERT INTO automation_flow_run_nodes (id,run_id,attempt,node_key,node_kind,node_label,status,input_json,started_at,created_at,updated_at)
                SELECT gen_random_uuid(),r.id,1,'node','trigger','Trigger',r.status,'{{}}',NOW(),NOW(),NOW()
                FROM automation_flow_runs r JOIN automation_flows f ON f.id=r.flow_id WHERE f.app_route_app_id='{app_id}';
            INSERT INTO automation_execution_runs SELECT r.id FROM automation_flow_runs r JOIN automation_flows f ON f.id=r.flow_id WHERE f.app_route_app_id='{app_id}';
            INSERT INTO automation_execution_audits SELECT run_id FROM automation_execution_runs WHERE run_id IN (SELECT r.id FROM automation_flow_runs r JOIN automation_flows f ON f.id=r.flow_id WHERE f.app_route_app_id='{app_id}');
            INSERT INTO automation_execution_tokens SELECT gen_random_uuid(),r.id,r.workflow_instance_id,NULL FROM automation_flow_runs r JOIN automation_flows f ON f.id=r.flow_id WHERE f.app_route_app_id='{app_id}';
            INSERT INTO automation_execution_tokens SELECT gen_random_uuid(),t.run_id,t.instance_id,t.id FROM automation_execution_tokens t JOIN automation_flow_runs r ON r.id=t.run_id JOIN automation_flows f ON f.id=r.flow_id WHERE f.app_route_app_id='{app_id}' AND t.parent_token_id IS NULL;
            INSERT INTO workflow_tasks SELECT id,NULL FROM workflow_instances WHERE form_uuid='{app_id}_workflow';
            INSERT INTO workflow_actions SELECT id FROM workflow_instances WHERE form_uuid='{app_id}_workflow';
            INSERT INTO workflow_branch_tokens SELECT id FROM workflow_instances WHERE form_uuid='{app_id}_workflow';
            INSERT INTO workflow_notifications SELECT gen_random_uuid(),id FROM workflow_instances WHERE form_uuid='{app_id}_workflow';
            INSERT INTO workflow_notification_dispatch SELECT n.id FROM workflow_notifications n JOIN workflow_instances i ON i.id=n.instance_id WHERE i.form_uuid='{app_id}_workflow';
        "#)).await.unwrap();
        let form_uuid = format!("{app_id}_basic");
        let structure = json!({"fields":[{"id":"name","type":"input","label":"Name"}, {"id":"items","type":"subform","label":"Items"}, {"id":"item","type":"input","label":"Item","parentGroupId":"items"}]});
        sync_current_storage_plan(&db, &form_uuid, 1, &structure)
            .await
            .unwrap();
        let form = FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&form_uuid))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        RecordRepository::new(&db)
            .insert(
                &form,
                json!({"name":"keep","items":[{"item":"child"}]}),
                "test",
                Utc::now(),
            )
            .await
            .unwrap();
        let storage = form_storage_definition_entity::Entity::find()
            .filter(form_storage_definition_entity::Column::FormUuid.eq(&form_uuid))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        storage_tables.push(storage.physical_table);
    }
    // A late failure must restore metadata, runs and even dropped physical tables.
    db.execute_unprepared("CREATE FUNCTION reject_app_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected deletion failure'; END $$; CREATE TRIGGER reject_app_delete BEFORE DELETE ON apps FOR EACH ROW EXECUTE FUNCTION reject_app_delete();").await.unwrap();
    let txn = db.begin().await.unwrap();
    assert!(
        deletion::delete_app_contents(&txn, "app_delete")
            .await
            .is_err()
    );
    txn.rollback().await.unwrap();
    assert_eq!(count(&db, "apps").await, 2);
    assert_eq!(count(&db, "automation_flow_runs").await, 12);
    assert_eq!(count(&db, &storage_tables[0]).await, 1);
    db.execute_unprepared("DROP TRIGGER reject_app_delete ON apps")
        .await
        .unwrap();
    let txn = db.begin().await.unwrap();
    deletion::delete_app_contents(&txn, "app_delete")
        .await
        .unwrap();
    txn.commit().await.unwrap();
    for (table, expected) in [
        ("apps", 1),
        ("form_definitions", 4),
        ("form_schemas", 4),
        ("form_views", 4),
        ("form_storage_definitions", 1),
        ("form_detail_definitions", 1),
        ("form_recycle_bin_entries", 1),
        ("app_custom_buttons", 2),
        ("app_navigation_items", 1),
        ("iam_role_permissions", 2),
        ("automation_flows", 3),
        ("automation_flow_versions", 3),
        ("automation_nodes", 3),
        ("automation_edges", 3),
        ("automation_flow_runs", 6),
        ("automation_flow_run_nodes", 6),
        ("automation_execution_runs", 6),
        ("automation_execution_audits", 6),
        ("automation_execution_tokens", 12),
        ("workflow_instances", 1),
        ("workflow_tasks", 1),
        ("workflow_actions", 1),
        ("workflow_branch_tokens", 1),
        ("workflow_notifications", 1),
        ("workflow_notification_dispatch", 1),
        ("workflow_comments", 1),
        ("market_installations", 1),
        ("market_installation_resources", 1),
        ("market_installation_versions", 1),
        ("market_installation_events", 1),
        ("agent_sessions", 2),
    ] {
        assert_eq!(
            count(&db, table).await,
            expected,
            "unexpected rows in {table}"
        );
    }
    assert_eq!(count(&db, &storage_tables[1]).await, 1);
    assert_eq!(
        RecordRepository::new(&db)
            .list("appXdelete_basic")
            .await
            .unwrap()[0]
            .record_data["name"],
        "keep"
    );
    let dropped = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT to_regclass($1)::text AS name",
            vec![storage_tables[0].clone().into()],
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(
        dropped
            .try_get::<Option<String>>("", "name")
            .unwrap()
            .is_none()
    );
}
