//! Platform broker: no legacy Agent transport or executor dependency.
use super::*;
use crate::infrastructure::entities::iam_user_entity;
use crate::platform::prelude::*;
use crate::platform::records::{QueryFieldKind, RecordRepository};
use serde::Deserialize;
use yaya_agent_v2::{
    domain::ToolCall,
    store::{Lease, event, exec, fingerprint, js},
    tools::{self, ToolDescriptor},
};

#[derive(Deserialize)]
pub(super) struct ToolRequest {
    pub call: ToolCall,
}
fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, AppError> {
    args[key]
        .as_str()
        .ok_or_else(|| bad("missing tool argument"))
}
fn has(grants: &HashSet<String>, permission: &str) -> bool {
    grants.contains("*") || grants.contains(permission)
}
fn need(grants: &HashSet<String>, permission: &str) -> Result<(), AppError> {
    if has(grants, permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden("tool action permission denied".into()))
    }
}

pub(super) fn frozen_grants(
    current: &HashSet<String>,
    snapshot: &Value,
) -> Result<HashSet<String>, AppError> {
    if snapshot["policy_version"] != tools::POLICY_VERSION {
        return Err(AppError::Forbidden(
            "task policy version changed; submit a new task".into(),
        ));
    }
    let saved: HashSet<String> = serde_json::from_value(snapshot["action_grants"].clone())
        .map_err(|_| {
            AppError::Forbidden("task action permission snapshot missing; submit a new task".into())
        })?;
    Ok(if saved.contains("*") {
        current.clone()
    } else if current.contains("*") {
        saved
    } else {
        current.intersection(&saved).cloned().collect()
    })
}

pub(super) async fn authorize(
    state: &AppState,
    scope: &Scope,
    employee: &RuntimeAiEmployee,
    grants: &HashSet<String>,
    call: &ToolCall,
    snapshot: Option<&Value>,
) -> Result<ToolDescriptor, AppError> {
    let data_grants = grants;
    let effective = if let Some(snapshot) = snapshot {
        frozen_grants(grants, snapshot)?
    } else {
        grants.clone()
    };
    let grants = &effective;
    let tool = tools::find(&call.name).ok_or_else(|| bad("unsupported tool"))?;
    if let Some(snapshot)=snapshot {
        if (super::design::is_write(&tool.id) || matches!(tool.id.as_str(),"platform_create_automation"|"platform_update_automation"|"platform_validate_form_design"|"platform_validate_automation_design"))
            && snapshot["development_contract_hash"].as_str().is_none() {
            return Err(AppError::Conflict("design task predates product contracts; submit a new task".into()));
        }
        if snapshot["development_contract_hash"].as_str().is_some_and(|hash| hash!=crate::modules::development_contracts::source_hash()) {
            return Err(AppError::Conflict("product contract changed; submit a new design task".into()));
        }
    }
    tools::validate(&tool, &call.arguments).map_err(bad)?;
    if !tools::allowed(&employee.allowed_tools, &tool.id) {
        return Err(AppError::Forbidden("employee action denied".into()));
    }
    if let Some(snapshot) = snapshot {
        if !snapshot["allowed_tools"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == &tool.id))
        {
            return Err(AppError::Forbidden("action outside task snapshot".into()));
        }
    }
    if matches!(tool.id.as_str(),"platform_get_form_schema_contract"|"platform_list_component_contracts"|"platform_get_component_contract"|"platform_get_automation_contract"|"platform_get_automation_node_contract")
        && !grants.contains("*")
        && !has(grants,"apps.manage")
        && !grants.iter().any(|permission| {
            permission.starts_with("app:") && permission.ends_with(":view_development")
        })
    {
        return Err(AppError::Forbidden(
            "development contract permission denied".into(),
        ));
    }
    if tool.id == "platform_create_app" {
        need(grants, "apps.manage")?;
        return Ok(tool);
    }
    let mut app_id = call.arguments["appId"].as_str().map(str::to_owned);
    if let Some(form_id) = call.arguments["formUuid"]
        .as_str()
        .or_else(|| call.arguments["sourceFormUuid"].as_str())
    {
        let form = crate::modules::forms::find_form_definition(&state.db, form_id).await?;
        if app_id
            .as_ref()
            .is_some_and(|app| app != &form.app_route_app_id)
        {
            return Err(bad("form does not belong to application"));
        }
        app_id = Some(form.app_route_app_id.clone());
        need(grants, &format!("form:{form_id}:display"))?;
        if tool.id == "platform_get_form_schema" || tool.id=="platform_validate_form_design" || super::design::is_write(&tool.id) {
            need(
                grants,
                &format!("app:{}:view_development", form.app_route_app_id),
            )?
        }
        if super::design::is_write(&tool.id) || tool.id=="platform_validate_form_design" {
            let schema = crate::modules::forms::load_schema_version_for_connection(
                &state.db,
                form_id,
                form.current_schema_version,
            )
            .await?;
            let saved = if let Some(snapshot) = snapshot {
                serde_json::from_value(snapshot["grants"].clone()).map_err(|_| {
                    AppError::Forbidden("task field permission snapshot missing".into())
                })?
            } else {
                data_grants.clone()
            };
            if !super::design::full_access(&schema.schema_json, form_id, data_grants, &saved) {
                return Err(AppError::Forbidden(
                    "whole design editing requires access to every existing field".into(),
                ));
            }
        }
        if tool.id == "platform_get_form_relationships"
            || tool.id == "platform_get_detail_form_definition"
        {
            need(
                grants,
                &format!("app:{}:view_development", form.app_route_app_id),
            )?;
        }
        if matches!(
            tool.id.as_str(),
            "platform_query_records" | "platform_aggregate_records"
        ) && form.form_type == "detail"
        {
            // Detail queries need parent-row policy and subform field permissions. Do not
            // silently treat child rows as independently owned records.
            return Err(AppError::Forbidden(
                "detail record query is not yet supported by the scoped record service".into(),
            ));
        }
    }
    if let Some(flow) = call.arguments["automationId"].as_str() {
        let definition = AutomationFlowEntity::find()
            .filter(automation_flow_entity::Column::FlowUuid.eq(flow))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("automation not found".into()))?;
        if app_id
            .as_ref()
            .is_some_and(|app| app != &definition.app_route_app_id)
        {
            return Err(bad("automation does not belong to application"));
        }
        app_id = Some(definition.app_route_app_id);
    }
    if let Some(app) = app_id.as_deref() {
        need(grants, &format!("app:{app}:display"))?;
        AppEntity::find()
            .filter(app_entity::Column::RouteAppId.eq(app))
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("application not found".into()))?;
        match tool.id.as_str() {
            "platform_update_app" | "platform_delete_app" => {
                need(grants, "apps.manage")?;
                let user = iam_user_entity::Entity::find_by_id(scope.user_id)
                    .one(&state.db)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("user missing".into()))?;
                let app = AppEntity::find()
                    .filter(app_entity::Column::RouteAppId.eq(app))
                    .one(&state.db)
                    .await?
                    .unwrap();
                if !has(grants, "*")
                    && app.creator_user_id != Some(user.id)
                    && !(app.creator_user_id.is_none() && app.owner_name == user.display_name)
                {
                    return Err(AppError::Forbidden(
                        "only application creator may edit".into(),
                    ));
                }
            }
            "platform_create_navigation_group" | "platform_delete_navigation_group" => {
                need(grants, &format!("app:{app}:create_group"))?
            }
            "platform_create_form" | "platform_create_detail_form" => {
                need(grants, &format!("app:{app}:create_form"))?
            }
            "platform_save_form_schema" | "platform_apply_design_patch" => {
                need(grants, &format!("app:{app}:edit_form"))?
            }
            "platform_delete_form" => need(grants, &format!("app:{app}:delete_form"))?,
            "platform_move_form_to_group" => need(grants, &format!("app:{app}:edit_form"))?,
            "platform_get_workflow_process_definition"
            | "platform_create_automation"
            | "platform_update_automation"
            | "platform_validate_automation_design"
            | "platform_delete_automation"
            | "platform_list_automations"
            | "platform_get_automation_graph" => need(grants, &format!("app:{app}:automation"))?,
            _ => {}
        }
    }
    if matches!(tool.id.as_str(),"platform_validate_form_design"|"platform_save_form_schema"|"platform_apply_design_patch"|"platform_create_automation"|"platform_update_automation"|"platform_validate_automation_design") {
        let saved=if let Some(snapshot)=snapshot {serde_json::from_value(snapshot["grants"].clone()).map_err(|_|bad("task field permission snapshot missing"))?}else{data_grants.clone()};
        super::development::authorize_references(state,&call.arguments,grants,data_grants,&saved).await?;
        // A patch may preserve references not repeated in its arguments.
        if tool.id=="platform_apply_design_patch" {
            let prepared=super::design::prepare(&state.db,call).await?;
            super::development::authorize_references(state,&prepared.target,grants,data_grants,&saved).await?;
        }
        if tool.id=="platform_update_automation" {
            let flow=AutomationFlowEntity::find().filter(automation_flow_entity::Column::FlowUuid.eq(required(&call.arguments,"automationId")?)).one(&state.db).await?.ok_or_else(||bad("automation unavailable"))?;
            super::development::authorize_references(state,&json!({"triggerFormUuid":flow.trigger_form_uuid}),grants,data_grants,&saved).await?;
        }
    }
    Ok(tool)
}

