use super::*;
use crate::infrastructure::entities::{
    iam_role_entity, iam_role_permission_entity, iam_user_role_entity,
};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, Schema};
use yaya_agent_v2::store::exec;
#[path = "design_broker_tests.rs"]
mod design_broker;

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL and isolated test license environment; run alone"]
async fn api_employee_permissions_and_private_sessions() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let name = format!("agent_v2_api_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {name}"))
        .await
        .unwrap();
    let mut opts = ConnectOptions::new(url);
    opts.set_schema_search_path(&name).sqlx_logging(false);
    let db = Database::connect(opts).await.unwrap();
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(iam_user_entity::Entity),
        schema.create_table_from_entity(iam_role_entity::Entity),
        schema.create_table_from_entity(iam_role_permission_entity::Entity),
        schema.create_table_from_entity(iam_user_role_entity::Entity),
    ] {
        db.execute(&statement).await.unwrap();
    }
    db.execute_unprepared(concat!(
        include_str!("../../../../agent-v2/core/schema.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_confirmations.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_policy.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_binding.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_workspace.sql"),
        "
",
        include_str!("../../../../agent-v2/core/upgrade_submissions.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_executions.sql"),
        "\n",
        include_str!("../../../../agent-v2/core/upgrade_long_tasks.sql"), "\n", include_str!("../../../../agent-v2/core/upgrade_session_directory.sql"), "\n", include_str!("../../../../agent-v2/core/upgrade_session_deletion.sql"), "\n", include_str!("../../../../agent-v2/core/upgrade_forks.sql")
    ))
    .await
    .unwrap();
    let result = tokio::spawn(verify(db)).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {name} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

