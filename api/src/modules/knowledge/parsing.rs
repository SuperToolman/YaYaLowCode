//! K2: durable, bounded parsing; deliberately no searchable/vector-ready claim.
use super::*;
use base64::Engine;
use sea_orm::TransactionTrait;
use std::time::Duration;

const PARSER: &str = "office-0.1.0-knowledge-1";
const CHUNKER: &str = "structure-utf8-v1";

pub(super) async fn enqueue(db: &impl ConnectionTrait, version: Uuid) -> Result<(), AppError> {
    exec(db,"INSERT INTO knowledge_index_generations(id,version_id,parser_version,chunker_version,status) VALUES($1::uuid,$2::uuid,$3,$4,'queued') ON CONFLICT(version_id,parser_version,chunker_version) DO NOTHING",vec![id(Uuid::new_v4()),id(version),PARSER.into(),CHUNKER.into()]).await.map_err(storage)?;
    let generation=rows(db,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_index_generations WHERE version_id=$1::uuid AND parser_version=$2 AND chunker_version=$3",vec![id(version),PARSER.into(),CHUNKER.into()]).await.map_err(storage)?.remove(0);
    exec(db,"INSERT INTO knowledge_jobs(id,generation_id,status) VALUES($1::uuid,$2::uuid,'queued') ON CONFLICT(generation_id) DO NOTHING",vec![id(Uuid::new_v4()),generation["id"].as_str().unwrap_or("").into()]).await.map_err(storage)?;
    exec(db,"UPDATE knowledge_document_versions SET status='queued' WHERE id=$1::uuid AND status='stored'",vec![id(version)]).await.map_err(storage)?;
    Ok(())
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
pub struct ParseQuery {
    pub offset: Option<u32>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunk {
    pub ordinal: i32,
    pub text: String,
    pub location: Value,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeParsing {
    pub status: String,
    pub parser_version: String,
    pub chunker_version: String,
    pub chunk_count: i32,
    pub error_code: Option<String>,
    pub coverage: Value,
    pub chunks: Vec<KnowledgeChunk>,
    pub next_offset: Option<u32>,
}

#[utoipa::path(get,path="/api/knowledge/versions/{version_id}/parsing",operation_id="knowledgeParsing",params(("version_id"=Uuid,Path),ParseQuery),responses((status=200,body=KnowledgeParsing)))]
pub async fn read(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(vid): Path<Uuid>,
    Query(q): Query<ParseQuery>,
) -> Result<Json<KnowledgeParsing>, AppError> {
    authorize_version(&s, &h, vid, false).await?;
    let generation=rows(&s.db,"SELECT row_to_json(g)::text data FROM knowledge_index_generations g WHERE version_id=$1::uuid AND parser_version=$2 AND chunker_version=$3",vec![id(vid),PARSER.into(),CHUNKER.into()]).await.map_err(storage)?.pop().ok_or_else(||AppError::NotFound("文档尚未安排解析".into()))?;
    let offset = q.offset.unwrap_or(0).min(4096);
    let values=rows(&s.db,"SELECT jsonb_build_object('ordinal',ordinal,'text',body,'location',location)::text data FROM knowledge_chunks WHERE generation_id=$1::uuid AND ordinal>=$2 ORDER BY ordinal LIMIT 21",vec![generation["id"].as_str().unwrap_or("").into(),(offset as i32).into()]).await.map_err(storage)?;
    let more = values.len() > 20;
    let chunks = values
        .into_iter()
        .take(20)
        .map(|v| KnowledgeChunk {
            ordinal: v["ordinal"].as_i64().unwrap_or(0) as i32,
            text: v["text"].as_str().unwrap_or("").into(),
            location: v["location"].clone(),
        })
        .collect();
    // Revocation during the read must not disclose any of the loaded text.
    authorize_version(&s, &h, vid, false).await?;
    Ok(Json(KnowledgeParsing {
        status: generation["status"].as_str().unwrap_or("queued").into(),
        parser_version: PARSER.into(),
        chunker_version: CHUNKER.into(),
        chunk_count: generation["chunk_count"].as_i64().unwrap_or(0) as i32,
        error_code: generation["error_code"].as_str().map(str::to_owned),
        coverage: generation["coverage"].clone(),
        chunks,
        next_offset: more.then_some(offset + 20),
    }))
}

async fn authorize_version(
    s: &AppState,
    h: &HeaderMap,
    vid: Uuid,
    write: bool,
) -> Result<Uuid, AppError> {
    let v=rows(&s.db,"SELECT jsonb_build_object('document',document_id)::text data FROM knowledge_document_versions WHERE id=$1::uuid",vec![id(vid)]).await.map_err(storage)?.pop().ok_or_else(||AppError::NotFound("文档版本不存在".into()))?;
    let did = Uuid::parse_str(v["document"].as_str().unwrap_or("")).map_err(storage)?;
    document_access(s, h, did, write).await?;
    Ok(did)
}

#[utoipa::path(post,path="/api/knowledge/versions/{version_id}/reprocess",operation_id="knowledgeReprocess",params(("version_id"=Uuid,Path)),responses((status=200,body=KnowledgeDocument)))]
pub async fn reprocess(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(vid): Path<Uuid>,
) -> Result<Json<KnowledgeDocument>, AppError> {
    let did = authorize_version(&s, &h, vid, true).await?;
    let tx = s.db.begin().await?;
    let doc = rows(
        &tx,
        "SELECT row_to_json(d)::text data FROM knowledge_documents d WHERE id=$1::uuid FOR UPDATE",
        vec![id(did)],
    )
    .await
    .map_err(storage)?
    .pop()
    .ok_or_else(|| AppError::NotFound("文档不存在".into()))?;
    if doc["current_version_id"] != vid.to_string() {
        return Err(AppError::Conflict("仅能重试当前文档版本".into()));
    }
    enqueue(&tx, vid).await?;
    // A duplicate click cannot reset a live generation or extend its lease.
    let changed=exec(&tx,"UPDATE knowledge_jobs SET status='queued',attempts=0,available_at=now(),error_code=NULL,updated_at=now() WHERE generation_id IN(SELECT id FROM knowledge_index_generations WHERE version_id=$1::uuid AND parser_version=$2 AND chunker_version=$3 AND status='failed') AND status='failed'",vec![id(vid),PARSER.into(),CHUNKER.into()]).await.map_err(storage)?;
    if changed > 0 {
        exec(&tx,"UPDATE knowledge_index_generations SET status='queued',error_code=NULL,updated_at=now() WHERE version_id=$1::uuid AND parser_version=$2 AND chunker_version=$3",vec![id(vid),PARSER.into(),CHUNKER.into()]).await.map_err(storage)?;
        exec(
            &tx,
            "UPDATE knowledge_document_versions SET status='queued' WHERE id=$1::uuid",
            vec![id(vid)],
        )
        .await
        .map_err(storage)?;
    }
    let result = document_dto(&tx, did, Some(vid)).await?;
    tx.commit().await?;
    Ok(Json(result))
}

fn chunks(extracted: &Value) -> Result<Vec<Value>, AppError> {
    let units = extracted["units"]
        .as_array()
        .ok_or_else(|| bad("knowledge_invalid_response"))?;
    if extracted["coverage"]["complete"] != true {
        return Err(bad("knowledge_incomplete_extraction"));
    }
    let mut chunks = Vec::new();
    let mut total = 0usize;
    for unit in units {
        let text = unit["text"]
            .as_str()
            .ok_or_else(|| bad("knowledge_invalid_response"))?;
        let table = unit["location"].get("row").is_some();
        if table && text.len() > 12 * 1024 {
            return Err(bad("knowledge_table_row_limit"));
        }
        let mut start = 0;
        while start < text.len() {
            let mut end = (start + if table { 12 * 1024 } else { 2400 }).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let body = &text[start..end];
            let mut location = unit["location"].clone();
            location["byteStart"] = json!(start);
            location["byteEnd"] = json!(end);
            total += body.len();
            if chunks.len() >= 4096 || total > 4 * 1024 * 1024 {
                return Err(bad("knowledge_chunk_limit"));
            }
            chunks.push(json!({"id":Uuid::new_v4(),"ordinal":chunks.len(),"body":body,"location":location,"sha256":format!("{:x}",Sha256::digest(body.as_bytes()))}));
            start = end;
        }
    }
    if chunks.is_empty() {
        return Err(bad("knowledge_no_extractable_text"));
    }
    Ok(chunks)
}

pub(super) async fn process(s: &AppState) -> Result<bool, AppError> {
    let tx = s.db.begin().await?;
    let job=rows(&tx,"WITH candidate AS(SELECT id FROM knowledge_jobs WHERE (status IN('queued','retry_wait') AND available_at<=now()) OR (status='processing' AND lease_until<now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE knowledge_jobs j SET status='processing',epoch=epoch+1,attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() FROM candidate c WHERE j.id=c.id RETURNING row_to_json(j)::text data",vec![]).await.map_err(storage)?.pop();
    let Some(job) = job else {
        tx.commit().await?;
        return Ok(false);
    };
    let gid = job["generation_id"].as_str().unwrap_or("");
    // No document bytes, generation lock or process inside the claim transaction.
    tx.commit().await?;
    let source=rows(&s.db,"SELECT jsonb_build_object('version',v.id,'document',d.id,'name',v.name,'hash',v.sha256,'data',encode(v.contents,'base64'),'current',d.current_version_id=v.id,'kind',b.kind,'employee',b.employee_id,'package',d.package_version)::text data FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id JOIN knowledge_bases b ON b.id=d.base_id WHERE g.id=$1::uuid",vec![gid.into()]).await.map_err(storage)?.pop();
    let Some(source) = source else {
        return Ok(true);
    };
    {
        let tx = s.db.begin().await?;
        let doc=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE",vec![source["document"].as_str().unwrap_or("").into()]).await.map_err(storage)?;
        if doc.is_empty() {
            return Ok(true);
        }
        let fenced=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_jobs WHERE id=$1::uuid AND epoch=$2 AND status='processing' AND lease_until>now() FOR UPDATE",vec![job["id"].as_str().unwrap_or("").into(),job["epoch"].as_i64().unwrap_or(0).into()]).await.map_err(storage)?;
        if fenced.is_empty() {
            return Ok(true);
        }
        exec(&tx,"UPDATE knowledge_index_generations SET status='processing',updated_at=now() WHERE id=$1::uuid",vec![gid.into()]).await.map_err(storage)?;
        exec(&tx,"UPDATE knowledge_document_versions SET status='processing' WHERE id=(SELECT version_id FROM knowledge_index_generations WHERE id=$1::uuid)",vec![gid.into()]).await.map_err(storage)?;
        tx.commit().await?;
    }

    let valid = source["current"] == true
        && (source["kind"] != "employee_bundle"
            || source["employee"]
                .as_str()
                .and_then(employee_version)
                .is_some_and(|version| source["package"] == version));
    let intact = base64::engine::general_purpose::STANDARD
        .decode(
            source["data"]
                .as_str()
                .unwrap_or("")
                .replace(['\r', '\n'], ""),
        )
        .is_ok_and(|bytes| source["hash"] == format!("{:x}", Sha256::digest(&bytes)));
    let extracted = if valid && intact {
        crate::modules::agent_v2::office::invoke(
            json!({"operation":"extract_knowledge","name":source["name"],"data":source["data"]}),
        )
        .await
    } else if !intact {
        Err(bad("knowledge_source_integrity_failed"))
    } else {
        Err(bad("knowledge_version_superseded"))
    };
    let result = match extracted {
        Ok(value) if value.get("error").is_none() => {
            chunks(&value).map(|chunks| (value["coverage"].clone(), chunks))
        }
        Ok(value) => Err(bad(error_code(
            value["error"]["message"].as_str().unwrap_or(""),
            value["error"]["code"].as_str().unwrap_or(""),
        ))),
        Err(error) => Err(error),
    };
    // Lock document before job, matching reprocess. Deletion cascades and removes
    // the generation, so late results cannot recreate a deleted document.
    let tx = s.db.begin().await?;
    let current=rows(&tx,"SELECT jsonb_build_object('version',current_version_id)::text data FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE",vec![source["document"].as_str().unwrap_or("").into()]).await.map_err(storage)?.pop();
    let fenced=rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_jobs WHERE id=$1::uuid AND epoch=$2 AND status='processing' AND lease_until>now() FOR UPDATE",vec![job["id"].as_str().unwrap_or("").into(),job["epoch"].as_i64().unwrap_or(0).into()]).await.map_err(storage)?;
    if fenced.is_empty() {
        return Ok(true);
    }
    let still_valid = valid
        && current
            .as_ref()
            .is_some_and(|d| d["version"] == source["version"])
        && (source["kind"] != "employee_bundle"
            || source["employee"]
                .as_str()
                .and_then(employee_version)
                .is_some_and(|version| source["package"] == version));
    let mut code = None;
    let mut retry = false;
    let awaiting_source = current
        .as_ref()
        .is_some_and(|d| d["version"] == source["version"])
        && source["kind"] == "employee_bundle"
        && source["employee"]
            .as_str()
            .and_then(employee_version)
            .is_none();
    let (status, gstatus) = if awaiting_source {
        code = Some("knowledge_source_inactive");
        retry = true;
        ("retry_wait", "queued")
    } else if !still_valid {
        code = Some("knowledge_source_inactive");
        ("cancelled", "cancelled")
    } else {
        match result {
            Ok((coverage, chunks)) => {
                exec(
                    &tx,
                    "DELETE FROM knowledge_chunks WHERE generation_id=$1::uuid",
                    vec![gid.into()],
                )
                .await
                .map_err(storage)?;
                exec(&tx,"INSERT INTO knowledge_chunks(id,generation_id,ordinal,body,location,sha256) SELECT id,$1::uuid,ordinal,body,location,sha256 FROM jsonb_to_recordset($2::jsonb) AS c(id uuid,ordinal integer,body text,location jsonb,sha256 text)",vec![gid.into(),Value::Array(chunks.clone()).into()]).await.map_err(storage)?;
                exec(&tx,"UPDATE knowledge_index_generations SET active=false WHERE version_id=$1::uuid AND id<>$2::uuid",vec![source["version"].as_str().unwrap_or("").into(),gid.into()]).await.map_err(storage)?;
                exec(&tx,"UPDATE knowledge_index_generations SET active=true,coverage=$2,chunk_count=$3 WHERE id=$1::uuid",vec![gid.into(),coverage.into(),(chunks.len() as i32).into()]).await.map_err(storage)?;
                exec(
                    &tx,
                    "UPDATE knowledge_documents SET parsed_version_id=$2::uuid WHERE id=$1::uuid",
                    vec![
                        source["document"].as_str().unwrap_or("").into(),
                        source["version"].as_str().unwrap_or("").into(),
                    ],
                )
                .await
                .map_err(storage)?;
                ("completed", "ready")
            }
            Err(error) => {
                let message = match &error {
                    AppError::BadRequest(message) => message.as_str(),
                    _ => "knowledge_parser_unavailable",
                };
                let safe = error_code(message, message);
                retry = matches!(
                    safe,
                    "knowledge_parser_unavailable" | "knowledge_parser_busy"
                ) && job["attempts"].as_i64().unwrap_or(3) < 3;
                code = Some(safe);
                if retry {
                    ("retry_wait", "queued")
                } else {
                    ("failed", "failed")
                }
            }
        }
    };
    exec(&tx,"UPDATE knowledge_jobs SET status=$2,error_code=$3,lease_until=NULL,available_at=now()+CASE WHEN $3='knowledge_source_inactive' THEN interval '60 seconds' ELSE interval '30 seconds' END,attempts=CASE WHEN $3='knowledge_source_inactive' THEN GREATEST(attempts-1,0) ELSE attempts END,updated_at=now() WHERE id=$1::uuid",vec![job["id"].as_str().unwrap_or("").into(),status.into(),code.map(str::to_owned).into()]).await.map_err(storage)?;
    exec(&tx,"UPDATE knowledge_index_generations SET status=$2,error_code=$3,updated_at=now() WHERE id=$1::uuid",vec![gid.into(),gstatus.into(),code.map(str::to_owned).into()]).await.map_err(storage)?;
    exec(
        &tx,
        "UPDATE knowledge_document_versions SET status=$2 WHERE id=$1::uuid",
        vec![
            source["version"].as_str().unwrap_or("").into(),
            if retry {
                "queued"
            } else if gstatus == "ready" {
                "ready"
            } else {
                "failed"
            }
            .into(),
        ],
    )
    .await
    .map_err(storage)?;
    tx.commit().await?;
    Ok(true)
}

fn error_code(message: &str, code: &str) -> &'static str {
    for known in [
        "knowledge_ocr_required",
        "knowledge_no_extractable_text",
        "knowledge_extracted_content_limit",
        "knowledge_document_traversal_limit",
        "knowledge_chunk_limit",
        "knowledge_table_row_limit",
        "knowledge_version_superseded",
        "knowledge_source_integrity_failed",
        "knowledge_parser_timeout",
        "knowledge_parser_version_mismatch",
        "knowledge_parser_unavailable",
        "knowledge_parser_busy",
    ] {
        if message.contains(known) {
            return known;
        }
    }
    if message.contains("office_unknown_operation") {
        return "knowledge_parser_version_mismatch";
    }
    if code == "office_process_limit" || message.contains("office_process_limit") {
        return "knowledge_parser_timeout";
    }
    if code == "office_unavailable"
        || message.contains("office_unavailable")
        || code == "knowledge_parser_unavailable"
    {
        return "knowledge_parser_unavailable";
    }
    if message.contains("office_busy") || code == "knowledge_parser_busy" {
        return "knowledge_parser_busy";
    }
    "knowledge_document_unreadable"
}

pub fn start(state: AppState) {
    tokio::spawn(async move {
        let mut shutdown = state.shutdown_receiver();
        loop {
            if *shutdown.borrow() {
                return;
            }
            let result = tokio::select! {
                _=shutdown.changed()=>return,
                result=process(&state)=>result,
            };
            match result {
                Ok(true) => continue,
                Ok(false) => {}
                Err(_) => {
                    tracing::warn!("knowledge parsing job deferred; metadata transaction failed")
                }
            }
            tokio::select! {
                _=shutdown.changed()=>return,
                _=tokio::time::sleep(Duration::from_secs(2))=>{},
            }
        }
    });
}
