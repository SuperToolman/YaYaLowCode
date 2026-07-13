//! A small build-script-free compatibility implementation of `mime_guess`.
//!
//! The upstream crate generates reverse MIME mappings from `build.rs`. Some managed
//! Windows environments prohibit executing unsigned Cargo build-script binaries.
//! Rig and Reqwest only need forward extension lookup, so this local patch keeps the
//! public operations they use without requiring a custom build command.

pub extern crate mime;
pub use mime::Mime;

use std::ffi::OsStr;
use std::path::Path;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct MimeGuess(Option<&'static str>);

impl MimeGuess {
    pub fn from_ext(ext: &str) -> Self {
        Self(extension_mime(ext))
    }

    pub fn from_path<P: AsRef<Path>>(path: P) -> Self {
        path.as_ref()
            .extension()
            .and_then(OsStr::to_str)
            .map(Self::from_ext)
            .unwrap_or(Self(None))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_none()
    }

    pub fn count(&self) -> usize {
        usize::from(self.0.is_some())
    }

    pub fn first(&self) -> Option<Mime> {
        self.0.and_then(|value| value.parse().ok())
    }

    pub fn first_raw(&self) -> Option<&'static str> {
        self.0
    }

    pub fn first_or_octet_stream(&self) -> Mime {
        self.first_or(mime::APPLICATION_OCTET_STREAM)
    }

    pub fn first_or_text_plain(&self) -> Mime {
        self.first_or(mime::TEXT_PLAIN)
    }

    pub fn first_or(&self, default: Mime) -> Mime {
        self.first().unwrap_or(default)
    }

    pub fn first_or_else<F>(&self, default: F) -> Mime
    where
        F: FnOnce() -> Mime,
    {
        self.first().unwrap_or_else(default)
    }
}

pub fn from_ext(ext: &str) -> MimeGuess {
    MimeGuess::from_ext(ext)
}

pub fn from_path<P: AsRef<Path>>(path: P) -> MimeGuess {
    MimeGuess::from_path(path)
}

fn extension_mime(ext: &str) -> Option<&'static str> {
    match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "json" => Some("application/json"),
        "pdf" => Some("application/pdf"),
        "zip" => Some("application/zip"),
        "xml" => Some("application/xml"),
        "csv" => Some("text/csv"),
        "txt" | "log" | "md" => Some("text/plain"),
        "html" | "htm" => Some("text/html"),
        "css" => Some("text/css"),
        "js" | "mjs" => Some("text/javascript"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "doc" => Some("application/msword"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xls" => Some("application/vnd.ms-excel"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "ppt" => Some("application/vnd.ms-powerpoint"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        _ => None,
    }
}
