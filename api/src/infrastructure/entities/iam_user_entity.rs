use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "iam_users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub display_name: String,
    pub mobile: Option<String>,
    pub state_code: Option<String>,
    pub telephone: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub job_number: Option<String>,
    pub title: Option<String>,
    pub work_place: Option<String>,
    pub remark: Option<String>,
    pub hired_at: Option<DateTimeUtc>,
    pub manager_external_user_id: Option<String>,
    pub primary_organization_unit_id: Option<Uuid>,
    pub senior: bool,
    pub is_admin: bool,
    pub is_boss: bool,
    pub real_authed: bool,
    pub extension_json: Json,
    pub status: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
