//! One request per process. No database, model credentials, filesystem input paths or network.
use std::io::{Read, Write};

fn main() {
    let result = (|| -> anyhow::Result<serde_json::Value> {
        let _limits = yaya_agent_v2_office::limits::install()?;
        let mut bytes = Vec::new();
        std::io::stdin()
            .take(12 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        anyhow::ensure!(bytes.len() <= 12 * 1024 * 1024, "office_input_limit");
        yaya_agent_v2_office::handle(serde_json::from_slice(&bytes)?)
    })();
    let output = match result {
        Ok(value) => serde_json::json!({"protocolVersion":1,"result":value}),
        Err(error) => serde_json::json!({"protocolVersion":1,"error":format!("{error:#}")}),
    };
    let _ = std::io::stdout().write_all(output.to_string().as_bytes());
}
