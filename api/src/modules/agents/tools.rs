use std::collections::HashSet;
use std::fmt::{Display, Formatter};

use rig_core::tool::Tool;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::infrastructure::entities::{
    agent_pending_action_entity, app_entity, automation_flow_entity, form_definition_entity,
    form_detail_definition_entity, form_schema_entity, iam_organization_membership_entity,
    iam_user_entity, organization_unit_entity, workflow_action_entity, workflow_instance_entity,
    workflow_task_entity,
};
use crate::platform::config::load_application_business_context_settings;
use crate::platform::records::RecordRepository;

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

/// Effective application permissions for one Agent run. Tools must use this
/// context instead of bypassing the platform RBAC layer with raw DB queries.
#[derive(Clone)]
pub(crate) struct AgentAccessScope {
    grants: HashSet<String>,
    principal_user_id: Option<uuid::Uuid>,
}

impl AgentAccessScope {
    pub(crate) fn for_user(grants: HashSet<String>, principal_user_id: uuid::Uuid) -> Self {
        Self {
            grants,
            principal_user_id: Some(principal_user_id),
        }
    }

    pub(crate) fn require_app_access(&self, app_id: &str) -> Result<(), String> {
        if self.can_access_app(app_id) {
            Ok(())
        } else {
            Err("application visibility permission denied".to_string())
        }
    }

    pub(crate) fn require_agent_use(&self, agent_id: &str) -> Result<(), String> {
        if self.grants.contains("*")
            || self.grants.contains("settings.agent")
            || self.grants.contains(&format!("agent:{agent_id}:use"))
        {
            Ok(())
        } else {
            Err("agent use permission denied".to_string())
        }
    }

    fn can_access_app(&self, app_id: &str) -> bool {
        self.grants.contains("*")
            || self.grants.contains("apps.manage")
            || self.grants.contains(&format!("app:{app_id}:display"))
    }

    fn can_access_form(&self, form_uuid: &str) -> bool {
        self.grants.contains("*") || self.grants.contains(&format!("form:{form_uuid}:display"))
    }

    pub(crate) fn require_form_access(&self, app_id: &str, form_uuid: &str) -> Result<(), String> {
        self.require_app_access(app_id)?;
        if self.can_access_form(form_uuid) {
            Ok(())
        } else {
            Err("form visibility permission denied".to_string())
        }
    }

    pub(crate) fn can_create_form(&self, app_id: &str) -> bool {
        self.grants.contains("*") || self.grants.contains(&format!("app:{app_id}:create_form"))
    }

    pub(crate) fn can_edit_form(&self, app_id: &str) -> bool {
        self.grants.contains("*") || self.grants.contains(&format!("app:{app_id}:edit_form"))
    }

    pub(crate) fn can_manage_automations(&self, app_id: &str) -> bool {
        self.grants.contains("*") || self.grants.contains(&format!("app:{app_id}:automation"))
    }

    fn record_data_scope(&self, form_uuid: &str) -> AgentRecordDataScope {
        if self.grants.contains("*") {
            return AgentRecordDataScope::All;
        }
        let prefix = format!("form:{form_uuid}:data_scope:");
        let has = |value| self.grants.contains(&format!("{prefix}{value}"));
        if has("none") {
            AgentRecordDataScope::None
        } else if has("self") {
            AgentRecordDataScope::SelfOnly
        } else if has("department") {
            AgentRecordDataScope::Department
        } else if has("sub_department") {
            AgentRecordDataScope::SubDepartment
        } else {
            AgentRecordDataScope::All
        }
    }

