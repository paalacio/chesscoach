//! The app's SQLite database (in the app-data folder).
//!
//! Schema changes are "migrations": numbered SQL steps that run once, in order.
//! Never edit a migration that has shipped; add a new one at the end instead.

use rusqlite::{Connection, OptionalExtension, params};
use rusqlite_migration::{M, Migrations};
use std::path::Path;

pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // 1: Claude answer cache + a log of calls (for the "calls today" counter).
        M::up(
            "CREATE TABLE claude_cache (
                key            TEXT PRIMARY KEY,
                kind           TEXT NOT NULL,
                fen            TEXT NOT NULL,
                move_played    TEXT,
                model          TEXT NOT NULL,
                prompt_version INTEGER NOT NULL,
                response_json  TEXT NOT NULL,
                created_at     INTEGER NOT NULL
            );
            CREATE TABLE claude_calls (
                id      INTEGER PRIMARY KEY,
                at      INTEGER NOT NULL,      -- unix seconds
                kind    TEXT NOT NULL,
                ok      INTEGER NOT NULL       -- 1 = answered, 0 = error
            );
            CREATE INDEX claude_calls_at ON claude_calls(at);",
        ),
        // 2: imported games, which monthly archives were fetched, and training
        //    cards made from the user's mistakes (the trainer arrives in Phase 4).
        M::up(
            "CREATE TABLE games (
                id              INTEGER PRIMARY KEY,
                source          TEXT NOT NULL DEFAULT 'chesscom',
                url             TEXT NOT NULL,          -- unique id of the game at the source
                username        TEXT NOT NULL,          -- the user's account (lowercase)
                archive         TEXT NOT NULL,          -- 'YYYY/MM'
                pgn             TEXT NOT NULL,
                white           TEXT NOT NULL,
                black           TEXT NOT NULL,
                white_elo       INTEGER,
                black_elo       INTEGER,
                my_color        TEXT NOT NULL,          -- 'white' | 'black'
                result          TEXT NOT NULL,          -- '1-0' | '0-1' | '1/2-1/2'
                my_result       TEXT NOT NULL,          -- 'win' | 'loss' | 'draw'
                termination     TEXT,
                time_class      TEXT,
                time_control    TEXT,
                end_time        INTEGER,                -- unix seconds
                eco             TEXT,
                opening         TEXT,
                ply_count       INTEGER NOT NULL DEFAULT 0,
                analysis_status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error
                analysis_json   TEXT,                   -- engine evaluation of every position
                analysis_error  TEXT,
                review_summary  TEXT,                   -- accuracy etc., computed by the frontend
                imported_at     INTEGER NOT NULL,
                UNIQUE (source, url)
            );
            CREATE INDEX games_user_time ON games(username, end_time DESC);
            CREATE INDEX games_status ON games(analysis_status);

            CREATE TABLE sync_archives (
                username   TEXT NOT NULL,
                archive    TEXT NOT NULL,
                etag       TEXT,
                fetched_at INTEGER NOT NULL,
                PRIMARY KEY (username, archive)
            );

            CREATE TABLE training_cards (
                id          INTEGER PRIMARY KEY,
                game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                ply         INTEGER NOT NULL,
                fen         TEXT NOT NULL,              -- position where it was the user's move
                played_uci  TEXT NOT NULL,
                played_san  TEXT NOT NULL,
                best_uci    TEXT NOT NULL,
                best_san    TEXT NOT NULL,
                judgement   TEXT NOT NULL,              -- 'mistake' | 'blunder'
                win_before  REAL NOT NULL,
                win_after   REAL NOT NULL,
                created_at  INTEGER NOT NULL,
                UNIQUE (game_id, ply)
            );",
        ),
        // 3: Lichess explorer cache, and every position of the user's games
        //    (for the "My games" explorer and, later, the repertoire report).
        M::up(
            "CREATE TABLE explorer_cache (
                key        TEXT PRIMARY KEY,           -- source + filters + EPD
                json       TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            );
            CREATE TABLE game_positions (
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                ply     INTEGER NOT NULL,              -- the move number in half-moves (1 = first move)
                epd     TEXT NOT NULL,                 -- position BEFORE the move (FEN without counters)
                uci     TEXT NOT NULL,
                san     TEXT NOT NULL,
                PRIMARY KEY (game_id, ply)
            );
            CREATE INDEX game_positions_epd ON game_positions(epd);",
        ),
        // 4: repertoires (moves keyed by position, so transpositions merge), the trainer's
        //    spaced-repetition cards and their review history.
        M::up(
            "CREATE TABLE repertoires (
                id         INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                color      TEXT NOT NULL,               -- 'white' | 'black': the side the user plays
                meta_json  TEXT NOT NULL DEFAULT '{}',  -- chosen lines, build settings (written by the UI)
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE repertoire_moves (
                rep_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
                epd    TEXT NOT NULL,                   -- position before the move (FEN without counters)
                fen    TEXT NOT NULL,                   -- a full FEN of that position
                uci    TEXT NOT NULL,
                san    TEXT NOT NULL,
                mine   INTEGER NOT NULL,                -- 1 = the user's move (one per position), 0 = opponent reply
                share  REAL,                            -- opponent replies: % of games at the user's level
                source TEXT NOT NULL,                   -- claude | theory | engine | explorer | user | pgn
                PRIMARY KEY (rep_id, epd, uci)
            );
            CREATE TABLE repertoire_notes (
                rep_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
                epd    TEXT NOT NULL,
                note   TEXT NOT NULL DEFAULT '',        -- the user's own note
                why    TEXT,                            -- Claude's one-line reason for the user's move
                PRIMARY KEY (rep_id, epd)
            );
            CREATE TABLE srs_cards (
                id         TEXT PRIMARY KEY,            -- 'rep:<repertoire id>:<epd>' | 'mistake:<training card id>'
                kind       TEXT NOT NULL,               -- 'repertoire' | 'mistake'
                answer     TEXT NOT NULL,               -- the move (UCI) the card was learned with
                card_json  TEXT NOT NULL,               -- the ts-fsrs card
                due        INTEGER NOT NULL,            -- unix seconds (copy of the card's dueAt)
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX srs_cards_due ON srs_cards(due);
            CREATE TABLE srs_reviews (
                id          INTEGER PRIMARY KEY,
                card_id     TEXT NOT NULL,
                rating      INTEGER NOT NULL,           -- 1 again, 2 hard, 3 good, 4 easy
                reviewed_at INTEGER NOT NULL,           -- unix seconds
                log_json    TEXT NOT NULL               -- the ts-fsrs review log
            );
            CREATE INDEX srs_reviews_at ON srs_reviews(reviewed_at);",
        ),
        // 5: courses / books / studies imported as repertoires. The file and the author's
        //    notes live only here, in the app-data database (never in the repo or the app).
        M::up(
            "CREATE TABLE courses (
                rep_id      INTEGER PRIMARY KEY REFERENCES repertoires(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                file_name   TEXT NOT NULL,
                pgn         TEXT NOT NULL,              -- the imported file, as it was
                imported_at INTEGER NOT NULL
            );
            CREATE TABLE course_annotations (
                rep_id  INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
                epd     TEXT NOT NULL,                  -- position before the move
                uci     TEXT NOT NULL,                  -- '' = a note about the position itself
                san     TEXT NOT NULL,
                comment TEXT NOT NULL,                  -- the author's words
                nags    TEXT NOT NULL,                  -- annotation symbols: ! ?! ± ...
                main    INTEGER NOT NULL,               -- 1 = in the repertoire, 0 = a side line
                PRIMARY KEY (rep_id, epd, uci)
            );",
        ),
    ])
}

