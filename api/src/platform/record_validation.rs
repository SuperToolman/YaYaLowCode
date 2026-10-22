//! Configured value checks shared by preflight and every record write.
use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::sync::LazyLock;

pub(crate) static FORMAT_RULES: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    [
    Regex::new(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$").unwrap(),
    Regex::new(r"^(?:\+86)?1[3-9][0-9]{9}$").unwrap(),
    Regex::new(r"^[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]$").unwrap(),
]
});

pub(crate) struct FieldCheck {
    pub label: String,
    pub path: String,
    pub unique: bool,
    pub values: Vec<(String, Value)>,
    pub format: Option<String>,
    pub date_validation: Option<String>,
}

pub(crate) fn field_checks(schema: &Value, data: &Value) -> Vec<FieldCheck> {
    let Some(fields) = schema.get("fields").and_then(Value::as_array) else {
        return vec![];
    };
    let mut checks = vec![];
    for field in fields {
        let kind = field["type"].as_str().unwrap_or("");
        let unique = matches!(kind, "singleLineText" | "multiLineText" | "serialNumber")
            && field["props"]["isUnique"].as_bool() == Some(true);
        let format = if kind == "singleLineText" {
            field["props"]["formatValidation"]
                .as_str()
                .map(str::to_owned)
        } else {
            None
        };
        let date_validation = if matches!(kind, "date" | "dateRange") {
            field["props"]["dateValidation"]
                .as_str()
                .or_else(|| {
                    (field["props"]["dateTodayOrFuture"].as_bool() == Some(true))
                        .then_some("onOrAfterToday")
                })
                .filter(|rule| *rule != "none")
                .map(str::to_owned)
        } else {
            None
        };
        if !unique && format.is_none() && date_validation.is_none() {
            continue;
        }
        let id = field["id"].as_str().unwrap_or("").to_owned();
        let mut parents = vec![];
        let mut parent = field["parentGroupId"].as_str();
        let mut visited = HashSet::new();
        while let Some(parent_id) = parent {
            if !visited.insert(parent_id) {
                break;
            }
            let Some(container) = fields.iter().find(|f| f["id"].as_str() == Some(parent_id))
            else {
                break;
            };
            if container["type"] == "subform" {
                parents.push(parent_id.to_owned());
            }
            parent = container["parentGroupId"].as_str();
        }
        parents.reverse();
        let mut scopes = vec![(String::new(), data)];
        let mut path = "$".to_owned();
        for parent in parents {
            path.push_str(&format!(".{}[*]", serde_json::to_string(&parent).unwrap()));
            scopes = scopes
                .into_iter()
                .flat_map(|(prefix, row)| {
                    row[&parent]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .enumerate()
                        .map(|(index, row)| (format!("{prefix}{parent}:{index}:"), row))
                        .collect::<Vec<_>>()
                })
                .collect();
        }
        path.push_str(&format!(
            ".{} ? (@ == $value)",
            serde_json::to_string(&id).unwrap()
        ));
        checks.push(FieldCheck {
            label: field["label"].as_str().unwrap_or(&id).to_owned(),
            values: scopes
                .into_iter()
                .map(|(prefix, row)| (format!("{prefix}{id}"), row[&id].clone()))
                .collect(),
            path,
            unique,
            format,
            date_validation,
        });
    }
    checks
}

