//! Application-wide runtime state shared by HTTP handlers.

use std::collections::{BTreeMap, HashSet};
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
    event_bus: LocalEventBus,
    pub(crate) im_metrics: ImMetrics,
    communication_memberships: Arc<RwLock<HashSet<(String, Uuid)>>>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ImDeliveryEvent {
    pub(crate) event: String,
    #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub(crate) user_id: Option<String>,
    #[serde(rename = "conversationId", skip_serializing_if = "Option::is_none")]
    pub(crate) conversation_id: Option<String>,
    #[serde(rename = "conversationSeq", skip_serializing_if = "Option::is_none")]
    pub(crate) conversation_seq: Option<i64>,
    #[serde(rename = "mailboxSeq", skip_serializing_if = "Option::is_none")]
    pub(crate) mailbox_seq: Option<i64>,
    #[serde(rename = "localId", skip_serializing_if = "Option::is_none")]
    pub(crate) local_id: Option<String>,
    #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
    pub(crate) message_id: Option<String>,
    pub(crate) data: serde_json::Value,
}

#[derive(Clone, Default)]
pub(crate) struct ImMetrics {
    counters: Arc<RwLock<BTreeMap<&'static str, u64>>>,
}

impl ImMetrics {
    pub(crate) fn inc(&self, name: &'static str) {
        if let Ok(mut counters) = self.counters.write() {
            *counters.entry(name).or_default() += 1;
        }
    }

    pub(crate) fn snapshot(&self) -> BTreeMap<&'static str, u64> {
        self.counters
            .read()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}

pub(crate) trait EventBus: Send + Sync {
    fn publish(
        &self,
        event: ImDeliveryEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>>;
    fn subscribe(&self) -> broadcast::Receiver<ImDeliveryEvent>;
}

#[derive(Clone)]
pub(crate) struct LocalEventBus {
    sender: broadcast::Sender<ImDeliveryEvent>,
}

impl EventBus for LocalEventBus {
    fn publish(
        &self,
        event: ImDeliveryEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            self.sender
                .send(event)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    }

    fn subscribe(&self) -> broadcast::Receiver<ImDeliveryEvent> {
        self.sender.subscribe()
    }
}

impl LocalEventBus {
    pub(crate) fn publish_now(&self, event: ImDeliveryEvent) {
        let _ = self.sender.send(event);
    }
}

impl AppState {
    pub(crate) fn new(
        db: DatabaseConnection,
        valkey: Option<ConnectionManager>,
        cache_ttl_seconds: u64,
        shutdown: watch::Sender<bool>,
    ) -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self {
            db,
            valkey,
            cache_ttl_seconds,
            shutdown,
            restart_pending: Arc::new(AtomicBool::new(false)),
            event_bus: LocalEventBus { sender },
            im_metrics: ImMetrics::default(),
            communication_memberships: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub(crate) fn publish_communication_event<T: Serialize>(&self, event_type: &str, data: &T) {
        if let Ok(data) = serde_json::to_value(data) {
            let string_field = |name: &str| {
                data.get(name)
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            };
            let number_field = |name: &str| data.get(name).and_then(serde_json::Value::as_i64);
            self.event_bus.publish_now(ImDeliveryEvent {
                event: event_type.to_string(),
                request_id: string_field("requestId"),
                user_id: string_field("userId"),
                conversation_id: string_field("conversationId"),
                conversation_seq: number_field("conversationSeq"),
                mailbox_seq: number_field("mailboxSeq"),
                local_id: string_field("localId"),
                message_id: string_field("messageId"),
                data,
            });
        }
    }

    pub(crate) fn subscribe_communication_events(&self) -> broadcast::Receiver<ImDeliveryEvent> {
        self.event_bus.subscribe()
    }

    pub(crate) fn shutdown_receiver(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
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
