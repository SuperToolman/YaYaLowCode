//! Knowledge-base configuration: probe before the transaction, persist atomically with creation.
use super::vectors::{ProfileConfig, RetrievalConfig};
use super::*;

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaseRetrievalSelection {
    pub embedding_route_id: String,
    pub embedding_model: String,
    pub reranker_route_id: Option<String>,
    pub reranker_model: Option<String>,
}
pub(super) struct Prepared {
    config: ProfileConfig,
    connections: Vec<(String, String, (String, String, String), String)>,
}
pub(super) fn check_create_retry(v: &Value, i: &CreateBase) -> Result<(), AppError> {
    let selection = i
        .retrieval
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(storage)?;
    if v["kind"] != i.kind
        || v["name"] != i.name.trim()
        || v["application_id"] != json!(i.application_id)
        || v["description"].as_str().unwrap_or("") != i.description.trim()
        || v["retrieval_selection"] != json!(selection)
    {
        return Err(AppError::Conflict("请求 ID 已用于不同的建库内容".into()));
    }
    Ok(())
}
pub(super) async fn prepare(
    s: &AppState,
    user: Uuid,
    deployment: Uuid,
    c: &BaseRetrievalSelection,
) -> Result<Prepared, AppError> {
    if c.embedding_model.trim().is_empty()
        || c.embedding_model.len() > 200
        || c.embedding_route_id.is_empty()
        || c.reranker_model
            .as_ref()
            .is_some_and(|v| v.trim().is_empty() || v.len() > 200)
        || c.reranker_model.is_some() != c.reranker_route_id.is_some()
    {
        return Err(bad("请选择嵌入模型及有效的可选重排序模型"));
    }
    let connection = crate::modules::byom::knowledge_connection(
        s,
        user,
        deployment,
        &c.embedding_route_id,
        "embedding",
        c.embedding_model.trim(),
    )
    .await?;
    let key = crate::modules::byom::decrypt(&connection.2)?;
    let response=super::vectors::request(&connection.1,&key,"embeddings",json!({"model":c.embedding_model.trim(),"input":["knowledge connection check"],"encoding_format":"float"})).await.map_err(|e|bad(&format!("嵌入模型连接验证失败：{}",e.code)))?;
    let dimensions = probe_dimensions(&response)?;
    let mut connections = vec![(
        "embedding".into(),
        c.embedding_route_id.clone(),
        connection.clone(),
        c.embedding_model.clone(),
    )];
    let reranker_endpoint_hash = if let Some(route) = &c.reranker_route_id {
        let connection =
            crate::modules::byom::knowledge_connection(s, user, deployment, route, "reranker", c.reranker_model.as_deref().unwrap_or_default().trim())
                .await?;
        let hash = super::vectors::hash(&connection.1);
        connections.push((
            "reranker".into(),
            route.clone(),
            connection,
            c.reranker_model.clone().unwrap(),
        ));
        Some(hash)
    } else {
        None
    };
    Ok(Prepared {
        config: ProfileConfig {
            settings: RetrievalConfig {
                enabled: true,
                embedding_route_id: c.embedding_route_id.clone(),
                embedding_model: c.embedding_model.trim().into(),
                dimensions,
                reranker_route_id: c.reranker_route_id.clone(),
                reranker_model: c.reranker_model.clone(),
                allow_keyword_fallback: true,
            },
            embedding_endpoint_hash: super::vectors::hash(&connection.1),
            reranker_endpoint_hash,
        },
        connections,
    })
}
fn probe_dimensions(response: &Value) -> Result<u32, AppError> {
    let data = response["data"]
        .as_array()
        .filter(|v| v.len() == 1)
        .ok_or_else(|| bad("嵌入模型返回格式无效"))?;
    let values = data[0]["embedding"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 4096)
        .ok_or_else(|| bad("嵌入模型实际维度需为1—4096"))?;
    if data[0]["index"] != 0
        || values
            .iter()
            .any(|v| v.as_f64().is_none_or(|n| !n.is_finite()))
        || values
            .iter()
            .map(|v| v.as_f64().unwrap().powi(2))
            .sum::<f64>()
            <= 1e-24
    {
        return Err(bad("嵌入模型返回了无效向量"));
    }
    Ok(values.len() as u32)
}
pub(super) async fn persist(
    tx: &impl ConnectionTrait,
    deployment: Uuid,
    user: Uuid,
    base: Uuid,
    p: Prepared,
) -> Result<(), AppError> {
    for (kind, route, (name, url, key), model) in p.connections {
        // Reusing a published route must never silently replace another base's endpoint/credentials.
        exec(tx,"INSERT INTO knowledge_provider_connections(deployment_id,provider_type,route_id,name,api_base_url,encrypted_api_key,configured_by,models) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8) ON CONFLICT(deployment_id,provider_type,route_id) DO UPDATE SET models=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(knowledge_provider_connections.models || EXCLUDED.models)) WHERE knowledge_provider_connections.api_base_url=EXCLUDED.api_base_url AND knowledge_provider_connections.encrypted_api_key=EXCLUDED.encrypted_api_key",vec![id(deployment),kind.clone().into(),route.clone().into(),name.into(),url.clone().into(),key.clone().into(),id(user),json!([model]).into()]).await.map_err(storage)?;
        let published=rows(tx,"SELECT jsonb_build_object('same',api_base_url=$4 AND encrypted_api_key=$5)::text data FROM knowledge_provider_connections WHERE deployment_id=$1::uuid AND provider_type=$2 AND route_id=$3",vec![id(deployment),kind.into(),route.into(),url.into(),key.into()]).await.map_err(storage)?;
        if published.first().is_none_or(|v| v["same"] != true) {
            return Err(AppError::Conflict(
                "该连接已发布且地址或密钥已变更，请使用新的供应商连接".into(),
            ));
        }
    }
    let value = serde_json::to_value(p.config).map_err(storage)?;
    exec(tx,"INSERT INTO knowledge_vector_profiles(id,user_id,config,config_hash,deployment_id,base_id) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid) ON CONFLICT(base_id,config_hash) WHERE base_id IS NOT NULL DO NOTHING",vec![id(Uuid::new_v4()),id(user),value.clone().into(),yaya_agent_v2::store::fingerprint(&value).into(),id(deployment),id(base)]).await.map_err(storage)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_actual_dimensions_and_rejects_invalid_vectors() {
        assert_eq!(
            probe_dimensions(&json!({"data":[{"index":0,"embedding":[0.2,0.4,0.6]}]})).unwrap(),
            3
        );
        for value in [
            json!({"data":[]}),
            json!({"data":[{"index":0,"embedding":[0,0]}]}),
            json!({"data":[{"index":1,"embedding":[1]}]}),
            json!({"data":[{"index":0,"embedding":["bad"]}]}),
        ] {
            assert!(probe_dimensions(&value).is_err());
        }
    }
}
