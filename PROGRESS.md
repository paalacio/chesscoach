# Progress log

## Phase 3 (26 Nov 2026): opening explorer

**Status:** built and tested on this Mac, committed and pushed; CI: see the line below. **Lichess games at
your level haven't been tried for real yet**, because that needs your Lichess token (step 4 under "Things
only you can do"). The Masters explorer was checked against the real Lichess.

### What's new
- **Explorer** (sidebar). The same board as Analysis, with the explorer for the current position on the
  right. Three sources:
  - **Masters**: Lichess's database of master games played over the board. Works without a token.
  - **My level**: Lichess rated games, filtered by rating (default 1000–1600) and speed (default blitz and
    rapid). Click the chips to change the filters; your choice is saved. Needs a Lichess token.
  - **My games**: your own Chess.com games as White or as Black, built on this computer from the games you
    synced.
- **Each row** shows:
  - the move and its opening name;
  - how often it's played (share and count);
  - a White / draw / Black bar;
  - Stockfish's evaluation after the move (depth 14, for the top 8 moves).
  
  Click a row to play the move.
- **"Explain this opening"** sends one Claude request with:
  - the explorer numbers from every source you've looked at;
  - Stockfish's lines;
  - the opening name.
  
  The answer covers the main idea, the pawn structure, plans for each side, traps, common mistakes at club
  level, and how the middlegame usually goes. It comes in English or Portuguese and is cached per position
  and language.
- **Lichess token** (Settings → Lichess):
  - paste the token and press Save; it goes to the macOS Keychain (Windows: Credential Manager), never
    into a file;
  - "Create a token" opens the Lichess page with the name already filled in; no permissions need ticking;
  - the Setup screen shows whether a token is saved.
- **Lichess being down never breaks the app:**
  - answers are cached for 30 days;
  - if Lichess fails, the last answer shows with a note;
  - after "too many requests" (HTTP 429), the app waits 60 s before asking again;
  - the panel offers Masters or My games instead.

### How it was checked
- Tests: Rust 55 (+6 live checks run by hand), Vitest 63, Playwright 32 (16 tests × WebKit/Chromium). All pass.
- **Real Lichess:** the Masters explorer for the start position returned 3.0M games with e4 first. The
  live check (`live_lichess_masters_explorer`) and the mock-mode recording both use real answers.
- **Real Claude:** "Explain this opening" on the Closed Ruy Lopez, in English and in Portuguese. The
  answers were good and are now the mock-mode examples.
- Screenshots: `screenshots/phase-3/`, covering Masters, My level, no token, and Explain in English and
  Portuguese, in light and dark.

### Decisions (and why)
- **Host `explorer.lichess.org`.** Lichess moved the explorer there; the spec's `explorer.lichess.ovh`
  is the old address. I checked the current API: `/masters` answers without a token and `/lichess`
  answers 401 without one, so the app only asks `/lichess` once a token is saved.
- **Token:**
  - needs no scopes;
  - is checked for its shape before saving (10–200 letters, digits, `_` or `-`);
  - is stored with the `keyring-core` crate and the native Apple and Windows stores, under service
    `app.chesscoach.desktop` and account `lichess-api-token`.
- **Requests to Lichess go one at a time**, as Lichess asks.
- **My games:**
  - every position of every synced game is indexed once, keyed by the position without move counters,
    so transpositions land on the same row;
  - it's split by the colour you played.
- **Explorer evaluations** are short Stockfish searches limited to the explorer's moves. They wait their
  turn behind "Explain" and the other one-off searches, so two never fight over the engine.

### Click-through checklist (Phase 3, real app: `pnpm tauri dev`)
- [ ] Explorer → Masters: step through a Ruy Lopez. The rows load and the evaluations appear a second
      later; click a row to play it.
- [ ] Settings → Lichess → "Create a token" (no boxes to tick), paste it, press Save. Then try Explorer →
      My level and the rating and speed chips.
- [ ] After a Chess.com sync: Explorer → My games, as White and as Black.
- [ ] "Explain this opening" on one of your openings (Ruy Lopez, Queen's Gambit, King's Indian, Sicilian).
- [ ] Turn Wi-Fi off and go back to a position you already looked at: the saved answer still shows.

## Phase 2 (26 Nov 2026): Chess.com import, game review, phases + language switch + "compare the best moves"

