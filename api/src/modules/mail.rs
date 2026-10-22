mod mailbox;
use crate::{
    platform::{api::ApiResponse, authorization, error::AppError, runtime::AppState},
    shared::success_response,
};
use axum::{Json, extract::State, http::HeaderMap};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};
pub(crate) use mailbox::{
    MailDetailResponse, MailPageResponse, download_attachment, get_message, list_messages,
    recent_contacts,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SendMailRequest {
    #[serde(skip)]
    #[schema(ignore)]
    pub(crate) from: String,
    pub(crate) to: Vec<String>,
    #[serde(default)]
    pub(crate) cc: Vec<String>,
    #[serde(default)]
    pub(crate) bcc: Vec<String>,
    pub(crate) subject: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) html: Option<String>,
    #[serde(default)]
    pub(crate) attachments: Vec<SendMailAttachment>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SendMailAttachment {
    filename: String,
    content_type: String,
    content_base64: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailContact {
    name: String,
    email: String,
    avatar_url: Option<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailComposeContext {
    sender: MailContact,
}
pub(crate) async fn compose_context(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<MailComposeContext>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    authorization::resolved_tenant_id(&state, &user).await?;
    Ok(Json(success_response(
        "写信信息已加载",
        MailComposeContext {
            sender: MailContact {
                name: user.display_name,
                email: user.email.unwrap_or_default(),
                avatar_url: user.avatar_url,
            },
        },
    )))
}
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendMailResponse {
    pub(crate) accepted: bool,
    pub(crate) request_id: String,
    pub(crate) archive_warning: Option<String>,
}

pub(crate) async fn save_authorization(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    email: Option<&str>,
    password: Option<&str>,
    clear: bool,
) -> Result<(), AppError> {
    if clear {
        db.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "DELETE FROM user_smtp_authorizations WHERE user_id = $1 AND email = $2",
            vec![
                user_id.into(),
                email.unwrap_or_default().trim().to_ascii_lowercase().into(),
            ],
        ))
        .await?;
        return Ok(());
    }
    let Some(password) = password.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    if password.len() > 4096 || password.contains(['\r', '\n']) {
        return Err(AppError::BadRequest("SMTP 授权码格式无效".into()));
    }
    let email = email
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::BadRequest("请先配置主邮箱，再保存 SMTP 授权码".into()))?;
    normalize_addresses(vec![email.into()], "主邮箱")?;
    let encrypted = crate::modules::byom::encrypt(password).map_err(|_| {
        AppError::BadRequest("SMTP 授权码无法加密，请检查服务端加密密钥配置".into())
    })?;
    db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "INSERT INTO user_smtp_authorizations (user_id, email, encrypted_password) VALUES ($1, $2, $3) ON CONFLICT (user_id, email) DO UPDATE SET email = EXCLUDED.email, encrypted_password = EXCLUDED.encrypted_password",
        vec![user_id.into(), email.to_ascii_lowercase().into(), encrypted.into()])).await?;
    Ok(())
}

