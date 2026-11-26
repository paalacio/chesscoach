//! The Lichess API token, kept in the operating system's secure store:
//! Keychain on macOS, Credential Manager on Windows. It never goes into a file.
//!
//! The token is read once and then kept in memory, so the keychain isn't asked
//! on every explorer request.

use std::sync::{Arc, Mutex};

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, token: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

const SERVICE: &str = "app.chesscoach.desktop";
const ACCOUNT: &str = "lichess-api-token";

/// Lichess personal tokens look like `lip_...`; we only check they're plausible.
pub fn validate_token(token: &str) -> Result<String, String> {
    let t = token.trim();
    let ok = (10..=200).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok { Ok(t.to_string()) } else { Err("That doesn't look like a Lichess API token.".into()) }
}

pub struct KeychainTokenStore {
    /// None = not read yet; Some(None) = read, no token.
    cache: Mutex<Option<Option<String>>>,
}

impl KeychainTokenStore {
    pub fn new() -> Self {
        Self { cache: Mutex::new(None) }
    }

    fn entry() -> Result<keyring_core::Entry, String> {
        #[cfg(target_os = "macos")]
        let store: Arc<keyring_core::api::CredentialStore> =
            apple_native_keyring_store::keychain::Store::new().map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        let store: Arc<keyring_core::api::CredentialStore> =
            windows_native_keyring_store::Store::new().map_err(|e| e.to_string())?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        return Err("No secure credential store on this platform.".into());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        keyring_core::Entry::new_in_store(&store, SERVICE, ACCOUNT).map_err(|e| e.to_string())
    }
}

impl Default for KeychainTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeychainTokenStore {
    fn get(&self) -> Result<Option<String>, String> {
        if let Some(cached) = self.cache.lock().unwrap().clone() {
            return Ok(cached);
        }
        let value = match Self::entry()?.get_password() {
            Ok(t) => Some(t),
            Err(keyring_core::Error::NoEntry) => None,
            Err(e) => return Err(format!("Couldn't read the keychain: {e}")),
        };
        *self.cache.lock().unwrap() = Some(value.clone());
        Ok(value)
    }

    fn set(&self, token: &str) -> Result<(), String> {
        Self::entry()?.set_password(token).map_err(|e| format!("Couldn't save to the keychain: {e}"))?;
        *self.cache.lock().unwrap() = Some(Some(token.to_string()));
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => {}
            Err(e) => return Err(format!("Couldn't remove it from the keychain: {e}")),
        }
        *self.cache.lock().unwrap() = Some(None);
        Ok(())
    }
}

/// In-memory store for tests (and platforms without a keychain).
#[derive(Default)]
pub struct MemoryTokenStore(Mutex<Option<String>>);

impl TokenStore for MemoryTokenStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set(&self, token: &str) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(token.to_string());
        Ok(())
    }
    fn clear(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_tokens() {
        assert_eq!(validate_token("  lip_abcDEF123456  ").unwrap(), "lip_abcDEF123456");
        assert!(validate_token("short").is_err());
        assert!(validate_token("lip_has spaces inside").is_err());
        assert!(validate_token("lip_token\nwith-newline").is_err());
    }

    #[test]
    fn memory_store_round_trip() {
        let s = MemoryTokenStore::default();
        assert_eq!(s.get().unwrap(), None);
        s.set("lip_x").unwrap();
        assert_eq!(s.get().unwrap().as_deref(), Some("lip_x"));
        s.clear().unwrap();
        assert_eq!(s.get().unwrap(), None);
    }
}
