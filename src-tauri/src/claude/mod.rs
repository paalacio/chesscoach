//! Talking to Claude through the Claude Code CLI (`claude -p`), which uses the
//! Claude subscription of whoever is logged in on this computer.
//!
//! Everything goes through the `ClaudeService` trait so a different backend
//! (e.g. one using an API key) could be added later without touching the app.

pub mod locate;
pub mod parse;

pub use parse::{AuthStatus, ClaudeError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// Bump this whenever the system prompt, schemas or context packet change in a
/// way that should invalidate cached answers.
pub const PROMPT_VERSION: u32 = 1;

pub const SYSTEM_PROMPT: &str = include_str!("../../prompts/coach-system.md");

/// How long one answer may take before we give up.
pub const TIMEOUT: Duration = Duration::from_secs(90);

/// The kinds of questions the app asks. Each has its own JSON schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestKind {
    /// A tiny test question used by the setup screen.
    Hello,
    MoveExplanation,
    PositionPlan,
    /// A whole game: summary, 3 lessons, key moments (one call per game).
    GameReview,
    /// The engine's best move and the other good moves, compared.
    BestMoves,
    /// "Explain this opening": plans, structure, traps, typical mistakes.
    OpeningOverview,
}

impl RequestKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestKind::Hello => "hello",
            RequestKind::MoveExplanation => "moveExplanation",
            RequestKind::PositionPlan => "positionPlan",
            RequestKind::GameReview => "gameReview",
            RequestKind::BestMoves => "bestMoves",
            RequestKind::OpeningOverview => "openingOverview",
        }
    }

    pub fn schema(self) -> &'static str {
        match self {
            RequestKind::Hello => include_str!("../../prompts/schemas/hello.json"),
            RequestKind::MoveExplanation => include_str!("../../prompts/schemas/move_explanation.json"),
            RequestKind::PositionPlan => include_str!("../../prompts/schemas/position_plan.json"),
            RequestKind::GameReview => include_str!("../../prompts/schemas/game_review.json"),
            RequestKind::BestMoves => include_str!("../../prompts/schemas/best_moves.json"),
            RequestKind::OpeningOverview => include_str!("../../prompts/schemas/opening_overview.json"),
        }
    }
}

/// The cache key for an answer: hash of everything that would change it
/// (including the app language, since Claude answers in it).
pub fn cache_key(kind: RequestKind, fen: &str, move_played: Option<&str>, model: &str, language: &str) -> String {
    let mut h = Sha256::new();
    for part in [kind.as_str(), fen, move_played.unwrap_or("-"), model, language, &PROMPT_VERSION.to_string()] {
        h.update(part.as_bytes());
        h.update([0u8]); // separator, so "ab"+"c" != "a"+"bc"
    }
    hex::encode(h.finalize())
}

pub struct StructuredRequest {
    pub kind: RequestKind,
    /// The user message: instructions plus the context packet.
    pub prompt: String,
    pub model: String,
}

#[derive(Debug, Clone)]
pub struct StructuredReply {
    pub data: Value,
    pub session_id: Option<String>,
}

/// Something that can answer structured questions. Only the CLI version exists today.
#[allow(async_fn_in_trait)]
pub trait ClaudeService {
    async fn ask_structured(&self, req: StructuredRequest) -> Result<StructuredReply, ClaudeError>;
    fn cancel(&self);
}

/// Runs `claude -p` as a child process.
pub struct CliClaude {
    /// Empty folder the CLI runs in, so no project CLAUDE.md gets loaded.
    workdir: PathBuf,
    system_prompt_file: PathBuf,
    custom_path: Mutex<Option<String>>,
    /// Only one call at a time: each call waits for this lock.
    queue: tokio::sync::Mutex<()>,
    /// Wakes the running call when the user presses Cancel.
    cancel_signal: tokio::sync::Notify,
}

impl CliClaude {
    /// `data_dir` is the app's data folder; we create our working folder inside it.
    pub fn new(data_dir: &Path) -> std::io::Result<Self> {
        let workdir = data_dir.join("claude-workdir");
        std::fs::create_dir_all(&workdir)?;
        let prompts = data_dir.join("prompts");
        std::fs::create_dir_all(&prompts)?;
        let system_prompt_file = prompts.join("coach-system.md");
        std::fs::write(&system_prompt_file, SYSTEM_PROMPT)?;
        Ok(Self {
            workdir,
            system_prompt_file,
            custom_path: Mutex::new(None),
            queue: tokio::sync::Mutex::new(()),
            cancel_signal: tokio::sync::Notify::new(),
        })
    }

    pub fn set_custom_path(&self, path: Option<String>) {
        *self.custom_path.lock().unwrap() = path;
    }

    pub fn binary(&self) -> Result<PathBuf, ClaudeError> {
        let custom = self.custom_path.lock().unwrap().clone();
        locate::find_claude(custom.as_deref()).ok_or(ClaudeError::NotFound)
    }

    /// A `claude` command with a clean environment and our working folder.
    fn command(&self, bin: &Path) -> tokio::process::Command {
        let mut std_cmd = std::process::Command::new(bin);
        std_cmd.current_dir(&self.workdir);
        // Variables that would make the CLI think it runs inside another Claude Code
        // session, or switch it from the subscription login to an API key / proxy.
        for (key, _) in std::env::vars_os() {
            let Some(key) = key.to_str() else { continue };
            if key == "CLAUDECODE"
                || key.starts_with("CLAUDE_CODE_")
                || key.starts_with("CLAUDE_AGENT_SDK")
                || matches!(key, "CLAUDE_PID" | "CLAUDE_EFFORT" | "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_BASE_URL")
            {
                std_cmd.env_remove(key);
            }
        }
        crate::engine::hide_console_window(&mut std_cmd);
        let mut cmd = tokio::process::Command::from(std_cmd);
        cmd.kill_on_drop(true);
        cmd
    }

