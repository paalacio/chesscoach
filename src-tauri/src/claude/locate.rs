//! Finding the `claude` executable.
//!
//! Apps started from the Finder / Start menu don't get the PATH your terminal
//! has, so we look in the places the installers use, then ask a login shell.

use std::path::{Path, PathBuf};

/// Known install locations, most likely first.
/// - Native installer (macOS/Linux): ~/.local/bin/claude (a symlink into ~/.local/share/claude)
/// - Native installer (Windows): %USERPROFILE%\.local\bin\claude.exe
/// - Homebrew: /opt/homebrew/bin (Apple Silicon), /usr/local/bin (Intel)
/// - Old npm "local" installs: ~/.claude/local/claude
/// - npm global on Windows: %APPDATA%\npm\claude.cmd
pub fn candidate_paths(home: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        let mut v = vec![home.join(".local").join("bin").join("claude.exe")];
        if let Some(appdata) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
        }
        v
    } else {
        vec![
            home.join(".local/bin/claude"),
            "/opt/homebrew/bin/claude".into(),
            "/usr/local/bin/claude".into(),
            home.join(".claude/local/claude"),
        ]
    }
}

/// Returns the path to use for `claude`, or None if it can't be found.
pub fn find_claude(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = custom.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    if let Some(home) = home_dir() {
        if let Some(p) = candidate_paths(&home).into_iter().find(|p| p.is_file()) {
            return Some(p);
        }
    }
    from_shell()
}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

/// Last resort: ask the user's login shell (macOS) or `where` (Windows).
fn from_shell() -> Option<PathBuf> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("where");
        c.arg("claude");
        c
    } else {
        let shell = if Path::new("/bin/zsh").exists() { "/bin/zsh" } else { "/bin/sh" };
        let mut c = std::process::Command::new(shell);
        c.args(["-lc", "command -v claude"]);
        c
    };
    crate::engine::hide_console_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_path_must_exist() {
        assert_eq!(find_claude(Some("/definitely/not/here/claude")), None);
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, "").unwrap();
        assert_eq!(find_claude(Some(fake.to_str().unwrap())), Some(fake));
    }

    #[test]
    fn native_installer_location_comes_first() {
        let home = PathBuf::from("/home/someone");
        let first = candidate_paths(&home).remove(0);
        assert!(first.starts_with(&home));
        assert!(first.to_string_lossy().contains(".local"));
    }
}
