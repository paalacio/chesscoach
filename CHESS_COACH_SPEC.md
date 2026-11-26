# ChessCoach: build spec for Claude Code

You are building a cross-platform desktop app (macOS first, Windows too) that helps me study chess, mainly openings, and understand what the best plan is in each phase of each game. Stockfish does the calculating and Claude does the explaining. On the Mac it should look and feel like a native app. Read this whole file before writing any code.

---

## 0. About me (the user)

- Chess: about 800–1200 rapid on Chess.com. I know how to play but I'm not strong. I started playing regularly in October 2026 to improve.
- I’m most used to playing ruy lopez and queen gambit on white, and king’s indian or sicilian on black, but without knowing any of the lines too well.
- I play on **Chess.com**. My username: `muripalas` (use it to test with real data). My Lichess username is `palas26` (only needed for the explorer token for now).
- **Never put secrets or my email in the code or the repo.** The Lichess token and the contact email are typed into the app's Settings (token → OS keychain, email → local settings file). For tests, use a gitignored `.env.local`.
- Programming: I know beginner Python and R, but not TypeScript or Rust. Keep the code readable, comment the non-obvious parts, and tell me in plain words what you did at the end of each phase.
- Mac: Apple Silicon, recent macOS, English system language. I use Claude Code on a **Claude Pro** subscription. I don't have an Anthropic API key and don't want one for now.
- I want to share the app with a friend who uses **Windows**.
- App language: **English**.

## 1. How I want you to work

1. **Ask before building.** After reading this spec, ask me up to 5 questions about anything that blocks you. Then propose a plan for Phase 0 + Phase 1 and wait for my OK.
2. **Work in phases** (section 8). Finish one before starting the next. At the end of each phase: run the tests, commit, take screenshots of the new screens (light and dark mode), and give me a short checklist of things to click to verify it works.
3. **Check your own work visually.** Make the frontend runnable in a normal browser with a **mock backend** (fixture data instead of Tauri commands). Then you can open it with Playwright, take screenshots and fix layout problems yourself before asking me.
4. **Verify before relying on things.** Library versions, API endpoints, Tauri config keys and CLI flags in this spec were checked in Nov 2026 but can change. Check the current docs, `claude --help` and the package READMEs before you depend on them. Pin dependency versions.
5. **Create a `CLAUDE.md`** in the repo with build/test/dev commands, architecture notes and conventions, and keep it updated.
6. Use git from the start, with one commit (or a few) per phase. Assume the repo will be pushed to GitHub, because the Windows build runs there.
7. Don't over-engineer. Prefer simple, working, tested code over clever abstractions.
8. **Unattended runs (e.g. overnight).** When I say "overnight mode" and name the phases or tasks:
   - work through them without waiting for my OK
   - don't stop for questions: make the most reasonable choice and log it in `PROGRESS.md` (what you did, what you decided and why, what's left, anything I need to check)
   - commit after each finished step
   - stop and leave a note instead of guessing on anything hard to undo
   - **In a cloud session (Linux)** you can't run the macOS app. Do the logic, tests, the Rust backend and mock-mode screenshots, and list in `PROGRESS.md` the Mac-only things I should check in the morning (window effects, menus, the real app build).

## 2. Tech stack

**Shell:** Tauri 2 (Rust backend + system webview). On macOS it needs only the Xcode Command Line Tools, not full Xcode.

