//! Structural validation and normalization for low-code automation graphs.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::platform::error::AppError;
use crate::shared::normalize_json_array;

use super::{
    default_node_description, default_node_label, normalize_automation_node_config,
    normalize_automation_node_kind,
};

pub(super) fn json_array_items(value: &Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

pub(super) fn read_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToString::to_string)
}

pub(super) fn read_json_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

pub(super) fn read_json_value(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

pub(super) fn normalize_automation_nodes(data: Value) -> Result<Value, AppError> {
    let mut seen_node_ids = HashSet::new();
    let items = normalize_json_array(data);
    let mut nodes = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("automation node must be object".to_string()))?;
        let node_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation node id is required".to_string()))?;

        if !seen_node_ids.insert(node_id.clone()) {
            return Err(AppError::BadRequest(
                "automation node id must be unique".to_string(),
            ));
        }

        let position = raw.get("position").and_then(Value::as_object);
        let x = read_json_number(position.and_then(|value| value.get("x"))).unwrap_or(0.0);
        let y = read_json_number(position.and_then(|value| value.get("y"))).unwrap_or(0.0);
        let data = raw
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::BadRequest("automation node data is required".to_string()))?;
        let kind = normalize_automation_node_kind(
            read_json_string(data.get("kind")).as_deref().unwrap_or(""),
        )?;

        nodes.push(json!({
            "id": node_id,
            "type": read_json_string(raw.get("type")).unwrap_or_else(|| "workflow".to_string()),
            "position": { "x": x, "y": y },
            "data": {
                "kind": kind,
                "label": read_json_string(data.get("label")).unwrap_or_else(|| default_node_label(&kind).to_string()),
                "description": read_json_string(data.get("description")).unwrap_or_else(|| default_node_description(&kind).to_string()),
                "config": normalize_automation_node_config(&kind, data.get("config").cloned().unwrap_or_else(|| json!({})))?,
            },
        }));
    }

    Ok(Value::Array(nodes))
}

pub(super) fn normalize_automation_edges(data: Value) -> Result<Value, AppError> {
    let mut seen_edge_ids = HashSet::new();
    let items = normalize_json_array(data);
    let mut edges = Vec::new();

    for item in json_array_items(&items) {
        let raw = item
            .as_object()
            .ok_or_else(|| AppError::BadRequest("automation edge must be object".to_string()))?;
        let edge_id = read_json_string(raw.get("id"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("automation edge id is required".to_string()))?;

        if !seen_edge_ids.insert(edge_id.clone()) {
            return Err(AppError::BadRequest(
                "automation edge id must be unique".to_string(),
            ));
        }

        let source = read_json_string(raw.get("source"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::BadRequest("automation edge source is required".to_string())
            })?;
        let target = read_json_string(raw.get("target"))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::BadRequest("automation edge target is required".to_string())
            })?;

        edges.push(json!({
            "id": edge_id,
            "source": source,
            "target": target,
            "sourceHandle": read_json_string(raw.get("sourceHandle")),
            "targetHandle": read_json_string(raw.get("targetHandle")),
            "type": read_json_string(raw.get("type")).unwrap_or_else(|| "insertable".to_string()),
        }));
    }

    Ok(Value::Array(edges))
}

pub(super) fn validate_automation_graph(
    nodes_json: &Value,
    edges_json: &Value,
) -> Result<(), AppError> {
    let node_ids = json_array_items(nodes_json)
        .into_iter()
        .filter_map(|item| read_json_string(item.get("id")))
        .collect::<HashSet<_>>();

    if !node_ids.iter().any(|id| id == "trigger-1") {
        return Err(AppError::BadRequest(
            "automation graph must include trigger node".to_string(),
        ));
    }

    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for edge in json_array_items(edges_json) {
        let source = read_json_string(edge.get("source")).ok_or_else(|| {
            AppError::BadRequest("automation edge source is required".to_string())
        })?;
        let target = read_json_string(edge.get("target")).ok_or_else(|| {
            AppError::BadRequest("automation edge target is required".to_string())
        })?;

        if !node_ids.contains(&source) || !node_ids.contains(&target) {
            return Err(AppError::BadRequest(
                "automation edge references unknown node".to_string(),
            ));
        }

        if target == "trigger-1" {
            return Err(AppError::BadRequest(
                "trigger node cannot be target of edge".to_string(),
            ));
        }

        if source == target {
            return Err(AppError::BadRequest(
                "automation graph cannot contain a self-referencing edge".to_string(),
            ));
        }
        outgoing.entry(source).or_default().push(target);
    }

    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for node_id in &node_ids {
        if graph_contains_cycle(node_id, &outgoing, &mut visiting, &mut visited) {
            return Err(AppError::BadRequest(
                "automation graph cannot contain a cycle".to_string(),
            ));
        }
    }

    Ok(())
}

