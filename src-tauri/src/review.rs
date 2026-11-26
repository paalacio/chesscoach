//! Background game analysis.
//!
//! A worker thread takes the newest game that hasn't been analysed yet, asks a
//! separate Stockfish process for an evaluation of every position (fixed depth,
//! with a time cap per move), and stores the results as JSON on the game. The
//! frontend turns those numbers into the review (mistakes, accuracy, key moments).
//!
//! The worker can be paused, and a game can be moved to the front of the queue.
//! It uses its own engine so the live analysis board isn't interrupted.

use crate::engine::uci::{self, Score};
use crate::{AppState, games};
use serde::Serialize;
use shakmaty::fen::Fen;
use shakmaty::{CastlingMode, Chess, Position};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The evaluation of one position, from White's point of view.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionEval {
    /// None only if the engine gave no score (shouldn't happen).
    pub score: Option<Score>,
    /// Best move in UCI (None when the game is over in this position).
    pub best: Option<String>,
    /// First moves of the engine's main line, in UCI.
    pub pv: Vec<String>,
    pub depth: u32,
}

/// What gets stored in `games.analysis_json`. `evals[0]` is the starting
/// position, `evals[k]` the position after k moves.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameAnalysis {
    pub version: u32,
    pub engine: String,
    pub depth: u32,
    pub evals: Vec<PositionEval>,
}

/// A simple engine for one-position-at-a-time analysis: send a position, wait
/// for `bestmove`, return the last evaluation. (The live board uses the
/// streaming `EngineManager` instead.)
pub struct BlockingEngine {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::Receiver<String>,
    pub name: String,
}

impl BlockingEngine {
    pub fn start(path: &Path, threads: u32, hash_mb: u32) -> Result<Self, String> {
        let mut cmd = Command::new(path);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        crate::engine::hide_console_window(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("Could not start the engine: {e}"))?;
        let stdin = child.stdin.take().ok_or("no engine stdin")?;
        let stdout = child.stdout.take().ok_or("no engine stdout")?;
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut e = Self { child, stdin, lines, name: "UCI engine".into() };
        e.send("uci")?;
        let mut name = None;
        e.wait_for(Duration::from_secs(5), |l| {
            if let Some(n) = uci::parse_id_name(l) {
                name = Some(n);
            }
            l == "uciok"
        })?;
        if let Some(n) = name {
            e.name = n;
        }
        e.send(&format!("setoption name Threads value {threads}"))?;
        e.send(&format!("setoption name Hash value {hash_mb}"))?;
        e.send("isready")?;
        e.wait_for(Duration::from_secs(15), |l| l == "readyok")?;
        Ok(e)
    }

    fn send(&mut self, cmd: &str) -> Result<(), String> {
        writeln!(self.stdin, "{cmd}").and_then(|_| self.stdin.flush()).map_err(|e| format!("engine: {e}"))
    }

    fn wait_for(&self, timeout: Duration, mut done: impl FnMut(&str) -> bool) -> Result<(), String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(l) if done(&l) => return Ok(()),
                Ok(_) => {}
                Err(_) => return Err("the engine stopped answering".into()),
            }
        }
    }

    pub fn new_game(&mut self) -> Result<(), String> {
        self.send("ucinewgame")?;
        self.send("isready")?;
        self.wait_for(Duration::from_secs(15), |l| l == "readyok")
    }

    /// Evaluates one position. Stops at `depth` or after `movetime_ms`, whichever comes first.
    pub fn evaluate(&mut self, fen: &str, depth: u32, movetime_ms: u64) -> Result<PositionEval, String> {
        let white_to_move = fen.split_whitespace().nth(1) != Some("b");
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth} movetime {movetime_ms}"))?;
        let mut last: Option<uci::InfoLine> = None;
        let mut best = None;
        self.wait_for(Duration::from_millis(movetime_ms + 10_000), |l| {
            if let Some(info) = uci::parse_info(l) {
                if info.multipv == 1 && info.bound.is_none() && !info.pv.is_empty() {
                    last = Some(info);
                }
            } else if let Some((b, _)) = uci::parse_bestmove(l) {
                best = Some(b);
                return true;
            }
            false
        })?;
        let info = last;
        Ok(PositionEval {
            score: info.as_ref().map(|i| white_pov(i.score, white_to_move)),
            best: best.flatten(),
            pv: info.as_ref().map(|i| i.pv.iter().take(8).cloned().collect()).unwrap_or_default(),
            depth: info.map(|i| i.depth).unwrap_or(0),
        })
    }
}

