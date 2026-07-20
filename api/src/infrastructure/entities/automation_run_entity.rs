use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_flow_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub run_uuid: String,
    pub flow_id: Uuid,
    pub flow_version: i32,
    pub trigger_event: String,
    pub trigger_payload: Json,
    pub status: String,
    pub retry_source: Option<String>,
    pub retry_run_uuid: Option<String>,
    pub retry_node_key: Option<String>,
    pub error_message: Option<String>,
    pub started_at: DateTimeUtc,
    pub finished_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
