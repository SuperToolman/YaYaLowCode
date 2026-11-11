use super::*;

#[test]
fn confirmed_write_results_tell_the_model_approval_and_commit_already_happened() {
    let result = json!({"appId":"test"});
    let output: Value =
        serde_json::from_str(&tool_result_text("platform_create_app", &result, true)).unwrap();
    assert_eq!(output["execution"]["userConfirmed"], true);
    assert_eq!(output["result"], result);
    let rejected = json!({"executed":false,"status":"rejected"});
    assert_eq!(
        tool_result_text("platform_create_app", &rejected, true),
        rejected.to_string()
    );
    assert_eq!(
        tool_result_text("platform_create_app", &result, false),
        result.to_string()
    );
    assert_eq!(
        tool_result_text("platform_list_apps", &result, true),
        result.to_string()
    );
}
use axum::{
    Json, Router,
    extract::State,
    response::IntoResponse,
    routing::{get, post},
};
use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;
use yaya_agent_v2::{
    domain::{Command, ContentPart, Scope, ToolCall},
    store::{exec, id, rows},
};

#[tokio::test]
#[ignore = "requires AGENT_V2_TEST_DATABASE_URL; isolated PostgreSQL schema and real Cordis process"]
async fn rig_stream_tool_and_worker_recovery() {
    let url = std::env::var("AGENT_V2_TEST_DATABASE_URL").unwrap();
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("agent_v2_runtime_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut opts = ConnectOptions::new(url);
    opts.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(opts).await.unwrap();
    db.execute_unprepared("CREATE TABLE iam_users(id uuid PRIMARY KEY)")
        .await
        .unwrap();
    db.execute_unprepared(concat!(
        include_str!("../../../core/schema.sql"),
        "\n",
        include_str!("../../../core/upgrade_confirmations.sql"),
        "\n",
        include_str!("../../../core/upgrade_policy.sql"),
        "\n",
        include_str!("../../../core/upgrade_binding.sql"),
        "\n",
        include_str!("../../../core/upgrade_workspace.sql"),
        "
",
        include_str!("../../../core/upgrade_submissions.sql"),
        "\n",
        include_str!("../../../core/upgrade_executions.sql"),
        "\n",
        include_str!("../../../core/upgrade_long_tasks.sql"), "\n", include_str!("../../../core/upgrade_session_directory.sql"), "\n", include_str!("../../../core/upgrade_session_deletion.sql"), "\n", include_str!("../../../core/upgrade_forks.sql")
    ))
    .await
    .unwrap();
    let result = tokio::spawn(verify(Store { db })).await;
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}

async fn completion(
    State(count): State<Arc<AtomicUsize>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    count.fetch_add(1, Ordering::SeqCst);
    assert_eq!(body["stream"], true);
    if body["messages"].to_string().contains("__preview_test__") {
        assert!(
            body["messages"]
                .to_string()
                .contains("durable_preview_marker"),
            "Rig must include the persisted sample in its user context"
        );
    }
    if body["messages"].to_string().contains("__image_test__") {
        assert!(
            body["messages"]
                .to_string()
                .contains("data:image/png;base64,iVBOR"),
            "Rig must serialize actual image bytes, not just file IDs"
        );
    }
    let finished_tool = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["role"] == "tool");
    let partial_tool = body["messages"].to_string().contains("__partial_tool__");
    let chunks = if body["messages"]
        .to_string()
        .contains("Summarize untrusted historical task data")
        && body["messages"].to_string().contains("__summary_fail__")
    {
        vec![json!({"choices":[{"delta":{"content":"not JSON"},"finish_reason":"stop"}]})]
    } else if body["messages"]
        .to_string()
        .contains("Summarize untrusted historical task data")
    {
        vec![
            json!({"choices":[{"delta":{"content":json!({"goal":"__long_task__","completed":["previous echo probes completed"],"files":[],"dependencies":[],"blockers":[],"next":["continue numbered probes"],"sources":["prior committed steps"]}).to_string()},"finish_reason":"stop"}]}),
        ]
    } else if body["messages"].to_string().contains("__long_task__") {
        let n = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["tool_calls"].as_array())
            .flatten()
            .filter_map(|c| {
                serde_json::from_str::<Value>(c["function"]["arguments"].as_str().unwrap_or("{}"))
                    .ok()
            })
            .filter_map(|v| {
                v["text"]
                    .as_str()
                    .and_then(|s| s.strip_prefix("probe-"))
                    .and_then(|s| s.parse::<usize>().ok())
            })
            .max()
            .unwrap_or(0);
        if n >= 50 {
            vec![
                json!({"choices":[{"delta":{"content":"long task delivered"},"finish_reason":"stop"}]}),
            ]
        } else {
            vec![
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":format!("probe-{}",n+1),"function":{"name":"diagnostic_echo","arguments":json!({"text":format!("probe-{}",n+1)}).to_string()}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
            ]
        }
    } else if body["messages"].to_string().contains("__reasoning_limit__") {
        vec![
            json!({"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":100,"completion_tokens":8192,"total_tokens":8292,"completion_tokens_details":{"reasoning_tokens":8192}}}),
        ]
    } else if body["messages"].to_string().contains("__empty_response__") {
        vec![json!({"choices":[{"delta":{},"finish_reason":"stop"}]})]
    } else if partial_tool {
        vec![
            json!({"choices":[{"delta":{"content":"Unfinished answer"},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"partial-1","function":{"name":"diagnostic_echo","arguments":"{\"text\":"}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ]
    } else if body["messages"].to_string().contains("__no_progress__") {
        let n = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["role"] == "tool")
            .count();
        if n >= 6 {
            vec![
                json!({"choices":[{"delta":{"content":"The model has identified a blocker and stopped."},"finish_reason":"stop"}]}),
            ]
        } else {
            vec![
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":format!("repeat-{n}"),"function":{"name":"diagnostic_echo","arguments":"{\"text\":\"same\"}"}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
            ]
        }
    } else if finished_tool {
        vec![
            json!({"choices":[{"delta":{"content":"verified answer"},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
        ]
    } else {
        assert!(
            body["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"] == "diagnostic_echo")
        );
        vec![
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"echo-1","function":{"name":"diagnostic_echo","arguments":"{\"text\":\"hello\"}"}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ]
    };
    let mut text = chunks
        .iter()
        .map(|c| format!("data: {c}\n\n"))
        .collect::<String>();
    text.push_str("data: [DONE]\n\n");
    ([("content-type", "text/event-stream")], text)
}

async fn verify(store: Store) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let base = format!("http://{address}");
    let model_base = format!("{base}/v1");
    let live_context = std::env::var("AGENT_V2_LIVE_CONTEXT")
        .ok()
        .map(|s| serde_json::from_str::<Value>(&s).unwrap());
    let live = live_context.is_some();
    let context = live_context.unwrap_or_else(||json!({"employee_id":"test","employee_version":"test-v1","system_prompt":"Use diagnostic_echo then answer.","allowed_tools":["diagnostic_echo"],"model":{"id":"fake","api_base_url":model_base,"api_key":"test-key","chat_model":"test-model"}}));
    let image_id = Uuid::new_v4();
    let document_id = Uuid::new_v4();
    let image_bytes = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=";
    let app = Router::new()
        .route(
            "/api/internal/agent-v2/runs/{run_id}/files/{file_id}",
            get(move |axum::extract::Path((_,fid)):axum::extract::Path<(Uuid,Uuid)>,headers: axum::http::HeaderMap| async move {
                assert_eq!(
                    headers["x-agent-v2-worker-secret"],
                    "test-secret-012345678901234567890123"
                );
                if fid==image_id {Json(json!({"name":"pixel.png","size":68,"mimeType":"image/png","data":image_bytes}))}
                else {Json(json!({"name":"test.xlsx","size":4,"mimeType":"application/octet-stream","data":"dGVzdA==","preview":{"status":"completed","sample":{"text":"durable_preview_marker","sampleOnly":true}}}))}
            }),
        )
        .route(
            "/api/internal/agent-v2/runs/{run_id}/files/{file_id}/preview",
            post(|| async { Json(json!({"status":"skipped","reason":"image_passthrough"})) }),
        )
        .route("/v1/chat/completions", post(completion))
        .with_state(count.clone())
        .route(
            "/api/internal/agent-v2/runs/{run_id}/context",
            get(move || {
                let context = context.clone();
                async move { Json(context) }
            }),
        );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let config = Config {
        api_url: base,
        worker_secret: "test-secret-012345678901234567890123".into(),
        host_path: std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../cordis-host/src/host.mjs"),
        lease_seconds: 30,
        context_tokens: 32768,
        max_attempts: 3,
        request_seconds: if live { 120 } else { 10 },
        idle_seconds: if live { 30 } else { 3 },
        first_token_seconds: if live { 60 } else { 3 },
        connect_seconds: 3,
        max_completion_tokens: 8192,
    };
    let scope = Scope {
        tenant_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
    };
    exec(
        &store.db,
        "INSERT INTO iam_users(id) VALUES($1::uuid)",
        vec![id(scope.user_id)],
    )
    .await
    .unwrap();
    let sid = Uuid::parse_str(
        store.create_session(&scope, "test").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    if !live {
        exec(&store.db,"INSERT INTO agent_v2_files(id,session_id,name,mime_type,size,sha256,source,contents) VALUES($1::uuid,$2::uuid,'test.xlsx','application/octet-stream',1,'test','upload',decode('78','hex'))",vec![id(document_id),id(sid)]).await.unwrap();
        exec(&store.db,"INSERT INTO agent_v2_files(id,session_id,name,mime_type,size,sha256,source,contents) VALUES($1::uuid,$2::uuid,'pixel.png','image/png',1,'test','upload',decode('78','hex'))",vec![id(image_id),id(sid)]).await.unwrap();
    }
    store
        .submit(
            &scope,
            sid,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: if live {vec![ContentPart::Text {text:"Call diagnostic_echo exactly once with text hello. Then answer briefly using the actual tool result.".into()}]} else {vec![ContentPart::Text {text:"__image_test__ __preview_test__ Call diagnostic_echo".into()},ContentPart::Image{file_id:image_id},ContentPart::File{file_id:document_id}]},
            },
        )
        .await
        .unwrap();
    let lease = store
        .claim(Uuid::new_v4(), if live { 300 } else { 30 })
        .await
        .unwrap()
        .unwrap();
    // Regression: a large employee prompt + full tool catalogue + attachment
    // metadata must not pause the first request based on a byte heuristic.
    let lease = if !live {
        let mut employee: ExecutionContext =
            serde_json::from_value(internal(&config, &lease, "context").await.unwrap()).unwrap();
        employee.system_prompt = "员工技能说明".repeat(20000);
        employee.allowed_tools = yaya_agent_v2::tools::registry()
            .into_iter()
            .map(|t| t.id)
            .collect();
        let mut draft = Checkpoint::default();
        draft.messages.push(TranscriptItem {
            reasoning: String::new(),
            role: "user".into(),
            text: "整理BOM".into(),
            calls: vec![],
            tool_call_id: None,
            attachments: vec![image_id, document_id],
        });
        let prepared = long_context::prepare(&config, &store, &lease, &employee, &draft)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(prepared.messages.len(), 1);
        assert_eq!(store.run(lease.run_id).await.unwrap()["model_requests"], 0);
        assert_eq!(store.run(lease.run_id).await.unwrap()["status"], "running");
        // A pre-fix context pause is recovered by the scheduler, without a
        // browser resume command or a new message/tool invocation.
        let (_, mut frozen) = prepare_run(&config, &store, &lease).await.unwrap();
        let mut old_registry = json!(yaya_agent_v2::tools::registry());
        for tool in old_registry.as_array_mut().unwrap() {
            if let Some(description) = tool["description"].as_str() {
                tool["description"]=json!(description.replace("timeoutSeconds defaults to 600 and accepts 1..7200 per invocation; the task has no cumulative execution budget.","timeoutSeconds defaults to 600, accepts 1..7200 and is bounded by the remaining task budget."));
            }
        }
        frozen["tool_contract_hash"] = json!(yaya_agent_v2::store::fingerprint(&old_registry));
        exec(
            &store.db,
            "UPDATE agent_v2_runs SET context_snapshot=$2 WHERE id=$1::uuid",
            vec![id(lease.run_id), yaya_agent_v2::store::js(frozen)],
        )
        .await
        .unwrap();
        store
            .suspend(&lease, "paused", "context_unshrinkable")
            .await
            .unwrap();
        let recovered = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
        assert_eq!(recovered.run_id, lease.run_id);
        assert!(recovered.epoch > lease.epoch);
        assert!(store.heartbeat(&lease, 30).await.is_err());
        assert!(store.run(lease.run_id).await.unwrap()["pause_reason"].is_null());
        recovered
    } else {
        lease
    };
    if let Ok(replay) = std::env::var("AGENT_V2_REPLAY_CHECKPOINT") {
        // Read-only replay of already parsed tool output, isolated from the source
        // session. No original tool is rerun and no generated write is executed.
        let mut cp: Checkpoint = serde_json::from_str(&replay).unwrap();
        for item in &mut cp.messages {
            item.attachments.clear();
        }
        let context: ExecutionContext =
            serde_json::from_value(internal(&config, &lease, "context").await.unwrap()).unwrap();
        let result = model::step(
            &config,
            &store,
            &lease,
            &context,
            &cp,
            model::definitions(&context.allowed_tools),
        )
        .await;
        match result {
            Ok((answer, usage)) => println!(
                "Replay model succeeded: answer_bytes={}, tool_calls={}, usage={}",
                answer.text.len(),
                answer.calls.len(),
                usage
            ),
            Err(error) => {
                let metadata = error
                    .chain()
                    .map(ToString::to_string)
                    .filter(|s| s.starts_with("provider_error_kind="))
                    .collect::<Vec<_>>();
                panic!(
                    "Replay model failed: safe_code={}, safe_metadata={metadata:?}",
                    error_code(&error)
                )
            }
        }
        server.abort();
        return;
    }
    execute(&config, &store, &lease).await.unwrap();
    assert_eq!(
        store.run(lease.run_id).await.unwrap()["status"],
        "completed"
    );
    if !live {
        assert_eq!(count.load(Ordering::SeqCst), 2);
        let page = store.message_page(sid, None).await.unwrap();
        assert!(page["events"].as_array().unwrap().iter().any(|e| e["type"]=="step.completed" && e["payload"]["text"]=="verified answer"));
        // Existing completed steps predate text in events; restore from their durable response.
        exec(&store.db,"UPDATE agent_v2_events SET payload=payload-'text' WHERE run_id=$1::uuid AND type='step.completed'",vec![id(lease.run_id)]).await.unwrap();
        let page = store.message_page(sid, None).await.unwrap();
        assert!(page["events"].as_array().unwrap().iter().any(|e| e["type"]=="step.completed" && e["payload"]["text"]=="verified answer"));
        assert_eq!(
            store.messages(sid).await.unwrap().last().unwrap()["parts"][0]["text"],
            "verified answer"
        );
    }
    let tool = rows(
        &store.db,
        "SELECT row_to_json(t)::text data FROM agent_v2_tool_invocations t WHERE run_id=$1::uuid",
        vec![id(lease.run_id)],
    )
    .await
    .unwrap();
    assert_eq!(tool.len(), 1);
    assert_eq!(tool[0]["result"]["source"], "cordis");
    if live {
        assert!(
            !store.messages(sid).await.unwrap().last().unwrap()["parts"][0]["text"]
                .as_str()
                .unwrap()
                .is_empty()
        );
        assert!(
            store
                .events(sid, 0)
                .await
                .unwrap()
                .iter()
                .any(|e| e["type"] == "message.delta")
        );
        server.abort();
        return;
    }
    // Simulate process death after committing the completed tool result/checkpoint.
    let run = store.run(lease.run_id).await.unwrap();
    let mut cp: Checkpoint = serde_json::from_value(run["checkpoint"].clone()).unwrap();
    cp.messages.pop();
    cp.step = 1;
    exec(&store.db,"UPDATE agent_v2_runs SET status='running',checkpoint=$2,lease_until=now()-interval '1 second' WHERE id=$1::uuid",vec![id(lease.run_id),yaya_agent_v2::store::js(serde_json::to_value(cp).unwrap())]).await.unwrap();
    let recovered = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    execute(&config, &store, &recovered).await.unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 3);
    let events = store.events(sid, 0).await.unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "tool.completed")
            .count(),
        1
    );
    assert_eq!(store.messages(sid).await.unwrap().len(), 2);
    // Rig drops incomplete tools and still emits Final. Text accompanying that partial
    // call must not turn the run into a successful answer or execute a normalized tool.
    let partial_session = Uuid::parse_str(
        store.create_session(&scope, "test").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    store
        .submit(
            &scope,
            partial_session,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: vec![ContentPart::Text {
                    text: "__partial_tool__".into(),
                }],
            },
        )
        .await
        .unwrap();
    let partial_lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let error = execute(&config, &store, &partial_lease).await.unwrap_err();
    assert_eq!(error_code(&error), "provider_retryable");
    assert_eq!(store.messages(partial_session).await.unwrap().len(), 1);
    assert!(
        !store
            .events(partial_session, 0)
            .await
            .unwrap()
            .iter()
            .any(|e| e["type"] == "tool.started" || e["type"] == "run.completed")
    );
    for (marker, code) in [
        ("__reasoning_limit__", "model_output_limit"),
        ("__empty_response__", "empty_model_response"),
    ] {
        let session = Uuid::parse_str(
            store.create_session(&scope, "test").await.unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        store
            .submit(
                &scope,
                session,
                &Command::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts: vec![ContentPart::Text {
                        text: marker.into(),
                    }],
                },
            )
            .await
            .unwrap();
        let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
        let error = execute(&config, &store, &lease).await.unwrap_err();
        assert_eq!(error_code(&error), code);
        let events = store.events(session, 0).await.unwrap();
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "model.response_failed" && e["payload"]["errorCode"] == code)
        );
        assert!(
            !serde_json::to_string(&events)
                .unwrap()
                .contains("private reasoning")
        );
        store
            .finish(&lease, "failed", "", Some(code))
            .await
            .unwrap();
    }
    verify_rejected_tool_recovery(&store, &config, &scope).await;
    let mut long_config = config;
    long_config.context_tokens = 20000;
    let sid = Uuid::parse_str(
        store.create_session(&scope, "test").await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    store
        .submit(
            &scope,
            sid,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: vec![ContentPart::Text {
                    text: "__long_task__".into(),
                }],
            },
        )
        .await
        .unwrap();
    let first = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
    execute(&long_config, &store, &first).await.unwrap();
    // One execution continues past the former 48-step ceiling.
    let next = first;
    let done = store.run(next.run_id).await.unwrap();
    assert_eq!(done["status"], "completed");
    assert_eq!(done["checkpoint"]["step"], 51);
    assert!(
        done["model_requests"].as_i64().unwrap() > 51,
        "compaction requests are included in usage observations"
    );
    assert!(!done["context_summary"].is_null());
    assert!(
        done["checkpoint"]["messages"].as_array().unwrap().len() > 100,
        "raw transcript is never compacted"
    );
    let invocations=rows(&store.db,"SELECT jsonb_build_object('count',count(*))::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid",vec![id(next.run_id)]).await.unwrap();
    assert_eq!(invocations[0]["count"], 50);
    assert_eq!(store.messages(sid).await.unwrap().len(), 2);

    for (marker, reason) in [
        (
            "__long_task__ __summary_fail__",
            "context_compaction_failed",
        ),
        ("__no_progress__", "no_progress"),
    ] {
        let sid = Uuid::parse_str(
            store.create_session(&scope, "test").await.unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        store
            .submit(
                &scope,
                sid,
                &Command::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts: vec![ContentPart::Text {
                        text: marker.into(),
                    }],
                },
            )
            .await
            .unwrap();
        let lease = store.claim(Uuid::new_v4(), 300).await.unwrap().unwrap();
        execute(&long_config, &store, &lease).await.unwrap();
        let run = store.run(lease.run_id).await.unwrap();
        assert_eq!(run["status"], "completed");
        if reason == "no_progress" {
            assert_eq!(run["model_requests"], 7);
        } else {
            assert!(
                store
                    .events(sid, 0)
                    .await
                    .unwrap()
                    .iter()
                    .any(|e| e["type"] == "context.compaction_deferred")
            );
        }
        let events = store.events(sid, 0).await.unwrap();
        assert!(
            !events
                .iter()
                .any(|e| e["type"] == "message.delta" && e["payload"]["text"] == "not JSON")
        );
    }
    server.abort();
}

