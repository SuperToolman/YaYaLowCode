use super::*;
use crate::infrastructure::entities::{
    custom_button_entity, form_detail_definition_entity, form_storage_definition_entity,
    form_view_entity,
};
use sea_orm::{ConnectOptions, Database, Schema};

#[tokio::test]
#[ignore = "requires WORKFLOW_TEST_DATABASE_SETTINGS_PATH; creates an isolated PostgreSQL schema"]
async fn market_suite_database_and_cross_platform_lifecycle() {
    let settings: Value = serde_json::from_slice(
        &fs::read(std::env::var("WORKFLOW_TEST_DATABASE_SETTINGS_PATH").unwrap()).unwrap(),
    )
    .unwrap();
    let config: crate::platform::config::DatabaseSettings =
        serde_json::from_value(settings["database"].clone()).unwrap();
    let url = config.to_database_url();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("market_suite_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema_name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(&schema_name)
        .sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}
async fn verify(db: DatabaseConnection) {
    let schema = Schema::new(DatabaseBackend::Postgres);
    for statement in [
        schema.create_table_from_entity(AppEntity),
        schema.create_table_from_entity(FormDefinitionEntity),
        schema.create_table_from_entity(FormSchemaEntity),
        schema.create_table_from_entity(AppNavigationEntity),
        schema.create_table_from_entity(form_view_entity::Entity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationNodeEntity),
        schema.create_table_from_entity(AutomationEdgeEntity),
        schema.create_table_from_entity(custom_button_entity::Entity),
        schema.create_table_from_entity(form_detail_definition_entity::Entity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    db.execute_unprepared("CREATE TABLE market_installations(installation_id UUID PRIMARY KEY,product_id TEXT UNIQUE,release_id TEXT,local_app_id TEXT,status TEXT,installed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,legacy_mapping BOOLEAN DEFAULT FALSE); CREATE TABLE market_installation_resources(installation_id UUID,resource_type TEXT,source_id TEXT,local_id TEXT,PRIMARY KEY(installation_id,resource_type,source_id)); CREATE TABLE market_installation_versions(installation_id UUID,release_id TEXT,version TEXT,package_sha256 TEXT,package_bytes BYTEA,snapshot_json JSONB,applied_at TIMESTAMPTZ,PRIMARY KEY(installation_id,release_id)); CREATE TABLE market_installation_events(id UUID PRIMARY KEY,installation_id UUID,event_type TEXT,detail_json JSONB,created_at TIMESTAMPTZ);").await.unwrap();
    db.execute_unprepared(include_str!("schema.sql"))
        .await
        .unwrap();
    db.execute_unprepared(include_str!("test_cleanup_schema.sql"))
        .await
        .unwrap();
    let mut original = protocol::tests::bundle();
    // Different forms legitimately save the same default view identifier.
    for member in original["members"].as_array_mut().unwrap() {
        let form = member["resources"]["form_definitions"][0]["form_uuid"].clone();
        member["resources"]["form_views"].as_array_mut().unwrap().push(json!({"id":Uuid::new_v4().to_string(),"form_uuid":form,"view_uuid":"default","name":"全部数据","config_json":{}}));
    }
    // A mode switch may leave an obsolete target in stored editor configuration.
    let flow = &mut original["members"][0]["resources"]["automation_flows"][0];
    flow["nodes_json"].as_array_mut().unwrap().push(json!({"id":"delete","data":{"kind":"delete-data","config":{"deleteMode":"data-node","sourceNodeId":"read","targetFormUuid":"deleted-cache"}}}));
    flow["edges_json"] = json!([{"source":"read","target":"delete"}]);
    let user = Uuid::new_v4();
    for (table, _) in protocol::TABLES {
        for m in original["members"].as_array().unwrap() {
            for raw in m["resources"][*table].as_array().unwrap() {
                let mut row = raw.clone();
                row["created_at"] = json!(Utc::now().to_rfc3339());
                row["updated_at"] = row["created_at"].clone();
                if *table == "apps" {
                    row["creator_user_id"] = json!(user);
                    row["owner_name"] = json!("publisher");
                    row["records_count"] = json!(0);
                    row["deployment_type"] = json!("local");
                }
                if *table == "automation_flows" {
                    row["created_by"] = json!("publisher");
                    row["updated_by"] = json!("publisher");
                }
                if *table == "app_custom_buttons" {
                    row["created_by"] = json!(user);
                    row["updated_by"] = json!(user);
                }
                sql(&db,format!("INSERT INTO {table} SELECT * FROM jsonb_populate_record(NULL::{table},$1::jsonb)"),vec![row.to_string().into()]).await.unwrap();
            }
        }
    }
    // Scope follows outgoing dependencies, never the applications that reference the root.
    let c_schema = original["members"][2]["resources"]["form_schemas"][0]["schema_json"].clone();
    let b_schema = original["members"][1]["resources"]["form_schemas"][0]["schema_json"].clone();
    let mut c_without_backlink = c_schema.clone();
    c_without_backlink["fields"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    sql(
        &db,
        "UPDATE form_schemas SET schema_json=$1::jsonb WHERE form_uuid='source-form-3'",
        vec![c_without_backlink.to_string().into()],
    )
    .await
    .unwrap();
    for (root, expected) in [
        (
            "source-app-1",
            vec!["source-app-1", "source-app-2", "source-app-3"],
        ),
        ("source-app-2", vec!["source-app-2", "source-app-3"]),
        ("source-app-3", vec!["source-app-3"]),
    ] {
        let result = scanner::scan_for(&db, user, "publisher", &HashSet::from(["*".into()]), root)
            .await
            .unwrap();
        assert_eq!(result["blockingIssues"], json!([]));
        let members: Vec<_> = result["bundle"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["appId"].as_str().unwrap())
            .collect();
        assert_eq!(members, expected);
        let (_, bytes) =
            super::super::publication::build_package(&result["bundle"], "1.0.0").unwrap();
        protocol::read(&bytes).unwrap();
    }
    // A direct B -> A reference makes A required even when publishing B.
    let mut b_with_backlink = b_schema.clone();
    b_with_backlink["fields"][1]["props"]["associationAppId"] = json!("source-app-1");
    b_with_backlink["fields"][1]["props"]["associationFormId"] = json!("source-form-1");
    sql(
        &db,
        "UPDATE form_schemas SET schema_json=$1::jsonb WHERE form_uuid='source-form-2'",
        vec![b_with_backlink.to_string().into()],
    )
    .await
    .unwrap();
    let direct_cycle = scanner::scan_for(
        &db,
        user,
        "publisher",
        &HashSet::from(["*".into()]),
        "source-app-2",
    )
    .await
    .unwrap();
    assert_eq!(direct_cycle["blockingIssues"], json!([]));
    assert_eq!(
        direct_cycle["bundle"]["members"].as_array().unwrap().len(),
        3
    );
    // Restore B -> C -> A; every entry must include all three exactly once.
    sql(
        &db,
        "UPDATE form_schemas SET schema_json=$1::jsonb WHERE form_uuid='source-form-2'",
        vec![b_schema.to_string().into()],
    )
    .await
    .unwrap();
    sql(
        &db,
        "UPDATE form_schemas SET schema_json=$1::jsonb WHERE form_uuid='source-form-3'",
        vec![c_schema.to_string().into()],
    )
    .await
    .unwrap();
    for root in ["source-app-2", "source-app-3"] {
        let result = scanner::scan_for(&db, user, "publisher", &HashSet::from(["*".into()]), root)
            .await
            .unwrap();
        assert_eq!(result["blockingIssues"], json!([]));
        assert_eq!(result["bundle"]["members"].as_array().unwrap().len(), 3);
        protocol::resources(&result["bundle"]).unwrap();
    }
    // An independent entry can explicitly include another application and its outgoing closure.
    let manual = scanner::scan_for_members(&db, user, "publisher", &HashSet::from(["*".into()]), "source-app-3", &["source-app-1".into()]).await.unwrap();
    assert_eq!(manual["blockingIssues"], json!([]));
    assert_eq!(manual["bundle"]["members"].as_array().unwrap().len(), 3);
    assert_eq!(manual["bundle"]["selectedAppIds"], json!(["source-app-1", "source-app-3"]));
    let reordered = scanner::scan_selected(&db, user, "publisher", &HashSet::from(["*".into()]), "source-app-2", &["source-app-3".into(), "source-app-1".into()]).await.unwrap();
    assert_eq!(manual["fingerprint"], reordered["fingerprint"]);
    assert!(manual["bundle"].get("rootAppId").is_none());
    let base = scanner::scan_for(&db, user, "publisher", &HashSet::from(["*".into()]), "source-app-3").await.unwrap();
    assert_ne!(manual["fingerprint"], base["fingerprint"]);
    let missing = scanner::scan_for_members(&db, user, "publisher", &HashSet::from(["*".into()]), "source-app-3", &["missing".into()]).await.unwrap();
    assert!(!missing["blockingIssues"].as_array().unwrap().is_empty());
    let mut scan = scanner::scan_for_members(
        &db,
        user,
        "publisher",
        &HashSet::from(["*".into()]),
        "source-app-1",
        &["source-app-3".into()],
    )
    .await
    .unwrap();
    assert_eq!(scan["blockingIssues"], json!([]));
    assert_eq!(scan["bundle"]["members"].as_array().unwrap().len(), 3);
    assert_eq!(scan["bundle"]["dependencies"].as_array().unwrap().len(), 9); // application + target form edges
    let denied = scanner::scan_for(
        &db,
        Uuid::new_v4(),
        "someone",
        &HashSet::new(),
        "source-app-1",
    )
    .await
    .unwrap();
    assert!(!denied["blockingIssues"].as_array().unwrap().is_empty());
    scan["bundle"]["packageName"]=json!("客户经营套件");
    let (_, export) = super::super::publication::build_package(&scan["bundle"], "1.0.0").unwrap();
    let (mut bytes, mut bundle) = (export.clone(), scan["bundle"].clone());
    if let Ok(manifest) = std::env::var("MARKET_OPERATION_TEST_MANIFEST") {
        let dir = std::env::temp_dir().join(format!("market-cross-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("export.zip");
        let target = dir.join("download.zip");
        fs::write(&source, &export).unwrap();
        let status = std::process::Command::new("cargo")
            .args([
                "test",
                "--manifest-path",
                &manifest,
                "application_market_v3_http_lifecycle",
                "--",
                "--nocapture",
            ])
            .env("MARKET_TEST_EXPORT_PATH", &source)
            .env("MARKET_TEST_DOWNLOADED_PATH", &target)
            .status()
            .unwrap();
        assert!(status.success());
        bytes = fs::read(target).unwrap();
        bundle = protocol::read(&bytes).unwrap().1;
        assert_eq!(bytes, export);
        assert_eq!(bundle["packageName"],"客户经营套件");
        let _ = fs::remove_dir_all(dir);
    }
    let id = Uuid::new_v4().to_string();
    let txn = db.begin().await.unwrap();
    sql(&txn,"INSERT INTO market_installations(installation_id,product_id,release_id,status,installed_at,updated_at) VALUES($1::uuid,'product-test','release-1','installing',NOW(),NOW())",vec![id.clone().into()]).await.unwrap();
    apply(&txn, &id, &bundle, "release-1", "1.0.0", user)
        .await
        .unwrap();
    store_version(
        &txn,
        &id,
        &json!({"releaseId":"release-1","version":"1.0.0"}),
        &bytes,
        &bundle,
        "installed",
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();
    let installed = members(&db, &id).await.unwrap();
    assert_eq!(installed.len(), 3);
    for member in &installed {
        let local_form: String = db
            .query_one_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT f.form_uuid FROM form_definitions f WHERE f.app_route_app_id=$1 LIMIT 1",
                vec![member["local_app_id"].as_str().unwrap().into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get("", "form_uuid")
            .unwrap();
        let default_view = form_view_entity::Entity::find()
            .filter(form_view_entity::Column::FormUuid.eq(&local_form))
            .filter(form_view_entity::Column::ViewUuid.eq("default"))
            .all(&db)
            .await
            .unwrap();
        assert_eq!(default_view.len(), 1);
        let local = member["local_app_id"].as_str().unwrap();
        assert_ne!(local, member["source_app_id"].as_str().unwrap());
        let f = FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(local))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let s = FormSchemaEntity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(&f.form_uuid))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let props = &s.schema_json["fields"][1]["props"];
        let target = FormDefinitionEntity::find()
            .filter(
                form_definition_entity::Column::FormUuid
                    .eq(props["associationFormId"].as_str().unwrap()),
            )
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            target.app_route_app_id,
            props["associationAppId"].as_str().unwrap()
        );
        assert!(!target.form_uuid.starts_with("source-"));
        assert_eq!(props["associationPrimaryFieldId"], "name");
        let record = crate::platform::records::RecordRepository::new(&db)
            .insert(&target, json!({"name":"客户资料"}), "test", Utc::now())
            .await
            .unwrap();
        let rows = crate::platform::records::RecordRepository::new(&db)
            .list(&target.form_uuid)
            .await
            .unwrap();
        assert!(rows.iter().any(|r|r.record_uuid==record.record_uuid&&r.record_data["name"]=="客户资料"));
    }
    let installed_a = installed
        .iter()
        .find(|m| m["source_app_id"] == "source-app-1")
        .unwrap()["local_app_id"]
        .as_str()
        .unwrap();
    let nav = AppNavigationEntity::find()
        .filter(app_navigation_entity::Column::AppRouteAppId.eq(installed_a))
        .all(&db)
        .await
        .unwrap();
    let child = nav.iter().find(|n| n.item_type == "form").unwrap();
    assert!(nav.iter().any(|n| Some(n.id) == child.parent_id));
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(installed_a))
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(flow.status, "paused");
    assert!(
        flow.nodes_json[1]["data"]["config"]
            .get("targetFormUuid")
            .is_none()
    );
    assert_eq!(flow.nodes_json[1]["data"]["config"]["sourceNodeId"], "read");
    assert_ne!(
        flow.nodes_json[0]["data"]["config"]["formUuid"],
        "source-form-3"
    );
    assert!(
        AutomationFlowVersionEntity::find()
            .filter(automation_flow_version_entity::Column::FlowId.eq(flow.id))
            .one(&db)
            .await
            .unwrap()
            .is_some()
    );
    let button = custom_button_entity::Entity::find()
        .filter(custom_button_entity::Column::AppRouteAppId.eq(installed_a))
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let view = form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq(&button.form_uuid))
        .filter(form_view_entity::Column::ViewUuid.ne("default"))
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        view.config_json["customButtons"][0]["buttonId"],
        button.button_uuid
    );
    let r = installation(&db, &id, false).await.unwrap();
    assert!(!changed(&db, &id, &r).await.unwrap());
    let mut next = bundle.clone();
    next["members"][0]["resources"]["form_schemas"][0]["schema_json"]["fields"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"extra","type":"text","label":"新增字段"}));
    // A later release adds a required fourth member; it must get an independent local copy.
    let mut fourth = next["members"][2].clone();
    fourth["appId"] = json!("source-app-4");
    for (table, _) in protocol::TABLES {
        for row in fourth["resources"][*table].as_array_mut().unwrap() {
            row["id"] = json!(Uuid::new_v4());
            if *table == "apps" {
                row["route_app_id"] = json!("source-app-4");
            }
            if row.get("app_route_app_id").is_some() {
                row["app_route_app_id"] = json!("source-app-4");
            }
            if row.get("form_uuid").is_some() {
                row["form_uuid"] = json!("source-form-4");
            }
        }
    }
    next["members"].as_array_mut().unwrap().push(fourth);
    next["members"][0]["resources"]["form_schemas"][0]["schema_json"]["fields"].as_array_mut().unwrap().push(json!({"id":"fourth","type":"associationFormField","props":{"associationAppId":"source-app-4","associationFormId":"source-form-4","associationPrimaryFieldId":"name"}}));
    next["dependencies"] = json!(protocol::dependency_graph(&next));
    assert!(breaking(&bundle, &next).is_empty());
    assert!(!breaking(&next, &bundle).is_empty());
    let txn = db.begin().await.unwrap();
    apply(&txn, &id, &next, "release-2", "1.0.1", user)
        .await
        .unwrap();
    txn.rollback().await.unwrap();
    assert_eq!(
        installation(&db, &id, false).await.unwrap()["release_id"],
        "release-1"
    );
    assert!(!changed(&db, &id, &r).await.unwrap());
    let txn = db.begin().await.unwrap();
    apply(&txn, &id, &next, "release-2", "1.0.1", user)
        .await
        .unwrap();
    txn.commit().await.unwrap();
    assert_eq!(
        installation(&db, &id, false).await.unwrap()["release_id"],
        "release-2"
    );
    assert_eq!(members(&db, &id).await.unwrap().len(), 4);
    db.execute_unprepared("UPDATE form_definitions SET name='本地修改' WHERE app_route_app_id IN (SELECT local_app_id FROM market_installation_members)").await.unwrap();
    let r = installation(&db, &id, false).await.unwrap();
    assert!(changed(&db, &id, &r).await.unwrap());
    let reset_root = std::env::temp_dir().join(format!("market-reset-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&reset_root).unwrap();
    fs::write(reset_root.join("test.zip"), b"fixture").unwrap();
    unsafe {
        std::env::set_var("YAYA_MARKET_RELEASES_PATH", &reset_root);
    }
    let preview = super::super::reset::command(&db, None).await.unwrap();
    assert_eq!(preview["executed"], false);
    assert_eq!(members(&db, &id).await.unwrap().len(), 4);
    let result = super::super::reset::command(&db, preview["confirmation"].as_str())
        .await
        .unwrap();
    assert_eq!(result["executed"], true);
    assert_eq!(AppEntity::find().all(&db).await.unwrap().len(), 3);
    assert!(
        AppEntity::find()
            .all(&db)
            .await
            .unwrap()
            .iter()
            .all(|a| a.route_app_id.starts_with("source-"))
    );
    assert!(members(&db, &id).await.unwrap().is_empty());
    assert!(!reset_root.join("test.zip").exists());
    unsafe {
        std::env::remove_var("YAYA_MARKET_RELEASES_PATH");
    }
    let _ = fs::remove_dir(reset_root);
}
