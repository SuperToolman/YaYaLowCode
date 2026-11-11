//! Real platform storage tests; no legacy Agent or DSH process is involved.
use super::*;
use crate::infrastructure::entities::{
    app_entity, automation_flow_version_entity, automation_run_entity,
    form_detail_definition_entity, form_schema_entity, form_storage_definition_entity,
    workflow_action_entity, workflow_instance_entity, workflow_task_entity,
};
use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; creates and removes an isolated schema"]
async fn scoped_platform_reads_database() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let namespace = format!("v2_tool_reads_{}", Uuid::new_v4().simple());
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

async fn form(
    db: &DatabaseConnection,
    app: &str,
    id: &str,
    kind: &str,
    fields: Value,
) -> form_definition_entity::Model {
    let now = chrono::Utc::now();
    let form = form_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        app_route_app_id: Set(app.into()),
        form_uuid: Set(id.into()),
        name: Set(id.into()),
        slug: Set(id.into()),
        form_type: Set(kind.into()),
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
        form_uuid: Set(id.into()),
        version: Set(1),
        schema_json: Set(schema.clone()),
        change_log: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    if kind != "detail" {
        crate::platform::form_storage::sync_current_storage_plan(db, id, 1, &schema)
            .await
            .unwrap();
    }
    form
}

fn snapshot(actions: &HashSet<String>, data: &HashSet<String>) -> Value {
    json!({"policy_version":tools::POLICY_VERSION,"action_grants":actions,"grants":data,
        "application_ids":["app-a"],"allowed_tools":tools::registry().iter().map(|t|t.id.clone()).collect::<Vec<_>>()})
}

async fn invoke(
    state: &AppState,
    scope: &Scope,
    employee: &RuntimeAiEmployee,
    current: &HashSet<String>,
    saved: &Value,
    name: &str,
    arguments: Value,
) -> Result<Value, AppError> {
    let call = ToolCall {
        id: "read-test".into(),
        name: name.into(),
        arguments,
    };
    let actions = frozen_grants(current, saved)?;
    authorize(state, scope, employee, &actions, &call, Some(saved)).await?;
    read(state, scope, employee, &actions, current, saved, &call).await
}

