use super::*;
use axum::extract::{Path, Query};
use mailparse::MailHeaderMap;
use std::{
    net::{TcpStream, ToSocketAddrs},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

type Session = imap::Session<native_tls::TlsStream<TcpStream>>;
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MailListQuery {
    pub folder: String,
    pub before_uid: Option<u32>,
    pub uid_validity: Option<u32>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MailDetailQuery {
    pub folder: String,
    pub uid_validity: u32,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSummary {
    id: String,
    sender: String,
    recipient: String,
    subject: String,
    preview: String,
    sent_at: String,
    is_read: bool,
    is_starred: bool,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailPageResponse {
    items: Vec<MailSummary>,
    next_before_uid: Option<u32>,
    uid_validity: u32,
    pub notice: Option<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailDetailResponse {
    subject: String,
    sender: String,
    recipient: String,
    cc: String,
    sent_at: String,
    text: String,
    html: Option<String>,
    inline_images: std::collections::BTreeMap<String, String>,
    has_attachments: bool,
    attachments: Vec<MailAttachment>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAttachment {
    id: u32,
    filename: String,
    content_type: String,
    size: usize,
}
fn failure(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn protocol_error(_: impl std::fmt::Debug) -> AppError {
    failure("邮箱读取失败，请检查 IMAP 服务、授权码及网络连接")
}
async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    static LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();
    let permit = LIMIT
        .get_or_init(|| Arc::new(Semaphore::new(8)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| failure("邮箱服务繁忙，请稍后重试"))?;
    tokio::time::timeout(
        Duration::from_secs(50),
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work()
        }),
    )
    .await
    .map_err(|_| failure("邮箱服务响应超时，请稍后刷新"))?
    .map_err(|_| failure("邮箱服务暂时不可用"))?
}
struct IdleSession {
    session: Session,
    idle_since: Instant,
}
fn sessions() -> &'static Mutex<std::collections::HashMap<String, IdleSession>> {
    static POOL: OnceLock<Mutex<std::collections::HashMap<String, IdleSession>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}
fn session_key(scope: &str, email: &str, password: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for value in [scope, email, password] {
        hash.update(value.len().to_be_bytes());
        hash.update(value.as_bytes());
    }
    format!("{:x}", hash.finalize())
}
// Take exclusive ownership while using an IMAP connection. Never hold the pool
// mutex during network I/O, and never reuse a session across credentials/users.
fn with_session<T>(
    scope: &str,
    email: &str,
    password: &str,
    work: impl FnOnce(&mut Session) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let started = Instant::now();
    let key = session_key(scope, email, password);
    let mut idle = {
        let mut pool = sessions()
            .lock()
            .map_err(|_| failure("邮箱连接池暂时不可用"))?;
        pool.retain(|_, entry| entry.idle_since.elapsed() < Duration::from_secs(60));
        pool.remove(&key)
    };
    if idle
        .as_mut()
        .is_some_and(|entry| entry.session.noop().is_err())
    {
        idle = None;
    }
    let reused = idle.is_some();
    let mut session = match idle {
        Some(entry) => entry.session,
        None => connect(email, password)?,
    };
    let result = work(&mut session);
    // A failed command may leave unread responses. Drop that connection rather
    // than retrying commands or returning an unsynchronized session to the pool.
    if result.is_ok() {
        if let Ok(mut pool) = sessions().lock() {
            if pool.len() >= 32 {
                if let Some(oldest) = pool
                    .iter()
                    .min_by_key(|(_, entry)| entry.idle_since)
                    .map(|(key, _)| key.clone())
                {
                    pool.remove(&oldest);
                }
            }
            pool.insert(
                key,
                IdleSession {
                    session,
                    idle_since: Instant::now(),
                },
            );
        }
    }
    tracing::debug!(
        connection_reused = reused,
        duration_ms = started.elapsed().as_millis() as u64,
        success = result.is_ok(),
        "IMAP operation completed"
    );
    result
}

fn connect(email: &str, password: &str) -> Result<Session, AppError> {
    let addresses: Vec<_> = ("imap.qiye.aliyun.com", 993)
        .to_socket_addrs()
        .map_err(|_| failure("IMAP 服务域名解析失败，请检查 DNS"))?
        .collect();
    let started = Instant::now();
    let mut connected = None;
    for address in addresses {
        let remaining = Duration::from_secs(10).saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        if let Ok(stream) =
            TcpStream::connect_timeout(&address, remaining.min(Duration::from_secs(2)))
        {
            connected = Some(stream);
            break;
        }
    }
    let stream = connected.ok_or_else(|| {
        failure("无法连接阿里邮箱 IMAP 993 端口，请检查网络、防火墙或邮箱连接限制")
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(12)))
        .map_err(protocol_error)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(12)))
        .map_err(protocol_error)?;
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(protocol_error)?;
    let stream = tls
        .connect("imap.qiye.aliyun.com", stream)
        .map_err(|_| failure("IMAP TLS 握手失败，请检查网络、证书或邮箱连接限制"))?;
    let mut client = imap::Client::new(stream);
    client
        .read_greeting()
        .map_err(|_| failure("IMAP 服务未返回登录欢迎信息，请稍后重试"))?;
    client
        .login(email, password)
        .map_err(|_| failure("IMAP 授权失败，请检查主邮箱授权码，并在邮箱设置中开启 IMAP 服务"))
}
// Prefer server-advertised SPECIAL-USE attributes, then exact known mailbox names.
fn resolve_folder(
    session: &mut imap::Session<impl std::io::Read + std::io::Write>,
    folder: &str,
) -> Result<Option<String>, AppError> {
    if folder == "inbox" || folder == "starred" {
        return Ok(Some("INBOX".into()));
    }
    let (attribute, aliases): (&str, &[&str]) = match folder {
        "sent" => (
            "\\Sent",
            &[
                "Sent",
                "Sent Messages",
                "Sent Items",
                "已发送",
                "已发送邮件",
            ],
        ),
        "drafts" => ("\\Drafts", &["Drafts", "草稿箱", "草稿"]),
        "trash" => (
            "\\Trash",
            &[
                "Trash",
                "Deleted Messages",
                "Deleted Items",
                "已删除",
                "已删除邮件",
            ],
        ),
        "important" => return Ok(None),
        _ => return Err(failure("无效的邮件分类")),
    };
    let names = session.list(Some(""), Some("*")).map_err(protocol_error)?;
    for name in names.iter() {
        if name.attributes().iter().any(|value| matches!(value, imap::types::NameAttribute::Custom(value) if value.eq_ignore_ascii_case(attribute))) {
            return Ok(Some(name.name().into()));
        }
    }
    Ok(names
        .iter()
        .find(|name| {
            aliases.iter().any(|alias| {
                name.name().eq_ignore_ascii_case(alias) || name.name() == encode_mailbox_name(alias)
            })
        })
        .map(|name| name.name().to_string()))
}
fn encode_mailbox_name(value: &str) -> String {
    use base64::Engine;
    let mut output = String::new();
    let mut unicode = String::new();
    let flush = |unicode: &mut String, output: &mut String| {
        if !unicode.is_empty() {
            let bytes: Vec<u8> = unicode.encode_utf16().flat_map(u16::to_be_bytes).collect();
            output.push('&');
            output.push_str(
                &base64::engine::general_purpose::STANDARD_NO_PAD
                    .encode(bytes)
                    .replace('/', ","),
            );
            output.push('-');
            unicode.clear();
        }
    };
    for ch in value.chars() {
        if ch.is_ascii() {
            flush(&mut unicode, &mut output);
            if ch == '&' {
                output.push_str("&-");
            } else {
                output.push(ch);
            }
        } else {
            unicode.push(ch);
        }
    }
    flush(&mut unicode, &mut output);
    output
}

async fn credentials(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(String, String, String), AppError> {
    let user = authorization::current_user(headers, state).await?;
    authorization::resolved_tenant_id(state, &user).await?;
    let email = user
        .email
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| failure("当前用户未设置主邮箱，请在用户管理中配置"))?;
    normalize_addresses(vec![email.clone()], "主邮箱")?;
    let password = mailbox_password(state, user.id, &email).await?;
    Ok((user.id.to_string(), email, password))
}

pub(crate) async fn recent_contacts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MailContact>>>, AppError> {
    let (scope, email, password) = credentials(&state, &headers).await?;
    // Exclude primary and additional addresses, even those without SMTP authorization.
    let user = authorization::current_user(&headers, &state).await?;
    let rows = state
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT email FROM iam_user_email_addresses WHERE user_id = $1",
            vec![user.id.into()],
        ))
        .await?;
    let mut own = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "email"))
        .collect::<Result<Vec<_>, _>>()?;
    own.push(email.clone());
    let result = run(move || {
        with_session(&scope, &email, &password, |session| {
            recent_contacts_from_session(session, &own, chrono::Utc::now())
        })
    })
    .await?;
    Ok(Json(success_response("最近联系人已加载", result)))
}

