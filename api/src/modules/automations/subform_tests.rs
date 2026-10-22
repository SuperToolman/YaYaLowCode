use super::*;
use crate::infrastructure::entities::{
    form_definition_entity as form, form_storage_definition_entity as storage,
};
use sea_orm::{ConnectOptions, Database, DbBackend, Schema, Statement};

#[tokio::test]
#[ignore = "isolated schema; requires WORKFLOW_TEST_DATABASE_SETTINGS_PATH"]
async fn subform_append_updates_physical_rows_and_preserves_parallel_appends() {
    let raw: Value = serde_json::from_slice(
        &std::fs::read(std::env::var("WORKFLOW_TEST_DATABASE_SETTINGS_PATH").unwrap()).unwrap(),
    )
    .unwrap();
    let settings: crate::platform::config::DatabaseSettings =
        serde_json::from_value(raw["database"].clone()).unwrap();
    let admin = Database::connect(settings.to_database_url()).await.unwrap();
    let name = format!("subform_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(settings.to_database_url());
    options
        .set_schema_search_path(&name)
        .sqlx_logging(false)
        .max_connections(4);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify(db: DatabaseConnection) {
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(form::Entity),
        schema.create_table_from_entity(storage::Entity),
        schema.create_table_from_entity(app_entity::Entity),
        schema
            .create_table_from_entity(crate::infrastructure::entities::form_schema_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let now = Utc::now();
    let definition = form::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set("test".into()),
        form_uuid: Set("parent".into()),
        name: Set("parent".into()),
        slug: Set("parent".into()),
        form_type: Set("normal".into()),
        current_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let schema_json = json!({"fields":[{"id":"items","type":"subform"},{"id":"name","type":"singleLineText","parentGroupId":"items"}]});
    crate::infrastructure::entities::form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set("parent".into()),
        version: Set(1),
        schema_json: Set(schema_json.clone()),
        change_log: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let nodes = json!([
        {"id":"source","data":{"kind":"trigger"}},
        {"id":"query","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"source"}}},
        {"id":"add","data":{"kind":"add-data","config":{"targetMode":"subtable","parentDataNodeId":"query","subformFieldId":"items","rows":[{"fieldId":"name"}]}}}
    ]);
    let edges = json!([{"source":"source","target":"query"},{"source":"query","target":"add"}]);
    assert_eq!(
        get_data::source_form(&nodes, &edges, "query", Some("parent")).unwrap(),
        "parent"
    );
    get_data::validate_get_nodes(&db, &nodes, &edges, Some("parent"))
        .await
        .unwrap();
    assert!(
        get_data::validate_get_nodes(&db, &nodes, &json!([]), Some("parent"))
            .await
            .is_err()
    );
    let mut invalid_nodes = nodes.clone();
    invalid_nodes[2]["data"]["config"]["subformFieldId"] = json!("deleted");
    assert!(
        get_data::validate_get_nodes(&db, &invalid_nodes, &edges, Some("parent"))
            .await
            .is_err()
    );
    invalid_nodes[2]["data"]["config"]["subformFieldId"] = json!("items");
    invalid_nodes[2]["data"]["config"]["rows"] = json!([{"fieldId":"items"}]);
    assert!(
        get_data::validate_get_nodes(&db, &invalid_nodes, &edges, Some("parent"))
            .await
            .is_err()
    );
    let plan =
        crate::platform::form_storage::sync_current_storage_plan(&db, "parent", 1, &schema_json)
            .await
            .unwrap();
    let record = RecordRepository::new(&db)
        .insert(
            &definition,
            json!({"items":[{"name":"original"}]}),
            "test",
            now,
        )
        .await
        .unwrap();
    let context = AutomationExecutionContext {
        outputs: HashMap::from([(
            "source".into(),
            json!({"__automationRecordUuid": record.record_uuid}),
        )]),
        operator: "test".into(),
        run_id: None,
    };
    let config = json!({"subformFieldId":"items","parentDataNodeId":"source","rows":[{"fieldId":"name","valueType":"value","rawValue":"new"}]});
    let flow = automation_flow_entity::Model {
        id: Uuid::new_v4(),
        flow_uuid: "test-subform".into(),
        app_route_app_id: "test".into(),
        name: "test".into(),
        description: None,
        status: "enabled".into(),
        current_version: 1,
        flow_type: "trigger".into(),
        trigger_form_uuid: Some("parent".into()),
        trigger_config: json!({}),
        nodes_json: nodes.clone(),
        edges_json: edges.clone(),
        created_by: "test".into(),
        updated_by: "test".into(),
        created_at: now,
        updated_at: now,
    };
    let mut shared_config = config.clone();
    shared_config["targetMode"] = json!("subtable");
    shared_config["targetFormUuid"] = json!("ignored-stale-cache");
    let (a, b) = tokio::join!(
        execute_add_data_node(&db, &flow, &shared_config, &context),
        execute_add_data_node(&db, &flow, &shared_config, &context)
    );
    a.unwrap();
    b.unwrap();
    let updated = RecordRepository::new(&db)
        .find("parent", &record.record_uuid)
        .await
        .unwrap();
    assert_eq!(updated.record_data["items"].as_array().unwrap().len(), 3);
    assert_eq!(updated.record_data["items"][0]["name"], "original");
    let table = plan
        .fields
        .iter()
        .find(|field| field.field_id == "name")
        .unwrap()
        .child_table
        .as_ref()
        .unwrap();
    let count = db
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT COUNT(*) AS count FROM \"{table}\""),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(count, 3);
    let second = RecordRepository::new(&db)
        .insert(&definition, json!({"items":[]}), "test", now)
        .await
        .unwrap();
    let context_many = AutomationExecutionContext {
        outputs: HashMap::from([(
            "source".into(),
            json!([
                {"__automationRecordUuid":record.record_uuid,"label":"first"},
                {"__automationRecordUuid":second.record_uuid,"label":"second"}
            ]),
        )]),
        ..context.clone()
    };
    let mut scoped_config = config.clone();
    scoped_config["rows"] =
        json!([{"fieldId":"name","valueType":"field","sourceFieldKey":"source:label"}]);
    let output = execute_add_subform_data(&db, &scoped_config, &context_many, "parent")
        .await
        .unwrap();
    assert_eq!(output.as_array().unwrap().len(), 2);
    assert_eq!(
        RecordRepository::new(&db)
            .find("parent", &record.record_uuid)
            .await
            .unwrap()
            .record_data["items"][3]["name"],
        "first"
    );
    assert_eq!(
        RecordRepository::new(&db)
            .find("parent", &second.record_uuid)
            .await
            .unwrap()
            .record_data["items"][0]["name"],
        "second"
    );
    let mut missing = context.clone();
    missing.outputs.clear();
    assert_eq!(
        execute_add_subform_data(&db, &config, &missing, "parent")
            .await
            .unwrap(),
        json!([])
    );
    let mut multiple_config = config.clone();
    multiple_config["recordMode"] = json!("multiple");
    multiple_config["multipleSourceNodeId"] = json!("items");
    multiple_config["rows"] =
        json!([{"fieldId":"name","valueType":"field","sourceFieldKey":"items:name"}]);
    let mut with_items = context.clone();
    with_items
        .outputs
        .insert("items".into(), json!([{"name":"one"},{"name":"two"}]));
    assert_eq!(
        execute_add_subform_data(&db, &multiple_config, &with_items, "parent")
            .await
            .unwrap(),
        json!([{"name":"one"},{"name":"two"}])
    );
    assert!(
        execute_add_subform_data(&db, &config, &context, "other-parent")
            .await
            .is_err()
    );
    let invalid = AutomationExecutionContext {
        outputs: HashMap::from([("source".into(), json!([{"name":"missing-id"}]))]),
        ..context
    };
    assert!(
        execute_add_subform_data(&db, &config, &invalid, "parent")
            .await
            .is_err()
    );
}