pub(crate) fn local_errors(checks: &[FieldCheck]) -> BTreeMap<String, String> {
    let mut errors = BTreeMap::new();
    for check in checks {
        let mut seen = BTreeMap::new();
        for (key, value) in &check.values {
            if value.is_null() || value.as_str().is_some_and(|v| v.trim().is_empty()) {
                continue;
            }
            if let Some(rule) = &check.date_validation {
                let today = chrono::Utc::now()
                    .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap())
                    .date_naive();
                let dates = value
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![value.clone()]);
                if dates.iter().any(|date| {
                    date.as_str()
                        .and_then(|text| text.get(..10))
                        .and_then(|text| chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").ok())
                        .is_none_or(|date| match rule.as_str() {
                            "beforeToday" => date >= today,
                            "onOrBeforeToday" => date > today,
                            "onOrAfterToday" => date < today,
                            "afterToday" => date <= today,
                            _ => true,
                        })
                }) {
                    let label = match rule.as_str() {
                        "beforeToday" => "今天之前",
                        "onOrBeforeToday" => "今天及之前",
                        "onOrAfterToday" => "今天及之后",
                        "afterToday" => "今天之后",
                        _ => "有效日期",
                    };
                    errors.insert(key.clone(), format!("日期必须是{label}"));
                }
                continue;
            }
            let Some(text) = value.as_str() else {
                errors.insert(key.clone(), format!("{}必须为文本", check.label));
                continue;
            };
            if let Some(format) = &check.format {
                let rule = match format.as_str() {
                    "email" => Some(0),
                    "phoneCN" => Some(1),
                    "idCardCN" => Some(2),
                    _ => None,
                };
                if !rule.is_some_and(|i| FORMAT_RULES[i].is_match(text)) {
                    errors.insert(key.clone(), format!("{}格式不正确", check.label));
                }
            }
            if check.unique {
                if let Some(previous_key) = seen.insert(text, key) {
                    let message = format!("{}已存在，不允许重复", check.label);
                    errors.insert(previous_key.clone(), message.clone());
                    errors.insert(key.clone(), message);
                }
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn date_range_rules_include_or_exclude_today() {
        let current = chrono::Utc::now()
            .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap())
            .date_naive();
        for (rule, accepted) in [
            ("none", [true, true, true]),
            ("beforeToday", [true, false, false]),
            ("onOrBeforeToday", [true, true, false]),
            ("onOrAfterToday", [false, true, true]),
            ("afterToday", [false, false, true]),
        ] {
            let schema = json!({"fields": [
                {"id":"date","type":"date","props":{"dateValidation":rule}},
                {"id":"range","type":"dateRange","props":{"dateValidation":rule}}
            ]});
            for (i, date) in [
                current.pred_opt().unwrap(),
                current,
                current.succ_opt().unwrap(),
            ]
            .iter()
            .enumerate()
            {
                let errors = local_errors(&field_checks(
                    &schema,
                    &json!({"date":format!("{date}T23:59:59"),"range":[date.to_string(), date.to_string()]}),
                ));
                assert_eq!(errors.is_empty(), accepted[i], "{rule}: {date}");
            }
        }
    }

    #[test]
    fn date_today_or_future_checks_dates_and_ranges() {
        let current = chrono::Utc::now()
            .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap())
            .date_naive();
        let yesterday = current.pred_opt().unwrap().to_string();
        let schema = json!({"fields": [
            {"id":"date","type":"date","props":{"dateTodayOrFuture":true}},
            {"id":"range","type":"dateRange","props":{"dateTodayOrFuture":true}}
        ]});
        assert!(local_errors(&field_checks(&schema, &json!({"date":format!("{current}T00:00:00"),"range":[current.to_string(),current.to_string()]}))).is_empty());
        assert_eq!(
            local_errors(&field_checks(
                &schema,
                &json!({"date":yesterday,"range":[current.to_string(),yesterday]})
            ))
            .len(),
            2
        );
        assert!(local_errors(&field_checks(&schema, &json!({}))).is_empty());
    }

    #[test]
    fn formats_and_optional_values() {
        let schema = json!({"fields": [
            {"id":"email","type":"singleLineText","props":{"formatValidation":"email"}},
            {"id":"phone","type":"singleLineText","props":{"formatValidation":"phoneCN"}},
            {"id":"id","type":"singleLineText","props":{"formatValidation":"idCardCN"}}
        ]});
        for phone in ["13800138000", "+8613800138000"] {
            assert!(
                local_errors(&field_checks(
                    &schema,
                    &json!({"email":"a+b@example.com","phone":phone,"id":"11010519491231002X"})
                ))
                .is_empty()
            );
        }
        assert_eq!(
            local_errors(&field_checks(
                &schema,
                &json!({"email":"bad","phone":"+12125551234","id":"123"})
            ))
            .len(),
            3
        );
        assert!(
            local_errors(&field_checks(&schema, &json!({"email":"  ","phone":null}))).is_empty()
        );
    }

    #[test]
    fn duplicate_rows_groups_and_unsupported_uploads() {
        let schema = json!({"fields": [
            {"id":"rows","type":"subform"},
            {"id":"group","type":"groupContainer","parentGroupId":"rows"},
            {"id":"text","type":"multiLineText","parentGroupId":"group","props":{"isUnique":true}},
            {"id":"files","type":"attachment","props":{"isUnique":true}}
        ]});
        let checks = field_checks(
            &schema,
            &json!({"rows":[{"text":"a\nb"},{"text":"a\nb"},{"text":"A\nb"},{"text":""},{"text":""}]}),
        );
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].path, "$.\"rows\"[*].\"text\" ? (@ == $value)");
        assert_eq!(
            local_errors(&checks).keys().cloned().collect::<Vec<_>>(),
            vec!["rows:0:text", "rows:1:text"]
        );
    }
}
