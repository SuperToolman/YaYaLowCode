//! Session workspace API: objects live in PostgreSQL alongside their authorization owner.
use super::*;
use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{StatusCode, header},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use sea_orm::{ConnectionTrait, TransactionTrait};
use sha2::{Digest, Sha256};
use yaya_agent_v2::{
    files::*,
    store::{event, exec},
};

fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
const SELECT: &str = "SELECT jsonb_build_object('id',id,'sessionId',session_id,'name',name,'mimeType',mime_type,'size',size,'sha256',sha256,'source',source,'createdAt',created_at,'downloadUrl','/api/agent/v2/sessions/'||session_id||'/files/'||id)::text data FROM agent_v2_files";

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agent/v2/sessions/{session_id}/files",
            get(list).post(upload),
        )
        .route(
            "/api/agent/v2/sessions/{session_id}/files/{file_id}",
            get(download),
        )
        .route(
            "/api/internal/agent-v2/runs/{run_id}/files/{file_id}",
            get(model_file),
        )
        .route(
            "/api/internal/agent-v2/runs/{run_id}/workspace/invoke",
            post(invoke),
        )
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
}

async fn directory(db: &impl ConnectionTrait, sid: Uuid) -> Result<Vec<Value>, AppError> {
    rows(
        db,
        &format!("{SELECT} WHERE session_id=$1::uuid ORDER BY created_at,id"),
        vec![id(sid)],
    )
    .await
    .map_err(map_store)
}

#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/files",operation_id="agentV2Files",params(("session_id"=Uuid,Path)),responses((status=200,body=AgentV2Files)))]
pub(crate) async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    access(&state, &headers, sid).await?;
    Ok(Json(json!({"items":directory(&state.db,sid).await?})))
}

#[utoipa::path(post,path="/api/agent/v2/sessions/{session_id}/files",operation_id="agentV2UploadFile",params(("session_id"=Uuid,Path)),request_body=UploadAgentV2File,responses((status=200,body=AgentV2File)))]
pub(crate) async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
    Json(input): Json<UploadAgentV2File>,
) -> Result<Json<Value>, AppError> {
    let (scope, _) = access(&state, &headers, sid).await?;
    validate_name(&input.name).map_err(bad)?;
    if input.data.len() > MAX_FILE_BYTES.div_ceil(3) * 4 {
        return Err(bad("文件超过 8 MiB"));
    }
    let bytes = STANDARD
        .decode(&input.data)
        .map_err(|_| bad("无效文件编码"))?;
    let tx = state.db.begin().await?;
    rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid FOR UPDATE",vec![id(sid),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?;
    let file = save(
        &tx,
        sid,
        input.client_file_id,
        &input.name,
        &bytes,
        None,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(file))
}

pub(super) async fn save(
    db: &impl ConnectionTrait,
    sid: Uuid,
    fid: Uuid,
    name: &str,
    bytes: &[u8],
    run: Option<Uuid>,
    call: Option<&str>,
) -> Result<Value, AppError> {
    save_artifact(db, sid, fid, name, bytes, run, call, "").await
}

pub(super) async fn save_artifact(
    db: &impl ConnectionTrait,
    sid: Uuid,
    fid: Uuid,
    name: &str,
    bytes: &[u8],
    run: Option<Uuid>,
    call: Option<&str>,
    artifact: &str,
) -> Result<Value, AppError> {
    let available=rows(db,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid AND archived_at IS NULL AND deletion_requested_at IS NULL FOR UPDATE",vec![id(sid)]).await.map_err(map_store)?;
    if available.is_empty(){return Err(AppError::Conflict("会话已归档或正在删除，不能写入工作区".into()));}
    validate_name(name).map_err(bad)?;
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err(bad("文件必须为 1 字节至 8 MiB"));
    }
    let hash = format!("{:x}", Sha256::digest(bytes));
    let existing = rows(
        db,
        &format!("{SELECT} WHERE id=$1::uuid OR (run_id=$2::uuid AND invocation_id=$3 AND artifact_key=$4)"),
        vec![
            id(fid),
            run.map(|r| r.to_string()).into(),
            call.map(str::to_owned).into(),
            artifact.into(),
        ],
    )
    .await
    .map_err(map_store)?;
    if let Some(old) = existing.first() {
        if old["sessionId"] != sid.to_string() || old["sha256"] != hash || old["name"] != name {
            return Err(AppError::Conflict("文件幂等键冲突".into()));
        }
        return Ok(old.clone());
    }
    let used=rows(db,"SELECT jsonb_build_object('bytes',COALESCE(sum(size),0),'count',count(*))::text data FROM agent_v2_files WHERE session_id=$1::uuid",vec![id(sid)]).await.map_err(map_store)?;
    if used[0]["bytes"].as_i64().unwrap_or(0) + bytes.len() as i64 > MAX_WORKSPACE_BYTES
        || used[0]["count"].as_i64().unwrap_or(0) >= MAX_WORKSPACE_FILES
    {
        return Err(bad("会话工作区限额为 100 MiB / 200 个文件"));
    }
    exec(db,"INSERT INTO agent_v2_files(id,session_id,run_id,invocation_id,name,mime_type,size,sha256,source,contents,artifact_key) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11)",vec![id(fid),id(sid),run.map(|r|r.to_string()).into(),call.map(str::to_owned).into(),name.into(),detected_mime(name,bytes).into(),(bytes.len() as i64).into(),hash.into(),if run.is_some(){"generated"}else{"upload"}.into(),bytes.to_vec().into(),artifact.into()]).await.map_err(map_store)?;
    let file = rows(db, &format!("{SELECT} WHERE id=$1::uuid"), vec![id(fid)])
        .await
        .map_err(map_store)?
        .remove(0);
    event(db, sid, run, "workspace.file.created", json!({"file":file}))
        .await
        .map_err(map_store)?;
    Ok(file)
}