pub(super) async fn version(
    db: &impl ConnectionTrait,
    call: &ToolCall,
    lock: bool,
) -> Result<String, AppError> {
    if call.name == "platform_create_app" {
        return Ok("new-application:v1".into());
    }
    let app = required(&call.arguments, "appId")?;
    let suffix = if lock { " FOR UPDATE" } else { "" };
    let apps = rows(
        db,
        &format!("SELECT row_to_json(a)::text data FROM apps a WHERE route_app_id=$1{suffix}"),
        vec![app.into()],
    )
    .await
    .map_err(map_store)?;
    if apps.is_empty() {
        return Err(AppError::NotFound("application not found".into()));
    }
    let forms=rows(db,&format!("SELECT row_to_json(f)::text data FROM form_definitions f WHERE app_route_app_id=$1 ORDER BY id{suffix}"),vec![app.into()]).await.map_err(map_store)?;
    // Match the shared designer save's form -> navigation lock order.
    let nav=rows(db,&format!("SELECT row_to_json(n)::text data FROM app_navigation_items n WHERE app_route_app_id=$1 ORDER BY id{suffix}"),vec![app.into()]).await.map_err(map_store)?;
    let schemas=rows(db,&format!("SELECT row_to_json(s)::text data FROM form_schemas s JOIN form_definitions f ON f.form_uuid=s.form_uuid AND f.current_schema_version=s.version WHERE f.app_route_app_id=$1 ORDER BY s.id{suffix}"),vec![app.into()]).await.map_err(map_store)?;
    let flows=rows(db,&format!("SELECT row_to_json(a)::text data FROM automation_flows a WHERE app_route_app_id=$1 ORDER BY id{suffix}"),vec![app.into()]).await.map_err(map_store)?;
    Ok(fingerprint(
        &json!({"apps":apps,"navigation":nav,"forms":forms,"schemas":schemas,"automations":flows}),
    ))
}

