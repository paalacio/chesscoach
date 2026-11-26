//! Tauri commands: the functions the frontend calls with `invoke("name", args)`.
//!
//! All commands are `async` so Tauri runs them off the main thread and the window
//! never freezes. Slow blocking work (starting the engine) runs in `spawn_blocking`.

use crate::AppState;
use crate::chesscom::{self, Archive, ChessComError};
use crate::claude::{self, ClaudeError, ClaudeService, RequestKind, StructuredRequest};
use crate::db;
use crate::games::{self, GameDetail, GameSummary, SyncReport, TrainingCard};
use crate::review::WorkerStatus;
use crate::engine::{self, AnalyzeOptions, EngineEvent, EngineStatus};
use crate::settings::{self, Settings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Errors as the frontend sees them: `{ kind, message, detail }`. The frontend
/// shows a translated message for known kinds (filled in with `detail`) and
/// falls back to the English `message`.
#[derive(Debug, Serialize)]
pub struct CmdError {
    kind: String,
    message: String,
    detail: Option<String>,
}

impl CmdError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into(), detail: None }
    }
}

impl From<String> for CmdError {
    fn from(message: String) -> Self {
        Self::new("error", message)
    }
}
impl From<ClaudeError> for CmdError {
    fn from(e: ClaudeError) -> Self {
        Self { kind: e.kind().into(), message: e.to_string(), detail: e.detail() }
    }
}
impl From<ChessComError> for CmdError {
    fn from(e: ChessComError) -> Self {
        Self { kind: e.kind().into(), message: e.to_string(), detail: e.detail() }
    }
}
impl From<rusqlite::Error> for CmdError {
    fn from(e: rusqlite::Error) -> Self {
        Self::new("database", e.to_string())
    }
}

type CmdResult<T> = Result<T, CmdError>;

// ---------- app & settings ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    os: &'static str,
    default_threads: u32,
}

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    Ok(AppInfo {
        version: state.app_version.clone(),
        data_dir: state.data_dir.display().to_string(),
        os: std::env::consts::OS,
        default_threads: engine::default_threads(),
    })
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CmdResult<Settings> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    settings::save(&state.settings_path, &settings)?;
    let old = std::mem::replace(&mut *state.settings.lock().unwrap(), settings.clone());
    if old.language != settings.language {
        // Rebuild the native menu bar in the new language.
        let menu = crate::menu::build(&app, &settings.language).map_err(|e| e.to_string())?;
        app.set_menu(menu).map_err(|e| e.to_string())?;
    }
    if old.auto_analyze != settings.auto_analyze {
        state.review.set_paused(!settings.auto_analyze);
    }
    state.claude.set_custom_path(Some(settings.claude_path.clone()));
    // Engine settings changed: stop it; it restarts with the new ones when next needed.
    if old.engine_path != settings.engine_path
        || old.engine_threads != settings.engine_threads
        || old.engine_hash_mb != settings.engine_hash_mb
    {
        state.engine.shutdown();
    }
    Ok(settings)
}

// ---------- engine ----------

/// Starts the engine with the current settings (no-op if it's already running).
fn start_engine(app: &AppHandle) -> Result<EngineStatus, String> {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let path = engine::resolve_engine_path(Some(&s.engine_path))?;
    let threads = s.engine_threads.unwrap_or_else(engine::default_threads);
    let handle = app.clone();
    let emit: engine::Emit = Arc::new(move |ev: EngineEvent| {
        let _ = handle.emit("engine:event", ev);
    });
    state.engine.start(&path, threads, s.engine_hash_mb, emit)?;
    Ok(state.engine.status())
}

#[tauri::command]
pub async fn engine_start(app: AppHandle) -> CmdResult<EngineStatus> {
    // The UCI handshake blocks for a moment, so run it on a blocking thread.
    let status = tauri::async_runtime::spawn_blocking(move || start_engine(&app))
        .await
        .map_err(|e| e.to_string())??;
    Ok(status)
}

