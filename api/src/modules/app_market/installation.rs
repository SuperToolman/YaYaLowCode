use super::*;
use std::collections::BTreeMap;
type Maps = BTreeMap<String, BTreeMap<String, String>>;

pub(super) async fn manage(state: &AppState, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let grants = authorization::grants(headers, state).await?;
    if !grants.contains("*") && !grants.contains("market.apps.manage") {
        return Err(AppError::Forbidden("需要应用市场管理权限".into()));
    }
    Ok(authorization::current_user(headers, state).await?.id)
}
async fn sql(
    db: &impl ConnectionTrait,
    query: impl Into<String>,
    values: Vec<sea_orm::Value>,
) -> Result<(), AppError> {
    db.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        query,
        values,
    ))
    .await?;
    Ok(())
}
async fn installation(db: &impl ConnectionTrait, id: &str, lock: bool) -> Result<Value, AppError> {
    db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,format!("SELECT to_jsonb(i) AS value FROM market_installations i WHERE installation_id::text=$1{}",if lock{" FOR UPDATE"}else{""}),vec![id.into()])).await?.map(|r|r.try_get("","value")).transpose()?.ok_or_else(||AppError::NotFound("安装不存在".into()))
}
async fn members(db: &impl ConnectionTrait, id: &str) -> Result<Vec<Value>, AppError> {
    Ok(db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT to_jsonb(m) AS value FROM market_installation_members m WHERE installation_id::text=$1 ORDER BY source_app_id",vec![id.into()])).await?.into_iter().map(|r|r.try_get("","value")).collect::<Result<_,sea_orm::DbErr>>()?)
}
async fn downloaded(product: &str) -> Result<(Value, Vec<u8>, Value), AppError> {
    let ticket = market_request(
        "POST",
        &format!("/api/market/applications/{product}/download-ticket"),
        Some(json!({})),
    )
    .await?
    .0
    .data
    .ok_or_else(|| AppError::BadRequest("下载票据为空".into()))?;
    let token = ticket["ticket"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("票据无效".into()))?;
    let settings = load_platform_license_settings()
        .ok_or_else(|| AppError::BadRequest("许可证未配置".into()))?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .get(format!(
            "{}/api/market/downloads/{token}",
            settings.license_center_url.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .to_vec();
    if ticket["packageSha256"].as_str() != Some(protocol::digest(&bytes).as_str()) {
        return Err(AppError::BadRequest("下载包摘要不匹配".into()));
    }
    let (_, bundle) = protocol::read(&bytes).map_err(AppError::BadRequest)?;
    Ok((ticket, bytes, bundle))
}

pub(crate) async fn preflight_market_application(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallPreflight>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let detail = market_request("GET", &format!("/api/market/applications/{product}"), None)
        .await?
        .0
        .data
        .unwrap_or_default();
    let exists = state
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM market_installations WHERE product_id=$1",
            vec![product.clone().into()],
        ))
        .await?
        .is_some();
    Ok(Json(success_response(
        "安装预检完成",
        contract_payload(
            json!({"productId":product,"releaseId":detail["releaseId"],"version":detail["version"],"resourceSummary":detail["resourceSummary"],"alreadyInstalled":exists,"blockingIssues":if exists{vec!["该商品已安装，请使用升级或恢复"]}else if detail["owned"]!=true {vec!["请先购买或免费领取该商品"]}else{vec![]},"connectorBindingRequired":false}),
        )?,
    )))
}

async fn mapping(db: &impl ConnectionTrait, id: &str, bundle: &Value) -> Result<Maps, AppError> {
    let mut maps = Maps::new();
    for row in db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT resource_type,source_id,local_id FROM market_installation_resources WHERE installation_id::text=$1",vec![id.into()])).await?{
        maps.entry(row.try_get("","resource_type")?).or_default().insert(row.try_get("","source_id")?,row.try_get("","local_id")?);
    }
    for member in bundle["members"].as_array().unwrap() {
        for (table, key) in protocol::TABLES {
            if *table == "form_schemas" {
                continue;
            }
            for row in member["resources"][*table].as_array().unwrap() {
                let source_identity =
                    protocol::resource_identity(table, key, row).map_err(AppError::BadRequest)?;
                let source = source_identity.as_str();
                let allocated = if *table == "form_views" && row["view_uuid"] == "default" {
                    "default".to_string()
                } else if *table == "form_views" {
                    maps.get(*table)
                        .and_then(|m| m.get(row["view_uuid"].as_str().unwrap()))
                        .cloned()
                        .unwrap_or_else(|| Uuid::new_v4().to_string())
                } else if *table == "form_detail_definitions" {
                    maps["form_definitions"][source].clone()
                } else if *table == "apps" {
                    format!("app_{}", Uuid::new_v4().simple())
                } else {
                    Uuid::new_v4().to_string()
                };
                let local = maps
                    .entry(String::from(*table))
                    .or_default()
                    .entry(source.into())
                    .or_insert(allocated)
                    .clone();
                if *table == "automation_flows" {
                    if let Some(internal) = row["id"].as_str() {
                        let internal_local = maps
                            .entry(String::from(*table))
                            .or_default()
                            .entry(internal.into())
                            .or_insert_with(|| Uuid::new_v4().to_string())
                            .clone();
                        let _ = internal_local;
                    }
                }
                sql(db,"INSERT INTO market_installation_resources(installation_id,source_app_id,resource_type,source_id,local_id) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT DO NOTHING",vec![id.into(),member["appId"].as_str().unwrap().into(),(*table).into(),source.into(),local.into()]).await?;
                if *table == "automation_flows" {
                    if let Some(internal) = row["id"].as_str() {
                        sql(db,"INSERT INTO market_installation_resources(installation_id,source_app_id,resource_type,source_id,local_id) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT DO NOTHING",vec![id.into(),member["appId"].as_str().unwrap().into(),(*table).into(),internal.into(),maps[*table][internal].clone().into()]).await?;
                    }
                }
            }
        }
    }
    Ok(maps)
}

