//! Exact snippet identity, independent of stored-byte integrity hashes.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

pub(super) fn key(text: &str) -> String {
    let normalized: String = text.replace("\r\n", "\n").replace('\r', "\n").nfc().collect();
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}

pub(super) fn expand(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter().flat_map(|mut row| {
        let sources = row.as_object_mut().and_then(|v| v.remove("_sources"));
        let score = row["score"].clone();
        let mut result = vec![row];
        if let Some(Value::Array(sources)) = sources {
            result.extend(sources.into_iter().map(|mut source| {
                source["score"] = score.clone();
                source
            }));
        }
        result
    }).collect()
}

/// Input is ranked; first occurrence wins, copies never boost its score.
pub(super) fn group(rows: Vec<Value>) -> Vec<Value> {
    let mut positions = HashMap::new();
    let mut groups: Vec<Value> = Vec::new();
    for row in expand(rows) {
        let hash = key(row["body"].as_str().unwrap_or(""));
        if let Some(&index) = positions.get(&hash) {
            let primary: &mut Value = &mut groups[index];
            if primary["chunk"] == row["chunk"] { continue; }
            if primary["_sources"].is_null() { primary["_sources"] = Value::Array(vec![]); }
            let sources = primary["_sources"].as_array_mut().unwrap();
            if !sources.iter().any(|v| v["chunk"] == row["chunk"]) { sources.push(row); }
        } else {
            positions.insert(hash, groups.len());
            groups.push(row);
        }
    }
    groups
}
