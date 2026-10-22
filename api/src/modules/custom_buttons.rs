//! Form-owned button definitions; execution and view binding are separate capabilities.
use crate::infrastructure::entities::custom_button_entity as button;
use crate::platform::authorization;
use crate::platform::prelude::*;
use crate::shared::success_response;
use axum::http::HeaderMap;
use sea_orm::{PaginatorTrait, QuerySelect};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FillFormConfig {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[schema(required = false)]
    pub target_app_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[schema(required = false)]
    pub target_form_uuid: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schema(required = false)]
    pub field_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_mode: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonConditionRule {
    pub id: String,
    pub parent_id: Option<String>,
    pub is_group: Option<bool>,
    pub logical_operator: Option<String>,
    pub field_key: Option<String>,
    pub operator: Option<String>,
    pub raw_value: Option<String>,
    pub value_type: Option<String>,
    pub source_field_key: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonAvailability {
    pub mode: String,
    pub rules: Vec<ButtonConditionRule>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveCustomButtonRequest {
    pub name: String,
    pub icon: Option<String>,
    pub description: String,
    pub action_type: String,
    pub action_config: FillFormConfig,
    #[serde(default = "default_availability")]
    pub availability: ButtonAvailability,
    #[serde(default)]
    pub disabled_reason: String,
}
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiCustomButton {
    pub id: String,
    pub app_id: String,
    pub form_uuid: String,
    pub name: String,
    pub icon: Option<String>,
    pub description: String,
    pub action_type: String,
    pub action_config: FillFormConfig,
    pub availability: ButtonAvailability,
    pub disabled_reason: String,
    pub target_form_name: Option<String>,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiCustomButtonList {
    pub items: Vec<ApiCustomButton>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListButtonsQuery {
    pub search: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

const ICONS: &[&str] = &[
    "pencil",
    "plus",
    "check",
    "play",
    "file",
    "gear",
    "bolt",
    "arrow-right",
];
const WRITABLE_TYPES: &[&str] = &[
    "singleLineText",
    "multiLineText",
    "richText",
    "number",
    "radio",
    "checkbox",
    "select",
    "multiSelect",
    "date",
    "dateRange",
    "attachment",
    "imageUpload",
    "member",
    "department",
    "countryCity",
    "cascader",
    "associationFormField",
    "subform",
];
const SYSTEM_FIELDS: &[&str] = &[
    "instanceId",
    "instanceTitle",
    "submitter",
    "submitterOrganization",
    "createdAt",
    "updatedAt",
];
const WORKFLOW_FIELDS: &[&str] = &[
    "workflowApprovalStatus",
    "workflowInstanceStatus",
    "workflowCurrentApprovalNode",
    "workflowSubmitter",
];

fn default_availability() -> ButtonAvailability {
    ButtonAvailability {
        mode: "all".into(),
        rules: vec![],
    }
}
async fn validate_owner_form(
    state: &AppState,
    headers: &HeaderMap,
    form_uuid: &str,
    payload: &SaveCustomButtonRequest,
) -> Result<form_definition_entity::Model, AppError> {
    let form = crate::modules::forms::find_form_definition(&state.db, form_uuid).await?;
    if !["normal", "workflow"].contains(&form.form_type.as_str()) {
        return Err(bad("自定义按钮只能归属普通表单或流程表单"));
    }
    let grants = authorization::grants(headers, state).await?;
    if !grants.contains("*")
        && !grants.contains(&format!("app:{}:edit_form", form.app_route_app_id))
    {
        return Err(AppError::Forbidden("无权编辑当前表单".into()));
    }
    if payload.action_type == "run_automation" {
        let flow = automation_for_button(
            state,
            payload.action_config.automation_id.as_deref().unwrap_or(""),
        )
        .await?;
        if flow.app_route_app_id != form.app_route_app_id
            || flow.trigger_form_uuid.as_deref() != Some(form_uuid)
        {
            return Err(bad("按钮自动化必须使用当前表单作为来源表单"));
        }
    }
    let schema = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid))
        .filter(form_schema_entity::Column::Version.eq(form.current_schema_version))
        .one(&state.db)
        .await?
        .ok_or_else(|| bad("表单结构不存在"))?;
    if payload.disabled_reason.chars().count() > 1000 {
        return Err(bad("禁用说明最多1000字"));
    }
    match payload.availability.mode.as_str() {
        "all" if payload.availability.rules.is_empty() => (),
        "conditions" => validate_rules(
            &payload.availability.rules,
            &valid_condition_fields(&schema.schema_json, form.form_type == "workflow"),
        )?,
        _ => return Err(bad("按钮可用条件模式无效")),
    }
    Ok(form)
}
fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
pub(super) fn valid_condition_fields(schema: &Value, workflow: bool) -> HashSet<String> {
    let mut keys: HashSet<String> = schema["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| {
            WRITABLE_TYPES.contains(&f["type"].as_str().unwrap_or(""))
                || f["type"] == "serialNumber"
        })
        .filter_map(|f| f["id"].as_str().map(str::to_owned))
        .collect();
    keys.extend(SYSTEM_FIELDS.iter().map(|s| (*s).to_owned()));
    if workflow {
        keys.extend(WORKFLOW_FIELDS.iter().map(|s| (*s).to_owned()));
    }
    keys
}
fn validate_configuration(
    payload: &mut SaveCustomButtonRequest,
    schema: &Value,
    _workflow: bool,
) -> Result<(), AppError> {
    payload.name = payload.name.trim().into();
    payload.description = payload.description.trim().into();
    payload.disabled_reason = payload.disabled_reason.trim().into();
    if payload.name.is_empty() || payload.name.chars().count() > 100 {
        return Err(bad("按钮名称必填，且不能超过100字"));
    }
    if payload.description.chars().count() > 2000 || payload.disabled_reason.chars().count() > 1000
    {
        return Err(bad("按钮说明或禁用说明过长"));
    }
    if payload.icon.as_deref().is_some_and(|s| !ICONS.contains(&s)) {
        return Err(bad("不支持的按钮图标"));
    }
    match payload.availability.mode.as_str() {
        "all" if payload.availability.rules.is_empty() => (),
        "conditions" => validate_rules(
            &payload.availability.rules,
            &valid_condition_fields(schema, _workflow),
        )?,
        _ => return Err(bad("按钮可用条件模式无效")),
    }
    if payload.action_type == "run_automation" {
        if payload
            .action_config
            .automation_id
            .as_deref()
            .is_none_or(|id| id.trim().is_empty())
        {
            return Err(bad("请选择集成自动化"));
        }
        payload.action_config.target_app_id.clear();
        payload.action_config.target_form_uuid.clear();
        payload.action_config.field_ids.clear();
        payload.action_config.link_type = None;
        payload.action_config.page_mode = None;
        payload.action_config.url = None;
        payload.action_config.open_mode = None;
        return Ok(());
    }
    payload.action_config.automation_id = None;
    if payload.action_type == "open_page" {
        let config = &payload.action_config;
        if ![Some("window"), Some("sidebar")].contains(&config.open_mode.as_deref()) {
            return Err(bad("请选择打开方式"));
        }
        match config.link_type.as_deref() {
            Some("internal") => {
                if config.target_app_id.is_empty()
                    || config.target_form_uuid.is_empty()
                    || ![Some("edit"), Some("view")].contains(&config.page_mode.as_deref())
                {
                    return Err(bad("请选择表单和页面模式"));
                }
            }
            Some("external") => {
                let url = url::Url::parse(config.url.as_deref().unwrap_or(""))
                    .map_err(|_| bad("链接地址无效"))?;
                if !["http", "https"].contains(&url.scheme()) {
                    return Err(bad("链接地址必须使用 http 或 https"));
                }
            }
            _ => return Err(bad("链接类型无效")),
        }
        payload.action_config.field_ids.clear();
        return Ok(());
    }
    if payload.action_type != "fill_form" {
        return Err(bad("不支持的按钮动作"));
    }
    let writable: HashSet<String> = schema["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| WRITABLE_TYPES.contains(&f["type"].as_str().unwrap_or("")))
        .filter(|f| {
            !SYSTEM_FIELDS.contains(&f["id"].as_str().unwrap_or(""))
                && !WORKFLOW_FIELDS.contains(&f["id"].as_str().unwrap_or(""))
        })
        .filter(|f| {
            f["props"]["isReadOnly"] != true
                && f["props"]["isDisabled"] != true
                && f["props"]["isHidden"] != true
        })
        .filter_map(|f| f["id"].as_str().map(str::to_owned))
        .collect();
    let fields = &payload.action_config.field_ids;
    if fields.is_empty() || fields.len() > 500 || fields.iter().any(|id| !writable.contains(id)) {
        return Err(bad("请选择有效且可填写的业务字段"));
    }
    if fields.iter().collect::<HashSet<_>>().len() != fields.len() {
        return Err(bad("选择字段不能重复"));
    }
    Ok(())
}
pub(super) fn validate_rules(
    rules: &[ButtonConditionRule],
    fields: &HashSet<String>,
) -> Result<(), AppError> {
    if rules.is_empty() || rules.len() > 200 {
        return Err(bad("筛选条件必须包含完整条件，最多200条"));
    }
    let ids: HashSet<&str> = rules.iter().map(|r| r.id.as_str()).collect();
    if ids.len() != rules.len() || ids.contains("") {
        return Err(bad("条件编号无效或重复"));
    }
    for rule in rules {
        if rule
            .logical_operator
            .as_deref()
            .is_some_and(|s| !["and", "or"].contains(&s))
        {
            return Err(bad("条件组逻辑无效"));
        }
        let mut parent = rule.parent_id.as_deref().filter(|s| !s.is_empty());
        let mut visited = HashSet::from([rule.id.as_str()]);
        while let Some(id) = parent {
            if !visited.insert(id) {
                return Err(bad("条件组存在循环"));
            }
            let ancestor = rules
                .iter()
                .find(|r| r.id == id)
                .ok_or_else(|| bad("条件父组不存在"))?;
            parent = ancestor.parent_id.as_deref().filter(|s| !s.is_empty());
        }
        if rule.is_group == Some(true) {
            if !rules
                .iter()
                .any(|r| r.parent_id.as_deref() == Some(&rule.id))
            {
                return Err(bad("条件组不能为空"));
            }
            continue;
        }
        if !rule
            .field_key
            .as_ref()
            .is_some_and(|key| fields.contains(key))
        {
            return Err(bad("条件字段不存在"));
        }
        let operator = rule.operator.as_deref().unwrap_or("eq");
        if !["eq", "neq", "inAny", "notInAny", "hasValue", "noValue"].contains(&operator) {
            return Err(bad("条件运算符无效"));
        }
        let value_type = rule.value_type.as_deref().unwrap_or("value");
        if !["value", "field"].contains(&value_type) {
            return Err(bad("条件比较类型无效"));
        }
        if ["hasValue", "noValue"].contains(&operator) {
            continue;
        }
        if value_type == "field" {
            if !rule
                .source_field_key
                .as_ref()
                .is_some_and(|key| fields.contains(key))
            {
                return Err(bad("比较字段不存在"));
            }
        } else if rule
            .raw_value
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(bad("请填写完整的条件比较值"));
        }
    }
    // Every sibling set uses one logical operator, including root conditions.
    for rule in rules {
        if rules.iter().any(|other| {
            other.parent_id.as_deref().filter(|s| !s.is_empty())
                == rule.parent_id.as_deref().filter(|s| !s.is_empty())
                && other.logical_operator.as_deref().unwrap_or("and")
                    != rule.logical_operator.as_deref().unwrap_or("and")
        }) {
            return Err(bad("同级条件逻辑必须一致"));
        }
    }
    if !rules.iter().any(|r| r.is_group != Some(true)) {
        return Err(bad("至少配置一个有效条件"));
    }
    Ok(())
}
pub(super) async fn validate_target(
    state: &AppState,
    headers: &HeaderMap,
    payload: &mut SaveCustomButtonRequest,
) -> Result<(), AppError> {
    if payload.action_type == "run_automation" {
        validate_configuration(payload, &json!({}), false)?;
        let flow = automation_for_button(
            state,
            payload.action_config.automation_id.as_deref().unwrap(),
        )
        .await?;
        let grants = authorization::grants(headers, state).await?;
        if !grants.contains("*")
            && !grants.contains(&format!("app:{}:display", flow.app_route_app_id))
        {
            return Err(AppError::Forbidden("无权访问自动化所属应用".into()));
        }
        return Ok(());
    }
    if payload.action_type == "open_page" {
        validate_configuration(payload, &json!({}), false)?;
        if payload.action_config.link_type.as_deref() == Some("external") {
            return Ok(());
        }
        let form = crate::modules::forms::find_form_definition(
            &state.db,
            &payload.action_config.target_form_uuid,
        )
        .await?;
        if form.app_route_app_id != payload.action_config.target_app_id {
            return Err(bad("目标表单应用不匹配"));
        }
        let grants = authorization::grants(headers, state).await?;
        let action = if payload.action_config.page_mode.as_deref() == Some("edit") {
            "edit"
        } else {
            "display"
        };
        if !grants.contains("*")
            && (!grants.contains(&format!("app:{}:display", form.app_route_app_id))
                || !grants.contains(&format!("form:{}:display", form.form_uuid))
                || !grants.contains(&format!("form:{}:{action}", form.form_uuid)))
        {
            return Err(AppError::Forbidden("无权访问目标页面".into()));
        }
        return Ok(());
    }
    let form = FormDefinitionEntity::find()
        .filter(
            form_definition_entity::Column::FormUuid.eq(&payload.action_config.target_form_uuid),
        )
        .one(&state.db)
        .await?
        .ok_or_else(|| bad("填写对象不存在"))?;
    if form.app_route_app_id != payload.action_config.target_app_id
        || !["normal", "workflow"].contains(&form.form_type.as_str())
    {
        return Err(bad("填写对象应用或表单类型不匹配"));
    }
    let grants = authorization::grants(headers, state).await?;
    if !grants.contains("*")
        && (!grants.contains(&format!("app:{}:display", form.app_route_app_id))
            || !grants.contains(&format!("form:{}:display", form.form_uuid)))
    {
        return Err(AppError::Forbidden("无权访问填写对象".into()));
    }
    let schema = FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(&form.form_uuid))
        .filter(form_schema_entity::Column::Version.eq(form.current_schema_version))
        .one(&state.db)
        .await?
        .ok_or_else(|| bad("填写对象缺少当前表单结构"))?;
    validate_configuration(payload, &schema.schema_json, form.form_type == "workflow")
}
pub(super) async fn find_button(
    db: &DatabaseConnection,
    form_uuid: &str,
    uuid: &str,
) -> Result<button::Model, AppError> {
    button::Entity::find()
        .filter(button::Column::FormUuid.eq(form_uuid))
        .filter(button::Column::ButtonUuid.eq(uuid))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("自定义按钮不存在".into()))
}
pub(super) async fn response(
    db: &DatabaseConnection,
    item: button::Model,
) -> Result<ApiCustomButton, AppError> {
    let config: FillFormConfig =
        serde_json::from_value(item.action_config).map_err(|_| bad("按钮动作配置损坏"))?;
    let target = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(&config.target_form_uuid))
        .one(db)
        .await?;
    Ok(ApiCustomButton {
        id: item.button_uuid,
        app_id: item.app_route_app_id,
        form_uuid: item.form_uuid,
        name: item.name,
        icon: item.icon,
        description: item.description,
        action_type: item.action_type,
        action_config: config,
        availability: serde_json::from_value(item.availability)
            .unwrap_or_else(|_| default_availability()),
        disabled_reason: item.disabled_reason,
        target_form_name: target.map(|f| f.name),
        created_by: item.created_by.to_string(),
        updated_by: item.updated_by.to_string(),
        created_at: item.created_at.to_rfc3339(),
        updated_at: item.updated_at.to_rfc3339(),
    })
}
pub(crate) async fn list_custom_buttons(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
    Query(query): Query<ListButtonsQuery>,
) -> Result<Json<ApiResponse<ApiCustomButtonList>>, AppError> {
    crate::modules::forms::find_form_definition(&state.db, &form_uuid).await?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
    let mut selection = button::Entity::find().filter(button::Column::FormUuid.eq(form_uuid));
    if let Some(search) = query.search.filter(|s| !s.trim().is_empty()) {
        selection = selection.filter(button::Column::Name.contains(search.trim()));
    }
    let total = selection.clone().count(&state.db).await?;
    let rows = selection
        .order_by_desc(button::Column::UpdatedAt)
        .order_by_asc(button::Column::Id)
        .offset(page.saturating_sub(1).saturating_mul(page_size))
        .limit(page_size)
        .all(&state.db)
        .await?;
    let mut items = vec![];
    for row in rows {
        items.push(response(&state.db, row).await?);
    }
    Ok(Json(success_response(
        "获取自定义按钮成功",
        ApiCustomButtonList {
            items,
            total,
            page,
            page_size,
        },
    )))
}
pub(crate) async fn get_custom_button(
    State(state): State<AppState>,
    Path((form_uuid, uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<ApiCustomButton>>, AppError> {
    Ok(Json(success_response(
        "获取自定义按钮成功",
        response(&state.db, find_button(&state.db, &form_uuid, &uuid).await?).await?,
    )))
}
pub(crate) async fn create_custom_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(form_uuid): Path<String>,
    Json(mut payload): Json<SaveCustomButtonRequest>,
) -> Result<Json<ApiResponse<ApiCustomButton>>, AppError> {
    let form = validate_owner_form(&state, &headers, &form_uuid, &payload).await?;
    validate_target(&state, &headers, &mut payload).await?;
    let actor = authorization::current_user(&headers, &state).await?;
    let now = Utc::now();
    let txn = state.db.begin().await?;
    lock_button_automation(&txn, &form.app_route_app_id, &form_uuid, &payload).await?;
    let item = button::ActiveModel {
        id: Set(Uuid::new_v4()),
        button_uuid: Set(format!("BTN-{}", Uuid::new_v4().simple())),
        app_route_app_id: Set(form.app_route_app_id),
        form_uuid: Set(form_uuid),
        name: Set(payload.name),
        icon: Set(payload.icon),
        description: Set(payload.description),
        action_type: Set(payload.action_type),
        action_config: Set(json!(payload.action_config)),
        availability: Set(json!(payload.availability)),
        disabled_reason: Set(payload.disabled_reason),
        created_by: Set(actor.id),
        updated_by: Set(actor.id),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "创建自定义按钮成功",
        response(&state.db, item).await?,
    )))
}
pub(crate) async fn update_custom_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, uuid)): Path<(String, String)>,
    Json(mut payload): Json<SaveCustomButtonRequest>,
) -> Result<Json<ApiResponse<ApiCustomButton>>, AppError> {
    let current = find_button(&state.db, &form_uuid, &uuid).await?;
    let form = validate_owner_form(&state, &headers, &form_uuid, &payload).await?;
    validate_target(&state, &headers, &mut payload).await?;
    let actor = authorization::current_user(&headers, &state).await?;
    let txn = state.db.begin().await?;
    lock_button_automation(&txn, &form.app_route_app_id, &form_uuid, &payload).await?;
    let mut item: button::ActiveModel = current.into();
    item.name = Set(payload.name);
    item.icon = Set(payload.icon);
    item.description = Set(payload.description);
    item.action_type = Set(payload.action_type);
    item.action_config = Set(json!(payload.action_config));
    item.availability = Set(json!(payload.availability));
    item.disabled_reason = Set(payload.disabled_reason);
    item.updated_by = Set(actor.id);
    item.updated_at = Set(Utc::now());
    let item = item.update(&txn).await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "更新自定义按钮成功",
        response(&state.db, item).await?,
    )))
}
pub(crate) async fn delete_custom_button(
    State(state): State<AppState>,
    Path((form_uuid, uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let item = find_button(&state.db, &form_uuid, &uuid).await?;
    button::Entity::delete_by_id(item.id)
        .exec(&state.db)
        .await?;
    Ok(Json(success_response("删除自定义按钮成功", json!({}))))
}
#[cfg(test)]
#[path = "custom_buttons/tests.rs"]
mod tests;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ButtonAutomationOption {
    pub id: String,
    pub name: String,
    pub status: String,
    pub source_form_uuid: String,
}
pub(super) async fn automation_for_button(
    state: &AppState,
    id: &str,
) -> Result<automation_flow_entity::Model, AppError> {
    let flow = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::FlowUuid.eq(id))
        .one(&state.db)
        .await?
        .ok_or_else(|| bad("绑定的集成自动化不存在"))?;
    if flow.flow_type != "trigger"
        || crate::shared::automation_trigger_events(&flow.trigger_config) != ["button_click"]
    {
        return Err(bad("请选择按钮触发自动化"));
    }
    Ok(flow)
}
pub(crate) async fn list_button_automation_options(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ButtonAutomationOption>>>, AppError> {
    let form = crate::modules::forms::find_form_definition(&state.db, &form_uuid).await?;
    let rows = AutomationFlowEntity::find()
        .filter(automation_flow_entity::Column::AppRouteAppId.eq(form.app_route_app_id))
        .filter(automation_flow_entity::Column::TriggerFormUuid.eq(Some(form_uuid)))
        .order_by_desc(automation_flow_entity::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let items = rows
        .into_iter()
        .filter(|flow| {
            flow.flow_type == "trigger"
                && crate::shared::automation_trigger_events(&flow.trigger_config)
                    == ["button_click"]
        })
        .map(|flow| ButtonAutomationOption {
            id: flow.flow_uuid,
            name: flow.name,
            status: flow.status,
            source_form_uuid: flow.trigger_form_uuid.unwrap_or_default(),
        })
        .collect();
    Ok(Json(success_response("获取按钮自动化选项成功", items)))
}

async fn lock_button_automation<C: ConnectionTrait>(
    db: &C,
    app_id: &str,
    form_uuid: &str,
    payload: &SaveCustomButtonRequest,
) -> Result<(), AppError> {
    if payload.action_type != "run_automation" {
        return Ok(());
    }
    let flow = AutomationFlowEntity::find()
        .filter(
            automation_flow_entity::Column::FlowUuid.eq(payload
                .action_config
                .automation_id
                .as_deref()
                .unwrap_or("")),
        )
        .lock_shared()
        .one(db)
        .await?
        .ok_or_else(|| bad("绑定的集成自动化不存在"))?;
    if flow.app_route_app_id != app_id
        || flow.flow_type != "trigger"
        || crate::shared::automation_trigger_events(&flow.trigger_config) != ["button_click"]
        || flow.trigger_form_uuid.as_deref() != Some(form_uuid)
    {
        return Err(bad("自动化来源配置已失效，请重新选择"));
    }
    Ok(())
}
