use axum::Json;
use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::entities::agent_config_profile_entity::{
    self, Entity as AgentConfigProfileEntity,
};
use crate::infrastructure::entities::agent_definition_entity::{
    self, Entity as AgentDefinitionEntity,
};
use crate::infrastructure::entities::agent_model_provider_entity::{
    self, Entity as AgentModelProviderEntity,
};
use crate::infrastructure::entities::agent_provider_model_entity::{
    self, Entity as AgentProviderModelEntity,
};
use crate::infrastructure::entities::agent_resource_entity::{self, Entity as AgentResourceEntity};
use crate::platform::config::{
    AgentConfigProfile, AgentDefinition, AgentKnowledgeBaseDefinition, AgentModelProvider,
    AgentPluginDefinition, AgentRegistry, AgentSettings, AgentSkillDefinition,
    ResolvedAgentRuntime, ensure_skill_package, import_skill_package, load_installed_ai_employees,
    write_skill_markdown,
};
use crate::platform::license::{
    PlatformAiEmployeeEntitlement, PlatformAiEmployeeSkill, license_status,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
};

#[derive(Clone, Deserialize, Serialize)]
struct AgentRuntimeCore {
    providers: Vec<AgentModelProvider>,
    profiles: Vec<AgentConfigProfile>,
    agents: Vec<AgentDefinition>,
    plugins: Vec<AgentPluginDefinition>,
    skills: Vec<AgentSkillDefinition>,
    knowledge_bases: Vec<AgentKnowledgeBaseDefinition>,
}

