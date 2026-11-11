//! Persistent current-account environments. Paths separate sessions; they do not confine hostile code.
use super::*;
const LOG_LIMIT: usize = 1024 * 1024;
pub(super) fn scope_key(scope: &Scope) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(scope).unwrap()))
}
pub(super) fn session_root(m: &Manager, s: &Scope) -> PathBuf {
    // Short components keep Windows venv/site-packages paths below legacy path limits.
    let short = |value: &str| format!("{:x}", Sha256::digest(value.as_bytes()))[..16].to_string();
    m.root
        .join("sessions")
        .join(short(&s.deployment_id.to_string()))
        .join(short(&s.user_id.to_string()))
        .join(short(&s.employee_id))
        .join(s.session_id.simple().to_string())
}
fn executable(name: &str) -> Option<PathBuf> {
    let file = FsPath::new(name);
    if file.is_absolute() && file.is_file() {
        return Some(file.to_path_buf());
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        #[cfg(windows)]
        let suffixes = [".exe", ".cmd", ".bat", ""];
        #[cfg(not(windows))]
        let suffixes = [""];
        for suffix in suffixes {
            let file = dir.join(format!("{name}{suffix}"));
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}
fn interpreter(language: &str) -> Result<PathBuf> {
    let (key, names): (&str, &[&str]) = match language {
        "python" => (
            "YAYA_EXECUTION_PYTHON",
            if cfg!(windows) {
                &["python"]
            } else {
                &["python3", "python"]
            },
        ),
        "node" => ("YAYA_EXECUTION_NODE", &["node"]),
        "powershell" => ("YAYA_EXECUTION_SHELL", &["pwsh", "powershell"]),
        "bash" => ("YAYA_EXECUTION_BASH", &["bash"]),
        "shell" => return interpreter(if cfg!(windows) { "powershell" } else { "bash" }),
        _ => bail!("interpreter_unavailable: unsupported language"),
    };
    if let Ok(value) = std::env::var(key) {
        return executable(&value)
            .context("interpreter_unavailable: configured executable missing");
    }
    names
        .iter()
        .find_map(|name| executable(name))
        .context("interpreter_unavailable: executable missing")
}
pub(super) async fn health() -> Value {
    let mut values = serde_json::Map::new();
    for name in ["python", "node", "shell"] {
        let check = async {
            let program = interpreter(name)?;
            let mut probe = Command::new(program);
            probe
                .env_clear()
                .envs(base_environment())
                .kill_on_drop(true)
                .stdin(std::process::Stdio::null());
            if name == "shell" && cfg!(windows) {
                probe.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$PSVersionTable.PSVersion.ToString()",
                ]);
            } else {
                probe.arg("--version");
            }
            let output = tokio::time::timeout(Duration::from_secs(2), probe.output()).await??;
            if !output.status.success() {
                bail!("interpreter probe failed")
            }
            Ok::<_, anyhow::Error>(
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .chars()
                    .take(128)
                    .collect::<String>(),
            )
        }
        .await;
        values.insert(name.into(), match check {
            Ok(version)=>json!({"available":true,"version":version}),
            Err(_)=>json!({"available":false,"diagnostic":"interpreter missing or version probe failed"})
        });
    }
    json!({"ready":true,"executionProtocol":2,"backend":"local","systemIsolation":false,"interpreters":values})
}
fn base_environment() -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.into(), value);
        }
    }
    env
}
fn command(program: &FsPath) -> Command {
    #[cfg(any(not(unix), test))]
    let mut c = Command::new(program);
    #[cfg(all(unix, not(test)))]
    let mut c = {
        let mut wrapper = Command::new(std::env::current_exe().expect("executor executable"));
        wrapper.arg("--local-supervisor").arg(program);
        wrapper
    };
    c.env_clear()
        .envs(base_environment())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // EOF signals manager death to the independent group watchdog on Linux.
    #[cfg(unix)]
    c.stdin(std::process::Stdio::piped());
    process::configure(&mut c);
    c
}

fn powershell_launcher(workspace: &FsPath) -> Result<PathBuf> {
    let launcher = workspace.join("__yaya_powershell_launcher.ps1");
    let script = br#"param([string]$ScriptPath, [string[]]$ScriptArguments)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
try {
    & $ScriptPath @ScriptArguments
    if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
} catch {
    [Console]::Error.WriteLine(($_ | Format-List * -Force | Out-String -Width 4096))
    exit 1
}
"#;
    let mut contents = b"\xef\xbb\xbf".to_vec();
    contents.extend_from_slice(script);
    std::fs::write(&launcher, contents)?;
    Ok(launcher)
}

