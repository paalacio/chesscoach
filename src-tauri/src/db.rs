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

fn now() -> i64 {
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
        assert_eq!(version, 1);
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
