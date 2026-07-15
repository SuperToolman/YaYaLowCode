use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccessTokenRequest<'a> {
    pub app_key: &'a str,
    pub app_secret: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccessTokenResult {
    pub access_token: String,
    pub expire_in: u64,
}

#[derive(Serialize)]
pub(super) struct DepartmentListRequest {
    pub dept_id: i64,
    pub language: &'static str,
}

#[derive(Deserialize)]
pub(super) struct DepartmentListResponse {
    #[serde(default)]
    pub errcode: i64,
    #[serde(default)]
    pub errmsg: String,
    #[serde(default)]
    pub result: Vec<DingTalkDepartment>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct DingTalkDepartment {
    pub dept_id: i64,
    pub name: String,
    pub parent_id: i64,
    #[serde(default)]
    pub order: i64,
}

#[derive(Serialize)]
pub(super) struct UserListRequest {
    pub dept_id: i64,
    pub cursor: i64,
    pub size: u32,
    pub order_field: &'static str,
    pub contain_access_limit: bool,
    pub language: &'static str,
}

#[derive(Serialize)]
pub(super) struct UserDetailRequest<'a> {
    pub userid: &'a str,
    pub language: &'static str,
}

#[derive(Deserialize)]
pub(super) struct UserDetailResponse {
    #[serde(default)]
    pub errcode: i64,
    #[serde(default)]
    pub errmsg: String,
    pub result: Option<DingTalkUser>,
}

#[derive(Deserialize)]
pub(super) struct UserListResponse {
    #[serde(default)]
    pub errcode: i64,
    #[serde(default)]
    pub errmsg: String,
    pub result: Option<UserListResult>,
}

#[derive(Deserialize)]
pub(super) struct UserListResult {
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub next_cursor: i64,
    #[serde(default)]
    pub list: Vec<DingTalkUser>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct DingTalkUser {
    #[serde(default)]
    pub userid: String,
    #[serde(default)]
    pub unionid: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub mobile: String,
    #[serde(default)]
    pub state_code: String,
    #[serde(default)]
    pub telephone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub org_email: String,
    #[serde(default)]
    pub job_number: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub work_place: String,
    #[serde(default)]
    pub remark: String,
    #[serde(default)]
    pub hired_date: i64,
    #[serde(default)]
    pub manager_userid: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub boss: bool,
    #[serde(default)]
    pub senior: bool,
    #[serde(default)]
    pub real_authed: bool,
    #[serde(default)]
    pub dept_id_list: Vec<i64>,
    #[serde(default)]
    pub dept_order_list: Vec<DingTalkDepartmentOrder>,
    #[serde(default)]
    pub role_list: Vec<DingTalkRole>,
    #[serde(default)]
    pub extension: Value,
    #[serde(default)]
    pub leader_in_dept: Value,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct DingTalkDepartmentOrder {
    #[serde(default)]
    pub dept_id: i64,
    #[serde(default)]
    pub order: i64,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct DingTalkRole {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub group_name: String,
}
