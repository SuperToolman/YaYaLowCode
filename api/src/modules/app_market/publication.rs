use super::*;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublishRequest {
    pub fingerprint: String,
    pub selected_app_ids: Vec<String>,
    pub package_name: Option<String>,
    pub commercial: CommercialConfig,
    pub product_id: Option<String>,
    #[serde(default)]
    pub new_product: bool,
}

pub(crate) async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<ApiResponse<MarketSubmission>>, AppError> {
    let scan = scanner::scan(&state, &headers, &app, &request.selected_app_ids).await?;
    request.commercial.validate()?;
    if scan["fingerprint"] != request.fingerprint {
        return Err(AppError::Conflict(
            "应用结构或依赖已变化，请重新预检确认".into(),
        ));
    }
    if scan["blockingIssues"]
        .as_array()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(AppError::BadRequest(scan["blockingIssues"].to_string()));
    }
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("请先配置运营管理平台与许可证".into()))?;
    let claims = validate_license_token(&settings.license).map_err(AppError::BadRequest)?;
    let mut bundle = named_bundle(&scan["bundle"], request.package_name.as_deref())?;
    let previous = load(&app);
    // A failed upload is retried byte-for-byte, including when the first response was lost.
    if let Some(old) = &previous {
        if old.status == "upload_pending"
            && old.fingerprint == request.fingerprint
            && old.snapshot["commercial"] == json!(request.commercial)
            && old.snapshot["manifest"]["packageName"] == bundle["packageName"]
            && old.snapshot["newProduct"].as_bool().unwrap_or(false) == request.new_product
            && (request.product_id.is_none() || request.product_id == old.product_id)
        {
            let bytes = fs::read(root().join(format!("{}.zip", old.submission_id)))
                .map_err(AppError::Server)?;
            let mut result = sync_to_operation_center(old, bytes).await?;
            result.fingerprint = old.fingerprint.clone();
            save(&result)?;
            save_product(&state.db, &result).await?;
            return Ok(Json(success_response("上线申请已重试", result)));
        }
    }
    let product_id = if request.new_product {
        None
    } else {
        request
            .product_id
            .clone()
            .or_else(|| previous.as_ref().and_then(|p| p.product_id.clone()))
    };
    let version = if let Some(product) = &product_id {
        let info = market_request(
            "GET",
            &format!("/api/market/applications/{product}/publication"),
            None,
        )
        .await?
        .0
        .data
        .unwrap_or_default();
        info["nextVersion"]
            .as_str()
            .ok_or_else(|| AppError::BadRequest("缺少下一版本信息".into()))?
            .to_string()
    } else {
        default_version()
    };
    bundle["publication"] = json!({"submissionType":if product_id.is_some(){"version_upgrade"}else{"new_listing"},"targetProductId":product_id});
    let (manifest, bytes) = build_package(&bundle, &version)?;
    let user = authorization::current_user(&headers, &state).await?;
    let submission = MarketSubmission {
        submission_id: format!("sub_{}", Uuid::new_v4().simple()),
        app_id: app.clone(),
        app_name: bundle["packageName"].as_str().unwrap().into(),
        version,
        status: "upload_pending".into(),
        submitted_by: user.display_name,
        applicant_subject: claims.subject,
        submitted_at: Utc::now().timestamp(),
        snapshot: json!({"formatVersion":3,"newProduct":request.new_product,"submissionType":if product_id.is_some(){"version_upgrade"}else{"new_listing"},"source":"online","manifest":manifest,"packageSha256":protocol::digest(&bytes),"resourceSummary":scanner::summary(&bundle),"commercial":request.commercial}),
        product_id,
        fingerprint: request.fingerprint,
        review_reason: String::new(),
    };
    fs::create_dir_all(root()).map_err(AppError::Server)?;
    fs::write(
        root().join(format!("{}.zip", submission.submission_id)),
        &bytes,
    )
    .map_err(AppError::Server)?;
    save(&submission)?;
    let mut result = sync_to_operation_center(&submission, bytes).await?;
    result.fingerprint = submission.fingerprint;
    save(&result)?;
    save_product(&state.db, &result).await?;
    Ok(Json(success_response("应用申请已提交，等待审核", result)))
}

pub(crate) async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app): Path<String>,
) -> Result<Json<ApiResponse<Option<MarketSubmission>>>, AppError> {
    publication_access::require_enabled()?;
    publication_access::require_administrator(&authorization::grants(&headers, &state).await?)?;
    let mut local = load(&app);
    if let Some(old) = &local {
        if let Ok(response) = market_request(
            "GET",
            &format!("/api/application-submissions/{}/status", old.submission_id),
            None,
        )
        .await
        {
            if let Some(value) = response.0.data {
                let mut updated: MarketSubmission = contract_payload(value)?;
                updated.fingerprint = old.fingerprint.clone();
                save(&updated)?;
                save_product(&state.db, &updated).await?;
                local = Some(updated);
            }
        }
    }
    Ok(Json(success_response("上线申请已读取", local)))
}

