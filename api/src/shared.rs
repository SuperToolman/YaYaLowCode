use crate::platform::api::ApiResponse;
use crate::platform::automation_runs::RetrySource;
use crate::platform::prelude::*;

pub(crate) fn format_date(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%d").to_string()
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
