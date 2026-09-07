use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_files")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub session_id: Uuid,
    pub owner_user_id: Uuid,
    pub agent_id: String,
    pub original_name: String,
    pub storage_key: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub checksum: String,
    pub kind: String,
    pub created_at: DateTimeUtc,
    pub expires_at: Option<DateTimeUtc>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
