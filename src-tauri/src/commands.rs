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
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Errors as the frontend sees them: `{ kind, message }`.
#[derive(Debug, Serialize)]
pub struct CmdError {
    kind: String,
    message: String,
}

impl CmdError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }
}

impl From<String> for CmdError {
    fn from(message: String) -> Self {
        Self::new("error", message)
    }
}
impl From<ClaudeError> for CmdError {
    fn from(e: ClaudeError) -> Self {
        Self::new(e.kind(), e.to_string())
    }
}
impl From<ChessComError> for CmdError {
    fn from(e: ChessComError) -> Self {
        Self::new("chesscom", e.to_string())
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
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    settings::save(&state.settings_path, &settings)?;
    let old = std::mem::replace(&mut *state.settings.lock().unwrap(), settings.clone());
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
    let model = state.settings.lock().unwrap().claude_model.clone();
    let key = claude::cache_key(request.kind, &request.fen, request.move_played.as_deref(), &model);

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
    Ok,
    Warning,
    Error,
    Info,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    id: &'static str,
    label: &'static str,
    status: CheckStatus,
    detail: String,
    fix: Option<String>,
}

#[tauri::command]
pub async fn setup_checks(app: AppHandle) -> CmdResult<Vec<SetupCheck>> {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let mut checks = Vec::new();

    // 1. Stockfish
    let app2 = app.clone();
    let engine = tauri::async_runtime::spawn_blocking(move || start_engine(&app2)).await.map_err(|e| e.to_string())?;
    checks.push(match engine {
        Ok(st) => SetupCheck {
            id: "engine",
            label: "Chess engine",
            status: CheckStatus::Ok,
            detail: format!(
                "{} is ready ({} threads, {} MB hash)",
                st.name.unwrap_or_default(),
                st.threads,
                st.hash_mb
            ),
            fix: None,
        },
        Err(e) => SetupCheck {
            id: "engine",
            label: "Chess engine",
            status: CheckStatus::Error,
            detail: e,
            fix: Some("Reinstall ChessCoach, or choose a Stockfish binary under Settings → Engine.".into()),
        },
    });

    // 2. Claude Code installed
    let install_fix = if cfg!(windows) {
        "Install Claude Code: open PowerShell and run  irm https://claude.ai/install.ps1 | iex  then restart ChessCoach."
    } else {
        "Install Claude Code: open Terminal and run  curl -fsSL https://claude.ai/install.sh | bash  then restart ChessCoach."
    };
    let version = state.claude.version().await;
    let installed = version.is_ok();
    checks.push(match version {
        Ok(v) => SetupCheck {
            id: "claude",
            label: "Claude Code",
            status: CheckStatus::Ok,
            detail: format!("Found {v} at {}", state.claude.binary().map(|p| p.display().to_string()).unwrap_or_default()),
            fix: None,
        },
        Err(e) => SetupCheck {
            id: "claude",
            label: "Claude Code",
            status: CheckStatus::Error,
            detail: e.to_string(),
            fix: Some(format!("{install_fix} If it's installed somewhere unusual, set its path in Settings → Claude.")),
        },
    });

    // 3. Claude Code logged in with a subscription
    let login_fix = "Open a terminal, run  claude  and log in with your Claude account (Pro or Max). Then click Check again.";
    checks.push(if !installed {
        SetupCheck {
            id: "claudeLogin",
            label: "Claude login",
            status: CheckStatus::Info,
            detail: "Checked once Claude Code is installed.".into(),
            fix: None,
        }
    } else {
        match state.claude.auth_status().await {
            Ok(a) if a.uses_subscription() => SetupCheck {
                id: "claudeLogin",
                label: "Claude login",
                status: CheckStatus::Ok,
                detail: format!(
                    "Logged in with a Claude subscription{}",
                    a.subscription_type.map(|t| format!(" ({t})")).unwrap_or_default()
                ),
                fix: None,
            },
            Ok(a) if a.logged_in => SetupCheck {
                id: "claudeLogin",
                label: "Claude login",
                status: CheckStatus::Warning,
                detail: format!(
                    "Logged in with {}, not a Claude subscription. Calls may be billed to that account.",
                    a.auth_method.unwrap_or_else(|| "another method".into())
                ),
                fix: Some(login_fix.into()),
            },
            Ok(_) => SetupCheck {
                id: "claudeLogin",
                label: "Claude login",
                status: CheckStatus::Error,
                detail: "Claude Code is not logged in.".into(),
                fix: Some(login_fix.into()),
            },
            Err(e) => SetupCheck {
                id: "claudeLogin",
                label: "Claude login",
                status: CheckStatus::Error,
                detail: e.to_string(),
                fix: Some(login_fix.into()),
            },
        }
    });

    // 4. Chess.com details for imports
    let missing: Vec<&str> = [
        (s.chesscom_username.trim().is_empty(), "username"),
        (s.contact_email.trim().is_empty(), "contact email"),
    ]
    .into_iter()
    .filter_map(|(m, name)| m.then_some(name))
    .collect();
    checks.push(if missing.is_empty() {
        SetupCheck {
            id: "chesscom",
            label: "Chess.com",
            status: CheckStatus::Ok,
            detail: format!("Importing games for {}", s.chesscom_username),
            fix: None,
        }
    } else {
        SetupCheck {
            id: "chesscom",
            label: "Chess.com",
            status: CheckStatus::Warning,
            detail: format!("Missing your Chess.com {}.", missing.join(" and ")),
            fix: Some(
                "Add them under Settings → Chess.com. The contact email is only sent to Chess.com, which asks apps to identify themselves."
                    .into(),
            ),
        }
    });

    // 5. Lichess token (needed later for the opening explorer)
    checks.push(SetupCheck {
        id: "lichess",
        label: "Lichess explorer",
        status: CheckStatus::Info,
        detail: "Needed for the opening explorer, which arrives in a later version.".into(),
        fix: None,
    });

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
