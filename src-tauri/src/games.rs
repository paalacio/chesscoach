//! Imported games: storing them, listing them, and syncing new ones from Chess.com.
//!
//! Sync is incremental: a monthly archive is downloaded if we've never fetched
//! it, or if it's one of the two most recent months (games may still be added
//! there). For those we send the ETag from last time, so an unchanged month is a
//! cheap "304 Not Modified". Requests go one after another, never in parallel.

use crate::chesscom::{self, ChessComError, ImportedGame, MonthFetch};
use crate::db::now;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A row in the games list (no PGN or analysis, to keep it small).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub id: i64,
    pub url: String,
    pub white: String,
    pub black: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    pub my_color: String,
    pub result: String,
    pub my_result: String,
    pub termination: Option<String>,
    pub time_class: Option<String>,
    pub time_control: Option<String>,
    pub end_time: Option<i64>,
    pub eco: Option<String>,
    pub opening: Option<String>,
    pub ply_count: i64,
    pub analysis_status: String,
    /// JSON written by the frontend after reviewing the game (accuracy, mistakes).
    pub review_summary: Option<serde_json::Value>,
}

/// Everything about one game.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDetail {
    #[serde(flatten)]
    pub summary: GameSummary,
    pub pgn: String,
    pub analysis: Option<serde_json::Value>,
    pub analysis_error: Option<String>,
}

const SUMMARY_COLUMNS: &str = "id, url, white, black, white_elo, black_elo, my_color, result, my_result, termination, \
     time_class, time_control, end_time, eco, opening, ply_count, analysis_status, review_summary";

fn summary_from_row(r: &rusqlite::Row) -> rusqlite::Result<GameSummary> {
    let review: Option<String> = r.get(17)?;
    Ok(GameSummary {
        id: r.get(0)?,
        url: r.get(1)?,
        white: r.get(2)?,
        black: r.get(3)?,
        white_elo: r.get(4)?,
        black_elo: r.get(5)?,
        my_color: r.get(6)?,
        result: r.get(7)?,
        my_result: r.get(8)?,
        termination: r.get(9)?,
        time_class: r.get(10)?,
        time_control: r.get(11)?,
        end_time: r.get(12)?,
        eco: r.get(13)?,
        opening: r.get(14)?,
        ply_count: r.get(15)?,
        analysis_status: r.get(16)?,
        review_summary: review.and_then(|s| serde_json::from_str(&s).ok()),
    })
}

/// Stores games, skipping ones we already have. Returns how many were new.
pub fn insert_games(conn: &Connection, username: &str, games: &[ImportedGame]) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR IGNORE INTO games (url, username, archive, pgn, white, black, white_elo, black_elo, my_color,
            result, my_result, termination, time_class, time_control, end_time, eco, opening, ply_count, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
    )?;
    let mut new = 0;
    for g in games {
        new += stmt.execute(params![
            g.url,
            username.to_lowercase(),
            g.archive,
            g.pgn,
            g.white,
            g.black,
            g.white_elo,
            g.black_elo,
            g.my_color,
            g.result,
            g.my_result,
            g.termination,
            g.time_class,
            g.time_control,
            g.end_time,
            g.eco,
            g.opening,
            g.ply_count,
            now()
        ])?;
    }
    Ok(new)
}

pub fn list_games(conn: &Connection, username: &str) -> rusqlite::Result<Vec<GameSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM games WHERE username = ?1 ORDER BY end_time DESC, id DESC"
    ))?;
    stmt.query_map([username.to_lowercase()], summary_from_row)?.collect()
}

pub fn get_game(conn: &Connection, id: i64) -> rusqlite::Result<Option<GameDetail>> {
    conn.query_row(
        &format!("SELECT {SUMMARY_COLUMNS}, pgn, analysis_json, analysis_error FROM games WHERE id = ?1"),
        [id],
        |r| {
            let analysis: Option<String> = r.get(19)?;
            Ok(GameDetail {
                summary: summary_from_row(r)?,
                pgn: r.get(18)?,
                analysis: analysis.and_then(|s| serde_json::from_str(&s).ok()),
                analysis_error: r.get(20)?,
            })
        },
    )
    .optional()
}

