use super::*;

fn rules(value: Value) -> Vec<ButtonConditionRule> {
    serde_json::from_value(value).unwrap()
}
fn test_schema() -> Value {
    json!({"fields":[{"id":"customer","type":"singleLineText"},{"id":"amount","type":"number"},{"id":"tags","type":"multiSelect"}]})
}

#[test]
fn source_resolution_uses_source_not_target_and_types_defaults() {
    let rules = rules(json!([
        {"id":"customer","fieldKey":"customer","operator":"eq","valueType":"field","sourceFieldKey":"sourceCustomer"},
        {"id":"amount","fieldKey":"amount","operator":"eq","rawValue":"12"}
    ]));
    let (resolved, expected) =
        resolve_rules(&rules, &json!({"sourceCustomer":"C1"}), &test_schema()).unwrap();
    assert!(automations::expression::evaluate_record_rule_group(
        &resolved,
        None,
        &json!({"customer":"C1","amount":12})
    ));
    let defaults = defaults_group(&rules, None, &expected);
    assert_eq!(defaults["customer"], Some(json!("C1")));
    assert_eq!(defaults["amount"], Some(json!(12)));
    assert!(resolve_rules(&rules, &json!({}), &test_schema()).is_err());
}

#[test]
fn or_only_keeps_common_assignments_and_and_does_not_resurrect_conflicts() {
    let rules = rules(json!([
        {"id":"a","fieldKey":"customer","operator":"eq","rawValue":"A","logicalOperator":"and"},
        {"id":"b","fieldKey":"customer","operator":"eq","rawValue":"B","logicalOperator":"and"},
        {"id":"c","fieldKey":"customer","operator":"eq","rawValue":"A","logicalOperator":"and"}
    ]));
    let (_, expected) = resolve_rules(&rules, &json!({}), &test_schema()).unwrap();
    assert_eq!(defaults_group(&rules, None, &expected)["customer"], None);
    let mut or_rules = rules.clone();
    for rule in &mut or_rules {
        rule.logical_operator = Some("or".into());
    }
    assert!(defaults_group(&or_rules, None, &expected).is_empty());
    or_rules[1].raw_value = Some("A".into());
    let (_, expected) = resolve_rules(&or_rules, &json!({}), &test_schema()).unwrap();
    assert_eq!(
        defaults_group(&or_rules, None, &expected)["customer"],
        Some(json!("A"))
    );
}

#[test]
fn nested_groups_and_non_equality_do_not_invent_defaults() {
    let rules = rules(json!([
        {"id":"g","isGroup":true},
        {"id":"a","parentId":"g","fieldKey":"amount","operator":"eq","rawValue":"3"},
        {"id":"b","parentId":"g","fieldKey":"customer","operator":"neq","rawValue":"C2"},
        {"id":"c","fieldKey":"tags","operator":"eq","rawValue":"one,two"}
    ]));
    let (_, expected) = resolve_rules(&rules, &json!({}), &test_schema()).unwrap();
    let defaults = defaults_group(&rules, None, &expected);
    assert!(!defaults.contains_key("customer"));
    assert_eq!(defaults["amount"], Some(json!(3)));
    assert_eq!(defaults["tags"], Some(json!(["one", "two"])));
}

