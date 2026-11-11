//! Uses the actual internal HTTP broker, PostgreSQL, shared save and confirmation API.
use super::*;
use crate::platform::prelude::*;
use yaya_agent_v2::{
    domain::{Checkpoint, ContentPart, ToolCall},
    store::{Lease, Store, js, rows},
};

struct Harness<'a> {
    db: &'a DatabaseConnection,
    client: &'a reqwest::Client,
    base: &'a str,
    scope: Scope,
}
impl Harness<'_> {
    async fn full(&self, patch: &ToolCall) -> ToolCall {
        let prepared = super::super::design::prepare(self.db, patch).await.unwrap();
        ToolCall {
            id: patch.id.clone(),
            name: "platform_save_form_schema".into(),
            arguments: json!({"appId":patch.arguments["appId"],"formUuid":patch.arguments["formUuid"],"baseVersion":patch.arguments["baseVersion"],"schema":prepared.target}),
        }
    }
    async fn start(&self, call: &ToolCall, snapshot: Option<Value>) -> Lease {
        let store = Store {
            db: self.db.clone(),
        };
        let session = store
            .create_session(&self.scope, "employee-a")
            .await
            .unwrap();
        let sid = Uuid::parse_str(session["id"].as_str().unwrap()).unwrap();
        store
            .submit(
                &self.scope,
                sid,
                &Command::Prompt {
                    client_command_id: Uuid::new_v4(),
                    parts: vec![ContentPart::Text {
                        text: "design test".into(),
                    }],
                },
            )
            .await
            .unwrap();
        let lease = store.claim(Uuid::new_v4(), 60).await.unwrap().unwrap();
        assert_eq!(lease.session_id, sid);
        let snapshot = snapshot.unwrap_or_else(|| json!({"employee_id":"employee-a","allowed_tools":[call.name],"application_ids":["*"],"grants":["*"],"action_grants":["*"],"policy_version":yaya_agent_v2::tools::POLICY_VERSION}));
        store.snapshot_context(&lease, snapshot).await.unwrap();
        store
            .checkpoint(
                &lease,
                &Checkpoint {
                    pending_calls: vec![call.clone()],
                    ..Default::default()
                },
                "test",
                json!({}),
            )
            .await
            .unwrap();
        lease
    }
    async fn invoke(&self, lease: &Lease, call: &ToolCall) -> (u16, Value) {
        let response = self
            .client
            .post(format!(
                "{}/api/internal/agent-v2/runs/{}/tools/invoke",
                self.base, lease.run_id
            ))
            .query(&[
                ("owner", lease.owner.to_string()),
                ("epoch", lease.epoch.to_string()),
            ])
            .header(
                "x-agent-v2-worker-secret",
                std::env::var("YAYA_AGENT_V2_WORKER_SECRET").unwrap(),
            )
            .json(&json!({"call":call}))
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        (status, response.json().await.unwrap())
    }
    async fn confirmation(&self, lease: &Lease) -> Value {
        let response: Value = self
            .client
            .get(format!(
                "{}/api/agent/v2/sessions/{}/confirmations",
                self.base, lease.session_id
            ))
            .bearer_auth(token(self.scope.user_id))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        response["items"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .clone()
    }
    async fn decision(&self, lease: &Lease, cid: &str, approve: bool) -> u16 {
        self.client.post(format!("{}/api/agent/v2/sessions/{}/commands",self.base,lease.session_id)).bearer_auth(token(self.scope.user_id))
            .json(&json!({"kind":"confirm","clientCommandId":Uuid::new_v4(),"confirmationId":cid,"approve":approve})).send().await.unwrap().status().as_u16()
    }
    async fn resume(&self, previous: &Lease) -> Lease {
        let next = Store {
            db: self.db.clone(),
        }
        .claim(Uuid::new_v4(), 60)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(next.run_id, previous.run_id);
        assert!(next.epoch > previous.epoch);
        next
    }
    async fn finish(&self, lease: &Lease) {
        Store {
            db: self.db.clone(),
        }
        .finish(lease, "completed", "design tested", None)
        .await
        .unwrap();
    }
    async fn count(&self, table: &str) -> i64 {
        rows(
            self.db,
            &format!("SELECT jsonb_build_object('n',count(*))::text data FROM {table}"),
            vec![],
        )
        .await
        .unwrap()[0]["n"]
            .as_i64()
            .unwrap()
    }
    async fn baseline(&self, form: &str) -> (i32, Value) {
        let definition = crate::modules::forms::find_form_definition(self.db, form)
            .await
            .unwrap();
        let stored = crate::modules::forms::load_schema_version(
            self.db,
            form,
            definition.current_schema_version,
        )
        .await
        .unwrap();
        (
            definition.current_schema_version,
            crate::modules::forms::build_schema_payload(&definition, stored).schema,
        )
    }
    async fn patch(&self, app: &str, form: &str, name: &str) -> ToolCall {
        let (version, schema) = self.baseline(form).await;
        ToolCall {
            id: Uuid::new_v4().to_string(),
            name: "platform_apply_design_patch".into(),
            arguments: json!({"appId":app,"formUuid":form,"baseVersion":version,"baseHash":super::super::design::hash(&schema),"patch":[{"op":"replace","path":"/formName","value":name},{"op":"add","path":"/fields/0/props/placeholder","value":"Changed placeholder"},{"op":"replace","path":"/fields/0/colSpan","value":3}]}),
        }
    }
}