/// The newest game still waiting for analysis.
pub fn next_pending(conn: &Connection) -> rusqlite::Result<Option<(i64, String)>> {
    conn.query_row(
        "SELECT id, pgn FROM games WHERE analysis_status = 'pending' ORDER BY end_time DESC, id DESC LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

pub fn pgn_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT pgn FROM games WHERE id = ?1", [id], |r| r.get(0)).optional()
}

pub fn count_pending(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM games WHERE analysis_status IN ('pending', 'running')", [], |r| r.get(0))
}

pub fn set_status(conn: &Connection, id: i64, status: &str, analysis: Option<&str>, error: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET analysis_status = ?2,
            analysis_json = COALESCE(?3, analysis_json),
            analysis_error = ?4
         WHERE id = ?1",
        params![id, status, analysis, error],
    )?;
    Ok(())
}

/// Games left "running" when the app quit go back in the queue.
pub fn reset_interrupted(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("UPDATE games SET analysis_status = 'pending' WHERE analysis_status = 'running'", [])
}

/// Forget the analysis so the game is analysed again (e.g. at a new depth).
pub fn requeue(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET analysis_status = 'pending', analysis_json = NULL, analysis_error = NULL, review_summary = NULL WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn set_review_summary(conn: &Connection, id: i64, summary: &serde_json::Value) -> rusqlite::Result<()> {
    conn.execute("UPDATE games SET review_summary = ?2 WHERE id = ?1", params![id, summary.to_string()])?;
    Ok(())
}

/// A "find the better move" card made from one of the user's mistakes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingCard {
    pub ply: i64,
    pub fen: String,
    pub played_uci: String,
    pub played_san: String,
    pub best_uci: String,
    pub best_san: String,
    pub judgement: String,
    pub win_before: f64,
    pub win_after: f64,
}

/// Saves cards for a game; cards that already exist (same game and ply) are kept as they are.
pub fn save_cards(conn: &Connection, game_id: i64, cards: &[TrainingCard]) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR IGNORE INTO training_cards (game_id, ply, fen, played_uci, played_san, best_uci, best_san,
            judgement, win_before, win_after, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;
    let mut n = 0;
    for c in cards {
        n += stmt.execute(params![
            game_id,
            c.ply,
            c.fen,
            c.played_uci,
            c.played_san,
            c.best_uci,
            c.best_san,
            c.judgement,
            c.win_before,
            c.win_after,
            now()
        ])?;
    }
    Ok(n)
}

pub fn count_cards(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM training_cards", [], |r| r.get(0))
}

// ---------- positions index ("My games" explorer) ----------

/// Records every position (and the move played) of games not indexed yet.
/// Returns how many games were indexed.
pub fn index_positions(conn: &Connection) -> rusqlite::Result<usize> {
    let todo: Vec<(i64, String)> = conn
        .prepare("SELECT id, pgn FROM games WHERE id NOT IN (SELECT DISTINCT game_id FROM game_positions)")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare_cached("INSERT OR IGNORE INTO game_positions (game_id, ply, epd, uci, san) VALUES (?1, ?2, ?3, ?4, ?5)")?;
    let mut done = 0;
    for (id, pgn) in todo {
        // A PGN we can't read is skipped (it simply won't show up in the explorer).
        let Ok(game) = crate::pgn::parse_game(&pgn) else { continue };
        for m in &game.moves {
            stmt.execute(params![id, m.ply, crate::lichess::epd(&m.fen_before), m.uci, m.san])?;
        }
        done += 1;
    }
    Ok(done)
}