pub(crate) async fn resolve_database_agent_runtime(
    state: &AppState,
    agent_id: Option<&str>,
    app_id: Option<&str>,
    business_id: Option<&str>,
) -> Result<crate::platform::config::ResolvedAgentRuntime, String> {
    let version = state.cache_version("yaya:v1:agent-runtime:version").await;
    let cache_key = format!("yaya:v1:agent-runtime:{version}");
    let core = if let Some(cached) = state.cache_get_json::<AgentRuntimeCore>(&cache_key).await {
        cached
    } else {
        let providers = AgentModelProviderEntity::find()
            .all(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|row| AgentModelProvider {
                id: row.id,
                name: row.name,
                kind: row.kind,
                enabled: row.enabled,
                is_default: row.is_default,
                api_base_url: row.api_base_url,
                api_key: row.api_key,
                website_url: row.website_url,
                default_chat_model: row.default_chat_model,
            })
            .collect();
        let profiles = AgentConfigProfileEntity::find()
            .all(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|row| serde_json::from_value(row.configuration_json).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let agents = AgentDefinitionEntity::find()
            .all(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|row| serde_json::from_value(row.configuration_json).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let resources = AgentResourceEntity::find()
            .all(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        let plugins = resources_of_kind(&resources, "plugin").map_err(|e| e.to_string())?;
        let skills = resources_of_kind(&resources, "skill").map_err(|e| e.to_string())?;
        let knowledge_bases =
            resources_of_kind(&resources, "knowledge_base").map_err(|e| e.to_string())?;
        let value = AgentRuntimeCore {
            providers,
            profiles,
            agents,
            plugins,
            skills,
            knowledge_bases,
        };
        state
            .cache_set_json(&cache_key, &value, state.cache_ttl_seconds())
            .await;
        value
    };
    let registry = AgentRegistry {
        providers: core.providers,
        profiles: core.profiles,
        agents: core.agents,
        plugins: core.plugins,
        skills: core.skills,
        knowledge_bases: core.knowledge_bases,
    };
    let runtime = crate::platform::config::resolve_agent_runtime_from_registry(
        &registry,
        agent_id,
        app_id,
        business_id,
    )?;
    Ok(runtime)
}

pub(crate) async fn resolve_system_ai_runtime(
    state: &AppState,
    system_id: &str,
    system_prompt: &str,
) -> Result<ResolvedAgentRuntime, String> {
    let provider = AgentModelProviderEntity::find()
        .filter(agent_model_provider_entity::Column::IsDefault.eq(true))
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "系统 AI 功能需要先配置默认模型供应商".to_string())?;
    if !provider.enabled {
        return Err("默认模型供应商已停用，系统 AI 功能不可用".to_string());
    }
    if provider.api_base_url.trim().is_empty() || provider.default_chat_model.trim().is_empty() {
        return Err("默认模型供应商缺少 API 地址或默认对话模型".to_string());
    }

    Ok(ResolvedAgentRuntime {
        agent_id: system_id.to_string(),
        profile_id: "system-default-provider".to_string(),
        scope_type: "platform".to_string(),
        scope_ref_id: None,
        settings: AgentSettings {
            enabled: true,
            provider: provider.kind,
            api_base_url: provider.api_base_url,
            api_key: provider.api_key,
            chat_model: provider.default_chat_model,
            embedding_model: String::new(),
            temperature: 0.2,
            max_steps: 8,
            system_prompt: system_prompt.to_string(),
        },
        plugins: Vec::new(),
        skills: Vec::new(),
        knowledge_bases: Vec::new(),
        allowed_tools: HashSet::new(),
        application_ids: HashSet::new(),
    })
}

fn resources_of_kind<T: serde::de::DeserializeOwned>(
    rows: &[agent_resource_entity::Model],
    kind: &str,
) -> Result<Vec<T>, serde_json::Error> {
    rows.iter()
        .filter(|row| row.kind == kind)
        .map(|row| serde_json::from_value(row.configuration_json.clone()))
        .collect()
}

async fn insert_resource<T: Serialize>(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
    name: &str,
    value: &T,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    agent_resource_entity::ActiveModel {
        id: Set(id.to_string()),
        kind: Set(kind.to_string()),
        name: Set(name.to_string()),
        configuration_json: Set(
            serde_json::to_value(value).map_err(|error| AppError::BadRequest(error.to_string()))?
        ),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(())
}

async fn ensure_resource_ids(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    ids: &[String],
) -> Result<(), AppError> {
    for id in ids {
        if AgentResourceEntity::find_by_id(id)
            .one(db)
            .await?
            .is_none_or(|row| row.kind != kind)
        {
            return Err(AppError::BadRequest(format!(
                "{kind} resource not found: {id}"
            )));
        }
    }
    Ok(())
}

async fn resource_in_use(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
) -> Result<bool, AppError> {
    for row in AgentConfigProfileEntity::find().all(db).await? {
        let profile: AgentConfigProfile = serde_json::from_value(row.configuration_json)
            .map_err(|error| AppError::BadRequest(error.to_string()))?;
        let used = match kind {
            "plugin" => profile.plugin_ids.iter().any(|value| value == id),
            "skill" => profile.skill_ids.iter().any(|value| value == id),
            "knowledge_base" => profile.knowledge_base_ids.iter().any(|value| value == id),
            _ => false,
        };
        if used {
            return Ok(true);
        }
    }
    for row in AgentDefinitionEntity::find().all(db).await? {
        let agent: AgentDefinition = serde_json::from_value(row.configuration_json)
            .map_err(|error| AppError::BadRequest(error.to_string()))?;
        let used = match kind {
            "plugin" => agent.plugin_ids.iter().any(|value| value == id),
            "skill" => agent.skill_ids.iter().any(|value| value == id),
            "knowledge_base" => agent.knowledge_base_ids.iter().any(|value| value == id),
            _ => false,
        };
        if used {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn save_resource<T: Serialize>(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
    name: &str,
    value: &T,
) -> Result<(), AppError> {
    let row = AgentResourceEntity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("{kind} not found")))?;
    if row.kind != kind {
        return Err(AppError::NotFound(format!("{kind} not found")));
    }
    let mut active: agent_resource_entity::ActiveModel = row.into();
    active.name = Set(name.to_string());
    active.configuration_json =
        Set(serde_json::to_value(value).map_err(|error| AppError::BadRequest(error.to_string()))?);
    active.updated_at = Set(chrono::Utc::now());
    active.update(db).await?;
    Ok(())
}

async fn delete_resource(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
) -> Result<(), AppError> {
    if resource_in_use(db, kind, id).await? {
        let resource_name = match kind {
            "plugin" => "插件",
            "skill" => "Skill",
            "knowledge_base" => "知识库",
            _ => kind,
        };
        return Err(AppError::BadRequest(format!(
            "{resource_name}仍绑定到配置文件或机器人，无法删除"
        )));
    }
    let result = AgentResourceEntity::delete_many()
        .filter(agent_resource_entity::Column::Id.eq(id))
        .filter(agent_resource_entity::Column::Kind.eq(kind))
        .exec(db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound(format!("{kind} not found")));
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderResponse {
    id: String,
    name: String,
    kind: String,
    enabled: bool,
    is_default: bool,
    api_base_url: String,
    api_key: String,
    website_url: String,
    default_chat_model: String,
    models: Vec<String>,
    api_key_configured: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderRequest {
    name: String,
    kind: String,
    enabled: bool,
    #[serde(default)]
    is_default: bool,
    api_base_url: String,
    api_key: Option<String>,
    #[serde(default)]
    website_url: String,
    #[serde(default)]
    default_chat_model: String,
    #[serde(default)]
    models: Vec<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemAiStatusResponse {
    available: bool,
    provider_id: Option<String>,
    provider_name: Option<String>,
    reason: Option<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiEmployeeConfigurationResponse {
    employee_id: String,
    title: String,
    enabled: bool,
    agent_id: Option<String>,
    provider_id: Option<String>,
    chat_model: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAiEmployeeConfigurationRequest {
    provider_id: String,
    chat_model: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileRequest {
    name: String,
    provider_id: String,
    chat_model: String,
    embedding_model: String,
    temperature: f64,
    max_steps: usize,
    max_retries: usize,
    image_caption_model: String,
    web_search_enabled: bool,
    #[serde(default)]
    allow_create_apps: bool,
    #[serde(default)]
    allow_create_forms: bool,
    #[serde(default)]
    allow_create_automations: bool,
    #[serde(default)]
    allowed_tools: Vec<String>,
    #[serde(default)]
    application_ids: Vec<String>,
    context_max_turns: i32,
    context_discard_turns: usize,
    context_overflow_strategy: String,
    context_compression_prompt: String,
    context_keep_recent_ratio: f64,
    context_compression_provider_id: Option<String>,
    max_context_tokens: usize,
    #[serde(default)]
    plugin_ids: Vec<String>,
    #[serde(default)]
    skill_ids: Vec<String>,
    #[serde(default)]
    knowledge_base_ids: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRequest {
    name: String,
    description: String,
    enabled: bool,
    is_default: bool,
    scope_type: String,
    scope_ref_id: Option<String>,
    profile_id: String,
    system_prompt: String,
    #[serde(default)]
    plugin_ids: Vec<String>,
    #[serde(default)]
    skill_ids: Vec<String>,
    #[serde(default)]
    knowledge_base_ids: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginRequest {
    name: String,
    description: String,
    enabled: bool,
    version: String,
    entrypoint: String,
    #[serde(default)]
    manifest_json: String,
    requires_confirmation: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillRequest {
    name: String,
    description: String,
    enabled: bool,
    #[serde(default)]
    instructions: String,
    requires_confirmation: bool,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SkillFileRequest {
    content: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillFileResponse {
    id: String,
    package_name: String,
    path: String,
    content: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeBaseRequest {
    name: String,
    description: String,
    enabled: bool,
    retrieval_mode: String,
    #[serde(default)]
    content: String,
    source_ids: Vec<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformToolResponse {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    category: &'static str,
    risk_level: &'static str,
}

pub(crate) async fn list_platform_tools(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<PlatformToolResponse>>>, AppError> {
    Ok(Json(success_response(
        "platform tools loaded",
        vec![
            PlatformToolResponse {
                id: "list_apps",
                name: "读取应用列表",
                description: "查询当前可访问的应用。",
                category: "app",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "create_app",
                name: "创建应用",
                description: "创建新的低代码应用。",
                category: "app",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "update_app",
                name: "编辑应用",
                description: "修改低代码应用的名称、描述或状态。",
                category: "app",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "delete_app",
                name: "删除应用",
                description: "永久删除低代码应用及其资源，始终要求人工确认。",
                category: "app",
                risk_level: "destructive",
            },
            PlatformToolResponse {
                id: "get_application_business_context",
                name: "读取应用业务地图",
                description: "读取应用说明、表单、字段摘要、关联关系和明细父表关系。",
                category: "app",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_field_outline",
                name: "读取字段大纲",
                description: "读取应用内所有表单、字段、字段类型和层级关系。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "list_forms",
                name: "读取表单列表",
                description: "查询应用内表单元数据。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "list_navigation_groups",
                name: "读取导航分组",
                description: "读取应用导航分组的真实 ID 和层级，用于创建或移动表单。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "create_navigation_group",
                name: "创建导航分组",
                description: "在应用导航中创建根级或嵌套分组。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "delete_navigation_group",
                name: "删除导航分组",
                description: "删除分组容器并将内部项目上移，需用户确认。",
                category: "form",
                risk_level: "destructive",
            },
            PlatformToolResponse {
                id: "get_form_schema",
                name: "读取表单 Schema",
                description: "读取表单当前版本结构和字段。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_form_schema_contract",
                name: "读取表单 Schema 规范",
                description: "读取平台通用表单 Schema 结构、字段布局和表单类型规则；没有参考表单时用于设计新表单。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_form_relationships",
                name: "读取表单关系",
                description: "读取 Schema 中的关联字段、目标表单和填充规则。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_related_records",
                name: "追溯关联记录",
                description: "沿已配置关联字段批量读取目标表单记录。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "list_form_records",
                name: "读取表单记录",
                description: "读取已授权表单最近的有限记录，用于业务分析。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "query_form_records",
                name: "条件查询表单记录",
                description: "在指定页的有限记录中按字段条件筛选，用于分析。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "aggregate_form_records",
                name: "汇总表单记录",
                description: "对有限页范围内的记录执行计数、求和、平均值或分组计数。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_detail_form_definition",
                name: "读取明细表定义",
                description: "读取明细表与父表、子表字段的关联。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "list_detail_records",
                name: "读取明细表记录",
                description: "读取父表子表字段中的有限明细行。",
                category: "form",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "create_form",
                name: "创建表单",
                description: "创建空白表单；还要求 Profile 开启创建表单能力。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "move_form_to_group",
                name: "移动表单到分组",
                description: "将已有表单移动到指定导航分组或根级。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "create_detail_form",
                name: "生成明细表配置",
                description: "为父表的 subform 字段生成明细表，要求 Profile 允许创建表单。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "save_form_schema",
                name: "保存表单 Schema",
                description: "保存表单 Schema 并立即成为当前版本。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "delete_form",
                name: "删除表单",
                description: "永久删除表单及其 Schema、记录、导航和关联资源，始终要求人工确认。",
                category: "form",
                risk_level: "destructive",
            },
            PlatformToolResponse {
                id: "list_automations",
                name: "读取自动化列表",
                description: "查询应用内集成自动化。",
                category: "automation",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_automation_graph",
                name: "读取自动化流程",
                description: "读取自动化的触发器、节点和连线。",
                category: "automation",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "create_automation_draft",
                name: "创建自动化草稿",
                description: "创建待确认的事件自动化草稿，确认后保持 draft 状态。",
                category: "automation",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "delete_automation",
                name: "删除集成自动化",
                description: "永久删除普通事件集成自动化；始终要求人工确认，不允许删除流程工作流。",
                category: "automation",
                risk_level: "destructive",
            },
            PlatformToolResponse {
                id: "get_workflow_process_definition",
                name: "读取工作流定义",
                description: "读取工作流表单的流程节点和连线。",
                category: "workflow",
                risk_level: "read",
            },
            PlatformToolResponse {
                id: "get_workflow_record_runtime",
                name: "读取工作流运行态",
                description: "读取一条工作流记录的实例、待办和动作轨迹。",
                category: "workflow",
                risk_level: "read",
            },
        ],
    )))
}

pub(crate) async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ProviderResponse>>>, AppError> {
    let version = state.cache_version("yaya:v1:agent-providers:version").await;
    let cache_key = format!("yaya:v1:agent-providers:{version}");
    if let Some(cached) = state.cache_get_json(&cache_key).await {
        return Ok(Json(success_response(
            "agent model providers loaded",
            cached,
        )));
    }
    let rows = AgentModelProviderEntity::find().all(&state.db).await?;
    let models = AgentProviderModelEntity::find()
        .filter(agent_provider_model_entity::Column::Enabled.eq(true))
        .all(&state.db)
        .await?;
    let response: Vec<ProviderResponse> = rows
        .iter()
        .map(|row| provider_response(row, &models))
        .collect();
    state
        .cache_set_json(&cache_key, &response, state.cache_ttl_seconds())
        .await;
    Ok(Json(success_response(
        "agent model providers loaded",
        response,
    )))
}

pub(crate) async fn get_system_ai_status(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<SystemAiStatusResponse>>, AppError> {
    let provider = AgentModelProviderEntity::find()
        .filter(agent_model_provider_entity::Column::IsDefault.eq(true))
        .one(&state.db)
        .await?;
    let response = match provider {
        None => SystemAiStatusResponse {
            available: false,
            provider_id: None,
            provider_name: None,
            reason: Some("请先配置默认模型供应商".to_string()),
        },
        Some(provider) => {
            let reason = if !provider.enabled {
                Some("默认模型供应商已停用".to_string())
            } else if provider.api_base_url.trim().is_empty()
                || provider.default_chat_model.trim().is_empty()
            {
                Some("默认模型供应商缺少 API 地址或默认对话模型".to_string())
            } else {
                None
            };
            SystemAiStatusResponse {
                available: reason.is_none(),
                provider_id: Some(provider.id),
                provider_name: Some(provider.name),
                reason,
            }
        }
    };
    Ok(Json(success_response("system AI status loaded", response)))
}

pub(crate) async fn list_ai_employee_configurations(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AiEmployeeConfigurationResponse>>>, AppError> {
    let installed = load_installed_ai_employees();
    let installed_packages = crate::platform::config::load_installed_ai_employee_packages();
    let status = license_status();
    for package in installed_packages.values().filter_map(|value| {
        serde_json::from_value::<PlatformAiEmployeeEntitlement>(value.clone()).ok()
    }) {
        sync_installed_ai_employee_runtime(&state, &package).await?;
    }
    let agent_rows = AgentDefinitionEntity::find().all(&state.db).await?;
    let profile_rows = AgentConfigProfileEntity::find().all(&state.db).await?;
    let mut response = Vec::new();
    for entitlement in status
        .ai_employees
        .iter()
        .filter(|item| installed.contains(&item.id))
    {
        let package = installed_packages.get(&entitlement.id).and_then(|value| {
            serde_json::from_value::<PlatformAiEmployeeEntitlement>(value.clone()).ok()
        });
        let effective_title = package
            .as_ref()
            .map(|item| item.title.as_str())
            .unwrap_or(entitlement.title.as_str());
        let scope_ref = ai_employee_scope_ref(&entitlement.id);
        let agent_row = agent_rows
            .iter()
            .find(|row| row.scope_ref_id.as_deref() == Some(scope_ref.as_str()));
        let profile = agent_row
            .and_then(|agent| profile_rows.iter().find(|row| row.id == agent.profile_id))
            .and_then(|row| {
                serde_json::from_value::<AgentConfigProfile>(row.configuration_json.clone()).ok()
            });
        response.push(AiEmployeeConfigurationResponse {
            employee_id: entitlement.id.clone(),
            title: effective_title.to_string(),
            enabled: status.valid
                && entitlement.expires_at >= chrono::Utc::now().timestamp()
                && agent_row.is_some_and(|row| row.enabled),
            agent_id: agent_row.map(|row| row.id.clone()),
            provider_id: profile.as_ref().map(|item| item.provider_id.clone()),
            chat_model: profile.as_ref().map(|item| item.chat_model.clone()),
        });
    }
    Ok(Json(success_response(
        "AI employee configurations loaded",
        response,
    )))
}

pub(crate) async fn sync_installed_ai_employee_runtime(
    state: &AppState,
    entitlement: &PlatformAiEmployeeEntitlement,
) -> Result<(), AppError> {
    let scope_ref = ai_employee_scope_ref(&entitlement.id);
    let Some(agent_row) = AgentDefinitionEntity::find()
        .filter(agent_definition_entity::Column::ScopeRefId.eq(&scope_ref))
        .one(&state.db)
        .await?
    else {
        return Ok(());
    };
    let mut agent = serde_json::from_value::<AgentDefinition>(agent_row.configuration_json.clone())
        .map_err(|error| AppError::BadRequest(format!("AI 员工运行配置无效: {error}")))?;
    let system_prompt = ai_employee_system_prompt(entitlement);
    let skill_ids = entitlement
        .skills
        .iter()
        .map(|skill| skill.id.clone())
        .collect();
    let agent_changed = agent.name != entitlement.title
        || !agent.enabled
        || agent.system_prompt != system_prompt
        || agent.skill_ids != skill_ids;
    agent.name = entitlement.title.clone();
    agent.enabled = true;
    agent.system_prompt = system_prompt;
    agent.skill_ids = skill_ids;
    let mut changed = false;
    if agent_changed {
        let mut active_agent: agent_definition_entity::ActiveModel = agent_row.into();
        active_agent.name = Set(agent.name.clone());
        active_agent.enabled = Set(true);
        active_agent.configuration_json = Set(serde_json::to_value(&agent)
            .map_err(|error| AppError::BadRequest(error.to_string()))?);
        active_agent.updated_at = Set(chrono::Utc::now());
        active_agent.update(&state.db).await?;
        changed = true;
    }
    if let Some(profile_row) = AgentConfigProfileEntity::find_by_id(&agent.profile_id)
        .one(&state.db)
        .await?
    {
        let mut profile =
            serde_json::from_value::<AgentConfigProfile>(profile_row.configuration_json.clone())
                .map_err(|error| AppError::BadRequest(format!("AI 员工模型配置无效: {error}")))?;
        let profile_name = format!("{} 模型配置", entitlement.title);
        let policy_changed = profile.name != profile_name
            || profile.allowed_tools != entitlement.allowed_tools
            || profile.application_ids != entitlement.application_ids;
        if policy_changed {
            profile.name = profile_name;
            profile.allowed_tools = entitlement.allowed_tools.clone();
            profile.application_ids = entitlement.application_ids.clone();
            let mut active_profile: agent_config_profile_entity::ActiveModel = profile_row.into();
            active_profile.name = Set(profile.name.clone());
            active_profile.configuration_json = Set(serde_json::to_value(&profile)
                .map_err(|error| AppError::BadRequest(error.to_string()))?);
            active_profile.updated_at = Set(chrono::Utc::now());
            active_profile.update(&state.db).await?;
            changed = true;
        }
    }
    if changed {
        state
            .bump_cache_version("yaya:v1:agent-runtime:version")
            .await;
    }
    Ok(())
}

pub(crate) async fn install_ai_employee_skill_package(
    state: &AppState,
    skill: &PlatformAiEmployeeSkill,
    archive: &[u8],
) -> Result<(), AppError> {
    let mut item = AgentSkillDefinition {
        id: skill.id.clone(),
        name: skill.title.clone(),
        package_name: market_skill_package_name(skill),
        source: "market".to_string(),
        version: skill.version.clone(),
        package_path: String::new(),
        is_system: skill.is_system,
        description: skill.description.clone(),
        enabled: true,
        instructions: skill.instructions.clone(),
        requires_confirmation: skill.requires_confirmation,
        plugin_manifest_json: serde_json::json!({
            "id": skill.id,
            "version": skill.version,
            "kind": "skill",
            "entrypoint": skill.package_path,
            "tools": []
        })
        .to_string(),
    };
    import_skill_package(&mut item, archive).map_err(AppError::BadRequest)?;
    item.source = "market".to_string();
    item.version = skill.version.clone();
    item.is_system = skill.is_system;
    item.name = skill.title.clone();
    item.description = skill.description.clone();
    item.requires_confirmation = skill.requires_confirmation;

    let now = chrono::Utc::now();
    if let Some(existing) = AgentResourceEntity::find_by_id(&item.id)
        .one(&state.db)
        .await?
    {
        if existing.kind != "skill" {
            return Err(AppError::BadRequest(format!(
                "AI 员工 Skill ID 与本地 {} 资源冲突",
                existing.kind
            )));
        }
        let mut active: agent_resource_entity::ActiveModel = existing.into();
        active.name = Set(item.name.clone());
        active.configuration_json =
            Set(serde_json::to_value(&item)
                .map_err(|error| AppError::BadRequest(error.to_string()))?);
        active.updated_at = Set(now);
        active.update(&state.db).await?;
    } else {
        insert_resource(&state.db, "skill", &item.id, &item.name, &item, now).await?;
    }
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(())
}

pub(crate) async fn disable_installed_ai_employee_runtime(
    state: &AppState,
    employee_id: &str,
) -> Result<(), AppError> {
    let scope_ref = ai_employee_scope_ref(employee_id);
    if let Some(row) = AgentDefinitionEntity::find()
        .filter(agent_definition_entity::Column::ScopeRefId.eq(&scope_ref))
        .one(&state.db)
        .await?
    {
        let mut active: agent_definition_entity::ActiveModel = row.into();
        active.enabled = Set(false);
        active.updated_at = Set(chrono::Utc::now());
        active.update(&state.db).await?;
        state
            .bump_cache_version("yaya:v1:agent-runtime:version")
            .await;
    }
    Ok(())
}

pub(crate) async fn update_ai_employee_configuration(
    State(state): State<AppState>,
    Path(employee_id): Path<String>,
    Json(payload): Json<UpdateAiEmployeeConfigurationRequest>,
) -> Result<Json<ApiResponse<AiEmployeeConfigurationResponse>>, AppError> {
    let entitlement = require_configurable_ai_employee(&employee_id)?;
    let provider = AgentModelProviderEntity::find_by_id(payload.provider_id.trim())
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("模型供应商不存在".to_string()))?;
    if !provider.enabled {
        return Err(AppError::BadRequest("模型供应商已停用".to_string()));
    }
    let chat_model = payload.chat_model.trim();
    if chat_model.is_empty() {
        return Err(AppError::BadRequest("请选择对话模型".to_string()));
    }

    let scope_ref = ai_employee_scope_ref(&employee_id);
    let existing_agent = AgentDefinitionEntity::find()
        .filter(agent_definition_entity::Column::ScopeRefId.eq(&scope_ref))
        .one(&state.db)
        .await?;
    let existing_profile_row = match existing_agent.as_ref() {
        Some(agent) => {
            AgentConfigProfileEntity::find_by_id(&agent.profile_id)
                .one(&state.db)
                .await?
        }
        None => None,
    };
    let mut profile = existing_profile_row
        .as_ref()
        .map(|row| serde_json::from_value::<AgentConfigProfile>(row.configuration_json.clone()))
        .transpose()
        .map_err(|error| AppError::BadRequest(format!("AI 员工模型配置无效: {error}")))?
        .unwrap_or_else(|| default_ai_employee_profile(&entitlement));
    profile.name = format!("{} 模型配置", entitlement.title);
    profile.provider_id = provider.id.clone();
    profile.chat_model = chat_model.to_string();
    let now = chrono::Utc::now();
    if let Some(row) = existing_profile_row {
        let mut active: agent_config_profile_entity::ActiveModel = row.into();
        active.name = Set(profile.name.clone());
        active.provider_id = Set(profile.provider_id.clone());
        active.configuration_json = Set(serde_json::to_value(&profile)
            .map_err(|error| AppError::BadRequest(error.to_string()))?);
        active.updated_at = Set(now);
        active.update(&state.db).await?;
    } else {
        agent_config_profile_entity::ActiveModel {
            id: Set(profile.id.clone()),
            name: Set(profile.name.clone()),
            provider_id: Set(profile.provider_id.clone()),
            configuration_json: Set(serde_json::to_value(&profile)
                .map_err(|error| AppError::BadRequest(error.to_string()))?),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&state.db)
        .await?;
    }

    let system_prompt = ai_employee_system_prompt(&entitlement);
    let agent = if let Some(row) = existing_agent {
        let mut agent =
            serde_json::from_value::<AgentDefinition>(row.configuration_json.clone())
                .map_err(|error| AppError::BadRequest(format!("AI 员工运行配置无效: {error}")))?;
        agent.name = entitlement.title.clone();
        agent.enabled = true;
        agent.profile_id = profile.id.clone();
        agent.system_prompt = system_prompt;
        agent.skill_ids = entitlement
            .skills
            .iter()
            .map(|skill| skill.id.clone())
            .collect();
        let mut active: agent_definition_entity::ActiveModel = row.into();
        active.name = Set(agent.name.clone());
        active.enabled = Set(true);
        active.profile_id = Set(agent.profile_id.clone());
        active.configuration_json = Set(serde_json::to_value(&agent)
            .map_err(|error| AppError::BadRequest(error.to_string()))?);
        active.updated_at = Set(now);
        active.update(&state.db).await?;
        agent
    } else {
        let agent = AgentDefinition {
            id: format!("agent-{}", Uuid::new_v4().simple()),
            name: entitlement.title.clone(),
            description: "从 AI 员工市场安装的内置 AI 员工".to_string(),
            enabled: true,
            is_default: false,
            scope_type: "platform".to_string(),
            scope_ref_id: Some(scope_ref),
            profile_id: profile.id.clone(),
            system_prompt,
            plugin_ids: Vec::new(),
            skill_ids: entitlement
                .skills
                .iter()
                .map(|skill| skill.id.clone())
                .collect(),
            knowledge_base_ids: Vec::new(),
        };
        agent_definition_entity::ActiveModel {
            id: Set(agent.id.clone()),
            name: Set(agent.name.clone()),
            enabled: Set(true),
            is_default: Set(false),
            scope_type: Set(agent.scope_type.clone()),
            scope_ref_id: Set(agent.scope_ref_id.clone()),
            profile_id: Set(agent.profile_id.clone()),
            configuration_json: Set(serde_json::to_value(&agent)
                .map_err(|error| AppError::BadRequest(error.to_string()))?),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&state.db)
        .await?;
        agent
    };
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "AI employee model configured",
        AiEmployeeConfigurationResponse {
            employee_id: entitlement.id,
            title: entitlement.title,
            enabled: true,
            agent_id: Some(agent.id),
            provider_id: Some(profile.provider_id),
            chat_model: Some(profile.chat_model),
        },
    )))
}

fn market_skill_package_name(skill: &PlatformAiEmployeeSkill) -> String {
    let value = if skill.package_name.trim().is_empty() {
        &skill.id
    } else {
        &skill.package_name
    };
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "market-skill".to_string()
    } else {
        normalized.to_string()
    }
}

pub(crate) async fn create_provider(
    State(state): State<AppState>,
    Json(payload): Json<ProviderRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ProviderResponse>>), AppError> {
    validate_provider(&payload)?;
    let is_first_provider = AgentModelProviderEntity::find().count(&state.db).await? == 0;
    let is_default = is_first_provider || payload.is_default;
    if is_default {
        clear_default_provider(&state.db, None).await?;
    }
    let provider = agent_model_provider_entity::ActiveModel {
        id: Set(format!("provider-{}", Uuid::new_v4().simple())),
        name: Set(payload.name.trim().to_string()),
        kind: Set(payload.kind.trim().to_string()),
        enabled: Set(payload.enabled),
        is_default: Set(is_default),
        api_base_url: Set(payload
            .api_base_url
            .trim()
            .trim_end_matches('/')
            .to_string()),
        api_key: Set(payload.api_key.unwrap_or_default()),
        website_url: Set(payload.website_url.trim().to_string()),
        default_chat_model: Set(payload.default_chat_model.trim().to_string()),
        created_at: Set(chrono::Utc::now()),
        updated_at: Set(chrono::Utc::now()),
    };
    let provider = provider.insert(&state.db).await?;
    sync_provider_models(
        &state.db,
        &provider.id,
        &payload.models,
        &provider.default_chat_model,
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "provider created",
            provider_response(
                &provider,
                &AgentProviderModelEntity::find()
                    .filter(agent_provider_model_entity::Column::ProviderId.eq(&provider.id))
                    .all(&state.db)
                    .await?,
            ),
        )),
    ))
}

pub(crate) async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ProviderRequest>,
) -> Result<Json<ApiResponse<ProviderResponse>>, AppError> {
    validate_provider(&payload)?;
    let provider = AgentModelProviderEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("model provider not found".to_string()))?;
    if payload.is_default {
        clear_default_provider(&state.db, Some(&id)).await?;
    }
    let mut active: agent_model_provider_entity::ActiveModel = provider.into();
    active.name = Set(payload.name.trim().to_string());
    active.kind = Set(payload.kind.trim().to_string());
    active.enabled = Set(payload.enabled);
    active.is_default = Set(payload.is_default);
    active.api_base_url = Set(payload
        .api_base_url
        .trim()
        .trim_end_matches('/')
        .to_string());
    active.website_url = Set(payload.website_url.trim().to_string());
    active.default_chat_model = Set(payload.default_chat_model.trim().to_string());
    active.updated_at = Set(chrono::Utc::now());
    if let Some(api_key) = payload.api_key.filter(|value| !value.trim().is_empty()) {
        active.api_key = Set(api_key);
    }
    let provider = active.update(&state.db).await?;
    sync_provider_models(
        &state.db,
        &provider.id,
        &payload.models,
        &provider.default_chat_model,
    )
    .await?;
    let models = AgentProviderModelEntity::find()
        .filter(agent_provider_model_entity::Column::ProviderId.eq(&provider.id))
        .all(&state.db)
        .await?;
    let response = provider_response(&provider, &models);
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("provider updated", response)))
}

pub(crate) async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    if AgentConfigProfileEntity::find()
        .filter(agent_config_profile_entity::Column::ProviderId.eq(&id))
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(AppError::BadRequest(
            "provider is used by a configuration profile".to_string(),
        ));
    }
    let result = AgentModelProviderEntity::delete_by_id(&id)
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound("model provider not found".to_string()));
    }
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "provider deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_profiles(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentConfigProfile>>>, AppError> {
    let rows = AgentConfigProfileEntity::find().all(&state.db).await?;
    let profiles = rows
        .into_iter()
        .map(|row| {
            serde_json::from_value(row.configuration_json)
                .map_err(|error| AppError::BadRequest(format!("invalid stored profile: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(success_response("agent profiles loaded", profiles)))
}

pub(crate) async fn create_profile(
    State(state): State<AppState>,
    Json(payload): Json<ProfileRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentConfigProfile>>), AppError> {
    validate_profile_payload(&payload)?;
    if AgentModelProviderEntity::find_by_id(&payload.provider_id)
        .one(&state.db)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest("model provider not found".to_string()));
    }
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let profile = profile_from_request(format!("profile-{}", Uuid::new_v4().simple()), payload);
    agent_config_profile_entity::ActiveModel {
        id: Set(profile.id.clone()),
        name: Set(profile.name.clone()),
        provider_id: Set(profile.provider_id.clone()),
        configuration_json: Set(serde_json::to_value(&profile)
            .map_err(|error| AppError::BadRequest(error.to_string()))?),
        created_at: Set(chrono::Utc::now()),
        updated_at: Set(chrono::Utc::now()),
    }
    .insert(&state.db)
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("profile created", profile)),
    ))
}

pub(crate) async fn update_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ProfileRequest>,
) -> Result<Json<ApiResponse<AgentConfigProfile>>, AppError> {
    validate_profile_payload(&payload)?;
    if AgentModelProviderEntity::find_by_id(&payload.provider_id)
        .one(&state.db)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest("model provider not found".to_string()));
    }
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let row = AgentConfigProfileEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("configuration profile not found".to_string()))?;
    let profile = profile_from_request(id, payload);
    let mut active: agent_config_profile_entity::ActiveModel = row.into();
    active.name = Set(profile.name.clone());
    active.provider_id = Set(profile.provider_id.clone());
    active.configuration_json =
        Set(serde_json::to_value(&profile)
            .map_err(|error| AppError::BadRequest(error.to_string()))?);
    active.updated_at = Set(chrono::Utc::now());
    active.update(&state.db).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("profile updated", profile)))
}