#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/files/{file_id}",operation_id="agentV2DownloadFile",params(("session_id"=Uuid,Path),("file_id"=Uuid,Path)),responses((status=200,description="Authenticated file bytes",content_type="application/octet-stream")))]
pub(crate) async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((sid, fid)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    access(&state, &headers, sid).await?;
    let data = load(&state.db, sid, fid).await?;
    let bytes = STANDARD
        .decode(
            data["data"]
                .as_str()
                .unwrap_or("")
                .replace(['\n', '\r'], ""),
        )
        .map_err(|_| bad("文件数据无效"))?;
    let mime = data["mimeType"]
        .as_str()
        .unwrap_or("application/octet-stream");
    let disposition = if mime.starts_with("image/") {
        "inline"
    } else {
        "attachment"
    };
    let encoded = data["name"]
        .as_str()
        .unwrap_or("file")
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("{disposition}; filename=\"download\"; filename*=UTF-8''{encoded}"),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .body(Body::from(bytes))
        .map_err(|_| bad("无法读取文件"))
}

pub(super) async fn load(
    db: &impl ConnectionTrait,
    sid: Uuid,
    fid: Uuid,
) -> Result<Value, AppError> {
    rows(db,"SELECT jsonb_build_object('id',id,'name',name,'mimeType',mime_type,'size',size,'data',encode(contents,'base64'))::text data FROM agent_v2_files WHERE session_id=$1::uuid AND id=$2::uuid",vec![id(sid),id(fid)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::NotFound("file not found".into()))
}

pub(super) async fn run_session(
    state: &AppState,
    headers: &HeaderMap,
    run: Uuid,
    proof: &LeaseProof,
) -> Result<Uuid, AppError> {
    let (_, employee, grants) = execution_subject(state, headers, run, proof).await?;
    let record = store(state).run(run).await.map_err(map_store)?;
    super::tools::frozen_grants(&grants, &record["context_snapshot"])?;
    super::executions::frozen_employee(employee, &record["context_snapshot"])?;
    Uuid::parse_str(record["session_id"].as_str().unwrap_or("")).map_err(|_| bad("invalid run"))
}
async fn model_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((run, fid)): Path<(Uuid, Uuid)>,
    Query(proof): Query<LeaseProof>,
) -> Result<Json<Value>, AppError> {
    let sid = run_session(&state, &headers, run, &proof).await?;
    // Model input only includes files referenced by this run's visible user history.
    let linked=rows(&state.db,"SELECT jsonb_build_object('ok',true)::text data FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.session_id=$1::uuid AND m.role='user' AND r.queue_seq<=(SELECT queue_seq FROM agent_v2_runs WHERE id=$2::uuid) AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.parts) p WHERE p->>'fileId'=$3) LIMIT 1",vec![id(sid),id(run),fid.to_string().into()]).await.map_err(map_store)?;
    if linked.is_empty() {
        return Err(AppError::NotFound("file not found".into()));
    }
    let mut file = load(&state.db, sid, fid).await?;
    file["preview"] = super::file_previews::cached(&state.db, fid)
        .await?
        .unwrap_or(Value::Null);
    Ok(Json(file))
}