pub(crate) async fn verify(state: &AppState, headers: &HeaderMap, role: Uuid, source_id: &str) {
    use crate::infrastructure::entities::iam_role_permission_entity;
    let now = Utc::now();
    for permission in [
        "form:form:edit",
        "form:target:display",
        "form:target:create",
        "form:target:edit",
    ] {
        iam_role_permission_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            role_id: Set(role),
            permission: Set(permission.into()),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&state.db)
        .await
        .unwrap();
    }
    let mut target: form_definition_entity::ActiveModel =
        forms::find_form_definition(&state.db, "form")
            .await
            .unwrap()
            .into();
    target.id = Set(Uuid::new_v4());
    target.form_uuid = Set("target".into());
    target.slug = Set("target".into());
    target.insert(&state.db).await.unwrap();
    let schema = json!({"columns":6,"rows":10,"fields":[{"id":"text","label":"客户","type":"singleLineText","row":0,"column":0},{"id":"amount","type":"number","row":1,"column":0}]});
    form_schema_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        form_uuid: Set("target".into()),
        version: Set(1),
        schema_json: Set(schema.clone()),
        change_log: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await
    .unwrap();
    crate::platform::form_storage::sync_current_storage_plan(&state.db, "target", 1, &schema)
        .await
        .unwrap();
    let draft: SaveCustomButtonRequest = serde_json::from_value(json!({"name":"关联填写","description":"","actionType":"fill_form","actionConfig":{"targetAppId":"app-a","targetFormUuid":"target","associationRules":[{"id":"r","fieldKey":"text","operator":"eq","valueType":"field","sourceFieldKey":"text"}]}})).unwrap();
    let Json(created) = create_custom_button(
        State(state.clone()),
        headers.clone(),
        Path("form".into()),
        Json(draft),
    )
    .await
    .unwrap();
    let created = created.data.unwrap();
    let Json(same) = create_custom_button(State(state.clone()), headers.clone(), Path("form".into()), Json(serde_json::from_value(json!({"name":"同表填写","description":"","actionType":"fill_form","actionConfig":{"targetAppId":"app-a","targetFormUuid":"form","fieldIds":["text"]}})).unwrap())).await.unwrap();
    let same = same.data.unwrap();
    // Preserve the existing bindings used by the lifecycle test.
    let view = form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq("form"))
        .filter(form_view_entity::Column::ViewUuid.eq("default"))
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let original = view.config_json.clone();
    let mut config = original.clone();
    config["customButtons"]
        .as_array_mut()
        .unwrap()
        .extend([json!({"buttonId":created.id}), json!({"buttonId":same.id})]);
    let _ = forms::update_form_view(
        State(state.clone()),
        Path(("form".into(), "default".into())),
        Json(forms::SaveFormViewRequest {
            name: "全部数据".into(),
            config,
        }),
    )
    .await
    .unwrap();
    let path = || Path(("form".into(), "default".into(), created.id.clone()));
    let resolve = |id: Option<String>| {
        Json(ResolveButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: id,
            page: None,
        })
    };
    let Json(result) =
        resolve_view_button_fill(State(state.clone()), headers.clone(), path(), resolve(None))
            .await
            .unwrap();
    let result = result.data.unwrap();
    assert_eq!(result.operation, "create");
    assert_eq!(result.initial_values["text"], "yes");
    let flow = automations::create_automation_definition(state, "app-a", Some(serde_json::from_value(json!({
        "name":"填写后事件", "triggerFormUuid":"target", "triggerEvents":["after_create","after_update"]
    })).unwrap())).await.unwrap();
    automations::update_automation_definition(
        state,
        &flow.flow_uuid,
        serde_json::from_value(json!({"status":"enabled"})).unwrap(),
    )
    .await
    .unwrap();
    let request_id = Uuid::new_v4();
    let submit = || {
        Json(SubmitButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: None,
            operation: "create".into(),
            request_id,
            configuration_version: result.configuration_version.clone(),
            data: json!({"text":"yes","amount":7}),
        })
    };
    let (_, Json(created_record)) =
        submit_view_button(State(state.clone()), headers.clone(), path(), submit())
            .await
            .unwrap();
    let id = created_record.data.unwrap().id;
    let (_, Json(repeated)) =
        submit_view_button(State(state.clone()), headers.clone(), path(), submit())
            .await
            .unwrap();
    assert_eq!(repeated.data.unwrap().id, id);
    assert_eq!(
        RecordRepository::new(&state.db)
            .list("target")
            .await
            .unwrap()
            .len(),
        1
    );
    let events = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .all(&state.db)
        .await
        .unwrap();
    assert_eq!(
        events.len(),
        1,
        "idempotent replay must not enqueue another automation"
    );
    assert_eq!(events[0].trigger_event, "after_create");
    assert!(events[0].trigger_payload.get("updatedAt").is_some());
    let Json(found) =
        resolve_view_button_fill(State(state.clone()), headers.clone(), path(), resolve(None))
            .await
            .unwrap();
    assert_eq!(found.data.unwrap().operation, "update");
    let stale_create = Json(SubmitButtonFillRequest {
        record_id: source_id.into(),
        target_record_id: None,
        operation: "create".into(),
        request_id: Uuid::new_v4(),
        configuration_version: created.updated_at.clone(),
        data: json!({"text":"yes"}),
    });
    assert!(
        submit_view_button(State(state.clone()), headers.clone(), path(), stale_create)
            .await
            .is_err()
    );
    // Partial update keeps amount. Rules are only lookup criteria, so changing text is allowed.
    let (_, Json(updated)) = submit_view_button(
        State(state.clone()),
        headers.clone(),
        path(),
        Json(SubmitButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: Some(id.clone()),
            operation: "update".into(),
            request_id: Uuid::new_v4(),
            configuration_version: created.updated_at.clone(),
            data: json!({"text":"yes"}),
        }),
    )
    .await
    .unwrap();
    assert_eq!(updated.data.unwrap().data["amount"], 7);
    let events = AutomationRunEntity::find()
        .filter(automation_run_entity::Column::FlowId.eq(flow.id))
        .all(&state.db)
        .await
        .unwrap();
    assert!(
        events
            .iter()
            .any(|event| event.trigger_event == "after_update")
    );
    let target = forms::find_form_definition(&state.db, "target")
        .await
        .unwrap();
    for _ in 0..21 {
        RecordRepository::new(&state.db)
            .insert(&target, json!({"text":"yes"}), "test", Utc::now())
            .await
            .unwrap();
    }
    let Json(multiple) = resolve_view_button_fill(
        State(state.clone()),
        headers.clone(),
        path(),
        Json(ResolveButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: None,
            page: Some(2),
        }),
    )
    .await
    .unwrap();
    let multiple = multiple.data.unwrap();
    assert_eq!(multiple.operation, "select");
    assert_eq!(multiple.total, 22);
    assert_eq!(multiple.candidates.len(), 2);
    let Json(selected) = resolve_view_button_fill(
        State(state.clone()),
        headers.clone(),
        path(),
        resolve(Some(id.clone())),
    )
    .await
    .unwrap();
    assert_eq!(selected.data.unwrap().target_record.unwrap().id, id);
    let same_path = || Path(("form".into(), "default".into(), same.id.clone()));
    let Json(current) = resolve_view_button_fill(
        State(state.clone()),
        headers.clone(),
        same_path(),
        resolve(None),
    )
    .await
    .unwrap();
    let current = current.data.unwrap();
    assert_eq!(current.target_record.unwrap().id, source_id);
    let (_, Json(updated)) = submit_view_button(
        State(state.clone()),
        headers.clone(),
        same_path(),
        Json(SubmitButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: Some(source_id.into()),
            operation: "update".into(),
            request_id: Uuid::new_v4(),
            configuration_version: same.updated_at.clone(),
            data: json!({"text":"yes"}),
        }),
    )
    .await
    .unwrap();
    assert_eq!(updated.data.unwrap().id, source_id);
    let invalid = Json(SubmitButtonFillRequest {
        record_id: source_id.into(),
        target_record_id: Some(source_id.into()),
        operation: "update".into(),
        request_id: Uuid::new_v4(),
        configuration_version: same.updated_at.clone(),
        data: json!({"computed":99}),
    });
    assert!(
        submit_view_button(State(state.clone()), headers.clone(), same_path(), invalid)
            .await
            .is_err()
    );
    // Latest source data and target membership are checked again at submit time.
    let repository = RecordRepository::new(&state.db);
    let source = repository.find("form", source_id).await.unwrap();
    repository
        .update(&source, json!({"text":""}), "test", Utc::now())
        .await
        .unwrap();
    assert!(
        resolve_view_button_fill(State(state.clone()), headers.clone(), path(), resolve(None))
            .await
            .is_err()
    );
    let empty_source = repository.find("form", source_id).await.unwrap();
    repository
        .update(
            &empty_source,
            source.record_data.clone(),
            "test",
            Utc::now(),
        )
        .await
        .unwrap();
    let previous = repository.find("target", &id).await.unwrap();
    repository
        .update(&previous, json!({"text":"no"}), "test", Utc::now())
        .await
        .unwrap();
    let update_request = |version: String| {
        Json(SubmitButtonFillRequest {
            record_id: source_id.into(),
            target_record_id: Some(id.clone()),
            operation: "update".into(),
            request_id: Uuid::new_v4(),
            configuration_version: version,
            data: json!({"text":"yes"}),
        })
    };
    assert!(
        submit_view_button(
            State(state.clone()),
            headers.clone(),
            path(),
            update_request(created.updated_at.clone())
        )
        .await
        .is_err()
    );
    let changed = repository.find("target", &id).await.unwrap();
    repository
        .update(&changed, previous.record_data.clone(), "test", Utc::now())
        .await
        .unwrap();
    assert!(
        submit_view_button(
            State(state.clone()),
            headers.clone(),
            path(),
            update_request("old-version".into())
        )
        .await
        .is_err()
    );
    // A matching record without edit permission must never become a create.
    iam_role_permission_entity::Entity::delete_many()
        .filter(iam_role_permission_entity::Column::RoleId.eq(role))
        .filter(iam_role_permission_entity::Column::Permission.eq("form:target:edit"))
        .exec(&state.db)
        .await
        .unwrap();
    assert!(
        resolve_view_button_fill(
            State(state.clone()),
            headers.clone(),
            path(),
            resolve(Some(id.clone()))
        )
        .await
        .is_err()
    );
    iam_role_permission_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        role_id: Set(role),
        permission: Set("form:target:edit".into()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await
    .unwrap();
    // The same request cannot be reused for a different payload.
    let mut changed_replay = submit().0;
    changed_replay.data = json!({"text":"yes","amount":999});
    assert!(
        submit_view_button(
            State(state.clone()),
            headers.clone(),
            path(),
            Json(changed_replay)
        )
        .await
        .is_err()
    );
    // Concurrent retries cannot execute synchronous hooks twice.
    let transaction = state.db.begin().await.unwrap();
    RecordRepository::new(&transaction)
        .lock_button_submission("test-retry")
        .await
        .unwrap();
    let retry = state.db.begin().await.unwrap();
    assert!(
        RecordRepository::new(&retry)
            .lock_button_submission("test-retry")
            .await
            .is_err()
    );
    retry.rollback().await.unwrap();
    transaction.rollback().await.unwrap();
    // A legacy cross-form configuration is preserved, but execution is blocked.
    let row = find_button(&state.db, "form", &created.id).await.unwrap();
    let original_action = row.action_config.clone();
    let mut legacy: button::ActiveModel = row.into();
    let mut action = original_action.clone();
    action["associationRules"] = json!([]);
    legacy.action_config = Set(action);
    legacy.update(&state.db).await.unwrap();
    assert!(
        resolve_view_button_fill(State(state.clone()), headers.clone(), path(), resolve(None))
            .await
            .is_err()
    );
    let mut restored: button::ActiveModel = find_button(&state.db, "form", &created.id)
        .await
        .unwrap()
        .into();
    restored.action_config = Set(original_action);
    restored.update(&state.db).await.unwrap();
    // Workflow records retain the existing saved / execution-assignee policy.
    use crate::infrastructure::entities::{
        workflow_instance_entity as instance, workflow_task_entity as task,
    };
    let mut workflow: form_definition_entity::ActiveModel =
        forms::find_form_definition(&state.db, "target")
            .await
            .unwrap()
            .into();
    workflow.form_type = Set("workflow".into());
    workflow.update(&state.db).await.unwrap();
    let record = repository.find("target", &id).await.unwrap();
    let mut data = record.record_data.clone();
    data["workflowApprovalStatus"] = json!("reviewing");
    let record = repository
        .update(&record, data, "test", Utc::now())
        .await
        .unwrap();
    assert!(
        ensure_workflow_editable(state, headers, &record)
            .await
            .is_err()
    );
    let workflow_id = Uuid::new_v4();
    instance::ActiveModel {
        id: Set(workflow_id),
        instance_uuid: Set(Uuid::new_v4().to_string()),
        form_uuid: Set("target".into()),
        record_uuid: Set(id.clone()),
        process_flow_id: Set(flow.id),
        flow_version: Set(1),
        status: Set("running".into()),
        current_node_key: Set(Some("execution".into())),
        submitter: Set("test".into()),
        submitter_user_id: Set(None),
        started_at: Set(now),
        completed_at: Set(None),
        paused_by: Set(None),
        paused_at: Set(None),
        pause_reason: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await
    .unwrap();
    let user = authorization::current_user(headers, state).await.unwrap();
    let task = task::ActiveModel {
        id: Set(Uuid::new_v4()),
        task_uuid: Set(Uuid::new_v4().to_string()),
        instance_id: Set(workflow_id),
        node_key: Set("execution".into()),
        branch_token_id: Set(None),
        node_label: Set("执行".into()),
        task_type: Set("execution".into()),
        assignee: Set(user.display_name),
        assignee_user_id: Set(Some(user.id)),
        status: Set("pending".into()),
        comment: Set(None),
        completed_by: Set(None),
        completed_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await
    .unwrap();
    ensure_workflow_editable(state, headers, &record)
        .await
        .unwrap();
    let mut completed: task::ActiveModel = task.into();
    completed.status = Set("completed".into());
    completed.update(&state.db).await.unwrap();
    assert!(
        ensure_workflow_editable(state, headers, &record)
            .await
            .is_err()
    );
    let mut data = record.record_data.clone();
    data["workflowApprovalStatus"] = json!("saved");
    let record = repository
        .update(&record, data, "test", Utc::now())
        .await
        .unwrap();
    ensure_workflow_editable(state, headers, &record)
        .await
        .unwrap();
    let deleted = repository.find("target", &id).await.unwrap();
    repository.soft_delete(&deleted, Utc::now()).await.unwrap();
    assert!(
        submit_view_button(
            State(state.clone()),
            headers.clone(),
            path(),
            update_request(created.updated_at.clone())
        )
        .await
        .is_err()
    );
    let _ = forms::update_form_view(
        State(state.clone()),
        Path(("form".into(), "default".into())),
        Json(forms::SaveFormViewRequest {
            name: "全部数据".into(),
            config: original,
        }),
    )
    .await
    .unwrap();
    let _ = delete_custom_button(State(state.clone()), Path(("form".into(), same.id)))
        .await
        .unwrap();
    let _ = delete_custom_button(State(state.clone()), Path(("form".into(), created.id)))
        .await
        .unwrap();
}
