# Tung Tung Chessahur (code name: ChessCoach)

Desktop app (Tauri 2: Rust backend + React/TypeScript UI) for studying chess openings and plans.
**Stockfish calculates, Claude explains.** The app is shown to users as "Tung Tung Chessahur"; code, crate names, the bundle identifier
(`app.chesscoach.desktop`, which decides where user data lives), file-format IDs and the API User-Agent keep
"ChessCoach". Don't change the identifier: users would lose their data folder and keychain entries. The full spec is `CHESS_COACH_SPEC.md`; progress notes and
open questions for the owner are in `PROGRESS.md`.

The owner is a beginner in TypeScript/Rust: keep code readable, comment the non-obvious parts, and
explain changes in plain words.

## Commands

Rust from Homebrew's `rustup` is keg-only. If `cargo` isn't found, run:
`export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"`

| What | Command |
|---|---|
| Install JS deps | `pnpm install` |
| Download the Stockfish sidecar (needed before any Rust build/test) | `pnpm fetch-stockfish` (add `--target x86_64-pc-windows-msvc` for Windows) |
| Run the real app | `pnpm tauri dev` |
| UI in a browser with the mock backend | `pnpm dev:mock` → http://localhost:1430 (`?platform=windows`, `?mock=errors`) |
| TypeScript typecheck | `pnpm typecheck` |
| TS unit tests (Vitest) | `pnpm test` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Playwright smoke tests (mock mode) | `pnpm test:e2e --grep-invert @screenshot` |
| Screenshots, light + dark, Mac + Windows look | `pnpm screenshots` → `screenshots/phase-1/` (gitignored) |
| Live checks vs real Stockfish/Claude/Chess.com (manual, uses 1-2 Claude requests) | `cargo test --manifest-path src-tauri/Cargo.toml --test live -- --ignored --nocapture` |
| Release build (Mac) | `pnpm tauri build` |
| Regenerate data | `pnpm openings` (opening names), `node scripts/fetch-pieces.mjs`, `node scripts/record-engine-fixture.mjs`, `node scripts/make-mock-games.mjs` (made-up games + real engine analysis for mock mode), `node scripts/make-icon.mjs` |
| Phase 2 screenshots | `SCREENSHOT_PHASE=phase-2 pnpm exec playwright test e2e/screenshots-phase2.spec.ts` |
| Phase 3 screenshots | `pnpm exec playwright test e2e/screenshots-phase3.spec.ts` → `screenshots/phase-3/` |
| Phase 4 screenshots | `pnpm exec playwright test e2e/screenshots-phase4.spec.ts` → `screenshots/phase-4/` |
| Re-record the Lichess masters fixture (real network, no token, ~220 requests) | `node scripts/record-explorer-fixture.mjs` |

CI: `.github/workflows/build.yml` runs all tests on macOS, then builds macOS (Apple Silicon) and Windows
installers with `tauri-apps/tauri-action@v1` and uploads them as workflow artifacts.

## Architecture

