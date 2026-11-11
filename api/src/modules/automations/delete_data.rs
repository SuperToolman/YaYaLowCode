//! Delete by record rules or persistent identities from an upstream node.
use super::*;

/// Reject references to record outputs explicitly deleted by an earlier node.
pub(super) fn validate_consumed_sources(nodes: &Value, edges: &Value) -> Result<(), AppError> {
    for node in nodes.as_array().into_iter().flatten() {
        let Some(current) = node["id"].as_str() else {
            continue;
        };
        let mut upstream = HashSet::from([current]);
        let mut pending = vec![current];
        while let Some(target) = pending.pop() {
            for edge in edges.as_array().into_iter().flatten() {
                if edge["target"].as_str() == Some(target) {
                    if let Some(source) = edge["source"].as_str() {
                        if upstream.insert(source) {
                            pending.push(source);
                        }
                    }
                }
            }
        }
        let deleted = nodes
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| {
                item["id"]
                    .as_str()
                    .is_some_and(|id| id != current && upstream.contains(id))
            })
            .filter(|item| {
                item.pointer("/data/kind").and_then(Value::as_str) == Some("delete-data")
                    && item
                        .pointer("/data/config/deleteMode")
                        .and_then(Value::as_str)
                        == Some("data-node")
            })
            .filter_map(|item| {
                item.pointer("/data/config/sourceNodeId")
                    .and_then(Value::as_str)
            })
            .collect::<HashSet<_>>();
        let config = &node["data"]["config"];
        let kind = node
            .pointer("/data/kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut sources = Vec::new();
        match kind {
            "get-one" | "get-many" => match config["sourceMode"].as_str() {
                Some("data-node") => sources.extend(config["dataNodeId"].as_str()),
                Some("trigger") => sources.push("trigger-1"),
                _ => {}
            },
            "add-data" => {
                if config["targetMode"].as_str() == Some("subtable") {
                    sources.extend(config["parentDataNodeId"].as_str());
                }
                if config["recordMode"].as_str() == Some("multiple") {
                    sources.extend(config["multipleSourceNodeId"].as_str());
                }
            }
            "update-data" if config["updateMode"].as_str() == Some("data-node") => {
                sources.extend(config["sourceNodeId"].as_str())
            }
            "delete-data" if config["deleteMode"].as_str() == Some("data-node") => {
                sources.extend(config["sourceNodeId"].as_str())
            }
            _ => {}
        }
        if sources.iter().any(|source| deleted.contains(source)) {
            return Err(AppError::BadRequest(format!(
                "节点 {current} 的数据来源已被上游删除节点删除，请重新选择"
            )));
        }
    }
    Ok(())
}

pub(super) fn validate_config(config: &Value) -> Result<(), AppError> {
    if config.get("matchRule").is_some_and(|value| {
        !value.is_null() && value.as_str().is_none_or(|s| !s.trim().is_empty())
    }) {
        return Err(AppError::BadRequest(
            "旧删除表达式需要重新配置为条件规则".into(),
        ));
    }
    match config
        .get("deleteMode")
        .and_then(Value::as_str)
        .unwrap_or("form")
    {
        "data-node" => {
            if config
                .get("sourceNodeId")
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                return Err(AppError::BadRequest("请选择删除来源节点".into()));
            }
        }
        "form" => match config
            .get("filterMode")
            .and_then(Value::as_str)
            .unwrap_or("rules")
        {
            "all" => {}
            "rules" => get_data::validate_query_rules(config.get("rules"), None).map_err(|_| {
                AppError::BadRequest("请配置有效的删除条件规则，或明确选择全部记录".into())
            })?,
            _ => return Err(AppError::BadRequest("删除筛选方式无效".into())),
        },
        _ => return Err(AppError::BadRequest("删除方式无效".into())),
    }
    Ok(())
}

