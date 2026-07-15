use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct DatabaseSettings {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    pub enabled: bool,
    pub provider: String,
    pub api_base_url: String,
    pub api_key: String,
    pub chat_model: String,
    pub embedding_model: String,
    pub temperature: f64,
    pub max_steps: usize,
    pub system_prompt: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistry {
    #[serde(default)]
    pub providers: Vec<AgentModelProvider>,
    #[serde(default)]
    pub profiles: Vec<AgentConfigProfile>,
    #[serde(default)]
    pub agents: Vec<AgentDefinition>,
    #[serde(default)]
    pub plugins: Vec<AgentPluginDefinition>,
    #[serde(default)]
    pub skills: Vec<AgentSkillDefinition>,
    #[serde(default)]
    pub knowledge_bases: Vec<AgentKnowledgeBaseDefinition>,
    #[serde(default = "default_personas")]
    pub personas: Vec<AgentPersonaDefinition>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPersonaDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPluginDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub version: String,
    #[serde(default)]
    pub entrypoint: String,
    pub requires_confirmation: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    pub requires_confirmation: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentKnowledgeBaseDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub retrieval_mode: String,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelProvider {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub api_base_url: String,
    pub api_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub chat_model: String,
    pub embedding_model: String,
    pub temperature: f64,
    pub max_steps: usize,
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,
    #[serde(default)]
    pub image_caption_model: String,
    #[serde(default = "default_persona_id")]
    pub persona_id: String,
    #[serde(default)]
    pub web_search_enabled: bool,
    #[serde(default = "default_context_max_turns")]
    pub context_max_turns: i32,
    #[serde(default = "default_context_discard_turns")]
    pub context_discard_turns: usize,
    #[serde(default = "default_context_overflow_strategy")]
    pub context_overflow_strategy: String,
    #[serde(default = "default_context_compression_prompt")]
    pub context_compression_prompt: String,
    #[serde(default = "default_context_keep_recent_ratio")]
    pub context_keep_recent_ratio: f64,
    #[serde(default)]
    pub context_compression_provider_id: Option<String>,
    #[serde(default = "default_max_context_tokens")]
    pub max_context_tokens: usize,
    #[serde(default)]
    pub plugin_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub knowledge_base_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub is_default: bool,
    pub scope_type: String,
    #[serde(default)]
    pub scope_ref_id: Option<String>,
    pub profile_id: String,
    pub system_prompt: String,
    #[serde(default)]
    pub plugin_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub knowledge_base_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySourceSettings {
    pub active_provider: String,
    pub local_admin_login_enabled: bool,
    pub dingtalk: DingTalkSettings,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkSettings {
    #[serde(default)]
    pub app_id: String,
    pub agent_id: String,
    pub client_id: String,
    pub client_secret: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub access_token_expires_at: Option<String>,
    pub sync_enabled: bool,
    pub sync_interval_minutes: u32,
    pub include_child_departments: bool,
    pub disable_departed_users: bool,
    pub allow_jit_provisioning: bool,
}

#[derive(Deserialize, Serialize)]
struct StoredSettings {
    database: DatabaseSettings,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("APP_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8787),
            database_url: load_database_settings()
                .map(|settings| settings.to_database_url())
                .or_else(|| std::env::var("DATABASE_URL").ok())
                .unwrap_or_else(|| "postgres://postgres@localhost:5432/yaya_low_code".to_string()),
        }
    }
}

impl DatabaseSettings {
    pub fn validate(&self) -> Result<(), String> {
        for (label, value) in [
            ("database host", self.host.trim()),
            ("database name", self.database.trim()),
            ("database username", self.username.trim()),
        ] {
            if value.is_empty() {
                return Err(format!("{label} is required"));
            }
        }
        if self.port == 0 {
            return Err("database port is required".to_string());
        }
        Ok(())
    }

    pub fn to_database_url(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            percent_encode(&self.username),
            percent_encode(&self.password),
            self.host.trim(),
            self.port,
            percent_encode(&self.database),
        )
    }
}

pub fn load_database_settings() -> Option<DatabaseSettings> {
    let content = fs::read_to_string(settings_path()).ok()?;
    serde_json::from_str::<StoredSettings>(&content)
        .ok()
        .map(|settings| settings.database)
}

pub fn save_database_settings(settings: &DatabaseSettings) -> Result<(), std::io::Error> {
    let path = settings_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(&StoredSettings {
        database: settings.clone(),
    })
    .expect("database settings are serializable");

    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn load_agent_settings() -> Option<AgentSettings> {
    let content = fs::read_to_string(agent_settings_path()).ok()?;
    serde_json::from_str::<AgentSettings>(&content).ok()
}

pub fn save_agent_settings(settings: &AgentSettings) -> Result<(), std::io::Error> {
    let path = agent_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(settings).expect("agent settings are serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn load_agent_registry() -> AgentRegistry {
    fs::read_to_string(agent_registry_path())
        .ok()
        .and_then(|content| serde_json::from_str::<AgentRegistry>(&content).ok())
        .filter(|registry| !registry.agents.is_empty())
        .unwrap_or_else(default_agent_registry)
}

pub fn save_agent_registry(registry: &AgentRegistry) -> Result<(), std::io::Error> {
    let path = agent_registry_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(registry).expect("agent registry is serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn resolve_agent_settings(agent_id: Option<&str>) -> Result<(String, AgentSettings), String> {
    resolve_agent_settings_for_scope(agent_id, None, None)
}

pub fn resolve_agent_settings_for_scope(
    agent_id: Option<&str>,
    app_id: Option<&str>,
    business_id: Option<&str>,
) -> Result<(String, AgentSettings), String> {
    let registry = load_agent_registry();
    let agent = agent_id
        .and_then(|id| registry.agents.iter().find(|agent| agent.id == id))
        .or_else(|| {
            app_id.and_then(|scope| {
                registry.agents.iter().find(|agent| {
                    agent.enabled
                        && agent.scope_type == "application"
                        && agent.scope_ref_id.as_deref() == Some(scope)
                })
            })
        })
        .or_else(|| {
            business_id.and_then(|scope| {
                registry.agents.iter().find(|agent| {
                    agent.enabled
                        && agent.scope_type == "business"
                        && agent.scope_ref_id.as_deref() == Some(scope)
                })
            })
        })
        .or_else(|| {
            registry
                .agents
                .iter()
                .find(|agent| agent.enabled && agent.scope_type == "platform" && agent.is_default)
        })
        .or_else(|| {
            registry
                .agents
                .iter()
                .find(|agent| agent.enabled && agent.scope_type == "platform")
        })
        .or_else(|| registry.agents.iter().find(|agent| agent.enabled))
        .ok_or_else(|| "no agent is configured".to_string())?;
    let profile = registry
        .profiles
        .iter()
        .find(|profile| profile.id == agent.profile_id)
        .ok_or_else(|| "agent configuration profile not found".to_string())?;
    let provider = registry
        .providers
        .iter()
        .find(|provider| provider.id == profile.provider_id)
        .ok_or_else(|| "agent model provider not found".to_string())?;
    let persona = registry
        .personas
        .iter()
        .find(|persona| persona.id == profile.persona_id);
    let persona_prompt = persona
        .map(|persona| persona.system_prompt.as_str())
        .unwrap_or("");

    Ok((
        agent.id.clone(),
        AgentSettings {
            enabled: agent.enabled && provider.enabled,
            provider: provider.kind.clone(),
            api_base_url: provider.api_base_url.clone(),
            api_key: provider.api_key.clone(),
            chat_model: profile.chat_model.clone(),
            embedding_model: profile.embedding_model.clone(),
            temperature: profile.temperature,
            max_steps: profile.max_steps,
            system_prompt: format!(
                "{}\n\nAgent capability bindings:\n- plugins: {}\n- skills: {}\n- knowledge bases: {}",
                if agent.system_prompt.trim().is_empty() {
                    persona_prompt
                } else {
                    agent.system_prompt.as_str()
                },
                profile.plugin_ids.join(", "),
                profile.skill_ids.join(", "),
                profile.knowledge_base_ids.join(", "),
            ),
        },
    ))
}

fn default_agent_registry() -> AgentRegistry {
    let legacy = load_agent_settings().unwrap_or(AgentSettings {
        enabled: false,
        provider: "openai-compatible".to_string(),
        api_base_url: "https://api.openai.com/v1".to_string(),
        api_key: String::new(),
        chat_model: "gpt-4.1-mini".to_string(),
        embedding_model: "text-embedding-3-small".to_string(),
        temperature: 0.2,
        max_steps: 8,
        system_prompt: "你是 YaYa 低代码平台助手。".to_string(),
    });
    AgentRegistry {
        providers: vec![AgentModelProvider {
            id: "provider-default".to_string(),
            name: "默认模型提供商".to_string(),
            kind: legacy.provider,
            enabled: legacy.enabled,
            api_base_url: legacy.api_base_url,
            api_key: legacy.api_key,
        }],
        profiles: vec![AgentConfigProfile {
            id: "profile-default".to_string(),
            name: "默认配置".to_string(),
            provider_id: "provider-default".to_string(),
            chat_model: legacy.chat_model,
            embedding_model: legacy.embedding_model,
            temperature: legacy.temperature,
            max_steps: legacy.max_steps,
            max_retries: default_max_retries(),
            image_caption_model: String::new(),
            persona_id: default_persona_id(),
            web_search_enabled: false,
            context_max_turns: default_context_max_turns(),
            context_discard_turns: default_context_discard_turns(),
            context_overflow_strategy: default_context_overflow_strategy(),
            context_compression_prompt: default_context_compression_prompt(),
            context_keep_recent_ratio: default_context_keep_recent_ratio(),
            context_compression_provider_id: None,
            max_context_tokens: default_max_context_tokens(),
            plugin_ids: Vec::new(),
            skill_ids: Vec::new(),
            knowledge_base_ids: Vec::new(),
        }],
        agents: vec![AgentDefinition {
            id: "agent-default".to_string(),
            name: "YaYa Agent".to_string(),
            description: "平台默认低代码助手".to_string(),
            enabled: legacy.enabled,
            is_default: true,
            scope_type: "platform".to_string(),
            scope_ref_id: None,
            profile_id: "profile-default".to_string(),
            system_prompt: legacy.system_prompt,
            plugin_ids: Vec::new(),
            skill_ids: Vec::new(),
            knowledge_base_ids: Vec::new(),
        }],
        plugins: Vec::new(),
        skills: Vec::new(),
        knowledge_bases: Vec::new(),
        personas: default_personas(),
    }
}

fn default_max_retries() -> usize {
    3
}
fn default_persona_id() -> String {
    "persona-default".to_string()
}
fn default_context_max_turns() -> i32 {
    50
}
fn default_context_discard_turns() -> usize {
    10
}
fn default_context_overflow_strategy() -> String {
    "llm_compress".to_string()
}
fn default_context_compression_prompt() -> String {
    "Based on our full conversation history, produce a concise summary of key takeaways and/or project progress.\nThe primary goal of this summary is to enable seamless continuation of the work that follows.\n1. Systematically cover all core topics discussed and the final conclusion/outcome for each; clearly highlight the latest primary focus.\n2. If any tools were used, summarize tool usage and extract the most valuable insights from tool outputs.\n3. If any materials were read that may be helpful for subsequent work, list them with their scope and path.\n4. If there was an initial user goal, state it first and describe the current progress/status.\n5. Write the summary in the user's language.".to_string()
}
fn default_context_keep_recent_ratio() -> f64 {
    0.15
}
fn default_max_context_tokens() -> usize {
    128_000
}
fn default_personas() -> Vec<AgentPersonaDefinition> {
    vec![
        AgentPersonaDefinition {
            id: "persona-default".to_string(),
            name: "默认人格".to_string(),
            description: "通用低代码平台助手".to_string(),
            system_prompt: "你是 YaYa 低代码平台助手。帮助用户设计表单、编排自动化和分析业务配置。"
                .to_string(),
        },
        AgentPersonaDefinition {
            id: "persona-business".to_string(),
            name: "业务分析师".to_string(),
            description: "聚焦业务流程和需求分析".to_string(),
            system_prompt: "你是一名业务分析师，擅长梳理业务流程、数据关系与系统需求。".to_string(),
        },
        AgentPersonaDefinition {
            id: "persona-builder".to_string(),
            name: "低代码实施顾问".to_string(),
            description: "聚焦应用搭建与自动化实施".to_string(),
            system_prompt: "你是一名低代码实施顾问，擅长表单设计、自动化编排和应用治理。"
                .to_string(),
        },
    ]
}

pub fn load_identity_source_settings() -> Option<IdentitySourceSettings> {
    let content = fs::read_to_string(identity_settings_path()).ok()?;
    serde_json::from_str::<IdentitySourceSettings>(&content).ok()
}

pub fn save_identity_source_settings(
    settings: &IdentitySourceSettings,
) -> Result<(), std::io::Error> {
    let path = identity_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(settings).expect("identity settings are serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

impl AgentSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.api_base_url.trim().is_empty() {
            return Err("agent api base url is required".to_string());
        }
        if self.chat_model.trim().is_empty() {
            return Err("agent chat model is required".to_string());
        }
        if self.enabled && self.api_key.trim().is_empty() {
            return Err("agent api key is required when enabled".to_string());
        }
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err("agent temperature must be between 0 and 2".to_string());
        }
        if self.max_steps == 0 || self.max_steps > 30 {
            return Err("agent max steps must be between 1 and 30".to_string());
        }
        Ok(())
    }
}

impl IdentitySourceSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.active_provider.as_str(), "local" | "dingtalk") {
            return Err("active identity provider must be local or dingtalk".to_string());
        }
        if self.dingtalk.sync_interval_minutes == 0 || self.dingtalk.sync_interval_minutes > 10_080
        {
            return Err("dingtalk sync interval must be between 1 and 10080 minutes".to_string());
        }
        if self.active_provider == "dingtalk" {
            for (label, value) in [
                ("App ID", self.dingtalk.app_id.trim()),
                ("AgentId", self.dingtalk.agent_id.trim()),
                ("Client ID", self.dingtalk.client_id.trim()),
                ("Client Secret", self.dingtalk.client_secret.trim()),
            ] {
                if value.is_empty() {
                    return Err(format!("dingtalk {label} is required when enabled"));
                }
            }
        }
        Ok(())
    }
}

fn settings_path() -> PathBuf {
    std::env::var_os("YAYA_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-lowcode-settings.json"))
}

fn agent_settings_path() -> PathBuf {
    std::env::var_os("YAYA_AGENT_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-agent-settings.json"))
}

fn agent_registry_path() -> PathBuf {
    std::env::var_os("YAYA_AGENT_REGISTRY_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-agent-registry.json"))
}

fn identity_settings_path() -> PathBuf {
    std::env::var_os("YAYA_IDENTITY_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-identity-settings.json"))
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}
