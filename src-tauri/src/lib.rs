//! ChessCoach backend. Everything that touches processes (Stockfish, Claude Code),
//! the network, the disk or secrets lives here; the UI is in `src/` (TypeScript).

pub mod chesscom;
pub mod claude;
mod commands;
mod menu;
pub mod db;
pub mod engine;
pub mod games;
pub mod pgn;
pub mod review;
pub mod settings;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Shared state, available to every command.
pub struct AppState {
    pub app_version: String,
    pub data_dir: PathBuf,
    pub settings_path: PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub db: Mutex<rusqlite::Connection>,
    pub engine: engine::EngineManager,
    pub claude: claude::CliClaude,
    pub http: reqwest::Client,
    /// Background game analysis (its own engine process).
    pub review: review::ReviewWorker,
}

fn init_state(app: &tauri::App) -> Result<AppState, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let settings_path = app.path().app_config_dir()?.join("settings.json");

    #[allow(unused_mut)]
    let mut settings = settings::load(&settings_path);
    // In development, `.env.local` in the repo fills in empty settings (never in release builds).
    #[cfg(debug_assertions)]
    if let Ok(env_text) = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env.local")) {
        settings::apply_dev_env(&mut settings, &env_text);
    }

    let review_paused = !settings.auto_analyze;
    let claude = claude::CliClaude::new(&data_dir)?;
    claude.set_custom_path(Some(settings.claude_path.clone()));

    let db = db::open(&data_dir.join("chesscoach.sqlite"))?;
    // Games that were being analysed when the app last quit go back in the queue.
    games::reset_interrupted(&db)?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    Ok(AppState {
        app_version: app.package_info().version.to_string(),
        data_dir,
        settings_path,
        settings: Mutex::new(settings),
        db: Mutex::new(db),
        engine: engine::EngineManager::new(),
        review: review::ReviewWorker::new(review_paused),
        claude,
        http,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = init_state(app)?;
            let review = state.review.clone();
            let language = state.settings.lock().unwrap().language.clone();
            app.manage(state);
            review.spawn(app.handle().clone());
            app.set_menu(menu::build(app.handle(), &language)?)?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::forward_events(app, event))
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::engine_start,
            commands::engine_analyze,
            commands::engine_stop,
            commands::claude_ask,
            commands::claude_cancel,
            commands::claude_calls_today,
            commands::chesscom_archives,
            commands::setup_checks,
            commands::games_sync,
            commands::games_list,
            commands::game_get,
            commands::game_save_review,
            commands::review_status,
            commands::review_set_paused,
            commands::review_prioritize,
            commands::review_reanalyze,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the ChessCoach app");

    app.run(|handle, event| {
        // Don't leave Stockfish running after the app quits.
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.engine.shutdown();
                state.review.shutdown();
            }
        }
    });
}