**Status:** built and tested on this Mac, committed and pushed; **CI green** (tests + macOS + Windows
builds, [run](https://github.com/paalacio/chesscoach/actions/runs/45826689352)). **The real Chess.com
sync hasn't been tried yet**, because `CHESSCOM_CONTACT` in `.env.local` is still empty. Everything else was
also checked against the real Stockfish and Claude.

### What's new
- **Games** (sidebar). Sync downloads your games from Chess.com month by month: only new months, plus the
  two most recent ones, which are re-asked with their ETag so an unchanged month is almost free. Requests
  go one at a time with a short pause between them. You can filter by colour and result and search by
  opponent or opening.
- **Background analysis.** A second Stockfish (about half your CPU) analyses every new game, newest
  first: depth 16, max 1.5 s per position. Its progress shows in the toolbar, and you can pause it. If you
  open a game that isn't analysed yet, it jumps to the front of the queue.
- **Game review** (click a game):
  - a win-chance graph (click or drag to jump) with the middlegame/endgame boundaries and dots at key moments;
  - accuracy per phase for you and your opponent, computed the Lichess way (see below);
  - counts of inaccuracies, mistakes and blunders;
  - where the game left the known opening;
  - the 5 biggest swings, with Stockfish's move;
  - **"Review this game with Claude"**: one request gives a summary, 3 lessons tied to phases, and a
    comment on each key moment;
  - "Analyse" opens the current position on the analysis board.
- **Training cards.** Every mistake or blunder you made is saved as a "find the better move" card. The
  trainer itself comes in Phase 4.
- **English / Português** (Settings → General). The whole UI, the menu bar and Claude's answers follow the
  language. Moves stay in English notation (Nf3, O-O), like on Lichess and Chess.com.
- **Several good moves, not just the best one** (your request):
  - the board shows the best move as a solid arrow, and any move about as good as a lighter arrow;
  - in the engine panel those lines get a ≈;
  - **"Compare the best moves"** (⌘B) asks Claude to explain each good move: its idea, the plan after it,
    its style (solid / sharp / …), and which one to pick at your level.

### How it was checked
- Tests: Rust 49 (+5 live checks run by hand), Vitest 58, Playwright 26 (13 tests × WebKit/Chromium). All pass.
- **Real app:** the new database tables are created on start. A hidden test game was analysed by the real
  worker (22 positions, depth 16, about 15 s), then deleted.
- **Real Claude:** the game-review and compare prompts were sent with the app's settings, in English and in
  Portuguese. The answers were good, named only real moves (unverified ones get marked), and the
  Portuguese reads naturally. They're now the mock-mode examples.
- Screenshots: `screenshots/phase-2/`, covering the games list, the review, the comparison, empty games,
  and Portuguese settings/setup, in light and dark.

### Decisions (and why)
- **Accuracy** uses Lichess's game-accuracy formula: the average of a volatility-weighted mean and a
  harmonic mean, per phase on the phase's positions. Ported from lila's `AccuracyPercent.scala`. A plain
  average gave 94% to a game with two blunders; this gives about 90/81, like Lichess would.
- **Key moments** are the 5 biggest drops in the mover's win chance, of at least 7.5 points.
- **"Left the known opening"** uses the opening-name list. "Left your repertoire" comes with the
  repertoire in Phase 4.
- **Claude reviews games only when you ask**, at one request per game, cached per game and language.
- **Portuguese** is Brazilian (pt-BR). A blunder is a "Capivarada", as on Chess.com Brasil, and the menus
  use the macOS words (Ajustes, Arquivo, …). Tell me if you'd prefer European Portuguese.
- **"About as good"** means at most 3 win-% points behind the best for the side to move, which is about how
  much Stockfish's evaluation moves between depths. "Playable" means 3–8 points behind. The comparison
  asks Stockfish for 4 lines at depth 18.
- **Mock mode** uses 6 made-up club games (Stockfish playing itself with random mistakes) in your
  openings. They are clearly marked as invented and exist only for screenshots and tests.

### Click-through checklist (Phase 2, real app: `pnpm tauri dev`)
- [ ] Fill in `CHESSCOM_CONTACT` in `.env.local` (or in Settings), then go to Games → Sync. Your months
      import one by one, and the toolbar then shows "Analysing · …%".
- [ ] Open a game, try ←/→ and the graph, click a key moment, then "Review this game with Claude".
- [ ] Pause and resume the analysis; turn "Analyse new games automatically" off and on in Settings.
- [ ] Analysis board: the lighter arrows for as-good moves, ≈ in the engine panel, ⌘B (Compare the best moves).
- [ ] Settings → Language → Português, then check the menu bar, the setup screen, and a Claude answer.

## Overnight run, 26 Nov 2026: Phase 0 + Phase 1

**Status:** Phase 0 and Phase 1 are done. Built and tested on this Mac, pushed to
https://github.com/paalacio/chesscoach, and **CI is green** (tests + macOS + Windows builds,
[run](https://github.com/paalacio/chesscoach/actions/runs/45818183525)). Installers are on the run page
under Artifacts: `ChessCoach-windows-x64-nsis` (setup .exe for your friend), `-msi`, and the macOS
`.app` / `.dmg`. The first Windows build failed while unzipping Stockfish (a PowerShell module
clash); fixed by using Windows' own `tar.exe`.

### What works (checked)

| | How it was checked |
|---|---|
| Toolchain | Xcode + CLT, Node 26 LTS, pnpm 12.23, Rust 1.100 (Homebrew rustup), gh 2.106, Claude Code 2.1.311 (Pro login, `authMethod: claude.ai`) |
| Spike 1: overlay title bar + translucent sidebar | Configured (`tauri.macos.conf.json`) and the app starts, but **not seen on screen**: screen capture needs a permission I don't have. Please look (checklist below). |
| Spike 2: Stockfish 19 sidecar over UCI | Live test against the real bundled binary: MultiPV 3 streams, and output from a stopped search is dropped. In `pnpm tauri dev` the frontend started the engine through the Rust command. |
| Spike 3: `claude -p` + JSON schema from Rust | Live tests: structured output, `auth status`, and Cancel (SIGINT, about 1 s). Two real Sonnet calls with the real prompts gave good answers, now used as mock fixtures. |
| Spike 4: Chess.com archive list | Client + User-Agent + local fake-server tests pass. **The live call is skipped** until you fill in `CHESSCOM_CONTACT` in `.env.local`. |
| Mock mode + Playwright | `pnpm dev:mock`. 7 smoke tests × WebKit + Chromium pass; 28 screenshots in `screenshots/phase-1/` |
| Setup screen | Checks engine, Claude Code, Claude login, Chess.com and Lichess (later) with fixes; "Send a test question" button |
| Phase 1 | Design system, board, analysis, coach panel, answer cache, native menus, GitHub Actions workflow |

Tests: Rust 35 (+4 live, run by hand), Vitest 36, Playwright 14. All pass.

### Things only you can do (a few minutes)

1. ~~Log in to GitHub~~ Done (26 Nov, morning). Commits now use your GitHub no-reply address; the repo
   is public at https://github.com/paalacio/chesscoach, spec included (your choice).
2. **Add Rust to your shell PATH.** My edit to `~/.zshrc` was blocked, so add this line yourself:
   `export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"`
3. **Fill in `CHESSCOM_CONTACT=`** in `.env.local` (your contact email for Chess.com), or type it in the
   app under Settings → Chess.com. Then the live Chess.com check can run.
4. **Make a Lichess token** (for "My level" in the Explorer). Log in at lichess.org, then in the app go to
   Settings → Lichess → "Create a token". Tick nothing, create it, paste it into the app and press Save.

### Click-through checklist (real app: `pnpm tauri dev`)

- [ ] The red/yellow/green buttons sit inside the sidebar's top strip, lined up with the toolbar. The
      sidebar is translucent (move the window over something colourful). The board area stays opaque.
- [ ] Drag the window by the toolbar or by the empty strip at the top of the sidebar.
- [ ] Menu bar: ChessCoach / File / Edit / View / Game / Train / Window / Help. Try ⌘N, ⌘O, ⌘1–⌘6, ⌘,
- [ ] Board: drag and click moves, legal-move dots, promotion picker (push a pawn to the last rank),
      arrows with right-drag (Shift = red, Alt = yellow), F flips, Space toggles the engine.
- [ ] Engine panel shows 3 lines with depth and speed. Click a move in a line to preview it, Esc to leave,
      "Play these moves" to add them.
- [ ] ⌘O, paste a PGN with variations → move list with variations; right-click a move for the native menu.
- [ ] ⌘E on a move → "Checking with Stockfish…", then "Asking Claude…", then the card. The "Claude
      calls today" counter goes up by one. Press ⌘E again on the same move: the saved answer comes back instantly with no new call.
- [ ] Setup (sidebar) → all green except Chess.com/Lichess → "Send a test question".
- [ ] Settings → change board colours / pieces / coordinates.
- [ ] Switch macOS to dark mode: everything follows.
- [ ] Optional: open the release build `src-tauri/target/release/bundle/macos/ChessCoach.app`.

### Decisions made overnight (and why)

- **App id `app.chesscoach.desktop`.** I didn't know your GitHub username, so I couldn't use the planned
  `io.github.<you>.chesscoach`. The id names the data folder (`~/Library/Application Support/app.chesscoach.desktop`).
  Changing it before you have real data costs nothing; say if you want it changed.
- **Stockfish 19 "universal" builds.** Stockfish 19 ships one binary per OS that picks the best CPU code
  at runtime, so there's no avx2/bmi2 choice for your friend's PC.
- **`--system-prompt-file` works** even though `claude --help` doesn't list it, and `--safe-mode`
  combines fine with `-p`. Both are used as the spec describes.
- **Env stripping:** when the app starts `claude`, it removes `CLAUDE_CODE_*`, `CLAUDECODE` and
  `ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL`. That way it always uses your own subscription login, even when
  launched from a terminal inside another Claude Code session, and never bills an API key by accident.
- **Prompt goes through stdin**, not as a command-line argument (no length or quoting problems on Windows).
- **Lichess formulas checked against their source:**
  - win% = 50 + 50·(2/(1+e^(−0.00368208·cp))−1), with cp capped at ±1000 and mates counted as ±1000;
  - inaccuracy / mistake / blunder = drops of 0.1 / 0.2 / 0.3 in winning chances (5 / 10 / 15 win-% points);
  - accuracy formula from `AccuracyPercent.scala`.

  Phase detection is a port of scalachess's `Divider` (MIT). Small deviation: Lichess judges moves into
  or out of a forced mate with separate rules; for now we treat a mate as ±1000 cp.
- **Explain button.** It explains the last move (with the "better move" field) when there is one, and
  otherwise gives a plan for the position. "Plan for this position" (⇧⌘E) is always available.
  Explanations run a depth-18 engine check first, so Claude always gets deep engine lines.
- **Claude's moves are checked.**
  - A suggested move that isn't legal, or isn't one of the engine's top moves, is removed, with a note.
  - Moves named inside sentences that aren't legal or in any engine line get a dotted orange underline.
  - Not flagged: castling ("castle with O-O" is a plan) and piece references like "the Nf6".
- **"In book"** means the position has a name in the CC0 opening list. That's a rough signal; the
  explorer in Phase 3 will give a better one.
- **After importing a PGN, the board shows the end of the main line**, which is where you want to look
  when studying an opening.
- **Last-move highlight is the accent blue at 40%.** At lower strength, blue over brown squares turns grey.
- **Piece sets:** cburnett (GPLv2+), merida (GPLv2+), chessnut (Apache-2.0), all GPL-compatible, credited in
  About. I skipped sets that lichess lists as non-commercial or non-free.
- **New app icon** (`assets/icon.svg`): merida knight on a blue tile with a gold sparkle.
- **Screenshots are gitignored**, to keep the repo small. They're regenerated with `pnpm screenshots`.
- **Your spec changed during the night.** Your openings are now the Ruy Lopez and Queen's Gambit as White,
  and the King's Indian or Sicilian as Black. That matters for the Phase 4 repertoire wizard (which
  still says "London" in section 5.5). I'll use your new openings unless you say otherwise.

### Not done yet / known gaps

- Windows builds in CI, but nobody has run the app on Windows yet. On Windows these need a look: Mica sidebar,
  Segoe UI, Ctrl shortcuts, and finding `claude.exe` at `%USERPROFILE%\.local\bin`.
- Follow-up chat ("ask Claude about this position", streaming) isn't built yet. The plan was to leave it
  out of Phase 1 unless you want it.
- Liquid Glass: Tauri 2.12 now has `liquidGlassRegular` window effects built in, so no plugin is needed.
  I left it for the Phase 5 polish as planned.
- The Chess.com fixture is hand-made in the documented shape. Once the contact is set, I'll replace it
  with a recorded real response.
- The JSON schema for the repertoire proposal comes with Phase 4.
- The Windows Credential Manager code for the Lichess token compiles in CI but hasn't been run on Windows.
