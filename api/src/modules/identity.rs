use std::collections::{HashMap, HashSet};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use axum::Json;
use axum::extract::{Path, State};
use hmac::{Hmac, Mac};
use reqwest::Client;
use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use tracing::error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::entities::{
    iam_external_identity_entity, iam_local_credential_entity, iam_organization_membership_entity,
    iam_role_entity, iam_user_email_address_entity, iam_user_entity, iam_user_role_entity,
    organization_unit_entity,
};
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationUnitResponse {
    id: String,
    source_type: String,
    external_id: String,
    parent_external_id: Option<String>,
    name: String,
    status: String,
    member_count: usize,
    members: Vec<OrganizationMemberResponse>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationMemberResponse {
    id: String,
    display_name: String,
    avatar_url: Option<String>,
    title: Option<String>,
    status: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateLocalOrganizationUnitRequest {
    name: String,
    parent_external_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserResponse {
    id: String,
    username: Option<String>,
    display_name: String,
    mobile: Option<String>,
    state_code: Option<String>,
    telephone: Option<String>,
    email: Option<String>,
    email_addresses: Vec<EmailAddressResponse>,
    avatar_url: Option<String>,
    job_number: Option<String>,
    title: Option<String>,
    work_place: Option<String>,
    remark: Option<String>,
    hired_at: Option<String>,
    tenure_months: Option<i64>,
    manager_name: Option<String>,
    primary_department: Option<String>,
    senior: bool,
    is_admin: bool,
    is_boss: bool,
    real_authed: bool,
    extension_json: serde_json::Value,
    status: String,
    source_type: String,
    departments: Vec<String>,
    roles: Vec<String>,
    role_ids: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailAddressResponse {
    label: String,
    email: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoleResponse {
    id: String,
    source_type: String,
    external_id: String,
    name: String,
    status: String,
    member_count: usize,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DingTalkLoginRequest {
    #[serde(default)]
    union_id: String,
    #[serde(default)]
    open_id: String,
    #[serde(default)]
    nick: String,
    #[serde(default)]
    avatar_url: String,
    #[serde(default)]
    mobile: String,
    #[serde(default)]
    email: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DingTalkLoginUserResponse {
    id: String,
    username: String,
    display_name: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendSmsCodeRequest {
    pub mobile: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendSmsCodeResponse {
    pub expires_in: u64,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifySmsCodeRequest {
    pub mobile: String,
    pub code: String,
}

const SMS_CODE_TTL: u64 = 300;
const SMS_SEND_COOLDOWN: u64 = 60;

pub(crate) async fn send_sms_code(
    State(state): State<AppState>,
    Json(payload): Json<SendSmsCodeRequest>,
) -> Result<Json<ApiResponse<SendSmsCodeResponse>>, AppError> {
    let mobile = normalize_mobile(&payload.mobile)?;
    if state.valkey.is_none() {
        return Err(AppError::Server(std::io::Error::other("验证码服务未配置")));
    }
    let _user = find_mobile_user(&state, &mobile).await?;

    let cooldown_key = format!("yaya:sms:login:cooldown:{mobile}");
    if state.cache_get_text(&cooldown_key).await.is_some() {
        return Err(AppError::BadRequest(
            "验证码发送过于频繁，请稍后再试".to_string(),
        ));
    }
    let code = format!(
        "{:06}",
        u32::from_be_bytes(Uuid::new_v4().as_bytes()[..4].try_into().unwrap()) % 1_000_000
    );
    let code_key = format!("yaya:sms:login:code:{mobile}");
    state
        .cache_set_text(&code_key, code.clone(), SMS_CODE_TTL)
        .await;
    state
        .cache_set_text(&cooldown_key, "1".to_string(), SMS_SEND_COOLDOWN)
        .await;
    if let Err(error) = send_aliyun_sms(&mobile, &code).await {
        if let Some(mut connection) = state.valkey.clone() {
            let _: Result<(), _> = redis::cmd("DEL")
                .arg(&code_key)
                .query_async(&mut connection)
                .await;
            let _: Result<(), _> = redis::cmd("DEL")
                .arg(&cooldown_key)
                .query_async(&mut connection)
                .await;
        }
        return Err(error);
    }
    Ok(Json(success_response(
        "验证码已发送",
        SendSmsCodeResponse {
            expires_in: SMS_CODE_TTL,
        },
    )))
}

pub(crate) async fn verify_sms_code(
    State(state): State<AppState>,
    Json(payload): Json<VerifySmsCodeRequest>,
) -> Result<Json<ApiResponse<DingTalkLoginUserResponse>>, AppError> {
    let mobile = normalize_mobile(&payload.mobile)?;
    if payload.code.len() != 6 || !payload.code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::BadRequest("验证码格式不正确".to_string()));
    }
    let key = format!("yaya:sms:login:code:{mobile}");
    let stored = state.cache_get_text(&key).await;
    if stored.as_deref() != Some(payload.code.trim()) {
        return Err(AppError::BadRequest("验证码错误或已过期".to_string()));
    }
    let user = find_mobile_user(&state, &mobile).await?;
    if let Some(mut connection) = state.valkey.clone() {
        let _: Result<(), _> = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut connection)
            .await;
    }
    let username = iam_local_credential_entity::Entity::find()
        .filter(iam_local_credential_entity::Column::UserId.eq(user.id))
        .one(&state.db)
        .await?
        .map(|credential| credential.username)
        .unwrap_or_else(|| mobile.clone());
    Ok(Json(success_response(
        "登录验证成功",
        DingTalkLoginUserResponse {
            id: user.id.to_string(),
            username,
            display_name: user.display_name,
        },
    )))
}

async fn find_mobile_user(
    state: &AppState,
    mobile: &str,
) -> Result<iam_user_entity::Model, AppError> {
    let user = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::Mobile.eq(mobile))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("当前系统用户不存在该手机号".to_string()))?;
    if user.status != "active" {
        return Err(AppError::BadRequest(
            "当前手机号对应的系统用户已被禁用".to_string(),
        ));
    }
    Ok(user)
}

fn normalize_mobile(value: &str) -> Result<String, AppError> {
    let value = value.trim().replace([' ', '-'], "");
    let value = value.strip_prefix("+86").unwrap_or(&value);
    if value.len() != 11 || !value.chars().all(|c| c.is_ascii_digit()) || !value.starts_with('1') {
        return Err(AppError::BadRequest("手机号格式不正确".to_string()));
    }
    Ok(value.to_string())
}

async fn send_aliyun_sms(mobile: &str, code: &str) -> Result<(), AppError> {
    let access_key = std::env::var("ALIYUN_ACCESS_KEY_ID")
        .map_err(|_| AppError::Server(std::io::Error::other("短信服务未配置")))?;
    let access_secret = std::env::var("ALIYUN_ACCESS_KEY_SECRET")
        .map_err(|_| AppError::Server(std::io::Error::other("短信服务未配置")))?;
    let sign_name = std::env::var("ALIYUN_SMS_SIGN_NAME")
        .map_err(|_| AppError::Server(std::io::Error::other("短信服务未配置")))?;
    let template_code = std::env::var("ALIYUN_SMS_LOGIN_TEMPLATE_CODE")
        .map_err(|_| AppError::Server(std::io::Error::other("短信服务未配置")))?;
    let nonce = Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let mut params = vec![
        ("AccessKeyId", access_key.clone()),
        ("Action", "SendSms".into()),
        ("Format", "JSON".into()),
        ("PhoneNumbers", mobile.into()),
        (
            "RegionId",
            std::env::var("ALIYUN_SMS_REGION").unwrap_or_else(|_| "cn-hangzhou".into()),
        ),
        ("SignName", sign_name),
        ("SignatureMethod", "HMAC-SHA1".into()),
        ("SignatureNonce", nonce),
        ("SignatureVersion", "1.0".into()),
        ("TemplateCode", template_code),
        ("TemplateParam", format!("{{\"code\":\"{code}\"}}")),
        ("Timestamp", timestamp),
        ("Version", "2017-05-25".into()),
    ];
    params.sort_by(|a, b| a.0.cmp(b.0));
    let canonical = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let string_to_sign = format!("GET&%2F&{}", percent_encode(&canonical));
    let mut mac = Hmac::<Sha1>::new_from_slice(format!("{}&", access_secret).as_bytes())
        .map_err(|_| AppError::Server(std::io::Error::other("短信签名失败")))?;
    mac.update(string_to_sign.as_bytes());
    let signature = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        mac.finalize().into_bytes(),
    );
    params.push(("Signature", signature));
    let response = Client::new()
        .get("https://dysmsapi.aliyuncs.com/")
        .query(&params)
        .send()
        .await
        .map_err(|error| {
            error!(%error, "aliyun sms request failed");
            AppError::Server(std::io::Error::other("短信服务请求失败"))
        })?;
    let body: serde_json::Value = response.json().await.map_err(|error| {
        error!(%error, "aliyun sms response was invalid");
        AppError::Server(std::io::Error::other("短信服务响应无效"))
    })?;
    if body.get("Code").and_then(|v| v.as_str()) != Some("OK") {
        let code = body
            .get("Code")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown");
        let message = body
            .get("Message")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown error");
        error!(code, message, request_id = ?body.get("RequestId"), "aliyun sms rejected request");
        return Err(AppError::Server(std::io::Error::other(format!(
            "阿里云短信错误 [{code}]: {message}"
        ))));
    }
    Ok(())
}

fn percent_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateLocalRoleRequest {
    name: String,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UpdateLocalRoleRequest {
    name: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateUserRequest {
    display_name: Option<String>,
    mobile: Option<String>,
    telephone: Option<String>,
    email: Option<String>,
    job_number: Option<String>,
    title: Option<String>,
    work_place: Option<String>,
    remark: Option<String>,
    status: Option<String>,
    email_addresses: Option<Vec<EmailAddressRequest>>,
    role_ids: Option<Vec<String>>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateLocalUserRequest {
    username: String,
    password: String,
    display_name: String,
    mobile: Option<String>,
    email: Option<String>,
    title: Option<String>,
    role_ids: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeLocalCredentialsResponse {
    initialized: usize,
    already_configured: usize,
    skipped: Vec<InitializeLocalCredentialSkip>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeLocalCredentialSkip {
    user_id: String,
    display_name: String,
    reason: String,
}
#[derive(Deserialize, ToSchema)]
pub(crate) struct LocalLoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailAddressRequest {
    label: String,
    email: String,
}

pub(crate) async fn list_organization_units(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<OrganizationUnitResponse>>>, AppError> {
    let units = organization_unit_entity::Entity::find()
        .order_by_asc(organization_unit_entity::Column::SortOrder)
        .order_by_asc(organization_unit_entity::Column::Name)
        .all(&state.db)
        .await?;
    let memberships = iam_organization_membership_entity::Entity::find()
        .all(&state.db)
        .await?;
    let users = iam_user_entity::Entity::find().all(&state.db).await?;
    let users_by_id = users
        .into_iter()
        .map(|user| (user.id, user))
        .collect::<HashMap<_, _>>();
    let mut member_counts = HashMap::<_, usize>::new();
    let mut members_by_unit = HashMap::<_, Vec<OrganizationMemberResponse>>::new();
    for membership in memberships {
        *member_counts
            .entry(membership.organization_unit_id)
            .or_default() += 1;
        if let Some(user) = users_by_id.get(&membership.user_id) {
            members_by_unit
                .entry(membership.organization_unit_id)
                .or_default()
                .push(OrganizationMemberResponse {
                    id: user.id.to_string(),
                    display_name: user.display_name.clone(),
                    avatar_url: user.avatar_url.clone(),
                    title: user.title.clone(),
                    status: user.status.clone(),
                });
        }
    }
    members_by_unit.values_mut().for_each(|members| {
        members.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    });
    Ok(Json(success_response(
        "organization units loaded",
        units
            .into_iter()
            .map(|unit| OrganizationUnitResponse {
                id: unit.id.to_string(),
                source_type: unit.source_type,
                external_id: unit.external_id,
                parent_external_id: unit.parent_external_id,
                name: unit.name,
                status: unit.status,
                member_count: member_counts.get(&unit.id).copied().unwrap_or(0),
                members: members_by_unit.remove(&unit.id).unwrap_or_default(),
            })
            .collect(),
    )))
}

pub(crate) async fn create_local_organization_unit(
    State(state): State<AppState>,
    Json(payload): Json<CreateLocalOrganizationUnitRequest>,
) -> Result<Json<ApiResponse<OrganizationUnitResponse>>, AppError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("组织名称不能为空".to_string()));
    }
    if name.len() > 160 {
        return Err(AppError::BadRequest(
            "组织名称不能超过 160 个字符".to_string(),
        ));
    }
    let parent_external_id = payload
        .parent_external_id
        .and_then(|value| optional_text(&value));
    if let Some(parent_external_id) = &parent_external_id {
        let parent_exists = organization_unit_entity::Entity::find()
            .filter(organization_unit_entity::Column::SourceType.eq("local"))
            .filter(organization_unit_entity::Column::ExternalId.eq(parent_external_id))
            .one(&state.db)
            .await?
            .is_some();
        if !parent_exists {
            return Err(AppError::BadRequest("所选上级组织不存在".to_string()));
        }
    }
    let now = chrono::Utc::now();
    let unit = organization_unit_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        source_type: Set("local".to_string()),
        external_id: Set(format!("local:{}", Uuid::new_v4())),
        parent_external_id: Set(parent_external_id),
        name: Set(name.to_string()),
        sort_order: Set(now.timestamp_millis()),
        status: Set("active".to_string()),
        raw_json: Set(serde_json::json!({ "source": "local" })),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "local organization unit created",
        OrganizationUnitResponse {
            id: unit.id.to_string(),
            source_type: unit.source_type,
            external_id: unit.external_id,
            parent_external_id: unit.parent_external_id,
            name: unit.name,
            status: unit.status,
            member_count: 0,
            members: Vec::new(),
        },
    )))
}

pub(crate) async fn create_local_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateLocalUserRequest>,
) -> Result<Json<ApiResponse<DingTalkLoginUserResponse>>, AppError> {
    let username = payload.username.trim();
    let password = payload.password.trim();
    let name = payload.display_name.trim();
    if username.is_empty() || password.is_empty() || name.is_empty() {
        return Err(AppError::BadRequest("账号、密码和姓名不能为空".to_string()));
    }
    let roles = validate_role_ids(&payload.role_ids)?;
    ensure_roles_match_source(&state.db, &roles, "local").await?;
    let tx = state.db.begin().await?;
    let now = chrono::Utc::now();
    let id = Uuid::new_v4();
    iam_user_entity::ActiveModel {
        id: Set(id),
        display_name: Set(name.to_string()),
        mobile: Set(payload.mobile.and_then(|v| optional_text(&v))),
        state_code: Set(None),
        telephone: Set(None),
        email: Set(payload.email.and_then(|v| optional_text(&v))),
        avatar_url: Set(None),
        job_number: Set(None),
        title: Set(payload.title.and_then(|v| optional_text(&v))),
        work_place: Set(None),
        remark: Set(None),
        hired_at: Set(None),
        manager_external_user_id: Set(None),
        primary_organization_unit_id: Set(None),
        senior: Set(false),
        is_admin: Set(false),
        is_boss: Set(false),
        real_authed: Set(false),
        extension_json: Set(serde_json::json!({"source":"local"})),
        status: Set("active".to_string()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&tx)
    .await?;
    iam_local_credential_entity::ActiveModel {
        user_id: Set(id),
        username: Set(username.to_string()),
        password: Set(hash_password(password)?),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&tx)
    .await?;
    for role_id in roles {
        iam_user_role_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(id),
            role_id: Set(role_id),
            created_at: Set(now.into()),
        }
        .insert(&tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(success_response(
        "local user created",
        DingTalkLoginUserResponse {
            id: id.to_string(),
            username: username.to_string(),
            display_name: name.to_string(),
        },
    )))
}

pub(crate) async fn initialize_local_credentials(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<InitializeLocalCredentialsResponse>>, AppError> {
    let users = iam_user_entity::Entity::find()
        .order_by_asc(iam_user_entity::Column::DisplayName)
        .all(&state.db)
        .await?;
    let credentials = iam_local_credential_entity::Entity::find()
        .all(&state.db)
        .await?;
    let configured_user_ids = credentials
        .iter()
        .map(|credential| credential.user_id)
        .collect::<HashSet<_>>();
    let mut used_usernames = credentials
        .into_iter()
        .map(|credential| credential.username)
        .collect::<HashSet<_>>();
    let transaction = state.db.begin().await?;
    let now = chrono::Utc::now();
    let mut initialized = 0;
    let mut already_configured = 0;
    let mut skipped = Vec::new();

    for user in users {
        if configured_user_ids.contains(&user.id) {
            already_configured += 1;
            continue;
        }
        let credential_value = user
            .email
            .as_deref()
            .and_then(optional_text)
            .or_else(|| user.mobile.as_deref().and_then(optional_text));
        let Some(credential_value) = credential_value else {
            skipped.push(InitializeLocalCredentialSkip {
                user_id: user.id.to_string(),
                display_name: user.display_name,
                reason: "未设置主邮箱或手机号".to_string(),
            });
            continue;
        };
        if !used_usernames.insert(credential_value.clone()) {
            skipped.push(InitializeLocalCredentialSkip {
                user_id: user.id.to_string(),
                display_name: user.display_name,
                reason: format!("账号“{credential_value}”已被其他用户使用"),
            });
            continue;
        }
        iam_local_credential_entity::ActiveModel {
            user_id: Set(user.id),
            username: Set(credential_value.clone()),
            password: Set(hash_password(&credential_value)?),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&transaction)
        .await?;
        initialized += 1;
    }
    transaction.commit().await?;
    Ok(Json(success_response(
        "local credentials initialized",
        InitializeLocalCredentialsResponse {
            initialized,
            already_configured,
            skipped,
        },
    )))
}
pub(crate) async fn local_login(
    State(state): State<AppState>,
    Json(payload): Json<LocalLoginRequest>,
) -> Result<Json<ApiResponse<DingTalkLoginUserResponse>>, AppError> {
    let credential = iam_local_credential_entity::Entity::find()
        .filter(iam_local_credential_entity::Column::Username.eq(payload.username.trim()))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("账号或密码错误".to_string()))?;
    if !verify_password(&credential.password, &payload.password) {
        return Err(AppError::BadRequest("账号或密码错误".to_string()));
    }
    let user = iam_user_entity::Entity::find_by_id(credential.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("账号或密码错误".to_string()))?;
    if user.status != "active" {
        return Err(AppError::BadRequest("用户已停用".to_string()));
    }
    if !credential.password.starts_with("$argon2") {
        let mut upgraded: iam_local_credential_entity::ActiveModel = credential.clone().into();
        upgraded.password = Set(hash_password(&payload.password)?);
        upgraded.updated_at = Set(chrono::Utc::now().into());
        upgraded.update(&state.db).await?;
    }
    Ok(Json(success_response(
        "login verified",
        DingTalkLoginUserResponse {
            id: user.id.to_string(),
            username: credential.username,
            display_name: user.display_name,
        },
    )))
}

fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| AppError::Server(std::io::Error::other("password hashing failed")))
}

fn verify_password(stored: &str, provided: &str) -> bool {
    if let Ok(parsed) = PasswordHash::new(stored) {
        return Argon2::default()
            .verify_password(provided.as_bytes(), &parsed)
            .is_ok();
    }

    // Existing development installations used plaintext credentials. Upgrade after
    // a successful login, then never return the value through the API.
    stored == provided
}

pub(crate) async fn list_users(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<UserResponse>>>, AppError> {
    let users = iam_user_entity::Entity::find()
        .order_by_asc(iam_user_entity::Column::DisplayName)
        .all(&state.db)
        .await?;
    let identities = iam_external_identity_entity::Entity::find()
        .all(&state.db)
        .await?;
    let memberships = iam_organization_membership_entity::Entity::find()
        .all(&state.db)
        .await?;
    let units = organization_unit_entity::Entity::find()
        .all(&state.db)
        .await?;
    let user_roles = iam_user_role_entity::Entity::find().all(&state.db).await?;
    let email_addresses = iam_user_email_address_entity::Entity::find()
        .all(&state.db)
        .await?;
    let credentials = iam_local_credential_entity::Entity::find()
        .all(&state.db)
        .await?;
    let roles = iam_role_entity::Entity::find().all(&state.db).await?;

    let sources = identities
        .iter()
        .map(|identity| (identity.user_id, identity.provider.clone()))
        .collect::<HashMap<_, _>>();
    let users_by_external_id = identities
        .iter()
        .map(|identity| (identity.external_user_id.clone(), identity.user_id))
        .collect::<HashMap<_, _>>();
    let user_names = users
        .iter()
        .map(|user| (user.id, user.display_name.clone()))
        .collect::<HashMap<_, _>>();
    let unit_names = units
        .into_iter()
        .map(|unit| (unit.id, unit.name))
        .collect::<HashMap<_, _>>();
    let role_names = roles
        .into_iter()
        .map(|role| (role.id, role.name))
        .collect::<HashMap<_, _>>();
    let mut departments_by_user = HashMap::<_, Vec<String>>::new();
    for membership in memberships {
        if let Some(name) = unit_names.get(&membership.organization_unit_id) {
            departments_by_user
                .entry(membership.user_id)
                .or_default()
                .push(name.clone());
        }
    }
    let mut roles_by_user = HashMap::<_, Vec<String>>::new();
    let mut role_ids_by_user = HashMap::<_, Vec<String>>::new();
    for binding in user_roles {
        if let Some(name) = role_names.get(&binding.role_id) {
            roles_by_user
                .entry(binding.user_id)
                .or_default()
                .push(name.clone());
        }
        role_ids_by_user
            .entry(binding.user_id)
            .or_default()
            .push(binding.role_id.to_string());
    }
    let mut email_addresses_by_user = HashMap::<_, Vec<EmailAddressResponse>>::new();
    let credentials_by_user = credentials
        .into_iter()
        .map(|credential| (credential.user_id, credential.username))
        .collect::<HashMap<_, _>>();
    for item in email_addresses {
        email_addresses_by_user
            .entry(item.user_id)
            .or_default()
            .push(EmailAddressResponse {
                label: item.label,
                email: item.email,
            });
    }

    Ok(Json(success_response(
        "users loaded",
        users
            .into_iter()
            .map(|user| UserResponse {
                id: user.id.to_string(),
                username: credentials_by_user.get(&user.id).cloned(),
                display_name: user.display_name,
                mobile: user.mobile,
                state_code: user.state_code,
                telephone: user.telephone,
                email: user.email,
                email_addresses: email_addresses_by_user.remove(&user.id).unwrap_or_default(),
                avatar_url: user.avatar_url,
                job_number: user.job_number,
                title: user.title,
                work_place: user.work_place,
                remark: user.remark,
                hired_at: user.hired_at.as_ref().map(|value| value.to_rfc3339()),
                tenure_months: user.hired_at.as_ref().map(|value| {
                    let days = chrono::Utc::now()
                        .signed_duration_since(value.to_owned())
                        .num_days()
                        .max(0);
                    days / 30
                }),
                manager_name: user
                    .manager_external_user_id
                    .as_ref()
                    .and_then(|external_id| users_by_external_id.get(external_id))
                    .and_then(|user_id| user_names.get(user_id))
                    .cloned(),
                primary_department: user
                    .primary_organization_unit_id
                    .and_then(|organization_id| unit_names.get(&organization_id).cloned()),
                senior: user.senior,
                is_admin: user.is_admin,
                is_boss: user.is_boss,
                real_authed: user.real_authed,
                extension_json: user.extension_json,
                status: user.status,
                source_type: sources
                    .get(&user.id)
                    .cloned()
                    .unwrap_or_else(|| "local".to_string()),
                departments: departments_by_user.remove(&user.id).unwrap_or_default(),
                roles: roles_by_user.remove(&user.id).unwrap_or_default(),
                role_ids: role_ids_by_user.remove(&user.id).unwrap_or_default(),
            })
            .collect(),
    )))
}

pub(crate) async fn list_roles(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<RoleResponse>>>, AppError> {
    let roles = iam_role_entity::Entity::find()
        .order_by_asc(iam_role_entity::Column::Name)
        .all(&state.db)
        .await?;
    let bindings = iam_user_role_entity::Entity::find().all(&state.db).await?;
    let mut member_counts = HashMap::<_, usize>::new();
    for binding in bindings {
        *member_counts.entry(binding.role_id).or_default() += 1;
    }

    Ok(Json(success_response(
        "roles loaded",
        roles
            .into_iter()
            .map(|role| RoleResponse {
                id: role.id.to_string(),
                source_type: role.source_type,
                external_id: role.external_id,
                name: role.name,
                status: role.status,
                member_count: member_counts.get(&role.id).copied().unwrap_or(0),
            })
            .collect(),
    )))
}

pub(crate) async fn update_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<ApiResponse<UserResponse>>, AppError> {
    let id =
        Uuid::parse_str(&user_id).map_err(|_| AppError::NotFound("user not found".to_string()))?;
    let user = iam_user_entity::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".to_string()))?;
    let email_addresses = payload
        .email_addresses
        .as_ref()
        .map(validate_email_addresses)
        .transpose()?;
    let role_ids = payload
        .role_ids
        .as_ref()
        .map(|ids| validate_role_ids(ids))
        .transpose()?;
    let user_source = iam_external_identity_entity::Entity::find()
        .filter(iam_external_identity_entity::Column::UserId.eq(id))
        .one(&state.db)
        .await?
        .map(|identity| identity.provider)
        .unwrap_or_else(|| "local".to_string());
    if let Some(role_ids) = &role_ids {
        ensure_roles_match_source(&state.db, role_ids, &user_source).await?;
    }
    let transaction = state.db.begin().await?;
    let mut active: iam_user_entity::ActiveModel = user.into();
    if let Some(value) = payload.display_name {
        if value.trim().is_empty() {
            return Err(AppError::BadRequest("display name is required".to_string()));
        }
        active.display_name = Set(value.trim().to_string());
    }
    if let Some(value) = payload.mobile {
        active.mobile = Set(optional_text(&value));
    }
    if let Some(value) = payload.telephone {
        active.telephone = Set(optional_text(&value));
    }
    if let Some(value) = payload.email {
        active.email = Set(optional_text(&value));
    }
    if let Some(value) = payload.job_number {
        active.job_number = Set(optional_text(&value));
    }
    if let Some(value) = payload.title {
        active.title = Set(optional_text(&value));
    }
    if let Some(value) = payload.work_place {
        active.work_place = Set(optional_text(&value));
    }
    if let Some(value) = payload.remark {
        active.remark = Set(optional_text(&value));
    }
    if let Some(status) = payload.status {
        if !matches!(status.as_str(), "active" | "inactive") {
            return Err(AppError::BadRequest("invalid user status".to_string()));
        }
        active.status = Set(status);
    }
    active.updated_at = Set(chrono::Utc::now().into());
    let updated = active.update(&transaction).await?;
    if let Some(ref addresses) = email_addresses {
        iam_user_email_address_entity::Entity::delete_many()
            .filter(iam_user_email_address_entity::Column::UserId.eq(id))
            .exec(&transaction)
            .await?;
        let now = chrono::Utc::now();
        for address in addresses {
            iam_user_email_address_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(id),
                label: Set(address.label.clone()),
                email: Set(address.email.clone()),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(&transaction)
            .await?;
        }
    }
    if let Some(role_ids) = role_ids {
        if id
            == Uuid::parse_str("00000000-0000-4000-8000-000000000001")
                .expect("valid system user id")
            && !role_ids
                .iter()
                .any(|role_id| role_id.to_string() == "00000000-0000-4000-8000-000000000002")
        {
            return Err(AppError::BadRequest(
                "system administrator role cannot be removed".to_string(),
            ));
        }
        iam_user_role_entity::Entity::delete_many()
            .filter(iam_user_role_entity::Column::UserId.eq(id))
            .exec(&transaction)
            .await?;
        let now = chrono::Utc::now();
        for role_id in &role_ids {
            iam_user_role_entity::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(id),
                role_id: Set(*role_id),
                created_at: Set(now.into()),
            }
            .insert(&transaction)
            .await?;
        }
    }
    transaction.commit().await?;
    let persisted_addresses = email_addresses.unwrap_or_default();
    Ok(Json(success_response(
        "user updated",
        UserResponse {
            id: updated.id.to_string(),
            username: None,
            display_name: updated.display_name,
            mobile: updated.mobile,
            state_code: updated.state_code,
            telephone: updated.telephone,
            email: updated.email,
            email_addresses: persisted_addresses,
            avatar_url: updated.avatar_url,
            job_number: updated.job_number,
            title: updated.title,
            work_place: updated.work_place,
            remark: updated.remark,
            hired_at: updated.hired_at.map(|value| value.to_rfc3339()),
            tenure_months: None,
            manager_name: None,
            primary_department: None,
            senior: updated.senior,
            is_admin: updated.is_admin,
            is_boss: updated.is_boss,
            real_authed: updated.real_authed,
            extension_json: updated.extension_json,
            status: updated.status,
            source_type: "local".to_string(),
            departments: vec![],
            roles: vec![],
            role_ids: vec![],
        },
    )))
}

fn validate_role_ids(ids: &Vec<String>) -> Result<Vec<Uuid>, AppError> {
    let mut result = Vec::with_capacity(ids.len());
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        let role_id =
            Uuid::parse_str(id).map_err(|_| AppError::BadRequest("invalid role id".to_string()))?;
        if !seen.insert(role_id) {
            return Err(AppError::BadRequest(
                "role cannot be duplicated".to_string(),
            ));
        }
        result.push(role_id);
    }
    Ok(result)
}

async fn ensure_roles_match_source<C>(
    db: &C,
    role_ids: &[Uuid],
    expected_source: &str,
) -> Result<(), AppError>
where
    C: ConnectionTrait,
{
    if role_ids.is_empty() {
        return Ok(());
    }
    let count = iam_role_entity::Entity::find()
        .filter(iam_role_entity::Column::Id.is_in(role_ids.to_vec()))
        .filter(iam_role_entity::Column::SourceType.eq(expected_source))
        .count(db)
        .await?;
    if count != role_ids.len() as u64 {
        return Err(AppError::BadRequest(
            "roles must match the user's identity source".to_string(),
        ));
    }
    Ok(())
}

fn validate_email_addresses(
    addresses: &Vec<EmailAddressRequest>,
) -> Result<Vec<EmailAddressResponse>, AppError> {
    let mut values = Vec::with_capacity(addresses.len());
    let mut seen = std::collections::HashSet::new();
    for address in addresses {
        let label = address.label.trim();
        let email = address.email.trim().to_lowercase();
        if label.is_empty()
            || email.is_empty()
            || !email.contains('@')
            || !email
                .rsplit_once('@')
                .is_some_and(|(_, domain)| domain.contains('.'))
        {
            return Err(AppError::BadRequest(
                "邮箱名称和有效的邮箱地址不能为空".to_string(),
            ));
        }
        if !seen.insert(email.clone()) {
            return Err(AppError::BadRequest("邮箱地址不能重复".to_string()));
        }
        values.push(EmailAddressResponse {
            label: label.to_string(),
            email,
        });
    }
    Ok(values)
}

pub(crate) async fn delete_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    if user_id == "00000000-0000-4000-8000-000000000001" {
        return Err(AppError::BadRequest(
            "system administrator user cannot be deleted".to_string(),
        ));
    }
    let id =
        Uuid::parse_str(&user_id).map_err(|_| AppError::NotFound("user not found".to_string()))?;
    let result = iam_user_entity::Entity::delete_by_id(id)
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound("user not found".to_string()));
    }
    Ok(Json(success_response(
        "user deleted",
        serde_json::json!({ "id": user_id }),
    )))
}

