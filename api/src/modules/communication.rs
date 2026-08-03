use axum::{
    Json,
    extract::ws::{Message as WebSocketMessage, WebSocketUpgrade},
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue},
    response::Response,
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DbBackend, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait, Value as SeaValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    infrastructure::entities::{
        communication_conversation_entity as conversation,
        communication_conversation_member_entity as member,
        communication_message_entity as message, iam_user_entity,
    },
    platform::{
        api::ApiResponse,
        authorization,
        config::{communication_module_enabled, load_communication_settings},
        error::AppError,
        runtime::AppState,
    },
    shared::{format_datetime, success_response},
};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationAvailabilityResponse {
    pub(crate) enabled: bool,
}

pub(crate) async fn communication_status() -> Json<ApiResponse<CommunicationAvailabilityResponse>> {
    Json(success_response(
        "communication availability loaded",
        CommunicationAvailabilityResponse {
            enabled: communication_module_enabled(),
        },
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateDirectConversationRequest {
    pub(crate) user_id: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateGroupConversationRequest {
    pub(crate) title: String,
    pub(crate) member_ids: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateGroupConversationRequest {
    pub(crate) title: Option<String>,
    pub(crate) add_member_ids: Vec<String>,
    pub(crate) remove_member_ids: Vec<String>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransferGroupOwnerRequest {
    pub(crate) user_id: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendCommunicationMessageRequest {
    pub(crate) message_type: String,
    #[serde(default)]
    pub(crate) content: String,
    pub(crate) client_message_id: Option<String>,
    #[serde(default)]
    pub(crate) file_ids: Vec<String>,
    pub(crate) email_subject: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecallCommunicationMessageRequest {
    pub(crate) reason: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReeditCommunicationMessageRequest {
    pub(crate) content: String,
    pub(crate) client_message_id: Option<String>,
    #[serde(default)]
    pub(crate) file_ids: Vec<String>,
    pub(crate) email_subject: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkConversationReadRequest {
    pub(crate) sequence: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCommunicationMessagesQuery {
    pub(crate) before_sequence: Option<i64>,
    pub(crate) limit: Option<u64>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ListCommunicationUsersQuery {
    pub(crate) query: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationUserResponse {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) avatar_url: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationMemberResponse {
    pub(crate) user_id: String,
    pub(crate) display_name: String,
    pub(crate) avatar_url: Option<String>,
    pub(crate) role: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationConversationResponse {
    pub(crate) id: String,
    pub(crate) conversation_type: String,
    pub(crate) title: String,
    pub(crate) members: Vec<CommunicationMemberResponse>,
    pub(crate) last_message_sequence: i64,
    pub(crate) last_message_at: Option<String>,
    pub(crate) last_message_preview: Option<String>,
    pub(crate) unread_count: i64,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationMessageResponse {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) sender_user_id: String,
    pub(crate) sequence: i64,
    pub(crate) message_type: String,
    pub(crate) content: String,
    pub(crate) email_subject: Option<String>,
    pub(crate) file_ids: Vec<String>,
    pub(crate) attachments: Vec<CommunicationAttachmentResponse>,
    pub(crate) status: String,
    pub(crate) replaces_message_id: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationAttachmentResponse {
    pub(crate) file_id: String,
    pub(crate) name: String,
    pub(crate) size: i64,
    pub(crate) mime_type: String,
    pub(crate) is_image: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommunicationMessagePageResponse {
    pub(crate) items: Vec<CommunicationMessageResponse>,
    pub(crate) next_before_sequence: Option<i64>,
}

pub(crate) async fn create_direct_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDirectConversationRequest>,
) -> Result<Json<ApiResponse<CommunicationConversationResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let other_id = parse_uuid(&payload.user_id, "user id")?;
    if current.id == other_id {
        return Err(AppError::BadRequest("不能与自己创建单聊".into()));
    }
    let other = active_user(&state, other_id).await?;
    let direct_key = direct_key(current.id, other_id);
    if let Some(existing) = conversation::Entity::find()
        .filter(conversation::Column::DirectKey.eq(&direct_key))
        .one(&state.db)
        .await?
    {
        return Ok(Json(success_response(
            "单聊会话已存在",
            conversation_response(&state, existing, current.id).await?,
        )));
    }

    let txn = state.db.begin().await?;
    let now = Utc::now();
    let model = conversation::ActiveModel {
        id: Set(Uuid::new_v4()),
        conversation_uuid: Set(Uuid::new_v4().to_string()),
        conversation_type: Set("direct".into()),
        direct_key: Set(Some(direct_key)),
        title: Set(None),
        created_by_user_id: Set(current.id),
        last_message_sequence: Set(0),
        last_message_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    for user_id in [current.id, other.id] {
        member::ActiveModel {
            conversation_id: Set(model.id),
            user_id: Set(user_id),
            member_role: Set("member".into()),
            last_read_sequence: Set(0),
            joined_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    txn.commit().await?;
    state.invalidate_communication_memberships(&model.conversation_uuid);
    Ok(Json(success_response(
        "单聊会话已创建",
        conversation_response(&state, model, current.id).await?,
    )))
}

pub(crate) async fn create_group_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateGroupConversationRequest>,
) -> Result<Json<ApiResponse<CommunicationConversationResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let title = payload.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 160 {
        return Err(AppError::BadRequest(
            "群聊名称必须为 1 至 160 个字符".into(),
        ));
    }
    let mut user_ids = HashSet::from([current.id]);
    for value in payload.member_ids {
        user_ids.insert(parse_uuid(&value, "member id")?);
    }
    if user_ids.len() < 2 || user_ids.len() > 500 {
        return Err(AppError::BadRequest(
            "群聊成员数量必须为 2 至 500 人".into(),
        ));
    }
    for user_id in &user_ids {
        active_user(&state, *user_id).await?;
    }
    let txn = state.db.begin().await?;
    let now = Utc::now();
    let model = conversation::ActiveModel {
        id: Set(Uuid::new_v4()),
        conversation_uuid: Set(Uuid::new_v4().to_string()),
        conversation_type: Set("group".into()),
        direct_key: Set(None),
        title: Set(Some(title)),
        created_by_user_id: Set(current.id),
        last_message_sequence: Set(0),
        last_message_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    for user_id in user_ids {
        member::ActiveModel {
            conversation_id: Set(model.id),
            user_id: Set(user_id),
            member_role: Set(if user_id == current.id {
                "owner"
            } else {
                "member"
            }
            .into()),
            last_read_sequence: Set(0),
            joined_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    txn.commit().await?;
    state.invalidate_communication_memberships(&model.conversation_uuid);
    Ok(Json(success_response(
        "群聊已创建",
        conversation_response(&state, model, current.id).await?,
    )))
}

pub(crate) async fn update_group_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
    Json(payload): Json<UpdateGroupConversationRequest>,
) -> Result<Json<ApiResponse<CommunicationConversationResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    if conversation.conversation_type != "group" {
        return Err(AppError::BadRequest("只有群聊支持成员管理".into()));
    }
    let owner = member::Entity::find_by_id((conversation.id, current.id))
        .one(&state.db)
        .await?
        .filter(|item| item.member_role == "owner");
    if owner.is_none() {
        return Err(AppError::Forbidden("只有群主可以管理群聊".into()));
    }
    if let Some(title) = payload.title.map(|value| value.trim().to_string()) {
        if title.is_empty() || title.chars().count() > 160 {
            return Err(AppError::BadRequest(
                "群聊名称必须为 1 至 160 个字符".into(),
            ));
        }
        let mut model: conversation::ActiveModel = conversation.clone().into();
        model.title = Set(Some(title));
        model.updated_at = Set(Utc::now());
        model.update(&state.db).await?;
    }
    let add_ids = payload
        .add_member_ids
        .into_iter()
        .map(|value| parse_uuid(&value, "member id"))
        .collect::<Result<Vec<_>, _>>()?;
    for user_id in &add_ids {
        active_user(&state, *user_id).await?;
    }
    let existing = member::Entity::find()
        .filter(member::Column::ConversationId.eq(conversation.id))
        .all(&state.db)
        .await?;
    let existing_ids: HashSet<Uuid> = existing.iter().map(|item| item.user_id).collect();
    if existing_ids.len()
        + add_ids
            .iter()
            .filter(|id| !existing_ids.contains(id))
            .count()
        > 500
    {
        return Err(AppError::BadRequest("群聊成员不能超过 500 人".into()));
    }
    for user_id in add_ids.into_iter().filter(|id| !existing_ids.contains(id)) {
        member::ActiveModel {
            conversation_id: Set(conversation.id),
            user_id: Set(user_id),
            member_role: Set("member".into()),
            last_read_sequence: Set(0),
            joined_at: Set(Utc::now()),
        }
        .insert(&state.db)
        .await?;
    }
    let remove_ids = payload
        .remove_member_ids
        .into_iter()
        .map(|value| parse_uuid(&value, "member id"))
        .collect::<Result<Vec<_>, _>>()?;
    if remove_ids.contains(&current.id) {
        return Err(AppError::BadRequest("群主不能移除自己".into()));
    }
    for user_id in remove_ids {
        member::Entity::delete_by_id((conversation.id, user_id))
            .exec(&state.db)
            .await?;
    }
    state.invalidate_communication_memberships(&conversation_uuid);
    let event = persist_message(
        &state,
        &conversation,
        current.id,
        SendCommunicationMessageRequest {
            message_type: "system".into(),
            content: "群成员已更新".into(),
            client_message_id: None,
            file_ids: Vec::new(),
            email_subject: None,
        },
        None,
    )
    .await?;
    state.publish_communication_event("message.created", &event);
    let refreshed = conversation::Entity::find_by_id(conversation.id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("会话不存在".into()))?;
    Ok(Json(success_response(
        "群聊已更新",
        conversation_response(&state, refreshed, current.id).await?,
    )))
}

pub(crate) async fn transfer_group_owner(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
    Json(payload): Json<TransferGroupOwnerRequest>,
) -> Result<Json<ApiResponse<CommunicationConversationResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let target = parse_uuid(&payload.user_id, "user id")?;
    if target == current.id {
        return Err(AppError::BadRequest("目标用户已经是群主".into()));
    }
    let owner = member::Entity::find_by_id((conversation.id, current.id))
        .one(&state.db)
        .await?
        .filter(|m| m.member_role == "owner");
    if owner.is_none() {
        return Err(AppError::Forbidden("只有群主可以转让群主".into()));
    }
    if member::Entity::find_by_id((conversation.id, target))
        .one(&state.db)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest("目标用户不是群成员".into()));
    }
    let event = persist_message(
        &state,
        &conversation,
        current.id,
        SendCommunicationMessageRequest {
            message_type: "system".into(),
            content: "群主已转让".into(),
            client_message_id: None,
            file_ids: Vec::new(),
            email_subject: None,
        },
        None,
    )
    .await?;
    state.publish_communication_event("message.created", &event);
    member::Entity::update_many()
        .filter(member::Column::ConversationId.eq(conversation.id))
        .filter(member::Column::UserId.eq(current.id))
        .col_expr(
            member::Column::MemberRole,
            sea_orm::sea_query::Expr::value("member"),
        )
        .exec(&state.db)
        .await?;
    member::Entity::update_many()
        .filter(member::Column::ConversationId.eq(conversation.id))
        .filter(member::Column::UserId.eq(target))
        .col_expr(
            member::Column::MemberRole,
            sea_orm::sea_query::Expr::value("owner"),
        )
        .exec(&state.db)
        .await?;
    Ok(Json(success_response(
        "群主已转让",
        conversation_response(&state, conversation, current.id).await?,
    )))
}

pub(crate) async fn leave_group_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    if conversation.conversation_type != "group" {
        return Err(AppError::BadRequest("只有群聊可以退出".into()));
    }
    let membership = member::Entity::find_by_id((conversation.id, current.id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::Forbidden("不是会话成员".into()))?;
    if membership.member_role == "owner" {
        return Err(AppError::BadRequest("群主必须先转让群主后才能退出".into()));
    }
    let event = persist_message(
        &state,
        &conversation,
        current.id,
        SendCommunicationMessageRequest {
            message_type: "system".into(),
            content: "成员已退出群聊".into(),
            client_message_id: None,
            file_ids: Vec::new(),
            email_subject: None,
        },
        None,
    )
    .await?;
    state.publish_communication_event("message.created", &event);
    member::Entity::delete_by_id((conversation.id, current.id))
        .exec(&state.db)
        .await?;
    state.invalidate_communication_memberships(&conversation_uuid);
    Ok(Json(success_response(
        "已退出群聊",
        json!({"conversationId": conversation_uuid}),
    )))
}

pub(crate) async fn delete_group_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    if conversation.conversation_type != "group" {
        return Err(AppError::BadRequest("只有群聊可以解散".into()));
    }
    let owner = member::Entity::find_by_id((conversation.id, current.id))
        .one(&state.db)
        .await?
        .filter(|m| m.member_role == "owner");
    if owner.is_none() {
        return Err(AppError::Forbidden("只有群主可以解散群聊".into()));
    }
    message::Entity::delete_many()
        .filter(message::Column::ConversationId.eq(conversation.id))
        .exec(&state.db)
        .await?;
    member::Entity::delete_many()
        .filter(member::Column::ConversationId.eq(conversation.id))
        .exec(&state.db)
        .await?;
    conversation::Entity::delete_by_id(conversation.id)
        .exec(&state.db)
        .await?;
    state.invalidate_communication_memberships(&conversation_uuid);
    Ok(Json(success_response(
        "群聊已解散",
        json!({"conversationId": conversation_uuid}),
    )))
}

pub(crate) async fn list_conversations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<CommunicationConversationResponse>>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let memberships = member::Entity::find()
        .filter(member::Column::UserId.eq(current.id))
        .all(&state.db)
        .await?;
    let conversation_ids = memberships
        .iter()
        .map(|item| item.conversation_id)
        .collect::<Vec<_>>();
    if conversation_ids.is_empty() {
        return Ok(Json(success_response("会话列表已加载", Vec::new())));
    }
    let conversations = conversation::Entity::find()
        .filter(conversation::Column::Id.is_in(conversation_ids.clone()))
        .all(&state.db)
        .await?;
    let all_memberships = member::Entity::find()
        .filter(member::Column::ConversationId.is_in(conversation_ids.clone()))
        .all(&state.db)
        .await?;
    let user_ids = all_memberships
        .iter()
        .map(|item| item.user_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let users = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::Id.is_in(user_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|user| (user.id, user))
        .collect::<HashMap<_, _>>();
    let placeholders = (1..=conversation_ids.len())
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>()
        .join(",");
    let values = conversation_ids
        .iter()
        .copied()
        .map(|id| SeaValue::Uuid(Some(id)))
        .collect::<Vec<_>>();
    let last_rows = state.db.query_all_raw(Statement::from_sql_and_values(DbBackend::Postgres, format!("SELECT DISTINCT ON (conversation_id) conversation_id, content, message_type, status, metadata_json FROM communication_messages WHERE conversation_id IN ({placeholders}) ORDER BY conversation_id, sequence DESC"), values)).await?;
    let mut previews = HashMap::new();
    for row in last_rows {
        let id: Uuid = row.try_get("", "conversation_id")?;
        let content: String = row.try_get("", "content")?;
        let kind: String = row.try_get("", "message_type")?;
        let status: String = row.try_get("", "status")?;
        let metadata: Value = row.try_get("", "metadata_json")?;
        let preview = if status == "recalled" {
            "消息已撤回".into()
        } else if kind == "file" {
            format!("[文件] {content}")
        } else if kind == "email" {
            format!(
                "[邮件] {}",
                metadata
                    .get("emailSubject")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        } else {
            content.chars().take(80).collect()
        };
        previews.insert(id, preview);
    }
    let mut items = Vec::with_capacity(conversations.len());
    for model in conversations {
        let related = all_memberships
            .iter()
            .filter(|item| item.conversation_id == model.id)
            .collect::<Vec<_>>();
        let current_read = related
            .iter()
            .find(|item| item.user_id == current.id)
            .map(|item| item.last_read_sequence)
            .unwrap_or(0);
        let members = related
            .into_iter()
            .filter_map(|membership| {
                users
                    .get(&membership.user_id)
                    .map(|user| CommunicationMemberResponse {
                        user_id: user.id.to_string(),
                        display_name: user.display_name.clone(),
                        avatar_url: user.avatar_url.clone(),
                        role: membership.member_role.clone(),
                    })
            })
            .collect::<Vec<_>>();
        let title = model.title.clone().unwrap_or_else(|| {
            members
                .iter()
                .find(|item| item.user_id != current.id.to_string())
                .map(|item| item.display_name.clone())
                .unwrap_or_else(|| "单聊".into())
        });
        items.push(CommunicationConversationResponse {
            id: model.conversation_uuid,
            conversation_type: model.conversation_type,
            title,
            members,
            last_message_sequence: model.last_message_sequence,
            last_message_at: model.last_message_at.map(format_datetime),
            last_message_preview: previews.remove(&model.id),
            unread_count: (model.last_message_sequence - current_read).max(0),
        });
    }
    items.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
    Ok(Json(success_response("会话列表已加载", items)))
}

pub(crate) async fn list_communication_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListCommunicationUsersQuery>,
) -> Result<Json<ApiResponse<Vec<CommunicationUserResponse>>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let mut select = iam_user_entity::Entity::find()
        .filter(iam_user_entity::Column::Status.eq("active"))
        .filter(iam_user_entity::Column::Id.ne(current.id));
    if let Some(value) = query
        .query
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        select = select.filter(iam_user_entity::Column::DisplayName.contains(value));
    }
    let users = select
        .order_by_asc(iam_user_entity::Column::DisplayName)
        .limit(100)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|user| CommunicationUserResponse {
            id: user.id.to_string(),
            display_name: user.display_name,
            avatar_url: user.avatar_url,
        })
        .collect();
    Ok(Json(success_response("通讯录已加载", users)))
}

pub(crate) async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
    Query(query): Query<ListCommunicationMessagesQuery>,
) -> Result<Json<ApiResponse<CommunicationMessagePageResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let mut select =
        message::Entity::find().filter(message::Column::ConversationId.eq(conversation.id));
    if let Some(before) = query.before_sequence {
        select = select.filter(message::Column::Sequence.lt(before));
    }
    let models = select
        .order_by_desc(message::Column::Sequence)
        .limit(limit)
        .all(&state.db)
        .await?;
    let next = models.last().map(|item| item.sequence);
    let attachments_by_message = load_message_attachments(
        &state,
        &models.iter().map(|item| item.id).collect::<Vec<_>>(),
    )
    .await?;
    let mut items = Vec::with_capacity(models.len());
    for model in models.into_iter().rev() {
        let attachments = attachments_by_message
            .get(&model.id)
            .cloned()
            .unwrap_or_default();
        items.push(map_message_response(
            model,
            &conversation.conversation_uuid,
            attachments,
        ));
    }
    Ok(Json(success_response(
        "消息记录已加载",
        CommunicationMessagePageResponse {
            items,
            next_before_sequence: next,
        },
    )))
}

pub(crate) async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
    Json(payload): Json<SendCommunicationMessageRequest>,
) -> Result<Json<ApiResponse<CommunicationMessageResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let response = persist_message(&state, &conversation, current.id, payload, None).await?;
    state.publish_communication_event("message.created", &response);
    Ok(Json(success_response("消息已发送", response)))
}

pub(crate) async fn recall_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((conversation_uuid, message_uuid)): Path<(String, String)>,
    Json(payload): Json<RecallCommunicationMessageRequest>,
) -> Result<Json<ApiResponse<CommunicationMessageResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let model = message::Entity::find()
        .filter(message::Column::ConversationId.eq(conversation.id))
        .filter(message::Column::MessageUuid.eq(&message_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("消息不存在".into()))?;
    if model.sender_user_id != current.id {
        return Err(AppError::Forbidden("只能撤回自己发送的消息".into()));
    }
    if model.status == "recalled" {
        return Err(AppError::BadRequest("消息已经撤回".into()));
    }
    let has_unlimited_recall = conversation.conversation_type == "group"
        && member::Entity::find_by_id((conversation.id, current.id))
            .one(&state.db)
            .await?
            .is_some_and(|membership| matches!(membership.member_role.as_str(), "owner" | "admin"));
    if !has_unlimited_recall
        && Utc::now()
            .signed_duration_since(model.created_at)
            .num_minutes()
            >= 2
    {
        return Err(AppError::BadRequest("消息发送超过 2 分钟，不能撤回".into()));
    }
    let mut active: message::ActiveModel = model.into();
    active.status = Set("recalled".into());
    active.content = Set(String::new());
    active.recalled_at = Set(Some(Utc::now()));
    active.recalled_by_user_id = Set(Some(current.id));
    active.updated_at = Set(Utc::now());
    let mut metadata = active.metadata_json.take().unwrap_or_else(|| json!({}));
    if let Some(object) = metadata.as_object_mut() {
        object.insert(
            "recallReason".into(),
            json!(payload.reason.unwrap_or_default()),
        );
    }
    active.metadata_json = Set(metadata);
    let updated = active.update(&state.db).await?;
    let response = message_response(&state, updated, &conversation_uuid).await?;
    state.publish_communication_event("message.recalled", &response);
    Ok(Json(success_response("消息已撤回", response)))
}

pub(crate) async fn reedit_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((conversation_uuid, message_uuid)): Path<(String, String)>,
    Json(payload): Json<ReeditCommunicationMessageRequest>,
) -> Result<Json<ApiResponse<CommunicationMessageResponse>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let original = message::Entity::find()
        .filter(message::Column::ConversationId.eq(conversation.id))
        .filter(message::Column::MessageUuid.eq(message_uuid))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("消息不存在".into()))?;
    if original.sender_user_id != current.id || original.status != "recalled" {
        return Err(AppError::BadRequest(
            "只有自己撤回的消息可以重新编辑".into(),
        ));
    }
    let request = SendCommunicationMessageRequest {
        message_type: original.message_type,
        content: payload.content,
        client_message_id: payload.client_message_id,
        file_ids: payload.file_ids,
        email_subject: payload.email_subject,
    };
    let response = persist_message(
        &state,
        &conversation,
        current.id,
        request,
        Some(original.id),
    )
    .await?;
    state.publish_communication_event("message.created", &response);
    Ok(Json(success_response("消息已重新发送", response)))
}

pub(crate) async fn mark_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_uuid): Path<String>,
    Json(payload): Json<MarkConversationReadRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    require_enabled()?;
    let current = authorization::current_user(&headers, &state).await?;
    let conversation = member_conversation(&state, &conversation_uuid, current.id).await?;
    let sequence = payload
        .sequence
        .unwrap_or(conversation.last_message_sequence)
        .clamp(0, conversation.last_message_sequence);
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE communication_conversation_members SET last_read_sequence=GREATEST(last_read_sequence,$3) WHERE conversation_id=$1 AND user_id=$2",
            vec![
                SeaValue::Uuid(Some(conversation.id)),
                SeaValue::Uuid(Some(current.id)),
                SeaValue::BigInt(Some(sequence)),
            ],
        ))
        .await?;
    let event =
        json!({ "conversationId": conversation_uuid, "userId": current.id, "sequence": sequence });
    state.publish_communication_event("conversation.read", &event);
    Ok(Json(success_response("会话已读状态已更新", event)))
}

