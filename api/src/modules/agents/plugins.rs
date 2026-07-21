use std::net::IpAddr;
use std::time::Duration;

use rig_core::tool::Tool;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::modules::agents::dto::AgentPageContext;
use crate::modules::agents::tools::{AgentToolError, tool_error};
use crate::platform::config::{AgentPluginDefinition, PluginManifest, parse_plugin_manifest};

#[derive(Clone)]
pub(crate) struct PluginTool {
    pub(crate) plugins: Vec<AgentPluginDefinition>,
    pub(crate) context: AgentPageContext,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginToolArgs {
    plugin_id: String,
    tool_name: String,
    #[serde(default)]
    arguments: Value,
}

impl Tool for PluginTool {
    const NAME: &'static str = "call_plugin_tool";
    type Error = AgentToolError;
    type Args = PluginToolArgs;
    type Output = Value;

    fn description(&self) -> String {
        "调用当前配置文件中已绑定的插件工具。仅可调用运行时资源清单中声明且不需要人工确认的工具。"
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pluginId", "toolName"],
            "properties": {
                "pluginId": { "type": "string", "description": "运行时资源清单中的插件 ID" },
                "toolName": { "type": "string", "description": "该插件 Manifest 声明的工具名" },
                "arguments": { "type": "object", "description": "插件工具所需的 JSON 参数" }
            }
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        if !self.enabled {
            return Err(tool_error(
                "plugin tools are not allowed by the current Agent profile skills",
            ));
        }
        let plugin = self
            .plugins
            .iter()
            .find(|plugin| plugin.id == args.plugin_id)
            .ok_or_else(|| tool_error("plugin is not available in the current Agent profile"))?;
        if plugin.requires_confirmation {
            return Err(tool_error(
                "plugin requires confirmation and cannot run automatically",
            ));
        }
        let manifest = parse_plugin_manifest(&plugin.manifest_json).map_err(tool_error)?;
        let declared_tool = manifest
            .tools
            .iter()
            .find(|tool| tool.name == args.tool_name)
            .ok_or_else(|| tool_error("plugin tool is not declared by the Manifest"))?;
        if declared_tool.requires_confirmation {
            return Err(tool_error(
                "plugin tool requires confirmation and cannot run automatically",
            ));
        }
        let endpoint = validate_endpoint(&manifest).await?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| tool_error(format!("plugin client setup failed: {error}")))?;
        let response = client
            .post(endpoint)
            .json(&json!({
                "tool": args.tool_name,
                "arguments": args.arguments,
                "context": self.context,
            }))
            .send()
            .await
            .map_err(|error| tool_error(format!("plugin request failed: {error}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| tool_error(format!("plugin response could not be read: {error}")))?;
        if bytes.len() > 1_000_000 {
            return Err(tool_error("plugin response exceeds the 1 MB limit"));
        }
        let body = String::from_utf8_lossy(&bytes).to_string();
        if !status.is_success() {
            return Err(tool_error(format!("plugin returned HTTP {status}: {body}")));
        }
        Ok(serde_json::from_str(&body).unwrap_or_else(|_| json!({ "text": body })))
    }
}

async fn validate_endpoint(manifest: &PluginManifest) -> Result<reqwest::Url, AgentToolError> {
    let endpoint = reqwest::Url::parse(&manifest.endpoint)
        .map_err(|_| tool_error("plugin Manifest endpoint is invalid"))?;
    if endpoint.username() != "" || endpoint.password().is_some() || endpoint.fragment().is_some() {
        return Err(tool_error(
            "plugin Manifest endpoint must not contain credentials or fragments",
        ));
    }
    let host = endpoint
        .host_str()
        .ok_or_else(|| tool_error("plugin Manifest endpoint host is required"))?
        .to_ascii_lowercase();
    let local_development_host = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
    match endpoint.scheme() {
        "http" if local_development_host => Ok(endpoint),
        "https" => {
            let port = endpoint.port_or_known_default().unwrap_or(443);
            let addresses = tokio::net::lookup_host((host.as_str(), port))
                .await
                .map_err(|_| tool_error("plugin endpoint host could not be resolved"))?
                .map(|address| address.ip())
                .collect::<Vec<_>>();
            if addresses.is_empty() || addresses.iter().any(|address| !is_public_address(*address))
            {
                return Err(tool_error(
                    "plugin endpoint resolves to a private or reserved address",
                ));
            }
            Ok(endpoint)
        }
        _ => Err(tool_error(
            "plugin endpoint must use HTTPS or an explicit localhost HTTP development address",
        )),
    }
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified()
                || address.is_multicast())
        }
        IpAddr::V6(address) => {
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_unique_local()
                || address.is_unicast_link_local())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_explicit_local_development_endpoint() {
        let manifest = PluginManifest {
            endpoint: "http://127.0.0.1:8788/plugin".to_string(),
            tools: Vec::new(),
        };
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        assert!(runtime.block_on(validate_endpoint(&manifest)).is_ok());
    }

    #[test]
    fn rejects_non_local_http_endpoint() {
        let manifest = PluginManifest {
            endpoint: "http://example.com/plugin".to_string(),
            tools: Vec::new(),
        };
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        assert!(runtime.block_on(validate_endpoint(&manifest)).is_err());
    }
}
