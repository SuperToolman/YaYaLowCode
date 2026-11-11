//! Provider model discovery. Catalogs are not the model configured on a route.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Protocol {
    OpenAi,
    Anthropic,
    Google,
    Ollama,
    Azure,
}

fn candidates(base: &str, kind: &str) -> Result<Vec<(String, Protocol)>, AppError> {
    let url = reqwest::Url::parse(base)
        .map_err(|_| AppError::BadRequest("请输入有效的服务地址".into()))?;
    let host = url.host_str().unwrap_or_default();
    let protocol = if kind == "anthropic" || host == "api.anthropic.com" {
        Protocol::Anthropic
    } else if kind == "google" || host == "generativelanguage.googleapis.com" {
        Protocol::Google
    } else if kind.starts_with("ollama") || kind == "local" {
        Protocol::Ollama
    } else if host.ends_with(".openai.azure.com") {
        Protocol::Azure
    } else {
        Protocol::OpenAi
    };
    let base = base.trim_end_matches('/');
    let mut result = Vec::new();
    if protocol == Protocol::Google {
        let base = base.strip_suffix("/openai").unwrap_or(base);
        let base = base
            .strip_suffix("/v1beta")
            .or_else(|| base.strip_suffix("/v1"))
            .unwrap_or(base);
        result.push((format!("{base}/v1beta/models"), protocol));
    } else {
        let base = [
            "/chat/completions",
            "/embeddings",
            "/rerank",
            "/messages",
            "/responses",
            "/audio/speech",
            "/audio/transcriptions",
        ]
        .iter()
        .find_map(|suffix| base.strip_suffix(suffix))
        .unwrap_or(base);
        if base.ends_with("/models") {
            result.push((base.to_owned(), protocol));
        } else {
            let version = base.rsplit('/').next().unwrap_or_default();
            let versioned = version
                .strip_prefix('v')
                .is_some_and(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()));
            if versioned {
                result.push((format!("{base}/models"), protocol));
            } else {
                result.push((format!("{base}/v1/models"), protocol));
                result.push((format!("{base}/models"), protocol));
            }
            for suffix in ["/api/anthropic", "/apps/anthropic", "/anthropic"] {
                if let Some(root) = base.strip_suffix(suffix) {
                    result.push((format!("{root}/v1/models"), Protocol::OpenAi));
                    result.push((format!("{root}/models"), Protocol::OpenAi));
                    if suffix == "/apps/anthropic" {
                        result.push((
                            format!("{root}/compatible-mode/v1/models"),
                            Protocol::OpenAi,
                        ));
                    }
                    break;
                }
            }
        }
        if protocol == Protocol::Ollama {
            let root = base.strip_suffix("/v1").unwrap_or(base);
            result.push((format!("{root}/api/tags"), protocol));
        }
    }
    result.dedup();
    Ok(result)
}

fn parse_models(data: &serde_json::Value, protocol: Protocol) -> Option<Vec<String>> {
    let list = data
        .get("data")
        .and_then(|v| v.as_array())
        .or_else(|| data.get("models").and_then(|v| v.as_array()))
        .or_else(|| data.as_array())?;
    let mut models = list
        .iter()
        .filter_map(|item| {
            if let Some(id) = item.as_str() {
                return Some(id.to_owned());
            }
            if let Some(id) = item
                .get("id")
                .or_else(|| item.get("slug"))
                .and_then(|v| v.as_str())
            {
                return Some(id.to_owned());
            }
            let name = item
                .get("name")
                .or_else(|| item.get("model"))
                .and_then(|v| v.as_str())?;
            Some(
                if protocol == Protocol::Google {
                    name.strip_prefix("models/").unwrap_or(name)
                } else {
                    name
                }
                .to_owned(),
            )
        })
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if !list.is_empty() && models.is_empty() {
        return None;
    }
    models.sort();
    models.dedup();
    Some(models)
}

