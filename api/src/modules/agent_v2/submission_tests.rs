use super::*;
use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionTrait};
use sha2::{Digest, Sha256};
use yaya_agent_v2::store::exec;
async fn counts(db: &DatabaseConnection) -> Value {
    rows(db,"SELECT jsonb_build_object('sessions',(SELECT count(*) FROM agent_v2_sessions),'files',(SELECT count(*) FROM agent_v2_files),'messages',(SELECT count(*) FROM agent_v2_messages),'runs',(SELECT count(*) FROM agent_v2_runs))::text data",vec![]).await.unwrap().remove(0)
}
pub(super) async fn verify(
    db: &DatabaseConnection,
    client: &reqwest::Client,
    root: &str,
    a: Uuid,
    b: Uuid,
) {
    let token = super::tests::token(a);
    let other = super::tests::token(b);
    let fid = Uuid::new_v4();
    let bytes = b"part,qty\n00123,42";
    let input = json!({"clientRequestId":Uuid::new_v4(),"employeeId":"employee-a","sessionId":null,"text":"整理 BOM","attachments":[{"clientFileId":fid,"name":"bom.csv","size":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes))}]});
    let before = counts(db).await;
    let create = || {
        client
            .post(format!("{root}/submissions"))
            .bearer_auth(&token)
            .json(&input)
    };
    let response = create().send().await.unwrap();
    assert_eq!(response.status(), 200);
    let submission: Value = response.json().await.unwrap();
    let sid = submission["id"].as_str().unwrap();
    let url = format!("{root}/submissions/{sid}");
    assert_eq!(
        counts(db).await,
        before,
        "staging must not create any formal data"
    );
    assert_eq!(
        create()
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        submission
    );
    let mut changed = input.clone();
    changed["text"] = json!("different");
    assert_eq!(
        client
            .post(format!("{root}/submissions"))
            .bearer_auth(&token)
            .json(&changed)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    for suffix in ["", "/commit"] {
        let response = if suffix.is_empty() {
            client.get(format!("{url}{suffix}"))
        } else {
            client.post(format!("{url}{suffix}"))
        }
        .bearer_auth(&other)
        .send()
        .await
        .unwrap();
        assert_eq!(response.status(), 404);
    }
    let commit = || client.post(format!("{url}/commit")).bearer_auth(&token);
    assert_eq!(commit().send().await.unwrap().status(), 409);
    assert_eq!(counts(db).await, before);
    let upload = |data: Vec<u8>| {
        client
            .put(format!("{url}/attachments/{fid}"))
            .bearer_auth(&token)
            .header("content-type", "application/octet-stream")
            .body(data)
    };
    assert_eq!(
        upload(b"wrong".to_vec()).send().await.unwrap().status(),
        409
    );
    assert_eq!(upload(bytes.to_vec()).send().await.unwrap().status(), 200);
    assert_eq!(upload(bytes.to_vec()).send().await.unwrap().status(), 200);
    assert_eq!(counts(db).await, before);
    let (first, second) = tokio::join!(commit().send(), commit().send());
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.status(), 200);
    assert_eq!(second.status(), 200);
    let saved: Value = first.json().await.unwrap();
    assert_eq!(saved, second.json::<Value>().await.unwrap());
    assert_eq!(saved["status"], "committed");
    let after = counts(db).await;
    for key in ["sessions", "files", "messages", "runs"] {
        assert_eq!(
            after[key].as_i64().unwrap(),
            before[key].as_i64().unwrap() + 1
        );
    }
    assert_eq!(
        client
            .delete(&url)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        saved
    );
    assert_eq!(
        create()
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap(),
        saved,
        "lost commit response is recoverable by original key"
    );
    let contents=rows(db,"SELECT jsonb_build_object('empty',contents IS NULL)::text data FROM agent_v2_staged_files WHERE submission_id=$1::uuid",vec![sid.into()]).await.unwrap();
    assert_eq!(contents[0]["empty"], true);
    // Real parser, current worker authority, persistent preview, cache and stale epoch.
    let run = Uuid::parse_str(saved["result"]["runId"].as_str().unwrap()).unwrap();
    let owner = Uuid::new_v4();
    let employee = installed()
        .await
        .unwrap()
        .into_iter()
        .find(|e| e.id == "employee-a")
        .unwrap();
    let snapshot = json!({"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"employee_version":employee_version(&employee),"allowed_tools":["workspace_read_file"],"grants":["field_policy:default_visible_v1"],"action_grants":[]});
    let claim_tx = db.begin().await.unwrap();
    exec(
        &claim_tx,
        "SET LOCAL yaya.agent_execution_protocol='2'",
        vec![],
    )
    .await
    .unwrap();
    exec(&claim_tx,"UPDATE agent_v2_runs SET status='running',lease_owner=$2::uuid,lease_epoch=1,lease_until=now()+interval '1 minute',context_snapshot=$3 WHERE id=$1::uuid",vec![id(run),id(owner),yaya_agent_v2::store::js(snapshot)]).await.unwrap();
    claim_tx.commit().await.unwrap();
    let preview = |epoch: i64| {
        client.post(format!("{}/api/internal/agent-v2/runs/{run}/files/{fid}/preview?owner={owner}&epoch={epoch}",root.trim_end_matches("/api/agent/v2"))).header("x-agent-v2-worker-secret",std::env::var("YAYA_AGENT_V2_WORKER_SECRET").unwrap()).json(&json!({"skip":false}))
    };
    let response = preview(1).send().await.unwrap();
    assert_eq!(response.status(), 200);
    let parsed: Value = response.json().await.unwrap();
    assert_eq!(parsed["status"], "completed");
    assert!(parsed.to_string().contains("00123"));
    assert_eq!(
        parsed,
        preview(1)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    );
    assert_eq!(preview(0).send().await.unwrap().status(), 403);
    let public = format!(
        "{root}/sessions/{}/file-previews",
        saved["result"]["sessionId"].as_str().unwrap()
    );
    assert_eq!(
        client
            .get(&public)
            .bearer_auth(&other)
            .send()
            .await
            .unwrap()
            .status(),
        404
    ); // Foreign sessions are masked by the existing boundary.
    assert_eq!(
        client
            .get(&public)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["items"][0]["status"],
        "completed"
    );
    exec(
        db,
        "UPDATE agent_v2_runs SET status='cancelled' WHERE id=$1::uuid",
        vec![id(run)],
    )
    .await
    .unwrap();
    assert_eq!(preview(1).send().await.unwrap().status(), 403);
    // A cancelled run cannot publish late parser output; durable run state also
    // prevents a refresh from showing an interrupted preview as still parsing.
    exec(db,"UPDATE agent_v2_file_previews SET status='parsing',result='{}'::jsonb WHERE file_id=$1::uuid",vec![id(fid)]).await.unwrap();
    let stopped: Value = client
        .get(&public)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(stopped["items"][0]["status"], "skipped");
    assert_eq!(
        stopped["items"][0]["result"]["reason"],
        "run_terminated_before_preview_completed"
    );
    // Expiration and abandonment leave no business effect; cleanup frees uploaded bytes.
    let mut next = input.clone();
    next["clientRequestId"] = json!(Uuid::new_v4());
    let created: Value = client
        .post(format!("{root}/submissions"))
        .bearer_auth(&token)
        .json(&next)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let expired = created["id"].as_str().unwrap();
    exec(
        db,
        "UPDATE agent_v2_submissions SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
        vec![expired.into()],
    )
    .await
    .unwrap();
    assert_eq!(
        client
            .post(format!("{root}/submissions/{expired}/commit"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    submissions::cleanup(db).await.unwrap();
    assert_eq!(
        client
            .get(format!("{root}/submissions/{expired}"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["status"],
        "expired"
    );
    next["clientRequestId"] = json!(Uuid::new_v4());
    let abandoned: Value = client
        .post(format!("{root}/submissions"))
        .bearer_auth(&token)
        .json(&next)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let abandoned = abandoned["id"].as_str().unwrap();
    assert_eq!(
        client
            .delete(format!("{root}/submissions/{abandoned}"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(format!("{root}/submissions/{abandoned}/commit"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(counts(db).await, after);
    // A forced failure after promotion proves the entire new-session transaction rolls back.
    db.execute_unprepared("CREATE FUNCTION reject_submission_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload::text LIKE '%__reject_submission_test__%' THEN RAISE EXCEPTION 'test fault after file promotion'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_submission_test BEFORE INSERT ON agent_v2_commands FOR EACH ROW EXECUTE FUNCTION reject_submission_test();").await.unwrap();
    let mut fault = input.clone();
    fault["clientRequestId"] = json!(Uuid::new_v4());
    fault["text"] = json!("__reject_submission_test__");
    fault["attachments"][0]["clientFileId"] = json!(Uuid::new_v4());
    let staged: Value = client
        .post(format!("{root}/submissions"))
        .bearer_auth(&token)
        .json(&fault)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let fault_id = staged["id"].as_str().unwrap();
    let fault_file = fault["attachments"][0]["clientFileId"].as_str().unwrap();
    assert_eq!(
        client
            .put(format!(
                "{root}/submissions/{fault_id}/attachments/{fault_file}"
            ))
            .bearer_auth(&token)
            .header("content-type", "application/octet-stream")
            .body(bytes.to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(format!("{root}/submissions/{fault_id}/commit"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        counts(db).await,
        after,
        "formal session, promotion and message creation all roll back"
    );
    db.execute_unprepared("DROP TRIGGER reject_submission_test ON agent_v2_commands; DROP FUNCTION reject_submission_test();").await.unwrap();
    // Resource permission is rechecked at commit, not only at reservation/upload time.
    exec(
        db,
        "UPDATE iam_users SET status='disabled' WHERE id=$1::uuid",
        vec![id(a)],
    )
    .await
    .unwrap();
    assert_eq!(
        client
            .post(format!("{root}/submissions/{fault_id}/commit"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    exec(
        db,
        "UPDATE iam_users SET status='active' WHERE id=$1::uuid",
        vec![id(a)],
    )
    .await
    .unwrap();
    assert_eq!(counts(db).await, after);
    client
        .delete(format!("{root}/submissions/{fault_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    // Eight simultaneous 16 MiB reservations cannot exceed the 100 MiB per-user ceiling.
    let requests=(0..8).map(|_|{
        let body=json!({"clientRequestId":Uuid::new_v4(),"employeeId":"employee-a","sessionId":null,"text":"quota","attachments":(0..8).map(|_|json!({"clientFileId":Uuid::new_v4(),"name":"quota.bin","size":2*1024*1024,"sha256":"0".repeat(64)})).collect::<Vec<_>>()});
        client.post(format!("{root}/submissions")).bearer_auth(&token).json(&body).send()
    });
    let responses = futures_util::future::join_all(requests).await;
    let mut accepted = 0;
    for response in responses {
        let response = response.unwrap();
        if response.status() == 200 {
            accepted += 1;
            let item: Value = response.json().await.unwrap();
            client
                .delete(format!(
                    "{root}/submissions/{}",
                    item["id"].as_str().unwrap()
                ))
                .bearer_auth(&token)
                .send()
                .await
                .unwrap();
        } else {
            assert_eq!(response.status(), 400);
        }
    }
    assert_eq!(accepted, 6);
    assert_eq!(counts(db).await, after);
}
