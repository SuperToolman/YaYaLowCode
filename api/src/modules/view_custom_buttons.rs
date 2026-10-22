//! View bindings and authorized custom button invocation.
use crate::infrastructure::entities::{custom_button_entity as button, form_view_entity};
use crate::modules::{automations, custom_buttons::*, forms};
use crate::platform::prelude::*;
use crate::platform::{authorization, records::RecordRepository};
use crate::shared::success_response;
use axum::http::{HeaderMap, Method};
use sea_orm::QuerySelect;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ViewButtonBinding {
    pub button_id: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewButtonRuntime {
    pub binding: ViewButtonBinding,
    pub definition: Option<ApiCustomButton>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonInvocation {
    pub record_id: String,
    pub data: Option<Value>,
}
fn bindings(config: &Value) -> Result<Vec<ViewButtonBinding>, AppError> {
    serde_json::from_value(config.get("customButtons").cloned().unwrap_or(json!([])))
        .map_err(|_| AppError::BadRequest("视图按钮绑定配置无效".into()))
}
async fn schema(state: &AppState, form_uuid: &str) -> Result<Value, AppError> {
    let form = forms::find_form_definition(&state.db, form_uuid).await?;
    Ok(FormSchemaEntity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form_uuid))
        .filter(form_schema_entity::Column::Version.eq(form.current_schema_version))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("表单结构不存在".into()))?
        .schema_json)
}
pub(crate) async fn validate_view_config(
    state: &AppState,
    form_uuid: &str,
    config: &Value,
) -> Result<(), AppError> {
    let rows = bindings(config)?;
    if rows.len() > 100 {
        return Err(AppError::BadRequest("一个视图最多绑定100个按钮".into()));
    }
    if rows.is_empty() {
        return Ok(());
    }
    let form = forms::find_form_definition(&state.db, form_uuid).await?;
    let schema_json = schema(state, form_uuid).await?;
    let fields = valid_condition_fields(&schema_json, form.form_type == "workflow");
    let mut seen = HashSet::new();
    for row in rows {
        if !seen.insert(row.button_id.clone()) {
            return Err(AppError::BadRequest("不能重复绑定同一个按钮".into()));
        }
        let button = find_button(&state.db, form_uuid, &row.button_id).await?;
        if button.action_type == "run_automation" {
            let config: FillFormConfig = serde_json::from_value(button.action_config.clone())
                .map_err(|_| AppError::BadRequest("按钮配置无效".into()))?;
            let flow =
                automation_for_button(state, config.automation_id.as_deref().unwrap_or("")).await?;
            if flow.app_route_app_id != form.app_route_app_id
                || flow.trigger_form_uuid.as_deref() != Some(form_uuid)
            {
                return Err(AppError::BadRequest("自动化来源表单不匹配".into()));
            }
        }
        if button.form_uuid != form_uuid {
            return Err(AppError::BadRequest("按钮不属于当前表单".into()));
        }
        let button = response(&state.db, button).await?;
        if button.disabled_reason.chars().count() > 1000 {
            return Err(AppError::BadRequest("禁用说明最多1000字".into()));
        }
        match button.availability.mode.as_str() {
            "all" if button.availability.rules.is_empty() => (),
            "conditions" => validate_rules(&button.availability.rules, &fields)?,
            _ => return Err(AppError::BadRequest("按钮可用条件模式无效".into())),
        }
    }
    Ok(())
}
async fn saved_bindings(
    state: &AppState,
    form_uuid: &str,
    view_uuid: &str,
) -> Result<Vec<ViewButtonBinding>, AppError> {
    let view = form_view_entity::Entity::find()
        .filter(form_view_entity::Column::FormUuid.eq(form_uuid))
        .filter(form_view_entity::Column::ViewUuid.eq(view_uuid))
        .one(&state.db)
        .await?;
    match view {
        Some(view) => bindings(&view.config_json),
        None if view_uuid == "default" => Ok(vec![]),
        None => Err(AppError::NotFound("视图不存在".into())),
    }
}
pub(crate) async fn list_view_button_options(
    State(state): State<AppState>,
    Path(form_uuid): Path<String>,
) -> Result<Json<ApiResponse<Vec<ApiCustomButton>>>, AppError> {
    let form = forms::find_form_definition(&state.db, &form_uuid).await?;
    let rows = button::Entity::find()
        .filter(button::Column::FormUuid.eq(&form_uuid))
        .order_by_desc(button::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let mut items = vec![];
    for row in rows {
        if row.action_type == "run_automation" {
            let config: FillFormConfig = serde_json::from_value(row.action_config.clone())
                .map_err(|_| AppError::BadRequest("按钮配置无效".into()))?;
            if automation_for_button(&state, config.automation_id.as_deref().unwrap_or(""))
                .await
                .is_ok_and(|flow| {
                    flow.app_route_app_id == form.app_route_app_id
                        && flow.trigger_form_uuid.as_deref() == Some(form_uuid.as_str())
                })
            {
                items.push(response(&state.db, row).await?);
            }
        } else {
            items.push(response(&state.db, row).await?);
        }
    }
    Ok(Json(success_response("获取可绑定按钮成功", items)))
}
pub(crate) async fn list_view_buttons(
    State(state): State<AppState>,
    Path((form_uuid, view_uuid)): Path<(String, String)>,
) -> Result<Json<ApiResponse<Vec<ViewButtonRuntime>>>, AppError> {
    let form = forms::find_form_definition(&state.db, &form_uuid).await?;
    let mut items = vec![];
    for binding in saved_bindings(&state, &form_uuid, &view_uuid).await? {
        let row = button::Entity::find()
            .filter(button::Column::AppRouteAppId.eq(&form.app_route_app_id))
            .filter(button::Column::ButtonUuid.eq(&binding.button_id))
            .one(&state.db)
            .await?;
        items.push(ViewButtonRuntime {
            binding,
            definition: match row {
                Some(row) if row.form_uuid == form_uuid => Some(response(&state.db, row).await?),
                _ => None,
            },
        });
    }
    Ok(Json(success_response("获取视图按钮成功", items)))
}
async fn check_invocation(
    state: &AppState,
    headers: &HeaderMap,
    form_uuid: &str,
    view_uuid: &str,
    button_uuid: &str,
    record_id: &str,
) -> Result<ApiCustomButton, AppError> {
    authorization::authorize_request(
        headers,
        state,
        &Method::GET,
        &format!("/api/forms/{form_uuid}/records"),
    )
    .await?;
    let form = forms::find_form_definition(&state.db, form_uuid).await?;
    let _binding = saved_bindings(state, form_uuid, view_uuid)
        .await?
        .into_iter()
        .find(|b| b.button_id == button_uuid)
        .ok_or_else(|| AppError::BadRequest("按钮尚未绑定到已保存视图，请先保存配置".into()))?;
    let row = find_button(&state.db, form_uuid, button_uuid).await?;
    let definition = response(&state.db, row.clone()).await?;
    let record = RecordRepository::new(&state.db)
        .find(form_uuid, record_id)
        .await?;
    if definition.availability.mode == "conditions" {
        validate_rules(
            &definition.availability.rules,
            &valid_condition_fields(
                &schema(state, form_uuid).await?,
                form.form_type == "workflow",
            ),
        )?;
        let rules = definition
            .availability
            .rules
            .iter()
            .map(|r| json!(r))
            .collect::<Vec<_>>();
        let mut data = automations::record_data_with_automation_identity(record.clone());
        if definition.availability.rules.iter().any(|r| {
            r.field_key.as_deref() == Some("submitterOrganization")
                || r.source_field_key.as_deref() == Some("submitterOrganization")
        }) {
            let user = crate::infrastructure::entities::iam_user_entity::Entity::find()
                .filter(
                    crate::infrastructure::entities::iam_user_entity::Column::DisplayName
                        .eq(&record.created_by),
                )
                .one(&state.db)
                .await?;
            let organization = if let Some(id) =
                user.and_then(|user| user.primary_organization_unit_id)
            {
                crate::infrastructure::entities::organization_unit_entity::Entity::find_by_id(id)
                    .one(&state.db)
                    .await?
                    .map(|unit| unit.name)
            } else {
                None
            };
            data["submitterOrganization"] = json!(organization);
        }
        if !automations::expression::evaluate_record_rule_group(&rules, None, &data) {
            return Err(AppError::BadRequest(
                if definition.disabled_reason.trim().is_empty() {
                    "当前数据不满足按钮可用条件".into()
                } else {
                    definition.disabled_reason
                },
            ));
        }
    } else if definition.availability.mode != "all" {
        return Err(AppError::BadRequest("按钮条件无效".into()));
    }
    if row.form_uuid != form_uuid {
        return Err(AppError::BadRequest("按钮不属于当前表单".into()));
    }
    let definition = response(&state.db, row).await?;
    let mut payload = SaveCustomButtonRequest {
        name: definition.name.clone(),
        icon: definition.icon.clone(),
        description: definition.description.clone(),
        action_type: definition.action_type.clone(),
        action_config: definition.action_config.clone(),
        availability: definition.availability.clone(),
        disabled_reason: definition.disabled_reason.clone(),
    };
    if definition.action_type == "run_automation" {
        let flow = automation_for_button(
            state,
            definition
                .action_config
                .automation_id
                .as_deref()
                .unwrap_or(""),
        )
        .await?;
        if flow.app_route_app_id != form.app_route_app_id
            || flow.trigger_form_uuid.as_deref() != Some(form_uuid)
        {
            return Err(AppError::BadRequest("自动化来源表单不匹配".into()));
        }
    } else {
        validate_target(state, headers, &mut payload).await?;
    }
    if definition.action_type == "fill_form" {
        authorization::authorize_request(
            headers,
            state,
            &Method::POST,
            &format!(
                "/api/forms/{}/records",
                definition.action_config.target_form_uuid
            ),
        )
        .await?;
    }
    Ok(definition)
}
pub(crate) async fn prepare_view_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, view_uuid, button_uuid)): Path<(String, String, String)>,
    Json(payload): Json<ButtonInvocation>,
) -> Result<Json<ApiResponse<ApiCustomButton>>, AppError> {
    let definition = check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    Ok(Json(success_response("按钮可执行", definition)))
}
pub(crate) async fn submit_view_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, view_uuid, button_uuid)): Path<(String, String, String)>,
    Json(payload): Json<ButtonInvocation>,
) -> Result<
    (
        axum::http::StatusCode,
        Json<ApiResponse<forms::ApiFormRecord>>,
    ),
    AppError,
