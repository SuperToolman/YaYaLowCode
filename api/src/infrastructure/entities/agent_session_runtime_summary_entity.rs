use sea_orm::entity::prelude::*;

use super::agent_session_entity;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_session_runtime_summaries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: Uuid,
    pub event_generation: String,
    pub last_event_seq: i64,
    pub run_status: String,
    pub phase: Option<String>,
    pub last_tool_name: Option<String>,
    pub last_error: Option<String>,
    pub pending_approval_count: i32,
    pub unread_activity_version: i64,
    pub last_activity_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "agent_session_entity::Entity",
        from = "Column::SessionId",
        to = "agent_session_entity::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Session,
}

impl Related<agent_session_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Session.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
