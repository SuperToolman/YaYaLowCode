//! Explicit support identity, online revocation and request audit at the control plane.
use crate::infrastructure::entities::iam_user_entity;
use crate::platform::{error::AppError, runtime::AppState};
use axum::{Json, extract::State, http::HeaderMap};
use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) fn is_operator(user: &iam_user_entity::Model) -> bool {
    user.extension_json.get("source").and_then(Value::as_str) == Some("operations")
}
fn config() -> Result<(String, String, String), AppError> {
    let id = std::env::var("YAYA_PLATFORM_INSTANCE_ID").unwrap_or_default();
    Uuid::parse_str(&id).map_err(|_| AppError::Forbidden("此平台未配置运营实例身份".into()))?;
    let center = crate::platform::config::load_platform_license_settings()
        .ok_or_else(|| AppError::Forbidden("请先完成客户平台许可证激活".into()))?
        .license_center_url;
    let token = std::env::var("BACKEND_INTERNAL_TOKEN")
        .map_err(|_| AppError::Forbidden("实例认证配置缺失".into()))?;
    Ok((center.trim_end_matches('/').into(), id, token))
}
async fn control(action: &str, body: Value) -> Result<Value, AppError> {
    control_at(&format!("support-access/{action}"), body).await
}
async fn control_at(path: &str, body: Value) -> Result<Value, AppError> {
    let (center, id, token) = config()?;
    let reply = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Forbidden("无法连接运营认证服务".into()))?
        .post(format!("{center}/api/platform-instances/{id}/{path}"))
        .header("x-yaya-instance-token", token)
        .json(&body)
        .send()
        .await
        .map_err(|_| AppError::Forbidden("运营认证服务不可用，运维访问已拒绝".into()))?;
    if !reply.status().is_success() {
        let status = reply.status().as_u16();
        let body = reply.json::<Value>().await.unwrap_or(Value::Null);
        return Err(control_failure(status, body.get("message").and_then(Value::as_str)));
    }
    let body: Value = reply
        .json()
        .await
        .map_err(|_| AppError::Forbidden("运营认证响应无效".into()))?;
    body.get("data")
        .filter(|v| !v.is_null())
        .cloned()
        .ok_or_else(|| AppError::Forbidden("运营认证响应缺少身份".into()))
}
pub(crate) async fn send_sms(mobile: &str, code: &str) -> Result<(), AppError> {
    control_at("sms/send", json!({"mobile":mobile,"code":code}))
        .await
        .map(|_| ())
        .map_err(|error| {
            let message = match error {
                AppError::Forbidden(message) | AppError::BadRequest(message) => message,
                _ => "运营平台短信服务暂不可用".into(),
            };
            AppError::BadRequest(format!("验证码发送失败：{message}"))
        })
}

