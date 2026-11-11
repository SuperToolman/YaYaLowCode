//! Read-only design validation; never dispatches an automation node.
use super::*;

pub(crate) async fn validate_trigger_design<C: ConnectionTrait>(
    db: &C,
    app: &str,
    nodes: &Value,
    edges: &Value,
    source: Option<&str>,
    events: &Value,
) -> Result<(), AppError> {
    if serde_json::to_vec(&json!({"nodes":nodes,"edges":edges}))
        .map_or(true, |v| v.len() > 1024 * 1024)
        || !nodes
            .as_array()
            .is_some_and(|a| !a.is_empty() && a.len() <= 200)
        || !edges.as_array().is_some_and(|a| a.len() <= 1000)
    {
        return Err(AppError::BadRequest(
            "automation design exceeds limits or has invalid node/edge arrays".into(),
        ));
    }
    crate::modules::development_contracts::ensure(
        crate::modules::development_contracts::node_issues(nodes),
    )?;
    let events: Vec<String> = serde_json::from_value(events.clone())
        .map_err(|_| AppError::BadRequest("triggerEvents must be an array of strings".into()))?;
    let events = normalize_automation_trigger_events(events)?;
    if events.iter().any(|e| e == "form_submit") {
        return Err(AppError::BadRequest(
            "process flows are managed by workflow forms".into(),
        ));
    }
    if events == ["button_click"] && source.is_none() {
        return Err(AppError::BadRequest(
            "button trigger requires a source form".into(),
        ));
    }
    if let Some(source) = source {
        ensure_form_belongs_to_app(db, app, source).await?;
    }
    let trigger = with_automation_trigger_events(json!({}), &events);
    graph::validate_current_protocol(nodes, &trigger)?;
    let normalized = graph::normalize_automation_nodes(nodes.clone())?;
    let edges = graph::normalize_automation_edges(edges.clone())?;
    graph::validate_automation_graph(&normalized, &edges)?;
    validate_flow_node_kinds(&normalized, "trigger")?;
    ensure_automation_node_forms_belong_to_app(db, app, &normalized).await?;
    get_data::validate_get_nodes(db, &normalized, &edges, source).await?;
    Ok(())
}
