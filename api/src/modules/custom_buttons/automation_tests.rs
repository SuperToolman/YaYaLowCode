use super::*;
use crate::infrastructure::entities::{
    iam_role_permission_entity, workflow_instance_entity, workflow_notification_entity,
    workflow_task_entity,
};
use crate::modules::{automations, forms, view_custom_buttons as views};

#[test]
fn automation_action_has_an_independent_config() {
    let mut request: SaveCustomButtonRequest = serde_json::from_value(json!({
        "name":"执行", "description":"", "actionType":"run_automation",
        "actionConfig":{"automationId":"AUTO-test"}
    }))
    .unwrap();
    validate_configuration(&mut request, &json!({}), false).unwrap();
    assert_eq!(
        json!(request.action_config),
        json!({"automationId":"AUTO-test"})
    );
    request.action_config.automation_id = None;
    assert!(validate_configuration(&mut request, &json!({}), false).is_err());
    assert!(
        crate::shared::normalize_automation_trigger_events(vec!["button_click".into()]).is_ok()
    );
    assert!(
        crate::shared::normalize_automation_trigger_events(vec![
            "button_click".into(),
            "after_create".into()
        ])
        .is_err()
    );
    let source: automations::execution::TriggerSource = serde_json::from_value(json!({"kind":"form_event","event":"after_create","event_id":"old","form_uuid":null,"record_uuid":null})).unwrap();
    assert!(source.button_uuid.is_none());
}

