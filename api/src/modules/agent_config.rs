use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::entities::agent_model_provider_entity::{
    self, Entity as AgentModelProviderEntity,
};
use crate::infrastructure::entities::agent_provider_model_entity::{
    self, Entity as AgentProviderModelEntity,
};
use crate::infrastructure::entities::agent_resource_entity::{self, Entity as AgentResourceEntity};
use crate::platform::config::{AgentPluginDefinition, AgentSkillDefinition, import_skill_package};
use crate::platform::license::PlatformAiEmployeeSkill;
use crate::platform::prelude::{ApiResponse, AppError, AppState};
use crate::shared::success_response;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
};

fn resources_of_kind<T: serde::de::DeserializeOwned>(
    rows: &[agent_resource_entity::Model],
    kind: &str,
) -> Result<Vec<T>, serde_json::Error> {
    rows.iter()
        .filter(|row| row.kind == kind)
        .map(|row| serde_json::from_value(row.configuration_json.clone()))
        .collect()
}

async fn insert_resource<T: Serialize>(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
    name: &str,
    value: &T,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    agent_resource_entity::ActiveModel {
        id: Set(id.to_string()),
        kind: Set(kind.to_string()),
        name: Set(name.to_string()),
        configuration_json: Set(
            serde_json::to_value(value).map_err(|error| AppError::BadRequest(error.to_string()))?
        ),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(())
}

async fn save_resource<T: Serialize>(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
    name: &str,
    value: &T,
) -> Result<(), AppError> {
    let row = AgentResourceEntity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("{kind} not found")))?;
    if row.kind != kind {
        return Err(AppError::NotFound(format!("{kind} not found")));
    }
    let mut active: agent_resource_entity::ActiveModel = row.into();
    active.name = Set(name.to_string());
    active.configuration_json =
        Set(serde_json::to_value(value).map_err(|error| AppError::BadRequest(error.to_string()))?);
    active.updated_at = Set(chrono::Utc::now());
    active.update(db).await?;
    Ok(())
}

