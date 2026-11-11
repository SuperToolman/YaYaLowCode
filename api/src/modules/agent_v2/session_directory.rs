//! Session metadata and directory; authorization always precedes pagination.
use super::*;
use yaya_agent_v2::domain::AgentV2Sessions;
use sea_orm::TransactionTrait;
use serde::{Serialize, Deserialize};
use utoipa::{IntoParams, ToSchema};
use yaya_agent_v2::store::{exec, event};

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct DirectoryQuery {
    pub employee_id: Option<String>,
    pub search: Option<String>,
    pub search_in: Option<String>,
    pub archived: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    /// Include persisted provider token usage for each authorized session.
    pub include_token_usage: Option<bool>,
}
#[derive(Serialize, Deserialize)]
struct Cursor { pinned: bool, updated_at: String, id: Uuid, filter: String }

#[utoipa::path(get,path="/api/agent/v2/sessions",operation_id="agentV2Sessions",params(DirectoryQuery),responses((status=200,body=AgentV2Sessions)))]
pub(crate) async fn list(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<DirectoryQuery>) -> Result<Json<Value>, AppError> {
    let (scope, grants) = principal(&state, &headers).await?;
    let allowed: Vec<String> = if query.archived.unwrap_or(false) {
        rows(&state.db,"SELECT DISTINCT jsonb_build_object('employee',employee_id)::text data FROM agent_v2_sessions WHERE tenant_id=$1::uuid AND owner_user_id=$2::uuid",vec![id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.into_iter().filter_map(|v|v["employee"].as_str().map(str::to_string)).filter(|id|employee_allowed(&grants,id)).collect()
    } else {installed().await?.into_iter().filter(|e| employee_allowed(&grants, &e.id)).map(|e| e.id).collect()};
    let search = query.search.unwrap_or_default().trim().to_string();
    if search.chars().count() > 200 { return Err(AppError::BadRequest("搜索内容最多 200 个字符".into())); }
    let search_in=query.search_in.unwrap_or("all".into());
    if !matches!(search_in.as_str(),"all"|"title"|"content") {return Err(AppError::BadRequest("搜索范围无效".into()));}
    let employee = query.employee_id.unwrap_or_default();
    let archived = query.archived.unwrap_or(false);
    let limit = query.limit.unwrap_or(50).clamp(1,100);
    let filter = json!([scope.tenant_id,scope.user_id,employee,search,search_in,archived,"archive-time-v1"]).to_string();
    let cursor: Option<Cursor> = query.cursor.as_deref().map(serde_json::from_str).transpose().map_err(|_| AppError::BadRequest("会话分页游标无效".into()))?;
    if let Some(c) = &cursor {
        if c.filter != filter || chrono::DateTime::parse_from_rfc3339(&c.updated_at).is_err() { return Err(AppError::BadRequest("筛选条件已变化，请重新加载会话".into())); }
    }
    let mut items = rows(&state.db, r#"
SELECT row_to_json(x)::text data FROM (
 SELECT s.*, (SELECT status FROM agent_v2_session_deletions d WHERE d.session_id=s.id) deletion_status, (SELECT error_code FROM agent_v2_session_deletions d WHERE d.session_id=s.id) deletion_error, (SELECT status FROM agent_v2_runs r WHERE r.session_id=s.id ORDER BY queue_seq DESC LIMIT 1) run_status
 FROM agent_v2_sessions s
 WHERE s.tenant_id=$1::uuid AND s.owner_user_id=$2::uuid
 AND (s.deletion_requested_at IS NULL OR $5)
 AND $3::jsonb ? s.employee_id AND ($4='' OR s.employee_id=$4)
 AND (s.archived_at IS NOT NULL)=$5
 AND ($6='' OR ($11<>'content' AND strpos(lower(s.title),lower($6))>0)
      OR ($11<>'title' AND (
          EXISTS (SELECT 1 FROM agent_v2_messages m, LATERAL jsonb_array_elements(m.parts) part
                  WHERE m.session_id=s.id AND part->>'type'='text' AND strpos(lower(part->>'text'),lower($6))>0)
          OR EXISTS (SELECT 1 FROM agent_v2_steps step JOIN agent_v2_runs run ON run.id=step.run_id
                     WHERE run.session_id=s.id AND step.status='completed' AND strpos(lower(step.response_snapshot#>>'{answer,text}'),lower($6))>0)
      )))
 AND ($7='' OR (CASE WHEN $5 THEN false ELSE s.pinned END,CASE WHEN $5 THEN s.archived_at ELSE s.updated_at END,s.id)<($8,NULLIF($7,'')::timestamptz,$9::uuid))
 ORDER BY CASE WHEN $5 THEN false ELSE s.pinned END DESC,CASE WHEN $5 THEN s.archived_at ELSE s.updated_at END DESC,s.id DESC LIMIT $10
) x"#, vec![id(scope.tenant_id),id(scope.user_id),json!(allowed).to_string().into(),employee.into(),archived.into(),search.clone().into(),cursor.as_ref().map(|c|c.updated_at.clone()).unwrap_or_default().into(),cursor.as_ref().map(|c|c.pinned).unwrap_or(false).into(),id(cursor.as_ref().map(|c|c.id).unwrap_or(Uuid::nil())),((limit+1) as i64).into(),search_in.clone().into()]).await.map_err(map_store)?;
    let more=items.len()>limit as usize;
    items.truncate(limit as usize);
    if query.include_token_usage.unwrap_or(false) && !items.is_empty() {
        let ids = items.iter().filter_map(|item| item["id"].as_str().and_then(|s| Uuid::parse_str(s).ok())).collect::<Vec<_>>();
        let usage = store(&state).session_token_usage(&ids).await.map_err(map_store)?;
        for item in &mut items {
            if let Some(record) = usage.iter().find(|record| record["session_id"] == item["id"]) {
                item["token_usage"] = record["token_usage"].clone();
            }
        }
    }
    // Return bounded plain-text matches only from the already-authorized page.
    // No raw tool arguments, configuration or private reasoning enters search results.
    for item in &mut items {
        let mut hits=Vec::new();
        if !search.is_empty() && search_in!="title" {
            let matches=rows(&state.db,r#"
 SELECT jsonb_build_object('id',x.id,'role',x.role,'excerpt',
   CASE WHEN strpos(lower(x.text),lower($2))>65 THEN '…' ELSE '' END ||
   substring(x.text FROM GREATEST(1,strpos(lower(x.text),lower($2))-64) FOR LEAST(400,char_length($2)+160)) ||
   CASE WHEN char_length(x.text)>GREATEST(1,strpos(lower(x.text),lower($2))-64)+LEAST(400,char_length($2)+160)-1 THEN '…' ELSE '' END)::text data
 FROM (
 SELECT m.id::text||':'||p.n::text id,m.role,p.part->>'text' text,m.created_at ts
 FROM agent_v2_messages m,LATERAL jsonb_array_elements(m.parts) WITH ORDINALITY p(part,n)
 WHERE m.session_id=$1::uuid AND p.part->>'type'='text'
 UNION ALL
 SELECT 'step:'||step.run_id::text||':'||step.ordinal::text||':'||step.attempt::text,'assistant',step.response_snapshot#>>'{answer,text}',step.created_at
 FROM agent_v2_steps step JOIN agent_v2_runs r ON r.id=step.run_id
 WHERE r.session_id=$1::uuid AND step.status='completed'
 AND NOT EXISTS (
   SELECT 1 FROM agent_v2_messages final,LATERAL jsonb_array_elements(final.parts) part
   WHERE final.run_id=step.run_id AND final.role='assistant'
     AND part->>'type'='text' AND part->>'text'=step.response_snapshot#>>'{answer,text}'
 )
 ) x WHERE strpos(lower(x.text),lower($2))>0 ORDER BY x.ts DESC,x.id LIMIT 5
"#,vec![item["id"].as_str().unwrap_or("").into(),search.clone().into()]).await.map_err(map_store)?;
            hits=matches;
        }
        item["search_hits"]=json!(hits);
    }
    let next_cursor=if more {items.last().map(|v|json!({"pinned":if archived {json!(false)} else {v["pinned"].clone()},"updated_at":if archived {v["archived_at"].clone()} else {v["updated_at"].clone()},"id":v["id"],"filter":filter}).to_string())} else {None};
    Ok(Json(json!({"items":items,"next_cursor":next_cursor})))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct UpdateSession {
    pub expected_version: i64,
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[utoipa::path(patch,path="/api/agent/v2/sessions/{session_id}",operation_id="agentV2UpdateSession",params(("session_id"=Uuid,Path)),request_body=UpdateSession,responses((status=200,body=AgentV2Session),(status=409,description="Session changed or has unfinished tasks")))]
pub(crate) async fn update(State(state): State<AppState>, headers: HeaderMap, Path(session_id): Path<Uuid>, Json(input): Json<UpdateSession>) -> Result<Json<Value>,AppError> {
    let (scope,_) = access(&state,&headers,session_id).await?;
    let title=input.title.as_deref().map(str::trim);
    if title.is_some_and(|t|t.is_empty() || t.chars().count()>120 || t.chars().any(char::is_control)) || (title.is_none() && input.pinned.is_none() && input.archived.is_none()) {return Err(AppError::BadRequest("请提供有效修改，标题需为 1—120 个字符且不能含控制字符".into()));}
    let tx=state.db.begin().await?;
    let current=rows(&tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid FOR UPDATE",vec![id(session_id),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::NotFound("session not found".into()))?;
    if !current["deletion_requested_at"].is_null() {return Err(AppError::Conflict("会话正在删除，不能修改或恢复".into()));}
    if current["metadata_version"].as_i64()!=Some(input.expected_version) {return Err(AppError::Conflict("会话已被修改，请刷新后重试".into()));}
    if input.archived==Some(true) {
        // Archive and cancellation share the session lock and transaction. Running
        // processes acknowledge stopping asynchronously; they are never assumed dead.
        Store::submit_in_transaction(&tx, &scope, session_id, &Command::Cancel {
            client_command_id: Uuid::new_v4(),
        }).await.map_err(map_store)?;
    }
    exec(&tx,"UPDATE agent_v2_sessions SET title=COALESCE($2,title),title_custom=title_custom OR $2 IS NOT NULL,pinned=COALESCE($3,pinned),archived_at=CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN COALESCE(archived_at,now()) ELSE NULL END,metadata_version=metadata_version+1 WHERE id=$1::uuid",vec![id(session_id),title.map(str::to_string).into(),input.pinned.into(),input.archived.into()]).await.map_err(map_store)?;
    event(&tx,session_id,None,"session.updated",json!({"metadataVersion":input.expected_version+1})).await.map_err(map_store)?;
    let result=rows(&tx,"SELECT (to_jsonb(s)||jsonb_build_object('run_status',(SELECT status FROM agent_v2_runs r WHERE r.session_id=s.id ORDER BY queue_seq DESC LIMIT 1)))::text data FROM agent_v2_sessions s WHERE id=$1::uuid",vec![id(session_id)]).await.map_err(map_store)?.remove(0);
    tx.commit().await?;
    Ok(Json(result))
}