fn fields(value: &Value, out: &mut BTreeMap<String, Value>) {
    match value {
        Value::Object(o) => {
            if let (Some(id), Some(_)) = (o.get("id").and_then(Value::as_str), o.get("type")) {
                out.insert(id.into(),json!({"type":o["type"],"associationFormId":o.get("props").and_then(|p|p.get("associationFormId"))}));
            }
            for v in o.values() {
                fields(v, out)
            }
        }
        Value::Array(a) => {
            for v in a {
                fields(v, out)
            }
        }
        _ => (),
    }
}
pub(super) fn breaking(before: &Value, after: &Value) -> Vec<String> {
    let mut issues = Vec::new();
    let old = match protocol::resources(before) {
        Ok(v) => v,
        Err(e) => return vec![e],
    };
    let next = match protocol::resources(after) {
        Ok(v) => v,
        Err(e) => return vec![e],
    };
    for (key, (_, row)) in old {
        let Some((_, target)) = next.get(&key) else {
            issues.push(format!("不能移除成员或已有资源：{key}"));
            continue;
        };
        if key.starts_with("form_schemas:") {
            let mut a = BTreeMap::new();
            let mut b = BTreeMap::new();
            fields(&row["schema_json"], &mut a);
            fields(&target["schema_json"], &mut b);
            for (id, field) in a {
                if b.get(&id) != Some(&field) {
                    issues.push(format!("字段删除、类型或关联目标变化：{id}"));
                }
            }
        }
    }
    issues
}