async fn delete_resource(
    db: &sea_orm::DatabaseConnection,
    kind: &str,
    id: &str,
) -> Result<(), AppError> {
    let result = AgentResourceEntity::delete_many()
        .filter(agent_resource_entity::Column::Id.eq(id))
        .filter(agent_resource_entity::Column::Kind.eq(kind))
        .exec(db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound(format!("{kind} not found")));
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderResponse {
    id: String,
    name: String,
    kind: String,
    enabled: bool,
    is_default: bool,
    api_base_url: String,
    api_key: String,
    website_url: String,
    default_chat_model: String,
    models: Vec<String>,
    api_key_configured: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderRequest {
    name: String,
    kind: String,
    enabled: bool,
    #[serde(default)]
    is_default: bool,
    api_base_url: String,
    api_key: Option<String>,
    #[serde(default)]
    website_url: String,
    #[serde(default)]
    default_chat_model: String,
    #[serde(default)]
    models: Vec<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemAiStatusResponse {
    available: bool,
    provider_id: Option<String>,
    provider_name: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginRequest {
    name: String,
    description: String,
    enabled: bool,
    version: String,
    entrypoint: String,
    #[serde(default)]
    manifest_json: String,
    requires_confirmation: bool,
}

pub(crate) async fn get_system_ai_status(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<SystemAiStatusResponse>>, AppError> {
    let provider = AgentModelProviderEntity::find()
        .filter(agent_model_provider_entity::Column::IsDefault.eq(true))
        .one(&state.db)
        .await?;
    let response = match provider {
        None => SystemAiStatusResponse {
            available: false,
            provider_id: None,
            provider_name: None,
            reason: Some("请先配置默认模型供应商".to_string()),
        },
        Some(provider) => {
            let reason = if !provider.enabled {
                Some("默认模型供应商已停用".to_string())
            } else if provider.api_base_url.trim().is_empty()
                || provider.default_chat_model.trim().is_empty()
            {
                Some("默认模型供应商缺少 API 地址或默认对话模型".to_string())
            } else {
                None
            };
            SystemAiStatusResponse {
                available: reason.is_none(),
                provider_id: Some(provider.id),
                provider_name: Some(provider.name),
                reason,
            }
        }
    };
    Ok(Json(success_response("system AI status loaded", response)))
}

pub(crate) async fn list_providers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ProviderResponse>>>, AppError> {
    let grants = crate::platform::authorization::grants(&headers, &state).await?;
    let can_manage = grants.contains("*") || grants.contains("settings.models.manage");
    let providers = AgentModelProviderEntity::find().all(&state.db).await?;
    let models = AgentProviderModelEntity::find().all(&state.db).await?;
    Ok(Json(success_response(
        "providers loaded",
        providers
            .iter()
            .map(|provider| {
                let mut response = provider_response(provider, &models);
                if !can_manage {
                    response.api_key.clear();
                }
                response
            })
            .collect(),
    )))
}

pub(crate) async fn install_ai_employee_skill_package(
    state: &AppState,
    skill: &PlatformAiEmployeeSkill,
    archive: &[u8],
) -> Result<(), AppError> {
    let mut item = AgentSkillDefinition {
        id: skill.id.clone(),
        name: skill.title.clone(),
        package_name: market_skill_package_name(skill),
        source: "market".to_string(),
        version: skill.version.clone(),
        package_path: String::new(),
        is_system: false,
        description: skill.description.clone(),
        enabled: true,
        instructions: skill.instructions.clone(),
        requires_confirmation: false,
        plugin_manifest_json: serde_json::json!({
            "id": skill.id,
            "version": skill.version,
            "kind": "skill",
            "entrypoint": skill.package_path,
            "tools": []
        })
        .to_string(),
    };
    import_skill_package(&mut item, archive).map_err(AppError::BadRequest)?;
    item.source = "market".to_string();
    item.version = skill.version.clone();
    item.name = skill.title.clone();
    item.description = skill.description.clone();

    let now = chrono::Utc::now();
    if let Some(existing) = AgentResourceEntity::find_by_id(&item.id)
        .one(&state.db)
        .await?
    {
        if existing.kind != "skill" {
            return Err(AppError::BadRequest(format!(
                "AI 员工 Skill ID 与本地 {} 资源冲突",
                existing.kind
            )));
        }
        let mut active: agent_resource_entity::ActiveModel = existing.into();
        active.name = Set(item.name.clone());
        active.configuration_json =
            Set(serde_json::to_value(&item)
                .map_err(|error| AppError::BadRequest(error.to_string()))?);
        active.updated_at = Set(now);
        active.update(&state.db).await?;
    } else {
        insert_resource(&state.db, "skill", &item.id, &item.name, &item, now).await?;
    }
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(())
}

fn market_skill_package_name(skill: &PlatformAiEmployeeSkill) -> String {
    let value = if skill.package_name.trim().is_empty() {
        &skill.id
    } else {
        &skill.package_name
    };
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "market-skill".to_string()
    } else {
        normalized.to_string()
    }
}

pub(crate) async fn create_provider(
    State(state): State<AppState>,
    Json(payload): Json<ProviderRequest>,
) -> Result<(StatusCode, Json<ApiResponse<ProviderResponse>>), AppError> {
    validate_provider(&payload)?;
    let is_first_provider = AgentModelProviderEntity::find().count(&state.db).await? == 0;
    let is_default = is_first_provider || payload.is_default;
    if is_default {
        clear_default_provider(&state.db, None).await?;
    }
    let provider = agent_model_provider_entity::ActiveModel {
        id: Set(format!("provider-{}", Uuid::new_v4().simple())),
        name: Set(payload.name.trim().to_string()),
        kind: Set(payload.kind.trim().to_string()),
        enabled: Set(payload.enabled),
        is_default: Set(is_default),
        api_base_url: Set(payload
            .api_base_url
            .trim()
            .trim_end_matches('/')
            .to_string()),
        api_key: Set(payload.api_key.unwrap_or_default()),
        website_url: Set(payload.website_url.trim().to_string()),
        default_chat_model: Set(payload.default_chat_model.trim().to_string()),
        created_at: Set(chrono::Utc::now()),
        updated_at: Set(chrono::Utc::now()),
    };
    let provider = provider.insert(&state.db).await?;
    sync_provider_models(
        &state.db,
        &provider.id,
        &payload.models,
        &provider.default_chat_model,
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response(
            "provider created",
            provider_response(
                &provider,
                &AgentProviderModelEntity::find()
                    .filter(agent_provider_model_entity::Column::ProviderId.eq(&provider.id))
                    .all(&state.db)
                    .await?,
            ),
        )),
    ))
}

pub(crate) async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ProviderRequest>,
) -> Result<Json<ApiResponse<ProviderResponse>>, AppError> {
    validate_provider(&payload)?;
    let provider = AgentModelProviderEntity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("model provider not found".to_string()))?;
    if payload.is_default {
        clear_default_provider(&state.db, Some(&id)).await?;
    }
    let mut active: agent_model_provider_entity::ActiveModel = provider.into();
    active.name = Set(payload.name.trim().to_string());
    active.kind = Set(payload.kind.trim().to_string());
    active.enabled = Set(payload.enabled);
    active.is_default = Set(payload.is_default);
    active.api_base_url = Set(payload
        .api_base_url
        .trim()
        .trim_end_matches('/')
        .to_string());
    active.website_url = Set(payload.website_url.trim().to_string());
    active.default_chat_model = Set(payload.default_chat_model.trim().to_string());
    active.updated_at = Set(chrono::Utc::now());
    if let Some(api_key) = payload.api_key.filter(|value| !value.trim().is_empty()) {
        active.api_key = Set(api_key);
    }
    let provider = active.update(&state.db).await?;
    sync_provider_models(
        &state.db,
        &provider.id,
        &payload.models,
        &provider.default_chat_model,
    )
    .await?;
    let models = AgentProviderModelEntity::find()
        .filter(agent_provider_model_entity::Column::ProviderId.eq(&provider.id))
        .all(&state.db)
        .await?;
    let response = provider_response(&provider, &models);
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("provider updated", response)))
}

