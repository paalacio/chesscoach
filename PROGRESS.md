# Progress log

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
- The JSON schemas for opening overview, game summary, key-moment batch and repertoire proposal will
  come with the phases that use them.
- The Lichess token in the keychain is Phase 3.
