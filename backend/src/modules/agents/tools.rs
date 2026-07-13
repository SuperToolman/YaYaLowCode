use std::fmt::{Display, Formatter};

use rig_core::tool::Tool;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::infrastructure::entities::{
    automation_flow_entity, form_definition_entity, form_schema_entity,
};

#[derive(Debug)]
pub(crate) struct AgentToolError(String);

impl Display for AgentToolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AgentToolError {}

fn tool_error(message: impl Into<String>) -> AgentToolError {
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