pub(super) async fn invoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run): Path<Uuid>,
    Query(proof): Query<LeaseProof>,
    Json(request): Json<ToolRequest>,
) -> Result<Json<Value>, AppError> {
    let (scope, employee, current_grants) =
        execution_subject(&state, &headers, run, &proof).await?;
    let store = store(&state);
    let record = store.run(run).await.map_err(map_store)?;
    let snapshot = record
        .get("context_snapshot")
        .filter(|s| !s.is_null())
        .ok_or_else(|| bad("run has not been prepared"))?;
    let grants = frozen_grants(&current_grants, snapshot)?;
    let tool = authorize(
        &state,
        &scope,
        &employee,
        &current_grants,
        &request.call,
        Some(snapshot),
    )
    .await?;
    let lease = Lease {
        run_id: run,
        session_id: Uuid::parse_str(
            record["session_id"]
                .as_str()
                .ok_or_else(|| bad("session missing"))?,
        )
        .map_err(|_| bad("invalid session"))?,
        owner: proof.owner,
        epoch: proof.epoch,
        cancelled: false,
    };
    // The broker only accepts the exact call persisted in this run's checkpoint.
    let persisted = record["checkpoint"]["pending_calls"]
        .as_array()
        .is_some_and(|calls| {
            calls.iter().any(|c| {
                c["id"] == request.call.id
                    && c["name"] == request.call.name
                    && c["arguments"] == request.call.arguments
            })
        });
    if !persisted {
        return Err(AppError::Forbidden(
            "tool call is not pending in this run".into(),
        ));
    }
    if tool.id.starts_with("knowledge_") {
        let result=crate::modules::knowledge::retrieval::agent(&state,&lease,snapshot,&grants,&employee.id,&request.call).await?;
        execution_subject(&state,&headers,run,&proof).await?;
        return Ok(Json(json!({"status":"completed","result":result})));
    }
    if tool.effect_class == "read" {
        return Ok(Json(
            json!({"status":"completed","result":read(&state,&scope,&employee,&grants,&current_grants,snapshot,&request.call).await?}),
        ));
    }
    let existing=rows(&state.db,"SELECT row_to_json(c)::text data FROM agent_v2_confirmations c WHERE run_id=$1::uuid AND call_id=$2",vec![id(run),request.call.id.clone().into()]).await.map_err(map_store)?.pop();
    let Some(c) = existing else {
        let tx = store.fence(&lease, false).await.map_err(map_store)?;
        let version = version(&tx, &request.call, true).await?;
        let (_, fresh_employee, fresh_permissions) =
            execution_subject(&state, &headers, run, &proof).await?;
        authorize(
            &state,
            &scope,
            &fresh_employee,
            &fresh_permissions,
            &request.call,
            Some(snapshot),
        )
        .await?;
        let ttl = std::env::var("YAYA_AGENT_V2_CONFIRMATION_SECONDS")
            .ok()
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|n| (1..=86400).contains(n))
            .unwrap_or(1800);
        let preview = super::preview::build(&tx, &request.call).await?;
        store
            .request_confirmation_in(&tx, &lease, &request.call, &version, preview, ttl)
            .await
            .map_err(map_store)?;
        tx.commit().await?;
        return Ok(Json(json!({"status":"waiting_confirmation"})));
    };
    if c["arguments_hash"] != fingerprint(&request.call.arguments)
        || c["tool_name"] != request.call.name
    {
        return Err(AppError::Conflict("confirmation parameters changed".into()));
    }
    if c["policy_version"] != tools::POLICY_VERSION {
        return Err(AppError::Conflict(
            "confirmation policy changed; generate a new preview".into(),
        ));
    }
    if c["status"] == "pending" {
        return Err(AppError::Conflict("confirmation is pending".into()));
    }
    if ["rejected", "expired", "cancelled", "conflict", "failed"]
        .iter()
        .any(|s| c["status"] == *s)
    {
        let result = c
            .get("failure")
            .filter(|v| v.is_object())
            .cloned()
            .unwrap_or_else(|| json!({"status":c["status"],"executed":false}));
        return Ok(Json(json!({"status":"completed","result":result})));
    }
    let tx = store.fence(&lease, false).await.map_err(map_store)?;
    let confirmation = Uuid::parse_str(c["id"].as_str().ok_or_else(|| bad("confirmation id"))?)
        .map_err(|_| bad("confirmation id"))?;
    let c=rows(&tx,"SELECT row_to_json(c)::text data FROM agent_v2_confirmations c WHERE id=$1::uuid FOR UPDATE",vec![id(confirmation)]).await.map_err(map_store)?.pop().ok_or_else(||bad("confirmation missing"))?;
    if let Some(effect) = rows(
        &tx,
        "SELECT result::text data FROM agent_v2_effects WHERE effect_key=$1::uuid",
        vec![id(confirmation)],
    )
    .await
    .map_err(map_store)?
    .pop()
    {
        tx.commit().await?;
        return Ok(Json(json!({"status":"completed","result":effect})));
    }
    if c["status"] != "approved" {
        return Err(AppError::Conflict("confirmation is not approved".into()));
    }
    let fresh=rows(&tx,"SELECT jsonb_build_object('expired',expires_at<=now())::text data FROM agent_v2_confirmations WHERE id=$1::uuid",vec![id(confirmation)]).await.map_err(map_store)?;
    if fresh[0]["expired"] == true {
        exec(
            &tx,
            "UPDATE agent_v2_confirmations SET status='expired',failure=jsonb_build_object('status','expired','executed',false),resolved_at=now() WHERE id=$1::uuid",
            vec![id(confirmation)],
        )
        .await
        .map_err(map_store)?;
        event(
            &tx,
            lease.session_id,
            Some(run),
            "confirmation.resolved",
            json!({"confirmationId":confirmation,"status":"expired"}),
        )
        .await
        .map_err(map_store)?;
        tx.commit().await?;
        return Ok(Json(
            json!({"status":"completed","result":{"status":"expired","executed":false}}),
        ));
    }
    let version = version(&tx, &request.call, true).await?;
    let design_changed = if super::design::is_write(&request.call.name) {
        match super::design::prepare(&tx, &request.call).await {
            Ok(prepared) => c["preview"]["designBaseline"] != prepared.baseline,
            Err(AppError::Conflict(_)) => true,
            Err(error) => return Err(error),
        }
    } else {
        false
    };
    if c["resource_version"] != version || design_changed {
        exec(
            &tx,
            "UPDATE agent_v2_confirmations SET status='conflict',failure=jsonb_build_object('status','conflict','executed',false,'reason','resource_changed_requires_new_preview'),resolved_at=now() WHERE id=$1::uuid",
            vec![id(confirmation)],
        )
        .await
        .map_err(map_store)?;
        event(
            &tx,
            lease.session_id,
            Some(run),
            "confirmation.resolved",
            json!({"confirmationId":confirmation,"status":"conflict"}),
        )
        .await
        .map_err(map_store)?;
        tx.commit().await?;
        return Ok(Json(
            json!({"status":"completed","result":{"status":"conflict","executed":false,"reason":"resource_changed_requires_new_preview"}}),
        ));
    }
    // Authorization is refreshed after acquiring the run/resource locks, before any business mutation.
    let (_, fresh_employee, current_grants) =
        execution_subject(&state, &headers, run, &proof).await?;
    let fresh_grants = frozen_grants(&current_grants, snapshot)?;
    authorize(
        &state,
        &scope,
        &fresh_employee,
        &current_grants,
        &request.call,
        Some(snapshot),
    )
    .await?;
    let user = iam_user_entity::Entity::find_by_id(scope.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::Forbidden("user missing".into()))?;
    let result = write(&tx, &request.call, &user, &fresh_grants).await?;
    exec(
        &tx,
        "INSERT INTO agent_v2_effects(effect_key,result) VALUES($1::uuid,$2)",
        vec![id(confirmation), js(result.clone())],
    )
    .await
    .map_err(map_store)?;
    exec(
        &tx,
        "UPDATE agent_v2_confirmations SET status='executed' WHERE id=$1::uuid",
        vec![id(confirmation)],
    )
    .await
    .map_err(map_store)?;
    exec(&tx,"INSERT INTO agent_v2_tool_audit(id,confirmation_id,actor_user_id,action,outcome) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'executed')",vec![id(Uuid::new_v4()),id(confirmation),id(scope.user_id),tool.action_id.into()]).await.map_err(map_store)?;
    event(
        &tx,
        lease.session_id,
        Some(run),
        "confirmation.resolved",
        json!({"confirmationId":confirmation,"status":"executed"}),
    )
    .await
    .map_err(map_store)?;
    tx.commit().await?;
    Ok(Json(json!({"status":"completed","result":result})))
}