    fn has_restricted_record_data_scope(&self, form_uuid: &str) -> bool {
        self.record_data_scope(form_uuid) != AgentRecordDataScope::All
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentRecordDataScope {
    All,
    SelfOnly,
    Department,
    SubDepartment,
    None,
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

async fn filter_agent_records_by_data_scope(
    db: &DatabaseConnection,
    access: &AgentAccessScope,
    form_uuid: &str,
    records: Vec<crate::platform::records::StoredFormRecord>,
) -> Result<Vec<crate::platform::records::StoredFormRecord>, AgentToolError> {
    let scope = access.record_data_scope(form_uuid);
    if scope == AgentRecordDataScope::All {
        return Ok(records);
    }
    if scope == AgentRecordDataScope::None {
        return Err(tool_error("record data permission denied"));
    }
    let principal_user_id = access.principal_user_id.ok_or_else(|| {
        tool_error("current user context is required for restricted record access")
    })?;
    let creator_names = records
        .iter()
        .map(|record| record.created_by.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if creator_names.is_empty() {
        return Ok(records);
    }
    let users = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::DisplayName.is_in(creator_names))
        .all(db)
        .await
        .map_err(|error| tool_error(error.to_string()))?;
    let mut user_ids_by_name = std::collections::HashMap::<String, Vec<uuid::Uuid>>::new();
    for user in users {
        user_ids_by_name
            .entry(user.display_name)
            .or_default()
            .push(user.id);
    }
    let creator_ids = user_ids_by_name
        .values()
        .filter(|ids| ids.len() == 1)
        .map(|ids| ids[0])
        .collect::<HashSet<_>>();
    let visible_creator_ids = match scope {
        AgentRecordDataScope::SelfOnly => HashSet::from([principal_user_id]),
        AgentRecordDataScope::Department | AgentRecordDataScope::SubDepartment => {
            let principal_units = iam_organization_membership_entity::Entity::find()
                .filter(iam_organization_membership_entity::Column::UserId.eq(principal_user_id))
                .all(db)
                .await
                .map_err(|error| tool_error(error.to_string()))?
                .into_iter()
                .map(|membership| membership.organization_unit_id)
                .collect::<HashSet<_>>();
            if principal_units.is_empty() {
                HashSet::new()
            } else {
                let allowed_units = if scope == AgentRecordDataScope::Department {
                    principal_units
                } else {
                    let units = organization_unit_entity::Entity::find()
                        .all(db)
                        .await
                        .map_err(|error| tool_error(error.to_string()))?;
                    let mut allowed = principal_units.clone();
                    let mut frontier = units
                        .iter()
                        .filter(|unit| principal_units.contains(&unit.id))
                        .map(|unit| (unit.source_type.clone(), unit.external_id.clone()))
                        .collect::<Vec<_>>();
                    while !frontier.is_empty() {
                        let parents = frontier.drain(..).collect::<HashSet<_>>();
                        let children = units
                            .iter()
                            .filter(|unit| {
                                unit.parent_external_id.as_ref().is_some_and(|parent| {
                                    parents.contains(&(unit.source_type.clone(), parent.clone()))
                                }) && allowed.insert(unit.id)
                            })
                            .collect::<Vec<_>>();
                        frontier = children
                            .into_iter()
                            .map(|unit| (unit.source_type.clone(), unit.external_id.clone()))
                            .collect();
                    }
                    allowed
                };
                let memberships = iam_organization_membership_entity::Entity::find()
                    .filter(
                        iam_organization_membership_entity::Column::UserId
                            .is_in(creator_ids.into_iter().collect::<Vec<_>>()),
                    )
                    .all(db)
                    .await
                    .map_err(|error| tool_error(error.to_string()))?;
                memberships
                    .into_iter()
                    .filter(|membership| allowed_units.contains(&membership.organization_unit_id))
                    .map(|membership| membership.user_id)
                    .collect()
            }
        }
        AgentRecordDataScope::All | AgentRecordDataScope::None => unreachable!(),
    };
    Ok(records
        .into_iter()
        .filter(|record| {
            user_ids_by_name
                .get(&record.created_by)
                .is_some_and(|ids| ids.len() == 1 && visible_creator_ids.contains(&ids[0]))
        })
        .collect())
}

async fn create_pending_action(
    db: &DatabaseConnection,
    session_id: uuid::Uuid,
    action_type: &str,
    payload: Value,
    summary: String,
) -> Result<Value, AgentToolError> {
    let now = chrono::Utc::now();
    let action_uuid = format!("AACT-{}", uuid::Uuid::new_v4().simple());
    agent_pending_action_entity::ActiveModel {
        id: Set(uuid::Uuid::new_v4()),
        action_uuid: Set(action_uuid.clone()),
        session_id: Set(session_id),
        action_type: Set(action_type.to_string()),
        payload_json: Set(payload),
        summary: Set(summary.clone()),
        status: Set("pending".to_string()),
        expires_at: Set((now + chrono::Duration::hours(24)).into()),
        confirmed_at: Set(None),
        error_message: Set(None),
        created_at: Set(now.into()),
        completed_at: Set(None),
    }
    .insert(db)
    .await
    .map_err(|error| tool_error(error.to_string()))?;
    Ok(
        json!({"pendingAction": {"id": action_uuid, "type": action_type, "summary": summary, "expiresInSeconds": 86400}}),
    )
}

#[derive(Clone)]
pub(crate) struct ListFormsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct ListAppsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct GetApplicationBusinessContextTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetApplicationBusinessContextArgs {
    #[serde(default)]
    app_id: Option<String>,
}

impl Tool for GetApplicationBusinessContextTool {
    const NAME: &'static str = "get_application_business_context";
    type Error = AgentToolError;
    type Args = GetApplicationBusinessContextArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取一个应用的业务地图：应用说明、表单、字段摘要、关联关系、明细父表关系和流程表单标识。用于多表分析前建立上下文，不读取业务记录。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"app_id":{"type":"string","description":"应用 ID；当前页面有应用上下文时可省略"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        self.access
            .require_app_access(&app_id)
            .map_err(tool_error)?;
        let app = app_entity::Entity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id.clone()))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("application not found"))?;
        let forms = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .order_by_desc(form_definition_entity::Column::UpdatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .into_iter()
            .filter(|form| self.access.can_access_form(&form.form_uuid))
            .collect::<Vec<_>>();
        let form_names = forms
            .iter()
            .map(|form| (form.form_uuid.clone(), form.name.clone()))
            .collect::<std::collections::HashMap<_, _>>();
        let detail_form_ids = forms
            .iter()
            .map(|form| form.form_uuid.clone())
            .collect::<Vec<_>>();
        let detail_relations = if detail_form_ids.is_empty() {
            Vec::new()
        } else {
            form_detail_definition_entity::Entity::find()
                .filter(
                    form_detail_definition_entity::Column::DetailFormUuid.is_in(detail_form_ids),
                )
                .all(&self.db)
                .await
                .map_err(|error| tool_error(error.to_string()))?
        }
        .into_iter()
        .map(|relation| (relation.detail_form_uuid.clone(), relation))
        .collect::<std::collections::HashMap<_, _>>();
        let mut form_summaries = Vec::new();
        for form in forms {
            let schema = form_schema_entity::Entity::find()
                .filter(form_schema_entity::Column::FormUuid.eq(form.form_uuid.clone()))
                .filter(form_schema_entity::Column::Version.eq(form.draft_schema_version))
                .one(&self.db)
                .await
                .map_err(|error| tool_error(error.to_string()))?;
            let fields = schema
                .as_ref()
                .and_then(|schema| schema.schema_json.get("fields"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let field_summaries = fields.iter().take(50).map(|field| {
                let props = field.get("props");
                let target_id = props.and_then(|props| props.get("associationFormId")).and_then(Value::as_str);
                json!({"id": field.get("id").and_then(Value::as_str), "label": field.get("label").and_then(Value::as_str), "type": field.get("type").and_then(Value::as_str), "parentGroupId": field.get("parentGroupId").and_then(Value::as_str), "associationTarget": target_id.and_then(|id| form_names.get(id)).map(|name| json!({"name": name})), "associationTargetUnavailable": target_id.is_some_and(|id| !form_names.contains_key(id))})
            }).collect::<Vec<_>>();
            let detail_relation = detail_relations.get(&form.form_uuid);
            form_summaries.push(json!({
                "id": form.form_uuid,
                "name": form.name,
                "formType": form.form_type,
                "status": form.status,
                "fields": field_summaries,
                "omittedFieldCount": fields.len().saturating_sub(50),
                "detailParent": detail_relation.map(|relation| json!({"formId": relation.source_form_uuid, "formName": form_names.get(&relation.source_form_uuid), "subformFieldId": relation.subform_field_id})),
            }));
        }
        let business_context = load_application_business_context_settings()
            .and_then(|settings| settings.applications.get(&app_id).cloned())
            .filter(|context| !context.is_empty());
        Ok(json!({
            "application": {"id": app.route_app_id, "name": app.name, "description": app.description, "status": app.status},
            "businessContext": business_context,
            "forms": form_summaries,
        }))
    }
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
        Ok(json!(apps.into_iter()
            .filter(|app| self.access.can_access_app(&app.route_app_id))
            .map(|app| json!({"appId":app.route_app_id,"name":app.name,"description":app.description,"status":app.status}))
            .collect::<Vec<_>>()))
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
        self.access
            .require_app_access(&app_id)
            .map_err(tool_error)?;
        let forms = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id.clone()))
            .order_by_desc(form_definition_entity::Column::UpdatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        Ok(json!({
            "appId": app_id,
            "forms": forms.into_iter().filter(|form| self.access.can_access_form(&form.form_uuid)).map(|form| json!({
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
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct GetFormRelationshipsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetFormRelationshipsArgs {
    form_uuid: String,
}

impl Tool for GetFormRelationshipsTool {
    const NAME: &'static str = "get_form_relationships";
    type Error = AgentToolError;
    type Args = GetFormRelationshipsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取表单 Schema 中配置的关联字段及其目标表单，用于规划跨表查询；不执行关联写入。"
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid"],"properties":{"form_uuid":{"type":"string","description":"源表单 UUID"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let source = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != source.app_route_app_id)
        {
            return Err(tool_error("form is outside the current Agent context"));
        }
        self.access
            .require_form_access(&source.app_route_app_id, &source.form_uuid)
            .map_err(tool_error)?;
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(source.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(source.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form schema not found"))?;
        let mut relationships = Vec::new();
        for field in schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let props = field.get("props").and_then(Value::as_object);
            let target_form_uuid = props
                .and_then(|props| props.get("associationFormId"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            let Some(target_form_uuid) = target_form_uuid else {
                continue;
            };
            let target = form_definition_entity::Entity::find()
                .filter(form_definition_entity::Column::FormUuid.eq(target_form_uuid))
                .one(&self.db)
                .await
                .map_err(|error| tool_error(error.to_string()))?;
            let target_info = target.filter(|form| {
                form.app_route_app_id == source.app_route_app_id
                    && self.access.can_access_form(&form.form_uuid)
            });
            relationships.push(json!({
                "fieldId": field.get("id").and_then(Value::as_str),
                "fieldLabel": field.get("label").and_then(Value::as_str),
                "componentType": field.get("type").and_then(Value::as_str),
                "targetForm": target_info.as_ref().map(|form| json!({"id": form.form_uuid, "name": form.name, "formType": form.form_type})),
                "targetUnavailable": target_info.is_none(),
                "display": {"primaryFieldId": props.and_then(|value| value.get("associationPrimaryFieldId")).and_then(Value::as_str), "secondaryFieldId": props.and_then(|value| value.get("associationSecondaryFieldId")).and_then(Value::as_str), "tableFieldIds": props.and_then(|value| value.get("associationTableFieldIds"))},
                "filters": props.and_then(|value| value.get("associationFilters")),
                "fills": props.and_then(|value| value.get("associationFills")),
                "subformFills": props.and_then(|value| value.get("associationSubformFills")),
            }));
        }
        Ok(
            json!({"formId": source.form_uuid, "formName": source.name, "relationships": relationships}),
        )
    }
}

#[derive(Clone)]
pub(crate) struct GetRelatedRecordsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetRelatedRecordsArgs {
    source_form_uuid: String,
    relationship_field_id: String,
    record_uuids: Vec<String>,
    #[serde(default)]
    target_field_ids: Vec<String>,
}

impl Tool for GetRelatedRecordsTool {
    const NAME: &'static str = "get_related_records";
    type Error = AgentToolError;
    type Args = GetRelatedRecordsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "沿表单 Schema 中已配置的 associationFormField 批量读取关联记录，最多追溯 20 条源记录，仅用于分析。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["source_form_uuid","relationship_field_id","record_uuids"],"properties":{"source_form_uuid":{"type":"string"},"relationship_field_id":{"type":"string","description":"associationFormField 字段 ID"},"record_uuids":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"string"}},"target_field_ids":{"type":"array","maxItems":20,"items":{"type":"string"},"description":"可选，关联目标记录返回的字段"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        if args.record_uuids.is_empty()
            || args.record_uuids.len() > 20
            || args.target_field_ids.len() > 20
        {
            return Err(tool_error("invalid related record request size"));
        }
        let source = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.source_form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("source form not found"))?;
        if source.form_type == "detail" {
            return Err(tool_error("detail forms do not own association records"));
        }
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != source.app_route_app_id)
        {
            return Err(tool_error(
                "source form is outside the current Agent context",
            ));
        }
        self.access
            .require_form_access(&source.app_route_app_id, &source.form_uuid)
            .map_err(tool_error)?;
        let source_schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(source.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(source.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("source form schema not found"))?;
        let relationship = source_schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|field| {
                field.get("id").and_then(Value::as_str) == Some(args.relationship_field_id.as_str())
                    && field.get("type").and_then(Value::as_str) == Some("associationFormField")
            })
            .ok_or_else(|| tool_error("relationship field not found"))?;
        let target_form_uuid = relationship
            .get("props")
            .and_then(|props| props.get("associationFormId"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| tool_error("relationship field has no target form"))?;
        let target = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(target_form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("relationship target form not found"))?;
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != target.app_route_app_id)
        {
            return Err(tool_error(
                "relationship target is outside the current Agent context",
            ));
        }
        self.access
            .require_form_access(&target.app_route_app_id, &target.form_uuid)
            .map_err(tool_error)?;
        let target_schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(target.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(target.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("target form schema not found"))?;
        let target_fields = target_schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|field| field.get("id").and_then(Value::as_str))
            .collect::<HashSet<_>>();
        if args
            .target_field_ids
            .iter()
            .any(|field_id| !target_fields.contains(field_id.as_str()))
        {
            return Err(tool_error("unknown target form field"));
        }
        ensure_agent_fields_queryable(
            &agent_field_privacy(&target_schema.schema_json),
            &args.target_field_ids,
        )?;
        let source_repository = RecordRepository::new(&self.db);
        let target_repository = RecordRepository::new(&self.db);
        let mut items = Vec::new();
        for source_record_uuid in args.record_uuids {
            let source_record = source_repository
                .find(&source.form_uuid, &source_record_uuid)
                .await
                .map_err(|error| tool_error(format!("source record query failed: {error:?}")))?;
            if filter_agent_records_by_data_scope(
                &self.db,
                &self.access,
                &source.form_uuid,
                vec![source_record.clone()],
            )
            .await?
            .is_empty()
            {
                return Err(tool_error("source record data permission denied"));
            }
            let related_record_uuid = source_record
                .record_data
                .get(&args.relationship_field_id)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());
            let related = match related_record_uuid {
                Some(record_uuid) => target_repository
                    .find(&target.form_uuid, record_uuid)
                    .await
                    .ok(),
                None => None,
            };
            let privacy = agent_field_privacy(&target_schema.schema_json);
            let related = filter_agent_records_by_data_scope(
                &self.db,
                &self.access,
                &target.form_uuid,
                related.into_iter().collect(),
            )
            .await?
            .into_iter()
            .next();
            let related_data = related
                .map(|record| {
                    if args.target_field_ids.is_empty() {
                        record.record_data
                    } else {
                        Value::Object(
                            args.target_field_ids
                                .iter()
                                .filter_map(|field_id| {
                                    record
                                        .record_data
                                        .get(field_id)
                                        .cloned()
                                        .map(|value| (field_id.clone(), value))
                                })
                                .collect(),
                        )
                    }
                })
                .map(|data| mask_agent_record_data(data, &privacy));
            items.push(json!({"sourceRecordId": source_record_uuid, "relatedRecordId": related_record_uuid, "record": related_data}));
        }
        Ok(
            json!({"sourceFormId": source.form_uuid, "targetForm": {"id": target.form_uuid, "name": target.name}, "relationshipFieldId": args.relationship_field_id, "items": items}),
        )
    }
}

#[derive(Clone)]
pub(crate) struct ListFormRecordsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct GetWorkflowProcessDefinitionTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetWorkflowProcessDefinitionArgs {
    form_uuid: String,
}

impl Tool for GetWorkflowProcessDefinitionTool {
    const NAME: &'static str = "get_workflow_process_definition";
    type Error = AgentToolError;
    type Args = GetWorkflowProcessDefinitionArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取工作流表单绑定的流程定义、节点和连线，仅用于分析，不修改流程。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid"],"properties":{"form_uuid":{"type":"string","description":"工作流表单 UUID"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let definition = workflow_form_definition(
            &self.db,
            &self.access,
            &self.allowed_app_id,
            &args.form_uuid,
        )
        .await?;
        let flow = automation_flow_entity::Entity::find()
            .filter(
                automation_flow_entity::Column::TriggerFormUuid.eq(definition.form_uuid.clone()),
            )
            .filter(automation_flow_entity::Column::FlowType.eq("process"))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("workflow process definition not found"))?;
        Ok(json!({
            "formId": definition.form_uuid,
            "formName": definition.name,
            "flow": {
                "id": flow.flow_uuid,
                "name": flow.name,
                "description": flow.description,
                "status": flow.status,
                "version": flow.current_version,
                "nodes": flow.nodes_json,
                "edges": flow.edges_json,
            }
        }))
    }
}

#[derive(Clone)]
pub(crate) struct GetWorkflowRecordRuntimeTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetWorkflowRecordRuntimeArgs {
    form_uuid: String,
    record_uuid: String,
}

impl Tool for GetWorkflowRecordRuntimeTool {
    const NAME: &'static str = "get_workflow_record_runtime";
    type Error = AgentToolError;
    type Args = GetWorkflowRecordRuntimeArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取一条工作流记录最新流程实例的状态、待办和动作轨迹，仅用于分析，不执行审批操作。"
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid","record_uuid"],"properties":{"form_uuid":{"type":"string","description":"工作流表单 UUID"},"record_uuid":{"type":"string","description":"表单记录 UUID"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let definition = workflow_form_definition(
            &self.db,
            &self.access,
            &self.allowed_app_id,
            &args.form_uuid,
        )
        .await?;
        let record = RecordRepository::new(&self.db)
            .find(&definition.form_uuid, &args.record_uuid)
            .await
            .map_err(|error| tool_error(format!("workflow record query failed: {error:?}")))?;
        if filter_agent_records_by_data_scope(
            &self.db,
            &self.access,
            &definition.form_uuid,
            vec![record],
        )
        .await?
        .is_empty()
        {
            return Err(tool_error("workflow record data permission denied"));
        }
        let instance = workflow_instance_entity::Entity::find()
            .filter(workflow_instance_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(workflow_instance_entity::Column::RecordUuid.eq(args.record_uuid.clone()))
            .order_by_desc(workflow_instance_entity::Column::StartedAt)
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        let Some(instance) = instance else {
            return Ok(
                json!({"formId": definition.form_uuid, "recordId": args.record_uuid, "instance": null, "tasks": [], "actions": []}),
            );
        };
        let tasks = workflow_task_entity::Entity::find()
            .filter(workflow_task_entity::Column::InstanceId.eq(instance.id))
            .order_by_asc(workflow_task_entity::Column::CreatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        let actions = workflow_action_entity::Entity::find()
            .filter(workflow_action_entity::Column::InstanceId.eq(instance.id))
            .order_by_asc(workflow_action_entity::Column::CreatedAt)
            .all(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?;
        Ok(json!({
            "formId": definition.form_uuid,
            "recordId": args.record_uuid,
            "instance": {"id": instance.instance_uuid, "status": instance.status, "currentNodeKey": instance.current_node_key, "flowVersion": instance.flow_version, "submitter": instance.submitter, "startedAt": instance.started_at, "completedAt": instance.completed_at},
            "tasks": tasks.into_iter().map(|task| json!({"id": task.task_uuid, "nodeKey": task.node_key, "nodeLabel": task.node_label, "taskType": task.task_type, "assignee": task.assignee, "status": task.status, "comment": task.comment, "completedBy": task.completed_by, "completedAt": task.completed_at})).collect::<Vec<_>>(),
            "actions": actions.into_iter().map(|action| json!({"action": action.action, "operator": action.operator, "comment": action.comment, "createdAt": action.created_at})).collect::<Vec<_>>(),
        }))
    }
}

async fn workflow_form_definition(
    db: &DatabaseConnection,
    access: &AgentAccessScope,
    allowed_app_id: &Option<String>,
    form_uuid: &str,
) -> Result<form_definition_entity::Model, AgentToolError> {
    let definition = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
        .one(db)
        .await
        .map_err(|error| tool_error(error.to_string()))?
        .ok_or_else(|| tool_error("form not found"))?;
    if definition.form_type != "workflow" {
        return Err(tool_error("form is not a workflow form"));
    }
    if allowed_app_id
        .as_deref()
        .is_some_and(|app_id| app_id != definition.app_route_app_id)
    {
        return Err(tool_error("form is outside the current Agent context"));
    }
    access
        .require_form_access(&definition.app_route_app_id, &definition.form_uuid)
        .map_err(tool_error)?;
    Ok(definition)
}

#[derive(Deserialize)]
pub(crate) struct ListFormRecordsArgs {
    form_uuid: String,
    #[serde(default = "default_record_limit")]
    limit: u64,
}
fn default_record_limit() -> u64 {
    20
}

impl Tool for ListFormRecordsTool {
    const NAME: &'static str = "list_form_records";
    type Error = AgentToolError;
    type Args = ListFormRecordsArgs;
    type Output = Value;
    fn description(&self) -> String {
        "读取一个已发布表单最近的记录，最多 100 条，仅用于分析，不修改数据。".to_string()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid"],"properties":{"form_uuid":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100}}})
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.form_uuid))
            .one(&self.db)
            .await
            .map_err(|e| tool_error(e.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != definition.app_route_app_id)
        {
            return Err(tool_error("form is outside the current Agent context"));
        }
        self.access
            .require_form_access(&definition.app_route_app_id, &definition.form_uuid)
            .map_err(tool_error)?;
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(definition.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form schema not found"))?;
        let privacy = agent_field_privacy(&schema.schema_json);
        let (records, total) = RecordRepository::new(&self.db)
            .list_page(&definition.form_uuid, 1, args.limit.clamp(1, 100))
            .await
            .map_err(|e| tool_error(format!("record query failed: {e:?}")))?;
        let records = filter_agent_records_by_data_scope(
            &self.db,
            &self.access,
            &definition.form_uuid,
            records,
        )
        .await?;
        let scoped_total = (!self
            .access
            .has_restricted_record_data_scope(&definition.form_uuid))
        .then_some(total);
        Ok(
            json!({"formId": definition.form_uuid, "formName": definition.name, "total": scoped_total, "records": records.into_iter().map(|record| json!({"id":record.record_uuid,"data":mask_agent_record_data(record.record_data, &privacy),"createdAt":record.created_at,"updatedAt":record.updated_at})).collect::<Vec<_>>() }),
        )
    }
}

#[derive(Clone)]
pub(crate) struct QueryFormRecordsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct FormRecordFilter {
    field_id: String,
    operator: String,
    #[serde(default)]
    value: Option<Value>,
}

#[derive(Deserialize)]
pub(crate) struct QueryFormRecordsArgs {
    form_uuid: String,
    #[serde(default)]
    filters: Vec<FormRecordFilter>,
    #[serde(default)]
    field_ids: Vec<String>,
    #[serde(default = "default_record_limit")]
    limit: u64,
    #[serde(default = "default_record_page")]
    page: u64,
}

fn default_record_page() -> u64 {
    1
}

impl Tool for QueryFormRecordsTool {
    const NAME: &'static str = "query_form_records";
    type Error = AgentToolError;
    type Args = QueryFormRecordsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "按受控条件筛选一个表单的记录。仅扫描指定页最多 100 条记录，支持 equals、contains、is_empty；结果会标明是否可能遗漏其他页记录。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid"],"properties":{"form_uuid":{"type":"string"},"filters":{"type":"array","maxItems":8,"items":{"type":"object","required":["field_id","operator"],"properties":{"field_id":{"type":"string"},"operator":{"type":"string","enum":["equals","contains","is_empty"]},"value":{}}}},"field_ids":{"type":"array","maxItems":20,"items":{"type":"string"},"description":"可选，返回的字段 ID；省略时返回完整记录数据"},"limit":{"type":"integer","minimum":1,"maximum":100},"page":{"type":"integer","minimum":1,"description":"要扫描的记录页，按创建时间倒序"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        if args.filters.len() > 8 || args.field_ids.len() > 20 {
            return Err(tool_error("too many filters or projected fields"));
        }
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if definition.form_type == "detail" {
            return Err(tool_error("use list_detail_records for a detail form"));
        }
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != definition.app_route_app_id)
        {
            return Err(tool_error("form is outside the current Agent context"));
        }
        self.access
            .require_form_access(&definition.app_route_app_id, &definition.form_uuid)
            .map_err(tool_error)?;
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(definition.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form schema not found"))?;
        let valid_fields = schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|field| field.get("id").and_then(Value::as_str))
            .collect::<HashSet<_>>();
        let privacy = agent_field_privacy(&schema.schema_json);
        ensure_agent_fields_queryable(
            &privacy,
            &args
                .filters
                .iter()
                .map(|filter| filter.field_id.clone())
                .chain(args.field_ids.clone())
                .collect::<Vec<_>>(),
        )?;
        for field_id in args
            .filters
            .iter()
            .map(|filter| filter.field_id.as_str())
            .chain(args.field_ids.iter().map(String::as_str))
        {
            if !valid_fields.contains(field_id) {
                return Err(tool_error(format!("unknown form field: {field_id}")));
            }
        }
        for filter in &args.filters {
            if !matches!(filter.operator.as_str(), "equals" | "contains" | "is_empty") {
                return Err(tool_error(
                    "filter operator must be equals, contains, or is_empty",
                ));
            }
            if filter.operator != "is_empty" && filter.value.is_none() {
                return Err(tool_error("filter value is required"));
            }
        }
        let scan_size = 100_u64;
        let (records, total) = RecordRepository::new(&self.db)
            .list_page(&definition.form_uuid, args.page.max(1), scan_size)
            .await
            .map_err(|error| tool_error(format!("record query failed: {error:?}")))?;
        let records = filter_agent_records_by_data_scope(
            &self.db,
            &self.access,
            &definition.form_uuid,
            records,
        )
        .await?;
        let limit = args.limit.clamp(1, 100) as usize;
        let matched = records.into_iter().filter(|record| args.filters.iter().all(|filter| record_matches_filter(&record.record_data, filter))).take(limit)
            .map(|record| {
                let data = if args.field_ids.is_empty() { record.record_data } else {
                    Value::Object(args.field_ids.iter().filter_map(|field_id| record.record_data.get(field_id).cloned().map(|value| (field_id.clone(), value))).collect())
                };
                json!({"id": record.record_uuid, "data": mask_agent_record_data(data, &privacy), "createdAt": record.created_at, "updatedAt": record.updated_at})
            }).collect::<Vec<_>>();
        let scanned_until = args.page.max(1).saturating_mul(scan_size);
        let unrestricted = !self
            .access
            .has_restricted_record_data_scope(&definition.form_uuid);
        Ok(
            json!({"formId": definition.form_uuid, "formName": definition.name, "records": matched, "scannedPage": args.page.max(1), "scannedRecords": if unrestricted { scan_size.min(total.max(0) as u64) } else { scan_size }, "totalRecords": unrestricted.then_some(total), "mayHaveMoreMatches": unrestricted.then_some(total.max(0) as u64 > scanned_until)}),
        )
    }
}

#[derive(Clone)]
pub(crate) struct AggregateFormRecordsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct AggregateFormRecordsArgs {
    form_uuid: String,
    operation: String,
    #[serde(default)]
    filters: Vec<FormRecordFilter>,
    #[serde(default)]
    value_field_id: Option<String>,
    #[serde(default)]
    group_field_id: Option<String>,
    #[serde(default = "default_record_page")]
    page: u64,
    #[serde(default = "default_scan_pages")]
    scan_pages: u64,
}

fn default_scan_pages() -> u64 {
    1
}

impl Tool for AggregateFormRecordsTool {
    const NAME: &'static str = "aggregate_form_records";
    type Error = AgentToolError;
    type Args = AggregateFormRecordsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "对表单记录做受控聚合，支持 count、sum、average、group_count。最多扫描连续 10 页、每页 100 条，并明确返回扫描范围。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["form_uuid","operation"],"properties":{"form_uuid":{"type":"string"},"operation":{"type":"string","enum":["count","sum","average","group_count"]},"filters":{"type":"array","maxItems":8,"items":{"type":"object","required":["field_id","operator"],"properties":{"field_id":{"type":"string"},"operator":{"type":"string","enum":["equals","contains","is_empty"]},"value":{}}}},"value_field_id":{"type":"string","description":"sum 或 average 所需的数值字段 ID"},"group_field_id":{"type":"string","description":"可选的分组字段 ID；group_count 时必填"},"page":{"type":"integer","minimum":1},"scan_pages":{"type":"integer","minimum":1,"maximum":10}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        if !matches!(
            args.operation.as_str(),
            "count" | "sum" | "average" | "group_count"
        ) {
            return Err(tool_error("unsupported aggregation operation"));
        }
        if matches!(args.operation.as_str(), "sum" | "average")
            && args.value_field_id.as_deref().is_none_or(str::is_empty)
        {
            return Err(tool_error("value_field_id is required for sum and average"));
        }
        if args.operation == "group_count"
            && args.group_field_id.as_deref().is_none_or(str::is_empty)
        {
            return Err(tool_error("group_field_id is required for group_count"));
        }
        let definition = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form not found"))?;
        if definition.form_type == "detail" {
            return Err(tool_error(
                "aggregate detail rows through their parent form or use the detail reader",
            ));
        }
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != definition.app_route_app_id)
        {
            return Err(tool_error("form is outside the current Agent context"));
        }
        self.access
            .require_form_access(&definition.app_route_app_id, &definition.form_uuid)
            .map_err(tool_error)?;
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(definition.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(definition.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("form schema not found"))?;
        let fields = schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|field| field.get("id").and_then(Value::as_str))
            .collect::<HashSet<_>>();
        let privacy = agent_field_privacy(&schema.schema_json);
        if args.filters.len() > 8 {
            return Err(tool_error("too many filters"));
        }
        for field_id in args
            .filters
            .iter()
            .map(|filter| filter.field_id.as_str())
            .chain(
                [
                    args.value_field_id.as_deref(),
                    args.group_field_id.as_deref(),
                ]
                .into_iter()
                .flatten(),
            )
        {
            if !fields.contains(field_id) {
                return Err(tool_error(format!("unknown form field: {field_id}")));
            }
        }
        for filter in &args.filters {
            if !matches!(filter.operator.as_str(), "equals" | "contains" | "is_empty") {
                return Err(tool_error(
                    "filter operator must be equals, contains, or is_empty",
                ));
            }
            if filter.operator != "is_empty" && filter.value.is_none() {
                return Err(tool_error("filter value is required"));
            }
        }
        ensure_agent_fields_queryable(
            &privacy,
            &args
                .filters
                .iter()
                .map(|filter| filter.field_id.clone())
                .chain(
                    [args.value_field_id.clone(), args.group_field_id.clone()]
                        .into_iter()
                        .flatten(),
                )
                .collect::<Vec<_>>(),
        )?;
        let page = args.page.max(1);
        let scan_pages = args.scan_pages.clamp(1, 10);
        let repository = RecordRepository::new(&self.db);
        let mut records = Vec::new();
        let mut total = 0_i64;
        let mut scanned_pages = 0_u64;
        for current_page in page..page.saturating_add(scan_pages) {
            let (items, current_total) = repository
                .list_page(&definition.form_uuid, current_page, 100)
                .await
                .map_err(|error| tool_error(format!("record query failed: {error:?}")))?;
            total = current_total;
            scanned_pages += 1;
            let item_count = items.len();
            records.extend(
                filter_agent_records_by_data_scope(
                    &self.db,
                    &self.access,
                    &definition.form_uuid,
                    items,
                )
                .await?,
            );
            if item_count < 100 {
                break;
            }
        }
        let scanned_record_count = records.len();
        let records = records
            .into_iter()
            .filter(|record| {
                args.filters
                    .iter()
                    .all(|filter| record_matches_filter(&record.record_data, filter))
            })
            .collect::<Vec<_>>();
        let result = match args.operation.as_str() {
            "count" => json!({"count": records.len()}),
            "sum" | "average" => {
                let values = records
                    .iter()
                    .filter_map(|record| {
                        record
                            .record_data
                            .get(args.value_field_id.as_deref().unwrap_or_default())
                    })
                    .filter_map(Value::as_f64)
                    .collect::<Vec<_>>();
                let sum = values.iter().sum::<f64>();
                if args.operation == "sum" {
                    json!({"sum": sum, "numericRecordCount": values.len()})
                } else {
                    json!({"average": if values.is_empty() { Value::Null } else { json!(sum / values.len() as f64) }, "numericRecordCount": values.len()})
                }
            }
            "group_count" => {
                let mut groups = std::collections::BTreeMap::<String, u64>::new();
                for record in &records {
                    let value = record
                        .record_data
                        .get(args.group_field_id.as_deref().unwrap_or_default())
                        .cloned()
                        .unwrap_or(Value::Null);
                    let key = value
                        .as_str()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| value.to_string());
                    *groups.entry(key).or_default() += 1;
                }
                json!({"groups": groups.into_iter().take(50).map(|(value, count)| json!({"value": value, "count": count})).collect::<Vec<_>>()})
            }
            _ => unreachable!(),
        };
        let scanned_until = page
            .saturating_add(scanned_pages)
            .saturating_sub(1)
            .saturating_mul(100);
        Ok(
            json!({"formId": definition.form_uuid, "formName": definition.name, "operation": args.operation, "result": result, "scannedRecords": scanned_record_count, "matchedRecords": records.len(), "scannedPageStart": page, "scannedPages": scanned_pages, "totalRecords": total, "mayHaveMoreRecords": total.max(0) as u64 > scanned_until}),
        )
    }
}