pub(crate) async fn communication_websocket(
    State(state): State<AppState>,
    websocket: WebSocketUpgrade,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    require_enabled()?;
    if !load_communication_settings()
        .unwrap_or_default()
        .websocket_enabled
    {
        return Err(AppError::Forbidden("WebSocket 实时推送已关闭".into()));
    }
    let protocol_header = headers
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let token = protocol_header
        .split(',')
        .map(str::trim)
        .find(|value| value.matches('.').count() == 2)
        .ok_or_else(|| AppError::Forbidden("实时连接缺少身份令牌".into()))?;
    let mut auth_headers = HeaderMap::new();
    auth_headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| AppError::Forbidden("实时连接身份令牌无效".into()))?,
    );
    authorization::authenticate(&auth_headers, &state).await?;
    let current = authorization::current_user(&auth_headers, &state).await?;
    let mut receiver = state.subscribe_communication_events();
    Ok(websocket
        .protocols(["yaya-chat"])
        .on_upgrade(move |mut socket| async move {
            let mut transient_events = VecDeque::new();
            loop {
                tokio::select! {
                incoming = socket.recv() => {
                    let Some(Ok(WebSocketMessage::Text(text))) = incoming else { break; };
                    let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };
                    let Some(conversation_id) = value.get("conversationId").and_then(Value::as_str) else { continue; };
                    let event_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
                    let now = Instant::now();
                    while transient_events.front().is_some_and(|sent_at| now.duration_since(*sent_at) > Duration::from_secs(10)) {
                        transient_events.pop_front();
                    }
                    if transient_events.len() >= 40 { continue; }
                    transient_events.push_back(now);
                    if !matches!(event_type, "conversation.typing" | "conversation.presence") || !websocket_member(&state, conversation_id, current.id).await { continue; }
                    state.publish_communication_event(event_type, &json!({ "conversationId": conversation_id, "userId": current.id, "typing": value.get("typing").and_then(Value::as_bool).unwrap_or(false), "online": true }));
                }
                received = receiver.recv() => {
                let Ok(event) = received else { continue; };
                let conversation_id =
                    serde_json::from_str::<Value>(&event)
                        .ok()
                        .and_then(|value| {
                            value
                                .pointer("/data/conversationId")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        });
                let Some(conversation_id) = conversation_id else {
                    continue;
                };
                if !websocket_member(&state, &conversation_id, current.id).await {
                    continue;
                }
                if socket
                    .send(WebSocketMessage::Text(event.into()))
                    .await
                    .is_err()
                {
                    break;
                }
                }
                }
            }
        }))
}