async fn read(
    state: &AppState,
    scope: &Scope,
    employee: &RuntimeAiEmployee,
    grants: &HashSet<String>,
    current_grants: &HashSet<String>,
    snapshot: &Value,
    call: &ToolCall,
) -> Result<Value, AppError> {
    let args = &call.arguments;
    match call.name.as_str() {
        "platform_list_component_contracts" => Ok(crate::modules::development_contracts::component_catalog()),
        "platform_get_component_contract" => crate::modules::development_contracts::component(required(args,"componentId")?),
        "platform_get_automation_contract" => Ok(crate::modules::development_contracts::automation_catalog()),
        "platform_get_automation_node_contract" => crate::modules::development_contracts::node(required(args,"nodeType")?),
        "platform_validate_form_design" => super::development::diagnostics(super::development::validate_form(&state.db,args).await),
        "platform_validate_automation_design" => super::development::diagnostics(super::development::validate_automation(&state.db,call).await),
        "platform_list_apps" => {
            let user = iam_user_entity::Entity::find_by_id(scope.user_id)
                .one(&state.db)
                .await?
                .ok_or_else(|| bad("user missing"))?;
            let apps = crate::modules::apps::list_apps_for_subject(state, &user, grants).await?;
            Ok(json!({"items":apps}))
        }
        "platform_list_forms" => {
            let app_id = required(args, "appId")?;
            let forms = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
                .order_by_asc(form_definition_entity::Column::FormUuid)
                .all(&state.db)
                .await?;
            let forms = forms
                .into_iter()
                .filter(|f| has(grants, &format!("form:{}:display", f.form_uuid)))
                .collect::<Vec<_>>();
            let page = args["page"].as_u64().unwrap_or(1).clamp(1, 1_000_000);
            let page_size = args["pageSize"].as_u64().unwrap_or(50).clamp(1, 100);
            let total = forms.len();
            let items = forms
                .into_iter()
                .skip(page.saturating_sub(1).saturating_mul(page_size) as usize)
                .take(page_size as usize)
                .map(crate::modules::forms::ApiFormSummary::from)
                .collect::<Vec<_>>();
            Ok(json!({"items":items,"total":total,"page":page,"pageSize":page_size}))
        }
        "platform_get_field_outline" => {
            let app_id = required(args, "appId")?;
            let forms = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
                .order_by_asc(form_definition_entity::Column::FormUuid)
                .all(&state.db)
                .await?;
            let saved = serde_json::from_value(snapshot["grants"].clone())
                .map_err(|_| bad("task permission snapshot missing"))?;
            let mut visible = Vec::new();
            for form in forms {
                if !has(grants, &format!("form:{}:display", form.form_uuid)) {
                    continue;
                }
                let schema = crate::modules::forms::load_schema_version(
                    &state.db,
                    &form.form_uuid,
                    form.current_schema_version,
                )
                .await?;
                let policy = crate::platform::record_access::FieldPolicy::new(
                    &schema.schema_json,
                    &form.form_uuid,
                    current_grants,
                    &saved,
                );
                let fields=schema.schema_json["fields"].as_array().into_iter().flatten().filter(|field|field["id"].as_str().is_some_and(|id|policy.can_read(id))).map(|field|json!({"id":field["id"],"label":field["label"],"type":field["type"],"required":field["props"]["required"],"parentGroupId":field["parentGroupId"],"hidden":field["props"]["isHidden"]==true})).collect::<Vec<_>>();
                visible.push(json!({"formUuid":form.form_uuid,"name":form.name,"formType":form.form_type,"schemaVersion":form.current_schema_version,"fields":fields}));
            }
            Ok(json!({"appId":app_id,"forms":visible}))
        }
        "platform_get_form_schema" => {
            let f =
                crate::modules::forms::find_form_definition(&state.db, required(args, "formUuid")?)
                    .await?;
            let schema = crate::modules::forms::load_schema_version(
                &state.db,
                &f.form_uuid,
                f.current_schema_version,
            )
            .await?;
            let saved = serde_json::from_value(snapshot["grants"].clone())
                .map_err(|_| bad("task permission snapshot missing"))?;
            let policy = crate::platform::record_access::FieldPolicy::new(
                &schema.schema_json,
                &f.form_uuid,
                current_grants,
                &saved,
            );
            let complete = super::design::full_access(
                &schema.schema_json,
                &f.form_uuid,
                current_grants,
                &saved,
            );
            let mut payload = crate::modules::forms::build_schema_payload(&f, schema);
            let baseline = if complete
                && has(grants, &format!("app:{}:edit_form", f.app_route_app_id))
                && matches!(f.form_type.as_str(), "normal" | "workflow")
            {
                Some(
                    json!({"algorithm":"sha256-json-v1","baseVersion":payload.version,"baseHash":super::design::hash(&payload.schema)}),
                )
            } else {
                None
            };
            if let Some(fields) = payload.schema["fields"].as_array_mut() {
                fields.retain(|field| field["id"].as_str().is_some_and(|id| policy.can_read(id)));
            }
            let mut result =
                serde_json::to_value(payload).map_err(|_| bad("schema serialization"))?;
            if let Some(baseline) = baseline {
                result["designBaseline"] = baseline;
            }
            Ok(result)
        }
        "platform_get_form_relationships" => {
            let form_id = required(args, "formUuid")?;
            let definition =
                crate::modules::forms::find_form_definition(&state.db, form_id).await?;
            let schema = crate::modules::forms::load_schema_version(
                &state.db,
                form_id,
                definition.current_schema_version,
            )
            .await?;
            let saved = serde_json::from_value(snapshot["grants"].clone())
                .map_err(|_| bad("task permission snapshot missing"))?;
            let policy = crate::platform::record_access::FieldPolicy::new(
                &schema.schema_json,
                form_id,
                current_grants,
                &saved,
            );
            let mut relationships = Vec::new();
            for field in schema.schema_json["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|field| {
                    field["type"] == "associationFormField"
                        && field["id"].as_str().is_some_and(|id| policy.can_read(id))
                })
            {
                let Some(target) = field["props"]["associationFormId"].as_str() else {
                    continue;
                };
                let target_form =
                    crate::modules::forms::find_form_definition(&state.db, target).await?;
                if definition.app_route_app_id != target_form.app_route_app_id
                    || !has(
                        grants,
                        &format!("app:{}:display", target_form.app_route_app_id),
                    )
                    || !has(grants, &format!("form:{target}:display"))
                {
                    continue;
                }
                relationships.push(json!({"fieldId":field["id"],"label":field["label"],"targetFormUuid":target,"displayFieldId":field["props"]["associationPrimaryFieldId"],"fills":field["props"]["associationFills"]}));
            }
            Ok(json!({"formUuid":form_id,"relationships":relationships}))
        }
        "platform_get_related_records" => {
            related_records(state, scope, employee, current_grants, snapshot, args).await
        }
        "platform_list_form_records" => {
            let mut query = args.clone();
            query["filters"] = json!([]);
            query["sorts"] = json!([]);
            query_records(state, scope, &query, current_grants, snapshot).await
        }
        "platform_list_detail_records" => {
            detail_records(state, scope, employee, current_grants, snapshot, args).await
        }
        "platform_get_detail_form_definition" => {
            let form_id = required(args, "formUuid")?;
            let definition =
                crate::modules::forms::find_form_definition(&state.db, form_id).await?;
            if definition.form_type != "detail" {
                return Err(bad("form is not a detail form"));
            }
            let detail=crate::infrastructure::entities::form_detail_definition_entity::Entity::find().filter(crate::infrastructure::entities::form_detail_definition_entity::Column::DetailFormUuid.eq(form_id)).one(&state.db).await?.ok_or_else(||bad("detail definition missing"))?;
            if !has(grants, &format!("form:{}:display", detail.source_form_uuid)) {
                return Err(AppError::Forbidden("source form permission denied".into()));
            }
            let schema = crate::modules::forms::load_schema_version(
                &state.db,
                form_id,
                definition.current_schema_version,
            )
            .await?;
            let saved = serde_json::from_value(snapshot["grants"].clone())
                .map_err(|_| bad("task permission snapshot missing"))?;
            let policy = crate::platform::record_access::FieldPolicy::new(
                &schema.schema_json,
                form_id,
                current_grants,
                &saved,
            );
            let fields = schema.schema_json["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|field| field["id"].as_str().is_some_and(|id| policy.can_read(id)))
                .collect::<Vec<_>>();
            Ok(
                json!({"formUuid":form_id,"sourceFormUuid":detail.source_form_uuid,"subformFieldId":detail.subform_field_id,"title":detail.title,"primaryDisplayFieldId":detail.primary_display_field_id,"secondaryDisplayFieldId":detail.secondary_display_field_id,"schemaVersion":definition.current_schema_version,"fields":fields}),
            )
        }
        "platform_get_workflow_process_definition" => {
            let form_id = required(args, "formUuid")?;
            let form = crate::modules::forms::find_form_definition(&state.db, form_id).await?;
            if form.form_type != "workflow" {
                return Err(bad("form is not a workflow form"));
            }
            let flow = AutomationFlowEntity::find()
                .filter(automation_flow_entity::Column::TriggerFormUuid.eq(form_id))
                .filter(automation_flow_entity::Column::FlowType.eq("process"))
                .one(&state.db)
                .await?
                .ok_or_else(|| {
                    AppError::NotFound("workflow process definition not found".into())
                })?;
            let version = crate::infrastructure::entities::automation_flow_version_entity::Entity::find()
                .filter(crate::infrastructure::entities::automation_flow_version_entity::Column::FlowId.eq(flow.id))
                .filter(crate::infrastructure::entities::automation_flow_version_entity::Column::Version.eq(flow.current_version))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("current workflow process version not found".into()))?;
            let mut definition = json!({"formUuid":form_id,"flowUuid":flow.flow_uuid,"appId":flow.app_route_app_id,"name":version.name,"status":flow.status,"version":version.version,"triggerConfig":version.trigger_config,"nodes":version.nodes_json,"edges":version.edges_json});
            sanitize_automation_value(&mut definition);
            Ok(definition)
        }
        "platform_get_workflow_record_runtime" => {
            let form_id = required(args, "formUuid")?;
            let record_id = required(args, "recordUuid")?;
            let form = crate::modules::forms::find_form_definition(&state.db, form_id).await?;
            if form.form_type != "workflow" {
                return Err(bad("form is not a workflow form"));
            }
            let creators = scoped_creators(state, scope, form_id, current_grants, snapshot).await?;
            let record = RecordRepository::new(&state.db)
                .find(form_id, record_id)
                .await?;
            if creators
                .as_ref()
                .is_some_and(|ids| !ids.contains(&record.created_by))
            {
                return Err(AppError::NotFound("workflow record not found".into()));
            }
            let runtime = crate::modules::workflows::load_workflow_record_runtime_with_limit(
                &state.db,
                form_id,
                record_id,
                Some(201),
            )
            .await?;
            let tasks_truncated = runtime.tasks.len() > 200;
            let actions_truncated = runtime.actions.len() > 200;
            // Free-text comments may repeat business fields that this employee cannot
            // read. The model receives status metadata, never unrestricted comments.
            let tasks = runtime
                .tasks
                .into_iter()
                .take(200)
                .map(|mut task| {
                    if let Some(fields) = task.as_object_mut() {
                        fields.remove("comment");
                    }
                    task
                })
                .collect::<Vec<_>>();
            let actions = runtime.actions.into_iter().take(200).map(|action| {
                json!({"action":action.action,"operator":action.operator,"createdAt":action.created_at})
            }).collect::<Vec<_>>();
            Ok(
                json!({"formUuid":form_id,"recordUuid":record_id,"runId":runtime.run_id,
                "instance":runtime.instance,"tasks":tasks,"actions":actions,
                "tasksTruncated":tasks_truncated,"actionsTruncated":actions_truncated,
                "readOnly":true,"supportedOperations":[]}),
            )
        }
        "platform_get_form_schema_contract" => {
            let Json(response) =
                crate::modules::forms::get_form_schema_contract(State(state.clone())).await?;
            Ok(response.data.unwrap_or(Value::Null))
        }
        "platform_list_navigation_groups" => {
            let all=rows(&state.db,"SELECT row_to_json(n)::text data FROM app_navigation_items n WHERE app_route_app_id=$1 ORDER BY sort_order,id LIMIT 1000",vec![required(args,"appId")?.into()]).await.map_err(map_store)?;
            let mut visible = all
                .iter()
                .filter(|item| {
                    item["item_type"] != "form"
                        || item["target_form_uuid"]
                            .as_str()
                            .is_some_and(|form| has(grants, &format!("form:{form}:display")))
                })
                .filter_map(|item| item["id"].as_str().map(str::to_owned))
                .collect::<HashSet<_>>();
            loop {
                let added = all
                    .iter()
                    .filter(|item| {
                        item["item_type"] == "group"
                            && !visible.contains(item["id"].as_str().unwrap_or_default())
                            && all.iter().any(|child| {
                                child["parent_id"] == item["id"]
                                    && visible.contains(child["id"].as_str().unwrap_or_default())
                            })
                    })
                    .filter_map(|item| item["id"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>();
                if added.is_empty() {
                    break;
                }
                visible.extend(added);
            }
            let items = all
                .into_iter()
                .filter(|item| {
                    item["item_type"] == "group"
                        && visible.contains(item["id"].as_str().unwrap_or_default())
                })
                .collect::<Vec<_>>();
            Ok(json!({"items":items}))
        }
        "platform_list_automations" => Ok(
            json!({"items":rows(&state.db,"SELECT jsonb_build_object('flowUuid',flow_uuid,'name',name,'description',description,'status',status,'currentVersion',current_version,'flowType',flow_type,'triggerFormUuid',trigger_form_uuid,'createdAt',created_at,'updatedAt',updated_at)::text data FROM automation_flows WHERE app_route_app_id=$1 ORDER BY id LIMIT 200",vec![required(args,"appId")?.into()]).await.map_err(map_store)?}),
        ),
        "platform_get_automation_graph" => {
            let mut flow = rows(
                &state.db,
                "SELECT jsonb_build_object('id',id,'flowUuid',flow_uuid,'appId',app_route_app_id,'name',name,'description',description,'status',status,'currentVersion',current_version,'flowType',flow_type,'triggerFormUuid',trigger_form_uuid,'triggerConfig',trigger_config,'createdAt',created_at,'updatedAt',updated_at)::text data FROM automation_flows WHERE flow_uuid=$1",
                vec![required(args, "automationId")?.into()],
            )
            .await
            .map_err(map_store)?
            .pop()
            .ok_or_else(|| bad("automation missing"))?;
            let flow_id = flow["id"].as_str().ok_or_else(|| bad("flow id"))?;
            let version = flow["currentVersion"].as_i64().unwrap_or(1);
            let mut nodes=rows(&state.db,"SELECT raw_json::text data FROM automation_nodes WHERE flow_id=$1::uuid AND version=$2 ORDER BY node_key LIMIT 500",vec![flow_id.into(),version.into()]).await.map_err(map_store)?;
            let mut edges=rows(&state.db,"SELECT raw_json::text data FROM automation_edges WHERE flow_id=$1::uuid AND version=$2 ORDER BY edge_key LIMIT 1000",vec![flow_id.into(),version.into()]).await.map_err(map_store)?;
            sanitize_automation_value(&mut flow);
            for node in &mut nodes {
                sanitize_automation_value(node);
            }
            for edge in &mut edges {
                sanitize_automation_value(edge);
            }
            Ok(json!({"flow":flow,"nodes":nodes,"edges":edges}))
        }
        "platform_query_records" => {
            query_records(state, scope, args, current_grants, snapshot).await
        }
        "platform_aggregate_records" => {
            aggregate_records(state, scope, args, current_grants, snapshot).await
        }
        _ => Err(bad("unsupported read tool")),
    }
}

async fn related_records(
    state: &AppState,
    scope: &Scope,
    _employee: &RuntimeAiEmployee,
    grants: &HashSet<String>,
    snapshot: &Value,
    args: &Value,
) -> Result<Value, AppError> {
    let source_id = required(args, "formUuid")?;
    let record_id = required(args, "recordUuid")?;
    let field_id = required(args, "fieldId")?;
    let source = crate::modules::forms::find_form_definition(&state.db, source_id).await?;
    let source_schema = crate::modules::forms::load_schema_version(
        &state.db,
        source_id,
        source.current_schema_version,
    )
    .await?;
    let source_saved = serde_json::from_value(snapshot["grants"].clone())
        .map_err(|_| bad("task permission snapshot missing"))?;
    let source_policy = crate::platform::record_access::FieldPolicy::new(
        &source_schema.schema_json,
        source_id,
        grants,
        &source_saved,
    );
    let field = source_schema.schema_json["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|field| {
            field["id"] == field_id
                && field["type"] == "associationFormField"
                && source_policy.can_read(field_id)
        })
        .ok_or_else(|| AppError::Forbidden("association field is unavailable".into()))?;
    let target_id = field["props"]["associationFormId"]
        .as_str()
        .ok_or_else(|| bad("association target is missing"))?;
    let target = crate::modules::forms::find_form_definition(&state.db, target_id).await?;
    let actions = frozen_grants(grants, snapshot)?;
    if source.app_route_app_id != target.app_route_app_id
        || !has(
            &actions,
            &format!("app:{}:display", target.app_route_app_id),
        )
        || !has(&actions, &format!("form:{target_id}:display"))
    {
        return Err(AppError::Forbidden(
            "related form is outside the authorized application scope".into(),
        ));
    }
    let source_creators = scoped_creators(state, scope, source_id, grants, snapshot).await?;
    let source_record = RecordRepository::new(&state.db)
        .find(source_id, record_id)
        .await?;
    if source_creators
        .as_ref()
        .is_some_and(|ids| !ids.contains(&source_record.created_by))
    {
        return Err(AppError::NotFound("source record not found".into()));
    }
    let linked = source_record
        .record_data
        .get(field_id)
        .ok_or_else(|| bad("association value is missing"))?;
    let ids: Vec<&str> = if let Some(id) = linked.as_str() {
        vec![id]
    } else if let Some(items) = linked.as_array() {
        if items.len() > 20 {
            return Err(bad("association has too many linked records"));
        }
        items
            .iter()
            .map(|item| {
                item.as_str()
                    .ok_or_else(|| bad("invalid association record reference"))
            })
            .collect::<Result<_, _>>()?
    } else {
        return Err(bad("unsupported association value"));
    };
    let target_creators = scoped_creators(state, scope, target_id, grants, snapshot).await?;
    let target_schema = crate::modules::forms::load_schema_version(
        &state.db,
        target_id,
        target.current_schema_version,
    )
    .await?;
    let target_policy = crate::platform::record_access::FieldPolicy::new(
        &target_schema.schema_json,
        target_id,
        grants,
        &source_saved,
    );
    let mut items = Vec::new();
    for linked_id in ids.into_iter().take(20) {
        let record = match RecordRepository::new(&state.db)
            .find(target_id, linked_id)
            .await
        {
            Ok(record) => record,
            Err(AppError::NotFound(_)) => continue,
            Err(error) => return Err(error),
        };
        if target_creators
            .as_ref()
            .is_some_and(|allowed| !allowed.contains(&record.created_by))
        {
            continue;
        }
        items.push(json!({"id":record.record_uuid,"formUuid":target_id,"schemaVersion":record.schema_version,"data":target_policy.project(&record.record_data),"createdAt":record.created_at,"updatedAt":record.updated_at}));
    }
    Ok(
        json!({"sourceFormUuid":source_id,"sourceRecordUuid":record_id,"fieldId":field_id,"targetFormUuid":target_id,"items":items}),
    )
}

