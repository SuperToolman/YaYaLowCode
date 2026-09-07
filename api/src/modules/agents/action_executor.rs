use super::*;

pub(crate) async fn execute_action(
    state: AppState,
    headers: HeaderMap,
    operator: String,
    access: PlatformActionAccess,
    action: agent_transaction_entity::Model,
) -> Result<Value, AppError> {
    let result = match action.action_type.as_str() {
        "create_automation_draft" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_manage_automations(app_id) {
                return Err(AppError::Forbidden(
                    "automation permission denied".to_string(),
                ));
            }
            let definition = action
                .payload_json
                .get("definition")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let nodes = action
                .payload_json
                .get("nodes")
                .cloned()
                .or_else(|| definition.get("nodes").cloned())
                .unwrap_or_else(|| json!([]));
            let edges = action
                .payload_json
                .get("edges")
                .cloned()
                .or_else(|| definition.get("edges").cloned())
                .unwrap_or_else(|| json!([]));
            let created = crate::modules::automations::create_automation_definition(
                &state,
                app_id,
                Some(
                    crate::modules::automations::dto::CreateAutomationFlowRequest {
                        name: action
                            .payload_json
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        description: action
                            .payload_json
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        trigger_form_uuid: action
                            .payload_json
                            .get("triggerFormUuid")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        trigger_event: action
                            .payload_json
                            .get("triggerEvent")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        trigger_events: None,
                        operator: Some(operator.clone()),
                    },
                ),
            )
            .await?;
            let updated = crate::modules::automations::update_automation_definition(
                &state,
                &created.flow_uuid,
                crate::modules::automations::dto::UpdateAutomationFlowRequest {
                    name: None,
                    description: None,
                    status: None,
                    trigger_form_uuid: None,
                    trigger_event: None,
                    trigger_events: None,
                    trigger_config: None,
                    nodes: Some(nodes),
                    edges: Some(edges),
                    change_summary: Some("Agent confirmed automation draft".to_string()),
                    operator: Some(operator.clone()),
                },
            )
            .await?;
            json!({"id": updated.id, "name": updated.name, "status": updated.status, "flowType": updated.flow_type})
        }
        "delete_automation" => {
            let automation_id = action
                .payload_json
                .get("automationId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let flow = AutomationFlowEntity::find()
                .filter(automation_flow_entity::Column::FlowUuid.eq(automation_id))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("automation flow not found".to_string()))?;
            if flow.flow_type == "process" {
                return Err(AppError::BadRequest(
                    "process workflow automation cannot be deleted by Agent".to_string(),
                ));
            }
            access
                .require_app_access(&flow.app_route_app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_manage_automations(&flow.app_route_app_id) {
                return Err(AppError::Forbidden(
                    "automation permission denied".to_string(),
                ));
            }
            let name = flow.name.clone();
            crate::modules::automations::delete_automation_definition(&state, automation_id)
                .await?;
            json!({"id": automation_id, "name": name, "deleted": true})
        }
        "create_form" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let name = action
                .payload_json
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_create_form(app_id) {
                return Err(AppError::Forbidden(
                    "form creation permission denied".to_string(),
                ));
            }
            let form_type = action
                .payload_json
                .get("formType")
                .and_then(Value::as_str)
                .unwrap_or("normal");
            if !matches!(form_type, "normal" | "workflow" | "defined") {
                return Err(AppError::BadRequest("invalid form type".to_string()));
            }
            let parent_group_id = action
                .payload_json
                .get("parentGroupId")
                .and_then(Value::as_str);
            let form = crate::modules::forms::create_form_definition(
                &state.db,
                app_id,
                Some(form_type),
                parent_group_id,
                Some(name),
            )
            .await?;
            json!({"id": form.form_uuid, "appId": form.app_route_app_id, "name": form.name, "formType": form.form_type, "parentGroupId": parent_group_id})
        }
        "create_app" => {
            if !access.can_manage_apps() {
                return Err(AppError::Forbidden(
                    "application management permission denied".to_string(),
                ));
            }
            let name = action
                .payload_json
                .get("name")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let description = action
                .payload_json
                .get("description")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let icon = action
                .payload_json
                .get("icon")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let owner = authorization::current_user(&headers, &state).await?;
            let app = crate::modules::apps::create_app_definition(
                &state.db,
                &owner,
                crate::modules::apps::CreateAppRequest {
                    name,
                    description,
                    icon,
                },
            )
            .await?;
            json!({"id": app.id, "name": app.name})
        }
        "update_app" => {
            if !access.can_manage_apps() {
                return Err(AppError::Forbidden(
                    "application management permission denied".to_string(),
                ));
            }
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            let payload = crate::modules::apps::UpdateAppRequest {
                name: action
                    .payload_json
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                description: action
                    .payload_json
                    .get("description")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                icon: action
                    .payload_json
                    .get("icon")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            };
            let owner = authorization::current_user(&headers, &state).await?;
            let grants = authorization::grants(&headers, &state).await?;
            let app = crate::modules::apps::update_app_definition(
                &state.db, app_id, payload, &owner, &grants,
            )
            .await?;
            json!({"id": app.id, "name": app.name})
        }
        "delete_app" => {
            if !access.can_manage_apps() {
                return Err(AppError::Forbidden(
                    "application management permission denied".to_string(),
                ));
            }
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            let owner = authorization::current_user(&headers, &state).await?;
            let grants = authorization::grants(&headers, &state).await?;
            crate::modules::apps::delete_app_definition(&state, app_id, &owner, &grants).await?;
            json!({"appId": app_id, "deleted": true})
        }
        "move_form_to_group" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let form_uuid = action
                .payload_json
                .get("formUuid")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let parent_group_id = action
                .payload_json
                .get("parentGroupId")
                .and_then(Value::as_str);
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_edit_form(app_id) {
                return Err(AppError::Forbidden(
                    "form edit permission denied".to_string(),
                ));
            }
            let form = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
                .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
            crate::modules::navigation::move_form_navigation_to_group(
                &state.db,
                app_id,
                form_uuid,
                parent_group_id,
            )
            .await?;
            json!({"formUuid": form.form_uuid, "name": form.name, "parentGroupId": parent_group_id})
        }
        "create_navigation_group" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let title = action
                .payload_json
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let parent_id = action
                .payload_json
                .get("parentGroupId")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_manage_navigation_groups(app_id) {
                return Err(AppError::Forbidden(
                    "navigation group permission denied".to_string(),
                ));
            }
            let group = crate::modules::navigation::create_navigation_group_definition(
                &state.db,
                app_id,
                crate::modules::navigation::CreateNavigationGroupRequest {
                    title: title.to_string(),
                    parent_id,
                },
            )
            .await?;
            json!({"id": group.id, "name": group.title, "parentId": group.parent_id})
        }
        "delete_navigation_group" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let group_id = action
                .payload_json
                .get("groupId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_manage_navigation_groups(app_id) {
                return Err(AppError::Forbidden(
                    "navigation group permission denied".to_string(),
                ));
            }
            let result = crate::modules::navigation::delete_navigation_group_definition(
                &state.db, app_id, group_id,
            )
            .await?;
            json!({"id": result.id, "name": result.title, "deleted": true, "reparentedItems": result.reparented_items})
        }
        "create_detail_form" => {
            let source_form_uuid = action
                .payload_json
                .get("sourceFormUuid")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let subform_field_id = action
                .payload_json
                .get("subformFieldId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let definition = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::FormUuid.eq(source_form_uuid))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("source form not found".to_string()))?;
            access
                .require_app_access(&definition.app_route_app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_create_form(&definition.app_route_app_id) {
                return Err(AppError::Forbidden(
                    "form creation permission denied".to_string(),
                ));
            }
            let detail = crate::modules::forms::create_detail_form_definition(
                &state,
                source_form_uuid,
                CreateDetailFormRequest {
                    subform_field_id: subform_field_id.to_string(),
                    title: action
                        .payload_json
                        .get("title")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    primary_display_field_id: action
                        .payload_json
                        .get("primaryDisplayFieldId")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    secondary_display_field_id: action
                        .payload_json
                        .get("secondaryDisplayFieldId")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                },
            )
            .await?;
            json!({"id": detail.detail_form_uuid, "sourceFormUuid": detail.source_form_uuid, "subformFieldId": detail.subform_field_id, "title": detail.title})
        }
        "save_form_schema" => {
            let form_uuid = action
                .payload_json
                .get("formUuid")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let schema = action
                .payload_json
                .get("schema")
                .cloned()
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let definition = FormDefinitionEntity::find()
                .filter(form_definition_entity::Column::FormUuid.eq(form_uuid))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("form not found".to_string()))?;
            access
                .require_app_access(&definition.app_route_app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_edit_form(&definition.app_route_app_id) {
                return Err(AppError::Forbidden(
                    "form edit permission denied".to_string(),
                ));
            }
            let base_version = action
                .payload_json
                .get("baseVersion")
                .and_then(Value::as_i64)
                .and_then(|value| i32::try_from(value).ok());
            let (_, saved) = crate::modules::forms::save_form_schema_definition(
                &state,
                form_uuid,
                SaveSchemaRequest {
                    schema,
                    change_log: action
                        .payload_json
                        .get("changeLog")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| Some("Agent saved schema".to_string())),
                    base_version,
                },
            )
            .await?;
            json!({"formUuid": saved.form_uuid, "version": saved.version})
        }
        "delete_form" => {
            let app_id = action
                .payload_json
                .get("appId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let form_uuid = action
                .payload_json
                .get("formUuid")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("invalid transaction".to_string()))?;
            let name = action
                .payload_json
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("表单");
            access
                .require_app_access(app_id)
                .map_err(AppError::Forbidden)?;
            if !access.can_delete_form(form_uuid) {
                return Err(AppError::Forbidden(
                    "form delete permission denied".to_string(),
                ));
            }
            crate::modules::forms::delete_form_definition(&state, form_uuid).await?;
            json!({"formUuid": form_uuid, "name": name, "deleted": true})
        }
        _ => return Err(AppError::BadRequest("unsupported transaction".to_string())),
    };
    Ok(result)
}