async fn save_product(db: &impl ConnectionTrait, value: &MarketSubmission) -> Result<(), AppError> {
    if let Some(product) = &value.product_id {
        db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"INSERT INTO market_publications(product_id,submission_id,status,snapshot_json,updated_at) VALUES($1,$2,$3,$4::jsonb,NOW()) ON CONFLICT(product_id) DO UPDATE SET submission_id=excluded.submission_id,status=excluded.status,snapshot_json=excluded.snapshot_json,updated_at=NOW()",vec![product.clone().into(),value.submission_id.clone().into(),value.status.clone().into(),serde_json::to_string(value).map_err(|e|AppError::BadRequest(e.to_string()))?.into()])).await?;
    }
    Ok(())
}

fn named_bundle(source: &Value, requested: Option<&str>) -> Result<Value, AppError> {
    let root = source["members"]
        .as_array()
        .and_then(|m| m.first())
        .ok_or_else(|| AppError::BadRequest("应用包缺少成员".into()))?;
    let name = if source["applicationType"] == "suite" {
        requested.unwrap_or("").trim()
    } else {
        root["resources"]["apps"][0]["name"]
            .as_str()
            .unwrap_or("应用")
    };
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "请填写套应用名称（1–80 字，不含控制字符）".into(),
        ));
    }
    let mut bundle = source.clone();
    bundle["packageName"] = json!(name);
    Ok(bundle)
}

pub(super) fn build_package(bundle: &Value, version: &str) -> Result<(Value, Vec<u8>), AppError> {
    let data = serde_json::to_vec(&bundle).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let manifest = json!({"formatVersion":3,"packageType":"yaya-application","packageName":bundle["packageName"],"selectedAppIds":bundle["selectedAppIds"],"version":version,"applicationType":bundle["applicationType"],"members":bundle["members"],"dependencies":bundle["dependencies"],"publication":bundle["publication"],"checksums":{"bundle.json":protocol::digest(&data)}});
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in [
        (
            "manifest.json",
            serde_json::to_vec(&manifest).map_err(|e| AppError::BadRequest(e.to_string()))?,
        ),
        ("bundle.json", data),
    ] {
        zip.start_file(
            name,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
        zip.write_all(&bytes).map_err(AppError::Server)?;
    }
    let bytes = zip
        .finish()
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .into_inner();
    protocol::read(&bytes).map_err(AppError::BadRequest)?;
    Ok((manifest, bytes))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportPackageRequest {
    pub fingerprint: String,
    pub selected_app_ids: Vec<String>,
    pub package_name: Option<String>,
    pub version: String,
    #[serde(default)]
    pub submission_type: Option<String>,
    pub target_product_id: Option<String>,
}

pub(crate) async fn export_package(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(app): Path<String>,
    Json(request): Json<ExportPackageRequest>,
) -> Result<axum::response::Response, AppError> {
    let scan = scanner::scan(&state, &headers, &app, &request.selected_app_ids).await?;
    if scan["fingerprint"] != request.fingerprint {
        return Err(AppError::Conflict(
            "应用结构或依赖已变化，请重新预检确认".into(),
        ));
    }
    if scan["blockingIssues"]
        .as_array()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(AppError::BadRequest(scan["blockingIssues"].to_string()));
    }
    let version = request.version.trim();
    if version.is_empty()
        || version.len() > 64
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    {
        return Err(AppError::BadRequest("请输入有效版本号，例如 1.0.0".into()));
    }
    let mut bundle = named_bundle(&scan["bundle"], request.package_name.as_deref())?;
    let kind = request.submission_type.as_deref().unwrap_or("new_listing");
    if !matches!(kind, "new_listing" | "version_upgrade") || (kind == "new_listing" && request.target_product_id.is_some()) || (kind == "version_upgrade") != request.target_product_id.as_ref().is_some_and(|id| !id.trim().is_empty()) {
        return Err(AppError::BadRequest("版本升级必须指定目标商品，新上线不能指定目标商品".into()));
    }
    bundle["publication"] = json!({"submissionType":kind,"targetProductId":request.target_product_id});
    let (_, bytes) = build_package(&bundle, version)?;
    let name = bundle["packageName"].as_str().unwrap();
    let mut response = axum::response::Response::new(axum::body::Body::from(bytes));
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/zip"),
    );
    response.headers_mut().insert(
        axum::http::header::CONTENT_DISPOSITION,
        crate::shared::download_content_disposition(&format!("{name}-{version}.zip")),
    );
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_names_are_required_for_suites_and_single_apps_keep_their_name() {
        let suite=protocol::tests::bundle();
        assert!(named_bundle(&suite,None).is_err());
        assert!(named_bundle(&suite,Some("   ")).is_err());
        assert!(named_bundle(&suite,Some(&"名".repeat(81))).is_err());
        let named=named_bundle(&suite,Some(" 客户经营套件 ")).unwrap();
        assert_eq!(named["packageName"],"客户经营套件");
        let (_,bytes)=build_package(&named,"1.0.0").unwrap();
        assert_eq!(protocol::read(&bytes).unwrap().0["packageName"],"客户经营套件");
        let mut single=suite.clone();single["applicationType"]=json!("single");
        assert_eq!(named_bundle(&single,Some("ignored")).unwrap()["packageName"],"应用1");
    }
    #[test]
    fn exported_zip_uses_the_online_package_contract() {
        let bundle = protocol::tests::bundle();
        let (manifest, bytes) = build_package(&bundle, "1.0.7").unwrap();
        let (read_manifest, read_bundle) = protocol::read(&bytes).unwrap();
        assert_eq!(read_bundle, bundle);
        assert_eq!(read_manifest, manifest);
        assert_eq!(read_manifest["version"], "1.0.7");
        assert_eq!(read_manifest["applicationType"], "suite");
    }
}