pub(crate) async fn delete_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    if AgentDefinitionEntity::find()
        .filter(agent_definition_entity::Column::ProfileId.eq(&id))
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(AppError::BadRequest(
            "profile is used by an agent".to_string(),
        ));
    }
    let result = AgentConfigProfileEntity::delete_by_id(&id)
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound(
            "configuration profile not found".to_string(),
        ));
    }
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "profile deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_agents(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentDefinition>>>, AppError> {
    let rows = AgentDefinitionEntity::find().all(&state.db).await?;
    let agents = rows
        .into_iter()
        .map(|row| {
            serde_json::from_value(row.configuration_json)
                .map_err(|error| AppError::BadRequest(format!("invalid stored agent: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(success_response("agents loaded", agents)))
}

pub(crate) async fn create_agent(
    State(state): State<AppState>,
    Json(payload): Json<AgentRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentDefinition>>), AppError> {
    validate_agent_payload(&payload)?;
    if AgentConfigProfileEntity::find_by_id(&payload.profile_id)
        .one(&state.db)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest(
            "configuration profile not found".to_string(),
        ));
    }
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let agent = agent_from_request(format!("agent-{}", Uuid::new_v4().simple()), payload);
    agent_definition_entity::ActiveModel {
        id: Set(agent.id.clone()),
        name: Set(agent.name.clone()),
        enabled: Set(agent.enabled),
        is_default: Set(agent.is_default),
        scope_type: Set(agent.scope_type.clone()),
        scope_ref_id: Set(agent.scope_ref_id.clone()),
        profile_id: Set(agent.profile_id.clone()),
        configuration_json: Set(serde_json::to_value(&agent)
            .map_err(|error| AppError::BadRequest(error.to_string()))?),
        created_at: Set(chrono::Utc::now()),
        updated_at: Set(chrono::Utc::now()),
    }
    .insert(&state.db)
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("agent created", agent)),
    ))
}

