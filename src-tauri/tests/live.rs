//! Live checks against the real Stockfish, Claude Code and Chess.com.
//!
//! These are `#[ignore]`d so the normal test run never touches them (tests must
//! not call the real engine, Claude or the network). Run them by hand:
//!
//!   cargo test --test live -- --ignored --nocapture
//!
//! The Claude test uses one small Haiku request from your plan. The Chess.com
//! test only runs if CHESSCOM_CONTACT is set in .env.local.

use chesscoach_lib::claude::{ClaudeError, ClaudeService, CliClaude, RequestKind, StructuredRequest};
use chesscoach_lib::engine::{AnalyzeOptions, EngineEvent, EngineManager};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RUY: &str = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6";

/// The sidecar fetched by scripts/fetch-stockfish.mjs (or Homebrew's as a fallback).
fn engine_path() -> std::path::PathBuf {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    std::fs::read_dir(&dir)
        .ok()
        .and_then(|rd| rd.flatten().map(|e| e.path()).find(|p| p.file_name().unwrap().to_string_lossy().starts_with("stockfish-")))
        .unwrap_or_else(|| chesscoach_lib::engine::resolve_engine_path(None).expect("no Stockfish found"))
}

#[test]
#[ignore]
fn live_engine_streams_multipv_lines_and_drops_stale_output() {
    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(Mutex::new(tx));
    let emit = Arc::new(move |ev: EngineEvent| {
        let _ = tx.lock().unwrap().send(ev);
    });
    let engine = EngineManager::new();
    let name = engine.start(&engine_path(), 2, 64, emit).expect("engine starts");
    println!("engine: {name}");
    assert!(name.contains("Stockfish"));

    // Start an infinite search, then switch position while it runs.
    engine.analyze(AnalyzeOptions { analysis_id: 1, fen: START.into(), multipv: 3, depth: None, movetime_ms: None, searchmoves: None }).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    engine.analyze(AnalyzeOptions { analysis_id: 2, fen: RUY.into(), multipv: 3, depth: Some(14), movetime_ms: None, searchmoves: None }).unwrap();

    let mut seen_multipv = std::collections::HashSet::new();
    let mut infos_after_switch = 0;
    let mut saw_old_after_new = false;
    let mut saw_new = false;
    loop {
        match rx.recv_timeout(Duration::from_secs(20)).expect("engine output") {
            EngineEvent::Info { analysis_id, fen, info } => {
                if analysis_id == 2 {
                    saw_new = true;
                    assert_eq!(fen, RUY);
                    seen_multipv.insert(info.multipv);
                    infos_after_switch += 1;
                } else if saw_new {
                    saw_old_after_new = true;
                }
            }
            EngineEvent::BestMove { analysis_id, best, .. } => {
                assert_eq!(analysis_id, 2, "the stopped search's bestmove is swallowed");
                println!("bestmove {best:?} after {infos_after_switch} info lines");
                break;
            }
            EngineEvent::Exited { message } => panic!("engine exited: {message}"),
        }
    }
    assert!(!saw_old_after_new, "no lines from the old search after the new one started");
    assert_eq!(seen_multipv, [1, 2, 3].into_iter().collect());
    engine.shutdown();
}

#[tokio::test]
#[ignore]
async fn live_claude_answers_with_structured_output() {
    let dir = tempfile::tempdir().unwrap();
    let claude = CliClaude::new(dir.path()).unwrap();
    let auth = claude.auth_status().await.expect("auth status");
    println!("auth: {auth:?}");
    assert!(auth.uses_subscription(), "Claude Code should be logged in with a Claude subscription");

    let reply = claude
        .ask_structured(StructuredRequest {
            kind: RequestKind::Hello,
            prompt: "Say hello to a new chess student and give one opening tip.".into(),
            model: "haiku".into(),
        })
        .await
        .expect("an answer");
    println!("answer: {}", reply.data);
    assert!(reply.data["greeting"].is_string());
    assert!(reply.data["tip"].is_string());
}

#[tokio::test]
#[ignore]
async fn live_claude_can_be_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let claude = Arc::new(CliClaude::new(dir.path()).unwrap());
    let c2 = claude.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        c2.cancel();
    });
    let started = std::time::Instant::now();
    let result = claude
        .ask_structured(StructuredRequest {
            kind: RequestKind::Hello,
            prompt: "Say hello to a new chess student and give one opening tip.".into(),
            model: "haiku".into(),
        })
        .await;
    println!("cancel result after {:?}: {:?}", started.elapsed(), result.as_ref().err());
    assert_eq!(result.err(), Some(ClaudeError::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(6));
}

#[tokio::test]
#[ignore]
async fn live_chesscom_archive_list() {
    let env = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env.local")).unwrap_or_default();
    let mut s = chesscoach_lib::settings::Settings::default();
    chesscoach_lib::settings::apply_dev_env(&mut s, &env);
    if s.contact_email.is_empty() || s.chesscom_username.is_empty() {
        println!("skipped: set CHESSCOM_USERNAME and CHESSCOM_CONTACT in .env.local");
        return;
    }
    let ua = chesscoach_lib::chesscom::user_agent("0.1.0", &s.chesscom_username, &s.contact_email).unwrap();
    let archives = chesscoach_lib::chesscom::fetch_archives(&reqwest::Client::new(), chesscoach_lib::chesscom::API_BASE, &ua, &s.chesscom_username)
        .await
        .expect("archives");
    println!("{} monthly archives, latest {:?}", archives.len(), archives.last());
    assert!(!archives.is_empty());
}

#[test]
#[ignore]
fn live_batch_analysis_of_a_game() {
    use chesscoach_lib::review::{BlockingEngine, terminal_eval};
    let pgn = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/chesscom/game.pgn")).unwrap();
    let game = chesscoach_lib::pgn::parse_game(&pgn).unwrap();
    let mut eng = BlockingEngine::start(&engine_path(), 2, 64).unwrap();
    eng.new_game().unwrap();
    let started = std::time::Instant::now();
    let mut evals = Vec::new();
    for fen in std::iter::once(&game.start_fen).chain(game.moves.iter().map(|m| &m.fen_after)) {
        evals.push(terminal_eval(fen).map(Ok).unwrap_or_else(|| eng.evaluate(fen, 12, 400)).unwrap());
    }
    println!("{} positions in {:?}", evals.len(), started.elapsed());
    assert_eq!(evals.len(), game.moves.len() + 1);
    assert!(evals.iter().all(|e| e.score.is_some() && e.best.is_some()));
    // After 9...Nxe4 10.Rxe4 d5 11.Rxe5 White is a piece up: clearly better for White.
    println!("final score: {:?}", evals.last().unwrap().score);
    match evals.last().unwrap().score.unwrap() {
        chesscoach_lib::engine::uci::Score::Cp(cp) => assert!(cp > 150, "{cp}"),
        chesscoach_lib::engine::uci::Score::Mate(m) => assert!(m > 0),
    }
}