/// Check potential execution paths from the submission root. Conditions may
/// take any configured exit; ordinary nodes follow every exit in connection order.
pub(super) fn validate_process_reachable_approval(
    nodes_json: &Value,
    edges_json: &Value,
) -> Result<(), AppError> {
    let nodes = json_array_items(nodes_json);
    let edges = json_array_items(edges_json);
    let node_map = nodes
        .iter()
        .filter_map(|node| node.get("id").and_then(Value::as_str).map(|id| (id, node)))
        .collect::<HashMap<_, _>>();
    let mut pending = vec!["trigger-1"];
    let mut visited = HashSet::new();
    while let Some(id) = pending.pop() {
        if !visited.insert(id) {
            continue;
        }
        let Some(node) = node_map.get(id) else {
            continue;
        };
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        if kind == "approval" {
            return Ok(());
        }
        let outgoing = edges
            .iter()
            .filter(|edge| edge.get("source").and_then(Value::as_str) == Some(id));
        if matches!(kind, "condition" | "parallel-condition") {
            let branches = node
                .pointer("/data/config/branches")
                .and_then(Value::as_array);
            for edge in outgoing {
                let valid_handle = branches.is_some_and(|branches| {
                    branches.iter().any(|branch| {
                        branch
                            .get("id")
                            .and_then(Value::as_str)
                            .is_some_and(|branch_id| {
                                edge.get("sourceHandle").and_then(Value::as_str)
                                    == Some(format!("condition-branch:{branch_id}").as_str())
                            })
                    })
                });
                if valid_handle {
                    if let Some(target) = edge.get("target").and_then(Value::as_str) {
                        pending.push(target);
                    }
                }
            }
        } else {
            for edge in outgoing {
                if let Some(target) = edge.get("target").and_then(Value::as_str) {
                    pending.push(target);
                }
            }
        }
    }
    Err(AppError::BadRequest(
        "审批流程必须至少存在一个从表单提交节点可抵达的审批人节点，无法保存。".to_string(),
    ))
}

