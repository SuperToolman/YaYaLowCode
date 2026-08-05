mod http;
mod infrastructure;
mod modules;
mod openapi;
mod platform;
mod shared;

use std::net::SocketAddr;

use modules::{locations, navigation};
use platform::config::{
    AppConfig, communication_module_enabled, migrate_legacy_runtime_layout,
    validate_production_environment,
};
use platform::error::AppError;
use platform::form_storage::ensure_all_form_dynamic_storage;
use platform::runtime::AppState;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use tracing::{info, warn};
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    if let Some(delay) = std::env::var("YAYA_RESTART_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    }

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "yaya_api=debug,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(platform::logging::PlatformLogLayer)
        .init();

    let openapi_output =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi/openapi.json");
    if std::env::args()
        .skip(1)
        .any(|argument| argument == "--export-openapi")
    {
        openapi::export_to_file(&openapi_output).map_err(AppError::Server)?;
        return Ok(());
    }

    // `cargo run` is the local development entry point, so keep its contract current.
    #[cfg(debug_assertions)]
    openapi::export_to_file(&openapi_output).map_err(AppError::Server)?;

    migrate_legacy_runtime_layout().map_err(AppError::Server)?;
    validate_production_environment().map_err(AppError::Server)?;
    let config = AppConfig::from_env();
    let db = Database::connect(&config.database_url).await?;
    let valkey = connect_valkey(config.valkey_url.as_deref()).await;

    locations::prepare_legacy_location_catalog_schema(&db).await?;
    infrastructure::legacy_bootstrap::ensure_form_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_automation_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_identity_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_agent_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_workflow_tables(&db).await?;
    infrastructure::legacy_bootstrap::ensure_file_tables(&db).await?;
    if communication_module_enabled() {
        infrastructure::legacy_bootstrap::ensure_communication_tables(&db).await?;
    }
    infrastructure::migrator::Migrator::up(&db, None).await?;
    platform::logging::start_persistence();
    locations::ensure_location_catalog_schema(&db).await?;
    if let Some(path) = import_location_catalog_path() {
        let imported = locations::import_catalog_directory(&db, &path).await?;
        info!(count = imported, "location catalog imported");
        return Ok(());
    }
    navigation::ensure_system_navigation_items(&db).await?;
    ensure_all_form_dynamic_storage(&db).await?;

    let (shutdown, mut shutdown_signal) = tokio::sync::watch::channel(false);
    let state = AppState::new(db, valkey, config.valkey_cache_ttl_seconds, shutdown);
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

async fn connect_valkey(url: Option<&str>) -> Option<redis::aio::ConnectionManager> {
    let url = url?;
    let client = match redis::Client::open(url) {
        Ok(client) => client,
        Err(error) => {
            warn!(%error, "Valkey configuration is invalid; cache is disabled");
            return None;
        }
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        redis::aio::ConnectionManager::new(client),
    )
    .await
    {
        Ok(Ok(connection)) => {
            info!("Valkey cache connected");
            Some(connection)
        }
        Ok(Err(error)) => {
            warn!(%error, "Valkey is unavailable; cache is disabled");
            None
        }
        Err(_) => {
            warn!("Valkey connection timed out; cache is disabled");
            None
        }
    }
}

fn import_location_catalog_path() -> Option<std::path::PathBuf> {
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--import-location-catalog" {
            return arguments.next().map(std::path::PathBuf::from);
        }
    }
    None
}
