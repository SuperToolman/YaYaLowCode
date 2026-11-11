//! Development preflight shared by read tools, frozen previews and execution.
use super::*;
use crate::modules::{automations, development_contracts as contracts, forms};
use crate::platform::prelude::*;
use yaya_agent_v2::domain::ToolCall;

pub(super) const GUIDANCE: &str = "\nLow-code development: An empty application with no forms, templates or knowledge documents is a normal starting point. Clarify missing consequential business rules; do not invent approvals, credentials or resource IDs. First inspect the application and current design, discover product component/node contracts, and read exact contracts on demand. Knowledge/cases are optional references, not product rules. Create resources in dependency order using real returned IDs. Validate complete form/automation designs, repair structured diagnostics, then use confirmed write tools. Preserve unrelated fields/nodes and original identity/version. A valid design is not a write authorization. Saving a form applies immediately; new trigger automations are paused, not enabled or executed. Do not use scripts/SQL to bypass platform RBAC or write confirmations. Track successful resource IDs across failures, never recreate committed resources or automatically delete them as compensation. Report saved/enabled/tested/unverified separately. Process-flow authoring and defined/html/tsx design are not supported by these tools.";

pub(super) fn diagnostics(result: Result<(), AppError>) -> Result<Value, AppError> {
    let issues = match result {
        Ok(()) => vec![],
        Err(AppError::BadRequest(message)) => {
            if let Ok(value) = serde_json::from_str::<Value>(&message) {
                value["issues"]
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![contracts::issue("/", "product_validation", &message)])
            } else {
                vec![contracts::issue("/", "product_validation", &message)]
            }
        }
        Err(e) => return Err(e),
    };
    Ok(
        json!({"valid":issues.is_empty(),"issues":issues,"contract":contracts::identity(),"saved":false,"executed":false,"limitations":["Validation is not a runtime business test; authorization and versions are checked again before saving."]}),
    )
}

pub(super) async fn validate_form(db: &impl ConnectionTrait, args: &Value) -> Result<(), AppError> {
    let id = args["formUuid"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("formUuid missing".into()))?;
    let f = forms::find_form_definition(db, id).await?;
    if args["appId"] != f.app_route_app_id || args["baseVersion"] != f.current_schema_version {
        return Err(AppError::Conflict(
            "design baseline changed; read current schema again".into(),
        ));
    }
    let s = forms::load_schema_version_for_connection(db, id, f.current_schema_version).await?;
    let base = forms::build_schema_payload(&f, s).schema;
    let mut target = args["schema"].clone();
    forms::clean_removed_field_config(&mut target);
    super::design::validate(id, &f.form_type, &base, &target)?;
    validate_form_references(db, &target).await
}