fn record_matches_filter(record_data: &Value, filter: &FormRecordFilter) -> bool {
    let actual = record_data.get(&filter.field_id);
    match filter.operator.as_str() {
        "equals" => actual == filter.value.as_ref(),
        "contains" => match (actual, filter.value.as_ref()) {
            (Some(Value::String(actual)), Some(Value::String(expected))) => {
                actual.to_lowercase().contains(&expected.to_lowercase())
            }
            (Some(Value::Array(values)), Some(expected)) => {
                values.iter().any(|value| value == expected)
            }
            _ => false,
        },
        "is_empty" => {
            actual.is_none()
                || actual.is_some_and(|value| {
                    value.is_null() || value == "" || value.as_array().is_some_and(Vec::is_empty)
                })
        }
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentFieldPrivacy {
    Allow,
    Mask,
    Deny,
}

fn agent_field_privacy(schema: &Value) -> std::collections::HashMap<String, AgentFieldPrivacy> {
    schema
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            let id = field.get("id").and_then(Value::as_str)?;
            let explicit = field
                .get("props")
                .and_then(|props| props.get("agentDataAccess"))
                .and_then(Value::as_str);
            let normalized = format!(
                "{} {}",
                id,
                field.get("label").and_then(Value::as_str).unwrap_or("")
            )
            .to_lowercase();
            let privacy = match explicit {
                Some("allow") => AgentFieldPrivacy::Allow,
                Some("deny") => AgentFieldPrivacy::Deny,
                Some("mask") => AgentFieldPrivacy::Mask,
                _ if [
                    "password",
                    "secret",
                    "token",
                    "apikey",
                    "api_key",
                    "身份证",
                    "银行卡",
                    "bankcard",
                ]
                .iter()
                .any(|term| normalized.contains(term)) =>
                {
                    AgentFieldPrivacy::Deny
                }
                _ if ["phone", "mobile", "email", "手机号", "手机", "电话", "邮箱"]
                    .iter()
                    .any(|term| normalized.contains(term)) =>
                {
                    AgentFieldPrivacy::Mask
                }
                _ => AgentFieldPrivacy::Allow,
            };
            (privacy != AgentFieldPrivacy::Allow).then_some((id.to_string(), privacy))
        })
        .collect()
}

