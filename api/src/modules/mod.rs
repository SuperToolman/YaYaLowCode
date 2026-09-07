//! Business capabilities of the low-code platform.
//!
//! Each module owns a product domain. HTTP registration remains in `http`, while
//! persistence mappings remain in `infrastructure`.

pub mod agent_config;
pub mod agent_files;
pub mod agents;
pub mod app_market;
pub mod apps;
pub mod automations;
pub mod byom;
pub mod communication;
pub mod dingtalk;
pub mod files;
pub mod forms;
pub mod identity;
pub mod locations;
pub mod logs;
pub mod navigation;
pub mod recycle_bin;
pub mod settings;
pub mod workflows;
