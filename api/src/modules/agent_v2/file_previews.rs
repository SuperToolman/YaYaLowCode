//! Run-authorized bounded document samples; never shared across session file IDs.
use super::*;
use serde::Serialize;
use utoipa::ToSchema;
use yaya_agent_v2::store::{Lease, event, exec, js};
const PARSER: &str = "office-0.1.0-preview-2";
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub file_id: Uuid,
    pub status: String,
    pub result: Value,
}
#[derive(Serialize, ToSchema)]
pub struct FilePreviews {
    pub items: Vec<FilePreview>,
}
pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agent/v2/sessions/{session_id}/file-previews",
            get(list),
        )
        .route(
            "/api/internal/agent-v2/runs/{run_id}/files/{file_id}/preview",
            post(prepare),
        )
}
#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/file-previews",operation_id="agentV2FilePreviews",params(("session_id"=Uuid,Path)),responses((status=200,body=FilePreviews)))]
pub(crate) async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    access(&state, &headers, sid).await?;
    let items=rows(&state.db,"SELECT jsonb_build_object('fileId',p.file_id,'status',CASE WHEN interrupted THEN 'skipped' ELSE p.status END,'result',CASE WHEN interrupted THEN jsonb_build_object('status','skipped','reason','run_terminated_before_preview_completed','complete',false) ELSE p.result END)::text data FROM agent_v2_file_previews p JOIN agent_v2_files f ON f.id=p.file_id CROSS JOIN LATERAL (SELECT p.status='parsing' AND EXISTS (SELECT 1 FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.session_id=f.session_id AND m.role='user' AND r.status IN ('cancelled','failed','completed') AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.parts) part WHERE part->>'fileId'=f.id::text)) AS interrupted) state WHERE f.session_id=$1::uuid AND p.parser_version=$2 AND p.rule_version=1 ORDER BY p.created_at",vec![id(sid),PARSER.into()]).await.map_err(map_store)?;
    Ok(Json(json!({"items":items})))
}
pub(super) async fn cached(
    db: &impl sea_orm::ConnectionTrait,
    fid: Uuid,
) -> Result<Option<Value>, AppError> {
    Ok(rows(db,"SELECT result::text data FROM agent_v2_file_previews p JOIN agent_v2_files f ON f.id=p.file_id WHERE p.file_id=$1::uuid AND p.sha256=f.sha256 AND parser_version=$2 AND rule_version=1 AND status<>'parsing'",vec![id(fid),PARSER.into()]).await.map_err(map_store)?.pop())
}
async fn prepare(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((run, fid)): Path<(Uuid, Uuid)>,
    Query(proof): Query<LeaseProof>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let sid = files::run_session(&state, &headers, run, &proof).await?;
    let linked=rows(&state.db,"SELECT jsonb_build_object('ok',true)::text data FROM agent_v2_messages WHERE run_id=$1::uuid AND role='user' AND EXISTS(SELECT 1 FROM jsonb_array_elements(parts) p WHERE p->>'fileId'=$2)",vec![id(run),fid.to_string().into()]).await.map_err(map_store)?;
    if linked.is_empty() {
        return Err(AppError::NotFound("file not in current message".into()));
    }
    if let Some(result) = cached(&state.db, fid).await? {
        return Ok(Json(result));
    }
    let file = files::load(&state.db, sid, fid).await?;
    let name = file["name"].as_str().unwrap_or("");
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let supported =
        ["xlsx", "xls", "ods", "csv", "tsv", "docx", "pptx", "pdf"].contains(&ext.as_str());
    let lease = Lease {
        run_id: run,
        session_id: sid,
        owner: proof.owner,
        epoch: proof.epoch,
        cancelled: false,
    };
    {
        let tx = store(&state)
            .fence(&lease, false)
            .await
            .map_err(map_store)?;
        exec(&tx,"INSERT INTO agent_v2_file_previews(file_id,sha256,parser_version,rule_version,status,result) SELECT id,sha256,$2,1,'parsing','{}'::jsonb FROM agent_v2_files WHERE id=$1::uuid ON CONFLICT DO NOTHING",vec![id(fid),PARSER.into()]).await.map_err(map_store)?;
        event(
            &tx,
            sid,
            Some(run),
            "attachment.parsing",
            json!({"fileId":fid}),
        )
        .await
        .map_err(map_store)?;
        tx.commit().await?;
    }
    let result = if input["skip"] == true {
        json!({"status":"skipped","reason":"preparation_budget_exhausted","complete":false})
    } else if !supported {
        json!({"status":"skipped","reason":"image_or_text_passthrough_or_unsupported_format","complete":false})
    } else {
        let limit = if ["pptx", "pdf"].contains(&ext.as_str()) {
            3
        } else {
            10
        };
        let value=super::office::invoke(json!({"operation":"preview","name":name,"data":file["data"],"options":{"start":1,"limit":limit,"columns":8}})).await;
        match value {
            Ok(value) if value.get("error").is_none() => {
                json!({"status":"completed","sample":value,"complete":false,"untrustedContent":true})
            }
            Ok(value) => json!({"status":"failed","error":value["error"],"complete":false}),
            Err(_) => {
                json!({"status":"failed","error":{"code":"preview_unavailable","message":"基础解析暂不可用，可以稍后通过文件工具重试。"},"complete":false})
            }
        }
    };
    files::run_session(&state, &headers, run, &proof).await?;
    let tx = store(&state)
        .fence(&lease, false)
        .await
        .map_err(map_store)?;
    let hash=rows(&tx,"SELECT jsonb_build_object('sha256',sha256)::text data FROM agent_v2_files WHERE id=$1::uuid AND session_id=$2::uuid",vec![id(fid),id(sid)]).await.map_err(map_store)?.remove(0);
    let inserted=exec(&tx,"UPDATE agent_v2_file_previews SET status=$4,result=$5 WHERE file_id=$1::uuid AND sha256=$2 AND parser_version=$3 AND rule_version=1 AND status='parsing'",vec![id(fid),hash["sha256"].as_str().unwrap_or("").into(),PARSER.into(),result["status"].as_str().unwrap_or("failed").into(),js(result.clone())]).await.map_err(map_store)?;
    if inserted > 0 {
        event(
            &tx,
            sid,
            Some(run),
            "attachment.parsed",
            json!({"fileId":fid,"status":result["status"]}),
        )
        .await
        .map_err(map_store)?;
    }
    let saved = cached(&tx, fid).await?.unwrap_or(result);
    tx.commit().await?;
    Ok(Json(saved))
}
