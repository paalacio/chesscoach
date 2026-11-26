# ChessCoach

Desktop app (Tauri 2: Rust backend + React/TypeScript UI) for studying chess openings and plans.
**Stockfish calculates, Claude explains.** The full spec is `CHESS_COACH_SPEC.md`; progress notes and
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
| Regenerate data | `pnpm openings` (opening names), `node scripts/fetch-pieces.mjs`, `node scripts/record-engine-fixture.mjs`, `node scripts/make-icon.mjs` |

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
    context-packet.ts     what Claude receives + prompt text; the allowed-move sets
    validate.ts           checks every move Claude names (drops invalid structured moves, flags prose)
  backend/                One `Backend` interface: tauri.ts (real, invoke/listen) and mock.ts (fixtures)
    fixtures/             Real recorded Stockfish lines and Claude answers for mock mode
  store/                  Zustand stores: app (pages, settings, sheets), analysis (tree, engine, Claude)
  ui/                     Thin React components; styles in src/styles (tokens.css = design tokens)
src-tauri/                Rust: everything touching processes, network, disk, secrets
  src/engine/             Stockfish UCI manager (+ uci.rs parser and SearchTracker for stale output)
  src/claude/             ClaudeService trait + CliClaude (`claude -p`), output parsing, binary lookup
  src/chesscom.rs         Chess.com Published-Data API (User-Agent built from Settings)
  src/db.rs               SQLite + migrations (append-only!), Claude answer cache, calls-today log
  src/settings.rs         settings.json in the app config dir; dev builds fill blanks from .env.local
  src/commands.rs         Tauri commands called by src/backend/tauri.ts
  src/menu.rs             native menu bar; item ids are handled in src/ui/actions.ts
  prompts/                coach system prompt + JSON schemas (embedded with include_str!)
e2e/                      Playwright tests against mock mode
```

Data flow for "Explain": `store/analysis.ts explain()` → fixed-depth engine eval of the position (and the
one before, for a move) → `buildPacket` + `buildPrompt` → `claude_ask` command (SQLite cache keyed by
sha256(kind, FEN, move, model, PROMPT_VERSION)) → `claude -p --json-schema ... --safe-mode --tools ""`
→ `structured_output` → `checkMoveExplanation` / `checkPositionPlan` → coach panel.

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
- Commits: one or a few per phase; git identity for this repo is local (see PROGRESS.md).
