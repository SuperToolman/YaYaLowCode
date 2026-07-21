use axum::response::sse::Event;
use futures_util::StreamExt;
use rig_core::agent::MultiTurnStreamItem;
use rig_core::client::CompletionClient;
use rig_core::completion::Message;
use rig_core::providers::openai;
use rig_core::streaming::{StreamedAssistantContent, StreamingPrompt};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::infrastructure::entities::agent_run_step_entity;
use crate::modules::agents::capabilities;
use crate::modules::agents::dto::AgentPageContext;
use crate::modules::agents::plugins::PluginTool;
use crate::modules::agents::tools::{
    CreateFormDraftTool, GetAutomationGraphTool, GetFormSchemaTool, ListAppsTool,
    ListAutomationsTool, ListFormsTool, SaveFormSchemaDraftTool,
};
use crate::platform::config::ResolvedAgentRuntime;

pub(crate) struct AgentRunOutput {
    pub(crate) content: String,
    pub(crate) prompt_tokens: i64,
    pub(crate) completion_tokens: i64,
}

pub(crate) async fn execute_agent_run(
    db: DatabaseConnection,
    run_id: Uuid,
    runtime: ResolvedAgentRuntime,
    context: AgentPageContext,
    prompt: String,
    history: Vec<Message>,
    event_tx: mpsc::Sender<Event>,
) -> Result<AgentRunOutput, String> {
    let settings = runtime.settings.clone();
    let capabilities = capabilities::resolve(&runtime, &prompt);
    let client = openai::CompletionsClient::builder()
        .api_key(settings.api_key.clone())
        .base_url(settings.api_base_url.clone())
        .build()
        .map_err(|error| format!("create model client failed: {error}"))?;

    let context_json = serde_json::to_string(&context).unwrap_or_else(|_| "{}".to_string());
    let interaction_policy = if context.form_draft_assist.unwrap_or(false) {
        "你只能使用已注册的只读工具，不能创建、发布、删除或提交任何持久化数据。当前页面允许你协助填写浏览器中的未提交表单草稿：这只是在客户端更新字段值，不属于提交或持久化修改。用户要求填写时，应直接根据消息中提供的可填写字段与当前值完成，不要先进行不必要的表单分析；在正常回复末尾输出严格格式的不可见标记 <!--FORM_VALUES:{\"字段ID\":\"字段值\"}-->，仅包含需要填写或修改的字段。绝不能代替用户提交表单。"
    } else if runtime.allow_create_forms {
        "你可以使用已注册工具创建表单草稿，但只能在当前应用上下文或用户明确提供的应用 ID 中调用 create_form_draft。创建前应先读取现有表单以避免命名冲突；创建完成后报告工具返回的表单 ID 和草稿状态。绝不能发布、删除或修改已有表单，也不能创建、修改、发布或删除自动化。"
    } else {
        "你只能使用已注册的只读工具。不能创建、修改、发布或删除任何数据。如果用户要求修改，请说明当前 MVP 只能分析，并给出建议步骤。优先根据页面上下文调用工具，不要猜测表单或自动化结构。只要用户提供应用 ID，或询问应用中已有表单、自动化、命名冲突、数量或状态，必须先调用 list_forms 和/或 list_automations，再基于工具结果陈述事实；工具未调用或调用失败时，必须明确说未验证，绝不能声称应用为空或不存在冲突。"
    };
    let preamble = format!(
        "{}\n\n{}\n\n当前页面上下文：{}\n\n{}",
        settings.system_prompt, capabilities.prompt_context, context_json, interaction_policy,
    );
    let allowed_app_id = context.app_id.clone();
    let agent = client
        .agent(settings.chat_model.clone())
        .preamble(&preamble)
        .temperature(settings.temperature)
        .tool(ListAppsTool {
            db: db.clone(),
            enabled: runtime.allowed_tools.contains("list_apps"),
        })
        .tool(ListFormsTool {
            db: db.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_forms"),
        })
        .tool(GetFormSchemaTool {
            db: db.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("get_form_schema"),
        })
        .tool(ListAutomationsTool {
            db: db.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_automations"),
        })
        .tool(GetAutomationGraphTool {
            db: db.clone(),
            allowed_app_id,
            enabled: runtime.allowed_tools.contains("get_automation_graph"),
        })
        .tool(CreateFormDraftTool {
            db: db.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allow_create_forms
                && runtime.allowed_tools.contains("create_form_draft"),
        })
        .tool(SaveFormSchemaDraftTool {
            db: db.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allow_create_forms
                && runtime.allowed_tools.contains("save_form_schema_draft"),
        })
        .tool(PluginTool {
            plugins: runtime.plugins.clone(),
            context: context.clone(),
            enabled: runtime.allowed_tools.contains("call_plugin_tool"),
        })
        .build();

    send_event(&event_tx, "status", json!({ "status": "thinking" })).await;
    insert_step(
        &db,
        run_id,
        0,
        "model",
        "agent_started",
        json!({ "prompt": prompt, "historyCount": history.len() }),
        capabilities.audit_json,
        "running",
        None,
    )
    .await?;

    let mut stream = agent
        .stream_prompt(prompt)
        .history(history)
        .max_turns(settings.max_steps)
        .await;
    let mut content = String::new();
    let mut prompt_tokens = 0_i64;
    let mut completion_tokens = 0_i64;
    let mut step_index = 1_i32;

    while let Some(item) = stream.next().await {
        match item.map_err(|error| error.to_string())? {
            MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text)) => {
                content.push_str(&text.text);
                send_event(&event_tx, "message.delta", json!({ "delta": text.text })).await;
            }
            MultiTurnStreamItem::ToolExecutionStart { tool_call, .. } => {
                let name = tool_call.function.name.clone();
                let arguments = tool_call.function.arguments.clone();
                send_event(
                    &event_tx,
                    "tool.started",
                    json!({ "name": name, "arguments": arguments }),
                )
                .await;
                insert_step(
                    &db,
                    run_id,
                    step_index,
                    "tool",
                    &tool_call.function.name,
                    tool_call.function.arguments,
                    json!({}),
                    "running",
                    None,
                )
                .await?;
                step_index += 1;
            }
            MultiTurnStreamItem::StreamUserItem(tool_result) => {
                let output = serde_json::to_value(&tool_result).unwrap_or_else(|_| json!({}));
                send_event(&event_tx, "tool.completed", json!({ "result": output })).await;
                insert_step(
                    &db,
                    run_id,
                    step_index,
                    "tool_result",
                    "tool_completed",
                    json!({}),
                    output,
                    "completed",
                    None,
                )
                .await?;
                step_index += 1;
            }
            MultiTurnStreamItem::CompletionCall(call) => {
                prompt_tokens += call.usage.input_tokens as i64;
                completion_tokens += call.usage.output_tokens as i64;
            }
            MultiTurnStreamItem::FinalResponse(response) => {
                prompt_tokens = response.usage.input_tokens as i64;
                completion_tokens = response.usage.output_tokens as i64;
                if content.is_empty() {
                    content = response.output;
                    if !content.is_empty() {
                        send_event(&event_tx, "message.delta", json!({ "delta": content })).await;
                    }
                }
            }
            _ => {}
        }
    }

    if content.trim().is_empty() {
        content = "Agent 没有生成可显示的回答。".to_string();
    }
    insert_step(
        &db,
        run_id,
        step_index,
        "model",
        "agent_completed",
        json!({}),
        json!({ "contentLength": content.len() }),
        "completed",
        None,
    )
    .await?;

    Ok(AgentRunOutput {
        content,
        prompt_tokens,
        completion_tokens,
    })
}

async fn send_event(event_tx: &mpsc::Sender<Event>, event_name: &str, data: Value) {
    let _ = event_tx
        .send(Event::default().event(event_name).data(data.to_string()))
        .await;
}

async fn insert_step(
    db: &DatabaseConnection,
    run_id: Uuid,
    step_index: i32,
    step_type: &str,
    name: &str,
    input_json: Value,
    output_json: Value,
    status: &str,
    error_message: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now();
    agent_run_step_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        run_id: Set(run_id),
        step_index: Set(step_index),
        step_type: Set(step_type.to_string()),
        name: Set(name.to_string()),
        input_json: Set(input_json),
        output_json: Set(output_json),
        status: Set(status.to_string()),
        error_message: Set(error_message),
        started_at: Set(now.into()),
        completed_at: Set(Some(now.into())),
    }
    .insert(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}