#[tauri::command]
pub async fn engine_analyze(app: AppHandle, options: AnalyzeOptions) -> CmdResult<()> {
    let state = app.state::<AppState>();
    if !state.engine.status().running {
        let app2 = app.clone();
        tauri::async_runtime::spawn_blocking(move || start_engine(&app2))
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(state.engine.analyze(options)?)
}

#[tauri::command]
pub async fn engine_stop(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(state.engine.stop()?)
}

// ---------- Claude ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    kind: RequestKind,
    fen: String,
    move_played: Option<String>,
    /// Instructions + context packet, built by the frontend (src/core/context-packet.ts).
    prompt: String,
    /// Skip the cache and ask again.
    #[serde(default)]
    force: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskReply {
    data: Value,
    cached: bool,
    calls_today: i64,
    model: String,
}

#[tauri::command]
pub async fn claude_ask(state: State<'_, AppState>, request: AskRequest) -> CmdResult<AskReply> {
    let (model, language) = {
        let s = state.settings.lock().unwrap();
        (s.claude_model.clone(), s.language.clone())
    };
    let key = claude::cache_key(request.kind, &request.fen, request.move_played.as_deref(), &model, &language);

    if !request.force {
        let cached = db::cache_get(&state.db.lock().unwrap(), &key)?;
        if let Some(json) = cached {
            let data: Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            let calls_today = db::calls_today(&state.db.lock().unwrap())?;
            return Ok(AskReply { data, cached: true, calls_today, model });
        }
    }

    let result = state
        .claude
        .ask_structured(StructuredRequest { kind: request.kind, prompt: request.prompt, model: model.clone() })
        .await;

    // Note: the DB lock is only taken after the await, never held across it.
    let conn = state.db.lock().unwrap();
    if !matches!(result, Err(ClaudeError::Cancelled | ClaudeError::NotFound)) {
        db::record_call(&conn, request.kind.as_str(), result.is_ok())?;
    }
    let reply = result?;
    // The hello test is never cached, so "Test Claude" always really tests it.
    if request.kind != RequestKind::Hello {
        db::cache_put(
            &conn,
            &db::CacheEntry {
                key: &key,
                kind: request.kind.as_str(),
                fen: &request.fen,
                move_played: request.move_played.as_deref(),
                model: &model,
                prompt_version: claude::PROMPT_VERSION,
                response_json: &reply.data.to_string(),
            },
        )?;
    }
    let calls_today = db::calls_today(&conn)?;
    Ok(AskReply { data: reply.data, cached: false, calls_today, model })
}

#[tauri::command]
pub async fn claude_cancel(state: State<'_, AppState>) -> CmdResult<()> {
    state.claude.cancel();
    Ok(())
}

#[tauri::command]
pub async fn claude_calls_today(state: State<'_, AppState>) -> CmdResult<i64> {
    Ok(db::calls_today(&state.db.lock().unwrap())?)
}

// ---------- Chess.com ----------

#[tauri::command]
pub async fn chesscom_archives(state: State<'_, AppState>) -> CmdResult<Vec<Archive>> {
    let s = state.settings.lock().unwrap().clone();
    let ua = chesscom::user_agent(&state.app_version, &s.chesscom_username, &s.contact_email)?;
    Ok(chesscom::fetch_archives(&state.http, chesscom::API_BASE, &ua, &s.chesscom_username).await?)
}

// ---------- first-run setup checks ----------

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    #[serde(rename = "ok")]
    Pass,
    Warning,
    #[serde(rename = "error")]
    Fail,
    Info,
}

/// One line of the setup screen. The frontend shows a translated sentence for
/// `id` + `status` filled in with `params`; `detail`/`fix` are English fallbacks.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    id: &'static str,
    label: &'static str,
    status: CheckStatus,
    detail: String,
    fix: Option<String>,
    params: BTreeMap<&'static str, String>,
}

fn check(id: &'static str, label: &'static str, status: CheckStatus, detail: impl Into<String>) -> SetupCheck {
    SetupCheck { id, label, status, detail: detail.into(), fix: None, params: BTreeMap::new() }
}

impl SetupCheck {
    fn fix(mut self, fix: impl Into<String>) -> Self {
        self.fix = Some(fix.into());
        self
    }
    fn param(mut self, k: &'static str, v: impl ToString) -> Self {
        self.params.insert(k, v.to_string());
        self
    }
}

