use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_flows")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub flow_uuid: String,
    pub app_route_app_id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub current_version: i32,
    pub trigger_form_uuid: Option<String>,
    pub trigger_event: String,
    pub trigger_config: Json,
    pub nodes_json: Json,
    pub edges_json: Json,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