async fn detail_records(
    state: &AppState,
    scope: &Scope,
    _employee: &RuntimeAiEmployee,
    grants: &HashSet<String>,
    snapshot: &Value,
    args: &Value,
) -> Result<Value, AppError> {
    let source_id = required(args, "sourceFormUuid")?;
    let parent_id = required(args, "recordUuid")?;
    let source = crate::modules::forms::find_form_definition(&state.db, source_id).await?;
    let source_schema = crate::modules::forms::load_schema_version(
        &state.db,
        source_id,
        source.current_schema_version,
    )
    .await?;
    let source_saved = serde_json::from_value(snapshot["grants"].clone())
        .map_err(|_| bad("task permission snapshot missing"))?;
    let parent_policy = crate::platform::record_access::FieldPolicy::new(
        &source_schema.schema_json,
        source_id,
        grants,
        &source_saved,
    );
    let creators = scoped_creators(state, scope, source_id, grants, snapshot).await?;
    let parent = RecordRepository::new(&state.db)
        .find(source_id, parent_id)
        .await?;
    if creators
        .as_ref()
        .is_some_and(|ids| !ids.contains(&parent.created_by))
    {
        return Err(AppError::NotFound("source record not found".into()));
    }
    let links = crate::infrastructure::entities::form_detail_definition_entity::Entity::find()
        .filter(
            crate::infrastructure::entities::form_detail_definition_entity::Column::SourceFormUuid
                .eq(source_id),
        )
        .order_by_asc(
            crate::infrastructure::entities::form_detail_definition_entity::Column::CreatedAt,
        )
        .all(&state.db)
        .await?;
    let page = args["page"].as_u64().unwrap_or(1).clamp(1, 1_000_000);
    let page_size = args["pageSize"].as_u64().unwrap_or(50).clamp(1, 100);
    let start = page.saturating_sub(1).saturating_mul(page_size) as usize;
    let end = start.saturating_add(page_size as usize);
    let actions = frozen_grants(grants, snapshot)?;
    let mut total = 0usize;
    let mut items = Vec::new();
    for link in links {
        if !parent_policy.can_read(&link.subform_field_id)
            || !has(&actions, &format!("form:{}:display", link.detail_form_uuid))
        {
            continue;
        }
        let detail =
            crate::modules::forms::find_form_definition(&state.db, &link.detail_form_uuid).await?;
        if detail.app_route_app_id != source.app_route_app_id {
            return Err(AppError::Forbidden(
                "detail form application mismatch".into(),
            ));
        }
        let schema = crate::modules::forms::load_schema_version(
            &state.db,
            &link.detail_form_uuid,
            detail.current_schema_version,
        )
        .await?;
        let policy = crate::platform::record_access::FieldPolicy::new(
            &schema.schema_json,
            &link.detail_form_uuid,
            grants,
            &source_saved,
        );
        if let Some(rows) = parent.record_data[&link.subform_field_id].as_array() {
            for (index, row) in rows.iter().enumerate() {
                let ordinal = total;
                total = total.saturating_add(1);
                if ordinal >= start && ordinal < end {
                    items.push(json!({"id":format!("{}:{index}",parent_id),"detailFormUuid":link.detail_form_uuid,"sourceFormUuid":source_id,"sourceRecordUuid":parent_id,"subformFieldId":link.subform_field_id,"schemaVersion":detail.current_schema_version,"data":policy.project(row)}));
                }
            }
        }
    }
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":page_size}))
}

