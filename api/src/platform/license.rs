//! Platform license validation. The platform never receives a signing private key.

use std::collections::{BTreeMap, HashMap};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::config::{
    PlatformLicenseSettings, load_platform_license_settings, save_platform_license_settings,
};

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAiEmployeeSkill {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub package_name: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub package_path: String,
    pub description: String,
    pub instructions: String,
    #[serde(default)]
    pub environment_values: BTreeMap<String, String>,
    /// Canonical DSH Plugin manifest emitted by the operation center/package
    /// installer. Kept on the signed entitlement so Host can build its
    /// employee-scoped plugin registry without reading the database directly.
    #[serde(default)]
    pub plugin_manifest_json: String,
}

impl PlatformAiEmployeeSkill {
    /// Instructions are model-visible. Skill configuration is execution-only.
    pub(crate) fn execution_instructions(&self) -> String {
        self.instructions.clone()
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAiEmployeeEntitlement {
    pub id: String,
    pub title: String,
    pub expires_at: i64,
    #[serde(default)]
    pub template_version: String,
    #[serde(default)]
    pub skills: Vec<PlatformAiEmployeeSkill>,
    #[serde(default)]
    pub system_prompt: String,
    /// Final platform policy assigned to this AI employee by the operation center.
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub application_ids: Vec<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub knowledge: Option<EmployeeKnowledgeManifest>,
}
#[derive(Clone,Deserialize,Serialize,ToSchema)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct EmployeeKnowledgeFile {pub id:String,pub name:String,pub size:i64,pub sha256:String}
#[derive(Clone,Deserialize,Serialize,ToSchema)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct EmployeeKnowledgeManifest {pub format_version:u32,pub version:String,pub documents:Vec<EmployeeKnowledgeFile>}


/// Signed operation-center plugin metadata. It never contains credentials.
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPluginPackageEntitlement {
    pub id: String,
    pub version: String,
    pub sha256: String,
    pub module: String,
    pub manifest: serde_json::Value,
    pub expires_at: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLicenseClaims {
    pub license_id: String,
    pub subject: String,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default = "default_deployment_type")]
    pub deployment_type: String,
    pub modules: Vec<String>,
    pub exp: usize,
    #[serde(default)]
    pub module_expires_at: HashMap<String, i64>,
    #[serde(default)]
    pub module_titles: HashMap<String, String>,
    #[serde(default)]
    pub ai_employees: Vec<PlatformAiEmployeeEntitlement>,
    #[serde(default)]
    pub plugin_packages: Vec<PlatformPluginPackageEntitlement>,
    pub iss: String,
    pub aud: String,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLicenseStatus {
    pub valid: bool,
    pub reason: Option<String>,
    pub license_center_url: Option<String>,
    pub license_id: Option<String>,
    pub subject: Option<String>,
    pub customer_name: Option<String>,
    pub deployment_type: String,
    pub modules: Vec<String>,
    pub expires_at: Option<i64>,
    pub module_expires_at: HashMap<String, i64>,
    pub module_titles: HashMap<String, String>,
    #[serde(serialize_with = "serialize_public_entitlements")]
    pub ai_employees: Vec<PlatformAiEmployeeEntitlement>,
    pub ai_employee_statuses: HashMap<String, String>,
    pub platform_status: String,
    pub module_statuses: HashMap<String, String>,
    pub update_available: bool,
    pub latest_license_id: Option<String>,
    pub latest_issued_at: Option<i64>,
}

fn serialize_public_entitlements<S: serde::Serializer>(
    employees: &[PlatformAiEmployeeEntitlement],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut value = serde_json::to_value(employees).map_err(serde::ser::Error::custom)?;
    if let Some(items) = value.as_array_mut() {
        for employee in items {
            if let Some(skills) = employee["skills"].as_array_mut() {
                for skill in skills {
                    if let Some(s) = skill.as_object_mut() {
                        s.remove("environmentValues");
                        s.remove("encryptedEnvironmentValues");
                        s.remove("packagePath");
                    }
                }
            }
        }
    }
    value.serialize(serializer)
}

fn default_deployment_type() -> String {
    "saas".to_string()
}

pub fn license_allows_database_configuration() -> bool {
    load_platform_license_settings()
        .and_then(|settings| validate_license_token(&settings.license).ok())
        .is_some_and(|claims| claims.deployment_type == "local")
}

#[derive(Deserialize)]
struct LicenseCenterEnvelope {
    data: Option<LicenseCenterStatus>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseCenterStatus {
    valid: bool,
    #[serde(default)]
    latest_license: Option<String>,
    #[serde(default)]
    latest_license_id: Option<String>,
    #[serde(default)]
    latest_issued_at: Option<i64>,
}

pub struct RemoteLicenseUpdate {
    pub license: String,
    pub license_id: String,
    pub issued_at: Option<i64>,
}

pub fn validate_license_token(token: &str) -> Result<PlatformLicenseClaims, String> {
    decode_license_claims(token, true)
}

fn decode_license_claims(
    token: &str,
    validate_expiration: bool,
) -> Result<PlatformLicenseClaims, String> {
    let public_key = license_public_key()?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = validate_expiration;
    validation.set_issuer(&["yaya-operation-center", "yaya-license-center"]);
    validation.set_audience(&["yaya-low-code"]);
    let claims = decode::<PlatformLicenseClaims>(
        token,
        &DecodingKey::from_rsa_pem(public_key.as_bytes())
            .map_err(|_| "许可证公钥无效".to_string())?,
        &validation,
    )
    .map_err(|_| "许可证无效或已过期".to_string())?
    .claims;
    if !claims.modules.iter().any(|module| module == "platform") {
        return Err("许可证不包含平台授权".to_string());
    }
    Ok(claims)
}

fn license_public_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("YAYA_LICENSE_PUBLIC_KEY_PEM") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    let path = std::env::var_os("YAYA_LICENSE_PUBLIC_KEY_PATH")
        .ok_or_else(|| "许可证公钥未配置".to_string())?;
    std::fs::read_to_string(path).map_err(|_| "许可证公钥无法读取".to_string())
}

pub fn license_status() -> PlatformLicenseStatus {
    let Some(settings) = load_platform_license_settings() else {
        return invalid_status("尚未激活许可证", None);
    };
    match validate_license_token(&settings.license) {
        Ok(claims) => status_from_claims(&settings, claims, true, None),
        Err(reason) => match decode_license_claims(&settings.license, false) {
            Ok(claims) => status_from_claims(&settings, claims, false, Some(reason)),
            Err(_) => invalid_status(&reason, Some(settings.license_center_url)),
        },
    }
}

pub fn license_has_module(module: &str) -> bool {
    let Some(settings) = load_platform_license_settings() else {
        return false;
    };
    validate_license_token(&settings.license).is_ok_and(|claims| {
        claims.modules.iter().any(|candidate| candidate == module)
            && module_expiry(&claims, module) >= chrono::Utc::now().timestamp()
    })
}

pub fn license_module_expires_at(module: &str) -> Option<i64> {
    let settings = load_platform_license_settings()?;
    let claims = validate_license_token(&settings.license).ok()?;
    if license_has_module(module) {
        Some(module_expiry(&claims, module))
    } else {
        None
    }
}

pub async fn validate_license_remotely() -> Result<Option<RemoteLicenseUpdate>, String> {
    let settings = load_platform_license_settings().ok_or_else(|| "尚未激活许可证".to_string())?;
    let claims = validate_license_token(&settings.license)?;
    let url = license_status_url(&settings.license_center_url, &claims.license_id)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|_| "无法创建许可证校验请求".to_string())?
        .get(url)
        .bearer_auth(&settings.license)
        .send()
        .await
        .map_err(|_| "许可中心不可访问".to_string())?;
    if response.status() != StatusCode::OK {
        return Err("许可中心拒绝了许可证校验".to_string());
    }
    let body = response
        .json::<LicenseCenterEnvelope>()
        .await
        .map_err(|_| "许可中心返回了无效响应".to_string())?;
    let status = body
        .data
        .ok_or_else(|| "许可中心返回了无效状态".to_string())?;
    if !status.valid {
        Err("许可证已被吊销或失效".to_string())
    } else {
        if let Some(latest_license) = status.latest_license {
            let latest_claims = validate_license_token(&latest_license)
                .map_err(|_| "许可中心返回了无效的最新许可证".to_string())?;
            if latest_claims.subject != claims.subject {
                return Err("最新许可证主体与当前平台不一致".to_string());
            }
            if latest_claims.license_id != claims.license_id {
                return Ok(Some(RemoteLicenseUpdate {
                    license: latest_license,
                    license_id: status.latest_license_id.unwrap_or(latest_claims.license_id),
                    issued_at: status.latest_issued_at,
                }));
            }
        }
        Ok(None)
    }
}

pub async fn apply_latest_license_remotely() -> Result<bool, String> {
    let Some(update) = validate_license_remotely().await? else {
        return Ok(false);
    };
    let settings = load_platform_license_settings().ok_or_else(|| "尚未激活许可证".to_string())?;
    let updated_settings = PlatformLicenseSettings {
        license_center_url: settings.license_center_url,
        license: update.license,
        activated_at: chrono::Utc::now().to_rfc3339(),
    };
    save_platform_license_settings(&updated_settings)
        .map_err(|_| "最新许可证保存失败".to_string())?;
    mark_license_running_remotely().await?;
    Ok(true)
}

/// Notifies newer license centers that this signed license is in use. Older
/// centers do not expose this endpoint yet, so a 404 remains compatible.
pub async fn mark_license_running_remotely() -> Result<(), String> {
    let settings = load_platform_license_settings().ok_or_else(|| "尚未激活许可证".to_string())?;
    let claims = validate_license_token(&settings.license)?;
    let url = license_activation_url(&settings.license_center_url, &claims.license_id)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|_| "无法创建许可证激活请求".to_string())?
        .post(url)
        .bearer_auth(&settings.license)
        .send()
        .await
        .map_err(|_| "许可中心不可访问".to_string())?;
    if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err("许可中心拒绝了许可证激活".to_string())
    }
}

