use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_flow_versions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub flow_id: Uuid,
    pub version: i32,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub trigger_form_uuid: Option<String>,
    pub trigger_event: String,
    pub trigger_config: Json,
    pub nodes_json: Json,
    pub edges_json: Json,
    pub change_summary: Option<String>,
    pub created_by: String,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
