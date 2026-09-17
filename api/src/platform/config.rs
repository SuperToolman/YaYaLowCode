use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use zip::ZipArchive;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub valkey_url: Option<String>,
    pub valkey_cache_ttl_seconds: u64,
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
pub struct ValkeySettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub database: u8,
    pub username: String,
    pub password: String,
    #[serde(default = "default_valkey_cache_ttl_hours")]
    pub cache_ttl_hours: u8,
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

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBusinessContext {
    #[serde(default)]
    pub business_overview: String,
    #[serde(default)]
    pub terminology: String,
    #[serde(default)]
    pub process_description: String,
    #[serde(default)]
    pub analysis_guidance: String,
}

impl ApplicationBusinessContext {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("businessOverview", &self.business_overview),
            ("terminology", &self.terminology),
            ("processDescription", &self.process_description),
            ("analysisGuidance", &self.analysis_guidance),
        ] {
            if value.chars().count() > 4_000 {
                return Err(format!("{name} must not exceed 4000 characters"));
            }
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.business_overview.trim().is_empty()
            && self.terminology.trim().is_empty()
            && self.process_description.trim().is_empty()
            && self.analysis_guidance.trim().is_empty()
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct ApplicationBusinessContextSettings {
    #[serde(default)]
    pub applications: HashMap<String, ApplicationBusinessContext>,
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
    pub scope_type: String,
    pub scope_ref_id: Option<String>,
    pub settings: AgentSettings,
    pub plugins: Vec<AgentPluginDefinition>,
    pub skills: Vec<AgentSkillDefinition>,
    pub knowledge_bases: Vec<AgentKnowledgeBaseDefinition>,
    pub allowed_tools: HashSet<String>,
    pub application_ids: HashSet<String>,
}

impl ResolvedAgentRuntime {
    pub fn validate_scope(
        &self,
        app_id: Option<&str>,
        business_id: Option<&str>,
    ) -> Result<(), String> {
        match self.scope_type.as_str() {
            "platform" => Ok(()),
            "application" if self.scope_ref_id.as_deref() == app_id => Ok(()),
            "business" if self.scope_ref_id.as_deref() == business_id => Ok(()),
            "application" => Err("Agent is restricted to its configured application".to_string()),
            "business" => Err("Agent is restricted to its configured business scope".to_string()),
            _ => Err("Agent has an invalid scope configuration".to_string()),
        }
    }
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
    let mut names = HashSet::new();
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
    pub instructions: String,
    pub requires_confirmation: bool,
    #[serde(default)]
    pub plugin_manifest_json: String,
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
    #[serde(default)]
    pub is_default: bool,
    pub api_base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub website_url: String,
    #[serde(default)]
    pub default_chat_model: String,
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
    #[serde(default)]
    pub web_search_enabled: bool,
    #[serde(default)]
    pub allow_create_apps: bool,
    #[serde(default)]
    pub allow_create_forms: bool,
    #[serde(default)]
    pub allow_create_automations: bool,
    /// Final platform authorization owned by the AI employee profile.
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub application_ids: Vec<String>,
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
pub struct NotificationSettings {
    #[serde(default = "default_true")]
    pub in_app_enabled: bool,
    #[serde(default = "default_notification_poll_interval_seconds")]
    pub poll_interval_seconds: u32,
    #[serde(default = "default_notification_retention_days")]
    pub retention_days: u32,
    #[serde(default)]
    pub dingtalk_enabled: bool,
    #[serde(default)]
    pub dingtalk_webhook_url: String,
    #[serde(default)]
    pub email_enabled: bool,
    #[serde(default)]
    pub email_from_address: String,
    #[serde(default)]
    pub websocket_enabled: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationModuleSettings {
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub license_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default = "default_communication_max_file_upload_mb")]
    pub max_file_upload_mb: u32,
    #[serde(default = "default_communication_retention_days")]
    pub retention_days: u32,
    #[serde(default)]
    pub allowed_file_extensions: String,
    #[serde(default = "default_true")]
    pub websocket_enabled: bool,
    #[serde(default = "default_true")]
    pub allow_file_messages: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinSettings {
    pub retention_days: u16,
}

impl Default for RecycleBinSettings {
    fn default() -> Self {
        Self { retention_days: 7 }
    }
}

impl Default for CommunicationModuleSettings {
    fn default() -> Self {
        Self {
            installed: false,
            license_id: None,
            expires_at: None,
            max_file_upload_mb: default_communication_max_file_upload_mb(),
            retention_days: default_communication_retention_days(),
            allowed_file_extensions: String::new(),
            websocket_enabled: true,
            allow_file_messages: true,
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLicenseSettings {
    pub license_center_url: String,
    pub license: String,
    pub activated_at: String,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            in_app_enabled: true,
            poll_interval_seconds: default_notification_poll_interval_seconds(),
            retention_days: default_notification_retention_days(),
            dingtalk_enabled: false,
            dingtalk_webhook_url: String::new(),
            email_enabled: false,
            email_from_address: String::new(),
            websocket_enabled: false,
        }
    }
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

#[derive(Deserialize, Serialize)]
struct StoredSettings {
    database: DatabaseSettings,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let valkey_settings = load_valkey_settings();
        Self {
            host: std::env::var("APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("APP_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8788),
            database_url: database_url_from_env()
                .or_else(|| load_database_settings().map(|settings| settings.to_database_url()))
                .unwrap_or_else(|| "postgres://postgres@localhost:5432/yaya_low_code".to_string()),
            valkey_url: std::env::var("VALKEY_URL").ok().or_else(|| {
                valkey_settings
                    .as_ref()
                    .filter(|settings| settings.enabled)
                    .map(|settings| settings.to_valkey_url())
            }),
            valkey_cache_ttl_seconds: valkey_settings
                .as_ref()
                .map(|settings| settings.cache_ttl_hours as u64 * 3_600)
                .or_else(|| {
                    std::env::var("VALKEY_CACHE_TTL_HOURS")
                        .ok()
                        .and_then(|value| value.parse::<u64>().ok())
                        .map(|hours| hours * 3_600)
                })
                .unwrap_or(8 * 3_600),
        }
    }
}

pub fn validate_production_environment() -> Result<(), std::io::Error> {
    let production = matches!(std::env::var("APP_ENV").as_deref(), Ok("production"))
        || matches!(std::env::var("NODE_ENV").as_deref(), Ok("production"));
    if !production {
        return Ok(());
    }

    for name in [
        "DATABASE_URL",
        "AUTH_TOKEN_SECRET",
        "BACKEND_INTERNAL_TOKEN",
        "YAYA_LICENSE_PUBLIC_KEY_PEM",
    ] {
        if std::env::var(name).is_ok_and(|value| !value.trim().is_empty()) {
            continue;
        }
        if name == "YAYA_LICENSE_PUBLIC_KEY_PEM"
            && std::env::var_os("YAYA_LICENSE_PUBLIC_KEY_PATH").is_some()
        {
            continue;
        }
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("required production environment variable is missing: {name}"),
        ));
    }
    Ok(())
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

pub fn database_url_from_env() -> Option<String> {
    std::env::var("DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

pub fn runtime_database_settings() -> Option<(DatabaseSettings, String)> {
    let database_url = database_url_from_env()?;
    let parsed = reqwest::Url::parse(&database_url).ok()?;
    let host = parsed.host_str()?.to_string();
    let database = parsed.path().trim_start_matches('/').to_string();
    if database.is_empty() || parsed.username().is_empty() {
        return None;
    }
    Some((
        DatabaseSettings {
            host,
            port: parsed.port().unwrap_or(5432),
            database,
            username: parsed.username().to_string(),
            // Runtime credentials are never returned through the settings API.
            password: String::new(),
        },
        database_url,
    ))
}

impl ValkeySettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
        if self.host.trim().is_empty() {
            return Err("Valkey host is required".to_string());
        }
        if self.port == 0 {
            return Err("Valkey port is required".to_string());
        }
        if self.database > 15 {
            return Err("Valkey database must be between 0 and 15".to_string());
        }
        if !(1..=24).contains(&self.cache_ttl_hours) {
            return Err("Valkey cache TTL must be between 1 and 24 hours".to_string());
        }
        Ok(())
    }

    pub fn to_valkey_url(&self) -> String {
        let credentials = match (self.username.trim(), self.password.as_str()) {
            ("", "") => String::new(),
            (username, password) => format!(
                "{}:{}@",
                percent_encode(if username.is_empty() {
                    "default"
                } else {
                    username
                }),
                percent_encode(password)
            ),
        };
        format!(
            "redis://{credentials}{}:{}/{}",
            self.host.trim(),
            self.port,
            self.database
        )
    }
}

fn default_valkey_cache_ttl_hours() -> u8 {
    8
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

pub fn load_valkey_settings() -> Option<ValkeySettings> {
    let content = fs::read_to_string(valkey_settings_path()).ok()?;
    serde_json::from_str::<ValkeySettings>(&content).ok()
}

pub fn save_valkey_settings(settings: &ValkeySettings) -> Result<(), std::io::Error> {
    let path = valkey_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(settings).expect("Valkey settings are serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
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
    let package_path = format!("{}/SKILL.md", skill.package_name);
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

pub fn write_skill_markdown(
    skill: &mut AgentSkillDefinition,
    content: &str,
) -> Result<(), std::io::Error> {
    ensure_skill_package(skill)?;
    fs::write(skill_markdown_path(skill), content.as_bytes())?;
    skill.instructions = content.to_string();
    Ok(())
}

pub fn import_skill_package(
    skill: &mut AgentSkillDefinition,
    archive: &[u8],
) -> Result<(), String> {
    const MAX_ARCHIVE_BYTES: usize = 10 * 1024 * 1024;
    const MAX_FILES: usize = 256;
    const MAX_UNCOMPRESSED_BYTES: u64 = 20 * 1024 * 1024;

    if archive.is_empty() || archive.len() > MAX_ARCHIVE_BYTES {
        return Err("Skill 压缩包不能为空且不得超过 10 MB".to_string());
    }
    let mut zip = ZipArchive::new(Cursor::new(archive))
        .map_err(|error| format!("无法读取 Skill ZIP 文件: {error}"))?;
    if zip.len() > MAX_FILES {
        return Err("Skill 压缩包中的文件数量不能超过 256 个".to_string());
    }

    let mut skill_prefix = None;
    let mut total_size = 0_u64;
    for index in 0..zip.len() {
        let file = zip
            .by_index(index)
            .map_err(|error| format!("无法读取 Skill ZIP 条目: {error}"))?;
        let path = file
            .enclosed_name()
            .ok_or_else(|| "Skill 压缩包包含不安全的文件路径".to_string())?;
        total_size = total_size.saturating_add(file.size());
        if total_size > MAX_UNCOMPRESSED_BYTES {
            return Err("Skill 压缩包解压后不得超过 20 MB".to_string());
        }
        if !file.is_dir() && path.file_name().is_some_and(|name| name == "SKILL.md") {
            skill_prefix = Some(path.parent().unwrap_or_else(|| Path::new("")).to_path_buf());
            break;
        }
    }
    let prefix = skill_prefix.ok_or_else(|| "Skill 压缩包必须包含 SKILL.md".to_string())?;

    if skill.package_name.trim().is_empty() {
        skill.package_name = skill_package_name(&skill.id);
    }
    let package_dir = skill_packages_root().join(&skill.package_name);
    fs::create_dir_all(&package_dir).map_err(|error| error.to_string())?;
    let mut instructions = None;
    for index in 0..zip.len() {
        let mut file = zip
            .by_index(index)
            .map_err(|error| format!("无法读取 Skill ZIP 条目: {error}"))?;
        let source = file
            .enclosed_name()
            .ok_or_else(|| "Skill 压缩包包含不安全的文件路径".to_string())?;
        if !source.starts_with(&prefix) {
            continue;
        }
        let relative = source
            .strip_prefix(&prefix)
            .map_err(|_| "Skill 压缩包目录结构无效".to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = package_dir.join(relative);
        if file.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes)
            .map_err(|error| format!("无法解压 Skill 文件: {error}"))?;
        if relative == Path::new("SKILL.md") {
            instructions = Some(
                String::from_utf8(bytes.clone())
                    .map_err(|_| "SKILL.md 必须是 UTF-8 文本".to_string())?,
            );
        }
        fs::write(target, bytes).map_err(|error| error.to_string())?;
    }
    skill.instructions = instructions.ok_or_else(|| "Skill 压缩包必须包含 SKILL.md".to_string())?;
    skill.source = "local".to_string();
    skill.version = default_skill_version();
    skill.package_path = format!("{}/SKILL.md", skill.package_name);
    Ok(())
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
    // Install skills to DSH agents home for automatic discovery by skill-filesystem provider
    let agents_home = std::env::var("DSH_AGENTS_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{}/.agents", home)
    });
    PathBuf::from(agents_home).join("skills")
}

pub(crate) fn resolve_agent_runtime_from_registry(
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
    let allowed_tools = profile
        .allowed_tools
        .iter()
        .cloned()
        .collect::<HashSet<_>>();

    Ok(ResolvedAgentRuntime {
        agent_id: agent.id.clone(),
        profile_id: profile.id.clone(),
        scope_type: agent.scope_type.clone(),
        scope_ref_id: agent.scope_ref_id.clone(),
        settings: AgentSettings {
            enabled: agent.enabled && provider.enabled,
            provider: provider.kind.clone(),
            api_base_url: provider.api_base_url.clone(),
            api_key: provider.api_key.clone(),
            chat_model: if profile.chat_model.trim().is_empty() {
                provider.default_chat_model.clone()
            } else {
                profile.chat_model.clone()
            },
            embedding_model: profile.embedding_model.clone(),
            temperature: profile.temperature,
            max_steps: profile.max_steps,
            system_prompt: agent.system_prompt.clone(),
        },
        plugins,
        skills,
        knowledge_bases,
        allowed_tools,
        application_ids: profile.application_ids.iter().cloned().collect(),
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
            web_search_enabled: false,
            allow_create_apps: false,
            allow_create_forms: false,
            allow_create_automations: false,
            allowed_tools: vec!["get_form_schema".to_string()],
            application_ids: vec!["APP_TEST".to_string()],
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
                is_default: true,
                api_base_url: "https://example.test/v1".to_string(),
                api_key: "test-key".to_string(),
                website_url: String::new(),
                default_chat_model: "gpt-test".to_string(),
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
                system_prompt: "你是表单设计助手。".to_string(),
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
                instructions: String::new(),
                plugin_manifest_json: String::new(),
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
        }
    }

    #[test]
    fn runtime_uses_profile_bindings_and_deduplicates_resources() {
        let registry = registry();
        let runtime =
            resolve_agent_runtime_from_registry(&registry, Some("robot-form-builder"), None, None)
                .expect("runtime should resolve");

        assert_eq!(runtime.agent_id, "robot-form-builder");
        assert_eq!(runtime.profile_id, "profile-form-builder");
        assert_eq!(runtime.scope_type, "platform");
        assert_eq!(runtime.settings.chat_model, "gpt-test");
        assert_eq!(runtime.settings.system_prompt, "你是表单设计助手。");
        assert_eq!(runtime.plugins.len(), 1);
        assert_eq!(runtime.plugins[0].id, "plugin-one");
        assert_eq!(runtime.skills[0].id, "skill-one");
        assert_eq!(runtime.knowledge_bases[0].id, "knowledge-one");
        assert!(runtime.allowed_tools.contains("get_form_schema"));
        assert!(!runtime.allowed_tools.contains("list_forms"));
        assert!(!runtime.allowed_tools.contains("create_form"));
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
    fn application_agent_runtime_rejects_another_application_context() {
        let mut registry = registry();
        registry.agents[0].scope_type = "application".to_string();
        registry.agents[0].scope_ref_id = Some("sales".to_string());

        let runtime =
            resolve_agent_runtime_from_registry(&registry, Some("robot-form-builder"), None, None)
                .expect("runtime should resolve");

        assert!(runtime.validate_scope(Some("sales"), None).is_ok());
        assert!(runtime.validate_scope(Some("hr"), None).is_err());
        assert!(runtime.validate_scope(None, None).is_err());
    }
}

fn default_max_retries() -> usize {
    3
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

pub fn load_application_business_context_settings() -> Option<ApplicationBusinessContextSettings> {
    let content = fs::read_to_string(application_business_context_settings_path()).ok()?;
    serde_json::from_str::<ApplicationBusinessContextSettings>(&content).ok()
}

pub fn save_application_business_context_settings(
    settings: &ApplicationBusinessContextSettings,
) -> Result<(), std::io::Error> {
    let path = application_business_context_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content = serde_json::to_vec_pretty(settings)
        .expect("application business context settings are serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn load_notification_settings() -> Option<NotificationSettings> {
    let content = fs::read_to_string(notification_settings_path()).ok()?;
    serde_json::from_str::<NotificationSettings>(&content).ok()
}

pub fn save_notification_settings(settings: &NotificationSettings) -> Result<(), std::io::Error> {
    let path = notification_settings_path();
    let temporary_path = path.with_extension("tmp");
    let content =
        serde_json::to_vec_pretty(settings).expect("notification settings are serializable");
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn communication_module_enabled() -> bool {
    crate::platform::license::license_has_module("communication")
}

pub fn load_platform_license_settings() -> Option<PlatformLicenseSettings> {
    let content = fs::read_to_string(platform_license_settings_path()).ok()?;
    serde_json::from_str::<PlatformLicenseSettings>(&content).ok()
}

pub fn save_platform_license_settings(
    settings: &PlatformLicenseSettings,
) -> Result<(), std::io::Error> {
    let path = platform_license_settings_path();
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(settings).expect("license settings are serializable"),
    )?;
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

/// Per-platform Agent workspace limits. The platform instance owns this root;
/// user, AI employee, and session are the isolation segments below it.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceSettings {
    pub root: String,
    pub max_bytes: u64,
    pub max_files: u64,
    pub retention_days: u32,
}

pub fn agent_workspace_settings() -> AgentWorkspaceSettings {
    AgentWorkspaceSettings {
        // Local API runs from api/, while the DSH host runs from
        // agent/deepseek-harness. Both fallbacks resolve to agent/runtime;
        // production sets an absolute path through YAYA_AGENT_WORKSPACE_ROOT.
        root: std::env::var("YAYA_AGENT_WORKSPACE_ROOT")
            .unwrap_or_else(|_| "../agent/runtime/workspaces".to_string()),
        max_bytes: env_u64("YAYA_AGENT_WORKSPACE_MAX_BYTES", 1_073_741_824),
        max_files: env_u64("YAYA_AGENT_WORKSPACE_MAX_FILES", 10_000),
        retention_days: env_u64("YAYA_AGENT_WORKSPACE_RETENTION_DAYS", 30).min(u32::MAX as u64)
            as u32,
    }
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value: &u64| *value > 0)
        .unwrap_or(fallback)
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

impl NotificationSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(15..=3_600).contains(&self.poll_interval_seconds) {
            return Err(
                "notification polling interval must be between 15 and 3600 seconds".to_string(),
            );
        }
        if !(1..=3_650).contains(&self.retention_days) {
            return Err("notification retention must be between 1 and 3650 days".to_string());
        }
        if self.dingtalk_enabled && self.dingtalk_webhook_url.trim().is_empty() {
            return Err("dingtalk webhook url is required when enabled".to_string());
        }
        if self.email_enabled && self.email_from_address.trim().is_empty() {
            return Err("email from address is required when enabled".to_string());
        }
        Ok(())
    }
}

fn default_true() -> bool {
    true
}
fn default_notification_poll_interval_seconds() -> u32 {
    60
}
fn default_notification_retention_days() -> u32 {
    90
}
fn default_communication_max_file_upload_mb() -> u32 {
    20
}
fn default_communication_retention_days() -> u32 {
    0
}

fn settings_path() -> PathBuf {
    runtime_state_path("YAYA_SETTINGS_PATH", "database.json")
}

fn valkey_settings_path() -> PathBuf {
    runtime_state_path("YAYA_VALKEY_SETTINGS_PATH", "valkey.json")
}

fn application_business_context_settings_path() -> PathBuf {
    runtime_state_path(
        "YAYA_APPLICATION_BUSINESS_CONTEXT_PATH",
        "application-business-context.json",
    )
}

fn identity_settings_path() -> PathBuf {
    runtime_state_path("YAYA_IDENTITY_SETTINGS_PATH", "identity.json")
}

fn notification_settings_path() -> PathBuf {
    runtime_state_path("YAYA_NOTIFICATION_SETTINGS_PATH", "notifications.json")
}

fn communication_settings_path() -> PathBuf {
    runtime_state_path("YAYA_COMMUNICATION_SETTINGS_PATH", "communication.json")
}

fn installed_ai_employees_path() -> PathBuf {
    runtime_state_path(
        "YAYA_INSTALLED_AI_EMPLOYEES_PATH",
        "installed-ai-employees.json",
    )
}

fn installed_ai_employee_packages_path() -> PathBuf {
    runtime_state_path(
        "YAYA_INSTALLED_AI_EMPLOYEE_PACKAGES_PATH",
        "installed-ai-employee-packages.json",
    )
}

pub fn load_installed_ai_employees() -> HashSet<String> {
    fs::read_to_string(installed_ai_employees_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_installed_ai_employees(ids: &HashSet<String>) -> Result<(), std::io::Error> {
    let path = installed_ai_employees_path();
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(ids).expect("installed AI employees are serializable"),
    )?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn save_installed_ai_employee_package(
    id: &str,
    package: serde_json::Value,
) -> Result<(), std::io::Error> {
    let path = installed_ai_employee_packages_path();
    let mut packages = load_installed_ai_employee_packages();
    packages.insert(id.to_string(), package);
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(&packages)
            .expect("installed AI employee packages are serializable"),
    )?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn load_installed_ai_employee_packages() -> HashMap<String, serde_json::Value> {
    fs::read_to_string(installed_ai_employee_packages_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn remove_installed_ai_employee_package(id: &str) -> Result<(), std::io::Error> {
    let path = installed_ai_employee_packages_path();
    let mut packages = load_installed_ai_employee_packages();
    packages.remove(id);
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(&packages).expect("installed AI employees are serializable"),
    )?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

fn recycle_bin_settings_path() -> PathBuf {
    runtime_state_path("YAYA_RECYCLE_BIN_SETTINGS_PATH", "recycle-bin.json")
}

pub fn load_recycle_bin_settings() -> RecycleBinSettings {
    fs::read_to_string(recycle_bin_settings_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_recycle_bin_settings(settings: &RecycleBinSettings) -> Result<(), std::io::Error> {
    let path = recycle_bin_settings_path();
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(settings).expect("recycle settings are serializable"),
    )?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

pub fn load_communication_settings() -> Option<CommunicationModuleSettings> {
    let content = fs::read_to_string(communication_settings_path()).ok()?;
    serde_json::from_str::<CommunicationModuleSettings>(&content).ok()
}

pub fn save_communication_settings(
    settings: &CommunicationModuleSettings,
) -> Result<(), std::io::Error> {
    let path = communication_settings_path();
    let temporary_path = path.with_extension("tmp");
    fs::write(
        &temporary_path,
        serde_json::to_vec_pretty(settings).expect("communication settings are serializable"),
    )?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary_path, path)
}

fn platform_license_settings_path() -> PathBuf {
    runtime_state_path("YAYA_LICENSE_SETTINGS_PATH", "license.json")
}

fn runtime_state_path(variable: &str, file_name: &str) -> PathBuf {
    std::env::var_os(variable)
        .map(PathBuf::from)
        .unwrap_or_else(|| api_runtime_root().join("state").join(file_name))
}

fn api_runtime_root() -> PathBuf {
    std::env::var_os("YAYA_API_RUNTIME_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("runtime"))
}

/// Moves local runtime state out of the source root without overwriting an
/// existing runtime directory. Explicit `YAYA_*_PATH` values are left alone.
pub fn migrate_legacy_runtime_layout() -> Result<(), std::io::Error> {
    let state_migrations = [
        (
            "YAYA_SETTINGS_PATH",
            ".yaya-lowcode-settings.json",
            "database.json",
        ),
        (
            "YAYA_VALKEY_SETTINGS_PATH",
            ".yaya-valkey-settings.json",
            "valkey.json",
        ),
        (
            "YAYA_APPLICATION_BUSINESS_CONTEXT_PATH",
            ".yaya-application-business-context.json",
            "application-business-context.json",
        ),
        (
            "YAYA_IDENTITY_SETTINGS_PATH",
            ".yaya-identity-settings.json",
            "identity.json",
        ),
        (
            "YAYA_NOTIFICATION_SETTINGS_PATH",
            ".yaya-notification-settings.json",
            "notifications.json",
        ),
        (
            "YAYA_COMMUNICATION_SETTINGS_PATH",
            ".yaya-communication-settings.json",
            "communication.json",
        ),
        (
            "YAYA_RECYCLE_BIN_SETTINGS_PATH",
            ".yaya-recycle-bin.json",
            "recycle-bin.json",
        ),
        (
            "YAYA_LICENSE_SETTINGS_PATH",
            ".yaya-license.json",
            "license.json",
        ),
    ];

    fs::create_dir_all(api_runtime_root().join("state"))?;
    for (variable, legacy, file_name) in state_migrations {
        if std::env::var_os(variable).is_none() {
            move_runtime_path(Path::new(legacy), &runtime_state_path(variable, file_name))?;
        }
    }
    if std::env::var_os("YAYA_UPLOAD_DIR").is_none() {
        move_runtime_path(
            Path::new("data/uploads"),
            &api_runtime_root().join("uploads"),
        )?;
    }
    if std::env::var_os("YAYA_LOG_DIRECTORY").is_none() {
        move_runtime_path(Path::new("data/logs"), &api_runtime_root().join("logs"))?;
    }
    if Path::new("data").is_dir() && fs::read_dir("data")?.next().is_none() {
        fs::remove_dir("data")?;
    }
    Ok(())
}

fn move_runtime_path(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, destination)
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