async fn verify(db: DatabaseConnection) {
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(app_entity::Entity),
        schema.create_table_from_entity(form_definition_entity::Entity),
        schema.create_table_from_entity(form_schema_entity::Entity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
        schema.create_table_from_entity(form_detail_definition_entity::Entity),
        schema.create_table_from_entity(automation_flow_entity::Entity),
        schema.create_table_from_entity(automation_flow_version_entity::Entity),
        schema.create_table_from_entity(iam_user_entity::Entity),
        schema.create_table_from_entity(workflow_instance_entity::Entity),
        schema.create_table_from_entity(workflow_task_entity::Entity),
        schema.create_table_from_entity(workflow_action_entity::Entity),
        schema.create_table_from_entity(automation_run_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let now = chrono::Utc::now();
    let user = Uuid::new_v4();
    let other = Uuid::new_v4();
    for (id, name) in [(user, "reader"), (other, "other")] {
        exec(&db,"INSERT INTO iam_users(id,display_name,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1::uuid,$2,false,false,false,false,'{}','active',now(),now())",vec![id.to_string().into(),name.into()]).await.unwrap();
    }
    for app in ["app-a", "app-b"] {
        app_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            route_app_id: Set(app.into()),
            name: Set(app.into()),
            description: Set(String::new()),
            icon: Set(String::new()),
            badge: Set(None),
            color: Set(String::new()),
            creator_user_id: Set(Some(user)),
            deployment_type: Set("local".into()),
            online_version: Set(None),
            online_release_id: Set(None),
            owner_name: Set("reader".into()),
            records_count: Set(0),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db)
        .await
        .unwrap();
    }
    let target = form(
        &db,
        "app-a",
        "target",
        "normal",
        json!([
            {"id":"visible","type":"input","label":"Visible"},
            {"id":"private","type":"input","label":"Private"},
            {"id":"hidden","type":"input","props":{"isHidden":true}}
        ]),
    )
    .await;
    form(&db, "app-b", "foreign", "normal", json!([])).await;
    let source = form(
        &db,
        "app-a",
        "source",
        "normal",
        json!([
            {"id":"link","type":"associationFormField","props":{"associationFormId":"target"}},
            {"id":"cross","type":"associationFormField","props":{"associationFormId":"foreign"}},
            {"id":"lines","type":"subform"}
        ]),
    )
    .await;
    form(
        &db,
        "app-a",
        "detail",
        "detail",
        json!([
            {"id":"value","type":"input"}, {"id":"private","type":"input"},
            {"id":"hidden","type":"input","props":{"isHidden":true}}
        ]),
    )
    .await;
    form_detail_definition_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        detail_form_uuid: Set("detail".into()),
        source_form_uuid: Set("source".into()),
        subform_field_id: Set("lines".into()),
        title: Set("Lines".into()),
        primary_display_field_id: Set(None),
        secondary_display_field_id: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let repo = RecordRepository::new(&db);
    let own = repo
        .insert(
            &target,
            json!({"visible":"mine","private":"secret","hidden":"hidden"}),
            &user.to_string(),
            now,
        )
        .await
        .unwrap();
    let theirs = repo
        .insert(
            &target,
            json!({"visible":"theirs","private":"secret"}),
            &other.to_string(),
            now,
        )
        .await
        .unwrap();
    let parent = repo
        .insert(
            &source,
            json!({"link":own.record_uuid,"cross":"foreign-row",
        "lines":[{"value":"first","private":"secret","hidden":"hidden"},{"value":"second"}]}),
            &user.to_string(),
            now,
        )
        .await
        .unwrap();
    let other_parent = repo
        .insert(
            &source,
            json!({"link":own.record_uuid,"lines":[{"value":"other parent"}]}),
            &other.to_string(),
            now,
        )
        .await
        .unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let scope = Scope {
        tenant_id: Uuid::new_v4(),
        user_id: user,
    };
    let mut employee = RuntimeAiEmployee {
        id: "reader".into(),
        title: "Reader".into(),
        description: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        allowed_tools: tools::registry().iter().map(|t| t.id.clone()).collect(),
        application_ids: vec![],
        avatar_url: None,
    };
    let mut current = HashSet::from(["*".to_owned()]);
    let saved_actions = HashSet::from(
        [
            "app:app-a:display",
            "app:app-a:view_development",
            "app:app-a:automation",
            "form:source:display",
            "form:target:display",
            "form:detail:display",
            "form:workflow:display",
        ]
        .map(str::to_owned),
    );
    let saved_data = HashSet::from(
        [
            "form:source:data_scope:self",
            "form:target:data_scope:self",
            "form:target:field_scope:specified",
            "form:target:field:visible:read",
            "form:detail:field_scope:specified",
            "form:detail:field:value:read",
        ]
        .map(str::to_owned),
    );
    let saved = snapshot(&saved_actions, &saved_data);

    // T09: even a current administrator cannot discover cross-application relations.
    let relationships = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_get_form_relationships",
        json!({"formUuid":"source"}),
    )
    .await
    .unwrap();
    assert_eq!(relationships["relationships"].as_array().unwrap().len(), 1);
    assert_eq!(
        relationships["relationships"][0]["targetFormUuid"],
        "target"
    );
    // T10: follow the actual association and intersect both source/target row policies.
    let related_args =
        json!({"formUuid":"source","recordUuid":parent.record_uuid,"fieldId":"link"});
    let inaccessible_target = repo
        .insert(
            &source,
            json!({"link":theirs.record_uuid}),
            &user.to_string(),
            now,
        )
        .await
        .unwrap();
    let filtered = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_get_related_records",
        json!({"formUuid":"source","recordUuid":inaccessible_target.record_uuid,"fieldId":"link"}),
    )
    .await
    .unwrap();
    assert!(filtered["items"].as_array().unwrap().is_empty());
    let related = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_get_related_records",
        related_args.clone(),
    )
    .await
    .unwrap();
    assert_eq!(related["items"].as_array().unwrap().len(), 1);
    assert_eq!(related["items"][0]["data"], json!({"visible":"mine"}));
    assert!(matches!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &saved,
            "platform_get_related_records",
            json!({"formUuid":"source","recordUuid":other_parent.record_uuid,"fieldId":"link"})
        )
        .await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &saved,
            "platform_get_related_records",
            json!({"formUuid":"source","recordUuid":parent.record_uuid,"fieldId":"cross"})
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let mut no_target = saved.clone();
    no_target["action_grants"] = json!(["app:app-a:display", "form:source:display"]);
    assert!(matches!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &no_target,
            "platform_get_related_records",
            related_args.clone()
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    employee.application_ids.clear();
    let result = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_get_related_records",
        related_args.clone(),
    )
    .await;
    assert!(
        result.is_ok(),
        "legacy employee scope is not a user permission"
    );
    // T11: pagination does not expose other owners or hidden/restricted fields.
    let list = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_list_form_records",
        json!({"formUuid":"target","pageSize":1000}),
    )
    .await
    .unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(list["items"][0]["data"], json!({"visible":"mine"}));
    let empty = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_list_form_records",
        json!({"formUuid":"target","page":2,"pageSize":1}),
    )
    .await
    .unwrap();
    assert!(empty["items"].as_array().unwrap().is_empty());
    assert!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &saved,
            "platform_list_form_records",
            json!({"formUuid":"detail"})
        )
        .await
        .is_err()
    );
    // T14: page through this parent only, projecting the detail field policy.
    let details = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &saved,
        "platform_list_detail_records",
        json!({"sourceFormUuid":"source","recordUuid":parent.record_uuid,"page":2,"pageSize":1}),
    )
    .await
    .unwrap();
    assert_eq!(details["total"], 2);
    assert_eq!(details["items"].as_array().unwrap().len(), 1);
    assert_eq!(details["items"][0]["data"], json!({"value":"second"}));
    assert!(matches!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &saved,
            "platform_list_detail_records",
            json!({"sourceFormUuid":"source","recordUuid":other_parent.record_uuid})
        )
        .await,
        Err(AppError::NotFound(_))
    ));
    let mut no_detail = saved.clone();
    no_detail["action_grants"] = json!(["app:app-a:display", "form:source:display"]);
    let denied = invoke(
        &state,
        &scope,
        &employee,
        &current,
        &no_detail,
        "platform_list_detail_records",
        json!({"sourceFormUuid":"source","recordUuid":parent.record_uuid}),
    )
    .await
    .unwrap();
    assert_eq!(denied["total"], 0);
    current = saved_actions.clone();
    current.remove("form:target:display");
    assert!(
        invoke(
            &state,
            &scope,
            &employee,
            &current,
            &saved,
            "platform_get_related_records",
            related_args
        )
        .await
        .is_err()
    );
    verify_workflow(&state, &scope, &employee, &saved).await;
}