pub(super) fn target_form(
    nodes: &Value,
    edges: &Value,
    current: &str,
    config: &Value,
    trigger_form: Option<&str>,
) -> Result<String, AppError> {
    if config.get("deleteMode").and_then(Value::as_str) != Some("data-node") {
        return config
            .get("targetFormUuid")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .ok_or_else(|| AppError::BadRequest("请选择删除目标表单".into()));
    }
    let source = config
        .get("sourceNodeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut visited = HashSet::from([current]);
    let mut pending = vec![current];
    while let Some(target) = pending.pop() {
        for edge in edges.as_array().into_iter().flatten() {
            if edge.get("target").and_then(Value::as_str) == Some(target) {
                if let Some(id) = edge.get("source").and_then(Value::as_str) {
                    if visited.insert(id) {
                        pending.push(id);
                    }
                }
            }
        }
    }
    if source == current || !visited.contains(source) {
        return Err(AppError::BadRequest("删除来源只能选择上游记录节点".into()));
    }
    let source_node = nodes
        .as_array()
        .into_iter()
        .flatten()
        .find(|node| node["id"].as_str() == Some(source));
    let allowed =
        source_node.is_some_and(
            |node| match node.pointer("/data/kind").and_then(Value::as_str) {
                Some("trigger" | "get-one" | "get-many") => true,
                Some("add-data") => {
                    node.pointer("/data/config/targetMode")
                        .and_then(Value::as_str)
                        != Some("subtable")
                }
                _ => false,
            },
        );
    if !allowed {
        return Err(AppError::BadRequest("删除来源节点没有主表记录输出".into()));
    }
    get_data::source_form(nodes, edges, source, trigger_form)
}

pub(super) async fn validate_nodes<C: ConnectionTrait>(
    db: &C,
    nodes: &Value,
    edges: &Value,
    trigger_form: Option<&str>,
) -> Result<(), AppError> {
    for node in
        nodes.as_array().into_iter().flatten().filter(|node| {
            node.pointer("/data/kind").and_then(Value::as_str) == Some("delete-data")
        })
    {
        let config = node.pointer("/data/config").unwrap_or(&Value::Null);
        validate_config(config)?;
        let form_uuid = target_form(
            nodes,
            edges,
            node["id"].as_str().unwrap_or_default(),
            config,
            trigger_form,
        )?;
        let form = forms::find_form_definition(db, &form_uuid).await?;
        if !matches!(form.form_type.as_str(), "normal" | "workflow") {
            return Err(AppError::BadRequest("删除目标必须为普通或流程表单".into()));
        }
        if config.get("deleteMode").and_then(Value::as_str) != Some("data-node")
            && config.get("filterMode").and_then(Value::as_str) != Some("all")
        {
            let schema = forms::load_schema_version_for_connection(
                db,
                &form_uuid,
                form.current_schema_version,
            )
            .await?;
            let mut fields = schema.schema_json["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|field| field["id"].as_str().map(str::to_string))
                .collect::<HashSet<_>>();
            fields.extend(get_data::automation_system_field_ids());
            get_data::validate_query_rules(config.get("rules"), Some(&fields))
                .map_err(|_| AppError::BadRequest("删除条件规则不完整或目标字段失效".into()))?;
        }
    }
    Ok(())
}

pub(super) fn select_records(
    records: Vec<StoredFormRecord>,
    config: &Value,
    context: &AutomationExecutionContext,
) -> Result<Vec<StoredFormRecord>, AppError> {
    validate_config(config)?;
    if config.get("deleteMode").and_then(Value::as_str) == Some("data-node") {
        let source = config
            .get("sourceNodeId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let candidates = get_data::node_candidates(context.outputs.get(source))?;
        let ids = candidates
            .iter()
            .map(|record| {
                record
                    .get("__automationRecordUuid")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| AppError::BadRequest("删除来源记录缺少持久化记录 ID".into()))
            })
            .collect::<Result<HashSet<_>, _>>()?;
        return Ok(records
            .into_iter()
            .filter(|record| ids.contains(record.record_uuid.as_str()))
            .collect());
    }
    Ok(
        if config.get("filterMode").and_then(Value::as_str) == Some("all") {
            records
        } else {
            filter_records_by_rules(records, config.get("rules"))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumed_sources_exclude_deleted_outputs_but_allow_delete_itself() {
        let mut nodes = json!([
            {"id":"source","data":{"kind":"get-many"}},
            {"id":"delete","data":{"kind":"delete-data","config":{"deleteMode":"data-node","sourceNodeId":"source"}}},
            {"id":"next","data":{"kind":"get-one","config":{"sourceMode":"data-node","dataNodeId":"source"}}}
        ]);
        let edges =
            json!([{"source":"source","target":"delete"},{"source":"delete","target":"next"}]);
        assert!(validate_consumed_sources(&nodes, &edges).is_err());
        assert!(validate_consumed_sources(&json!([nodes[0], nodes[1]]), &edges).is_ok());
        for (kind, config) in [
            (
                "add-data",
                json!({"targetMode":"subtable","parentDataNodeId":"source"}),
            ),
            (
                "add-data",
                json!({"recordMode":"multiple","multipleSourceNodeId":"source"}),
            ),
            (
                "update-data",
                json!({"updateMode":"data-node","sourceNodeId":"source"}),
            ),
            (
                "delete-data",
                json!({"deleteMode":"data-node","sourceNodeId":"source"}),
            ),
        ] {
            nodes[2]["data"] = json!({"kind":kind,"config":config});
            assert!(validate_consumed_sources(&nodes, &edges).is_err());
        }
        assert!(
            validate_consumed_sources(&nodes, &json!([{"source":"source","target":"next"}]))
                .is_ok()
        );
        nodes[1]["data"]["config"]["deleteMode"] = json!("form");
        assert!(validate_consumed_sources(&nodes, &edges).is_ok());
    }

    fn record(id: &str, status: &str) -> StoredFormRecord {
        StoredFormRecord {
            id: Uuid::new_v4(),
            record_uuid: id.into(),
            form_uuid: "customers".into(),
            schema_version: 1,
            record_data: json!({"status":status}),
            created_by: "test".into(),
            updated_by: "test".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
    fn context(output: Value) -> AutomationExecutionContext {
        AutomationExecutionContext {
            outputs: HashMap::from([("source".into(), output)]),
            operator: "test".into(),
            run_id: None,
            branch_id: None,
        }
    }
    #[test]
    fn delete_rules_and_legacy_configs_fail_closed() {
        assert!(validate_config(&json!({})).is_err());
        assert!(
            validate_config(&json!({"matchRule":"status == 'old'","filterMode":"all"})).is_err()
        );
        assert!(validate_config(&json!({"filterMode":"rules","rules":[]})).is_err());
        let config = json!({"filterMode":"rules","rules":[{"id":"r","fieldKey":"status","operator":"eq","rawValue":"old"}]});
        let normalized = normalize_automation_node_config("delete-data", config.clone()).unwrap();
        assert_eq!(normalized["rules"][0]["fieldKey"], "status");
        let matched = select_records(
            vec![record("one", "old"), record("two", "new")],
            &config,
            &context(Value::Null),
        )
        .unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].record_uuid, "one");
        assert_eq!(
            select_records(
                vec![record("one", "old"), record("two", "new")],
                &json!({"filterMode":"all"}),
                &context(Value::Null)
            )
            .unwrap()
            .len(),
            2
        );
    }
    #[test]
    fn node_delete_mode_and_trigger_source_survive_config_normalization() {
        let nodes = json!([
            {"id":"trigger-1","type":"workflow","position":{"x":120,"y":80},"data":{"kind":"trigger","config":{}}},
            {"id":"delete","type":"workflow","position":{"x":120,"y":260},"data":{"kind":"delete-data","config":{
                "deleteMode":"data-node",
                "sourceNodeId":"trigger-1",
                "targetFormUuid":"customers",
                "filterMode":"rules",
                "rules":[]
            }}}
        ]);
        let normalized = super::super::graph::normalize_automation_nodes(nodes).unwrap();
        assert_eq!(normalized[1]["data"]["config"]["deleteMode"], "data-node");
        assert_eq!(normalized[1]["data"]["config"]["sourceNodeId"], "trigger-1");
        assert_eq!(
            normalized[1]["data"]["config"]["targetFormUuid"],
            "customers"
        );
    }
    #[test]
    fn node_delete_uses_persistent_ids_and_never_falls_back_to_all() {
        let config = json!({"deleteMode":"data-node","sourceNodeId":"source"});
        for output in [
            json!({"__automationRecordUuid":"two"}),
            json!([{"__automationRecordUuid":"two"},{"__automationRecordUuid":"two"}]),
        ] {
            let matched = select_records(
                vec![record("one", "old"), record("two", "new")],
                &config,
                &context(output),
            )
            .unwrap();
            assert_eq!(matched.len(), 1);
            assert_eq!(matched[0].record_uuid, "two");
        }
        for output in [Value::Null, json!([])] {
            assert!(
                select_records(vec![record("one", "old")], &config, &context(output))
                    .unwrap()
                    .is_empty()
            );
        }
        assert!(
            select_records(
                vec![record("one", "old")],
                &config,
                &context(json!({"id":"one"}))
            )
            .is_err()
        );
    }
    #[test]
    fn node_delete_resolves_actual_source_form_and_requires_upstream() {
        let nodes = json!([
            {"id":"source","data":{"kind":"add-data","config":{"targetFormUuid":"customers"}}},
            {"id":"delete","data":{"kind":"delete-data"}}
        ]);
        let config = json!({"deleteMode":"data-node","sourceNodeId":"source","targetFormUuid":"stale-cache"});
        let edges = json!([{"source":"source","target":"delete"}]);
        assert_eq!(
            target_form(&nodes, &edges, "delete", &config, None).unwrap(),
            "customers"
        );
        assert!(target_form(&nodes, &json!([]), "delete", &config, None).is_err());
        assert!(target_form(&nodes, &edges, "source", &config, None).is_err());
        let mut invalid = nodes.clone();
        invalid[0]["data"]["config"]["targetMode"] = json!("subtable");
        assert!(target_form(&invalid, &edges, "delete", &config, None).is_err());
    }
}
