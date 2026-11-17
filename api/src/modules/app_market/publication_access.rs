use super::*;

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicationCapabilities {
    pub enabled: bool,
    pub can_publish: bool,
}

fn enabled_value(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
}

fn enabled() -> bool {
    enabled_value(std::env::var("YAYA_MARKET_PUBLICATION_ENABLED").ok().as_deref())
}

fn require_access(enabled: bool, administrator: bool) -> Result<(), AppError> {
    if !enabled {
        return Err(AppError::Forbidden("当前环境未开启应用上线申请与应用包导出".into()));
    }
    if !administrator {
        return Err(AppError::Forbidden("仅超级管理员可以申请上线或导出应用包".into()));
    }
    Ok(())
}

pub(super) fn require_enabled() -> Result<(), AppError> {
    require_access(enabled(), true)
}

pub(super) fn require_administrator(grants: &HashSet<String>) -> Result<(), AppError> {
    require_access(true, grants.contains("*"))
}

pub(crate) async fn publication_capabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<PublicationCapabilities>>, AppError> {
    let grants = authorization::grants(&headers, &state).await?;
    let enabled = enabled();
    Ok(Json(success_response("应用发布能力已读取", PublicationCapabilities {
        enabled,
        can_publish: require_access(enabled, grants.contains("*")).is_ok(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_is_opt_in_and_requires_an_administrator() {
        for value in [None, Some(""), Some("false"), Some("1"), Some("yes")] {
            assert!(!enabled_value(value));
        }
        assert!(enabled_value(Some(" true ")));
        assert!(enabled_value(Some("TRUE")));
        assert!(require_access(false, true).is_err());
        assert!(require_access(false, false).is_err());
        assert!(require_access(true, false).is_err());
        assert!(require_access(true, true).is_ok());
        assert!(require_administrator(&HashSet::from(["market.apps.manage".into()])).is_err());
        assert!(require_administrator(&HashSet::from(["*".into()])).is_ok());
    }
}
