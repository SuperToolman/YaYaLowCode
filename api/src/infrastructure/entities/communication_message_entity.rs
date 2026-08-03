use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "communication_messages")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub message_uuid: String,
    pub conversation_id: Uuid,
    pub sender_user_id: Uuid,
    pub sequence: i64,
    pub client_message_id: Option<String>,
    pub message_type: String,
    pub content: String,
    pub metadata_json: Json,
    pub status: String,
    pub recalled_at: Option<DateTimeUtc>,
    pub recalled_by_user_id: Option<Uuid>,
    pub replaces_message_id: Option<Uuid>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
