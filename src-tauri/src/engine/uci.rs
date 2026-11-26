//! Parsing of the text lines a UCI chess engine (Stockfish) prints.
//!
//! The engine talks in plain text lines such as:
//!   `info depth 20 seldepth 28 multipv 1 score cp 35 nodes 1234567 nps 1500000 time 823 pv e2e4 e7e5`
//!   `bestmove e2e4 ponder e7e5`
//! Scores are always from the point of view of the side to move.

use serde::Serialize;

/// An evaluation: centipawns (100 = one pawn) or "mate in N" (negative = getting mated).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum Score {
    Cp(i32),
    Mate(i32),
}

/// Set when the engine only knows the score is at least / at most this value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Bound {
    Lower,
    Upper,
}

/// One `info` line that carries a principal variation (a candidate line).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoLine {
    pub depth: u32,
    pub seldepth: Option<u32>,
    /// 1 = best line, 2 = second best, ... (MultiPV)
    pub multipv: u32,
    pub score: Score,
    pub bound: Option<Bound>,
    pub nodes: Option<u64>,
    pub nps: Option<u64>,
    pub time_ms: Option<u64>,
    /// Moves in UCI notation (e.g. "e2e4", "e7e8q").
    pub pv: Vec<String>,
}

/// Parses an `info ...` line. Returns `None` for info lines that don't describe a
/// candidate line (e.g. `info string ...` or `info depth 5 currmove e2e4`).
pub fn parse_info(line: &str) -> Option<InfoLine> {
    let mut tokens = line.split_whitespace();
    if tokens.next()? != "info" {
        return None;
    }

    let mut depth = None;
    let mut seldepth = None;
    let mut multipv = 1;
    let mut score = None;
    let mut bound = None;
    let mut nodes = None;
    let mut nps = None;
    let mut time_ms = None;
    let mut pv = Vec::new();

    while let Some(tok) = tokens.next() {
        match tok {
            "depth" => depth = tokens.next()?.parse().ok(),
            "seldepth" => seldepth = tokens.next()?.parse().ok(),
            "multipv" => multipv = tokens.next()?.parse().ok()?,
            "nodes" => nodes = tokens.next()?.parse().ok(),
            "nps" => nps = tokens.next()?.parse().ok(),
            "time" => time_ms = tokens.next()?.parse().ok(),
            "score" => {
                let kind = tokens.next()?;
                let value: i32 = tokens.next()?.parse().ok()?;
                score = Some(match kind {
                    "cp" => Score::Cp(value),
                    "mate" => Score::Mate(value),
                    _ => return None,
                });
            }
            "lowerbound" => bound = Some(Bound::Lower),
            "upperbound" => bound = Some(Bound::Upper),
            // `string` swallows the rest of the line, so there's nothing more to read.
            "string" => return None,
            // `pv` is always last: everything after it is a move.
            "pv" => {
                pv = tokens.by_ref().map(str::to_owned).collect();
            }
            _ => {} // hashfull, tbhits, wdl, currmove, ... are not needed
        }
    }

    Some(InfoLine {
        depth: depth?,
        seldepth,
        multipv,
        score: score?,
        bound,
        nodes,
        nps,
        time_ms,
        pv,
    })
}

/// Parses `bestmove e2e4 [ponder e7e5]`. Returns (best, ponder).
/// Stockfish prints `bestmove (none)` when there are no legal moves.
pub fn parse_bestmove(line: &str) -> Option<(Option<String>, Option<String>)> {
    let mut tokens = line.split_whitespace();
    if tokens.next()? != "bestmove" {
        return None;
    }
    let best = tokens.next().filter(|m| *m != "(none)").map(str::to_owned);
    let ponder = match (tokens.next(), tokens.next()) {
        (Some("ponder"), Some(m)) => Some(m.to_owned()),
        _ => None,
    };
    Some((best, ponder))
}

/// Parses `id name Stockfish 19`.
pub fn parse_id_name(line: &str) -> Option<String> {
    line.strip_prefix("id name ").map(|s| s.trim().to_owned())
}

/// Keeps track of which search the engine's output belongs to.
///
/// Problem: when we start analysing a new position, the engine may still print a few
/// lines from the previous search. UCI guarantees exactly one `bestmove` per `go`,
/// and output comes out in order, so we count: while the number of `bestmove`s seen
/// is lower than the number of `go`s sent minus one, the lines are from an old search.
#[derive(Debug, Default, Clone)]
pub struct SearchTracker {
    gos_sent: u64,
    bestmoves_seen: u64,
    /// Id of the latest analysis, chosen by the caller, sent along with events.
    pub analysis_id: u64,
    /// FEN of the latest analysis.
    pub fen: String,
}

