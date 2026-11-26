//! Turning the `claude -p --output-format json` output into data or a clear error.

use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;

/// Everything that can go wrong when asking Claude. The messages are shown in the UI.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ClaudeError {
    #[error("Claude Code was not found. Install it (see the setup screen) or set its path in Settings.")]
    NotFound,
    #[error("Claude Code is not logged in. Open a terminal, run `claude` and log in with your Claude account.")]
    NotLoggedIn,
    #[error("You've reached your Claude usage limit for now. {0}")]
    UsageLimit(String),
    #[error("Claude took longer than {0} seconds and was stopped. Try again.")]
    Timeout(u64),
    #[error("Cancelled.")]
    Cancelled,
    #[error("Claude's answer didn't contain the expected data. Try again.")]
    MissingStructuredOutput,
    #[error("Claude Code failed: {0}")]
    Failed(String),
}

impl ClaudeError {
    pub fn kind(&self) -> &'static str {
        match self {
            ClaudeError::NotFound => "notFound",
            ClaudeError::NotLoggedIn => "notLoggedIn",
            ClaudeError::UsageLimit(_) => "usageLimit",
            ClaudeError::Timeout(_) => "timeout",
            ClaudeError::Cancelled => "cancelled",
            ClaudeError::MissingStructuredOutput => "missingStructuredOutput",
            ClaudeError::Failed(_) => "failed",
        }
    }
}

/// Sent to the frontend as `{ "kind": "...", "message": "..." }`.
impl Serialize for ClaudeError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("ClaudeError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

/// The fields we use from the CLI's JSON result.
#[derive(Debug, Deserialize)]
struct RawResult {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    structured_output: Option<Value>,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CliResult {
    pub structured_output: Value,
    pub session_id: Option<String>,
}

/// Parses stdout of `claude -p --output-format json`. `stderr` is used to explain
/// failures when stdout is empty.
pub fn parse_cli_output(stdout: &str, stderr: &str) -> Result<CliResult, ClaudeError> {
    // Normally stdout is exactly one JSON object. To be safe, take the last line
    // (or the whole text) that parses as a `"type": "result"` object.
    let raw = std::iter::once(stdout.trim())
        .chain(stdout.lines().rev().map(str::trim))
        .filter(|s| s.starts_with('{'))
        .find_map(|s| serde_json::from_str::<RawResult>(s).ok().filter(|r| r.kind.as_deref() == Some("result")));

    let Some(raw) = raw else {
        let text = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(classify_error_text(text));
    };

    if raw.is_error {
        return Err(classify_error_text(raw.result.as_deref().unwrap_or("unknown error")));
    }
    match raw.structured_output {
        Some(v) if v.is_object() => Ok(CliResult { structured_output: v, session_id: raw.session_id }),
        _ => Err(ClaudeError::MissingStructuredOutput),
    }
}

/// Maps an error message from the CLI to one of our error kinds.
/// The exact wording changes between Claude Code versions, so we look for keywords.
pub fn classify_error_text(text: &str) -> ClaudeError {
    let lower = text.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| lower.contains(w));
    if has(&["usage limit", "hit your limit", "limit reached", "rate limit", "out of extra usage"]) {
        ClaudeError::UsageLimit(text.trim().to_string())
    } else if has(&["not logged in", "/login", "invalid api key", "authentication", "oauth token"]) {
        ClaudeError::NotLoggedIn
    } else {
        let mut msg = text.trim().to_string();
        if msg.is_empty() {
            msg = "no output".into();
        }
        msg.truncate(500);
        ClaudeError::Failed(msg)
    }
}

/// Output of `claude auth status` (JSON by default).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub logged_in: bool,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub subscription_type: Option<String>,
}

impl AuthStatus {
    /// True when Claude Code uses a Claude subscription login (what ChessCoach expects).
    pub fn uses_subscription(&self) -> bool {
        self.logged_in && self.auth_method.as_deref() == Some("claude.ai")
    }
}

pub fn parse_auth_status(json: &str) -> Result<AuthStatus, ClaudeError> {
    serde_json::from_str(json.trim()).map_err(|_| classify_error_text(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = format!("{}/tests/fixtures/claude/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn reads_structured_output_from_a_real_result() {
        let r = parse_cli_output(&fixture("success.json"), "").unwrap();
        assert_eq!(r.structured_output["greeting"], "Hello! Welcome to chess coaching.");
        assert_eq!(r.session_id.as_deref(), Some("c21d28e6-4f22-4900-9767-71d2e67e8d3b"));
    }

    #[test]
    fn missing_structured_output_is_an_error() {
        assert_eq!(
            parse_cli_output(&fixture("missing_structured.json"), ""),
            Err(ClaudeError::MissingStructuredOutput)
        );
    }

    #[test]
    fn recognises_usage_limit_and_login_errors() {
        assert!(matches!(parse_cli_output(&fixture("usage_limit.json"), ""), Err(ClaudeError::UsageLimit(_))));
        assert_eq!(parse_cli_output(&fixture("not_logged_in.json"), ""), Err(ClaudeError::NotLoggedIn));
        assert!(matches!(
            classify_error_text("Claude AI usage limit reached|1767225600"),
            ClaudeError::UsageLimit(_)
        ));
        assert_eq!(classify_error_text("Invalid API key · Please run /login"), ClaudeError::NotLoggedIn);
    }

    #[test]
    fn empty_stdout_uses_stderr() {
        let err = parse_cli_output("", "error: unknown option '--foo'").unwrap_err();
        assert_eq!(err, ClaudeError::Failed("error: unknown option '--foo'".into()));
    }

    #[test]
    fn tolerates_extra_lines_before_the_json() {
        let out = format!("some warning\n{}", fixture("success.json").replace('\n', ""));
        assert!(parse_cli_output(&out, "").is_ok());
    }

    #[test]
    fn errors_serialize_with_kind_and_message() {
        let v = serde_json::to_value(ClaudeError::Timeout(90)).unwrap();
        assert_eq!(v["kind"], "timeout");
        assert!(v["message"].as_str().unwrap().contains("90"));
    }

    #[test]
    fn parses_auth_status() {
        let ok = parse_auth_status(&fixture("auth_status_ok.json")).unwrap();
        assert!(ok.uses_subscription());
        assert_eq!(ok.subscription_type.as_deref(), Some("pro"));
        let out = parse_auth_status(&fixture("auth_status_logged_out.json")).unwrap();
        assert!(!out.logged_in);
        assert!(!out.uses_subscription());
    }
}
