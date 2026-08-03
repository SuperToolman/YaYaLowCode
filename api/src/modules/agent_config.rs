use axum::Json;
use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
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
    AgentPersonaDefinition, AgentPluginDefinition, AgentRegistry, AgentSkillDefinition,
    ensure_skill_package, import_skill_package, load_agent_registry, write_skill_markdown,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
};

fn default_approval_mode() -> String {
    "approve_on_behalf".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
struct AgentRuntimeCore {
    providers: Vec<AgentModelProvider>,
    profiles: Vec<AgentConfigProfile>,
    agents: Vec<AgentDefinition>,
    personas: Vec<AgentPersonaDefinition>,
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
        let personas = resources_of_kind(&resources, "persona").map_err(|e| e.to_string())?;
        let plugins = resources_of_kind(&resources, "plugin").map_err(|e| e.to_string())?;
        let skills = resources_of_kind(&resources, "skill").map_err(|e| e.to_string())?;
        let knowledge_bases =
            resources_of_kind(&resources, "knowledge_base").map_err(|e| e.to_string())?;
        let value = AgentRuntimeCore {
            providers,
            profiles,
            agents,
            personas,
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
        personas: core.personas,
        plugins: core.plugins,
        skills: core.skills,
        knowledge_bases: core.knowledge_bases,
    };
    crate::platform::config::resolve_agent_runtime_from_registry(
        &registry,
        agent_id,
        app_id,
        business_id,
    )
}

pub(crate) async fn migrate_legacy_agent_resources(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), AppError> {
    let registry = load_agent_registry();
    let now = chrono::Utc::now();
    for persona in registry.personas {
        insert_resource_if_absent(db, "persona", &persona.id, &persona.name, &persona, now).await?;
    }
    for plugin in registry.plugins {
        insert_resource_if_absent(db, "plugin", &plugin.id, &plugin.name, &plugin, now).await?;
    }
    for skill in registry.skills {
        insert_resource_if_absent(db, "skill", &skill.id, &skill.name, &skill, now).await?;
    }
    for knowledge_base in registry.knowledge_bases {
        insert_resource_if_absent(
            db,
            "knowledge_base",
            &knowledge_base.id,
            &knowledge_base.name,
            &knowledge_base,
            now,
        )
        .await?;
    }
    Ok(())
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

async fn insert_resource_if_absent<T: Serialize>(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
    name: &str,
    value: &T,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    if AgentResourceEntity::find_by_id(id).one(db).await?.is_none() {
        insert_resource(db, kind, id, name, value, now).await?;
    }
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
    for row in AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("persona"))
        .all(db)
        .await?
    {
        let persona: AgentPersonaDefinition = serde_json::from_value(row.configuration_json)
            .map_err(|error| AppError::BadRequest(error.to_string()))?;
        let used = match kind {
            "plugin" => persona.plugin_ids.iter().any(|value| value == id),
            "skill" => persona.skill_ids.iter().any(|value| value == id),
            "knowledge_base" => persona.knowledge_base_ids.iter().any(|value| value == id),
            _ => false,
        };
        if used {
            return Ok(true);
        }
    }
    for row in AgentConfigProfileEntity::find().all(db).await? {
        let profile: AgentConfigProfile = serde_json::from_value(row.configuration_json)
            .map_err(|error| AppError::BadRequest(error.to_string()))?;
        let used = match kind {
            "persona" => profile.persona_id == id,
            "plugin" => profile.plugin_ids.iter().any(|value| value == id),
            "skill" => profile.skill_ids.iter().any(|value| value == id),
            "knowledge_base" => profile.knowledge_base_ids.iter().any(|value| value == id),
            _ => false,
        };
        if used {
            return Ok(true);
        }
    }
    if kind == "persona" {
        return Ok(false);
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
        return Err(AppError::BadRequest(format!(
            "{kind} is still bound to a profile or agent"
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

pub(crate) async fn migrate_legacy_agent_registry(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), AppError> {
    if AgentModelProviderEntity::find().count(db).await? > 0
        || AgentConfigProfileEntity::find().count(db).await? > 0
        || AgentDefinitionEntity::find().count(db).await? > 0
    {
        return Ok(());
    }
    let registry = load_agent_registry();
    let now = chrono::Utc::now();
    for provider in registry.providers {
        let default_chat_model = provider.default_chat_model.clone();
        let provider_id = provider.id.clone();
        agent_model_provider_entity::ActiveModel {
            id: Set(provider.id),
            name: Set(provider.name),
            kind: Set(provider.kind),
            enabled: Set(provider.enabled),
            api_base_url: Set(provider.api_base_url),
            api_key: Set(provider.api_key),
            website_url: Set(provider.website_url),
            default_chat_model: Set(default_chat_model.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;
        if !default_chat_model.is_empty() {
            insert_provider_model(db, &provider_id, &default_chat_model, true).await?;
        }
    }
    for profile in registry.profiles {
        agent_config_profile_entity::ActiveModel {
            id: Set(profile.id.clone()),
            name: Set(profile.name.clone()),
            provider_id: Set(profile.provider_id.clone()),
            configuration_json: Set(serde_json::to_value(&profile)
                .map_err(|error| AppError::BadRequest(error.to_string()))?),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;
    }
    for agent in registry.agents {
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
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;
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
    api_base_url: String,
    api_key: Option<String>,
    #[serde(default)]
    website_url: String,
    #[serde(default)]
    default_chat_model: String,
    #[serde(default)]
    models: Vec<String>,
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
    persona_id: String,
    web_search_enabled: bool,
    #[serde(default)]
    allow_create_apps: bool,
    #[serde(default)]
    allow_create_forms: bool,
    #[serde(default)]
    allow_create_automations: bool,
    #[serde(default = "default_approval_mode")]
    approval_mode: String,
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
pub(crate) struct PersonaRequest {
    name: String,
    #[serde(default)]
    description: String,
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
    allowed_tools: Vec<String>,
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
                id: "get_application_business_context",
                name: "读取应用业务地图",
                description: "读取应用说明、表单、字段摘要、关联关系和明细父表关系。",
                category: "app",
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
                id: "get_form_schema",
                name: "读取表单 Schema",
                description: "读取表单草稿结构和字段。",
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
                id: "create_form_draft",
                name: "创建表单草稿",
                description: "创建空白表单草稿；还要求 Profile 开启创建表单能力。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "create_detail_form_draft",
                name: "生成明细表配置",
                description: "为父表的 subform 字段生成明细表，需用户确认且要求 Profile 允许创建表单。",
                category: "form",
                risk_level: "write",
            },
            PlatformToolResponse {
                id: "save_form_schema_draft",
                name: "保存表单草稿",
                description: "保存表单草稿结构；还要求 Profile 开启创建表单能力。",
                category: "form",
                risk_level: "write",
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
            PlatformToolResponse {
                id: "call_plugin_tool",
                name: "调用插件工具",
                description: "调用当前 Profile 绑定的受控 HTTP 插件。",
                category: "plugin",
                risk_level: "external",
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

pub(crate) async fn create_provider(
    State(state): State<AppState>,
    Json(payload): Json<ProviderRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ProviderResponse>>), AppError> {
    validate_provider(&payload)?;
    let provider = agent_model_provider_entity::ActiveModel {
        id: Set(format!("provider-{}", Uuid::new_v4().simple())),
        name: Set(payload.name.trim().to_string()),
        kind: Set(payload.kind.trim().to_string()),
        enabled: Set(payload.enabled),
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
    let mut active: agent_model_provider_entity::ActiveModel = provider.into();
    active.name = Set(payload.name.trim().to_string());
    active.kind = Set(payload.kind.trim().to_string());
    active.enabled = Set(payload.enabled);
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

pub(crate) async fn list_personas(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentPersonaDefinition>>>, AppError> {
    let rows = AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("persona"))
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent personas loaded",
        resources_of_kind(&rows, "persona")
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
    )))
}

pub(crate) async fn create_persona(
    State(state): State<AppState>,
    Json(payload): Json<PersonaRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentPersonaDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let item = AgentPersonaDefinition {
        id: format!("persona-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        system_prompt: payload.system_prompt.trim().to_string(),
        plugin_ids: payload.plugin_ids,
        skill_ids: payload.skill_ids,
        knowledge_base_ids: payload.knowledge_base_ids,
    };
    insert_resource(
        &state.db,
        "persona",
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
        Json(success_response("persona created", item)),
    ))
}

pub(crate) async fn update_persona(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PersonaRequest>,
) -> Result<Json<ApiResponse<AgentPersonaDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    ensure_resource_ids(&state.db, "plugin", &payload.plugin_ids).await?;
    ensure_resource_ids(&state.db, "skill", &payload.skill_ids).await?;
    ensure_resource_ids(&state.db, "knowledge_base", &payload.knowledge_base_ids).await?;
    let item = AgentPersonaDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        system_prompt: payload.system_prompt.trim().to_string(),
        plugin_ids: payload.plugin_ids,
        skill_ids: payload.skill_ids,
        knowledge_base_ids: payload.knowledge_base_ids,
    };
    save_resource(&state.db, "persona", &item.id, &item.name, &item).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("persona updated", item)))
}

pub(crate) async fn delete_persona(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    delete_resource(&state.db, "persona", &id).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "persona deleted",
        serde_json::json!({ "id": id }),
    )))
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
    ensure_resource_ids(
        &state.db,
        "persona",
        std::slice::from_ref(&payload.persona_id),
    )
    .await?;
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
    ensure_resource_ids(
        &state.db,
        "persona",
        std::slice::from_ref(&payload.persona_id),
    )
    .await?;
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
        allowed_tools: payload.allowed_tools,
        instructions: payload.instructions.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    ensure_skill_package(&mut item).map_err(AppError::Server)?;
    let instructions = item.instructions.clone();
    write_skill_markdown(&mut item, &instructions).map_err(AppError::Server)?;
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
        allowed_tools: Vec::new(),
        instructions: String::new(),
        requires_confirmation: false,
    };
    import_skill_package(&mut item, &bytes).map_err(AppError::BadRequest)?;
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
        allowed_tools: payload.allowed_tools,
        instructions: payload.instructions.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    let instructions = item.instructions.clone();
    write_skill_markdown(&mut item, &instructions).map_err(AppError::Server)?;
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
        || !matches!(
            payload.approval_mode.as_str(),
            "request_approval" | "approve_on_behalf" | "full_access"
        )
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
        persona_id: payload.persona_id,
        web_search_enabled: payload.web_search_enabled,
        allow_create_apps: payload.allow_create_apps,
        allow_create_forms: payload.allow_create_forms,
        allow_create_automations: payload.allow_create_automations,
        approval_mode: payload.approval_mode,
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
