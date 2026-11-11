//! Native office helper: byte input only, no user-selected executable or server paths.
use super::*;
use std::{path::PathBuf, process::Stdio, sync::OnceLock};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Semaphore,
};

pub(crate) async fn invoke(input: Value) -> Result<Value, AppError> {
    static CAPACITY: OnceLock<Semaphore> = OnceLock::new();
    let _permit = tokio::time::timeout(
        Duration::from_secs(2),
        CAPACITY.get_or_init(|| Semaphore::new(2)).acquire(),
    )
    .await
    .map_err(|_| AppError::BadRequest("office_busy_retry".into()))?
    .map_err(|_| AppError::BadRequest("office_unavailable".into()))?;
    let exe = if cfg!(windows) {
        "yaya-agent-v2-office.exe"
    } else {
        "yaya-agent-v2-office"
    };
    let path = std::env::var_os("YAYA_AGENT_V2_OFFICE_PATH")
        .map(PathBuf::from)
        .or_else(|| {
            let path = std::env::current_exe().ok()?.parent()?.join(exe);
            path.is_file().then_some(path)
        })
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../agent-v2/target/debug")
                .join(exe)
        });
    if !path.is_file() {
        return Ok(
            json!({"error":{"code":"office_unavailable","message":"办公文件工具未部署，请构建并配置 yaya-agent-v2-office。"}}),
        );
    }
    let bytes = serde_json::to_vec(&input)
        .map_err(|_| AppError::BadRequest("office_invalid_request".into()))?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err(AppError::BadRequest("office_input_limit".into()));
    }
    let mut command = Command::new(path);
    command
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
        if let Some(root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", root);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|_| AppError::BadRequest("office_unavailable".into()))?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        let write = async move {
            stdin.write_all(&bytes).await?;
            // The helper reads to EOF. shutdown alone doesn't close a Windows pipe handle.
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let read = async {
            let mut out = Vec::new();
            stdout
                .take(12 * 1024 * 1024 + 1)
                .read_to_end(&mut out)
                .await?;
            Ok::<_, std::io::Error>(out)
        };
        let (_, out, status) = tokio::try_join!(write, read, child.wait())?;
        Ok::<_, std::io::Error>((out, status))
    })
    .await;
    let Ok(Ok((out, status))) = result else {
        let _ = child.kill().await;
        return Ok(
            json!({"error":{"code":"office_process_limit","message":"文件处理超时或超出资源限制；请缩小文件或分页重试。"}}),
        );
    };
    if !status.success() || out.len() > 12 * 1024 * 1024 {
        return Ok(
            json!({"error":{"code":"office_process_limit","message":"文件损坏或处理超出资源限制。"}}),
        );
    }
    let result: Value = serde_json::from_slice(&out)
        .map_err(|_| AppError::BadRequest("office_invalid_response".into()))?;
    if result["protocolVersion"] != 1 {
        return Ok(
            json!({"error":{"code":"office_protocol_mismatch","message":"办公文件工具版本不匹配，请更新 API 和解析程序。"}}),
        );
    }
    if let Some(error) = result["error"].as_str() {
        return Ok(
            json!({"error":{"code":"office_document_rejected","message":error.chars().take(512).collect::<String>()}}),
        );
    }
    Ok(result["result"].clone())
}