/// The "My games" explorer: moves played from a position in the user's games
/// with `color`, counted like Lichess does (white wins / draws / black wins).
pub fn my_games_explorer(conn: &Connection, username: &str, color: &str, fen: &str) -> rusqlite::Result<crate::lichess::ExplorerResult> {
    let mut stmt = conn.prepare(
        "SELECT p.uci, p.san, COUNT(*),
                SUM(g.result = '1-0'), SUM(g.result = '1/2-1/2'), SUM(g.result = '0-1')
         FROM game_positions p JOIN games g ON g.id = p.game_id
         WHERE p.epd = ?1 AND g.username = ?2 AND g.my_color = ?3
         GROUP BY p.uci, p.san
         ORDER BY COUNT(*) DESC
         LIMIT 12",
    )?;
    let moves: Vec<crate::lichess::ExplorerMove> = stmt
        .query_map(params![crate::lichess::epd(fen), username.to_lowercase(), color], |r| {
            Ok(crate::lichess::ExplorerMove {
                uci: r.get(0)?,
                san: r.get(1)?,
                average_rating: None,
                // SQLite counts are i64; they're never negative.
                white: r.get::<_, i64>(3)? as u64,
                draws: r.get::<_, i64>(4)? as u64,
                black: r.get::<_, i64>(5)? as u64,
                opening: None,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let sum = |f: fn(&crate::lichess::ExplorerMove) -> u64| moves.iter().map(f).sum();
    Ok(crate::lichess::ExplorerResult {
        white: sum(|m| m.white),
        draws: sum(|m| m.draws),
        black: sum(|m| m.black),
        moves,
        opening: None,
    })
}

// ---------- sync ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub archive: String,
    pub index: usize,
    pub total: usize,
    pub new_games: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub months: usize,
    pub fetched: usize,
    pub new_games: usize,
    pub total_games: usize,
}

/// Downloads new games for `username`. `progress` is called after each month.
pub async fn sync(
    db: &Mutex<Connection>,
    http: &reqwest::Client,
    api_base: &str,
    user_agent: &str,
    username: &str,
    progress: impl Fn(SyncProgress),
) -> Result<SyncReport, ChessComError> {
    let user = chesscom::normalize_username(username)?;
    let archives = chesscom::fetch_archives(http, api_base, user_agent, &user).await?;
    let recent_from = archives.len().saturating_sub(2);
    let mut report = SyncReport { months: archives.len(), fetched: 0, new_games: 0, total_games: 0 };

    for (i, archive) in archives.iter().enumerate() {
        let key = archive.key();
        let known: Option<Option<String>> = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT etag FROM sync_archives WHERE username = ?1 AND archive = ?2",
                params![user, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| ChessComError::BadResponse(e.to_string()))?;
        let recent = i >= recent_from;
        if known.is_some() && !recent {
            continue; // an old month we already have
        }
        let etag = known.flatten();
        match chesscom::fetch_month(http, &archive.url, user_agent, etag.as_deref()).await? {
            MonthFetch::NotModified => {}
            MonthFetch::Fresh { body, etag } => {
                report.fetched += 1;
                let games = chesscom::parse_month(&body, &user, &key)?;
                let conn = db.lock().unwrap();
                let db_err = |e: rusqlite::Error| ChessComError::BadResponse(e.to_string());
                report.new_games += insert_games(&conn, &user, &games).map_err(db_err)?;
                index_positions(&conn).map_err(db_err)?;
                conn.execute(
                    "INSERT OR REPLACE INTO sync_archives (username, archive, etag, fetched_at) VALUES (?1, ?2, ?3, ?4)",
                    params![user, key, etag, now()],
                )
                .map_err(db_err)?;
            }
        }
        progress(SyncProgress { archive: key, index: i + 1, total: archives.len(), new_games: report.new_games });
        // Be polite: a short pause between requests.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    report.total_games = list_games(&db.lock().unwrap(), &user)
        .map_err(|e| ChessComError::BadResponse(e.to_string()))?
        .len();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/chesscom/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    /// A fake Chess.com on localhost. `respond(path, if_none_match)` returns
    /// (status line, extra headers, body). Every request path is recorded.
    fn fake_chesscom(
        respond: impl Fn(&str, Option<&str>) -> (&'static str, String, String) + Send + 'static,
    ) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(Vec::new()));
        let log2 = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut sock) = stream else { break };
                let mut buf = [0u8; 8192];
                let n = sock.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                let inm = req
                    .lines()
                    .find(|l| l.to_lowercase().starts_with("if-none-match:"))
                    .map(|l| l.split_once(':').unwrap().1.trim().to_string());
                log2.lock().unwrap().push(path.clone());
                let (status, headers, body) = respond(&path, inm.as_deref());
                let resp = format!(
                    "HTTP/1.1 {status}\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes());
            }
        });
        (base, log)
    }

    #[tokio::test]
    async fn sync_imports_new_games_and_then_only_rechecks_recent_months() {
        // Fake #1 serves the monthly archives: the first time with an ETag, then
        // "304 Not Modified" when that ETag is sent back.
        let month = fixture("month.json");
        let (base, log) = fake_chesscom(move |_path, inm| match inm {
            Some(_) => ("304 Not Modified", String::new(), String::new()),
            None => ("200 OK", "ETag: \"v1\"\r\n".into(), month.clone()),
        });
        // Fake #2 is the API base: its archive list points at fake #1.
        let archives_body = format!(
            r#"{{"archives":["{b}/player/someone/games/2026/09","{b}/player/someone/games/2026/10","{b}/player/someone/games/2026/11"]}}"#,
            b = base
        );
        let (api, api_log) = fake_chesscom(move |_path, _| ("200 OK", String::new(), archives_body.clone()));

        let conn = db::open_in_memory().unwrap();
        let db = Mutex::new(conn);
        let http = reqwest::Client::new();
        let steps = Arc::new(Mutex::new(Vec::new()));
        let s2 = steps.clone();

        let first = sync(&db, &http, &api, "ua", "SomeOne", move |p| s2.lock().unwrap().push(p.index)).await.unwrap();
        assert_eq!(first, SyncReport { months: 3, fetched: 3, new_games: 2, total_games: 2 });
        assert_eq!(*steps.lock().unwrap(), vec![1, 2, 3]);
        assert_eq!(log.lock().unwrap().len(), 3, "every month fetched once");
        assert_eq!(api_log.lock().unwrap().len(), 1);

        // Second sync: the oldest month is skipped, the two recent ones are
        // re-checked with their ETag and come back "304 Not Modified".
        let second = sync(&db, &http, &api, "ua", "someone", |_| {}).await.unwrap();
        assert_eq!(second, SyncReport { months: 3, fetched: 0, new_games: 0, total_games: 2 });
        let paths = log.lock().unwrap().clone();
        assert_eq!(paths.len(), 5);
        assert!(paths[3].ends_with("2026/10") && paths[4].ends_with("2026/11"), "{paths:?}");
    }

    #[test]
    fn games_queue_status_and_cards() {
        let conn = db::open_in_memory().unwrap();
        let games = chesscom::parse_month(&fixture("month.json"), "someone", "2026/11").unwrap();
        assert_eq!(insert_games(&conn, "someone", &games).unwrap(), 2);
        assert_eq!(insert_games(&conn, "someone", &games).unwrap(), 0, "no duplicates");

        let list = list_games(&conn, "SOMEONE").unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].end_time >= list[1].end_time, "newest first");
        assert_eq!(count_pending(&conn).unwrap(), 2);

        // The newest pending game is analysed first.
        let (id, pgn) = next_pending(&conn).unwrap().unwrap();
        assert_eq!(id, list[0].id);
        assert!(pgn.contains("Qxf7#"));
        set_status(&conn, id, "running", None, None).unwrap();
        assert_eq!(reset_interrupted(&conn).unwrap(), 1);
        set_status(&conn, id, "done", Some(r#"{"evals":[]}"#), None).unwrap();
        let detail = get_game(&conn, id).unwrap().unwrap();
        assert_eq!(detail.summary.analysis_status, "done");
        assert_eq!(detail.analysis.unwrap()["evals"], serde_json::json!([]));
        set_review_summary(&conn, id, &serde_json::json!({"accuracy": 71.5})).unwrap();
        assert_eq!(list_games(&conn, "someone").unwrap()[0].review_summary.as_ref().unwrap()["accuracy"], 71.5);

        let card = TrainingCard {
            ply: 6,
            fen: "x".into(),
            played_uci: "g8f6".into(),
            played_san: "Nf6".into(),
            best_uci: "g7g6".into(),
            best_san: "g6".into(),
            judgement: "blunder".into(),
            win_before: 45.0,
            win_after: 2.0,
        };
        assert_eq!(save_cards(&conn, id, &[card.clone()]).unwrap(), 1);
        assert_eq!(save_cards(&conn, id, &[card]).unwrap(), 0, "same card isn't added twice");
        assert_eq!(count_cards(&conn).unwrap(), 1);

        // The positions index feeds the "My games" explorer.
        assert_eq!(index_positions(&conn).unwrap(), 2);
        assert_eq!(index_positions(&conn).unwrap(), 0, "already indexed");
        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let as_white = my_games_explorer(&conn, "someone", "white", start).unwrap();
        assert_eq!(as_white.moves.len(), 1);
        assert_eq!((as_white.moves[0].san.as_str(), as_white.white, as_white.black), ("e4", 1, 0));
        let after_e4_e5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
        let as_black = my_games_explorer(&conn, "someone", "black", after_e4_e5).unwrap();
        assert_eq!(as_black.moves[0].san, "Bc4", "the opponent's move in my game as Black");
        assert_eq!(as_black.white, 1, "that game was won by White");

        requeue(&conn, id).unwrap();
        let again = get_game(&conn, id).unwrap().unwrap();
        assert_eq!(again.summary.analysis_status, "pending");
        assert!(again.analysis.is_none());
    }
}
