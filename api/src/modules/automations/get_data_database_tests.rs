use super::*;
use sea_orm::{ConnectOptions, Database, Schema};

#[tokio::test]
#[ignore = "requires AUTOMATION_TEST_DATABASE_URL; uses and removes an isolated schema"]
async fn get_data_save_reload_and_execute_database() {
    let url = std::env::var("AUTOMATION_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("get_data_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema_name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&schema_name)
        .sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(AppEntity),
        schema.create_table_from_entity(FormDefinitionEntity),
        schema.create_table_from_entity(FormSchemaEntity),
        schema.create_table_from_entity(
            crate::infrastructure::entities::form_storage_definition_entity::Entity,
        ),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationNodeEntity),
        schema.create_table_from_entity(AutomationEdgeEntity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let result = tokio::spawn(async move { verify_query_database(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify_query_database(db: DatabaseConnection) {
    let now = Utc::now();
    app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set("query-test".into()),
        name: Set("Query test".into()),
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
    let form = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set("query-test".into()),
        form_uuid: Set("FORM-QUERY-TEST".into()),
        name: Set("Query form".into()),
        slug: Set("query".into()),
        form_type: Set("normal".into()),
        current_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let structure = json!({"fields":[{"id":"status","type":"input","label":"状态"},{"id":"tenant","type":"input","label":"租户"}]});
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(form.form_uuid.clone()),
        version: Set(1),
        schema_json: Set(structure.clone()),
        change_log: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    crate::platform::form_storage::sync_current_storage_plan(&db, &form.form_uuid, 1, &structure)
        .await
        .unwrap();
    let repo = RecordRepository::new(&db);
    repo.insert(
        &form,
        json!({"status":"inactive","tenant":"a"}),
        "test",
        now,
    )
    .await
    .unwrap();
    let matched = repo
        .insert(
            &form,
            json!({"status":"active","tenant":"a"}),
            "test",
            now + chrono::Duration::seconds(1),
        )
        .await
        .unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let flow = create_automation_definition(
        &state,
        "query-test",
        Some(
            serde_json::from_value(
                json!({"triggerFormUuid":form.form_uuid,"triggerEvents":["after_create"]}),
            )
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    let rule = json!({"id":"active","fieldKey":"status","operator":"eq","rawValue":"active","valueType":"value"});
    let nodes = json!([
        {"id":"trigger-1","data":{"kind":"trigger"}},
        {"id":"many","data":{"kind":"get-many","config":{"sourceMode":"form","formUuid":form.form_uuid,"filterMode":"rules","rules":[rule]}}},
        {"id":"one","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"many","filterMode":"all"}}}
    ]);
    let edges = json!([{"id":"a","source":"trigger-1","target":"many"},{"id":"b","source":"many","target":"one"}]);
    let saved = update_automation_definition(
        &state,
        &flow.flow_uuid,
        serde_json::from_value(json!({"nodes":nodes,"edges":edges})).unwrap(),
    )
    .await
    .unwrap();
    let loaded = AutomationFlowEntity::find_by_id(saved.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loaded.nodes_json, saved.nodes_json);
    assert_eq!(loaded.nodes_json[2]["data"]["config"]["dataNodeId"], "many");
    validate_execution_sources(&db, &loaded).await.unwrap();
    let mut context = AutomationExecutionContext {
        outputs: HashMap::from([("trigger-1".into(), json!({}))]),
        operator: "test".into(),
        run_id: None,
    };
    execute_memory_graph(&db, &loaded, "trigger-1", &mut context)
        .await
        .unwrap();
    assert_eq!(context.outputs["many"].as_array().unwrap().len(), 1);
    assert_eq!(
        context.outputs["one"]["__automationRecordUuid"],
        matched.record_uuid
    );
    let config = json!({"sourceMode":"form","formUuid":form.form_uuid,"filterMode":"all"});
    assert_eq!(
        execute_get_many_node(&db, &config, &context)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        execute_get_one_node(&db, &config, &context).await.unwrap()["__automationRecordUuid"],
        matched.record_uuid
    );
    let missing = json!({"sourceMode":"form","formUuid":form.form_uuid,"filterMode":"rules","rules":[{"id":"missing","fieldKey":"status","operator":"eq","rawValue":"missing"}]});
    assert_eq!(
        execute_get_one_node(&db, &missing, &context).await.unwrap(),
        Value::Null
    );
    assert_eq!(
        execute_get_many_node(&db, &missing, &context)
            .await
            .unwrap(),
        json!([])
    );
    let mut invalid = nodes.clone();
    invalid[1]["data"]["config"]["rules"][0]["fieldKey"] = json!("removed");
    assert!(
        update_automation_definition(
            &state,
            &flow.flow_uuid,
            serde_json::from_value(json!({"nodes":invalid})).unwrap()
        )
        .await
        .is_err()
    );
    let mut stale = loaded.clone();
    stale.nodes_json = invalid;
    assert!(validate_execution_sources(&db, &stale).await.is_err());
    assert_eq!(repo.list(&form.form_uuid).await.unwrap().len(), 2);
}
