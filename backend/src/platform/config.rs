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
                .unwrap_or_else(|| {
                    "postgres://postgres:5201314qq@localhost:5432/yaya_low_code".to_string()
                }),
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

fn settings_path() -> PathBuf {
    std::env::var_os("YAYA_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".yaya-lowcode-settings.json"))
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
