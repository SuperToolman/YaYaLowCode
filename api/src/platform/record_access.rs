//! Current product data scopes applied before record retrieval. Legacy name ownership
//! is accepted only when it identifies one active user; ambiguous names fail closed.
use super::prelude::*;
use crate::infrastructure::entities::{
    iam_organization_membership_entity, iam_user_entity, organization_unit_entity,
};

/// `None` means unrestricted. Keep both policies rather than intersecting grant
/// strings: an absent data_scope is "all" in the product's existing contract.
pub(crate) fn intersect_creators(
    a: Option<Vec<String>>,
    b: Option<Vec<String>>,
) -> Option<Vec<String>> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(a), Some(b)) => Some(a.into_iter().filter(|id| b.contains(id)).collect()),
    }
}

/// Optional field RBAC v1. Existing form display grants retain the product's
/// visible-field behavior. `field_scope:specified` switches to an explicit read
/// allowlist; `field_scope:none` denies all values. Hidden ancestors always win.
pub(crate) struct FieldPolicy {
    fields: HashMap<String, serde_json::Value>,
    readable: HashSet<String>,
}
impl FieldPolicy {
    pub(crate) fn new(
        schema: &serde_json::Value,
        form: &str,
        current: &HashSet<String>,
        snapshot: &HashSet<String>,
    ) -> Self {
        let fields = schema["fields"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|f| f["id"].as_str().map(|id| (id.to_owned(), f.clone())))
            .collect::<HashMap<_, _>>();
        let permits = |grants: &HashSet<String>, id: &str| {
            if grants.contains("*") {
                return true;
            }
            if grants.contains(&format!("form:{form}:field_scope:none")) {
                return false;
            }
            !grants.contains(&format!("form:{form}:field_scope:specified"))
                || grants.contains(&format!("form:{form}:field:{id}:read"))
        };
        let readable = fields
            .keys()
            .filter(|id| {
                if !permits(current, id) || !permits(snapshot, id) {
                    return false;
                }
                let mut cursor = Some(id.as_str());
                let mut seen = HashSet::new();
                while let Some(id) = cursor {
                    if !seen.insert(id) {
                        return false;
                    }
                    let Some(field) = fields.get(id) else {
                        return false;
                    };
                    if field["props"]["isHidden"] == true {
                        return false;
                    }
                    cursor = field["parentGroupId"].as_str();
                }
                true
            })
            .cloned()
            .collect();
        Self { fields, readable }
    }
    pub(crate) fn can_read(&self, id: &str) -> bool {
        self.readable.contains(id)
    }
    pub(crate) fn can_query(&self, id: &str) -> bool {
        if !self.can_read(id) {
            return false;
        }
        let field = &self.fields[id];
        if matches!(
            field["type"].as_str(),
            Some(
                "subform"
                    | "attachment"
                    | "imageUpload"
                    | "associationFormField"
                    | "html"
                    | "tsx"
                    | "groupContainer"
                    | "separator"
                    | "button"
                    | "description"
            )
        ) {
            return false;
        }
        let mut parent = field["parentGroupId"].as_str();
        while let Some(id) = parent {
            let Some(field) = self.fields.get(id) else {
                return false;
            };
            if field["type"] == "subform" {
                return false;
            }
            parent = field["parentGroupId"].as_str();
        }
        true
    }
    pub(crate) fn project(&self, data: &serde_json::Value) -> serde_json::Value {
        let values = self
            .readable
            .iter()
            .filter(|id| self.can_query(id))
            .filter_map(|id| {
                let value = data.get(id)?;
                let scalar = |v: &serde_json::Value| {
                    v.is_null()
                        || v.is_number()
                        || v.is_boolean()
                        || v.as_str().is_some_and(|s| s.len() <= 16384)
                };
                if scalar(value)
                    || value
                        .as_array()
                        .is_some_and(|items| items.len() <= 100 && items.iter().all(scalar))
                {
                    Some((id.clone(), value.clone()))
                } else {
                    None
                }
            })
            .collect::<serde_json::Map<_, _>>();
        serde_json::Value::Object(values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn data_scope_intersection_never_turns_a_restriction_into_all() {
        assert_eq!(
            intersect_creators(None, Some(vec!["self".into()])),
            Some(vec!["self".into()])
        );
        assert_eq!(
            intersect_creators(Some(vec!["a".into()]), Some(vec!["b".into()])),
            Some(vec![])
        );
        assert_eq!(intersect_creators(None, Some(vec![])), Some(vec![]));
    }
    #[test]
    fn field_projection_checks_both_policies_and_hidden_ancestors() {
        let schema = json!({"fields":[{"id":"name","type":"singleLineText","props":{}},{"id":"secret","type":"singleLineText","props":{"isHidden":true}},{"id":"group","type":"groupContainer","props":{"isHidden":true}},{"id":"child","type":"singleLineText","parentGroupId":"group","props":{}},{"id":"files","type":"attachment","props":{}}]});
        let all = HashSet::from(["*".into()]);
        let restricted = HashSet::from([
            "form:f:field_scope:specified".into(),
            "form:f:field:name:read".into(),
        ]);
        for (current, saved) in [(&all, &restricted), (&restricted, &all)] {
            let policy = FieldPolicy::new(&schema, "f", current, saved);
            assert_eq!(policy.project(&json!({"name":"visible","secret":"hidden","child":"hidden parent","unknown":"legacy secret","files":["url"]})),json!({"name":"visible"}));
            assert!(!policy.can_query("secret"));
            assert!(!policy.can_query("unknown"));
        }
        let none = HashSet::from(["form:f:field_scope:none".into()]);
        assert_eq!(
            FieldPolicy::new(&schema, "f", &all, &none).project(&json!({"name":"hidden"})),
            json!({})
        );
    }
}

pub(crate) async fn creators(
    state: &AppState,
    user_id: Uuid,
    form: &str,
    grants: &HashSet<String>,
) -> Result<Option<Vec<String>>, AppError> {
    if grants.contains("*") {
        return Ok(None);
    }
    let prefix = format!("form:{form}:data_scope:");
    let scopes = grants
        .iter()
        .filter_map(|grant| grant.strip_prefix(&prefix))
        .collect::<Vec<_>>();
    // Existing product permissions UI defines absent data_scope as all.
    if scopes.is_empty() || scopes.contains(&"all") {
        return Ok(None);
    }
    if scopes.iter().all(|scope| *scope == "none") {
        return Ok(Some(vec![]));
    }
    let mut ids = HashSet::new();
    if scopes.contains(&"self") {
        ids.insert(user_id);
    }
    if scopes.contains(&"department") || scopes.contains(&"sub_department") {
        let memberships = iam_organization_membership_entity::Entity::find()
            .filter(iam_organization_membership_entity::Column::UserId.eq(user_id))
            .all(&state.db)
            .await?;
        let user = iam_user_entity::Entity::find_by_id(user_id)
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::Forbidden("user missing".into()))?;
        let mut departments = memberships
            .into_iter()
            .map(|m| m.organization_unit_id)
            .collect::<HashSet<_>>();
        if let Some(primary) = user.primary_organization_unit_id {
            departments.insert(primary);
        }
        if scopes.contains(&"sub_department") {
            let orgs = organization_unit_entity::Entity::find()
                .filter(organization_unit_entity::Column::Status.eq("active"))
                .all(&state.db)
                .await?;
            loop {
                let previous = departments.len();
                for org in &orgs {
                    if orgs.iter().any(|parent| {
                        departments.contains(&parent.id)
                            && org.source_type == parent.source_type
                            && org.parent_external_id.as_deref()
                                == Some(parent.external_id.as_str())
                    }) {
                        departments.insert(org.id);
                    }
                }
                if previous == departments.len() {
                    break;
                }
            }
        }
        if !departments.is_empty() {
            let members = iam_organization_membership_entity::Entity::find()
                .filter(
                    iam_organization_membership_entity::Column::OrganizationUnitId
                        .is_in(departments.iter().copied()),
                )
                .all(&state.db)
                .await?;
            ids.extend(members.into_iter().map(|m| m.user_id));
            let primary = iam_user_entity::Entity::find()
                .filter(iam_user_entity::Column::PrimaryOrganizationUnitId.is_in(departments))
                .all(&state.db)
                .await?;
            ids.extend(primary.into_iter().map(|u| u.id));
        }
    }
    let users = iam_user_entity::Entity::find().all(&state.db).await?;
    let mut result = vec![];
    for user in users.iter().filter(|u| ids.contains(&u.id)) {
        result.push(user.id.to_string());
        if users
            .iter()
            .filter(|candidate| candidate.display_name == user.display_name)
            .count()
            != 1
        {
            return Err(AppError::Forbidden(
                "ambiguous legacy record owner; scoped access requires ownership migration".into(),
            ));
        }
        result.push(user.display_name.clone());
    }
    Ok(Some(result))
}
