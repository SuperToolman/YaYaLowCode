//! Stores platform events in short-lived, newline-delimited JSON log files.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tracing::{
    Event, Subscriber,
    field::{Field, Visit},
};
use tracing_subscriber::{Layer, layer::Context};
use uuid::Uuid;

const QUEUE_CAPACITY: usize = 2_000;
const DEFAULT_RETENTION_DAYS: i64 = 7;
const LOG_FILE_PREFIX: &str = "platform-";
const LOG_FILE_SUFFIX: &str = ".ndjson";
static LOG_SENDER: OnceLock<mpsc::Sender<PlatformLogEvent>> = OnceLock::new();

pub(crate) struct PlatformLogLayer;

impl<S> Layer<S> for PlatformLogLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let metadata = event.metadata();
        let mut visitor = JsonVisitor::default();
        event.record(&mut visitor);
        let message = visitor
            .fields
            .remove("message")
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| metadata.name().to_string());
        if let Some(sender) = LOG_SENDER.get() {
            let _ = sender.try_send(PlatformLogEvent {
                id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                level: metadata.level().as_str().to_ascii_lowercase(),
                target: metadata.target().to_string(),
                message,
                fields: Value::Object(visitor.fields),
            });
        }
    }
}

pub(crate) fn start_persistence() {
    let (sender, mut receiver) = mpsc::channel(QUEUE_CAPACITY);
    if LOG_SENDER.set(sender).is_err() {
        return;
    }
    tokio::spawn(async move {
        let mut cleaned_for_date = None;
        while let Some(event) = receiver.recv().await {
            let log_date = event.occurred_at.date_naive();
            if cleaned_for_date != Some(log_date) {
                cleanup_expired_files().await;
                cleaned_for_date = Some(log_date);
            }
            let _ = append_event(&event).await;
        }
    });
}

pub(crate) async fn list_events(
    level: Option<&str>,
    offset: usize,
    limit: usize,
) -> Vec<PlatformLogEvent> {
    let mut paths = match log_files().await {
        Ok(paths) => paths,
        Err(_) => return Vec::new(),
    };
    paths.sort_by(|left, right| right.file_name().cmp(&left.file_name()));

    let mut events = Vec::new();
    for path in paths {
        let Ok(contents) = tokio::fs::read_to_string(path).await else {
            continue;
        };
        events.extend(
            contents
                .lines()
                .filter_map(|line| serde_json::from_str::<PlatformLogEvent>(line).ok()),
        );
    }
    events.retain(|event| level.is_none_or(|selected| event.level == selected));
    events.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
    events.into_iter().skip(offset).take(limit).collect()
}

pub(crate) async fn total_size_bytes() -> u64 {
    let Ok(paths) = log_files().await else {
        return 0;
    };
    let mut total: u64 = 0;
    for path in paths {
        if let Ok(metadata) = tokio::fs::metadata(path).await {
            total = total.saturating_add(metadata.len());
        }
    }
    total
}

pub(crate) async fn clear_events() -> std::io::Result<u64> {
    let mut cleared_bytes: u64 = 0;
    for path in log_files().await? {
        if let Ok(metadata) = tokio::fs::metadata(&path).await {
            cleared_bytes = cleared_bytes.saturating_add(metadata.len());
        }
        tokio::fs::remove_file(path).await?;
    }
    Ok(cleared_bytes)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformLogEvent {
    pub(crate) id: Uuid,
    pub(crate) occurred_at: DateTime<Utc>,
    pub(crate) level: String,
    pub(crate) target: String,
    pub(crate) message: String,
    pub(crate) fields: Value,
}

async fn append_event(event: &PlatformLogEvent) -> std::io::Result<()> {
    let directory = log_directory();
    tokio::fs::create_dir_all(&directory).await?;
    let path = directory.join(log_file_name(event.occurred_at.date_naive()));
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    let encoded = serde_json::to_vec(event).expect("platform log event is serializable");
    file.write_all(&encoded).await?;
    file.write_all(b"\n").await
}

async fn cleanup_expired_files() {
    let cutoff = Utc::now().date_naive() - chrono::Duration::days(retention_days());
    let Ok(paths) = log_files().await else { return };
    for path in paths {
        if file_date(&path).is_some_and(|date| date < cutoff) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
}

async fn log_files() -> std::io::Result<Vec<PathBuf>> {
    let mut directory = match tokio::fs::read_dir(log_directory()).await {
        Ok(directory) => directory,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut files = Vec::new();
    while let Some(entry) = directory.next_entry().await? {
        let path = entry.path();
        if entry.file_type().await?.is_file() && file_date(&path).is_some() {
            files.push(path);
        }
    }
    Ok(files)
}

fn log_directory() -> PathBuf {
    std::env::var_os("YAYA_LOG_DIRECTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("runtime/logs"))
}

fn retention_days() -> i64 {
    std::env::var("YAYA_LOG_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|days| *days > 0)
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

fn log_file_name(date: NaiveDate) -> String {
    format!("{LOG_FILE_PREFIX}{date}{LOG_FILE_SUFFIX}")
}

fn file_date(path: &Path) -> Option<NaiveDate> {
    let name = path.file_name()?.to_str()?;
    let date = name
        .strip_prefix(LOG_FILE_PREFIX)?
        .strip_suffix(LOG_FILE_SUFFIX)?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

#[derive(Default)]
struct JsonVisitor {
    fields: Map<String, Value>,
}

impl JsonVisitor {
    fn record_value(&mut self, field: &Field, value: Value) {
        self.fields.insert(field.name().to_string(), value);
    }
}

impl Visit for JsonVisitor {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.record_value(field, Value::Bool(value));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.record_value(field, Value::from(value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.record_value(field, Value::from(value));
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.record_value(field, Value::from(value));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.record_value(field, Value::String(value.to_string()));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.record_value(field, Value::String(format!("{value:?}")));
    }
}
