//! Skill resources and execution broker. Skill configuration never crosses the model boundary.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sea_orm::TransactionTrait;
use sha2::{Digest, Sha256};
use std::path::{Path as FsPath, PathBuf};
use yaya_agent_v2::store::{Lease, event, exec, fingerprint, js};

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionRecord {
    pub id: Uuid,
    pub run_id: Uuid,
    pub call_id: String,
    pub status: String,
    pub result: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub timeout_seconds: Option<i32>,
    pub deadline_at: Option<String>,
}
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ExecutionList {
    pub items: Vec<ExecutionRecord>,
}
pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/internal/agent-v2/runs/{run_id}/executions/invoke",
            post(invoke),
        )
        .route("/api/agent/v2/sessions/{session_id}/executions", get(list))
        .route(
            "/api/agent/v2/sessions/{session_id}/executions/{execution_id}",
            get(detail),
        )
        .route(
            "/api/agent/v2/sessions/{session_id}/executions/{execution_id}/logs",
            get(logs),
        )
}
fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
const SELECT: &str = "SELECT jsonb_build_object('id',id,'runId',run_id,'callId',call_id,'status',status,'result',result,'createdAt',created_at,'updatedAt',updated_at,'timeoutSeconds',timeout_seconds,'deadlineAt',deadline_at)::text data FROM agent_v2_executions";
#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/executions",operation_id="agentV2Executions",params(("session_id"=Uuid,Path)),responses((status=200,body=ExecutionList)))]
pub(crate) async fn list(
    State(state): State<AppState>,
    h: HeaderMap,
    Path(sid): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    access(&state, &h, sid).await?;
    Ok(Json(
        json!({"items":rows(&state.db,&format!("{SELECT} WHERE session_id=$1::uuid ORDER BY created_at"),vec![id(sid)]).await.map_err(map_store)?}),
    ))
}
#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/executions/{execution_id}",operation_id="agentV2Execution",params(("session_id"=Uuid,Path),("execution_id"=Uuid,Path)),responses((status=200,body=ExecutionRecord)))]
pub(crate) async fn detail(
    State(state): State<AppState>,
    h: HeaderMap,
    Path((sid, eid)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    access(&state, &h, sid).await?;
    Ok(Json(
        rows(
            &state.db,
            &format!("{SELECT} WHERE session_id=$1::uuid AND id=$2::uuid"),
            vec![id(sid), id(eid)],
        )
        .await
        .map_err(map_store)?
        .pop()
        .ok_or_else(|| AppError::NotFound("execution not found".into()))?,
    ))
}
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionLog {
    pub text: String,
    pub next_offset: usize,
    pub truncated: bool,
    pub done: bool,
}
#[derive(serde::Deserialize)]
pub(crate) struct ExecutionLogQuery {
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    stream: Option<String>,
}
#[utoipa::path(get,path="/api/agent/v2/sessions/{session_id}/executions/{execution_id}/logs",operation_id="agentV2ExecutionLogs",params(("session_id"=Uuid,Path),("execution_id"=Uuid,Path),("offset"=Option<usize>,Query),("stream"=Option<String>,Query)),responses((status=200,body=ExecutionLog)))]
pub(crate) async fn logs(
    State(state): State<AppState>,
    h: HeaderMap,
    Path((sid, eid)): Path<(Uuid, Uuid)>,
    Query(q): Query<ExecutionLogQuery>,
) -> Result<Json<Value>, AppError> {
    access(&state, &h, sid).await?;
    if !["stdout", "stderr"].contains(&q.stream.as_deref().unwrap_or("stdout"))
        || q.offset > 2 * 1024 * 1024
    {
        return Err(bad("invalid log cursor"));
    }
    if rows(&state.db,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_executions WHERE session_id=$1::uuid AND id=$2::uuid",vec![id(sid),id(eid)]).await.map_err(map_store)?.is_empty(){return Err(AppError::NotFound("execution not found".into()))}
    Ok(Json(
        service(
            reqwest::Method::GET,
            &format!(
                "/executions/{eid}/logs?offset={}&stream={}",
                q.offset,
                q.stream.as_deref().unwrap_or("stdout")
            ),
            None,
        )
        .await?,
    ))
}
fn relative(path: &str) -> Result<PathBuf, AppError> {
    if path.is_empty()
        || path.len() > 240
        || path.contains(['\\', ':', '\0'])
        || path
            .split('/')
            .any(|s| s.is_empty() || s == ".." || s == ".")
    {
        return Err(bad("invalid skill resource path"));
    }
    Ok(PathBuf::from(path))
}
fn root(skill: &crate::platform::license::PlatformAiEmployeeSkill) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(&skill.package_path);
    let assets = std::fs::canonicalize(crate::platform::config::employee_package_assets_root())
        .map_err(|_| bad("skill resources unavailable"))?;
    let path = std::fs::canonicalize(path).map_err(|_| bad("skill resources unavailable"))?;
    if !path.starts_with(&assets) || !path.is_file() {
        return Err(bad("skill resource identity invalid"));
    }
    Ok(path
        .parent()
        .ok_or_else(|| bad("skill resources unavailable"))?
        .to_path_buf())
}
fn walk(
    base: &FsPath,
    dir: &FsPath,
    items: &mut Vec<Value>,
    bytes: &mut usize,
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(|_| bad("skill resources unavailable"))? {
        let e = entry.map_err(|_| bad("skill resource unreadable"))?;
        let kind = e
            .file_type()
            .map_err(|_| bad("skill resource unreadable"))?;
        if kind.is_symlink() {
            return Err(bad("skill resource links not supported"));
        }
        let path = e.path();
        let rel = path
            .strip_prefix(base)
            .map_err(|_| bad("skill path invalid"))?;
        if rel.components().count() > 12 {
            return Err(bad("skill resource depth limit"));
        }
        if kind.is_dir() {
            if !["node_modules", ".venv", "__pycache__", ".git"]
                .contains(&e.file_name().to_string_lossy().as_ref())
            {
                walk(base, &path, items, bytes)?;
            }
            continue;
        }
        if !kind.is_file() {
            return Err(bad("unsupported skill resource"));
        }
        if e.metadata()
            .map_err(|_| bad("skill resource unreadable"))?
            .len()
            > 16 * 1024 * 1024
        {
            return Err(bad("skill resource limit"));
        }
        let content = std::fs::read(&path).map_err(|_| bad("skill resource unreadable"))?;
        *bytes += content.len();
        if items.len() >= 1000 || *bytes > 40 * 1024 * 1024 {
            return Err(bad("skill resource limit"));
        }
        items.push(json!({"path":rel.to_string_lossy().replace('\\',"/"),"size":content.len(),"sha256":format!("{:x}",Sha256::digest(&content)),"data":STANDARD.encode(content)}));
    }
    Ok(())
}
fn resources(
    skill: &crate::platform::license::PlatformAiEmployeeSkill,
) -> Result<Vec<Value>, AppError> {
    let base = root(skill)?;
    let mut items = vec![];
    walk(&base, &base, &mut items, &mut 0)?;
    items.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(items)
}
pub(super) async fn service(
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, AppError> {
    let base = std::env::var("YAYA_AGENT_V2_EXECUTION_URL")
        .map_err(|_| bad("script_executor_unavailable"))?;
    let secret =
        std::env::var("YAYA_EXECUTION_SECRET").map_err(|_| bad("script_executor_unavailable"))?;
    if secret.len() < 32 {
        return Err(bad("script_executor_unavailable"));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(if path == "/sessions/delete" {180} else {35}))
        .build()
        .map_err(|_| bad("script_executor_unavailable"))?;
    let mut request = client
        .request(method, format!("{}{path}", base.trim_end_matches('/')))
        .header("x-execution-secret", secret);
    if let Some(body) = body {
        request = request.json(body)
    }
    let result = request
        .send()
        .await
        .map_err(|_| bad("script_executor_unavailable"))?;
    if !result.status().is_success() {
        if path == "/sessions/delete" {
            let status=result.status();
            let response:Value=result.json().await.unwrap_or_default();
            let message=response["error"].as_str().or_else(||response["message"].as_str()).unwrap_or_default();
            let code=match message {
                "session execution active"=>"session_cleanup_active",
                "session execution requires review"=>"session_cleanup_review_required",
                "session files busy"=>"session_cleanup_files_busy",
                "unreadable execution; deletion denied"=>"session_cleanup_unreadable_execution",
                "session identity unavailable"|"session identity conflict"|"invalid deletion path"|"invalid execution root"=>"session_cleanup_identity_conflict",
                _ if status==reqwest::StatusCode::UNAUTHORIZED || message=="execution authentication required"=>"session_cleanup_authentication_failed",
                _=>"session_cleanup_executor_rejected",
            };
            return Err(bad(code));
        }
        return Err(bad("script_executor_rejected"));
    }
    let result = result
        .bytes()
        .await
        .map_err(|_| bad("script_executor_unavailable"))?;
    if result.len() > 24 * 1024 * 1024 {
        return Err(bad("script_executor_result_limit"));
    }
    serde_json::from_slice(&result).map_err(|_| bad("script_executor_invalid_result"))
}

// Store immutable resource identities, never execution configuration values.
pub(super) fn freeze_skills(employee: &RuntimeAiEmployee) -> Result<Value, AppError> {
    let mut skills = vec![];
    for skill in &employee.skills {
        let mut definition =
            serde_json::to_value(skill).map_err(|_| bad("invalid skill definition"))?;
        definition
            .as_object_mut()
            .unwrap()
            .remove("environmentValues");
        let assets = if skill.package_path.is_empty() {
            vec![]
        } else {
            resources(skill)?
        };
        let hashes = assets
            .iter()
            .map(|r| json!([r["path"], r["sha256"]]))
            .collect::<Vec<_>>();
        skills.push(json!({"definition":definition,"resourceHash":fingerprint(&json!(hashes)),"configHash":fingerprint(&json!(skill.environment_values))}));
    }
    Ok(json!({"ruleVersion":1,"skills":skills}))
}
pub(super) fn frozen_employee(
    mut employee: RuntimeAiEmployee,
    snapshot: &Value,
) -> Result<RuntimeAiEmployee, AppError> {
    if snapshot["skill_resources"]["ruleVersion"] != 1 {
        if snapshot["employee_version"] != employee_version(&employee) {
            return Err(AppError::Forbidden(
                "employee content changed; submit a new task".into(),
            ));
        }
        return Ok(employee);
    }
    let frozen = snapshot["skill_resources"]["skills"]
        .as_array()
        .ok_or_else(|| bad("invalid frozen skill references"))?;
    let mut skills = vec![];
    for entry in frozen {
        let mut skill: crate::platform::license::PlatformAiEmployeeSkill =
            serde_json::from_value(entry["definition"].clone())
                .map_err(|_| bad("invalid frozen skill definition"))?;
        let current = employee
            .skills
            .iter()
            .find(|s| s.id == skill.id)
            .ok_or_else(|| {
                AppError::Forbidden("skill no longer assigned; submit a new task".into())
            })?;
        if entry["configHash"] != fingerprint(&json!(current.environment_values)) {
            return Err(AppError::Forbidden(
                "skill configuration changed; submit a new task".into(),
            ));
        }
        let assets = if skill.package_path.is_empty() {
            vec![]
        } else {
            resources(&skill)?
        };
        let hashes = assets
            .iter()
            .map(|r| json!([r["path"], r["sha256"]]))
            .collect::<Vec<_>>();
        if entry["resourceHash"] != fingerprint(&json!(hashes)) {
            return Err(AppError::Forbidden(
                "frozen skill resources changed; submit a new task".into(),
            ));
        }
        skill.environment_values = current.environment_values.clone();
        skills.push(skill);
    }
    employee.skills = skills;
    Ok(employee)
}
async fn invoke(
    State(state): State<AppState>,
    h: HeaderMap,
    Path(run): Path<Uuid>,
    Query(proof): Query<LeaseProof>,
    Json(input): Json<super::tools::ToolRequest>,
) -> Result<Json<Value>, AppError> {
    let sid = files::run_session(&state, &h, run, &proof).await?;
    let (scope, employee, _) = execution_subject(&state, &h, run, &proof).await?;
    let record = store(&state).run(run).await.map_err(map_store)?;
    let employee = frozen_employee(employee, &record["context_snapshot"])?;
    let call = input.call;
    let tool =
        yaya_agent_v2::tools::find(&call.name).ok_or_else(|| bad("unsupported skill tool"))?;
    if !yaya_agent_v2::tools::allowed(&employee.allowed_tools, &tool.id) {
        return Err(AppError::Forbidden(
            "skill tool no longer allowed by employee".into(),
        ));
    }
    if ![
        "skill_list_resources",
        "skill_read_resource",
        "skill_run_script",
        "workspace_execute_code",
    ]
    .contains(&tool.id.as_str())
    {
        return Err(bad("unsupported skill tool"));
    }
    yaya_agent_v2::tools::validate(&tool, &call.arguments).map_err(bad)?;
    if !record["context_snapshot"]["allowed_tools"]
        .as_array()
        .is_some_and(|a| a.iter().any(|v| v == &tool.id))
    {
        return Err(AppError::Forbidden(
            "skill tool outside task snapshot".into(),
        ));
    }
    let args = &call.arguments;
    let skill = match args["skillId"].as_str() {
        Some(skill_id) => Some(
            employee
                .skills
                .iter()
                .find(|s| s.id == skill_id)
                .ok_or_else(|| {
                    AppError::Forbidden("skill is not associated with this employee".into())
                })?,
        ),
        None => None,
    };
    if tool.id != "workspace_execute_code" && skill.is_none() {
        return Err(bad("skillId required"));
    }
    let mut assets = if let Some(s) = skill {
        resources(s)?
    } else {
        vec![]
    };
    if tool.id == "skill_list_resources" {
        for a in &mut assets {
            a.as_object_mut().unwrap().remove("data");
        }
        return Ok(Json(
            json!({"result":{"items":assets,"untrustedContent":true}}),
        ));
    }
    if tool.id == "skill_read_resource" {
        let path = args["path"].as_str().ok_or_else(|| bad("path required"))?;
        relative(path)?;
        let a = assets
            .iter()
            .find(|a| a["path"] == path)
            .ok_or_else(|| bad("skill resource missing"))?;
        let bytes = STANDARD
            .decode(a["data"].as_str().unwrap_or(""))
            .map_err(|_| bad("skill resource encoding"))?;
        let offset = args["offset"].as_u64().unwrap_or(0) as usize;
        let limit = args["limit"].as_u64().unwrap_or(16384).clamp(1, 32768) as usize;
        let result = if let Ok(text) = std::str::from_utf8(&bytes) {
            let start = offset.min(text.len());
            let mut end = (start + limit).min(text.len());
            let mut start = start;
            while start < text.len() && !text.is_char_boundary(start) {
                start += 1
            }
            while end > start && !text.is_char_boundary(end) {
                end -= 1
            }
            json!({"text":&text[start..end],"offset":start,"nextOffset":if end<text.len(){Some(end)}else{None},"size":bytes.len(),"untrustedContent":true})
        } else {
            json!({"binary":true,"size":bytes.len(),"path":path,"untrustedContent":true})
        };
        return Ok(Json(json!({"result":result})));
    }
    // Persist identity before contacting the execution service. Retries reuse exactly this id.
    if std::env::var("YAYA_AGENT_V2_EXECUTION_URL")
        .ok()
        .is_none_or(|s| s.trim().is_empty())
        || std::env::var("YAYA_EXECUTION_SECRET")
            .ok()
            .is_none_or(|s| s.len() < 32)
    {
        return Ok(Json(
            json!({"result":{"status":"failed","error":{"code":"script_executor_unavailable","message":"本地脚本执行服务未配置，尚未执行命令。"}}}),
        ));
    }
    let lease = Lease {
        run_id: run,
        session_id: sid,
        owner: proof.owner,
        epoch: proof.epoch,
        cancelled: false,
    };
    let hash = fingerprint(
        &json!({"tool":call.name,"arguments":args,"employeeVersion":record["context_snapshot"]["employee_version"]}),
    );
    let tx = store(&state)
        .fence(&lease, false)
        .await
        .map_err(map_store)?;
    let requested = args["timeoutSeconds"].as_u64().unwrap_or(600);
    if !(1..=7200).contains(&requested) {
        return Err(bad("timeoutSeconds must be 1..7200"));
    }
    let actual = requested as i32;
    let eid = Uuid::new_v4();
    let inserted=exec(&tx,"INSERT INTO agent_v2_executions(id,run_id,session_id,call_id,fingerprint,epoch,status,timeout_seconds,deadline_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'queued',$7,now()+make_interval(secs=>$7)) ON CONFLICT(run_id,call_id) DO NOTHING",vec![id(eid),id(run),id(sid),call.id.clone().into(),hash.clone().into(),proof.epoch.into(),actual.into()]).await.map_err(map_store)?;
    exec(&tx,"UPDATE agent_v2_executions SET timeout_seconds=600,deadline_at=created_at+interval '600 seconds' WHERE run_id=$1::uuid AND call_id=$2 AND timeout_seconds IS NULL",vec![id(run),call.id.clone().into()]).await.map_err(map_store)?;
    let old=rows(&tx,"SELECT (to_jsonb(e)||jsonb_build_object('deadlineUnixMs',(EXTRACT(EPOCH FROM deadline_at)*1000)::bigint))::text data FROM agent_v2_executions e WHERE run_id=$1::uuid AND call_id=$2 FOR UPDATE",vec![id(run),call.id.clone().into()]).await.map_err(map_store)?.remove(0);
    if old["fingerprint"] != hash {
        return Err(AppError::Conflict("execution fingerprint conflict".into()));
    }
    let eid = Uuid::parse_str(old["id"].as_str().unwrap_or(""))
        .map_err(|_| bad("invalid execution id"))?;
    if inserted == 1 {
        event(
            &tx,
            sid,
            Some(run),
            "execution.queued",
            json!({"executionId":eid,"callId":call.id,"status":"queued"}),
        )
        .await
        .map_err(map_store)?;
    }
    tx.commit().await?;
    if !["queued", "running"].contains(&old["status"].as_str().unwrap_or("")) {
        return Ok(Json(json!({"result":model_result(old["result"].clone())})));
    }
    let (language, script, script_path) = if tool.id == "skill_run_script" {
        let path = args["path"].as_str().ok_or_else(|| bad("path required"))?;
        relative(path)?;
        let language = if path.ends_with(".py") {
            "python"
        } else if path.ends_with(".js") || path.ends_with(".mjs") || path.ends_with(".cjs") {
            "node"
        } else if path.ends_with(".ps1") {
            "powershell"
        } else if path.ends_with(".sh") {
            "bash"
        } else {
            return Err(bad("unsupported script language"));
        };
        let script = assets
            .iter()
            .find(|a| a["path"] == path)
            .ok_or_else(|| bad("skill script missing"))?;
        let text = String::from_utf8(
            STANDARD
                .decode(script["data"].as_str().unwrap_or(""))
                .map_err(|_| bad("invalid script"))?,
        )
        .map_err(|_| bad("script must be UTF-8"))?;
        (language.to_owned(), text, path.to_owned())
    } else {
        (
            args["language"].as_str().unwrap_or("").to_owned(),
            args["code"].as_str().unwrap_or("").to_owned(),
            String::new(),
        )
    };
    let mut files = vec![];
    let mut total = 0;
    let file_ids = args["fileIds"].as_array().cloned().unwrap_or_default();
    if file_ids.len() > 200 {
        return Err(bad("input file limit"));
    }
    for fid in file_ids {
        let fid =
            Uuid::parse_str(fid.as_str().unwrap_or("")).map_err(|_| bad("invalid file id"))?;
        let f = files::load(&state.db, sid, fid).await?;
        total += f["size"].as_u64().unwrap_or(0);
        if total > 24 * 1024 * 1024 {
            return Err(bad("execution input limit"));
        }
        files.push(json!({"path":format!("{fid}/{}",f["name"].as_str().unwrap_or("file")),"data":f["data"].as_str().unwrap_or("").replace(['\n','\r'],"")}));
    }
    let environment = skill
        .map(|s| s.environment_values.clone())
        .unwrap_or_default();
    let version=skill.map(|s|fingerprint(&json!({"id":s.id,"version":s.version,"resources":assets.iter().map(|a|json!([a["path"],a["sha256"]])).collect::<Vec<_>>(),"config":s.environment_values}))).unwrap_or("base-v1".into());
    let arguments = args["arguments"].as_array().cloned().unwrap_or_default();
    if arguments.iter().any(|v| !v.is_string()) {
        return Err(bad("script arguments must be strings"));
    }
    let request = json!({"scope":{"deploymentId":scope.tenant_id,"userId":scope.user_id,"employeeId":employee.id,"sessionId":sid},"id":eid,"epoch":proof.epoch,"timeoutSeconds":old["timeout_seconds"].as_i64().unwrap_or(600),"deadlineUnixMs":old["deadlineUnixMs"].as_i64().unwrap_or(0),"language":language,"script":script,"scriptPath":script_path,"arguments":arguments,"files":files,"resources":assets.iter().map(|a|json!({"path":a["path"],"data":a["data"]})).collect::<Vec<_>>(),"environment":environment,"version":version});
    let response = service(reqwest::Method::POST, "/executions", Some(&request)).await?;
    let status = response["status"].as_str().unwrap_or("outcome_unknown");
    let pending = ["queued", "running"].contains(&status);
    // Recheck identity/permission after remote work, then fence all publication.
    files::run_session(&state, &h, run, &proof).await?;
    let tx = store(&state)
        .fence(&lease, false)
        .await
        .map_err(map_store)?;
    let latest = rows(
        &tx,
        "SELECT row_to_json(e)::text data FROM agent_v2_executions e WHERE id=$1::uuid FOR UPDATE",
        vec![id(eid)],
    )
    .await
    .map_err(map_store)?
    .remove(0);
    if !["queued", "running"].contains(&latest["status"].as_str().unwrap_or("")) {
        return Ok(Json(
            json!({"result":model_result(latest["result"].clone())}),
        ));
    }
    let mut result = response["result"].clone();
    if !pending {
        let artifacts = result
            .as_object_mut()
            .and_then(|r| r.remove("artifacts"))
            .unwrap_or(json!([]));
        let mut output = vec![];
        if let Some(items) = artifacts.as_array() {
            if items.len() > 8 {
                return Err(bad("output file limit"));
            }
            let mut total = 0;
            for item in items {
                let path = item["path"]
                    .as_str()
                    .ok_or_else(|| bad("invalid artifact path"))?;
                relative(path)?;
                let bytes = STANDARD
                    .decode(item["data"].as_str().unwrap_or(""))
                    .map_err(|_| bad("invalid artifact"))?;
                total += bytes.len();
                if total > 16 * 1024 * 1024 {
                    return Err(bad("output size limit"));
                }
                let digest = Sha256::digest(format!("{eid}/{path}").as_bytes());
                let mut uid = [0u8; 16];
                uid.copy_from_slice(&digest[..16]);
                let fid = Uuid::from_bytes(uid);
                let name = path.rsplit('/').next().unwrap_or("output");
                output.push(
                    files::save_artifact(
                        &tx,
                        sid,
                        fid,
                        name,
                        &bytes,
                        Some(run),
                        Some(&call.id),
                        path,
                    )
                    .await?,
                );
            }
        }
        if !result.is_object() {
            result = json!({})
        }
        result["executionId"] = json!(eid);
        result["status"] = json!(status);
        result["files"] = json!(output);
        result["untrustedContent"] = json!(true);
    }
    exec(&tx,"UPDATE agent_v2_executions SET status=$2,result=$3,epoch=$4,updated_at=now() WHERE id=$1::uuid",vec![id(eid),status.into(),if pending{Value::Null}else{result.clone()}.into(),proof.epoch.into()]).await.map_err(map_store)?;
    if latest["status"] != status {
        event(&tx,sid,Some(run),&format!("execution.{status}"),json!({"executionId":eid,"callId":call.id,"status":status,"result":if pending{Value::Null}else{result.clone()}})).await.map_err(map_store)?;
    }
    tx.commit().await?;
    if pending {
        Ok(Json(
            json!({"executionId":eid,"executionPending":true,"status":status}),
        ))
    } else {
        // Keep the model response bounded; the full safe log remains queryable.
        Ok(Json(json!({"result":model_result(result)})))
    }
}

fn model_result(mut result: Value) -> Value {
    for key in ["stdout", "stderr"] {
        if let Some(text) = result[key].as_str() {
            let shortened = text.chars().take(4096).collect::<String>();
            if shortened.len() < text.len() {
                result["logsMayBeTruncated"] = json!(true);
            }
            result[key] = json!(shortened);
        }
    }
    result
}

pub(crate) fn start_cleanup(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Ok(items)=rows(&state.db,"SELECT jsonb_build_object('id',e.id,'epoch',e.epoch,'sessionId',e.session_id,'runId',e.run_id)::text data FROM agent_v2_executions e JOIN agent_v2_runs r ON r.id=e.run_id WHERE e.status IN ('queued','running') AND e.stop_confirmed_at IS NULL AND r.status IN ('cancel_requested','cancelled','failed','completed','paused')",vec![]).await{
        for item in items {
            let Some(eid)=item["id"].as_str() else {continue};
            let Ok(value)=service(reqwest::Method::POST,&format!("/executions/{eid}/cancel"),Some(&json!({"epoch":item["epoch"]}))).await else {continue};
            if value["stopConfirmed"]!=true {continue}
            let remote=value["status"].as_str().unwrap_or("");
            if !["succeeded","failed","timed_out","cancelled","outcome_unknown"].contains(&remote){continue}
            let _:Result<(),AppError>=async {
                let sid=Uuid::parse_str(item["sessionId"].as_str().unwrap_or("")).map_err(|_|bad("invalid execution session"))?;
                let run=Uuid::parse_str(item["runId"].as_str().unwrap_or("")).map_err(|_|bad("invalid execution run"))?;
                let tx=state.db.begin().await?;
                rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_sessions WHERE id=$1::uuid FOR UPDATE",vec![id(sid)]).await.map_err(map_store)?;
                let parent=rows(&tx,"SELECT jsonb_build_object('status',status)::text data FROM agent_v2_runs WHERE id=$1::uuid FOR UPDATE",vec![id(run)]).await.map_err(map_store)?.remove(0);
                if !["cancel_requested","cancelled","failed","completed","paused"].iter().any(|s|parent["status"]==*s){return Ok(())}
                let paused=parent["status"]=="paused";
                // A stopped script may have completed before the pause. Keep its frozen
                // invocation pending so the next owner publishes the original result.
                let status=if paused && remote!="outcome_unknown" {"running"}else if paused{"outcome_unknown"}else{"cancelled"};
                let result=if remote=="outcome_unknown"{json!({"status":"outcome_unknown","error":{"code":"execution_outcome_unknown"}})}else{json!({"status":"cancelled","remoteStatus":remote})};
                let updated=rows(&tx,"UPDATE agent_v2_executions SET status=$2,result=CASE WHEN $3 THEN result ELSE $4 END,stop_confirmed_at=now(),updated_at=now() WHERE id=$1::uuid AND status IN ('queued','running') AND stop_confirmed_at IS NULL RETURNING jsonb_build_object('callId',call_id)::text data",vec![eid.into(),status.into(),(paused&&remote!="outcome_unknown").into(),js(result.clone())]).await.map_err(map_store)?;
                if let Some(record)=updated.first(){
                    exec(&tx,"UPDATE agent_v2_runs SET active_ms=active_ms+COALESCE((EXTRACT(EPOCH FROM(now()-active_since))*1000)::bigint,0),active_since=NULL WHERE id=$1::uuid AND status IN ('paused','cancelled') AND NOT EXISTS(SELECT 1 FROM agent_v2_executions WHERE run_id=$1::uuid AND status IN ('queued','running') AND stop_confirmed_at IS NULL)",vec![id(run)]).await.map_err(map_store)?;
                    if paused&&remote=="outcome_unknown" {
                        exec(&tx,"UPDATE agent_v2_runs SET status='manual_review',pause_reason='outcome_unknown' WHERE id=$1::uuid",vec![id(run)]).await.map_err(map_store)?;
                        event(&tx,sid,Some(run),"run.manual_review",json!({"reason":"outcome_unknown"})).await.map_err(map_store)?;
                    }
                    event(&tx,sid,Some(run),if paused{"execution.stopped"}else{"execution.cancelled"},json!({"executionId":eid,"callId":record["callId"],"status":remote})).await.map_err(map_store)?;
                }
                tx.commit().await?;Ok(())
            }.await;
        }
    }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_resource_escapes() {
        for s in ["../secret", "/etc/passwd", "a\\b", "C:/a", "a//b"] {
            assert!(relative(s).is_err());
        }
        assert!(relative("templates/book.xlsx").is_ok());
    }
}

#[cfg(test)]
mod frozen_tests {
    use super::*;
    #[test]
    fn frozen_resources_survive_employee_metadata_update_without_freezing_secrets() {
        let skill = crate::platform::license::PlatformAiEmployeeSkill {
            id: "sample".into(),
            title: "sample".into(),
            package_name: String::new(),
            source: String::new(),
            version: "v1".into(),
            package_path: String::new(),
            description: String::new(),
            instructions: "read then execute".into(),
            environment_values: std::collections::BTreeMap::from([(
                "TOKEN".into(),
                "secret-test-only".into(),
            )]),
            plugin_manifest_json: String::new(),
        };
        let employee = RuntimeAiEmployee {
            id: "employee".into(),
            title: "old".into(),
            description: String::new(),
            system_prompt: "old prompt".into(),
            skills: vec![skill],
            allowed_tools: vec!["workspace_execute_code".into()],
            application_ids: vec![],
            avatar_url: None,
        };
        let frozen = freeze_skills(&employee).unwrap();
        assert!(!frozen.to_string().contains("secret-test-only"));
        let snapshot =
            json!({"employee_version":employee_version(&employee),"skill_resources":frozen});
        let mut updated = employee.clone();
        updated.title = "new title".into();
        updated.skills[0].version = "v2".into();
        let resolved = frozen_employee(updated.clone(), &snapshot).unwrap();
        assert_eq!(resolved.skills[0].version, "v1");
        assert_eq!(
            resolved.skills[0].environment_values["TOKEN"],
            "secret-test-only"
        );
        updated.skills[0]
            .environment_values
            .insert("TOKEN".into(), "changed".into());
        assert!(frozen_employee(updated.clone(), &snapshot).is_err());
        updated.skills.clear();
        assert!(frozen_employee(updated, &snapshot).is_err());
    }
}
