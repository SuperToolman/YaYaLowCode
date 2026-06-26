pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("APP_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8787),
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:5201314qq@localhost:5432/yaya_low_code".to_string()
            }),
        }
    }
}
