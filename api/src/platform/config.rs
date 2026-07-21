use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
pub struct DatabaseSettings {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
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

/// The concrete configuration selected for one Agent run.
///
/// A Robot selects a profile. The profile owns its model provider and the
/// resources available to the run; keeping that relationship here prevents
/// the runner from re-reading loosely related registry entries.
#[derive(Clone)]
pub struct ResolvedAgentRuntime {
    pub agent_id: String,
    pub profile_id: String,
    pub settings: AgentSettings,
    pub plugins: Vec<AgentPluginDefinition>,
    pub skills: Vec<AgentSkillDefinition>,
    pub knowledge_bases: Vec<AgentKnowledgeBaseDefinition>,
    pub allow_create_forms: bool,
    pub allowed_tools: HashSet<String>,
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

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentPersonaDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
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
    #[serde(default)]
    pub manifest_json: String,
    pub requires_confirmation: bool,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub tools: Vec<PluginManifestTool>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestTool {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub requires_confirmation: bool,
}

pub fn parse_plugin_manifest(manifest_json: &str) -> Result<PluginManifest, String> {
    if manifest_json.trim().is_empty() || manifest_json.trim() == "{}" {
        return Ok(PluginManifest::default());
    }
    let manifest = serde_json::from_str::<PluginManifest>(manifest_json)
        .map_err(|error| format!("plugin manifest must be valid JSON: {error}"))?;
    if manifest.endpoint.trim().is_empty() {
        return Err("plugin manifest endpoint is required when tools are declared".to_string());
    }
    let mut names = std::collections::HashSet::new();
    for tool in &manifest.tools {
        if tool.name.trim().is_empty()
            || !tool.name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
            || tool.description.trim().is_empty()
            || !names.insert(tool.name.as_str())
        {
            return Err("plugin manifest contains an invalid or duplicate tool".to_string());
        }
    }
    Ok(manifest)
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub package_name: String,
    #[serde(default = "default_skill_source")]
    pub source: String,
    #[serde(default = "default_skill_version")]
    pub version: String,
    #[serde(default)]
    pub package_path: String,
    #[serde(default)]
    pub is_system: bool,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub instructions: String,
    pub requires_confirmation: bool,
}

fn default_skill_source() -> String {
    "local".to_string()
}

fn default_skill_version() -> String {
    "1.0.0".to_string()
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentKnowledgeBaseDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub retrieval_mode: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelProvider {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub api_base_url: String,
    pub api_key: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
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
    #[serde(default)]
    pub allow_create_apps: bool,
    #[serde(default)]
    pub allow_create_forms: bool,
    #[serde(default)]
    pub allow_create_automations: bool,
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

#[derive(Clone, Deserialize, Serialize, ToSchema)]
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

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySourceSettings {
    pub dingtalk: DingTalkSettings,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
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

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RbacPermissionSettings {
    #[serde(default)]
    pub grants: HashMap<String, Vec<String>>,
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
    let mut registry = fs::read_to_string(agent_registry_path())
        .ok()
        .and_then(|content| serde_json::from_str::<AgentRegistry>(&content).ok())
        .filter(|registry| !registry.agents.is_empty())
        .unwrap_or_else(default_agent_registry);
    ensure_default_agent_resources_in_registry(&mut registry);
    registry
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

pub fn ensure_default_agent_resources() -> Result<(), std::io::Error> {
    let path = agent_registry_path();
    let mut registry = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<AgentRegistry>(&content).ok())
        .filter(|registry| !registry.agents.is_empty())
        .unwrap_or_else(default_agent_registry);
    let resources_changed = ensure_default_agent_resources_in_registry(&mut registry);
    let packages_changed = ensure_skill_packages_in_registry(&mut registry)?;
    if resources_changed || packages_changed || !path.exists() {
        save_agent_registry(&registry)?;
    }
    Ok(())
}

pub fn ensure_skill_package(skill: &mut AgentSkillDefinition) -> Result<bool, std::io::Error> {
    let mut changed = false;
    if skill.package_name.trim().is_empty() {
        skill.package_name = skill_package_name(&skill.id);
        changed = true;
    }
    if skill.source.trim().is_empty() {
        skill.source = default_skill_source();
        changed = true;
    }
    if skill.version.trim().is_empty() {
        skill.version = default_skill_version();
        changed = true;
    }

    let root = skill_packages_root();
    let package_dir = root.join(&skill.package_name);
    fs::create_dir_all(&package_dir)?;
    let package_path = format!("skills/{}/SKILL.md", skill.package_name);
    if skill.package_path != package_path {
        skill.package_path = package_path;
        changed = true;
    }
    let markdown_path = package_dir.join("SKILL.md");
    if !markdown_path.exists() {
        fs::write(markdown_path, skill.instructions.as_bytes())?;
        changed = true;
    }
    Ok(changed)
}

pub fn read_skill_markdown(skill: &AgentSkillDefinition) -> Result<String, std::io::Error> {
    fs::read_to_string(skill_markdown_path(skill))
}

pub fn write_skill_markdown(
    skill: &mut AgentSkillDefinition,
    content: &str,
) -> Result<(), std::io::Error> {
    ensure_skill_package(skill)?;
    fs::write(skill_markdown_path(skill), content.as_bytes())?;
    skill.instructions = content.to_string();
    Ok(())
}

fn ensure_skill_packages_in_registry(registry: &mut AgentRegistry) -> Result<bool, std::io::Error> {
    let mut changed = false;
    for skill in &mut registry.skills {
        changed |= ensure_skill_package(skill)?;
    }
    Ok(changed)
}

fn skill_markdown_path(skill: &AgentSkillDefinition) -> PathBuf {
    skill_packages_root()
        .join(&skill.package_name)
        .join("SKILL.md")
}

fn skill_package_name(value: &str) -> String {
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
    normalized
        .trim_matches('-')
        .to_string()
        .chars()
        .take(80)
        .collect::<String>()
}

fn skill_packages_root() -> PathBuf {
    std::env::var_os("YAYA_SKILLS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-skills"))
}

fn ensure_default_agent_resources_in_registry(registry: &mut AgentRegistry) -> bool {
    let mut changed = false;
    for skill in default_agent_skills() {
        if let Some(existing) = registry.skills.iter_mut().find(|item| item.id == skill.id) {
            if skill.is_system {
                if existing.package_name.trim().is_empty() {
                    existing.package_name = skill.package_name.clone();
                    changed = true;
                }
                if existing.source == "local" {
                    existing.source = skill.source.clone();
                    changed = true;
                }
                if !existing.is_system {
                    existing.is_system = true;
                    changed = true;
                }
            }
            // Built-in Skills may gain a newly implemented platform tool after an
            // installation already has its resource registry. Only fill missing
            // defaults so custom instructions and explicit settings remain intact.
            for tool in skill.allowed_tools {
                if !existing
                    .allowed_tools
                    .iter()
                    .any(|allowed| allowed == &tool)
                {
                    existing.allowed_tools.push(tool);
                    changed = true;
                }
            }
        } else {
            registry.skills.push(skill);
            changed = true;
        }
    }
    for knowledge_base in default_agent_knowledge_bases() {
        if !registry
            .knowledge_bases
            .iter()
            .any(|item| item.id == knowledge_base.id)
        {
            registry.knowledge_bases.push(knowledge_base);
            changed = true;
        }
    }
    for plugin in default_agent_plugins() {
        if !registry.plugins.iter().any(|item| item.id == plugin.id) {
            registry.plugins.push(plugin);
            changed = true;
        }
    }
    if let Some(profile) = registry
        .profiles
        .iter_mut()
        .find(|profile| profile.id == "profile-default")
    {
        for id in [
            "skill-form-designer",
            "skill-form-draft-assistant",
            "skill-automation-reviewer",
        ] {
            if !profile.skill_ids.iter().any(|item| item == id) {
                profile.skill_ids.push(id.to_string());
                changed = true;
            }
        }
        for id in ["knowledge-form-components", "knowledge-automation-review"] {
            if !profile.knowledge_base_ids.iter().any(|item| item == id) {
                profile.knowledge_base_ids.push(id.to_string());
                changed = true;
            }
        }
    }
    changed
}

fn default_agent_skills() -> Vec<AgentSkillDefinition> {
    vec![
        AgentSkillDefinition {
            id: "skill-form-designer".to_string(),
            name: "表单设计顾问".to_string(),
            package_name: "yaya-form-designer".to_string(),
            source: "system".to_string(),
            version: "1.0.0".to_string(),
            package_path: String::new(),
            is_system: true,
            description: "根据业务目标设计可维护的 YaYa 表单结构。".to_string(),
            enabled: true,
            allowed_tools: vec!["list_apps".to_string(), "list_forms".to_string(), "get_form_schema".to_string(), "create_form_draft".to_string(), "save_form_schema_draft".to_string()],
            instructions: "分析或设计表单时，先确认业务对象、提交人、关键字段、选项来源、必填规则和审批/自动化触发点。优先复用已有表单的字段命名和结构。给出字段清单时包含字段标签、组件类型、字段 ID 建议、是否必填、选项或约束。仅在配置文件已启用允许创建表单时创建空白草稿；不要声称已经发布表单。".to_string(),
            requires_confirmation: false,
        },
        AgentSkillDefinition {
            id: "skill-form-draft-assistant".to_string(),
            name: "表单草稿填写助手".to_string(),
            package_name: "yaya-form-draft-assistant".to_string(),
            source: "system".to_string(),
            version: "1.0.0".to_string(),
            package_path: String::new(),
            is_system: true,
            description: "在运行时协助填写可自动填写的字段。".to_string(),
            enabled: true,
            allowed_tools: vec!["get_form_schema".to_string()],
            instructions: "协助填写草稿时，只填写当前页面明确允许自动填写且值可从用户消息推导的字段。单选、多选和成员/部门字段必须使用可用选项值；日期使用 YYYY-MM-DD；附件、图片、子表单、按钮和未知组件必须要求用户操作。永远不要代替用户提交表单。".to_string(),
            requires_confirmation: false,
        },
        AgentSkillDefinition {
            id: "skill-automation-reviewer".to_string(),
            name: "自动化流程审查".to_string(),
            package_name: "yaya-automation-reviewer".to_string(),
            source: "system".to_string(),
            version: "1.0.0".to_string(),
            package_path: String::new(),
            is_system: true,
            description: "分析触发器、节点与连线，识别流程风险。".to_string(),
            enabled: true,
            allowed_tools: vec!["list_automations".to_string(), "get_automation_graph".to_string()],
            instructions: "审查自动化时，先读取实际流程图。检查触发条件是否过宽、字段引用是否存在、失败重试是否可能重复执行、节点是否存在不可达分支，以及外部请求是否可能暴露敏感数据。只提出修改建议，不执行或发布自动化。".to_string(),
            requires_confirmation: false,
        },
    ]
}

fn default_agent_knowledge_bases() -> Vec<AgentKnowledgeBaseDefinition> {
    vec![
        AgentKnowledgeBaseDefinition {
            id: "knowledge-form-components".to_string(),
            name: "YaYa 表单组件规范".to_string(),
            description: "当前表单运行时组件、值类型和 Agent 填写边界。".to_string(),
            enabled: true,
            retrieval_mode: "keyword".to_string(),
            content: "YaYa 表单组件：singleLineText 为单行字符串；multiLineText 为多行字符串；number 为数值，需遵守最小值、最大值和步长；radio 与 select 为单选，值必须在选项中；checkbox 与 multiSelect 为字符串数组，所有值必须在选项中；date 为 YYYY-MM-DD；dateRange 为两个 YYYY-MM-DD 字符串组成的数组；member 和 department 的值必须来自可用选项。groupContainer、description、link 不产生可填写业务值。attachment、imageUpload、subform、button 需要用户交互，Agent 不能自动填写。未知组件一律禁止自动填写。字段设计优先使用稳定、语义明确的字段 ID，并将选项值与显示标签分离。".to_string(),
            source_ids: vec!["web/app/lib/form-component-agent-capabilities.ts".to_string()],
        },
        AgentKnowledgeBaseDefinition {
            id: "knowledge-automation-review".to_string(),
            name: "YaYa 自动化审查规范".to_string(),
            description: "自动化流程分析和变更建议的安全边界。".to_string(),
            enabled: true,
            retrieval_mode: "keyword".to_string(),
            content: "YaYa 自动化由触发配置、节点和连线构成。审查时先确认触发表单和触发事件，再检查节点输入引用、条件分支、错误处理和重试行为。涉及 HTTP 请求时不得把密钥、身份凭据或无关个人数据写入请求参数。可能产生外部副作用的节点应具备幂等键、人工确认或清晰的失败处理。Agent 可以读取和解释自动化，不能创建、修改、执行、重试或发布自动化。".to_string(),
            source_ids: vec!["api/src/modules/automations".to_string()],
        },
    ]
}

fn default_agent_plugins() -> Vec<AgentPluginDefinition> {
    vec![AgentPluginDefinition {
        id: "plugin-http-json-template".to_string(),
        name: "HTTP JSON 插件模板".to_string(),
        description: "用于创建受控 HTTP 插件的禁用模板；配置有效 Manifest 和服务端点后再启用。".to_string(),
        enabled: false,
        version: "1.0.0".to_string(),
        entrypoint: "template.http-json".to_string(),
        manifest_json: r#"{"endpoint":"https://plugin.example.com/agent-tools","tools":[{"name":"lookup","description":"查询外部业务数据","requiresConfirmation":true}]}"#.to_string(),
        requires_confirmation: true,
    }]
}

pub fn resolve_agent_runtime(agent_id: Option<&str>) -> Result<ResolvedAgentRuntime, String> {
    resolve_agent_runtime_for_scope(agent_id, None, None)
}

pub fn resolve_agent_runtime_for_scope(
    agent_id: Option<&str>,
    app_id: Option<&str>,
    business_id: Option<&str>,
) -> Result<ResolvedAgentRuntime, String> {
    let registry = load_agent_registry();
    resolve_agent_runtime_from_registry(&registry, agent_id, app_id, business_id)
}

fn resolve_agent_runtime_from_registry(
    registry: &AgentRegistry,
    agent_id: Option<&str>,
    app_id: Option<&str>,
    business_id: Option<&str>,
) -> Result<ResolvedAgentRuntime, String> {
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

    let plugins = resolve_bound_resources(
        "plugin",
        &profile.plugin_ids,
        &registry.plugins,
        |resource| &resource.id,
        |resource| resource.enabled,
    )?;
    let skills = resolve_bound_resources(
        "skill",
        &profile.skill_ids,
        &registry.skills,
        |resource| &resource.id,
        |resource| resource.enabled,
    )?;
    let knowledge_bases = resolve_bound_resources(
        "knowledge base",
        &profile.knowledge_base_ids,
        &registry.knowledge_bases,
        |resource| &resource.id,
        |resource| resource.enabled,
    )?;
    let allowed_tools = skills
        .iter()
        .flat_map(|skill| skill.allowed_tools.iter().cloned())
        .collect::<HashSet<_>>();

    Ok(ResolvedAgentRuntime {
        agent_id: agent.id.clone(),
        profile_id: profile.id.clone(),
        settings: AgentSettings {
            enabled: agent.enabled && provider.enabled,
            provider: provider.kind.clone(),
            api_base_url: provider.api_base_url.clone(),
            api_key: provider.api_key.clone(),
            chat_model: profile.chat_model.clone(),
            embedding_model: profile.embedding_model.clone(),
            temperature: profile.temperature,
            max_steps: profile.max_steps,
            system_prompt: if agent.system_prompt.trim().is_empty() {
                persona_prompt.to_string()
            } else {
                agent.system_prompt.clone()
            },
        },
        plugins,
        skills,
        knowledge_bases,
        allow_create_forms: profile.allow_create_forms,
        allowed_tools,
    })
}

fn resolve_bound_resources<T: Clone>(
    resource_type: &str,
    ids: &[String],
    resources: &[T],
    id: impl Fn(&T) -> &str,
    enabled: impl Fn(&T) -> bool,
) -> Result<Vec<T>, String> {
    let mut resolved = Vec::with_capacity(ids.len());
    for resource_id in ids {
        let resource = resources
            .iter()
            .find(|resource| id(resource) == resource_id)
            .ok_or_else(|| format!("configured {resource_type} '{resource_id}' was not found"))?;
        if !enabled(resource) {
            continue;
        }
        if !resolved.iter().any(|existing| id(existing) == resource_id) {
            resolved.push(resource.clone());
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> AgentConfigProfile {
        AgentConfigProfile {
            id: "profile-form-builder".to_string(),
            name: "表单搭建配置".to_string(),
            provider_id: "provider-one".to_string(),
            chat_model: "gpt-test".to_string(),
            embedding_model: "embedding-test".to_string(),
            temperature: 0.2,
            max_steps: 8,
            max_retries: 3,
            image_caption_model: String::new(),
            persona_id: "persona-one".to_string(),
            web_search_enabled: false,
            allow_create_apps: false,
            allow_create_forms: false,
            allow_create_automations: false,
            context_max_turns: 50,
            context_discard_turns: 10,
            context_overflow_strategy: "truncate".to_string(),
            context_compression_prompt: String::new(),
            context_keep_recent_ratio: 0.15,
            context_compression_provider_id: None,
            max_context_tokens: 128_000,
            plugin_ids: vec!["plugin-one".to_string(), "plugin-one".to_string()],
            skill_ids: vec!["skill-one".to_string()],
            knowledge_base_ids: vec!["knowledge-one".to_string()],
        }
    }

    fn registry() -> AgentRegistry {
        AgentRegistry {
            providers: vec![AgentModelProvider {
                id: "provider-one".to_string(),
                name: "测试提供商".to_string(),
                kind: "openai-compatible".to_string(),
                enabled: true,
                api_base_url: "https://example.test/v1".to_string(),
                api_key: "test-key".to_string(),
            }],
            profiles: vec![profile()],
            agents: vec![AgentDefinition {
                id: "robot-form-builder".to_string(),
                name: "表单机器人".to_string(),
                description: String::new(),
                enabled: true,
                is_default: true,
                scope_type: "platform".to_string(),
                scope_ref_id: None,
                profile_id: "profile-form-builder".to_string(),
                system_prompt: String::new(),
                // Robot settings do not own capabilities in the current UI.
                plugin_ids: vec!["plugin-not-used".to_string()],
                skill_ids: Vec::new(),
                knowledge_base_ids: Vec::new(),
            }],
            plugins: vec![AgentPluginDefinition {
                id: "plugin-one".to_string(),
                name: "测试插件".to_string(),
                description: String::new(),
                enabled: true,
                version: "1.0.0".to_string(),
                entrypoint: String::new(),
                manifest_json: String::new(),
                requires_confirmation: false,
            }],
            skills: vec![AgentSkillDefinition {
                id: "skill-one".to_string(),
                name: "表单设计".to_string(),
                package_name: "skill-one".to_string(),
                source: "local".to_string(),
                version: "1.0.0".to_string(),
                package_path: String::new(),
                is_system: false,
                description: String::new(),
                enabled: true,
                allowed_tools: vec!["get_form_schema".to_string()],
                instructions: String::new(),
                requires_confirmation: false,
            }],
            knowledge_bases: vec![AgentKnowledgeBaseDefinition {
                id: "knowledge-one".to_string(),
                name: "表单规范".to_string(),
                description: String::new(),
                enabled: true,
                retrieval_mode: "semantic".to_string(),
                content: String::new(),
                source_ids: vec!["source-one".to_string()],
            }],
            personas: vec![AgentPersonaDefinition {
                id: "persona-one".to_string(),
                name: "实施顾问".to_string(),
                description: String::new(),
                system_prompt: "你是表单设计助手。".to_string(),
            }],
        }
    }

    #[test]
    fn runtime_uses_profile_bindings_and_deduplicates_resources() {
        let mut registry = registry();
        registry.profiles[0].allow_create_forms = true;
        let runtime =
            resolve_agent_runtime_from_registry(&registry, Some("robot-form-builder"), None, None)
                .expect("runtime should resolve");

        assert_eq!(runtime.agent_id, "robot-form-builder");
        assert_eq!(runtime.profile_id, "profile-form-builder");
        assert_eq!(runtime.settings.chat_model, "gpt-test");
        assert_eq!(runtime.settings.system_prompt, "你是表单设计助手。");
        assert_eq!(runtime.plugins.len(), 1);
        assert_eq!(runtime.plugins[0].id, "plugin-one");
        assert_eq!(runtime.skills[0].id, "skill-one");
        assert_eq!(runtime.knowledge_bases[0].id, "knowledge-one");
        assert!(runtime.allow_create_forms);
        assert!(runtime.allowed_tools.contains("get_form_schema"));
        assert!(!runtime.allowed_tools.contains("list_forms"));
        assert!(!runtime.allowed_tools.contains("create_form_draft"));
    }

    #[test]
    fn disabled_bound_resource_is_excluded_from_runtime() {
        let mut registry = registry();
        registry.plugins[0].enabled = false;

        let runtime =
            resolve_agent_runtime_from_registry(&registry, Some("robot-form-builder"), None, None)
                .expect("disabled plugin must not prevent the Agent from running");

        assert!(runtime.plugins.is_empty());
    }

    #[test]
    fn default_resources_are_added_once_and_bound_to_default_profile() {
        let mut registry = registry();
        registry.profiles[0].id = "profile-default".to_string();
        registry.profiles[0].skill_ids.clear();
        registry.profiles[0].knowledge_base_ids.clear();
        registry.skills.clear();
        registry.knowledge_bases.clear();
        registry.plugins.clear();

        assert!(ensure_default_agent_resources_in_registry(&mut registry));
        assert!(registry.skills.iter().any(|item| {
            item.id == "skill-form-designer"
                && item
                    .allowed_tools
                    .iter()
                    .any(|tool| tool == "create_form_draft")
        }));
        assert!(
            registry
                .knowledge_bases
                .iter()
                .any(|item| item.id == "knowledge-form-components")
        );
        assert!(
            registry
                .plugins
                .iter()
                .any(|item| item.id == "plugin-http-json-template" && !item.enabled)
        );
        assert_eq!(registry.profiles[0].skill_ids.len(), 3);
        assert_eq!(registry.profiles[0].knowledge_base_ids.len(), 2);
        assert!(!ensure_default_agent_resources_in_registry(&mut registry));
    }
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
            allow_create_apps: false,
            allow_create_forms: false,
            allow_create_automations: false,
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

pub fn load_rbac_permission_settings() -> Option<RbacPermissionSettings> {
    let content = fs::read_to_string(rbac_permission_settings_path()).ok()?;
    serde_json::from_str::<RbacPermissionSettings>(&content).ok()
}

pub fn save_rbac_permission_settings(
    settings: &RbacPermissionSettings,
) -> Result<(), std::io::Error> {
    let path = rbac_permission_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content =
        serde_json::to_vec_pretty(settings).expect("rbac permission settings are serializable");
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
        if self.dingtalk.sync_interval_minutes == 0 || self.dingtalk.sync_interval_minutes > 10_080
        {
            return Err("dingtalk sync interval must be between 1 and 10080 minutes".to_string());
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

fn rbac_permission_settings_path() -> PathBuf {
    std::env::var_os("YAYA_RBAC_PERMISSION_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-rbac-permissions.json"))
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
