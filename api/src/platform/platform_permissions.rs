//! Shared platform RBAC catalog, compatibility and route policy.
use super::error::AppError;
use axum::http::Method;
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};

#[derive(Deserialize)]
struct Catalog {
    groups: Vec<Group>,
    legacy: std::collections::HashMap<String, Vec<String>>,
}
#[derive(Deserialize)]
struct Group {
    items: Vec<Item>,
}
#[derive(Deserialize)]
struct Item {
    key: String,
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("platform-permissions.json"))
            .expect("valid platform permission catalog")
    })
}
pub(crate) fn normalize(grants: impl IntoIterator<Item = String>) -> HashSet<String> {
    grants
        .into_iter()
        .flat_map(|grant| {
            catalog()
                .legacy
                .get(&grant)
                .cloned()
                .unwrap_or_else(|| vec![grant])
        })
        .collect()
}
pub(crate) fn effective(grants: impl IntoIterator<Item = String>) -> HashSet<String> {
    let mut result = normalize(grants);
    let views = result
        .iter()
        .filter_map(|g| g.strip_suffix(".manage").map(|p| format!("{p}.view")))
        .collect::<Vec<_>>();
    result.extend(views.into_iter().filter(|view| {
        catalog()
            .groups
            .iter()
            .flat_map(|g| &g.items)
            .any(|i| &i.key == view)
    }));
    result
}
pub(crate) fn can_delegate(actor: &HashSet<String>, target: &HashSet<String>) -> bool {
    actor.contains("*") || (!target.contains("*") && target.iter().all(|g| actor.contains(g)))
}
pub(crate) fn validate_grants(grants: &HashSet<String>) -> Result<(), AppError> {
    for grant in grants {
        let platform = catalog()
            .groups
            .iter()
            .flat_map(|g| &g.items)
            .any(|i| &i.key == grant);
        let parts = grant.split(':').collect::<Vec<_>>();
        let resource = match parts.as_slice() {
            ["agent", id, "use"] => !id.is_empty(),
            ["app", id, action] => {
                !id.is_empty()
                    && [
                        "display",
                        "edit", // Legacy application navigation grants remain readable and editable.
                        "edit_info",
                        "create_group",
                        "automation",
                        "settings",
                        "publish",
                        "create_form",
                        "edit_form",
                        "delete_form",
                        "view_development",
                    ]
                    .contains(action)
            }
            ["form", id, action] => {
                !id.is_empty()
                    && [
                        "display",
                        "create",
                        "edit",
                        "delete",
                        "change_log",
                        "comment",
                        "import",
                        "export",
                        "bulk_edit",
                        "bulk_delete",
                        "batch_print",
                        "create_view",
                    ]
                    .contains(action)
            }
            ["form", id, "data_scope", value] => {
                !id.is_empty()
                    && ["all", "self", "department", "sub_department", "none"].contains(value)
            }
            ["form", id, "view_scope", value] => {
                !id.is_empty() && ["all", "specified"].contains(value)
            }
            ["form", id, "view", view] => !id.is_empty() && !view.is_empty(),
            _ => false,
        };
        if !platform && !resource {
            return Err(AppError::BadRequest(format!(
                "unsupported permission: {grant}"
            )));
        }
    }
    Ok(())
}