fn require_enabled() -> Result<(), AppError> {
    if communication_module_enabled() {
        Ok(())
    } else {
        Err(AppError::Forbidden("通讯模块未激活".into()))
    }
}

async fn active_user(state: &AppState, user_id: Uuid) -> Result<iam_user_entity::Model, AppError> {
    let user = iam_user_entity::Entity::find_by_id(user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("用户不存在".into()))?;
    if user.status != "active" {
        return Err(AppError::BadRequest("用户未启用".into()));
    }
    Ok(user)
}

async fn member_conversation(
    state: &AppState,
    value: &str,
    user_id: Uuid,
) -> Result<conversation::Model, AppError> {
    let model = conversation::Entity::find()
        .filter(conversation::Column::ConversationUuid.eq(value))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("会话不存在".into()))?;
    let membership = member::Entity::find_by_id((model.id, user_id))
        .one(&state.db)
        .await?;
    if membership.is_none() {
        return Err(AppError::Forbidden("你不是该会话成员".into()));
    }
    Ok(model)
}

async fn websocket_member(state: &AppState, conversation_id: &str, user_id: Uuid) -> bool {
    if state.communication_membership_cached(conversation_id, user_id) {
        return true;
    }
    if member_conversation(state, conversation_id, user_id)
        .await
        .is_ok()
    {
        state.cache_communication_membership(conversation_id, user_id);
        true
    } else {
        false
    }
}