fn recent_contacts_from_session(
    session: &mut imap::Session<impl std::io::Read + std::io::Write>,
    own: &[String],
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<MailContact>, AppError> {
    let cutoff = now - chrono::Duration::days(7);
    // SINCE has day granularity. Fetch an extra day and enforce the exact window locally.
    let since = (cutoff - chrono::Duration::days(1)).format("%d-%b-%Y");
    let mut contacts = std::collections::HashMap::<String, (i64, MailContact)>::new();
    for folder in ["inbox", "sent"] {
        let Some(name) = resolve_folder(session, folder)? else {
            continue;
        };
        let mailbox = session.examine(&name).map_err(protocol_error)?;
        if mailbox.exists == 0 {
            continue;
        }
        let mut uids: Vec<_> = session
            .uid_search(format!("SINCE {since}"))
            .map_err(protocol_error)?
            .into_iter()
            .collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        // Only headers are read; no message bodies, attachments or Seen mutations.
        for chunk in uids.chunks(100) {
            let set = chunk
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let messages = session
                .uid_fetch(set, "(UID INTERNALDATE BODY.PEEK[HEADER])")
                .map_err(protocol_error)?;
            for message in messages.iter() {
                let Some(raw) = message.header() else {
                    continue;
                };
                if raw.len() > 256 * 1024 {
                    continue;
                }
                let Ok((headers, _)) = mailparse::parse_headers(raw) else {
                    continue;
                };
                // Incoming contacts use delivery time; outgoing contacts use send time.
                let internal = message.internal_date().map(|date| date.timestamp());
                let sent = mailparse::dateparse(&header(&headers, "Date")).ok();
                let timestamp = if folder == "sent" {
                    sent.or(internal)
                } else {
                    internal.or(sent)
                };
                let Some(timestamp) = timestamp
                    .filter(|time| *time >= cutoff.timestamp() && *time <= now.timestamp())
                else {
                    continue;
                };
                let fields: &[&str] = if folder == "sent" {
                    &["To", "Cc", "Bcc"]
                } else {
                    &["From"]
                };
                for field in fields {
                    for value in headers.get_all_values(field) {
                        collect_recent_addresses(&mut contacts, &value, timestamp, own);
                    }
                }
            }
        }
    }
    let mut contacts: Vec<_> = contacts.into_values().collect();
    contacts.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.email.cmp(&b.1.email)));
    contacts.truncate(500);
    Ok(contacts.into_iter().map(|(_, contact)| contact).collect())
}

fn collect_recent_addresses(
    contacts: &mut std::collections::HashMap<String, (i64, MailContact)>,
    value: &str,
    timestamp: i64,
    own: &[String],
) {
    let Ok(addresses) = mailparse::addrparse(value) else {
        return;
    };
    let mut add = |address: &mailparse::SingleInfo| {
        let email = address.addr.trim().to_ascii_lowercase();
        if own.iter().any(|value| value.eq_ignore_ascii_case(&email))
            || email.parse::<lettre::Address>().is_err()
        {
            return;
        }
        if contacts
            .get(&email)
            .is_some_and(|(time, _)| *time >= timestamp)
        {
            return;
        }
        let name = address
            .display_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&email)
            .to_string();
        contacts.insert(
            email.clone(),
            (
                timestamp,
                MailContact {
                    name,
                    email,
                    avatar_url: None,
                },
            ),
        );
    };
    for address in addresses.iter() {
        match address {
            mailparse::MailAddr::Single(address) => add(address),
            mailparse::MailAddr::Group(group) => {
                for address in &group.addrs {
                    add(address);
                }
            }
        }
    }
}

