use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::config::{
    AgentConfigProfile, AgentDefinition, AgentKnowledgeBaseDefinition, AgentModelProvider,
    AgentPersonaDefinition, AgentPluginDefinition, AgentRegistry, AgentSkillDefinition,
    load_agent_registry, save_agent_registry,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderResponse {
    id: String,
    name: String,
    kind: String,
    enabled: bool,
    api_base_url: String,
    api_key_configured: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderRequest {
    name: String,
    kind: String,
    enabled: bool,
    api_base_url: String,
    api_key: Option<String>,
}

#[derive(Deserialize)]
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
    context_max_turns: i32,
    context_discard_turns: usize,
    context_overflow_strategy: String,
    context_compression_prompt: String,
    context_keep_recent_ratio: f64,
    context_compression_provider_id: Option<String>,
    max_context_tokens: usize,
    plugin_ids: Vec<String>,
    skill_ids: Vec<String>,
    knowledge_base_ids: Vec<String>,
}

#[derive(Deserialize)]
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
    plugin_ids: Vec<String>,
    skill_ids: Vec<String>,
    knowledge_base_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginRequest {
    name: String,
    description: String,
    enabled: bool,
    version: String,
    entrypoint: String,
    requires_confirmation: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillRequest {
    name: String,
    description: String,
    enabled: bool,
    allowed_tools: Vec<String>,
    requires_confirmation: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeBaseRequest {
    name: String,
    description: String,
    enabled: bool,
    retrieval_mode: String,
    source_ids: Vec<String>,
}

pub(crate) async fn list_providers(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ProviderResponse>>>, AppError> {
    Ok(Json(success_response(
        "agent model providers loaded",
        load_agent_registry()
            .providers
            .iter()
            .map(ProviderResponse::from)
            .collect(),
    )))
}

pub(crate) async fn create_provider(
    State(_state): State<AppState>,
    Json(payload): Json<ProviderRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ProviderResponse>>), AppError> {
    validate_provider(&payload)?;
    let mut registry = load_agent_registry();
    let provider = AgentModelProvider {
        id: format!("provider-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        kind: payload.kind.trim().to_string(),
        enabled: payload.enabled,
        api_base_url: payload
            .api_base_url
            .trim()
            .trim_end_matches('/')
            .to_string(),
        api_key: payload.api_key.unwrap_or_default(),
    };
    registry.providers.push(provider.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "provider created",
            ProviderResponse::from(&provider),
        )),
    ))
}

pub(crate) async fn update_provider(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ProviderRequest>,
) -> Result<Json<ApiResponse<ProviderResponse>>, AppError> {
    validate_provider(&payload)?;
    let mut registry = load_agent_registry();
    let provider = registry
        .providers
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("model provider not found".to_string()))?;
    provider.name = payload.name.trim().to_string();
    provider.kind = payload.kind.trim().to_string();
    provider.enabled = payload.enabled;
    provider.api_base_url = payload
        .api_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    if let Some(api_key) = payload.api_key.filter(|value| !value.trim().is_empty()) {
        provider.api_key = api_key;
    }
    let response = ProviderResponse::from(&*provider);
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("provider updated", response)))
}

pub(crate) async fn delete_provider(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    if registry
        .profiles
        .iter()
        .any(|profile| profile.provider_id == id)
    {
        return Err(AppError::BadRequest(
            "provider is used by a configuration profile".to_string(),
        ));
    }
    let before = registry.providers.len();
    registry.providers.retain(|item| item.id != id);
    if registry.providers.len() == before {
        return Err(AppError::NotFound("model provider not found".to_string()));
    }
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "provider deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_profiles(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentConfigProfile>>>, AppError> {
    Ok(Json(success_response(
        "agent profiles loaded",
        load_agent_registry().profiles,
    )))
}

pub(crate) async fn list_personas(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentPersonaDefinition>>>, AppError> {
    Ok(Json(success_response(
        "agent personas loaded",
        load_agent_registry().personas,
    )))
}

pub(crate) async fn create_profile(
    State(_state): State<AppState>,
    Json(payload): Json<ProfileRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentConfigProfile>>), AppError> {
    let mut registry = load_agent_registry();
    validate_profile(&registry, &payload)?;
    let profile = profile_from_request(format!("profile-{}", Uuid::new_v4().simple()), payload);
    registry.profiles.push(profile.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response("profile created", profile)),
    ))
}

