use super::*;
use sea_orm::{Database, ConnectOptions, Schema};
use sea_orm_migration::{MigratorTrait, SchemaManager};

#[tokio::test]
#[ignore = "isolated schema; requires WORKFLOW_TEST_DATABASE_SETTINGS_PATH"]
async fn parallel_process_database_lifecycle() {
    let path = std::env::var("WORKFLOW_TEST_DATABASE_SETTINGS_PATH").unwrap();
    let raw: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let settings: crate::platform::config::DatabaseSettings = serde_json::from_value(raw["database"].clone()).unwrap();
    let url = settings.to_database_url();
    let admin = Database::connect(url.clone()).await.unwrap();
    let name = format!("parallel_test_{}", Uuid::new_v4().simple());
    admin.execute_unprepared(&format!("CREATE SCHEMA {name}")).await.unwrap();
    let mut options = ConnectOptions::new(url);
    options.set_schema_search_path(&name).sqlx_logging(false).max_connections(8);
    let db = Database::connect(options).await.unwrap();
    let result = tokio::spawn(async move { verify(db).await }).await;
    admin.execute_unprepared(&format!("DROP SCHEMA {name} CASCADE")).await.unwrap();
    result.unwrap();
}

async fn verify(db: sea_orm::DatabaseConnection) {
    use crate::infrastructure::entities::{form_storage_definition_entity, automation_flow_entity, form_schema_entity, app_entity, automation_run_entity, automation_run_node_entity};
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(form_definition_entity::Entity),
        schema.create_table_from_entity(form_schema_entity::Entity),
        schema.create_table_from_entity(app_entity::Entity),
        schema.create_table_from_entity(form_storage_definition_entity::Entity),
        schema.create_table_from_entity(workflow_instance_entity::Entity),
        schema.create_table_from_entity(automation_run_entity::Entity),
        schema.create_table_from_entity(automation_run_node_entity::Entity),
        schema.create_table_from_entity(workflow_action_entity::Entity),
        schema.create_table_from_entity(workflow_task_entity::Entity),
        schema.create_table_from_entity(workflow_notification_entity::Entity),
        schema.create_table_from_entity(iam_user_entity::Entity),
        schema.create_table_from_entity(automation_flow_entity::Entity),
        schema.create_table_from_entity(automation_flow_version_entity::Entity),
    ] { db.execute(&statement).await.unwrap(); }
    crate::infrastructure::migrator::Migrator::migrations().into_iter()
        .find(|m| m.name().contains("workflow_parallel_branches")).unwrap()
        .up(&SchemaManager::new(&db)).await.unwrap();
    crate::infrastructure::migrator::Migrator::migrations().into_iter()
        .find(|m| m.name().contains("unified_automation_engine")).unwrap()
        .up(&SchemaManager::new(&db)).await.unwrap();
    crate::infrastructure::migrator::Migrator::migrations().into_iter()
        .find(|m| m.name().contains("remove_automation_compatibility")).unwrap()
        .up(&SchemaManager::new(&db)).await.unwrap();
    db.execute_unprepared("CREATE TABLE im_business_message_bindings(message_id UUID PRIMARY KEY, business_type TEXT, business_id UUID, status TEXT)").await.unwrap();
    db.execute_unprepared("CREATE TABLE im_messages(id UUID PRIMARY KEY, message_uuid TEXT UNIQUE, payload_json JSONB)").await.unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db, None, 1, shutdown);
    let now = Utc::now();
    let user_id = Uuid::new_v4();
    let definition = form_definition_entity::ActiveModel {
        id:Set(Uuid::new_v4()), app_route_app_id:Set("test".into()), form_uuid:Set("test-form".into()),
        name:Set("test".into()), slug:Set("test".into()), form_type:Set("workflow".into()),
        current_schema_version:Set(1), latest_schema_version:Set(1), created_at:Set(now),updated_at:Set(now),
    }.insert(&state.db).await.unwrap();
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()), form_uuid: Set("test-form".into()), version: Set(1),
        schema_json: Set(json!({"fields":[]})), change_log: Set(None),
        created_at: Set(now), updated_at: Set(now),
    }.insert(&state.db).await.unwrap();
    crate::platform::form_storage::sync_current_storage_plan(&state.db,"test-form",1,&json!({"fields":[]})).await.unwrap();
    let record = RecordRepository::new(&state.db).insert(&definition,json!({"amount":100}),"test",now).await.unwrap();
    let flow = automation_flow_entity::Model {
        id:Uuid::new_v4(),flow_uuid:"test-flow".into(),app_route_app_id:"test".into(),name:"test".into(),
        description:None,status:"enabled".into(),current_version:1,flow_type:"process".into(),trigger_form_uuid:Some("test-form".into()),
        trigger_config:json!({"triggerEvents":["form_submit"]}),created_by:"test".into(),updated_by:"test".into(),created_at:now,updated_at:now,
        nodes_json:json!([
            {"id":"trigger-1","data":{"kind":"trigger"}},
            {"id":"parallel","data":{"kind":"parallel-condition","config":{"branches":[
                {"id":"a","entryMode":"condition","mode":"all"},
                {"id":"b","entryMode":"condition","mode":"all"},
                {"id":"otherwise","entryMode":"otherwise"}
            ]}}},
            {"id":"a","data":{"kind":"approval","config":{"assigneeMode":"self"}}},
            {"id":"b","data":{"kind":"approval","config":{"assigneeMode":"self"}}},
            {"id":"fallback","data":{"kind":"get-one"}},
            {"id":"query","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"pre"}}},
            {"id":"pre","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}
        ]),
        edges_json:json!([
            {"source":"trigger-1","target":"pre"},
            {"source":"parallel","target":"a","sourceHandle":"condition-branch:a"},
            {"source":"parallel","target":"b","sourceHandle":"condition-branch:b"},
            {"source":"parallel","target":"fallback","sourceHandle":"condition-branch:otherwise"},
            {"source":"a","target":"query"},
            {"source":"pre","target":"parallel"}
        ]),
    };
    let instance = workflow_instance_entity::ActiveModel {
        id:Set(Uuid::new_v4()),instance_uuid:Set("test-instance".into()),form_uuid:Set("test-form".into()),record_uuid:Set(record.record_uuid.clone()),
        process_flow_id:Set(flow.id),flow_version:Set(1),status:Set("running".into()),current_node_key:Set(Some("trigger-1".into())),submitter:Set("test".into()),submitter_user_id:Set(Some(user_id)),
        started_at:Set(now),completed_at:Set(None),paused_by:Set(None),paused_at:Set(None),pause_reason:Set(None),created_at:Set(now),updated_at:Set(now),
    }.insert(&state.db).await.unwrap();
    start(&state,&flow,&instance,&record.record_data).await.unwrap();
    let tasks = workflow_task_entity::Entity::find().all(&state.db).await.unwrap();
    assert_eq!(tasks.len(),2);
    assert!(tasks.iter().all(|t| t.branch_token_id.is_some() && t.status == "pending"));
    let a=tasks.iter().find(|t|t.node_key=="a").unwrap();
    let b=tasks.iter().find(|t|t.node_key=="b").unwrap();
    assert_ne!(a.branch_token_id,b.branch_token_id);
    let mut done: workflow_task_entity::ActiveModel = a.clone().into();
    done.status = Set("completed".into()); done.update(&state.db).await.unwrap();
    let txn=state.db.begin().await.unwrap();
    let latest=lock_instance(&txn,instance.id).await.unwrap();
    assert!(claim_waiting_branch(&txn,instance.id,a.branch_token_id.unwrap(),"a").await.unwrap());
    assert!(!claim_waiting_branch(&txn,instance.id,a.branch_token_id.unwrap(),"a").await.unwrap());
    assert_eq!(latest.status,"running");
    txn.commit().await.unwrap();
    resume_branch(&state,&flow,&instance,a.branch_token_id.unwrap(),&record.record_data).await.unwrap();
    assert_eq!(workflow_instance_entity::Entity::find_by_id(instance.id).one(&state.db).await.unwrap().unwrap().status,"running");
    let row=state.db.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,"SELECT outputs FROM workflow_branch_tokens WHERE id=$1",vec![a.branch_token_id.unwrap().into()])).await.unwrap().unwrap();
    let outputs:Value=row.try_get("","outputs").unwrap();
    assert_eq!(outputs["query"],json!({"amount":100}));
    let mut done: workflow_task_entity::ActiveModel = b.clone().into();
    done.status = Set("completed".into()); done.update(&state.db).await.unwrap();
    assert!(claim_waiting_branch(&state.db,instance.id,b.branch_token_id.unwrap(),"b").await.unwrap());
    // A paused instance must leave the cursor queued until resume.
    let mut paused:workflow_instance_entity::ActiveModel=instance.clone().into();
    paused.status=Set("paused".into());paused.update(&state.db).await.unwrap();
    resume_branch(&state,&flow,&instance,b.branch_token_id.unwrap(),&record.record_data).await.unwrap();
    assert_eq!(workflow_instance_entity::Entity::find_by_id(instance.id).one(&state.db).await.unwrap().unwrap().status,"paused");
    let mut active:workflow_instance_entity::ActiveModel=instance.clone().into();active.status=Set("running".into());active.update(&state.db).await.unwrap();
    resume_queued(&state,&flow,&instance).await.unwrap();
    assert_eq!(workflow_instance_entity::Entity::find_by_id(instance.id).one(&state.db).await.unwrap().unwrap().status,"completed");

    // Otherwise is selected only when all normal branches fail; without it the
    // current path ends. Neither case creates an approval task.
    let mut unmatched = flow.clone();
    for branch in unmatched.nodes_json[1]["data"]["config"]["branches"].as_array_mut().unwrap().iter_mut().take(2) {
        branch["mode"] = json!("expression");
        branch["expression"] = json!("{{trigger-1:amount}} == 200");
    }
    let outputs = HashMap::from([("trigger-1".into(), record.record_data.clone())]);
    assert_eq!(test_targets(&unmatched, &unmatched.nodes_json[1], &outputs), vec!["fallback"]);
    unmatched.nodes_json[1]["data"]["config"]["branches"].as_array_mut().unwrap().pop();
    assert!(test_targets(&unmatched, &unmatched.nodes_json[1], &outputs).is_empty());
    let empty = new_instance(&state, &instance).await;
    start(&state, &unmatched, &empty, &record.record_data).await.unwrap();
    assert_eq!(workflow_instance_entity::Entity::find_by_id(empty.id).one(&state.db).await.unwrap().unwrap().status, "completed");

    // Nested branching can reach the same approval node through separate
    // cursors. An "any" approval may skip only its own cursor's assignees.
    let mut nested = flow.clone();
    let mut inner = flow.nodes_json[1].clone(); inner["id"] = json!("inner");
    nested.nodes_json.as_array_mut().unwrap().push(inner);
    nested.edges_json[2]["target"] = json!("inner");
    nested.edges_json.as_array_mut().unwrap().extend([
        json!({"source":"inner","target":"a","sourceHandle":"condition-branch:a"}),
        json!({"source":"inner","target":"b","sourceHandle":"condition-branch:b"}),
    ]);
    let nested_instance = new_instance(&state, &instance).await;
    start(&state, &nested, &nested_instance, &record.record_data).await.unwrap();
    let tasks = workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(nested_instance.id)).all(&state.db).await.unwrap();
    assert_eq!(tasks.len(), 3);
    let first = tasks.iter().find(|task| task.node_key == "a").unwrap();
    skip_pending_tasks(&state.db, &nested_instance, Some("a"), "其他审批人已同意", now, first.branch_token_id).await.unwrap();
    assert_eq!(workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(nested_instance.id)).filter(workflow_task_entity::Column::Status.eq("pending")).count(&state.db).await.unwrap(), 2);
    // Rejecting the instance cancels every sibling and blocks queued work.
    let txn = state.db.begin().await.unwrap();
    let latest = lock_instance(&txn, nested_instance.id).await.unwrap();
    skip_pending_tasks(&txn, &latest, None, "其他审批人已驳回", now, None).await.unwrap();
    complete_instance(&txn, &latest, "rejected", "rejected", "completed", "已拒绝", "test").await.unwrap();
    txn.commit().await.unwrap();
    resume_queued(&state, &nested, &nested_instance).await.unwrap();
    assert_eq!(workflow_instance_entity::Entity::find_by_id(nested_instance.id).one(&state.db).await.unwrap().unwrap().status, "rejected");
    assert_eq!(workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(nested_instance.id)).filter(workflow_task_entity::Column::Status.eq("pending")).count(&state.db).await.unwrap(), 0);

    // Ordinary fanout and exclusive conditions use the exact same transitions
    // and handlers as the in-memory adapter, including branch-local outputs.
    let mut automatic = flow.clone();
    automatic.nodes_json = json!([
        {"id":"trigger-1","data":{"kind":"trigger"}},
        {"id":"one","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}},
        {"id":"many","data":{"kind":"get-many","config":{"sourceMode":"data-node","dataNodeId":"one"}}},
        {"id":"isolated","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"one"}}},
        {"id":"check","data":{"kind":"condition","config":{"branches":[{"id":"yes","mode":"expression","expression":"{{one:amount}} == 100","priority":1},{"id":"fallback","entryMode":"otherwise"}]}}},
        {"id":"leaf","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"many"}}}
    ]);
    automatic.edges_json = json!([
        {"source":"trigger-1","target":"one"},{"source":"trigger-1","target":"isolated"},
        {"source":"one","target":"many"},{"source":"many","target":"check"},
        {"source":"check","target":"leaf","sourceHandle":"condition-branch:yes"}
    ]);
    let runtime = engine::MemoryRuntime { db: &state.db, flow: &automatic, outputs: std::sync::Mutex::new(HashMap::new()) };
    let memory_context = AutomationExecutionContext { outputs: HashMap::from([("trigger-1".into(), record.record_data.clone())]), operator:"系统".into(), run_id:None };
    engine::drive(&runtime, Cursor { id:Uuid::new_v4(), node:"trigger-1".into(), context:memory_context, depth:0, log_id:None, parallel_group:None }).await.unwrap();
    let comparison = new_instance(&state, &instance).await;
    start(&state, &automatic, &comparison, &record.record_data).await.unwrap();
    let run = automation_run_entity::Entity::find().filter(automation_run_entity::Column::WorkflowInstanceId.eq(comparison.id)).one(&state.db).await.unwrap().unwrap();
    assert_eq!(run.status, "success");
    let logs = automation_run_node_entity::Entity::find().filter(automation_run_node_entity::Column::RunId.eq(run.id)).all(&state.db).await.unwrap();
    for node in ["one", "many", "isolated", "leaf"] {
        assert_eq!(logs.iter().find(|log|log.node_key==node).unwrap().output_json.as_ref().unwrap(), &runtime.outputs.lock().unwrap()[node]);
    }
    assert_eq!(runtime.outputs.lock().unwrap()["isolated"], Value::Null);

    // A plain ordinary node can start two independent human paths in order.
    let mut ordinary = flow.clone();
    ordinary.edges_json = json!([{"source":"trigger-1","target":"a"},{"source":"trigger-1","target":"b"}]);
    let ordinary_instance = new_instance(&state, &instance).await;
    start(&state, &ordinary, &ordinary_instance, &record.record_data).await.unwrap();
    assert_eq!(workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(ordinary_instance.id)).count(&state.db).await.unwrap(), 2);

    // Exercise the real action handler, including authorization, pinned graph,
    // duplicate submissions and final human-log output, rather than manual SQL.
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO iam_users(id,display_name,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1,'test',false,false,false,false,'{}','disabled',NOW(),NOW())",vec![user_id.into()])).await.unwrap();
    let secret = std::env::var("AUTH_TOKEN_SECRET").unwrap_or_else(|_|"yaya-development-token-secret".into());
    let token = jsonwebtoken::encode(&jsonwebtoken::Header::default(), &json!({"sub":user_id.to_string(),"exp":(Utc::now()+chrono::Duration::hours(1)).timestamp()}), &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes())).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
    let mut action_flow = flow.clone();
    action_flow.edges_json = json!([{"source":"trigger-1","target":"a"}]);
    let active_flow: automation_flow_entity::ActiveModel = action_flow.clone().into();
    active_flow.insert(&state.db).await.unwrap();
    automation_flow_version_entity::ActiveModel {
        id:Set(Uuid::new_v4()),flow_id:Set(flow.id),version:Set(1),name:Set(flow.name.clone()),description:Set(None),status:Set("enabled".into()),
        trigger_form_uuid:Set(flow.trigger_form_uuid.clone()),trigger_config:Set(flow.trigger_config.clone()),
        nodes_json:Set(action_flow.nodes_json.clone()),edges_json:Set(action_flow.edges_json.clone()),change_summary:Set(None),created_by:Set("test".into()),created_at:Set(now),
    }.insert(&state.db).await.unwrap();
    let actionable = new_instance(&state, &instance).await;
    start(&state,&action_flow,&actionable,&record.record_data).await.unwrap();
    let task = workflow_task_entity::Entity::find().filter(workflow_task_entity::Column::InstanceId.eq(actionable.id)).one(&state.db).await.unwrap().unwrap();
    let mut obsolete: workflow_instance_entity::ActiveModel = actionable.clone().into();
    obsolete.submitter_user_id = Set(None); obsolete.update(&state.db).await.unwrap();
    assert!(super::super::complete_task(state.clone(),headers.clone(),task.task_uuid.clone(),None,true,None,None,None).await.is_err());
    let mut current: workflow_instance_entity::ActiveModel = actionable.clone().into();
    current.submitter_user_id = Set(Some(user_id)); current.update(&state.db).await.unwrap();
    let card_id = Uuid::new_v4();
    let public_id = format!("WFN-{}", card_id.simple());
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO im_messages VALUES($1,$2,$3)", vec![card_id.into(), public_id.clone().into(), json!({"version":1}).into()])).await.unwrap();
    state.db.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO im_business_message_bindings VALUES($1,'approval',$2,'active')", vec![card_id.into(), task.id.into()])).await.unwrap();
    assert!(super::super::complete_task(state.clone(),headers.clone(),task.task_uuid.clone(),None,true,None,Some(2),Some(public_id.clone())).await.is_err());
    assert_eq!(workflow_task_entity::Entity::find_by_id(task.id).one(&state.db).await.unwrap().unwrap().status,"pending");
    assert!(super::super::complete_task(state.clone(),headers.clone(),task.task_uuid.clone(),None,true,None,Some(1),Some(public_id.clone())).await.is_ok());
    assert!(super::super::complete_task(state.clone(),headers.clone(),task.task_uuid.clone(),None,true,None,Some(1),Some(public_id)).await.is_err());
    assert!(super::super::complete_task(state.clone(),headers,task.task_uuid.clone(),None,true,None,None,None).await.is_err());
    let log = automation_run_node_entity::Entity::find().filter(automation_run_node_entity::Column::BranchId.eq(task.branch_token_id.unwrap()))
        .filter(automation_run_node_entity::Column::NodeKey.eq("a")).one(&state.db).await.unwrap().unwrap();
    assert_eq!(log.status,"success");
    assert_eq!(log.output_json.unwrap()["tasks"][0]["status"],"approved");
    assert_eq!(workflow_instance_entity::Entity::find_by_id(actionable.id).one(&state.db).await.unwrap().unwrap().status,"completed");
    let response = crate::modules::automations::list_automation_flow_runs(State(state.clone()),Path(flow.flow_uuid.clone())).await.unwrap().0;
    let runs = response.data.unwrap();
    assert!(runs.iter().any(|run|run.workflow_instance_id.as_deref()==Some(actionable.instance_uuid.as_str()) && run.nodes.iter().any(|node|node.branch_id.is_some())));
    let process_run = runs.iter().find(|run|run.workflow_instance_id.as_deref()==Some(actionable.instance_uuid.as_str())).unwrap();
    assert!(crate::modules::automations::retry_automation_flow_run(State(state.clone()),Path((flow.flow_uuid.clone(),process_run.id.clone()))).await.is_err());
    assert!(crate::modules::automations::retry_automation_flow_run_node(State(state.clone()),Path((flow.flow_uuid.clone(),process_run.id.clone(),"a".into()))).await.is_err());
    let mut trigger = action_flow.clone();
    trigger.id=Uuid::new_v4();trigger.flow_uuid="trigger-test".into();trigger.flow_type="trigger".into();
    trigger.trigger_config=json!({"triggerEvents":["after_create"]});
    trigger.nodes_json.as_array_mut().unwrap().retain(|node| matches!(node["id"].as_str(),Some("trigger-1"|"pre")));
    trigger.edges_json=json!([{"source":"trigger-1","target":"pre"}]);
    let trigger_active: automation_flow_entity::ActiveModel=trigger.clone().into();trigger_active.insert(&state.db).await.unwrap();
    let seed = crate::platform::automation_runs::create_automation_run(&state.db,&trigger,"after_create",&record.record_data,None,None,None).await.unwrap();
    let _ = crate::modules::automations::retry_automation_flow_run(State(state.clone()),Path((trigger.flow_uuid.clone(),seed.run_uuid))).await.unwrap();
    let trigger_logs = crate::modules::automations::list_automation_flow_runs(State(state.clone()),Path(trigger.flow_uuid.clone())).await.unwrap().0.data.unwrap();
    let retried=trigger_logs.iter().find(|run|run.status=="success").unwrap();
    assert!(retried.workflow_instance_id.is_none());
    let _ = crate::modules::automations::retry_automation_flow_run_node(State(state.clone()),Path((trigger.flow_uuid,retried.id.clone(),"pre".into()))).await.unwrap();
}

async fn new_instance(state: &AppState, template: &workflow_instance_entity::Model) -> workflow_instance_entity::Model {
    let mut instance: workflow_instance_entity::ActiveModel = template.clone().into();
    instance.id = Set(Uuid::new_v4());
    instance.instance_uuid = Set(Uuid::new_v4().to_string());
    instance.insert(&state.db).await.unwrap()
}

fn test_targets(flow: &automation_flow_entity::Model, node: &Value, outputs: &HashMap<String, Value>) -> Vec<String> {
    let context = AutomationExecutionContext { outputs: outputs.clone(), operator: "test".into(), run_id: None };
    match engine::transition(flow, node, &context) {
        Transition::End => vec![], Transition::Continue(next) => vec![next], Transition::Split { targets, .. } => targets,
    }
}
