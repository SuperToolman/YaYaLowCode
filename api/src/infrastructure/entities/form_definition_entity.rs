use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "form_definitions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub app_route_app_id: String,
    #[sea_orm(unique)]
    pub form_uuid: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    pub draft_schema_version: i32,
    pub published_schema_version: i32,
    pub latest_schema_version: i32,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