async fn apply(
    db: &impl ConnectionTrait,
    id: &str,
    bundle: &Value,
    release: &str,
    version: &str,
    user: Uuid,
) -> Result<(), AppError> {
    let maps = mapping(db, id, bundle).await?;
    for member in bundle["members"].as_array().unwrap() {
        let source = member["appId"].as_str().unwrap();
        let app = &maps["apps"][source];
        sql(db,"INSERT INTO market_installation_members(installation_id,source_app_id,local_app_id,name) VALUES($1::uuid,$2,$3,$4) ON CONFLICT(installation_id,source_app_id) DO UPDATE SET name=excluded.name",vec![id.into(),source.into(),app.clone().into(),member["resources"]["apps"][0]["name"].as_str().unwrap_or("应用").into()]).await?;
    }
    // Definitions before references; navigation parent constraints are deferred for the transaction.
    for (table, key) in protocol::TABLES {
        for member in bundle["members"].as_array().unwrap() {
            for source in member["resources"][*table].as_array().unwrap() {
                let mut row = source.clone();
                protocol::rewrite(&mut row, &maps).map_err(AppError::BadRequest)?;
                let source_identity = protocol::resource_identity(table, key, source)
                    .map_err(AppError::BadRequest)?;
                let source_id = source_identity.as_str();
                let existing = if *table == "form_schemas" {
                    db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT id::text AS id FROM form_schemas WHERE form_uuid=$1 ORDER BY version DESC LIMIT 1",vec![maps["form_definitions"][source_id].clone().into()])).await?
                } else {
                    let local = &maps[*table][source_id];
                    db.query_one_raw(Statement::from_sql_and_values(
                        DatabaseBackend::Postgres,
                        if *table == "form_views" { "SELECT id::text AS id FROM form_views WHERE view_uuid=$1 AND form_uuid=$2".into() } else { format!("SELECT id::text AS id FROM {table} WHERE {key}::text=$1") },
                        if *table == "form_views" { vec![local.clone().into(),row["form_uuid"].as_str().unwrap().into()] } else { vec![local.clone().into()] },
                    ))
                    .await?
                };
                let row_id = existing
                    .as_ref()
                    .map(|r| r.try_get::<String>("", "id"))
                    .transpose()?
                    .unwrap_or_else(|| {
                        if *table == "app_navigation_items" {
                            maps[*table][source_id].clone()
                        } else if *table == "automation_flows" {
                            maps[*table][source["id"].as_str().unwrap()].clone()
                        } else {
                            Uuid::new_v4().to_string()
                        }
                    });
                row["id"] = json!(row_id);
                if *table != "form_schemas" {
                    row[*key] = json!(maps[*table][source_id]);
                }
                row["created_at"] = json!(Utc::now().to_rfc3339());
                row["updated_at"] = row["created_at"].clone();
                if *table == "apps" {
                    row["creator_user_id"] = json!(user);
                    row["owner_name"] = json!("应用市场");
                    row["records_count"] = json!(0);
                    row["deployment_type"] = json!("market");
                    row["online_release_id"] = json!(release);
                    row["online_version"] = json!(version);
                }
                if *table == "automation_flows" {
                    row["status"] = json!("paused");
                    row["created_by"] = json!("application-market");
                    row["updated_by"] = json!("application-market");
                }
                if *table == "app_custom_buttons" {
                    row["created_by"] = json!(user);
                    row["updated_by"] = json!(user);
                }
                // Use table columns from PostgreSQL, never interpolate user-supplied identifiers.
                if existing.is_some() {
                    let cols=db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",vec![(*table).into()])).await?;
                    let names: Vec<String> = cols
                        .into_iter()
                        .map(|r| r.try_get::<String>("", "column_name"))
                        .collect::<Result<_, _>>()?;
                    let names: Vec<_> = names
                        .iter()
                        .filter(|n| {
                            n.as_str() != "id"
                                && n.as_str() != "created_at"
                                && row.get(n.as_str()).is_some()
                                && !(*table == "apps" && n.as_str() == "records_count")
                        })
                        .map(|n| format!("\"{n}\"=r.\"{n}\""))
                        .collect();
                    sql(db,format!("UPDATE {table} t SET {} FROM jsonb_populate_record(NULL::{table},$1::jsonb) r WHERE t.id=r.id",names.join(",")),vec![row.to_string().into()]).await?;
                } else {
                    sql(db,format!("INSERT INTO {table} SELECT * FROM jsonb_populate_record(NULL::{table},$1::jsonb)"),vec![row.to_string().into()]).await?;
                }
                if *table == "form_schemas"
                    && !bundle["members"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .flat_map(|m| m["resources"]["form_definitions"].as_array().unwrap())
                        .any(|f| {
                            f["form_uuid"] == source["form_uuid"] && f["form_type"] == "detail"
                        })
                {
                    sync_current_storage_plan(
                        db,
                        row["form_uuid"].as_str().unwrap(),
                        row["version"].as_i64().unwrap_or(1) as i32,
                        &row["schema_json"],
                    )
                    .await?;
                }
                if *table == "automation_flows" {
                    let flow = AutomationFlowEntity::find_by_id(Uuid::parse_str(&row_id).unwrap())
                        .one(db)
                        .await?
                        .unwrap();
                    // Version rows are immutable execution snapshots; allocate a fresh local version.
                    let max=db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT COALESCE(MAX(version),0)+1 AS v FROM automation_flow_versions WHERE flow_id=$1::uuid",vec![row_id.clone().into()])).await?.unwrap().try_get::<i32>("","v")?;
                    let mut active: automation_flow_entity::ActiveModel = flow.into();
                    active.current_version = Set(max);
                    let flow = active.update(db).await?;
                    crate::modules::automations::create_automation_snapshot(
                        db,
                        &flow,
                        Some("market package".into()),
                    )
                    .await?;
                }
            }
        }
    }
    let mut baseline = Vec::new();
    for m in members(db, id).await? {
        baseline.push(scanner::capture(db, m["local_app_id"].as_str().unwrap()).await?);
    }
    sql(db,"UPDATE market_installations SET release_id=$2,status='installed',updated_at=NOW(),managed_snapshot=$3::jsonb WHERE installation_id::text=$1",vec![id.into(),release.into(),json!(baseline).to_string().into()]).await?;
    Ok(())
}

async fn changed(db: &impl ConnectionTrait, id: &str, record: &Value) -> Result<bool, AppError> {
    let mut current = Vec::new();
    for m in members(db, id).await? {
        current.push(scanner::capture(db, m["local_app_id"].as_str().unwrap()).await?);
    }
    Ok(record["managed_snapshot"] != json!(current))
}
async fn lock_members(db: &impl ConnectionTrait, id: &str) -> Result<(), AppError> {
    // Coordinate with normal application/schema edits as well as marketplace operations.
    for m in members(db, id).await? {
        let app = m["local_app_id"].as_str().unwrap();
        for query in [
            "SELECT id FROM apps WHERE route_app_id=$1 FOR UPDATE",
            "SELECT id FROM form_definitions WHERE app_route_app_id=$1 ORDER BY id FOR UPDATE",
            "SELECT s.id FROM form_schemas s JOIN form_definitions f ON f.form_uuid=s.form_uuid WHERE f.app_route_app_id=$1 ORDER BY s.id FOR UPDATE OF s",
            "SELECT id FROM automation_flows WHERE app_route_app_id=$1 ORDER BY id FOR UPDATE",
            "SELECT id FROM app_navigation_items WHERE app_route_app_id=$1 ORDER BY id FOR UPDATE",
            "SELECT id FROM app_custom_buttons WHERE app_route_app_id=$1 ORDER BY id FOR UPDATE",
            "SELECT v.id FROM form_views v JOIN form_definitions f ON f.form_uuid=v.form_uuid WHERE f.app_route_app_id=$1 ORDER BY v.id FOR UPDATE OF v",
            "SELECT d.id FROM form_detail_definitions d JOIN form_definitions f ON f.form_uuid=d.detail_form_uuid WHERE f.app_route_app_id=$1 ORDER BY d.id FOR UPDATE OF d",
        ] {
            db.query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                query,
                vec![app.into()],
            ))
            .await?;
        }
    }
    Ok(())
}
async fn store_version(
    db: &impl ConnectionTrait,
    id: &str,
    ticket: &Value,
    bytes: &[u8],
    bundle: &Value,
    event: &str,
) -> Result<(), AppError> {
    let release = ticket["releaseId"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("缺少 releaseId".into()))?;
    // Persist bytes transactionally: no filesystem/DB split or orphan package on rollback.
    sql(db,"INSERT INTO market_installation_versions(installation_id,release_id,version,package_sha256,package_bytes,snapshot_json,applied_at) VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT(installation_id,release_id) DO UPDATE SET applied_at=excluded.applied_at",vec![id.into(),release.into(),ticket["version"].as_str().unwrap_or("1.0.0").into(),protocol::digest(bytes).into(),bytes.to_vec().into(),bundle.to_string().into()]).await?;
    sql(db,"INSERT INTO market_installation_events(id,installation_id,event_type,detail_json,created_at) VALUES($1::uuid,$2::uuid,$3,$4::jsonb,NOW())",vec![Uuid::new_v4().to_string().into(),id.into(),event.into(),ticket.to_string().into()]).await
}