pub(super) async fn fetch(
    base: &str,
    key: &str,
    kind: &str,
) -> Result<TestModelRouteResponse, AppError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|_| AppError::Server(std::io::Error::other("无法初始化模型列表请求")))?;
    let started = std::time::Instant::now();
    let mut message = "供应商未提供可识别的模型列表接口，请手动填写模型 ID。".to_owned();
    for (endpoint, protocol) in candidates(base, kind)? {
        if started.elapsed().as_secs() >= 10 {
            break;
        }
        let mut next = Some(endpoint);
        let mut models = Vec::new();
        let mut valid = false;
        let mut pages = 0;
        // Native Google and Anthropic catalogs can be paginated.
        while let Some(endpoint) = next.take() {
            valid = false;
            pages += 1;
            if pages > 30 || models.len() > 30_000 || started.elapsed().as_secs() >= 10 {
                message = "模型列表分页过多或请求超时，请稍后重试。".into();
                valid = false;
                break;
            }
            let mut request = client
                .get(&endpoint)
                .timeout(std::time::Duration::from_secs(10).saturating_sub(started.elapsed()));
            if !key.is_empty() {
                request = match protocol {
                    Protocol::Anthropic => request
                        .header("x-api-key", key)
                        .header("anthropic-version", "2023-06-01"),
                    Protocol::Google => request.header("x-goog-api-key", key),
                    Protocol::Azure => request.header("api-key", key),
                    _ => request.bearer_auth(key),
                };
            }
            let mut response = match request.send().await {
                Ok(response) => response,
                Err(error) => {
                    message = if error.is_timeout() {
                        "连接超时，请检查服务地址和网络。"
                    } else {
                        "无法连接供应商，请检查服务地址、网络和证书。"
                    }
                    .into();
                    break;
                }
            };
            let status = response.status().as_u16();
            if !response.status().is_success() {
                message = match status {
                    401 | 403 => "鉴权失败，请检查 API Key 及模型列表访问权限。".into(),
                    404 | 405 => {
                        "模型列表接口不存在或不受支持，请检查基础地址，或手动填写模型 ID。".into()
                    }
                    429 => "供应商请求受限，请稍后重试或检查账户额度。".into(),
                    _ => format!("供应商模型列表接口返回 HTTP {status}。"),
                };
                if matches!(status, 401 | 403 | 429) {
                    return Ok(TestModelRouteResponse {
                        success: false,
                        message,
                        latency_ms: started.elapsed().as_millis() as u64,
                        models: vec![],
                    });
                }
                break;
            }
            let mut bytes = Vec::new();
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) if bytes.len() + chunk.len() <= 4 * 1024 * 1024 => {
                        bytes.extend_from_slice(&chunk)
                    }
                    Ok(None) => break,
                    _ => {
                        bytes.clear();
                        break;
                    }
                }
            }
            let data = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
            let Some(data) = data else {
                message = "模型列表响应不是有效 JSON，请检查 API 地址。".into();
                break;
            };
            let Some(ids) = parse_models(&data, protocol) else {
                message = "模型列表格式不受支持，请手动填写模型 ID。".into();
                break;
            };
            models.extend(ids);
            valid = true;
            let mut url = reqwest::Url::parse(&endpoint).expect("validated endpoint");
            if protocol == Protocol::Google {
                if let Some(token) = data["nextPageToken"].as_str().filter(|s| !s.is_empty()) {
                    url.set_query(None);
                    url.query_pairs_mut().append_pair("pageToken", token);
                    next = Some(url.to_string());
                }
            } else if protocol == Protocol::Anthropic && data["has_more"] == true {
                if let Some(token) = data["last_id"].as_str().filter(|s| !s.is_empty()) {
                    url.set_query(None);
                    url.query_pairs_mut().append_pair("after_id", token);
                    next = Some(url.to_string());
                } else {
                    valid = false;
                    message = "供应商分页响应缺少游标。".into();
                }
            }
        }
        if valid {
            models.sort();
            models.dedup();
            return Ok(TestModelRouteResponse {
                success: true,
                message: "连接成功，已获取模型列表；尚未验证具体模型调用。".into(),
                latency_ms: started.elapsed().as_millis() as u64,
                models,
            });
        }
    }
    Ok(TestModelRouteResponse {
        success: false,
        message,
        latency_ms: started.elapsed().as_millis() as u64,
        models: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_provider_urls_and_response_formats() {
        assert_eq!(
            candidates("https://api.siliconflow.cn", "").unwrap()[0].0,
            "https://api.siliconflow.cn/v1/models"
        );
        assert_eq!(
            candidates("https://example.com/v4", "").unwrap()[0].0,
            "https://example.com/v4/models"
        );
        assert_eq!(
            candidates("https://example.com/v1/chat/completions", "").unwrap()[0].0,
            "https://example.com/v1/models"
        );
        assert_eq!(
            candidates(
                "https://generativelanguage.googleapis.com/v1beta/openai",
                ""
            )
            .unwrap()[0]
                .0,
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            parse_models(
                &serde_json::json!({"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}),
                Protocol::OpenAi
            )
            .unwrap(),
            vec!["a", "b"]
        );
        assert_eq!(
            parse_models(
                &serde_json::json!({"models":[{"name":"models/gemini-test"}]}),
                Protocol::Google
            )
            .unwrap(),
            vec!["gemini-test"]
        );
        assert_eq!(
            parse_models(
                &serde_json::json!({"models":[{"name":"qwen:latest"}]}),
                Protocol::Ollama
            )
            .unwrap(),
            vec!["qwen:latest"]
        );
        assert!(
            parse_models(
                &serde_json::json!({"data":[{"wrong":"id"}]}),
                Protocol::OpenAi
            )
            .is_none()
        );
    }

    #[tokio::test]
    async fn native_auth_pagination_and_ollama_fallback() {
        use axum::{Router, extract::Query, routing::get};
        use std::collections::HashMap;
        let app = Router::new()
            .route("/anthropic/v1/models", get(|headers: HeaderMap, Query(query): Query<HashMap<String,String>>| async move {
                assert_eq!(headers["x-api-key"], "test-key");
                assert_eq!(headers["anthropic-version"], "2023-06-01");
                assert!(headers.get("authorization").is_none());
                Json(if query.contains_key("after_id") { serde_json::json!({"data":[{"id":"claude-b"}],"has_more":false}) }
                    else { serde_json::json!({"data":[{"id":"claude-a"}],"has_more":true,"last_id":"claude-a"}) })
            }))
            .route("/google/v1beta/models", get(|headers: HeaderMap, Query(query): Query<HashMap<String,String>>| async move {
                assert_eq!(headers["x-goog-api-key"], "test-key");
                assert!(headers.get("authorization").is_none());
                Json(if query.contains_key("pageToken") { serde_json::json!({"models":[{"name":"models/gemini-b"}]}) }
                    else { serde_json::json!({"models":[{"name":"models/gemini-a"}],"nextPageToken":"page-2"}) })
            }))
            .route("/ollama/api/tags", get(|| async { Json(serde_json::json!({"models":[{"name":"qwen:latest"}]})) }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let anthropic = fetch(&format!("{root}/anthropic/v1"), "test-key", "anthropic")
            .await
            .unwrap();
        assert!(anthropic.success);
        assert_eq!(anthropic.models, vec!["claude-a", "claude-b"]);
        let google = fetch(
            &format!("{root}/google/v1beta/openai"),
            "test-key",
            "google",
        )
        .await
        .unwrap();
        assert!(google.success);
        assert_eq!(google.models, vec!["gemini-a", "gemini-b"]);
        let ollama = fetch(&format!("{root}/ollama/v1"), "", "ollama")
            .await
            .unwrap();
        assert!(ollama.success);
        assert_eq!(ollama.models, vec!["qwen:latest"]);
        server.abort();
    }
}