**Frontend (`src/`):**
- React + TypeScript + Vite.
- **Board:** [`@lichess-org/chessground`](https://github.com/lichess-org/chessground), the board used on lichess.org.
- **Chess logic** (moves, FEN, SAN, PGN): [`chessops`](https://github.com/niklasf/chessops).
- **Spaced repetition:** [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) (MIT, FSRS v6).
- **State:** a small store such as Zustand.
- **UI building blocks:** unstyled, accessible primitives (e.g. Radix UI) that we style ourselves for the Mac look (section 6).
- **Charts:** a lightweight chart library for eval graphs and the insights page.
- **Opening names:** the CC0 dataset [`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings) (a–e `.tsv` files: ECO, name, moves), bundled with the app.

**Backend (`src-tauri/`, Rust):** everything that touches processes, the network, the disk or secrets.
- **Stockfish:** a UCI engine manager that starts, stops, streams `info` lines to the frontend through Tauri events, and handles MultiPV.
- **Batch game analysis** in the background, using [`shakmaty`](https://github.com/niklasf/shakmaty) + `pgn-reader` for positions and moves on the Rust side.
- **HTTP:** Chess.com and Lichess requests go through Rust (`reqwest` or `tauri-plugin-http`), **not** browser `fetch`. Chess.com needs a custom `User-Agent`, which a webview can't reliably set, and this also avoids CORS problems.
- **Database:** SQLite (`rusqlite` with migrations, or `sqlx`) stored in the Tauri app-data directory.
- **Secrets** (Lichess token): the OS keychain via the `keyring` crate (Keychain on Mac, Credential Manager on Windows).
- **The `claude` CLI:** spawned with `std::process::Command` (section 4).

**Stockfish bundling:** ship Stockfish 19 as a **Tauri sidecar** so my friend doesn't have to install anything.
- Write a script (`scripts/fetch-stockfish`) that downloads the official release binaries and names them the way Tauri expects: `src-tauri/binaries/stockfish-<target-triple>` (plus `.exe` on Windows), e.g. `stockfish-aarch64-apple-darwin` and `stockfish-x86_64-pc-windows-msvc.exe`.
- Settings can point to a custom engine path instead (e.g. Homebrew's `stockfish`).
- Show Stockfish's GPL license and a source link in About.

**License:** chessground, chessops, shakmaty and Stockfish are GPL, so the app is **GPL-3.0-or-later**. Add a `LICENSE` file. That's fine for sharing it free with friends.

**Architecture rule:** keep chess and domain logic in plain TypeScript modules with no React inside (`src/core/`), and keep React components thin. That way the logic is testable and could be reused later, e.g. by a phone trainer.

## 3. The core principle: Stockfish calculates, Claude explains

LLMs make up chess moves and lines. So:

- **Claude never decides what the best move is.** Stockfish does. Claude turns engine output plus position facts into a plain-language explanation for an 800–1200 player.
- Every Claude request includes a **context packet** built in code:
  - FEN, side to move, move number, game phase (section 5.4), the last ~10 moves in SAN
  - the move played (if any), with eval before and after shown as **win probability**, not just centipawns
  - Stockfish's top 3 lines (MultiPV 3) in SAN with evals
  - opening name + ECO, and whether the position is still "in book" or in my repertoire
  - explorer stats for the position, when available
  - simple facts computed in code: material balance, castling status, pieces that are attacked and not defended, passed pawns, open files
  - my rating band (800–1200)
- The prompt tells Claude to **only mention moves that appear in the provided lines or the legal-move list** and never to invent variations.
- **Validate the output:** every SAN move in Claude's JSON is checked with chessops against the legal moves and the engine lines. Drop or flag anything that doesn't match.
- Explanations are short and concrete: at most 3 ideas, one "plan for the next few moves", chess principles in simple words (development, center, king safety, pawn breaks, piece activity, typical plans of the structure).

## 4. Talking to Claude: my Pro plan through the Claude Code CLI

The app calls Claude by running the `claude` CLI in non-interactive mode from the Rust backend, which uses the logged-in Claude subscription of whoever runs the app. Each person needs their own Claude account, so my friend logs into his own Claude Code. Put all of this behind one `ClaudeService` interface, so an API-key backend could be added later without touching the rest of the app.

**Invocation (check the flags against the installed version first):**

```bash
claude -p "<user prompt with the context packet>" \
  --output-format json \
  --json-schema '<schema for this request type>' \
  --system-prompt-file <bundled coach prompt> \
  --tools "" --disallowedTools "mcp__*" \
  --model sonnet \
  --no-session-persistence \
  --safe-mode            # skips the user's CLAUDE.md/plugins/hooks but keeps subscription login
```

- **Do NOT use `--bare`.** Bare mode doesn't use the subscription login and needs an API key.
- `--system-prompt-file` replaces Claude Code's default coding-agent prompt, and `--tools ""` removes tool definitions. That keeps each call small, which matters because it all counts against my Pro limits. If `--safe-mode` doesn't combine well with `-p` on the installed version, drop it and rely on the dedicated working directory.
- Run the process from a **dedicated empty working directory** inside the app-data folder, so no project `CLAUDE.md` gets loaded.
- **Finding the binary:** GUI apps don't inherit the shell `PATH`.
  - On macOS, check `~/.local/bin/claude`, `/opt/homebrew/bin`, `/usr/local/bin`, or ask a login shell: `/bin/zsh -lc 'command -v claude'`.
  - On Windows, check where the native installer puts `claude.exe` (verify this) or run `where claude`.
  - Allow overriding the path in Settings.
- Read `structured_output` from the JSON result (and check that it's present). `result` holds plain text, and `session_id` is there for follow-ups.
- **Follow-up chat** ("ask Claude about this position"): keep the session (no `--no-session-persistence`) and continue with `--resume <session_id>`. Use `--output-format stream-json --verbose --include-partial-messages` and forward the tokens to the frontend as Tauri events, so the chat panel streams.
- **Robustness:**
  - one call at a time (queue), with a timeout around 90s
  - cancel with SIGINT on macOS; on Windows kill the process and accept that the turn is lost
  - clear errors for "claude not found", "not logged in" (check `claude auth status`, `authMethod` should be `claude.ai`) and "usage limit reached"
- **Save Pro usage:**
  - Cache every response in SQLite, keyed by hash(FEN + request type + move played + model + prompt version).
  - Explanations are on demand (an "Explain" button or ⌘E / Ctrl+E), never automatic for every move.
  - Game review explains only the 3–5 key moments, **batched into one call per game**.
  - Show a small "Claude calls today" counter.
- Model in Settings: default `sonnet`, with options for the other aliases the plan supports.

**Example schema (move explanation):**

```json
{
  "type": "object",
  "properties": {
    "summary":   { "type": "string", "description": "1-2 sentences, plain English" },
    "ideas":     { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
    "better_move": {
      "type": ["object", "null"],
      "properties": { "san": { "type": "string" }, "why": { "type": "string" } }
    },
    "plan_next": { "type": "string", "description": "what to aim for in the next few moves" },
    "concepts":  { "type": "array", "items": { "type": "string" },
                   "description": "tags like development, king-safety, hanging-piece, pawn-break" }
  },
  "required": ["summary", "ideas", "plan_next", "concepts"]
}
```

Create similar schemas for: position plan, opening overview, game summary (3 lessons), key-moment batch, and repertoire proposal.

## 5. Features

### 5.1 Board & analysis (the base for everything)
- chessground board:
  - drag-and-drop and click-to-move, legal-move dots, last-move and check highlights, promotion picker, animations, coordinates, flip board
  - arrows and circles drawn by me (right-drag), plus an arrow for Stockfish's best move
- Slim eval bar plus MultiPV 3 lines (clickable to preview), depth and nodes shown. Live analysis runs until stopped.
- Move list with variations, PGN/FEN paste and import, copy FEN/PGN.
- Keyboard: ←/→ move, ↑/↓ start/end, F flip, Space engine on/off, ⌘E / Ctrl+E explain the position.
- Stockfish defaults: Threads = CPU cores − 1, Hash 256 MB, MultiPV 3. Depth/time configurable.

### 5.2 Chess.com import & game review
- Import my games from the Chess.com Published-Data API: `GET https://api.chess.com/pub/player/{user}/games/archives`, then each monthly archive. Fetch **sequentially** (parallel requests can get 429). Chess.com requires a **User-Agent with contact info**. Build it from Settings, e.g. `ChessCoach/0.1 (username: <chess.com username from Settings>; contact: <email from Settings>)`, so each person's copy (like my friend's) uses their own details and nothing personal is hardcoded. Incremental sync: only fetch new months and games.
- Background analysis of each game in Rust (e.g. ~0.3–0.5 s or depth 16–18 per move, configurable), with progress shown and the ability to pause.
- Per game:
  - eval graph (win %)
  - move classification using **Lichess-style win-probability-drop thresholds** (inaccuracy, mistake, blunder; look up the exact formula and thresholds)
  - accuracy per phase (opening, middlegame, endgame)
  - **"where I left book"** (first move outside my repertoire, and first move outside popular theory)
  - key moments (biggest win % swings)
- Claude: a game summary with 3 lessons, plus explanations for the key moments (one batched call).
- Every blunder or mistake I made becomes a **training card** ("find the better move"), added to the trainer.

### 5.3 Opening explorer
- Three sources, as tabs or a segmented control:
  1. **Lichess Masters**
  2. **Lichess rated games**, filtered by rating band (default around 1000–1600) and speed (rapid/blitz), so I see what people at my level actually play
  3. **My games**: a tree built locally from my Chess.com games, split by color
- For each candidate move: games count, a W/D/L bar, Stockfish eval, opening name.
- **The Lichess explorer now requires authentication.** I'll create a free Lichess account and a personal API token (lichess.org/account/oauth/token). Store it in the OS keychain and send it from Rust as `Authorization: Bearer <token>` to `explorer.lichess.ovh` (`/masters`, `/lichess`). Check the current API docs for parameters.
- Cache explorer responses in SQLite (refresh after ~30 days). On 429s or outages, back off and fall back cleanly to "My games" plus the engine. The app must never break because Lichess is down.
- Claude "Explain this opening": typical plans, the pawn structure and what each side aims for, the most common traps and mistakes at my level, and how to play the middlegame that comes out of it.

### 5.4 Game phases ("what's best in which part of the game")
- Detect opening, middlegame and endgame with a simple documented heuristic in code (e.g. opening until development/castling or leaving book, endgame when non-pawn material drops below a threshold; look at how Lichess's "divider" does it).
- Show the phase on the board and in reviews. Claude's explanations are phase-aware:
  - **opening:** development and principles
  - **middlegame:** plans and pawn breaks for the structure
  - **endgame:** king activity, passed pawns, technique

### 5.5 Repertoire builder (help me find my openings)
- **Wizard:**
  1. Analyze my imported games: what I face most as Black (1.e4 / 1.d4 / other) and what Black plays against my London, with my results in each.
  2. Ask a few style questions (sharp vs solid, how much theory I'm willing to learn, do I like attacking).
  3. Claude proposes **2–3 candidate options per slot**:
     - Black vs 1.e4 (which Sicilian, or an alternative)
     - Black vs 1.d4
     - Black vs 1.c4 / 1.Nf3 / other
     - White: the London setup against Black's main replies
  4. Each option comes with pros and cons, theory load, typical plans, and explorer stats at my rating. I choose, and the app builds the tree.
- **Repertoire tree:**
  - positions keyed by normalized FEN (EPD) so transpositions merge
  - one chosen move for my side per position
  - opponent replies included if played in ≥ X% of games at my level (default 5%, configurable)
  - default depth around 10–12 moves
  - per-node notes (mine, plus Claude's cached "why")
- **Deviation report:** after each sync, show where my games left the repertoire (my mistake, or a new opponent move) and offer to add the new move to the tree.

### 5.6 Trainer (spaced repetition)
- FSRS scheduling with ts-fsrs. A card is a position where it's my move. The app plays the opponent's moves automatically, weighted by how often they're played.
- Modes: **Learn new lines**, **Review due**, **My mistakes** (cards from game review).
- On a wrong move: show the right move, an arrow, and a one-line cached reason, then repeat the card soon.
- Daily goal and streak, but keep it low-key.

### 5.7 Insights dashboard
- Results by opening and color, accuracy per phase over time, my most common mistake tags (from Claude's `concepts`), and a short list of "openings to fix next".

## 6. Design: native Mac look (and at home on Windows)

The goal: on macOS it should be hard to tell this isn't a native app. Detect the OS at startup (Tauri's OS plugin), set `data-platform="mac"` or `"windows"` on `<html>`, and keep platform-specific styling in CSS variables.

**Window (macOS):**
- `titleBarStyle: "Overlay"` with a hidden title, so the red/yellow/green buttons sit over the sidebar like in Apple's apps. Put a toolbar area in the title-bar strip and make it draggable (`data-tauri-drag-region`).
- **Translucent sidebar:** a transparent window + `macOSPrivateApi: true` + Tauri's `windowEffects` with the `sidebar` material (check the exact config keys). The sidebar background stays transparent in CSS so the effect shows through. Content areas stay opaque.
- **Optional:** Liquid Glass on macOS 26+ with `tauri-plugin-liquid-glass` (experimental; falls back to vibrancy). Put it behind a setting and only add it if it works reliably.
- Real **native menu bar** (App, File, Edit, View, Game, Train, Window, Help) with keyboard shortcuts, built with Tauri's menu API. **Native context menus** on right-click (e.g. on a move: "Explain", "Add to repertoire", "Copy FEN").

**Window (Windows):** normal title bar with a **Mica** effect on the sidebar (opaque fallback if it isn't available), Segoe UI Variable font, Ctrl instead of ⌘ everywhere.

**Look & feel:**
- **Font:** `system-ui` / `-apple-system` (SF Pro) on Mac, at macOS sizes (13 px body, 11 px secondary), with tabular numbers for evals and stats.
- **Light/dark:** follow the system automatically. Use the system accent color if the webview exposes it, otherwise macOS blue.
- **Layout:** like Apple's apps, three columns:
  1. **Sidebar:** Analysis, Games, Explorer, Repertoire, Train, Insights; Settings in a separate window or sheet
  2. **Board:** big, always square, fills the space
  3. **Inspector panel:** engine lines, explorer, Claude explanation; collapsible
- **Controls:** a small in-house component set styled like macOS: sidebar list with selection pill, segmented controls, toggles, popovers, sheets, search field, buttons. Corner radii, focus rings and hover states like AppKit.
- **Icons:** a clean line icon set (e.g. Lucide or Phosphor). Don't use SF Symbols, because their license is meant for apps on Apple platforms only.
- **Motion:** short (150–250 ms), eased animations, and respect "reduce motion".
- **Board theme:**
  - restyle chessground with CSS: muted, elegant square colors (offer 3 themes, e.g. classic brown, blue-gray, green) and a nice piece set (cburnett default, with a few alternatives; check licenses and add attribution)
  - rounded outer corners and a soft shadow
  - last-move highlight in the accent color at low opacity, and a soft check glow
  - arrow colors: engine = accent, mine = green/red/yellow
  - slim eval bar with rounded ends
- No modal popups for explanations. They go in the inspector panel.
- Loading states for the engine, Claude and the network. Never freeze the UI.

**Visual QA:** in every phase that adds UI, take Playwright screenshots of the browser mock mode in light and dark, check them yourself, fix obvious problems, then show me the screenshots.

## 7. Portable data (so a phone trainer is possible later)

- Repertoire: import/export as **PGN** (with comments for notes).
- Trainer cards and review history: export/import as **JSON** (documented schema).
- Full backup/restore of the SQLite database from Settings.
- Never lock data into a format only this app can read.

## 8. Phases

- **Phase 0, setup & spikes:**
  - Check the toolchain (Xcode CLT, rustup, Node LTS + pnpm, Tauri CLI, `claude` CLI + `claude auth status`), and tell me exactly what to install if something is missing.
  - Scaffold Tauri 2 + React + TS + Vite.
  - Spikes:
    1. the overlay title bar + translucent sidebar window
    2. talking UCI to the bundled Stockfish sidecar
    3. calling `claude -p` with a JSON schema from Rust and showing `structured_output` in the UI
    4. fetching my Chess.com archive list with the custom User-Agent
  - Set up the browser mock mode + Playwright screenshots.
  - Add a first-run **setup screen** that checks each dependency and explains how to fix it.
- **Phase 1:**
  - The design system (section 6), the board and analysis (5.1), the Claude "Explain position" panel and the response cache.
  - **Set up the GitHub Actions build now** (`tauri-apps/tauri-action`, matrix: `macos-latest` + `windows-latest`, artifacts uploaded) so Windows problems show up early.
- **Phase 2:** Chess.com import and game review (5.2), plus phase detection (5.4).
- **Phase 3:** opening explorer (5.3).
- **Phase 4:** repertoire builder (5.5), trainer (5.6) and portable data (section 7).
- **Phase 5:** insights dashboard (5.7), polish, and a release:
  - tagged GitHub release with the macOS `.dmg` and the Windows installer
  - a short README for my friend: how to install, log into Claude Code, and get past the Windows SmartScreen warning for an unsigned app ("More info → Run anyway")
- **Stretch (ask before doing):** play out any position against Stockfish at limited strength (UCI_LimitStrength / UCI_Elo) to practice the middlegame that comes out of my openings.

**Done for a phase means:** the tests pass, the app runs with `pnpm tauri dev`, the GitHub Actions build is green (from Phase 1 on), it's committed, and you've given me screenshots and a short click-through checklist.

## 9. Tests I expect

- **Rust (`cargo test`):**
  - UCI output parsing (info lines, mate scores, MultiPV)
  - PGN import (including Chess.com PGNs with `%clk` comments)
  - the Chess.com and Lichess clients (with recorded fixtures)
  - the explorer cache and offline fallback
  - Claude JSON parsing
  - database migrations
- **TypeScript (Vitest):**
  - win-probability conversion and move classification
  - phase detection
  - FSRS scheduling wrapper
  - SAN validation of Claude's output
  - repertoire tree logic (transpositions, coverage thresholds)
- **Playwright:** smoke tests and screenshots against the browser mock mode.
- Tests never call the real network, Stockfish or Claude.

## 10. Out of scope for v1

App Store / Microsoft Store distribution, code signing, cloud sync, a phone app (but keep data portable, section 7), Lichess game import (maybe later), a puzzle database, multiplayer, Linux builds (free to add later, since Tauri supports it).