pub(crate) async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MailListQuery>,
) -> Result<Json<ApiResponse<MailPageResponse>>, AppError> {
    let (scope, email, password) = credentials(&state, &headers).await?;
    let result =
        run(move || with_session(&scope, &email, &password, |session| list(session, query)))
            .await?;
    Ok(Json(success_response("邮件列表已读取", result)))
}
fn list(
    session: &mut imap::Session<impl std::io::Read + std::io::Write>,
    query: MailListQuery,
) -> Result<MailPageResponse, AppError> {
    let Some(folder) = resolve_folder(session, &query.folder)? else {
        return Ok(MailPageResponse {
            items: vec![],
            next_before_uid: None,
            uid_validity: 0,
            notice: Some(
                if query.folder == "important" {
                    "重要联系人不是标准 IMAP 文件夹，暂未接入联系人筛选"
                } else {
                    "邮箱服务未提供此分类对应的文件夹"
                }
                .into(),
            ),
        });
    };
    let mailbox = session
        .examine(&folder)
        .map_err(|_| failure("IMAP 文件夹打开失败或超时，请稍后重试"))?;
    let validity = mailbox
        .uid_validity
        .ok_or_else(|| failure("邮箱未返回 UIDVALIDITY"))?;
    if query.uid_validity.is_some_and(|value| value != validity) {
        return Err(failure("邮箱文件夹已更新，请刷新列表"));
    }
    let filter = if query.folder == "starred" {
        "FLAGGED"
    } else {
        "ALL"
    };
    if query.before_uid.is_some_and(|uid| uid <= 1) {
        return Ok(MailPageResponse {
            items: vec![],
            next_before_uid: None,
            uid_validity: validity,
            notice: None,
        });
    }
    let ceiling = query.before_uid.or(mailbox.uid_next);
    let (mut uids, resume) = if let Some(ceiling) = ceiling {
        bounded_search(ceiling, filter, |search| {
            session
                .uid_search(search)
                .map(|values| values.into_iter().collect())
                .map_err(|_| failure("IMAP 邮件索引查询失败或超时，请稍后重试"))
        })?
    } else {
        // Older servers without UIDNEXT use the original UID search fallback.
        let search = query
            .before_uid
            .map(|uid| format!("UID 1:{} {filter}", uid - 1))
            .unwrap_or_else(|| filter.into());
        (
            session
                .uid_search(search)
                .map_err(|_| failure("IMAP 邮件索引查询失败或超时，请稍后重试"))?
                .into_iter()
                .collect(),
            None,
        )
    };
    uids.sort_unstable_by(|a, b| b.cmp(a));
    let has_more = uids.len() > 25;
    uids.truncate(25);
    let next = if has_more {
        uids.last().copied()
    } else {
        resume
    };
    let mut items = vec![];
    if !uids.is_empty() {
        let set = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let messages = session
            .uid_fetch(
                set,
                "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.8192>)",
            )
            .map_err(|_| failure("IMAP 邮件头读取失败或超时，请稍后重试"))?;
        for message in messages.iter() {
            let Some(uid) = message.uid else {
                continue;
            };
            let raw = message.header().ok_or_else(|| failure("邮件头无法读取"))?;
            if raw.len() > 256 * 1024 {
                return Err(failure("邮件头过大，无法读取"));
            }
            let (headers, _) = mailparse::parse_headers(raw).map_err(protocol_error)?;
            items.push(MailSummary {
                id: uid.to_string(),
                sender: header(&headers, "From"),
                recipient: header(&headers, "To"),
                subject: header(&headers, "Subject"),
                preview: list_preview(raw, message.text()),
                sent_at: header(&headers, "Date"),
                is_read: message
                    .flags()
                    .iter()
                    .any(|flag| matches!(flag, imap::types::Flag::Seen)),
                is_starred: message
                    .flags()
                    .iter()
                    .any(|flag| matches!(flag, imap::types::Flag::Flagged)),
            });
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.id.parse::<u32>().unwrap_or(0)));
    }
    Ok(MailPageResponse {
        items,
        next_before_uid: next,
        uid_validity: validity,
        notice: if query.folder == "starred" {
            Some("显示收件箱中的星标邮件".into())
        } else {
            None
        },
    })
}
// Never ask a large mailbox to return its complete UID index for one page.
fn bounded_search(
    ceiling: u32,
    filter: &str,
    mut search: impl FnMut(String) -> Result<Vec<u32>, AppError>,
) -> Result<(Vec<u32>, Option<u32>), AppError> {
    let started = Instant::now();
    let mut upper = ceiling.saturating_sub(1);
    let mut values = vec![];
    for _ in 0..4 {
        if upper == 0 {
            break;
        }
        let lower = upper.saturating_sub(4095).max(1);
        values.extend(
            search(format!("UID {lower}:{upper} {filter}"))?
                .into_iter()
                .filter(|uid| *uid >= lower && *uid <= upper),
        );
        upper = lower - 1;
        if values.len() > 25 || started.elapsed() >= Duration::from_secs(5) {
            break;
        }
    }
    Ok((values, if upper > 0 { Some(upper + 1) } else { None }))
}

