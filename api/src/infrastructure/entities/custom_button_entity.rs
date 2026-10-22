use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "app_custom_buttons")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub button_uuid: String,
    pub app_route_app_id: String,
    pub form_uuid: String,
    pub name: String,
    pub icon: Option<String>,
    pub description: String,
    pub action_type: String,
    pub action_config: Json,
    pub availability: Json,
    pub disabled_reason: String,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
