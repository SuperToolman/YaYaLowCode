//! Current-account local execution. Session directories are NOT an OS security sandbox.
use anyhow::{Context, Result, bail};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;
mod local;
mod process;
#[cfg(test)]
mod tests;
#[derive(Clone)]
struct Manager {
    root: PathBuf,
    secret: String,
    gate: Arc<Mutex<()>>,
    slots: Arc<Semaphore>,
    sessions: Arc<Mutex<BTreeMap<String, Arc<Mutex<()>>>>>,
    children: Arc<Mutex<BTreeMap<Uuid, u32>>>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    deployment_id: Uuid,
    user_id: Uuid,
    employee_id: String,
    session_id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: Uuid,
    epoch: i64,
    scope: Scope,
    language: String,
    script: String,
    #[serde(rename = "scriptPath")]
    script_path: String,
    arguments: Vec<String>,
    files: Vec<Asset>,
    resources: Vec<Asset>,
    environment: BTreeMap<String, String>,
    version: String,
    #[serde(rename = "timeoutSeconds", default = "default_timeout")]
    timeout_seconds: u64,
    #[serde(rename = "deadlineUnixMs", default)]
    deadline_unix_ms: u64,
}
fn default_timeout() -> u64 {
    600
}
fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: String,
    data: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Job {
    id: Uuid,
    epoch: i64,
    fingerprint: String,
    status: String,
    result: Value,
    #[serde(default)]
    scope: Option<Scope>,
    #[serde(default)]
    timeout_seconds: u64,
    #[serde(default)]
    deadline_unix_ms: u64,
}
type HttpResult = std::result::Result<Json<Value>, (StatusCode, Json<Value>)>;
fn reject(code: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (code, Json(json!({"error":message})))
}
fn auth(m: &Manager, h: &HeaderMap) -> std::result::Result<(), (StatusCode, Json<Value>)> {
    if h.get("x-execution-secret").and_then(|v| v.to_str().ok()) != Some(m.secret.as_str()) {
        return Err(reject(
            StatusCode::FORBIDDEN,
            "execution authentication required",
        ));
    }
    Ok(())
}
fn job_dir(m: &Manager, id: Uuid) -> PathBuf {
    m.root.join(id.to_string())
}
fn write_job(m: &Manager, j: &Job) -> Result<()> {
    let dir = job_dir(m, j.id);
    std::fs::create_dir_all(&dir)?;
    let temp = dir.join("job.tmp");
    std::fs::write(&temp, serde_json::to_vec(j)?)?;
    std::fs::rename(temp, dir.join("job.json"))?;
    Ok(())
}
fn read_job(m: &Manager, id: Uuid) -> Result<Job> {
    Ok(serde_json::from_slice(&std::fs::read(
        job_dir(m, id).join("job.json"),
    )?)?)
}
async fn session_gate(m: &Manager, scope: &Scope) -> Arc<Mutex<()>> {
    m.sessions
        .lock()
        .await
        .entry(local::scope_key(scope))
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}
async fn submit(State(m): State<Manager>, h: HeaderMap, Json(req): Json<Request>) -> HttpResult {
    auth(&m, &h)?;
    validate(&req).map_err(|_| reject(StatusCode::BAD_REQUEST, "invalid execution request"))?;
    let _g = m.gate.lock().await;
    if m.root.join("deleted-sessions").join(local::scope_key(&req.scope)).exists() {
        return Err(reject(StatusCode::CONFLICT,"session permanently deleted"));
    }
    let hash = fingerprint(&req);
    if job_dir(&m, req.id).exists() {
        let mut j = read_job(&m, req.id).map_err(|_| {
            reject(
                StatusCode::INTERNAL_SERVER_ERROR,
                "execution state unreadable; do not replay",
            )
        })?;
        let legacy = j.timeout_seconds == 0 && j.fingerprint == execution_fingerprint(&req, false);
        if req.epoch < j.epoch
            || (j.fingerprint != hash && !legacy)
            || j.scope.as_ref() != Some(&req.scope)
        {
            return Err(reject(StatusCode::CONFLICT, "execution identity conflict"));
        }
        if legacy && ["queued", "running"].contains(&j.status.as_str()) {
            j.status = "outcome_unknown".into();
            j.result = json!({"status":"outcome_unknown","error":{"code":"legacy_execution_requires_review"}});
        }
        j.epoch = req.epoch;
        write_job(&m, &j).map_err(|_| {
            reject(
                StatusCode::INTERNAL_SERVER_ERROR,
                "execution persistence failed",
            )
        })?;
        return Ok(Json(json!({"id":j.id,"status":j.status,"result":j.result})));
    }
    let j = Job {
        id: req.id,
        epoch: req.epoch,
        fingerprint: hash,
        timeout_seconds: req.timeout_seconds,
        deadline_unix_ms: req.deadline_unix_ms,
        status: "queued".into(),
        result: Value::Null,
        scope: Some(req.scope.clone()),
    };
    write_job(&m, &j).map_err(|_| {
        reject(
            StatusCode::INTERNAL_SERVER_ERROR,
            "execution persistence failed",
        )
    })?;
    drop(_g);
    let response = json!({"id":j.id,"status":j.status});
    tokio::spawn(async move {
        let gate = session_gate(&m, &req.scope).await;
        let _session = gate.lock().await;
        let _slot = m.slots.acquire().await;
        if let Err(error) = local::run(&m, &req).await {
            // Static errors never print arbitrary child output or Skill configuration.
            let code = if error.to_string().starts_with("interpreter_unavailable") {
                "interpreter_unavailable"
            } else {
                "execution_outcome_unknown"
            };
            finish(&m,req.id,if code=="interpreter_unavailable"{"failed"}else{"outcome_unknown"},json!({"error":{"code":code,"message":"本地执行未能确认完成；检查解释器与执行日志，不得自动重放不确定调用。"}})).await;
        }
        m.children.lock().await.remove(&req.id);
    });
    Ok(Json(response))
}
async fn query(State(m): State<Manager>, h: HeaderMap, Path(id): Path<Uuid>) -> HttpResult {
    auth(&m, &h)?;
    let _g = m.gate.lock().await;
    let j = read_job(&m, id).map_err(|_| reject(StatusCode::NOT_FOUND, "execution not found"))?;
    Ok(Json(json!({"id":j.id,"status":j.status,"result":j.result})))
}
#[derive(Deserialize)]
struct Epoch {
    epoch: i64,
}
async fn cancel(
    State(m): State<Manager>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Json(e): Json<Epoch>,
) -> HttpResult {
    auth(&m, &h)?;
    let _g = m.gate.lock().await;
    let mut j =
        read_job(&m, id).map_err(|_| reject(StatusCode::NOT_FOUND, "execution not found"))?;
    if e.epoch < j.epoch {
        return Err(reject(StatusCode::CONFLICT, "stale execution epoch"));
    }
    if !["queued", "running"].contains(&j.status.as_str()) {
        let stopped = !m.children.lock().await.contains_key(&id);
        return Ok(Json(
            json!({"id":id,"status":j.status,"result":j.result,"stopConfirmed":stopped}),
        ));
    }
    j.epoch = e.epoch;
    j.status = "cancelled".into();
    j.result = json!({"error":{"code":"execution_cancelled"}});
    write_job(&m, &j).map_err(|_| {
        reject(
            StatusCode::INTERNAL_SERVER_ERROR,
            "execution persistence failed",
        )
    })?;
    if let Some(pid) = m.children.lock().await.get(&id).copied() {
        process::terminate(pid).await;
    }
    let stopped = !m.children.lock().await.contains_key(&id);
    Ok(Json(
        json!({"id":id,"status":"cancelled","stopConfirmed":stopped}),
    ))
}
async fn finish(m: &Manager, id: Uuid, status: &str, result: Value) {
    let _g = m.gate.lock().await;
    if let Ok(mut j) = read_job(m, id) {
        if ["queued", "running"].contains(&j.status.as_str()) {
            j.status = status.into();
            j.result = result;
            let _ = write_job(m, &j);
        }
    }
}
#[derive(Default, Deserialize)]
struct LogQuery {
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    stream: Option<String>,
}
async fn logs(
    State(m): State<Manager>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<LogQuery>,
) -> HttpResult {
    auth(&m, &h)?;
    let j = read_job(&m, id).map_err(|_| reject(StatusCode::NOT_FOUND, "execution not found"))?;
    let value = local::read_logs(&m, id);
    let stream = q.stream.as_deref().unwrap_or("stdout");
    if !["stdout", "stderr"].contains(&stream) {
        return Err(reject(StatusCode::BAD_REQUEST, "invalid log stream"));
    }
    let text = value[stream].as_str().unwrap_or("");
    let start = q.offset.min(text.len());
    let mut start = start;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    let mut end = (start + 16384).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Ok(Json(
        json!({"text":&text[start..end],"nextOffset":end,"truncated":value["truncated"]==true,"done":!["queued","running"].contains(&j.status.as_str())&&end==text.len()}),
    ))
}
async fn reset(State(m): State<Manager>, h: HeaderMap, Json(scope): Json<Scope>) -> HttpResult {
    auth(&m, &h)?;
    let gate = session_gate(&m, &scope).await;
    let _session = gate
        .try_lock()
        .map_err(|_| reject(StatusCode::CONFLICT, "session execution active"))?;
    let _g = m.gate.lock().await;
    for entry in std::fs::read_dir(&m.root)
        .map_err(|_| reject(StatusCode::INTERNAL_SERVER_ERROR, "state unavailable"))?
    {
        let entry =
            entry.map_err(|_| reject(StatusCode::INTERNAL_SERVER_ERROR, "state unavailable"))?;
        if let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) {
            let j = read_job(&m, id)
                .map_err(|_| reject(StatusCode::CONFLICT, "unreadable execution; reset denied"))?;
            if j.scope.as_ref() == Some(&scope)
                && ["queued", "running"].contains(&j.status.as_str())
            {
                return Err(reject(StatusCode::CONFLICT, "session execution active"));
            }
        }
    }
    let dir = local::session_root(&m, &scope);
    if dir.exists() {
        let resolved = std::fs::canonicalize(&dir)
            .map_err(|_| reject(StatusCode::CONFLICT, "invalid session directory"))?;
        let allowed = std::fs::canonicalize(m.root.join("sessions"))
            .map_err(|_| reject(StatusCode::CONFLICT, "invalid session directory"))?;
        if !resolved.starts_with(&allowed) || resolved == allowed {
            return Err(reject(StatusCode::CONFLICT, "invalid session directory"));
        }
        let identity: Scope = std::fs::read(resolved.join("scope.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| reject(StatusCode::CONFLICT, "session identity unavailable"))?;
        if identity != scope {
            return Err(reject(StatusCode::CONFLICT, "session identity conflict"));
        }
        std::fs::remove_dir_all(resolved)
            .map_err(|_| reject(StatusCode::CONFLICT, "session environment busy"))?;
    }
    Ok(Json(json!({"reset":true})))
}
// Authenticated, idempotent purge. A tombstone prevents late execution replay.
async fn delete_session(State(m): State<Manager>, h: HeaderMap, Json(scope): Json<Scope>) -> HttpResult {
    auth(&m,&h)?;
    let gate=session_gate(&m,&scope).await;
    let session_guard=gate.try_lock_owned().map_err(|_|reject(StatusCode::CONFLICT,"session execution active"))?;
    let _g=m.gate.lock().await;
    let mut jobs=Vec::new();
    for entry in std::fs::read_dir(&m.root).map_err(|_|reject(StatusCode::INTERNAL_SERVER_ERROR,"state unavailable"))? {
        let entry=entry.map_err(|_|reject(StatusCode::INTERNAL_SERVER_ERROR,"state unavailable"))?;
        if let Ok(id)=Uuid::parse_str(&entry.file_name().to_string_lossy()) {
            let j=read_job(&m,id).map_err(|_|reject(StatusCode::CONFLICT,"unreadable execution; deletion denied"))?;
            if j.scope.as_ref()==Some(&scope) {
                if ["queued","running","outcome_unknown"].contains(&j.status.as_str()) || m.children.lock().await.contains_key(&id) {
                    return Err(reject(StatusCode::CONFLICT,"session execution requires review"));
                }
                jobs.push(job_dir(&m,id));
            }
        }
    }
    let tombstones=m.root.join("deleted-sessions");
    std::fs::create_dir_all(&tombstones).map_err(|_|reject(StatusCode::INTERNAL_SERVER_ERROR,"deletion state unavailable"))?;
    std::fs::write(tombstones.join(local::scope_key(&scope)),b"deleted").map_err(|_|reject(StatusCode::INTERNAL_SERVER_ERROR,"deletion state unavailable"))?;
    // Detach execution directories under the metadata gate. Otherwise another
    // session's scanner can read a half-deleted job and reject its own cleanup.
    // This is an in-place deletion staging area, not a retained backup.
    let cleanup_dir=tombstones.join(format!("{}.cleanup",local::scope_key(&scope)));
    if cleanup_dir.exists() && std::fs::symlink_metadata(&cleanup_dir).map_err(|_|reject(StatusCode::CONFLICT,"invalid deletion path"))?.file_type().is_symlink(){return Err(reject(StatusCode::CONFLICT,"invalid deletion path"));}
    std::fs::create_dir_all(&cleanup_dir).map_err(|_|reject(StatusCode::CONFLICT,"session files busy"))?;
    for path in &jobs {
        let metadata=std::fs::symlink_metadata(path).map_err(|_|reject(StatusCode::CONFLICT,"invalid deletion path"))?;
        if metadata.file_type().is_symlink(){return Err(reject(StatusCode::CONFLICT,"invalid deletion path"));}
        let target=cleanup_dir.join(path.file_name().ok_or_else(||reject(StatusCode::CONFLICT,"invalid deletion path"))?);
        std::fs::rename(path,target).map_err(|_|reject(StatusCode::CONFLICT,"session files busy"))?;
    }
    let jobs=vec![cleanup_dir];
    let session=local::session_root(&m,&scope);
    // Publish the tombstone under the manager gate, then release the global gate.
    // Retain only this session lock while blocking filesystem cleanup runs.
    drop(_g);
    tokio::task::spawn_blocking(move || {
    let _session=session_guard;
    for path in std::iter::once(session).chain(jobs) {
        if !path.exists(){continue;}
        let resolved=std::fs::canonicalize(&path).map_err(|_|reject(StatusCode::CONFLICT,"invalid deletion path"))?;
        let allowed=std::fs::canonicalize(&m.root).map_err(|_|reject(StatusCode::CONFLICT,"invalid execution root"))?;
        if !resolved.starts_with(&allowed) || resolved==allowed || std::fs::symlink_metadata(&path).map_err(|_|reject(StatusCode::CONFLICT,"invalid deletion path"))?.file_type().is_symlink() {
            return Err(reject(StatusCode::CONFLICT,"invalid deletion path"));
        }
        if path.starts_with(m.root.join("sessions")) {
            let identity:Scope=std::fs::read(resolved.join("scope.json")).ok().and_then(|v|serde_json::from_slice(&v).ok()).ok_or_else(||reject(StatusCode::CONFLICT,"session identity unavailable"))?;
            if identity!=scope{return Err(reject(StatusCode::CONFLICT,"session identity conflict"));}
        }
        std::fs::remove_dir_all(resolved).map_err(|_|reject(StatusCode::CONFLICT,"session files busy"))?;
    }
    Ok(Json(json!({"deleted":true})))
    }).await.map_err(|_|reject(StatusCode::INTERNAL_SERVER_ERROR,"session cleanup interrupted"))?
}
async fn health() -> Json<Value> {
    Json(local::health().await)
}
#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(unix)]
    if std::env::args().nth(1).as_deref() == Some("--local-supervisor") {
        process::supervise();
    }
    let root = std::env::var("YAYA_EXECUTION_ROOT").unwrap_or("runtime/executions".into());
    std::fs::create_dir_all(&root)?;
    let root = std::fs::canonicalize(root)?;
    // Node's entry-point resolver cannot consume Rust's Windows verbatim drive paths.
    #[cfg(windows)]
    let root = {
        let value = root.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{unc}"))
        } else if let Some(drive) = value.strip_prefix(r"\\?\") {
            PathBuf::from(drive)
        } else {
            root
        }
    };
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("manager.lock"))?;
    lock.try_lock()
        .context("another manager owns this execution root")?;
    let secret = std::env::var("YAYA_EXECUTION_SECRET").context("execution secret required")?;
    if secret.len() < 32 {
        bail!("execution secret too short")
    }
    let m = Manager {
        root,
        secret,
        gate: Arc::new(Mutex::new(())),
        slots: Arc::new(Semaphore::new(2)),
        sessions: Default::default(),
        children: Default::default(),
    };
    for entry in std::fs::read_dir(&m.root)? {
        let entry = entry?;
        if let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) {
            let j =
                read_job(&m, id).context("unreadable prior execution; manager startup stopped")?;
            if ["queued", "running"].contains(&j.status.as_str()) {
                finish(&m,id,"outcome_unknown",json!({"error":{"code":"execution_outcome_unknown","message":"执行服务已重启，不自动重复命令。"}})).await;
            }
        }
    }
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/executions", post(submit))
        .route("/executions/{id}", get(query))
        .route("/executions/{id}/logs", get(logs))
        .route("/executions/{id}/cancel", post(cancel))
        .route("/sessions/reset", post(reset))
        .route("/sessions/delete", post(delete_session))
        .layer(DefaultBodyLimit::max(96 * 1024 * 1024))
        .with_state(m);
    let bind = std::env::var("YAYA_EXECUTION_BIND").unwrap_or("127.0.0.1:8791".into());
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    drop(lock);
    Ok(())
}