pub(crate) async fn install_market_application(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallResponse>>, AppError> {
    let user = manage(&state, &headers).await?;
    let (ticket, bytes, bundle) = downloaded(&product).await?;
    let id = Uuid::new_v4().to_string();
    let release = ticket["releaseId"].as_str().unwrap();
    let version = ticket["version"].as_str().unwrap_or("1.0.0");
    let txn = state.db.begin().await?;
    txn.execute_unprepared("SET CONSTRAINTS ALL DEFERRED")
        .await?;
    sql(
        &txn,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        vec![product.clone().into()],
    )
    .await?;
    if txn
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM market_installations WHERE product_id=$1",
            vec![product.clone().into()],
        ))
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("商品已安装，请使用更新或恢复".into()));
    }
    sql(&txn,"INSERT INTO market_installations(installation_id,product_id,release_id,status,installed_at,updated_at) VALUES($1::uuid,$2,$3,'installing',NOW(),NOW())",vec![id.clone().into(),product.into(),release.into()]).await?;
    apply(&txn, &id, &bundle, release, version, user).await?;
    let member_app_ids = members(&txn, &id).await?.iter()
        .filter_map(|m| m["local_app_id"].as_str().map(str::to_string)).collect();
    store_version(&txn, &id, &ticket, &bytes, &bundle, "installed").await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "整套应用安装完成",
        MarketInstallResponse {
            installation_id: id,
            member_app_ids,
            release_id: release.into(),
            disabled_automations: scanner::summary(&bundle)["automations"]
                .as_u64()
                .unwrap_or(0) as usize,
        },
    )))
}