```
src/                      React + TS frontend
  core/                   Pure chess/domain logic, NO React (testable, reusable on a phone later)
    chess.ts              chessops helpers (FEN, SAN/UCI, legal moves; castling always "e1g1" form)
    winprob.ts            Lichess win%, move classification (0.1/0.2/0.3 winning-chance drops), accuracy
    engine-lines.ts       engine info lines -> display lines (White's POV, SAN)
    game-tree.ts          move tree with variations; ids are UCI paths ("e2e4 e7e5"); PGN/FEN import+export
    facts.ts              material, castling, attacked-and-undefended pieces, passed pawns, open files
    phase.ts              opening/middlegame/endgame, ported from Lichess's Divider (scalachess, MIT)
    openings.ts           names from src/data/openings.json (CC0 lichess-org/chess-openings, keyed by EPD)
    context-packet.ts     what Claude receives + prompt text; the allowed-move sets; candidates for "compare"
    validate.ts           checks every move Claude names (drops invalid structured moves, flags prose)
    review.ts             game review from the worker's evals: judgements, Lichess game accuracy (per phase),
                          key moments, where the game left the opening, training cards, list summary
    game-review-packet.ts the one-call-per-game Claude review (summary, 3 lessons, key-moment comments) + check
    explorer.ts           explorer rows (share, W/D/L %), "Explain this opening" prompt + answer check
    repertoire.ts         repertoire = flat list of moves keyed by EPD (transpositions merge); walk/reach, edits,
                          pathTo, weighted replies, PGN export/import, where a game left the repertoire
    repertoire-build.ts   automatic build from seed lines via a BuildOracle (explorer + engine), minShare/minReach
    repertoire-proposal.ts wizard slots, the Claude proposal prompt, checking Claude's lines (legal, in the slot)
    course.ts             course / book / study import: annotated PGN -> repertoire moves + author's notes
                          (CourseAnnotation per move), side lines, FEN chapters; notes for Claude's packet
    srs.ts                ts-fsrs 6 wrapper (FSRS-7 pinned; dates revived from JSON), streak, training file format
    trainer.ts            trainer cards (repertoire + mistakes), due/new counts, lessons ("learn new lines")
  backend/                One `Backend` interface: tauri.ts (real, invoke/listen) and mock.ts (fixtures)
    fixtures/             Real recorded Stockfish lines and Claude answers for mock mode
  store/                  Zustand stores: app (pages, settings, sheets), analysis (tree, engine, Claude),
                          games (list, sync, background-analysis status, open game review),
                          explorer (source, replies per position+filters, move evals, opening overview),
                          repertoire (load/edit/save, build with the live oracle, PGN, deviations), wizard,
                          trainer (sessions: learn / review / mistakes), why (Claude "why this move", cached),
                          data (training export/import, DB backup/restore), course-notes (loaded courses'
                          notes for Explain / trainer / why; a plain module to avoid store import cycles)
  i18n/                   en.ts / pt.ts (Brazilian Portuguese) dictionaries, useT() / tNow(); pt.ts is typed
                          with en's keys, so a missing translation fails the typecheck
  ui/                     Thin React components; styles in src/styles (tokens.css = design tokens);
                          ui/repertoire (panel + wizard), ui/train (trainer page)
src-tauri/                Rust: everything touching processes, network, disk, secrets
  src/engine/             Stockfish UCI manager (+ uci.rs parser and SearchTracker for stale output)
  src/claude/             ClaudeService trait + CliClaude (`claude -p`), output parsing, binary lookup
  src/chesscom.rs         Chess.com Published-Data API: archives, monthly games (ETag), User-Agent from Settings
  src/pgn.rs              shakmaty + pgn-reader: positions, SAN/UCI moves and %clk times of a PGN
  src/games.rs            games/sync/training-card storage; incremental sync (new months + 2 most recent)
  src/review.rs           background analysis worker: own Stockfish, newest pending game first, pausable
  src/lichess.rs          Lichess opening explorer (explorer.lichess.org): masters / lichess, 30-day SQLite
                          cache, stale fallback, one request at a time, 60 s wait after a 429
  src/secrets.rs          Lichess token in the OS keychain (keyring-core + Apple / Windows native stores)
  src/study.rs            repertoires, SRS cards + reviews, mistake cards, games' opening moves, DB backup/restore
  src/db.rs               SQLite + migrations (append-only!), Claude answer cache, calls-today log
  src/settings.rs         settings.json in the app config dir; dev builds fill blanks from .env.local
  src/commands.rs         Tauri commands called by src/backend/tauri.ts
  src/menu.rs             native menu bar (en/pt, rebuilt on language change); ids handled in src/ui/actions.ts
  prompts/                coach system prompt + JSON schemas (embedded with include_str!)
e2e/                      Playwright tests against mock mode (mock exposes window.__trainer for the trainer tests)
docs/data-formats.md      repertoire PGN conventions, training JSON format, SQLite backup
```

Data flow for "Explain": `store/analysis.ts explain()` → fixed-depth engine eval of the position (and the
one before, for a move) → `buildPacket` + `buildPrompt` → `claude_ask` command (SQLite cache keyed by
sha256(kind, FEN, move, model, PROMPT_VERSION)) → `claude -p --json-schema ... --safe-mode --tools ""`
→ `structured_output` → `checkMoveExplanation` / `checkPositionPlan` → coach panel.

