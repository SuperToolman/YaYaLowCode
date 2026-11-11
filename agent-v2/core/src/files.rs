//! Immutable, session-owned workspace objects. No caller-controlled filesystem paths.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_WORKSPACE_BYTES: i64 = 100 * 1024 * 1024;
pub const MAX_WORKSPACE_FILES: i64 = 200;

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentV2File {
    pub id: Uuid,
    pub session_id: Uuid,
    pub name: String,
    pub mime_type: String,
    pub size: i64,
    pub sha256: String,
    pub source: String,
    pub created_at: String,
    pub download_url: String,
}
#[derive(Serialize, ToSchema)]
pub struct AgentV2Files {
    pub items: Vec<AgentV2File>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadAgentV2File {
    pub client_file_id: Uuid,
    pub name: String,
    /// Base64 bytes only, without a data URL prefix. Maximum decoded size: 8 MiB.
    pub data: String,
}

pub fn validate_name(name: &str) -> Result<(), &'static str> {
    if name.trim().is_empty()
        || name.len() > 240
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '\0'))
    {
        return Err("文件名无效，不能包含路径或控制字符");
    }
    Ok(())
}

/// Browser MIME declarations are never trusted. Only signature-verified raster images render inline.
pub fn detected_mime(name: &str, bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "image/png";
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return "image/jpeg";
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    if bytes.starts_with(b"%PDF-") {
        return "application/pdf";
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if [
        "txt", "md", "csv", "tsv", "json", "yaml", "yml", "xml", "log", "rs", "py", "js", "ts",
    ]
    .contains(&ext.as_str())
        && std::str::from_utf8(bytes).is_ok()
        && !bytes.contains(&0)
    {
        return match ext.as_str() {
            "csv" => "text/csv",
            "json" => "application/json",
            _ => "text/plain",
        };
    }
    "application/octet-stream"
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_does_not_trust_extensions() {
        for name in ["../secret", "C:\\secret", "a/b", "a\r\nx", "..", ""] {
            assert!(validate_name(name).is_err());
        }
        assert!(validate_name("季度报价.csv").is_ok());
        assert_eq!(
            detected_mime("fake.png", b"<script>bad</script>"),
            "application/octet-stream"
        );
        assert_eq!(
            detected_mime("test.svg", b"<svg/>"),
            "application/octet-stream"
        );
        assert_eq!(detected_mime("a.csv", b"a,b\n1,2"), "text/csv");
    }
}