fn mask_agent_record_data(
    mut data: Value,
    privacy: &std::collections::HashMap<String, AgentFieldPrivacy>,
) -> Value {
    let Some(values) = data.as_object_mut() else {
        return data;
    };
    for (field_id, policy) in privacy {
        match policy {
            AgentFieldPrivacy::Deny => {
                values.remove(field_id);
            }
            AgentFieldPrivacy::Mask => {
                if values.contains_key(field_id) {
                    values.insert(field_id.clone(), Value::String("***".to_string()));
                }
            }
            AgentFieldPrivacy::Allow => {}
        }
    }
    data
}

fn ensure_agent_fields_queryable(
    privacy: &std::collections::HashMap<String, AgentFieldPrivacy>,
    field_ids: &[String],
) -> Result<(), AgentToolError> {
    if field_ids
        .iter()
        .any(|field_id| privacy.get(field_id) == Some(&AgentFieldPrivacy::Deny))
    {
        Err(tool_error(
            "a protected field cannot be queried, grouped, or projected for Agent analysis",
        ))
    } else {
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct GetDetailFormDefinitionTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct GetDetailFormDefinitionArgs {
    detail_form_uuid: String,
}

impl Tool for GetDetailFormDefinitionTool {
    const NAME: &'static str = "get_detail_form_definition";
    type Error = AgentToolError;
    type Args = GetDetailFormDefinitionArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取明细表定义、父表关联和展示字段，仅用于分析，不修改数据。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["detail_form_uuid"],"properties":{"detail_form_uuid":{"type":"string","description":"明细表 UUID"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let (detail_form, relation) = detail_form_relation(
            &self.db,
            &self.access,
            &self.allowed_app_id,
            &args.detail_form_uuid,
        )
        .await?;
        let parent = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(relation.source_form_uuid.clone()))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("detail parent form not found"))?;
        Ok(json!({
            "detailForm": {"id": detail_form.form_uuid, "name": detail_form.name, "status": detail_form.status},
            "parentForm": {"id": parent.form_uuid, "name": parent.name, "formType": parent.form_type},
            "relation": {"subformFieldId": relation.subform_field_id, "title": relation.title, "primaryDisplayFieldId": relation.primary_display_field_id, "secondaryDisplayFieldId": relation.secondary_display_field_id}
        }))
    }
}

#[derive(Clone)]
pub(crate) struct ListDetailRecordsTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct ListDetailRecordsArgs {
    detail_form_uuid: String,
    #[serde(default)]
    parent_record_uuid: Option<String>,
    #[serde(default = "default_record_limit")]
    limit: u64,
}

impl Tool for ListDetailRecordsTool {
    const NAME: &'static str = "list_detail_records";
    type Error = AgentToolError;
    type Args = ListDetailRecordsArgs;
    type Output = Value;

    fn description(&self) -> String {
        "读取明细表记录；记录保存在父表 subform 字段中，最多返回 100 行，仅用于分析。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["detail_form_uuid"],"properties":{"detail_form_uuid":{"type":"string","description":"明细表 UUID"},"parent_record_uuid":{"type":"string","description":"可选，限定到某条父表记录"},"limit":{"type":"integer","minimum":1,"maximum":100}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let (detail_form, relation) = detail_form_relation(
            &self.db,
            &self.access,
            &self.allowed_app_id,
            &args.detail_form_uuid,
        )
        .await?;
        let detail_schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(detail_form.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(detail_form.draft_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("detail form schema not found"))?;
        let privacy = agent_field_privacy(&detail_schema.schema_json);
        let limit = args.limit.clamp(1, 100) as usize;
        let parents = if let Some(parent_record_uuid) = args
            .parent_record_uuid
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            vec![
                RecordRepository::new(&self.db)
                    .find(&relation.source_form_uuid, parent_record_uuid)
                    .await
                    .map_err(|error| {
                        tool_error(format!("parent record query failed: {error:?}"))
                    })?,
            ]
        } else {
            RecordRepository::new(&self.db)
                .list_page(&relation.source_form_uuid, 1, 100)
                .await
                .map_err(|error| tool_error(format!("parent record query failed: {error:?}")))?
                .0
        };
        let parents = filter_agent_records_by_data_scope(
            &self.db,
            &self.access,
            &relation.source_form_uuid,
            parents,
        )
        .await?;
        let mut records = Vec::new();
        for parent in parents {
            for (row_index, row) in parent
                .record_data
                .get(&relation.subform_field_id)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                if records.len() == limit {
                    break;
                }
                records.push(json!({"id": format!("{}:{}", parent.record_uuid, row_index), "parentRecordId": parent.record_uuid, "rowIndex": row_index, "data": mask_agent_record_data(row.clone(), &privacy), "createdAt": parent.created_at, "updatedAt": parent.updated_at}));
            }
            if records.len() == limit {
                break;
            }
        }
        Ok(
            json!({"detailFormId": args.detail_form_uuid, "parentFormId": relation.source_form_uuid, "subformFieldId": relation.subform_field_id, "records": records, "limit": limit, "truncated": records.len() == limit}),
        )
    }
}

