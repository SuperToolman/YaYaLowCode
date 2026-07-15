//! SeaORM persistence mappings. Business modules depend on these mappings only at their
//! repository boundary.

pub mod agent_message_entity;
pub mod agent_run_entity;
pub mod agent_run_step_entity;
pub mod agent_session_entity;
pub mod app_entity;
pub mod app_navigation_entity;
pub mod automation_edge_entity;
pub mod automation_flow_entity;
pub mod automation_flow_version_entity;
pub mod automation_node_entity;
pub mod automation_run_entity;
pub mod automation_run_node_entity;
pub mod form_definition_entity;
pub mod form_record_entity;
pub mod form_schema_entity;
pub mod iam_external_identity_entity;
pub mod iam_organization_membership_entity;
pub mod iam_role_entity;
pub mod iam_user_entity;
pub mod iam_user_role_entity;
pub mod organization_unit_entity;
