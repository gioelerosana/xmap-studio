//! Errore serializzabile verso il frontend. Il `code` permette alla UI di
//! reagire (es. proporre "Salva comunque" su conflitto o su XMind aperto).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

impl ErrorPayload {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ErrorPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ErrorPayload {}

pub const CODE_XMIND_RUNNING: &str = "xmind_running";
pub const CODE_CONFLICT: &str = "conflict";
pub const CODE_LATEX: &str = "latex";
pub const CODE_NO_WORKBOOK: &str = "no_workbook";
pub const CODE_TOPIC_NOT_FOUND: &str = "topic_not_found";
pub const CODE_RENDERER: &str = "renderer";
pub const CODE_VALIDATION: &str = "validation";
pub const CODE_IO: &str = "io";
pub const CODE_FORMAT: &str = "format";
pub const CODE_MOVE: &str = "move";

/// Converte un `anyhow::Error` in payload, usando IO come fallback.
pub fn from_anyhow(e: anyhow::Error) -> ErrorPayload {
    ErrorPayload::new(CODE_IO, format!("{e:#}"))
}