async fn verify_workflow_runtime(
    state: &AppState,
    scope: &Scope,
    employee: &RuntimeAiEmployee,
    saved: &Value,
    form: &form_definition_entity::Model,
    flow: &automation_flow_entity::Model,
) {
    let db = &state.db;
    let current = HashSet::from(["*".into()]);
    let now = chrono::Utc::now();
    let repo = RecordRepository::new(db);
    let own = repo
        .insert(form, json!({}), &scope.user_id.to_string(), now)
        .await
        .unwrap();
    let other = repo.insert(form, json!({}), "other", now).await.unwrap();
    let mut saved = saved.clone();
    saved["grants"] = json!(["form:workflow:data_scope:self"]);
    let args = json!({"formUuid":"workflow","recordUuid":own.record_uuid});
    let empty = invoke(
        state,
        scope,
        employee,
        &current,
        &saved,
        "platform_get_workflow_record_runtime",
        args.clone(),
    )
    .await
    .unwrap();
    assert!(empty["instance"].is_null());
    assert!(empty["tasks"].as_array().unwrap().is_empty());
    let instance = Uuid::new_v4();
    exec(db,"INSERT INTO workflow_instances(id,instance_uuid,form_uuid,record_uuid,process_flow_id,flow_version,status,current_node_key,submitter,submitter_user_id,started_at,created_at,updated_at) VALUES($1::uuid,'own-instance','workflow',$2,$3::uuid,2,'running','approval','reader',$4::uuid,now(),now(),now())",
        vec![instance.to_string().into(),own.record_uuid.clone().into(),flow.id.to_string().into(),scope.user_id.to_string().into()]).await.unwrap();
    exec(db,"INSERT INTO workflow_tasks(id,task_uuid,instance_id,node_key,node_label,task_type,assignee,assignee_user_id,status,comment,created_at,updated_at) VALUES($1::uuid,'own-task',$2::uuid,'approval','Review','approval','reader',$3::uuid,'pending','private comment',now(),now())",
        vec![Uuid::new_v4().to_string().into(),instance.to_string().into(),scope.user_id.to_string().into()]).await.unwrap();
    exec(db,"INSERT INTO workflow_actions(id,instance_id,action,operator,comment,created_at) VALUES($1::uuid,$2::uuid,'submit','reader','private action comment',now())",
        vec![Uuid::new_v4().to_string().into(),instance.to_string().into()]).await.unwrap();
    let loaded = invoke(
        state,
        scope,
        employee,
        &current,
        &saved,
        "platform_get_workflow_record_runtime",
        args.clone(),
    )
    .await
    .unwrap();
    assert_eq!(loaded["instance"]["id"], "own-instance");
    assert_eq!(loaded["instance"]["flowVersion"], 2);
    assert_eq!(loaded["tasks"][0]["status"], "pending");
    assert_eq!(loaded["actions"][0]["action"], "submit");
    assert!(
        !loaded["tasks"][0]
            .as_object()
            .unwrap()
            .contains_key("comment")
    );
    assert!(
        !loaded["actions"][0]
            .as_object()
            .unwrap()
            .contains_key("comment")
    );
    assert_eq!(loaded["readOnly"], true);
    assert!(loaded["supportedOperations"].as_array().unwrap().is_empty());
    assert!(matches!(
        invoke(
            state,
            scope,
            employee,
            &current,
            &saved,
            "platform_get_workflow_record_runtime",
            json!({"formUuid":"workflow","recordUuid":other.record_uuid})
        )
        .await,
        Err(AppError::NotFound(_))
    ));
    assert!(
        invoke(
            state,
            scope,
            employee,
            &current,
            &saved,
            "platform_get_workflow_record_runtime",
            json!({"formUuid":"workflow","recordUuid":"missing"})
        )
        .await
        .is_err()
    );
    let mut no_capability = employee.clone();
    no_capability
        .allowed_tools
        .retain(|tool| tool != "platform_get_workflow_record_runtime");
    assert!(matches!(
        invoke(
            state,
            scope,
            &no_capability,
            &current,
            &saved,
            "platform_get_workflow_record_runtime",
            args.clone()
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let mut no_form = saved.clone();
    no_form["action_grants"] = json!(["app:app-a:display"]);
    assert!(matches!(
        invoke(
            state,
            scope,
            employee,
            &current,
            &no_form,
            "platform_get_workflow_record_runtime",
            args.clone()
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    // Product UI keeps comments; only the V2 model payload omits free text.
    let product =
        crate::modules::workflows::load_workflow_record_runtime(db, "workflow", &own.record_uuid)
            .await
            .unwrap();
    assert_eq!(product.tasks[0]["comment"], "private comment");
    assert_eq!(
        product.actions[0].comment.as_deref(),
        Some("private action comment")
    );
    exec(db,"INSERT INTO workflow_tasks(id,task_uuid,instance_id,node_key,node_label,task_type,assignee,status,created_at,updated_at) SELECT md5('task-'||n)::uuid,'bulk-'||n,$1::uuid,'approval','Review','approval','reader','pending',now(),now() FROM generate_series(1,205) n",
        vec![instance.to_string().into()]).await.unwrap();
    let bounded = invoke(
        state,
        scope,
        employee,
        &current,
        &saved,
        "platform_get_workflow_record_runtime",
        args,
    )
    .await
    .unwrap();
    assert_eq!(bounded["tasks"].as_array().unwrap().len(), 200);
    assert_eq!(bounded["tasksTruncated"], true);
}

async fn verify_workflow(
    state: &AppState,
    scope: &Scope,
    employee: &RuntimeAiEmployee,
    saved: &Value,
) {
    let db = &state.db;
    let workflow_form = form(db, "app-a", "workflow", "workflow", json!([])).await;
    let now = chrono::Utc::now();
    let flow = automation_flow_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        flow_uuid: Set("process".into()),
        app_route_app_id: Set("app-a".into()),
        name: Set("activity row".into()),
        description: Set(None),
        status: Set("enabled".into()),
        current_version: Set(2),
        flow_type: Set("process".into()),
        trigger_form_uuid: Set(Some("workflow".into())),
        trigger_config: Set(json!({})),
        nodes_json: Set(json!([{"id":"wrong-activity-row"}])),
        edges_json: Set(json!([])),
        created_by: Set("test".into()),
        updated_by: Set("test".into()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    for version in [1, 2] {
        automation_flow_version_entity::ActiveModel {
            id:Set(Uuid::new_v4()),flow_id:Set(flow.id),version:Set(version),name:Set(format!("version-{version}")),
            description:Set(None),status:Set("enabled".into()),trigger_form_uuid:Set(Some("workflow".into())),
            trigger_config:Set(json!({})),nodes_json:Set(json!([{"id":format!("node-{version}"),"data":{"config":{"apiKey":"never expose"}}}])),
            edges_json:Set(json!([])),change_summary:Set(None),created_by:Set("test".into()),created_at:Set(now),
        }.insert(db).await.unwrap();
    }
    let current = HashSet::from(["*".into()]);
    let args = json!({"formUuid":"workflow"});
    let output = invoke(
        state,
        scope,
        employee,
        &current,
        saved,
        "platform_get_workflow_process_definition",
        args.clone(),
    )
    .await
    .unwrap();
    assert_eq!(output["version"], 2);
    assert_eq!(output["name"], "version-2");
    assert_eq!(output["nodes"][0]["id"], "node-2");
    assert_eq!(output["nodes"][0]["data"]["config"]["apiKey"], "[REDACTED]");
    verify_workflow_runtime(state, scope, employee, saved, &workflow_form, &flow).await;
    let mut denied = saved.clone();
    denied["action_grants"] = json!(["app:app-a:display", "form:workflow:display"]);
    assert!(matches!(
        invoke(
            state,
            scope,
            employee,
            &current,
            &denied,
            "platform_get_workflow_process_definition",
            args.clone()
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    exec(
        db,
        "UPDATE automation_flows SET current_version=3 WHERE id=$1::uuid",
        vec![flow.id.to_string().into()],
    )
    .await
    .unwrap();
    assert!(matches!(
        invoke(
            state,
            scope,
            employee,
            &current,
            saved,
            "platform_get_workflow_process_definition",
            args
        )
        .await,
        Err(AppError::NotFound(_))
    ));
    assert!(
        invoke(
            state,
            scope,
            employee,
            &current,
            saved,
            "platform_get_workflow_process_definition",
            json!({"formUuid":"source"})
        )
        .await
        .is_err()
    );
}
