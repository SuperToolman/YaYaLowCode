//! Shared, versioned condition references and comparisons. Legacy strings remain readable.
use crate::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub(crate) const PATH_PREFIX: &str = "__condition_path_v2__:";
pub(crate) const VALUE_PREFIX: &str = "__condition_value_v2__:";
pub(crate) const OPERATORS: &[&str] = &[
    "eq",
    "neq",
    "inAny",
    "notInAny",
    "hasValue",
    "noValue",
    "contains",
    "notContains",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "containsAny",
    "containsAll",
    "containsNone",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FieldReference {
    pub root: String,
    pub path: Vec<String>,
}
pub(crate) fn reference(key: &str) -> Result<FieldReference, AppError> {
    let value = if let Some(encoded) = key.strip_prefix(PATH_PREFIX) {
        serde_json::from_str(encoded).map_err(|_| bad("关联字段路径格式无效"))?
    } else {
        FieldReference {
            root: key.into(),
            path: vec![],
        }
    };
    if value.root.is_empty() || value.path.len() > 8 || value.path.iter().any(|id| id.is_empty()) {
        return Err(bad("字段路径为空或超过8层"));
    }
    Ok(value)
}
pub(crate) fn root_key(key: &str) -> String {
    reference(key).map(|r| r.root).unwrap_or_default()
}
pub(crate) fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
pub(crate) fn literal(raw: &str) -> Result<Value, AppError> {
    match raw.strip_prefix(VALUE_PREFIX) {
        Some(encoded) => {
            let value: Value = serde_json::from_str(encoded).map_err(|_| bad("条件值格式无效"))?;
            if value.is_object()
                || value.as_array().is_some_and(|items| {
                    items.len() > 500 || items.iter().any(|v| v.is_object() || v.is_array())
                })
            {
                return Err(bad("条件值必须为标量或一维数组"));
            }
            Ok(value)
        }
        None => Ok(Value::String(raw.trim().into())),
    }
}
pub(crate) fn scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.trim().into(),
        _ => value.to_string(),
    }
}
pub(crate) fn has_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(v) => !v.is_empty(),
        Value::Object(v) => !v.is_empty(),
        _ => true,
    }
}
fn datetime(value: &Value) -> Option<i64> {
    let text = scalar(value);
    let text = text.split('[').next()?;
    if !text.contains('T') {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|v| v.timestamp_millis())
        .ok()
        .or_else(|| {
            [
                "%Y-%m-%dT%H:%M",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M:%S%.f",
            ]
            .iter()
            .find_map(|format| {
                chrono::NaiveDateTime::parse_from_str(text, format)
                    .ok()
                    .map(|v| v.and_utc().timestamp_millis())
            })
        })
}
fn equal(a: &Value, b: &Value) -> bool {
    if a.is_number() || b.is_number() {
        return has_value(a)
            && has_value(b)
            && scalar(a)
                .parse::<f64>()
                .ok()
                .zip(scalar(b).parse::<f64>().ok())
                .is_some_and(|(a, b)| a == b);
    }
    if let (Some(a), Some(b)) = (datetime(a), datetime(b)) {
        return a == b;
    }
    scalar(a) == scalar(b)
}
fn order(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    if !has_value(a) || !has_value(b) {
        return None;
    }
    if a.is_number() || b.is_number() {
        return scalar(a)
            .parse::<f64>()
            .ok()?
            .partial_cmp(&scalar(b).parse::<f64>().ok()?);
    }
    if let (Some(a), Some(b)) = (datetime(a), datetime(b)) {
        return Some(a.cmp(&b));
    }
    Some(scalar(a).cmp(&scalar(b)))
}
pub(crate) fn compare(a: &Value, op: &str, b: &Value) -> bool {
    let list = b.as_array().cloned().unwrap_or_else(|| {
        scalar(b)
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| Value::String(s.into()))
            .collect()
    });
    let items = a
        .as_array()
        .cloned()
        .unwrap_or_else(|| if a.is_null() { vec![] } else { vec![a.clone()] });
    use std::cmp::Ordering::*;
    match op {
        "hasValue" => has_value(a),
        "noValue" => !has_value(a),
        "eq" => !a.is_null() && equal(a, b),
        "neq" => a.is_null() || !equal(a, b),
        "inAny" => !a.is_null() && list.iter().any(|v| equal(a, v)),
        "notInAny" => a.is_null() || !list.iter().any(|v| equal(a, v)),
        "contains" => !a.is_null() && scalar(a).contains(&scalar(b)),
        "notContains" => a.is_null() || !scalar(a).contains(&scalar(b)),
        "containsAny" => items.iter().any(|v| list.iter().any(|b| equal(v, b))),
        "containsAll" => !list.is_empty() && list.iter().all(|b| items.iter().any(|v| equal(v, b))),
        "containsNone" => !items.iter().any(|v| list.iter().any(|b| equal(v, b))),
        "gt" => order(a, b) == Some(Greater),
        "gte" => matches!(order(a, b), Some(Greater | Equal)),
        "lt" => order(a, b) == Some(Less),
        "lte" => matches!(order(a, b), Some(Less | Equal)),
        "between" => {
            list.len() == 2
                && matches!(order(a, &list[0]), Some(Greater | Equal))
                && matches!(order(a, &list[1]), Some(Less | Equal))
        }
        _ => false,
    }
}