async fn conversation_response(
    state: &AppState,
    model: conversation::Model,
    current_user_id: Uuid,
) -> Result<CommunicationConversationResponse, AppError> {
    let memberships = member::Entity::find()
        .filter(member::Column::ConversationId.eq(model.id))
        .all(&state.db)
        .await?;
    let current_read = memberships
        .iter()
        .find(|item| item.user_id == current_user_id)
        .map(|item| item.last_read_sequence)
        .unwrap_or(0);
    let mut members = Vec::with_capacity(memberships.len());
    for membership in memberships {
        if let Some(user) = iam_user_entity::Entity::find_by_id(membership.user_id)
            .one(&state.db)
            .await?
        {
            members.push(CommunicationMemberResponse {
                user_id: user.id.to_string(),
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                role: membership.member_role,
            });
        }
    }
    let title = model.title.clone().unwrap_or_else(|| {
        members
            .iter()
            .find(|item| item.user_id != current_user_id.to_string())
            .map(|item| item.display_name.clone())
            .unwrap_or_else(|| "单聊".into())
    });
    let last_message_preview = message::Entity::find()
        .filter(message::Column::ConversationId.eq(model.id))
        .order_by_desc(message::Column::Sequence)
        .one(&state.db)
        .await?
        .map(|item| {
            if item.status == "recalled" {
                "消息已撤回".to_string()
            } else if item.message_type == "file" {
                format!("[文件] {}", item.content)
            } else if item.message_type == "email" {
                format!(
                    "[邮件] {}",
                    item.metadata_json
                        .get("emailSubject")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                )
            } else {
                item.content.chars().take(80).collect()
            }
        });
    Ok(CommunicationConversationResponse {
        id: model.conversation_uuid,
        conversation_type: model.conversation_type,
        title,
        members,
        last_message_sequence: model.last_message_sequence,
        last_message_at: model.last_message_at.map(format_datetime),
        last_message_preview,
        unread_count: (model.last_message_sequence - current_read).max(0),
    })
}