fn header(headers: &[mailparse::MailHeader<'_>], key: &str) -> String {
    headers.get_first_value(key).unwrap_or_default()
}
pub(crate) async fn get_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uid): Path<u32>,
    Query(query): Query<MailDetailQuery>,
) -> Result<Json<ApiResponse<MailDetailResponse>>, AppError> {
    if uid == 0 {
        return Err(failure("无效的邮件编号"));
    }
    let (scope, email, password) = credentials(&state, &headers).await?;
    let result = run(move || {
        with_session(&scope, &email, &password, |session| {
            detail(session, uid, query)
        })
    })
    .await?;
    Ok(Json(success_response("邮件详情已读取", result)))
}
fn detail(
    session: &mut imap::Session<impl std::io::Read + std::io::Write>,
    uid: u32,
    query: MailDetailQuery,
) -> Result<MailDetailResponse, AppError> {
    read_message(session, uid, query, parse_detail)
}
fn read_message<T>(
    session: &mut imap::Session<impl std::io::Read + std::io::Write>,
    uid: u32,
    query: MailDetailQuery,
    parse: impl FnOnce(&[u8]) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let folder =
        resolve_folder(session, &query.folder)?.ok_or_else(|| failure("邮件文件夹不存在"))?;
    let mailbox = session
        .examine(&folder)
        .map_err(|_| failure("IMAP 文件夹打开失败或超时，请稍后重试"))?;
    if mailbox.uid_validity != Some(query.uid_validity) {
        return Err(failure("邮箱文件夹已更新，请刷新列表"));
    }
    let sizes = session
        .uid_fetch(uid.to_string(), "RFC822.SIZE")
        .map_err(protocol_error)?;
    let size = sizes
        .iter()
        .next()
        .and_then(|value| value.size)
        .ok_or_else(|| failure("邮件不存在或已被移动"))?;
    if size > 10 * 1024 * 1024 {
        return Err(failure("邮件超过 10MB，请在邮箱客户端查看"));
    }
    let messages = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .map_err(protocol_error)?;
    let raw = messages
        .iter()
        .next()
        .and_then(|message| message.body())
        .ok_or_else(|| failure("邮件不存在或已被移动"))?;
    parse(raw)
}
// Bound each list preview to 8 KiB and reuse the list FETCH, never download attachments
// or open a connection per row. Truncated/unsupported MIME must not fail the list.
fn list_preview(headers: &[u8], body: Option<&[u8]>) -> String {
    let Some(body) = body else {
        return String::new();
    };
    let mut raw = headers.to_vec();
    raw.extend_from_slice(body);
    parse_body(&raw, false)
        .map(|detail| {
            detail
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(160)
                .collect()
        })
        .unwrap_or_default()
}
fn parse_detail(raw: &[u8]) -> Result<MailDetailResponse, AppError> {
    parse_body(raw, true)
}
fn parse_body(raw: &[u8], include_images: bool) -> Result<MailDetailResponse, AppError> {
    let parsed = mailparse::parse_mail(raw).map_err(protocol_error)?;
    let mut plain = vec![];
    let mut html = vec![];
    let mut attachments = false;
    body_parts(&parsed, &mut plain, &mut html, &mut attachments)?;
    let mut inline_images = std::collections::BTreeMap::new();
    if include_images {
        collect_inline_images(&parsed, &mut inline_images)?;
    }
    let attachments = if include_images {
        attachment_data(&parsed, &inline_images)?
            .into_iter()
            .map(|(metadata, _)| metadata)
            .collect()
    } else {
        vec![]
    };
    let text = if !plain.is_empty() {
        plain.join("\n\n")
    } else {
        html.iter()
            .map(|body| html2text::from_read(body.as_bytes(), 100).unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    Ok(MailDetailResponse {
        subject: header(&parsed.headers, "Subject"),
        sender: header(&parsed.headers, "From"),
        recipient: header(&parsed.headers, "To"),
        cc: header(&parsed.headers, "Cc"),
        sent_at: header(&parsed.headers, "Date"),
        text,
        html: if html.is_empty() {
            None
        } else {
            Some(html.join("\n"))
        },
        inline_images,
        has_attachments: !attachments.is_empty(),
        attachments,
    })
}
fn attachment_data(
    mail: &mailparse::ParsedMail<'_>,
    inline_images: &std::collections::BTreeMap<String, String>,
) -> Result<Vec<(MailAttachment, Vec<u8>)>, AppError> {
    fn walk(
        mail: &mailparse::ParsedMail<'_>,
        inline_images: &std::collections::BTreeMap<String, String>,
        output: &mut Vec<(MailAttachment, Vec<u8>)>,
    ) -> Result<(), AppError> {
        let disposition = mail.get_content_disposition();
        let filename = disposition
            .params
            .get("filename")
            .or_else(|| mail.ctype.params.get("name"));
        let cid = header(&mail.headers, "Content-ID");
        if inline_images.contains_key(cid.trim().trim_start_matches('<').trim_end_matches('>')) {
            return Ok(());
        }
        if filename.is_some()
            || disposition.disposition == mailparse::DispositionType::Attachment
            || (mail.subparts.is_empty()
                && !matches!(mail.ctype.mimetype.as_str(), "text/plain" | "text/html"))
        {
            let bytes = mail
                .get_body_raw()
                .map_err(|_| failure("邮件附件解码失败"))?;
            let id = output.len() as u32;
            let filename = filename
                .cloned()
                .unwrap_or_else(|| format!("附件-{}", id + 1));
            let filename: String = filename
                .chars()
                .map(|ch| {
                    if ch.is_control() || matches!(ch, '/' | '\\') {
                        '_'
                    } else {
                        ch
                    }
                })
                .collect();
            output.push((
                MailAttachment {
                    id,
                    filename,
                    content_type: mail.ctype.mimetype.clone(),
                    size: bytes.len(),
                },
                bytes,
            ));
            return Ok(());
        }
        for part in &mail.subparts {
            walk(part, inline_images, output)?;
        }
        Ok(())
    }
    let mut output = vec![];
    walk(mail, inline_images, &mut output)?;
    Ok(output)
}

pub(crate) async fn download_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uid, attachment_id)): Path<(u32, u32)>,
    Query(query): Query<MailDetailQuery>,
) -> Result<axum::response::Response, AppError> {
    if uid == 0 {
        return Err(failure("无效的邮件编号"));
    }
    let (scope, email, password) = credentials(&state, &headers).await?;
    let (attachment, bytes) = run(move || {
        with_session(&scope, &email, &password, |session| {
            read_message(session, uid, query, |raw| {
                let parsed = mailparse::parse_mail(raw).map_err(protocol_error)?;
                let mut images = std::collections::BTreeMap::new();
                collect_inline_images(&parsed, &mut images)?;
                attachment_data(&parsed, &images)?
                    .into_iter()
                    .find(|(item, _)| item.id == attachment_id)
                    .ok_or_else(|| failure("附件不存在或邮件已更新"))
            })
        })
    })
    .await?;
    let encoded = url::form_urlencoded::byte_serialize(attachment.filename.as_bytes())
        .collect::<String>()
        .replace('+', "%20");
    axum::response::Response::builder()
        .header("content-type", "application/octet-stream")
        .header(
            "content-disposition",
            format!("attachment; filename=\"attachment.bin\"; filename*=UTF-8''{encoded}"),
        )
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .body(axum::body::Body::from(bytes))
        .map_err(|_| failure("附件下载响应生成失败"))
}

