mod long_context;
use crate::{
    Config,
    adapters::{cordis::Host, model},
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use yaya_agent_v2::{
    domain::{Checkpoint, ExecutionContext, TranscriptItem},
    store::{Lease, SavedToolResult, Store},
};

pub(crate) async fn internal(config: &Config, lease: &Lease, resource: &str) -> Result<Value> {
    let response = reqwest::Client::new()
        .get(format!(
            "{}/api/internal/agent-v2/runs/{}/{}",
            config.api_url, lease.run_id, resource
        ))
        .query(&[
            ("owner", lease.owner.to_string()),
            ("epoch", lease.epoch.to_string()),
        ])
        .header("x-agent-v2-worker-secret", &config.worker_secret)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .context("execution_context_unavailable")?;
    if !response.status().is_success() {
        if response.status().is_server_error() || response.status().as_u16() == 429 {
            bail!("execution_context_unavailable")
        }
        let body: Value = response.json().await.unwrap_or_default();
        if body["message"]
            .as_str()
            .is_some_and(|message| message.contains("task policy version changed"))
        {
            bail!("task_policy_changed")
        }
        bail!("execution_access_denied")
    }
    response
        .json()
        .await
        .context("execution_context_unavailable")
}
async fn prepare_run(
    config: &Config,
    store: &Store,
    lease: &Lease,
) -> Result<(ExecutionContext, Value)> {
    let current: ExecutionContext =
        serde_json::from_value(internal(config, lease, "context").await?)?;
    let contracts = json!(yaya_agent_v2::tools::registry());
    let contract_hash = yaya_agent_v2::store::fingerprint(&contracts);
    let snapshot=store.snapshot_context(lease,json!({"knowledge_scope":current.knowledge_scope,"knowledge_user_id":current.knowledge_user_id,"development_contract_hash":current.development_contract_hash,"employee_id":current.employee_id,"employee_version":current.employee_version,"skill_resources":current.skill_resources,"system_prompt":current.system_prompt,"allowed_tools":current.allowed_tools,"grants":current.grants,"action_grants":current.action_grants,"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"tool_contract_hash":contract_hash,"route_id":current.model.id,"api_base_url":current.model.api_base_url,"model":current.model.chat_model,"thinking_enabled":current.model.thinking_enabled,"reasoning_protocol":current.model.reasoning_protocol,"reasoning_effort":current.model.reasoning_effort,"reasoning_disabled":current.model.reasoning_disabled})).await?;
    if snapshot["development_contract_hash"].as_str().is_some_and(|hash| hash != current.development_contract_hash) { bail!("tool_contract_changed"); }
    if snapshot["policy_version"] != yaya_agent_v2::tools::POLICY_VERSION {
        bail!("task_policy_changed")
    }
    // Exact compatibility for the previous description-only timeout contract.
    // Tool schemas, names, action permissions and frozen capabilities are unchanged.
    let mut previous_contracts = contracts.clone();
    for tool in previous_contracts.as_array_mut().into_iter().flatten() {
        if let Some(description) = tool["description"].as_str() {
            tool["description"] = json!(description.replace("timeoutSeconds defaults to 600 and accepts 1..7200 per invocation; the task has no cumulative execution budget.","timeoutSeconds defaults to 600, accepts 1..7200 and is bounded by the remaining task budget."));
        }
    }
    let previous_contract_hash = yaya_agent_v2::store::fingerprint(&previous_contracts);
    if snapshot["tool_contract_hash"] != contract_hash
        && snapshot["tool_contract_hash"] != previous_contract_hash
    {
        bail!("tool_contract_changed")
    }
    if snapshot["route_id"] != current.model.id
        || snapshot["model"] != current.model.chat_model
        || snapshot["api_base_url"] != current.model.api_base_url
    {
        bail!("model_route_changed")
    }
    Ok((current, snapshot))
}
pub async fn execute(config: &Config, store: &Store, lease: &Lease) -> Result<()> {
    let run = store.run(lease.run_id).await?;
    let (current, snapshot) = prepare_run(config, store, lease).await?;
    let mut cp = if run["checkpoint"].as_object().is_some_and(|v| v.is_empty()) {
        Checkpoint::default()
    } else {
        serde_json::from_value(run["checkpoint"].clone())?
    };
    if cp.messages.is_empty() {
        // Only completed earlier turns are visible; later queued prompts cannot enter this run.
        let messages=yaya_agent_v2::store::rows(&store.db,"SELECT row_to_json(m)::text data FROM agent_v2_messages m JOIN agent_v2_runs r ON r.id=m.run_id WHERE m.session_id=$1::uuid AND r.queue_seq<=(SELECT queue_seq FROM agent_v2_runs WHERE id=$2::uuid) ORDER BY r.queue_seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END",vec![yaya_agent_v2::store::id(lease.session_id),yaya_agent_v2::store::id(lease.run_id)]).await?;
        for m in messages {
            let text = m["parts"]
                .as_array()
                .context("invalid message parts")?
                .iter()
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            cp.messages.push(TranscriptItem {
                reasoning: String::new(),
                role: m["role"].as_str().context("message role")?.into(),
                text,
                calls: vec![],
                tool_call_id: None,
                attachments: m["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|p| p["fileId"].as_str())
                    .filter_map(|s| uuid::Uuid::parse_str(s).ok())
                    .collect(),
            });
        }
        store
            .checkpoint(
                lease,
                &cp,
                "run.prepared",
                json!({"model":current.model.chat_model}),
            )
            .await?;
    }
    // Deterministic, durable preparation happens before the first model step.
    // On restart the API returns the versioned, session-owned cached sample.
    let current_files = yaya_agent_v2::store::rows(
        &store.db,
        "SELECT parts::text data FROM agent_v2_messages WHERE run_id=$1::uuid AND role='user'",
        vec![yaya_agent_v2::store::id(lease.run_id)],
    )
    .await?;
    let deadline_tx = store.fence(lease, false).await?;
    let budget=yaya_agent_v2::store::rows(&deadline_tx,"UPDATE agent_v2_runs SET attachment_prepare_deadline=COALESCE(attachment_prepare_deadline,now()+interval '60 seconds') WHERE id=$1::uuid RETURNING jsonb_build_object('seconds',GREATEST(0,extract(epoch FROM attachment_prepare_deadline-now())))::text data",vec![yaya_agent_v2::store::id(lease.run_id)]).await?.remove(0);
    deadline_tx.commit().await?;
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs_f64(budget["seconds"].as_f64().unwrap_or(0.0));
    for parts in current_files {
        for part in parts.as_array().into_iter().flatten() {
            let Some(fid) = part["fileId"].as_str() else {
                continue;
            };
            let skip = deadline
                .saturating_duration_since(std::time::Instant::now())
                .as_secs()
                < 22;
            let response = reqwest::Client::new()
                .post(format!(
                    "{}/api/internal/agent-v2/runs/{}/files/{fid}/preview",
                    config.api_url, lease.run_id
                ))
                .query(&[
                    ("owner", lease.owner.to_string()),
                    ("epoch", lease.epoch.to_string()),
                ])
                .header("x-agent-v2-worker-secret", &config.worker_secret)
                .json(&json!({"skip":skip}))
                .timeout(std::time::Duration::from_secs(25))
                .send()
                .await
                .context("execution_context_unavailable")?;
            if !response.status().is_success() {
                if response.status().is_server_error() {
                    bail!("execution_context_unavailable")
                }
                bail!("execution_access_denied")
            }
        }
    }
    let mut host: Option<Host> = None;
    loop {
        let mut context: ExecutionContext =
            serde_json::from_value(internal(config, lease, "context").await?)?;
        context.system_prompt = snapshot["system_prompt"]
            .as_str()
            .context("prompt snapshot")?
            .into();
        let locked: Vec<String> = serde_json::from_value(snapshot["allowed_tools"].clone())?;
        context.allowed_tools.retain(|t| locked.contains(t));
        if context.model.id != current.model.id
            || context.model.chat_model != current.model.chat_model
            || context.model.api_base_url != current.model.api_base_url
            || context.employee_version != current.employee_version
        {
            bail!("model_route_changed")
        }
        while !cp.pending_calls.is_empty() {
            let call = cp.pending_calls[0].clone();
            // Register before validation so rejected calls have a durable outcome too.
            // Successful data is not exposed until current tool authorization succeeds.
            let saved = store.tool_start(lease, &call).await?;
            let replaying = saved.is_some();
            let execution: Result<(Value, Option<&'static str>)> = async {
                // Refresh employee/RBAC authorization immediately before each tool, including replay.
                let fresh: ExecutionContext =
                    serde_json::from_value(internal(config, lease, "context").await?)?;
                // Safe failures contain no business data and must remain replayable even
                // for an unknown tool or invalid arguments. No tool is executed here.
                if let Some(SavedToolResult::Failed(value)) = &saved {
                    return Ok((value.clone(), Some("failed")));
                }
                let descriptor = if saved.is_some() {
                    yaya_agent_v2::tools::find(&call.name)
                } else {
                    Some(yaya_agent_v2::tools::find(&call.name).context("unsupported_tool")?)
                };
                if !context.allowed_tools.contains(&call.name)
                    || !fresh.allowed_tools.contains(&call.name)
                {
                    bail!("tool_access_denied")
                }
                if let Some(result) = saved {
                    let Some(descriptor)=descriptor else{return Ok((result_value(&result),Some(saved_status(&result))))};
                    if let Err(error)=yaya_agent_v2::tools::validate(&descriptor,&call.arguments){
                        if matches!(result,SavedToolResult::Failed(_)){return Ok((result_value(&result),Some("failed")))}
                        bail!(error)
                    }
                    return Ok(match result {
                        SavedToolResult::Completed(value) => (value, Some("completed")),
                        SavedToolResult::Failed(value) => (value, Some("failed")),
                    });
                }
                yaya_agent_v2::tools::validate(&descriptor.context("unsupported_tool")?, &call.arguments).map_err(anyhow::Error::msg)?;
                match call.name.as_str() {
                    "diagnostic_echo" => {
                        let args = call
                            .arguments
                            .as_object()
                            .context("invalid_tool_arguments")?;
                        if args.len() != 1
                            || args
                                .get("text")
                                .and_then(Value::as_str)
                                .is_none_or(|t| t.len() > 4096)
                        {
                            bail!("invalid_tool_arguments")
                        }
                        if host.is_none() {
                            host = Some(Host::start(&config.host_path).await?)
                        }
                        Ok((host.as_mut().context("plugin host")?.rpc("tool.invoke",json!({"invocationId":call.id,"name":call.name,"arguments":call.arguments,"scope":{"runId":lease.run_id,"sessionId":lease.session_id,"employeeId":context.employee_id}})).await?, None))
                    }
                    name if name.starts_with("knowledge_") || name.starts_with("platform_") || name.starts_with("workspace_") || name.starts_with("skill_") => {
                        let script = name.starts_with("skill_") || name=="workspace_execute_code";
                        let endpoint=if script {"executions"}else if name.starts_with("workspace_"){"workspace"}else{"tools"};
                        let response = loop {
                        let response = reqwest::Client::new()
                            .post(format!(
                                "{}/api/internal/agent-v2/runs/{}/{}/invoke",
                                config.api_url, lease.run_id, endpoint
                            ))
                            .query(&[
                                ("owner", lease.owner.to_string()),
                                ("epoch", lease.epoch.to_string()),
                            ])
                            .header("x-agent-v2-worker-secret", &config.worker_secret)
                            .json(&json!({"call":call}))
                            .timeout(std::time::Duration::from_secs(45))
                            .send()
                            .await
                            .context("platform_tool_unavailable")?;
                        if !response.status().is_success() {
                            if response.status().is_server_error() || response.status().as_u16()==429 {
                                bail!("platform_tool_unavailable")
                            }
                            bail!("platform_tool_rejected")
                        }
                        let response: Value = response.json().await.context("platform_tool_unavailable")?;
                        if response["executionPending"]==true {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            let _:ExecutionContext=serde_json::from_value(internal(config,lease,"context").await?)?;
                            continue;
                        }
                        break response;
                        };
                        if response["status"] == "waiting_confirmation" {
                            return Err(anyhow::anyhow!("waiting_confirmation"));
                        }
                        Ok((response["result"].clone(), None))
                    }
                    _ => bail!("tool_access_denied"),
                }
            }.await;
            let (result, replayed_status) = match execution {
                Ok(result) => result,
                Err(error) if error.to_string() == "waiting_confirmation" => return Ok(()),
                Err(error) => {
                    let code = error_code(&error);
                    // Never overwrite a committed outcome when access has changed.
                    // Infrastructure failures leave the pending call available for retry.
                    if replaying
                        || matches!(
                            code,
                            "platform_tool_unavailable" | "execution_context_unavailable"
                        )
                    {
                        return Err(error);
                    }
                    let failure = yaya_agent_v2::store::safe_tool_failure(code);
                    cp.messages.push(TranscriptItem {
                        reasoning: String::new(),
                        role: "tool".into(),
                        text: failure.to_string(),
                        calls: vec![],
                        tool_call_id: Some(call.id.clone()),
                        attachments: vec![],
                    });
                    cp.pending_calls.remove(0);
                    let stalled = long_context::progress(&mut cp, &call, &failure);
                    store.tool_failed(lease, &call.id, failure, &cp).await?;
                    if stalled {
                        store.finish(lease, "failed", "任务遇到重复且无进展的工具调用，已停止，避免持续空转。已完成的结果、文件和依赖仍保留。", Some("no_progress")).await?;
                        return Ok(());
                    }
                    if code == "execution_access_denied" {
                        return Err(error);
                    }
                    continue;
                }
            };
            cp.messages.push(TranscriptItem {
                reasoning: String::new(),
                role: "tool".into(),
                text: tool_result_text(&call.name, &result, replayed_status != Some("failed")),
                calls: vec![],
                tool_call_id: Some(call.id.clone()),
                attachments: vec![],
            });
            cp.pending_calls.remove(0);
            let outcome_unknown = result["status"] == "outcome_unknown";
            let no_progress =
                replayed_status.is_none() && long_context::progress(&mut cp, &call, &result);
            if let Some(status) = replayed_status {
                store
                    .replay_tool_result(lease, &call.id, status, &cp)
                    .await?;
            } else if (call.name.starts_with("workspace_") || call.name.starts_with("skill_"))
                && (result.get("error").is_some()
                    || ["failed", "timed_out", "cancelled", "outcome_unknown"]
                        .contains(&result["status"].as_str().unwrap_or("")))
            {
                let unknown = result["status"] == "outcome_unknown";
                store.tool_failed(lease, &call.id, result, &cp).await?;
                if unknown {
                    store
                        .suspend(lease, "manual_review", "outcome_unknown")
                        .await?;
                    return Ok(());
                }
            } else {
                store.tool_end(lease, &call.id, result, &cp).await?;
            }
            if outcome_unknown {
                store
                    .suspend(lease, "manual_review", "outcome_unknown")
                    .await?;
                return Ok(());
            }
            if no_progress {
                // Guidance only. The model decides whether to change approach or finish.
                cp.progress_warning_seen = false;
            }
        }
        if cp
            .messages
            .last()
            .is_some_and(|m| m.role == "assistant" && m.calls.is_empty())
        {
            let answer = cp.messages.last().context("answer")?.text.clone();
            if let Some(host) = host.take() {
                host.close().await?
            }
            store.finish(lease, "completed", &answer, None).await?;
            return Ok(());
        }
        let tools = model::definitions(&context.allowed_tools);
        context.system_prompt.push_str("\nExecution guidance: Continue the authorized task until it is complete or there is a concrete blocker; there is no task time, step or request quota. Read the selected Skill and execute its workflow. Missing dependencies: submit a separate installation call, then a new script invocation. Every call has a NEW input/output directory; pass fileIds on each call needing attachments, located at YAYA_INPUT_DIR/<fileId>/<original file name>. Use environment variables and pathlib for Unicode paths. Pass skillId for Skill resources/configuration; never print secrets. Deliver files under the current YAYA_OUTPUT_DIR. Session files/dependencies persist. Never repeat outcome_unknown operations.");
        if cp.progress_warning.is_some() {
            context.system_prompt.push_str("\nRepeated identical tool calls produced no progress. Stop repeating that probe: change approach or report the actual blocker. Choose another approach or explain the concrete blocker instead of repeating the same call.");
        }
        let Some(model_cp) = long_context::prepare(config, store, lease, &context, &cp).await?
        else {
            return Ok(());
        };
        store.record_model_request(lease).await?;
        store.step_start(lease,&cp,json!({"messages":cp.messages,"systemPrompt":context.system_prompt,"tools":context.allowed_tools,"routeId":context.model.id,"model":context.model.chat_model})).await?;
        let (answer, usage) = model::step(config, store, lease, &context, &model_cp, tools).await?;
        let mut unique = std::collections::HashSet::new();
        if answer
            .calls
            .iter()
            .any(|c| c.id.is_empty() || !unique.insert(c.id.clone()))
        {
            bail!("invalid_tool_call_id")
        }
        if cp.progress_warning.is_some() {
            cp.progress_warning_seen = true;
        }
        cp.pending_calls = answer.calls.clone();
        cp.messages.push(answer.clone());
        cp.step += 1;
        store
            .step_end(lease, &cp, json!({"answer":answer,"usage":usage}))
            .await?;
    }
}

fn tool_result_text(name: &str, result: &Value, completed: bool) -> String {
    if completed
        && result["executed"] != false
        && yaya_agent_v2::tools::find(name)
            .is_some_and(|tool| tool.effect_class == "platform_write")
    {
        // The broker returns successful write results only after approval + commit.
        // Preserve this fact in the checkpoint, including effect replay after a restart.
        json!({"execution":{"status":"completed","userConfirmed":true,
            "message":"The user approved this operation in the platform confirmation card. The business transaction has committed; this is the execution result, not a preview. Do not ask for the same confirmation again."},"result":result}).to_string()
    } else {
        result.to_string()
    }
}

fn result_value(result: &SavedToolResult) -> Value {
    match result {
        SavedToolResult::Completed(value) | SavedToolResult::Failed(value) => value.clone(),
    }
}
fn saved_status(result: &SavedToolResult) -> &'static str {
    match result {
        SavedToolResult::Completed(_) => "completed",
        SavedToolResult::Failed(_) => "failed",
    }
}

pub fn error_code(error: &anyhow::Error) -> &'static str {
    // Preserve the status from our sanitized adapter metadata even when another
    // layer wraps the classified error in a generic retry context.
    for cause in error.chain() {
        let message = cause.to_string();
        if message.starts_with("provider_error_kind=") {
            match message.rsplit_once("http_status=").map(|(_, value)| value) {
                Some("503") => return "provider_unavailable",
                Some("429") => return "provider_rate_limited",
                _ => {}
            }
        }
    }
    for code in [
        "provider_unavailable",
        "provider_rate_limited",
        "provider_retryable",
        "provider_rejected",
        "execution_access_denied",
        "execution_context_unavailable",
        "tool_access_denied",
        "invalid_tool_arguments",
        "unsupported_tool",
        "platform_tool_unavailable",
        "platform_tool_rejected",
        "step_budget_exceeded",
        "output_budget_exceeded",
        "tool_budget_exceeded",
        "invalid_model_response",
        "empty_model_response",
        "model_output_limit",
        "invalid_tool_call_id",
        "model_route_changed",
        "tool_contract_changed",
        "task_policy_changed",
        "attachment_context_budget_exceeded",
        "attachment_text_budget_exceeded",
    ] {
        if error.chain().any(|cause| cause.to_string() == code) {
            return code;
        }
    }
    "execution_failed"
}

#[cfg(test)]
mod tests;
