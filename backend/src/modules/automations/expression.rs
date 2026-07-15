//! Expression evaluation and data-template helpers for automation nodes.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::platform::records::StoredFormRecord;

use super::graph::{read_json_string, read_json_value};
use super::runtime::AutomationExecutionContext;

pub(super) fn build_record_data_from_rows(
    rows: &[Value],
    outputs: &HashMap<String, Value>,
) -> Value {
    let mut result = serde_json::Map::new();

    for row in rows {
        let field_id = read_json_string(row.get("fieldId")).unwrap_or_default();
        if field_id.is_empty() {
            continue;
        }
        let value_type =
            read_json_string(row.get("valueType")).unwrap_or_else(|| "value".to_string());
        let next_value = match value_type.as_str() {
            "field" => resolve_source_field_values(
                outputs,
                &read_json_string(row.get("sourceFieldKey")).unwrap_or_default(),
            )
            .into_iter()
            .next()
            .unwrap_or(Value::Null),
            "formula" => Value::String(read_json_string(row.get("formula")).unwrap_or_default()),
            _ => read_json_value(row.get("rawValue")),
        };
        result.insert(field_id, next_value);
    }

    Value::Object(result)
}

pub(super) fn filter_records_by_expression(
    records: Vec<StoredFormRecord>,
    expression: Option<&Value>,
    context: &AutomationExecutionContext,
) -> Vec<StoredFormRecord> {
    let expression = read_json_string(expression).unwrap_or_default();
    if expression.trim().is_empty() {
        return records;
    }

    records
        .into_iter()
        .filter(|record| evaluate_record_expression(&expression, &record.record_data, context))
        .collect()
}

pub(super) fn evaluate_context_expression(
    expression: &str,
    context: &AutomationExecutionContext,
) -> bool {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return false;
    }
    evaluate_record_expression(trimmed, &json!({}), context)
}

pub(super) fn evaluate_record_expression(
    expression: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> bool {
    let clauses = expression
        .split("&&")
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if clauses.is_empty() {
        return true;
    }

    clauses
        .into_iter()
        .all(|clause| evaluate_record_clause(clause, record_data, context))
}

pub(super) fn evaluate_record_clause(
    clause: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> bool {
    let (operator, lhs, rhs) = if let Some((lhs, rhs)) = clause.split_once("!=") {
        ("!=", lhs.trim(), rhs.trim())
    } else if let Some((lhs, rhs)) = clause.split_once("==") {
        ("==", lhs.trim(), rhs.trim())
    } else {
        return false;
    };

    let left_values = resolve_expression_operand(lhs, record_data, context);
    let right_values = resolve_expression_operand(rhs, record_data, context);

    if operator == "!=" {
        left_values.iter().all(|left| {
            right_values.is_empty()
                || right_values
                    .iter()
                    .all(|right| normalize_scalar(left) != normalize_scalar(right))
        })
    } else {
        left_values.iter().any(|left| {
            right_values
                .iter()
                .any(|right| normalize_scalar(left) == normalize_scalar(right))
        })
    }
}

pub(super) fn resolve_expression_operand(
    operand: &str,
    record_data: &Value,
    context: &AutomationExecutionContext,
) -> Vec<Value> {
    let trimmed = operand.trim();
    if trimmed.is_empty() {
        return vec![Value::String(String::new())];
    }

    if let Some(token) = trimmed
        .strip_prefix("{{")
        .and_then(|value| value.strip_suffix("}}"))
    {
        return resolve_source_field_values(&context.outputs, token);
    }

    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        return vec![Value::String(trimmed[1..trimmed.len() - 1].to_string())];
    }

    if let Ok(number) = trimmed.parse::<i64>() {
        return vec![Value::Number(number.into())];
    }

    if let Ok(number) = trimmed.parse::<f64>() {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return vec![Value::Number(number)];
        }
    }

    if trimmed == "true" || trimmed == "false" {
        return vec![Value::Bool(trimmed == "true")];
    }

    match record_data {
        Value::Object(map) => map.get(trimmed).cloned().into_iter().collect(),
        _ => vec![Value::String(trimmed.to_string())],
    }
}

pub(super) fn render_text_template(template: &str, outputs: &HashMap<String, Value>) -> String {
    let mut result = String::new();
    let mut remaining = template;

    while let Some(start) = remaining.find("{{") {
        result.push_str(&remaining[..start]);
        let after_start = &remaining[start + 2..];
        if let Some(end) = after_start.find("}}") {
            let token = &after_start[..end];
            let value = resolve_source_field_values(outputs, token)
                .into_iter()
                .next()
                .map(|item| normalize_scalar(&item))
                .unwrap_or_default();
            result.push_str(&value);
            remaining = &after_start[end + 2..];
        } else {
            result.push_str(&remaining[start..]);
            remaining = "";
            break;
        }
    }

    result.push_str(remaining);
    result
}

pub(super) fn merge_record_payload(current: Value, patch: &Value) -> Value {
    let mut next = current.as_object().cloned().unwrap_or_default();
    if let Some(patch_map) = patch.as_object() {
        for (key, value) in patch_map {
            next.insert(key.clone(), value.clone());
        }
    }
    Value::Object(next)
}

pub(super) fn normalize_scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(inner) => inner.to_string(),
        Value::Number(inner) => inner.to_string(),
        Value::String(inner) => inner.trim().to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

pub(super) fn parse_multi_values(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

pub(super) fn value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(inner) => !inner.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    }
}

pub(super) fn resolve_source_field_values(
    outputs: &HashMap<String, Value>,
    source_field_key: &str,
) -> Vec<Value> {
    let Some((node_id, field_id)) = source_field_key.split_once(':') else {
        return Vec::new();
    };
    let Some(source) = outputs.get(node_id) else {
        return Vec::new();
    };

    match source {
        Value::Object(map) => map.get(field_id).cloned().into_iter().collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get(field_id).cloned())
            .collect(),
        _ => Vec::new(),
    }
}
