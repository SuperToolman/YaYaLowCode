use crate::platform::api::ApiResponse;
use crate::platform::automation_runs::RetrySource;
use crate::platform::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FormType {
    Normal,
    Workflow,
    Defined,
    Detail,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutomationStatus {
    Enabled,
    Paused,
    Draft,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutomationFlowType {
    Trigger,
    Process,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutomationTriggerEvent {
    BeforeCreate,
    AfterCreate,
    BeforeUpdate,
    AfterUpdate,
    BeforeDelete,
    AfterDelete,
    FormSubmit,
}

pub(crate) fn format_date(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%d").to_string()
}

pub(crate) fn format_datetime(value: DateTime<Utc>) -> String {
    value.to_rfc3339()
}

pub(crate) fn calculate_duration_ms(
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
) -> Option<i64> {
    finished_at.map(|value| (value - started_at).num_milliseconds().max(0))
}

pub(crate) fn generate_route_app_id() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("APP_{}", &raw[..20])
}

pub(crate) fn generate_form_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("FORM-{}", &raw[..28])
}

pub(crate) fn generate_record_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("REC-{}", &raw[..28])
}

pub(crate) fn generate_automation_run_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("RUN-{}", &raw[..28])
}

pub(crate) fn generate_automation_flow_uuid() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("AUTO-{}", &raw[..27])
}

pub(crate) fn build_form_slug(sort_order: i32) -> String {
    if sort_order == 0 {
        "overview".to_string()
    } else {
        format!("form-{}", sort_order + 1)
    }
}

pub(crate) fn success_response<T>(message: impl Into<String>, data: T) -> ApiResponse<T>
where
    T: Serialize,
{
    ApiResponse {
        code: 0,
        message: message.into(),
        data: Some(data),
        time: Utc::now().to_rfc3339(),
    }
}

pub(crate) fn error_response(code: i32, message: impl Into<String>) -> ApiResponse<Value> {
    ApiResponse {
        code,
        message: message.into(),
        data: None,
        time: Utc::now().to_rfc3339(),
    }
}

pub(crate) fn build_blank_schema(form_uuid: &str, form_name: &str) -> Value {
    json!({
        "formUuid": form_uuid,
        "formName": form_name,
        "columns": 6,
        "rows": 1,
        "pageProps": {
            "formulaValidations": [
                { "id": "formula-dictionary-exists", "label": "EXIST(字典项)" },
                { "id": "formula-sequence-exists", "label": "EXIST(序号)" }
            ],
            "serviceValidations": [],
            "customServiceValidations": [],
            "stopRulesOnFailure": false,
            "businessFailureRules": [],
            "integrationAutomations": [
                { "id": "integration-1", "label": "集成&自动化" }
            ],
            "serviceExecutions": [],
            "customServiceExecutions": [],
            "submitButtonText": "提交",
            "beforeSubmitActions": [],
            "afterSubmitActions": [],
            "afterDataInitActions": [],
            "dataSourceCode": "",
            "indexedFieldIds": []
        },
        "fields": []
    })
}

pub(crate) fn normalize_record_payload(data: Value) -> Value {
    match data {
        Value::Object(_) => data,
        _ => json!({}),
    }
}

pub(crate) fn normalize_json_object(data: Value) -> Value {
    match data {
        Value::Object(_) => data,
        _ => json!({}),
    }
}

pub(crate) fn normalize_json_array(data: Value) -> Value {
    match data {
        Value::Array(_) => data,
        _ => json!([]),
    }
}

pub(crate) fn normalize_operator(operator: Option<String>) -> String {
    normalize_optional_text(operator).unwrap_or_else(|| "管理员".to_string())
}

pub(crate) fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

pub(crate) fn retry_source_label(value: RetrySource) -> String {
    match value {
        RetrySource::Flow => "flow".to_string(),
        RetrySource::Node => "node".to_string(),
    }
}

pub(crate) fn normalize_automation_status(status: &str) -> Result<String, AppError> {
    let normalized = status.trim();
    if matches!(normalized, "enabled" | "paused" | "draft") {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation status".to_string(),
        ))
    }
}

