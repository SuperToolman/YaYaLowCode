//! Schema-resolved condition plans shared by SQL queries and run-aware relation loading.
use super::{
    conditions::{self, bad},
    form_storage::{self, FormStoragePlan, StorageTarget},
};
use crate::{
    AppError,
    infrastructure::entities::{form_definition_entity, form_schema_entity},
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Value as SeaValue};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
pub(crate) struct PathPlan {
    pub hops: Vec<(String, FormStoragePlan)>,
    pub field_id: String,
    pub field: Value,
}
pub(crate) async fn schema<C: ConnectionTrait>(db: &C, form: &str) -> Result<Value, AppError> {
    let definition = form_definition_entity::Entity::find()
        .filter(form_definition_entity::Column::FormUuid.eq(form))
        .one(db)
        .await?
        .ok_or_else(|| bad("条件来源表单不存在"))?;
    Ok(form_schema_entity::Entity::find()
        .filter(form_schema_entity::Column::FormUuid.eq(form))
        .filter(form_schema_entity::Column::Version.eq(definition.current_schema_version))
        .one(db)
        .await?
        .ok_or_else(|| bad("条件表单结构不存在"))?
        .schema_json)
}
async fn storage<C: ConnectionTrait>(db: &C, form: &str) -> Result<FormStoragePlan, AppError> {
    let definition = form_storage::load_storage_definition(db, form)
        .await?
        .ok_or_else(|| bad("关联表单存储不存在"))?;
    let plan = form_storage::deserialize_storage_plan(&definition)?;
    if !form_storage::is_safe_identifier(&plan.main_table) {
        return Err(bad("关联表单存储标识无效"));
    }
    Ok(plan)
}
fn field(schema: &Value, id: &str) -> Result<Value, AppError> {
    if [
        "id",
        "recordUuid",
        "instanceId",
        "schemaVersion",
        "createdBy",
        "submitter",
        "submitterOrganization",
        "instanceTitle",
        "updatedBy",
        "createdAt",
        "updatedAt",
        "workflowApprovalStatus",
        "workflowInstanceStatus",
        "workflowCurrentApprovalNode",
        "workflowSubmitter",
    ]
    .contains(&id)
    {
        return Ok(
            json!({"id":id,"type":if ["createdAt","updatedAt"].contains(&id) {"dateTime"} else if id == "schemaVersion" {"number"} else {"singleLineText"}}),
        );
    }
    let fields = schema["fields"]
        .as_array()
        .ok_or_else(|| bad("条件字段结构无效"))?;
    let value = fields
        .iter()
        .find(|f| f["id"] == id)
        .ok_or_else(|| bad(&format!("条件字段已失效：{id}")))?;
    if [
        "subform",
        "groupContainer",
        "separator",
        "description",
        "button",
        "html",
        "tsx",
    ]
    .contains(&value["type"].as_str().unwrap_or(""))
    {
        return Err(bad("此字段不支持条件"));
    }
    let mut parent = value["parentGroupId"].as_str();
    let mut seen = HashSet::new();
    while let Some(id) = parent {
        if !seen.insert(id) {
            return Err(bad("字段分组循环"));
        }
        let p = fields
            .iter()
            .find(|f| f["id"] == id)
            .ok_or_else(|| bad("字段分组失效"))?;
        if p["type"] == "subform" {
            return Err(bad("暂不支持跨子表行的关联条件"));
        }
        parent = p["parentGroupId"].as_str();
    }
    Ok(value.clone())
}
pub(crate) async fn resolve<C: ConnectionTrait>(
    db: &C,
    form: &str,
    key: &str,
) -> Result<PathPlan, AppError> {
    let reference = conditions::reference(key)?;
    let mut current_schema = schema(db, form).await?;
    let mut field_id = reference.root.clone();
    let mut hops = Vec::new();
    for next_id in &reference.path {
        let f = field(&current_schema, &field_id)?;
        if f["type"] != "associationFormField" {
            return Err(bad("条件路径的中间字段必须是关联表单"));
        }
        let target = f["props"]["associationFormId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| bad("关联表单未配置"))?;
        let target_plan = storage(db, target).await?;
        let next_schema = schema(db, target).await?;
        hops.push((field_id, target_plan));
        current_schema = next_schema;
        field_id = next_id.clone();
    }
    let mut terminal = field(&current_schema, &field_id)?;
    if terminal["type"] == "date"
        && matches!(
            terminal["props"]["granularity"].as_str(),
            Some("hour" | "minute" | "second")
        )
    {
        terminal["type"] = json!("dateTime");
    }
    Ok(PathPlan {
        hops,
        field_id,
        field: terminal,
    })
}

#[cfg(test)]
#[path = "condition_query_tests.rs"]
mod tests;
pub(crate) fn allowed(field: &Value, op: &str) -> bool {
    let ty = field["type"].as_str().unwrap_or("");
    if ["hasValue", "noValue"].contains(&op) {
        return true;
    }
    if [
        "number", "integer", "rating", "slider", "progress", "date", "dateTime", "datetime", "time",
    ]
    .contains(&ty)
    {
        return ["eq", "neq", "gt", "gte", "lt", "lte", "between"].contains(&op);
    }
    if ["checkbox", "multiSelect"].contains(&ty)
        || ["member", "department"].contains(&ty)
            && (field["props"]["memberMultiple"] == true || field["props"]["multiple"] == true)
    {
        return ["containsAny", "containsAll", "containsNone"].contains(&op);
    }
    if [
        "attachment",
        "imageUpload",
        "richText",
        "countryCity",
        "dateRange",
    ]
    .contains(&ty)
    {
        return false;
    }
    if ["boolean", "switch"].contains(&ty) {
        return ["eq", "neq"].contains(&op);
    }
    if [
        "select",
        "radio",
        "member",
        "department",
        "associationFormField",
    ]
    .contains(&ty)
    {
        return ["eq", "neq", "inAny", "notInAny"].contains(&op);
    }
    ["eq", "neq", "contains", "notContains", "inAny", "notInAny"].contains(&op)
}
pub(crate) fn validate_operand(plan: &PathPlan, rule: &Value) -> Result<(), AppError> {
    let op = rule["operator"].as_str().unwrap_or("eq");
    if !allowed(&plan.field, op) {
        return Err(bad("运算符与条件字段类型不兼容"));
    }
    if rule["valueType"] == "field" && ["between", "inAny", "notInAny"].contains(&op) {
        return Err(bad("集合或区间条件需要配置固定值"));
    }
    if ["hasValue", "noValue"].contains(&op) || rule["valueType"] == "field" {
        return Ok(());
    }
    let value = conditions::literal(rule["rawValue"].as_str().unwrap_or(""))?;
    if ["containsAny", "containsAll", "containsNone"].contains(&op) && !value.is_array() {
        return Err(bad("多值条件需要数组值"));
    }
    if ![
        "inAny",
        "notInAny",
        "containsAny",
        "containsAll",
        "containsNone",
        "between",
    ]
    .contains(&op)
        && value.is_array()
    {
        return Err(bad("此运算符需要单个值"));
    }
    let ty = plan.field["type"].as_str().unwrap_or("");
    let values = value.as_array().cloned().unwrap_or_else(|| vec![value]);
    if ["number", "integer", "rating", "slider", "progress"].contains(&ty)
        && values.iter().any(|v| {
            conditions::scalar(v).parse::<f64>().map_or(true, |n| {
                !n.is_finite() || ty == "integer" && n.fract() != 0.0
            })
        })
    {
        return Err(bad("数字条件值无效"));
    }
    if ["date", "dateTime", "datetime"].contains(&ty)
        && values.iter().any(|v| {
            let s = conditions::scalar(v)
                .split('[')
                .next()
                .unwrap_or("")
                .to_string();
            chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").is_err()
                && chrono::DateTime::parse_from_rfc3339(&s).is_err()
                && chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M").is_err()
                && chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S").is_err()
        })
    {
        return Err(bad("日期条件值无效"));
    }
    if ty == "time"
        && values.iter().any(|v| {
            let s = conditions::scalar(v);
            chrono::NaiveTime::parse_from_str(&s, "%H:%M").is_err()
                && chrono::NaiveTime::parse_from_str(&s, "%H:%M:%S").is_err()
        })
    {
        return Err(bad("时间条件值无效"));
    }
    Ok(())
}
pub(crate) fn validate_pair(a: &PathPlan, b: &PathPlan) -> Result<(), AppError> {
    let a_type = a.field["type"].as_str().unwrap_or("");
    let b_type = b.field["type"].as_str().unwrap_or("");
    let numeric = |t| ["number", "integer", "rating", "slider", "progress"].contains(&t);
    if a_type != b_type
        && !(numeric(a_type) && numeric(b_type))
        && !(["singleLineText", "multiLineText"].contains(&a_type)
            && ["singleLineText", "multiLineText"].contains(&b_type))
    {
        return Err(bad("比较字段类型不兼容"));
    }
    if a_type == "associationFormField"
        && a.field["props"]["associationFormId"] != b.field["props"]["associationFormId"]
    {
        return Err(bad("比较关联字段的目标表单不一致"));
    }
    let multiple = |f: &Value| {
        ["checkbox", "multiSelect"].contains(&f["type"].as_str().unwrap_or(""))
            || ["member", "department"].contains(&f["type"].as_str().unwrap_or(""))
                && (f["props"]["memberMultiple"] == true || f["props"]["multiple"] == true)
    };
    if multiple(&a.field) != multiple(&b.field) {
        return Err(bad("比较字段的单选多选设置不兼容"));
    }
    Ok(())
}

fn bind(value: Value, params: &mut Vec<SeaValue>) -> String {
    params.push(SeaValue::Json(Some(Box::new(value))));
    format!("${}::jsonb", params.len())
}
fn local_expr(
    plan: Option<&FormStoragePlan>,
    alias: &str,
    id: &str,
    params: &mut Vec<SeaValue>,
) -> String {
    let system = match id {
        "id" | "recordUuid" | "instanceId" => Some("record_uuid"),
        "createdAt" => Some("created_at"),
        "updatedAt" => Some("updated_at"),
        "createdBy" | "submitter" => Some("created_by"),
        "updatedBy" => Some("updated_by"),
        "schemaVersion" => Some("schema_version"),
        _ => None,
    };
    if let Some(column) = system {
        return format!("to_jsonb({alias}.{column})");
    }
    if let Some(plan) = plan {
        if let Some(f) = plan
            .fields
            .iter()
            .find(|f| f.field_id == id && matches!(f.target, StorageTarget::Column))
        {
            if let Some(column) = &f.column_name {
                if form_storage::is_safe_identifier(column) {
                    return format!("to_jsonb({alias}.\"{column}\")");
                }
            }
        }
    }
    params.push(id.to_string().into());
    format!(
        "{alias}.{} -> ${}",
        if plan.is_some() {
            "extension_data"
        } else {
            "record_data"
        },
        params.len()
    )
}
fn path_expr(plan: &PathPlan, index: usize, alias: &str, params: &mut Vec<SeaValue>) -> String {
    let storage = index.checked_sub(1).map(|i| &plan.hops[i].1);
    if index == plan.hops.len() {
        return local_expr(storage, alias, &plan.field_id, params);
    }
    let (field, target) = &plan.hops[index];
    let id = local_expr(storage, alias, field, params);
    let next_alias = format!("rel{index}");
    let terminal = path_expr(plan, index + 1, &next_alias, params);
    format!(
        "(SELECT {terminal} FROM \"{}\" {next_alias} WHERE {next_alias}.record_uuid = ({id} #>> '{{}}') AND {next_alias}.deleted_at IS NULL)",
        target.main_table
    )
}
fn cast(expr: &str, field: &Value) -> String {
    let text = format!("({expr} #>> '{{}}')");
    match field["type"].as_str().unwrap_or("") {
        "number" | "integer" | "rating" | "slider" | "progress" => format!(
            "(CASE WHEN {text} ~ '^[+-]?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$' THEN {text}::numeric END)"
        ),
        "date" => format!("NULLIF({text},'')::date"),
        "dateTime" | "datetime" => {
            let value = format!("NULLIF(split_part({text},'[',1),'')");
            format!(
                "(CASE WHEN {value} ~ '(Z|[+-][0-9]{{2}}:[0-9]{{2}})$' THEN {value}::timestamptz ELSE {value}::timestamp AT TIME ZONE 'UTC' END)"
            )
        }
        "time" => format!("NULLIF({text},'')::time"),
        _ => format!("btrim({text})"),
    }
}
fn predicate(
    rule: &Value,
    plans: &HashMap<String, PathPlan>,
    params: &mut Vec<SeaValue>,
) -> Result<String, AppError> {
    let key = rule["fieldKey"].as_str().unwrap_or("");
    let plan = &plans[key];
    let raw = path_expr(plan, 0, "source", params);
    let a = cast(&raw, &plan.field);
    let op = rule["operator"].as_str().unwrap_or("eq");
    if ["hasValue", "noValue"].contains(&op) {
        let has = format!(
            "COALESCE(({raw} NOT IN ('null'::jsonb,'[]'::jsonb,'{{}}'::jsonb) AND btrim({raw} #>> '{{}}') <> ''),FALSE)"
        );
        return Ok(if op == "noValue" {
            format!("NOT ({has})")
        } else {
            has
        });
    }
    let expected = conditions::literal(rule["rawValue"].as_str().unwrap_or(""))?;
    let right = if rule["valueType"] == "field" {
        path_expr(
            &plans[rule["sourceFieldKey"].as_str().unwrap_or("")],
            0,
            "source",
            params,
        )
    } else {
        bind(expected.clone(), params)
    };
    let b = cast(&right, &plan.field);
    let negate = ["neq", "notContains", "notInAny", "containsNone"].contains(&op);
    let positive = match op {
        "eq" | "neq" => format!("{a} = {b}"),
        "gt" => format!("{a} > {b}"),
        "gte" => format!("{a} >= {b}"),
        "lt" => format!("{a} < {b}"),
        "lte" => format!("{a} <= {b}"),
        "contains" | "notContains" => format!("strpos({a},{b}) > 0"),
        "between" => format!(
            "{a} >= {} AND {a} <= {}",
            cast(&format!("{right} -> 0"), &plan.field),
            cast(&format!("{right} -> 1"), &plan.field)
        ),
        "inAny" | "notInAny" => {
            let list = if expected.is_array() || rule["valueType"] == "field" {
                right
            } else {
                bind(
                    json!(
                        conditions::scalar(&expected)
                            .split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                    ),
                    params,
                )
            };
            format!(
                "EXISTS (SELECT 1 FROM jsonb_array_elements({list}) item(value) WHERE {a} = {})",
                cast("item.value", &plan.field)
            )
        }
        "containsAny" | "containsNone" => format!(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof({raw}) = 'array' THEN {raw} ELSE '[]'::jsonb END) item(value) WHERE {right} @> jsonb_build_array(item.value))"
        ),
        "containsAll" => {
            format!("{right} <> '[]'::jsonb AND COALESCE({raw},'[]'::jsonb) @> {right}")
        }
        _ => return Err(bad("不支持的条件运算符")),
    };
    Ok(if negate {
        format!("NOT COALESCE(({positive}),FALSE)")
    } else {
        format!("COALESCE(({positive}),FALSE)")
    })
}
fn group(
    rules: &[Value],
    parent: Option<&str>,
    plans: &HashMap<String, PathPlan>,
    params: &mut Vec<SeaValue>,
) -> Result<String, AppError> {
    let siblings: Vec<_> = rules
        .iter()
        .filter(|r| r["parentId"].as_str().filter(|s| !s.is_empty()) == parent)
        .collect();
    let join = if siblings
        .first()
        .is_some_and(|r| r["logicalOperator"] == "or")
    {
        " OR "
    } else {
        " AND "
    };
    let mut parts = vec![];
    for rule in siblings {
        let id = rule["id"].as_str();
        let children: Vec<_> = rules
            .iter()
            .filter(|r| r["parentId"].as_str().is_some() && r["parentId"].as_str() == id)
            .collect();
        let own = if rule["isGroup"] == true {
            group(rules, id, plans, params)?
        } else {
            let own = predicate(rule, plans, params)?;
            if children.is_empty() {
                own
            } else {
                format!(
                    "({own}) {} ({})",
                    if children[0]["logicalOperator"] == "or" {
                        "OR"
                    } else {
                        "AND"
                    },
                    group(rules, id, plans, params)?
                )
            }
        };
        parts.push(format!("({own})"));
    }
    Ok(if parts.is_empty() {
        "TRUE".into()
    } else {
        parts.join(join)
    })
}
pub(crate) async fn compile<C: ConnectionTrait>(
    db: &C,
    form: &str,
    rules: &[Value],
    params: &mut Vec<SeaValue>,
) -> Result<(String, Vec<String>), AppError> {
    conditions::validate_rules(rules)?;
    let mut plans = HashMap::new();
    let mut forms = HashSet::new();
    for rule in rules.iter().filter(|r| r["isGroup"] != true) {
        let key = rule["fieldKey"].as_str().unwrap_or("");
        let plan = resolve(db, form, key).await?;
        validate_operand(&plan, rule)?;
        forms.extend(plan.hops.iter().map(|(_, p)| p.form_uuid.clone()));
        if rule["valueType"] == "field" {
            let source = rule["sourceFieldKey"].as_str().unwrap_or("");
            let other = resolve(db, form, source).await?;
            validate_pair(&plan, &other)?;
            forms.extend(other.hops.iter().map(|(_, p)| p.form_uuid.clone()));
            plans.insert(source.into(), other);
        }
        plans.insert(key.into(), plan);
    }
    Ok((
        group(rules, None, &plans, params)?,
        forms.into_iter().collect(),
    ))
}

