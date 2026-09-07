use std::collections::HashSet;

pub(crate) struct PlatformActionAccess {
    grants: HashSet<String>,
}

impl PlatformActionAccess {
    pub(crate) fn new(grants: HashSet<String>) -> Self {
        Self { grants }
    }
    fn has(&self, permission: String) -> bool {
        self.grants.contains("*") || self.grants.contains(&permission)
    }
    pub(crate) fn require_app_access(&self, app_id: &str) -> Result<(), String> {
        if self.grants.contains("*")
            || self.grants.contains("apps.manage")
            || self.has(format!("app:{app_id}:display"))
        {
            Ok(())
        } else {
            Err("application visibility permission denied".to_string())
        }
    }
    pub(crate) fn can_manage_apps(&self) -> bool {
        self.has("apps.manage".to_string())
    }
    pub(crate) fn can_create_form(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:create_form"))
    }
    pub(crate) fn can_edit_form(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:edit_form"))
    }
    pub(crate) fn can_delete_form(&self, form_uuid: &str) -> bool {
        self.has(format!("form:{form_uuid}:delete_form"))
    }
    pub(crate) fn can_manage_navigation_groups(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:create_group"))
    }
    pub(crate) fn can_manage_automations(&self, app_id: &str) -> bool {
        self.has(format!("app:{app_id}:automation"))
    }
}

pub(crate) fn is_supported_transaction(action_type: &str) -> bool {
    matches!(
        action_type,
        "create_automation_draft"
            | "create_app"
            | "update_app"
            | "delete_app"
            | "delete_automation"
            | "create_form"
            | "move_form_to_group"
            | "create_navigation_group"
            | "delete_navigation_group"
            | "create_detail_form"
            | "save_form_schema"
            | "delete_form"
    )
}