async fn persist_message(
    state: &AppState,
    conversation: &conversation::Model,
    sender_user_id: Uuid,
    payload: SendCommunicationMessageRequest,
    replaces_message_id: Option<Uuid>,
) -> Result<CommunicationMessageResponse, AppError> {
    let message_type = payload.message_type.trim().to_lowercase();
    if !matches!(
        message_type.as_str(),
        "text" | "emoji" | "file" | "email" | "system"
    ) {
        return Err(AppError::BadRequest("不支持的消息类型".into()));
    }
    let content = payload.content.trim().to_string();
    if content.is_empty() && payload.file_ids.is_empty() {
        return Err(AppError::BadRequest("消息内容不能为空".into()));
    }
    if content.chars().count() > 100_000 {
        return Err(AppError::BadRequest(
            "消息内容不能超过 100000 个字符".into(),
        ));
    }
    let client_message_id = payload
        .client_message_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(client_id) = &client_message_id {
        if let Some(existing) = message::Entity::find()
            .filter(message::Column::SenderUserId.eq(sender_user_id))
            .filter(message::Column::ClientMessageId.eq(client_id))
            .one(&state.db)
            .await?
        {
            return message_response(state, existing, &conversation.conversation_uuid).await;
        }
    }
    let file_ids = payload
        .file_ids
        .into_iter()
        .map(|value| parse_uuid(&value, "file id"))
        .collect::<Result<Vec<_>, _>>()?;
    let communication_settings = load_communication_settings().unwrap_or_default();
    if !file_ids.is_empty() && !communication_settings.allow_file_messages {
        return Err(AppError::Forbidden("当前设置不允许发送聊天文件".into()));
    }
    let max_file_bytes = i64::from(communication_settings.max_file_upload_mb) * 1024 * 1024;
    for file_id in &file_ids {
        let row = state
            .db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id, original_name, byte_size FROM uploaded_files WHERE id=$1 AND uploaded_by=$2",
                vec![
                    SeaValue::Uuid(Some(*file_id)),
                    SeaValue::String(Some(sender_user_id.to_string())),
                ],
            ))
            .await?;
        if let Some(row) = row {
            let original_name: String = row.try_get("", "original_name")?;
            let byte_size: i64 = row.try_get("", "byte_size")?;
            if byte_size > max_file_bytes {
                return Err(AppError::BadRequest(format!(
                    "聊天文件不能超过 {} MB",
                    communication_settings.max_file_upload_mb
                )));
            }
            if !communication_settings
                .allowed_file_extensions
                .trim()
                .is_empty()
            {
                let extension = std::path::Path::new(&original_name)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !communication_settings
                    .allowed_file_extensions
                    .split(',')
                    .any(|value| value.trim() == extension)
                {
                    return Err(AppError::BadRequest(format!(
                        "不允许发送 .{extension} 文件"
                    )));
                }
            }
        } else {
            return Err(AppError::BadRequest("附件不存在或不属于当前用户".into()));
        }
    }
    let txn = state.db.begin().await?;
    let now = Utc::now();
    let row = txn.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "UPDATE communication_conversations SET last_message_sequence=last_message_sequence+1,last_message_at=$2,updated_at=$2 WHERE id=$1 RETURNING last_message_sequence",
        vec![SeaValue::Uuid(Some(conversation.id)), SeaValue::ChronoDateTimeUtc(Some(now))])).await?.ok_or_else(|| AppError::NotFound("会话不存在".into()))?;
    let sequence: i64 = row.try_get("", "last_message_sequence")?;
    let model = message::ActiveModel {
        id: Set(Uuid::new_v4()), message_uuid: Set(Uuid::new_v4().to_string()), conversation_id: Set(conversation.id), sender_user_id: Set(sender_user_id), sequence: Set(sequence),
        client_message_id: Set(client_message_id), message_type: Set(message_type), content: Set(content),
        metadata_json: Set(json!({ "emailSubject": payload.email_subject.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) })),
        status: Set("active".into()), recalled_at: Set(None), recalled_by_user_id: Set(None), replaces_message_id: Set(replaces_message_id), created_at: Set(now), updated_at: Set(now),
    }.insert(&txn).await?;
    for file_id in &file_ids {
        txn.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
            "INSERT INTO communication_message_attachments(message_id,file_id,created_at) VALUES($1,$2,$3)",
            vec![SeaValue::Uuid(Some(model.id)), SeaValue::Uuid(Some(*file_id)), SeaValue::ChronoDateTimeUtc(Some(now))])).await?;
    }
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE communication_conversation_members SET last_read_sequence=GREATEST(last_read_sequence,$3) WHERE conversation_id=$1 AND user_id=$2",
        vec![
            SeaValue::Uuid(Some(conversation.id)),
            SeaValue::Uuid(Some(sender_user_id)),
            SeaValue::BigInt(Some(sequence)),
        ],
    )).await?;
    txn.commit().await?;
    message_response(state, model, &conversation.conversation_uuid).await
}

