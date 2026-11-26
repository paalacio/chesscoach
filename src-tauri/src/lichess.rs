//! Lichess opening explorer client (https://explorer.lichess.org), with a cache.
//!
//! Checked Nov 2026 (lichess-org/api OpenAPI spec): `/masters` and `/lichess`,
//! OAuth2 without scopes. In practice `/masters` still answers without a token,
//! `/lichess` returns 401 without one. Lichess asks for one request at a time and
//! a one-minute pause after an HTTP 429.
//!
//! Answers are cached in SQLite for 30 days. If Lichess can't be reached (no
//! token, 429, outage, offline) we return the cached answer even if it's older,
//! and the UI falls back to "My games" and the engine. The app never breaks
//! because Lichess is down.

use crate::db::now;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const EXPLORER_BASE: &str = "https://explorer.lichess.org";
const CACHE_DAYS: i64 = 30;
const BACKOFF_SECS: i64 = 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningRef {
    pub eco: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerMove {
    pub uci: String,
    pub san: String,
    #[serde(default)]
    pub average_rating: Option<i32>,
    pub white: u64,
    pub draws: u64,
    pub black: u64,
    #[serde(default)]
    pub opening: Option<OpeningRef>,
}

/// Results for one position (game lists are not used).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerResult {
    pub white: u64,
    pub draws: u64,
    pub black: u64,
    pub moves: Vec<ExplorerMove>,
    #[serde(default)]
    pub opening: Option<OpeningRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Source {
    Masters,
    /// Lichess rated games, filtered by speed ("blitz", "rapid", ...) and rating
    /// groups (each value covers up to the next: 1000 = 1000-1199, ...).
    Lichess { speeds: Vec<String>, ratings: Vec<u32> },
}

const SPEEDS: &[&str] = &["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"];
const RATINGS: &[u32] = &[0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

impl Source {
    /// Keeps only values Lichess accepts, sorted, so equal filters share a cache entry.
    pub fn normalized(&self) -> Source {
        match self {
            Source::Masters => Source::Masters,
            Source::Lichess { speeds, ratings } => {
                let mut s: Vec<String> = SPEEDS.iter().filter(|x| speeds.iter().any(|y| y == *x)).map(|x| x.to_string()).collect();
                let mut r: Vec<u32> = RATINGS.iter().copied().filter(|x| ratings.contains(x)).collect();
                if s.is_empty() {
                    s = vec!["blitz".into(), "rapid".into()];
                }
                if r.is_empty() {
                    r = vec![1000, 1200, 1400, 1600];
                }
                Source::Lichess { speeds: s, ratings: r }
            }
        }
    }

    fn query(&self) -> String {
        match self {
            Source::Masters => "masters?moves=12&topGames=0".into(),
            Source::Lichess { speeds, ratings } => format!(
                "lichess?variant=standard&moves=12&topGames=0&recentGames=0&speeds={}&ratings={}",
                speeds.join(","),
                ratings.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
            ),
        }
    }

    fn needs_token(&self) -> bool {
        matches!(self, Source::Lichess { .. })
    }
}

/// FEN without move counters (positions reached by different move orders match).
pub fn epd(fen: &str) -> String {
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

/// Explorer wants a full FEN; we send the EPD with "0 1" counters so cache keys
/// and requests don't depend on the move number.
pub fn request_url(base: &str, source: &Source, fen: &str) -> String {
    let full = format!("{} 0 1", epd(fen));
    format!("{base}/{}&fen={}", source.query(), urlencode(&full))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum LichessError {
    #[error("A Lichess token is needed for games at your level.")]
    NeedsToken,
    #[error("Lichess didn't accept the token. Create a new one and save it in Settings.")]
    BadToken,
    #[error("Lichess asked us to slow down. Trying again in a minute.")]
    RateLimited,
    #[error("Lichess answered with HTTP {0}.")]
    Http(u16),
    #[error("Could not reach Lichess: {0}")]
    Network(String),
    #[error("Lichess sent something unexpected: {0}")]
    BadResponse(String),
}

impl LichessError {
    pub fn kind(&self) -> &'static str {
        match self {
            LichessError::NeedsToken => "lichessNeedsToken",
            LichessError::BadToken => "lichessBadToken",
            LichessError::RateLimited => "lichessRateLimited",
            LichessError::Http(_) => "lichessHttp",
            LichessError::Network(_) => "lichessNetwork",
            LichessError::BadResponse(_) => "lichessBadResponse",
        }
    }
    pub fn detail(&self) -> Option<String> {
        match self {
            LichessError::Http(c) => Some(c.to_string()),
            LichessError::Network(s) | LichessError::BadResponse(s) => Some(s.clone()),
            _ => None,
        }
    }
}

pub fn parse_result(body: &str) -> Result<ExplorerResult, LichessError> {
    serde_json::from_str(body).map_err(|e| LichessError::BadResponse(e.to_string()))
}

/// One request to the explorer. `user_agent` names the app (Lichess asks for it).
pub async fn fetch(
    client: &reqwest::Client,
    base: &str,
    user_agent: &str,
    token: Option<&str>,
    source: &Source,
    fen: &str,
) -> Result<ExplorerResult, LichessError> {
    if source.needs_token() && token.is_none() {
        return Err(LichessError::NeedsToken);
    }
    let mut req = client
        .get(request_url(base, source, fen))
        .header(reqwest::header::USER_AGENT, user_agent)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let res = req.send().await.map_err(|e| LichessError::Network(e.to_string()))?;
    match res.status().as_u16() {
        200 => {}
        401 | 403 => return Err(if token.is_some() { LichessError::BadToken } else { LichessError::NeedsToken }),
        429 => return Err(LichessError::RateLimited),
        code => return Err(LichessError::Http(code)),
    }
    let body = res.text().await.map_err(|e| LichessError::Network(e.to_string()))?;
    parse_result(&body)
}

// ---------- cache + fallback ----------

/// What the UI gets: the result (fresh or cached), and the problem if Lichess couldn't be asked.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerReply {
    pub result: Option<ExplorerResult>,
    pub cached: bool,
    /// The cached answer is older than 30 days (shown because Lichess couldn't be reached).
    pub stale: bool,
    pub error_kind: Option<String>,
    pub error_detail: Option<String>,
}

fn cache_key(source: &Source, fen: &str) -> String {
    let src = match source {
        Source::Masters => "masters".to_string(),
        Source::Lichess { speeds, ratings } => format!(
            "lichess:{}:{}",
            speeds.join(","),
            ratings.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
        ),
    };
    format!("{src}|{}", epd(fen))
}

fn cache_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<(String, i64)>> {
    conn.query_row("SELECT json, fetched_at FROM explorer_cache WHERE key = ?1", [key], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
}

fn cache_put(conn: &Connection, key: &str, json: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO explorer_cache (key, json, fetched_at) VALUES (?1, ?2, ?3)",
        params![key, json, now()],
    )?;
    Ok(())
}

/// Keeps the app polite with Lichess: one request at a time (Lichess asks for
/// that), and after a "too many requests" it waits before asking again.
#[derive(Default)]
pub struct Backoff {
    /// Until when (unix seconds) we don't ask Lichess.
    until: Mutex<i64>,
    /// Held while a request is in flight, so the next one waits its turn.
    /// (An async mutex, because it is held across the `.await` of the request.)
    gate: tokio::sync::Mutex<()>,
}

impl Backoff {
    pub fn active(&self, at: i64) -> bool {
        *self.until.lock().unwrap() > at
    }
    pub fn start(&self, at: i64) {
        *self.until.lock().unwrap() = at + BACKOFF_SECS;
    }
}

/// Cached answer if it's recent, else a fresh one from Lichess, else the old
/// cached one with the reason Lichess couldn't be asked.
#[allow(clippy::too_many_arguments)]
pub async fn query(
    db: &Mutex<Connection>,
    backoff: &Backoff,
    client: &reqwest::Client,
    base: &str,
    user_agent: &str,
    token: Option<&str>,
    source: &Source,
    fen: &str,
) -> ExplorerReply {
    let source = source.normalized();
    let key = cache_key(&source, fen);
    let cached = cache_get(&db.lock().unwrap(), &key).ok().flatten();
    let parse = |json: &str| serde_json::from_str::<ExplorerResult>(json).ok();
    if let Some((json, at)) = &cached {
        if now() - at < CACHE_DAYS * 86_400 {
            return ExplorerReply { result: parse(json), cached: true, stale: false, error_kind: None, error_detail: None };
        }
    }
    // Wait for any request already in flight (one at a time).
    let _turn = backoff.gate.lock().await;
    let error = if backoff.active(now()) {
        LichessError::RateLimited
    } else {
        match fetch(client, base, user_agent, token, &source, fen).await {
            Ok(result) => {
                if let Ok(json) = serde_json::to_string(&result) {
                    let _ = cache_put(&db.lock().unwrap(), &key, &json);
                }
                return ExplorerReply { result: Some(result), cached: false, stale: false, error_kind: None, error_detail: None };
            }
            Err(e) => {
                if e == LichessError::RateLimited {
                    backoff.start(now());
                }
                e
            }
        }
    };
    ExplorerReply {
        result: cached.as_ref().and_then(|(json, _)| parse(json)),
        cached: cached.is_some(),
        stale: cached.is_some(),
        error_kind: Some(error.kind().into()),
        error_detail: error.detail(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, mpsc};

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    fn fixture() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/lichess/masters-start.json")).unwrap()
    }

    /// Fake explorer on localhost: answers `n` requests with `status` + body, reports each request.
    fn serve(n: usize, status: &'static str, body: String) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..n {
                let Ok((mut sock, _)) = listener.accept() else { return };
                let mut buf = [0u8; 8192];
                let k = sock.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..k]).to_string());
                let resp = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = sock.write_all(resp.as_bytes());
            }
        });
        (format!("http://{addr}"), rx)
    }

    #[test]
    fn parses_the_recorded_masters_answer() {
        let r = parse_result(&fixture()).unwrap();
        assert_eq!(r.moves[0].san, "e4");
        assert_eq!(r.moves[0].opening.as_ref().unwrap().eco, "B00");
        assert!(r.white > 0 && r.draws > 0 && r.black > 0);
    }

    #[test]
    fn builds_requests_and_normalizes_filters() {
        let s = Source::Lichess { speeds: vec!["rapid".into(), "blitz".into(), "nonsense".into()], ratings: vec![1600, 1000, 999] }.normalized();
        assert_eq!(s, Source::Lichess { speeds: vec!["blitz".into(), "rapid".into()], ratings: vec![1000, 1600] });
        let url = request_url("https://x", &s, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
        assert!(url.starts_with("https://x/lichess?variant=standard&moves=12"), "{url}");
        assert!(url.contains("speeds=blitz,rapid&ratings=1000,1600"), "{url}");
        assert!(url.ends_with("&fen=rnbqkbnr%2Fpppppppp%2F8%2F8%2F4P3%2F8%2FPPPP1PPP%2FRNBQKBNR%20b%20KQkq%20-%200%201"), "{url}");
        assert_eq!(cache_key(&Source::Masters, START), cache_key(&Source::Masters, &START.replace(" 0 1", " 5 9")));
    }

    #[tokio::test]
    async fn sends_the_token_and_maps_errors() {
        let client = reqwest::Client::new();
        let (base, req) = serve(1, "200 OK", fixture());
        let lichess = Source::Lichess { speeds: vec!["rapid".into()], ratings: vec![1000] };
        fetch(&client, &base, "ChessCoach/test", Some("lip_secret"), &lichess, START).await.unwrap();
        let r = req.recv().unwrap().to_lowercase();
        assert!(r.contains("authorization: bearer lip_secret"), "{r}");
        assert!(r.contains("user-agent: chesscoach/test"));

        assert_eq!(fetch(&client, &base, "ua", None, &lichess, START).await, Err(LichessError::NeedsToken), "no request without a token");
        let (base, _) = serve(1, "401 Unauthorized", String::new());
        assert_eq!(fetch(&client, &base, "ua", Some("lip_bad"), &lichess, START).await, Err(LichessError::BadToken));
        let (base, _) = serve(1, "429 Too Many Requests", String::new());
        assert_eq!(fetch(&client, &base, "ua", None, &Source::Masters, START).await, Err(LichessError::RateLimited));
    }

    #[tokio::test]
    async fn caches_answers_and_falls_back_when_lichess_is_down() {
        let db = Mutex::new(db::open_in_memory().unwrap());
        let backoff = Backoff::default();
        let client = reqwest::Client::new();

        // First time: asks Lichess and stores the answer.
        let (base, reqs) = serve(1, "200 OK", fixture());
        let r = query(&db, &backoff, &client, &base, "ua", None, &Source::Masters, START).await;
        assert!(!r.cached && r.result.is_some() && r.error_kind.is_none());
        assert_eq!(reqs.iter().count(), 1);

        // Second time: straight from the cache, no request.
        let r = query(&db, &backoff, &client, "http://127.0.0.1:9", "ua", None, &Source::Masters, START).await;
        assert!(r.cached && !r.stale && r.result.is_some());

        // An old cached answer, and Lichess is down: the old answer comes back, with the reason.
        db.lock().unwrap().execute("UPDATE explorer_cache SET fetched_at = fetched_at - 40 * 86400", []).unwrap();
        let r = query(&db, &backoff, &client, "http://127.0.0.1:9", "ua", None, &Source::Masters, START).await;
        assert!(r.stale && r.result.is_some());
        assert_eq!(r.error_kind.as_deref(), Some("lichessNetwork"));

        // 429: back off for a minute without asking again.
        let (base, reqs) = serve(1, "429 Too Many Requests", String::new());
        let other = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
        let r = query(&db, &backoff, &client, &base, "ua", None, &Source::Masters, other).await;
        assert_eq!(r.error_kind.as_deref(), Some("lichessRateLimited"));
        assert!(r.result.is_none());
        assert!(backoff.active(now()));
        let counted = Arc::new(reqs);
        let r = query(&db, &backoff, &client, &base, "ua", None, &Source::Masters, other).await;
        assert_eq!(r.error_kind.as_deref(), Some("lichessRateLimited"));
        assert_eq!(counted.try_iter().count(), 1, "only the first request reached Lichess");
    }
}
