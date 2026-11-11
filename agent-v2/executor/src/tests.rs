use super::*;
fn manager() -> Manager {
    Manager {
        root: std::env::temp_dir().join(format!("yaya-local-test-{}", Uuid::new_v4())),
        secret: "x".repeat(32),
        gate: Default::default(),
        slots: Arc::new(Semaphore::new(2)),
        sessions: Default::default(),
        children: Default::default(),
    }
}
fn request(language: &str, script: &str) -> Request {
    Request {
        id: Uuid::new_v4(),
        epoch: 1,
        scope: Scope {
            deployment_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            employee_id: "local-test-employee".into(),
            session_id: Uuid::new_v4(),
        },
        language: language.into(),
        script: script.into(),
        script_path: String::new(),
        arguments: vec![],
        files: vec![],
        resources: vec![],
        environment: BTreeMap::new(),
        version: "test-v1".into(),
        timeout_seconds: 600,
        deadline_unix_ms: 0,
    }
}
fn insert(m: &Manager, r: &Request) {
    write_job(
        m,
        &Job {
            id: r.id,
            epoch: r.epoch,
            fingerprint: fingerprint(r),
            status: "queued".into(),
            result: Value::Null,
            scope: Some(r.scope.clone()),
            timeout_seconds: r.timeout_seconds,
            deadline_unix_ms: r.deadline_unix_ms,
        },
    )
    .unwrap();
}
async fn execute(m: &Manager, r: &Request) -> Job {
    insert(m, r);
    local::run(m, r).await.unwrap();
    read_job(m, r.id).unwrap()
}
#[test]
fn validates_scope_language_paths_and_config() {
    let mut r = request("shell", "python --version");
    assert!(validate(&r).is_ok());
    r.scope.employee_id.clear();
    assert!(validate(&r).is_err());
    for path in ["../a", "/etc/passwd", "C:/x", "a\\b", "a//b"] {
        assert!(relative(path).is_err())
    }
    for name in [
        "PATH",
        "path",
        "NODE_OPTIONS",
        "PYTHONHOME",
        "BASH_ENV",
        "YAYA_INPUT_DIR",
    ] {
        assert!(!valid_env(name))
    }
    assert!(valid_env("SUPPLIER_API_KEY"));
}

#[tokio::test]
async fn reset_rejects_active_session_and_retains_execution_history() {
    let m = manager();
    let r = request("node", "console.log('test')");
    insert(&m, &r);
    let mut h = HeaderMap::new();
    h.insert("x-execution-secret", m.secret.parse().unwrap());
    assert!(
        reset(State(m.clone()), h.clone(), Json(r.scope.clone()))
            .await
            .is_err()
    );
    finish(&m, r.id, "succeeded", json!({"exitCode":0})).await;
    let root = local::session_root(&m, &r.scope);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("scope.json"),
        serde_json::to_vec(&r.scope).unwrap(),
    )
    .unwrap();
    assert!(reset(State(m.clone()), h, Json(r.scope)).await.is_ok());
    assert!(!root.exists());
    assert_eq!(read_job(&m, r.id).unwrap().status, "succeeded");
    std::fs::remove_dir_all(m.root).unwrap();
}