async fn detail_form_relation(
    db: &DatabaseConnection,
    access: &AgentAccessScope,
    allowed_app_id: &Option<String>,
    detail_form_uuid: &str,
) -> Result<
    (
        form_definition_entity::Model,
        form_detail_definition_entity::Model,
    ),
    AgentToolError,
> {
    let detail_form = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(detail_form_uuid))
        .one(db)
        .await
        .map_err(|error| tool_error(error.to_string()))?
        .ok_or_else(|| tool_error("detail form not found"))?;
    if detail_form.form_type != "detail" {
        return Err(tool_error("form is not a detail form"));
    }
    if allowed_app_id
        .as_deref()
        .is_some_and(|app_id| app_id != detail_form.app_route_app_id)
    {
        return Err(tool_error(
            "detail form is outside the current Agent context",
        ));
    }
    access
        .require_form_access(&detail_form.app_route_app_id, &detail_form.form_uuid)
        .map_err(tool_error)?;
    let relation = form_detail_definition_entity::Entity::find()
        .filter(form_detail_definition_entity::Column::DetailFormUuid.eq(detail_form_uuid))
        .one(db)
        .await
        .map_err(|error| tool_error(error.to_string()))?
        .ok_or_else(|| tool_error("detail form definition not found"))?;
    let parent = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(&relation.source_form_uuid))
        .one(db)
        .await
        .map_err(|error| tool_error(error.to_string()))?
        .ok_or_else(|| tool_error("detail parent form not found"))?;
    access
        .require_form_access(&parent.app_route_app_id, &parent.form_uuid)
        .map_err(tool_error)?;
    Ok((detail_form, relation))
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
        self.access
            .require_form_access(&definition.app_route_app_id, &definition.form_uuid)
            .map_err(tool_error)?;
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
    pub(crate) access: AgentAccessScope,
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
        self.access
            .require_app_access(&app_id)
            .map_err(tool_error)?;
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
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct CreateFormDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) session_id: uuid::Uuid,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct CreateDetailFormDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) session_id: uuid::Uuid,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Clone)]
pub(crate) struct CreateAutomationDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) session_id: uuid::Uuid,
    pub(crate) access: AgentAccessScope,
    pub(crate) allowed_app_id: Option<String>,
    pub(crate) enabled: bool,
}
#[derive(Deserialize)]
pub(crate) struct CreateAutomationDraftArgs {
    app_id: Option<String>,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    trigger_form_uuid: Option<String>,
    #[serde(default = "default_automation_event")]
    trigger_event: String,
    nodes: Value,
    edges: Value,
}
fn default_automation_event() -> String {
    "after_create".to_string()
}
impl Tool for CreateAutomationDraftTool {
    const NAME: &'static str = "create_automation_draft";
    type Error = AgentToolError;
    type Args = CreateAutomationDraftArgs;
    type Output = Value;
    fn description(&self) -> String {
        "创建普通事件触发自动化草稿提案；需用户确认，确认后仍保持 draft，不自动启用。".to_string()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","required":["name","nodes","edges"],"properties":{"app_id":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"trigger_form_uuid":{"type":"string"},"trigger_event":{"type":"string","enum":["before_create","after_create","before_update","after_update","before_delete","after_delete"]},"nodes":{"type":"array"},"edges":{"type":"array"}}})
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        self.access
            .require_app_access(&app_id)
            .map_err(tool_error)?;
        if !self.access.can_manage_automations(&app_id) {
            return Err(tool_error("automation permission denied"));
        }
        if args.name.trim().is_empty() || !args.nodes.is_array() || !args.edges.is_array() {
            return Err(tool_error("automation name, nodes and edges are required"));
        }
        create_pending_action(&self.db, self.session_id, "create_automation_draft", json!({"appId":app_id,"name":args.name.trim(),"description":args.description,"triggerFormUuid":args.trigger_form_uuid,"triggerEvent":args.trigger_event,"nodes":args.nodes,"edges":args.edges}), format!("在应用 {} 中创建自动化草稿“{}”", app_id, args.name.trim())).await
    }
}