fn require_records_access(grants: &HashSet<String>) -> Result<(), AppError> {
    publication_access::require_enabled()?;
    publication_access::require_administrator(grants)
}

pub(crate) async fn list_submissions(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<ApiResponse<Value>>, AppError> {
    publication_access::require_enabled()?;
    require_records_access(&authorization::grants(&headers, &state).await?)?;
    let subject = load_platform_license_settings().and_then(|settings| validate_license_token(&settings.license).ok()).map(|claims|claims.subject);
    let mut records = std::collections::BTreeMap::new();
    for directory in [root(), root().join("history")] {
        if !directory.exists() { continue; }
        for entry in fs::read_dir(directory).map_err(AppError::Server)? {
            let entry = entry.map_err(AppError::Server)?;
            if entry.path().extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let value: MarketSubmission = serde_json::from_slice(&fs::read(entry.path()).map_err(AppError::Server)?)
                .map_err(|e|AppError::BadRequest(format!("申请记录读取失败：{e}")))?;
            if subject.as_ref().is_some_and(|subject| !value.applicant_subject.is_empty() && &value.applicant_subject != subject) { continue; }
            fs::create_dir_all(root().join("history")).map_err(AppError::Server)?;
            if !root().join("history").join(format!("{}.json", value.submission_id)).exists() {
                write_submission(&root().join("history").join(format!("{}.json", value.submission_id)), &value)?;
            }
            records.insert(value.submission_id.clone(), json!(value));
        }
    }
    // The license-scoped operations history also includes packages imported by staff.
    let remote = market_request("GET", "/api/market/application-submissions", None).await;
    let sync_error = remote.as_ref().err().map(|_| "运营平台暂时不可用，当前显示本地保存记录，审核状态可能尚未更新".to_string());
    if let Ok(response) = remote {
        for value in response.0.data.unwrap_or_default().as_array().into_iter().flatten() {
            let mut value = value.clone();
            if let Some(old) = records.get(value["submissionId"].as_str().unwrap_or("")) {
                value["appId"] = old["appId"].clone();
                value["fingerprint"] = old["fingerprint"].clone();
            }
            let cached: MarketSubmission = contract_payload(&value)?;
            if !cached.submission_id.is_empty() && cached.submission_id.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'_') {
                fs::create_dir_all(root().join("history")).map_err(AppError::Server)?;
                write_submission(&root().join("history").join(format!("{}.json", cached.submission_id)), &cached)?;
            }
            if let Some(id) = value["submissionId"].as_str() { records.insert(id.to_string(), value); }
        }
    }
    let mut values: Vec<Value> = records.into_values().collect();
    values.sort_by_key(|v| std::cmp::Reverse(v["submittedAt"].as_i64().unwrap_or(0)));
    Ok(Json(success_response("上线申请记录已读取", json!({"records":values,"syncError":sync_error}))))
}

pub(crate) async fn retry_submission(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> Result<Json<ApiResponse<MarketSubmission>>, AppError> {
    publication_access::require_enabled()?;
    require_records_access(&authorization::grants(&headers, &state).await?)?;
    if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') || id.is_empty() { return Err(AppError::BadRequest("申请编号无效".into())); }
    let file = root().join("history").join(format!("{id}.json"));
    let old: MarketSubmission = serde_json::from_slice(&fs::read(file).map_err(AppError::Server)?)
        .map_err(|e|AppError::BadRequest(e.to_string()))?;
    if old.status != "upload_pending" { return Err(AppError::Conflict("只能重试尚未上传成功的申请".into())); }
    let claims = load_platform_license_settings().ok_or_else(||AppError::BadRequest("请先配置许可证".into()))?;
    let claims = validate_license_token(&claims.license).map_err(AppError::BadRequest)?;
    if claims.subject != old.applicant_subject { return Err(AppError::Forbidden("不能重试其他发布主体的申请".into())); }
    let bytes = fs::read(root().join(format!("{id}.zip"))).map_err(AppError::Server)?;
    let mut result = sync_to_operation_center(&old, bytes).await?;
    result.fingerprint = old.fingerprint;
    fs::create_dir_all(root().join("history")).map_err(AppError::Server)?;
    write_submission(&root().join("history").join(format!("{id}.json")), &result)?;
    if load(&result.app_id).is_some_and(|latest|latest.submission_id == id) { save(&result)?; }
    save_product(&state.db, &result).await?;
    Ok(Json(success_response("申请已重新上传", result)))
}
