//! Transport-level response envelope shared by every API domain.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub(crate) struct ApiResponse<T>
where
    T: Serialize,
{
    pub(crate) code: i32,
    pub(crate) message: String,
    pub(crate) data: Option<T>,
    pub(crate) time: String,
}
