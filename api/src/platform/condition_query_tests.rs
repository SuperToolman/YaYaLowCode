use super::*;
use crate::infrastructure::entities::{app_entity, form_storage_definition_entity};
use crate::modules::forms::QueryFormRecordsRequest;
use crate::platform::records::{QueryFieldKind, RecordRepository};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectOptions, Database, DatabaseConnection, Schema,
};
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires CONDITION_TEST_DATABASE_SETTINGS_PATH; isolated schema"]
async fn multi_hop_sql_and_run_overlay() {
    let bytes =
        std::fs::read(std::env::var("CONDITION_TEST_DATABASE_SETTINGS_PATH").unwrap()).unwrap();
    let raw: Value = serde_json::from_slice(&bytes).unwrap();
    let settings: crate::platform::config::DatabaseSettings =
        serde_json::from_value(raw.get("database").unwrap_or(&raw).clone()).unwrap();
    let url = settings.to_database_url();
    let admin = Database::connect(url.clone()).await.unwrap();
    let namespace = format!("condition_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {namespace}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&namespace)
        .sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {namespace} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}
async fn create_form(
    db: &DatabaseConnection,
    name: &str,
    fields: Value,
) -> form_definition_entity::Model {
    let now = Utc::now();
    let form = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set("test".into()),
        form_uuid: Set(name.into()),
        name: Set(name.into()),
        slug: Set(name.into()),
        form_type: Set("normal".into()),
        current_schema_version: Set(1),
        latest_schema_version: Set(1),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    let schema = json!({"fields":fields});
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set(name.into()),
        version: Set(1),
        schema_json: Set(schema.clone()),
        change_log: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    form_storage::sync_current_storage_plan(db, name, 1, &schema)
        .await
        .unwrap();
    form
}
async fn verify(db: DatabaseConnection) {
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(app_entity::Entity),
        schema.create_table_from_entity(form_definition_entity::Entity),
        schema.create_table_from_entity(form_schema_entity::Entity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let now = Utc::now();
    app_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        route_app_id: Set("test".into()),
        name: Set("test".into()),
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
    let c = create_form(&db,"C",json!([{"id":"contact","type":"singleLineText"},{"id":"amount","type":"number"},{"id":"tags","type":"multiSelect"},{"id":"when","type":"date","props":{"granularity":"minute"}},{"id":"enabled","type":"switch"}])).await;
    let b = create_form(
        &db,
        "B",
        json!([{"id":"group","type":"associationFormField","props":{"associationFormId":"C"}}]),
    )
    .await;
    let a = create_form(&db,"A",json!([{"id":"company","type":"associationFormField","props":{"associationFormId":"B"}},{"id":"threshold","type":"number"},{"id":"note","type":"singleLineText"}])).await;
    let repo = RecordRepository::new(&db);
    let c1 = repo.insert(&c,json!({"contact":"小明","amount":10,"tags":["a","b"],"when":"2026-11-16T08:00:00+08:00","enabled":false}),"test",now).await.unwrap();
    let c2 = repo.insert(&c,json!({"contact":"小红","amount":2,"tags":["b"],"when":"2026-11-17T00:00:00Z","enabled":true}),"test",now).await.unwrap();
    let b1 = repo
        .insert(&b, json!({"group":c1.record_uuid}), "test", now)
        .await
        .unwrap();
    let b2 = repo
        .insert(&b, json!({"group":c2.record_uuid}), "test", now)
        .await
        .unwrap();
    let a1 = repo
        .insert(
            &a,
            json!({"company":b1.record_uuid,"threshold":5}),
            "test",
            now,
        )
        .await
        .unwrap();
    repo.insert(
        &a,
        json!({"company":b2.record_uuid,"threshold":5}),
        "test",
        now,
    )
    .await
    .unwrap();
    repo.insert(&a, json!({}), "test", now).await.unwrap();
    let path = |field: &str| {
        format!(
            "{}{}",
            conditions::PATH_PREFIX,
            json!({"root":"company","path":["group",field]})
        )
    };
    for (field, op, value, count) in [
        ("contact", "eq", json!("小明"), 1),
        ("contact", "neq", json!("小明"), 2),
        ("contact", "contains", json!("小"), 2),
        ("contact", "notContains", json!("小"), 1),
        ("contact", "noValue", Value::Null, 1),
        ("contact", "hasValue", Value::Null, 2),
        ("when", "eq", json!("2026-11-16T00:00:00Z"), 1),
        ("enabled", "eq", json!(false), 1),
        ("amount", "gt", json!(2), 1),
        ("amount", "between", json!([2, 10]), 2),
        ("tags", "containsAny", json!(["a"]), 1),
        ("tags", "containsAll", json!(["a", "b"]), 1),
        ("tags", "containsNone", json!(["a"]), 2),
        ("contact", "inAny", json!(["小明", "小红"]), 2),
    ] {
        let rules = vec![
            json!({"id":"r","fieldKey":path(field),"operator":op,"rawValue":format!("{}{}",conditions::VALUE_PREFIX,value)}),
        ];
        let request: QueryFormRecordsRequest =
            serde_json::from_value(json!({"conditionRules":rules,"sorts":[],"filters":[]}))
                .unwrap();
        let (rows, total) = repo
            .query_page(
                "A",
                &request,
                &HashMap::<String, QueryFieldKind>::new(),
                1,
                1,
            )
            .await
            .unwrap();
        assert_eq!(total, count, "{field} {op}");
        assert_eq!(rows.len(), 1.min(count as usize));
        let mut values: Vec<_> = repo
            .list("A")
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.record_data)
            .collect();
        hydrate(&db, &repo, "A", &[path(field)], &mut values)
            .await
            .unwrap();
        assert_eq!(
            values
                .iter()
                .filter(|data| conditions::evaluate(&rules, None, data))
                .count(),
            total as usize,
            "SQL vs memory: {field} {op}"
        );
    }
    // Compare a related number with a root number, and preserve nested AND/OR grouping.
    let left = json!({"id":"r","fieldKey":path("amount"),"operator":"gt","valueType":"field","sourceFieldKey":"threshold"});
    let nested = vec![json!({"id":"g","isGroup":true}), {
        let mut r = left.clone();
        r["parentId"] = json!("g");
        r
    }];
    for rules in [vec![left], nested] {
        let request: QueryFormRecordsRequest =
            serde_json::from_value(json!({"conditionRules":rules})).unwrap();
        assert_eq!(
            repo.query_page("A", &request, &HashMap::new(), 1, 20)
                .await
                .unwrap()
                .1,
            1
        );
        let mut values: Vec<_> = repo
            .list("A")
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.record_data)
            .collect();
        hydrate(&db, &repo, "A", &[path("amount")], &mut values)
            .await
            .unwrap();
        assert_eq!(
            values
                .iter()
                .filter(|data| conditions::evaluate(&rules, None, data))
                .count(),
            1
        );
    }
    let invalid = vec![json!({"id":"r","fieldKey":path("missing"),"operator":"eq","rawValue":"x"})];
    assert!(compile(&db, "A", &invalid, &mut vec![]).await.is_err());
    // Run-local updates must override committed related values, without changing the root output.
    db.execute_unprepared("CREATE TABLE automation_execution_record_changes (run_id uuid,form_uuid text,operation text,record_uuid text,record_id uuid,schema_version integer,record_data jsonb,created_by text,updated_by text,record_created_at timestamptz,record_updated_at timestamptz)").await.unwrap();
    let run = Uuid::new_v4();
    db.execute_unprepared(&format!("INSERT INTO automation_execution_record_changes VALUES ('{run}','C','upsert','{}','{}',1,'{{\"contact\":\"运行中修改\"}}','test','test',NOW(),NOW())",c1.record_uuid,c1.id)).await.unwrap();
    let run_repo = RecordRepository::for_automation_run(&db, run, None);
    let mut values = vec![a1.record_data.clone()];
    hydrate(&db, &run_repo, "A", &[path("contact")], &mut values)
        .await
        .unwrap();
    assert_eq!(values[0][path("contact")], "运行中修改");
    assert_eq!(values[0]["company"], a1.record_data["company"]);
    verify_automation(&db, &a1, path("contact"), run).await;
}