pub fn validate_license_center_url(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    if !(value.starts_with("https://") || value.starts_with("http://")) {
        return Err("许可中心地址必须使用 HTTP 或 HTTPS".to_string());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "许可中心地址无效".to_string())?;
    if url.host_str().is_none() || url.port().is_none() {
        return Err("许可中心地址必须包含主机和端口".to_string());
    }
    Ok(value.to_string())
}

fn license_status_url(base_url: &str, license_id: &str) -> Result<reqwest::Url, String> {
    let base_url = validate_license_center_url(base_url)?;
    reqwest::Url::parse(&format!("{base_url}/api/licenses/{license_id}/status"))
        .map_err(|_| "许可中心地址无效".to_string())
}

fn license_activation_url(base_url: &str, license_id: &str) -> Result<reqwest::Url, String> {
    let base_url = validate_license_center_url(base_url)?;
    reqwest::Url::parse(&format!("{base_url}/api/licenses/{license_id}/activate"))
        .map_err(|_| "许可中心地址无效".to_string())
}

fn status_from_claims(
    settings: &PlatformLicenseSettings,
    claims: PlatformLicenseClaims,
    valid: bool,
    reason: Option<String>,
) -> PlatformLicenseStatus {
    let module_titles = claims
        .modules
        .iter()
        .map(|module| {
            (
                module.clone(),
                claims
                    .module_titles
                    .get(module)
                    .cloned()
                    .unwrap_or_else(|| default_module_title(module)),
            )
        })
        .collect();
    let module_expires_at = claims
        .modules
        .iter()
        .map(|module| (module.clone(), module_expiry(&claims, module)))
        .collect();
    let module_statuses = claims
        .modules
        .iter()
        .map(|module| {
            let running = valid && module_expiry(&claims, module) >= chrono::Utc::now().timestamp();
            (
                module.clone(),
                if running {
                    "running".to_string()
                } else {
                    "expired".to_string()
                },
            )
        })
        .collect();
    let ai_employee_statuses = claims
        .ai_employees
        .iter()
        .map(|entitlement| {
            (
                entitlement.id.clone(),
                if valid && entitlement.expires_at >= chrono::Utc::now().timestamp() {
                    "running".to_string()
                } else {
                    "expired".to_string()
                },
            )
        })
        .collect();
    PlatformLicenseStatus {
        valid,
        reason,
        license_center_url: Some(settings.license_center_url.clone()),
        license_id: Some(claims.license_id),
        subject: Some(claims.subject),
        customer_name: claims.customer_name.filter(|name| !name.trim().is_empty()),
        deployment_type: claims.deployment_type,
        modules: claims.modules,
        expires_at: Some(claims.exp as i64),
        module_expires_at,
        module_titles,
        ai_employees: claims.ai_employees,
        ai_employee_statuses,
        platform_status: if valid {
            "running".to_string()
        } else {
            "expired".to_string()
        },
        module_statuses,
        update_available: false,
        latest_license_id: None,
        latest_issued_at: None,
    }
}