pub(crate) fn normalize_automation_trigger_event(event: &str) -> Result<String, AppError> {
    let normalized = event.trim();
    if matches!(
        normalized,
        "before_create"
            | "after_create"
            | "before_update"
            | "after_update"
            | "before_delete"
            | "after_delete"
            | "form_submit"
    ) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::BadRequest(
            "invalid automation trigger event".to_string(),
        ))
    }
}

pub(crate) fn normalize_automation_trigger_events(
    events: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let mut normalized = Vec::new();
    for event in events {
        let event = normalize_automation_trigger_event(&event)?;
        if !normalized.contains(&event) {
            normalized.push(event);
        }
    }

    // A record operation has one execution point. Different operations may
    // share a flow, but one operation cannot run both before and after.
    for pair in [
        ("before_create", "after_create"),
        ("before_update", "after_update"),
        ("before_delete", "after_delete"),
    ] {
        if normalized.iter().any(|event| event == pair.0)
            && normalized.iter().any(|event| event == pair.1)
        {
            return Err(AppError::BadRequest(
                "each automation trigger type must select either before or after".to_string(),
            ));
        }
    }

    Ok(normalized)
}

pub(crate) fn automation_trigger_events(
    trigger_event: &str,
    trigger_config: &Value,
) -> Vec<String> {
    let configured_events = trigger_config
        .get("triggerEvents")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|event| normalize_automation_trigger_event(event).ok())
                .fold(Vec::new(), |mut events, event| {
                    if !events.contains(&event) {
                        events.push(event);
                    }
                    events
                })
        });

    // An explicit empty array means this automation has no enabled record
    // event. Only older configurations without this key use the legacy value.
    configured_events.unwrap_or_else(|| vec![trigger_event.to_string()])
}

pub(crate) fn with_automation_trigger_events(
    trigger_config: Value,
    trigger_events: &[String],
) -> Value {
    let mut config = trigger_config.as_object().cloned().unwrap_or_default();
    config.insert(
        "triggerEvents".to_string(),
        Value::Array(trigger_events.iter().cloned().map(Value::String).collect()),
    );
    Value::Object(config)
}

pub(crate) fn automation_trigger_label(event: &str) -> &'static str {
    match event {
        "before_create" => "创建成功前",
        "after_create" => "创建成功后",
        "before_update" => "编辑成功前",
        "after_update" => "编辑成功后",
        "before_delete" => "删除成功前",
        "after_delete" => "删除成功后",
        "form_submit" => "表单提交时",
        _ => "未配置",
    }
}

#[cfg(test)]
mod automation_trigger_event_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_unique_configured_trigger_events_and_falls_back_to_legacy_value() {
        let config = json!({ "triggerEvents": ["before_create", "after_create", "before_create"] });
        assert_eq!(
            automation_trigger_events("after_create", &config),
            vec!["before_create", "after_create"]
        );
        assert_eq!(
            automation_trigger_events("after_update", &json!({})),
            vec!["after_update"]
        );
        assert!(
            automation_trigger_events("after_update", &json!({ "triggerEvents": [] })).is_empty()
        );
    }

    #[test]
    fn rejects_before_and_after_for_the_same_record_operation() {
        assert!(
            normalize_automation_trigger_events(vec![
                "before_update".to_string(),
                "after_update".to_string(),
            ])
            .is_err()
        );
        assert!(
            normalize_automation_trigger_events(vec![
                "before_create".to_string(),
                "after_update".to_string(),
            ])
            .is_ok()
        );
    }
}

pub(crate) fn build_group_slug(title: &str) -> String {
    let normalized = title
        .trim()
        .chars()
        .map(|char| match char {
            'a'..='z' | 'A'..='Z' | '0'..='9' => char.to_ascii_lowercase(),
            _ => '-',
        })
        .collect::<String>();
    let collapsed = normalized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if collapsed.is_empty() {
        format!("group-{}", Uuid::new_v4().simple())
    } else {
        format!("group-{collapsed}")
    }
}
