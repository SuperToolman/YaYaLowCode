//! Structural validation and normalization for low-code automation graphs.

use std::collections::HashSet;

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
    }

    Ok(())
}
