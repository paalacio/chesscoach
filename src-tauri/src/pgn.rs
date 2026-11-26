//! Reading PGN games on the Rust side (with shakmaty + pgn-reader), for game
//! import and batch analysis: headers, every position as FEN, every move in
//! SAN and UCI, and the clock times Chess.com stores in comments.
//!
//! Only the main line is read; variations are skipped.

use pgn_reader::{RawComment, RawTag, Reader, SanPlus, Visitor};
use serde::Serialize;
use shakmaty::fen::Fen;
use shakmaty::uci::UciMove;
use shakmaty::{CastlingMode, Chess, EnPassantMode};
use std::collections::BTreeMap;
use std::ops::ControlFlow;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMove {
    /// 1 = White's first move.
    pub ply: u32,
    /// With check marks, e.g. "Bb5+".
    pub san: String,
    /// Standard UCI, castling as king two squares ("e1g1").
    pub uci: String,
    pub fen_before: String,
    pub fen_after: String,
    /// Seconds left on the mover's clock after the move (`[%clk 0:09:58.5]`).
    pub clock: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedGame {
    pub headers: BTreeMap<String, String>,
    pub start_fen: String,
    pub moves: Vec<ParsedMove>,
}

pub fn fen_of(pos: &Chess) -> String {
    Fen::from_position(pos, EnPassantMode::Legal).to_string()
}

/// Reads `[%clk 0:09:58.5]` from a comment and returns seconds.
pub fn parse_clock(comment: &str) -> Option<f32> {
    let start = comment.find("[%clk")? + "[%clk".len();
    let rest = comment[start..].trim_start();
    let end = rest.find(']')?;
    let mut secs = 0.0f32;
    for part in rest[..end].trim().split(':') {
        secs = secs * 60.0 + part.parse::<f32>().ok()?;
    }
    Some(secs)
}

struct Movetext {
    headers: BTreeMap<String, String>,
    pos: Chess,
    start_fen: String,
    moves: Vec<ParsedMove>,
}

struct GameVisitor;

impl Visitor for GameVisitor {
    type Tags = BTreeMap<String, String>;
    type Movetext = Movetext;
    type Output = Result<ParsedGame, String>;

    fn begin_tags(&mut self) -> ControlFlow<Self::Output, Self::Tags> {
        ControlFlow::Continue(BTreeMap::new())
    }

    fn tag(&mut self, tags: &mut Self::Tags, name: &[u8], value: RawTag<'_>) -> ControlFlow<Self::Output> {
        tags.insert(String::from_utf8_lossy(name).into_owned(), value.decode_utf8_lossy().into_owned());
        ControlFlow::Continue(())
    }

    fn begin_movetext(&mut self, tags: Self::Tags) -> ControlFlow<Self::Output, Self::Movetext> {
        // Games can start from a custom position ([FEN "..."]).
        let pos = match tags.get("FEN") {
            Some(fen) => match Fen::from_ascii(fen.as_bytes())
                .map_err(|e| e.to_string())
                .and_then(|f| f.into_position::<Chess>(CastlingMode::Standard).map_err(|e| e.to_string()))
            {
                Ok(p) => p,
                Err(e) => return ControlFlow::Break(Err(format!("bad FEN tag: {e}"))),
            },
            None => Chess::default(),
        };
        let start_fen = fen_of(&pos);
        ControlFlow::Continue(Movetext { headers: tags, pos, start_fen, moves: Vec::new() })
    }

    fn san(&mut self, mt: &mut Self::Movetext, san_plus: SanPlus) -> ControlFlow<Self::Output> {
        let m = match san_plus.san.to_move(&mt.pos) {
            Ok(m) => m,
            Err(e) => return ControlFlow::Break(Err(format!("illegal move {san_plus} after {} moves: {e}", mt.moves.len()))),
        };
        let fen_before = fen_of(&mt.pos);
        let uci = UciMove::from_move(m, CastlingMode::Standard).to_string();
        let san = SanPlus::from_move_and_play_unchecked(&mut mt.pos, m).to_string();
        mt.moves.push(ParsedMove {
            ply: mt.moves.len() as u32 + 1,
            san,
            uci,
            fen_before,
            fen_after: fen_of(&mt.pos),
            clock: None,
        });
        ControlFlow::Continue(())
    }

    fn comment(&mut self, mt: &mut Self::Movetext, comment: RawComment<'_>) -> ControlFlow<Self::Output> {
        if let Some(last) = mt.moves.last_mut() {
            if let Some(secs) = parse_clock(&String::from_utf8_lossy(comment.as_bytes())) {
                last.clock = Some(secs);
            }
        }
        ControlFlow::Continue(())
    }

    fn end_game(&mut self, mt: Self::Movetext) -> Self::Output {
        Ok(ParsedGame { headers: mt.headers, start_fen: mt.start_fen, moves: mt.moves })
    }
}

/// Parses the first game in `pgn`.
pub fn parse_game(pgn: &str) -> Result<ParsedGame, String> {
    let mut reader = Reader::new(std::io::Cursor::new(pgn.as_bytes()));
    match reader.read_game(&mut GameVisitor) {
        Ok(Some(result)) => result,
        Ok(None) => Err("no game found in the PGN".into()),
        Err(e) => Err(format!("could not read the PGN: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/chesscom/game.pgn")).unwrap()
    }

    #[test]
    fn reads_a_chesscom_pgn_with_clock_comments() {
        let g = parse_game(&fixture()).unwrap();
        assert_eq!(g.headers["White"], "someone");
        assert_eq!(g.headers["Black"], "rival_player");
        assert_eq!(g.headers["Result"], "1-0");
        assert_eq!(g.headers["TimeControl"], "600");
        assert_eq!(g.start_fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

        let first = &g.moves[0];
        assert_eq!((first.ply, first.san.as_str(), first.uci.as_str()), (1, "e4", "e2e4"));
        assert_eq!(first.clock, Some(598.5));
        assert_eq!(g.moves[1].clock, Some(597.1));
        assert_eq!(g.moves[1].fen_before, first.fen_after);

        // Castling is written king-two-squares, like Stockfish expects.
        let castle = g.moves.iter().find(|m| m.san == "O-O").unwrap();
        assert_eq!(castle.uci, "e1g1");
        assert_eq!(g.moves.last().unwrap().ply as usize, g.moves.len());
    }

    #[test]
    fn skips_variations_and_handles_custom_start_positions() {
        let g = parse_game("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *").unwrap();
        assert_eq!(g.moves.iter().map(|m| m.san.as_str()).collect::<Vec<_>>(), ["e4", "e5", "Nf3"]);

        let g = parse_game("[SetUp \"1\"]\n[FEN \"4k3/8/8/8/8/8/4P3/4K3 w - - 0 1\"]\n\n1. e4 Kd7 *").unwrap();
        assert_eq!(g.start_fen, "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
        assert_eq!(g.moves.len(), 2);
    }

    #[test]
    fn writes_check_and_mate_marks() {
        let g = parse_game("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7 1-0").unwrap();
        assert_eq!(g.moves.last().unwrap().san, "Qxf7#", "mate mark added even if the PGN lacks it");
        let g = parse_game("1. e4 f5 2. Qh5 *").unwrap();
        assert_eq!(g.moves.last().unwrap().san, "Qh5+");
    }

    #[test]
    fn reports_illegal_moves() {
        let err = parse_game("1. e4 e5 2. Ke3 *").unwrap_err();
        assert!(err.contains("illegal move Ke3"), "{err}");
    }

    #[test]
    fn parses_clock_values() {
        assert_eq!(parse_clock("[%clk 0:09:58.5]"), Some(598.5));
        assert_eq!(parse_clock("[%clk 1:00:00]"), Some(3600.0));
        assert_eq!(parse_clock("good move [%clk 0:00:07.2] [%eval 0.3]"), Some(7.2));
        assert_eq!(parse_clock("no clock"), None);
    }
}
