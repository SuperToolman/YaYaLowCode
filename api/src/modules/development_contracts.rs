//! Product contracts compiled from designer source. No customer data or network access.
use crate::platform::error::AppError;
use serde_json::{Value, json};
use std::sync::LazyLock;

static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("development_contracts/catalog.generated.json"))
        .expect("generated development contracts must be valid JSON")
});
pub(crate) fn source_hash() -> &'static str {
    CATALOG["sourceHash"].as_str().expect("source hash")
}
pub(crate) fn identity() -> Value {
    json!({"formatVersion":1,"platformVersion":env!("CARGO_PKG_VERSION"),"sourceHash":source_hash(),"sourceHashAlgorithm":"sha256-generated-contract-v1"})
}
pub(crate) fn component_catalog() -> Value {
    json!({"contract":identity(),"items":CATALOG["components"].as_array().unwrap().iter().map(|c|json!({"id":c["id"],"label":c["label"],"category":c["category"],"version":c["version"],"designWriteSupported":c["designWriteSupported"],"purpose":c["guidance"]["purpose"]})).collect::<Vec<_>>(),
    "rules":["An empty application and absent knowledge base are valid; use current product contracts, not invented examples.","Read exact component contracts before designing. Canonical fields use id,type,label,row,column,rowSpan,colSpan,parentGroupId,props.","Normal/workflow design saving is supported; defined/html/tsx and logical detail design are outside this write contract.","Validate complete designs, request confirmation, then save. Validation is not authorization or a business write."]})
}
fn with_definitions(mut value: Value) -> Value {
    // Include only definitions reachable from this contract, avoiding the whole catalog.
    let mut defs = serde_json::Map::new();
    let mut pending = vec![value.clone()];
    while let Some(item) = pending.pop() {
        match item {
            Value::Object(o) => {
                if let Some(name) = o
                    .get("$ref")
                    .and_then(Value::as_str)
                    .and_then(|s| s.strip_prefix("#/$defs/"))
                {
                    if !defs.contains_key(name) {
                        let d = CATALOG["$defs"][name].clone();
                        defs.insert(name.into(), d.clone());
                        pending.push(d);
                    }
                }
                pending.extend(o.into_values());
            }
            Value::Array(a) => pending.extend(a),
            _ => {}
        }
    }
    value["$defs"] = Value::Object(defs);
    value["contract"] = identity();
    value
}
pub(crate) fn component(id: &str) -> Result<Value, AppError> {
    CATALOG["components"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .cloned()
        .map(with_definitions)
        .ok_or_else(|| {
            AppError::BadRequest(
                "unknown component ID; read platform_list_component_contracts".into(),
            )
        })
}
pub(crate) fn automation_catalog() -> Value {
    json!({"contract":identity(),"nodes":CATALOG["nodes"].as_array().unwrap().iter().map(|n|json!({"id":n["id"],"supportedFlowTypes":n["supportedFlowTypes"]})).collect::<Vec<_>>(),
    "triggerEvents":["before_create","after_create","before_update","after_update","before_delete","after_delete","button_click"],
    "fieldMapping":{"shape":{"id":"stable row ID","fieldId":"target field ID","valueType":"value | field | formula","rawValue":"literal string for value","sourceFieldKey":"<upstreamNodeId>:<fieldId> for field","formula":"platform expression when valueType=formula"},"rule":"Use actual authorized fields and upstream nodes. Expressions must use platform syntax, never JavaScript by assumption."},
    "graph":{"node":{"id":"unique string; entry is trigger-1","type":"workflow","position":{"x":120,"y":80},"data":{"kind":"exact node ID","label":"display name","config":"read node contract"}},"edge":{"id":"unique string","source":"existing node ID","target":"existing node ID","sourceHandle":"condition-branch:<branchId> for condition edges"}},
    "rules":["Read node contracts and the actual authorized form schema; never invent variable IDs or field mappings.","Trigger-flow creation persists paused; saving is NOT enabling or executing.","Process flows belong to workflow forms; do not create them with platform_create_automation.","Validate without running nodes or calling external systems. All writes require confirmation.","No automatic external test run or activation is exposed by this contract."]})
}
pub(crate) fn node(id: &str) -> Result<Value, AppError> {
    CATALOG["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .cloned()
        .map(with_definitions)
        .ok_or_else(|| AppError::BadRequest("unknown automation node ID".into()))
}
pub(crate) fn issue(path: &str, code: &str, message: &str) -> Value {
    json!({"path":path,"code":code,"severity":"error","message":message})
}
fn escaped(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

// Covers precisely the generated subset (type/const/anyOf/required/properties/
// additionalProperties/items/$ref), not an advertised general JSON Schema engine.
fn check(value: &Value, schema: &Value, path: &str, depth: usize, issues: &mut Vec<Value>) {
    if issues.len() >= 64 {
        return;
    }
    if depth > 48 {
        issues.push(issue(
            path,
            "depth_limit",
            "configuration nesting exceeds validation limit",
        ));
        return;
    }
    if let Some(reference) = schema["$ref"].as_str() {
        if let Some(def) = reference
            .strip_prefix("#/$defs/")
            .and_then(|n| CATALOG["$defs"].get(n))
        {
            check(value, def, path, depth + 1, issues)
        } else {
            issues.push(issue(
                path,
                "contract_reference",
                "unknown contract definition",
            ))
        }
        return;
    }
    if let Some(options) = schema["anyOf"].as_array() {
        if !options.iter().any(|s| {
            let mut errors = vec![];
            check(value, s, path, depth + 1, &mut errors);
            errors.is_empty()
        }) {
            issues.push(issue(
                path,
                "value_contract",
                "value does not match any allowed product type",
            ))
        }
        return;
    }
    if let Some(expected) = schema.get("const") {
        if value != expected {
            issues.push(issue(path, "enum", "value is outside the product enum"));
        }
        return;
    }
    let valid = match schema["type"].as_str() {
        Some("string") => value.is_string(),
        Some("number") => value.is_number(),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        Some("array") => value.is_array(),
        Some("object") => value.is_object(),
        _ => true,
    };
    if !valid {
        issues.push(issue(path, "type", "incorrect product property type"));
        return;
    }
    if let Some(o) = value.as_object() {
        if let Some(required) = schema["required"].as_array() {
            for key in required.iter().filter_map(Value::as_str) {
                if !o.contains_key(key) {
                    issues.push(issue(
                        &format!("{path}/{}", escaped(key)),
                        "required",
                        "missing required product property",
                    ));
                }
            }
        }
        if let Some(properties) = schema["properties"].as_object() {
            for (key, v) in o {
                let p = format!("{path}/{}", escaped(key));
                if let Some(s) = properties.get(key) {
                    check(v, s, &p, depth + 1, issues)
                } else if schema["additionalProperties"] == false {
                    issues.push(issue(
                        &p,
                        "unknown_property",
                        "property is absent from the current designer contract",
                    ));
                }
            }
        }
    }
    if let Some(a) = value.as_array() {
        if let Some(s) = schema.get("items") {
            for (i, v) in a.iter().enumerate() {
                check(v, s, &format!("{path}/{i}"), depth + 1, issues);
                if issues.len() >= 64 {
                    break;
                }
            }
        }
    }
}
pub(crate) fn component_issues(schema: &Value) -> Vec<Value> {
    let mut errors = vec![];
    if let Some(fields) = schema["fields"].as_array() {
        for (i, f) in fields.iter().enumerate() {
            let path = format!("/fields/{i}");
            let Some(c) = CATALOG["components"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == f["type"])
            else {
                errors.push(issue(
                    &format!("{path}/type"),
                    "unsupported_component",
                    "component is not registered",
                ));
                continue;
            };
            if c["designWriteSupported"] != true {
                errors.push(issue(
                    &format!("{path}/type"),
                    "unsupported_design",
                    "component design writing is not supported",
                ));
                continue;
            }
            check(
                &f["props"],
                &c["propsSchema"],
                &format!("{path}/props"),
                0,
                &mut errors,
            );
            if let Some(options) = f["props"]["options"].as_array() {
                let mut values = std::collections::HashSet::new();
                for (j, o) in options.iter().enumerate() {
                    if !values.insert(o["value"].to_string()) {
                        errors.push(issue(
                            &format!("{path}/props/options/{j}/value"),
                            "duplicate_option",
                            "option values must be unique",
                        ));
                    }
                }
            }
            if errors.len() >= 64 {
                break;
            }
        }
    }
    errors.truncate(64);
    errors
}
pub(crate) fn node_issues(nodes: &Value) -> Vec<Value> {
    let mut errors = vec![];
    if let Some(nodes) = nodes.as_array() {
        for (i, n) in nodes.iter().enumerate() {
            let Some(c) = CATALOG["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == n["data"]["kind"])
            else {
                errors.push(issue(
                    &format!("/nodes/{i}/data/kind"),
                    "unknown_node",
                    "unknown automation node",
                ));
                continue;
            };
            check(
                &n["data"]["config"],
                &c["configSchema"],
                &format!("/nodes/{i}/data/config"),
                0,
                &mut errors,
            );
            if errors.len() >= 64 {
                break;
            }
        }
    }
    errors.truncate(64);
    errors
}
pub(crate) fn ensure(issues: Vec<Value>) -> Result<(), AppError> {
    if issues.is_empty() {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            json!({"code":"design_validation_failed","contract":identity(),"issues":issues})
                .to_string(),
        ))
    }
}