fn sanitize_automation_value(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let key = key.to_ascii_lowercase();
                if [
                    "secret",
                    "token",
                    "password",
                    "apikey",
                    "credential",
                    "privatekey",
                ]
                .iter()
                .any(|sensitive| key.contains(sensitive))
                {
                    *child = json!("[REDACTED]");
                } else {
                    sanitize_automation_value(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_automation_value(item);
            }
        }
        _ => {}
    }
}

fn query_field_kinds(schema: &Value) -> HashMap<String, QueryFieldKind> {
    let mut kinds = HashMap::from([
        ("id".into(), QueryFieldKind::Text),
        ("recordUuid".into(), QueryFieldKind::Text),
        ("instanceId".into(), QueryFieldKind::Text),
        ("schemaVersion".into(), QueryFieldKind::Number),
        ("createdBy".into(), QueryFieldKind::Text),
        ("submitter".into(), QueryFieldKind::Text),
        ("updatedBy".into(), QueryFieldKind::Text),
        ("createdAt".into(), QueryFieldKind::DateTime),
        ("updatedAt".into(), QueryFieldKind::DateTime),
        ("workflowApprovalStatus".into(), QueryFieldKind::Text),
        ("workflowInstanceStatus".into(), QueryFieldKind::Text),
        ("workflowCurrentApprovalNode".into(), QueryFieldKind::Text),
        ("workflowSubmitter".into(), QueryFieldKind::Text),
    ]);
    crate::modules::forms::collect_queryable_field_kinds(schema, &mut kinds);
    kinds
}