#[tokio::test]
async fn logs_are_bounded_utf8_pages_and_session_locks_serialize() {
    let m = manager();
    let r = request("node", "console.log('test')");
    insert(&m, &r);
    std::fs::write(
        job_dir(&m, r.id).join("logs.json"),
        serde_json::to_vec(&json!({"stdout":"中".repeat(12000),"stderr":"","truncated":true}))
            .unwrap(),
    )
    .unwrap();
    let mut h = HeaderMap::new();
    h.insert("x-execution-secret", m.secret.parse().unwrap());
    let page = logs(
        State(m.clone()),
        h,
        Path(r.id),
        Query(LogQuery {
            offset: 1,
            stream: Some("stdout".into()),
        }),
    )
    .await
    .unwrap()
    .0;
    assert!(page["text"].as_str().unwrap().len() <= 16384);
    assert_eq!(page["truncated"], true);
    assert_eq!(page["done"], false);
    let a = session_gate(&m, &r.scope).await;
    let b = session_gate(&m, &r.scope).await;
    let _guard = a.lock().await;
    assert!(b.try_lock().is_err());
    let mut other = r.scope.clone();
    other.session_id = Uuid::new_v4();
    assert!(session_gate(&m, &other).await.try_lock().is_ok());
    std::fs::remove_dir_all(m.root).unwrap();
}
#[tokio::test]
async fn identity_fencing_corruption_and_logs() {
    let m = manager();
    let mut r = request("python", "print(1)");
    insert(&m, &r);
    let mut h = HeaderMap::new();
    h.insert("x-execution-secret", m.secret.parse().unwrap());
    r.epoch = 0;
    assert!(submit(State(m.clone()), h.clone(), Json(r)).await.is_err());
    let mut r = request("python", "print(2)");
    r.id = Uuid::new_v4();
    insert(&m, &r);
    finish(&m, r.id, "succeeded", json!({"exitCode":0})).await;
    finish(&m, r.id, "failed", Value::Null).await;
    assert_eq!(read_job(&m, r.id).unwrap().status, "succeeded");
    let mut same = request("python", "print(2)");
    same.id = r.id;
    same.scope = r.scope.clone();
    same.epoch = 2;
    assert_eq!(
        submit(State(m.clone()), h.clone(), Json(same))
            .await
            .unwrap()
            .0["status"],
        "succeeded"
    );
    assert!(
        query(State(m.clone()), HeaderMap::new(), Path(r.id))
            .await
            .is_err()
    );
    std::fs::write(job_dir(&m, r.id).join("job.json"), b"broken").unwrap();
    let mut same = request("python", "print(2)");
    same.id = r.id;
    same.scope = r.scope.clone();
    assert!(submit(State(m.clone()), h, Json(same)).await.is_err());
    std::fs::remove_dir_all(m.root).unwrap();
}
#[tokio::test]
async fn real_python_missing_dependency_install_and_reuse() {
    let m = manager();
    let mut r = request(
        "python",
        "import session_test_dependency; print(session_test_dependency.VALUE)",
    );
    let first = execute(&m, &r).await;
    assert_eq!(first.status, "failed");
    assert!(
        first.result["stderr"]
            .as_str()
            .unwrap()
            .contains("ModuleNotFoundError")
    );
    // Real pip installs a local fixture package: deterministic, offline and no global mutation.
    let package = local::session_root(&m, &r.scope)
        .join("workspace")
        .join("fixture-package");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("setup.py"),"from setuptools import setup\nsetup(name='session-test-dependency',version='1.0',py_modules=['session_test_dependency'])").unwrap();
    std::fs::write(
        package.join("session_test_dependency.py"),
        "VALUE='persisted-install'",
    )
    .unwrap();
    // venv may lack setuptools on Python >=3.12. Use a valid wheel so no build dependency download is needed.
    let wheel = create_wheel(&package);
    r.id = Uuid::new_v4();
    r.language = "shell".into();
    r.script = format!("python -m pip install --no-index '{}'", wheel.display());
    assert_eq!(execute(&m, &r).await.status, "succeeded");
    let restarted = Manager {
        root: m.root.clone(),
        ..manager()
    };
    r.id = Uuid::new_v4();
    r.language = "python".into();
    r.script = "import session_test_dependency; print(session_test_dependency.VALUE)".into();
    let result = execute(&restarted, &r).await;
    assert_eq!(result.status, "succeeded");
    assert!(
        result.result["stdout"]
            .as_str()
            .unwrap()
            .contains("persisted-install")
    );
    r.id = Uuid::new_v4();
    r.scope.session_id = Uuid::new_v4();
    assert_eq!(execute(&m, &r).await.status, "failed");
    std::fs::remove_dir_all(&m.root).unwrap();
}
fn create_wheel(package: &FsPath) -> PathBuf {
    // Build a tiny pure-Python wheel with the system stdlib, not imported Skill code.
    let wheel = package.join("session_test_dependency-1.0-py3-none-any.whl");
    let code = r#"import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr('session_test_dependency.py',"VALUE='persisted-install'")
z.writestr('session_test_dependency-1.0.dist-info/METADATA',chr(10).join(['Metadata-Version: 2.1','Name: session-test-dependency','Version: 1.0','']))
z.writestr('session_test_dependency-1.0.dist-info/WHEEL',chr(10).join(['Wheel-Version: 1.0','Generator: test','Root-Is-Purelib: true','Tag: py3-none-any','']))
z.writestr('session_test_dependency-1.0.dist-info/RECORD','')
z.close()
"#;
    let status = std::process::Command::new(if cfg!(windows) { "python" } else { "python3" })
        .arg("-c")
        .arg(code)
        .arg(&wheel)
        .status()
        .unwrap();
    assert!(status.success());
    wheel
}
#[tokio::test]
async fn real_output_redaction_and_session_files() {
    let m = manager();
    let mut r = request(
        "python",
        "import os; from pathlib import Path; print(os.environ['FIXTURE_SECRET']); print('DB_PRESENT='+str('DATABASE_URL' in os.environ)); Path('persist.txt').write_text('session file'); Path(os.environ['YAYA_OUTPUT_DIR'],'report.txt').write_text('safe report')",
    );
    r.environment
        .insert("FIXTURE_SECRET".into(), "split-secret-fixture".into());
    let j = execute(&m, &r).await;
    assert_eq!(j.status, "succeeded");
    assert_eq!(j.result["artifacts"].as_array().unwrap().len(), 1);
    assert!(!j.result.to_string().contains("split-secret-fixture"));
    assert!(
        j.result["stdout"]
            .as_str()
            .unwrap()
            .contains("DB_PRESENT=False")
    );
    let raw = std::fs::read_to_string(job_dir(&m, r.id).join("logs.json")).unwrap();
    assert!(!raw.contains("split-secret-fixture"));
    r.id = Uuid::new_v4();
    r.script = "from pathlib import Path; print(Path('persist.txt').read_text()); print('原始BOM 测试.xlsx')".into();
    let unicode = execute(&m, &r).await;
    assert_eq!(unicode.status, "succeeded");
    assert!(
        unicode.result["stdout"]
            .as_str()
            .unwrap()
            .contains("原始BOM 测试.xlsx")
    );
    std::fs::remove_dir_all(m.root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn powershell_stderr_is_captured_as_utf8() {
    let m = manager();
    let r = request("shell", "throw '中文异常：文件格式不正确'");
    let result = execute(&m, &r).await;
    let stderr = result.result["stderr"].as_str().unwrap_or_default();
    assert_eq!(result.status, "failed", "{}", result.result);
    assert!(stderr.contains("中文异常：文件格式不正确"), "{stderr}");
    assert!(!stderr.contains('�'), "{stderr}");
    std::fs::remove_dir_all(m.root).unwrap();
}
#[tokio::test]
async fn real_node_modules_persist_for_commonjs_and_esm() {
    let m = manager();
    let mut r = request(
        "node",
        "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);console.log(require('session-fixture'));",
    );
    assert_eq!(execute(&m, &r).await.status, "failed");
    let workspace = local::session_root(&m, &r.scope).join("workspace");
    let package = workspace.join("fixture-node");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("package.json"),r#"{"name":"session-fixture","version":"1.0.0","main":"index.cjs","exports":{"require":"./index.cjs","import":"./index.mjs"}}"#).unwrap();
    std::fs::write(
        package.join("index.cjs"),
        "module.exports='node-persisted';",
    )
    .unwrap();
    std::fs::write(package.join("index.mjs"), "export default 'esm-persisted';").unwrap();
    r.id = Uuid::new_v4();
    r.language = "shell".into();
    r.script = "npm install --offline --ignore-scripts --no-audit --no-fund ./fixture-node".into();
    let installed = execute(&m, &r).await;
    assert_eq!(installed.status, "succeeded", "{}", installed.result);
    assert!(
        workspace
            .join("node_modules/session-fixture/package.json")
            .is_file()
    );
    r.id = Uuid::new_v4();
    r.language = "node".into();
    r.script="import {createRequire} from 'node:module';const require=createRequire(import.meta.url);console.log(require('session-fixture'));".into();
    assert_eq!(execute(&m, &r).await.status, "succeeded");
    r.id = Uuid::new_v4();
    r.script = "import value from 'session-fixture';console.log(value);".into();
    let j = execute(&m, &r).await;
    assert_eq!(j.status, "succeeded");
    assert!(
        j.result["stdout"]
            .as_str()
            .unwrap()
            .contains("esm-persisted")
    );
    r.id = Uuid::new_v4();
    r.scope.session_id = Uuid::new_v4();
    // Inspect the session path rather than ancestor imports: this is directory separation,
    // and Node may still resolve account-accessible global/ancestor packages.
    assert!(
        !local::session_root(&m, &r.scope)
            .join("workspace/node_modules/session-fixture")
            .exists()
    );
    std::fs::remove_dir_all(m.root).unwrap();
}

#[tokio::test]
async fn real_stop_kills_process_tree_and_keeps_environment() {
    let m = manager();
    let warm = request("python", "print('ready')");
    assert_eq!(execute(&m, &warm).await.status, "succeeded");
    let mut r = request(
        "python",
        "import time; print('started',flush=True); time.sleep(30)",
    );
    r.scope = warm.scope.clone();
    insert(&m, &r);
    let id = r.id;
    let scope = r.scope.clone();
    let copy = m.clone();
    let task = tokio::spawn(async move { local::run(&copy, &r).await });
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if local::read_logs(&m, id)["stdout"]
                .as_str()
                .unwrap_or("")
                .contains("started")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await
        }
    })
    .await
    .unwrap();
    let mut h = HeaderMap::new();
    h.insert("x-execution-secret", m.secret.parse().unwrap());
    assert_eq!(
        cancel(State(m.clone()), h, Path(id), Json(Epoch { epoch: 2 }))
            .await
            .unwrap()
            .0["status"],
        "cancelled"
    );
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(read_job(&m, id).unwrap().status, "cancelled");
    assert!(local::session_root(&m, &scope).join("python").exists());
    std::fs::remove_dir_all(m.root).unwrap();
}