// Only supported CID images become data URLs; ordinary attachments use authenticated downloads.
fn collect_inline_images(
    mail: &mailparse::ParsedMail<'_>,
    images: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), AppError> {
    use base64::Engine;
    let content_id = header(&mail.headers, "Content-ID");
    let id = content_id
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>');
    if !id.is_empty() && mail.subparts.is_empty() {
        let bytes = mail
            .get_body_raw()
            .map_err(|_| failure("邮件内嵌图片解码失败"))?;
        let declared = mail.ctype.mimetype.to_ascii_lowercase();
        // Aliyun commonly labels inline JPEG/PNG files as application/octet-stream.
        // Use file signatures rather than trusting extensions or treating all files as images.
        let mime = raster_image_type(&bytes).or_else(|| match declared.as_str() {
            "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
            | "image/avif" => Some(declared.as_str()),
            "image/jpg" | "image/pjpeg" => Some("image/jpeg"),
            "image/x-png" => Some("image/png"),
            _ => None,
        });
        if let Some(mime) = mime {
            images.entry(id.to_string()).or_insert_with(|| {
                format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            });
        }
    }
    for part in &mail.subparts {
        collect_inline_images(part, images)?;
    }
    Ok(())
}
fn raster_image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else if bytes.starts_with(b"\x00\x00\x01\x00") {
        Some("image/x-icon")
    } else if bytes.get(4..8) == Some(b"ftyp")
        && matches!(bytes.get(8..12), Some(b"avif" | b"avis"))
    {
        Some("image/avif")
    } else {
        None
    }
}
fn body_parts(
    mail: &mailparse::ParsedMail<'_>,
    plain: &mut Vec<String>,
    html: &mut Vec<String>,
    attachments: &mut bool,
) -> Result<(), AppError> {
    let disposition = mail.get_content_disposition();
    if disposition.disposition == mailparse::DispositionType::Attachment
        || disposition.params.contains_key("filename")
        || mail.ctype.params.contains_key("name")
    {
        *attachments = true;
        return Ok(());
    }
    if mail.subparts.is_empty() {
        match mail.ctype.mimetype.as_str() {
            "text/plain" => plain.push(mail.get_body().map_err(protocol_error)?),
            "text/html" => {
                let body = mail.get_body().map_err(protocol_error)?;
                html.push(body);
            }
            _ => *attachments = true,
        }
    } else {
        for part in &mail.subparts {
            body_parts(part, plain, html, attachments)?;
        }
    }
    Ok(())
}
pub(super) async fn archive_sent(
    email: String,
    password: String,
    raw: Vec<u8>,
    message_id: Option<String>,
) -> Result<(), AppError> {
    run(move || {
        let mut session = connect(&email, &password)?;
        let result = (|| {
            let folder = resolve_folder(&mut session, "sent")?
                .ok_or_else(|| failure("未找到已发送文件夹"))?;
            session.select(&folder).map_err(protocol_error)?;
            if let Some(id) = message_id.filter(|value| {
                value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"<>@._-".contains(&byte))
            }) {
                if !session
                    .uid_search(format!("HEADER Message-ID \"{id}\""))
                    .map_err(protocol_error)?
                    .is_empty()
                {
                    return Ok(());
                }
            }
            session
                .append_with_flags(&folder, raw, &[imap::types::Flag::Seen])
                .map_err(protocol_error)?;
            Ok(())
        })();
        let _ = session.logout();
        result
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recent_contacts_use_one_week_headers_deduplicate_and_exclude_self() {
        let fetch = |uid, internal: &str, headers: &str| {
            format!(
                "* {uid} FETCH (UID {uid} INTERNALDATE \"{internal}\" BODY[HEADER] {{{}}}\r\n{headers})\r\n",
                headers.len()
            )
        };
        let inbox = fetch(
            1,
            "15-Oct-2026 10:00:00 +0000",
            "From: Alice <ALICE@example.com>\r\n\r\n",
        ) + &fetch(
            2,
            "08-Oct-2026 11:59:59 +0000",
            "From: old@example.com\r\n\r\n",
        ) + &fetch(
            3,
            "15-Oct-2026 11:00:00 +0000",
            "From: ME@example.com\r\n\r\n",
        );
        let sent = fetch(
            4,
            "15-Oct-2026 11:30:00 +0000",
            "From: me@example.com\r\nTo: Latest Alice <alice@example.com>, Bob <bob@example.com>, alias@example.com\r\nCc: Carol <carol@example.com>\r\nDate: Thu, 15 Oct 2026 11:30:00 +0000\r\n\r\n",
        );
        let (mut session, worker) = mock_session(vec![
            ("LOGIN \"user@example.com\" \"test-password\"", "".into()),
            ("EXAMINE \"INBOX\"", "* 3 EXISTS\r\n".into()),
            ("UID SEARCH SINCE 07-Oct-2026", "* SEARCH 1 2 3\r\n".into()),
            (
                "UID FETCH 3,2,1 (UID INTERNALDATE BODY.PEEK[HEADER])",
                inbox,
            ),
            ("LIST \"\" *", "* LIST (\\Sent) \"/\" \"Sent\"\r\n".into()),
            ("EXAMINE \"Sent\"", "* 1 EXISTS\r\n".into()),
            ("UID SEARCH SINCE 07-Oct-2026", "* SEARCH 4\r\n".into()),
            ("UID FETCH 4 (UID INTERNALDATE BODY.PEEK[HEADER])", sent),
        ]);
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-15T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let contacts = recent_contacts_from_session(
            &mut session,
            &["me@example.com".into(), "alias@example.com".into()],
            now,
        )
        .unwrap();
        assert_eq!(
            contacts
                .iter()
                .map(|contact| contact.email.as_str())
                .collect::<Vec<_>>(),
            vec!["alice@example.com", "bob@example.com", "carol@example.com"]
        );
        assert_eq!(contacts[0].name, "Latest Alice");
        worker.join().unwrap();
    }

    #[test]
    fn recent_address_groups_are_parsed_and_newest_contact_wins() {
        let mut contacts = std::collections::HashMap::new();
        collect_recent_addresses(
            &mut contacts,
            "Team: Older <a@example.com>, b@example.com;",
            20,
            &[],
        );
        collect_recent_addresses(&mut contacts, "Newest <A@example.com>", 30, &[]);
        collect_recent_addresses(&mut contacts, "Oldest <a@example.com>", 10, &[]);
        assert_eq!(contacts.len(), 2);
        assert_eq!(contacts["a@example.com"].1.name, "Newest");
    }

    fn mock_session(
        expected: Vec<(&'static str, String)>,
    ) -> (imap::Session<TcpStream>, std::thread::JoinHandle<()>) {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream.write_all(b"* OK test mailbox\r\n").unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for (command, response) in expected {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let (tag, actual) = line.trim_end().split_once(' ').unwrap();
                assert_eq!(actual, command);
                write!(stream, "{response}{tag} OK completed\r\n").unwrap();
            }
        });
        let mut client = imap::Client::new(TcpStream::connect(address).unwrap());
        client.read_greeting().unwrap();
        let session = client
            .login("user@example.com", "test-password")
            .map_err(|(error, _)| error)
            .unwrap();
        (session, worker)
    }
    #[test]
    fn protocol_lists_newest_uids_and_uses_read_only_peek() {
        let header =
            "From: from@example.com\r\nTo: to@example.com\r\nSubject: Test\r\nDate: today\r\n\r\n";
        let fixture = format!(
            "* 1 FETCH (UID 1 FLAGS (\\Seen) BODY[HEADER] {{{}}}\r\n{} BODY[TEXT]<0> {{11}}\r\nHello world)\r\n* 2 FETCH (UID 2 FLAGS (\\Flagged) BODY[HEADER] {{{}}}\r\n{} BODY[TEXT]<0> {{11}}\r\nHello world)\r\n",
            header.len(),
            header,
            header.len(),
            header
        );
        let (mut session, worker) = mock_session(vec![
            ("LOGIN \"user@example.com\" \"test-password\"", "".into()),
            (
                "EXAMINE \"INBOX\"",
                "* 2 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\n".into(),
            ),
            ("UID SEARCH ALL", "* SEARCH 1 2\r\n".into()),
            (
                "UID FETCH 2,1 (UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.8192>)",
                fixture,
            ),
        ]);
        let result = list(
            &mut session,
            MailListQuery {
                folder: "inbox".into(),
                before_uid: None,
                uid_validity: None,
            },
        )
        .unwrap();
        assert_eq!(result.uid_validity, 9);
        assert_eq!(result.items[0].id, "2");
        assert!(result.items[0].is_starred);
        assert_eq!(result.items[0].preview, "Hello world");
        assert!(result.items[1].is_read);
        assert!(result.next_before_uid.is_none());
        worker.join().unwrap();
    }
    #[test]
    fn cursor_search_excludes_newer_mail_and_sets_next_cursor() {
        let ids: Vec<u32> = (1..=26).collect();
        let search = format!(
            "* SEARCH {}\r\n",
            ids.iter().map(u32::to_string).collect::<Vec<_>>().join(" ")
        );
        let fetch = format!(
            "UID FETCH {} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.8192>)",
            (2..=26)
                .rev()
                .map(|uid| uid.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        // Keep command storage alive for the synchronous mock worker.
        let command: &'static str = Box::leak(fetch.into_boxed_str());
        let (mut session, worker) = mock_session(vec![
            ("LOGIN \"user@example.com\" \"test-password\"", "".into()),
            (
                "EXAMINE \"INBOX\"",
                "* 26 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\n".into(),
            ),
            ("UID SEARCH UID 1:29 ALL", search),
            (command, "".into()),
        ]);
        let page = list(
            &mut session,
            MailListQuery {
                folder: "inbox".into(),
                before_uid: Some(30),
                uid_validity: Some(9),
            },
        )
        .unwrap();
        assert_eq!(page.next_before_uid, Some(2));
        worker.join().unwrap();
    }
    #[test]
    fn special_use_folder_resolves_arbitrary_provider_name() {
        let (mut session, worker) = mock_session(vec![
            ("LOGIN \"user@example.com\" \"test-password\"", "".into()),
            (
                "LIST \"\" *",
                "* LIST (\\Sent) \"/\" \"ProviderSent\"\r\n".into(),
            ),
        ]);
        assert_eq!(
            resolve_folder(&mut session, "sent").unwrap(),
            Some("ProviderSent".into())
        );
        worker.join().unwrap();
    }
    #[test]
    fn stale_validity_rejects_before_fetch() {
        let (mut session, worker) = mock_session(vec![
            ("LOGIN \"user@example.com\" \"test-password\"", "".into()),
            (
                "EXAMINE \"INBOX\"",
                "* 0 EXISTS\r\n* OK [UIDVALIDITY 10] valid\r\n".into(),
            ),
        ]);
        assert!(
            list(
                &mut session,
                MailListQuery {
                    folder: "inbox".into(),
                    before_uid: Some(20),
                    uid_validity: Some(9)
                }
            )
            .is_err()
        );
        worker.join().unwrap();
    }
    #[test]
    fn bounded_uid_search_does_not_scan_the_entire_large_mailbox() {
        let mut calls = vec![];
        let (values, resume) = bounded_search(100_001, "ALL", |query| {
            calls.push(query);
            Ok((99_975..=100_000).collect())
        })
        .unwrap();
        assert_eq!(calls, vec!["UID 95905:100000 ALL"]);
        assert_eq!(values.len(), 26);
        assert_eq!(resume, Some(95905));
        let (values, resume) = bounded_search(100_001, "FLAGGED", |_| Ok(vec![])).unwrap();
        assert!(values.is_empty());
        assert_eq!(resume, Some(83617));
    }
    #[test]
    fn session_pool_keys_isolate_users_and_changed_credentials() {
        assert_ne!(
            session_key("user-a", "test@example.com", "code"),
            session_key("user-b", "test@example.com", "code")
        );
        assert_ne!(
            session_key("user-a", "test@example.com", "code"),
            session_key("user-a", "test@example.com", "changed")
        );
        assert_ne!(
            session_key("user-a", "test@example.com", "code"),
            session_key("user-a", "other@example.com", "code")
        );
        assert_eq!(
            session_key("user-a", "test@example.com", "code"),
            session_key("user-a", "test@example.com", "code")
        );
    }
    #[test]
    fn modified_utf7_encodes_chinese_folder_names() {
        assert_eq!(encode_mailbox_name("台北"), "&U,BTFw-");
        assert_eq!(encode_mailbox_name("Sent & Drafts"), "Sent &- Drafts");
    }
    #[tokio::test]
    #[ignore = "requires explicit local primary-mailbox authorization; reads only, never sends"]
    async fn live_primary_mailbox_read_only() {
        let db = sea_orm::Database::connect(std::env::var("DATABASE_URL").expect("DATABASE_URL"))
            .await
            .unwrap();
        let row = db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
            "SELECT u.email, a.encrypted_password FROM iam_users u JOIN user_smtp_authorizations a ON a.user_id = u.id AND a.email = lower(u.email) WHERE u.id = $1",
            vec![Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap().into()])).await.unwrap().expect("primary mailbox authorization");
        let email: String = row.try_get("", "email").unwrap();
        let password = crate::modules::byom::decrypt(
            &row.try_get::<String>("", "encrypted_password").unwrap(),
        )
        .unwrap();
        run(move || {
            if let Ok(uid) = std::env::var("YAYA_MAIL_VERIFY_UID") {
                let mut session = connect(&email, &password)?;
                let mailbox = session.examine("INBOX").map_err(protocol_error)?;
                let message = detail(
                    &mut session,
                    uid.parse().unwrap(),
                    MailDetailQuery {
                        folder: "inbox".into(),
                        uid_validity: mailbox.uid_validity.unwrap(),
                    },
                )?;
                let cid = std::env::var("YAYA_MAIL_VERIFY_CID").expect("YAYA_MAIL_VERIFY_CID");
                assert!(
                    message.inline_images.contains_key(&cid),
                    "expected CID must be decoded"
                );
                println!("verified inline images: {}", message.inline_images.len());
                if std::env::var("YAYA_MAIL_VERIFY_ATTACHMENTS").as_deref() == Ok("1") {
                    assert!(
                        !message.attachments.is_empty(),
                        "expected ordinary attachment"
                    );
                    let files = read_message(
                        &mut session,
                        uid.parse().unwrap(),
                        MailDetailQuery {
                            folder: "inbox".into(),
                            uid_validity: mailbox.uid_validity.unwrap(),
                        },
                        |raw| {
                            let parsed = mailparse::parse_mail(raw).map_err(protocol_error)?;
                            let mut images = std::collections::BTreeMap::new();
                            collect_inline_images(&parsed, &mut images)?;
                            attachment_data(&parsed, &images)
                        },
                    )?;
                    assert_eq!(files.len(), message.attachments.len());
                    for ((file, bytes), expected) in files.iter().zip(&message.attachments) {
                        assert_eq!(file.id, expected.id);
                        assert_eq!(file.filename, expected.filename);
                        assert_eq!(bytes.len(), expected.size);
                        assert!(!bytes.is_empty());
                    }
                    println!("verified downloadable attachments: {}", files.len());
                }
                let _ = session.logout();
                return Ok(());
            }
            for attempt in 0..2 {
                let started = Instant::now();
                let count = with_session("live-performance-check", &email, &password, |session| {
                    list(
                        session,
                        MailListQuery {
                            folder: "inbox".into(),
                            before_uid: None,
                            uid_validity: None,
                        },
                    )
                    .map(|page| page.items.len())
                })?;
                println!(
                    "inbox attempt={attempt}: count={count}, elapsed_ms={}",
                    started.elapsed().as_millis()
                );
            }
            let mut session = connect(&email, &password)?;
            for folder in ["inbox", "sent", "drafts", "trash", "starred"] {
                let page = list(
                    &mut session,
                    MailListQuery {
                        folder: folder.into(),
                        before_uid: None,
                        uid_validity: None,
                    },
                )?;
                println!(
                    "{folder}: count={}, has_more={}, supported={}",
                    page.items.len(),
                    page.next_before_uid.is_some(),
                    page.notice.is_none()
                );
                if folder == "inbox" {
                    if let Some(message) = page.items.first() {
                        let value = detail(
                            &mut session,
                            message.id.parse().unwrap(),
                            MailDetailQuery {
                                folder: folder.into(),
                                uid_validity: page.uid_validity,
                            },
                        )?;
                        println!(
                            "detail: text_bytes={}, attachments={}",
                            value.text.len(),
                            value.has_attachments
                        );
                    }
                }
            }
            let _ = session.logout();
            Ok(())
        })
        .await
        .unwrap();
    }

    #[test]
    fn decodes_chinese_and_never_exposes_html_as_markup() {
        let mail = parse_detail(b"Subject: =?UTF-8?B?5rWL6K+V?=\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><script>alert(1)</script>").unwrap();
        assert_eq!(mail.subject, "测试");
        assert!(mail.text.contains("Hello"));
        assert!(mail.html.as_deref().unwrap().contains("<p>Hello</p>"));
        assert!(!mail.text.contains("<script>"));
    }
    #[test]
    fn list_preview_is_bounded_safe_and_tolerates_missing_body() {
        let headers = b"Content-Type: text/html; charset=utf-8\r\n\r\n";
        let body = format!("<p>{}</p><script>hidden</script>", "hello ".repeat(100));
        let preview = list_preview(headers, Some(body.as_bytes()));
        assert_eq!(preview.chars().count(), 160);
        assert!(!preview.contains('<'));
        assert_eq!(list_preview(headers, None), "");
        assert_eq!(
            list_preview(
                b"Content-Disposition: attachment; filename=x.txt\r\n\r\n",
                Some(b"private attachment")
            ),
            ""
        );
    }
    #[test]
    fn decodes_nested_cid_images_including_named_attachments() {
        let raw = concat!(
            "Content-Type: multipart/related; boundary=outer\r\n\r\n",
            "--outer\r\nContent-Type: multipart/alternative; boundary=inner\r\n\r\n",
            "--inner\r\nContent-Type: text/plain\r\n\r\nHello\r\n",
            "--inner\r\nContent-Type: text/html\r\n\r\n<p>Hello<img src=\"cid:logo@example\"></p>\r\n--inner--\r\n",
            "--outer\r\nContent-Type: image/png; name=logo.png\r\nContent-ID: <logo@example>\r\n",
            "Content-Disposition: inline; filename=logo.png\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n",
            "--outer\r\nContent-Type: image/jpeg\r\nContent-ID: <photo@example>\r\n",
            "Content-Disposition: attachment; filename=photo.jpg\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=41=42=43\r\n",
            "--outer\r\nContent-Type: application/pdf\r\nContent-ID: <file@example>\r\n\r\nprivate\r\n--outer--\r\n"
        );
        let mail = parse_detail(raw.as_bytes()).unwrap();
        assert_eq!(mail.inline_images.len(), 2);
        assert_eq!(
            mail.inline_images["logo@example"],
            "data:image/png;base64,aGVsbG8="
        );
        assert_eq!(
            mail.inline_images["photo@example"],
            "data:image/jpeg;base64,QUJD"
        );
        assert!(mail.html.unwrap().contains("cid:logo@example"));
        assert_eq!(mail.text.trim(), "Hello");
        assert!(
            parse_body(raw.as_bytes(), false)
                .unwrap()
                .inline_images
                .is_empty()
        );
    }
    #[test]
    fn aliyun_generic_mime_inline_images_are_detected_from_bytes() {
        use base64::Engine;
        for (id, bytes, mime) in [
            (
                "__aliyun175446669277980181",
                b"\xff\xd8\xff\xe0image".as_slice(),
                "image/jpeg",
            ),
            (
                "__aliyun175446669277980182",
                b"\x89PNG\r\n\x1a\nimage".as_slice(),
                "image/png",
            ),
            (
                "image021385.gif@3723AB6C.DFD6986D",
                b"GIF89aimage".as_slice(),
                "image/gif",
            ),
        ] {
            let body = base64::engine::general_purpose::STANDARD.encode(bytes);
            let raw = format!(
                "Content-Type: application/octet-stream\r\nContent-ID: <{id}>\r\nContent-Disposition: attachment; filename=image.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n{body}"
            );
            let message = parse_detail(raw.as_bytes()).unwrap();
            assert_eq!(
                message.inline_images[id],
                format!("data:{mime};base64,{body}")
            );
        }
        for bytes in [
            b"%PDF-1.7".as_slice(),
            b"Rar!archive".as_slice(),
            b"<svg/>".as_slice(),
        ] {
            assert!(raster_image_type(bytes).is_none());
        }
        let file = parse_detail(b"Content-Type: application/octet-stream\r\nContent-ID: <not-image>\r\nContent-Disposition: attachment; filename=photo.jpg\r\n\r\n%PDF-1.7").unwrap();
        assert!(file.inline_images.is_empty());
    }
    #[test]
    fn cid_images_exclude_svg_and_unidentified_files() {
        let svg =
            parse_detail(b"Content-Type: image/svg+xml\r\nContent-ID: <vector>\r\n\r\n<svg/>")
                .unwrap();
        assert!(svg.inline_images.is_empty());
        let image = parse_detail(b"Content-Type: image/png\r\n\r\nbytes").unwrap();
        assert!(image.inline_images.is_empty());
    }
    #[test]
    fn attachments_are_not_rendered_as_body() {
        let mail = parse_detail(b"Content-Type: text/plain\r\nContent-Disposition: attachment; filename=secret.txt\r\n\r\nattachment content").unwrap();
        assert!(mail.has_attachments);
        assert!(mail.text.is_empty());
    }

    #[test]
    fn attachment_metadata_and_download_bytes_match_without_exposing_inline_images() {
        let raw = concat!(
            "Content-Type: multipart/mixed; boundary=x\r\n\r\n",
            "--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n正文\r\n",
            "--x\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\n",
            "Content-Disposition: inline; filename=logo.png\r\nContent-Transfer-Encoding: base64\r\n\r\naW1hZ2U=\r\n",
            "--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=report.rar\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\nUmFyIQ==\r\n",
            "--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=report.rar\r\n\r\nsecond\r\n--x--\r\n"
        );
        let detail = parse_detail(raw.as_bytes()).unwrap();
        assert_eq!(detail.attachments.len(), 2);
        assert_eq!(detail.attachments[0].filename, "report.rar");
        assert_eq!(detail.attachments[0].size, 4);
        assert_eq!(detail.attachments[1].id, 1);
        assert_eq!(detail.text.trim(), "正文");
        let parsed = mailparse::parse_mail(raw.as_bytes()).unwrap();
        let files = attachment_data(&parsed, &detail.inline_images).unwrap();
        assert_eq!(files[0].1, b"Rar!");
        assert_eq!(files[1].1, b"second");
    }

    #[test]
    fn attachment_names_are_safe_and_preserve_unicode() {
        let raw = "Content-Type: text/plain\r\nContent-Disposition: attachment; filename=\"../测试.txt\"\r\n\r\nfile";
        let detail = parse_detail(raw.as_bytes()).unwrap();
        assert_eq!(detail.attachments[0].filename, ".._测试.txt");
        assert_eq!(detail.attachments[0].size, 4);
    }
}
