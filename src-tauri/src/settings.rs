//! User settings, stored as a small JSON file in the app's config folder.
//! (The Lichess token will go to the OS keychain instead, in Phase 3.)

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub chesscom_username: String,
    /// Sent to Chess.com in the User-Agent, as they ask. Never leaves this computer otherwise.
    pub contact_email: String,
    /// Custom engine binary; empty = use the bundled Stockfish.
    pub engine_path: String,
    /// None = CPU cores - 1.
    pub engine_threads: Option<u32>,
    pub engine_hash_mb: u32,
    pub multipv: u32,
    /// Custom `claude` binary; empty = find it automatically.
    pub claude_path: String,
    /// Claude Code model alias: "sonnet", "opus", "haiku", ...
    pub claude_model: String,
    pub board_theme: String,
    pub piece_set: String,
    pub show_coordinates: bool,
    pub setup_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            chesscom_username: String::new(),
            contact_email: String::new(),
            engine_path: String::new(),
            engine_threads: None,
            engine_hash_mb: 256,
            multipv: 3,
            claude_path: String::new(),
            claude_model: "sonnet".into(),
            board_theme: "brown".into(),
            piece_set: "cburnett".into(),
            show_coordinates: true,
            setup_complete: false,
        }
    }
}

/// Reads settings; a missing or broken file gives the defaults.
pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Write to a temp file first and rename, so a crash can't leave half a file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// During development, values from `.env.local` fill in settings that are still
/// empty. `env_text` is the file's content (KEY=value lines).
pub fn apply_dev_env(settings: &mut Settings, env_text: &str) {
    for line in env_text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim().trim_matches('"');
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "CHESSCOM_USERNAME" if settings.chesscom_username.is_empty() => {
                settings.chesscom_username = value.into()
            }
            "CHESSCOM_CONTACT" if settings.contact_email.is_empty() => settings.contact_email = value.into(),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let s = load(Path::new("/no/such/settings.json"));
        assert_eq!(s, Settings::default());
        assert_eq!(s.claude_model, "sonnet");
        assert_eq!(s.engine_hash_mb, 256);
        assert_eq!(s.multipv, 3);
    }

    #[test]
    fn save_and_load_round_trip_and_unknown_fields_are_ok() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings { chesscom_username: "someone".into(), ..Default::default() };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        // Older/newer files with missing or extra fields still load.
        std::fs::write(&path, r#"{"chesscomUsername":"x","somethingNew":1}"#).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.chesscom_username, "x");
        assert_eq!(loaded.claude_model, "sonnet");
    }

    #[test]
    fn dev_env_only_fills_empty_values() {
        let mut s = Settings::default();
        apply_dev_env(&mut s, "# comment\nCHESSCOM_USERNAME=someone\nCHESSCOM_CONTACT=\n");
        assert_eq!(s.chesscom_username, "someone");
        assert_eq!(s.contact_email, "", "empty values are ignored");
        let mut s = Settings { chesscom_username: "kept".into(), ..Default::default() };
        apply_dev_env(&mut s, "CHESSCOM_USERNAME=other\nCHESSCOM_CONTACT=\"me@example.com\"");
        assert_eq!(s.chesscom_username, "kept");
        assert_eq!(s.contact_email, "me@example.com");
    }
}
