//! V2 design contract. No dependency on the legacy Agent executor.
use super::*;
use sea_orm::ConnectionTrait;
use sha2::{Digest, Sha256};
const LIMIT: usize = 1024 * 1024;
const ROOTS: &[&str] = &["formName", "columns", "rows", "pageProps", "fields"];
fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
pub(super) fn is_write(name: &str) -> bool {
    matches!(
        name,
        "platform_save_form_schema" | "platform_apply_design_patch"
    )
}
/// Independent from command fingerprints; arrays retain their original order.
pub(super) fn hash(value: &Value) -> String {
    fn canonical(v: &Value) -> Value {
        match v {
            Value::Object(o) => {
                let sorted: std::collections::BTreeMap<_, _> =
                    o.iter().map(|(k, v)| (k.clone(), canonical(v))).collect();
                Value::Object(sorted.into_iter().collect())
            }
            Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
            _ => v.clone(),
        }
    }
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical(value)).expect("JSON value"))
    )
}
fn bounded(value: &Value) -> Result<(), AppError> {
    if serde_json::to_vec(value)
        .map_err(|_| bad("invalid JSON"))?
        .len()
        > LIMIT
    {
        return Err(bad("design exceeds 1 MiB"));
    }
    Ok(())
}
fn pointer(path: &str) -> Result<Vec<String>, AppError> {
    if !path.starts_with('/') {
        return Err(bad("root replacement is forbidden"));
    }
    let parts = path[1..]
        .split('/')
        .map(|part| {
            let mut out = String::new();
            let mut chars = part.chars();
            while let Some(c) = chars.next() {
                if c != '~' {
                    out.push(c);
                } else {
                    out.push(match chars.next() {
                        Some('0') => '~',
                        Some('1') => '/',
                        _ => return Err(bad("invalid JSON Pointer escape")),
                    });
                }
            }
            Ok(out)
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    if !ROOTS.contains(&parts[0].as_str()) {
        return Err(bad("design path is not editable"));
    }
    Ok(parts)
}
fn index(token: &str, len: usize, insert: bool) -> Result<usize, AppError> {
    if insert && token == "-" {
        return Ok(len);
    }
    if token.is_empty()
        || (token.len() > 1 && token.starts_with('0'))
        || !token.bytes().all(|c| c.is_ascii_digit())
    {
        return Err(bad("invalid array index"));
    }
    let n = token
        .parse::<usize>()
        .map_err(|_| bad("invalid array index"))?;
    if n > len || (!insert && n == len) {
        return Err(bad("array index out of bounds"));
    }
    Ok(n)
}
pub(super) fn apply(base: &Value, patch: &Value) -> Result<Value, AppError> {
    bounded(patch)?;
    let ops = patch
        .as_array()
        .ok_or_else(|| bad("patch must be an array"))?;
    if ops.len() > 100 {
        return Err(bad("patch exceeds 100 operations"));
    }
    let mut result = base.clone();
    for op in ops {
        let object = op
            .as_object()
            .ok_or_else(|| bad("invalid patch operation"))?;
        let kind = op["op"].as_str().ok_or_else(|| bad("missing operation"))?;
        if !matches!(kind, "add" | "replace" | "remove")
            || object
                .keys()
                .any(|k| !["op", "path", "value"].contains(&k.as_str()))
        {
            return Err(bad("unsupported patch operation"));
        }
        if kind != "remove" && !object.contains_key("value") {
            return Err(bad("patch value required"));
        }
        let parts = pointer(op["path"].as_str().ok_or_else(|| bad("missing path"))?)?;
        let mut parent = &mut result;
        for part in &parts[..parts.len() - 1] {
            parent = match parent {
                Value::Object(o) => o.get_mut(part).ok_or_else(|| bad("patch parent missing"))?,
                Value::Array(a) => {
                    let n = index(part, a.len(), false)?;
                    &mut a[n]
                }
                _ => return Err(bad("patch parent is not a container")),
            };
        }
        let key = &parts[parts.len() - 1];
        match parent {
            Value::Object(o) => {
                if kind != "add" && !o.contains_key(key) {
                    return Err(bad("patch path missing"));
                }
                if kind == "remove" {
                    o.remove(key);
                } else {
                    o.insert(key.clone(), op["value"].clone());
                }
            }
            Value::Array(a) => {
                let n = index(key, a.len(), kind == "add")?;
                match kind {
                    "add" => a.insert(n, op["value"].clone()),
                    "remove" => {
                        a.remove(n);
                    }
                    _ => a[n] = op["value"].clone(),
                }
            }
            _ => return Err(bad("patch parent is not a container")),
        }
        bounded(&result)?;
    }
    bounded(&result)?;
    Ok(result)
}
pub(super) fn full_access(
    schema: &Value,
    form: &str,
    current: &HashSet<String>,
    saved: &HashSet<String>,
) -> bool {
    if [current, saved]
        .iter()
        .any(|g| !g.contains("*") && g.contains(&format!("form:{form}:field_scope:none")))
    {
        return false;
    }
    let policy = crate::platform::record_access::FieldPolicy::new(schema, form, current, saved);
    let mut seen = HashSet::new();
    schema["fields"].as_array().is_some_and(|fields| {
        fields.iter().all(|f| {
            f["id"]
                .as_str()
                .is_some_and(|id| seen.insert(id) && policy.can_read(id))
                && f["props"]
                    .get("isHidden")
                    .is_none_or(|hidden| hidden == false)
        })
    })
}
pub(super) fn validate(
    form: &str,
    kind: &str,
    base: &Value,
    target: &Value,
) -> Result<(), AppError> {
    bounded(target)?;
    if !matches!(kind, "normal" | "workflow") {
        return Err(bad(
            "V2 design editing supports normal and workflow forms only",
        ));
    }
    let object = target
        .as_object()
        .ok_or_else(|| bad("schema must be an object"))?;
    let base_object = base.as_object().ok_or_else(|| bad("invalid base schema"))?;
    for key in object.keys().chain(base_object.keys()) {
        if !ROOTS.contains(&key.as_str()) && object.get(key) != base_object.get(key) {
            return Err(bad("schema identity or contract metadata changed"));
        }
    }
    if target["formUuid"].as_str() != Some(form)
        || target["formName"]
            .as_str()
            .is_none_or(|s| s.trim().is_empty())
        || !target["pageProps"].is_object()
    {
        return Err(bad("invalid schema identity, name or pageProps"));
    }
    let columns = target["columns"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(|| bad("invalid columns"))?;
    let rows = target["rows"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(|| bad("invalid rows"))?;
    crate::modules::forms::validate_schema_for_form_type(kind, target)?;
    crate::modules::development_contracts::ensure(
        crate::modules::development_contracts::component_issues(target),
    )?;
    let fields = target["fields"]
        .as_array()
        .ok_or_else(|| bad("invalid fields"))?;
    let mut by_id: std::collections::HashMap<&str, &Value> = std::collections::HashMap::new();
    for f in fields {
        let id = f["id"]
            .as_str()
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| bad("invalid field id"))?;
        if by_id.insert(id, f).is_some() {
            return Err(bad("duplicate field id"));
        }
        if !matches!(
            f["type"].as_str(),
            Some(
                "singleLineText"
                    | "multiLineText"
                    | "description"
                    | "number"
                    | "radio"
                    | "checkbox"
                    | "select"
                    | "multiSelect"
                    | "link"
                    | "date"
                    | "dateRange"
                    | "attachment"
                    | "imageUpload"
                    | "member"
                    | "department"
                    | "button"
                    | "groupContainer"
                    | "separator"
                    | "subform"
                    | "richText"
                    | "associationFormField"
                    | "countryCity"
                    | "cascader"
                    | "serialNumber"
            )
        ) || !f["props"].is_object()
            || !f["label"].is_string()
        {
            return Err(bad("invalid component contract"));
        }
        if !f
            .get("parentGroupId")
            .is_some_and(|v| v.is_null() || v.is_string())
        {
            return Err(bad("parentGroupId must be string or null"));
        }
        for key in [
            "isRequired",
            "isHidden",
            "isDisabled",
            "isReadOnly",
            "showClearButton",
            "showCounter",
        ] {
            if f["props"].get(key).is_some_and(|v| !v.is_boolean()) {
                return Err(bad("invalid boolean field property"));
            }
        }
        if let Some(options) = f["props"].get("options") {
            if !options.as_array().is_some_and(|a| {
                a.iter().all(|o| {
                    o["label"].is_string()
                        && o.get("value")
                            .is_some_and(|v| v.is_string() || v.is_number())
                })
            }) {
                return Err(bad("invalid option contract"));
            }
        }
        for key in ["minValue", "maxValue"] {
            if f["props"]
                .get(key)
                .is_some_and(|v| !v.is_null() && !v.is_number())
            {
                return Err(bad("invalid numeric field property"));
            }
        }
        if let (Some(min), Some(max)) = (
            f["props"]["minValue"].as_f64(),
            f["props"]["maxValue"].as_f64(),
        ) {
            if min > max {
                return Err(bad("minimum exceeds maximum"));
            }
        }
        for key in ["row", "column", "rowSpan", "colSpan"] {
            if f[key].as_u64().is_none() || (key.ends_with("Span") && f[key] == 0) {
                return Err(bad("invalid field layout"));
            }
        }
    }
    for (i, a) in fields.iter().enumerate() {
        for b in &fields[i + 1..] {
            if a["parentGroupId"] == b["parentGroupId"]
                && a["row"].as_u64().unwrap()
                    < b["row"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(b["rowSpan"].as_u64().unwrap())
                && b["row"].as_u64().unwrap()
                    < a["row"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(a["rowSpan"].as_u64().unwrap())
                && a["column"].as_u64().unwrap()
                    < b["column"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(b["colSpan"].as_u64().unwrap())
                && b["column"].as_u64().unwrap()
                    < a["column"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(a["colSpan"].as_u64().unwrap())
            {
                return Err(bad("overlapping sibling fields"));
            }
        }
    }
    if let Some(indexed) = target["pageProps"].get("indexedFieldIds") {
        let mut unique = HashSet::new();
        if !indexed.as_array().is_some_and(|items| {
            items.iter().all(|id| {
                id.as_str()
                    .is_some_and(|id| by_id.contains_key(id) && unique.insert(id))
            })
        }) {
            return Err(bad("indexedFieldIds must reference unique existing fields"));
        }
    }
    let mut serial_scopes = HashSet::new();
    for f in fields {
        let bottom = f["row"]
            .as_u64()
            .unwrap()
            .checked_add(f["rowSpan"].as_u64().unwrap())
            .ok_or_else(|| bad("layout overflow"))?;
        let right = f["column"]
            .as_u64()
            .unwrap()
            .checked_add(f["colSpan"].as_u64().unwrap())
            .ok_or_else(|| bad("layout overflow"))?;
        if let Some(parent) = f["parentGroupId"].as_str().and_then(|id| by_id.get(id)) {
            if parent["type"] == "subform" {
                if matches!(
                    f["type"].as_str(),
                    Some("groupContainer" | "subform" | "richText" | "separator")
                ) || f["row"].as_u64() < parent["row"].as_u64()
                    || f["rowSpan"] != 1
                    || f["colSpan"] != 1
                    || right > columns
                {
                    return Err(bad("invalid subform layout"));
                }
            } else if f["row"].as_u64() < parent["row"].as_u64()
                || f["column"].as_u64() < parent["column"].as_u64()
                || bottom
                    > parent["row"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(parent["rowSpan"].as_u64().unwrap())
                || right
                    > parent["column"]
                        .as_u64()
                        .unwrap()
                        .saturating_add(parent["colSpan"].as_u64().unwrap())
            {
                return Err(bad("field exceeds parent layout"));
            }
        }
        let mut parent = f["parentGroupId"].as_str();
        let mut seen = HashSet::from([f["id"].as_str().unwrap()]);
        let mut scope = "canvas";
        while let Some(id) = parent {
            if !seen.insert(id) {
                return Err(bad("cyclic field parents"));
            }
            let p = by_id.get(id).ok_or_else(|| bad("field parent missing"))?;
            if !matches!(p["type"].as_str(), Some("groupContainer" | "subform")) {
                return Err(bad("invalid field parent type"));
            }
            if p["type"] == "subform" {
                scope = id;
                if f["type"] == "separator" {
                    return Err(bad("separator cannot belong to subform"));
                }
            }
            parent = p["parentGroupId"].as_str();
        }
        if f["type"] == "serialNumber" && !serial_scopes.insert(scope) {
            return Err(bad("duplicate serialNumber in scope"));
        }
        if matches!(f["type"].as_str(), Some("groupContainer" | "subform"))
            && !fields.iter().any(|child| child["parentGroupId"] == f["id"])
        {
            return Err(bad("empty container"));
        }
        if f["type"] == "associationFormField"
            && ["associationFormId", "associationPrimaryFieldId"]
                .iter()
                .any(|k| f["props"][k].as_str().is_none_or(str::is_empty))
        {
            return Err(bad("association display configuration missing"));
        }
        if f["parentGroupId"].is_null()
            && (f["row"]
                .as_u64()
                .unwrap()
                .checked_add(f["rowSpan"].as_u64().unwrap())
                .is_none_or(|n| n > rows)
                || f["column"]
                    .as_u64()
                    .unwrap()
                    .checked_add(f["colSpan"].as_u64().unwrap())
                    .is_none_or(|n| n > columns))
        {
            return Err(bad("field layout exceeds canvas"));
        }
    }
    crate::platform::form_storage::compile_form_storage_plan(form, target)?;
    Ok(())
}
pub(super) struct Prepared {
    pub base: Value,
    pub target: Value,
    pub baseline: Value,
}
pub(super) async fn prepare(
    db: &impl ConnectionTrait,
    call: &yaya_agent_v2::domain::ToolCall,
) -> Result<Prepared, AppError> {
    let args = &call.arguments;
    let id = args["formUuid"]
        .as_str()
        .ok_or_else(|| bad("formUuid missing"))?;
    let definition = crate::modules::forms::find_form_definition(db, id).await?;
    if args["appId"] != definition.app_route_app_id
        || args["baseVersion"] != definition.current_schema_version
    {
        return Err(AppError::Conflict("design baseline changed".into()));
    }
    let schema = crate::modules::forms::load_schema_version_for_connection(
        db,
        id,
        definition.current_schema_version,
    )
    .await?;
    let base = crate::modules::forms::build_schema_payload(&definition, schema).schema;
    let base_hash = hash(&base);
    let mut target = if call.name == "platform_apply_design_patch" {
        if args["baseHash"] != base_hash {
            return Err(AppError::Conflict("design hash changed".into()));
        }
        apply(&base, &args["patch"])?
    } else {
        args["schema"].clone()
    };
    bounded(&target)?;
    crate::modules::forms::clean_removed_field_config(&mut target);
    validate(id, &definition.form_type, &base, &target)?;
    super::development::validate_form_references(db,&target).await?;
    let baseline = json!({"algorithm":"sha256-json-v1","baseVersion":definition.current_schema_version,"baseHash":base_hash,"targetHash":hash(&target)});
    Ok(Prepared {
        base,
        target,
        baseline,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schema() -> Value {
        json!({"formUuid":"f","formName":"Form","columns":6,"rows":4,"pageProps":{},"fields":[{"id":"name","type":"singleLineText","label":"Name","row":0,"column":0,"rowSpan":1,"colSpan":2,"parentGroupId":null,"props":{}}]})
    }
    #[test]
    fn hash_is_canonical_and_array_order_is_significant() {
        let a: Value = serde_json::from_str(r#"{"z":[{"b":2,"a":1}],"a":0}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"a":0,"z":[{"a":1,"b":2}]}"#).unwrap();
        assert_eq!(hash(&a), hash(&b));
        assert_ne!(hash(&json!([1, 2])), hash(&json!([2, 1])));
        assert_eq!(
            hash(&json!({})),
            "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        );
    }
    #[test]
    fn array_add_inserts_remove_shifts_and_dash_appends() {
        let result = apply(
            &json!({"fields":[1,3]}),
            &json!([
                {"op":"add","path":"/fields/1","value":2},
                {"op":"remove","path":"/fields/0"},
                {"op":"add","path":"/fields/-","value":4},
                {"op":"replace","path":"/fields/0","value":20}
            ]),
        )
        .unwrap();
        assert_eq!(result, json!({"fields":[20,3,4]}));
        assert_eq!(
            apply(
                &json!({"pageProps":{"a/b":{"~x":0}}}),
                &json!([{"op":"replace","path":"/pageProps/a~1b/~0x","value":1}])
            )
            .unwrap()["pageProps"]["a/b"]["~x"],
            1
        );
    }
    #[test]
    fn invalid_operations_paths_and_indices_fail_closed() {
        for op in [
            json!({"op":"copy","path":"/fields/0","value":0}),
            json!({"op":"add","path":"","value":{}}),
            json!({"op":"add","path":"/formUuid","value":"other"}),
            json!({"op":"add","path":"/pageProps/~2","value":0}),
            json!({"op":"add","path":"/pageProps/~","value":0}),
            json!({"op":"add","path":"/pageProps/missing/x","value":0}),
            json!({"op":"replace","path":"/fields/-","value":0}),
            json!({"op":"replace","path":"/fields/1","value":0}),
            json!({"op":"remove","path":"/pageProps/missing"}),
            json!({"op":"add","path":"/fields/01","value":0}),
            json!({"op":"add","path":"/fields/+1","value":0}),
            json!({"op":"add","path":"/fields/2","value":0}),
            json!({"op":"add","path":"/fields/0"}),
        ] {
            assert!(apply(&schema(), &json!([op])).is_err(), "{op}");
        }
    }
    #[test]
    fn operation_and_byte_limits_apply_to_patch_and_result() {
        let op = json!({"op":"add","path":"/pageProps/x","value":1});
        assert!(apply(&schema(), &json!(vec![op.clone(); 100])).is_ok());
        assert!(apply(&schema(), &json!(vec![op; 101])).is_err());
        assert!(
            apply(
                &schema(),
                &json!([{"op":"add","path":"/pageProps/x","value":"x".repeat(LIMIT)}])
            )
            .is_err()
        );
        assert!(
            apply(
                &json!({"pageProps":{"large":"x".repeat(LIMIT-60)}}),
                &json!([{"op":"add","path":"/pageProps/extra","value":"x".repeat(100)}])
            )
            .is_err()
        );
    }
    #[test]
    fn full_design_validation_rejects_identity_layout_and_component_bypasses() {
        let base = schema();
        assert!(validate("f", "normal", &base, &base).is_ok());
        assert!(validate("f", "workflow", &base, &base).is_ok());
        for kind in ["defined", "detail"] {
            assert!(validate("f", kind, &base, &base).is_err());
        }
        for (path, value) in [
            ("/formUuid", json!("other")),
            ("/rows", json!(0)),
            ("/fields/0/type", json!("html")),
            ("/fields/0/colSpan", json!(7)),
            ("/fields/0/parentGroupId", json!("missing")),
            ("/fields/0/props", json!([])),
        ] {
            let mut target = base.clone();
            *target.pointer_mut(path).unwrap() = value;
            assert!(validate("f", "normal", &base, &target).is_err(), "{path}");
        }
        let mut target = base.clone();
        target["fields"]
            .as_array_mut()
            .unwrap()
            .push(base["fields"][0].clone());
        assert!(validate("f", "normal", &base, &target).is_err());
        target["fields"][1]["id"] = json!("other");
        assert!(
            validate("f", "normal", &base, &target).is_err(),
            "overlapping siblings"
        );
    }
    #[test]
    fn hidden_partial_and_snapshot_field_policies_deny_whole_design() {
        let mut base = schema();
        let admin = HashSet::from(["*".into()]);
        let partial = HashSet::from(["form:f:field_scope:specified".into()]);
        assert!(full_access(&base, "f", &admin, &admin));
        assert!(!full_access(&base, "f", &admin, &partial));
        assert!(!full_access(&base, "f", &partial, &admin));
        base["fields"][0]["props"]["isHidden"] = json!(true);
        assert!(!full_access(&base, "f", &admin, &admin));
        let mut visible = base["fields"][0].clone();
        visible["props"]["isHidden"] = json!(false);
        base["fields"].as_array_mut().unwrap().push(visible);
        assert!(
            !full_access(&base, "f", &admin, &admin),
            "duplicate ID cannot mask a hidden field"
        );
        base["fields"] = json!([]);
        assert!(!full_access(
            &base,
            "f",
            &admin,
            &HashSet::from(["form:f:field_scope:none".into()])
        ));
    }
    #[test]
    fn malformed_layout_properties_and_container_relations_are_rejected() {
        let base = schema();
        for (path, value) in [
            ("/fields/0/row", json!("0")),
            ("/fields/0/rowSpan", json!(-1)),
            ("/fields/0/props/isHidden", json!("true")),
            ("/fields/0/props/options", json!({})),
            ("/pageProps/indexedFieldIds", json!(["missing"])),
        ] {
            let parts: Vec<_> = path[1..].split('/').collect();
            let mut target = base.clone();
            let (last, parent) = parts.split_last().unwrap();
            let parent = format!("/{}", parent.join("/"));
            target.pointer_mut(&parent).unwrap()[*last] = value;
            assert!(validate("f", "normal", &base, &target).is_err(), "{path}");
        }
        let mut target = base.clone();
        target["fields"][0]["type"] = json!("groupContainer");
        target["fields"][0]["parentGroupId"] = json!("name");
        assert!(
            validate("f", "normal", &base, &target).is_err(),
            "self cycle"
        );
        let mut group = base["fields"][0].clone();
        group["id"] = json!("group");
        group["type"] = json!("groupContainer");
        let mut child = base["fields"][0].clone();
        child["parentGroupId"] = json!("group");
        child["column"] = json!(3);
        target["fields"] = json!([child, group]);
        assert!(
            validate("f", "normal", &base, &target).is_err(),
            "parent geometry independent of field array order"
        );
    }
}