pub(crate) async fn update_profile(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ProfileRequest>,
) -> Result<Json<ApiResponse<AgentConfigProfile>>, AppError> {
    let mut registry = load_agent_registry();
    validate_profile(&registry, &payload)?;
    let index = registry
        .profiles
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("configuration profile not found".to_string()))?;
    let profile = profile_from_request(id, payload);
    registry.profiles[index] = profile.clone();
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("profile updated", profile)))
}

pub(crate) async fn delete_profile(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    if registry.agents.iter().any(|agent| agent.profile_id == id) {
        return Err(AppError::BadRequest(
            "profile is used by an agent".to_string(),
        ));
    }
    let before = registry.profiles.len();
    registry.profiles.retain(|item| item.id != id);
    if registry.profiles.len() == before {
        return Err(AppError::NotFound(
            "configuration profile not found".to_string(),
        ));
    }
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "profile deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_agents(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentDefinition>>>, AppError> {
    Ok(Json(success_response(
        "agents loaded",
        load_agent_registry().agents,
    )))
}

pub(crate) async fn create_agent(
    State(_state): State<AppState>,
    Json(payload): Json<AgentRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentDefinition>>), AppError> {
    let mut registry = load_agent_registry();
    validate_agent(&registry, &payload)?;
    let agent = agent_from_request(format!("agent-{}", Uuid::new_v4().simple()), payload);
    if agent.is_default {
        registry
            .agents
            .iter_mut()
            .for_each(|item| item.is_default = false);
    }
    registry.agents.push(agent.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response("agent created", agent)),
    ))
}

pub(crate) async fn update_agent(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AgentRequest>,
) -> Result<Json<ApiResponse<AgentDefinition>>, AppError> {
    let mut registry = load_agent_registry();
    validate_agent(&registry, &payload)?;
    let index = registry
        .agents
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("agent not found".to_string()))?;
    let agent = agent_from_request(id, payload);
    if agent.is_default {
        registry
            .agents
            .iter_mut()
            .for_each(|item| item.is_default = false);
    }
    registry.agents[index] = agent.clone();
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("agent updated", agent)))
}

pub(crate) async fn delete_agent(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    let before = registry.agents.len();
    registry.agents.retain(|item| item.id != id);
    if registry.agents.len() == before {
        return Err(AppError::NotFound("agent not found".to_string()));
    }
    if !registry.agents.iter().any(|item| item.is_default) {
        if let Some(first) = registry.agents.first_mut() {
            first.is_default = true;
        }
    }
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "agent deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_plugins(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentPluginDefinition>>>, AppError> {
    Ok(Json(success_response(
        "agent plugins loaded",
        load_agent_registry().plugins,
    )))
}

pub(crate) async fn create_plugin(
    State(_state): State<AppState>,
    Json(payload): Json<PluginRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentPluginDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let item = AgentPluginDefinition {
        id: format!("plugin-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    registry.plugins.push(item.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response("plugin created", item)),
    ))
}

pub(crate) async fn update_plugin(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PluginRequest>,
) -> Result<Json<ApiResponse<AgentPluginDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let index = registry
        .plugins
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("plugin not found".to_string()))?;
    let item = AgentPluginDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    registry.plugins[index] = item.clone();
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("plugin updated", item)))
}

pub(crate) async fn delete_plugin(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    registry.plugins.retain(|item| item.id != id);
    registry
        .agents
        .iter_mut()
        .for_each(|agent| agent.plugin_ids.retain(|item| item != &id));
    registry
        .profiles
        .iter_mut()
        .for_each(|profile| profile.plugin_ids.retain(|item| item != &id));
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "plugin deleted",
        serde_json::json!({"id": id}),
    )))
}

pub(crate) async fn list_skills(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentSkillDefinition>>>, AppError> {
    Ok(Json(success_response(
        "agent skills loaded",
        load_agent_registry().skills,
    )))
}
pub(crate) async fn create_skill(
    State(_state): State<AppState>,
    Json(payload): Json<SkillRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentSkillDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let item = AgentSkillDefinition {
        id: format!("skill-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        allowed_tools: payload.allowed_tools,
        requires_confirmation: payload.requires_confirmation,
    };
    registry.skills.push(item.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response("skill created", item)),
    ))
}
pub(crate) async fn update_skill(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SkillRequest>,
) -> Result<Json<ApiResponse<AgentSkillDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let index = registry
        .skills
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("skill not found".to_string()))?;
    let item = AgentSkillDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        allowed_tools: payload.allowed_tools,
        requires_confirmation: payload.requires_confirmation,
    };
    registry.skills[index] = item.clone();
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("skill updated", item)))
}
pub(crate) async fn delete_skill(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    registry.skills.retain(|item| item.id != id);
    registry
        .agents
        .iter_mut()
        .for_each(|agent| agent.skill_ids.retain(|item| item != &id));
    registry
        .profiles
        .iter_mut()
        .for_each(|profile| profile.skill_ids.retain(|item| item != &id));
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response(
        "skill deleted",
        serde_json::json!({"id": id}),
    )))
}

