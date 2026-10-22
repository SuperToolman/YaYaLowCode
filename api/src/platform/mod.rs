//! Cross-cutting platform configuration and runtime concerns.

pub mod api;
pub mod authorization;
pub mod automation_runs;
pub mod config;
pub mod error;
pub mod form_storage;
pub mod license;
pub mod logging;
pub mod prelude;
pub mod rbac;
pub mod records;
pub mod runtime;

pub mod record_validation;

#[cfg(test)]
mod record_validation_database_tests;

pub mod platform_permissions;
