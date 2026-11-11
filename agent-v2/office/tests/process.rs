use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn request(input: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_yaya-agent-v2-office"))
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}
#[test]
fn real_resource_limited_process_reads_and_writes_office() {
    let input = json!({"operation":"write","name":"test.xlsx","document":{"sheets":[{"name":"BOM","rows":[["00123",42]]}]}});
    let output = request(input.clone());
    assert!(output.get("error").is_none(), "{output}");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    assert_eq!(
        output,
        request(input),
        "creation timestamps must not change replayed output"
    );
    let result = request(
        json!({"operation":"read","name":"test.xlsx","data":output["result"]["data"],"options":{}}),
    );
    assert_eq!(result["result"]["rows"][0]["cells"][1]["value"], 42.0);
    assert!(
        request(json!({"operation":"read","name":"test.xlsx","data":"eA=="}))
            .get("error")
            .is_some()
    );
}