pub(crate) async fn send_mail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut payload): Json<SendMailRequest>,
) -> Result<Json<ApiResponse<SendMailResponse>>, AppError> {
    let user = authorization::current_user(&headers, &state).await?;
    let tenant_id = authorization::resolved_tenant_id(&state, &user).await?;
    payload.from = user
        .email
        .filter(|email| !email.trim().is_empty())
        .ok_or_else(|| {
            AppError::BadRequest("当前登录用户未设置主邮箱，请联系管理员在用户管理中配置".into())
        })?;
    let request = normalize(payload)?;
    let password = mailbox_password(&state, user.id, &request.from).await?;
    let request_id = Uuid::new_v4().to_string();
    let message = smtp_message(&request)?;
    let archive_password = password.clone();
    let transport = AsyncSmtpTransport::<Tokio1Executor>::relay("smtp.qiye.aliyun.com")
        .map_err(|_| AppError::BadRequest("SMTP 服务初始化失败".into()))?
        .port(465)
        .credentials(Credentials::new(request.from.clone(), password))
        .timeout(Some(std::time::Duration::from_secs(15)))
        .build();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        transport.send(message.clone()),
    )
    .await;
    let error = match response {
        Err(_) => Some(("timeout", "邮件发送超时，结果未知，请核实后再重试")),
        Ok(Err(error)) if error.is_timeout() => {
            Some(("timeout", "邮件发送超时，结果未知，请核实后再重试"))
        }
        Ok(Err(error)) if error.status().is_some_and(|code| u16::from(code) == 535) => Some((
            "authentication",
            "SMTP 授权失败，请检查主邮箱授权码及邮箱的 SMTP 服务是否开启",
        )),
        Ok(Err(_)) => Some(("smtp", "SMTP 发送失败，请检查邮箱授权、发信权限及网络连接")),
        Ok(Ok(response)) if !response.is_positive() => {
            Some(("rejected", "SMTP 服务未接受邮件，请检查邮箱发信权限和额度"))
        }
        Ok(Ok(_)) => None,
    };
    if let Some((kind, message)) = error {
        tracing::warn!(%request_id, user_id = %user.id, %tenant_id, error_kind = kind, "SMTP mail send failed");
        return Err(AppError::BadRequest(message.into()));
    }
    tracing::info!(%request_id, user_id = %user.id, %tenant_id, "SMTP mail accepted");
    let archive_warning = mailbox::archive_sent(
        request.from.clone(),
        archive_password,
        message.formatted(),
        message
            .headers()
            .get::<lettre::message::header::MessageId>()
            .map(|value| value.as_ref().to_string()),
    )
    .await
    .err()
    .map(|_| "邮件已发送，但已发送文件夹存档失败，请勿重复发送".to_string());
    if archive_warning.is_some() {
        tracing::warn!(%request_id, user_id = %user.id, "SMTP accepted but IMAP sent archive failed");
    }
    Ok(Json(success_response(
        "邮件已提交发送",
        SendMailResponse {
            accepted: true,
            request_id,
            archive_warning,
        },
    )))
}

async fn mailbox_password(
    state: &AppState,
    user_id: Uuid,
    email: &str,
) -> Result<String, AppError> {
    let row = state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT email, encrypted_password FROM user_smtp_authorizations WHERE user_id = $1 AND email = $2",
        vec![user_id.into(), email.to_ascii_lowercase().into()])).await?
        .ok_or_else(|| AppError::BadRequest("当前用户的主邮箱未配置邮箱授权，请联系管理员在用户管理中配置授权码，并开启 SMTP/IMAP 服务".into()))?;
    let authorized: String = row.try_get("", "email")?;
    ensure_authorized_email(email, Some(&authorized))?;
    let encrypted: String = row.try_get("", "encrypted_password")?;
    crate::modules::byom::decrypt(&encrypted).map_err(|_| {
        AppError::BadRequest("邮箱授权无法读取，请检查加密配置或重新配置授权码".into())
    })
}

fn ensure_authorized_email(current: &str, authorized: Option<&str>) -> Result<(), AppError> {
    match authorized {
        None => Err(AppError::BadRequest(
            "当前用户的主邮箱未配置 SMTP 授权，请联系管理员在用户管理中配置授权码".into(),
        )),
        Some(email) if !email.eq_ignore_ascii_case(current) => Err(AppError::BadRequest(
            "主邮箱已变更，请在用户管理中重新配置 SMTP 授权码".into(),
        )),
        Some(_) => Ok(()),
    }
}

fn normalize(mut request: SendMailRequest) -> Result<SendMailRequest, AppError> {
    request.from = request.from.trim().to_string();
    if request.from.is_empty()
        || normalize_addresses(vec![request.from.clone()], "发信人")?.len() != 1
    {
        return Err(AppError::BadRequest(
            "当前登录用户的邮箱地址无效，请在用户管理中修改".into(),
        ));
    }
    request.to = normalize_addresses(request.to, "收件人")?;
    request.cc = normalize_addresses(request.cc, "抄送")?;
    request.bcc = normalize_addresses(request.bcc, "密送")?;
    if request.to.is_empty() {
        return Err(AppError::BadRequest("至少需要一个收件人".into()));
    }
    if request.subject.trim().is_empty() {
        return Err(AppError::BadRequest("邮件主题不能为空".into()));
    }
    if request.text.trim().is_empty() {
        return Err(AppError::BadRequest("邮件正文不能为空".into()));
    }
    request.subject = request.subject.trim().to_string();
    if request.subject.chars().count() > 100 || request.subject.contains(['\r', '\n']) {
        return Err(AppError::BadRequest(
            "邮件主题最多 100 个字符且不能换行".into(),
        ));
    }
    if request.text.len() > 80 * 1024 {
        return Err(AppError::BadRequest("邮件正文最多 80KB".into()));
    }
    if request
        .html
        .as_ref()
        .is_some_and(|html| html.len() > 512 * 1024)
    {
        return Err(AppError::BadRequest("富文本正文最多 512KB".into()));
    }
    if request.attachments.len() > 10 {
        return Err(AppError::BadRequest("最多添加 10 个附件".into()));
    }
    let mut total = 0;
    for attachment in &request.attachments {
        total += decode_attachment(attachment)?.len();
        if total > 6 * 1024 * 1024 {
            return Err(AppError::BadRequest("附件总大小最多 6MB".into()));
        }
    }
    let mut seen = std::collections::HashSet::new();
    for address in request
        .to
        .iter()
        .chain(request.cc.iter())
        .chain(request.bcc.iter())
    {
        if !seen.insert(address.to_ascii_lowercase()) {
            return Err(AppError::BadRequest("收件人地址不能重复".into()));
        }
    }
    if seen.len() > 60 {
        return Err(AppError::BadRequest(
            "一封邮件最多填写 60 个收件地址".into(),
        ));
    }
    Ok(request)
}

