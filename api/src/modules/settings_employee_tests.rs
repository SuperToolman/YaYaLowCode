//! Runs only inside the existing isolated license/database integration harness.
use super::*;
use crate::platform::config::save_platform_license_settings;
use axum::{Router, routing::get};
use serde_json::json;
use std::{
    io::Write,
    sync::{Arc, Mutex},
};

fn archive() -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zip.start_file("SKILL.md", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"# Isolated employee skill\nTest instructions")
        .unwrap();
    zip.start_file("requirements.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"openpyxl==3.1.5").unwrap();
    zip.finish().unwrap().into_inner()
}

pub(crate) async fn verify(db: &sea_orm::DatabaseConnection) {
    use crate::infrastructure::entities::agent_resource_entity;
    let schema = sea_orm::Schema::new(db.get_database_backend());
    db.execute(&schema.create_table_from_entity(agent_resource_entity::Entity))
        .await
        .unwrap();
    let settings_path = std::env::var("YAYA_LICENSE_SETTINGS_PATH").unwrap();
    let package_path = std::env::var("YAYA_INSTALLED_AI_EMPLOYEE_PACKAGES_PATH").unwrap();
    let original_settings = std::fs::read(&settings_path).unwrap();
    let original_packages = std::fs::read(&package_path).unwrap();
    let employee = license_status()
        .ai_employees
        .into_iter()
        .find(|item| item.id == "employee-a")
        .unwrap();
    let mut package = serde_json::to_value(employee).unwrap();
    package["templateVersion"] = json!("2.0.0");
    package["applicationIds"] = json!([]);
    package["skills"] = json!([{"id":"test-update-skill","title":"Test", "version":"1.0.0","description":"test", "instructions":"test"}]);
    let fixture = Arc::new(Mutex::new((package.clone(), archive(), false)));
    let metadata = fixture.clone();
    let bytes = fixture.clone();
    let environment_status = Arc::new(Mutex::new(StatusCode::SERVICE_UNAVAILABLE));
    let environment_reply = environment_status.clone();
    let health_reply = environment_status.clone();
    let install_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let install_call_count = install_calls.clone();
    let router = Router::new()
        .route("/healthz", get(move || {let reply=health_reply.clone();async move{(*reply.lock().unwrap(),Json(json!({"ready":true,"backend":"local","interpreters":{"python":{"available":true},"node":{"available":true},"shell":{"available":true}}})))}}))
        .route("/environments", axum::routing::post(move || {
            install_call_count.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            let reply = environment_reply.clone();
            async move { (*reply.lock().unwrap(), Json(json!({"ready":true}))) }
        }))
        .route(
            "/api/market/ai-employees/employee-a/package",
            get(move || {
                let metadata = metadata.clone();
                async move {
                    let value = metadata.lock().unwrap();
                    if value.2 {
                        (StatusCode::BAD_GATEWAY, Json(json!({"code":502})))
                    } else {
                        (StatusCode::OK, Json(json!({"code":0,"data":value.0})))
                    }
                }
            }),
        )
        .route(
            "/api/market/ai-employees/employee-a/skills/test-update-skill/archive",
            get(move || {
                let bytes = bytes.clone();
                async move { bytes.lock().unwrap().1.clone() }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut settings = load_platform_license_settings().unwrap();
    settings.license_center_url = format!("http://{address}");
    save_platform_license_settings(&settings).unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let old_execution_url = std::env::var("YAYA_AGENT_V2_EXECUTION_URL").ok();
    let old_execution_secret = std::env::var("YAYA_EXECUTION_SECRET").ok();
    // This harness runs alone with isolated settings and schema.
    unsafe {
        std::env::set_var("YAYA_AGENT_V2_EXECUTION_URL", format!("http://{address}"));
        std::env::set_var(
            "YAYA_EXECUTION_SECRET",
            "isolated-test-execution-secret-32-bytes",
        );
    }
    let install = || install_ai_employee(State(state.clone()), axum::http::HeaderMap::new(), Path("employee-a".into()));

    // Installation succeeds without contacting any dependency service, even when it is down.
    assert!(install().await.unwrap().0.data.unwrap().installed);
    let installed = load_installed_ai_employee_packages()["employee-a"].clone();
    assert_eq!(installed["employeeVersion"], "2.0.0");
    let installed_at = installed["installedAt"]
        .as_i64()
        .expect("installation timestamp");
    assert_eq!(install_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(installed["templateVersion"], "2.0.0");
    let instructions = installed["skills"][0]["packagePath"].as_str().unwrap();
    assert!(std::path::Path::new(instructions).is_file());
    assert!(instructions.contains("employee-skills"));
    assert!(
        list_runtime_ai_employees()
            .await
            .unwrap()
            .0
            .data
            .unwrap()
            .iter()
            .any(|item| item.id == "employee-a" && item.application_ids.is_empty())
    );

    // Both transport failure and malformed ZIP leave package + active files untouched.
    fixture.lock().unwrap().2 = true;
    assert!(install().await.is_err());
    fixture.lock().unwrap().2 = false;
    fixture.lock().unwrap().1 = b"invalid zip".to_vec();
    assert!(install().await.is_err());
    assert_eq!(
        load_installed_ai_employee_packages()["employee-a"],
        installed
    );
    assert!(
        std::fs::read_to_string(instructions)
            .unwrap()
            .contains("Test instructions")
    );

    fixture.lock().unwrap().1 = archive();
    for invalid in ["identity", "version", "expiry", "duplicate"] {
        let mut bad = package.clone();
        match invalid {
            "identity" => bad["id"] = json!("another-employee"),
            "version" => bad["templateVersion"] = json!(""),
            "expiry" => bad["expiresAt"] = json!(0),
            _ => bad["skills"] = json!([bad["skills"][0], bad["skills"][0]]),
        }
        fixture.lock().unwrap().0 = bad;
        assert!(install().await.is_err(), "{invalid}");
        assert_eq!(
            load_installed_ai_employee_packages()["employee-a"],
            installed
        );
    }
    // A resource conflict rolls back publication without replacing the active manifest.
    db.execute_unprepared("UPDATE agent_resources SET kind='plugin' WHERE id='test-update-skill'")
        .await
        .unwrap();
    package["templateVersion"] = json!("3.0.0");
    fixture.lock().unwrap().0 = package;
    assert!(install().await.is_err());
    assert_eq!(
        load_installed_ai_employee_packages()["employee-a"],
        installed
    );
    db.execute_unprepared("UPDATE agent_resources SET kind='skill' WHERE id='test-update-skill'")
        .await
        .unwrap();
    let _ = install().await.unwrap();
    assert_eq!(
        load_installed_ai_employee_packages()["employee-a"]["templateVersion"],
        "3.0.0"
    );
    assert_eq!(
        load_installed_ai_employee_packages()["employee-a"]["installedAt"],
        installed_at
    );

    std::fs::write(settings_path, original_settings).unwrap();
    std::fs::write(package_path, original_packages).unwrap();
    unsafe {
        for (name, old) in [
            ("YAYA_AGENT_V2_EXECUTION_URL", old_execution_url),
            ("YAYA_EXECUTION_SECRET", old_execution_secret),
        ] {
            if let Some(value) = old {
                std::env::set_var(name, value);
            } else {
                std::env::remove_var(name);
            }
        }
    }
    server.abort();
}