#[tokio::test]
async fn frozen_deadline_timeout_retains_environment_and_result() {
    let m = manager();
    let mut r = request("python", "print('warm')");
    assert_eq!(execute(&m, &r).await.status, "succeeded");
    r.id = Uuid::new_v4();
    r.timeout_seconds = 1;
    r.script = "import time; print('中文超时',flush=True); time.sleep(30)".into();
    r.deadline_unix_ms = unix_ms() + 1500;
    let j = execute(&m, &r).await;
    assert_eq!(j.status, "timed_out");
    assert!(j.result["stdout"].as_str().unwrap().contains("中文超时"));
    assert_eq!(
        read_job(&m, r.id).unwrap().deadline_unix_ms,
        r.deadline_unix_ms
    );
    assert!(local::session_root(&m, &r.scope).join("python").exists());
    let previous = fingerprint(&r);
    r.timeout_seconds = 2;
    assert_ne!(previous, fingerprint(&r));
    r.timeout_seconds = 7201;
    assert!(validate(&r).is_err());
    std::fs::remove_dir_all(m.root).unwrap();
}

#[tokio::test]
async fn legacy_pending_job_is_not_replayed_under_new_timeout_contract() {
    let m = manager();
    let r = request("node", "throw Error('must never run')");
    write_job(
        &m,
        &Job {
            id: r.id,
            epoch: 1,
            fingerprint: execution_fingerprint(&r, false),
            status: "running".into(),
            result: Value::Null,
            scope: Some(r.scope.clone()),
            timeout_seconds: 0,
            deadline_unix_ms: 0,
        },
    )
    .unwrap();
    let mut h = HeaderMap::new();
    h.insert("x-execution-secret", m.secret.parse().unwrap());
    let result = submit(State(m.clone()), h, Json(r)).await.unwrap().0;
    assert_eq!(result["status"], "outcome_unknown");
    assert!(m.children.lock().await.is_empty());
    std::fs::remove_dir_all(m.root).unwrap();
}
