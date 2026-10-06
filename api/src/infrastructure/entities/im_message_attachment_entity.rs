use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "im_message_attachments")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub message_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub file_id: Uuid,
    pub created_at: DateTimeUtc,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