impl Drop for BlockingEngine {
    fn drop(&mut self) {
        let _ = self.send("quit");
        std::thread::sleep(Duration::from_millis(50));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Engine scores are for the side to move; we store White's point of view.
pub fn white_pov(score: Score, white_to_move: bool) -> Score {
    if white_to_move {
        return score;
    }
    match score {
        Score::Cp(v) => Score::Cp(-v),
        Score::Mate(v) => Score::Mate(-v),
    }
}

/// Evaluation of a position where the game is over (no engine needed).
/// A finished checkmate is stored as "mate in 1" for the winner, which the
/// win-chance formula treats the same as any mate.
pub fn terminal_eval(fen: &str) -> Option<PositionEval> {
    let pos: Chess = Fen::from_ascii(fen.as_bytes()).ok()?.into_position(CastlingMode::Standard).ok()?;
    if !pos.is_game_over() {
        return None;
    }
    let score = if pos.is_checkmate() {
        // The side to move is mated.
        Score::Mate(if pos.turn().is_white() { -1 } else { 1 })
    } else {
        Score::Cp(0) // stalemate or insufficient material
    };
    Some(PositionEval { score: Some(score), best: None, pv: vec![], depth: 0 })
}

// ---------- the worker ----------

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStatus {
    pub paused: bool,
    pub current_game: Option<i64>,
    pub ply: usize,
    pub plies: usize,
    /// Games still waiting (including the current one).
    pub pending: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ReviewEvent {
    Progress { game_id: i64, ply: usize, plies: usize, pending: i64 },
    GameDone { game_id: i64, pending: i64 },
    GameError { game_id: i64, message: String },
    Status { status: WorkerStatus },
}

#[derive(Default)]
struct Shared {
    paused: AtomicBool,
    stop: AtomicBool,
    priority: Mutex<VecDeque<i64>>,
    status: Mutex<WorkerStatus>,
    /// Wakes the worker (new games, resume, priority).
    wake: (Mutex<bool>, Condvar),
}

#[derive(Clone, Default)]
pub struct ReviewWorker {
    shared: Arc<Shared>,
}

impl ReviewWorker {
    pub fn new(paused: bool) -> Self {
        let w = Self::default();
        w.shared.paused.store(paused, Ordering::SeqCst);
        w.shared.status.lock().unwrap().paused = paused;
        w
    }

    pub fn status(&self) -> WorkerStatus {
        self.shared.status.lock().unwrap().clone()
    }

    pub fn set_paused(&self, paused: bool) {
        self.shared.paused.store(paused, Ordering::SeqCst);
        self.shared.status.lock().unwrap().paused = paused;
        self.wake();
    }

    /// Analyse this game next (after the one in progress).
    pub fn prioritize(&self, game_id: i64) {
        let mut q = self.shared.priority.lock().unwrap();
        q.retain(|&id| id != game_id);
        q.push_front(game_id);
        drop(q);
        self.wake();
    }

    pub fn wake(&self) {
        let (lock, cv) = &self.shared.wake;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }

    pub fn shutdown(&self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.wake();
    }

    fn sleep(&self, timeout: Duration) {
        let (lock, cv) = &self.shared.wake;
        let mut woken = lock.lock().unwrap();
        if !*woken {
            woken = cv.wait_timeout(woken, timeout).unwrap().0;
        }
        *woken = false;
    }

    /// Starts the background thread.
    pub fn spawn(&self, app: AppHandle) {
        let me = self.clone();
        std::thread::spawn(move || me.run(app));
    }

    fn emit(&self, app: &AppHandle, ev: ReviewEvent) {
        let _ = app.emit("review:event", ev);
    }

    fn publish_status(&self, app: &AppHandle) {
        let status = self.status();
        self.emit(app, ReviewEvent::Status { status });
    }

    fn run(&self, app: AppHandle) {
        let mut engine: Option<BlockingEngine> = None;
        loop {
            if self.shared.stop.load(Ordering::SeqCst) {
                break;
            }
            let state = app.state::<AppState>();
            let pending = games::count_pending(&state.db.lock().unwrap()).unwrap_or(0);
            {
                let mut st = self.shared.status.lock().unwrap();
                st.pending = pending;
                st.current_game = None;
            }
            if self.shared.paused.load(Ordering::SeqCst) {
                engine = None; // free the CPU and memory while paused
                self.publish_status(&app);
                self.sleep(Duration::from_secs(60));
                continue;
            }
            // Next game: a prioritised one, else the newest pending one.
            let next = {
                let prio = self.shared.priority.lock().unwrap().pop_front();
                let conn = state.db.lock().unwrap();
                match prio {
                    Some(id) => games::pgn_of(&conn, id).ok().flatten().map(|pgn| (id, pgn)),
                    None => games::next_pending(&conn).ok().flatten(),
                }
            };
            let Some((game_id, pgn)) = next else {
                engine = None;
                self.publish_status(&app);
                self.sleep(Duration::from_secs(300));
                continue;
            };

            let settings = state.settings.lock().unwrap().clone();
            if engine.is_none() {
                let path = match crate::engine::resolve_engine_path(Some(&settings.engine_path)) {
                    Ok(p) => p,
                    Err(e) => {
                        self.emit(&app, ReviewEvent::GameError { game_id, message: e });
                        self.set_paused(true);
                        continue;
                    }
                };
                let threads = settings.review_threads.unwrap_or_else(default_review_threads);
                match BlockingEngine::start(&path, threads, 128) {
                    Ok(e) => engine = Some(e),
                    Err(e) => {
                        self.emit(&app, ReviewEvent::GameError { game_id, message: e });
                        self.set_paused(true);
                        continue;
                    }
                }
            }
            let eng = engine.as_mut().expect("engine started above");

            let _ = games::set_status(&state.db.lock().unwrap(), game_id, "running", None, None);
            match self.analyse(&app, eng, game_id, &pgn, settings.review_depth, settings.review_movetime_ms as u64, pending) {
                Ok(Some(analysis)) => {
                    let json = serde_json::to_string(&analysis).unwrap_or_default();
                    let _ = games::set_status(&state.db.lock().unwrap(), game_id, "done", Some(&json), None);
                    self.emit(&app, ReviewEvent::GameDone { game_id, pending: (pending - 1).max(0) });
                }
                Ok(None) => {
                    // Paused or stopped half-way: put it back in the queue.
                    let _ = games::set_status(&state.db.lock().unwrap(), game_id, "pending", None, None);
                }
                Err(message) => {
                    let _ = games::set_status(&state.db.lock().unwrap(), game_id, "error", None, Some(&message));
                    self.emit(&app, ReviewEvent::GameError { game_id, message });
                    engine = None; // restart the engine in case it was the problem
                }
            }
        }
    }

    /// Analyses every position of one game. Returns None if paused/stopped midway.
    #[allow(clippy::too_many_arguments)]
    fn analyse(
        &self,
        app: &AppHandle,
        eng: &mut BlockingEngine,
        game_id: i64,
        pgn: &str,
        depth: u32,
        movetime_ms: u64,
        pending: i64,
    ) -> Result<Option<GameAnalysis>, String> {
        let game = crate::pgn::parse_game(pgn)?;
        let fens: Vec<&str> =
            std::iter::once(game.start_fen.as_str()).chain(game.moves.iter().map(|m| m.fen_after.as_str())).collect();
        let plies = fens.len();
        eng.new_game()?;
        let mut evals = Vec::with_capacity(plies);
        for (ply, fen) in fens.iter().enumerate() {
            if self.shared.paused.load(Ordering::SeqCst) || self.shared.stop.load(Ordering::SeqCst) {
                return Ok(None);
            }
            {
                let mut st = self.shared.status.lock().unwrap();
                st.current_game = Some(game_id);
                st.ply = ply;
                st.plies = plies;
            }
            if ply % 4 == 0 {
                self.emit(app, ReviewEvent::Progress { game_id, ply, plies, pending });
            }
            let eval = match terminal_eval(fen) {
                Some(e) => e,
                None => eng.evaluate(fen, depth, movetime_ms)?,
            };
            evals.push(eval);
        }
        Ok(Some(GameAnalysis { version: 1, engine: eng.name.clone(), depth, evals }))
    }
}

/// Threads for background analysis: about half the CPU, so the live board stays quick.
pub fn default_review_threads() -> u32 {
    (crate::engine::default_threads() / 2).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scores_are_stored_from_whites_point_of_view() {
        assert_eq!(white_pov(Score::Cp(35), true), Score::Cp(35));
        assert_eq!(white_pov(Score::Cp(35), false), Score::Cp(-35));
        assert_eq!(white_pov(Score::Mate(2), false), Score::Mate(-2));
    }

    #[test]
    fn finished_games_need_no_engine() {
        // Fool's mate: White is checkmated, so Black "mates in 1".
        let mated = terminal_eval("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3").unwrap();
        assert_eq!(mated.score, Some(Score::Mate(-1)));
        assert_eq!(mated.best, None);
        // Stalemate: Black to move, no legal moves, not in check.
        let stale = terminal_eval("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();
        assert_eq!(stale.score, Some(Score::Cp(0)));
        assert!(terminal_eval("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").is_none());
    }

    #[test]
    fn analysis_json_has_the_shape_the_frontend_reads() {
        let a = GameAnalysis {
            version: 1,
            engine: "Stockfish 19".into(),
            depth: 16,
            evals: vec![PositionEval { score: Some(Score::Cp(20)), best: Some("e2e4".into()), pv: vec!["e2e4".into()], depth: 16 }],
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["evals"][0]["score"], serde_json::json!({"kind": "cp", "value": 20}));
        assert_eq!(v["evals"][0]["best"], "e2e4");
    }

    #[test]
    fn review_threads_leave_room_for_the_live_engine() {
        assert!(default_review_threads() >= 1);
        assert!(default_review_threads() <= crate::engine::default_threads());
    }
}