pub(crate) async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AgentRequest>,
) -> Result<Json<ApiResponse<AgentDefinition>>, AppError> {
    validate_agent_payload(&payload)?;
    if AgentConfigProfileEntity::find_by_id(&payload.profile_id)
        .one(&state.db)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest(
            "configuration profile not found".to_string(),
        ));
    }
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let row = AgentDefinitionEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("agent not found".to_string()))?;
    let agent = agent_from_request(id, payload);
    let mut active: agent_definition_entity::ActiveModel = row.into();
    active.name = Set(agent.name.clone());
    active.enabled = Set(agent.enabled);
    active.is_default = Set(agent.is_default);
    active.scope_type = Set(agent.scope_type.clone());
    active.scope_ref_id = Set(agent.scope_ref_id.clone());
    active.profile_id = Set(agent.profile_id.clone());
    active.configuration_json =
        Set(serde_json::to_value(&agent)
            .map_err(|error| AppError::BadRequest(error.to_string()))?);
    active.updated_at = Set(chrono::Utc::now());
    active.update(&state.db).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("agent updated", agent)))
}

pub(crate) async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let result = AgentDefinitionEntity::delete_by_id(&id)
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound("agent not found".to_string()));
    }
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "agent deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_plugins(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentPluginDefinition>>>, AppError> {
    let rows = AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("plugin"))
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent plugins loaded",
        resources_of_kind(&rows, "plugin")
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
    )))
}