/// Opens (or creates) the database file and brings its schema up to date.
pub fn open(path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| format!("Could not open the database: {e}"))?;
    prepare(&mut conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection, String> {
    let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    prepare(&mut conn)?;
    Ok(conn)
}

fn prepare(conn: &mut Connection) -> Result<(), String> {
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    migrations().to_latest(conn).map_err(|e| format!("Database migration failed: {e}"))
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn cache_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT response_json FROM claude_cache WHERE key = ?1", [key], |r| r.get(0))
        .optional()
}

pub struct CacheEntry<'a> {
    pub key: &'a str,
    pub kind: &'a str,
    pub fen: &'a str,
    pub move_played: Option<&'a str>,
    pub model: &'a str,
    pub prompt_version: u32,
    pub response_json: &'a str,
}

pub fn cache_put(conn: &Connection, e: &CacheEntry) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO claude_cache
            (key, kind, fen, move_played, model, prompt_version, response_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![e.key, e.kind, e.fen, e.move_played, e.model, e.prompt_version, e.response_json, now()],
    )?;
    Ok(())
}

/// Records a real (not cached) Claude call.
pub fn record_call(conn: &Connection, kind: &str, ok: bool) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO claude_calls (at, kind, ok) VALUES (?1, ?2, ?3)", params![now(), kind, ok])?;
    Ok(())
}

/// Number of real Claude calls since local midnight.
pub fn calls_today(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM claude_calls
         WHERE date(at, 'unixepoch', 'localtime') = date('now', 'localtime')",
        [],
        |r| r.get(0),
    )
}

/// Number of migrations (the schema version a fresh database ends up at).
pub fn migrations_count() -> i64 {
    5
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        migrations().validate().unwrap();
    }

    #[test]
    fn migrating_twice_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite");
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, migrations_count());
    }

    #[test]
    fn cache_round_trip_and_replace() {
        let conn = open_in_memory().unwrap();
        assert_eq!(cache_get(&conn, "k").unwrap(), None);
        let mut e = CacheEntry {
            key: "k",
            kind: "positionPlan",
            fen: "fen",
            move_played: None,
            model: "sonnet",
            prompt_version: 1,
            response_json: r#"{"summary":"a"}"#,
        };
        cache_put(&conn, &e).unwrap();
        assert_eq!(cache_get(&conn, "k").unwrap().as_deref(), Some(r#"{"summary":"a"}"#));
        e.response_json = r#"{"summary":"b"}"#;
        cache_put(&conn, &e).unwrap();
        assert_eq!(cache_get(&conn, "k").unwrap().as_deref(), Some(r#"{"summary":"b"}"#));
    }

    #[test]
    fn counts_todays_calls_only() {
        let conn = open_in_memory().unwrap();
        record_call(&conn, "positionPlan", true).unwrap();
        record_call(&conn, "positionPlan", false).unwrap();
        // A call from three days ago doesn't count.
        conn.execute("INSERT INTO claude_calls (at, kind, ok) VALUES (?1, 'x', 1)", [now() - 3 * 86_400])
            .unwrap();
        assert_eq!(calls_today(&conn).unwrap(), 2);
    }
}