async fn message_response(
    state: &AppState,
    model: message::Model,
    conversation_uuid: &str,
) -> Result<CommunicationMessageResponse, AppError> {
    let mut attachments_by_message = load_message_attachments(state, &[model.id]).await?;
    let attachments = attachments_by_message.remove(&model.id).unwrap_or_default();
    Ok(map_message_response(model, conversation_uuid, attachments))
}

async fn load_message_attachments(
    state: &AppState,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<CommunicationAttachmentResponse>>, AppError> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = (1..=message_ids.len())
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>()
        .join(",");
    let values = message_ids
        .iter()
        .copied()
        .map(|id| SeaValue::Uuid(Some(id)))
        .collect::<Vec<_>>();
    let rows = state
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!("SELECT a.message_id, a.file_id, f.original_name, f.byte_size, f.mime_type FROM communication_message_attachments a JOIN uploaded_files f ON f.id=a.file_id WHERE a.message_id IN ({placeholders}) ORDER BY a.created_at"),
            values,
        ))
        .await?;
    let mut attachments_by_message = HashMap::new();
    for row in rows {
        let message_id = row.try_get::<Uuid>("", "message_id")?;
        let file_id = row.try_get::<Uuid>("", "file_id")?;
        let name = row.try_get::<String>("", "original_name")?;
        let size = row.try_get::<i64>("", "byte_size")?;
        let mime_type = row.try_get::<String>("", "mime_type")?;
        attachments_by_message
            .entry(message_id)
            .or_insert_with(Vec::new)
            .push(CommunicationAttachmentResponse {
                file_id: file_id.to_string(),
                name,
                size,
                is_image: mime_type.starts_with("image/"),
                mime_type,
            });
    }
    Ok(attachments_by_message)
}