pub(crate) async fn create_plugin(
    State(state): State<AppState>,
    Json(payload): Json<PluginRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentPluginDefinition>>), AppError> {
    validate_plugin(&payload)?;
    let item = AgentPluginDefinition {
        id: format!("plugin-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        manifest_json: payload.manifest_json.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    insert_resource(
        &state.db,
        "plugin",
        &item.id,
        &item.name,
        &item,
        chrono::Utc::now(),
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("plugin created", item)),
    ))
}

pub(crate) async fn update_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PluginRequest>,
) -> Result<Json<ApiResponse<AgentPluginDefinition>>, AppError> {
    validate_plugin(&payload)?;
    let item = AgentPluginDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        manifest_json: payload.manifest_json.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    save_resource(&state.db, "plugin", &item.id, &item.name, &item).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("plugin updated", item)))
}

pub(crate) async fn delete_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    delete_resource(&state.db, "plugin", &id).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "plugin deleted",
        serde_json::json!({"id": id}),
    )))
}

pub(crate) async fn list_skills(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentSkillDefinition>>>, AppError> {
    let rows = AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("skill"))
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent skills loaded",
        resources_of_kind(&rows, "skill")
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
    )))
}
pub(crate) async fn create_skill(
    State(state): State<AppState>,
    Json(payload): Json<SkillRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentSkillDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    let mut item = AgentSkillDefinition {
        id: format!("skill-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        package_name: String::new(),
        source: "local".to_string(),
        version: "1.0.0".to_string(),
        package_path: String::new(),
        is_system: false,
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        instructions: payload.instructions.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
        plugin_manifest_json: String::new(),
    };
    ensure_skill_package(&mut item).map_err(AppError::Server)?;
    let instructions = item.instructions.clone();
    write_skill_markdown(&mut item, &instructions).map_err(AppError::Server)?;
    item.plugin_manifest_json = skill_plugin_manifest(&item);
    insert_resource(
        &state.db,
        "skill",
        &item.id,
        &item.name,
        &item,
        chrono::Utc::now(),
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("skill created", item)),
    ))
}