fn relative(value: &str) -> Result<PathBuf> {
    if value.is_empty()
        || value.len() > 240
        || value.contains(['\\', ':', '\0'])
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        bail!("invalid relative path")
    }
    Ok(PathBuf::from(value))
}
fn valid_env(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    let name = upper.as_str();
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .enumerate()
            .all(|(i, c)| c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
        && ![
            "PATH",
            "HOME",
            "TMPDIR",
            "NODE_OPTIONS",
            "NODE_PATH",
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHONUSERBASE",
            "VIRTUAL_ENV",
            "BASH_ENV",
            "ENV",
            "COMSPEC",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
            "DOCKER_HOST",
            "HOSTNAME",
        ]
        .contains(&name)
        && !name.starts_with("YAYA_")
}

fn validate(req: &Request) -> Result<()> {
    if !(1..=7200).contains(&req.timeout_seconds) {
        bail!("invalid execution timeout")
    }
    if !["python", "node", "bash", "powershell", "shell"].contains(&req.language.as_str())
        || req.scope.employee_id.is_empty()
        || req.scope.employee_id.len() > 256
        || req.script.is_empty()
        || req.script.len() > 128 * 1024
        || req.epoch < 1
        || req.version.is_empty()
    {
        bail!("invalid execution")
    }
    if !req.script_path.is_empty() {
        relative(&req.script_path)?;
    }
    if req.arguments.len() > 64
        || req
            .arguments
            .iter()
            .any(|s| s.len() > 4096 || s.contains('\0'))
    {
        bail!("invalid arguments")
    }
    if req.environment.len() > 64
        || req
            .environment
            .iter()
            .any(|(k, v)| !valid_env(k) || v.len() > 16384 || v.contains(['\n', '\r', '\0']))
    {
        bail!("invalid skill environment")
    }
    if req.files.len() > 200 || req.resources.len() > 1000 {
        bail!("too many assets")
    }
    let mut bytes = 0usize;
    let mut paths = std::collections::HashSet::new();
    for (group, assets) in [("input", &req.files), ("skill", &req.resources)] {
        for a in assets {
            relative(&a.path)?;
            if !paths.insert(format!("{group}/{}", a.path)) {
                bail!("duplicate asset")
            }
            bytes = bytes
                .checked_add(STANDARD.decode(&a.data)?.len())
                .context("asset limit")?;
        }
    }
    if bytes > 64 * 1024 * 1024 {
        bail!("asset limit")
    };
    Ok(())
}
fn fingerprint(req: &Request) -> String {
    execution_fingerprint(req, true)
}
fn execution_fingerprint(req: &Request, timeout: bool) -> String {
    let mut h = Sha256::new();
    for s in [&req.language, &req.script, &req.version] {
        h.update((s.len() as u64).to_le_bytes());
        h.update(s)
    }
    if timeout {
        h.update(req.timeout_seconds.to_le_bytes());
        h.update(req.deadline_unix_ms.to_le_bytes());
    }
    h.update(serde_json::to_vec(&req.arguments).unwrap());
    for assets in [&req.files, &req.resources] {
        for a in assets {
            h.update(a.path.as_bytes());
            h.update([0]);
            h.update(a.data.as_bytes());
            h.update([0]);
        }
    }
    h.update(serde_json::to_vec(&req.scope).unwrap());
    h.update(req.script_path.as_bytes());
    h.update(serde_json::to_vec(&req.environment).unwrap());
    format!("{:x}", h.finalize())
}

fn validate_outputs(items: &[Value], secrets: &[String]) -> Result<()> {
    if items.len() > 8 {
        bail!("output count")
    }
    let mut total = 0usize;
    let mut paths = std::collections::HashSet::new();
    for item in items {
        let path = item["path"].as_str().context("output path")?;
        relative(path)?;
        if path.split('/').count() > 8 || !paths.insert(path) {
            bail!("output path limit")
        }
        let data = STANDARD.decode(item["data"].as_str().context("output data")?)?;
        total += data.len();
        if data.is_empty() || data.len() > 8 * 1024 * 1024 || total > 16 * 1024 * 1024 {
            bail!("output size limit")
        }
        if secrets
            .iter()
            .filter(|s| !s.is_empty())
            .any(|s| data.windows(s.len()).any(|w| w == s.as_bytes()))
        {
            bail!("output contains configuration")
        }
    }
    Ok(())
}
