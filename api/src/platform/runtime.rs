//! Application-wide runtime state shared by HTTP handlers.

use std::collections::HashSet;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use sea_orm::DatabaseConnection;
use serde::{Serialize, de::DeserializeOwned};
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: DatabaseConnection,
    pub(crate) valkey: Option<ConnectionManager>,
    cache_ttl_seconds: u64,
    shutdown: watch::Sender<bool>,
    restart_pending: Arc<AtomicBool>,
    communication_events: broadcast::Sender<String>,
    communication_memberships: Arc<RwLock<HashSet<(String, Uuid)>>>,
}

impl AppState {
    pub(crate) fn new(
        db: DatabaseConnection,
        valkey: Option<ConnectionManager>,
        cache_ttl_seconds: u64,
        shutdown: watch::Sender<bool>,
    ) -> Self {
        let (communication_events, _) = broadcast::channel(1024);
        Self {
            db,
            valkey,
            cache_ttl_seconds,
            shutdown,
            restart_pending: Arc::new(AtomicBool::new(false)),
            communication_events,
            communication_memberships: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub(crate) fn publish_communication_event<T: Serialize>(&self, event_type: &str, data: &T) {
        if let Ok(value) =
            serde_json::to_string(&serde_json::json!({ "type": event_type, "data": data }))
        {
            let _ = self.communication_events.send(value);
        }
    }

    pub(crate) fn subscribe_communication_events(&self) -> broadcast::Receiver<String> {
        self.communication_events.subscribe()
    }

    pub(crate) fn communication_membership_cached(
        &self,
        conversation_id: &str,
        user_id: Uuid,
    ) -> bool {
        self.communication_memberships
            .read()
            .is_ok_and(|cache| cache.contains(&(conversation_id.to_string(), user_id)))
    }

    pub(crate) fn cache_communication_membership(&self, conversation_id: &str, user_id: Uuid) {
        if let Ok(mut cache) = self.communication_memberships.write() {
            cache.insert((conversation_id.to_string(), user_id));
        }
    }

    pub(crate) fn invalidate_communication_memberships(&self, conversation_id: &str) {
        if let Ok(mut cache) = self.communication_memberships.write() {
            cache.retain(|(cached_conversation_id, _)| cached_conversation_id != conversation_id);
        }
    }

    /// Cache failures are deliberately non-fatal: PostgreSQL remains the source of truth.
    pub(crate) async fn cache_get_json<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let mut connection = self.valkey.clone()?;
        let value = connection.get::<_, Option<String>>(key).await.ok()??;
        serde_json::from_str(&value).ok()
    }

    pub(crate) async fn cache_get_text(&self, key: &str) -> Option<String> {
        let mut connection = self.valkey.clone()?;
        connection.get(key).await.ok().flatten()
    }

    pub(crate) async fn cache_set_text(&self, key: &str, value: String, ttl_seconds: u64) {
        if value.len() > 1_048_576 {
            return;
        }
        let Some(mut connection) = self.valkey.clone() else {
            return;
        };
        let _: Result<(), _> = connection.set_ex(key, value, ttl_seconds).await;
    }

    pub(crate) async fn cache_set_json<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        ttl_seconds: u64,
    ) {
        let Some(mut connection) = self.valkey.clone() else {
            return;
        };
        let Ok(payload) = serde_json::to_string(value) else {
            return;
        };
        if payload.len() > 1_048_576 {
            return;
        }
        let _: Result<(), _> = connection.set_ex(key, payload, ttl_seconds).await;
    }

    pub(crate) async fn cache_version(&self, key: &str) -> u64 {
        let Some(mut connection) = self.valkey.clone() else {
            return 0;
        };
        connection
            .get::<_, Option<u64>>(key)
            .await
            .ok()
            .flatten()
            .unwrap_or(0)
    }

    pub(crate) async fn bump_cache_version(&self, key: &str) {
        let Some(mut connection) = self.valkey.clone() else {
            return;
        };
        let _: Result<i64, _> = redis::cmd("INCR")
            .arg(key)
            .query_async(&mut connection)
            .await;
    }

    pub(crate) fn cache_ttl_seconds(&self) -> u64 {
        self.cache_ttl_seconds
    }

    pub(crate) fn schedule_restart(&self) -> Result<(), std::io::Error> {
        if self.restart_pending.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let executable = std::env::current_exe()?;
        let current_dir = std::env::current_dir()?;
        let mut command = std::process::Command::new(executable);
        command
            .args(std::env::args_os().skip(1))
            .current_dir(current_dir)
            .env("YAYA_RESTART_DELAY_MS", "1200");

        if let Err(error) = command.spawn() {
            self.restart_pending.store(false, Ordering::SeqCst);
            return Err(error);
        }

        let shutdown = self.shutdown.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = shutdown.send(true);
        });

        Ok(())
    }
}