pub(crate) async fn list_market_installations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MarketInstallation>>>, AppError> {
    let _ = authorization::current_user(&headers, &state).await?;
    let mut list = Vec::new();
    for row in state
        .db
        .query_all_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            "SELECT installation_id::text AS id FROM market_installations ORDER BY updated_at DESC"
                .to_string(),
        ))
        .await?
    {
        let id: String = row.try_get("", "id")?;
        let r = installation(&state.db, &id, false).await?;
        let events=state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT jsonb_build_object('eventType',event_type,'detail',detail_json,'createdAt',created_at) AS value FROM market_installation_events WHERE installation_id::text=$1 ORDER BY created_at DESC LIMIT 20",vec![id.clone().into()])).await?.into_iter().map(|r|r.try_get::<Value>("","value")).collect::<Result<Vec<_>,_>>()?;
        let versions=state.db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT jsonb_build_object('releaseId',release_id,'version',version,'appliedAt',applied_at) AS value FROM market_installation_versions WHERE installation_id::text=$1 ORDER BY applied_at DESC",vec![id.clone().into()])).await?.into_iter().map(|r|r.try_get::<Value>("","value")).collect::<Result<Vec<_>,_>>()?;
        list.push(contract_payload(json!({"installationId":id,"productId":r["product_id"],"releaseId":r["release_id"],"memberAppIds":members(&state.db,&id).await?.iter().filter_map(|m|m["local_app_id"].as_str().map(str::to_string)).collect::<Vec<_>>(),"status":r["status"],"installedAt":r["installed_at"],"updatedAt":r["updated_at"],"archivedAt":r["archived_at"],"versions":versions,"events":events,"members":members(&state.db,&id).await?}))?);
    }
    Ok(Json(success_response("安装记录已读取", list)))
}