    /// `claude --version`, e.g. "2.1.311 (Claude Code)".
    pub async fn version(&self) -> Result<String, ClaudeError> {
        let out = self.run_simple(&["--version"]).await?;
        Ok(out.trim().to_string())
    }

    /// `claude auth status` (JSON).
    pub async fn auth_status(&self) -> Result<AuthStatus, ClaudeError> {
        let out = self.run_simple(&["auth", "status"]).await?;
        parse::parse_auth_status(&out)
    }

    async fn run_simple(&self, args: &[&str]) -> Result<String, ClaudeError> {
        let bin = self.binary()?;
        let mut cmd = self.command(&bin);
        cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let out = tokio::time::timeout(Duration::from_secs(20), cmd.output())
            .await
            .map_err(|_| ClaudeError::Timeout(20))?
            .map_err(|e| ClaudeError::Failed(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.trim().is_empty() {
            return Err(parse::classify_error_text(&String::from_utf8_lossy(&out.stderr)));
        }
        Ok(stdout)
    }
}

impl ClaudeService for CliClaude {
    async fn ask_structured(&self, req: StructuredRequest) -> Result<StructuredReply, ClaudeError> {
        let _turn = self.queue.lock().await; // wait for any earlier call to finish
        let bin = self.binary()?;

        let mut cmd = self.command(&bin);
        cmd.arg("-p")
            .args(["--output-format", "json"])
            .args(["--json-schema", req.kind.schema()])
            .arg("--system-prompt-file")
            .arg(&self.system_prompt_file)
            // No tools at all: smaller requests, and Claude can't touch the disk.
            .args(["--tools", "", "--disallowedTools", "mcp__*"])
            .args(["--model", &req.model])
            .arg("--no-session-persistence")
            // Ignore the user's own CLAUDE.md, plugins, hooks and MCP servers.
            .arg("--safe-mode")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ClaudeError::NotFound,
            _ => ClaudeError::Failed(e.to_string()),
        })?;
        let pid = child.id();

        // The prompt goes in through stdin (safer than a long command-line argument).
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(req.prompt.as_bytes())
                .await
                .map_err(|e| ClaudeError::Failed(format!("could not send the prompt: {e}")))?;
        }

        // Wait for the answer, the timeout, or Cancel, whichever comes first.
        // Dropping `wait` drops the child, and `kill_on_drop` then ends the process.
        let wait = child.wait_with_output();
        tokio::pin!(wait);
        let output = tokio::select! {
            out = &mut wait => out.map_err(|e| ClaudeError::Failed(e.to_string()))?,
            _ = tokio::time::sleep(TIMEOUT) => return Err(ClaudeError::Timeout(TIMEOUT.as_secs())),
            _ = self.cancel_signal.notified() => {
                interrupt(pid);
                // Give the CLI up to 3 s to exit cleanly before it gets killed.
                let _ = tokio::time::timeout(Duration::from_secs(3), &mut wait).await;
                return Err(ClaudeError::Cancelled);
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let parsed = parse::parse_cli_output(&stdout, &stderr)?;
        Ok(StructuredReply { data: parsed.structured_output, session_id: parsed.session_id })
    }

    /// Stops the running call, if any.
    fn cancel(&self) {
        // notify_waiters only wakes a call that is waiting right now, so pressing
        // Cancel when nothing runs doesn't cancel the next call.
        self.cancel_signal.notify_waiters();
    }
}

/// On macOS/Linux, send Ctrl+C (SIGINT) so the CLI can exit cleanly.
/// On Windows there is no simple equivalent: the process is killed when dropped,
/// and that turn is lost.
fn interrupt(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        // SAFETY: kill() only sends a signal to the process id of our own child,
        // which is still running (we hold its handle, so the id can't be reused).
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGINT);
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_changes_with_every_input() {
        let fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
        let base = cache_key(RequestKind::PositionPlan, fen, None, "sonnet", "en");
        assert_eq!(base, cache_key(RequestKind::PositionPlan, fen, None, "sonnet", "en"), "stable");
        assert_eq!(base.len(), 64);
        assert_ne!(base, cache_key(RequestKind::MoveExplanation, fen, None, "sonnet", "en"));
        assert_ne!(base, cache_key(RequestKind::PositionPlan, fen, Some("e2e4"), "sonnet", "en"));
        assert_ne!(base, cache_key(RequestKind::PositionPlan, fen, None, "opus", "en"));
        assert_ne!(base, cache_key(RequestKind::PositionPlan, fen, None, "sonnet", "pt"));
    }

    #[test]
    fn every_schema_is_valid_json_with_required_fields() {
        for kind in [RequestKind::Hello, RequestKind::MoveExplanation, RequestKind::PositionPlan, RequestKind::GameReview, RequestKind::BestMoves, RequestKind::OpeningOverview] {
            let v: Value = serde_json::from_str(kind.schema()).expect(kind.as_str());
            assert_eq!(v["type"], "object");
            assert!(v["required"].as_array().is_some_and(|r| !r.is_empty()));
        }
    }

    #[test]
    fn creates_an_empty_working_folder_and_the_prompt_file() {
        let dir = tempfile::tempdir().unwrap();
        let c = CliClaude::new(dir.path()).unwrap();
        assert!(c.workdir.is_dir());
        assert_eq!(std::fs::read_dir(&c.workdir).unwrap().count(), 0);
        assert_eq!(std::fs::read_to_string(&c.system_prompt_file).unwrap(), SYSTEM_PROMPT);
    }
}
