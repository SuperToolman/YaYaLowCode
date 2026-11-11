mod adapters;
mod runtime;

use anyhow::{Context, Result, bail};
use sea_orm::Database;
use std::{path::PathBuf, time::Duration};
use uuid::Uuid;
use yaya_agent_v2::store::Store;

pub struct Config {
    pub api_url: String,
    pub worker_secret: String,
    pub host_path: PathBuf,
    pub lease_seconds: i32,
    pub context_tokens: usize,
    pub max_attempts: i64,
    pub request_seconds: u64,
    pub idle_seconds: u64,
    pub first_token_seconds: u64,
    pub connect_seconds: u64,
    pub max_completion_tokens: u64,
}

fn context_window(value: Option<&str>) -> Result<usize> {
    let size = value.unwrap_or("32768").parse::<usize>()?;
    if size == 0 {
        bail!("invalid YAYA_AGENT_V2_CONTEXT_TOKENS")
    }
    Ok(size)
}

impl Config {
    fn load() -> Result<Self> {
        let worker_secret = std::env::var("YAYA_AGENT_V2_WORKER_SECRET")
            .context("YAYA_AGENT_V2_WORKER_SECRET is required")?;
        if worker_secret.len() < 32 {
            bail!("worker secret must contain at least 32 bytes")
        }
        fn positive(name: &str, default: u64) -> Result<u64> {
            let value = std::env::var(name)
                .ok()
                .map(|v| v.parse::<u64>())
                .transpose()?
                .unwrap_or(default);
            if value == 0 || value > 86400 {
                bail!("invalid {name}")
            }
            Ok(value)
        }
        Ok(Self {
            api_url: std::env::var("YAYA_AGENT_V2_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8788".into())
                .trim_end_matches('/')
                .into(),
            worker_secret,
            host_path: std::env::var_os("YAYA_AGENT_V2_CORDIS_HOST")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../cordis-host/src/host.mjs")
                }),
            lease_seconds: positive("YAYA_AGENT_V2_LEASE_SECONDS", 30)? as i32,
            context_tokens: context_window(
                std::env::var("YAYA_AGENT_V2_CONTEXT_TOKENS")
                    .ok()
                    .as_deref(),
            )?,
            max_attempts: positive("YAYA_AGENT_V2_MAX_ATTEMPTS", 3)? as i64,
            request_seconds: positive("YAYA_AGENT_V2_REQUEST_SECONDS", 120)?,
            idle_seconds: positive("YAYA_AGENT_V2_IDLE_SECONDS", 20)?,
            first_token_seconds: positive("YAYA_AGENT_V2_FIRST_TOKEN_SECONDS", 30)?,
            connect_seconds: positive("YAYA_AGENT_V2_CONNECT_SECONDS", 10)?,
            max_completion_tokens: {
                let value = positive("YAYA_AGENT_V2_MAX_COMPLETION_TOKENS", 8192)?;
                if value > 32768 {
                    bail!("invalid YAYA_AGENT_V2_MAX_COMPLETION_TOKENS: maximum 32768")
                }
                value
            },
        })
    }
}

#[cfg(test)]
mod config_tests {
    #[test]
    fn context_windows_are_not_limited_by_the_timeout_seconds_range() {
        assert_eq!(super::context_window(Some("131072")).unwrap(), 131072);
        assert_eq!(super::context_window(Some("1048576")).unwrap(), 1048576);
        assert_eq!(super::context_window(None).unwrap(), 32768);
        assert!(super::context_window(Some("0")).is_err());
        assert!(super::context_window(Some("unknown")).is_err());
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let config = Config::load()?;
    let store = Store {
        db: Database::connect(std::env::var("DATABASE_URL").context("DATABASE_URL is required")?)
            .await?,
    };
    let owner = Uuid::new_v4();
    tracing::info!(%owner,"Agent V2 worker ready");
    loop {
        store.expire_confirmations().await?;
        let lease = tokio::select! {_ = tokio::signal::ctrl_c()=>break, claim=store.claim(owner,config.lease_seconds)=>claim?};
        if let Some(lease) = lease {
            if lease.cancelled {
                store.finish(&lease, "cancelled", "", None).await?;
                continue;
            }
            let task = runtime::execute(&config, &store, &lease);
            tokio::pin!(task);
            let mut heartbeat = tokio::time::interval(Duration::from_secs(
                (config.lease_seconds as u64 / 3).max(1),
            ));
            let result = loop {
                tokio::select! {
                    _=tokio::signal::ctrl_c()=>return Ok(()),
                    result=&mut task=>break Some(result),
                    _=heartbeat.tick()=>{
                        if store.heartbeat(&lease,config.lease_seconds).await.is_err(){
                            // A failed heartbeat can be a DB outage. Do not convert it into a user cancellation.
                            if store.run(lease.run_id).await.is_ok_and(|r|r["status"]=="cancel_requested") {
                                let _=store.finish(&lease,"cancelled","",Some("cancelled")).await;
                            }
                            break None;
                        }
                    }
                }
            };
            if let Some(Err(error)) = result {
                let run = store.run(lease.run_id).await?;
                if run["status"] == "running" {
                    let code = runtime::error_code(&error);
                    let retry = matches!(
                        code,
                        "provider_retryable"
                            | "provider_unavailable"
                            | "provider_rate_limited"
                            | "empty_model_response"
                            | "platform_tool_unavailable"
                            | "execution_context_unavailable"
                    ) && run["consecutive_failures"]
                        .as_i64()
                        .unwrap_or(config.max_attempts)
                        + 1
                        < config.max_attempts;
                    let _ = store
                        .finish(
                            &lease,
                            if retry { "retry_wait" } else { "failed" },
                            "",
                            Some(code),
                        )
                        .await;
                    let provider_metadata = error
                        .chain()
                        .map(ToString::to_string)
                        .find(|s| s.starts_with("provider_error_kind="))
                        .unwrap_or_default();
                    tracing::warn!(run_id=%lease.run_id,error_code=code,provider_metadata,"Agent V2 run did not complete");
                }
            }
        } else {
            tokio::select! {_=tokio::signal::ctrl_c()=>break,_=tokio::time::sleep(Duration::from_millis(500))=>{}}
        }
    }
    Ok(())
}
