//! Storage for Phase 4: repertoires, the trainer's spaced-repetition cards and
//! their review history, plus database backup and restore.
//!
//! The chess logic (building a repertoire, which card is due, FSRS scheduling)
//! lives in the TypeScript core (`src/core/repertoire.ts`, `src/core/srs.ts`);
//! this module only stores and returns rows.

use crate::db::{self, now};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

// ---------- repertoires ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireInfo {
    pub id: i64,
    pub name: String,
    /// "white" | "black": the side the user plays.
    pub color: String,
    /// Chosen lines and build settings; written and read by the UI.
    pub meta: Value,
    pub move_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One move of a repertoire. Positions are keyed by EPD (FEN without move
/// counters), so lines that transpose into each other share their moves.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepMove {
    pub epd: String,
    /// A full FEN of the position before the move.
    pub fen: String,
    pub uci: String,
    pub san: String,
    /// true = the user's move (one per position), false = an opponent reply.
    pub mine: bool,
    /// Opponent replies: % of games at the user's level that chose this move.
    pub share: Option<f64>,
    /// Where the move came from: "claude", "theory", "engine", "explorer", "user", "pgn".
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepNote {
    pub epd: String,
    pub note: String,
    /// Claude's one-line reason for the user's move here (cached).
    pub why: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireData {
    pub info: RepertoireInfo,
    pub moves: Vec<RepMove>,
    pub notes: Vec<RepNote>,
    /** Set when the repertoire was imported from a course / book / study. */
    pub course: Option<CourseInfo>,
    /// The author's notes on the course's moves.
    pub annotations: Vec<CourseAnnotation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CourseInfo {
    pub title: String,
    pub file_name: String,
    pub imported_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CourseAnnotation {
    pub epd: String,
    /// "" = a note about the position itself.
    pub uci: String,
    pub san: String,
    pub comment: String,
    pub nags: String,
    /// true = the move is in the repertoire; false = a side line the course shows.
    pub main: bool,
}

const INFO_SELECT: &str = "SELECT r.id, r.name, r.color, r.meta_json, r.created_at, r.updated_at,
        (SELECT COUNT(*) FROM repertoire_moves m WHERE m.rep_id = r.id)
     FROM repertoires r";

fn info_from_row(r: &rusqlite::Row) -> rusqlite::Result<RepertoireInfo> {
    let meta: String = r.get(3)?;
    Ok(RepertoireInfo {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        meta: serde_json::from_str(&meta).unwrap_or(Value::Null),
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        move_count: r.get(6)?,
    })
}

pub fn list_repertoires(conn: &Connection) -> rusqlite::Result<Vec<RepertoireInfo>> {
    conn.prepare(&format!("{INFO_SELECT} ORDER BY r.color DESC, r.id"))?
        .query_map([], info_from_row)?
        .collect()
}

pub fn create_repertoire(conn: &Connection, name: &str, color: &str, meta: &Value) -> rusqlite::Result<i64> {
    let t = now();
    conn.execute(
        "INSERT INTO repertoires (name, color, meta_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![name, color, meta.to_string(), t],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_repertoire(conn: &Connection, id: i64) -> rusqlite::Result<Option<RepertoireData>> {
    let Some(info) = conn.query_row(&format!("{INFO_SELECT} WHERE r.id = ?1"), [id], info_from_row).optional()? else {
        return Ok(None);
    };
    let moves = conn
        .prepare("SELECT epd, fen, uci, san, mine, share, source FROM repertoire_moves WHERE rep_id = ?1")?
        .query_map([id], |r| {
            Ok(RepMove {
                epd: r.get(0)?,
                fen: r.get(1)?,
                uci: r.get(2)?,
                san: r.get(3)?,
                mine: r.get(4)?,
                share: r.get(5)?,
                source: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let notes = conn
        .prepare("SELECT epd, note, why FROM repertoire_notes WHERE rep_id = ?1")?
        .query_map([id], |r| Ok(RepNote { epd: r.get(0)?, note: r.get(1)?, why: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let course = conn
        .query_row("SELECT title, file_name, imported_at FROM courses WHERE rep_id = ?1", [id], |r| {
            Ok(CourseInfo { title: r.get(0)?, file_name: r.get(1)?, imported_at: r.get(2)? })
        })
        .optional()?;
    let annotations = conn
        .prepare("SELECT epd, uci, san, comment, nags, main FROM course_annotations WHERE rep_id = ?1")?
        .query_map([id], |r| {
            Ok(CourseAnnotation { epd: r.get(0)?, uci: r.get(1)?, san: r.get(2)?, comment: r.get(3)?, nags: r.get(4)?, main: r.get(5)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(RepertoireData { info, moves, notes, course, annotations }))
}

/// Replaces all the moves of a repertoire (it's at most a few thousand rows,
/// so the UI simply saves the whole thing after each change).
pub fn save_moves(conn: &Connection, id: i64, moves: &[RepMove]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM repertoire_moves WHERE rep_id = ?1", [id])?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO repertoire_moves (rep_id, epd, fen, uci, san, mine, share, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for m in moves {
            stmt.execute(params![id, m.epd, m.fen, m.uci, m.san, m.mine, m.share, m.source])?;
        }
    }
    tx.execute("UPDATE repertoires SET updated_at = ?2 WHERE id = ?1", params![id, now()])?;
    tx.commit()
}

pub fn update_repertoire(conn: &Connection, id: i64, name: Option<&str>, meta: Option<&Value>) -> rusqlite::Result<()> {
    if let Some(name) = name {
        conn.execute("UPDATE repertoires SET name = ?2, updated_at = ?3 WHERE id = ?1", params![id, name, now()])?;
    }
    if let Some(meta) = meta {
        conn.execute(
            "UPDATE repertoires SET meta_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, meta.to_string(), now()],
        )?;
    }
    Ok(())
}

/// Saves an imported course for a repertoire: the file as it was, and the author's notes
/// (replacing an earlier import).
pub fn save_course(
    conn: &Connection,
    id: i64,
    title: &str,
    file_name: &str,
    pgn: &str,
    annotations: &[CourseAnnotation],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR REPLACE INTO courses (rep_id, title, file_name, pgn, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, file_name, pgn, now()],
    )?;
    tx.execute("DELETE FROM course_annotations WHERE rep_id = ?1", [id])?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO course_annotations (rep_id, epd, uci, san, comment, nags, main)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for a in annotations {
            stmt.execute(params![id, a.epd, a.uci, a.san, a.comment, a.nags, a.main])?;
        }
    }
    tx.commit()
}

/// Deletes a repertoire, its moves and notes (cascade) and its trainer cards.
pub fn delete_repertoire(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM srs_cards WHERE id LIKE ?1", [format!("rep:{id}:%")])?;
    tx.execute("DELETE FROM repertoires WHERE id = ?1", [id])?;
    tx.commit()
}

/// Saves the note and/or Claude's "why" for a position (None leaves it as it is).
pub fn set_note(conn: &Connection, id: i64, epd: &str, note: Option<&str>, why: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO repertoire_notes (rep_id, epd, note, why) VALUES (?1, ?2, COALESCE(?3, ''), ?4)
         ON CONFLICT (rep_id, epd) DO UPDATE SET
            note = COALESCE(?3, note),
            why = COALESCE(?4, why)",
        params![id, epd, note, why],
    )?;
    Ok(())
}

// ---------- trainer: spaced-repetition cards ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SrsCard {
    /// "rep:<repertoire id>:<epd>" or "mistake:<training card id>".
    pub id: String,
    /// "repertoire" | "mistake"
    pub kind: String,
    /// The move (UCI) this card was learned with. If the repertoire move changes,
    /// the UI treats the card as new again.
    pub answer: String,
    /// The ts-fsrs card (stability, difficulty, dueAt, ...).
    pub card: Value,
    /// Unix seconds; a copy of the card's due date, so it can be queried.
    pub due: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SrsReview {
    pub card_id: String,
    /// 1 = again, 2 = hard, 3 = good, 4 = easy.
    pub rating: i64,
    /// Unix seconds.
    pub reviewed_at: i64,
    /// The ts-fsrs review log.
    pub log: Value,
}

pub fn srs_list(conn: &Connection) -> rusqlite::Result<Vec<SrsCard>> {
    conn.prepare("SELECT id, kind, answer, card_json, due, updated_at FROM srs_cards")?
        .query_map([], |r| {
            let card: String = r.get(3)?;
            Ok(SrsCard {
                id: r.get(0)?,
                kind: r.get(1)?,
                answer: r.get(2)?,
                card: serde_json::from_str(&card).unwrap_or(Value::Null),
                due: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .collect()
}

fn upsert_card(conn: &Connection, c: &SrsCard) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO srs_cards (id, kind, answer, card_json, due, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![c.id, c.kind, c.answer, c.card.to_string(), c.due, c.updated_at],
    )?;
    Ok(())
}

fn insert_review(conn: &Connection, r: &SrsReview) -> rusqlite::Result<usize> {
    // The same review twice (e.g. importing a file again) is only stored once.
    conn.execute(
        "INSERT INTO srs_reviews (card_id, rating, reviewed_at, log_json)
         SELECT ?1, ?2, ?3, ?4
         WHERE NOT EXISTS (SELECT 1 FROM srs_reviews WHERE card_id = ?1 AND reviewed_at = ?3 AND rating = ?2)",
        params![r.card_id, r.rating, r.reviewed_at, r.log.to_string()],
    )
}

/// Saves a card after a review, together with the review itself.
pub fn srs_record(conn: &Connection, card: &SrsCard, review: &SrsReview) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    upsert_card(&tx, card)?;
    insert_review(&tx, review)?;
    tx.commit()
}

/// Per local day ("2026-11-26"): how many reviews, and how many cards were reviewed
/// for the first time (new moves learned). For the daily goal, the streak and the
/// new-moves-per-day limit.
pub fn srs_review_days(conn: &Connection, days: i64) -> rusqlite::Result<Vec<(String, i64, i64)>> {
    conn.prepare(
        "WITH firsts AS (SELECT date(MIN(reviewed_at), 'unixepoch', 'localtime') AS day FROM srs_reviews GROUP BY card_id)
         SELECT date(reviewed_at, 'unixepoch', 'localtime') AS day, COUNT(*),
                (SELECT COUNT(*) FROM firsts f WHERE f.day = date(r.reviewed_at, 'unixepoch', 'localtime'))
         FROM srs_reviews r WHERE reviewed_at >= ?1 GROUP BY day ORDER BY day",
    )?
    .query_map([now() - days * 86_400], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
    .collect()
}

pub fn srs_reviews_all(conn: &Connection) -> rusqlite::Result<Vec<SrsReview>> {
    conn.prepare("SELECT card_id, rating, reviewed_at, log_json FROM srs_reviews ORDER BY reviewed_at, id")?
        .query_map([], |r| {
            let log: String = r.get(3)?;
            Ok(SrsReview {
                card_id: r.get(0)?,
                rating: r.get(1)?,
                reviewed_at: r.get(2)?,
                log: serde_json::from_str(&log).unwrap_or(Value::Null),
            })
        })?
        .collect()
}

/// Imports cards and reviews (from an exported file). A card replaces the stored one
/// only if it was updated later; reviews already stored are skipped.
/// Returns (cards written, reviews added).
pub fn srs_import(conn: &Connection, cards: &[SrsCard], reviews: &[SrsReview]) -> rusqlite::Result<(usize, usize)> {
    let tx = conn.unchecked_transaction()?;
    let mut written = 0;
    for c in cards {
        let stored: Option<i64> =
            tx.query_row("SELECT updated_at FROM srs_cards WHERE id = ?1", [&c.id], |r| r.get(0)).optional()?;
        if stored.is_none_or(|at| at < c.updated_at) {
            upsert_card(&tx, c)?;
            written += 1;
        }
    }
    let mut added = 0;
    for r in reviews {
        added += insert_review(&tx, r)?;
    }
    tx.commit()?;
    Ok((written, added))
}

// ---------- mistakes from game reviews, and the opening moves of games ----------

/// A "find the better move" card from a reviewed game (Phase 2), with the game it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MistakeCard {
    pub id: i64,
    pub game_id: i64,
    pub ply: i64,
    pub fen: String,
    pub played_uci: String,
    pub played_san: String,
    pub best_uci: String,
    pub best_san: String,
    pub judgement: String,
    pub win_before: f64,
    pub win_after: f64,
    pub my_color: String,
    pub opponent: String,
    pub url: String,
    pub end_time: Option<i64>,
}

pub fn mistake_cards(conn: &Connection) -> rusqlite::Result<Vec<MistakeCard>> {
    conn.prepare(
        "SELECT c.id, c.game_id, c.ply, c.fen, c.played_uci, c.played_san, c.best_uci, c.best_san, c.judgement,
                c.win_before, c.win_after, g.my_color, CASE g.my_color WHEN 'white' THEN g.black ELSE g.white END,
                g.url, g.end_time
         FROM training_cards c JOIN games g ON g.id = c.game_id
         ORDER BY g.end_time DESC, c.ply",
    )?
    .query_map([], |r| {
        Ok(MistakeCard {
            id: r.get(0)?,
            game_id: r.get(1)?,
            ply: r.get(2)?,
            fen: r.get(3)?,
            played_uci: r.get(4)?,
            played_san: r.get(5)?,
            best_uci: r.get(6)?,
            best_san: r.get(7)?,
            judgement: r.get(8)?,
            win_before: r.get(9)?,
            win_after: r.get(10)?,
            my_color: r.get(11)?,
            opponent: r.get(12)?,
            url: r.get(13)?,
            end_time: r.get(14)?,
        })
    })?
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlyMove {
    pub ply: i64,
    /// Position before the move.
    pub epd: String,
    pub uci: String,
    pub san: String,
}

/// The opening moves of a game, for the "where did my games leave the repertoire" report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameMoves {
    pub game_id: i64,
    pub url: String,
    pub my_color: String,
    pub opponent: String,
    pub my_result: String,
    pub end_time: Option<i64>,
    pub moves: Vec<PlyMove>,
}

/// The first `max_ply` moves of the `limit` most recent games.
pub fn recent_game_moves(conn: &Connection, limit: i64, max_ply: i64) -> rusqlite::Result<Vec<GameMoves>> {
    let mut games: Vec<GameMoves> = conn
        .prepare(
            "SELECT id, url, my_color, CASE my_color WHEN 'white' THEN black ELSE white END, my_result, end_time
             FROM games ORDER BY end_time DESC, id DESC LIMIT ?1",
        )?
        .query_map([limit], |r| {
            Ok(GameMoves {
                game_id: r.get(0)?,
                url: r.get(1)?,
                my_color: r.get(2)?,
                opponent: r.get(3)?,
                my_result: r.get(4)?,
                end_time: r.get(5)?,
                moves: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt =
        conn.prepare_cached("SELECT ply, epd, uci, san FROM game_positions WHERE game_id = ?1 AND ply <= ?2 ORDER BY ply")?;
    for g in &mut games {
        g.moves = stmt
            .query_map(params![g.game_id, max_ply], |r| {
                Ok(PlyMove { ply: r.get(0)?, epd: r.get(1)?, uci: r.get(2)?, san: r.get(3)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(games)
}

// ---------- insights ----------

/// How often each of Claude's concept tags comes up in its game reviews (each game
/// counted once, even if it was reviewed in two languages), most frequent first.
pub fn concept_counts(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT fen, response_json FROM claude_cache WHERE kind = 'gameReview' ORDER BY created_at")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    // The latest review of each game (the cache "fen" of a game review is "game:<url>").
    let mut latest: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (game, json) in rows {
        latest.insert(game, json);
    }
    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for json in latest.values() {
        let Ok(v) = serde_json::from_str::<Value>(json) else { continue };
        let mut tags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for lesson in v["lessons"].as_array().into_iter().flatten() {
            if let Some(t) = lesson["concept"].as_str() {
                tags.insert(t.to_string());
            }
        }
        for t in v["concepts"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            tags.insert(t.to_string());
        }
        for t in tags {
            *counts.entry(t).or_default() += 1;
        }
    }
    let mut out: Vec<(String, i64)> = counts.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(out)
}

// ---------- backup and restore ----------

/// Writes a complete, compact copy of the database to `path` (replacing the file).
pub fn backup_to(conn: &Connection, path: &Path) -> Result<(), String> {
    if path.exists() {
        // The user already confirmed replacing it in the save dialog.
        std::fs::remove_file(path).map_err(|e| format!("Could not replace {}: {e}", path.display()))?;
    }
    let target = path.to_str().ok_or("The file name has unsupported characters.")?;
    conn.execute("VACUUM INTO ?1", [target]).map_err(|e| format!("Backup failed: {e}"))?;
    Ok(())
}

/// Replaces the live database with the backup at `path`, then brings its schema
/// up to date. Before that, the current database is saved as `safety_copy`.
pub fn restore_from(conn: &mut Connection, path: &Path, safety_copy: &Path) -> Result<(), String> {
    let src = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open that file: {e}"))?;
    // Is it one of our databases, from this version or an older one?
    let looks_right: bool = src
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'claude_cache'", [], |r| {
            r.get::<_, i64>(0)
        })
        .map(|n| n == 1)
        .unwrap_or(false);
    if !looks_right {
        return Err("That file isn't a Tung Tung Chessahur backup.".into());
    }
    let version: i64 = src.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap_or(0);
    if version > db::migrations_count() {
        return Err("That backup comes from a newer version of Tung Tung Chessahur. Update the app first.".into());
    }
    backup_to(conn, safety_copy)?;
    let backup = rusqlite::backup::Backup::new(&src, conn).map_err(|e| format!("Restore failed: {e}"))?;
    backup
        .run_to_completion(256, std::time::Duration::ZERO, None)
        .map_err(|e| format!("Restore failed: {e}"))?;
    drop(backup);
    db::migrations().to_latest(conn).map_err(|e| format!("Database migration failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::{self, TrainingCard};
    use serde_json::json;

    fn mv(epd: &str, uci: &str, mine: bool) -> RepMove {
        RepMove {
            epd: epd.into(),
            fen: format!("{epd} 0 1"),
            uci: uci.into(),
            san: uci.into(),
            mine,
            share: if mine { None } else { Some(40.0) },
            source: "user".into(),
        }
    }

    #[test]
    fn repertoire_round_trip() {
        let conn = db::open_in_memory().unwrap();
        let id = create_repertoire(&conn, "Black", "black", &json!({"lines": []})).unwrap();
        save_moves(&conn, id, &[mv("a", "e2e4", false), mv("b", "c7c5", true)]).unwrap();
        // Saving again replaces everything.
        save_moves(&conn, id, &[mv("a", "e2e4", false), mv("a", "d2d4", false), mv("b", "c7c5", true)]).unwrap();
        set_note(&conn, id, "b", Some("The Sicilian"), None).unwrap();
        set_note(&conn, id, "b", None, Some("Fights for d4")).unwrap();
        update_repertoire(&conn, id, Some("Black: Sicilian"), None).unwrap();

        let data = get_repertoire(&conn, id).unwrap().unwrap();
        assert_eq!(data.info.name, "Black: Sicilian");
        assert_eq!(data.info.move_count, 3);
        assert_eq!(data.info.meta, json!({"lines": []}));
        assert_eq!(data.moves.len(), 3);
        assert_eq!(data.notes, vec![RepNote { epd: "b".into(), note: "The Sicilian".into(), why: Some("Fights for d4".into()) }]);
        assert_eq!(list_repertoires(&conn).unwrap().len(), 1);
    }

    #[test]
    fn deleting_a_repertoire_removes_its_moves_and_cards() {
        let conn = db::open_in_memory().unwrap();
        let id = create_repertoire(&conn, "White", "white", &json!({})).unwrap();
        save_moves(&conn, id, &[mv("a", "e2e4", true)]).unwrap();
        let card = SrsCard {
            id: format!("rep:{id}:a"),
            kind: "repertoire".into(),
            answer: "e2e4".into(),
            card: json!({"state": 2}),
            due: 100,
            updated_at: 1,
        };
        let review = SrsReview { card_id: card.id.clone(), rating: 3, reviewed_at: 50, log: json!({}) };
        srs_record(&conn, &card, &review).unwrap();
        delete_repertoire(&conn, id).unwrap();
        assert!(get_repertoire(&conn, id).unwrap().is_none());
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM repertoire_moves", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
        assert!(srs_list(&conn).unwrap().is_empty());
    }

    #[test]
    fn courses_are_kept_with_their_repertoire() {
        let conn = db::open_in_memory().unwrap();
        let id = create_repertoire(&conn, "Italian", "white", &json!({})).unwrap();
        let note = CourseAnnotation {
            epd: "a".into(),
            uci: "f1c4".into(),
            san: "Bc4".into(),
            comment: "Aims at f7.".into(),
            nags: "!".into(),
            main: true,
        };
        save_course(&conn, id, "My course", "course.pgn", "1. e4 *", std::slice::from_ref(&note)).unwrap();
        // Importing again replaces the notes.
        save_course(&conn, id, "My course", "course.pgn", "1. e4 *", std::slice::from_ref(&note)).unwrap();
        let data = get_repertoire(&conn, id).unwrap().unwrap();
        assert_eq!(data.course.map(|c| c.title), Some("My course".to_string()));
        assert_eq!(data.annotations, vec![note]);
        delete_repertoire(&conn, id).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM courses", [], |r| r.get(0)).unwrap();
        let notes: i64 = conn.query_row("SELECT COUNT(*) FROM course_annotations", [], |r| r.get(0)).unwrap();
        assert_eq!((left, notes), (0, 0));
    }

    #[test]
    fn srs_cards_reviews_and_import() {
        let conn = db::open_in_memory().unwrap();
        let mut card = SrsCard {
            id: "mistake:1".into(),
            kind: "mistake".into(),
            answer: "g1f3".into(),
            card: json!({"state": 1}),
            due: 1000,
            updated_at: 10,
        };
        let review = SrsReview { card_id: card.id.clone(), rating: 1, reviewed_at: now(), log: json!({"rating": 1}) };
        srs_record(&conn, &card, &review).unwrap();
        assert_eq!(srs_list(&conn).unwrap(), vec![card.clone()]);
        assert_eq!(srs_review_days(&conn, 30).unwrap().iter().map(|d| (d.1, d.2)).collect::<Vec<_>>(), [(1, 1)]);

        // Importing the same review again adds nothing; an older card doesn't overwrite a newer one.
        let older = SrsCard { updated_at: 5, card: json!({"state": 0}), ..card.clone() };
        assert_eq!(srs_import(&conn, &[older], std::slice::from_ref(&review)).unwrap(), (0, 0));
        card.updated_at = 20;
        card.due = 2000;
        assert_eq!(srs_import(&conn, std::slice::from_ref(&card), &[]).unwrap(), (1, 0));
        assert_eq!(srs_list(&conn).unwrap()[0].due, 2000);
        assert_eq!(srs_reviews_all(&conn).unwrap().len(), 1);
    }

    #[test]
    fn mistakes_and_opening_moves_come_with_their_game() {
        let conn = db::open_in_memory().unwrap();
        let pgn = "[White \"me\"]\n[Black \"them\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0";
        conn.execute(
            "INSERT INTO games (url, username, archive, pgn, white, black, my_color, result, my_result, end_time, imported_at)
             VALUES ('u1', 'me', '2026/11', ?1, 'me', 'them', 'white', '1-0', 'win', 100, 0)",
            [pgn],
        )
        .unwrap();
        games::index_positions(&conn).unwrap();
        let card = TrainingCard {
            ply: 5,
            fen: "fen".into(),
            played_uci: "f1b5".into(),
            played_san: "Bb5".into(),
            best_uci: "f1c4".into(),
            best_san: "Bc4".into(),
            judgement: "mistake".into(),
            win_before: 55.0,
            win_after: 44.0,
        };
        games::save_cards(&conn, 1, &[card]).unwrap();

        let m = mistake_cards(&conn).unwrap();
        assert_eq!((m.len(), m[0].opponent.as_str(), m[0].best_san.as_str()), (1, "them", "Bc4"));

        let g = recent_game_moves(&conn, 10, 4).unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].moves.iter().map(|m| m.san.as_str()).collect::<Vec<_>>(), ["e4", "e5", "Nf3", "Nc6"]);
        assert_eq!(g[0].opponent, "them");
    }

    #[test]
    fn concept_counts_count_each_game_once() {
        let conn = db::open_in_memory().unwrap();
        let put = |key: &str, fen: &str, json: &str| {
            db::cache_put(
                &conn,
                &db::CacheEntry { key, kind: "gameReview", fen, move_played: None, model: "sonnet", prompt_version: 1, response_json: json },
            )
            .unwrap();
        };
        let review = r#"{"lessons":[{"concept":"tactics"},{"concept":"development"}],"concepts":["tactics","center"]}"#;
        put("a-en", "game:a", review);
        put("a-pt", "game:a", review); // the same game in Portuguese: still one game
        put("b", "game:b", r#"{"lessons":[{"concept":"tactics"}],"concepts":[]}"#);
        let counts = concept_counts(&conn).unwrap();
        assert_eq!(counts[0], ("tactics".to_string(), 2));
        assert!(counts.contains(&("center".to_string(), 1)));
    }

    #[test]
    fn backup_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = db::open(&dir.path().join("live.sqlite")).unwrap();
        let id = create_repertoire(&conn, "Black", "black", &json!({})).unwrap();
        save_moves(&conn, id, &[mv("a", "e2e4", false)]).unwrap();

        let backup = dir.path().join("backup.sqlite");
        backup_to(&conn, &backup).unwrap();
        backup_to(&conn, &backup).unwrap(); // replacing an existing file works too

        // Change the live database, then restore the backup.
        delete_repertoire(&conn, id).unwrap();
        create_repertoire(&conn, "Other", "white", &json!({})).unwrap();
        let safety = dir.path().join("safety.sqlite");
        restore_from(&mut conn, &backup, &safety).unwrap();
        let reps = list_repertoires(&conn).unwrap();
        assert_eq!(reps.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["Black"]);
        assert_eq!(reps[0].move_count, 1);
        assert!(safety.exists());

        // Something that isn't a ChessCoach database is refused.
        let other = dir.path().join("other.sqlite");
        Connection::open(&other).unwrap().execute("CREATE TABLE x (a)", []).unwrap();
        assert!(restore_from(&mut conn, &other, &dir.path().join("s2.sqlite")).is_err());
    }
}