pub(crate) async fn preflight_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MarketUpgradePreflight>>, AppError> {
    manage(&state, &headers).await?;
    let r = installation(&state.db, &id, false).await?;
    let (ticket, _, bundle) = downloaded(r["product_id"].as_str().unwrap()).await?;
    let old=state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT snapshot_json FROM market_installation_versions WHERE installation_id::text=$1 AND release_id=$2",vec![id.clone().into(),r["release_id"].as_str().unwrap().into()])).await?.ok_or_else(||AppError::BadRequest("旧安装需要重置后重装".into()))?.try_get::<Value>("","snapshot_json")?;
    let mut blockers = breaking(&old, &bundle);
    if r["status"] != "installed" {
        blockers.push("应用未处于已安装状态".into());
    }
    if changed(&state.db, &id, &r).await? {
        blockers.push("本地结构已修改，请先解决冲突".into());
    }
    Ok(Json(success_response(
        "升级预检完成",
        contract_payload(
            json!({"installationId":id,"currentReleaseId":r["release_id"],"targetReleaseId":ticket["releaseId"],"targetVersion":ticket["version"],"upToDate":r["release_id"]==ticket["releaseId"],"canUpgrade":blockers.is_empty()&&r["release_id"]!=ticket["releaseId"],"blockingIssues":blockers}),
        )?,
    )))
}

async fn update(
    state: &AppState,
    headers: &HeaderMap,
    id: &str,
    rollback: Option<&str>,
) -> Result<Json<ApiResponse<MarketReleaseResponse>>, AppError> {
    let user = manage(state, headers).await?;
    let r = installation(&state.db, id, false).await?;
    let (ticket, bytes, bundle) = if let Some(target) = rollback {
        let row=state.db.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT version,package_bytes FROM market_installation_versions WHERE installation_id::text=$1 AND release_id=$2",vec![id.into(),target.into()])).await?.ok_or_else(||AppError::NotFound("本地历史包不存在".into()))?;
        let bytes: Vec<u8> = row.try_get("", "package_bytes")?;
        let (_, bundle) = protocol::read(&bytes).map_err(AppError::BadRequest)?;
        (
            json!({"releaseId":target,"version":row.try_get::<String>("","version")?}),
            bytes,
            bundle,
        )
    } else {
        downloaded(r["product_id"].as_str().unwrap()).await?
    };
    let txn = state.db.begin().await?;
    txn.execute_unprepared("SET CONSTRAINTS ALL DEFERRED")
        .await?;
    let r = installation(&txn, id, true).await?;
    lock_members(&txn, id).await?;
    if r["status"] != "installed" {
        return Err(AppError::BadRequest("请先恢复已归档应用".into()));
    }
    let old=txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT snapshot_json FROM market_installation_versions WHERE installation_id::text=$1 AND release_id=$2",vec![id.into(),r["release_id"].as_str().unwrap().into()])).await?.ok_or_else(||AppError::BadRequest("缺少当前版本快照".into()))?.try_get::<Value>("","snapshot_json")?;
    let blockers = breaking(&old, &bundle);
    if !blockers.is_empty() {
        return Err(AppError::BadRequest(blockers.join("；")));
    }
    if changed(&txn, id, &r).await? {
        return Err(AppError::Conflict("本地应用结构已修改，不能覆盖".into()));
    }
    let release = ticket["releaseId"].as_str().unwrap();
    apply(
        &txn,
        id,
        &bundle,
        release,
        ticket["version"].as_str().unwrap(),
        user,
    )
    .await?;
    store_version(
        &txn,
        id,
        &ticket,
        &bytes,
        &bundle,
        if rollback.is_some() {
            "rolled_back"
        } else {
            "upgraded"
        },
    )
    .await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "整套版本已更新",
        MarketReleaseResponse {
            installation_id: id.into(),
            release_id: release.into(),
        },
    )))
}
pub(crate) async fn upgrade_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MarketReleaseResponse>>, AppError> {
    update(&state, &headers, &id, None).await
}
pub(crate) async fn rollback_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<MarketRollbackRequest>,
) -> Result<Json<ApiResponse<MarketReleaseResponse>>, AppError> {
    update(
        &state,
        &headers,
        &id,
        Some(
            request
                .release_id
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("请选择回滚版本".into()))?,
        ),
    )
    .await
}

