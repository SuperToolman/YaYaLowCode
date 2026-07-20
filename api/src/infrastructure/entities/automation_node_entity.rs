use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_nodes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub flow_id: Uuid,
    pub version: i32,
    pub node_key: String,
    pub node_kind: String,
    pub label: String,
    pub description: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub config_json: Json,
    pub raw_json: Json,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