fn graph_contains_cycle(
    node_id: &str,
    outgoing: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) -> bool {
    if visited.contains(node_id) {
        return false;
    }
    if !visiting.insert(node_id.to_string()) {
        return true;
    }

    let contains_cycle = outgoing
        .get(node_id)
        .into_iter()
        .flatten()
        .any(|target| graph_contains_cycle(target, outgoing, visiting, visited));
    visiting.remove(node_id);
    visited.insert(node_id.to_string());
    contains_cycle
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{validate_automation_graph, validate_process_reachable_approval};

    #[test]
    fn new_automation_trigger_node_is_a_valid_initial_graph() {
        let nodes = json!([{
            "id": "trigger-1",
            "type": "workflow",
            "position": { "x": 120.0, "y": 80.0 },
            "data": {
                "kind": "trigger",
                "label": "自动化触发时",
                "description": "自动化触发入口",
                "config": {}
            }
        }]);

        assert!(validate_automation_graph(&nodes, &json!([])).is_ok());
    }

    #[test]
    fn process_requires_reachable_approval_not_just_an_existing_node() {
        let nodes = json!([
            {"id":"trigger-1","data":{"kind":"trigger"}},
            {"id":"data","data":{"kind":"get-one"}},
            {"id":"approval","data":{"kind":"approval"}},
            {"id":"end","data":{"kind":"get-one"}}
        ]);
        assert!(validate_process_reachable_approval(&json!([nodes[0]]), &json!([])).is_err());
        assert!(
            validate_process_reachable_approval(
                &nodes,
                &json!([
                    {"source":"trigger-1","target":"data"}
                ])
            )
            .is_err()
        );
        assert!(
            validate_process_reachable_approval(
                &nodes,
                &json!([
                    {"source":"trigger-1","target":"data"},
                    {"source":"data","target":"approval"}
                ])
            )
            .is_ok()
        );
        assert!(
            validate_process_reachable_approval(
                &nodes,
                &json!([
                    {"source":"trigger-1","target":"end"},
                ])
            )
            .is_err()
        );
        assert!(
            validate_process_reachable_approval(
                &nodes,
                &json!([
                    {"source":"trigger-1","target":"data"},
                    {"source":"data","target":"data"}
                ])
            )
            .is_err()
        );
    }

    #[test]
    fn process_checks_configured_condition_exits_and_all_ordinary_exits() {
        let nodes = json!([
            {"id":"trigger-1","data":{"kind":"trigger"}},
            {"id":"condition","data":{"kind":"condition","config":{"branches":[{"id":"yes"},{"id":"otherwise"}]}}},
            {"id":"approval","data":{"kind":"approval"}},
            {"id":"end","data":{"kind":"get-one"}}
        ]);
        let mut edges = json!([
            {"source":"trigger-1","target":"condition"},
            {"source":"condition","target":"end","sourceHandle":"condition-branch:yes"},
            {"source":"condition","target":"approval","sourceHandle":"condition-branch:otherwise"}
        ]);
        assert!(validate_process_reachable_approval(&nodes, &edges).is_ok());
        edges[2]["sourceHandle"] = json!("condition-branch:removed");
        assert!(validate_process_reachable_approval(&nodes, &edges).is_err());
        assert!(
            validate_process_reachable_approval(
                &nodes,
                &json!([
                    {"source":"trigger-1","target":"end"},
                    {"source":"trigger-1","target":"approval"}
                ])
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_cycles_that_do_not_target_the_trigger() {
        let nodes = json!([
            { "id": "trigger-1" },
            { "id": "a" },
            { "id": "b" }
        ]);
        let edges = json!([
            { "source": "trigger-1", "target": "a" },
            { "source": "a", "target": "b" },
            { "source": "b", "target": "a" }
        ]);

        assert!(validate_automation_graph(&nodes, &edges).is_err());
    }
}

/// Reject retired protocols before normalization or any execution side effects.
pub(super) fn validate_current_protocol(
    nodes: &Value,
    trigger_config: &Value,
) -> Result<(), AppError> {
    if trigger_config.get("triggerEvent").is_some() {
        return Err(AppError::BadRequest(
            "旧字段 triggerEvent 不受支持，请使用 triggerEvents 数组".into(),
        ));
    }
    let events = trigger_config
        .get("triggerEvents")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::BadRequest("旧自动化配置不受支持：必须配置 triggerEvents 数组".into())
        })?;
    let events = events
        .iter()
        .map(|event| {
            event.as_str().map(str::to_string).ok_or_else(|| {
                AppError::BadRequest("triggerEvents must contain event strings".into())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    crate::shared::normalize_automation_trigger_events(events)?;
    if trigger_config.get("changedFieldsText").is_some() {
        return Err(AppError::BadRequest(
            "旧字段 changedFieldsText 不受支持".into(),
        ));
    }
    for node in nodes.as_array().into_iter().flatten() {
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        normalize_automation_node_kind(kind)?;
        let config = node
            .pointer("/data/config")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if matches!(kind, "get-one" | "get-many") {
            super::get_data::validate_query_config(&config)?;
        }
        validate_config_references(&config, matches!(kind, "condition" | "parallel-condition"))?;
        if kind == "add-data"
            && config.get("targetMode").and_then(Value::as_str) == Some("subtable")
        {
            for key in ["subformFieldId", "parentDataNodeId"] {
                if config
                    .get(key)
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
                {
                    return Err(AppError::BadRequest(format!("子表新增必须配置 {key}")));
                }
            }
            let source = config
                .get("parentDataNodeId")
                .and_then(Value::as_str)
                .unwrap();
            if !nodes.as_array().into_iter().flatten().any(|item| {
                item.get("id").and_then(Value::as_str) == Some(source)
                    && matches!(
                        item.pointer("/data/kind").and_then(Value::as_str),
                        Some("trigger" | "get-one" | "get-many")
                    )
            }) {
                return Err(AppError::BadRequest("子表来源数据节点无效".into()));
            }
        }
        if matches!(kind, "condition" | "parallel-condition")
            && !config
                .get("branches")
                .and_then(Value::as_array)
                .is_some_and(|branches| !branches.is_empty())
        {
            return Err(AppError::BadRequest(
                "条件节点必须使用 branches 配置，旧条件配置不受支持".into(),
            ));
        }
        if matches!(kind, "condition" | "parallel-condition")
            && config
                .get("branches")
                .and_then(Value::as_array)
                .is_some_and(|branches| {
                    branches
                        .iter()
                        .filter(|branch| {
                            branch.get("entryMode").and_then(Value::as_str) == Some("otherwise")
                        })
                        .count()
                        > 1
                })
        {
            return Err(AppError::BadRequest(
                "条件分支只能配置一个否则进入项".into(),
            ));
        }
        if kind == "update-data" && config.get("matchRule").is_some() {
            return Err(AppError::BadRequest(
                "更新节点仅支持 rules，旧 matchRule 不受支持".into(),
            ));
        }
        for key in ["assigneeIds", "recipientIds", "roleIds"] {
            for id in config
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if id
                    .as_str()
                    .and_then(|id| uuid::Uuid::parse_str(id).ok())
                    .is_none()
                {
                    return Err(AppError::BadRequest(format!("{key} must contain UUIDs")));
                }
            }
        }
    }
    Ok(())
}

fn validate_config_references(value: &Value, condition: bool) -> Result<(), AppError> {
    match value {
        Value::Object(map) => {
            if map.contains_key("changedFieldsText") {
                return Err(AppError::BadRequest(
                    "旧字段 changedFieldsText 不受支持".into(),
                ));
            }
            let field_reference = map.get("valueType").and_then(Value::as_str) == Some("field");
            for (key, value) in map {
                if key == "sourceFieldKey" || (condition && key == "fieldKey") {
                    if let Some(reference) = value.as_str().filter(|s| !s.is_empty()) {
                        validate_reference(reference)?;
                    } else if field_reference
                        || (condition
                            && key == "fieldKey"
                            && map.get("isGroup").and_then(Value::as_bool) != Some(true))
                    {
                        return Err(AppError::BadRequest(
                            "字段引用必须使用 nodeId:fieldId".into(),
                        ));
                    }
                }
                if let Some(text) = value.as_str() {
                    if matches!(
                        key.as_str(),
                        "expression"
                            | "formula"
                            | "multipleFormula"
                            | "bodyTemplate"
                            | "url"
                            | "headersText"
                            | "matchRule"
                    ) {
                        validate_template_references(text)?;
                        if condition && key == "expression" {
                            for clause in text.split("&&") {
                                for operator in ["!=", "=="] {
                                    if let Some((lhs, rhs)) = clause.split_once(operator) {
                                        for operand in [lhs.trim(), rhs.trim()] {
                                            if !operand.is_empty()
                                                && !operand.starts_with("{{")
                                                && !operand.starts_with(['\'', '"'])
                                                && operand.parse::<f64>().is_err()
                                                && !matches!(operand, "true" | "false" | "null")
                                            {
                                                return Err(AppError::BadRequest("条件表达式字段必须使用 {{nodeId:fieldId}}，字符串必须加引号".into()));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                validate_config_references(value, condition)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_config_references(item, condition)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn validate_template_references(text: &str) -> Result<(), AppError> {
    let mut rest = text;
    while let Some((_, tail)) = rest.split_once("{{") {
        let (reference, suffix) = tail
            .split_once("}}")
            .ok_or_else(|| AppError::BadRequest("字段引用缺少 }}".into()))?;
        validate_reference(reference.trim())?;
        rest = suffix;
    }
    Ok(())
}
fn validate_reference(reference: &str) -> Result<(), AppError> {
    if !reference.split_once(':').is_some_and(|(node, field)| {
        !node.is_empty()
            && !field.is_empty()
            && !field.contains(':')
            && !reference.chars().any(char::is_whitespace)
    }) {
        return Err(AppError::BadRequest(format!(
            "字段引用 {reference} 不受支持，必须使用 nodeId:fieldId"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod current_protocol_tests {
    use super::*;
    #[test]
    fn rejects_old_nodes_keys_and_references_without_conversion() {
        let trigger = json!({"triggerEvents":["after_create"]});
        assert!(validate_current_protocol(&json!([]), &json!({})).is_err());
        for kind in ["condition", "parallel-condition"] {
            let nodes = json!([{"data":{"kind":kind,"config":{"branches":[{"id":"a","entryMode":"otherwise"},{"id":"b","entryMode":"otherwise"}]}}}]);
            assert!(validate_current_protocol(&nodes, &trigger).is_err());
        }
        for kind in ["end", "create-record", "update-record", "delete-record"] {
            assert!(validate_current_protocol(&json!([{"data":{"kind":kind}}]), &trigger).is_err());
        }
        for config in [
            json!({"changedFieldsText":"amount"}),
            json!({"branches":[{"mode":"rules","rules":[{"fieldKey":"amount"}]}]}),
            json!({"branches":[{"mode":"expression","expression":"record.amount == 1"}]}),
            json!({"branches":[{"mode":"expression","expression":"{{record.amount}} == 1"}]}),
        ] {
            assert!(
                validate_current_protocol(
                    &json!([{"data":{"kind":"condition","config":config}}]),
                    &trigger
                )
                .is_err()
            );
        }
        assert!(
            validate_current_protocol(
                &json!([{"data":{"kind":"update-data","config":{"matchRule":""}}}]),
                &trigger
            )
            .is_err()
        );
        assert!(validate_current_protocol(&json!([{"data":{"kind":"condition","config":{"branches":[{"mode":"expression","expression":"{{trigger-1:amount}} == 1"}]}}}]),&trigger).is_ok());
        assert!(validate_current_protocol(&json!([{"data":{"kind":"get-one","config":{"filterExpression":"amount == {{trigger-1:amount}}"}}}]),&trigger).is_err());
    }
}