async fn verify_automation(
    db: &DatabaseConnection,
    root: &crate::platform::records::StoredFormRecord,
    path: String,
    run: Uuid,
) {
    use crate::infrastructure::entities::automation_flow_entity;
    use crate::modules::automations::{self, AutomationExecutionContext, engine};
    let now = Utc::now();
    let node_path = format!(
        "{}{}",
        conditions::PATH_PREFIX,
        json!({"root":"trigger-1:company","path":["group","contact"]})
    );
    let rule = json!({"id":"r","fieldKey":path,"operator":"eq","rawValue":"小明"});
    let get = json!({"sourceMode":"form","formUuid":"A","filterMode":"rules","rules":[rule]});
    let branch = json!({"branches":[{"id":"yes","mode":"rules","rules":[{"id":"r","fieldKey":node_path,"operator":"eq","rawValue":"运行中修改"}]}]});
    let nodes = json!([
        {"id":"trigger-1","data":{"kind":"trigger","config":{}}},
        {"id":"get","data":{"kind":"get-many","config":get}},
        {"id":"condition","data":{"kind":"condition","config":branch}},
        {"id":"parallel","data":{"kind":"parallel-condition","config":branch}}
    ]);
    let edges = json!([
        {"source":"trigger-1","target":"get"},
        {"source":"trigger-1","target":"condition"},
        {"source":"trigger-1","target":"parallel"},
        {"source":"condition","sourceHandle":"condition-branch:yes","target":"matched"},
        {"source":"parallel","sourceHandle":"condition-branch:yes","target":"matched"}
    ]);
    let flow = automation_flow_entity::Model {
        id: Uuid::new_v4(),
        flow_uuid: "test".into(),
        app_route_app_id: "test".into(),
        name: "test".into(),
        description: None,
        status: "enabled".into(),
        current_version: 1,
        flow_type: "trigger".into(),
        trigger_form_uuid: Some("A".into()),
        trigger_config: json!({}),
        nodes_json: nodes,
        edges_json: edges,
        created_by: "test".into(),
        updated_by: "test".into(),
        created_at: now,
        updated_at: now,
    };
    let mut context = AutomationExecutionContext {
        outputs: HashMap::from([(
            "trigger-1".into(),
            automations::record_data_with_automation_identity(root.clone()),
        )]),
        operator: "test".into(),
        run_id: None,
        branch_id: None,
    };
    automations::validate_execution_sources(db, &flow)
        .await
        .unwrap();
    automations::execute_shared_node(db, &flow, "get", "get-many", &get, &mut context)
        .await
        .unwrap();
    assert_eq!(context.outputs["get"].as_array().unwrap().len(), 1);
    context.run_id = Some(run);
    for (id, kind) in [
        ("condition", "condition"),
        ("parallel", "parallel-condition"),
    ] {
        automations::execute_shared_node(db, &flow, id, kind, &branch, &mut context)
            .await
            .unwrap();
        let node = flow
            .nodes_json
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap();
        assert!(
            matches!(engine::transition(&flow,node,&context),engine::Transition::Continue(target) if target == "matched")
        );
    }
    context.run_id = None;
    let update = json!({"targetFormUuid":"A","rules":[rule],"rows":[{"fieldId":"note","valueType":"value","rawValue":"已命中"}]});
    automations::execute_shared_node(db, &flow, "update", "update-data", &update, &mut context)
        .await
        .unwrap();
    assert_eq!(context.outputs["update"].as_array().unwrap().len(), 1);
    assert_eq!(
        RecordRepository::new(db)
            .find("A", &root.record_uuid)
            .await
            .unwrap()
            .record_data["note"],
        "已命中"
    );
    let delete =
        json!({"targetFormUuid":"A","deleteMode":"form","filterMode":"rules","rules":[rule]});
    automations::execute_shared_node(db, &flow, "delete", "delete-data", &delete, &mut context)
        .await
        .unwrap();
    assert!(
        RecordRepository::new(db)
            .find("A", &root.record_uuid)
            .await
            .is_err()
    );
    assert_eq!(RecordRepository::new(db).list("A").await.unwrap().len(), 2);
}
