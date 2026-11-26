//! Chess.com Published-Data API client.
//! Docs: https://www.chess.com/news/view/published-data-api
//!
//! Chess.com asks every client to send a User-Agent with contact details, and to
//! make requests one after another (parallel requests can get HTTP 429).

use serde::{Deserialize, Serialize};

pub const API_BASE: &str = "https://api.chess.com/pub";

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ChessComError {
    #[error("Add your Chess.com username in Settings.")]
    MissingUsername,
    #[error("Add a contact email in Settings. Chess.com asks apps to include one in every request.")]
    MissingContact,
    #[error("\"{0}\" is not a valid Chess.com username.")]
    InvalidUsername(String),
    #[error("Chess.com has no player called \"{0}\".")]
    PlayerNotFound(String),
    #[error("Chess.com is asking us to slow down. Try again in a minute.")]
    RateLimited,
    #[error("Chess.com answered with HTTP {0}.")]
    Http(u16),
    #[error("Could not reach Chess.com: {0}")]
    Network(String),
    #[error("Chess.com sent something unexpected: {0}")]
    BadResponse(String),
}

/// Builds the User-Agent from the user's own Settings, e.g.
/// `ChessCoach/0.1.0 (username: someone; contact: someone@example.com)`.
pub fn user_agent(app_version: &str, username: &str, contact: &str) -> Result<String, ChessComError> {
    let username = username.trim();
    let contact = contact.trim();
    if username.is_empty() {
        return Err(ChessComError::MissingUsername);
    }
    if contact.is_empty() {
        return Err(ChessComError::MissingContact);
    }
    // Keep the header to safe, printable characters.
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_graphic() || *c == ' ').collect::<String>();
    Ok(format!("ChessCoach/{app_version} (username: {}; contact: {})", clean(username), clean(contact)))
}

/// Chess.com usernames: letters, digits, `_` and `-`, 3-25 characters. The API
/// wants them lowercase.
pub fn normalize_username(username: &str) -> Result<String, ChessComError> {
    let u = username.trim().to_lowercase();
    let ok = (3..=25).contains(&u.len()) && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok { Ok(u) } else { Err(ChessComError::InvalidUsername(username.trim().to_string())) }
}

/// One monthly archive, e.g. 2026/10.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Archive {
    pub year: u16,
    pub month: u8,
    pub url: String,
}

#[derive(Deserialize)]
struct ArchivesBody {
    archives: Vec<String>,
}

/// Parses the body of `/player/{user}/games/archives`. Oldest month first.
pub fn parse_archives(body: &str) -> Result<Vec<Archive>, ChessComError> {
    let parsed: ArchivesBody = serde_json::from_str(body).map_err(|e| ChessComError::BadResponse(e.to_string()))?;
    let mut out = Vec::new();
    for url in parsed.archives {
        // URL ends in .../games/YYYY/MM
        let mut parts = url.trim_end_matches('/').rsplit('/');
        let month = parts.next().and_then(|m| m.parse().ok());
        let year = parts.next().and_then(|y| y.parse().ok());
        match (year, month) {
            (Some(year), Some(month)) if (1..=12).contains(&month) => out.push(Archive { year, month, url }),
            _ => return Err(ChessComError::BadResponse(format!("odd archive URL: {url}"))),
        }
    }
    out.sort_by_key(|a| (a.year, a.month));
    Ok(out)
}

/// Fetches the list of monthly archives for a player.
/// `base` is `API_BASE` in the app, or a local test server in tests.
pub async fn fetch_archives(
    client: &reqwest::Client,
    base: &str,
    user_agent: &str,
    username: &str,
) -> Result<Vec<Archive>, ChessComError> {
    let user = normalize_username(username)?;
    let url = format!("{base}/player/{user}/games/archives");
    let res = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, user_agent)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| ChessComError::Network(e.to_string()))?;
    match res.status().as_u16() {
        200 => {}
        404 => return Err(ChessComError::PlayerNotFound(user)),
        429 => return Err(ChessComError::RateLimited),
        code => return Err(ChessComError::Http(code)),
    }
    let body = res.text().await.map_err(|e| ChessComError::Network(e.to_string()))?;
    parse_archives(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/chesscom/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn user_agent_uses_settings_and_needs_contact() {
        assert_eq!(
            user_agent("0.1.0", "someone", "me@example.com").unwrap(),
            "ChessCoach/0.1.0 (username: someone; contact: me@example.com)"
        );
        assert_eq!(user_agent("0.1.0", "someone", "  "), Err(ChessComError::MissingContact));
        assert_eq!(user_agent("0.1.0", "", "me@example.com"), Err(ChessComError::MissingUsername));
        // Newlines can't sneak into the header.
        assert!(!user_agent("0.1.0", "a\nb", "c\r\nd").unwrap().contains('\n'));
    }

    #[test]
    fn usernames_are_normalized_and_checked() {
        assert_eq!(normalize_username(" MuriPalas ").unwrap(), "muripalas");
        assert!(normalize_username("no spaces").is_err());
        assert!(normalize_username("ab").is_err());
        assert!(normalize_username("../etc").is_err());
    }

    #[test]
    fn parses_the_recorded_archive_list() {
        let archives = parse_archives(&fixture("archives.json")).unwrap();
        assert_eq!(archives.len(), 3);
        assert_eq!((archives[0].year, archives[0].month), (2026, 9));
        assert_eq!((archives[2].year, archives[2].month), (2026, 11));
        assert!(parse_archives("{\"archives\": [\"https://x/games/2026/13\"]}").is_err());
        assert!(parse_archives("not json").is_err());
    }

    /// A one-shot HTTP server on localhost that answers with `status` and `body`
    /// and reports the request it got. No real network involved.
    fn serve_once(status: &'static str, body: String) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).unwrap();
            tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).unwrap();
            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(resp.as_bytes()).unwrap();
        });
        (format!("http://{addr}"), rx)
    }

    #[tokio::test]
    async fn fetches_archives_with_our_user_agent() {
        let (base, request) = serve_once("200 OK", fixture("archives.json"));
        let client = reqwest::Client::new();
        let ua = user_agent("0.1.0", "someone", "me@example.com").unwrap();
        let archives = fetch_archives(&client, &base, &ua, "SomeOne").await.unwrap();
        assert_eq!(archives.len(), 3);
        let req = request.recv().unwrap().to_lowercase();
        assert!(req.starts_with("get /player/someone/games/archives "), "{req}");
        assert!(req.contains("user-agent: chesscoach/0.1.0 (username: someone; contact: me@example.com)"));
    }

    #[tokio::test]
    async fn maps_http_errors() {
        let client = reqwest::Client::new();
        let (base, _r) = serve_once("404 Not Found", "{}".into());
        assert_eq!(
            fetch_archives(&client, &base, "ua", "nobody").await,
            Err(ChessComError::PlayerNotFound("nobody".into()))
        );
        let (base, _r) = serve_once("429 Too Many Requests", "{}".into());
        assert_eq!(fetch_archives(&client, &base, "ua", "someone").await, Err(ChessComError::RateLimited));
    }
}
