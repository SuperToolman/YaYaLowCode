//! Explicit offline maintenance. Preview never mutates the database or package files.
use super::*;
use std::collections::BTreeMap;
use std::path::Path;

pub(super) fn package_files(root: &Path) -> Result<BTreeMap<PathBuf, String>, String> {
    let mut result = BTreeMap::new();
    if !root.exists() {
        return Ok(result);
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if root.parent().is_none() || root.parent().and_then(Path::parent).is_none() {
        return Err("不能清理磁盘根目录".into());
    }
    fn visit(path: &Path, result: &mut BTreeMap<PathBuf, String>) -> Result<(), String> {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let ty = entry.file_type().map_err(|e| e.to_string())?;
            if ty.is_symlink() {
                return Err("包目录包含链接，请先人工核对".into());
            }
            let p = entry.path();
            if ty.is_dir() {
                if entry.file_name() != "installed-packages" && entry.file_name() != "history" {
                    return Err(format!("市场目录包含非预期子目录：{}", p.display()));
                }
                visit(&p, result)?;
            } else {
                if !p
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|e| matches!(e, "json" | "zip" | "tmp"))
                {
                    return Err(format!("市场目录包含非预期文件：{}", p.display()));
                }
                result.insert(
                    p.clone(),
                    protocol::digest(&fs::read(&p).map_err(|e| e.to_string())?),
                );
            }
        }
        Ok(())
    }
    visit(&root, &mut result)?;
    Ok(result)
}

async fn snapshot(db: &impl ConnectionTrait) -> Result<Value, AppError> {
    let mut value = json!({"database":db.query_one_raw(Statement::from_string(DatabaseBackend::Postgres,"SELECT current_database() AS name".to_string())).await?.unwrap().try_get::<String>("","name")?,"tables":{}});
    for table in [
        "apps",
        "market_installations",
        "market_installation_members",
        "market_installation_resources",
        "market_installation_versions",
        "market_installation_events",
        "market_publications",
    ] {
        let exists = db
            .query_one_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT to_regclass($1)::text AS name",
                vec![table.into()],
            ))
            .await?
            .unwrap()
            .try_get::<Option<String>>("", "name")?
            .is_some();
        if exists {
            value["tables"][table]=db.query_one_raw(Statement::from_string(DatabaseBackend::Postgres,format!("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM {table} t"))).await?.unwrap().try_get::<Value>("","value")?;
        }
    }
    let apps = AppEntity::find()
        .filter(app_entity::Column::DeploymentType.is_in(["market", "market_archived"]))
        .all(db)
        .await?;
    let mut data = Vec::new();
    for app in apps {
        let mut item = json!({"appId":app.route_app_id,"name":app.name,"forms":[]});
        let mut forms = Vec::new();
        for form in FormDefinitionEntity::find()
            .filter(form_definition_entity::Column::AppRouteAppId.eq(&app.route_app_id))
            .all(db)
            .await?
        {
            let storage=crate::infrastructure::entities::form_storage_definition_entity::Entity::find().filter(crate::infrastructure::entities::form_storage_definition_entity::Column::FormUuid.eq(&form.form_uuid)).one(db).await?;
            let content = if let Some(storage) = storage {
                if !crate::platform::form_storage::is_safe_identifier(&storage.physical_table) {
                    return Err(AppError::BadRequest("物理表名称无效".into()));
                }
                db.query_one_raw(Statement::from_string(DatabaseBackend::Postgres,format!("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM \"{}\" t",storage.physical_table))).await?.unwrap().try_get::<Value>("","value")?
            } else {
                json!([])
            };
            forms.push(json!({"formId":form.form_uuid,"records":crate::platform::records::RecordRepository::new(db).count_for_deletion(&form.form_uuid).await?,"contentDigest":protocol::digest(content.to_string().as_bytes())}));
        }
        item["forms"] = json!(forms);
        item["structure"] = scanner::capture(db, &app.route_app_id).await?;
        data.push(item);
    }
    value["deleteApplications"] = json!(data);
    Ok(value)
}
pub(crate) async fn command(
    db: &DatabaseConnection,
    confirmation: Option<&str>,
) -> Result<Value, AppError> {
    let txn = db.begin().await?;
    // Block all application/data writers while checking the confirmation and deleting.
    txn.execute_unprepared(
        "LOCK TABLE apps,form_definitions,form_schemas,automation_flows IN ACCESS EXCLUSIVE MODE",
    )
    .await?;
    let snapshot = snapshot(&txn).await?;
    let files = package_files(&root()).map_err(AppError::BadRequest)?;
    let preview = json!({"database":snapshot["database"],"packageRoot":std::path::absolute(root()).map_err(AppError::Server)?.to_string_lossy(),"deleteApplications":snapshot["deleteApplications"],"marketTables":snapshot["tables"].as_object().unwrap().iter().filter(|(k,_)|k.as_str()!="apps").map(|(k,v)|(k.clone(),json!(v.as_array().map_or(0,Vec::len)))).collect::<serde_json::Map<_,_>>(),"packageFiles":files.len()});
    let credential = protocol::digest(
        &serde_json::to_vec(
            &json!({"snapshot":snapshot,"files":files,"root":preview["packageRoot"]}),
        )
        .map_err(|e| AppError::BadRequest(e.to_string()))?,
    );
    if let Some(token) = confirmation {
        if token != credential {
            return Err(AppError::Conflict(
                "重置凭据失效，数据或文件已变化，请重新预览".into(),
            ));
        }
        for app in snapshot["deleteApplications"].as_array().unwrap() {
            crate::modules::apps::deletion::delete_app_contents(
                &txn,
                app["appId"].as_str().unwrap(),
            )
            .await?;
        }
        for table in [
            "market_installation_members",
            "market_installation_resources",
            "market_installation_versions",
            "market_installation_events",
            "market_installations",
            "market_publications",
        ] {
            if snapshot["tables"].get(table).is_some() {
                txn.execute_unprepared(&format!("DELETE FROM {table}"))
                    .await?;
            }
        }
        txn.execute_unprepared("UPDATE apps SET deployment_type='local',online_version=NULL,online_release_id=NULL WHERE deployment_type='online' OR online_release_id IS NOT NULL").await?;
        if package_files(&root()).map_err(AppError::BadRequest)? != files {
            return Err(AppError::Conflict("包文件已变化，请重新预览".into()));
        }
        txn.commit().await?;
        for path in files.keys() {
            fs::remove_file(path).map_err(AppError::Server)?;
        }
        return Ok(json!({"executed":true,"preview":preview}));
    }
    txn.rollback().await?;
    Ok(json!({"executed":false,"confirmation":credential,"preview":preview}))
}