fn normalize_addresses(values: Vec<String>, label: &str) -> Result<Vec<String>, AppError> {
    let mut result = Vec::new();
    for value in values.into_iter().map(|item| item.trim().to_string()) {
        if value.is_empty() {
            continue;
        }
        if value.len() > 320
            || value.parse::<lettre::Address>().is_err()
            || value.contains(char::is_whitespace)
        {
            return Err(AppError::BadRequest(format!("{label}地址格式不正确")));
        }
        result.push(value);
    }
    Ok(result)
}

fn smtp_message(request: &SendMailRequest) -> Result<Message, AppError> {
    use lettre::message::{Attachment, MultiPart, SinglePart, header::ContentType};
    let invalid = || AppError::BadRequest("邮件地址格式不正确".into());
    let mut builder = Message::builder()
        .from(Mailbox::new(
            None,
            request.from.parse().map_err(|_| invalid())?,
        ))
        .subject(&request.subject);
    for address in &request.to {
        builder = builder.to(Mailbox::new(None, address.parse().map_err(|_| invalid())?));
    }
    for address in &request.cc {
        builder = builder.cc(Mailbox::new(None, address.parse().map_err(|_| invalid())?));
    }
    for address in &request.bcc {
        builder = builder.bcc(Mailbox::new(None, address.parse().map_err(|_| invalid())?));
    }
    builder = builder.message_id(Some(format!("<{}@yaya-mail.local>", Uuid::new_v4())));
    let mut body = MultiPart::alternative().singlepart(SinglePart::plain(request.text.clone()));
    if let Some(html) = &request.html {
        body = body.singlepart(SinglePart::html(html.clone()));
    }
    let mut mixed = MultiPart::mixed().multipart(body);
    for attachment in &request.attachments {
        let mime = ContentType::parse(&attachment.content_type)
            .map_err(|_| AppError::BadRequest("附件类型无效".into()))?;
        mixed = mixed.singlepart(
            Attachment::new(attachment.filename.clone()).body(decode_attachment(attachment)?, mime),
        );
    }
    builder
        .multipart(mixed)
        .map_err(|_| AppError::BadRequest("邮件内容格式无效".into()))
}