pub(crate) fn validate_rules(rules: &[Value]) -> Result<(), AppError> {
    if rules.is_empty() || rules.len() > 200 {
        return Err(bad("条件数量必须为1～200条"));
    }
    let mut parents = HashMap::new();
    for rule in rules {
        let id = rule["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| bad("条件ID为空"))?;
        if parents
            .insert(id, rule["parentId"].as_str().filter(|s| !s.is_empty()))
            .is_some()
        {
            return Err(bad("条件ID重复"));
        }
        if rule
            .get("logicalOperator")
            .and_then(Value::as_str)
            .is_some_and(|op| !["and", "or"].contains(&op))
        {
            return Err(bad("条件组逻辑无效"));
        }
        if rule["isGroup"] != true {
            reference(rule["fieldKey"].as_str().unwrap_or(""))?;
            let op = rule["operator"].as_str().unwrap_or("eq");
            if rule
                .get("valueType")
                .is_some_and(|v| !v.is_null() && !matches!(v.as_str(), Some("value" | "field")))
            {
                return Err(bad("条件值类型无效"));
            }
            if !OPERATORS.contains(&op) {
                return Err(bad("条件运算符无效"));
            }
            if !["hasValue", "noValue"].contains(&op) {
                if rule["valueType"] == "field" {
                    reference(rule["sourceFieldKey"].as_str().unwrap_or(""))?;
                } else {
                    let value = literal(rule["rawValue"].as_str().unwrap_or(""))?;
                    if !has_value(&value) {
                        return Err(bad("条件值不能为空"));
                    }
                    if value
                        .as_array()
                        .is_some_and(|items| items.iter().any(|item| !has_value(item)))
                    {
                        return Err(bad("条件值包含空选项"));
                    }
                    if op == "between"
                        && !value.as_array().is_some_and(|v| {
                            v.len() == 2
                                && v.iter().all(has_value)
                                && order(&v[0], &v[1])
                                    .is_some_and(|o| o != std::cmp::Ordering::Greater)
                        })
                    {
                        return Err(bad("条件区间无效"));
                    }
                }
            }
        }
    }
    for (id, parent) in &parents {
        let mut visited = HashSet::from([*id]);
        let mut p = *parent;
        while let Some(id) = p {
            if !visited.insert(id) {
                return Err(bad("条件分组循环"));
            }
            p = *parents.get(id).ok_or_else(|| bad("条件父组不存在"))?;
        }
    }
    if !rules.iter().any(|rule| rule["isGroup"] != true) {
        return Err(bad("条件组缺少条件项"));
    }
    for rule in rules.iter().filter(|rule| rule["isGroup"] == true) {
        if !rules.iter().any(|child| child["parentId"] == rule["id"]) {
            return Err(bad("条件组不能为空"));
        }
    }
    Ok(())
}

pub(crate) fn evaluate(rules: &[Value], parent: Option<&str>, data: &Value) -> bool {
    let siblings: Vec<_> = rules
        .iter()
        .filter(|r| r["parentId"].as_str().filter(|s| !s.is_empty()) == parent)
        .collect();
    let or = siblings
        .first()
        .is_some_and(|r| r["logicalOperator"] == "or");
    let results = siblings.iter().map(|rule| {
        let key = rule["fieldKey"].as_str().unwrap_or("");
        let expected = if rule["valueType"] == "field" {
            data.get(rule["sourceFieldKey"].as_str().unwrap_or(""))
                .cloned()
                .unwrap_or(Value::Null)
        } else {
            literal(rule["rawValue"].as_str().unwrap_or("")).unwrap_or(Value::Null)
        };
        let own = compare(
            data.get(key).unwrap_or(&Value::Null),
            rule["operator"].as_str().unwrap_or("eq"),
            &expected,
        );
        let id = rule["id"].as_str();
        let children: Vec<_> = rules
            .iter()
            .filter(|r| r["parentId"].as_str().is_some() && r["parentId"].as_str() == id)
            .collect();
        if rule["isGroup"] == true {
            evaluate(rules, id, data)
        } else if children.is_empty() {
            own
        } else if children[0]["logicalOperator"] == "or" {
            own || evaluate(rules, id, data)
        } else {
            own && evaluate(rules, id, data)
        }
    });
    if siblings.is_empty() {
        true
    } else if or {
        results.fold(false, |a, b| a || b)
    } else {
        results.fold(true, |a, b| a && b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn typed_comparisons() {
        assert!(compare(&json!(10), "gt", &json!(2)));
        assert!(compare(&json!(0), "eq", &json!(0)));
        assert!(compare(&json!(false), "hasValue", &Value::Null));
        assert!(compare(
            &json!(["a", "b"]),
            "containsAll",
            &json!(["b", "a"])
        ));
        assert!(compare(&Value::Null, "neq", &json!("小明")));
        assert!(!compare(&json!(1), "unknown", &json!(1)));
    }
    #[test]
    fn rejects_bad_groups_and_paths() {
        assert!(reference(&format!("{PATH_PREFIX}{{\"root\":\"x\",\"path\":[\"y\"]}}")).is_ok());
        assert!(reference(&format!("{PATH_PREFIX}invalid")).is_err());
        assert!(
            validate_rules(&[
                json!({"id":"r","parentId":"r","fieldKey":"x","operator":"hasValue"})
            ])
            .is_err()
        );
    }
}