pub(super) async fn verify(
    state: &AppState,
    headers: &HeaderMap,
    actor: Uuid,
    role: Uuid,
    record_id: &str,
) {
    let schema = sea_orm::Schema::new(state.db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(workflow_instance_entity::Entity),
        schema.create_table_from_entity(workflow_notification_entity::Entity),
        schema.create_table_from_entity(workflow_task_entity::Entity),
        schema.create_table_from_entity(AutomationFlowEntity),
        schema.create_table_from_entity(AutomationFlowVersionEntity),
        schema.create_table_from_entity(AutomationNodeEntity),
        schema.create_table_from_entity(AutomationEdgeEntity),
        schema.create_table_from_entity(AutomationRunEntity),
        schema.create_table_from_entity(AutomationRunNodeEntity),
    ] {
        state.db.execute(&statement).await.unwrap();
    }
    state
        .db
        .execute_unprepared(include_str!("../automations/execution_schema.sql"))
        .await
        .unwrap();
    assert!(
        automations::create_automation_definition(
            state,
            "app-a",
            Some(
                serde_json::from_value(json!({
                    "name":"无来源", "triggerEvents":["button_click"]
                }))
                .unwrap()
            )
        )
        .await
        .is_err()
    );
    let flow = automations::create_automation_definition(
        state,
        "app-a",
        Some(
            serde_json::from_value(json!({
                "name":"按钮自动化", "triggerEvents":["button_click"], "triggerFormUuid":"form"
            }))
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    assert_eq!(flow.trigger_form_uuid.as_deref(), Some("form"));
    let mut invalid = flow.clone();
    invalid.trigger_form_uuid = None;
    assert!(automations::validate_execution_definition(&invalid).is_err());
    assert!(
        automations::update_automation_definition(
            state,
            &flow.flow_uuid,
            serde_json::from_value(json!({"triggerFormUuid":""})).unwrap()
        )
        .await
        .is_err()
    );
    let flow_id = flow.flow_uuid.clone();
    let nodes = json!([
        {"id":"trigger-1","data":{"kind":"trigger"}},
        {"id":"read","data":{"kind":"get-one","config":{"sourceMode":"trigger","filterMode":"all"}}},
        {"id":"branch","data":{"kind":"condition","config":{"branches":[{"id":"yes","entryMode":"condition","mode":"expression","expression":"{{trigger-1:text}} == 'yes'"}]}}},
        {"id":"write","data":{"kind":"add-data","config":{"targetFormUuid":"form","rows":[{"fieldId":"text","valueType":"field","sourceFieldKey":"trigger-1:text"}]}}}
    ]);
    let edges = json!([{"id":"e1","source":"trigger-1","target":"read"},{"id":"e-read","source":"read","target":"branch"},{"id":"e2","source":"branch","target":"write","sourceHandle":"condition-branch:yes"}]);
    automations::update_automation_definition(
        state,
        &flow_id,
        serde_json::from_value(json!({"nodes":nodes,"edges":edges,"status":"enabled"})).unwrap(),
    )
    .await
    .unwrap();
    let draft: SaveCustomButtonRequest = serde_json::from_value(json!({"name":"执行A","description":"","actionType":"run_automation","actionConfig":{"automationId":flow_id}})).unwrap();
    let Json(a) = create_custom_button(
        State(state.clone()),
        headers.clone(),
        Path("form".into()),
        Json(draft.clone()),
    )
    .await
    .unwrap();
    let a = a.data.unwrap();
    let Json(b) = create_custom_button(
        State(state.clone()),
        headers.clone(),
        Path("form".into()),
        Json(draft.clone()),
    )
    .await
    .unwrap();
    let b = b.data.unwrap();
    let mut other: form_definition_entity::ActiveModel =
        forms::find_form_definition(&state.db, "form")
            .await
            .unwrap()
            .into();
    other.id = Set(Uuid::new_v4());
    other.form_uuid = Set("foreign-form".into());
    other.slug = Set("foreign".into());
    other.insert(&state.db).await.unwrap();
    assert!(
        create_custom_button(
            State(state.clone()),
            headers.clone(),
            Path("foreign-form".into()),
            Json(draft.clone())
        )
        .await
        .is_err()
    );
    let config = json!({"customButtons":([a.id.clone(),b.id.clone()].into_iter().map(|id| json!({"buttonId":id})).collect::<Vec<_>>())});
    assert!(
        views::validate_view_config(state, "foreign-form", &config)
            .await
            .is_err()
    );
    let Json(options) =
        list_button_automation_options(State(state.clone()), Path("foreign-form".into()))
            .await
            .unwrap();
    assert!(options.data.unwrap().is_empty());
    let Json(options) = list_button_automation_options(State(state.clone()), Path("form".into()))
        .await
        .unwrap();
    assert_eq!(options.data.unwrap()[0].id, flow_id);
    let _ = forms::update_form_view(
        State(state.clone()),
        Path(("form".into(), "default".into())),
        Json(forms::SaveFormViewRequest {
            name: "buttons".into(),
            config: config.clone(),
        }),
    )
    .await
    .unwrap();
    assert!(
        automations::delete_automation_definition(state, &flow_id)
            .await
            .is_err()
    );
    assert!(
        automations::update_automation_definition(
            state,
            &flow_id,
            serde_json::from_value(json!({"triggerEvents":["after_create"]})).unwrap()
        )
        .await
        .is_err()
    );
    assert!(
        automations::restore_automation_flow_version(
            State(state.clone()),
            Path((flow_id.clone(), 2)),
            None
        )
        .await
        .is_ok()
    ); // Same trigger and source can be restored.
    automations::update_automation_definition(
        state,
        &flow_id,
        serde_json::from_value(json!({"nodes":nodes,"edges":edges,"status":"enabled"})).unwrap(),
    )
    .await
    .unwrap();
    // Remove management and create permission: ordinary source readers can execute the authorized binding.
    iam_role_permission_entity::Entity::delete_many()
        .filter(iam_role_permission_entity::Column::RoleId.eq(role))
        .filter(
            iam_role_permission_entity::Column::Permission
                .is_in(["app:app-a:automation", "form:form:create"]),
        )
        .exec(&state.db)
        .await
        .unwrap();
    let request_id = Uuid::new_v4();
    let invoke = || views::ExecuteButtonRequest {
        record_id: record_id.into(),
        request_id,
    };
    let path = || Path(("form".into(), "default".into(), a.id.clone()));
    let Json(first) = views::execute_view_button(
        State(state.clone()),
        headers.clone(),
        path(),
        Json(invoke()),
    )
    .await
    .unwrap();
    let first = first.data.unwrap();
    let Json(duplicate) = views::execute_view_button(
        State(state.clone()),
        headers.clone(),
        path(),
        Json(invoke()),
    )
    .await
    .unwrap();
    assert_eq!(duplicate.data.unwrap().run_id, first.run_id);
    let Json(second) = views::execute_view_button(
        State(state.clone()),
        headers.clone(),
        Path(("form".into(), "default".into(), b.id.clone())),
        Json(invoke()),
    )
    .await
    .unwrap();
    assert_ne!(second.data.unwrap().run_id, first.run_id);
    let run = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::RunUuid.eq(&first.run_id))
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.trigger_event, "button_click");
    assert_eq!(run.trigger_payload["text"], "yes");
    let row = state
        .db
        .query_one_raw(sea_orm::Statement::from_sql_and_values(
            state.db.get_database_backend(),
            "SELECT source,identity,definition FROM automation_execution_runs WHERE run_id=$1",
            vec![run.id.into()],
        ))
        .await
        .unwrap()
        .unwrap();
    let source: Value = row.try_get("", "source").unwrap();
    let identity: Value = row.try_get("", "identity").unwrap();
    let snapshot: Value = row.try_get("", "definition").unwrap();
    assert_eq!(snapshot["triggerFormUuid"], "form");
    assert_eq!(source["form_uuid"], "form");
    assert_eq!(source["button_uuid"], a.id);
    assert_eq!(source["view_uuid"], "default");
    assert_eq!(identity["user_id"], actor.to_string());
    let before = crate::platform::records::RecordRepository::new(&state.db)
        .list("form")
        .await
        .unwrap()
        .len();
    automations::execution::drive_execution(state, run.id)
        .await
        .unwrap();
    let finished = AutomationRunEntity::find_by_id(run.id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(finished.status, "success", "{:?}", finished.error_message);
    assert_eq!(
        crate::platform::records::RecordRepository::new(&state.db)
            .list("form")
            .await
            .unwrap()
            .len(),
        before + 1
    );
    assert!(
        views::validate_view_config(state, "foreign-form", &config)
            .await
            .is_err()
    );
    // Unbound, paused, blocked and unauthenticated requests must not create executions.
    assert!(
        views::execute_view_button(
            State(state.clone()),
            headers.clone(),
            Path(("form".into(), "unsaved".into(), a.id.clone())),
            Json(invoke())
        )
        .await
        .is_err()
    );
    assert!(
        views::execute_view_button(
            State(state.clone()),
            HeaderMap::new(),
            path(),
            Json(invoke())
        )
        .await
        .is_err()
    );
    automations::update_automation_definition(
        state,
        &flow_id,
        serde_json::from_value(json!({"status":"paused"})).unwrap(),
    )
    .await
    .unwrap();
    assert!(
        views::execute_view_button(
            State(state.clone()),
            headers.clone(),
            path(),
            Json(invoke())
        )
        .await
        .is_err()
    );
    automations::update_automation_definition(
        state,
        &flow_id,
        serde_json::from_value(json!({"status":"enabled"})).unwrap(),
    )
    .await
    .unwrap();
    let _ = delete_custom_button(State(state.clone()), Path(("form".into(), a.id)))
        .await
        .unwrap();
    let _ = delete_custom_button(State(state.clone()), Path(("form".into(), b.id)))
        .await
        .unwrap();
    assert!(
        automations::ensure_no_button_references(&state.db, &flow_id)
            .await
            .is_ok()
    );
}
