//! The native menu bar (App, File, Edit, View, Game, Train, Window, Help).
//!
//! Clicking an item sends its id to the frontend as a `menu` event; the frontend
//! runs the matching action (src/ui/actions.ts). Edit and Window use the
//! predefined OS items so copy/paste, minimise, zoom etc. work natively.
//!
//! Single-key shortcuts (arrows, F, Space) are handled by the frontend instead of
//! menu accelerators, so they don't steal keys while typing in a text field.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str, accel: Option<&str>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accel)
}

fn disabled<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, false, None::<&str>)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);

    // On macOS the first submenu becomes the app menu (shown with the app's name).
    let app_menu = Submenu::with_items(
        app,
        "ChessCoach",
        true,
        &[
            &item(app, "about", "About ChessCoach", None)?,
            &sep()?,
            &item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &item(app, "setup", "Setup Check…", None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, "new-game", "New Analysis", Some("CmdOrCtrl+N"))?,
            &item(app, "import", "Import PGN or FEN…", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item(app, "copy-fen", "Copy FEN", Some("CmdOrCtrl+Shift+C"))?,
            &item(app, "copy-pgn", "Copy PGN", None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(app, "page:analysis", "Analysis", Some("CmdOrCtrl+1"))?,
            &item(app, "page:games", "Games", Some("CmdOrCtrl+2"))?,
            &item(app, "page:explorer", "Explorer", Some("CmdOrCtrl+3"))?,
            &item(app, "page:repertoire", "Repertoire", Some("CmdOrCtrl+4"))?,
            &item(app, "page:train", "Train", Some("CmdOrCtrl+5"))?,
            &item(app, "page:insights", "Insights", Some("CmdOrCtrl+6"))?,
            &sep()?,
            &item(app, "flip", "Flip Board (F)", None)?,
            &item(app, "toggle-inspector", "Show/Hide Inspector", Some("CmdOrCtrl+Alt+I"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let game = Submenu::with_items(
        app,
        "Game",
        true,
        &[
            &item(app, "explain", "Explain Move or Position", Some("CmdOrCtrl+E"))?,
            &item(app, "plan", "Plan for This Position", Some("CmdOrCtrl+Shift+E"))?,
            &sep()?,
            &item(app, "toggle-engine", "Engine On/Off (Space)", None)?,
            &sep()?,
            &item(app, "first", "First Move (↑)", None)?,
            &item(app, "prev", "Previous Move (←)", None)?,
            &item(app, "next", "Next Move (→)", None)?,
            &item(app, "last", "Last Move (↓)", None)?,
        ],
    )?;

    let train = Submenu::with_items(
        app,
        "Train",
        true,
        &[
            &disabled(app, "train-learn", "Learn New Lines (coming soon)")?,
            &disabled(app, "train-review", "Review Due (coming soon)")?,
            &disabled(app, "train-mistakes", "My Mistakes (coming soon)")?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;

    let help = Submenu::with_items(app, "Help", true, &[&item(app, "help-setup", "Setup Check…", None)?])?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &game, &train, &window, &help])
}

/// Forwards clicks on our own menu items to the frontend.
pub fn forward_events<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let _ = app.emit("menu", event.id().0.clone());
}