pub(crate) async fn create_local_role(
    State(state): State<AppState>,
    Json(payload): Json<CreateLocalRoleRequest>,
) -> Result<Json<ApiResponse<RoleResponse>>, AppError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("role name is required".to_string()));
    }
    if iam_role_entity::Entity::find()
        .filter(iam_role_entity::Column::SourceType.eq("local"))
        .filter(iam_role_entity::Column::Name.eq(name))
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(AppError::BadRequest(
            "a local role with this name already exists".to_string(),
        ));
    }
    let now = chrono::Utc::now();
    let created = iam_role_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        source_type: Set("local".to_string()),
        external_id: Set(format!("local-{}", Uuid::new_v4())),
        name: Set(name.to_string()),
        status: Set("inactive".to_string()),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(success_response(
        "local role created",
        RoleResponse {
            id: created.id.to_string(),
            source_type: created.source_type,
            external_id: created.external_id,
            name: created.name,
            status: created.status,
            member_count: 0,
        },
    )))
}

pub(crate) async fn update_local_role(
    State(state): State<AppState>,
    Path(role_id): Path<String>,
    Json(payload): Json<UpdateLocalRoleRequest>,
) -> Result<Json<ApiResponse<RoleResponse>>, AppError> {
    let id =
        Uuid::parse_str(&role_id).map_err(|_| AppError::NotFound("role not found".to_string()))?;
    let role = iam_role_entity::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("role not found".to_string()))?;
    ensure_editable_local_role(&role)?;
    let mut active: iam_role_entity::ActiveModel = role.into();
    if let Some(name) = payload.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("role name is required".to_string()));
        }
        if iam_role_entity::Entity::find()
            .filter(iam_role_entity::Column::SourceType.eq("local"))
            .filter(iam_role_entity::Column::Name.eq(name))
            .filter(iam_role_entity::Column::Id.ne(id))
            .one(&state.db)
            .await?
            .is_some()
        {
            return Err(AppError::BadRequest(
                "a local role with this name already exists".to_string(),
            ));
        }
        active.name = Set(name.to_string());
    }
    if let Some(status) = payload.status {
        if !matches!(status.as_str(), "active" | "inactive") {
            return Err(AppError::BadRequest("invalid role status".to_string()));
        }
        active.status = Set(status);
    }
    active.updated_at = Set(chrono::Utc::now().into());
    let updated = active.update(&state.db).await?;
    let member_count = iam_user_role_entity::Entity::find()
        .filter(iam_user_role_entity::Column::RoleId.eq(updated.id))
        .count(&state.db)
        .await? as usize;
    Ok(Json(success_response(
        "local role updated",
        RoleResponse {
            id: updated.id.to_string(),
            source_type: updated.source_type,
            external_id: updated.external_id,
            name: updated.name,
            status: updated.status,
            member_count,
        },
    )))
}

