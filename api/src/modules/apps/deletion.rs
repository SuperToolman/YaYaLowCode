//! Application-owned data must be removed in one transaction, children before parents.

use crate::platform::form_storage::delete_storage_definition;
use crate::platform::prelude::*;
use sea_orm::{DbBackend, Statement};

pub(crate) async fn delete_app_contents<C: ConnectionTrait>(
    db: &C,
    app_id: &str,
) -> Result<(), AppError> {
    db.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT id FROM apps WHERE route_app_id = $1 FOR UPDATE",
        vec![app_id.into()],
    ))
    .await?;
    let forms = FormDefinitionEntity::find()
        .filter(form_definition_entity::Column::AppRouteAppId.eq(app_id))
        .all(db)
        .await?;

    // Keep the form and flow definitions until all scoped child queries have finished.
    // Runs reference instances; instances RESTRICT deleting their process flow.
    // The execution engine's tokens, snapshots and audits cascade from each run.
    let flows = "SELECT id FROM automation_flows WHERE app_route_app_id = $1";
    let forms_sql = "SELECT form_uuid FROM form_definitions WHERE app_route_app_id = $1";
    let instances = format!(
        "SELECT id FROM workflow_instances WHERE process_flow_id IN ({flows}) OR form_uuid IN ({forms_sql})"
    );
    let runs = format!(
        "SELECT id FROM automation_flow_runs WHERE flow_id IN ({flows}) OR workflow_instance_id IN ({instances})"
    );
    for sql in [
        format!("SELECT id FROM automation_flows WHERE id IN ({flows}) FOR UPDATE"),
        // Match the engine's instance -> execution -> run locking order, so a
        // currently executing node finishes before its data is removed.
        format!("SELECT id FROM workflow_instances WHERE id IN ({instances}) FOR UPDATE"),
        format!("SELECT run_id FROM automation_execution_runs WHERE run_id IN ({runs}) FOR UPDATE"),
        format!("SELECT id FROM automation_flow_runs WHERE id IN ({runs}) FOR UPDATE"),
    ] {
        db.query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            vec![app_id.into()],
        ))
        .await?;
    }
    for sql in [
        format!("DELETE FROM automation_flow_run_nodes WHERE run_id IN ({runs})"),
        format!("DELETE FROM automation_flow_runs WHERE id IN ({runs})"),
        format!("DELETE FROM workflow_instances WHERE id IN ({instances})"),
        format!("DELETE FROM automation_flow_versions WHERE flow_id IN ({flows})"),
        format!("DELETE FROM automation_edges WHERE flow_id IN ({flows})"),
        format!("DELETE FROM automation_nodes WHERE flow_id IN ({flows})"),
        "DELETE FROM app_custom_buttons WHERE app_route_app_id = $1".into(),
        "DELETE FROM automation_flows WHERE app_route_app_id = $1".into(),
        format!("DELETE FROM workflow_comments WHERE form_uuid IN ({forms_sql})"),
        format!("DELETE FROM form_recycle_bin_entries WHERE form_uuid IN ({forms_sql}) OR detail_source_form_uuid IN ({forms_sql})"),
        format!("DELETE FROM form_detail_definitions WHERE detail_form_uuid IN ({forms_sql}) OR source_form_uuid IN ({forms_sql})"),
        format!("DELETE FROM form_views WHERE form_uuid IN ({forms_sql})"),
        format!("DELETE FROM form_schemas WHERE form_uuid IN ({forms_sql})"),
        // Permission strings are scoped by an exact prefix, not LIKE (IDs contain '_').
        "DELETE FROM iam_role_permissions WHERE starts_with(permission, 'app:' || $1 || ':') OR EXISTS (SELECT 1 FROM form_definitions f WHERE f.app_route_app_id = $1 AND starts_with(permission, 'form:' || f.form_uuid || ':'))".into(),
        // Conversations belong to their users. Remove the invalid application association.
        "UPDATE agent_sessions SET app_route_app_id = NULL WHERE app_route_app_id = $1".into(),
        "DELETE FROM app_navigation_items WHERE app_route_app_id = $1".into(),
    ] {
        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres, sql, vec![app_id.into()],
        )).await?;
    }
    // Dropping storage removes main and child records atomically, and also works for
    // logical detail forms and forms that have never had a physical storage plan.
    for form in &forms {
        delete_storage_definition(db, &form.form_uuid).await?;
    }
    for sql in [
        "DELETE FROM form_definitions WHERE app_route_app_id = $1",
        "DELETE FROM market_installation_resources WHERE installation_id IN (SELECT installation_id FROM market_installations WHERE local_app_id = $1)",
        "DELETE FROM market_installation_versions WHERE installation_id IN (SELECT installation_id FROM market_installations WHERE local_app_id = $1)",
        "DELETE FROM market_installation_events WHERE installation_id IN (SELECT installation_id FROM market_installations WHERE local_app_id = $1)",
        "DELETE FROM market_installations WHERE local_app_id = $1",
        "DELETE FROM apps WHERE route_app_id = $1",
    ] {
        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            vec![app_id.into()],
        ))
        .await?;
    }
    Ok(())
}
