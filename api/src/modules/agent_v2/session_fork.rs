//! Immutable conversation snapshots; no executable source state crosses the fork.
use super::*;
use sea_orm::TransactionTrait;
use serde::Deserialize;
use utoipa::ToSchema;
use yaya_agent_v2::store::{exec,event,js};
use std::collections::HashMap;

#[derive(Deserialize,ToSchema)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ForkSession { pub client_request_id:Uuid, pub message_id:Uuid }

#[utoipa::path(post,path="/api/agent/v2/sessions/{session_id}/fork",operation_id="agentV2ForkSession",params(("session_id"=Uuid,Path)),request_body=ForkSession,responses((status=200,body=AgentV2Session),(status=409,description="Boundary unavailable or idempotency conflict")))]
pub(crate) async fn fork(State(state):State<AppState>,headers:HeaderMap,Path(source):Path<Uuid>,Json(input):Json<ForkSession>)->Result<Json<Value>,AppError>{
 let(scope,_)=access(&state,&headers,source).await?;
 let tx=state.db.begin().await?;
 // Scope-wide lock serializes identical client keys without creating a disposable session.
 exec(&tx,"SELECT pg_advisory_xact_lock(hashtextextended($1,0))",vec![format!("fork:{}:{}",scope.tenant_id,scope.user_id).into()]).await.map_err(map_store)?;
 let original=rows(&tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid AND deletion_requested_at IS NULL FOR UPDATE",vec![id(source),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::NotFound("source session not found".into()))?;
 let existing=rows(&tx,"SELECT row_to_json(f)::text data FROM agent_v2_forks f WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND client_id=$3::uuid",vec![id(scope.tenant_id),id(scope.user_id),id(input.client_request_id)]).await.map_err(map_store)?;
 if let Some(old)=existing.first(){
  if old["source_session_id"]!=source.to_string() || old["source_message_id"]!=input.message_id.to_string(){return Err(AppError::Conflict("分叉请求 ID 已用于其他消息".into()));}
  let target=Uuid::parse_str(old["target_session_id"].as_str().unwrap_or("")).map_err(map_store)?;
  let result=rows(&tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_user_id=$3::uuid AND deletion_requested_at IS NULL",vec![id(target),id(scope.tenant_id),id(scope.user_id)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::Conflict("此分叉会话已被删除，不能重放请求".into()))?;
  return Ok(Json(result));
 }
 let boundary=rows(&tx,"SELECT jsonb_build_object('seq',r.queue_seq)::text data FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.id=$1::uuid AND m.session_id=$2::uuid AND m.role='assistant' AND r.status='completed'",vec![id(input.message_id),id(source)]).await.map_err(map_store)?.pop().ok_or_else(||AppError::Conflict("只能从已完成且持久保存的助手回复分叉".into()))?;
 let seq=boundary["seq"].as_i64().ok_or_else(||AppError::BadRequest("invalid boundary".into()))?;
 let runs=rows(&tx,"SELECT jsonb_build_object('id',r.id,'status',r.status)::text data FROM agent_v2_runs r WHERE session_id=$1::uuid AND queue_seq<=$2 ORDER BY queue_seq",vec![id(source),seq.into()]).await.map_err(map_store)?;
 if runs.iter().any(|r|!matches!(r["status"].as_str(),Some("completed"|"failed"|"cancelled"))){return Err(AppError::Conflict("边界之前存在未结束任务，请先处理后再分叉".into()));}
 let messages=rows(&tx,"SELECT row_to_json(m)::text data FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.session_id=$1::uuid AND r.queue_seq<=$2 ORDER BY r.queue_seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END",vec![id(source),seq.into()]).await.map_err(map_store)?;
 let files=rows(&tx,r#"SELECT jsonb_build_object('id',f.id,'size',f.size,'run_id',f.run_id)::text data FROM agent_v2_files f WHERE f.session_id=$1::uuid AND (
 EXISTS(SELECT 1 FROM agent_v2_runs r WHERE r.id=f.run_id AND r.session_id=$1::uuid AND r.queue_seq<=$2)
 OR EXISTS(SELECT 1 FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id,LATERAL jsonb_array_elements(m.parts) p WHERE m.session_id=$1::uuid AND r.queue_seq<=$2 AND p->>'fileId'=f.id::text))"#,vec![id(source),seq.into()]).await.map_err(map_store)?;
 if files.len()>200 || files.iter().map(|f|f["size"].as_i64().unwrap_or(i64::MAX)).try_fold(0i64,|a,b|a.checked_add(b)).is_none_or(|n|n>100*1024*1024){return Err(AppError::Conflict("分叉文件超过会话工作区 100 MiB / 200 文件限额".into()));}
 let target=Uuid::new_v4();
 let title=format!("{} · 分叉",original["title"].as_str().unwrap_or("会话").chars().take(110).collect::<String>());
 exec(&tx,"INSERT INTO agent_v2_sessions(id,tenant_id,owner_user_id,employee_id,title,title_custom,fork_origin) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,true,$6)",vec![id(target),id(scope.tenant_id),id(scope.user_id),original["employee_id"].as_str().unwrap_or("").into(),title.into(),js(json!({"sessionId":source,"messageId":input.message_id}))]).await.map_err(map_store)?;
 let run_map:HashMap<String,Uuid>=runs.iter().map(|r|(r["id"].as_str().unwrap_or("").to_owned(),Uuid::new_v4())).collect();
 let file_map:HashMap<String,Uuid>=files.iter().map(|f|(f["id"].as_str().unwrap_or("").to_owned(),Uuid::new_v4())).collect();
 for (index,run) in runs.iter().enumerate(){
  let new=run_map[run["id"].as_str().unwrap_or("")];
  exec(&tx,"INSERT INTO agent_v2_commands(id,session_id,client_id,payload) VALUES($1::uuid,$2::uuid,$3::uuid,$4)",vec![id(new),id(target),id(Uuid::new_v4()),js(json!({"kind":"history_snapshot"}))]).await.map_err(map_store)?;
  exec(&tx,"INSERT INTO agent_v2_runs(id,session_id,status,queue_seq,history_snapshot,execution_protocol) VALUES($1::uuid,$2::uuid,$3,$4,true,2)",vec![id(new),id(target),run["status"].as_str().unwrap_or("completed").into(),((index+1) as i64).into()]).await.map_err(map_store)?;
 }
 for f in &files {
  let old=f["id"].as_str().unwrap_or("");
  let mapped_run=f["run_id"].as_str().and_then(|v|run_map.get(v)).map(|v|v.to_string());
  exec(&tx,"INSERT INTO agent_v2_files(id,session_id,run_id,name,mime_type,size,sha256,source,contents) SELECT $1::uuid,$2::uuid,$3::uuid,name,mime_type,size,sha256,source,contents FROM agent_v2_files WHERE id=$4::uuid AND session_id=$5::uuid",vec![id(file_map[old]),id(target),mapped_run.into(),old.into(),id(source)]).await.map_err(map_store)?;
 }
 for m in messages {
  let mut parts=m["parts"].clone();
  for part in parts.as_array_mut().ok_or_else(||AppError::BadRequest("invalid message".into()))? {
   if let Some(text)=part["text"].as_str(){part["text"]=json!(rewrite_text(text,source,target,&file_map));}
   if let Some(old)=part["fileId"].as_str(){let new=file_map.get(old).ok_or_else(||AppError::Conflict("历史附件缺失，不能创建不完整分叉".into()))?;part["fileId"]=json!(new);}
  }
  exec(&tx,"INSERT INTO agent_v2_messages(id,session_id,run_id,role,parts,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz)",vec![id(Uuid::new_v4()),id(target),id(run_map[m["run_id"].as_str().unwrap_or("")]),m["role"].as_str().unwrap_or("").into(),js(parts),m["created_at"].as_str().unwrap_or("").into()]).await.map_err(map_store)?;
 }
 // Only already-visible explanations are copied; tool invocations, private reasoning,
 // authorization snapshots, model configuration and execution environments are excluded.
 let notes=rows(&tx,r#"SELECT jsonb_build_object('run',e.run_id,'step',e.payload->'step','text',COALESCE(e.payload->>'text',
 (SELECT step.response_snapshot#>>'{answer,text}' FROM agent_v2_steps step WHERE step.run_id=e.run_id AND step.ordinal=(e.payload->>'step')::int AND step.attempt=(e.payload->>'epoch')::int AND step.status='completed')))::text data
 FROM agent_v2_events e JOIN agent_v2_runs r ON r.id=e.run_id WHERE r.session_id=$1::uuid AND r.queue_seq<=$2 AND e.type='step.completed' ORDER BY r.queue_seq,e.seq"#,vec![id(source),seq.into()]).await.map_err(map_store)?;
 for note in notes {if note["text"].as_str().is_none_or(|v|v.is_empty()){continue;} event(&tx,target,Some(run_map[note["run"].as_str().unwrap_or("")]),"step.completed",json!({"step":note["step"],"epoch":0,"text":rewrite_text(note["text"].as_str().unwrap_or(""),source,target,&file_map),"historySnapshot":true})).await.map_err(map_store)?;}
 for run in &runs {event(&tx,target,Some(run_map[run["id"].as_str().unwrap_or("")]),"run.history_snapshot",json!({"historyOnly":true,"status":run["status"]})).await.map_err(map_store)?;}
 exec(&tx,"UPDATE agent_v2_sessions SET next_seq=GREATEST(next_seq,$2) WHERE id=$1::uuid",vec![id(target),(runs.len() as i64).into()]).await.map_err(map_store)?;
 event(&tx,target,None,"session.forked",json!({"sourceSessionId":source,"sourceMessageId":input.message_id,"historyOnly":true})).await.map_err(map_store)?;
 exec(&tx,"INSERT INTO agent_v2_forks(tenant_id,user_id,client_id,source_session_id,source_message_id,target_session_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)",vec![id(scope.tenant_id),id(scope.user_id),id(input.client_request_id),id(source),id(input.message_id),id(target)]).await.map_err(map_store)?;
 let result=rows(&tx,"SELECT row_to_json(s)::text data FROM agent_v2_sessions s WHERE id=$1::uuid",vec![id(target)]).await.map_err(map_store)?.remove(0);
 tx.commit().await?;
 Ok(Json(result))
}

fn rewrite_text(text:&str,source:Uuid,target:Uuid,files:&HashMap<String,Uuid>)->String {
 let mut result=text.replace(&format!("/api/agent/v2/sessions/{source}/files/"),&format!("/api/agent/v2/sessions/{target}/files/"));
 for(old,new) in files {result=result.replace(old,&new.to_string());}
 result
}