async fn pending_run(
    store: &Store,
    scope: &Scope,
    calls: Vec<ToolCall>,
) -> (Uuid, Lease, Checkpoint) {
    let session = store.create_session(scope, "test").await.unwrap();
    let sid = Uuid::parse_str(session["id"].as_str().unwrap()).unwrap();
    store
        .submit(
            scope,
            sid,
            &Command::Prompt {
                client_command_id: Uuid::new_v4(),
                parts: vec![ContentPart::Text {
                    text: "test persisted tools".into(),
                }],
            },
        )
        .await
        .unwrap();
    let lease = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    let cp = Checkpoint {
        progress_fingerprints: vec![],
        progress_warning: None,
        progress_warning_seen: false,
        messages: vec![
            TranscriptItem {
                reasoning: String::new(),
                role: "user".into(),
                text: "test persisted tools".into(),
                calls: vec![],
                tool_call_id: None,
                attachments: vec![],
            },
            TranscriptItem {
                reasoning: String::new(),
                role: "assistant".into(),
                text: String::new(),
                calls: calls.clone(),
                tool_call_id: None,
                attachments: vec![],
            },
        ],
        pending_calls: calls,
        step: 1,
    };
    store
        .checkpoint(&lease, &cp, "test.pending", json!({}))
        .await
        .unwrap();
    (sid, lease, cp)
}

