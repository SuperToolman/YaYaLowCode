use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub task_uuid: String,
    pub instance_id: Uuid,
    pub node_key: String,
    pub node_label: String,
    pub task_type: String,
    pub assignee: String,
    pub assignee_user_id: Option<Uuid>,
    pub status: String,
    pub comment: Option<String>,
    pub completed_by: Option<String>,
    pub completed_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