pub(crate) async fn import_skill(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ApiResponse<AgentSkillDefinition>>), AppError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("invalid Skill import payload: {error}")))?
        .ok_or_else(|| AppError::BadRequest("请选择一个 Skill ZIP 文件".to_string()))?;
    let file_name = field.file_name().unwrap_or("skill.zip").to_string();
    if !file_name.to_ascii_lowercase().ends_with(".zip") {
        return Err(AppError::BadRequest(
            "Skill 导入仅支持 .zip 文件".to_string(),
        ));
    }
    let bytes = field
        .bytes()
        .await
        .map_err(|error| AppError::BadRequest(format!("无法读取 Skill ZIP 文件: {error}")))?;
    let id = format!("skill-{}", Uuid::new_v4().simple());
    let mut item = AgentSkillDefinition {
        package_name: String::new(),
        id,
        name: file_name
            .strip_suffix(".zip")
            .or_else(|| file_name.strip_suffix(".ZIP"))
            .unwrap_or(&file_name)
            .to_string(),
        source: "local".to_string(),
        version: "1.0.0".to_string(),
        package_path: String::new(),
        is_system: false,
        description: String::new(),
        enabled: true,
        instructions: String::new(),
        requires_confirmation: false,
        plugin_manifest_json: String::new(),
    };
    import_skill_package(&mut item, &bytes).map_err(AppError::BadRequest)?;
    item.plugin_manifest_json = skill_plugin_manifest(&item);
    if item.name.trim().is_empty() {
        item.name = item.package_name.clone();
    }
    insert_resource(
        &state.db,
        "skill",
        &item.id,
        &item.name,
        &item,
        chrono::Utc::now(),
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("skill imported", item)),
    ))
}
pub(crate) async fn update_skill(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SkillRequest>,
) -> Result<Json<ApiResponse<AgentSkillDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    let existing = AgentResourceEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("skill not found".to_string()))?;
    if existing.kind != "skill" {
        return Err(AppError::NotFound("skill not found".to_string()));
    }
    let existing: AgentSkillDefinition = serde_json::from_value(existing.configuration_json)
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    let mut item = AgentSkillDefinition {
        id,
        name: payload.name.trim().to_string(),
        package_name: existing.package_name,
        source: existing.source,
        version: existing.version,
        package_path: existing.package_path,
        is_system: existing.is_system,
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        instructions: payload.instructions.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
        plugin_manifest_json: existing.plugin_manifest_json,
    };
    let instructions = item.instructions.clone();
    write_skill_markdown(&mut item, &instructions).map_err(AppError::Server)?;
    item.plugin_manifest_json = skill_plugin_manifest(&item);
    save_resource(&state.db, "skill", &item.id, &item.name, &item).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("skill updated", item)))
}

