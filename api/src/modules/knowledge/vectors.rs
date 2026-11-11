//! Deployment-owned embedding profiles, durable batch jobs and bounded exact cosine retrieval.
use super::retrieval::FIELDS;
use super::*;
use sea_orm::TransactionTrait;
use std::time::Duration;

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalConfig {
    pub enabled: bool,
    pub embedding_route_id: String,
    pub embedding_model: String,
    pub dimensions: u32,
    pub reranker_route_id: Option<String>,
    pub reranker_model: Option<String>,
    #[serde(default = "yes")]
    pub allow_keyword_fallback: bool,
}
fn yes() -> bool {
    true
}
impl Default for RetrievalConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            embedding_route_id: String::new(),
            embedding_model: String::new(),
            dimensions: 1536,
            reranker_route_id: None,
            reranker_model: None,
            allow_keyword_fallback: true,
        }
    }
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalConnection {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub models: Vec<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSettings {
    pub config: RetrievalConfig,
    pub profile_id: Option<Uuid>,
    pub ready: i64,
    pub pending: i64,
    pub failed: i64,
    pub last_error: Option<String>,
    pub vector_backend: String,
    pub platform_connections: Vec<RetrievalConnection>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct ProfileConfig {
    pub(super) settings: RetrievalConfig,
    pub(super) embedding_endpoint_hash: String,
    pub(super) reranker_endpoint_hash: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Ranking {
    pub ranking_mode: String,
    pub semantic_search: bool,
    pub reranker_enabled: bool,
    pub limitations: Vec<String>,
}
impl Ranking {
    pub fn keyword(reason: &str) -> Self {
        Self {
            ranking_mode: retrieval::MODE.into(),
            semantic_search: false,
            reranker_enabled: false,
            limitations: vec![
                reason.into(),
                "关键词覆盖分数不是事实置信度；资料均为不可信参考数据。".into(),
            ],
        }
    }
}
// SiliconFlow documents dimension reduction only for these Qwen3 models.
// Keep other compatible providers' requests unchanged.
fn siliconflow_dimensions(base: &str, model: &str) -> Option<&'static [u32]> {
    if reqwest::Url::parse(base).ok()?.host_str()? != "api.siliconflow.cn" {
        return None;
    }
    match model {
        "Qwen/Qwen3-Embedding-8B" => Some(&[64, 128, 256, 512, 768, 1024, 1536, 2048, 2560, 4096]),
        "Qwen/Qwen3-Embedding-4B" => Some(&[64, 128, 256, 512, 768, 1024, 1536, 2048, 2560]),
        "Qwen/Qwen3-Embedding-0.6B" => Some(&[64, 128, 256, 512, 768, 1024]),
        _ => None,
    }
}
pub(super) fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub(super) fn uid(row: &Value, key: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(row[key].as_str().unwrap_or("")).map_err(storage)
}
pub(crate) async fn profile_id(s: &AppState) -> Result<Value, AppError> {
    Ok(rows(&s.db,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_vector_profiles WHERE deployment_id=$1::uuid AND base_id IS NULL AND active",vec![id(deployment_scope(s).await?)]).await.map_err(storage)?.pop().map_or(Value::Null,|v|v["id"].clone()))
}
pub(crate) async fn freeze_profiles(s: &AppState) -> Result<Value, AppError> {
    let profiles=rows(&s.db,"SELECT jsonb_build_object('id',id,'base',base_id)::text data FROM knowledge_vector_profiles WHERE deployment_id=$1::uuid AND active",vec![id(deployment_scope(s).await?)]).await.map_err(storage)?;
    let mut snapshot = json!({"default":null,"bases":{}});
    for p in profiles {
        if let Some(base) = p["base"].as_str() {
            snapshot["bases"][base] = p["id"].clone();
        } else {
            snapshot["default"] = p["id"].clone();
        }
    }
    Ok(snapshot)
}
fn selected_profile(snapshot: &Value, base: &str) -> Value {
    if snapshot.is_string() || snapshot.is_null() {
        return snapshot.clone();
    }
    snapshot["bases"]
        .get(base)
        .unwrap_or(&snapshot["default"])
        .clone()
}
#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
pub struct RetrievalQuery {
    pub base_id: Option<Uuid>,
}
async fn profile(s: &AppState, pid: Uuid) -> Result<ProfileConfig, AppError> {
    let row=rows(&s.db,"SELECT config::text data FROM knowledge_vector_profiles WHERE id=$1::uuid AND deployment_id=$2::uuid AND active",vec![id(pid),id(deployment_scope(s).await?)]).await.map_err(storage)?.pop().ok_or_else(||AppError::Conflict("知识检索配置已变更或停用，请重新发送任务".into()))?;
    serde_json::from_value(row).map_err(storage)
}
async fn provider(
    s: &AppState,
    route: &str,
    provider_type: &str,
    expected: &str,
) -> Result<(String, String), AppError> {
    let (url, key) = crate::modules::byom::platform_knowledge_provider(
        s,
        deployment_scope(s).await?,
        route,
        provider_type,
    )
    .await?;
    if hash(&url) != expected {
        return Err(AppError::Conflict(
            "knowledge_provider_endpoint_changed".into(),
        ));
    }
    Ok((url, key))
}
#[utoipa::path(get,path="/api/knowledge/retrieval-settings",operation_id="knowledgeRetrievalSettings",params(RetrievalQuery),responses((status=200,body=RetrievalSettings)))]
pub async fn settings(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<RetrievalQuery>,
) -> Result<Json<RetrievalSettings>, AppError> {
    let (_, user, _) = subject(&s, &h).await?;
    if let Some(base) = q.base_id {
        access(&s, &h, base, false).await?;
    }
    Ok(Json(view_base(&s, user, q.base_id).await?))
}
async fn view(s: &AppState, user: Uuid) -> Result<RetrievalSettings, AppError> {
    view_base(s, user, None).await
}
async fn view_base(
    s: &AppState,
    _user: Uuid,
    base: Option<Uuid>,
) -> Result<RetrievalSettings, AppError> {
    let selected = if let Some(base) = base {
        selected_profile(&freeze_profiles(s).await?, &base.to_string())
    } else {
        profile_id(s).await?
    };
    let pid = selected
        .as_str()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(storage)?;
    let mut result = RetrievalSettings {
        config: RetrievalConfig::default(),
        profile_id: pid,
        ready: 0,
        pending: 0,
        failed: 0,
        last_error: None,
        vector_backend: "postgres-array-exact-cosine-v1".into(),
        platform_connections: rows(&s.db,"SELECT jsonb_build_object('id',route_id,'name',name,'providerType',provider_type,'models',models)::text data FROM knowledge_provider_connections WHERE deployment_id=$1::uuid ORDER BY provider_type,name,route_id",vec![id(deployment_scope(s).await?)]).await.map_err(storage)?.into_iter().map(serde_json::from_value).collect::<Result<Vec<_>,_>>().map_err(storage)?,
    };
    if let Some(pid) = pid {
        result.config = profile(s, pid).await?.settings;
        let counts=rows(&s.db,"SELECT jsonb_build_object('ready',count(*) FILTER(WHERE j.status='ready'),'pending',count(*) FILTER(WHERE j.status IN('queued','processing','retry_wait')),'failed',count(*) FILTER(WHERE j.status IN('failed','revoked')))::text data FROM knowledge_vector_jobs j JOIN knowledge_index_generations g ON g.id=j.generation_id JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id WHERE j.profile_id=$1::uuid AND ($2::uuid IS NULL OR d.base_id=$2::uuid) AND g.active AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id",vec![id(pid),base.map(|b|b.to_string()).into()]).await.map_err(storage)?.remove(0);
        result.ready = counts["ready"].as_i64().unwrap_or(0);
        result.pending = counts["pending"].as_i64().unwrap_or(0);
        result.failed = counts["failed"].as_i64().unwrap_or(0);
        result.last_error=rows(&s.db,"SELECT jsonb_build_object('error',j.error_code)::text data FROM knowledge_vector_jobs j JOIN knowledge_index_generations g ON g.id=j.generation_id JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id WHERE j.profile_id=$1::uuid AND ($2::uuid IS NULL OR d.base_id=$2::uuid) AND j.error_code IS NOT NULL AND g.active AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id ORDER BY j.updated_at DESC LIMIT 1",vec![id(pid),base.map(|b|b.to_string()).into()]).await.map_err(storage)?.pop().and_then(|v|v["error"].as_str().map(str::to_owned));
    }
    Ok(result)
}
#[utoipa::path(put,path="/api/knowledge/retrieval-settings",operation_id="knowledgeSaveRetrievalSettings",request_body=RetrievalConfig,responses((status=200,body=RetrievalSettings)))]
pub async fn save(
    State(s): State<AppState>,
    h: HeaderMap,
    Json(mut c): Json<RetrievalConfig>,
) -> Result<Json<RetrievalSettings>, AppError> {
    let (deployment, user, grants) = subject(&s, &h).await?;
    if !has(&grants, "settings.models.manage") {
        return Err(AppError::Forbidden("无模型配置管理权限".into()));
    }
    c.embedding_model = c.embedding_model.trim().to_owned();
    c.reranker_model = c
        .reranker_model
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty());
    c.reranker_route_id = c.reranker_route_id.filter(|v| !v.is_empty());
    let mut connections = Vec::new();
    let config = if c.enabled {
        if c.embedding_model.is_empty()
            || c.embedding_model.len() > 200
            || !(1..=4096).contains(&c.dimensions)
            || c.reranker_model.as_ref().is_some_and(|v| v.len() > 200)
            || c.reranker_model.is_some() != c.reranker_route_id.is_some()
        {
            return Err(bad("请完整配置Embedding模型、实际输出维度及可选重排模型"));
        }
        let connection = crate::modules::byom::knowledge_connection(
            &s,
            user,
            deployment,
            &c.embedding_route_id,
            "embedding",
            c.embedding_model.trim(),
        )
        .await?;
        if siliconflow_dimensions(&connection.1, &c.embedding_model)
            .is_some_and(|allowed| !allowed.contains(&c.dimensions))
        {
            return Err(bad(
                "该硅基流动Qwen3向量模型不支持所选维度，请按官方支持的维度配置",
            ));
        }
        let endpoint_hash = hash(&connection.1);
        connections.push(("embedding", c.embedding_route_id.clone(), connection));
        let reranker_endpoint_hash = if let Some(route) = &c.reranker_route_id {
            let connection =
                crate::modules::byom::knowledge_connection(&s, user, deployment, route, "reranker", c.reranker_model.as_deref().unwrap_or_default().trim())
                    .await?;
            let endpoint_hash = hash(&connection.1);
            connections.push(("reranker", route.clone(), connection));
            Some(endpoint_hash)
        } else {
            None
        };
        Some(ProfileConfig {
            settings: c,
            embedding_endpoint_hash: endpoint_hash,
            reranker_endpoint_hash,
        })
    } else {
        None
    };
    let tx = s.db.begin().await?;
    // Serialize the singleton deployment configuration, independent of administrator identity.
    rows(
        &tx,
        "SELECT jsonb_build_object('id',id)::text data FROM knowledge_deployment_scope WHERE id=$1::uuid FOR UPDATE",
        vec![id(deployment)],
    )
    .await
    .map_err(storage)?;
    for (provider_type, route, (name, url, encrypted)) in connections {
        exec(&tx,"INSERT INTO knowledge_provider_connections(deployment_id,provider_type,route_id,name,api_base_url,encrypted_api_key,configured_by) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid) ON CONFLICT(deployment_id,provider_type,route_id) DO UPDATE SET name=EXCLUDED.name,api_base_url=EXCLUDED.api_base_url,encrypted_api_key=EXCLUDED.encrypted_api_key,configured_by=EXCLUDED.configured_by,updated_at=now()",vec![id(deployment),provider_type.into(),route.into(),name.into(),url.into(),encrypted.into(),id(user)]).await.map_err(storage)?;
    }
    if let Some(config) = config {
        let value = serde_json::to_value(config).map_err(storage)?;
        let fingerprint = yaya_agent_v2::store::fingerprint(&value);
        if !rows(&tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_vector_profiles WHERE deployment_id=$1::uuid AND base_id IS NULL AND active AND config_hash=$2",vec![id(deployment),fingerprint.clone().into()]).await.map_err(storage)?.is_empty() {
            tx.commit().await?;return Ok(Json(view(&s,user).await?));
        }
        exec(
            &tx,
            "UPDATE knowledge_vector_profiles SET active=false WHERE deployment_id=$1::uuid AND base_id IS NULL AND active",
            vec![id(deployment)],
        )
        .await
        .map_err(storage)?;
        exec(&tx,"INSERT INTO knowledge_vector_profiles(id,user_id,config,config_hash,deployment_id) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid) ON CONFLICT(deployment_id,config_hash) WHERE deployment_id IS NOT NULL AND base_id IS NULL DO UPDATE SET active=true",vec![id(Uuid::new_v4()),id(user),value.into(),fingerprint.into(),id(deployment)]).await.map_err(storage)?;
    } else {
        exec(
            &tx,
            "UPDATE knowledge_vector_profiles SET active=false WHERE deployment_id=$1::uuid AND base_id IS NULL AND active",
            vec![id(deployment)],
        )
        .await
        .map_err(storage)?;
    }
    tx.commit().await?;
    Ok(Json(view(&s, user).await?))
}
#[utoipa::path(post,path="/api/knowledge/retrieval-settings/retry",operation_id="knowledgeRetryVectorIndex",params(RetrievalQuery),responses((status=200,body=RetrievalSettings)))]
pub async fn retry(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<RetrievalQuery>,
) -> Result<Json<RetrievalSettings>, AppError> {
    let (deployment, user, grants) = subject(&s, &h).await?;
    if let Some(base) = q.base_id {
        access(&s, &h, base, true).await?;
    } else if !has(&grants, "settings.models.manage") {
        return Err(AppError::Forbidden("无模型配置管理权限".into()));
    }
    exec(&s.db,"UPDATE knowledge_vector_jobs j SET status='queued',attempts=0,error_code=NULL,available_at=now() FROM knowledge_vector_profiles p,knowledge_index_generations g,knowledge_document_versions v,knowledge_documents d WHERE p.id=j.profile_id AND p.deployment_id=$1::uuid AND p.active AND ($2::uuid IS NULL OR d.base_id=$2::uuid) AND g.id=j.generation_id AND g.active AND v.id=g.version_id AND d.id=v.document_id AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND j.status IN('failed','revoked')",vec![id(deployment),q.base_id.map(|b|b.to_string()).into()]).await.map_err(storage)?;
    Ok(Json(view_base(&s, user, q.base_id).await?))
}

pub(super) struct Failure {
    pub(super) code: &'static str,
    retry: bool,
}
pub(super) async fn request(
    url: &str,
    key: &str,
    path: &str,
    body: Value,
) -> Result<Value, Failure> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| Failure {
            code: "provider_client_error",
            retry: false,
        })?;
    let mut response = client
        .post(format!("{}/{path}", url.trim_end_matches('/')))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|_| Failure {
            code: "provider_network_or_timeout",
            retry: true,
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(Failure {
            code: match status.as_u16() {
                401 | 403 => "provider_authentication_failed",
                400 | 404 | 422 => "provider_model_or_protocol_invalid",
                429 => "provider_rate_limited",
                _ => "provider_http_failed",
            },
            retry: status.as_u16() == 429 || status.is_server_error(),
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Failure {
        code: "provider_response_interrupted",
        retry: true,
    })? {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err(Failure {
                code: "provider_response_too_large",
                retry: false,
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Failure {
        code: "provider_invalid_json",
        retry: false,
    })
}
async fn embeddings(
    s: &AppState,
    p: &ProfileConfig,
    texts: &[String],
) -> Result<Vec<Vec<f64>>, Failure> {
    let (url, key) = provider(
        s,
        &p.settings.embedding_route_id,
        "embedding",
        &p.embedding_endpoint_hash,
    )
    .await
    .map_err(|_| Failure {
        code: "embedding_provider_unavailable_or_changed",
        retry: false,
    })?;
    let mut body =
        json!({"model":p.settings.embedding_model,"input":texts,"encoding_format":"float"});
    if let Some(allowed) = siliconflow_dimensions(&url, &p.settings.embedding_model) {
        if !allowed.contains(&p.settings.dimensions) {
            return Err(Failure {
                code: "embedding_dimension_mismatch",
                retry: false,
            });
        }
        body["dimensions"] = json!(p.settings.dimensions);
    }
    let response = request(&url, &key, "embeddings", body).await?;
    let invalid = || Failure {
        code: "embedding_response_contract_invalid",
        retry: false,
    };
    let data = response["data"].as_array().ok_or_else(invalid)?;
    if data.len() != texts.len() {
        return Err(invalid());
    }
    let mut vectors = vec![None; texts.len()];
    for item in data {
        let index = item["index"].as_u64().ok_or_else(invalid)? as usize;
        if index >= vectors.len() || vectors[index].is_some() {
            return Err(invalid());
        }
        let values = item["embedding"].as_array().ok_or_else(invalid)?;
        if values.len() != p.settings.dimensions as usize {
            return Err(Failure {
                code: "embedding_dimension_mismatch",
                retry: false,
            });
        }
        let mut v = values
            .iter()
            .map(|v| v.as_f64().filter(|n| n.is_finite()).ok_or_else(invalid))
            .collect::<Result<Vec<_>, _>>()?;
        let norm = v.iter().map(|n| n * n).sum::<f64>().sqrt();
        if !norm.is_finite() || norm <= 1e-12 {
            return Err(invalid());
        }
        for n in &mut v {
            *n /= norm;
        }
        vectors[index] = Some(v);
    }
    vectors.into_iter().map(|v| v.ok_or_else(invalid)).collect()
}

async fn authorized_generation(s: &AppState, gid: Uuid) -> Result<bool, AppError> {
    let row=rows(&s.db,"SELECT to_jsonb(b)::text data FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id JOIN knowledge_bases b ON b.id=d.base_id WHERE g.id=$1::uuid AND b.tenant_id=$3::uuid AND g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND (b.kind<>'employee_bundle' OR d.package_version=$2::jsonb->>(b.employee_id))",vec![id(gid),json!(crate::platform::config::load_installed_ai_employee_packages().iter().filter_map(|(id,p)|p["knowledge"]["version"].as_str().map(|v|(id.clone(),v.to_owned()))).collect::<std::collections::HashMap<_,_>>()).into(),id(deployment_scope(s).await?)]).await.map_err(storage)?.pop();
    Ok(row.is_some_and(|b| allowed(&HashSet::new(), &b, false)))
}
pub(crate) fn start(s: AppState) {
    tokio::spawn(async move {
        let mut shutdown = s.shutdown_receiver();
        loop {
            if *shutdown.borrow() {
                return;
            }
            let result = tokio::select! {_=shutdown.changed()=>return,result=process(&s)=>result};
            if result.is_err() {
                tracing::warn!("knowledge embedding metadata transaction failed");
            }
            tokio::select! {_=shutdown.changed()=>return,_=tokio::time::sleep(Duration::from_secs(2))=>{}}
        }
    });
}
pub(super) async fn process(s: &AppState) -> Result<(), AppError> {
    let deployment = deployment_scope(s).await?;
    let profiles=rows(&s.db,"SELECT jsonb_build_object('id',id,'base',base_id)::text data FROM knowledge_vector_profiles WHERE deployment_id=$1::uuid AND active",vec![id(deployment)]).await.map_err(storage)?;
    for entry in profiles {
        let pid = uid(&entry, "id")?;
        let bundles = crate::platform::config::load_installed_ai_employee_packages()
            .keys()
            .filter_map(|employee| {
                employee_version(employee).map(|version| (employee.clone(), version))
            })
            .collect::<std::collections::HashMap<_, _>>();
        let pending=rows(&s.db,"SELECT jsonb_build_object('version',v.id,'base',to_jsonb(b),'package',d.package_version)::text data FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id JOIN knowledge_bases b ON b.id=d.base_id WHERE b.tenant_id=$1::uuid AND (($4::uuid IS NOT NULL AND b.id=$4::uuid) OR ($4::uuid IS NULL AND NOT EXISTS(SELECT 1 FROM knowledge_vector_profiles own WHERE own.base_id=b.id AND own.active))) AND (b.kind<>'employee_bundle' OR d.package_version=$3::jsonb->>(b.employee_id)) AND g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND NOT EXISTS(SELECT 1 FROM knowledge_vector_jobs j WHERE j.profile_id=$2::uuid AND j.generation_id=g.id) ORDER BY g.created_at LIMIT 100",vec![id(deployment),id(pid),json!(bundles).into(),entry["base"].as_str().map(str::to_owned).into()]).await.map_err(storage)?;
        let versions = pending
            .iter()
            .filter(|row| {
                allowed(&HashSet::new(), &row["base"], false)
                    && (row["base"]["kind"] != "employee_bundle"
                        || row["base"]["employee_id"]
                            .as_str()
                            .and_then(employee_version)
                            .is_some_and(|v| row["package"] == v))
            })
            .filter_map(|v| v["version"].as_str().map(str::to_owned))
            .collect::<Vec<_>>();
        enqueue(s, pid, &versions).await?;
    }
    let tx = s.db.begin().await?;
    let job=rows(&tx,"WITH next AS(SELECT j.profile_id,j.generation_id FROM knowledge_vector_jobs j JOIN knowledge_vector_profiles p ON p.id=j.profile_id WHERE p.active AND p.deployment_id=$1::uuid AND ((j.status IN('queued','retry_wait') AND j.available_at<=now()) OR (j.status='processing' AND j.lease_until<now())) ORDER BY j.updated_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED) UPDATE knowledge_vector_jobs j SET status='processing',epoch=epoch+1,lease_until=now()+interval '90 seconds',updated_at=now() FROM next n WHERE j.profile_id=n.profile_id AND j.generation_id=n.generation_id RETURNING to_jsonb(j)::text data",vec![id(deployment_scope(s).await?)]).await.map_err(storage)?.pop();
    tx.commit().await?;
    let Some(job) = job else { return Ok(()) };
    let pid = uid(&job, "profile_id")?;
    let gid = uid(&job, "generation_id")?;
    let outcome=async {
        // Shared execution does not resolve a configuring user or their RBAC.
        let p=profile(s,pid).await.map_err(|_|Failure{code:"profile_unavailable",retry:false})?;
        if !authorized_generation(s,gid).await.unwrap_or(false){return Err(Failure{code:"source_permission_or_version_revoked",retry:false});}
        let chunks=rows(&s.db,"SELECT jsonb_build_object('id',c.id,'text',c.body,'hash',c.sha256)::text data FROM knowledge_chunks c WHERE generation_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM knowledge_vectors e WHERE e.profile_id=$2::uuid AND e.chunk_id=c.id) ORDER BY c.ordinal LIMIT 16",vec![id(gid),id(pid)]).await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        let texts=chunks.iter().map(|v|v["text"].as_str().unwrap_or("").to_owned()).collect::<Vec<_>>();
        for c in &chunks {if c["hash"]!=hash(c["text"].as_str().unwrap_or("")){return Err(Failure{code:"source_hash_mismatch",retry:false});}}
        let vectors=if texts.is_empty(){vec![]}else{embeddings(s,&p,&texts).await?};
        if !authorized_generation(s,gid).await.unwrap_or(false){return Err(Failure{code:"source_permission_or_version_revoked",retry:false});}
        profile(s,pid).await.map_err(|_|Failure{code:"profile_changed",retry:false})?;
        let tx=s.db.begin().await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        let lock=rows(&tx,"SELECT jsonb_build_object('ok',true)::text data FROM knowledge_vector_jobs j JOIN knowledge_vector_profiles p ON p.id=j.profile_id JOIN knowledge_index_generations g ON g.id=j.generation_id JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id WHERE j.profile_id=$1::uuid AND j.generation_id=$2::uuid AND j.epoch=$3 AND j.status='processing' AND j.lease_until>now() AND p.active AND g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id FOR UPDATE OF j FOR SHARE OF p,g,d",vec![id(pid),id(gid),job["epoch"].as_i64().unwrap_or(0).into()]).await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        if lock.is_empty(){return Err(Failure{code:"embedding_epoch_lost",retry:false});}
        for (c,v) in chunks.iter().zip(vectors) {
            exec(&tx,"INSERT INTO knowledge_vectors(profile_id,generation_id,chunk_id,embedding,content_hash) SELECT $1::uuid,$2::uuid,c.id,ARRAY(SELECT value::double precision FROM jsonb_array_elements_text($4::jsonb)),c.sha256 FROM knowledge_chunks c WHERE c.id=$3::uuid AND c.generation_id=$2::uuid AND c.sha256=$5 ON CONFLICT(profile_id,chunk_id) DO NOTHING",vec![id(pid),id(gid),c["id"].as_str().unwrap_or("").into(),json!(v).into(),c["hash"].as_str().unwrap_or("").into()]).await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        }
        exec(&tx,"UPDATE knowledge_vector_jobs j SET status=CASE WHEN (SELECT count(*) FROM knowledge_vectors e WHERE e.profile_id=j.profile_id AND e.generation_id=j.generation_id)=(SELECT chunk_count FROM knowledge_index_generations WHERE id=j.generation_id) THEN 'ready' ELSE 'queued' END,error_code=NULL,attempts=0,lease_until=NULL,updated_at=now() WHERE profile_id=$1::uuid AND generation_id=$2::uuid",vec![id(pid),id(gid)]).await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        tx.commit().await.map_err(|_|Failure{code:"embedding_storage_failed",retry:true})?;
        Ok::<_,Failure>(())
    }.await;
    if let Err(e) = outcome {
        exec(&s.db,"UPDATE knowledge_vector_jobs SET status=CASE WHEN $4 AND attempts<2 THEN 'retry_wait' ELSE 'failed' END,attempts=attempts+1,error_code=$5,available_at=now()+interval '30 seconds',lease_until=NULL,updated_at=now() WHERE profile_id=$1::uuid AND generation_id=$2::uuid AND epoch=$3 AND status='processing' AND lease_until>now()",vec![id(pid),id(gid),job["epoch"].as_i64().unwrap_or(0).into(),e.retry.into(),e.code.into()]).await.map_err(storage)?;
    }
    Ok(())
}

async fn enqueue(s: &AppState, pid: Uuid, versions: &[String]) -> Result<(), AppError> {
    exec(&s.db,"INSERT INTO knowledge_vector_jobs(profile_id,generation_id,status) SELECT $1::uuid,g.id,'queued' FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id WHERE g.active AND g.status='ready' AND g.version_id IN(SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb)) AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id ON CONFLICT(profile_id,generation_id) DO NOTHING",vec![id(pid),json!(versions).into()]).await.map_err(storage)?;
    Ok(())
}
async fn ready_scope(
    tx: &impl ConnectionTrait,
    pid: Uuid,
    versions: &[String],
) -> Result<(), String> {
    let state=rows(tx,"SELECT jsonb_build_object('chunks',COALESCE(sum(g.chunk_count),0),'complete',COALESCE(bool_and(COALESCE(j.status='ready',false) AND (SELECT count(*) FROM knowledge_vectors e WHERE e.profile_id=$1::uuid AND e.generation_id=g.id)=g.chunk_count),false))::text data FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id LEFT JOIN knowledge_vector_jobs j ON j.generation_id=g.id AND j.profile_id=$1::uuid WHERE g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND g.version_id IN(SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))",vec![id(pid),json!(versions).into()]).await.map_err(|_|"embedding_storage_unavailable")?.remove(0);
    if state["chunks"].as_i64().unwrap_or(0) > 20000 {
        return Err("exact_vector_scope_limit_20000_chunks".into());
    }
    if state["complete"] != true {
        return Err("embedding_index_building_or_failed".into());
    }
    Ok(())
}
async fn vector_candidates(
    s: &AppState,
    pid: Uuid,
    p: &ProfileConfig,
    versions: &[String],
    query: &str,
) -> Result<Vec<Value>, String> {
    let size=rows(&s.db,"SELECT jsonb_build_object('chunks',COALESCE(sum(g.chunk_count),0))::text data FROM knowledge_index_generations g JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id WHERE g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND v.id IN(SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))",vec![json!(versions).into()]).await.map_err(|_|"embedding_storage_unavailable")?.remove(0);
    if size["chunks"].as_i64().unwrap_or(0) > 20000 {
        return Err("exact_vector_scope_limit_20000_chunks".into());
    }
    enqueue(s, pid, versions)
        .await
        .map_err(|_| "embedding_storage_unavailable")?;
    let tx =
        s.db.begin()
            .await
            .map_err(|_| "embedding_storage_unavailable")?;
    tx.execute_unprepared("SET LOCAL statement_timeout='5s'")
        .await
        .map_err(|_| "embedding_storage_unavailable")?;
    ready_scope(&tx, pid, versions).await?;
    tx.commit()
        .await
        .map_err(|_| "embedding_storage_unavailable")?;
    let vectors = embeddings(s, p, &[query.to_owned()])
        .await
        .map_err(|e| e.code.to_owned())?;
    let tx =
        s.db.begin()
            .await
            .map_err(|_| "embedding_storage_unavailable")?;
    tx.execute_unprepared("SET LOCAL statement_timeout='5s'")
        .await
        .map_err(|_| "embedding_storage_unavailable")?;
    tx.execute_unprepared("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .await
        .map_err(|_| "embedding_storage_unavailable")?;
    ready_scope(&tx, pid, versions).await?;
    let found=rows(&tx,&format!("SELECT ({FIELDS}||jsonb_build_object('score',knowledge_cosine_dot(e.embedding,ARRAY(SELECT value::double precision FROM jsonb_array_elements_text($3::jsonb)))))::text data FROM knowledge_vectors e JOIN knowledge_vector_jobs j ON j.profile_id=e.profile_id AND j.generation_id=e.generation_id JOIN knowledge_chunks c ON c.id=e.chunk_id AND c.sha256=e.content_hash JOIN knowledge_index_generations g ON g.id=e.generation_id JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id JOIN knowledge_bases b ON b.id=d.base_id WHERE e.profile_id=$1::uuid AND j.status='ready' AND g.active AND g.status='ready' AND g.version_id IN(SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb)) AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id AND cardinality(e.embedding)=$4 ORDER BY knowledge_cosine_dot(e.embedding,ARRAY(SELECT value::double precision FROM jsonb_array_elements_text($3::jsonb))) DESC,c.id LIMIT 40"),vec![id(pid),json!(versions).into(),json!(vectors[0]).into(),(p.settings.dimensions as i32).into()]).await.map_err(|_|"vector_query_failed")?;
    tx.commit().await.map_err(|_| "vector_query_failed")?;
    Ok(found)
}
/// Reciprocal Rank Fusion: ranks start at 1, k=60, equal source weights;
/// raw lexical/cosine scores are deliberately never added together.
fn fuse(keyword: &[Value], semantic: &[Value]) -> Vec<Value> {
    let mut rows = std::collections::HashMap::<String, (Value, f64)>::new();
    for list in [keyword, semantic] {
        for (rank, row) in super::dedup::group(list.to_vec()).into_iter().enumerate() {
            let key = super::dedup::key(row["body"].as_str().unwrap_or(""));
            let entry = rows.entry(key).or_insert_with(|| (row.clone(), 0.));
            entry.0 = super::dedup::group(vec![entry.0.clone(), row]).remove(0);
            entry.1 += 1. / (60. + rank as f64 + 1.);
        }
    }
    let mut rows = rows
        .into_values()
        .map(|(mut row, score)| {
            row["score"] = json!(score);
            row
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .partial_cmp(&a["score"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a["chunk"].as_str().cmp(&b["chunk"].as_str()))
    });
    rows
}
async fn current_sources(
    s: &AppState,
    user: Uuid,
    found: Vec<Value>,
) -> Result<Vec<Value>, AppError> {
    let grants = authorization::grants_for_user(s, user).await?;
    let ids = found
        .iter()
        .filter_map(|v| v["chunk"].as_str())
        .collect::<Vec<_>>();
    let sources=rows(&s.db,"SELECT jsonb_build_object('chunk',c.id,'base',to_jsonb(b),'package',d.package_version)::text data FROM knowledge_chunks c JOIN knowledge_index_generations g ON g.id=c.generation_id JOIN knowledge_document_versions v ON v.id=g.version_id JOIN knowledge_documents d ON d.id=v.document_id JOIN knowledge_bases b ON b.id=d.base_id WHERE b.tenant_id=$2::uuid AND c.id IN(SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)) AND g.active AND g.status='ready' AND COALESCE(d.parsed_version_id,d.current_version_id)=v.id",vec![json!(ids).into(),id(deployment_scope(s).await?)]).await.map_err(storage)?;
    let valid = sources
        .iter()
        .filter(|row| {
            allowed(&grants, &row["base"], false)
                && (row["base"]["kind"] != "employee_bundle"
                    || row["base"]["employee_id"]
                        .as_str()
                        .and_then(employee_version)
                        .is_some_and(|v| row["package"] == v))
        })
        .filter_map(|v| v["chunk"].as_str())
        .collect::<HashSet<_>>();
    Ok(found
        .into_iter()
        .filter(|v| v["chunk"].as_str().is_some_and(|id| valid.contains(id)))
        .collect())
}
async fn rerank(
    s: &AppState,
    p: &ProfileConfig,
    query: &str,
    found: &[Value],
) -> Result<Vec<Value>, String> {
    let route = p
        .settings
        .reranker_route_id
        .as_deref()
        .ok_or("reranker_not_configured")?;
    let expected = p
        .reranker_endpoint_hash
        .as_deref()
        .ok_or("reranker_not_configured")?;
    let (url, key) = provider(s, route, "reranker", expected)
        .await
        .map_err(|_| "reranker_provider_unavailable_or_changed")?;
    let texts = found
        .iter()
        .map(|v| v["body"].as_str().unwrap_or(""))
        .collect::<Vec<_>>();
    let response=request(&url,&key,"rerank",json!({"model":p.settings.reranker_model,"query":query,"documents":texts,"top_n":found.len(),"return_documents":false})).await.map_err(|e|e.code.to_owned())?;
    let data = response["results"]
        .as_array()
        .ok_or("reranker_response_contract_invalid")?;
    if data.len() != found.len() {
        return Err("reranker_response_contract_invalid".into());
    }
    let mut used = HashSet::new();
    let mut ranked = Vec::new();
    for item in data {
        let index = item["index"]
            .as_u64()
            .ok_or("reranker_response_contract_invalid")? as usize;
        let score = item["relevance_score"]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or("reranker_response_contract_invalid")?;
        if index >= found.len() || !used.insert(index) {
            return Err("reranker_response_contract_invalid".into());
        }
        let mut row = found[index].clone();
        row["score"] = json!(score);
        ranked.push(row);
    }
    ranked.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .partial_cmp(&a["score"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a["chunk"].as_str().cmp(&b["chunk"].as_str()))
    });
    Ok(ranked)
}

/// Group authorized versions by the frozen base profile; never compare raw scores from different models.
pub(super) async fn retrieve(
    s: &AppState,
    user: Uuid,
    snapshot: &Value,
    versions: &[String],
    query: &str,
    keyword: Vec<Value>,
    limit: usize,
) -> Result<(Vec<Value>, Ranking), AppError> {
    let (found, ranking) = retrieve_grouped(s, user, snapshot, versions, query, keyword, limit).await?;
    // Expand only selected groups so persistence can authorize and cite each source separately.
    Ok((super::dedup::expand(found), ranking))
}

async fn retrieve_grouped(
    s: &AppState,
    user: Uuid,
    snapshot: &Value,
    versions: &[String],
    query: &str,
    keyword: Vec<Value>,
    limit: usize,
) -> Result<(Vec<Value>, Ranking), AppError> {
    if snapshot.is_string() || snapshot.is_null() || versions.is_empty() {
        return retrieve_profile(s, user, snapshot, versions, query, keyword, limit).await;
    }
    let sources=rows(&s.db,"SELECT jsonb_build_object('version',v.id,'base',d.base_id)::text data FROM knowledge_document_versions v JOIN knowledge_documents d ON d.id=v.document_id WHERE v.id IN(SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))",vec![json!(versions).into()]).await.map_err(storage)?;
    let mut groups = std::collections::BTreeMap::<String, Vec<String>>::new();
    for source in sources {
        let profile = selected_profile(snapshot, source["base"].as_str().unwrap_or(""));
        groups
            .entry(profile.as_str().unwrap_or("").into())
            .or_default()
            .push(source["version"].as_str().unwrap_or("").into());
    }
    let mut batches = Vec::new();
    let mut rankings = Vec::new();
    for (pid, versions) in groups {
        let local = super::retrieval::candidates(s, &versions, query, 40).await?;
        let frozen = if pid.is_empty() {
            Value::Null
        } else {
            json!(pid)
        };
        let (found, ranking) =
            retrieve_profile(s, user, &frozen, &versions, query, local, 40).await?;
        batches.push(found);
        rankings.push(ranking);
    }
    if rankings.len() == 1 {
        let mut found = batches.pop().unwrap();
        found.truncate(limit);
        return Ok((found, rankings.pop().unwrap()));
    }
    let mut found = batches
        .into_iter()
        .flat_map(|batch| {
            batch.into_iter().enumerate().map(|(i, mut row)| {
                row["score"] = json!(1.0 / (61.0 + i as f64));
                row
            })
        })
        .collect::<Vec<_>>();
    found.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .partial_cmp(&a["score"].as_f64())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a["chunk"].as_str().cmp(&b["chunk"].as_str()))
    });
    found = super::dedup::group(found);
    found.truncate(limit);
    let semantic = rankings.iter().any(|r| r.semantic_search);
    let reranked = rankings.iter().any(|r| r.reranker_enabled);
    let mut limitations = rankings
        .into_iter()
        .flat_map(|r| r.limitations)
        .collect::<Vec<_>>();
    limitations.sort();
    limitations.dedup();
    limitations.push(
        "按知识库分别检索和重排，跨库按倒数排名合并；部分库可能降级，以限制说明为准。".into(),
    );
    Ok((
        found,
        Ranking {
            ranking_mode: if semantic {
                "per-base-hybrid-rrf-v1"
            } else {
                retrieval::MODE
            }
            .into(),
            semantic_search: semantic,
            reranker_enabled: reranked,
            limitations,
        },
    ))
}

async fn retrieve_profile(
    s: &AppState,
    user: Uuid,
    frozen_profile: &Value,
    versions: &[String],
    query: &str,
    keyword: Vec<Value>,
    limit: usize,
) -> Result<(Vec<Value>, Ranking), AppError> {
    let keyword = current_sources(s, user, keyword).await?;
    let fallback = |rows: Vec<Value>, reason: &str| {
        let mut rows = super::dedup::group(rows);
        rows.truncate(limit);
        (rows, Ranking::keyword(reason))
    };
    if versions.is_empty() {
        return Ok(fallback(keyword, "no_authorized_parsed_sources"));
    }
    let Some(pid) = frozen_profile
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
    else {
        return Ok(fallback(keyword, "embedding_not_configured_for_this_task"));
    };
    let p = profile(s, pid).await?; // Changing/disabling the frozen profile is not permission to switch providers.
    let semantic = match vector_candidates(s, pid, &p, versions, query).await {
        Ok(v) => v,
        Err(reason) => {
            if !p.settings.allow_keyword_fallback {
                return Err(AppError::Conflict(format!("知识向量检索未就绪：{reason}")));
            }
            return Ok(fallback(keyword, &reason));
        }
    };
    let semantic = current_sources(s, user, semantic).await?;
    let mut rows = fuse(&keyword, &semantic);
    rows.truncate(40);
    let mut ranking = Ranking {
        ranking_mode: "hybrid-rrf-k60-v1".into(),
        semantic_search: true,
        reranker_enabled: false,
        limitations: vec![
            "PostgreSQL精确余弦召回，范围上限20000分块；排名分数不是事实置信度。".into(),
        ],
    };
    if p.settings.reranker_model.is_some() && !rows.is_empty() {
        match rerank(s, &p, query, &rows).await {
            Ok(ranked) => {
                rows = ranked;
                ranking.reranker_enabled = true;
                ranking.ranking_mode = "hybrid-rrf-k60-reranked-v1".into();
            }
            Err(reason) => {
                if !p.settings.allow_keyword_fallback {
                    return Err(AppError::Conflict(format!("知识重排失败：{reason}")));
                }
                ranking
                    .limitations
                    .push(format!("reranker_fallback_to_rrf:{reason}"));
            }
        }
    }
    // Recheck profile and route ownership after remote calls, before returning any evidence.
    profile(s, pid).await?;
    provider(
        s,
        &p.settings.embedding_route_id,
        "embedding",
        &p.embedding_endpoint_hash,
    )
    .await?;
    if ranking.reranker_enabled {
        if let (Some(route), Some(expected)) =
            (&p.settings.reranker_route_id, &p.reranker_endpoint_hash)
        {
            provider(s, route, "reranker", expected).await?;
        }
    }
    rows.truncate(limit);
    Ok((rows, ranking))
}
