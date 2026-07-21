use std::fmt::{Display, Formatter};

use rig_core::tool::Tool;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, QueryOrder,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::infrastructure::entities::{
    app_entity, automation_flow_entity, form_definition_entity, form_schema_entity,
};
use crate::modules::forms::create_blank_form;

#[derive(Debug)]
pub(crate) struct AgentToolError(String);

impl Display for AgentToolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AgentToolError {}

pub(crate) fn tool_error(message: impl Into<String>) -> AgentToolError {
    AgentToolError(message.into())
}

fn resolve_app_id(
    allowed_app_id: &Option<String>,
    requested_app_id: Option<String>,
) -> Result<String, AgentToolError> {
    match (allowed_app_id, requested_app_id) {
        (Some(allowed), Some(requested)) if requested != *allowed => Err(tool_error(
            "requested app is outside the current Agent context",
        )),
        (Some(allowed), _) => Ok(allowed.clone()),
        (None, Some(requested)) if !requested.trim().is_empty() => Ok(requested),
        _ => Err(tool_error("appId is required")),
    }
}

#[derive(Clone)]
pub(crate) struct ListFormsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct ListAppsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) enabled: bool,
}
#[derive(Deserialize)]
pub(crate) struct ListAppsArgs {
    #[serde(default)]
    query: Option<String>,
}
impl Tool for ListAppsTool {
    const NAME: &'static str = "list_apps";
    type Error = AgentToolError;
    type Args = ListAppsArgs;
    type Output = Value;
    fn description(&self) -> String {
        "读取当前用户可见的应用列表，可按名称关键词筛选，用于将应用名称定位为 app_id。".to_string()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"query":{"type":"string"}}})
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let mut query = app_entity::Entity::find();
        if let Some(keyword) = args.query.filter(|value| !value.trim().is_empty()) {
            query = query.filter(app_entity::Column::Name.contains(keyword.trim()));
        }
        let apps = query
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        Ok(json!(apps.into_iter().map(|app| json!({"appId":app.route_app_id,"name":app.name,"description":app.description,"status":app.status})).collect::<Vec<_>>()))
    }
}

#[derive(Deserialize)]
pub(crate) struct ListFormsArgs {
    app_id: Option<String>,
}

impl Tool for ListFormsTool {
    const NAME: &'static str = "list_forms";
    type Error = AgentToolError;
    type Args = ListFormsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "列出指定低代码应用中的表单，只返回表单元数据，不修改任何内容。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "app_id": { "type": "string", "description": "应用 ID；当前页面已有应用上下文时可省略" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        let forms = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .order_by_desc(form_definition_entity::Column::UpdatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        Ok(json!({
            "appId": app_id,
            "forms": forms.into_iter().map(|form| json!({
                "id": form.form_uuid,
                "name": form.name,
                "slug": form.slug,
                "status": form.status,
                "draftSchemaVersion": form.draft_schema_version,
                "publishedSchemaVersion": form.published_schema_version,
            })).collect::<Vec<_>>()
        }))
    }
}

#[derive(Clone)]
pub(crate) struct GetFormSchemaTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetFormSchemaArgs {
    form_uuid: String,
}

impl Tool for GetFormSchemaTool {
    const NAME: &'static str = "get_form_schema";
    type Error = AgentToolError;
    type Args = GetFormSchemaArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取一个表单当前草稿 Schema，用于解释字段和页面结构，不修改表单。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "required": ["form_uuid"],
            "properties": {
                "form_uuid": { "type": "string", "description": "表单 UUID" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(args.form_uuid.clone()))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if self
            .allowed_app_id
            .as_ref()
            .is_some_and(|app_id| definition.app_route_app_id != *app_id)
        {
            return Err(tool_error("form is outside the current Agent context"));
        }
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(definition.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form schema not found"))?;
        Ok(json!({
            "formId": definition.form_uuid,
            "formName": definition.name,
            "version": schema.version,
            "schema": schema.schema_json,
        }))
    }
}

#[derive(Clone)]
pub(crate) struct ListAutomationsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct ListAutomationsArgs {
    app_id: Option<String>,
}

impl Tool for ListAutomationsTool {
    const NAME: &'static str = "list_automations";
    type Error = AgentToolError;
    type Args = ListAutomationsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "列出应用中的集成自动化及其状态，只读取元数据。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "app_id": { "type": "string", "description": "应用 ID；当前页面已有应用上下文时可省略" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        let flows = automation_flow_entity::Entity::find()
            .filter(automation_flow_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .order_by_desc(automation_flow_entity::Column::UpdatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        Ok(json!({
            "appId": app_id,
            "automations": flows.into_iter().map(|flow| json!({
                "id": flow.flow_uuid,
                "name": flow.name,
                "description": flow.description,
                "status": flow.status,
                "triggerFormUuid": flow.trigger_form_uuid,
                "triggerEvent": flow.trigger_event,
                "currentVersion": flow.current_version,
                "nodesCount": flow.nodes_json.as_array().map(Vec::len).unwrap_or(0),
            })).collect::<Vec<_>>()
        }))
    }
}

#[derive(Clone)]
pub(crate) struct GetAutomationGraphTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct CreateFormDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct SaveFormSchemaDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}
#[derive(Deserialize)]
pub(crate) struct SaveFormSchemaDraftArgs {
    form_uuid: String,
    schema: Value,
}
impl Tool for SaveFormSchemaDraftTool {
    const NAME: &'static str = "save_form_schema_draft";
    type Error = AgentToolError;
    type Args = SaveFormSchemaDraftArgs;
    type Output = Value;
    fn description(&self) -> String {
        "保存 YaYa 设计器的完整扁平 Schema 为未发布草稿。schema 必须包含 formName、columns、rows 和 fields 数组；fields 中每项必须有 id、type、row、column、width、height。分组成员必须平铺在 fields 中并以 parentGroupId 关联，禁止使用 components 或 children 嵌套结构。".to_string()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid","schema"],"properties":{"form_uuid":{"type":"string"},"schema":{"type":"object"}}})
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        validate_designer_schema(&args.schema)?;
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.form_uuid))
            .one(&self.db)
            .await
            .map_err(|e| tool_error(e.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|id| id != definition.app_route_app_id)
        {
            return Err(tool_error("form is outside current application"));
        }
        let version = definition.latest_schema_version + 1;
        let now = chrono::Utc::now();
        form_schema_entity::ActiveModel {
            id: Set(uuid::Uuid::new_v4()),
            form_uuid: Set(args.form_uuid.clone()),
            version: Set(version),
            schema_json: Set(args.schema.clone()),
            change_log: Set(Some("Agent saved schema draft".to_string())),
            published: Set(false),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&self.db)
        .await
        .map_err(|e| tool_error(e.to_string()))?;
        let mut active = definition.into_active_model();
        active.draft_schema_version = Set(version);
        active.latest_schema_version = Set(version);
        active.updated_at = Set(now.into());
        active
            .update(&self.db)
            .await
            .map_err(|e| tool_error(e.to_string()))?;
        Ok(json!({"formUuid":args.form_uuid,"version":version,"status":"draft"}))
    }
}

