//! Bounded native office document tools. Text extraction, never macro/script execution.
pub mod limits;
mod package;
mod read;
mod write;
use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
pub const MAX_INPUT: usize = 8 * 1024 * 1024;
pub const MAX_RESULT: usize = 192 * 1024;
pub fn handle(input: Value) -> Result<Value> {
    match input["operation"].as_str() {
        Some("extract_knowledge") => {
            let data = input["data"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("office_missing_data"))?;
            ensure!(data.len() <= 12 * 1024 * 1024, "office_input_limit");
            let bytes = STANDARD.decode(data.replace(['\r', '\n'], ""))?;
            ensure!(
                !bytes.is_empty() && bytes.len() <= MAX_INPUT,
                "office_input_limit"
            );
            read::extract_knowledge(input["name"].as_str().unwrap_or(""), &bytes)
        }
        Some("read") | Some("preview") => {
            let data = input["data"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("office_missing_data"))?;
            // PostgreSQL encode(bytea, 'base64') wraps lines at 76 characters.
            // Bound the raw input before allocating, then enforce the binary limit below.
            ensure!(data.len() <= 12 * 1024 * 1024, "office_input_limit");
            let data = data.replace(['\r', '\n'], "");
            ensure!(
                data.len() <= MAX_INPUT.div_ceil(3) * 4,
                "office_input_limit"
            );
            let bytes = STANDARD.decode(&data)?;
            ensure!(
                !bytes.is_empty() && bytes.len() <= MAX_INPUT,
                "office_input_limit"
            );
            let mut result = read::read(
                input["name"].as_str().unwrap_or(""),
                &bytes,
                &input["options"],
            )?;
            if input["operation"] == "preview" {
                result = bounded_preview(result);
            }
            ensure!(
                result.to_string().len() <= MAX_RESULT,
                "office_result_limit_reduce_page_size"
            );
            Ok(result)
        }
        Some("write") => {
            ensure!(
                input["document"].to_string().len() <= 192 * 1024,
                "office_document_limit"
            );
            let bytes = write::write(input["name"].as_str().unwrap_or(""), &input["document"])?;
            ensure!(bytes.len() <= MAX_INPUT, "office_output_limit");
            Ok(json!({"data":STANDARD.encode(bytes)}))
        }
        _ => anyhow::bail!("office_unknown_operation"),
    }
}

/// A sample is explicitly distinct from a full document, even after truncation.
fn bounded_preview(mut result: Value) -> Value {
    fn shorten(value: &mut Value, changed: &mut bool) {
        match value {
            Value::String(s) if s.len() > 512 => {
                *s = s.chars().take(128).collect();
                *changed = true;
            }
            Value::Array(items) => {
                for item in items {
                    shorten(item, changed);
                }
            }
            Value::Object(items) => {
                for item in items.values_mut() {
                    shorten(item, changed);
                }
            }
            _ => {}
        }
    }
    let mut changed = false;
    shorten(&mut result, &mut changed);
    while result.to_string().len() > 7000 {
        let key = ["rows", "units", "sheets"]
            .into_iter()
            .find(|key| result[*key].as_array().is_some_and(|a| !a.is_empty()));
        if let Some(key) = key {
            result[key].as_array_mut().unwrap().pop();
            changed = true;
        } else {
            result = json!({"format":result["format"],"complete":false,"sampleOmitted":true});
            changed = true;
            break;
        }
    }
    if changed {
        result["complete"] = json!(false);
    }
    result["sampleTruncated"] = json!(changed);
    result["sampleOnly"] = json!(true);
    result["untrustedContent"] = json!(true);
    result["continueReading"] = json!(
        "Use workspace_read_file for remaining rows, sheets or pages; a sample is not the full file."
    );
    result
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    #[test]
    fn postgres_wrapped_base64_is_accepted_without_accepting_invalid_symbols() {
        let text = "a,b\n1,2\n".repeat(30);
        let encoded = STANDARD.encode(text);
        let wrapped = encoded
            .as_bytes()
            .chunks(76)
            .map(|part| std::str::from_utf8(part).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        for data in [&encoded, &wrapped, &wrapped.replace('\n', "\r\n")] {
            let sample = handle(json!({"operation":"preview","name":"test.csv","data":data,"options":{"start":1,"limit":10,"columns":8}})).unwrap();
            assert_eq!(sample["sampleOnly"], true);
        }
        assert!(handle(json!({"operation":"preview","name":"test.csv","data":format!("{encoded}!"),"options":{}})).is_err());
    }
    #[test]
    fn bounded_json_sample_never_claims_truncated_content_is_complete() {
        let result = bounded_preview(
            json!({"complete":true,"rows":(0..10).map(|i|json!({"row":i,"cells":vec!["中".repeat(2000);8]})).collect::<Vec<_>>()}),
        );
        assert!(result.to_string().len() < 8192);
        assert_eq!(result["complete"], false);
        assert_eq!(result["sampleTruncated"], true);
    }
}

pub fn extension(name: &str) -> String {
    name.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}