pub(crate) async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let result = AgentModelProviderEntity::delete_by_id(&id)
        .exec(&state.db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound("model provider not found".to_string()));
    }
    state
        .bump_cache_version("yaya:v1:agent-providers:version")
        .await;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "provider deleted",
        serde_json::json!({ "id": id }),
    )))
}

pub(crate) async fn list_plugins(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AgentPluginDefinition>>>, AppError> {
    let rows = AgentResourceEntity::find()
        .filter(agent_resource_entity::Column::Kind.eq("plugin"))
        .all(&state.db)
        .await?;
    Ok(Json(success_response(
        "agent plugins loaded",
        resources_of_kind(&rows, "plugin")
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
    )))
}

pub(crate) async fn create_plugin(
    State(state): State<AppState>,
    Json(payload): Json<PluginRequest>,
) -> Result<(StatusCode, Json<ApiResponse<AgentPluginDefinition>>), AppError> {
    validate_plugin(&payload)?;
    let item = AgentPluginDefinition {
        id: format!("plugin-{}", Uuid::new_v4().simple()),
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        manifest_json: payload.manifest_json.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    insert_resource(
        &state.db,
        "plugin",
        &item.id,
        &item.name,
        &item,
        chrono::Utc::now(),
    )
    .await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok((
        StatusCode::CREATED,
        Json(success_response("plugin created", item)),
    ))
}

pub(crate) async fn update_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PluginRequest>,
) -> Result<Json<ApiResponse<AgentPluginDefinition>>, AppError> {
    validate_plugin(&payload)?;
    let item = AgentPluginDefinition {
        id,
        name: payload.name.trim().to_string(),
        description: payload.description.trim().to_string(),
        enabled: payload.enabled,
        version: payload.version.trim().to_string(),
        entrypoint: payload.entrypoint.trim().to_string(),
        manifest_json: payload.manifest_json.trim().to_string(),
        requires_confirmation: payload.requires_confirmation,
    };
    save_resource(&state.db, "plugin", &item.id, &item.name, &item).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response("plugin updated", item)))
}

