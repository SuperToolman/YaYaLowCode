//! Platform license validation. The platform never receives a signing private key.

use std::collections::HashMap;

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::config::{PlatformLicenseSettings, load_platform_license_settings};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLicenseClaims {
    pub license_id: String,
    pub subject: String,
    pub modules: Vec<String>,
    pub exp: usize,
    #[serde(default)]
    pub module_expires_at: HashMap<String, i64>,
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
    pub modules: Vec<String>,
    pub expires_at: Option<i64>,
    pub module_expires_at: HashMap<String, i64>,
    pub platform_status: String,
    pub module_statuses: HashMap<String, String>,
}

#[derive(Deserialize)]
struct LicenseCenterEnvelope {
    data: Option<LicenseCenterStatus>,
}

#[derive(Deserialize)]
struct LicenseCenterStatus {
    valid: bool,
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
    validation.set_issuer(&["yaya-license-center"]);
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

pub async fn validate_license_remotely() -> Result<(), String> {
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
    if body.data.is_some_and(|status| status.valid) {
        Ok(())
    } else {
        Err("许可证已被吊销或失效".to_string())
    }
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
    PlatformLicenseStatus {
        valid,
        reason,
        license_center_url: Some(settings.license_center_url.clone()),
        license_id: Some(claims.license_id),
        subject: Some(claims.subject),
        modules: claims.modules,
        expires_at: Some(claims.exp as i64),
        module_expires_at,
        platform_status: if valid {
            "running".to_string()
        } else {
            "expired".to_string()
        },
        module_statuses,
    }
}

fn invalid_status(reason: &str, license_center_url: Option<String>) -> PlatformLicenseStatus {
    PlatformLicenseStatus {
        valid: false,
        reason: Some(reason.to_string()),
        license_center_url,
        license_id: None,
        subject: None,
        modules: Vec::new(),
        expires_at: None,
        module_expires_at: HashMap::new(),
        platform_status: "expired".to_string(),
        module_statuses: HashMap::new(),
    }
}

fn module_expiry(claims: &PlatformLicenseClaims, module: &str) -> i64 {
    claims
        .module_expires_at
        .get(module)
        .copied()
        .unwrap_or(claims.exp as i64)
}