async fn scoped_creators(
    state: &AppState,
    scope: &Scope,
    form: &str,
    grants: &HashSet<String>,
    snapshot: &Value,
) -> Result<Option<Vec<String>>, AppError> {
    let saved = serde_json::from_value(snapshot["grants"].clone())
        .map_err(|_| bad("task permission snapshot missing"))?;
    let current =
        crate::platform::record_access::creators(state, scope.user_id, form, grants).await?;
    let previous =
        crate::platform::record_access::creators(state, scope.user_id, form, &saved).await?;
    Ok(crate::platform::record_access::intersect_creators(
        current, previous,
    ))
}

async fn query_records(
    state: &AppState,
    scope: &Scope,
    args: &Value,
    grants: &HashSet<String>,
    snapshot: &Value,
) -> Result<Value, AppError> {
    let form_id = required(args, "formUuid")?;
    let mut request: crate::modules::forms::dto::QueryFormRecordsRequest =
        serde_json::from_value(json!({
            "page":args.get("page").cloned().unwrap_or(json!(1)),
            "pageSize":args.get("pageSize").cloned().unwrap_or(json!(50)),
            "filters":args.get("filters").cloned().unwrap_or(json!([])),
            "sorts":args.get("sorts").cloned().unwrap_or(json!([]))
        }))
        .map_err(|_| bad("invalid record query"))?;
    request.page = Some(request.page.unwrap_or(1).clamp(1, 1_000_000));
    request.page_size = Some(request.page_size.unwrap_or(50).clamp(1, 100));
    if request.filters.len() > 20 || request.sorts.len() > 5 {
        return Err(bad("record query exceeds filter or sort limits"));
    }
    let definition = crate::modules::forms::find_form_definition(&state.db, form_id).await?;
    if definition.form_type == "detail" {
        return Err(AppError::Forbidden(
            "detail record query is not yet supported by the scoped record service".into(),
        ));
    }
    let schema = crate::modules::forms::load_schema_version(
        &state.db,
        form_id,
        definition.current_schema_version,
    )
    .await?;
    let kinds = query_field_kinds(&schema.schema_json);
    let saved = serde_json::from_value(snapshot["grants"].clone())
        .map_err(|_| bad("task permission snapshot missing"))?;
    let fields = crate::platform::record_access::FieldPolicy::new(
        &schema.schema_json,
        form_id,
        grants,
        &saved,
    );
    for field in request
        .filters
        .iter()
        .map(|r| &r.field_id)
        .chain(request.sorts.iter().map(|r| &r.field_id))
    {
        if !kinds.contains_key(field) {
            return Err(bad("record query references an unknown field"));
        }
        if schema.schema_json["fields"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["id"] == field.as_str()))
            && !fields.can_query(field)
        {
            return Err(AppError::Forbidden(
                "record query references an unreadable field".into(),
            ));
        }
    }
    let creators = scoped_creators(state, scope, form_id, grants, snapshot).await?;
    let page = request.page.unwrap_or(1).clamp(1, 1_000_000);
    let page_size = request.page_size.unwrap_or(50).clamp(1, 100);
    let (records, total) = RecordRepository::new(&state.db)
        .query_page_for_creators(
            form_id,
            &request,
            &kinds,
            page,
            page_size,
            creators.as_deref(),
        )
        .await?;
    let items=records.into_iter().map(|r|json!({"id":r.record_uuid,"formUuid":r.form_uuid,"schemaVersion":r.schema_version,"data":fields.project(&r.record_data),"createdBy":r.created_by,"updatedBy":r.updated_by,"createdAt":r.created_at,"updatedAt":r.updated_at})).collect::<Vec<_>>();
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":page_size}))
}