pub(super) fn token(user: Uuid) -> String {
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"sub":user,"exp":chrono::Utc::now().timestamp()+3600}),
        &jsonwebtoken::EncodingKey::from_secret(
            std::env::var("AUTH_TOKEN_SECRET").unwrap().as_bytes(),
        ),
    )
    .unwrap()
}
async fn verify(db: sea_orm::DatabaseConnection) {
    let tenant = Uuid::new_v4();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let role_a = Uuid::new_v4();
    let role_b = Uuid::new_v4();
    for (user, role) in [(a, role_a), (b, role_b)] {
        exec(&db,"INSERT INTO iam_users(id,display_name,primary_organization_unit_id,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1::uuid,'V2 test',$2::uuid,false,false,false,false,'{}','active',now(),now())",vec![id(user),id(tenant)]).await.unwrap();
        exec(&db,"INSERT INTO iam_roles(id,source_type,external_id,name,status,created_at,updated_at) VALUES($1::uuid,'local',$2,'test','active',now(),now())",vec![id(role),role.to_string().into()]).await.unwrap();
        exec(&db,"INSERT INTO iam_user_roles(id,user_id,role_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,now())",vec![id(Uuid::new_v4()),id(user),id(role)]).await.unwrap();
        for permission in ["agent.window", "agent:employee-a:use"] {
            exec(&db,"INSERT INTO iam_role_permissions(id,role_id,permission,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3,now(),now())",vec![id(Uuid::new_v4()),id(role),permission.into()]).await.unwrap();
        }
    }
    use crate::infrastructure::entities::{
        app_entity, app_navigation_entity, automation_flow_entity, form_definition_entity,
        form_schema_entity,
    };
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(app_entity::Entity),
        schema.create_table_from_entity(app_navigation_entity::Entity),
        schema.create_table_from_entity(form_definition_entity::Entity),
        schema.create_table_from_entity(form_schema_entity::Entity),
        schema.create_table_from_entity(automation_flow_entity::Entity),
        schema.create_table_from_entity(
            crate::infrastructure::entities::form_storage_definition_entity::Entity,
        ),
        schema.create_table_from_entity(
            crate::infrastructure::entities::automation_flow_version_entity::Entity,
        ),
    ] {
        db.execute(&statement).await.unwrap();
    }
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    // Test retired endpoints on the real platform router as well as the V2 subtree.
    let platform_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let platform_address = platform_listener.local_addr().unwrap();
    let platform_app = crate::http::router::build(state.clone());
    let platform_server = tokio::spawn(async move {
        axum::serve(platform_listener, platform_app).await.unwrap();
    });
    let retired_client = reqwest::Client::new();
    // The real global middleware also checks the operation center. Give this
    // isolated signed test license a local status endpoint, rather than letting
    // an unreachable center hide an unremoved route behind a license 403.
    let original_license = crate::platform::config::load_platform_license_settings().unwrap();
    let status_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let status_address = status_listener.local_addr().unwrap();
    let signed_license = original_license.license.clone();
    let status_app = Router::new().route(
        "/api/licenses/agent-v2-integration-test/status",
        axum::routing::get(move |headers: HeaderMap| {
            let signed_license = signed_license.clone();
            async move {
                assert_eq!(
                    headers.get("authorization").unwrap().to_str().unwrap(),
                    format!("Bearer {signed_license}")
                );
                Json(json!({"data":{"valid":true}}))
            }
        }),
    );
    let status_server = tokio::spawn(async move {
        axum::serve(status_listener, status_app).await.unwrap();
    });
    let mut test_license = original_license.clone();
    test_license.license_center_url = format!("http://{status_address}");
    crate::platform::config::save_platform_license_settings(&test_license).unwrap();
    assert!(
        crate::platform::license::validate_license_remotely()
            .await
            .is_ok()
    );
    // An ordinary user's 403 cannot prove absence: use a real system-admin grant
    // so any residual handler is reached. All requests use this isolated schema.
    exec(
        &db,
        "UPDATE iam_roles SET external_id='system-administrator' WHERE id=$1::uuid",
        vec![id(role_a)],
    )
    .await
    .unwrap();
    assert!(
        authorization::grants_for_user(&state, a)
            .await
            .unwrap()
            .contains("*")
    );
    let retired: Vec<String> = serde_json::from_str(include_str!(
        "../../../../agent-v2/fixtures/retired-agent-routes.json"
    ))
    .unwrap();
    for template in &retired {
        let mut path = template.clone();
        while let Some(start) = path.find('{') {
            let end = path[start..].find('}').unwrap() + start;
            path.replace_range(start..=end, "00000000-0000-4000-8000-000000000099");
        }
        for method in [
            reqwest::Method::GET,
            reqwest::Method::POST,
            reqwest::Method::PUT,
            reqwest::Method::PATCH,
            reqwest::Method::DELETE,
        ] {
            let response = retired_client
                .request(method.clone(), format!("http://{platform_address}{path}"))
                .bearer_auth(token(a))
                .json(&json!({}))
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status().as_u16(),
                404,
                "retired route still reachable by admin: {method} {path}"
            );
        }
    }
    exec(
        &db,
        "UPDATE iam_roles SET external_id=$1 WHERE id=$2::uuid",
        vec![role_a.to_string().into(), id(role_a)],
    )
    .await
    .unwrap();
    crate::platform::config::save_platform_license_settings(&original_license).unwrap();
    status_server.abort();
    platform_server.abort();
    let app = routes().with_state(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    let root = format!("http://{address}/api/agent/v2");
    let staff: Value = client
        .get(format!("{root}/employees"))
        .bearer_auth(token(a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(staff["items"].as_array().unwrap().len(), 1);
    assert_eq!(staff["items"][0]["id"], "employee-a");
    let denied = client
        .post(format!("{root}/sessions"))
        .bearer_auth(token(a))
        .json(&json!({"employeeId":"employee-b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 403);
    let session: Value = client
        .post(format!("{root}/sessions"))
        .bearer_auth(token(a))
        .json(&json!({"employeeId":"employee-a"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = session["id"].as_str().unwrap();
    super::file_tests::verify(&db, &client, &root, a, b, tenant).await;
    super::submission_tests::verify(&db, &client, &root, a, b).await;
    for suffix in ["", "/messages", "/events"] {
        let response = client
            .get(format!("{root}/sessions/{sid}{suffix}"))
            .bearer_auth(token(b))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 404);
    }
    let forged=client.post(format!("{root}/sessions/{sid}/commands")).bearer_auth(token(a)).json(&json!({"kind":"prompt","clientCommandId":Uuid::new_v4(),"employeeId":"employee-b","parts":[{"type":"text","text":"x"}]})).send().await.unwrap();
    assert_eq!(forged.status(), 422);
    let body = json!({"kind":"prompt","clientCommandId":Uuid::new_v4(),"parts":[{"type":"text","text":"test"}]});
    let accepted: Value = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let again: Value = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(accepted, again);
    let mut stream = client
        .get(format!("{root}/sessions/{sid}/events?after=1"))
        .bearer_auth(token(a))
        .send()
        .await
        .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(3), stream.chunk())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&frame).contains("run.queued"));
    // Upgrade only the isolated test user to the platform's actual administrator role.
    exec(
        &db,
        "UPDATE iam_roles SET external_id='system-administrator' WHERE id=$1::uuid",
        vec![id(role_a)],
    )
    .await
    .unwrap();
    verify_write_broker(
        &db,
        &client,
        &format!("http://{address}"),
        a,
        b,
        tenant,
        Uuid::parse_str(sid).unwrap(),
    )
    .await;
    design_broker::verify(
        &db,
        &client,
        &format!("http://{address}"),
        a,
        tenant,
        role_a,
    )
    .await;
    verify_resume_commands(&db, &client, &root, a, b).await;
    exec(
        &db,
        "UPDATE iam_roles SET external_id=$2 WHERE id=$1::uuid",
        vec![id(role_a), role_a.to_string().into()],
    )
    .await
    .unwrap();
    exec(&db,"DELETE FROM iam_role_permissions WHERE role_id=$1::uuid AND permission='agent:employee-a:use'",vec![id(role_a)]).await.unwrap();
    for suffix in ["", "/messages", "/events"] {
        let response = client
            .get(format!("{root}/sessions/{sid}{suffix}"))
            .bearer_auth(token(a))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 403);
    }
    let revoked = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let frame = stream.chunk().await.unwrap().unwrap();
            let text = String::from_utf8_lossy(&frame).into_owned();
            if text.contains("access_revoked") {
                break text;
            }
        }
    })
    .await
    .unwrap();
    assert!(revoked.contains("access_revoked"));
    let denied = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&json!({"kind":"cancel","clientCommandId":Uuid::new_v4()}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 403);
    let empty: Value = client
        .get(format!("{root}/sessions"))
        .bearer_auth(token(a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(empty["items"].as_array().unwrap().is_empty());
    crate::modules::settings::employee_package_tests::verify(&db).await;
    server.abort();
}

async fn verify_write_broker(
    db: &sea_orm::DatabaseConnection,
    client: &reqwest::Client,
    base: &str,
    a: Uuid,
    b: Uuid,
    tenant: Uuid,
    sid: Uuid,
) {
    use yaya_agent_v2::domain::{Checkpoint, ContentPart, ToolCall};
    let store = Store { db: db.clone() };
    let scope = Scope {
        tenant_id: tenant,
        user_id: a,
    };
    // Complete the earlier API-only run so the broker task is the head of the queue.
    let old = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    store
        .finish(&old, "completed", "baseline", None)
        .await
        .unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: vec![ContentPart::Text {
                    text: "create application".into(),
                }],
            },
        )
        .await
        .unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let call = ToolCall {
        id: "create-app".into(),
        name: "platform_create_app".into(),
        arguments: json!({"name":"V2 confirmed app"}),
    };
    store.snapshot_context(&lease,json!({"employee_id":"employee-a","allowed_tools":["platform_create_app"],"application_ids":["*"],"grants":["*"],"action_grants":["*"],"policy_version":yaya_agent_v2::tools::POLICY_VERSION})).await.unwrap();
    let cp = Checkpoint {
        pending_calls: vec![call.clone()],
        ..Default::default()
    };
    store
        .checkpoint(&lease, &cp, "test", json!({}))
        .await
        .unwrap();
    let invoke = |lease: &yaya_agent_v2::store::Lease| {
        client
            .post(format!(
                "{base}/api/internal/agent-v2/runs/{}/tools/invoke",
                lease.run_id
            ))
            .query(&[
                ("owner", lease.owner.to_string()),
                ("epoch", lease.epoch.to_string()),
            ])
            .header(
                "x-agent-v2-worker-secret",
                std::env::var("YAYA_AGENT_V2_WORKER_SECRET").unwrap(),
            )
            .json(&json!({"call":call}))
    };
    let response = invoke(&lease).send().await.unwrap();
    assert_eq!(response.status(), 200, "{}", response.text().await.unwrap());
    assert_eq!(
        store.run(lease.run_id).await.unwrap()["status"],
        "waiting_confirmation"
    );
    let c = store
        .confirmations(&scope, sid)
        .await
        .unwrap()
        .pop()
        .unwrap();
    let cid = c["id"].as_str().unwrap();
    let endpoint = format!("{base}/api/agent/v2/sessions/{sid}/commands");
    let decision = json!({"kind":"confirm","clientCommandId":Uuid::new_v4(),"confirmationId":cid,"approve":true});
    assert_eq!(
        client
            .post(&endpoint)
            .bearer_auth(token(b))
            .json(&decision)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        client
            .post(&endpoint)
            .bearer_auth(token(a))
            .json(&decision)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(&endpoint)
            .bearer_auth(token(a))
            .json(&decision)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let resumed = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let response = invoke(&resumed).send().await.unwrap();
    let status = response.status();
    let body: Value = response.json().await.unwrap();
    assert_eq!(status, 200, "{body}");
    let again: Value = invoke(&resumed).send().await.unwrap().json().await.unwrap();
    assert_eq!(
        body, again,
        "committed effect reused before worker checkpoint"
    );
    let count=yaya_agent_v2::store::rows(db,"SELECT jsonb_build_object('count',COUNT(*))::text data FROM apps WHERE name='V2 confirmed app'",vec![]).await.unwrap();
    assert_eq!(count[0]["count"], 1);
    assert_eq!(
        store.confirmations(&scope, sid).await.unwrap()[0]["status"],
        "executed"
    );
    assert_eq!(
        invoke(&lease).send().await.unwrap().status(),
        403,
        "old worker fenced"
    );
    store
        .finish(&resumed, "completed", "created", None)
        .await
        .unwrap();
}

async fn verify_resume_commands(
    db: &sea_orm::DatabaseConnection,
    client: &reqwest::Client,
    root: &str,
    a: Uuid,
    b: Uuid,
) {
    let session: Value = client
        .post(format!("{root}/sessions"))
        .bearer_auth(token(a))
        .json(&json!({"employeeId":"employee-a"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = session["id"].as_str().unwrap();
    let queued:Value=client.post(format!("{root}/sessions/{sid}/commands")).bearer_auth(token(a)).json(&json!({"kind":"prompt","clientCommandId":Uuid::new_v4(),"parts":[{"type":"text","text":"isolated long task resume acceptance"}]})).send().await.unwrap().json().await.unwrap();
    let run = Uuid::parse_str(queued["runId"].as_str().unwrap()).unwrap();
    let employee = installed()
        .await
        .unwrap()
        .into_iter()
        .find(|e| e.id == "employee-a")
        .unwrap();
    let snapshot = json!({"employee_id":employee.id,"employee_version":employee_version(&employee),"skill_resources":executions::freeze_skills(&employee).unwrap(),"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"action_grants":["agent.window"],"allowed_tools":["diagnostic_echo"]});
    exec(db,"UPDATE agent_v2_runs SET status='paused',pause_reason='budget_exhausted',context_snapshot=$2 WHERE id=$1::uuid",vec![id(run),yaya_agent_v2::store::js(snapshot.clone())]).await.unwrap();
    let resume = json!({"kind":"resume","runId":run,"clientCommandId":Uuid::new_v4()});
    let denied = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(b))
        .json(&resume)
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 404);
    let accepted = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&resume)
        .send()
        .await
        .unwrap();
    assert!(accepted.status().is_success());
    let accepted: Value = accepted.json().await.unwrap();
    let again: Value = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&resume)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(accepted, again);
    let page: Value = client
        .get(format!("{root}/sessions/{sid}/messages"))
        .bearer_auth(token(a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["items"][0]["run_progress"]["model_limit"], 1000);
    let mut forged = resume.clone();
    forged["arguments"] = json!({"replace":"parameters"});
    assert_eq!(
        client
            .post(format!("{root}/sessions/{sid}/commands"))
            .bearer_auth(token(a))
            .json(&forged)
            .send()
            .await
            .unwrap()
            .status(),
        422
    );
    let invalid = Uuid::new_v4();
    exec(db,"UPDATE agent_v2_runs SET status='paused',pause_reason='no_progress',context_snapshot=jsonb_set(context_snapshot,'{policy_version}','0') WHERE id=$1::uuid",vec![id(run)]).await.unwrap();
    let rejected = client
        .post(format!("{root}/sessions/{sid}/commands"))
        .bearer_auth(token(a))
        .json(&json!({"kind":"resume","runId":run,"clientCommandId":invalid}))
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), 403);
    exec(
        db,
        "UPDATE agent_v2_runs SET context_snapshot=$2 WHERE id=$1::uuid",
        vec![id(run), yaya_agent_v2::store::js(snapshot)],
    )
    .await
    .unwrap();
    assert!(
        client
            .post(format!("{root}/sessions/{sid}/commands"))
            .bearer_auth(token(a))
            .json(&json!({"kind":"cancel","clientCommandId":Uuid::new_v4()}))
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
}