fn invalid_status(reason: &str, license_center_url: Option<String>) -> PlatformLicenseStatus {
    PlatformLicenseStatus {
        valid: false,
        reason: Some(reason.to_string()),
        license_center_url,
        license_id: None,
        subject: None,
        customer_name: None,
        deployment_type: default_deployment_type(),
        modules: Vec::new(),
        expires_at: None,
        module_expires_at: HashMap::new(),
        module_titles: HashMap::new(),
        ai_employees: Vec::new(),
        ai_employee_statuses: HashMap::new(),
        platform_status: "expired".to_string(),
        module_statuses: HashMap::new(),
        update_available: false,
        latest_license_id: None,
        latest_issued_at: None,
    }
}

fn module_expiry(claims: &PlatformLicenseClaims, module: &str) -> i64 {
    claims
        .module_expires_at
        .get(module)
        .copied()
        .unwrap_or(claims.exp as i64)
}

fn default_module_title(module: &str) -> String {
    match module {
        "platform" => "低代码平台".to_string(),
        "communication" => "通讯模型".to_string(),
        _ => module.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{LicenseCenterEnvelope, PlatformAiEmployeeSkill};

    #[test]
    fn customer_identity_survives_license_status_and_legacy_claims() {
        let mut value = serde_json::json!({
            "licenseId": "lic_test", "subject": "cus_test", "customerName": "测试客户",
            "modules": ["platform"], "exp": 2000000000,
            "iss": "test", "aud": "test"
        });
        let settings = super::PlatformLicenseSettings {
            license_center_url: "http://localhost:8779".into(),
            license: "test".into(),
            activated_at: "2026-11-11T00:00:00Z".into(),
        };
        let claims = serde_json::from_value(value.clone()).unwrap();
        let status = super::status_from_claims(&settings, claims, true, None);
        let response = serde_json::to_value(status).unwrap();
        assert_eq!(response["customerName"], "测试客户");
        assert_eq!(response["subject"], "cus_test");

        value.as_object_mut().unwrap().remove("customerName");
        let claims = serde_json::from_value(value).unwrap();
        let status = super::status_from_claims(&settings, claims, true, None);
        assert_eq!(status.customer_name, None);
        assert_eq!(status.subject.as_deref(), Some("cus_test"));
    }
    #[test]
    fn skill_environment_configuration_survives_package_roundtrip_and_is_scoped() {
        let legacy = serde_json::json!({"id":"generic", "title":"Generic", "description":"", "instructions":"run"});
        let unconfigured: PlatformAiEmployeeSkill = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(unconfigured.execution_instructions(), "run");
        let mut configured = legacy;
        configured["environmentValues"] = serde_json::json!({"CUSTOM_ENDPOINT":"https://example.com", "CUSTOM_TOKEN":"test-only-token"});
        let skill: PlatformAiEmployeeSkill = serde_json::from_value(configured).unwrap();
        let installed: PlatformAiEmployeeSkill =
            serde_json::from_str(&serde_json::to_string(&skill).unwrap()).unwrap();
        assert_eq!(
            installed.environment_values["CUSTOM_ENDPOINT"],
            "https://example.com"
        );
        assert!(!installed.execution_instructions().contains("CUSTOM_TOKEN"));
        assert!(
            !installed
                .execution_instructions()
                .contains("test-only-token")
        );
        assert!(!installed.execution_instructions().contains("--library-url"));
        assert_eq!(installed.instructions, "run");
        assert_eq!(unconfigured.execution_instructions(), "run");
    }

    #[test]
    fn deserializes_latest_license_fields_from_operation_center() {
        let envelope: LicenseCenterEnvelope = serde_json::from_str(
            r#"{"data":{"valid":true,"latestLicense":"signed-token","latestLicenseId":"lic_new","latestIssuedAt":123}}"#,
        )
        .expect("operation center response should deserialize");
        let status = envelope.data.expect("status should be present");

        assert_eq!(status.latest_license.as_deref(), Some("signed-token"));
        assert_eq!(status.latest_license_id.as_deref(), Some("lic_new"));
        assert_eq!(status.latest_issued_at, Some(123));
    }
}