#[tauri::command]
pub async fn setup_checks(app: AppHandle) -> CmdResult<Vec<SetupCheck>> {
    use CheckStatus::*;
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let mut checks = Vec::new();

    // 1. Stockfish
    let app2 = app.clone();
    let engine = tauri::async_runtime::spawn_blocking(move || start_engine(&app2)).await.map_err(|e| e.to_string())?;
    checks.push(match engine {
        Ok(st) => {
            let name = st.name.unwrap_or_default();
            check("engine", "Chess engine", Pass, format!("{name} is ready ({} threads, {} MB hash)", st.threads, st.hash_mb))
                .param("name", name)
                .param("threads", st.threads)
                .param("hash", st.hash_mb)
        }
        Err(e) => check("engine", "Chess engine", Fail, e.clone())
            .fix("Reinstall ChessCoach, or choose a Stockfish binary under Settings → Engine.")
            .param("error", e),
    });

    // 2. Claude Code installed
    let install_cmd = if cfg!(windows) {
        "irm https://claude.ai/install.ps1 | iex"
    } else {
        "curl -fsSL https://claude.ai/install.sh | bash"
    };
    let version = state.claude.version().await;
    let installed = version.is_ok();
    checks.push(match version {
        Ok(v) => {
            let path = state.claude.binary().map(|p| p.display().to_string()).unwrap_or_default();
            check("claude", "Claude Code", Pass, format!("Found {v} at {path}")).param("version", v).param("path", path)
        }
        Err(e) => check("claude", "Claude Code", Fail, e.to_string())
            .fix(format!(
                "Install Claude Code: open {}  {install_cmd}  then restart ChessCoach. If it's installed somewhere unusual, set its path in Settings → Claude.",
                if cfg!(windows) { "PowerShell and run" } else { "Terminal and run" }
            ))
            .param("command", install_cmd)
            .param("terminal", if cfg!(windows) { "PowerShell" } else { "Terminal" }),
    });

    // 3. Claude Code logged in with a subscription
    let login_fix = "Open a terminal, run  claude  and log in with your Claude account (Pro or Max). Then click Check again.";
    checks.push(if !installed {
        check("claudeLogin", "Claude login", Info, "Checked once Claude Code is installed.")
    } else {
        match state.claude.auth_status().await {
            Ok(a) if a.uses_subscription() => {
                let plan = a.subscription_type.unwrap_or_default();
                check("claudeLogin", "Claude login", Pass, format!("Logged in with a Claude subscription ({plan})")).param("plan", plan)
            }
            Ok(a) if a.logged_in => {
                let method = a.auth_method.unwrap_or_else(|| "another method".into());
                check(
                    "claudeLogin",
                    "Claude login",
                    Warning,
                    format!("Logged in with {method}, not a Claude subscription. Calls may be billed to that account."),
                )
                .fix(login_fix)
                .param("method", method)
            }
            Ok(_) => check("claudeLogin", "Claude login", Fail, "Claude Code is not logged in.").fix(login_fix),
            Err(e) => check("claudeLogin", "Claude login", Fail, e.to_string()).fix(login_fix).param("error", e.to_string()),
        }
    });

    // 4. Chess.com details for imports
    let no_user = s.chesscom_username.trim().is_empty();
    let no_contact = s.contact_email.trim().is_empty();
    checks.push(if !no_user && !no_contact {
        check("chesscom", "Chess.com", Pass, format!("Importing games for {}", s.chesscom_username)).param("user", &s.chesscom_username)
    } else {
        let missing = match (no_user, no_contact) {
            (true, true) => "both",
            (true, false) => "username",
            _ => "contact",
        };
        check("chesscom", "Chess.com", Warning, format!("Missing your Chess.com {missing}."))
            .fix("Add them under Settings → Chess.com. The contact email is only sent to Chess.com, which asks apps to identify themselves.")
            .param("missing", missing)
    });

    // 5. Lichess token (needed later for the opening explorer)
    checks.push(check(
        "lichess",
        "Lichess explorer",
        Info,
        "Needed for the opening explorer, which arrives in a later version.",
    ));

    Ok(checks)
}

// ---------- games & review ----------

/// Downloads new games from Chess.com. Sends `sync:progress` events per month.
#[tauri::command]
pub async fn games_sync(app: AppHandle) -> CmdResult<SyncReport> {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let ua = chesscom::user_agent(&state.app_version, &s.chesscom_username, &s.contact_email)?;
    let handle = app.clone();
    let report = games::sync(&state.db, &state.http, chesscom::API_BASE, &ua, &s.chesscom_username, move |p| {
        let _ = handle.emit("sync:progress", p);
    })
    .await?;
    if report.new_games > 0 {
        state.review.wake(); // new games to analyse
    }
    Ok(report)
}

#[tauri::command]
pub async fn games_list(state: State<'_, AppState>) -> CmdResult<Vec<GameSummary>> {
    let user = state.settings.lock().unwrap().chesscom_username.clone();
    Ok(games::list_games(&state.db.lock().unwrap(), &user)?)
}

#[tauri::command]
pub async fn game_get(state: State<'_, AppState>, id: i64) -> CmdResult<GameDetail> {
    games::get_game(&state.db.lock().unwrap(), id)?.ok_or_else(|| CmdError::new("notFound", "That game isn't in the database."))
}

/// Stores what the frontend computed from the analysis: a small summary for the
/// games list, and training cards for the user's mistakes and blunders.
#[tauri::command]
pub async fn game_save_review(
    state: State<'_, AppState>,
    id: i64,
    summary: Value,
    cards: Vec<TrainingCard>,
) -> CmdResult<usize> {
    let conn = state.db.lock().unwrap();
    games::set_review_summary(&conn, id, &summary)?;
    Ok(games::save_cards(&conn, id, &cards)?)
}

#[tauri::command]
pub async fn review_status(state: State<'_, AppState>) -> CmdResult<WorkerStatus> {
    let mut st = state.review.status();
    st.pending = games::count_pending(&state.db.lock().unwrap())?;
    Ok(st)
}

#[tauri::command]
pub async fn review_set_paused(state: State<'_, AppState>, paused: bool) -> CmdResult<()> {
    state.review.set_paused(paused);
    Ok(())
}

/// Analyse this game next.
#[tauri::command]
pub async fn review_prioritize(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    state.review.prioritize(id);
    Ok(())
}

/// Throw away a game's analysis and analyse it again next.
#[tauri::command]
pub async fn review_reanalyze(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    games::requeue(&state.db.lock().unwrap(), id)?;
    state.review.prioritize(id);
    Ok(())
}