impl SearchTracker {
    /// Call right before writing `go` to the engine.
    pub fn on_go(&mut self, analysis_id: u64, fen: String) {
        self.gos_sent += 1;
        self.analysis_id = analysis_id;
        self.fen = fen;
    }

    /// Is a search running (a `go` without its `bestmove` yet)?
    pub fn searching(&self) -> bool {
        self.gos_sent > self.bestmoves_seen
    }

    /// Does the output being read right now belong to the latest `go`?
    pub fn output_is_current(&self) -> bool {
        self.gos_sent > 0 && self.bestmoves_seen + 1 == self.gos_sent
    }

    /// Call when a `bestmove` line is read. Returns true if it ends the latest search.
    pub fn on_bestmove(&mut self) -> bool {
        let current = self.output_is_current();
        self.bestmoves_seen += 1;
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_full_info_line() {
        let line = "info depth 20 seldepth 28 multipv 1 score cp 35 nodes 1234567 nps 1500000 hashfull 120 tbhits 0 time 823 pv e2e4 e7e5 g1f3";
        let info = parse_info(line).unwrap();
        assert_eq!(info.depth, 20);
        assert_eq!(info.seldepth, Some(28));
        assert_eq!(info.multipv, 1);
        assert_eq!(info.score, Score::Cp(35));
        assert_eq!(info.bound, None);
        assert_eq!(info.nodes, Some(1_234_567));
        assert_eq!(info.nps, Some(1_500_000));
        assert_eq!(info.time_ms, Some(823));
        assert_eq!(info.pv, vec!["e2e4", "e7e5", "g1f3"]);
    }

    #[test]
    fn parses_mate_scores_and_bounds() {
        let info = parse_info("info depth 12 multipv 2 score mate -3 lowerbound nodes 10 pv h7h8q").unwrap();
        assert_eq!(info.score, Score::Mate(-3));
        assert_eq!(info.bound, Some(Bound::Lower));
        assert_eq!(info.multipv, 2);
        assert_eq!(info.pv, vec!["h7h8q"]);

        let info = parse_info("info depth 30 score mate 1 upperbound pv d8h4").unwrap();
        assert_eq!(info.score, Score::Mate(1));
        assert_eq!(info.bound, Some(Bound::Upper));
        assert_eq!(info.multipv, 1, "multipv defaults to 1 when missing");
    }

    #[test]
    fn handles_wdl_and_negative_cp() {
        let info = parse_info("info depth 18 seldepth 25 multipv 3 score cp -120 wdl 10 300 690 nodes 5 nps 5 time 1 pv g8f6").unwrap();
        assert_eq!(info.score, Score::Cp(-120));
        assert_eq!(info.multipv, 3);
    }

    #[test]
    fn ignores_lines_without_a_candidate_line() {
        assert!(parse_info("info string NNUE evaluation using nn-1111.nnue").is_none());
        assert!(parse_info("info depth 5 currmove e2e4 currmovenumber 1").is_none());
        assert!(parse_info("readyok").is_none());
        assert!(parse_info("").is_none());
    }

    #[test]
    fn parses_bestmove() {
        assert_eq!(
            parse_bestmove("bestmove e2e4 ponder e7e5"),
            Some((Some("e2e4".into()), Some("e7e5".into())))
        );
        assert_eq!(parse_bestmove("bestmove g1f3"), Some((Some("g1f3".into()), None)));
        assert_eq!(parse_bestmove("bestmove (none)"), Some((None, None)));
        assert_eq!(parse_bestmove("info depth 1"), None);
    }

    #[test]
    fn parses_engine_name() {
        assert_eq!(parse_id_name("id name Stockfish 19"), Some("Stockfish 19".into()));
        assert_eq!(parse_id_name("id author someone"), None);
    }

    #[test]
    fn tracker_ignores_output_from_a_stopped_search() {
        let mut t = SearchTracker::default();
        assert!(!t.searching());
        assert!(!t.output_is_current());

        t.on_go(1, "fen-a".into());
        assert!(t.searching());
        assert!(t.output_is_current());

        // New analysis requested before the first search printed bestmove.
        t.on_go(2, "fen-b".into());
        assert!(!t.output_is_current(), "lines still coming are from search 1");
        assert!(!t.on_bestmove(), "first bestmove ends the old search");
        assert!(t.output_is_current(), "now lines are from search 2");
        assert_eq!(t.fen, "fen-b");
        assert!(t.on_bestmove());
        assert!(!t.searching());
    }

    #[test]
    fn tracker_handles_a_search_that_finished_on_its_own() {
        let mut t = SearchTracker::default();
        t.on_go(1, "a".into());
        assert!(t.on_bestmove()); // e.g. `go depth 10` finished
        assert!(!t.searching());
        t.on_go(2, "b".into());
        assert!(t.output_is_current());
    }
}