#[derive(Deserialize)]
pub(crate) struct CreateFormDraftArgs {
    app_id: Option<String>,
    name: String,
}

impl Tool for CreateFormDraftTool {
    const NAME: &'static str = "create_form_draft";
    type Error = AgentToolError;
    type Args = CreateFormDraftArgs;
    type Output = Value;

    fn description(&self) -> String {
        "在当前允许的应用中创建一个未发布的空白表单草稿。仅当配置文件启用“允许创建表单”时可用。"
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "app_id": { "type": "string", "description": "目标应用 ID；当前页面有应用上下文时可省略" },
                "name": { "type": "string", "description": "新表单名称" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        if args.name.trim().is_empty() {
            return Err(tool_error("form name is required"));
        }
        let form = create_blank_form(&self.db, &app_id, Some(args.name))
            .await
            .map_err(|error| tool_error(format!("form draft creation failed: {error:?}")))?;
        Ok(json!({
            "id": form.form_uuid,
            "appId": form.app_route_app_id,
            "name": form.name,
            "status": form.status,
            "message": "form draft created; it has not been published by the Agent",
        }))
    }
}

#[derive(Deserialize)]
pub(crate) struct GetAutomationGraphArgs {
    automation_id: String,
}

impl Tool for GetAutomationGraphTool {
    const NAME: &'static str = "get_automation_graph";
    type Error = AgentToolError;
    type Args = GetAutomationGraphArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取集成自动化的触发配置、节点和连线，用于解释流程，不执行也不修改自动化。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "required": ["automation_id"],
            "properties": {
                "automation_id": { "type": "string", "description": "自动化 ID" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let flow = automation_flow_entity::Entity::find()
            .filter(automation_flow_entity::Column::FlowUuid.eq(args.automation_id))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("automation not found"))?;
        if self
            .allowed_app_id
            .as_ref()
            .is_some_and(|app_id| flow.app_route_app_id != *app_id)
        {
            return Err(tool_error(
                "automation is outside the current Agent context",
            ));
        }
        Ok(json!({
            "id": flow.flow_uuid,
            "name": flow.name,
            "description": flow.description,
            "status": flow.status,
            "triggerFormUuid": flow.trigger_form_uuid,
            "triggerEvent": flow.trigger_event,
            "triggerConfig": flow.trigger_config,
            "nodes": flow.nodes_json,
            "edges": flow.edges_json,
            "currentVersion": flow.current_version,
        }))
    }
}

fn ensure_enabled(enabled: bool, tool_name: &str) -> Result<(), AgentToolError> {
    if enabled {
        Ok(())
    } else {
        Err(tool_error(format!(
            "tool '{tool_name}' is not allowed by the current Agent profile skills"
        )))
    }
}

fn validate_designer_schema(schema: &Value) -> Result<(), AgentToolError> {
    let object = schema
        .as_object()
        .ok_or_else(|| tool_error("schema must be an object"))?;
    if object.contains_key("components") || !object.get("fields").is_some_and(Value::is_array) {
        return Err(tool_error(
            "schema must use the YaYa flat fields format, not components/children",
        ));
    }
    let fields = object
        .get("fields")
        .and_then(Value::as_array)
        .expect("fields was validated as an array");
    for field in fields {
        let item = field
            .as_object()
            .ok_or_else(|| tool_error("every field must be an object"))?;
        for key in ["id", "type", "row", "column", "width", "height"] {
            if !item.contains_key(key) {
                return Err(tool_error(format!("field is missing '{key}'")));
            }
        }
    }
    Ok(())
}
