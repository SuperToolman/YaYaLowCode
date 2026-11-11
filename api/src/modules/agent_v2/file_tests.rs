use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionTrait};
use yaya_agent_v2::store::{exec, js};

pub(super) async fn verify(
    db: &DatabaseConnection,
    client: &reqwest::Client,
    root: &str,
    a: Uuid,
    b: Uuid,
    tenant: Uuid,
) {
    let scope = Scope {
        tenant_id: tenant,
        user_id: a,
    };
    let storage = Store { db: db.clone() };
    let sid = Uuid::parse_str(
        storage.create_session(&scope, "employee-a").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let other = Uuid::parse_str(
        storage.create_session(&scope, "employee-b").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let fid = Uuid::new_v4();
    let url = format!("{root}/sessions/{sid}/files");
    let payload = json!({"clientFileId":fid,"name":"test.csv","data":STANDARD.encode(b"name,value\nhello,42")});
    let upload = || {
        client
            .post(&url)
            .bearer_auth(super::tests::token(a))
            .json(&payload)
    };
    let response = upload().send().await.unwrap();
    assert_eq!(response.status(), 200);
    let first: Value = response.json().await.unwrap();
    assert_eq!(first["mimeType"], "text/csv");
    assert_eq!(
        first,
        upload()
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    );
    let bad = client
        .post(&url)
        .bearer_auth(super::tests::token(a))
        .json(&json!({"clientFileId":fid,"name":"test.csv","data":STANDARD.encode(b"different")}))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 409);
    let response = client
        .get(format!("{url}/{fid}"))
        .bearer_auth(super::tests::token(a))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(
        response.bytes().await.unwrap().as_ref(),
        b"name,value\nhello,42"
    );
    for suffix in ["".to_owned(), format!("/{fid}")] {
        assert_eq!(
            client
                .get(format!("{url}{suffix}"))
                .bearer_auth(super::tests::token(b))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
    }
    // Employee B is not assigned; even an own session is denied.
    assert_eq!(
        client
            .get(format!("{root}/sessions/{other}/files/{fid}"))
            .bearer_auth(super::tests::token(a))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let another = Uuid::parse_str(
        storage.create_session(&scope, "employee-a").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        client
            .get(format!("{root}/sessions/{another}/files/{fid}"))
            .bearer_auth(super::tests::token(a))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    for name in ["../x.txt", "C:\\secret.txt", "a\r\nb.txt"] {
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(super::tests::token(a))
                .json(&json!({"clientFileId":Uuid::new_v4(),"name":name,"data":"eA=="}))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    let cross = Command::Prompt {
        client_command_id: Uuid::new_v4(),
        parts: vec![yaya_agent_v2::domain::ContentPart::File { file_id: fid }],
    };
    assert!(storage.submit(&scope, another, &cross).await.is_err());
    let invalid_image = Command::Prompt {
        client_command_id: Uuid::new_v4(),
        parts: vec![yaya_agent_v2::domain::ContentPart::Image { file_id: fid }],
    };
    assert!(storage.submit(&scope, sid, &invalid_image).await.is_err());
    let response = storage.submit(&scope, sid, &cross).await.unwrap();
    let run = Uuid::parse_str(response["runId"].as_str().unwrap()).unwrap();
    let owner = Uuid::new_v4();
    let employee = installed()
        .await
        .unwrap()
        .into_iter()
        .find(|e| e.id == "employee-a")
        .unwrap();
    let snapshot = json!({"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"employee_version":employee_version(&employee),"action_grants":["agent.window"],"allowed_tools":["workspace_write_file","workspace_write_document","workspace_list_files","workspace_read_file"]});
    let claim_tx = db.begin().await.unwrap();
    exec(
        &claim_tx,
        "SET LOCAL yaya.agent_execution_protocol='2'",
        vec![],
    )
    .await
    .unwrap();
    exec(&claim_tx,"UPDATE agent_v2_runs SET status='running',lease_owner=$2::uuid,lease_epoch=1,lease_until=now()+interval '2 minutes',context_snapshot=$3 WHERE id=$1::uuid",vec![id(run),id(owner),js(snapshot)]).await.unwrap();
    claim_tx.commit().await.unwrap();
    let base = root.trim_end_matches("/api/agent/v2");
    let internal = format!("{base}/api/internal/agent-v2/runs/{run}");
    let secret = std::env::var("YAYA_AGENT_V2_WORKER_SECRET").unwrap();
    let model = client
        .get(format!("{internal}/files/{fid}"))
        .header("x-agent-v2-worker-secret", &secret)
        .query(&[("owner", owner.to_string()), ("epoch", "1".into())])
        .send()
        .await
        .unwrap();
    assert_eq!(model.status(), 200);
    assert_eq!(model.json::<Value>().await.unwrap()["name"], "test.csv");
    let orphan = Uuid::new_v4();
    client
        .post(&url)
        .bearer_auth(super::tests::token(a))
        .json(&json!({"clientFileId":orphan,"name":"orphan.txt","data":"eA=="}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(
        client
            .get(format!("{internal}/files/{orphan}"))
            .header("x-agent-v2-worker-secret", &secret)
            .query(&[("owner", owner.to_string()), ("epoch", "1".into())])
            .send()
            .await
            .unwrap()
            .status(),
        404,
        "unreferenced/future attachments cannot enter model input"
    );
    let call = json!({"call":{"id":"write-1","name":"workspace_write_file","arguments":{"name":"answer.md","text":"# answer\n42"}}});
    let invoke = |epoch: &str| {
        client
            .post(format!("{internal}/workspace/invoke"))
            .header("x-agent-v2-worker-secret", &secret)
            .query(&[("owner", owner.to_string()), ("epoch", epoch.to_owned())])
            .json(&call)
    };
    let output = invoke("1").send().await.unwrap();
    assert_eq!(output.status(), 200);
    let output: Value = output.json().await.unwrap();
    assert_eq!(output["result"]["source"], "generated");
    assert_eq!(
        output,
        invoke("1")
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        "effect is replayed before worker checkpoint"
    );
    assert_eq!(
        invoke("0").send().await.unwrap().status(),
        403,
        "stale worker cannot save files"
    );
    let count=rows(db,"SELECT jsonb_build_object('count',count(*))::text data FROM agent_v2_files WHERE run_id=$1::uuid",vec![id(run)]).await.unwrap();
    assert_eq!(count[0]["count"], 1);
    // Real subprocess + broker + persistence; no DSH and no office-suite service.
    for (name, document, format) in [
        (
            "报价.xlsx",
            json!({"sheets":[{"name":"BOM","rows":[["型号","数量"],["00123",42]]}]}),
            "xlsx",
        ),
        (
            "报告.docx",
            json!({"title":"报价验收","paragraphs":["测试值 42"]}),
            "docx",
        ),
        (
            "汇报.pptx",
            json!({"slides":[{"title":"测试","paragraphs":["测试值 42"]}]}),
            "pptx",
        ),
    ] {
        let request = json!({"call":{"id":format!("office-{format}"),"name":"workspace_write_document","arguments":{"name":name,"document":document}}});
        let send = || {
            client
                .post(format!("{internal}/workspace/invoke"))
                .header("x-agent-v2-worker-secret", &secret)
                .query(&[("owner", owner.to_string()), ("epoch", "1".into())])
                .json(&request)
                .send()
        };
        let response = send().await.unwrap();
        assert_eq!(response.status(), 200);
        let generated: Value = response.json().await.unwrap();
        assert!(generated["result"].get("error").is_none(), "{generated}");
        assert_eq!(generated["result"]["source"], "generated");
        assert_eq!(
            generated,
            send().await.unwrap().json::<Value>().await.unwrap(),
            "office replay must return the same immutable file"
        );
        let file_id = generated["result"]["id"].as_str().unwrap();
        let response=client.post(format!("{internal}/workspace/invoke")).header("x-agent-v2-worker-secret",&secret).query(&[("owner",owner.to_string()),("epoch","1".into())]).json(&json!({"call":{"id":format!("read-{format}"),"name":"workspace_read_file","arguments":{"fileId":file_id}}})).send().await.unwrap();
        assert_eq!(response.status(), 200);
        let parsed: Value = response.json().await.unwrap();
        assert_eq!(parsed["result"]["format"], format, "{parsed}");
        assert!(parsed["result"].to_string().contains("42"));
        let bytes = client
            .get(format!("{url}/{file_id}"))
            .bearer_auth(super::tests::token(a))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert!(
            bytes.starts_with(b"PK"),
            "office downloads must contain real OOXML, not renamed text"
        );
    }
    let count=rows(db,"SELECT jsonb_build_object('count',count(*))::text data FROM agent_v2_files WHERE run_id=$1::uuid",vec![id(run)]).await.unwrap();
    assert_eq!(count[0]["count"], 4);
    let fake=client.post(format!("{internal}/workspace/invoke")).header("x-agent-v2-worker-secret",&secret).query(&[("owner",owner.to_string()),("epoch","1".into())]).json(&json!({"call":{"id":"fake-office","name":"workspace_write_file","arguments":{"name":"fake.xlsx","text":"not a real workbook"}}})).send().await.unwrap().json::<Value>().await.unwrap();
    assert_eq!(
        fake["result"]["error"]["code"],
        "binary_output_requires_document_tool"
    );
    exec(
        db,
        "UPDATE agent_v2_runs SET status='cancel_requested' WHERE id=$1::uuid",
        vec![id(run)],
    )
    .await
    .unwrap();
    assert_eq!(
        invoke("1").send().await.unwrap().status(),
        403,
        "cancelled run cannot publish late outputs"
    );
    db.execute_unprepared(&format!(
        "UPDATE agent_v2_runs SET status='cancelled',lease_until=NULL WHERE id='{run}'"
    ))
    .await
    .unwrap();
    // One remaining slot: concurrent uploads must serialize on the session lock.
    exec(db,"INSERT INTO agent_v2_files(id,session_id,name,mime_type,size,sha256,source,contents) SELECT gen_random_uuid(),$1::uuid,'fixture-'||n||'.txt','text/plain',1,'fixture','upload',decode('78','hex') FROM generate_series(1,199) n",vec![id(another)]).await.unwrap();
    let quota_upload = |name: &str| {
        client
            .post(format!("{root}/sessions/{another}/files"))
            .bearer_auth(super::tests::token(a))
            .json(&json!({"clientFileId":Uuid::new_v4(),"name":name,"data":"eA=="}))
            .send()
    };
    let (left, right) = tokio::join!(quota_upload("left.txt"), quota_upload("right.txt"));
    let mut statuses = [
        left.unwrap().status().as_u16(),
        right.unwrap().status().as_u16(),
    ];
    statuses.sort();
    assert_eq!(
        statuses,
        [200, 400],
        "parallel uploads cannot exceed workspace quota"
    );
    let count=rows(db,"SELECT jsonb_build_object('count',count(*))::text data FROM agent_v2_files WHERE session_id=$1::uuid",vec![id(another)]).await.unwrap();
    assert_eq!(count[0]["count"], 200);
    // One invocation can publish several artifacts; each key is independently idempotent.
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let left = super::files::save_artifact(
        db,
        sid,
        first,
        "one.txt",
        b"one",
        Some(run),
        Some("multi"),
        "one.txt",
    )
    .await
    .unwrap();
    let right = super::files::save_artifact(
        db,
        sid,
        second,
        "two.txt",
        b"two",
        Some(run),
        Some("multi"),
        "two.txt",
    )
    .await
    .unwrap();
    assert_ne!(left["id"], right["id"]);
    assert_eq!(
        left,
        super::files::save_artifact(
            db,
            sid,
            first,
            "one.txt",
            b"one",
            Some(run),
            Some("multi"),
            "one.txt"
        )
        .await
        .unwrap()
    );
    assert!(
        super::files::save_artifact(
            db,
            sid,
            first,
            "one.txt",
            b"changed",
            Some(run),
            Some("multi"),
            "one.txt"
        )
        .await
        .is_err()
    );
    let rolled_back = Uuid::new_v4();
    let tx = db.begin().await.unwrap();
    super::files::save_artifact(
        &tx,
        sid,
        rolled_back,
        "rollback.txt",
        b"rollback",
        Some(run),
        Some("rollback"),
        "rollback.txt",
    )
    .await
    .unwrap();
    tx.rollback().await.unwrap();
    assert!(
        super::files::load(db, sid, rolled_back).await.is_err(),
        "artifacts participate in the execution transaction"
    );
    let execution = Uuid::new_v4();
    exec(db,"INSERT INTO agent_v2_executions(id,run_id,session_id,call_id,fingerprint,epoch,status,result) VALUES($1::uuid,$2::uuid,$3::uuid,'isolation','test',1,'succeeded','{}')",vec![id(execution),id(run),id(sid)]).await.unwrap();
    for suffix in [String::new(), format!("/{execution}")] {
        let endpoint = format!("{root}/sessions/{sid}/executions{suffix}");
        assert_eq!(
            client
                .get(&endpoint)
                .bearer_auth(super::tests::token(a))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get(&endpoint)
                .bearer_auth(super::tests::token(b))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
    }
    assert_eq!(
        client
            .get(format!("{root}/sessions/{other}/executions/{execution}"))
            .bearer_auth(super::tests::token(a))
            .send()
            .await
            .unwrap()
            .status(),
        403,
        "same user without employee usage cannot resolve another employee execution"
    );
    // History uses whole-turn keyset pages, persisted run statuses and a safe SSE cursor.
    let history = Uuid::parse_str(
        storage.create_session(&scope, "employee-a").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    for n in 1..=25 {
        storage
            .submit(
                &scope,
                history,
                &Command::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts: vec![yaya_agent_v2::domain::ContentPart::Text {
                        text: format!("turn-{n}"),
                    }],
                },
            )
            .await
            .unwrap();
    }
    exec(
        db,
        "UPDATE agent_v2_runs SET status='completed' WHERE session_id=$1::uuid",
        vec![id(history)],
    )
    .await
    .unwrap();
    exec(db,"INSERT INTO agent_v2_messages(id,session_id,run_id,role,parts) SELECT gen_random_uuid(),session_id,id,'assistant','[{\"type\":\"text\",\"text\":\"done\"}]'::jsonb FROM agent_v2_runs WHERE session_id=$1::uuid",vec![id(history)]).await.unwrap();
    let last=rows(db,"SELECT jsonb_build_object('id',id)::text data FROM agent_v2_runs WHERE session_id=$1::uuid ORDER BY queue_seq DESC LIMIT 1",vec![id(history)]).await.unwrap();
    let latest = Uuid::parse_str(last[0]["id"].as_str().unwrap()).unwrap();
    yaya_agent_v2::store::event(
        db,
        history,
        Some(latest),
        "message.delta",
        json!({"text":"old replay"}),
    )
    .await
    .unwrap();
    let endpoint = format!("{root}/sessions/{history}/messages");
    let page: Value = client
        .get(&endpoint)
        .bearer_auth(super::tests::token(a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 40);
    assert_eq!(page["items"][0]["parts"][0]["text"], "turn-6");
    assert_eq!(page["items"][39]["role"], "assistant");
    assert_eq!(page["items"][39]["run_status"], "completed");
    assert!(
        page["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["type"] != "message.delta"),
        "terminal turns do not replay historical streamed text"
    );
    assert_eq!(page["event_cursor"], 27);
    // A newly appended turn cannot shift or duplicate an older keyset page.
    storage
        .submit(
            &scope,
            history,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: vec![yaya_agent_v2::domain::ContentPart::Text { text: "new".into() }],
            },
        )
        .await
        .unwrap();
    let older: Value = client
        .get(&endpoint)
        .query(&[("before", page["next_before"].as_str().unwrap())])
        .bearer_auth(super::tests::token(a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(older["items"].as_array().unwrap().len(), 10);
    assert_eq!(older["items"][0]["parts"][0]["text"], "turn-1");
    assert!(older["next_before"].is_null());
    assert_eq!(
        client
            .get(&endpoint)
            .query(&[("before", "6")])
            .bearer_auth(super::tests::token(b))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    exec(
        db,
        "UPDATE agent_v2_runs SET status='cancelled' WHERE session_id=$1::uuid AND status='queued'",
        vec![id(history)],
    )
    .await
    .unwrap();
}
