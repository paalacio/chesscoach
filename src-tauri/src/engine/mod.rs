//! Stockfish process manager: starts the engine, sends it positions to analyse and
//! streams its `info` lines to the frontend as events.
//!
//! A background thread reads the engine's output line by line. Commands (stop,
//! position, go, ...) are written to the engine's stdin from the Tauri commands.

pub mod uci;

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use uci::{InfoLine, SearchTracker};

/// What the frontend receives on the `engine:event` channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineEvent {
    Info { analysis_id: u64, fen: String, info: InfoLine },
    BestMove { analysis_id: u64, fen: String, best: Option<String>, ponder: Option<String> },
    Exited { message: String },
}

/// Function used to deliver events (the Tauri app handle in the real app).
pub type Emit = Arc<dyn Fn(EngineEvent) + Send + Sync>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeOptions {
    /// Chosen by the frontend so it can tell which events belong to which request.
    pub analysis_id: u64,
    pub fen: String,
    pub multipv: u32,
    /// Stop at this depth. If neither depth nor movetime is set, analysis runs until stopped.
    pub depth: Option<u32>,
    pub movetime_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub name: Option<String>,
    pub path: Option<String>,
    pub threads: u32,
    pub hash_mb: u32,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    tracker: Arc<Mutex<SearchTracker>>,
    /// Lines that are not `info`/`bestmove` (uciok, readyok, id, option...).
    misc_rx: mpsc::Receiver<String>,
    name: String,
    path: PathBuf,
    threads: u32,
    hash_mb: u32,
    multipv: u32,
}

impl Running {
    fn send(&mut self, cmd: &str) -> Result<(), String> {
        writeln!(self.stdin, "{cmd}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Could not talk to the engine: {e}"))
    }

    /// Reads non-search lines until one matches, or gives up after `timeout`.
    fn wait_for(&self, timeout: Duration, mut done: impl FnMut(&str) -> bool) -> Result<(), String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match self.misc_rx.recv_timeout(left) {
                Ok(line) if done(&line) => return Ok(()),
                Ok(_) => continue,
                Err(_) => return Err("The engine did not answer in time".into()),
            }
        }
    }
}

#[derive(Default)]
pub struct EngineManager {
    running: Mutex<Option<Running>>,
}

impl EngineManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts the engine (or keeps the running one if path and options match).
    /// Returns the engine's name, e.g. "Stockfish 19".
    pub fn start(&self, path: &Path, threads: u32, hash_mb: u32, emit: Emit) -> Result<String, String> {
        let mut guard = self.running.lock().unwrap();
        if let Some(r) = guard.as_ref() {
            if r.path == path && r.threads == threads && r.hash_mb == hash_mb {
                return Ok(r.name.clone());
            }
        }
        if let Some(old) = guard.take() {
            shutdown(old);
        }

        let mut cmd = Command::new(path);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        hide_console_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start the engine at {}: {e}", path.display()))?;
        let stdin = child.stdin.take().ok_or("No stdin for the engine")?;
        let stdout = child.stdout.take().ok_or("No stdout for the engine")?;

        let tracker = Arc::new(Mutex::new(SearchTracker::default()));
        let (misc_tx, misc_rx) = mpsc::channel();
        spawn_reader(stdout, tracker.clone(), misc_tx, emit);

        let mut running = Running {
            child,
            stdin,
            tracker,
            misc_rx,
            name: "UCI engine".into(),
            path: path.to_path_buf(),
            threads,
            hash_mb,
            multipv: 1,
        };

        // UCI handshake: "uci" -> id lines -> "uciok"; then options; then "isready" -> "readyok".
        running.send("uci")?;
        let mut name = None;
        running.wait_for(Duration::from_secs(5), |line| {
            if let Some(n) = uci::parse_id_name(line) {
                name = Some(n);
            }
            line == "uciok"
        })?;
        running.name = name.unwrap_or_else(|| "UCI engine".into());
        running.send(&format!("setoption name Threads value {threads}"))?;
        running.send(&format!("setoption name Hash value {hash_mb}"))?;
        running.send("isready")?;
        // Allocating a big hash table can take a moment.
        running.wait_for(Duration::from_secs(15), |line| line == "readyok")?;

        let engine_name = running.name.clone();
        *guard = Some(running);
        Ok(engine_name)
    }

    /// Starts analysing a position. Any running search is stopped first.
    pub fn analyze(&self, opts: AnalyzeOptions) -> Result<(), String> {
        check_fen(&opts.fen)?;
        let mut guard = self.running.lock().unwrap();
        let r = guard.as_mut().ok_or("The engine is not running")?;
        let tracker = r.tracker.clone();
        let mut t = tracker.lock().unwrap();
        if t.searching() {
            r.send("stop")?;
        }
        let multipv = opts.multipv.clamp(1, 5);
        if multipv != r.multipv {
            r.send(&format!("setoption name MultiPV value {multipv}"))?;
            r.multipv = multipv;
        }
        r.send(&format!("position fen {}", opts.fen))?;
        // Update the tracker *before* "go" so the reader thread attributes the
        // new output correctly (it waits on this lock).
        t.on_go(opts.analysis_id, opts.fen.clone());
        let go = match (opts.depth, opts.movetime_ms) {
            (Some(d), _) => format!("go depth {d}"),
            (None, Some(ms)) => format!("go movetime {ms}"),
            (None, None) => "go infinite".to_string(),
        };
        r.send(&go)
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.running.lock().unwrap();
        if let Some(r) = guard.as_mut() {
            let searching = r.tracker.lock().unwrap().searching();
            if searching {
                r.send("stop")?;
            }
        }
        Ok(())
    }

    pub fn status(&self) -> EngineStatus {
        let guard = self.running.lock().unwrap();
        match guard.as_ref() {
            Some(r) => EngineStatus {
                running: true,
                name: Some(r.name.clone()),
                path: Some(r.path.display().to_string()),
                threads: r.threads,
                hash_mb: r.hash_mb,
            },
            None => EngineStatus { running: false, name: None, path: None, threads: 0, hash_mb: 0 },
        }
    }

    /// Stops the engine process (e.g. when the engine path changes or the app quits).
    pub fn shutdown(&self) {
        if let Some(r) = self.running.lock().unwrap().take() {
            shutdown(r);
        }
    }
}