/// Known platform routes. An empty slice means authenticated access only.
pub(crate) fn route_permissions(method: &Method, path: &str) -> Option<Vec<&'static str>> {
    let read = *method == Method::GET || *method == Method::HEAD;
    let pair = |view, manage| Some(vec![if read { view } else { manage }]);
    if path == "/api/settings/valkey/status" || path == "/api/settings/license" && read {
        return Some(vec![]);
    }
    if path.starts_with("/api/settings/license") {
        return Some(vec!["settings.license.manage"]);
    }
    if path == "/api/settings/database"
        || path.starts_with("/api/settings/database/")
        || path == "/api/settings/valkey"
        || path.starts_with("/api/settings/valkey/")
    {
        return pair("settings.database.view", "settings.database.manage");
    }
    if path == "/api/settings/logs" {
        return pair("settings.logs.view", "settings.logs.manage");
    }
    if path == "/api/settings/recycle-bin"
        || path == "/api/recycle-bin"
        || path.starts_with("/api/recycle-bin/")
    {
        return pair("settings.recycle-bin.view", "settings.recycle-bin.manage");
    }
    if path == "/api/settings/notifications" {
        return pair(
            "settings.notifications.view",
            "settings.notifications.manage",
        );
    }
    if path == "/api/settings/communication" || path.starts_with("/api/settings/communication/") {
        return pair(
            "settings.communication.view",
            "settings.communication.manage",
        );
    }
    if read && path.starts_with("/api/settings/ai-employee-market/") && path.ends_with("/avatar") {
        return Some(vec![]);
    }
    if path == "/api/settings/ai-employee-market" && read {
        return Some(vec![
            "settings.ai-employees.view",
            "settings.permissions.view",
        ]);
    }
    if path == "/api/settings/ai-employee-market"
        || path.starts_with("/api/settings/ai-employee-market/")
    {
        return pair("settings.ai-employees.view", "settings.ai-employees.manage");
    }
    if path == "/api/settings/model-routes"
        || path.starts_with("/api/settings/model-routes/")
        || path.starts_with("/api/agent/providers")
        || path.starts_with("/api/agent/plugins")
    {
        return pair("settings.models.view", "settings.models.manage");
    }
    if path == "/api/settings/identity-source" || path.starts_with("/api/settings/identity-source/")
    {
        return pair(
            "settings.identity-source.view",
            "settings.identity-source.manage",
        );
    }
    if path == "/api/identity/organization-units" {
        return if read {
            Some(vec!["settings.identity-source.view", "settings.users.view"])
        } else {
            Some(vec!["settings.identity-source.manage"])
        };
    }
    if path == "/api/identity/users" || path.starts_with("/api/identity/users/") {
        return pair("settings.users.view", "settings.users.manage");
    }
    if path == "/api/identity/roles" && read {
        return Some(vec![
            "settings.roles.view",
            "settings.users.view",
            "settings.permissions.view",
        ]);
    }
    if path == "/api/identity/roles" || path.starts_with("/api/identity/roles/") {
        return pair("settings.roles.view", "settings.roles.manage");
    }
    if path.starts_with("/api/settings/permissions/") {
        return pair("settings.permissions.view", "settings.permissions.manage");
    }
    if path == "/api/agent/archived-sessions" {
        return Some(vec!["settings.agent-archive.view"]);
    }
    if path.ends_with("/restore") || path.ends_with("/purge") {
        if path.starts_with("/api/agent/sessions/") {
            return Some(vec!["settings.agent-archive.manage"]);
        }
    }
    if path == "/api/agent/runtime-identity" || path == "/api/agent/runtime-model-route" {
        return Some(vec![]);
    }
    if path == "/api/agent/runtime-employees" {
        return Some(vec!["agent.window", "settings.agent-archive.view"]);
    }
    if path.starts_with("/api/agent/sessions")
        || path == "/api/agent/runtime/reconcile-session"
        || path == "/api/agent/workbench/sessions"
        || path == "/api/agent/system-ai/status"
        || path == "/api/agent/available-agents"
    {
        return Some(vec!["agent.window"]);
    }
    if path.starts_with("/api/apps/") && path.ends_with("/market-submission") {
        return pair("market.apps.view", "market.apps.manage");
    }
    if path.starts_with("/api/market/") {
        return pair("market.apps.view", "market.apps.manage");
    }
    if path.starts_with("/api/communication/") {
        return Some(vec![]);
    }
    if path.starts_with("/api/agent/") || path == "/api/agents" || path.starts_with("/api/agents/")
    {
        return pair("settings.models.view", "settings.models.manage");
    }
    // Fail closed for future settings endpoints until their policy is specified.
    if path.starts_with("/api/settings/") {
        return Some(vec!["system.settings.unmapped"]);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separates_settings_and_closes_nested_routes() {
        assert_eq!(
            route_permissions(&Method::GET, "/api/settings/logs"),
            Some(vec!["settings.logs.view"])
        );
        assert_eq!(
            route_permissions(&Method::POST, "/api/settings/communication/cleanup"),
            Some(vec!["settings.communication.manage"])
        );
        assert_eq!(
            route_permissions(&Method::GET, "/api/settings/communication/storage"),
            Some(vec!["settings.communication.view"])
        );
        assert_eq!(
            route_permissions(&Method::POST, "/api/settings/new-feature"),
            Some(vec!["system.settings.unmapped"])
        );
    }
    #[test]
    fn legacy_is_expanded_and_manage_implies_view() {
        let grants = effective(vec!["settings.agent".into()]);
        assert!(grants.contains("settings.models.view"));
        assert!(grants.contains("settings.notifications.manage"));
        assert!(!grants.contains("settings.database.manage"));
    }
    #[test]
    fn rejects_wildcards_and_escalation() {
        assert!(validate_grants(&HashSet::from(["*".into()])).is_err());
        assert!(validate_grants(&HashSet::from(["settings.missing.manage".into()])).is_err());
        let actor = effective(vec!["settings.users.view".into()]);
        assert!(!can_delegate(
            &actor,
            &HashSet::from(["settings.users.manage".into()])
        ));
        assert!(!can_delegate(&actor, &HashSet::from(["*".into()])));
    }
    #[test]
    fn catalog_routes_cover_current_platform_endpoints() {
        let router = include_str!("../http/router.rs");
        for line in router.lines() {
            let Some(path) = line.split('"').nth(1) else {
                continue;
            };
            if !(path.starts_with("/api/settings/")
                || path.starts_with("/api/identity/users")
                || path.starts_with("/api/identity/roles")
                || path.starts_with("/api/market/")
                || path.starts_with("/api/agent/")
                || path.starts_with("/api/recycle-bin"))
            {
                continue;
            }
            for method in [Method::GET, Method::POST, Method::PUT, Method::DELETE] {
                let required = route_permissions(&method, path).expect(path);
                assert!(
                    !required.contains(&"system.settings.unmapped"),
                    "unmapped: {path}"
                );
                for key in required {
                    assert!(
                        catalog()
                            .groups
                            .iter()
                            .flat_map(|g| &g.items)
                            .any(|item| item.key == key),
                        "unknown: {key}"
                    );
                }
            }
        }
    }
    #[test]
    fn session_and_archive_permissions_are_separate() {
        assert_eq!(
            route_permissions(&Method::POST, "/api/agent/runtime/reconcile-session"),
            Some(vec!["agent.window"])
        );
        assert_eq!(
            route_permissions(&Method::POST, "/api/agent/sessions/abc/restore"),
            Some(vec!["settings.agent-archive.manage"])
        );
        assert_eq!(
            route_permissions(&Method::DELETE, "/api/agent/sessions/abc/purge"),
            Some(vec!["settings.agent-archive.manage"])
        );
        assert_eq!(
            route_permissions(&Method::GET, "/api/agent/sessions/abc/files"),
            Some(vec!["agent.window"])
        );
        assert_eq!(
            route_permissions(
                &Method::POST,
                "/api/settings/ai-employee-market/abc/install"
            ),
            Some(vec!["settings.ai-employees.manage"])
        );
        assert_eq!(
            route_permissions(&Method::GET, "/api/market/applications"),
            Some(vec!["market.apps.view"])
        );
        assert_eq!(
            route_permissions(&Method::POST, "/api/market/applications/abc/installations"),
            Some(vec!["market.apps.manage"])
        );
    }
}
