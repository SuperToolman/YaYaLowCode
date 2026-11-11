//! Knowledge management. Stored originals are not advertised as searchable indexes.
mod base_config;
mod dedup;
mod employee;
pub(crate) mod parsing;
pub(crate) mod retrieval;
pub(crate) mod vectors;
use crate::modules::agent_v2::submissions::BinaryUpload;
use crate::platform::{authorization, error::AppError, runtime::AppState};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, header},
    response::Response,
    routing::get,
};
pub(crate) use employee::{employee_downloads, sync_employee};
use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Cursor, Read},
};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use yaya_agent_v2::store::{exec, id, rows};

const MAX_BYTES: usize = 8 * 1024 * 1024;
fn storage(e: impl std::fmt::Display) -> AppError {
    tracing::error!(error=%e,"knowledge storage error");
    AppError::BadRequest("知识库操作失败".into())
}
fn bad(s: &str) -> AppError {
    AppError::BadRequest(s.into())
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub id: Uuid,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub retrieval: Option<base_config::BaseRetrievalSelection>,
    pub application_id: Option<String>,
    pub employee_id: Option<String>,
    pub created_at: String,
    pub document_count: i64,
    pub can_manage: bool,
}
#[derive(Serialize, ToSchema)]
pub struct KnowledgeBases {
    pub items: Vec<KnowledgeBase>,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocument {
    pub id: Uuid,
    pub base_id: Uuid,
    pub name: String,
    pub version_id: Uuid,
    pub version: i32,
    pub size: i64,
    pub sha256: String,
    pub status: String,
    pub parsing_error: Option<String>,
    pub chunk_count: i32,
    pub created_at: String,
    pub package_version: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub struct KnowledgeDocuments {
    pub items: Vec<KnowledgeDocument>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBase {
    pub client_request_id: Uuid,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub retrieval: Option<base_config::BaseRetrievalSelection>,
    pub application_id: Option<String>,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
pub struct BaseQuery {
    pub kind: Option<String>,
    pub application_id: Option<String>,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
pub struct UploadQuery {
    pub name: String,
    pub client_request_id: Uuid,
    pub document_id: Option<Uuid>,
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/knowledge/bases", get(list).post(create))
        .route(
            "/api/knowledge/bases/{base_id}",
            axum::routing::delete(remove_base),
        )
        .route(
            "/api/knowledge/bases/{base_id}/documents",
            get(documents).post(upload),
        )
        .route(
            "/api/knowledge/documents/{document_id}",
            axum::routing::delete(remove_document),
        )
        .route(
            "/api/knowledge/documents/{document_id}/versions",
            get(versions),
        )
        .route(
            "/api/knowledge/versions/{version_id}/content",
            get(download),
        )
        .route(
            "/api/knowledge/retrieval-settings",
            get(vectors::settings).put(vectors::save),
        )
        .route(
            "/api/knowledge/retrieval-settings/retry",
            axum::routing::post(vectors::retry),
        )
        .route(
            "/api/knowledge/search",
            axum::routing::post(retrieval::search),
        )
        .route(
            "/api/knowledge/citations/{citation_id}",
            get(retrieval::citation),
        )
        .route(
            "/api/knowledge/versions/{version_id}/parsing",
            get(parsing::read),
        )
        .route(
            "/api/knowledge/versions/{version_id}/reprocess",
            axum::routing::post(parsing::reprocess),
        )
        .layer(DefaultBodyLimit::max(MAX_BYTES))
}
fn has(g: &HashSet<String>, p: &str) -> bool {
    g.contains("*")
        || g.contains(p)
        || p.strip_suffix("knowledge_view")
            .is_some_and(|prefix| g.contains(&format!("{prefix}knowledge_manage")))
}
async fn subject(
    state: &AppState,
    h: &HeaderMap,
) -> Result<(Uuid, Uuid, HashSet<String>), AppError> {
    let grants = authorization::grants(h, state).await?;
    let u = authorization::current_user(h, state).await?;
    Ok((deployment_scope(state).await?, u.id, grants))
}
pub(crate) async fn deployment_scope(state: &AppState) -> Result<Uuid, AppError> {
    let row=rows(&state.db,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_deployment_scope WHERE singleton",vec![]).await.map_err(storage)?.pop().ok_or_else(||AppError::Conflict("知识库迁移尚未完成".into()))?;
    Uuid::parse_str(row["id"].as_str().unwrap_or("")).map_err(storage)
}
fn employee_version(employee: &str) -> Option<String> {
    let status = crate::platform::license::license_status();
    if !status.valid
        || !status
            .ai_employees
            .iter()
            .any(|e| e.id == employee && e.expires_at > chrono::Utc::now().timestamp())
        || !crate::platform::config::load_installed_ai_employees().contains(employee)
    {
        return None;
    }
    crate::platform::config::load_installed_ai_employee_packages()
        .get(employee)?
        .get("knowledge")?
        .get("version")?
        .as_str()
        .map(str::to_owned)
}
fn allowed(g: &HashSet<String>, b: &Value, write: bool) -> bool {
    // Current product rule: all authenticated platform users may read customer
    // knowledge. Management remains permission-controlled, bundle lifecycle does not.
    if !write {
        return match b["kind"].as_str() {
            Some("global" | "application") => true,
            Some("employee_bundle") => b["employee_id"]
                .as_str()
                .and_then(employee_version)
                .is_some(),
            _ => false,
        };
    }
    match b["kind"].as_str() {
        Some("global") => has(g, "knowledge.global.manage"),
        Some("application") => {
            let app = b["application_id"].as_str().unwrap_or("");
            has(g, &format!("app:{app}:display")) && has(g, &format!("app:{app}:knowledge_manage"))
        }
        _ => false,
    }
}
async fn access(
    state: &AppState,
    h: &HeaderMap,
    bid: Uuid,
    write: bool,
) -> Result<(Uuid, Uuid, HashSet<String>, Value), AppError> {
    let (t, u, g) = subject(state, h).await?;
    let b=rows(&state.db,"SELECT row_to_json(b)::text data FROM knowledge_bases b WHERE id=$1::uuid AND tenant_id=$2::uuid",vec![id(bid),id(t)]).await.map_err(storage)?.pop().ok_or_else(||AppError::NotFound("知识库不存在".into()))?;
    if !allowed(&g, &b, write) {
        return Err(AppError::Forbidden("没有知识库访问或管理权限".into()));
    }
    Ok((t, u, g, b))
}
fn base_dto(v: &Value, g: &HashSet<String>) -> Result<KnowledgeBase, AppError> {
    Ok(KnowledgeBase {
        id: Uuid::parse_str(v["id"].as_str().unwrap_or("")).map_err(storage)?,
        kind: v["kind"].as_str().unwrap_or("").into(),
        name: v["name"].as_str().unwrap_or("").into(),
        description: v["description"].as_str().unwrap_or("").into(),
        retrieval: v
            .get("retrieval_selection")
            .filter(|v| !v.is_null())
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(storage)?,
        application_id: v["application_id"].as_str().map(str::to_owned),
        employee_id: v["employee_id"].as_str().map(str::to_owned),
        created_at: v["created_at"].as_str().unwrap_or("").into(),
        document_count: v["document_count"].as_i64().unwrap_or(0),
        can_manage: allowed(g, v, true),
    })
}
async fn document_dto(
    db: &impl ConnectionTrait,
    did: Uuid,
    version: Option<Uuid>,
) -> Result<KnowledgeDocument, AppError> {
    let v=rows(db,"SELECT jsonb_build_object('id',d.id,'baseId',d.base_id,'name',v.name,'versionId',v.id,'version',v.version,'size',v.size,'sha256',v.sha256,'status',v.status,'parsingError',(SELECT error_code FROM knowledge_index_generations WHERE version_id=v.id ORDER BY created_at DESC LIMIT 1),'chunkCount',COALESCE((SELECT chunk_count FROM knowledge_index_generations WHERE version_id=v.id AND active),0),'createdAt',v.created_at,'packageVersion',d.package_version)::text data FROM knowledge_documents d JOIN knowledge_document_versions v ON v.document_id=d.id WHERE d.id=$1::uuid AND v.id=COALESCE($2::uuid,d.current_version_id)",vec![id(did),version.map(|v|v.to_string()).into()]).await.map_err(storage)?.pop().ok_or_else(||AppError::NotFound("文档不存在".into()))?;
    serde_json::from_value(v).map_err(storage)
}
#[utoipa::path(get,path="/api/knowledge/bases",operation_id="knowledgeBases",params(BaseQuery),responses((status=200,body=KnowledgeBases)))]
pub async fn list(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<BaseQuery>,
) -> Result<Json<KnowledgeBases>, AppError> {
    let (t, _, g) = subject(&s, &h).await?;
    let values=rows(&s.db,"SELECT (to_jsonb(b)||jsonb_build_object('document_count',(SELECT count(*) FROM knowledge_documents d WHERE d.base_id=b.id AND d.package_version IS NULL)))::text data FROM knowledge_bases b WHERE tenant_id=$1::uuid ORDER BY created_at DESC,id",vec![id(t)]).await.map_err(storage)?;
    let mut items = Vec::new();
    for mut b in values {
        if q.kind.as_ref().is_some_and(|k| b["kind"] != *k)
            || q.application_id
                .as_ref()
                .is_some_and(|a| b["application_id"] != *a)
            || !allowed(&g, &b, false)
        {
            continue;
        }
        if b["kind"] == "employee_bundle" {
            let version =
                employee_version(b["employee_id"].as_str().unwrap_or("")).unwrap_or_default();
            let count=rows(&s.db,"SELECT jsonb_build_object('n',count(*))::text data FROM knowledge_documents WHERE base_id=$1::uuid AND package_version=$2",vec![b["id"].as_str().unwrap_or("").into(),version.into()]).await.map_err(storage)?;
            b["document_count"] = count[0]["n"].clone();
        }
        items.push(base_dto(&b, &g)?);
    }
    Ok(Json(KnowledgeBases { items }))
}
#[utoipa::path(post,path="/api/knowledge/bases",operation_id="knowledgeCreateBase",request_body=CreateBase,responses((status=200,body=KnowledgeBase)))]
pub async fn create(
    State(s): State<AppState>,
    h: HeaderMap,
    Json(i): Json<CreateBase>,
) -> Result<Json<KnowledgeBase>, AppError> {
    let (t, u, g) = subject(&s, &h).await?;
    let name = i.name.trim();
    if name.is_empty()
        || name.chars().count() > 120
        || name.chars().any(char::is_control)
        || !matches!(i.kind.as_str(), "global" | "application")
        || (i.kind == "application") != i.application_id.is_some()
    {
        return Err(bad("知识库名称或归属无效"));
    }
    let b = json!({"kind":i.kind,"application_id":i.application_id});
    if !allowed(&g, &b, true) {
        return Err(AppError::Forbidden("没有创建知识库的权限".into()));
    }
    if i.description.chars().count() > 2000 {
        return Err(bad("知识库描述不能超过2000字"));
    }
    let selection = i
        .retrieval
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(storage)?;
    // An identical retry returns the original base without probing or publishing credentials again.
    let existing = rows(&s.db,"SELECT row_to_json(b)::text data FROM knowledge_bases b WHERE tenant_id=$1::uuid AND created_by=$2::uuid AND client_id=$3::uuid",vec![id(t),id(u),id(i.client_request_id)]).await.map_err(storage)?.pop();
    if let Some(v) = existing {
        base_config::check_create_retry(&v, &i)?;
        return Ok(Json(base_dto(&v, &g)?));
    }
    let prepared = if let Some(selection) = &i.retrieval {
        Some(base_config::prepare(&s, u, t, selection).await?)
    } else {
        None
    };
    let tx = s.db.begin().await?;
    exec(&tx,"INSERT INTO knowledge_bases(id,tenant_id,kind,name,application_id,created_by,client_id,description,retrieval_selection) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid,$8,$9) ON CONFLICT(tenant_id,created_by,client_id) DO NOTHING",vec![id(Uuid::new_v4()),id(t),i.kind.clone().into(),name.into(),i.application_id.clone().into(),id(u),id(i.client_request_id),i.description.trim().into(),selection.clone().into()]).await.map_err(storage)?;
    let v=rows(&tx,"SELECT row_to_json(b)::text data FROM knowledge_bases b WHERE tenant_id=$1::uuid AND created_by=$2::uuid AND client_id=$3::uuid FOR UPDATE",vec![id(t),id(u),id(i.client_request_id)]).await.map_err(storage)?.remove(0);
    base_config::check_create_retry(&v, &i)?;
    if let Some(prepared) = prepared {
        base_config::persist(&tx, t, u, vectors::uid(&v, "id")?, prepared).await?;
    }
    tx.commit().await?;
    Ok(Json(base_dto(&v, &g)?))
}
#[utoipa::path(get,path="/api/knowledge/bases/{base_id}/documents",operation_id="knowledgeDocuments",params(("base_id"=Uuid,Path)),responses((status=200,body=KnowledgeDocuments)))]
pub async fn documents(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(bid): Path<Uuid>,
) -> Result<Json<KnowledgeDocuments>, AppError> {
    let (_, _, _, b) = access(&s, &h, bid, false).await?;
    let version = b["employee_id"].as_str().and_then(employee_version);
    let values=rows(&s.db,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_documents WHERE base_id=$1::uuid AND (package_version IS NULL OR package_version=$2) ORDER BY created_at DESC,id",vec![id(bid),version.into()]).await.map_err(storage)?;
    let mut items = Vec::new();
    for v in values {
        items.push(
            document_dto(
                &s.db,
                Uuid::parse_str(v["id"].as_str().unwrap_or("")).map_err(storage)?,
                None,
            )
            .await?,
        );
    }
    Ok(Json(KnowledgeDocuments { items }))
}
// Signature and package structure validation, never execute document macros.
pub(super) fn validate_file(name: &str, bytes: &[u8]) -> Result<&'static str, AppError> {
    yaya_agent_v2::files::validate_name(name).map_err(bad)?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(bad("文档需为 1 字节至 8 MiB"));
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if matches!(ext.as_str(), "txt" | "md" | "csv" | "tsv")
        && std::str::from_utf8(bytes).is_ok()
        && !bytes.contains(&0)
    {
        return Ok("text/plain");
    }
    if ext == "pdf" && bytes.starts_with(b"%PDF-") {
        return Ok("application/pdf");
    }
    if matches!(ext.as_str(), "docx" | "xlsx" | "ods" | "pptx") {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|_| bad("Office 文件不是有效压缩文档"))?;
        if zip.len() > 10000 {
            return Err(bad("文档包含过多资源"));
        }
        let mut total = 0u64;
        for n in 0..zip.len() {
            let f = zip.by_index(n).map_err(|_| bad("压缩文档损坏"))?;
            total = total
                .checked_add(f.size())
                .ok_or_else(|| bad("文档解压超限"))?;
            if total > 128 * 1024 * 1024 {
                return Err(bad("文档解压超限"));
            }
        }
        let required = match ext.as_str() {
            "docx" => "word/document.xml",
            "xlsx" => "xl/workbook.xml",
            "pptx" => "ppt/presentation.xml",
            _ => "content.xml",
        };
        if zip.by_name(required).is_err() {
            return Err(bad("扩展名与文档结构不匹配"));
        }
        if ext == "ods" {
            let mut mime = String::new();
            zip.by_name("mimetype")
                .map_err(|_| bad("ODS 缺少格式标识"))?
                .take(100)
                .read_to_string(&mut mime)
                .map_err(|_| bad("ODS 格式无效"))?;
            if mime != "application/vnd.oasis.opendocument.spreadsheet" {
                return Err(bad("ODS 格式不匹配"));
            }
        } else if zip.by_name("[Content_Types].xml").is_err() {
            return Err(bad("Office 文档缺少内容合同"));
        }
        return Ok("application/octet-stream");
    }
    Err(bad(
        "支持 UTF-8 TXT/Markdown/CSV/TSV、PDF、DOCX、XLSX、ODS、PPTX；其他格式暂不支持",
    ))
}
#[utoipa::path(post,path="/api/knowledge/bases/{base_id}/documents",operation_id="knowledgeUploadDocument",params(("base_id"=Uuid,Path),UploadQuery),request_body(content=BinaryUpload,content_type="application/octet-stream"),responses((status=200,body=KnowledgeDocument)))]
pub async fn upload(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(bid): Path<Uuid>,
    Query(q): Query<UploadQuery>,
    bytes: Bytes,
) -> Result<Json<KnowledgeDocument>, AppError> {
    let (_, u, _, _) = access(&s, &h, bid, true).await?;
    let mime = validate_file(&q.name, &bytes)?;
    let sha = format!("{:x}", Sha256::digest(&bytes));
    let fp = json!([q.name, sha, q.document_id]).to_string();
    let tx = s.db.begin().await?;
    rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_bases WHERE id=$1::uuid FOR UPDATE",vec![id(bid)]).await.map_err(storage)?;
    let prior=rows(&tx,"SELECT row_to_json(c)::text data FROM knowledge_upload_commands c WHERE base_id=$1::uuid AND user_id=$2::uuid AND client_id=$3::uuid",vec![id(bid),id(u),id(q.client_request_id)]).await.map_err(storage)?;
    if let Some(p) = prior.first() {
        if p["fingerprint"] != fp {
            return Err(AppError::Conflict("相同请求 ID 的文档内容不同".into()));
        }
        let result = document_dto(
            &tx,
            Uuid::parse_str(p["document_id"].as_str().unwrap_or("")).map_err(storage)?,
            Some(Uuid::parse_str(p["version_id"].as_str().unwrap_or("")).map_err(storage)?),
        )
        .await?;
        tx.commit().await?;
        return Ok(Json(result));
    }
    let quota=rows(&tx,"SELECT jsonb_build_object('n',count(*),'bytes',COALESCE(sum(v.size),0))::text data FROM knowledge_document_versions v JOIN knowledge_documents d ON d.id=v.document_id WHERE d.base_id=$1::uuid",vec![id(bid)]).await.map_err(storage)?.remove(0);
    if quota["n"].as_i64().unwrap_or(0) >= 2000
        || quota["bytes"].as_i64().unwrap_or(0) + bytes.len() as i64 > 1024 * 1024 * 1024
    {
        return Err(bad("知识库含历史版本最多 2000 份 / 1 GiB"));
    }
    let did = q.document_id.unwrap_or_else(Uuid::new_v4);
    let vid = Uuid::new_v4();
    if q.document_id.is_some() {
        let found=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_documents WHERE id=$1::uuid AND base_id=$2::uuid FOR UPDATE",vec![id(did),id(bid)]).await.map_err(storage)?;
        if found.is_empty() {
            return Err(AppError::NotFound("目标文档不属于该知识库".into()));
        }
    } else {
        exec(
            &tx,
            "INSERT INTO knowledge_documents(id,base_id,name) VALUES($1::uuid,$2::uuid,$3)",
            vec![id(did), id(bid), q.name.clone().into()],
        )
        .await
        .map_err(storage)?;
    }
    exec(&tx,"INSERT INTO knowledge_document_versions(id,document_id,version,name,mime_type,size,sha256,contents,created_by,client_id) SELECT $1::uuid,$2::uuid,COALESCE(max(version),0)+1,$3,$4,$5,$6,$7,$8::uuid,$9::uuid FROM knowledge_document_versions WHERE document_id=$2::uuid",vec![id(vid),id(did),q.name.clone().into(),mime.into(),(bytes.len() as i64).into(),sha.into(),bytes.to_vec().into(),id(u),id(q.client_request_id)]).await.map_err(storage)?;
    exec(
        &tx,
        "UPDATE knowledge_documents SET current_version_id=$2::uuid,name=$3 WHERE id=$1::uuid",
        vec![id(did), id(vid), q.name.into()],
    )
    .await
    .map_err(storage)?;
    exec(&tx,"INSERT INTO knowledge_upload_commands VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid)",vec![id(bid),id(u),id(q.client_request_id),fp.into(),id(did),id(vid)]).await.map_err(storage)?;
    parsing::enqueue(&tx, vid).await?;
    let result = document_dto(&tx, did, None).await?;
    tx.commit().await?;
    Ok(Json(result))
}
async fn document_access(
    s: &AppState,
    h: &HeaderMap,
    did: Uuid,
    write: bool,
) -> Result<Value, AppError> {
    let d = rows(
        &s.db,
        "SELECT row_to_json(d)::text data FROM knowledge_documents d WHERE id=$1::uuid",
        vec![id(did)],
    )
    .await
    .map_err(storage)?
    .pop()
    .ok_or_else(|| AppError::NotFound("文档不存在".into()))?;
    let (_, _, _, b) = access(
        s,
        h,
        Uuid::parse_str(d["base_id"].as_str().unwrap_or("")).map_err(storage)?,
        write,
    )
    .await?;
    if b["kind"] == "employee_bundle"
        && d["package_version"].as_str()
            != b["employee_id"]
                .as_str()
                .and_then(employee_version)
                .as_deref()
    {
        return Err(AppError::Forbidden("员工知识版本已不可访问".into()));
    }
    Ok(d)
}
#[utoipa::path(get,path="/api/knowledge/documents/{document_id}/versions",operation_id="knowledgeDocumentVersions",params(("document_id"=Uuid,Path)),responses((status=200,body=KnowledgeDocuments)))]
pub async fn versions(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(did): Path<Uuid>,
) -> Result<Json<KnowledgeDocuments>, AppError> {
    document_access(&s, &h, did, false).await?;
    let ids=rows(&s.db,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_document_versions WHERE document_id=$1::uuid ORDER BY version DESC",vec![id(did)]).await.map_err(storage)?;
    let mut items = Vec::new();
    for v in ids {
        items.push(
            document_dto(
                &s.db,
                did,
                Some(Uuid::parse_str(v["id"].as_str().unwrap_or("")).map_err(storage)?),
            )
            .await?,
        );
    }
    Ok(Json(KnowledgeDocuments { items }))
}
#[utoipa::path(delete,path="/api/knowledge/documents/{document_id}",operation_id="knowledgeDeleteDocument",params(("document_id"=Uuid,Path)),responses((status=204,description="Deleted")))]
pub async fn remove_document(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(did): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let d = document_access(&s, &h, did, true).await?;
    let tx = s.db.begin().await?;
    rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_bases WHERE id=$1::uuid FOR UPDATE",vec![d["base_id"].as_str().unwrap_or("").into()]).await.map_err(storage)?;
    exec(
        &tx,
        "DELETE FROM knowledge_upload_commands WHERE document_id=$1::uuid",
        vec![id(did)],
    )
    .await
    .map_err(storage)?;
    exec(
        &tx,
        "DELETE FROM knowledge_documents WHERE id=$1::uuid",
        vec![id(did)],
    )
    .await
    .map_err(storage)?;
    tx.commit().await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
#[utoipa::path(delete,path="/api/knowledge/bases/{base_id}",operation_id="knowledgeDeleteBase",params(("base_id"=Uuid,Path)),responses((status=204,description="Deleted")))]
pub async fn remove_base(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(bid): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    access(&s, &h, bid, true).await?;
    exec(
        &s.db,
        "DELETE FROM knowledge_bases WHERE id=$1::uuid",
        vec![id(bid)],
    )
    .await
    .map_err(storage)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
#[utoipa::path(get,path="/api/knowledge/versions/{version_id}/content",operation_id="knowledgeDownloadVersion",params(("version_id"=Uuid,Path)),responses((status=200,content_type="application/octet-stream",body=BinaryUpload)))]
pub async fn download(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(vid): Path<Uuid>,
) -> Result<Response, AppError> {
    let v=rows(&s.db,"SELECT jsonb_build_object('document',document_id)::text data FROM knowledge_document_versions WHERE id=$1::uuid",vec![id(vid)]).await.map_err(storage)?.pop().ok_or_else(||AppError::NotFound("文档版本不存在".into()))?;
    document_access(
        &s,
        &h,
        Uuid::parse_str(v["document"].as_str().unwrap_or("")).map_err(storage)?,
        false,
    )
    .await?;
    let row =
        s.db.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT contents FROM knowledge_document_versions WHERE id=$1::uuid",
            vec![id(vid)],
        ))
        .await?
        .ok_or_else(|| AppError::NotFound("文档不存在".into()))?;
    let bytes: Vec<u8> = row.try_get("", "contents")?;
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, "attachment")
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(bytes))
        .map_err(|e| AppError::Server(std::io::Error::other(e)))?)
}

#[cfg(test)]
mod tests;
