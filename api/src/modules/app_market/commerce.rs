//! Customer commerce proxy. The operations service owns prices, orders and entitlements.
use super::*;
#[derive(Clone, Serialize, Deserialize, utoipa::ToSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommercialConfig {
    pub pricing_mode: String,
    pub price_cents: i64,
    pub currency: String,
    pub license_model: String,
    pub publisher_rate_basis_points: i64,
    pub description: String,
}
impl CommercialConfig {
    pub(super) fn validate(&self) -> Result<(), AppError> {
        if self.currency != "CNY"
            || self.license_model != "one_time"
            || self.description.trim().is_empty()
            || self.description.len() > 10000
            || !(0..=10000).contains(&self.publisher_rate_basis_points)
            || self.price_cents > 100_000_000
            || !match self.pricing_mode.as_str() {
                "free" => self.price_cents == 0 && self.publisher_rate_basis_points == 0,
                "paid" => self.price_cents > 0,
                _ => false,
            }
        {
            return Err(AppError::BadRequest(
                "商业资料无效，请检查价格、说明和发布者分成".into(),
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CheckoutRequest {
    pub idempotency_key: String,
    pub commercial_id: String,
}
pub(crate) async fn checkout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product): Path<String>,
    Json(request): Json<CheckoutRequest>,
) -> Result<Json<ApiResponse<ApplicationOrder>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    market_request(
        "POST",
        &format!("/api/market/applications/{product}/checkout"),
        Some(
            json!({"idempotencyKey":request.idempotency_key,"commercialId":request.commercial_id}),
        ),
    )
    .await
    .and_then(typed_market_response)
}
pub(crate) async fn orders(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApplicationOrder>>>, AppError> {
    authorization::current_user(&headers, &state).await?;
    market_request("GET", "/api/market/application-orders", None)
        .await
        .and_then(typed_market_response)
}
pub(crate) async fn revenues(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ApplicationRevenue>>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    market_request("GET", "/api/market/application-revenues", None)
        .await
        .and_then(typed_market_response)
}
pub(crate) async fn simulate_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order): Path<String>,
) -> Result<Json<ApiResponse<ApplicationOrder>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    market_request(
        "POST",
        &format!("/api/market/application-orders/{order}/simulate-payment"),
        Some(json!({})),
    )
    .await
    .and_then(typed_market_response)
}
pub(crate) async fn order_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<ApiResponse<ApplicationOrder>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    market_request(
        "POST",
        &format!("/api/market/application-orders/{order}/action"),
        Some(body),
    )
    .await
    .and_then(typed_market_response)
}

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommercialVersion {
    pub id: String,
    pub release_id: String,
    pub config: CommercialConfig,
    pub status: String,
    pub reason: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommercialSubmission {
    pub release_id: String,
    pub config: CommercialConfig,
}
pub(crate) async fn commercial_versions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product): Path<String>,
) -> Result<Json<ApiResponse<Vec<CommercialVersion>>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    market_request(
        "GET",
        &format!("/api/market/applications/{product}/commercial"),
        None,
    )
    .await
    .and_then(typed_market_response)
}
pub(crate) async fn submit_commercial(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product): Path<String>,
    Json(body): Json<CommercialSubmission>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    super::installation::manage(&state, &headers).await?;
    body.config.validate()?;
    market_request(
        "POST",
        &format!("/api/market/applications/{product}/commercial"),
        Some(json!({"releaseId":body.release_id,"config":body.config})),
    )
    .await
}