fn powershell_script_copy(workspace: &FsPath, entry: &FsPath, id: Uuid) -> Result<PathBuf> {
    let source = std::fs::read(entry)?;
    let mut contents = Vec::with_capacity(source.len() + 3);
    if !source.starts_with(b"\xef\xbb\xbf") {
        contents.extend_from_slice(b"\xef\xbb\xbf");
    }
    contents.extend_from_slice(&source);
    let copy = workspace.join(format!("__yaya_utf8_{id}.ps1"));
    std::fs::write(&copy, contents)?;
    Ok(copy)
}
fn write_assets(dir: &FsPath, items: &[Asset]) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    for a in items {
        let relative = relative(&a.path)?;
        let mut path = dir.to_path_buf();
        for component in relative.components() {
            path.push(component);
            if let Ok(metadata) = std::fs::symlink_metadata(&path) {
                if metadata.file_type().is_symlink() {
                    bail!("resource link rejected")
                }
            }
        }
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path, STANDARD.decode(&a.data)?)?;
    }
    Ok(())
}
async fn python_environment(m: &Manager, id: Uuid, root: &FsPath) -> Result<PathBuf> {
    let python = root.join("python");
    let binary = python.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    if binary.is_file() && python.join(".yaya-ready").is_file() {
        return Ok(binary);
    }
    let program = interpreter("python")?;
    std::fs::create_dir_all(root)?;
    let mut c = command(&program);
    c.args(["-m", "venv"])
        .arg(&python)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child;
    let pid;
    let tree;
    {
        let _g = m.gate.lock().await;
        if read_job(m, id)?.status != "running" {
            bail!("initialization cancelled")
        }
        child = c
            .spawn()
            .context("interpreter_unavailable: cannot create Python environment")?;
        pid = child.id().context("missing child pid")?;
        tree = process::Tree::attach(pid)?;
        m.children.lock().await.insert(id, pid);
    }
    let started = tokio::time::Instant::now();
    let status = loop {
        if read_job(m, id)?.status == "cancelled" || started.elapsed().as_secs() > 120 {
            process::terminate(pid).await;
            let _ = child.wait().await;
            drop(tree);
            m.children.lock().await.remove(&id);
            bail!("interpreter_unavailable: venv cancelled or timed out")
        }
        if let Some(exit) = child.try_wait()? {
            break exit;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    drop(tree);
    m.children.lock().await.remove(&id);
    if !status.success() || !binary.is_file() {
        bail!("interpreter_unavailable: Python venv module missing or initialization failed")
    }
    std::fs::write(python.join(".yaya-ready"), b"1")?;
    Ok(binary)
}
#[derive(Default)]
struct Buffer {
    out: Vec<u8>,
    err: Vec<u8>,
    truncated: bool,
}
type Shared = Arc<std::sync::Mutex<Buffer>>;
async fn drain(mut reader: impl tokio::io::AsyncRead + Unpin, buffer: Shared, stderr: bool) {
    let mut chunk = [0u8; 8192];
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        let mut b = buffer.lock().unwrap();
        let take = n.min(LOG_LIMIT.saturating_sub(b.out.len() + b.err.len()));
        if take < n {
            b.truncated = true
        }
        if stderr {
            b.err.extend_from_slice(&chunk[..take])
        } else {
            b.out.extend_from_slice(&chunk[..take])
        }
    }
}
fn redact(data: &[u8], secrets: &BTreeMap<String, String>, finalized: bool) -> String {
    let mut text = String::from_utf8_lossy(data).into_owned();
    let mut values = secrets
        .values()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    values.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for value in values {
        text = text.replace(value, "[REDACTED]");
        // Withhold every partial secret at a chunk boundary, including a capped final log.
        for (at, _) in value.char_indices().rev().filter(|(at, _)| *at > 0) {
            if text.ends_with(&value[..at]) {
                let len = text.len() - at;
                text.truncate(len);
                if finalized {
                    text.push_str("[REDACTED]")
                }
                break;
            }
        }
    }
    text
}
fn snapshot(b: &Shared, secrets: &BTreeMap<String, String>, done: bool) -> Value {
    let b = b.lock().unwrap();
    let mut out = redact(&b.out, secrets, done);
    let mut err = redact(&b.err, secrets, done);
    let mut truncated = b.truncated;
    fn cap(text: &mut String, budget: usize) -> bool {
        if text.len() <= budget {
            return false;
        }
        let mut at = budget;
        while !text.is_char_boundary(at) {
            at -= 1
        }
        text.truncate(at);
        true
    }
    truncated |= cap(&mut out, LOG_LIMIT);
    truncated |= cap(&mut err, LOG_LIMIT - out.len());
    json!({"stdout":out,"stderr":err,"truncated":truncated})
}
fn save_logs(m: &Manager, id: Uuid, value: &Value) -> Result<()> {
    let dir = job_dir(m, id);
    let temporary = dir.join("logs.tmp");
    std::fs::write(&temporary, serde_json::to_vec(value)?)?;
    std::fs::rename(temporary, dir.join("logs.json"))?;
    Ok(())
}
pub(super) fn read_logs(m: &Manager, id: Uuid) -> Value {
    std::fs::read(job_dir(m, id).join("logs.json"))
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_else(|| json!({"stdout":"","stderr":"","truncated":false}))
}
fn collect(root: &FsPath, dir: &FsPath, items: &mut Vec<Value>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let e = entry?;
        let metadata = std::fs::symlink_metadata(e.path())?;
        if metadata.file_type().is_symlink() {
            bail!("output link rejected")
        }
        let path = e.path();
        let rel = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        if rel.split('/').count() > 8 {
            bail!("output depth")
        }
        if metadata.is_dir() {
            collect(root, &path, items)?
        } else if metadata.is_file() {
            if items.len() >= 8 || metadata.len() == 0 || metadata.len() > 8 * 1024 * 1024 {
                bail!("output size")
            }
            let mut file = std::fs::File::open(&path)?;
            let mut data = Vec::new();
            std::io::Read::read_to_end(
                &mut std::io::Read::take(&mut file, 8 * 1024 * 1024 + 1),
                &mut data,
            )?;
            items.push(json!({"path":rel,"data":STANDARD.encode(data)}));
        } else {
            bail!("output is not regular file")
        }
    }
    Ok(())
}
pub(super) async fn run(m: &Manager, req: &Request) -> Result<()> {
    {
        let _g = m.gate.lock().await;
        let mut j = read_job(m, req.id)?;
        if j.status != "queued" {
            return Ok(());
        }
        j.status = "running".into();
        write_job(m, &j)?;
    }
    let root = session_root(m, &req.scope);
    std::fs::create_dir_all(&root)?;
    let identity = root.join("scope.json");
    if identity.exists() {
        let old: Scope = serde_json::from_slice(&std::fs::read(&identity)?)?;
        if old != req.scope {
            bail!("session identity conflict")
        }
    } else {
        std::fs::write(identity, serde_json::to_vec(&req.scope)?)?;
    }
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace)?;
    // npm walks up to the nearest package root. Always establish this boundary before
    // running any command so `npm install` cannot modify an ancestor project's manifest.
    let manifest = workspace.join("package.json");
    if !manifest.exists() {
        std::fs::write(
            &manifest,
            br#"{"name":"yaya-session","version":"0.0.0","private":true}"#,
        )?;
    }
    let python = if req.language == "python"
        || (matches!(req.language.as_str(), "shell" | "powershell" | "bash")
            && interpreter("python").is_ok())
    {
        Some(python_environment(m, req.id, &root).await?)
    } else {
        None
    };
    let job = job_dir(m, req.id);
    let input = job.join("input");
    let output = job.join("output");
    std::fs::create_dir_all(&output)?;
    write_assets(&input, &req.files)?;
    let version = format!("{:x}", Sha256::digest(req.version.as_bytes()));
    let skill = workspace.join("skills").join(version);
    write_assets(&skill, &req.resources)?;
    let ext = match req.language.as_str() {
        "python" => "py",
        "node" => "mjs",
        "powershell" => "ps1",
        "shell" if cfg!(windows) => "ps1",
        _ => "sh",
    };
    let entry = if req.script_path.is_empty() {
        let entry = workspace.join(format!("__yaya_{}.{}", req.id, ext));
        std::fs::write(&entry, &req.script)?;
        entry
    } else {
        skill.join(relative(&req.script_path)?)
    };
    let program = if req.language == "python" {
        python
            .clone()
            .context("interpreter_unavailable: Python missing")?
    } else {
        interpreter(&req.language)?
    };
    let mut c = command(&program);
    if req.language == "powershell" || (req.language == "shell" && cfg!(windows)) {
        c.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        if cfg!(windows) {
            let script = powershell_script_copy(&workspace, &entry, req.id)?;
            c.arg(powershell_launcher(&workspace)?)
                .arg(script)
                .args(&req.arguments);
        } else {
            c.arg(&entry).args(&req.arguments);
        }
    } else {
        c.arg(&entry).args(&req.arguments);
    }
    c.current_dir(&workspace);
    let mut paths = Vec::new();
    if let Some(python) = &python {
        paths.push(python.parent().unwrap().to_path_buf());
    }
    if let Ok(node) = interpreter("node") {
        paths.push(node.parent().unwrap().to_path_buf())
    }
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let temp = job.join("tmp");
    std::fs::create_dir_all(&temp)?;
    if python.is_some() {
        c.env("VIRTUAL_ENV", root.join("python"));
    }
    c.envs(&req.environment)
        .env("PATH", std::env::join_paths(paths)?)
        .env("HOME", &workspace)
        .env("USERPROFILE", &workspace)
        .env("TEMP", &temp)
        .env("TMP", &temp)
        .env("TMPDIR", &temp)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("NODE_PATH", workspace.join("node_modules"))
        .env("npm_config_prefix", &workspace)
        .env("npm_config_cache", workspace.join(".npm-cache"))
        .env("PIP_REQUIRE_VIRTUALENV", "true")
        .env("YAYA_INPUT_DIR", &input)
        .env("YAYA_SKILL_DIR", &skill)
        .env("YAYA_OUTPUT_DIR", &output);
    let mut child;
    let pid;
    let tree;
    {
        let _g = m.gate.lock().await;
        if read_job(m, req.id)?.status != "running" {
            return Ok(());
        }
        if req.deadline_unix_ms > 0 && unix_ms() >= req.deadline_unix_ms {
            drop(_g);
            finish(m,req.id,"timed_out",json!({"exitCode":-1,"stdout":"","stderr":"Frozen execution deadline elapsed before process start","artifacts":[]})).await;
            return Ok(());
        }
        child = c
            .spawn()
            .context("interpreter_unavailable: failed to start executable")?;
        pid = child.id().context("child pid missing")?;
        tree = process::Tree::attach(pid)?;
        m.children.lock().await.insert(req.id, pid);
    }
    let buffer: Shared = Default::default();
    let a = tokio::spawn(drain(
        child.stdout.take().context("stdout missing")?,
        buffer.clone(),
        false,
    ));
    let b = tokio::spawn(drain(
        child.stderr.take().context("stderr missing")?,
        buffer.clone(),
        true,
    ));
    let seconds = req.timeout_seconds;
    let started = tokio::time::Instant::now();
    let mut status = "succeeded";
    let code = loop {
        save_logs(m, req.id, &snapshot(&buffer, &req.environment, false))?;
        if read_job(m, req.id)?.status == "cancelled" {
            status = "cancelled";
            process::terminate(pid).await;
            let _ = child.wait().await;
            break -1;
        }
        if started.elapsed().as_secs() >= seconds
            || (req.deadline_unix_ms > 0 && unix_ms() >= req.deadline_unix_ms)
        {
            status = "timed_out";
            process::terminate(pid).await;
            let _ = child.wait().await;
            break -1;
        }
        if let Some(exit) = child.try_wait()? {
            if !exit.success() {
                status = "failed"
            }
            break exit.code().unwrap_or(-1);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    drop(tree);
    m.children.lock().await.remove(&req.id);
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        let _ = a.await;
        let _ = b.await;
    })
    .await;
    let logs = snapshot(&buffer, &req.environment, true);
    save_logs(m, req.id, &logs)?;
    let mut artifacts = vec![];
    if status == "succeeded" {
        if collect(&output, &output, &mut artifacts)
            .and_then(|_| {
                validate_outputs(
                    &artifacts,
                    &req.environment.values().cloned().collect::<Vec<_>>(),
                )
            })
            .is_err()
        {
            status = "failed";
            artifacts.clear();
        }
    }
    finish(m,req.id,status,json!({"exitCode":code,"stdout":logs["stdout"],"stderr":logs["stderr"],"logsMayBeTruncated":logs["truncated"],"artifacts":artifacts,"untrustedContent":true,"backend":"local","systemIsolation":false})).await;
    Ok(())
}
