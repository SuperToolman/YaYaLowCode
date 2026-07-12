//! Business capabilities of the low-code platform.
//!
//! Each module owns a product domain. HTTP registration remains in `http`, while
//! persistence mappings remain in `infrastructure`.

pub mod apps;
pub mod automations;
pub mod forms;
pub mod navigation;
pub mod settings;
