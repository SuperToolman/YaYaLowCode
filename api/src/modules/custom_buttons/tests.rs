use super::*;
fn payload() -> SaveCustomButtonRequest {
    serde_json::from_value(json!({"name":"  按钮  ","description":"","actionType":"fill_form","actionConfig":{"targetAppId":"app","targetFormUuid":"form","fieldIds":["text"]},"availability":{"mode":"all","rules":[]},"disabledReason":""})).unwrap()
}
fn schema() -> Value {
    json!({"fields":[{"id":"text","type":"singleLineText"},{"id":"computed","type":"number","props":{"isReadOnly":true}},{"id":"group","type":"groupContainer"}]})
}
#[test]
fn writable_fields_and_name() {
    let mut p = payload();
    validate_configuration(&mut p, &schema(), false).unwrap();
    assert_eq!(p.name, "按钮");
    for field in ["computed", "group", "missing", "createdAt"] {
        p.action_config.field_ids = vec![field.into()];
        assert!(validate_configuration(&mut p, &schema(), false).is_err());
    }
}
#[test]
fn open_page_configuration() {
    let mut p = payload();
    p.action_type = "open_page".into();
    p.action_config.link_type = Some("external".into());
    p.action_config.open_mode = Some("window".into());
    p.action_config.url = Some("https://example.com".into());
    validate_configuration(&mut p, &json!({}), false).unwrap();
    assert!(p.action_config.field_ids.is_empty());
    p.action_config.url = Some("javascript:alert(1)".into());
    assert!(validate_configuration(&mut p, &json!({}), false).is_err());
    p.action_config.link_type = Some("internal".into());
    p.action_config.page_mode = Some("edit".into());
    p.action_config.open_mode = Some("sidebar".into());
    validate_configuration(&mut p, &json!({}), false).unwrap();
}
#[test]
fn nested_conditions_validate_and_reject_cycles() {
    let mut p = payload();
    p.availability=serde_json::from_value(json!({"mode":"conditions","rules":[{"id":"root","isGroup":true,"logicalOperator":"and"},{"id":"child","parentId":"root","fieldKey":"text","operator":"eq","rawValue":"yes"}]})).unwrap();
    validate_rules(
        &p.availability.rules,
        &valid_condition_fields(&schema(), false),
    )
    .unwrap();
    p.availability.rules[0].parent_id = Some("child".into());
    assert!(
        validate_rules(
            &p.availability.rules,
            &valid_condition_fields(&schema(), false)
        )
        .is_err()
    );
}
#[test]
fn missing_values_and_field_references() {
    let mut p = payload();
    p.availability=serde_json::from_value(json!({"mode":"conditions","rules":[{"id":"r","fieldKey":"text","operator":"eq","valueType":"field","sourceFieldKey":"createdAt"}]})).unwrap();
    validate_rules(
        &p.availability.rules,
        &valid_condition_fields(&schema(), false),
    )
    .unwrap();
    p.availability.rules[0].source_field_key = Some("missing".into());
    assert!(
        validate_rules(
            &p.availability.rules,
            &valid_condition_fields(&schema(), false)
        )
        .is_err()
    );
    p.availability.rules[0].value_type = Some("value".into());
    assert!(
        validate_rules(
            &p.availability.rules,
            &valid_condition_fields(&schema(), false)
        )
        .is_err()
    );
    p.availability.rules[0].operator = Some("hasValue".into());
    validate_rules(
        &p.availability.rules,
        &valid_condition_fields(&schema(), false),
    )
    .unwrap();
}