#[derive(Clone)]
pub(crate) struct SaveFormSchemaDraftTool {
    pub(crate) db: DatabaseConnection,
    pub(crate) session_id: uuid::Uuid,
    pub(crate) access: AgentAccessScope,
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
        self.access
            .require_app_access(&definition.app_route_app_id)
            .map_err(tool_error)?;
        if !self.access.can_edit_form(&definition.app_route_app_id) {
            return Err(tool_error("form edit permission denied"));
        }
        create_pending_action(
            &self.db,
            self.session_id,
            "save_form_schema_draft",
            json!({"formUuid": args.form_uuid, "schema": args.schema}),
            format!("保存表单“{}”的 Schema 草稿", definition.name),
        )
        .await
    }
}

#[derive(Deserialize)]
pub(crate) struct CreateFormDraftArgs {
    app_id: Option<String>,
    name: String,
    #[serde(default = "default_form_type")]
    form_type: String,
}

fn default_form_type() -> String {
    "normal".to_string()
}

impl Tool for CreateFormDraftTool {
    const NAME: &'static str = "create_form_draft";
    type Error = AgentToolError;
    type Args = CreateFormDraftArgs;
    type Output = Value;

    fn description(&self) -> String {
        "在当前允许的应用中创建一个未发布的普通表单、流程表单或自定义页面草稿。明细表必须由父表单创建，不能使用此工具。仅当配置文件启用“允许创建表单”时可用。"
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "app_id": { "type": "string", "description": "目标应用 ID；当前页面有应用上下文时可省略" },
                "name": { "type": "string", "description": "新表单名称" },
                "form_type": { "type": "string", "enum": ["normal", "workflow", "defined"], "description": "表单类型；省略时为 normal" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        let app_id = resolve_app_id(&self.allowed_app_id, args.app_id)?;
        self.access
            .require_app_access(&app_id)
            .map_err(tool_error)?;
        if !self.access.can_create_form(&app_id) {
            return Err(tool_error("form creation permission denied"));
        }
        if args.name.trim().is_empty() {
            return Err(tool_error("form name is required"));
        }
        if !matches!(args.form_type.as_str(), "normal" | "workflow" | "defined") {
            return Err(tool_error(
                "form_type must be normal, workflow, or defined; detail forms require a parent form",
            ));
        }
        create_pending_action(
            &self.db,
            self.session_id,
            "create_form_draft",
            json!({"appId": app_id, "name": args.name.trim(), "formType": args.form_type}),
            format!(
                "在应用 {} 中创建{}草稿“{}”",
                app_id,
                form_type_label(&args.form_type),
                args.name.trim()
            ),
        )
        .await
    }
}

#[derive(Deserialize)]
pub(crate) struct CreateDetailFormDraftArgs {
    source_form_uuid: String,
    subform_field_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    primary_display_field_id: Option<String>,
    #[serde(default)]
    secondary_display_field_id: Option<String>,
}

impl Tool for CreateDetailFormDraftTool {
    const NAME: &'static str = "create_detail_form_draft";
    type Error = AgentToolError;
    type Args = CreateDetailFormDraftArgs;
    type Output = Value;

