//! Per-run state kept while executing an automation graph.

use std::collections::HashMap;

use serde_json::Value;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct AutomationExecutionContext {
    pub(crate) outputs: HashMap<String, Value>,
    pub(crate) operator: String,
    pub(crate) run_id: Option<Uuid>,
}
