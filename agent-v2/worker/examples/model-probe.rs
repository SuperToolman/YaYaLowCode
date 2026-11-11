//! One model request, no tool execution. Credentials arrive only via stdin.
use futures_util::StreamExt;
use rig::{
    client::CompletionClient,
    completion::{CompletionModel, Message, ToolDefinition},
    providers::openai,
};
use serde_json::{Value, json};
use std::io::Read;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let value: Value = serde_json::from_str(&input)?;
    let client = openai::CompletionsClient::builder()
        .api_key(value["apiKey"].as_str().unwrap_or_default())
        .base_url(
            value["snapshot"]["api_base_url"]
                .as_str()
                .unwrap_or_default(),
        )
        .http_client(
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()?,
        )
        .build()?;
    let model = client.completion_model(value["snapshot"]["model"].as_str().unwrap_or_default());
    let tools = value["snapshot"]["allowed_tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|name| yaya_agent_v2::tools::find(name.as_str()?))
        .map(|t| ToolDefinition {
            name: t.id,
            description: t.description,
            parameters: t.input_schema,
        })
        .collect::<Vec<_>>();
    let mut messages = value["checkpoint"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| Message::user(m["text"].as_str().unwrap_or_default()))
        .collect::<Vec<_>>();
    let request = model
        .completion_request(messages.pop().unwrap())
        .messages(messages)
        .preamble(
            value["snapshot"]["system_prompt"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        )
        .tools(tools)
        .max_tokens(8192)
        .build();
    let result = tokio::time::timeout(std::time::Duration::from_secs(40), async {
        let mut stream = model.stream(request).await?;
        while let Some(item) = stream.next().await {
            item?;
            println!("SSE item decoded by Rig");
            break;
        }
        Ok::<_, rig::completion::CompletionError>(())
    })
    .await;
    match result {
        Ok(Ok(())) => println!("Model probe passed (no tools executed)"),
        Ok(Err(error)) => {
            // Classify SDK-authored diagnostics without printing bodies, prompts or secrets.
            let text = error.to_string();
            println!(
                "{}",
                json!({"status":error.provider_response_status().map(|s|s.as_u16()),
                "invalidContentType":text.contains("Invalid content type"),
                "invalidStatus":text.contains("Invalid status"),
                "jsonError":matches!(error,rig::completion::CompletionError::JsonError(_)),
                "providerError":matches!(error,rig::completion::CompletionError::ProviderError(_))})
            );
            anyhow::bail!("model_probe_failed");
        }
        Err(_) => anyhow::bail!("model_probe_timeout"),
    }
    Ok(())
}