fn decode_attachment(attachment: &SendMailAttachment) -> Result<Vec<u8>, AppError> {
    use base64::Engine;
    if attachment.filename.trim().is_empty()
        || attachment.filename.len() > 255
        || attachment
            .filename
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\'))
    {
        return Err(AppError::BadRequest("附件名称无效".into()));
    }
    if attachment.content_type.len() > 150
        || lettre::message::header::ContentType::parse(&attachment.content_type).is_err()
    {
        return Err(AppError::BadRequest("附件类型无效".into()));
    }
    if attachment.content_base64.len() > 8 * 1024 * 1024 {
        return Err(AppError::BadRequest("附件总大小最多 6MB".into()));
    }
    base64::engine::general_purpose::STANDARD
        .decode(&attachment.content_base64)
        .map_err(|_| AppError::BadRequest("附件编码无效".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> SendMailRequest {
        SendMailRequest {
            from: "test@example.com".into(),
            to: vec!["recipient@example.com".into()],
            cc: vec![],
            bcc: vec![],
            subject: "中文主题".into(),
            text: "中文正文".into(),
            html: None,
            attachments: vec![],
        }
    }
    #[test]
    fn authorization_is_required_and_bound_to_primary_email() {
        assert!(ensure_authorized_email("test@example.com", None).is_err());
        assert!(ensure_authorized_email("changed@example.com", Some("test@example.com")).is_err());
        assert!(ensure_authorized_email("TEST@example.com", Some("test@example.com")).is_ok());
    }

    #[test]
    fn client_cannot_supply_sender() {
        let mut payload = serde_json::json!({"to":["user@example.com"],"subject":"s","text":"b"});
        assert!(
            serde_json::from_value::<SendMailRequest>(payload.clone())
                .unwrap()
                .from
                .is_empty()
        );
        payload["from"] = serde_json::json!("other@example.com");
        assert!(serde_json::from_value::<SendMailRequest>(payload).is_err());
    }
    #[test]
    fn removed_delivery_options_are_no_longer_accepted() {
        for key in ["highPriority", "requestReadReceipt"] {
            let mut payload =
                serde_json::json!({"to":["user@example.com"],"subject":"s","text":"b"});
            payload[key] = serde_json::json!(true);
            assert!(serde_json::from_value::<SendMailRequest>(payload).is_err());
        }
    }
    #[test]
    fn validates_addresses_and_limits() {
        let mut value = request();
        value.to.push("RECIPIENT@example.com".into());
        assert!(normalize(value).is_err());
        let mut value = request();
        value.subject = "x".repeat(101);
        assert!(normalize(value).is_err());
        let mut value = request();
        value.from = "invalid".into();
        assert!(normalize(value).is_err());
        let mut value = request();
        value.text = "x".repeat(80 * 1024 + 1);
        assert!(normalize(value).is_err());
        assert!(normalize(request()).is_ok());
    }
    #[test]
    fn smtp_keeps_bcc_in_envelope_only() {
        let mut value = request();
        value.cc.push("copy@example.com".into());
        value.bcc.push("hidden@example.com".into());
        let message = smtp_message(&value).unwrap();
        let wire = String::from_utf8(message.formatted()).unwrap();
        assert!(wire.contains("Cc: copy@example.com"));
        assert!(!wire.contains("Bcc:"));
        assert!(
            message
                .envelope()
                .to()
                .iter()
                .any(|address| address.to_string() == "hidden@example.com")
        );
    }

    #[test]
    fn rich_mail_preserves_bodies_and_attachment() {
        let mut value = request();
        value.html = Some("<p><strong>中文正文</strong></p>".into());
        value.attachments.push(SendMailAttachment {
            filename: "report.txt".into(),
            content_type: "text/plain".into(),
            content_base64: "aGVsbG8=".into(),
        });
        let value = normalize(value).unwrap();
        let message = smtp_message(&value).unwrap();
        let wire = message.formatted();
        let parsed = mailparse::parse_mail(&wire).unwrap();
        let alternative = &parsed.subparts[0];
        assert_eq!(alternative.ctype.mimetype, "multipart/alternative");
        assert_eq!(alternative.subparts[0].get_body().unwrap(), value.text);
        assert_eq!(
            alternative.subparts[1].get_body().unwrap(),
            value.html.unwrap()
        );
        assert_eq!(parsed.subparts[1].get_body_raw().unwrap(), b"hello");
        assert_eq!(
            parsed.subparts[1].get_content_disposition().params["filename"],
            "report.txt"
        );
        let wire = String::from_utf8(wire).unwrap();
        assert!(!wire.contains("X-Priority:"));
        assert!(!wire.contains("Disposition-Notification-To:"));
    }

    #[test]
    fn rejects_invalid_and_oversized_attachments_and_html() {
        let attachment = |name: &str, body: &str| SendMailAttachment {
            filename: name.into(),
            content_type: "text/plain".into(),
            content_base64: body.into(),
        };
        assert!(decode_attachment(&attachment("../secret", "aGVsbG8=")).is_err());
        assert!(decode_attachment(&attachment("safe.txt", "invalid!")).is_err());
        let mut value = request();
        value.attachments = (0..11).map(|_| attachment("safe.txt", "")).collect();
        assert!(normalize(value).is_err());
        let mut value = request();
        value.html = Some("x".repeat(512 * 1024 + 1));
        assert!(normalize(value).is_err());
        use base64::Engine;
        let mut value = request();
        let encoded = base64::engine::general_purpose::STANDARD.encode(vec![0; 4 * 1024 * 1024]);
        value.attachments = vec![attachment("a.bin", &encoded), attachment("b.bin", &encoded)];
        assert!(normalize(value).is_err());
    }
}