pub(crate) async fn hydrate<C: ConnectionTrait>(
    db: &C,
    repository: &super::records::RecordRepository<'_, C>,
    form: &str,
    keys: &[String],
    records: &mut [Value],
) -> Result<(), AppError> {
    let mut cache: HashMap<(String, String), Value> = HashMap::new();
    for key in keys {
        let plan = resolve(db, form, key).await?;
        if plan.hops.is_empty() {
            continue;
        }
        let mut current = records.to_vec();
        for (field, target) in &plan.hops {
            let ids: HashSet<_> = current
                .iter()
                .filter_map(|record| {
                    record[field]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                })
                .collect();
            let missing: Vec<_> = ids
                .into_iter()
                .filter(|id| !cache.contains_key(&(target.form_uuid.clone(), id.clone())))
                .collect();
            if !missing.is_empty() {
                let found = repository.find_many(&target.form_uuid, &missing).await?;
                for id in &missing {
                    cache.insert((target.form_uuid.clone(), id.clone()), Value::Null);
                }
                for record in found {
                    let id = record.record_uuid.clone();
                    let mut data = record.record_data.clone();
                    if let Some(map) = data.as_object_mut() {
                        map.insert("instanceId".into(), json!(id));
                        map.insert("id".into(), json!(id));
                        map.insert("recordUuid".into(), json!(id));
                        map.insert("schemaVersion".into(), json!(record.schema_version));
                        map.insert("createdBy".into(), json!(record.created_by));
                        map.insert("updatedBy".into(), json!(record.updated_by));
                        map.insert("createdAt".into(), json!(record.created_at.to_rfc3339()));
                        map.insert("updatedAt".into(), json!(record.updated_at.to_rfc3339()));
                        map.insert("submitter".into(), json!(record.created_by));
                    }
                    cache.insert((target.form_uuid.clone(), id), data);
                }
            }
            current = current
                .iter()
                .map(|record| {
                    record[field]
                        .as_str()
                        .and_then(|id| cache.get(&(target.form_uuid.clone(), id.to_string())))
                        .cloned()
                        .unwrap_or(Value::Null)
                })
                .collect();
        }
        for (root, terminal) in records.iter_mut().zip(current) {
            if let Some(map) = root.as_object_mut() {
                map.insert(
                    key.clone(),
                    terminal.get(&plan.field_id).cloned().unwrap_or(Value::Null),
                );
            }
        }
    }
    Ok(())
}