fn shutdown(mut r: Running) {
    let _ = r.send("quit");
    // Give it a moment to exit by itself, then make sure it's gone.
    for _ in 0..10 {
        if let Ok(Some(_)) = r.child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let _ = r.child.kill();
    let _ = r.child.wait();
}

fn spawn_reader(
    stdout: std::process::ChildStdout,
    tracker: Arc<Mutex<SearchTracker>>,
    misc_tx: mpsc::Sender<String>,
    emit: Emit,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim().to_string();
            if line.starts_with("info") {
                if let Some(info) = uci::parse_info(&line) {
                    let t = tracker.lock().unwrap();
                    if t.output_is_current() {
                        emit(EngineEvent::Info { analysis_id: t.analysis_id, fen: t.fen.clone(), info });
                    }
                }
            } else if let Some((best, ponder)) = uci::parse_bestmove(&line) {
                let mut t = tracker.lock().unwrap();
                if t.on_bestmove() {
                    emit(EngineEvent::BestMove { analysis_id: t.analysis_id, fen: t.fen.clone(), best, ponder });
                }
            } else {
                let _ = misc_tx.send(line);
            }
        }
        emit(EngineEvent::Exited { message: "The engine stopped.".into() });
    });
}

/// Very basic FEN sanity check. Stockfish can crash on nonsense input, and the
/// frontend should only ever send positions produced by chessops anyway.
fn check_fen(fen: &str) -> Result<(), String> {
    let board = fen.split_whitespace().next().unwrap_or("");
    let fields = fen.split(' ').count();
    // Only the characters a FEN can contain (no newlines, which would let a
    // string smuggle extra commands to the engine).
    let ok = (4..=6).contains(&fields)
        && fen.chars().all(|c| c == ' ' || c == '-' || c == '/' || c.is_ascii_alphanumeric())
        && board.matches('K').count() == 1
        && board.matches('k').count() == 1
        && board.split('/').count() == 8
        && board.chars().all(|c| "pnbrqkPNBRQK12345678/".contains(c));
    if ok { Ok(()) } else { Err(format!("Not a valid position: {fen}")) }
}

/// Finds the engine binary: the custom path from Settings, else the bundled
/// sidecar next to the app's executable, else common install locations.
pub fn resolve_engine_path(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = custom.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return if p.is_file() { Ok(p) } else { Err(format!("No engine found at {}", p.display())) };
    }
    let mut candidates = Vec::new();
    // Tauri copies the sidecar next to the main executable (without the target triple).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(format!("stockfish{}", std::env::consts::EXE_SUFFIX)));
        }
    }
    if cfg!(target_os = "macos") {
        candidates.push("/opt/homebrew/bin/stockfish".into());
        candidates.push("/usr/local/bin/stockfish".into());
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "Stockfish was not found. Reinstall the app or set an engine path in Settings.".into())
}

/// Number of search threads by default: all CPU cores but one, so the UI stays smooth.
pub fn default_threads() -> u32 {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2) as u32;
    cores.saturating_sub(1).max(1)
}

/// On Windows, stop a console window from flashing up for child processes.
pub fn hide_console_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fen_check_accepts_real_positions_and_rejects_junk() {
        assert!(check_fen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1").is_ok());
        assert!(check_fen("8/8/8/8/8/8/8/8 w - - 0 1").is_err(), "no kings");
        assert!(check_fen("hello").is_err());
        assert!(check_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1; quit").is_err());
        assert!(check_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\nquit").is_err());
    }

    #[test]
    fn events_serialize_in_the_shape_the_frontend_expects() {
        let ev = EngineEvent::BestMove { analysis_id: 7, fen: "x".into(), best: Some("e2e4".into()), ponder: None };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "bestMove");
        assert_eq!(json["analysisId"], 7);
        assert_eq!(json["best"], "e2e4");
    }

    #[test]
    fn default_threads_leaves_a_core_free() {
        assert!(default_threads() >= 1);
    }
}