Game review flow: `games_sync` imports games → the worker (`review.rs`) stores one evaluation per position
in `games.analysis_json` → on `review:event gameDone` the frontend runs `core/review.ts`, saves a summary for
the list and training cards (`game_save_review`) → the Review page shows it; "Review with Claude" sends
`buildGameReviewPrompt` (cache key fen = `game:<url>`).

Explorer flow: the Explorer page is `AnalysisPage mode="explorer"` with `ui/explorer/ExplorerPanel` →
`store/explorer.ts load()` → `explorer_query(source, fen, color)`: "masters"/"lichess" go to `lichess::query`
(token from the keychain; no request to `/lichess` without one), "mine" to `games::my_games_explorer` (the
`game_positions` index, keyed by EPD) → then `evaluateMoves` (Stockfish `searchmoves` on the shown moves).
One-off engine searches are serialized by `queued()` in `store/analysis.ts`. "Explain this opening" sends
kind `openingOverview` with the explorer numbers from every source already loaded.

Repertoire flow: wizard (`store/wizard.ts`) → facts from the "mine" explorer → `repertoireProposal` Claude
request per side (cache fen = `repertoire:<color>`, move = hash of the prompt) → `checkProposal` →
explorer stats per option → `runBuild` per repertoire: `buildRepertoire` with `liveOracle` (opponent replies:
Lichess at your level, else masters; your moves: masters theory if Stockfish says it's within
`AS_GOOD_POINTS`, else Stockfish; a 429 waits a minute, no network stops the build as "incomplete").
The Repertoire page is `AnalysisPage mode="repertoire"` + `RepertoirePanel`. Trainer: `store/trainer.ts`
builds cards from repertoires (`rep:<id>:<epd>`) and mistakes (`mistake:<id>`); answers → `answerCard`
(Good / Again) → `srs_record`. A card whose stored `answer` differs from the repertoire move counts as new.

## Conventions

- Never put secrets or the owner's email in code, fixtures or commits. Chess.com contact and username
  come from Settings (dev: gitignored `.env.local`, see `.env.local.example`).
- Tests never call the real network, Stockfish or Claude (except the `#[ignore]`d `tests/live.rs`).
- Pin dependency versions exactly (`.npmrc` has `save-exact`; Cargo uses `=x.y.z`). Check current docs
  before relying on library APIs, CLI flags or config keys.
- Domain logic goes in `src/core` with Vitest tests; React components stay thin.
- Changing the coach prompt, schemas or packet in a way that changes answers: bump `PROMPT_VERSION`
  in `src-tauri/src/claude/mod.rs` (invalidates the cache).
- DB schema changes: add a new migration at the end of `db::migrations()`, never edit old ones.
- When spawning `claude`, the env vars of any parent Claude Code session (`CLAUDE_CODE_*`,
  `ANTHROPIC_*`) are removed so the CLI uses the user's own subscription login. Never use `--bare`.
- Platform styling: `<html data-platform="mac|windows" data-vibrancy="on|off">`, values in `tokens.css`.
- All UI text goes through `useT()` / `tNow()` with keys in `src/i18n/en.ts` + `pt.ts` (no hard-coded
  strings). Rust sends kinds/params (errors, setup checks) and the UI translates them. Claude answers in
  the app language (`languageInstruction`), moves stay in English SAN, concept tags stay English keys.
- "About as good" moves: within `AS_GOOD_POINTS` (3) win-% points of the best (`core/engine-lines.ts`).
- Files (exports, imports, backups) go through Rust commands that show the native dialog themselves
  (`file_save_text`, `file_open_text`, `db_backup`, `db_restore`); the web page never handles paths.
- Data formats that leave the app are documented in `docs/data-formats.md`; change both together.
- Imported courses / books / studies live only in the app-data database (`courses`, `course_annotations`).
  Never add a real course PGN to the repo, fixtures or the bundle (`*.pgn` is gitignored; tests use
  self-written samples). Course notes go into Claude's packet as AUTHOR'S NOTES, and `AskRequest.variant`
  (= `courseKey`) keeps those answers cached apart from plain ones.
- Commits: one or a few per phase; git identity for this repo is local (see PROGRESS.md).
