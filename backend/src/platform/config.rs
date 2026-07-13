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
