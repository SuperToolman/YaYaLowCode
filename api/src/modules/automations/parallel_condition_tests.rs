use super::*;

fn context() -> AutomationExecutionContext {
    AutomationExecutionContext {
        outputs: HashMap::from([("trigger-1".into(), json!({"amount":100}))]),
        operator: "test".into(),
        run_id: None,
    }
}

fn branch_node(kind: &str) -> Value {
    json!({"id":"branch", "data":{"kind":kind,"config":{"branches":[
        {"id":"first","entryMode":"condition","mode":"expression","expression":"{{trigger-1:amount}} == 100","priority":99},
        {"id":"second","entryMode":"condition","mode":"all","priority":1},
        {"id":"miss","entryMode":"condition","mode":"expression","expression":"{{trigger-1:amount}} == 200"},
        {"id":"fallback","entryMode":"otherwise"}
    ]}}})
}

#[test]
fn parallel_condition_selects_all_matches_without_priority_and_preserves_fallback() {
    let node = branch_node("parallel-condition");
    assert_eq!(
        select_parallel_condition_branch_handles(&node, &context()),
        HashSet::from([
            "condition-branch:first".into(),
            "condition-branch:second".into()
        ])
    );
    let mut fallback = node.clone();
    fallback["data"]["config"]["branches"][1]["mode"] = json!("expression");
    fallback["data"]["config"]["branches"][1]["expression"] = json!("{{trigger-1:amount}} == 200");
    let mut input = context();
    input
        .outputs
        .insert("trigger-1".into(), json!({"amount":0}));
    assert_eq!(
        select_parallel_condition_branch_handles(&fallback, &input),
        HashSet::from(["condition-branch:fallback".into()])
    );
    fallback["data"]["config"]["branches"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(select_parallel_condition_branch_handles(&fallback, &input).is_empty());
    // The original exclusive node still picks the first branch by priority.
    assert_eq!(
        select_condition_branch_handle(&branch_node("condition"), &context()),
        Some(Some("condition-branch:second".into()))
    );
}

#[test]
fn parallel_condition_config_ignores_and_removes_priority() {
    let raw = branch_node("parallel-condition")["data"]["config"].clone();
    let normalized = normalize_automation_node_config("parallel-condition", raw.clone()).unwrap();
    assert_eq!(normalized["branches"][0]["id"], "first");
    assert!(
        normalized["branches"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b.get("priority").is_none())
    );
    assert_eq!(
        normalized,
        normalize_automation_node_config("parallel-condition", normalized.clone()).unwrap()
    );
    assert!(
        normalize_automation_node_config("parallel-condition", json!({"branches":[]})).is_err()
    );
    let mut duplicate = raw.clone();
    duplicate["branches"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"other","entryMode":"otherwise"}));
    assert!(normalize_automation_node_config("parallel-condition", duplicate).is_err());
    let nodes = json!([branch_node("parallel-condition")]);
    assert!(validate_flow_node_kinds(&nodes, "trigger").is_ok());
    assert!(validate_flow_node_kinds(&nodes, "process").is_ok());
}

#[test]
fn condition_fallback_is_unique_and_last_without_changing_branch_ids() {
    for kind in ["condition", "parallel-condition"] {
        let raw = json!({"branches":[
            {"id":"fallback","entryMode":"otherwise","mode":"rules"},
            {"id":"a","entryMode":"condition","mode":"all","priority":1},
            {"id":"b","entryMode":"condition","mode":"all","priority":2}
        ]});
        let normalized = normalize_automation_node_config(kind, raw).unwrap();
        let ids = normalized["branches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|branch| branch["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["a", "b", "fallback"]);
        let node = json!({"data":{"kind":kind,"config":normalized}});
        if kind == "condition" {
            assert_eq!(
                select_condition_branch_handle(&node, &context()),
                Some(Some("condition-branch:a".into()))
            );
        } else {
            assert_eq!(
                select_parallel_condition_branch_handles(&node, &context()),
                HashSet::from(["condition-branch:a".into(), "condition-branch:b".into()])
            );
        }
    }
}

#[tokio::test]
async fn parallel_condition_graph_runs_matching_paths_and_their_descendants() {
    let nodes = vec![
        branch_node("parallel-condition"),
        json!({"id":"first","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}),
        json!({"id":"second","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}),
        json!({"id":"child","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"first"}}}),
        json!({"id":"miss","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}),
        json!({"id":"fallback","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"trigger-1"}}}),
    ];
    let edges = ["first","second","miss","fallback"].iter().map(|id|
        json!({"source":"branch","target":id,"sourceHandle":format!("condition-branch:{id}")}))
        .chain([json!({"source":"first","target":"child"})]).collect::<Vec<_>>();
    let now = Utc::now();
    let flow = automation_flow_entity::Model {
        id: Uuid::new_v4(),
        flow_uuid: "test".into(),
        app_route_app_id: "test".into(),
        name: "test".into(),
        description: None,
        status: "enabled".into(),
        current_version: 1,
        flow_type: "trigger".into(),
        trigger_form_uuid: None,
        trigger_config: json!({"triggerEvents":["after_create"]}),
        nodes_json: json!(nodes),
        edges_json: json!(edges),
        created_by: "test".into(),
        updated_by: "test".into(),
        created_at: now,
        updated_at: now,
    };

    let mut input = context();
    execute_memory_graph(&DatabaseConnection::default(), &flow, "branch", &mut input)
        .await
        .unwrap();
    for id in ["first", "second", "child"] {
        assert_eq!(input.outputs[id], json!({"amount":100}));
    }
    assert!(!input.outputs.contains_key("miss"));
    assert!(!input.outputs.contains_key("fallback"));
    // A failing branch does not prevent a matching sibling from finishing.
    let mut failed_flow = flow.clone();
    failed_flow.nodes_json[1] =
        json!({"id":"first","data":{"kind":"http-request","config":{"url":""}}});
    let mut input = context();
    assert!(
        execute_memory_graph(
            &DatabaseConnection::default(),
            &failed_flow,
            "branch",
            &mut input
        )
        .await
        .is_err()
    );
    assert!(input.outputs.contains_key("second"));
}