async fn verify_rejected_tool_recovery(store: &Store, config: &Config, scope: &Scope) {
    let calls = vec![
        ToolCall {
            id: "unknown".into(),
            name: "unknown_tool".into(),
            arguments: json!({}),
        },
        ToolCall {
            id: "denied".into(),
            name: "platform_create_app".into(),
            arguments: json!({"name":"denied"}),
        },
        ToolCall {
            id: "invalid".into(),
            name: "diagnostic_echo".into(),
            arguments: json!({"unexpected":true}),
        },
    ];
    let (sid, lease, cp) = pending_run(store, scope, calls).await;
    execute(config, store, &lease).await.unwrap();
    let results = rows(&store.db, "SELECT jsonb_build_object('call_id',call_id,'status',status,'result',result)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid ORDER BY call_id", vec![id(lease.run_id)]).await.unwrap();
    assert_eq!(results.len(), 3);
    for result in &results {
        assert_eq!(result["status"], "failed");
        let expected = match result["call_id"].as_str().unwrap() {
            "unknown" => "unsupported_tool",
            "denied" => "tool_access_denied",
            "invalid" => "invalid_tool_arguments",
            _ => unreachable!(),
        };
        assert_eq!(result["result"]["error"]["code"], expected);
    }
    // Replay terminal failures from a checkpoint predating the results. Unknown
    // tools and bad arguments must not attempt to overwrite the saved failures.
    exec(&store.db, "UPDATE agent_v2_runs SET status='running',checkpoint=$2,lease_until=now()-interval '1 second' WHERE id=$1::uuid", vec![id(lease.run_id), yaya_agent_v2::store::js(serde_json::to_value(cp).unwrap())]).await.unwrap();
    let recovered = store.claim(Uuid::new_v4(), 30).await.unwrap().unwrap();
    execute(config, store, &recovered).await.unwrap();
    let events = store.events(sid, 0).await.unwrap();
    assert_eq!(
        events.iter().filter(|e| e["type"] == "tool.failed").count(),
        3
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "tool.started")
            .count(),
        3
    );
    let after = rows(&store.db, "SELECT jsonb_build_object('call_id',call_id,'status',status,'result',result)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid ORDER BY call_id", vec![id(lease.run_id)]).await.unwrap();
    assert_eq!(after, results);

    // A committed successful result cannot be rewritten as a failure or fed back
    // to the model after the employee loses the corresponding capability.
    let call = ToolCall {
        id: "revoked".into(),
        name: "platform_create_app".into(),
        arguments: json!({"name":"hidden"}),
    };
    let (sid, lease, cp) = pending_run(store, scope, vec![call.clone()]).await;
    store.tool_start(&lease, &call).await.unwrap();
    store
        .tool_end(&lease, &call.id, json!({"private":"do not replay"}), &cp)
        .await
        .unwrap();
    let error = execute(config, store, &lease).await.unwrap_err();
    assert_eq!(error_code(&error), "tool_access_denied");
    let saved = rows(&store.db, "SELECT jsonb_build_object('status',status,'result',result)::text data FROM agent_v2_tool_invocations WHERE run_id=$1::uuid AND call_id=$2", vec![id(lease.run_id), call.id.into()]).await.unwrap();
    assert_eq!(saved[0]["status"], "completed");
    assert_eq!(saved[0]["result"], json!({"private":"do not replay"}));
    assert!(
        !store
            .events(sid, 0)
            .await
            .unwrap()
            .iter()
            .any(|e| e["type"] == "message.delta" || e["type"] == "tool.failed")
    );
}

#[test]
fn model_failures_keep_actionable_codes() {
    for code in [
        "empty_model_response",
        "model_output_limit",
        "invalid_tool_call_id",
    ] {
        assert_eq!(error_code(&anyhow::anyhow!(code)), code);
    }
}