pub(crate) async fn get_skill_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SkillFileResponse>>, AppError> {
    let row = AgentResourceEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("skill not found".to_string()))?;
    if row.kind != "skill" {
        return Err(AppError::NotFound("skill not found".to_string()));
    }
    let skill: AgentSkillDefinition = serde_json::from_value(row.configuration_json)
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    Ok(Json(success_response(
        "skill file loaded",
        SkillFileResponse {
            id: skill.id,
            package_name: skill.package_name,
            path: skill.package_path,
            content: skill.instructions,
        },
    )))
}

pub(crate) async fn update_skill_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SkillFileRequest>,
) -> Result<Json<ApiResponse<SkillFileResponse>>, AppError> {
    if payload.content.len() > 512 * 1024 {
        return Err(AppError::BadRequest(
            "SKILL.md must be 512 KB or smaller".to_string(),
        ));
    }
    let row = AgentResourceEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("skill not found".to_string()))?;
    if row.kind != "skill" {
        return Err(AppError::NotFound("skill not found".to_string()));
    }
    let mut skill: AgentSkillDefinition = serde_json::from_value(row.configuration_json)
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    write_skill_markdown(&mut skill, &payload.content).map_err(AppError::Server)?;
    let response = SkillFileResponse {
        id: skill.id.clone(),
        package_name: skill.package_name.clone(),
        path: skill.package_path.clone(),
        content: skill.instructions.clone(),
    };
    save_resource(&state.db, "skill", &skill.id, &skill.name, &skill).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("skill file updated", response)))
}
pub(crate) async fn delete_skill(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    delete_resource(&state.db, "skill", &id).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "skill deleted",
        serde_json::json!({"id": id}),
    )))
}

pub(crate) async fn list_knowledge_bases(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentKnowledgeBaseDefinition>>>, AppError> {
    let rows = AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("knowledge_base"))
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "knowledge bases loaded",
        resources_of_kind(&rows, "knowledge_base")
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
    )))
}
pub(crate) async fn create_knowledge_base(
    State(state): State<AppState>,
    Json(payload): Json<KnowledgeBaseRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentKnowledgeBaseDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    let item = AgentKnowledgeBaseDefinition {
        id: format!("knowledge-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        retrieval_mode: payload.retrieval_mode,
        content: payload.content.trim().to_string(),
        source_ids: payload.source_ids,
    };
    insert_resource(
        &state.db,
        "knowledge_base",
        &item.id,
        &item.name,
        &item,
        chrono::Utc::now(),
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("knowledge base created", item)),
    ))
}
pub(crate) async fn update_knowledge_base(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<KnowledgeBaseRequest>,
) -> Result<Json<ApiResponse<AgentKnowledgeBaseDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    let item = AgentKnowledgeBaseDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        retrieval_mode: payload.retrieval_mode,
        content: payload.content.trim().to_string(),
        source_ids: payload.source_ids,
    };
    save_resource(&state.db, "knowledge_base", &item.id, &item.name, &item).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("knowledge base updated", item)))
}
pub(crate) async fn delete_knowledge_base(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    delete_resource(&state.db, "knowledge_base", &id).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "knowledge base deleted",
        serde_json::json!({"id": id}),
    )))
}

fn validate_resource_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        Err(AppError::BadRequest(
            "resource name is required".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn skill_plugin_manifest(skill: &AgentSkillDefinition) -> String {
    serde_json::json!({
        "id": skill.id,
        "version": skill.version,
        "kind": "skill",
        "entrypoint": skill.package_path,
        "tools": [],
    })
    .to_string()
}

fn validate_plugin(payload: &PluginRequest) -> Result<(), AppError> {
    validate_resource_name(&payload.name)?;
    crate::platform::config::parse_plugin_manifest(&payload.manifest_json)
        .map_err(AppError::BadRequest)?;
    Ok(())
}

fn validate_provider(payload: &ProviderRequest) -> Result<(), AppError> {
    if payload.name.trim().is_empty() || payload.api_base_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "provider name and API base URL are required".to_string(),
        ));
    }
    Ok(())
}

fn validate_profile_payload(payload: &ProfileRequest) -> Result<(), AppError> {
    if payload.name.trim().is_empty()
        || payload.max_steps == 0
        || payload.max_steps > 30
        || payload.max_retries > 20
        || !(0.0..=2.0).contains(&payload.temperature)
        || !(0.0..=0.3).contains(&payload.context_keep_recent_ratio)
    {
        return Err(AppError::BadRequest(
            "invalid configuration profile".to_string(),
        ));
    }
    Ok(())
}

