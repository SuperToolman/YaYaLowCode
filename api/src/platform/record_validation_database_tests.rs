use crate::platform::prelude::*;
use crate::platform::records::RecordRepository;
use sea_orm::{ConnectOptions, Database, Schema};

#[tokio::test]
#[ignore = "requires RECORD_VALIDATION_TEST_DATABASE_URL; uses and removes an isolated schema"]
async fn record_validation_database() {
    let url =
        std::env::var("RECORD_VALIDATION_TEST_DATABASE_URL").expect("test database URL required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema_name = format!("record_validation_test_{}", Uuid::new_v4().simple());
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
    ] {
        db.execute(&statement).await.unwrap();
    }
    let result = tokio::spawn(async move { verify_database(db).await }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema_name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn verify_database(db: DatabaseConnection) {
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
    let structure = json!({"fields":[
        {"id":"text","type":"singleLineText","label":"Text","props":{"isUnique":true,"formatValidation":"email"}},
        {"id":"multi\"line","type":"multiLineText","props":{"isUnique":true}},
        {"id":"serial","type":"serialNumber","props":{"isUnique":true}},
        {"id":"rows","type":"subform"},
        {"id":"child","type":"singleLineText","parentGroupId":"rows","props":{"isUnique":true}}
    ]});
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
    let data = json!({"text":"a@example.com","multi\"line":"one\ntwo","serial":"N001","rows":[{"child":"nested"}]});
    let first = repo.insert(&form, data.clone(), "test", now).await.unwrap();
    assert_eq!(
        repo.validate_values(&form.form_uuid, &data, None)
            .await
            .unwrap()
            .len(),
        4
    );
    assert!(repo.insert(&form, data.clone(), "test", now).await.is_err());
    assert!(
        repo.validate_values(&form.form_uuid, &data, Some(&first.record_uuid))
            .await
            .unwrap()
            .is_empty()
    );
    repo.update(&first, data.clone(), "test", now)
        .await
        .unwrap();
    assert!(
        repo.insert(&form, json!({"text":"bad"}), "test", now)
            .await
            .is_err()
    );
    let other = repo
        .insert(&form, json!({"text":"b@example.com"}), "test", now)
        .await
        .unwrap();
    assert!(
        repo.update(&other, data.clone(), "test", now)
            .await
            .is_err()
    );
    assert!(
        repo.insert(
            &form,
            json!({"rows":[{"child":"new"},{"child":"new"}]}),
            "test",
            now
        )
        .await
        .is_err()
    );
    repo.soft_delete(&first, now).await.unwrap();
    repo.insert(&form, data, "test", now).await.unwrap();
    repo.insert(&form, json!({"text":""}), "test", now)
        .await
        .unwrap();
    repo.insert(&form, json!({"text":""}), "test", now)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        repo.insert(&form, json!({"text":"race@example.com"}), "test", now),
        repo.insert(&form, json!({"text":"race@example.com"}), "test", now)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
}
