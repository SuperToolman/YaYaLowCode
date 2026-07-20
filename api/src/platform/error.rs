//! Canonical API error mapping.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sea_orm::DbErr;
use tracing::error;

use crate::shared::error_response;

#[derive(Debug)]
pub(crate) enum AppError {
    Database(DbErr),
    NotFound(String),
    BadRequest(String),
    Forbidden(String),
    Address(std::net::AddrParseError),
    Server(std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::Database(err) => {
                error!("database error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "database error")),
                )
                    .into_response()
            }
            Self::NotFound(message) => {
                (StatusCode::NOT_FOUND, Json(error_response(404, message))).into_response()
            }
            Self::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(error_response(400, message))).into_response()
            }
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, Json(error_response(403, message))).into_response(),
            Self::Address(err) => {
                error!("address parse error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "server configuration error")),
                )
                    .into_response()
            }
            Self::Server(err) => {
                error!("server error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(500, "server error")),
                )
                    .into_response()
            }
        }
    }
}

impl From<DbErr> for AppError {
    fn from(value: DbErr) -> Self {
        Self::Database(value)
    }
}

impl From<std::net::AddrParseError> for AppError {
    fn from(value: std::net::AddrParseError) -> Self {
        Self::Address(value)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Server(value)
    }
}
