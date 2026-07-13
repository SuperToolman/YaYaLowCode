use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub run_uuid: String,
    pub session_id: Uuid,
    pub status: String,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    #[sea_orm(column_type = "Text", nullable)]
    pub error_message: Option<String>,
    pub started_at: DateTimeUtc,
    pub completed_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
