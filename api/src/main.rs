mod http;
mod infrastructure;
mod modules;
mod openapi;
mod platform;
mod shared;

use std::net::SocketAddr;

use modules::navigation;
use platform::config::AppConfig;
use platform::error::AppError;
use platform::form_storage::ensure_all_form_dynamic_storage;
use platform::runtime::AppState;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    if let Some(delay) = std::env::var("YAYA_RESTART_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "yaya_api=info,tower_http=info".into()),
        )
        .init();

    if let Some(path) = std::env::var_os("YAYA_EXPORT_OPENAPI_PATH") {
        openapi::export_to_file(std::path::Path::new(&path)).map_err(AppError::Server)?;
        return Ok(());
    }

    let config = AppConfig::from_env();
    let db = Database::connect(&config.database_url).await?;

    infrastructure::migrator::Migrator::up(&db, None).await?;
    infrastructure::legacy_bootstrap::ensure_form_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_automation_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_agent_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_identity_tables(&db).await?;
    navigation::ensure_system_navigation_items(&db).await?;
    ensure_all_form_dynamic_storage(&db).await?;

    let (shutdown, mut shutdown_signal) = tokio::sync::watch::channel(false);
    let state = AppState::new(db, shutdown);
    let app = http::router::build(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    info!("api listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_signal.changed().await;
        })
        .await
        .map_err(AppError::from)
}