    fn description(&self) -> String {
        "为父表已发布 Schema 中的 subform 字段生成明细表配置提案。必须由用户确认后才会创建；仅当配置允许创建表单时可用。".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","required":["source_form_uuid","subform_field_id"],"properties":{"source_form_uuid":{"type":"string","description":"父表 UUID"},"subform_field_id":{"type":"string","description":"父表已发布 Schema 中的 subform 字段 ID"},"title":{"type":"string","description":"可选的明细表标题"},"primary_display_field_id":{"type":"string","description":"可选的父表主展示字段"},"secondary_display_field_id":{"type":"string","description":"可选的父表次展示字段"}}})
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        ensure_enabled(self.enabled, Self::NAME)?;
        if args.subform_field_id.trim().is_empty() {
            return Err(tool_error("subform_field_id is required"));
        }
        let source = form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(&args.source_form_uuid))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("source form not found"))?;
        if source.form_type == "detail" {
            return Err(tool_error("a detail form cannot own another detail form"));
        }
        if self
            .allowed_app_id
            .as_deref()
            .is_some_and(|app_id| app_id != source.app_route_app_id)
        {
            return Err(tool_error(
                "source form is outside the current Agent context",
            ));
        }
        self.access
            .require_app_access(&source.app_route_app_id)
            .map_err(tool_error)?;
        if !self.access.can_create_form(&source.app_route_app_id) {
            return Err(tool_error("form creation permission denied"));
        }
        let schema = form_schema_entity::Entity::find()
            .filter(form_schema_entity::Column::FormUuid.eq(source.form_uuid.clone()))
            .filter(form_schema_entity::Column::Version.eq(source.published_schema_version))
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .ok_or_else(|| tool_error("published source form schema not found"))?;
        let has_subform = schema
            .schema_json
            .get("fields")
            .and_then(Value::as_array)
            .is_some_and(|fields| {
                fields.iter().any(|field| {
                    field.get("id").and_then(Value::as_str) == Some(args.subform_field_id.trim())
                        && field.get("type").and_then(Value::as_str) == Some("subform")
                })
            });
        if !has_subform {
            return Err(tool_error(
                "subform field not found in the published schema",
            ));
        }
        let exists = form_detail_definition_entity::Entity::find()
            .filter(
                form_detail_definition_entity::Column::SourceFormUuid.eq(source.form_uuid.clone()),
            )
            .filter(
                form_detail_definition_entity::Column::SubformFieldId
                    .eq(args.subform_field_id.trim()),
            )
            .one(&self.db)
            .await
            .map_err(|error| tool_error(error.to_string()))?
            .is_some();
        if exists {
            return Err(tool_error("a detail form already exists for this subform"));
        }
        let title = args
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        create_pending_action(
            &self.db,
            self.session_id,
            "create_detail_form_draft",
            json!({"sourceFormUuid": source.form_uuid, "subformFieldId": args.subform_field_id.trim(), "title": title, "primaryDisplayFieldId": args.primary_display_field_id, "secondaryDisplayFieldId": args.secondary_display_field_id}),
            format!("为父表“{}”的子表字段“{}”生成明细表", source.name, args.subform_field_id.trim()),
        ).await
    }
}