fn control_failure(status: u16, message: Option<&str>) -> AppError {
    // Forward only known public diagnostics, never an arbitrary upstream body
    // which could contain credentials, proxy HTML or internal implementation data.
    let known = [
        "实例身份校验失败",
        "仅已部署并完成授权的运行中实例支持运维访问",
        "客户尚无可用平台授权，请先完成订单回款和授权交付",
        "客户平台授权已过期或不包含平台权益",
        "客户不存在或已停用",
        "运维登录凭证已使用或已过期",
        "运营账号或登录会话已失效",
        "运维会话已过期或撤销",
        "短信发送频繁，请稍后再试",
        "短信服务尚未配置，请联系管理员",
        "客户平台短信发送失败，请检查运营平台短信服务配置",
    ];
    let message = message.filter(|message| known.contains(message))
        .map(str::to_owned)
        .unwrap_or_else(|| match status {
            404 => "运营平台未找到实例或接口，请检查实例标识、运营平台地址及版本".into(),
            429 => "运营平台请求过于频繁，请稍后再试".into(),
            500..=599 => "运营平台服务异常，请联系管理员检查服务日志".into(),
            401 | 403 => "运营平台拒绝实例或运维身份校验，请重新从运营平台进入；仍失败时检查实例密钥与授权状态".into(),
            _ => "运营平台请求失败，请检查实例配置及服务状态".into(),
        });
    AppError::Forbidden(message)
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;

    #[test]
    fn control_failures_distinguish_sms_configuration_identity_and_server_errors() {
        for (status, source, expected) in [
            (503, Some("短信服务尚未配置，请联系管理员"), "短信服务尚未配置"),
            (401, Some("实例身份校验失败"), "实例身份校验失败"),
            (401, Some("运维会话已过期或撤销"), "运维会话已过期或撤销"),
            (404, None, "未找到实例或接口"),
            (500, Some("token=do-not-expose"), "运营平台服务异常"),
        ] {
            let AppError::Forbidden(message) = control_failure(status, source) else { panic!("wrong error"); };
            assert!(message.contains(expected));
            assert!(!message.contains("do-not-expose"));
        }
    }
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct Exchange {
    code: String,
}
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Login {
    id: String,
    username: String,
    display_name: String,
    operations_session: String,
    operations_actor: String,
    expires_at: i64,
}
pub(crate) async fn exchange(
    State(state): State<AppState>,
    Json(input): Json<Exchange>,
) -> Result<Json<crate::platform::api::ApiResponse<Login>>, AppError> {
    if input.code.len() != 64 || !input.code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest("运维凭证格式无效".into()));
    }
    let data = control("redeem", json!({"credential":input.code})).await?;
    let actor = data["actorId"]
        .as_str()
        .ok_or_else(|| AppError::Forbidden("运营身份无效".into()))?;
    let username = data["username"]
        .as_str()
        .ok_or_else(|| AppError::Forbidden("运营身份无效".into()))?;
    let session = data["session"]
        .as_str()
        .ok_or_else(|| AppError::Forbidden("运营会话无效".into()))?;
    let expires = data["expiresAt"]
        .as_i64()
        .ok_or_else(|| AppError::Forbidden("运营会话无效".into()))?;
    let instance = std::env::var("YAYA_PLATFORM_INSTANCE_ID").unwrap_or_default();
    let bytes = Sha256::digest(format!("yaya-operations:{instance}:{actor}").as_bytes());
    let mut uuid_bytes: [u8; 16] = bytes[..16].try_into().unwrap();
    uuid_bytes[6] = (uuid_bytes[6] & 15) | 64;
    uuid_bytes[8] = (uuid_bytes[8] & 63) | 128;
    let id = Uuid::from_bytes(uuid_bytes);
    let display = format!("平台运维 · {username}");
    let tx = state.db.begin().await?;
    tx.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO iam_users(id,display_name,status,is_admin,is_boss,real_authed,primary_organization_unit_id,extension_json,created_at,updated_at) VALUES($1,$2,'active',true,true,true,'00000000-0000-4000-8000-000000000010',$3,NOW(),NOW()) ON CONFLICT(id) DO NOTHING",
        [id.into(),display.clone().into(),json!({"source":"operations","actorId":actor,"protected":true}).into()])).await?;
    tx.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO iam_user_roles(id,user_id,role_id,created_at) SELECT $1,$2,id,NOW() FROM iam_roles WHERE external_id='system-administrator' AND source_type='local' ON CONFLICT(user_id,role_id) DO NOTHING",[Uuid::new_v4().into(),id.into()])).await?;
    tx.commit().await?;
    tracing::info!(target:"yaya::operations",actor_id=actor,user_id=%id,"Operations session connected");
    Ok(Json(crate::shared::success_response(
        "运维登录成功",
        Login {
            id: id.to_string(),
            username: username.into(),
            display_name: display,
            operations_session: session.into(),
            operations_actor: actor.into(),
            expires_at: expires,
        },
    )))
}
pub(crate) async fn validate(
    user: &iam_user_entity::Model,
    session: Option<&str>,
    actor: Option<&str>,
    request: Option<(&str, &str)>,
) -> Result<(), AppError> {
    if !is_operator(user) {
        if session.is_some() || actor.is_some() {
            return Err(AppError::Forbidden("运维身份与用户不匹配".into()));
        }
        return Ok(());
    }
    let actor = actor.ok_or_else(|| AppError::Forbidden("运维身份必须通过统一登录".into()))?;
    if user.extension_json["actorId"].as_str() != Some(actor) {
        return Err(AppError::Forbidden("运维身份不匹配".into()));
    }
    let session = session.ok_or_else(|| AppError::Forbidden("运维会话缺失".into()))?;
    let mut body = json!({"credential":session});
    if let Some((method, path)) = request {
        body["method"] = json!(method);
        body["path"] = json!(path);
    }
    let result = control("check", body).await?;
    if result["actorId"] != actor {
        return Err(AppError::Forbidden("运营身份不匹配".into()));
    }
    Ok(())
}
pub(crate) async fn logout(
    headers: HeaderMap,
) -> Result<Json<crate::platform::api::ApiResponse<Value>>, AppError> {
    let claims = crate::platform::authorization::claims(&headers)?;
    if let Some(session) = claims.operations_session {
        control("logout", json!({"credential":session})).await?;
    }
    Ok(Json(crate::shared::success_response(
        "运维会话已断开",
        json!({}),
    )))
}
