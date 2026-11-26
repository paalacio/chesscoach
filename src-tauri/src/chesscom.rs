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

impl ChessComError {
    /// Short name for the frontend, which shows a translated message.
    pub fn kind(&self) -> &'static str {
        match self {
            ChessComError::MissingUsername => "missingUsername",
            ChessComError::MissingContact => "missingContact",
            ChessComError::InvalidUsername(_) => "invalidUsername",
            ChessComError::PlayerNotFound(_) => "playerNotFound",
            ChessComError::RateLimited => "rateLimited",
            ChessComError::Http(_) => "http",
            ChessComError::Network(_) => "network",
            ChessComError::BadResponse(_) => "badResponse",
        }
    }

    /// The value inside the error (username, status code, technical message).
    pub fn detail(&self) -> Option<String> {
        match self {
            ChessComError::InvalidUsername(s) | ChessComError::PlayerNotFound(s) => Some(s.clone()),
            ChessComError::Network(s) | ChessComError::BadResponse(s) => Some(s.clone()),
            ChessComError::Http(code) => Some(code.to_string()),
            _ => None,
        }
    }
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

impl Archive {
    /// "2026/09"
    pub fn key(&self) -> String {
        format!("{:04}/{:02}", self.year, self.month)
    }
}

// ---------- monthly archives (the games themselves) ----------

#[derive(Deserialize)]
struct MonthBody {
    games: Vec<RawGame>,
}

#[derive(Deserialize)]
struct RawPlayer {
    username: String,
    rating: Option<i32>,
    /// "win", "checkmated", "resigned", "timeout", "agreed", "repetition", ...
    result: String,
}

#[derive(Deserialize)]
struct RawGame {
    url: String,
    pgn: Option<String>,
    time_control: Option<String>,
    time_class: Option<String>,
    end_time: Option<i64>,
    rules: Option<String>,
    white: RawPlayer,
    black: RawPlayer,
}

/// A game ready to be stored, from the point of view of the user.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame {
    /// The Chess.com game URL; unique per game.
    pub url: String,
    pub archive: String,
    pub pgn: String,
    pub white: String,
    pub black: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    pub my_color: String,
    /// "1-0", "0-1" or "1/2-1/2"
    pub result: String,
    /// "win", "loss" or "draw" for the user
    pub my_result: String,
    pub termination: Option<String>,
    pub time_class: Option<String>,
    pub time_control: Option<String>,
    pub end_time: Option<i64>,
    pub eco: Option<String>,
    /// Opening name from Chess.com's ECOUrl tag, e.g. "Ruy Lopez Opening Morphy Defense".
    pub opening: Option<String>,
    pub ply_count: u32,
}

const DRAW_CODES: &[&str] = &["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"];

fn outcome(code: &str) -> &'static str {
    if code == "win" {
        "win"
    } else if DRAW_CODES.contains(&code) {
        "draw"
    } else {
        "loss"
    }
}

/// "https://www.chess.com/openings/Ruy-Lopez-Opening-Morphy-Defense" -> "Ruy Lopez Opening Morphy Defense"
fn opening_from_eco_url(url: &str) -> Option<String> {
    let slug = url.trim_end_matches('/').rsplit('/').next()?;
    let name = slug.replace('-', " ");
    (!name.is_empty()).then_some(name)
}

/// Parses a monthly archive into the user's games. Variants (Chess960 etc.),
/// games without a PGN and games the user didn't play are skipped.
pub fn parse_month(body: &str, my_username: &str, archive: &str) -> Result<Vec<ImportedGame>, ChessComError> {
    let month: MonthBody = serde_json::from_str(body).map_err(|e| ChessComError::BadResponse(e.to_string()))?;
    let me = my_username.trim().to_lowercase();
    let mut out = Vec::new();
    for g in month.games {
        if g.rules.as_deref().unwrap_or("chess") != "chess" {
            continue;
        }
        let Some(pgn) = g.pgn else { continue };
        let my_color = if g.white.username.to_lowercase() == me {
            "white"
        } else if g.black.username.to_lowercase() == me {
            "black"
        } else {
            continue;
        };
        let mine = if my_color == "white" { &g.white.result } else { &g.black.result };
        let result = if g.white.result == "win" {
            "1-0"
        } else if g.black.result == "win" {
            "0-1"
        } else {
            "1/2-1/2"
        };
        // The PGN headers give the ECO code, opening, termination and move count.
        let parsed = crate::pgn::parse_game(&pgn).ok();
        let header = |k: &str| parsed.as_ref().and_then(|p| p.headers.get(k).cloned());
        out.push(ImportedGame {
            url: g.url,
            archive: archive.to_string(),
            white: g.white.username,
            black: g.black.username,
            white_elo: g.white.rating,
            black_elo: g.black.rating,
            my_color: my_color.into(),
            result: result.into(),
            my_result: outcome(mine).into(),
            termination: header("Termination"),
            time_class: g.time_class,
            time_control: g.time_control,
            end_time: g.end_time,
            eco: header("ECO"),
            opening: header("ECOUrl").and_then(|u| opening_from_eco_url(&u)),
            ply_count: parsed.as_ref().map(|p| p.moves.len() as u32).unwrap_or(0),
            pgn,
        });
    }
    Ok(out)
}