fn validate_agent_payload(payload: &AgentRequest) -> Result<(), AppError> {
    if payload.name.trim().is_empty()
        || !matches!(
            payload.scope_type.as_str(),
            "platform" | "application" | "business"
        )
    {
        return Err(AppError::BadRequest(
            "invalid agent configuration".to_string(),
        ));
    }
    if matches!(payload.scope_type.as_str(), "application" | "business")
        && payload
            .scope_ref_id
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(AppError::BadRequest(
            "application and business Agent scopes require a scope reference".to_string(),
        ));
    }
    Ok(())
}

fn profile_from_request(id: String, payload: ProfileRequest) -> AgentConfigProfile {
    AgentConfigProfile {
        id,
        name: payload.name.trim().to_string(),
        provider_id: payload.provider_id,
        chat_model: payload.chat_model.trim().to_string(),
        embedding_model: payload.embedding_model.trim().to_string(),
        temperature: payload.temperature,
        max_steps: payload.max_steps,
        max_retries: payload.max_retries,
        image_caption_model: payload.image_caption_model.trim().to_string(),
        web_search_enabled: payload.web_search_enabled,
        allow_create_apps: payload.allow_create_apps,
        allow_create_forms: payload.allow_create_forms,
        allow_create_automations: payload.allow_create_automations,
        allowed_tools: payload.allowed_tools,
        application_ids: payload.application_ids,
        context_max_turns: payload.context_max_turns,
        context_discard_turns: payload.context_discard_turns,
        context_overflow_strategy: payload.context_overflow_strategy,
        context_compression_prompt: payload.context_compression_prompt,
        context_keep_recent_ratio: payload.context_keep_recent_ratio,
        context_compression_provider_id: payload
            .context_compression_provider_id
            .filter(|value| !value.trim().is_empty()),
        max_context_tokens: payload.max_context_tokens,
        plugin_ids: Vec::new(),
        skill_ids: Vec::new(),
        knowledge_base_ids: Vec::new(),
    }
}

fn ai_employee_scope_ref(employee_id: &str) -> String {
    format!("ai-employee:{employee_id}")
}

fn require_configurable_ai_employee(
    employee_id: &str,
) -> Result<PlatformAiEmployeeEntitlement, AppError> {
    if !load_installed_ai_employees().contains(employee_id) {
        return Err(AppError::Forbidden("AI 员工尚未安装".to_string()));
    }
    let status = license_status();
    if !status.valid {
        return Err(AppError::Forbidden(
            status
                .reason
                .unwrap_or_else(|| "平台许可证无效".to_string()),
        ));
    }
    let entitlement = status
        .ai_employees
        .into_iter()
        .find(|item| item.id == employee_id && item.expires_at >= chrono::Utc::now().timestamp())
        .ok_or_else(|| AppError::Forbidden("当前许可证未包含有效的 AI 员工授权".to_string()))?;
    Ok(
        crate::platform::config::load_installed_ai_employee_packages()
            .get(employee_id)
            .and_then(|value| {
                serde_json::from_value::<PlatformAiEmployeeEntitlement>(value.clone()).ok()
            })
            .unwrap_or(entitlement),
    )
}

fn ai_employee_system_prompt(entitlement: &PlatformAiEmployeeEntitlement) -> String {
    entitlement.system_prompt.clone()
}

fn default_ai_employee_profile(entitlement: &PlatformAiEmployeeEntitlement) -> AgentConfigProfile {
    AgentConfigProfile {
        id: format!("profile-{}", Uuid::new_v4().simple()),
        name: format!("{} 模型配置", entitlement.title),
        provider_id: String::new(),
        chat_model: String::new(),
        embedding_model: String::new(),
        temperature: 0.2,
        max_steps: 8,
        max_retries: 3,
        image_caption_model: String::new(),
        web_search_enabled: false,
        allow_create_apps: false,
        allow_create_forms: false,
        allow_create_automations: false,
        allowed_tools: Vec::new(),
        application_ids: Vec::new(),
        context_max_turns: 50,
        context_discard_turns: 10,
        context_overflow_strategy: "llm_compress".to_string(),
        context_compression_prompt: String::new(),
        context_keep_recent_ratio: 0.15,
        context_compression_provider_id: None,
        max_context_tokens: 128_000,
        plugin_ids: Vec::new(),
        skill_ids: Vec::new(),
        knowledge_base_ids: Vec::new(),
    }
}

fn agent_from_request(id: String, payload: AgentRequest) -> AgentDefinition {
    AgentDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        is_default: payload.is_default,
        scope_type: payload.scope_type,
        scope_ref_id: payload
            .scope_ref_id
            .filter(|value| !value.trim().is_empty()),
        profile_id: payload.profile_id,
        system_prompt: payload.system_prompt.trim().to_string(),
        plugin_ids: Vec::new(),
        skill_ids: Vec::new(),
        knowledge_base_ids: Vec::new(),
    }
}

fn provider_response(
    value: &agent_model_provider_entity::Model,
    models: &[agent_provider_model_entity::Model],
) -> ProviderResponse {
    ProviderResponse {
        id: value.id.clone(),
        name: value.name.clone(),
        kind: value.kind.clone(),
        enabled: value.enabled,
        is_default: value.is_default,
        api_base_url: value.api_base_url.clone(),
        api_key: value.api_key.clone(),
        website_url: value.website_url.clone(),
        default_chat_model: value.default_chat_model.clone(),
        models: models
            .iter()
            .filter(|model| model.provider_id == value.id && model.enabled)
            .map(|model| model.model_id.clone())
            .collect(),
        api_key_configured: !value.api_key.is_empty(),
    }
}

async fn clear_default_provider(
    db: &sea_orm::DatabaseConnection,
    except_id: Option<&str>,
) -> Result<(), AppError> {
    let mut update = AgentModelProviderEntity::update_many()
        .col_expr(
            agent_model_provider_entity::Column::IsDefault,
            sea_orm::sea_query::Expr::value(false),
        )
        .filter(agent_model_provider_entity::Column::IsDefault.eq(true));
    if let Some(id) = except_id {
        update = update.filter(agent_model_provider_entity::Column::Id.ne(id));
    }
    update.exec(db).await?;
    Ok(())
}

async fn insert_provider_model(
    db: &sea_orm::DatabaseConnection,
    provider_id: &str,
    model_id: &str,
    is_default: bool,
) -> Result<(), AppError> {
    agent_provider_model_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        provider_id: Set(provider_id.to_string()),
        model_id: Set(model_id.to_string()),
        capability: Set("chat".to_string()),
        enabled: Set(true),
        is_default: Set(is_default),
    }
    .insert(db)
    .await?;
    Ok(())
}

async fn sync_provider_models(
    db: &sea_orm::DatabaseConnection,
    provider_id: &str,
    models: &[String],
    default_chat_model: &str,
) -> Result<(), AppError> {
    AgentProviderModelEntity::delete_many()
        .filter(agent_provider_model_entity::Column::ProviderId.eq(provider_id))
        .exec(db)
        .await?;
    let mut normalized = models
        .iter()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !default_chat_model.is_empty() && !normalized.iter().any(|model| model == default_chat_model)
    {
        normalized.push(default_chat_model.to_string());
    }
    normalized.sort();
    normalized.dedup();
    for model in normalized {
        insert_provider_model(db, provider_id, &model, model == default_chat_model).await?;
    }
    Ok(())
}
