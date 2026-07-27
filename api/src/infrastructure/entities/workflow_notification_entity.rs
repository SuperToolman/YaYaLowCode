use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_notifications")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)] pub id: Uuid,
    #[sea_orm(unique)] pub notification_uuid: String,
    pub recipient_user_id: Option<Uuid>, pub recipient: String,
    pub form_uuid: String, pub record_uuid: String, pub instance_id: Uuid,
    pub task_id: Option<Uuid>, pub notification_type: String,
    pub title: String, pub content: String, pub read_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)] pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