pub(crate) async fn delete_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    delete_resource(&state.db, "plugin", &id).await?;
    state
        .bump_cache_version("yaya:v1:agent-runtime:version")
        .await;
    Ok(Json(success_response(
        "plugin deleted",
        serde_json::json!({"id": id}),
    )))
}

fn validate_resource_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        Err(AppError::BadRequest(
            "resource name is required".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn validate_plugin(payload: &PluginRequest) -> Result<(), AppError> {
    validate_resource_name(&payload.name)?;
    crate::platform::config::parse_plugin_manifest(&payload.manifest_json)
        .map_err(AppError::BadRequest)?;
    Ok(())
}

fn validate_provider(payload: &ProviderRequest) -> Result<(), AppError> {
    if payload.name.trim().is_empty() || payload.api_base_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "provider name and API base URL are required".to_string(),
        ));
    }
    Ok(())
}

fn provider_response(
    value: &agent_model_provider_entity::Model,
    models: &[agent_provider_model_entity::Model],
) -> ProviderResponse {
    ProviderResponse {
        id: value.id.clone(),
        name: value.name.clone(),
        kind: value.kind.clone(),
        enabled: value.enabled,
        is_default: value.is_default,
        api_base_url: value.api_base_url.clone(),
        api_key: value.api_key.clone(),
        website_url: value.website_url.clone(),
        default_chat_model: value.default_chat_model.clone(),
        models: models
            .iter()
            .filter(|model| model.provider_id == value.id && model.enabled)
            .map(|model| model.model_id.clone())
            .collect(),
        api_key_configured: !value.api_key.is_empty(),
    }
}

async fn clear_default_provider(
    db: &sea_orm::DatabaseConnection,
    except_id: Option<&str>,
) -> Result<(), AppError> {
    let mut update = AgentModelProviderEntity::update_many()
        .col_expr(
            agent_model_provider_entity::Column::IsDefault,
            sea_orm::sea_query::Expr::value(false),
        )
        .filter(agent_model_provider_entity::Column::IsDefault.eq(true));
    if let Some(id) = except_id {
        update = update.filter(agent_model_provider_entity::Column::Id.ne(id));
    }
    update.exec(db).await?;
    Ok(())
}

async fn insert_provider_model(
    db: &sea_orm::DatabaseConnection,
    provider_id: &str,
    model_id: &str,
    is_default: bool,
) -> Result<(), AppError> {
    agent_provider_model_entity::ActiveModel {
        id: Set(Uuid::new_v4()),
        provider_id: Set(provider_id.to_string()),
        model_id: Set(model_id.to_string()),
        capability: Set("chat".to_string()),
        enabled: Set(true),
        is_default: Set(is_default),
    }
    .insert(db)
    .await?;
    Ok(())
}

async fn sync_provider_models(
    db: &sea_orm::DatabaseConnection,
    provider_id: &str,
    models: &[String],
    default_chat_model: &str,
) -> Result<(), AppError> {
    AgentProviderModelEntity::delete_many()
        .filter(agent_provider_model_entity::Column::ProviderId.eq(provider_id))
        .exec(db)
        .await?;
    let mut normalized = models
        .iter()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !default_chat_model.is_empty() && !normalized.iter().any(|model| model == default_chat_model)
    {
        normalized.push(default_chat_model.to_string());
    }
    normalized.sort();
    normalized.dedup();
    for model in normalized {
        insert_provider_model(db, provider_id, &model, model == default_chat_model).await?;
    }
    Ok(())
}