fn map_message_response(
    model: message::Model,
    conversation_uuid: &str,
    attachments: Vec<CommunicationAttachmentResponse>,
) -> CommunicationMessageResponse {
    let file_ids = attachments
        .iter()
        .map(|item| item.file_id.clone())
        .collect();
    CommunicationMessageResponse {
        id: model.message_uuid,
        conversation_id: conversation_uuid.to_string(),
        sender_user_id: model.sender_user_id.to_string(),
        sequence: model.sequence,
        message_type: model.message_type,
        content: model.content,
        email_subject: model
            .metadata_json
            .get("emailSubject")
            .and_then(Value::as_str)
            .map(str::to_string),
        file_ids,
        attachments,
        status: model.status,
        replaces_message_id: model.replaces_message_id.map(|id| id.to_string()),
        created_at: format_datetime(model.created_at),
    }
}

fn parse_uuid(value: &str, label: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value.trim()).map_err(|_| AppError::BadRequest(format!("{label} 格式无效")))
}

fn direct_key(first: Uuid, second: Uuid) -> String {
    let mut values = [first.to_string(), second.to_string()];
    values.sort();
    values.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_conversation_key_is_order_independent() {
        let first = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let second = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        assert_eq!(direct_key(first, second), direct_key(second, first));
    }
}