> {
    let definition = check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    let data = payload
        .data
        .ok_or_else(|| AppError::BadRequest("缺少填写数据".into()))?;
    if definition.action_type != "fill_form" {
        return Err(AppError::BadRequest("该按钮不支持提交表单".into()));
    }
    let values = data
        .as_object()
        .ok_or_else(|| AppError::BadRequest("填写数据必须为对象".into()))?;
    if values
        .keys()
        .any(|id| !definition.action_config.field_ids.contains(id))
    {
        return Err(AppError::BadRequest("不能提交按钮配置之外的字段".into()));
    }
    forms::create_form_record(
        State(state),
        headers,
        Path(definition.action_config.target_form_uuid),
        Json(forms::CreateFormRecordRequest { data }),
    )
    .await
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExecuteButtonRequest {
    pub record_id: String,
    pub request_id: Uuid,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteButtonResponse {
    pub run_id: String,
    pub status: String,
}
pub(crate) async fn execute_view_button(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((form_uuid, view_uuid, button_uuid)): Path<(String, String, String)>,
    Json(payload): Json<ExecuteButtonRequest>,
) -> Result<Json<ApiResponse<ExecuteButtonResponse>>, AppError> {
    let definition = check_invocation(
        &state,
        &headers,
        &form_uuid,
        &view_uuid,
        &button_uuid,
        &payload.record_id,
    )
    .await?;
    if definition.action_type != "run_automation" {
        return Err(AppError::BadRequest("该按钮不支持执行自动化".into()));
    }
    let source_form = forms::find_form_definition(&state.db, &form_uuid).await?;
    if !["normal", "workflow"].contains(&source_form.form_type.as_str()) {
        return Err(AppError::BadRequest(
            "按钮触发来源必须为普通或流程表单".into(),
        ));
    }
    let user = authorization::current_user(&headers, &state).await?;
    let txn = state.db.begin().await?;
    let flow = AutomationFlowEntity::find()
        .filter(
            automation_flow_entity::Column::FlowUuid.eq(definition
                .action_config
                .automation_id
                .as_deref()
                .unwrap_or("")),
        )
        .lock_shared()
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::BadRequest("自动化不存在".into()))?;
    if flow.status != "enabled"
        || flow.flow_type != "trigger"
        || crate::shared::automation_trigger_events(&flow.trigger_config) != ["button_click"]
        || flow.app_route_app_id != definition.app_id
        || flow.trigger_form_uuid.as_deref() != Some(form_uuid.as_str())
    {
        return Err(AppError::BadRequest("自动化未启用或来源配置已失效".into()));
    }
    automations::validate_execution_definition(&flow)?;
    automations::validate_execution_sources(&txn, &flow).await?;
    let record = RecordRepository::new(&txn)
        .find(&form_uuid, &payload.record_id)
        .await?;
    let input = automations::record_data_with_automation_identity(record);
    let event_id = serde_json::to_string(&(
        user.id,
        &button_uuid,
        &view_uuid,
        &form_uuid,
        &payload.record_id,
        payload.request_id,
    ))
    .map_err(|e| AppError::Server(std::io::Error::other(e.to_string())))?;
    let id = automations::execution::start_execution(
        &txn,
        automations::execution::StartExecutionRequest {
            flow: &flow,
            source: automations::execution::TriggerSource {
                kind: "button".into(),
                event: "button_click".into(),
                event_id,
                form_uuid: Some(form_uuid),
                record_uuid: Some(payload.record_id),
                button_uuid: Some(button_uuid),
                view_uuid: Some(view_uuid),
            },
            identity: automations::execution::ExecutionIdentity {
                user_id: Some(user.id),
                display_name: user.display_name.clone(),
                operator: user.display_name,
            },
            policy: automations::execution::ExecutionPolicy::Background,
            input: &input,
            instance_id: None,
            start_node: "trigger-1",
            outputs: None,
            retry_source: None,
            retry_run: None,
        },
    )
    .await?;
    let run = AutomationRunEntity::find_by_id(id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::Server(std::io::Error::other("运行不存在")))?;
    txn.commit().await?;
    Ok(Json(success_response(
        "已触发集成自动化",
        ExecuteButtonResponse {
            run_id: run.run_uuid,
            status: "accepted".into(),
        },
    )))
}
