//! Length-bounded NDJSON JSON-RPC transport. A per-run child never inherits service secrets.
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

pub struct Host {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next: u64,
}
impl Host {
    pub async fn start(path: &Path) -> Result<Self> {
        let mut command = Command::new("node");
        command.arg(path).env_clear();
        for name in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"] {
            if let Some(v) = std::env::var_os(name) {
                command.env(name, v);
            }
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("cordis host start")?;
        let input = child.stdin.take().context("host stdin")?;
        let output = BufReader::new(child.stdout.take().context("host stdout")?);
        let mut host = Self {
            child,
            input,
            output,
            next: 0,
        };
        let hello = host
            .rpc("host.initialize", json!({"protocolVersion":1}))
            .await?;
        if hello["protocolVersion"] != 1 {
            bail!("unsupported plugin protocol")
        };
        Ok(host)
    }
    pub async fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next += 1;
        let id = self.next;
        let mut request =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        if request.len() > 1024 * 1024 {
            bail!("plugin request too large")
        }
        request.push(b'\n');
        tokio::time::timeout(Duration::from_secs(15), async {
            self.input.write_all(&request).await?;
            self.input.flush().await?;
            let mut line = Vec::new();
            (&mut self.output)
                .take(1024 * 1024 + 1)
                .read_until(b'\n', &mut line)
                .await?;
            if line.is_empty() || line.len() > 1024 * 1024 || line.last() != Some(&b'\n') {
                bail!("invalid/oversized plugin frame")
            }
            let response: Value = serde_json::from_slice(&line)?;
            if response["jsonrpc"] != "2.0" || response["id"] != id {
                bail!("plugin response id mismatch")
            }
            if response.get("error").is_some() {
                bail!("plugin request rejected")
            }
            response
                .get("result")
                .cloned()
                .context("plugin result missing")
        })
        .await
        .context("plugin timeout")?
    }
    pub async fn close(mut self) -> Result<()> {
        self.rpc("plugin.dispose", json!({})).await?;
        drop(self.input);
        tokio::time::timeout(Duration::from_secs(3), self.child.wait()).await??;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_cordis_lifecycle() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../cordis-host/src/host.mjs");
        let mut host = Host::start(&path).await.unwrap();
        let tools = host.rpc("capability.list", json!({})).await.unwrap();
        assert_eq!(tools["tools"][0]["name"], "diagnostic_echo");
        let result=host.rpc("tool.invoke",json!({"invocationId":"test","name":"diagnostic_echo","arguments":{"text":"hello"},"scope":{"userId":"a","employeeId":"b"}})).await.unwrap();
        assert_eq!(result["text"], "hello");
        host.close().await.unwrap();
    }
}
