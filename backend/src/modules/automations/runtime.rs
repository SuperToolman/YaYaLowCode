//! Per-run state kept while executing an automation graph.

use std::collections::HashMap;

use serde_json::Value;
use uuid::Uuid;

#[derive(Clone)]
pub(super) struct AutomationExecutionContext {
    pub(super) outputs: HashMap<String, Value>,
    pub(super) operator: String,
    pub(super) run_id: Option<Uuid>,
}
