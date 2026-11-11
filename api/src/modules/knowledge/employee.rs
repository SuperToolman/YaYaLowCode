use super::*;
use crate::platform::license::PlatformAiEmployeeEntitlement;
pub async fn employee_downloads(
    p: &PlatformAiEmployeeEntitlement,
    url: &str,
    license: &str,
) -> Result<Vec<Vec<u8>>, AppError> {
    let Some(k) = &p.knowledge else {
        return Ok(Vec::new());
    };
    if k.format_version != 1 || k.version != p.template_version || k.documents.len() > 20 {
        return Err(bad("员工知识合同版本无效，保留原安装"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Server(std::io::Error::other(e)))?;
    let mut files = Vec::new();
    let mut total = 0usize;
    let mut ids = HashSet::new();
    for d in &k.documents {
        if Uuid::parse_str(&d.id).is_err()
            || !ids.insert(d.id.clone())
            || d.size < 1
            || d.size > MAX_BYTES as i64
        {
            return Err(bad("员工知识文档标识或大小无效"));
        }
        let mut u = reqwest::Url::parse(url).map_err(|_| bad("运营中心地址无效"))?;
        u.path_segments_mut()
            .map_err(|_| bad("运营中心地址无效"))?
            .pop_if_empty()
            .extend([
                "api",
                "market",
                "ai-employees",
                p.id.as_str(),
                "knowledge",
                d.id.as_str(),
            ]);
        let mut response = client
            .get(u)
            .bearer_auth(license)
            .send()
            .await
            .map_err(|_| bad("员工知识下载失败，保留原安装"))?;
        if !response.status().is_success() {
            return Err(bad("员工知识已撤回或下载被拒绝，保留原安装"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| bad("员工知识下载中断"))?
        {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(bad("员工知识超过大小限制"));
            }
            bytes.extend_from_slice(&chunk);
        }
        total += bytes.len();
        if total > 40 * 1024 * 1024
            || bytes.len() as i64 != d.size
            || format!("{:x}", Sha256::digest(&bytes)) != d.sha256
        {
            return Err(bad("员工知识大小或 hash 不匹配，保留原安装"));
        }
        validate_file(&d.name, &bytes)?;
        files.push(bytes);
    }
    Ok(files)
}
pub async fn sync_employee(
    tx: &impl ConnectionTrait,
    p: &PlatformAiEmployeeEntitlement,
    files: &[Vec<u8>],
    tenant: Uuid,
    uid: Uuid,
) -> Result<(), AppError> {
    let Some(k) = &p.knowledge else {
        return Ok(());
    };
    let licenses = crate::platform::license::license_status();
    if !licenses.valid
        || !licenses
            .ai_employees
            .iter()
            .any(|e| e.id == p.id && e.expires_at > chrono::Utc::now().timestamp())
    {
        return Err(AppError::Forbidden("员工知识同步时许可证失效".into()));
    }
    exec(tx,"INSERT INTO knowledge_bases(id,tenant_id,kind,name,employee_id,created_by,client_id) VALUES($1::uuid,$2::uuid,'employee_bundle',$3,$4,$5::uuid,$6::uuid) ON CONFLICT(tenant_id,employee_id) WHERE kind='employee_bundle' DO UPDATE SET name=excluded.name",vec![id(Uuid::new_v4()),id(tenant),format!("{}专属知识库",p.title).into(),p.id.clone().into(),id(uid),id(Uuid::new_v4())]).await.map_err(storage)?;
    let b=rows(tx,"SELECT jsonb_build_object('id',id)::text data FROM knowledge_bases WHERE tenant_id=$1::uuid AND employee_id=$2 AND kind='employee_bundle' FOR UPDATE",vec![id(tenant),p.id.clone().into()]).await.map_err(storage)?.remove(0);
    let bid = b["id"].as_str().unwrap_or("");
    if files.len() != k.documents.len() {
        return Err(bad("员工知识资源不完整"));
    }
    for (d, bytes) in k.documents.iter().zip(files) {
        let prior=rows(tx,"SELECT jsonb_build_object('id',id,'version',current_version_id)::text data FROM knowledge_documents WHERE base_id=$1::uuid AND source_id=$2 AND package_version=$3",vec![bid.into(),d.id.clone().into(),k.version.clone().into()]).await.map_err(storage)?;
        if let Some(prior) = prior.first() {
            let vid=Uuid::parse_str(prior["version"].as_str().unwrap_or("")).map_err(storage)?;
            parsing::enqueue(tx,vid).await?;
            continue;
        }
        let did = Uuid::new_v4();
        let vid = Uuid::new_v4();
        exec(tx,"INSERT INTO knowledge_documents(id,base_id,name,source_id,package_version) VALUES($1::uuid,$2::uuid,$3,$4,$5)",vec![id(did),bid.into(),d.name.clone().into(),d.id.clone().into(),k.version.clone().into()]).await.map_err(storage)?;
        exec(tx,"INSERT INTO knowledge_document_versions(id,document_id,version,name,mime_type,size,sha256,contents,created_by,client_id) VALUES($1::uuid,$2::uuid,1,$3,$4,$5,$6,$7,$8::uuid,$9::uuid)",vec![id(vid),id(did),d.name.clone().into(),validate_file(&d.name,bytes)?.into(),d.size.into(),d.sha256.clone().into(),bytes.clone().into(),id(uid),id(Uuid::new_v4())]).await.map_err(storage)?;
        exec(
            tx,
            "UPDATE knowledge_documents SET current_version_id=$2::uuid WHERE id=$1::uuid",
            vec![id(did), id(vid)],
        )
        .await
        .map_err(storage)?;
        parsing::enqueue(tx, vid).await?;
    }
    Ok(())
}