async fn status(
    state: &AppState,
    headers: &HeaderMap,
    id: &str,
    archive: bool,
) -> Result<Json<ApiResponse<MarketInstallationStatus>>, AppError> {
    manage(state, headers).await?;
    let txn = state.db.begin().await?;
    let record = installation(&txn, id, true).await?;
    let expected = if archive { "installed" } else { "archived" };
    if record["status"] != expected {
        return Err(AppError::Conflict("安装状态已变化，请刷新后重试".into()));
    }
    lock_members(&txn, id).await?;
    for m in members(&txn, id).await? {
        let app = m["local_app_id"].as_str().unwrap();
        sql(
            &txn,
            "UPDATE apps SET deployment_type=$2 WHERE route_app_id=$1",
            vec![
                app.into(),
                if archive { "market_archived" } else { "market" }.into(),
            ],
        )
        .await?;
        if archive {
            sql(
                &txn,
                "UPDATE automation_flows SET status='paused' WHERE app_route_app_id=$1",
                vec![app.into()],
            )
            .await?;
        }
    }
    let value = if archive { "archived" } else { "installed" };
    sql(&txn,"UPDATE market_installations SET status=$2,archived_at=CASE WHEN $2='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE installation_id::text=$1",vec![id.into(),value.into()]).await?;
    sql(&txn,"INSERT INTO market_installation_events(id,installation_id,event_type,detail_json,created_at) VALUES($1::uuid,$2::uuid,$3,'{}'::jsonb,NOW())",vec![Uuid::new_v4().to_string().into(),id.into(),value.into()]).await?;
    txn.commit().await?;
    Ok(Json(success_response(
        "整套状态已更新",
        MarketInstallationStatus {
            installation_id: id.into(),
            status: value.into(),
        },
    )))
}
pub(crate) async fn archive_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallationStatus>>, AppError> {
    status(&state, &headers, &id, true).await
}
pub(crate) async fn restore_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MarketInstallationStatus>>, AppError> {
    status(&state, &headers, &id, false).await
}
pub(crate) async fn purge_installation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MarketPurgeResponse>>, AppError> {
    manage(&state, &headers).await?;
    let txn = state.db.begin().await?;
    let r = installation(&txn, &id, true).await?;
    if r["status"] != "archived" {
        return Err(AppError::BadRequest("永久清理前必须归档整套应用".into()));
    }
    lock_members(&txn, &id).await?;
    let apps = members(&txn, &id).await?;
    for m in &apps {
        let app = m["local_app_id"].as_str().unwrap();
        for form in FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(app))
            .all(&txn)
            .await?
        {
            if crate::platform::records::RecordRepository::new(&txn)
                .count_for_deletion(&form.form_uuid)
                .await?
                > 0
            {
                return Err(AppError::BadRequest(
                    "成员应用仍有业务数据，不能永久清理".into(),
                ));
            }
        }
        if txn.query_one_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,"SELECT 1 FROM workflow_instances WHERE form_uuid IN (SELECT form_uuid FROM form_definitions WHERE app_route_app_id=$1) LIMIT 1",vec![app.into()])).await?.is_some(){return Err(AppError::BadRequest("成员应用仍有流程实例".into()));}
    }
    for m in apps {
        crate::modules::apps::deletion::delete_app_contents(
            &txn,
            m["local_app_id"].as_str().unwrap(),
        )
        .await?;
    }
    for table in [
        "market_installation_members",
        "market_installation_resources",
        "market_installation_versions",
        "market_installation_events",
        "market_installations",
    ] {
        sql(
            &txn,
            format!("DELETE FROM {table} WHERE installation_id::text=$1"),
            vec![id.clone().into()],
        )
        .await?;
    }
    txn.commit().await?;
    Ok(Json(success_response(
        "整套应用已清理",
        MarketPurgeResponse {
            installation_id: id,
        },
    )))
}

#[cfg(test)]
mod tests {
    include!("installation_tests.rs");
}
