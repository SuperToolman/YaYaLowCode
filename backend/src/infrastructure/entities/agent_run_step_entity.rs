use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_run_steps")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub run_id: Uuid,
    pub step_index: i32,
    pub step_type: String,
    pub name: String,
    pub input_json: Json,
    pub output_json: Json,
    pub status: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub error_message: Option<String>,
    pub started_at: DateTimeUtc,
    pub completed_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
