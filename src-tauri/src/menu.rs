//! The native menu bar (App, File, Edit, View, Game, Train, Window, Help), in
//! the app language. It's rebuilt when the language changes in Settings.
//!
//! Clicking an item sends its id to the frontend as a `menu` event; the frontend
//! runs the matching action (src/ui/actions.ts). Edit and Window use the
//! predefined OS items (with our own labels) so copy/paste, minimise, zoom etc.
//! work natively.
//!
//! Single-key shortcuts (arrows, F, Space) are handled by the frontend instead of
//! menu accelerators, so they don't steal keys while typing in a text field.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// Picks the English or Portuguese label.
struct L(bool);
impl L {
    fn t<'a>(&self, en: &'a str, pt: &'a str) -> &'a str {
        if self.0 { pt } else { en }
    }
}

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str, accel: Option<&str>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accel)
}

fn disabled<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, false, None::<&str>)
}

pub fn build<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<Menu<R>> {
    let l = L(language == "pt");
    let sep = || PredefinedMenuItem::separator(app);

    // On macOS the first submenu becomes the app menu (shown with the app's name).
    let app_menu = Submenu::with_items(
        app,
        "ChessCoach",
        true,
        &[
            &item(app, "about", l.t("About ChessCoach", "Sobre o ChessCoach"), None)?,
            &sep()?,
            &item(app, "settings", l.t("Settings…", "Ajustes…"), Some("CmdOrCtrl+,"))?,
            &item(app, "setup", l.t("Setup Check…", "Verificar instalação…"), None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, Some(l.t("Services", "Serviços")))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some(l.t("Hide ChessCoach", "Ocultar ChessCoach")))?,
            &PredefinedMenuItem::hide_others(app, Some(l.t("Hide Others", "Ocultar outros")))?,
            &PredefinedMenuItem::show_all(app, Some(l.t("Show All", "Mostrar tudo")))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some(l.t("Quit ChessCoach", "Encerrar ChessCoach")))?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        l.t("File", "Arquivo"),
        true,
        &[
            &item(app, "new-game", l.t("New Analysis", "Nova análise"), Some("CmdOrCtrl+N"))?,
            &item(app, "import", l.t("Import PGN or FEN…", "Importar PGN ou FEN…"), Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item(app, "copy-fen", l.t("Copy FEN", "Copiar FEN"), Some("CmdOrCtrl+Shift+C"))?,
            &item(app, "copy-pgn", l.t("Copy PGN", "Copiar PGN"), None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, Some(l.t("Close Window", "Fechar janela")))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        l.t("Edit", "Editar"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l.t("Undo", "Desfazer")))?,
            &PredefinedMenuItem::redo(app, Some(l.t("Redo", "Refazer")))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(l.t("Cut", "Recortar")))?,
            &PredefinedMenuItem::copy(app, Some(l.t("Copy", "Copiar")))?,
            &PredefinedMenuItem::paste(app, Some(l.t("Paste", "Colar")))?,
            &PredefinedMenuItem::select_all(app, Some(l.t("Select All", "Selecionar tudo")))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        l.t("View", "Visualizar"),
        true,
        &[
            &item(app, "page:analysis", l.t("Analysis", "Análise"), Some("CmdOrCtrl+1"))?,
            &item(app, "page:games", l.t("Games", "Partidas"), Some("CmdOrCtrl+2"))?,
            &item(app, "page:explorer", l.t("Explorer", "Explorador"), Some("CmdOrCtrl+3"))?,
            &item(app, "page:repertoire", l.t("Repertoire", "Repertório"), Some("CmdOrCtrl+4"))?,
            &item(app, "page:train", l.t("Train", "Treinar"), Some("CmdOrCtrl+5"))?,
            &item(app, "page:insights", l.t("Insights", "Estatísticas"), Some("CmdOrCtrl+6"))?,
            &sep()?,
            &item(app, "flip", l.t("Flip Board (F)", "Girar tabuleiro (F)"), None)?,
            &item(app, "toggle-inspector", l.t("Show/Hide Inspector", "Mostrar/ocultar painel"), Some("CmdOrCtrl+Alt+I"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, Some(l.t("Enter Full Screen", "Tela cheia")))?,
        ],
    )?;

    let game = Submenu::with_items(
        app,
        l.t("Game", "Partida"),
        true,
        &[
            &item(app, "explain", l.t("Explain Move or Position", "Explicar lance ou posição"), Some("CmdOrCtrl+E"))?,
            &item(app, "plan", l.t("Plan for This Position", "Plano para esta posição"), Some("CmdOrCtrl+Shift+E"))?,
            &sep()?,
            &item(app, "toggle-engine", l.t("Engine On/Off (Space)", "Ligar/desligar motor (Espaço)"), None)?,
            &sep()?,
            &item(app, "first", l.t("First Move (↑)", "Primeiro lance (↑)"), None)?,
            &item(app, "prev", l.t("Previous Move (←)", "Lance anterior (←)"), None)?,
            &item(app, "next", l.t("Next Move (→)", "Próximo lance (→)"), None)?,
            &item(app, "last", l.t("Last Move (↓)", "Último lance (↓)"), None)?,
        ],
    )?;

    let train = Submenu::with_items(
        app,
        l.t("Train", "Treinar"),
        true,
        &[
            &disabled(app, "train-learn", l.t("Learn New Lines (coming soon)", "Aprender linhas novas (em breve)"))?,
            &disabled(app, "train-review", l.t("Review Due (coming soon)", "Revisões pendentes (em breve)"))?,
            &disabled(app, "train-mistakes", l.t("My Mistakes (coming soon)", "Meus erros (em breve)"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        l.t("Window", "Janela"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(l.t("Minimize", "Minimizar")))?,
            &PredefinedMenuItem::maximize(app, Some(l.t("Zoom", "Zoom")))?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        l.t("Help", "Ajuda"),
        true,
        &[&item(app, "help-setup", l.t("Setup Check…", "Verificar instalação…"), None)?],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &game, &train, &window, &help])
}

/// Forwards clicks on our own menu items to the frontend.
pub fn forward_events<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let _ = app.emit("menu", event.id().0.clone());
}
