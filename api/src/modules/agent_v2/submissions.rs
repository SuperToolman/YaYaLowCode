//! Immutable send envelopes. Staging never creates a visible conversation.
use super::*;
use axum::{body::Bytes, extract::DefaultBodyLimit, routing::put};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;
use yaya_agent_v2::{
    domain::ContentPart,
    files::*,
    store::{event, exec, js},
};

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentManifest {
    pub client_file_id: Uuid,
    pub name: String,
    pub size: i64,
    pub sha256: String,
}
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmissionInput {
    pub client_request_id: Uuid,
    pub employee_id: String,
    pub session_id: Option<Uuid>,
    pub text: String,
    pub attachments: Vec<AttachmentManifest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub knowledge_base_ids: Vec<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionResult {
    pub session_id: Uuid,
    pub message_id: Uuid,
    pub command_id: Uuid,
    pub run_id: Uuid,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachment {
    pub client_file_id: Uuid,
    pub uploaded: bool,
}
pub struct BinaryUpload;
impl utoipa::PartialSchema for BinaryUpload {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::*;
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}
impl ToSchema for BinaryUpload {}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub id: Uuid,
    pub status: String,
    pub expires_at: String,
    pub payload: SubmissionInput,
    pub attachments: Vec<StagedAttachment>,
    pub result: Option<SubmissionResult>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/agent/v2/submissions", post(create))
        .route(
            "/api/agent/v2/submissions/{submission_id}",
            get(read).delete(abandon),
        )
        .route(
            "/api/agent/v2/submissions/{submission_id}/commit",
            post(commit),
        )
        .route(
            "/api/agent/v2/submissions/{submission_id}/attachments/{file_id}",
            put(upload),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE_BYTES))
}
fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn conflict(message: &str) -> AppError {
    AppError::Conflict(message.into())
}
async fn load(
    db: &impl ConnectionTrait,
    scope: &Scope,
    sid: Uuid,
    lock: bool,
) -> Result<Value, AppError> {
    rows(db,&format!("SELECT (to_jsonb(s)||jsonb_build_object('expired',expires_at<=now()))::text data FROM agent_v2_submissions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND user_id=$3::uuid{}",if lock {" FOR UPDATE"} else {""}),vec![id(sid),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::NotFound("submission not found".into()))
}
async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    value: &Value,
) -> Result<Scope, AppError> {
    let (scope, grants) = principal(state, headers).await?;
    employee(&grants, value["employee_id"].as_str().unwrap_or("")).await?;
    if let Some(sid) = value["session_id"].as_str() {
        let (_, session) = access(state, headers, Uuid::parse_str(sid).map_err(map_store)?).await?;
        if session["employee_id"] != value["employee_id"] {
            return Err(conflict("会话员工不匹配"));
        }
    }
    Ok(scope)
}
async fn view(db: &impl ConnectionTrait, value: &Value) -> Result<Value, AppError> {
    if value["payload"]["deleted"]==true {return Err(conflict("此发送请求所属会话已彻底删除，不能恢复或重放"));}
    let sid = value["id"].as_str().unwrap_or("");
    let files=rows(db,"SELECT jsonb_build_object('clientFileId',id,'uploaded',contents IS NOT NULL OR $2='committed')::text data FROM agent_v2_staged_files WHERE submission_id=$1::uuid ORDER BY id",vec![sid.into(),value["status"].as_str().unwrap_or("").into()]).await.map_err(map_store)?;
    Ok(
        json!({"id":value["id"],"status":if value["status"]=="uploading" && value["expired"]==true {json!("expired")}else{value["status"].clone()},"expiresAt":value["expires_at"],"payload":value["payload"],"attachments":files,"result":value["result"]}),
    )
}
fn active(value: &Value) -> Result<(), AppError> {
    if value["status"] != "uploading" || value["expired"] == true {
        return Err(conflict("发送请求已失效，请重新发送"));
    }
    Ok(())
}
fn validate(input: &SubmissionInput) -> Result<(), AppError> {
    if input.knowledge_base_ids.len()>50 || input.knowledge_base_ids.iter().collect::<HashSet<_>>().len()!=input.knowledge_base_ids.len() {
        return Err(bad("每次最多选择50个不同知识库"));
    }
    if input.employee_id.is_empty()
        || input.text.len() > 65536
        || (input.text.trim().is_empty() && input.attachments.is_empty())
        || input.attachments.len() > 8
    {
        return Err(bad("消息或附件数量无效"));
    }
    if input
        .reasoning_effort
        .as_deref()
        .is_some_and(|v| !matches!(v, "auto" | "off" | "low" | "medium" | "high" | "ultra" | "extreme" | "max"))
    {
        return Err(bad("无效的思考强度"));
    }
    let mut ids = HashSet::new();
    let mut total = 0;
    for file in &input.attachments {
        validate_name(&file.name).map_err(bad)?;
        if !ids.insert(file.client_file_id)
            || !(1..=MAX_FILE_BYTES as i64).contains(&file.size)
            || file.sha256.len() != 64
            || !file
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(bad("附件清单无效"));
        }
        total += file.size;
    }
    if total > 16 * 1024 * 1024 {
        return Err(bad("附件合计超过 16 MiB"));
    }
    Ok(())
}
#[utoipa::path(post,path="/api/agent/v2/submissions",operation_id="agentV2CreateSubmission",request_body=SubmissionInput,responses((status=200,body=Submission)))]
pub(crate) async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SubmissionInput>,
) -> Result<Json<Value>, AppError> {
    validate(&input)?;
    let (scope, grants) = principal(&state, &headers).await?;
    employee(&grants, &input.employee_id).await?;
    if let Some(sid) = input.session_id {
        let (_, s) = access(&state, &headers, sid).await?;
        if !s["archived_at"].is_null(){return Err(conflict("会话已归档，请恢复后发送消息"));}
        if s["employee_id"] != input.employee_id {
            return Err(conflict("会话员工不匹配"));
        }
    }
    let payload = serde_json::to_value(&input).map_err(map_store)?;
    let fingerprint = yaya_agent_v2::store::fingerprint(&payload);
    let tx = state.db.begin().await?;
    // Serialize quota reservation and request-ID deduplication across all API instances.
    rows(&tx,"SELECT jsonb_build_object('ok',true)::text data FROM pg_advisory_xact_lock(hashtextextended($1,0))",vec![format!("v2-staging:{}:{}",scope.tenant_id,scope.user_id).into()]).await.map_err(map_store)?;
    if let Some(old)=rows(&tx,"SELECT (to_jsonb(s)||jsonb_build_object('expired',expires_at<=now()))::text data FROM agent_v2_submissions s WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND client_id=$3::uuid",vec![id(scope.tenant_id),id(scope.user_id),id(input.client_request_id)]).await.map_err(map_store)?.pop(){
        if old["fingerprint"]!=fingerprint{return Err(conflict("发送请求幂等键冲突"));}
        return Ok(Json(view(&tx,&old).await?));
    }
    let used=rows(&tx,"SELECT jsonb_build_object('bytes',COALESCE(sum(f.size),0),'count',count(*))::text data FROM agent_v2_staged_files f JOIN agent_v2_submissions s ON s.id=f.submission_id WHERE s.tenant_id=$1::uuid AND s.user_id=$2::uuid AND s.status='uploading' AND s.expires_at>now()",vec![id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.remove(0);
    if used["bytes"].as_i64().unwrap_or(0) + input.attachments.iter().map(|f| f.size).sum::<i64>()
        > MAX_WORKSPACE_BYTES
        || used["count"].as_u64().unwrap_or(0) + input.attachments.len() as u64 > 200
    {
        return Err(bad("临时附件区超过 100 MiB / 200 个附件"));
    }
    let sid = Uuid::new_v4();
    exec(&tx,"INSERT INTO agent_v2_submissions(id,tenant_id,user_id,client_id,employee_id,session_id,payload,fingerprint) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8)",vec![id(sid),id(scope.tenant_id),id(scope.user_id),id(input.client_request_id),input.employee_id.into(),input.session_id.map(|v|v.to_string()).into(),js(payload),fingerprint.into()]).await.map_err(map_store)?;
    for f in input.attachments {
        exec(&tx,"INSERT INTO agent_v2_staged_files(submission_id,id,name,size,sha256) VALUES($1::uuid,$2::uuid,$3,$4,$5)",vec![id(sid),id(f.client_file_id),f.name.into(),f.size.into(),f.sha256.into()]).await.map_err(map_store)?;
    }
    let value = view(&tx, &load(&tx, &scope, sid, false).await?).await?;
    tx.commit().await?;
    Ok(Json(value))
}
#[utoipa::path(get,path="/api/agent/v2/submissions/{submission_id}",operation_id="agentV2Submission",params(("submission_id"=Uuid,Path)),responses((status=200,body=Submission)))]
pub(crate) async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let (scope, _) = principal(&state, &headers).await?;
    let value = load(&state.db, &scope, sid, false).await?;
    authorize(&state, &headers, &value).await?;
    Ok(Json(view(&state.db, &value).await?))
}
#[utoipa::path(put,path="/api/agent/v2/submissions/{submission_id}/attachments/{file_id}",operation_id="agentV2UploadStagedFile",params(("submission_id"=Uuid,Path),("file_id"=Uuid,Path)),request_body(content=BinaryUpload,content_type="application/octet-stream"),responses((status=200,body=Submission)))]
pub(crate) async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((sid, fid)): Path<(Uuid, Uuid)>,
    bytes: Bytes,
) -> Result<Json<Value>, AppError> {
    if headers.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/octet-stream")
    {
        return Err(bad("请使用 application/octet-stream"));
    }
    let (scope, _) = principal(&state, &headers).await?;
    let tx = state.db.begin().await?;
    let value = load(&tx, &scope, sid, true).await?;
    authorize(&state, &headers, &value).await?;
    active(&value)?;
    let manifest: SubmissionInput =
        serde_json::from_value(value["payload"].clone()).map_err(map_store)?;
    let f = manifest
        .attachments
        .iter()
        .find(|f| f.client_file_id == fid)
        .ok_or_else(|| bad("附件不在冻结清单中"))?;
    if bytes.len() as i64 != f.size || format!("{:x}", Sha256::digest(&bytes)) != f.sha256 {
        return Err(conflict("附件大小或 hash 不匹配"));
    }
    exec(&tx,"UPDATE agent_v2_staged_files SET contents=$3,mime_type=$4 WHERE submission_id=$1::uuid AND id=$2::uuid",vec![id(sid),id(fid),bytes.to_vec().into(),detected_mime(&f.name,&bytes).into()]).await.map_err(map_store)?;
    let result = view(&tx, &value).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[utoipa::path(post,path="/api/agent/v2/submissions/{submission_id}/commit",operation_id="agentV2CommitSubmission",params(("submission_id"=Uuid,Path)),responses((status=200,body=Submission)))]
pub(crate) async fn commit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let (scope, _) = principal(&state, &headers).await?;
    let tx = state.db.begin().await?;
    let value = load(&tx, &scope, sid, true).await?;
    authorize(&state, &headers, &value).await?;
    if value["status"] == "committed" {
        return Ok(Json(view(&tx, &value).await?));
    }
    active(&value)?;
    let input: SubmissionInput =
        serde_json::from_value(value["payload"].clone()).map_err(map_store)?;
    let route = byom::resolve_subject_route(
        &state,
        &scope.tenant_id.to_string(),
        &scope.user_id.to_string(),
        byom::RuntimeModelRouteQuery {
            route_id: input.route_id.clone(),
            model: input.model.clone(),
        },
    )
    .await?;
    let requested = input.reasoning_effort.as_deref().unwrap_or("auto");
    let enabled=route.thinking_enabled && requested!="off";
    let effort=if requested=="off" || (!enabled && requested=="auto") {None} else if requested=="auto" {if route.default_reasoning_effort=="auto" {None} else {Some(route.default_reasoning_effort.as_str())}} else {Some(requested)};
    if effort.is_some() && !enabled { return Err(bad("该供应商未开启深度思考，请重新选择")); }
    if let Some(effort)=effort {if !byom::reasoning_efforts(&route.reasoning_protocol).contains(&effort) {return Err(bad("所选思考强度与供应商协议不兼容"));}}
    let knowledge_grants=authorization::grants_for_user(&state,scope.user_id).await?;
    let knowledge_employee=employee(&knowledge_grants,&input.employee_id).await?;
    let has_knowledge= ["knowledge_search", "knowledge_read_document"].iter().any(|tool|yaya_agent_v2::tools::allowed(&knowledge_employee.allowed_tools,tool));
    let knowledge_scope=if has_knowledge {
        { let mut frozen=crate::modules::knowledge::retrieval::freeze(&state,&knowledge_grants,&input.employee_id,&input.knowledge_base_ids).await?;
          frozen["vectorProfile"]=crate::modules::knowledge::vectors::freeze_profiles(&state).await?; frozen }
    } else {
        if !input.knowledge_base_ids.is_empty() {return Err(AppError::Forbidden("当前员工未配置知识检索能力，请更新员工能力后重新发送".into()));}
        Value::Null
    };
    let selection=json!({"knowledge_scope":knowledge_scope,"route_id":route.id,"model":route.chat_model,"thinking_enabled":enabled,"reasoning_protocol":route.reasoning_protocol,"reasoning_effort":effort,"reasoning_disabled":requested=="off"});
    let files=rows(&tx,"SELECT jsonb_build_object('id',id,'ready',contents IS NOT NULL)::text data FROM agent_v2_staged_files WHERE submission_id=$1::uuid",vec![id(sid)]).await.map_err(map_store)?;
    if files.len() != input.attachments.len() || files.iter().any(|f| f["ready"] != true) {
        return Err(conflict("附件尚未全部上传"));
    }
    let session = input.session_id.unwrap_or_else(Uuid::new_v4);
    if input.session_id.is_none() {
        exec(&tx,"INSERT INTO agent_v2_sessions(id,tenant_id,owner_user_id,employee_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4)",vec![id(session),id(scope.tenant_id),id(scope.user_id),input.employee_id.clone().into()]).await.map_err(map_store)?;
        event(
            &tx,
            session,
            None,
            "session.created",
            json!({"employeeId":input.employee_id}),
        )
        .await
        .map_err(map_store)?;
    }
    rows(&tx,"SELECT jsonb_build_object('ok',true)::text data FROM agent_v2_sessions WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid AND employee_id=$4 FOR UPDATE",vec![id(session),id(scope.tenant_id),id(scope.user_id),input.employee_id.into()]).await.map_err(map_store)?;
    let mut parts = Vec::new();
    if !input.text.trim().is_empty() {
        parts.push(ContentPart::Text { text: input.text });
    }
    for f in input.attachments {
        use sea_orm::Statement;
        let row=tx.query_one_raw(Statement::from_sql_and_values(sea_orm::DatabaseBackend::Postgres,"SELECT contents FROM agent_v2_staged_files WHERE submission_id=$1::uuid AND id=$2::uuid",vec![id(sid),id(f.client_file_id)])).await?.ok_or_else(||conflict("附件缺失"))?;
        let bytes: Vec<u8> = row.try_get("", "contents")?;
        if format!("{:x}", Sha256::digest(&bytes)) != f.sha256 {
            return Err(conflict("附件 hash 已变化"));
        }
        let saved =
            files::save(&tx, session, f.client_file_id, &f.name, &bytes, None, None).await?;
        parts.push(
            if saved["mimeType"]
                .as_str()
                .unwrap_or("")
                .starts_with("image/")
            {
                ContentPart::Image {
                    file_id: f.client_file_id,
                }
            } else {
                ContentPart::File {
                    file_id: f.client_file_id,
                }
            },
        );
    }
    let command = Store::submit_in_transaction(
        &tx,
        &scope,
        session,
        &Command::Prompt {
            client_command_id: input.client_request_id,
            parts,
        },
    )
    .await
    .map_err(map_store)?;
    exec(
        &tx,
        "UPDATE agent_v2_runs SET model_selection=$2 WHERE id=$1::uuid",
        vec![
            command["runId"].as_str().unwrap_or("").into(),
            js(selection),
        ],
    )
    .await
    .map_err(map_store)?;
    let message=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_messages WHERE run_id=$1::uuid AND role='user'",vec![command["runId"].as_str().unwrap_or("").into()]).await.map_err(map_store)?.remove(0);
    let result = json!({"sessionId":session,"messageId":message["id"],"commandId":command["commandId"],"runId":command["runId"]});
    exec(&tx,"UPDATE agent_v2_submissions SET status='committed',session_id=$2::uuid,result=$3 WHERE id=$1::uuid",vec![id(sid),id(session),js(result)]).await.map_err(map_store)?;
    exec(
        &tx,
        "UPDATE agent_v2_staged_files SET contents=NULL WHERE submission_id=$1::uuid",
        vec![id(sid)],
    )
    .await
    .map_err(map_store)?;
    let result = view(&tx, &load(&tx, &scope, sid, false).await?).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[utoipa::path(delete,path="/api/agent/v2/submissions/{submission_id}",operation_id="agentV2AbandonSubmission",params(("submission_id"=Uuid,Path)),responses((status=200,body=Submission)))]
pub(crate) async fn abandon(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let (scope, _) = principal(&state, &headers).await?;
    let tx = state.db.begin().await?;
    let value = load(&tx, &scope, sid, true).await?;
    authorize(&state, &headers, &value).await?;
    if value["status"] != "committed" {
        exec(
            &tx,
            "UPDATE agent_v2_submissions SET status='abandoned' WHERE id=$1::uuid",
            vec![id(sid)],
        )
        .await
        .map_err(map_store)?;
        exec(
            &tx,
            "UPDATE agent_v2_staged_files SET contents=NULL WHERE submission_id=$1::uuid",
            vec![id(sid)],
        )
        .await
        .map_err(map_store)?;
    }
    let result = view(&tx, &load(&tx, &scope, sid, false).await?).await?;
    tx.commit().await?;
    Ok(Json(result))
}

pub(crate) async fn cleanup(db: &sea_orm::DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    let tx = db.begin().await?;
    tx.execute_unprepared("WITH expired AS (SELECT id FROM agent_v2_submissions WHERE (status='uploading' AND expires_at<=now()) OR (status='abandoned' AND EXISTS(SELECT 1 FROM agent_v2_staged_files f WHERE f.submission_id=agent_v2_submissions.id AND f.contents IS NOT NULL)) ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED), changed AS (UPDATE agent_v2_submissions SET status=CASE WHEN status='uploading' THEN 'expired' ELSE status END WHERE id IN(SELECT id FROM expired) RETURNING id) UPDATE agent_v2_staged_files SET contents=NULL WHERE submission_id IN(SELECT id FROM changed)").await?;
    tx.execute_unprepared("WITH old AS (SELECT id FROM agent_v2_submissions WHERE created_at<now()-interval '30 days' AND status<>'uploading' AND NOT(payload @> '{\"deleted\":true}'::jsonb) ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED) DELETE FROM agent_v2_submissions WHERE id IN(SELECT id FROM old)").await?;
    tx.commit().await
}
pub(crate) fn start_cleanup(state: AppState) {
    tokio::spawn(async move {
        let mut stop = state.shutdown_receiver();
        let mut timer = tokio::time::interval(Duration::from_secs(600));
        loop {
            tokio::select! {_=timer.tick()=>{if let Err(error)=cleanup(&state.db).await{tracing::warn!(%error,"Agent V2 staging cleanup failed");}},_=stop.changed()=>break}
        }
    });
}