#[tokio::test]
#[ignore = "requires CUSTOM_BUTTON_TEST_DATABASE_SETTINGS_PATH; isolated schema"]
async fn custom_buttons_database_lifecycle() {
    use sea_orm::{ConnectOptions, Database, Schema};
    let raw: Value = serde_json::from_slice(
        &std::fs::read(std::env::var("CUSTOM_BUTTON_TEST_DATABASE_SETTINGS_PATH").unwrap())
            .unwrap(),
    )
    .unwrap();
    let settings: crate::platform::config::DatabaseSettings =
        serde_json::from_value(raw["database"].clone()).unwrap();
    let url = settings.to_database_url();
    let admin = Database::connect(url.clone()).await.unwrap();
    let name = format!("buttons_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {name}"))
        .await
        .unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&name).sqlx_logging(false);
    let db = Database::connect(options).await.unwrap();
    let result=tokio::spawn(async move {
        let schema=Schema::new(db.get_database_backend());db.execute(&schema.create_table_from_entity(AppEntity)).await.unwrap();db.execute(&schema.create_table_from_entity(FormDefinitionEntity)).await.unwrap();
        db.execute_unprepared(include_str!("schema.sql")).await.unwrap();db.execute_unprepared(include_str!("schema.sql")).await.unwrap();
        let now=Utc::now();
        for app in ["app-a","app-b"] { app_entity::ActiveModel{id:Set(Uuid::new_v4()),route_app_id:Set(app.into()),name:Set(app.into()),description:Set("".into()),icon:Set("app".into()),badge:Set(None),color:Set("blue".into()),creator_user_id:Set(None),deployment_type:Set("native".into()),online_version:Set(None),online_release_id:Set(None),owner_name:Set("test".into()),records_count:Set(0),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap(); }
        let actor=Uuid::new_v4();let mut draft=payload();validate_configuration(&mut draft,&super::tests::schema(),false).unwrap();
        form_definition_entity::ActiveModel{id:Set(Uuid::new_v4()),app_route_app_id:Set("app-a".into()),form_uuid:Set("form".into()),name:Set("Source".into()),slug:Set("source".into()),form_type:Set("normal".into()),current_schema_version:Set(1),latest_schema_version:Set(1),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        let row=button::ActiveModel{id:Set(Uuid::new_v4()),button_uuid:Set("BTN-test".into()),app_route_app_id:Set("app-a".into()),form_uuid:Set("form".into()),name:Set(draft.name),icon:Set(None),description:Set("".into()),action_type:Set(draft.action_type),action_config:Set(json!(draft.action_config)),availability:Set(json!(draft.availability)),disabled_reason:Set("".into()),created_by:Set(actor),updated_by:Set(actor),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        assert!(find_button(&db,"form-b","BTN-test").await.is_err());
        let found=find_button(&db,"form","BTN-test").await.unwrap();assert_eq!(found.id,row.id);
        let response=response(&db,found).await.unwrap();assert_eq!(response.action_config.field_ids,vec!["text"]);assert_eq!(response.target_form_name.as_deref(),Some("Source"));
        let (shutdown,_)=tokio::sync::watch::channel(false);let state=AppState::new(db.clone(),None,60,shutdown);
        // Exercise real authorization with a signed test identity in the isolated schema.
        use crate::infrastructure::entities::{iam_user_entity,iam_role_entity,iam_user_role_entity,iam_role_permission_entity};
        for statement in [schema.create_table_from_entity(iam_user_entity::Entity),schema.create_table_from_entity(iam_role_entity::Entity),schema.create_table_from_entity(iam_user_role_entity::Entity),schema.create_table_from_entity(iam_role_permission_entity::Entity),schema.create_table_from_entity(FormSchemaEntity)] {db.execute(&statement).await.unwrap();}
        db.execute_raw(sea_orm::Statement::from_sql_and_values(db.get_database_backend(),"INSERT INTO iam_users(id,display_name,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1,'test',false,false,false,false,'{}','active',NOW(),NOW())",vec![actor.into()])).await.unwrap();
        let secret=std::env::var("AUTH_TOKEN_SECRET").unwrap_or_else(|_|"yaya-development-token-secret".into());
        let token=jsonwebtoken::encode(&jsonwebtoken::Header::default(),&json!({"sub":actor.to_string(),"exp":Utc::now().timestamp()+300}),&jsonwebtoken::EncodingKey::from_secret(secret.as_bytes())).unwrap();
        let mut headers=HeaderMap::new();headers.insert("authorization",format!("Bearer {token}").parse().unwrap());
        for method in [axum::http::Method::GET,axum::http::Method::POST,axum::http::Method::PATCH,axum::http::Method::DELETE] {
            assert!(authorization::authorize_request(&headers,&state,&method,"/api/forms/form/custom-buttons/BTN-test").await.is_err());
        }
        let role=Uuid::new_v4();
        iam_role_entity::ActiveModel{id:Set(role),source_type:Set("local".into()),external_id:Set("test-role".into()),name:Set("test".into()),status:Set("active".into()),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        iam_user_role_entity::ActiveModel{id:Set(Uuid::new_v4()),user_id:Set(actor),role_id:Set(role),created_at:Set(now)}.insert(&db).await.unwrap();
        for permission in ["app:app-a:automation","app:app-a:display"] {
            iam_role_permission_entity::ActiveModel{id:Set(Uuid::new_v4()),role_id:Set(role),permission:Set(permission.into()),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        }
        assert!(authorization::authorize_request(&headers,&state,&axum::http::Method::POST,"/api/forms/form/custom-buttons").await.is_err());


        form_schema_entity::ActiveModel{id:Set(Uuid::new_v4()),form_uuid:Set("form".into()),version:Set(1),schema_json:Set(super::tests::schema()),change_log:Set(None),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        let mut input=payload();input.action_config.target_app_id="app-a".into();
        assert!(create_custom_button(State(state.clone()),headers.clone(),Path("form".into()),Json(input.clone())).await.is_err());
        iam_role_permission_entity::ActiveModel{id:Set(Uuid::new_v4()),role_id:Set(role),permission:Set("form:form:display".into()),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        for permission in ["app:app-a:edit_form", "app:app-a:view_development"] { iam_role_permission_entity::ActiveModel{id:Set(Uuid::new_v4()),role_id:Set(role),permission:Set(permission.into()),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap(); }
        let Json(created)=create_custom_button(State(state.clone()),headers.clone(),Path("form".into()),Json(input.clone())).await.unwrap();
        let created=created.data.unwrap();input.name="Changed".into();
        let Json(updated)=update_custom_button(State(state.clone()),headers,Path(("form".into(),created.id.clone())),Json(input)).await.unwrap();assert_eq!(updated.data.unwrap().name,"Changed");
        // View binding reads do not require automation management; runtime invocation
        // still rechecks source conditions, saved binding and target create permission.
        use crate::modules::{forms, view_custom_buttons as views};
        use crate::infrastructure::entities::{form_view_entity, form_storage_definition_entity};
        db.execute(&schema.create_table_from_entity(form_view_entity::Entity)).await.unwrap();
        db.execute(&schema.create_table_from_entity(form_storage_definition_entity::Entity)).await.unwrap();
        crate::platform::form_storage::sync_current_storage_plan(&db,"form",1,&super::tests::schema()).await.unwrap();
        let source_definition = forms::find_form_definition(&db,"form").await.unwrap();
        let source = crate::platform::records::RecordRepository::new(&db).insert(&source_definition,json!({"text":"yes"}),"test",now).await.unwrap();
        let role_headers = {
            let mut h = HeaderMap::new(); h.insert("authorization",format!("Bearer {token}").parse().unwrap()); h
        };
        let binding = json!({"buttonId":created.id});
        let config = json!({"customButtons":[binding.clone()]});
        views::validate_view_config(&state,"form",&config).await.unwrap();
        assert!(views::validate_view_config(&state,"form",&json!({"customButtons":[binding.clone(),binding.clone()]})).await.is_err());
        let mut invalid = config.clone(); invalid["customButtons"][0]["buttonId"] = json!("foreign-button");
        assert!(views::validate_view_config(&state,"form",&invalid).await.is_err());
        let invoke = || views::ButtonInvocation { record_id: source.record_uuid.clone(), data: None };
        assert!(views::prepare_view_button(State(state.clone()),role_headers.clone(),Path(("form".into(),"default".into(),created.id.clone())),Json(invoke())).await.is_err());
        let _ = forms::update_form_view(State(state.clone()),Path(("form".into(),"default".into())),Json(forms::SaveFormViewRequest{name:"全部数据".into(),config:config.clone()})).await.unwrap();
        assert!(views::prepare_view_button(State(state.clone()),role_headers.clone(),Path(("form".into(),"default".into(),created.id.clone())),Json(invoke())).await.is_err());
        iam_role_permission_entity::ActiveModel{id:Set(Uuid::new_v4()),role_id:Set(role),permission:Set("form:form:create".into()),created_at:Set(now),updated_at:Set(now)}.insert(&db).await.unwrap();
        let _ = views::prepare_view_button(State(state.clone()),role_headers.clone(),Path(("form".into(),"default".into(),created.id.clone())),Json(invoke())).await.unwrap();
        let bad_data = views::ButtonInvocation { record_id: source.record_uuid.clone(), data:Some(json!({"computed":1})) };
        assert!(views::submit_view_button(State(state.clone()),role_headers.clone(),Path(("form".into(),"default".into(),created.id.clone())),Json(bad_data)).await.is_err());
        let _ = forms::update_form_view(State(state.clone()),Path(("form".into(),"default".into())),Json(forms::SaveFormViewRequest{name:"全部数据".into(),config})).await.unwrap();
        automation_tests::verify(&state, &role_headers, actor, role, &source.record_uuid).await;
        let _=delete_custom_button(State(state.clone()),Path(("form".into(),created.id))).await.unwrap();
        let Json(runtime)=views::list_view_buttons(State(state.clone()),Path(("form".into(),"default".into()))).await.unwrap();
        assert!(runtime.data.unwrap()[0].definition.is_none());
        let Json(list)=list_custom_buttons(State(state.clone()),Path("form".into()),Query(ListButtonsQuery{search:Some("按钮".into()),page:Some(1),page_size:Some(1)})).await.unwrap();assert_eq!(list.data.unwrap().total,1);
        let _ = delete_custom_button(State(state),Path(("form".into(),"BTN-test".into()))).await.unwrap();assert!(find_button(&db,"form","BTN-test").await.is_err());
        // Exercise conversion of legacy structure, binding cleanup, repeat migration,
        // and deletion through the owning form's foreign key in this isolated schema.
        let legacy: button::ActiveModel = row.clone().into();
        legacy.insert(&db).await.unwrap();
        db.execute_unprepared("ALTER TABLE app_custom_buttons DROP COLUMN form_uuid; ALTER TABLE app_custom_buttons ADD COLUMN button_scope TEXT DEFAULT 'public';").await.unwrap();
        db.execute_unprepared(include_str!("form_ownership.sql")).await.unwrap();
        assert_eq!(button::Entity::find().count(&db).await.unwrap(), 0);
        assert!(form_view_entity::Entity::find().all(&db).await.unwrap().iter().all(|view| view.config_json.get("customButtons").is_none()));
        let fresh: button::ActiveModel = row.into();
        fresh.insert(&db).await.unwrap();
        db.execute_unprepared(include_str!("form_ownership.sql")).await.unwrap();
        assert_eq!(button::Entity::find().count(&db).await.unwrap(), 1);
        FormDefinitionEntity::delete_many().filter(form_definition_entity::Column::FormUuid.eq("form")).exec(&db).await.unwrap();
        assert_eq!(button::Entity::find().count(&db).await.unwrap(), 0);
    }).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

#[path = "automation_tests.rs"]
mod automation_tests;
