use super::*;
use crate::infrastructure::entities::{
    app_entity, iam_role_entity, iam_role_permission_entity, iam_user_entity, iam_user_role_entity,
};
use sea_orm::{ConnectOptions, Database, Schema};
fn token(user: Uuid) -> String {
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"sub":user,"exp":chrono::Utc::now().timestamp()+3600}),
        &jsonwebtoken::EncodingKey::from_secret(
            std::env::var("AUTH_TOKEN_SECRET").unwrap().as_bytes(),
        ),
    )
    .unwrap()
}
#[tokio::test]
#[ignore = "requires KNOWLEDGE_TEST_DATABASE_URL; creates and drops only a random isolated schema"]
async fn knowledge_postgres_http() {
    let url =
        std::env::var("KNOWLEDGE_TEST_DATABASE_URL").expect("explicit test connection required");
    let admin = Database::connect(url.clone()).await.unwrap();
    let schema = format!("knowledge_test_{}", Uuid::new_v4().simple());
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
        .await
        .unwrap();
    let mut opts = ConnectOptions::new(url);
    opts.set_schema_search_path(&schema).sqlx_logging(false);
    let db = Database::connect(opts).await.unwrap();
    let result = tokio::spawn(verify(db.clone())).await;
    db.close().await.unwrap();
    admin
        .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
        .await
        .unwrap();
    result.unwrap();
}
async fn verify(db: sea_orm::DatabaseConnection) {
    let schema = Schema::new(db.get_database_backend());
    for stmt in [
        schema.create_table_from_entity(iam_user_entity::Entity),
        schema.create_table_from_entity(iam_role_entity::Entity),
        schema.create_table_from_entity(iam_user_role_entity::Entity),
        schema.create_table_from_entity(iam_role_permission_entity::Entity),
        schema.create_table_from_entity(app_entity::Entity),
    ] {
        db.execute(&stmt).await.unwrap();
    }
    db.execute_unprepared("CREATE TABLE agent_v2_runs(id uuid PRIMARY KEY); CREATE TABLE byom_model_routes(id text PRIMARY KEY,created_by_user_id uuid,name text,api_base_url text,encrypted_api_key text,enabled boolean,model text,is_default boolean);").await.unwrap();
    // Execute knowledge migrations only; this is not full-platform empty-database acceptance.
    for migration in crate::infrastructure::migrator::Migrator::migrations()
        .into_iter()
        .filter(|m| {
            matches!(
                m.name(),
                "m20261106_000114_knowledge_management"
                    | "m20261109_000115_knowledge_parsing"
                    | "m20261109_000116_knowledge_retrieval"
                    | "m20261109_000117_knowledge_vectors"
                    | "m20261109_000118_platform_knowledge_retrieval"
                    | "m20261109_000119_model_provider_types"
                    | "m20261109_000120_base_knowledge_retrieval"
            )
        })
    {
        migration
            .up(&sea_orm_migration::SchemaManager::new(&db))
            .await
            .unwrap();
    }
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let ra = Uuid::new_v4();
    let rb = Uuid::new_v4();
    for (u, r) in [(a, ra), (b, rb)] {
        exec(&db,"INSERT INTO iam_users(id,display_name,primary_organization_unit_id,senior,is_admin,is_boss,real_authed,extension_json,status,created_at,updated_at) VALUES($1::uuid,'Knowledge test',$2::uuid,false,false,false,false,'{}','active',now(),now())",vec![id(u),id(Uuid::new_v4())]).await.unwrap();
        exec(&db,"INSERT INTO iam_roles(id,source_type,external_id,name,status,created_at,updated_at) VALUES($1::uuid,'local',$2,'Knowledge test','active',now(),now())",vec![id(r),r.to_string().into()]).await.unwrap();
        exec(&db,"INSERT INTO iam_user_roles(id,user_id,role_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,now())",vec![id(Uuid::new_v4()),id(u),id(r)]).await.unwrap();
    }
    for (r, grants) in [
        (
            ra,
            vec![
                "knowledge.global.manage",
                "app:APP_KNOWLEDGE_TEST:display",
                "app:APP_KNOWLEDGE_TEST:knowledge_manage",
            ],
        ),
        (rb, vec![]),
    ] {
        for g in grants {
            exec(&db,"INSERT INTO iam_role_permissions(id,role_id,permission,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3,now(),now())",vec![id(Uuid::new_v4()),id(r),g.into()]).await.unwrap();
        }
    }
    exec(&db,"INSERT INTO apps(id,route_app_id,name,description,icon,color,deployment_type,owner_name,records_count,created_at,updated_at) VALUES($1::uuid,'APP_KNOWLEDGE_TEST','Knowledge acceptance','','','blue','local','test',0,now(),now())",vec![id(Uuid::new_v4())]).await.unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/api/knowledge", listener.local_addr().unwrap());
    let http_state = state.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, routes().with_state(http_state))
            .await
            .unwrap()
    });
    let c = reqwest::Client::new();
    let ta = token(a);
    let tb = token(b);
    let payload = json!({"clientRequestId":Uuid::new_v4(),"kind":"global","name":"知识专项验收"});
    let response = c
        .post(format!("{root}/bases"))
        .bearer_auth(&ta)
        .json(&payload)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let base: Value = response.json().await.unwrap();
    assert_eq!(status, 200, "{base}");
    let bid = base["id"].as_str().unwrap();
    assert_eq!(
        c.post(format!("{root}/bases"))
            .bearer_auth(&ta)
            .json(&payload)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["id"],
        base["id"]
    );
    let mut changed = payload.clone();
    changed["name"] = json!("different");
    assert_eq!(
        c.post(format!("{root}/bases"))
            .bearer_auth(&ta)
            .json(&changed)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        c.get(format!("{root}/bases"))
            .bearer_auth(&tb)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "global knowledge readable by active platform users without read grants"
    );
    verify_base_retrieval(&db, &state, &c, &root, &ta, a).await;
    let name = "知识验收.txt";
    let body = "采购规范：先检查型号，再核对单价。".as_bytes().to_vec();
    let key = Uuid::new_v4().to_string();
    let up = format!("{root}/bases/{bid}/documents");
    let upload = || {
        c.post(&up)
            .bearer_auth(&ta)
            .query(&[("name", name), ("client_request_id", key.as_str())])
            .header("content-type", "application/octet-stream")
            .body(body.clone())
    };
    let response = upload().send().await.unwrap();
    let status = response.status();
    let doc: Value = response.json().await.unwrap();
    assert_eq!(status, 200, "{doc}");
    let did = doc["id"].as_str().unwrap();
    let vid = doc["versionId"].as_str().unwrap();
    assert_eq!(doc["status"], "queued");
    assert_eq!(
        upload()
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["versionId"],
        doc["versionId"]
    );
    assert_eq!(
        c.post(&up)
            .bearer_auth(&ta)
            .query(&[("name", name), ("client_request_id", key.as_str())])
            .body("changed")
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        c.post(&up)
            .bearer_auth(&tb)
            .query(&[
                ("name", name),
                ("client_request_id", Uuid::new_v4().to_string().as_str())
            ])
            .body("test")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let download = c
        .get(format!("{root}/versions/{vid}/content"))
        .bearer_auth(&tb)
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), 200);
    assert_eq!(download.headers()["cache-control"], "private, no-store");
    assert_eq!(download.bytes().await.unwrap().as_ref(), body.as_slice());
    let update = c
        .post(&up)
        .bearer_auth(&ta)
        .query(&[
            ("name", name),
            ("client_request_id", Uuid::new_v4().to_string().as_str()),
            ("document_id", did),
        ])
        .body("第二版")
        .send()
        .await
        .unwrap();
    let status = update.status();
    let updated: Value = update.json().await.unwrap();
    assert_eq!(status, 200, "{updated}");
    assert_eq!(updated["version"], 2);
    assert_eq!(
        c.get(format!("{root}/documents/{did}/versions"))
            .bearer_auth(&tb)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        c.post(&up)
            .bearer_auth(&ta)
            .query(&[
                ("name", "fake.pdf"),
                ("client_request_id", Uuid::new_v4().to_string().as_str())
            ])
            .body("not a pdf")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let app_payload = json!({"clientRequestId":Uuid::new_v4(),"kind":"application","applicationId":"APP_KNOWLEDGE_TEST","name":"应用验收"});
    let r = c
        .post(format!("{root}/bases"))
        .bearer_auth(&ta)
        .json(&app_payload)
        .send()
        .await
        .unwrap();
    let status = r.status();
    let app: Value = r.json().await.unwrap();
    assert_eq!(status, 200, "{app}");
    let appid = app["id"].as_str().unwrap();
    assert_eq!(
        c.get(format!("{root}/bases/{appid}/documents"))
            .bearer_auth(&tb)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    exec(
        &db,
        "DELETE FROM iam_role_permissions WHERE role_id=$1::uuid",
        vec![id(rb)],
    )
    .await
    .unwrap();
    assert_eq!(
        c.get(format!("{root}/versions/{vid}/content"))
            .bearer_auth(&tb)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        c.delete(format!("{root}/documents/{did}"))
            .bearer_auth(&ta)
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        c.get(format!("{root}/versions/{vid}/content"))
            .bearer_auth(&ta)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        c.delete(format!("{root}/bases/{bid}"))
            .bearer_auth(&ta)
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        c.delete(format!("{root}/bases/{appid}"))
            .bearer_auth(&ta)
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        rows(
            &db,
            "SELECT jsonb_build_object('n',count(*))::text data FROM knowledge_document_versions",
            vec![]
        )
        .await
        .unwrap()[0]["n"],
        0
    );
    server.abort();
    println!(
        "KNOWLEDGE: migration + HTTP CRUD/version/hash/idempotency/shared-read/management-permissions passed"
    );
}
use sea_orm_migration::MigratorTrait;

// Real PostgreSQL + HTTP creation/upload/search with a deterministic local provider.
// No external model credentials, token charges or existing application data are used.
async fn verify_base_retrieval(
    db: &sea_orm::DatabaseConnection,
    state: &AppState,
    c: &reqwest::Client,
    root: &str,
    auth: &str,
    user: Uuid,
) {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let ec = calls.clone();
    let rc = calls.clone();
    let mock=axum::Router::new()
        .route("/embeddings",axum::routing::post(move |Json(body):Json<Value>|{let calls=ec.clone();async move{
            calls.lock().unwrap().push(body.clone());
            let dimensions=if body["model"]=="embed-b"{4}else{3};
            Json(json!({"data":body["input"].as_array().unwrap().iter().enumerate().map(|(index,_)|json!({"index":index,"embedding":vec![1.0;dimensions]})).collect::<Vec<_>>()}))
        }}))
        .route("/rerank",axum::routing::post(move |Json(body):Json<Value>|{let calls=rc.clone();async move{
            calls.lock().unwrap().push(body.clone());
            Json(json!({"results":body["documents"].as_array().unwrap().iter().enumerate().map(|(index,_)|json!({"index":index,"relevance_score":1.0-index as f64*0.01})).collect::<Vec<_>>()}))
        }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let mock_server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    let key = crate::modules::byom::encrypt("local-test-key").unwrap();
    for (route, kind, model) in [("embed-a-route", "embedding", "embed-a"), ("embed-b-route", "embedding", "embed-b"), ("rank-route", "reranker", "rank-a")] {
        exec(db,"INSERT INTO byom_model_routes(id,created_by_user_id,name,api_base_url,encrypted_api_key,enabled,provider_type,model) VALUES($1,$2::uuid,$1,$3,$4,true,$5,$6)",vec![route.into(),id(user),url.clone().into(),key.clone().into(),kind.into(),model.into()]).await.unwrap();
    }
    let mut ids = Vec::new();
    let mut versions = Vec::new();
    for (model, rerank, dimensions) in [("embed-a", true, 3), ("embed-b", false, 4)] {
        let body = json!({"clientRequestId":Uuid::new_v4(),"kind":"global","name":model,"description":"独立模型验收","retrieval":{"embeddingRouteId":format!("{model}-route"),"embeddingModel":model,"rerankerRouteId":if rerank{Some("rank-route")}else{None},"rerankerModel":if rerank{Some("rank-a")}else{None}}});
        let response = c
            .post(format!("{root}/bases"))
            .bearer_auth(auth)
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let base: Value = response.json().await.unwrap();
        assert_eq!(status, 200, "{base}");
        assert_eq!(base["description"], "独立模型验收");
        let bid = base["id"].as_str().unwrap();
        ids.push(bid.to_owned());
        let retry: Value = c
            .post(format!("{root}/bases"))
            .bearer_auth(auth)
            .json(&body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(retry["id"], base["id"]);
        let mut changed = body.clone();
        changed["description"] = json!("changed");
        assert_eq!(
            c.post(format!("{root}/bases"))
                .bearer_auth(auth)
                .json(&changed)
                .send()
                .await
                .unwrap()
                .status(),
            409
        );
        let uploaded = c
            .post(format!("{root}/bases/{bid}/documents"))
            .bearer_auth(auth)
            .query(&[
                ("name", "采购规范.txt"),
                ("client_request_id", Uuid::new_v4().to_string().as_str()),
            ])
            .body("采购规范：先检查型号，再核对单价。")
            .send()
            .await
            .unwrap();
        let status = uploaded.status();
        let document: Value = uploaded.json().await.unwrap();
        assert_eq!(status, 200, "{document}");
        versions.push(document["versionId"].as_str().unwrap().to_owned());
        assert!(parsing::process(state).await.unwrap());
        let parsed=rows(db,"SELECT jsonb_build_object('status',status)::text data FROM knowledge_document_versions WHERE id=$1::uuid",vec![document["versionId"].as_str().unwrap().into()]).await.unwrap();
        assert_eq!(parsed[0]["status"], "ready");
        for _ in 0..5 {
            vectors::process(state).await.unwrap();
        }
        let settings: Value = c
            .get(format!("{root}/retrieval-settings"))
            .bearer_auth(auth)
            .query(&[("base_id", bid)])
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(settings["config"]["dimensions"], dimensions);
        assert_eq!(settings["ready"], 1);
        assert_eq!(settings["config"]["embeddingModel"], model);
        let searched = c
            .post(format!("{root}/search"))
            .bearer_auth(auth)
            .json(&json!({"baseId":bid,"query":"采购规范","limit":5}))
            .send()
            .await
            .unwrap();
        let status = searched.status();
        let result: Value = searched.json().await.unwrap();
        assert_eq!(status, 200, "{result}");
        assert_eq!(result["semanticSearch"], true, "{result}");
        assert_eq!(result["rerankerEnabled"], rerank, "{result}");
        assert!(!result["items"].as_array().unwrap().is_empty());
        assert!(
            result["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["baseId"] == bid)
        );
    }
    let snapshot = vectors::freeze_profiles(state).await.unwrap();
    assert_eq!(snapshot["bases"].as_object().unwrap().len(), 2);
    assert!(snapshot["default"].is_null());
    let (found, ranking) = vectors::retrieve(
        state,
        user,
        &snapshot,
        &versions,
        "采购规范",
        Vec::new(),
        10,
    )
    .await
    .unwrap();
    assert_eq!(ranking.ranking_mode, "per-base-hybrid-rrf-v1");
    assert!(ranking.semantic_search && ranking.reranker_enabled);
    assert_eq!(found.len(), 2);
    let calls = calls.lock().unwrap().clone();
    assert!(calls.iter().any(|v| v["model"] == "rank-a"));
    assert!(calls.iter().any(|v| v["model"] == "embed-b"));
    for bid in ids {
        assert_eq!(
            c.delete(format!("{root}/bases/{bid}"))
                .bearer_auth(auth)
                .send()
                .await
                .unwrap()
                .status(),
            204
        );
    }
    assert!(
        vectors::freeze_profiles(state).await.unwrap()["bases"]
            .as_object()
            .unwrap()
            .is_empty()
    );
    mock_server.abort();
    println!(
        "KNOWLEDGE: per-base create/retry/description -> actual dimensions -> upload -> parsing -> vector worker -> hybrid search/rerank -> cross-base merge passed"
    );
}
