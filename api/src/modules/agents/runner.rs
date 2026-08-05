use axum::response::sse::Event;
use futures_util::StreamExt;
use rig_core::agent::MultiTurnStreamItem;
use rig_core::client::CompletionClient;
use rig_core::completion::Message;
use rig_core::providers::openai;
use rig_core::streaming::{StreamedAssistantContent, StreamingPrompt};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::infrastructure::entities::agent_run_step_entity;
use crate::infrastructure::entities::{
    app_entity, app_navigation_entity, automation_flow_entity, form_definition_entity,
};
use crate::modules::agents::capabilities;
use crate::modules::agents::dto::AgentPageContext;
use crate::modules::agents::plugins::PluginTool;
use crate::modules::agents::tools::{
    AgentAccessScope, AggregateFormRecordsTool, CreateAutomationDraftTool,
    CreateDetailFormDraftTool, CreateFormDraftTool, CreateNavigationGroupTool,
    DeleteAutomationTool, DeleteFormTool, DeleteNavigationGroupTool,
    GetApplicationBusinessContextTool, GetAutomationGraphTool, GetDetailFormDefinitionTool,
    GetFormRelationshipsTool, GetFormSchemaTool, GetRelatedRecordsTool,
    GetWorkflowProcessDefinitionTool, GetWorkflowRecordRuntimeTool, ListAppsTool,
    ListAutomationsTool, ListDetailRecordsTool, ListFormRecordsTool, ListFormsTool,
    ListNavigationGroupsTool, MoveFormToGroupTool, PublishFormTool, QueryFormRecordsTool,
    SaveFormSchemaDraftTool,
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
    session_id: Uuid,
    runtime: ResolvedAgentRuntime,
    access: AgentAccessScope,
    context: AgentPageContext,
    approval_mode: String,
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
    } else {
        "你只能使用运行时资源清单中列出的工具。工具是否可用由绑定 Skill 的 allowedTools 决定；具体数据和写操作仍必须通过当前用户权限、Agent 作用域和审批策略。优先根据页面上下文调用工具，不要猜测表单或自动化结构。处理批量或多步骤任务时，先读取现有模板和实际结构，明确全部交付物，再集中执行这一阶段的操作。工具返回 executedAction 表示后端已经执行，并包含真实结果；你必须基于该结果继续工作并调用读取工具验证。工具返回 pendingAction 才表示操作正在等待界面批准，此时停止依赖该操作的后续步骤；不要要求用户在聊天中回复确认，因为聊天文字不会批准操作。每轮写操作之后必须主动重新读取实际数据，逐项验证名称、字段、草稿版本、发布版本、导航分组和自动化节点等完成条件；发现不一致时继续修正并再次检查。只有所有请求项都经过实际查询验证后才能宣称完成。不要用计划、提交数量、工具返回成功或待确认 ID 代替实际完成结果，也不得编造或推测 UUID。"
    };
    let approval_policy = match approval_mode.as_str() {
        "full_access" => {
            "当前批准模式：完全访问。所有已授权写工具会在调用期间直接执行，不会产生待确认操作。禁止要求用户确认；使用 executedAction 的真实结果继续并完成验证。"
        }
        "approve_on_behalf" => {
            "当前批准模式：替我审批。普通已授权写工具会直接执行；只有删除等危险操作可能返回 pendingAction。没有 pendingAction 时禁止要求用户确认。"
        }
        _ => {
            "当前批准模式：请求批准。写工具可能返回 pendingAction；批准只能通过界面审批条完成，用户在聊天中回复确认不代表操作已获批准。"
        }
    };
    let preamble = format!(
        "{}\n\n{}\n\n当前页面上下文：{}\n\n{}",
        settings.system_prompt,
        capabilities.prompt_context,
        context_json,
        format!("{interaction_policy}\n\n{approval_policy}"),
    );
    let allowed_app_id = context.app_id.clone();
    let agent = client
        .agent(settings.chat_model.clone())
        .preamble(&preamble)
        .temperature(settings.temperature)
        .tool(ListAppsTool {
            db: db.clone(),
            access: access.clone(),
            enabled: runtime.allowed_tools.contains("list_apps"),
        })
        .tool(GetApplicationBusinessContextTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime
                .allowed_tools
                .contains("get_application_business_context"),
        })
        .tool(ListFormsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_forms"),
        })
        .tool(GetFormSchemaTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("get_form_schema"),
        })
        .tool(GetFormRelationshipsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("get_form_relationships"),
        })
        .tool(GetRelatedRecordsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("get_related_records"),
        })
        .tool(ListFormRecordsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_form_records"),
        })
        .tool(QueryFormRecordsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("query_form_records"),
        })
        .tool(AggregateFormRecordsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("aggregate_form_records"),
        })
        .tool(GetDetailFormDefinitionTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("get_detail_form_definition"),
        })
        .tool(ListDetailRecordsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_detail_records"),
        })
        .tool(GetWorkflowProcessDefinitionTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime
                .allowed_tools
                .contains("get_workflow_process_definition"),
        })
        .tool(GetWorkflowRecordRuntimeTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime
                .allowed_tools
                .contains("get_workflow_record_runtime"),
        })
        .tool(ListAutomationsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: allowed_app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_automations"),
        })
        .tool(ListNavigationGroupsTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("list_navigation_groups"),
        })
        .tool(CreateNavigationGroupTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("create_navigation_group"),
        })
        .tool(DeleteNavigationGroupTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("delete_navigation_group"),
        })
        .tool(GetAutomationGraphTool {
            db: db.clone(),
            access: access.clone(),
            allowed_app_id,
            enabled: runtime.allowed_tools.contains("get_automation_graph"),
        })
        .tool(CreateAutomationDraftTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: true && runtime.allowed_tools.contains("create_automation_draft"),
        })
        .tool(DeleteAutomationTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("delete_automation"),
        })
        .tool(CreateFormDraftTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: true && runtime.allowed_tools.contains("create_form_draft"),
        })
        .tool(MoveFormToGroupTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("move_form_to_group"),
        })
        .tool(CreateDetailFormDraftTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: true && runtime.allowed_tools.contains("create_detail_form_draft"),
        })
        .tool(SaveFormSchemaDraftTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: true && runtime.allowed_tools.contains("save_form_schema_draft"),
        })
        .tool(PublishFormTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("publish_form"),
        })
        .tool(DeleteFormTool {
            db: db.clone(),
            session_id,
            access: access.clone(),
            allowed_app_id: context.app_id.clone(),
            enabled: runtime.allowed_tools.contains("delete_form"),
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
                let resource_name =
                    resolve_tool_resource_name(&db, &name, &arguments, &context).await;
                send_event(
                    &event_tx,
                    "tool.started",
                    json!({ "name": name, "arguments": arguments, "resourceName": resource_name }),
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

async fn resolve_tool_resource_name(
    db: &DatabaseConnection,
    tool_name: &str,
    arguments: &Value,
    context: &AgentPageContext,
) -> Option<String> {
    let arguments = arguments.as_object()?;
    if matches!(
        tool_name,
        "create_form_draft" | "create_automation_draft" | "create_navigation_group"
    ) {
        if let Some(name) = string_argument(arguments, &["name", "title"]) {
            return Some(name.to_string());
        }
    }
    if let Some(automation_id) = string_argument(arguments, &["automation_id", "automationId"]) {
        return automation_flow_entity::Entity::find()
            .filter(automation_flow_entity::Column::FlowUuid.eq(automation_id))
            .one(db)
            .await
            .ok()
            .flatten()
            .map(|flow| flow.name);
    }
    if let Some(group_id) = string_argument(
        arguments,
        &["group_id", "groupId", "parent_group_id", "parentGroupId"],
    ) {
        if let Ok(group_id) = uuid::Uuid::parse_str(group_id) {
            if let Some(group) = app_navigation_entity::Entity::find_by_id(group_id)
                .one(db)
                .await
                .ok()
                .flatten()
            {
                return Some(group.title);
            }
        }
    }
    if let Some(form_uuid) = string_argument(
        arguments,
        &[
            "form_uuid",
            "formUuid",
            "source_form_uuid",
            "sourceFormUuid",
            "detail_form_uuid",
            "detailFormUuid",
        ],
    ) {
        return form_definition_entity::Entity::find()
            .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
            .one(db)
            .await
            .ok()
            .flatten()
            .map(|form| form.name);
    }
    let app_id = string_argument(arguments, &["app_id", "appId"])
        .map(str::to_string)
        .or_else(|| context.app_id.clone());
    if app_id.is_some() && is_application_scoped_tool(tool_name) {
        return app_entity::Entity::find()
            .filter(app_entity::Column::RouteAppId.eq(app_id?))
            .one(db)
            .await
            .ok()
            .flatten()
            .map(|app| app.name);
    }
    None
}

fn string_argument<'a>(
    arguments: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| arguments.get(*key).and_then(Value::as_str))
}

fn is_application_scoped_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "get_application_business_context"
            | "list_forms"
            | "list_navigation_groups"
            | "create_navigation_group"
            | "delete_navigation_group"
            | "list_automations"
            | "create_form_draft"
            | "create_automation_draft"
    )
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