pub(super) async fn validate_form_references(
    db: &impl ConnectionTrait,
    target: &Value,
) -> Result<(), AppError> {
    let fields = target["fields"].as_array().cloned().unwrap_or_default();
    let mut issues = vec![];
    for (i, field) in fields
        .iter()
        .enumerate()
        .filter(|(_, f)| f["type"] == "associationFormField")
    {
        let id = field["props"]["associationFormId"]
            .as_str()
            .unwrap_or_default();
        let definition = forms::find_form_definition(db, id).await?;
        if field["props"]["associationAppId"]
            .as_str()
            .is_some_and(|app| !app.is_empty() && app != definition.app_route_app_id)
        {
            issues.push(contracts::issue(
                &format!("/fields/{i}/props/associationAppId"),
                "resource_mismatch",
                "association application does not match target form",
            ));
        }
        let schema =
            forms::load_schema_version_for_connection(db, id, definition.current_schema_version)
                .await?;
        let remote = schema.schema_json["fields"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let exists = |id: &str| remote.iter().any(|f| f["id"] == id);
        for key in ["associationPrimaryFieldId", "associationSecondaryFieldId"] {
            if let Some(id) = field["props"][key].as_str().filter(|s| !s.is_empty()) {
                if !exists(id) {
                    issues.push(contracts::issue(
                        &format!("/fields/{i}/props/{key}"),
                        "field_reference",
                        "association display field does not exist",
                    ));
                }
            }
        }
        for (j, mapping) in field["props"]["associationFills"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            if !mapping["sourceFieldId"].as_str().is_some_and(exists)
                || !fields.iter().any(|f| f["id"] == mapping["targetFieldId"])
            {
                issues.push(contracts::issue(
                    &format!("/fields/{i}/props/associationFills/{j}"),
                    "mapping_reference",
                    "association fill must reference existing source and target fields",
                ));
            }
        }
    }
    contracts::ensure(issues)
}

pub(super) async fn validate_automation(
    db: &impl ConnectionTrait,
    call: &ToolCall,
) -> Result<(), AppError> {
    let args = &call.arguments;
    let app = args["appId"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("appId missing".into()))?;
    let (source, events) = if call.name == "platform_update_automation" {
        let flow = AutomationFlowEntity::find()
            .filter(
                automation_flow_entity::Column::FlowUuid
                    .eq(args["automationId"].as_str().unwrap_or_default()),
            )
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("automation not found".into()))?;
        if flow.app_route_app_id != app || args["baseVersion"] != flow.current_version {
            return Err(AppError::Conflict(
                "automation baseline changed; read current graph again".into(),
            ));
        }
        if flow.flow_type == "process" || flow.status != "paused" {
            return Err(AppError::BadRequest(
                "only paused trigger automations can be edited by this tool".into(),
            ));
        }
        (
            flow.trigger_form_uuid.clone(),
            flow.trigger_config["triggerEvents"].clone(),
        )
    } else {
        (
            args["triggerFormUuid"].as_str().map(str::to_owned),
            args["triggerEvents"].clone(),
        )
    };
    automations::design_contract::validate_trigger_design(
        db,
        app,
        &args["nodes"],
        &args["edges"],
        source.as_deref(),
        &events,
    )
    .await
}

// Resolve every explicit referenced form before invoking semantic validators.
// Whole-design operations require complete field access, avoiding schema probes
// or writes based on filtered source definitions. This initial policy is conservative.
pub(super) async fn authorize_references(
    state: &AppState,
    args: &Value,
    grants: &HashSet<String>,
    current: &HashSet<String>,
    saved: &HashSet<String>,
) -> Result<(), AppError> {
    let mut ids = HashSet::new();
    let mut pending = vec![args];
    while let Some(v) = pending.pop() {
        match v {
            Value::Object(o) => {
                for (k, v) in o {
                    if matches!(
                        k.as_str(),
                        "formUuid"
                            | "targetFormUuid"
                            | "triggerFormUuid"
                            | "associationFormId"
                            | "sourceFormUuid"
                    ) {
                        if let Some(id) = v.as_str().filter(|id| !id.is_empty()) {
                            ids.insert(id.to_owned());
                        }
                    } else if matches!(k.as_str(), "code" | "bodyTemplate" | "headersText") {
                        continue;
                    }
                    pending.push(v)
                }
            }
            Value::Array(a) => pending.extend(a),
            _ => {}
        }
    }
    for id in ids {
        let f = forms::find_form_definition(&state.db, &id)
            .await
            .map_err(|_| AppError::Forbidden("referenced form is unavailable for design".into()))?;
        for p in [
            format!("app:{}:display", f.app_route_app_id),
            format!("app:{}:view_development", f.app_route_app_id),
            format!("form:{id}:display"),
        ] {
            if !grants.contains("*") && !grants.contains(&p) {
                return Err(AppError::Forbidden(
                    "referenced design permission denied".into(),
                ));
            }
        }
        let s = forms::load_schema_version_for_connection(&state.db, &id, f.current_schema_version)
            .await?;
        if !super::design::full_access(&s.schema_json, &id, current, saved) {
            return Err(AppError::Forbidden(
                "design validation requires complete referenced-field access".into(),
            ));
        }
    }
    Ok(())
}