pub enum MonthFetch {
    /// Nothing changed since the last fetch (HTTP 304).
    NotModified,
    Fresh { body: String, etag: Option<String> },
}

/// Fetches one monthly archive. Sends the ETag from last time so an unchanged
/// month costs Chess.com (and us) almost nothing. Retries a few times, slower
/// each time, if Chess.com says "too many requests" or has a hiccup.
pub async fn fetch_month(
    client: &reqwest::Client,
    url: &str,
    user_agent: &str,
    etag: Option<&str>,
) -> Result<MonthFetch, ChessComError> {
    let waits = [2u64, 6, 15];
    let mut attempt = 0;
    loop {
        let mut req = client
            .get(url)
            .header(reqwest::header::USER_AGENT, user_agent)
            .header(reqwest::header::ACCEPT, "application/json");
        if let Some(tag) = etag {
            req = req.header(reqwest::header::IF_NONE_MATCH, tag);
        }
        let res = req.send().await.map_err(|e| ChessComError::Network(e.to_string()))?;
        let status = res.status().as_u16();
        match status {
            200 => {
                let etag = res
                    .headers()
                    .get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                let body = res.text().await.map_err(|e| ChessComError::Network(e.to_string()))?;
                return Ok(MonthFetch::Fresh { body, etag });
            }
            304 => return Ok(MonthFetch::NotModified),
            429 | 500..=599 if attempt < waits.len() => {
                tokio::time::sleep(std::time::Duration::from_secs(waits[attempt])).await;
                attempt += 1;
            }
            429 => return Err(ChessComError::RateLimited),
            404 => return Err(ChessComError::BadResponse(format!("archive not found: {url}"))),
            code => return Err(ChessComError::Http(code)),
        }
    }
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

    #[test]
    fn parses_a_month_from_the_users_point_of_view() {
        let games = parse_month(&fixture("month.json"), "SomeOne", "2026/11").unwrap();
        // 4 games in the file: one Chess960 and one between other players are skipped.
        assert_eq!(games.len(), 2);
        let won = &games[0];
        assert_eq!((won.my_color.as_str(), won.result.as_str(), won.my_result.as_str()), ("white", "1-0", "win"));
        assert_eq!(won.white_elo, Some(1104));
        assert_eq!(won.eco.as_deref(), Some("C84"));
        assert_eq!(won.opening.as_deref(), Some("Ruy Lopez Opening Morphy Defense Closed Variation"));
        assert_eq!(won.termination.as_deref(), Some("someone won by resignation"));
        assert_eq!(won.ply_count, 21);
        assert_eq!(won.archive, "2026/11");
        let lost = &games[1];
        assert_eq!((lost.my_color.as_str(), lost.result.as_str(), lost.my_result.as_str()), ("black", "1-0", "loss"));
        assert_eq!(lost.time_class.as_deref(), Some("rapid"));
    }

    #[test]
    fn draw_codes_count_as_draws() {
        assert_eq!(outcome("repetition"), "draw");
        assert_eq!(outcome("timevsinsufficient"), "draw");
        assert_eq!(outcome("abandoned"), "loss");
        assert_eq!(outcome("win"), "win");
    }

    /// Serves a fixed response and returns the request text, like `serve_once`,
    /// but lets the test add response headers.
    fn serve_with_headers(status: &'static str, headers: &'static str, body: String) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).unwrap();
            tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).unwrap();
            let resp = format!(
                "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(resp.as_bytes()).unwrap();
        });
        (format!("http://{addr}"), rx)
    }

    #[tokio::test]
    async fn fetches_a_month_and_remembers_its_etag() {
        let (base, request) = serve_with_headers("200 OK", "ETag: \"abc123\"\r\n", fixture("month.json"));
        let client = reqwest::Client::new();
        match fetch_month(&client, &format!("{base}/player/someone/games/2026/11"), "ua", None).await.unwrap() {
            MonthFetch::Fresh { body, etag } => {
                assert!(body.contains("\"games\""));
                assert_eq!(etag.as_deref(), Some("\"abc123\""));
            }
            MonthFetch::NotModified => panic!("expected a fresh month"),
        }
        assert!(!request.recv().unwrap().to_lowercase().contains("if-none-match"));

        // Second time: we send the ETag and Chess.com says nothing changed.
        let (base, request) = serve_with_headers("304 Not Modified", "", String::new());
        let r = fetch_month(&client, &format!("{base}/m"), "ua", Some("\"abc123\"")).await.unwrap();
        assert!(matches!(r, MonthFetch::NotModified));
        assert!(request.recv().unwrap().to_lowercase().contains("if-none-match: \"abc123\""));
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
