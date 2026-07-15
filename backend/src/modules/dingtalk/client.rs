use reqwest::Client;

use crate::platform::error::AppError;

use std::collections::{HashMap, HashSet, VecDeque};

use super::dto::{
    AccessTokenRequest, AccessTokenResult, DepartmentListRequest, DepartmentListResponse,
    DingTalkDepartment, DingTalkUser, UserDetailRequest, UserDetailResponse, UserListRequest,
    UserListResponse,
};

const ACCESS_TOKEN_URL: &str = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const DEPARTMENT_LIST_URL: &str = "https://oapi.dingtalk.com/topapi/v2/department/listsub";
const USER_LIST_URL: &str = "https://oapi.dingtalk.com/topapi/v2/user/list";
const USER_DETAIL_URL: &str = "https://oapi.dingtalk.com/topapi/v2/user/get";

pub(super) async fn request_access_token(
    client_id: &str,
    client_secret: &str,
) -> Result<AccessTokenResult, AppError> {
    let response = Client::new()
        .post(ACCESS_TOKEN_URL)
        .json(&AccessTokenRequest {
            app_key: client_id,
            app_secret: client_secret,
        })
        .send()
        .await
        .map_err(|error| AppError::BadRequest(format!("dingtalk request failed: {error}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| AppError::BadRequest(format!("dingtalk response failed: {error}")))?;
    if !status.is_success() {
        return Err(AppError::BadRequest(format!(
            "dingtalk access token request failed ({status}): {body}"
        )));
    }

    serde_json::from_str::<AccessTokenResult>(&body)
        .map_err(|error| AppError::BadRequest(format!("invalid dingtalk response: {error}")))
}

pub(super) async fn list_all_departments(
    access_token: &str,
) -> Result<Vec<DingTalkDepartment>, AppError> {
    let client = Client::new();
    let mut queue = VecDeque::from([1_i64]);
    let mut visited = HashSet::new();
    let mut departments = Vec::new();

    while let Some(parent_id) = queue.pop_front() {
        if !visited.insert(parent_id) {
            continue;
        }
        if visited.len() > 10_000 {
            return Err(AppError::BadRequest(
                "dingtalk department hierarchy exceeds limit".to_string(),
            ));
        }

        let response = client
            .post(DEPARTMENT_LIST_URL)
            .query(&[("access_token", access_token)])
            .json(&DepartmentListRequest {
                dept_id: parent_id,
                language: "zh_CN",
            })
            .send()
            .await
            .map_err(|error| {
                AppError::BadRequest(format!("dingtalk department request failed: {error}"))
            })?;
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            AppError::BadRequest(format!("dingtalk department response failed: {error}"))
        })?;
        if !status.is_success() {
            return Err(AppError::BadRequest(format!(
                "dingtalk department request failed ({status}): {body}"
            )));
        }

        let payload = serde_json::from_str::<DepartmentListResponse>(&body).map_err(|error| {
            AppError::BadRequest(format!("invalid dingtalk department response: {error}"))
        })?;
        if payload.errcode != 0 {
            return Err(AppError::BadRequest(format!(
                "dingtalk department request failed: {} ({})",
                payload.errmsg, payload.errcode
            )));
        }
        for department in payload.result {
            queue.push_back(department.dept_id);
            departments.push(department);
        }
    }

    Ok(departments)
}

pub(super) async fn list_users_for_departments(
    access_token: &str,
    department_ids: &[i64],
) -> Result<Vec<DingTalkUser>, AppError> {
    let client = Client::new();
    let mut users = HashMap::<String, DingTalkUser>::new();

    for department_id in department_ids {
        let mut cursor = 0_i64;
        loop {
            let response = client
                .post(USER_LIST_URL)
                .query(&[("access_token", access_token)])
                .json(&UserListRequest {
                    dept_id: *department_id,
                    cursor,
                    size: 100,
                    order_field: "entry_asc",
                    contain_access_limit: false,
                    language: "zh_CN",
                })
                .send()
                .await
                .map_err(|error| {
                    AppError::BadRequest(format!("dingtalk user request failed: {error}"))
                })?;
            let status = response.status();
            let body = response.text().await.map_err(|error| {
                AppError::BadRequest(format!("dingtalk user response failed: {error}"))
            })?;
            if !status.is_success() {
                return Err(AppError::BadRequest(format!(
                    "dingtalk user request failed ({status}): {body}"
                )));
            }

            let payload = serde_json::from_str::<UserListResponse>(&body).map_err(|error| {
                AppError::BadRequest(format!("invalid dingtalk user response: {error}"))
            })?;
            if payload.errcode != 0 {
                return Err(AppError::BadRequest(format!(
                    "dingtalk user request failed: {} ({})",
                    payload.errmsg, payload.errcode
                )));
            }
            let result = payload.result.ok_or_else(|| {
                AppError::BadRequest("dingtalk user response has no result".to_string())
            })?;
            for user in result.list {
                if user.userid.is_empty() {
                    continue;
                }
                users
                    .entry(user.userid.clone())
                    .and_modify(|existing| {
                        for department_id in &user.dept_id_list {
                            if !existing.dept_id_list.contains(department_id) {
                                existing.dept_id_list.push(*department_id);
                            }
                        }
                    })
                    .or_insert(user);
            }
            if !result.has_more {
                break;
            }
            if result.next_cursor == cursor {
                return Err(AppError::BadRequest(
                    "dingtalk user pagination cursor did not advance".to_string(),
                ));
            }
            cursor = result.next_cursor;
        }
    }

    let mut detailed_users = Vec::with_capacity(users.len());
    for summary in users.into_values() {
        match get_user_detail(&client, access_token, &summary.userid).await {
            Ok(mut detail) => {
                if detail.dept_id_list.is_empty() {
                    detail.dept_id_list = summary.dept_id_list;
                }
                detailed_users.push(detail);
            }
            Err(_) => detailed_users.push(summary),
        }
    }

    Ok(detailed_users)
}

async fn get_user_detail(
    client: &Client,
    access_token: &str,
    user_id: &str,
) -> Result<DingTalkUser, AppError> {
    let response = client
        .post(USER_DETAIL_URL)
        .query(&[("access_token", access_token)])
        .json(&UserDetailRequest {
            userid: user_id,
            language: "zh_CN",
        })
        .send()
        .await
        .map_err(|error| AppError::BadRequest(format!("dingtalk user detail failed: {error}")))?;
    let body = response
        .text()
        .await
        .map_err(|error| AppError::BadRequest(format!("dingtalk user detail failed: {error}")))?;
    let payload = serde_json::from_str::<UserDetailResponse>(&body).map_err(|error| {
        AppError::BadRequest(format!("invalid dingtalk user detail response: {error}"))
    })?;
    if payload.errcode != 0 {
        return Err(AppError::BadRequest(format!(
            "dingtalk user detail failed: {} ({})",
            payload.errmsg, payload.errcode
        )));
    }
    payload
        .result
        .ok_or_else(|| AppError::BadRequest("dingtalk user detail has no result".to_string()))
}