pub(crate) async fn delete_local_role(
    State(state): State<AppState>,
    Path(role_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let id =
        Uuid::parse_str(&role_id).map_err(|_| AppError::NotFound("role not found".to_string()))?;
    let role = iam_role_entity::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("role not found".to_string()))?;
    ensure_editable_local_role(&role)?;
    iam_role_entity::Entity::delete_by_id(id)
        .exec(&state.db)
        .await?;
    Ok(Json(success_response(
        "local role deleted",
        serde_json::json!({ "id": role_id }),
    )))
}

fn ensure_editable_local_role(role: &iam_role_entity::Model) -> Result<(), AppError> {
    if role.source_type != "local" {
        return Err(AppError::BadRequest(
            "synchronized roles cannot be modified".to_string(),
        ));
    }
    if role.external_id == "system-administrator" {
        return Err(AppError::BadRequest(
            "system administrator role cannot be modified".to_string(),
        ));
    }
    Ok(())
}

pub(crate) async fn resolve_dingtalk_login(
    State(state): State<AppState>,
    Json(payload): Json<DingTalkLoginRequest>,
) -> Result<Json<ApiResponse<DingTalkLoginUserResponse>>, AppError> {
    if payload.union_id.trim().is_empty() && payload.open_id.trim().is_empty() {
        return Err(AppError::BadRequest(
            "dingtalk user identity is missing".to_string(),
        ));
    }

    let identities = iam_external_identity_entity::Entity::find()
        .filter(iam_external_identity_entity::Column::Provider.eq("dingtalk"))
        .all(&state.db)
        .await?;
    let identity = identities.into_iter().find(|identity| {
        (!payload.union_id.is_empty()
            && identity.union_id.as_deref() == Some(payload.union_id.as_str()))
            || (!payload.open_id.is_empty() && identity.external_user_id == payload.open_id)
    });

    let now = chrono::Utc::now();
    let (user_id, username, display_name) = if let Some(identity) = identity {
        let user = iam_user_entity::Entity::find_by_id(identity.user_id)
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::BadRequest("dingtalk user is not available".to_string()))?;
        if user.status != "active" {
            return Err(AppError::BadRequest(
                "dingtalk user has been disabled".to_string(),
            ));
        }
        (user.id, identity.external_user_id, user.display_name)
    } else {
        let settings =
            crate::platform::config::load_identity_source_settings().ok_or_else(|| {
                AppError::BadRequest("dingtalk identity source is not configured".to_string())
            })?;
        if !settings.dingtalk.allow_jit_provisioning {
            return Err(AppError::BadRequest(
                "该钉钉账号尚未同步；请先同步通讯录，或开启“登录时自动创建用户”".to_string(),
            ));
        }
        let external_user_id = if payload.open_id.trim().is_empty() {
            payload.union_id.clone()
        } else {
            payload.open_id.clone()
        };
        let user_id = Uuid::new_v4();
        let display_name = if payload.nick.trim().is_empty() {
            "钉钉用户".to_string()
        } else {
            payload.nick.clone()
        };
        iam_user_entity::ActiveModel {
            id: Set(user_id),
            display_name: Set(display_name.clone()),
            mobile: Set(optional_text(&payload.mobile)),
            state_code: Set(None),
            telephone: Set(None),
            email: Set(optional_text(&payload.email)),
            avatar_url: Set(optional_text(&payload.avatar_url)),
            job_number: Set(None),
            title: Set(None),
            work_place: Set(None),
            remark: Set(None),
            hired_at: Set(None),
            manager_external_user_id: Set(None),
            primary_organization_unit_id: Set(None),
            senior: Set(false),
            is_admin: Set(false),
            is_boss: Set(false),
            real_authed: Set(false),
            extension_json: Set(serde_json::json!({ "source": "dingtalk-oauth" })),
            status: Set("active".to_string()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&state.db)
        .await?;
        iam_external_identity_entity::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(user_id),
            provider: Set("dingtalk".to_string()),
            external_user_id: Set(external_user_id.clone()),
            union_id: Set(optional_text(&payload.union_id)),
            raw_json: Set(serde_json::json!({ "source": "dingtalk-oauth" })),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&state.db)
        .await?;
        (user_id, external_user_id, display_name)
    };

    Ok(Json(success_response(
        "dingtalk login user resolved",
        DingTalkLoginUserResponse {
            id: user_id.to_string(),
            username,
            display_name,
        },
    )))
}

fn optional_text(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}