async fn aggregate_records(
    state: &AppState,
    scope: &Scope,
    args: &Value,
    grants: &HashSet<String>,
    snapshot: &Value,
) -> Result<Value, AppError> {
    let form_id = required(args, "formUuid")?;
    let operation = required(args, "operation")?;
    if !matches!(operation, "count" | "sum" | "avg" | "min" | "max") {
        return Err(bad("unsupported aggregate operation"));
    }
    let request: crate::modules::forms::dto::QueryFormRecordsRequest = serde_json::from_value(
        json!({"filters":args.get("filters").cloned().unwrap_or(json!([]))}),
    )
    .map_err(|_| bad("invalid record filters"))?;
    if request.filters.len() > 20 {
        return Err(bad("record query exceeds filter limit"));
    }
    let definition = crate::modules::forms::find_form_definition(&state.db, form_id).await?;
    if definition.form_type == "detail" {
        return Err(AppError::Forbidden(
            "detail record query is not yet supported by the scoped record service".into(),
        ));
    }
    let schema = crate::modules::forms::load_schema_version(
        &state.db,
        form_id,
        definition.current_schema_version,
    )
    .await?;
    let kinds = query_field_kinds(&schema.schema_json);
    let saved = serde_json::from_value(snapshot["grants"].clone())
        .map_err(|_| bad("task permission snapshot missing"))?;
    let fields = crate::platform::record_access::FieldPolicy::new(
        &schema.schema_json,
        form_id,
        grants,
        &saved,
    );
    for field in request
        .filters
        .iter()
        .map(|r| r.field_id.as_str())
        .chain(args["groupBy"].as_str())
        .chain(args["field"].as_str())
    {
        if !kinds.contains_key(field) {
            return Err(bad("aggregate query references an unknown field"));
        }
        if schema.schema_json["fields"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["id"] == field))
            && !fields.can_query(field)
        {
            return Err(AppError::Forbidden(
                "aggregate query references an unreadable field".into(),
            ));
        }
    }
    let creators = scoped_creators(state, scope, form_id, grants, snapshot).await?;
    let values = RecordRepository::new(&state.db)
        .aggregate_for_creators(
            form_id,
            &request,
            &kinds,
            creators.as_deref(),
            operation,
            args["field"].as_str(),
            args["groupBy"].as_str(),
        )
        .await?;
    Ok(json!({"items":values}))
}
async fn write(
    db: &impl ConnectionTrait,
    call: &ToolCall,
    user: &iam_user_entity::Model,
    grants: &HashSet<String>,
) -> Result<Value, AppError> {
    let args = &call.arguments;
    let optional = |key: &str| args[key].as_str().map(str::to_owned);
    match call.name.as_str() {
        "platform_create_automation" => {
            super::development::validate_automation(db,call).await?;
            let created = crate::modules::automations::create_automation_definition_in_transaction(
                db,
                required(args, "appId")?,
                Some(
                    crate::modules::automations::dto::CreateAutomationFlowRequest {
                        name: optional("name"),
                        description: optional("description"),
                        trigger_form_uuid: optional("triggerFormUuid"),
                        trigger_events: args
                            .get("triggerEvents")
                            .cloned()
                            .map(serde_json::from_value)
                            .transpose()
                            .map_err(|_| bad("invalid trigger events"))?,
                        operator: Some(user.id.to_string()),
                    },
                ),
            )
            .await?;
            let payload:crate::modules::automations::dto::UpdateAutomationFlowRequest=serde_json::from_value(json!({"nodes":args["nodes"],"edges":args["edges"],"operator":user.id.to_string(),"changeSummary":"Agent V2 confirmed automation"})).map_err(|_|bad("invalid automation definition"))?;
            let updated = crate::modules::automations::update_automation_definition_in_transaction(
                db,
                &created.flow_uuid,
                payload,
            )
            .await?;
            Ok(
                json!({"automationId":updated.flow_uuid,"name":updated.name,"version":updated.current_version,"status":updated.status,"executed":false}),
            )
        }
        "platform_update_automation" => {
            super::development::validate_automation(db,call).await?;
            let payload:crate::modules::automations::dto::UpdateAutomationFlowRequest=serde_json::from_value(json!({"name":args.get("name"),"description":args.get("description"),"nodes":args["nodes"],"edges":args["edges"],"operator":user.id.to_string(),"changeSummary":"Agent V2 confirmed graph update"})).map_err(|_|bad("invalid automation update"))?;
            let updated=crate::modules::automations::update_automation_definition_in_transaction(db,required(args,"automationId")?,payload).await?;
            Ok(json!({"automationId":updated.flow_uuid,"name":updated.name,"version":updated.current_version,"status":updated.status,"executed":false}))
        }
        "platform_delete_automation" => {
            crate::modules::automations::delete_automation_definition_in_transaction(
                db,
                required(args, "automationId")?,
            )
            .await?;
            Ok(json!({"deleted":true}))
        }
        "platform_create_form" => {
            let kind = args["formType"].as_str().unwrap_or("normal");
            if !matches!(kind, "normal" | "workflow" | "defined") {
                return Err(bad("unsupported form type"));
            }
            let form = crate::modules::forms::create_blank_form_in_transaction(
                db,
                required(args, "appId")?,
                optional("name"),
                kind,
                args["parentGroupId"].as_str(),
            )
            .await?;
            Ok(json!({"formUuid":form.form_uuid,"name":form.name,"formType":form.form_type}))
        }
        "platform_delete_app" => {
            crate::modules::apps::deletion::delete_app_contents(db, required(args, "appId")?)
                .await?;
            Ok(json!({"deleted":true}))
        }
        "platform_delete_form" => {
            crate::modules::forms::delete_form_definition_in_transaction(
                db,
                required(args, "formUuid")?,
            )
            .await?;
            Ok(json!({"deleted":true}))
        }
        "platform_save_form_schema" | "platform_apply_design_patch" => {
            let prepared = super::design::prepare(db, call).await?;
            let base = args["baseVersion"]
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .ok_or_else(|| bad("invalid base version"))?;
            let definition =
                crate::modules::forms::find_form_definition(db, required(args, "formUuid")?)
                    .await?;
            if definition.current_schema_version != base {
                return Err(AppError::Conflict("schema version changed".into()));
            }
            let (_, schema) = crate::modules::forms::save_form_schema_definition_in_transaction(
                db,
                &definition.form_uuid,
                crate::modules::forms::dto::SaveSchemaRequest {
                    schema: prepared.target,
                    base_version: Some(base),
                    change_log: Some("Agent V2 confirmed schema".into()),
                },
            )
            .await?;
            if super::design::hash(&schema.schema)
                != prepared.baseline["targetHash"].as_str().unwrap_or("")
            {
                return Err(AppError::Conflict(
                    "saved design differs from frozen target".into(),
                ));
            }
            Ok(
                json!({"formUuid":schema.form_uuid,"version":schema.version,"designHash":prepared.baseline["targetHash"]}),
            )
        }
        "platform_create_detail_form" => {
            let detail = crate::modules::forms::create_detail_form_definition_in_transaction(
                db,
                required(args, "sourceFormUuid")?,
                crate::modules::forms::dto::CreateDetailFormRequest {
                    subform_field_id: required(args, "subformFieldId")?.into(),
                    title: optional("title"),
                    primary_display_field_id: None,
                    secondary_display_field_id: None,
                },
            )
            .await?;
            Ok(serde_json::to_value(detail).map_err(|_| bad("detail serialization"))?)
        }
        "platform_create_app" => {
            let app = crate::modules::apps::create_app_definition(
                db,
                user,
                crate::modules::apps::CreateAppRequest {
                    name: optional("name"),
                    description: optional("description"),
                    icon: optional("icon"),
                },
            )
            .await?;
            Ok(json!({"appId":app.route_app_id,"name":app.name}))
        }
        "platform_update_app" => {
            let app = crate::modules::apps::update_app_definition(
                db,
                required(args, "appId")?,
                crate::modules::apps::UpdateAppRequest {
                    name: optional("name"),
                    description: optional("description"),
                    icon: optional("icon"),
                },
                user,
                grants,
            )
            .await?;
            Ok(json!({"appId":app.route_app_id,"name":app.name}))
        }
        "platform_create_navigation_group" => {
            let group = crate::modules::navigation::create_navigation_group_definition(
                db,
                required(args, "appId")?,
                crate::modules::navigation::CreateNavigationGroupRequest {
                    title: required(args, "title")?.into(),
                    parent_id: optional("parentGroupId"),
                },
            )
            .await?;
            Ok(json!({"id":group.id,"title":group.title}))
        }
        "platform_delete_navigation_group" => {
            let result = crate::modules::navigation::delete_navigation_group_definition(
                db,
                required(args, "appId")?,
                required(args, "groupId")?,
            )
            .await?;
            Ok(serde_json::to_value(result).map_err(|_| bad("result serialization"))?)
        }
        "platform_move_form_to_group" => {
            crate::modules::navigation::move_form_navigation_to_group(
                db,
                required(args, "appId")?,
                required(args, "formUuid")?,
                args["parentGroupId"].as_str(),
            )
            .await?;
            Ok(json!({"moved":true}))
        }
        _ => Err(bad("unsupported write tool")),
    }
}

#[cfg(test)]
#[path = "tool_read_tests.rs"]
mod read_database_tests;

#[cfg(test)]
mod authorization_tests {
    use super::*;

    #[test]
    fn a_task_snapshot_is_a_ceiling_even_for_a_current_administrator() {
        let snapshot = json!({"policy_version":tools::POLICY_VERSION,"action_grants":["app:a:display","app:a:create_form"]});
        let current = HashSet::from(["*".to_owned()]);
        let effective = frozen_grants(&current, &snapshot).unwrap();
        assert!(has(&effective, "app:a:create_form"));
        assert!(!has(&effective, "app:a:delete_form"));
        assert!(!has(&effective, "app:b:display"));
    }

    #[test]
    fn current_revocation_intersects_the_saved_action_scope() {
        let snapshot = json!({"policy_version":tools::POLICY_VERSION,"action_grants":["app:a:display","app:a:create_form","app:a:delete_form"]});
        let current = HashSet::from(["app:a:display".to_owned(), "app:a:create_form".to_owned()]);
        let effective = frozen_grants(&current, &snapshot).unwrap();
        assert!(has(&effective, "app:a:create_form"));
        assert!(!has(&effective, "app:a:delete_form"));
    }

    #[test]
    fn a_policy_version_mismatch_fails_closed() {
        let snapshot = json!({"policy_version":0,"action_grants":["*"]});
        assert!(frozen_grants(&HashSet::from(["*".to_owned()]), &snapshot).is_err());
    }

    #[test]
    fn workflow_graph_redacts_secret_values_recursively() {
        let mut output = json!({"nodes":[{"data":{"config":{"apiKey":"hidden","name":"visible"}}}],"password":"hidden"});
        sanitize_automation_value(&mut output);
        assert_eq!(output["nodes"][0]["data"]["config"]["apiKey"], "[REDACTED]");
        assert_eq!(output["nodes"][0]["data"]["config"]["name"], "visible");
        assert_eq!(output["password"], "[REDACTED]");
    }
}