fn form_type_label(form_type: &str) -> &'static str {
    match form_type {
        "workflow" => "流程表单",
        "defined" => "自定义页面",
        _ => "普通表单",
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
        self.access
            .require_app_access(&flow.app_route_app_id)
            .map_err(tool_error)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_scope_limits_application_visibility() {
        let scope = AgentAccessScope::for_user(
            HashSet::from([
                "app:sales:display".to_string(),
                "app:sales:create_form".to_string(),
            ]),
            uuid::Uuid::nil(),
        );

        assert!(scope.require_app_access("sales").is_ok());
        assert!(scope.require_app_access("hr").is_err());
        assert!(scope.can_create_form("sales"));
        assert!(!scope.can_edit_form("sales"));
    }

    #[test]
    fn administrator_scope_allows_all_application_actions() {
        let scope = AgentAccessScope::for_user(HashSet::from(["*".to_string()]), uuid::Uuid::nil());

        assert!(scope.require_app_access("any-app").is_ok());
        assert!(scope.can_create_form("any-app"));
        assert!(scope.can_edit_form("any-app"));
    }

    #[test]
    fn form_visibility_is_not_granted_by_application_visibility_alone() {
        let scope = AgentAccessScope::for_user(
            HashSet::from(["app:sales:display".to_string()]),
            uuid::Uuid::nil(),
        );
        assert!(scope.require_app_access("sales").is_ok());
        assert!(scope.require_form_access("sales", "FORM-ORDERS").is_err());

        let form_scope = AgentAccessScope::for_user(
            HashSet::from([
                "app:sales:display".to_string(),
                "form:FORM-ORDERS:display".to_string(),
            ]),
            uuid::Uuid::nil(),
        );
        assert!(
            form_scope
                .require_form_access("sales", "FORM-ORDERS")
                .is_ok()
        );
    }

    #[test]
    fn record_data_scope_uses_the_most_restrictive_role_grant() {
        let scope = AgentAccessScope::for_user(
            HashSet::from([
                "form:orders:data_scope:all".to_string(),
                "form:orders:data_scope:department".to_string(),
                "form:orders:data_scope:self".to_string(),
            ]),
            uuid::Uuid::nil(),
        );
        assert_eq!(
            scope.record_data_scope("orders"),
            AgentRecordDataScope::SelfOnly
        );

        let denied = AgentAccessScope::for_user(
            HashSet::from([
                "form:orders:data_scope:none".to_string(),
                "form:orders:data_scope:all".to_string(),
            ]),
            uuid::Uuid::nil(),
        );
        assert_eq!(
            denied.record_data_scope("orders"),
            AgentRecordDataScope::None
        );
    }

    #[test]
    fn record_filters_support_exact_contains_and_empty_values() {
        let record = json!({"status": "open", "tags": ["priority", "sales"], "note": ""});
        assert!(record_matches_filter(
            &record,
            &FormRecordFilter {
                field_id: "status".to_string(),
                operator: "equals".to_string(),
                value: Some(json!("open"))
            }
        ));
        assert!(record_matches_filter(
            &record,
            &FormRecordFilter {
                field_id: "tags".to_string(),
                operator: "contains".to_string(),
                value: Some(json!("sales"))
            }
        ));
        assert!(record_matches_filter(
            &record,
            &FormRecordFilter {
                field_id: "note".to_string(),
                operator: "is_empty".to_string(),
                value: None
            }
        ));
        assert!(!record_matches_filter(
            &record,
            &FormRecordFilter {
                field_id: "status".to_string(),
                operator: "equals".to_string(),
                value: Some(json!("closed"))
            }
        ));
    }

    #[test]
    fn agent_record_output_masks_sensitive_fields() {
        let schema = json!({"fields": [
            {"id": "password", "label": "密码"},
            {"id": "phone", "label": "联系电话"},
            {"id": "privateNote", "props": {"agentDataAccess": "deny"}},
            {"id": "publicName", "label": "名称"}
        ]});
        let result = mask_agent_record_data(
            json!({"password": "p", "phone": "13800000000", "privateNote": "x", "publicName": "采购单"}),
            &agent_field_privacy(&schema),
        );
        assert_eq!(result.get("password"), None);
        assert_eq!(result.get("phone"), Some(&json!("***")));
        assert_eq!(result.get("privateNote"), None);
        assert_eq!(result.get("publicName"), Some(&json!("采购单")));
    }
}