pub(super) async fn verify(
    db: &DatabaseConnection,
    client: &reqwest::Client,
    base: &str,
    user: Uuid,
    tenant: Uuid,
    role: Uuid,
) {
    let h = Harness {
        db,
        client,
        base,
        scope: Scope {
            tenant_id: tenant,
            user_id: user,
        },
    };
    let apps = rows(db,"SELECT jsonb_build_object('id',route_app_id)::text data FROM apps WHERE name='V2 confirmed app'",vec![]).await.unwrap();
    let app = apps[0]["id"].as_str().unwrap();
    for (id, kind) in [
        ("v2-design-normal", "normal"),
        ("v2-design-workflow", "workflow"),
    ] {
        let schema = json!({"formUuid":id,"formName":"Original","columns":6,"rows":4,"pageProps":{},"fields":[{"id":"name","type":"singleLineText","label":"Name","row":0,"column":0,"rowSpan":1,"colSpan":2,"parentGroupId":null,"props":{}}]});
        exec(db,"INSERT INTO form_definitions(id,app_route_app_id,form_uuid,name,slug,form_type,current_schema_version,latest_schema_version,created_at,updated_at) VALUES($1::uuid,$2,$3,'Original',$3,$4,1,1,now(),now())",vec![super::id(Uuid::new_v4()),app.into(),id.into(),kind.into()]).await.unwrap();
        exec(db,"INSERT INTO form_schemas(id,form_uuid,version,schema_json,created_at,updated_at) VALUES($1::uuid,$2,1,$3,now(),now())",vec![super::id(Uuid::new_v4()),id.into(),js(schema.clone())]).await.unwrap();
        exec(db,"INSERT INTO app_navigation_items(id,app_route_app_id,item_type,target_form_uuid,title,path_slug,sort_order,is_default_entry,created_at,updated_at) VALUES($1::uuid,$2,'form',$3,'Original',$3,1,false,now(),now())",vec![super::id(Uuid::new_v4()),app.into(),id.into()]).await.unwrap();
        crate::platform::form_storage::sync_current_storage_plan(db, id, 1, &schema)
            .await
            .unwrap();
    }
    let flow = Uuid::new_v4();
    exec(db,"INSERT INTO automation_flows(id,flow_uuid,app_route_app_id,name,status,current_version,flow_type,trigger_form_uuid,trigger_config,nodes_json,edges_json,created_by,updated_by,created_at,updated_at) VALUES($1::uuid,$2,$3,'Original审批流程','draft',1,'process','v2-design-workflow','{}','[]','[]','test','test',now(),now())",vec![super::id(flow),flow.to_string().into(),app.into()]).await.unwrap();
    exec(db,"INSERT INTO automation_flow_versions(id,flow_id,version,name,status,trigger_form_uuid,trigger_config,nodes_json,edges_json,created_by,created_at) VALUES($1::uuid,$2::uuid,1,'Original审批流程','draft','v2-design-workflow','{}','[]','[]','test',now())",vec![super::id(Uuid::new_v4()),super::id(flow)]).await.unwrap();

    // T23 and T31 each traverse real preview/approve/save/effect/replay paths.
    for (form, patch) in [("v2-design-normal", false), ("v2-design-workflow", true)] {
        let mut call = h.patch(app, form, "Confirmed design").await;
        if patch {
            call.arguments["patch"].as_array_mut().unwrap().push(json!({"op":"add","path":"/fields/-","value":{"id":"amount","type":"number","label":"Amount","row":1,"column":0,"rowSpan":1,"colSpan":1,"parentGroupId":null,"props":{}}}));
        }
        if !patch {
            let (version, mut target) = h.baseline(form).await;
            target["formName"] = json!("Confirmed design");
            target["fields"][0]["props"]["placeholder"] = json!("Changed placeholder");
            call.name = "platform_save_form_schema".into();
            call.arguments =
                json!({"appId":app,"formUuid":form,"baseVersion":version,"schema":target});
        }
        let before = (
            h.count("form_schemas").await,
            h.count("agent_v2_effects").await,
        );
        let business_before = super::super::tools::version(db, &call, false)
            .await
            .unwrap();
        let lease = h.start(&call, None).await;
        assert_eq!(
            h.invoke(&lease, &call).await,
            (200, json!({"status":"waiting_confirmation"}))
        );
        assert_eq!(
            before,
            (
                h.count("form_schemas").await,
                h.count("agent_v2_effects").await
            ),
            "preview has no business effects"
        );
        assert_eq!(
            super::super::tools::version(db, &call, false)
                .await
                .unwrap(),
            business_before
        );
        let c = h.confirmation(&lease).await;
        assert_eq!(
            c["preview"]["designBaseline"]["algorithm"],
            "sha256-json-v1"
        );
        assert!(
            c["preview"]["changes"]
                .to_string()
                .contains("Changed placeholder")
        );
        let cid = c["id"].as_str().unwrap();
        let (tab_a, tab_b) =
            tokio::join!(h.decision(&lease, cid, true), h.decision(&lease, cid, true));
        assert_eq!((tab_a, tab_b), (200, 200));
        let resumed = h.resume(&lease).await;
        assert_eq!(h.invoke(&lease, &call).await.0, 403, "old execution epoch");
        let (result, parallel) = tokio::join!(h.invoke(&resumed, &call), h.invoke(&resumed, &call));
        assert_eq!(result.0, 200, "{result:?}");
        assert_eq!(parallel, result, "concurrent invocation commits one effect");
        assert_eq!(result.1["result"]["version"], 2);
        // Simulate process loss after business commit, before worker checkpoint.
        exec(
            db,
            "UPDATE agent_v2_runs SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
            vec![super::id(resumed.run_id)],
        )
        .await
        .unwrap();
        let recovered = h.resume(&resumed).await;
        assert_eq!(h.invoke(&recovered, &call).await, result);
        assert_eq!(h.count("form_schemas").await, before.0 + 1);
        assert_eq!(h.count("agent_v2_effects").await, before.1 + 1);
        let applied = h.baseline(form).await;
        assert_eq!(applied.1["formName"], "Confirmed design");
        let nav = rows(db,"SELECT jsonb_build_object('title',title)::text data FROM app_navigation_items WHERE target_form_uuid=$1",vec![form.into()]).await.unwrap();
        assert_eq!(nav[0]["title"], "Confirmed design");
        let storage = rows(db,"SELECT jsonb_build_object('version',compiled_schema_version)::text data FROM form_storage_definitions WHERE form_uuid=$1",vec![form.into()]).await.unwrap();
        assert_eq!(storage[0]["version"], 2);
        if patch {
            let plan =
                crate::platform::form_storage::compile_form_storage_plan(form, &applied.1).unwrap();
            let added = plan.fields.iter().find(|f| f.field_id == "amount").unwrap();
            let actual = rows(db,"SELECT jsonb_build_object('type',data_type)::text data FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2",vec![plan.main_table.into(),added.column_name.clone().unwrap().into()]).await.unwrap();
            assert_eq!(
                actual[0]["type"], "numeric",
                "patch creates the actual dynamic storage column"
            );
        }
        assert_eq!(h.confirmation(&recovered).await["status"], "executed");
        h.finish(&recovered).await;
    }
    let workflow = rows(db,"SELECT jsonb_build_object('name',name)::text data FROM automation_flow_versions WHERE flow_id=$1::uuid",vec![super::id(flow)]).await.unwrap();
    assert_eq!(workflow[0]["name"], "Confirmed design审批流程");

    // Reject either contract; neither may write any schema/effect.
    for patch in [false, true] {
        let proposal = h.patch(app, "v2-design-normal", "Rejected design").await;
        let call = if patch {
            proposal
        } else {
            h.full(&proposal).await
        };
        let before = h.count("form_schemas").await;
        let lease = h.start(&call, None).await;
        assert_eq!(h.invoke(&lease, &call).await.0, 200);
        let c = h.confirmation(&lease).await;
        assert_eq!(
            h.decision(&lease, c["id"].as_str().unwrap(), false).await,
            200
        );
        let resumed = h.resume(&lease).await;
        assert_eq!(
            h.invoke(&resumed, &call).await.1["result"]["status"],
            "rejected"
        );
        assert_eq!(h.count("form_schemas").await, before);
        h.finish(&resumed).await;
    }

    // Two independent tasks freeze the same version; only the first can save.
    for patch in [false, true] {
        let first = h.patch(app, "v2-design-normal", "Winner").await;
        let proposal = h.patch(app, "v2-design-normal", "Stale").await;
        let second = if patch {
            proposal
        } else {
            h.full(&proposal).await
        };
        let a = h.start(&first, None).await;
        assert_eq!(h.invoke(&a, &first).await.0, 200);
        let b = h.start(&second, None).await;
        assert_eq!(h.invoke(&b, &second).await.0, 200);
        for (lease, call, winner) in [(&a, &first, true), (&b, &second, false)] {
            let c = h.confirmation(lease).await;
            assert_eq!(
                h.decision(lease, c["id"].as_str().unwrap(), true).await,
                200
            );
            let resumed = h.resume(lease).await;
            let result = h.invoke(&resumed, call).await;
            assert_eq!(result.0, 200, "{result:?}");
            if !winner {
                assert_eq!(result.1["result"]["status"], "conflict");
                assert_eq!(h.confirmation(&resumed).await["status"], "conflict");
            }
            h.finish(&resumed).await;
        }
    }

    // Incorrect baseline and invalid generated design never create an approvable preview.
    for bad_hash in [true, false] {
        let mut call = h.patch(app, "v2-design-normal", "Invalid").await;
        if bad_hash {
            call.arguments["baseHash"] = json!("wrong");
        } else {
            call.arguments["patch"] =
                json!([{"op":"replace","path":"/fields/0/type","value":"tsx"}]);
        }
        let before = h.count("form_schemas").await;
        let lease = h.start(&call, None).await;
        assert_eq!(
            h.invoke(&lease, &call).await.0,
            if bad_hash { 409 } else { 400 }
        );
        assert!(
            Store { db: db.clone() }
                .confirmations(&h.scope, lease.session_id)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(h.count("form_schemas").await, before);
        h.finish(&lease).await;
    }

    // T23 cannot use the full-schema contract to bypass the patch component restrictions.
    let proposal = h
        .patch(app, "v2-design-normal", "Invalid full schema")
        .await;
    let mut call = h.full(&proposal).await;
    call.arguments["schema"]["fields"][0]["type"] = json!("tsx");
    let before = super::super::tools::version(db, &call, false)
        .await
        .unwrap();
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 400);
    assert_eq!(
        super::super::tools::version(db, &call, false)
            .await
            .unwrap(),
        before
    );
    assert!(
        Store { db: db.clone() }
            .confirmations(&h.scope, lease.session_id)
            .await
            .unwrap()
            .is_empty()
    );
    h.finish(&lease).await;

    // An expired approved design cannot save, including after a worker restart.
    let call = h.patch(app, "v2-design-normal", "Expired").await;
    let before = h.count("form_schemas").await;
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    assert_eq!(
        h.decision(&lease, c["id"].as_str().unwrap(), true).await,
        200
    );
    exec(
        db,
        "UPDATE agent_v2_confirmations SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
        vec![c["id"].as_str().unwrap().to_owned().into()],
    )
    .await
    .unwrap();
    let resumed = h.resume(&lease).await;
    assert_eq!(
        h.invoke(&resumed, &call).await.1["result"]["status"],
        "expired"
    );
    assert_eq!(h.count("form_schemas").await, before);
    h.finish(&resumed).await;

    // Approve/reject competition produces one durable decision and at most one effect.
    let call = h.patch(app, "v2-design-normal", "Decision race").await;
    let before = h.count("agent_v2_effects").await;
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    let cid = c["id"].as_str().unwrap();
    let (yes, no) = tokio::join!(
        h.decision(&lease, cid, true),
        h.decision(&lease, cid, false)
    );
    assert!((yes == 200 && no == 409) || (yes == 409 && no == 200));
    let resumed = h.resume(&lease).await;
    assert_eq!(h.invoke(&resumed, &call).await.0, 200);
    assert_eq!(
        h.count("agent_v2_effects").await,
        before + if yes == 200 { 1 } else { 0 }
    );
    h.finish(&resumed).await;

    // Original checkpoint is authoritative; a worker cannot replace frozen parameters.
    let call = h.patch(app, "v2-design-normal", "Frozen").await;
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    assert_eq!(
        h.decision(&lease, c["id"].as_str().unwrap(), true).await,
        200
    );
    let resumed = h.resume(&lease).await;
    let mut forged = call.clone();
    forged.arguments["patch"][0]["value"] = json!("Replaced");
    assert_eq!(h.invoke(&resumed, &forged).await.0, 403);
    // Revocation after approval must prevent the write.
    exec(
        db,
        "UPDATE iam_roles SET external_id=$2 WHERE id=$1::uuid",
        vec![super::id(role), role.to_string().into()],
    )
    .await
    .unwrap();
    assert_eq!(h.invoke(&resumed, &call).await.0, 403);
    exec(
        db,
        "UPDATE iam_roles SET external_id='system-administrator' WHERE id=$1::uuid",
        vec![super::id(role)],
    )
    .await
    .unwrap();
    assert_eq!(h.invoke(&resumed, &call).await.0, 200);
    h.finish(&resumed).await;

    // A task snapshot is a ceiling for capability and user RBAC, not employee app IDs.
    for restriction in ["tool", "app", "design", "fields"] {
        let call = h.patch(app, "v2-design-normal", "Denied").await;
        let mut snapshot = json!({"employee_id":"employee-a","allowed_tools":[call.name],"application_ids":["*"],"grants":["*"],"action_grants":["*"],"policy_version":yaya_agent_v2::tools::POLICY_VERSION});
        match restriction {
            "tool" => snapshot["allowed_tools"] = json!([]),
            "app" => snapshot["action_grants"] = json!(["app:another-app:display"]),
            "design" => {
                snapshot["action_grants"] = json!([
                    format!("app:{app}:display"),
                    format!("app:{app}:edit_form"),
                    "form:v2-design-normal:display"
                ])
            }
            _ => snapshot["grants"] = json!(["form:v2-design-normal:field_scope:specified"]),
        }
        let lease = h.start(&call, Some(snapshot)).await;
        assert_eq!(h.invoke(&lease, &call).await.0, 403, "{restriction}");
        h.finish(&lease).await;
    }
    for legacy_scope in [vec![], vec!["other-app".to_owned()]] {
        let grants = HashSet::from(["*".to_owned()]);
        let mut employee = super::super::employee(&grants, "employee-a").await.unwrap();
        employee.application_ids = legacy_scope;
        let (shutdown, _) = tokio::sync::watch::channel(false);
        let state = AppState::new(db.clone(), None, 1, shutdown);
        let call = h.patch(app, "v2-design-normal", "RBAC authorized").await;
        let snapshot = json!({"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"allowed_tools":[call.name],"action_grants":["*"],"grants":["*"],"application_ids":[]});
        assert!(
            super::super::tools::authorize(
                &state,
                &h.scope,
                &employee,
                &grants,
                &call,
                Some(&snapshot)
            )
            .await
            .is_ok()
        );
    }
    // Real employee permission and current field policy checks, separate from snapshots.
    let grants = HashSet::from(["*".to_owned()]);
    let employee = super::super::employee(&grants, "employee-a").await.unwrap();
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let state = AppState::new(db.clone(), None, 1, shutdown);
    let call = h.patch(app, "v2-design-normal", "Denied").await;
    let snapshot = json!({"policy_version":yaya_agent_v2::tools::POLICY_VERSION,"allowed_tools":[call.name],"application_ids":["*"],"action_grants":["*"],"grants":["*"]});
    for restriction in ["tool", "fields"] {
        let mut employee = employee.clone();
        let mut current = grants.clone();
        match restriction {
            "tool" => employee.allowed_tools = vec!["yaya_propose_write".into()],
            _ => {
                current = HashSet::from([
                    format!("app:{app}:display"),
                    format!("app:{app}:edit_form"),
                    format!("app:{app}:view_development"),
                    "form:v2-design-normal:display".into(),
                    "form:v2-design-normal:field_scope:specified".into(),
                ])
            }
        }
        assert!(
            matches!(
                super::super::tools::authorize(
                    &state,
                    &h.scope,
                    &employee,
                    &current,
                    &call,
                    Some(&snapshot)
                )
                .await,
                Err(AppError::Forbidden(_))
            ),
            "{restriction}"
        );
    }

    // T05 exposes the authoritative baseline only on a complete, writable design.
    for filtered in [false, true] {
        let call = ToolCall {
            id: Uuid::new_v4().to_string(),
            name: "platform_get_form_schema".into(),
            arguments: json!({"formUuid":"v2-design-normal"}),
        };
        let data = if filtered {
            json!(["form:v2-design-normal:field_scope:specified"])
        } else {
            json!(["*"])
        };
        let snapshot = json!({"employee_id":"employee-a","policy_version":yaya_agent_v2::tools::POLICY_VERSION,"allowed_tools":[call.name],"application_ids":["*"],"action_grants":["*"],"grants":data});
        let lease = h.start(&call, Some(snapshot)).await;
        let result = h.invoke(&lease, &call).await;
        assert_eq!(result.0, 200, "{result:?}");
        assert_eq!(
            result.1["result"].get("designBaseline").is_some(),
            !filtered
        );
        if filtered {
            assert_eq!(result.1["result"]["schema"]["fields"], json!([]));
        } else {
            assert_eq!(
                result.1["result"]["designBaseline"]["baseHash"],
                super::super::design::hash(&result.1["result"]["schema"])
            );
        }
        h.finish(&lease).await;
    }

    // Even administrators cannot replace a complete schema containing hidden fields.
    let call = h.patch(app, "v2-design-normal", "Hidden").await;
    exec(db,"UPDATE form_schemas SET schema_json=jsonb_set(schema_json::jsonb,'{fields,0,props,isHidden}','true') WHERE form_uuid='v2-design-normal'",vec![]).await.unwrap();
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 403);
    h.finish(&lease).await;
    exec(db,"UPDATE form_schemas SET schema_json=schema_json::jsonb #- '{fields,0,props,isHidden}' WHERE form_uuid='v2-design-normal'",vec![]).await.unwrap();

    // The persisted target hash is checked in the resource lock, not trusted blindly.
    let call = h.patch(app, "v2-design-normal", "Hash mismatch").await;
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    assert_eq!(
        h.decision(&lease, c["id"].as_str().unwrap(), true).await,
        200
    );
    exec(db,"UPDATE agent_v2_confirmations SET preview=jsonb_set(preview,'{designBaseline,targetHash}','\"different\"') WHERE id=$1::uuid",vec![c["id"].as_str().unwrap().to_owned().into()]).await.unwrap();
    let resumed = h.resume(&lease).await;
    let conflict = h.invoke(&resumed, &call).await;
    assert_eq!(conflict.1["result"]["status"], "conflict");
    assert_eq!(
        h.invoke(&resumed, &call).await,
        conflict,
        "persistent conflict replay"
    );
    h.finish(&resumed).await;

    // Inject a real failure after schema/nav writes, at the storage-plan boundary.
    let call = h.patch(app, "v2-design-normal", "Must rollback").await;
    let before = (
        h.baseline("v2-design-normal").await,
        h.count("form_schemas").await,
        h.count("agent_v2_effects").await,
    );
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    assert_eq!(
        h.decision(&lease, c["id"].as_str().unwrap(), true).await,
        200
    );
    let resumed = h.resume(&lease).await;
    db.execute_unprepared(&format!("ALTER TABLE form_storage_definitions ADD CONSTRAINT test_design_rollback CHECK (form_uuid <> 'v2-design-normal' OR compiled_schema_version <= {})",before.0.0)).await.unwrap();
    assert_eq!(h.invoke(&resumed, &call).await.0, 500);
    assert_eq!(h.baseline("v2-design-normal").await, before.0);
    assert_eq!(h.count("form_schemas").await, before.1);
    assert_eq!(h.count("agent_v2_effects").await, before.2);
    assert_eq!(h.confirmation(&resumed).await["status"], "approved");
    db.execute_unprepared(
        "ALTER TABLE form_storage_definitions DROP CONSTRAINT test_design_rollback",
    )
    .await
    .unwrap();
    assert_eq!(h.invoke(&resumed, &call).await.0, 200);
    h.finish(&resumed).await;

    // Cancel/approve competition is serialized through the existing session command lock.
    let call = h.patch(app, "v2-design-normal", "Cancelled").await;
    let lease = h.start(&call, None).await;
    assert_eq!(h.invoke(&lease, &call).await.0, 200);
    let c = h.confirmation(&lease).await;
    let cancel = client
        .post(format!(
            "{base}/api/agent/v2/sessions/{}/commands",
            lease.session_id
        ))
        .bearer_auth(token(user))
        .json(&json!({"kind":"cancel","clientCommandId":Uuid::new_v4()}))
        .send();
    let (approval, cancelled) =
        tokio::join!(h.decision(&lease, c["id"].as_str().unwrap(), true), cancel);
    assert!([200, 409].contains(&approval));
    assert_eq!(cancelled.unwrap().status(), 200);
    assert_eq!(h.confirmation(&lease).await["status"], "cancelled");
    assert_eq!(h.invoke(&lease, &call).await.0, 403);
    assert_eq!(
        Store { db: db.clone() }.run(lease.run_id).await.unwrap()["status"],
        "cancelled"
    );

    // Shared editor regression: historical restore and no-change save retain semantics.
    let historical = crate::modules::forms::load_schema_version(db, "v2-design-normal", 1)
        .await
        .unwrap();
    let tx = db.begin().await.unwrap();
    let (unchanged, restored) = crate::modules::forms::save_form_schema_definition_in_transaction(
        &tx,
        "v2-design-normal",
        crate::modules::forms::dto::SaveSchemaRequest {
            schema: historical.schema_json,
            base_version: Some(1),
            change_log: Some("designer regression restore".into()),
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(unchanged);
    assert_eq!(restored.version, 1);
    assert!(restored.latest_version > 1);
    assert_eq!(h.baseline("v2-design-normal").await.0, 1);
}
