use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_instances")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub instance_uuid: String,
    pub form_uuid: String,
    pub record_uuid: String,
    pub process_flow_id: Uuid,
    pub flow_version: i32,
    pub status: String,
    pub current_node_key: Option<String>,
    pub submitter: String,
    pub started_at: DateTimeUtc,
    pub completed_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