pub(crate) async fn list_knowledge_bases(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentKnowledgeBaseDefinition>>>, AppError> {
    Ok(Json(success_response(
        "knowledge bases loaded",
        load_agent_registry().knowledge_bases,
    )))
}
pub(crate) async fn create_knowledge_base(
    State(_state): State<AppState>,
    Json(payload): Json<KnowledgeBaseRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentKnowledgeBaseDefinition>>), AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let item = AgentKnowledgeBaseDefinition {
        id: format!("knowledge-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        retrieval_mode: payload.retrieval_mode,
        source_ids: payload.source_ids,
    };
    registry.knowledge_bases.push(item.clone());
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok((
        StatusCode::CREATED,
        Json(success_response("knowledge base created", item)),
    ))
}
pub(crate) async fn update_knowledge_base(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<KnowledgeBaseRequest>,
) -> Result<Json<ApiResponse<AgentKnowledgeBaseDefinition>>, AppError> {
    validate_resource_name(&payload.name)?;
    let mut registry = load_agent_registry();
    let index = registry
        .knowledge_bases
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("knowledge base not found".to_string()))?;
    let item = AgentKnowledgeBaseDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        retrieval_mode: payload.retrieval_mode,
        source_ids: payload.source_ids,
    };
    registry.knowledge_bases[index] = item.clone();
    save_agent_registry(&registry).map_err(AppError::Server)?;
    Ok(Json(success_response("knowledge base updated", item)))
}
pub(crate) async fn delete_knowledge_base(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let mut registry = load_agent_registry();
    registry.knowledge_bases.retain(|item| item.id != id);
    registry
        .agents
        .iter_mut()
        .for_each(|agent| agent.knowledge_base_ids.retain(|item| item != &id));
    registry
        .profiles
        .iter_mut()
        .for_each(|profile| profile.knowledge_base_ids.retain(|item| item != &id));
    save_agent_registry(&registry).map_err(AppError::Server)?;
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

fn validate_provider(payload: &ProviderRequest) -> Result<(), AppError> {
    if payload.name.trim().is_empty() || payload.api_base_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "provider name and API base URL are required".to_string(),
        ));
    }
    Ok(())
}

fn validate_profile(registry: &AgentRegistry, payload: &ProfileRequest) -> Result<(), AppError> {
    if !registry
        .providers
        .iter()
        .any(|item| item.id == payload.provider_id)
    {
        return Err(AppError::BadRequest("model provider not found".to_string()));
    }
    if payload.name.trim().is_empty()
        || payload.chat_model.trim().is_empty()
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

fn validate_agent(registry: &AgentRegistry, payload: &AgentRequest) -> Result<(), AppError> {
    if !registry
        .profiles
        .iter()
        .any(|item| item.id == payload.profile_id)
    {
        return Err(AppError::BadRequest(
            "configuration profile not found".to_string(),
        ));
    }
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
        context_max_turns: payload.context_max_turns,
        context_discard_turns: payload.context_discard_turns,
        context_overflow_strategy: payload.context_overflow_strategy,
        context_compression_prompt: payload.context_compression_prompt,
        context_keep_recent_ratio: payload.context_keep_recent_ratio,
        context_compression_provider_id: payload
            .context_compression_provider_id
            .filter(|value| !value.trim().is_empty()),
        max_context_tokens: payload.max_context_tokens,
        plugin_ids: payload.plugin_ids,
        skill_ids: payload.skill_ids,
        knowledge_base_ids: payload.knowledge_base_ids,
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
        plugin_ids: payload.plugin_ids,
        skill_ids: payload.skill_ids,
        knowledge_base_ids: payload.knowledge_base_ids,
    }
}

impl From<&AgentModelProvider> for ProviderResponse {
    fn from(value: &AgentModelProvider) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            kind: value.kind.clone(),
            enabled: value.enabled,
            api_base_url: value.api_base_url.clone(),
            api_key_configured: !value.api_key.is_empty(),
        }
    }
}
