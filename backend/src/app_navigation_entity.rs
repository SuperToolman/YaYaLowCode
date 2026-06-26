use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "app_navigation_items")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub app_route_app_id: String,
    pub item_type: String,
    pub target_form_uuid: Option<String>,
    pub title: String,
    pub path_slug: String,
    pub sort_order: i32,
    pub is_default_entry: bool,
    pub parent_id: Option<Uuid>,
    pub visibility_rule: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