async fn invoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run): Path<Uuid>,
    Query(proof): Query<LeaseProof>,
    Json(input): Json<super::tools::ToolRequest>,
) -> Result<Json<Value>, AppError> {
    let sid = run_session(&state, &headers, run, &proof).await?;
    let record = store(&state).run(run).await.map_err(map_store)?;
    let tool = yaya_agent_v2::tools::find(&input.call.name)
        .filter(|t| t.id.starts_with("workspace_"))
        .ok_or_else(|| bad("unsupported workspace tool"))?;
    yaya_agent_v2::tools::validate(&tool, &input.call.arguments).map_err(bad)?;
    if !record["context_snapshot"]["allowed_tools"]
        .as_array()
        .is_some_and(|ts| ts.iter().any(|t| t == &tool.id))
    {
        return Err(AppError::Forbidden(
            "workspace tool not in task snapshot".into(),
        ));
    }
    // Parse outside transaction locks: heartbeat and cancellation must remain available.
    let args = &input.call.arguments;
    let prepared = match tool.id.as_str() {
        "workspace_read_file" => {
            let fid = Uuid::parse_str(args["fileId"].as_str().unwrap_or(""))
                .map_err(|_| bad("invalid file id"))?;
            let file = load(&state.db, sid, fid).await?;
            let bytes = STANDARD
                .decode(
                    file["data"]
                        .as_str()
                        .unwrap_or("")
                        .replace(['\n', '\r'], ""),
                )
                .map_err(|_| bad("invalid file bytes"))?;
            let name = file["name"].as_str().unwrap_or("");
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let result = if [
                "xlsx", "xls", "ods", "csv", "tsv", "docx", "pptx", "pdf", "doc", "ppt",
            ]
            .contains(&ext.as_str())
            {
                let mut result=super::office::invoke(json!({"operation":"read","name":name,"data":STANDARD.encode(&bytes),"options":args})).await?;
                result["fileId"] = json!(fid);
                result["name"] = json!(name);
                result["untrustedContent"] = json!(true);
                result
            } else if file["mimeType"]
                .as_str()
                .is_some_and(|m| m.starts_with("text/") || m == "application/json")
                && bytes.len() <= 262144
            {
                json!({"fileId":fid,"name":name,"text":String::from_utf8(bytes).map_err(|_|bad("invalid UTF-8"))?,"untrustedContent":true})
            } else {
                json!({"error":{"code":"unsupported_file_content","message":"支持 Excel(xlsx/xls/ods)、CSV/TSV、Word(docx)、PowerPoint(pptx)、文字 PDF 和小于 256 KiB 的 UTF-8 文本；扫描件需 OCR，旧 doc/ppt 请转换。图片请作为消息附件发送。"}})
            };
            Some(result)
        }
        "workspace_write_document" => {
            let name = args["name"].as_str().unwrap_or("");
            validate_name(name).map_err(bad)?;
            Some(
                super::office::invoke(
                    json!({"operation":"write","name":name,"document":args["document"]}),
                )
                .await?,
            )
        }
        _ => None,
    };
    run_session(&state, &headers, run, &proof).await?;
    let tx = state.db.begin().await?;
    rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid FOR UPDATE",vec![id(sid)]).await.map_err(map_store)?;
    let active=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_runs WHERE id=$1::uuid AND lease_owner=$2::uuid AND lease_epoch=$3 AND lease_until>now() AND status='running' FOR UPDATE",vec![id(run),id(proof.owner),proof.epoch.into()]).await.map_err(map_store)?;
    if active.is_empty() {
        return Err(AppError::Forbidden("run lease is not active".into()));
    }
    let args = &input.call.arguments;
    let result = match tool.id.as_str() {
        "workspace_list_files" => json!({"items":directory(&tx,sid).await?}),
        "workspace_read_file" => prepared.unwrap(),
        "workspace_write_document" => {
            let prepared = prepared.unwrap();
            if prepared.get("error").is_some() {
                prepared
            } else {
                let bytes = STANDARD
                    .decode(prepared["data"].as_str().unwrap_or(""))
                    .map_err(|_| bad("invalid office output"))?;
                save(
                    &tx,
                    sid,
                    Uuid::new_v4(),
                    args["name"].as_str().unwrap_or(""),
                    &bytes,
                    Some(run),
                    Some(&input.call.id),
                )
                .await?
            }
        }
        "workspace_write_file" => {
            let name = args["name"].as_str().unwrap_or("");
            let content = args["text"].as_str().unwrap_or("");
            if [
                "xlsx", "xls", "ods", "docx", "doc", "pptx", "ppt", "pdf", "png", "jpg", "jpeg",
                "webp", "zip",
            ]
            .contains(
                &name
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str(),
            ) {
                json!({"error":{"code":"binary_output_requires_document_tool","message":"不能把文本伪装成办公或二进制文件。XLSX/DOCX/PPTX 请使用 workspace_write_document；PDF/图片导出尚未实现。"}})
            } else {
                if content.len() > 262144 {
                    return Err(bad("生成文件超过 256 KiB"));
                }
                save(
                    &tx,
                    sid,
                    Uuid::new_v4(),
                    name,
                    content.as_bytes(),
                    Some(run),
                    Some(&input.call.id),
                )
                .await?
            }
        }
        _ => return Err(bad("unsupported workspace tool")),
    };
    tx.commit().await?;
    Ok(Json(json!({"result":result})))
}
