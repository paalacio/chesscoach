# Progress log

## 1.0.1 (27 Nov 2026): the Mac download opens

Checking the v1.0.0 release found a real problem: only the Mac app's main program was signed, not the app
bundle as a whole. Apple's own check (`syspolicy_check distribution`) called a downloaded copy **fatal**
("code has no resources but signature indicates they must be present"). Another Mac would say the app is
"damaged", and the README's steps wouldn't get past that. Fixed by ad-hoc signing the whole bundle
(`bundle.macOS.signingIdentity: "-"`). The signature is now valid and sealed, and what's left is the usual "not
notarized" warning of any app without a paid Apple developer account, which System Settings → Privacy &
Security → **Open Anyway** gets past. I started the signed app to check that it still launches Stockfish under
Apple's hardened runtime; it does. The README's Mac steps now match current macOS (right-click → Open no longer
works since macOS 15). The Windows files were fine.

## Phase 5 (26 Nov 2026): insights, polish, release

**Status:** built and tested on this Mac, committed and pushed; **CI green** (tests + macOS + Windows
builds, [run](https://github.com/paalacio/chesscoach/actions/runs/45905648228)). **Released:** [v1.0.0](https://github.com/paalacio/chesscoach/releases/tag/v1.0.0), published 26 Nov 2026. Not tried in the real window: the Liquid Glass
setting.

### What's new
- **Insights** (sidebar):
  - your numbers at a glance: games, score, accuracy, and accuracy per phase;
  - **openings to fix next**: openings you play at least 3 times that score under 50%, or where your
    accuracy in the opening or your mistakes per game are clearly worse than usual, most urgent first,
    with "See the games";
  - **results by opening**, as White and as Black (wins/draws/losses, score, accuracy);
  - **accuracy per phase over time**: a line per phase, averaged over your last few games, with a hover
    tooltip and a "Show the numbers" table;
  - **your most common mistake themes**, from Claude's game reviews (each game counted once).
  
  Games analysed before this phase get their summary updated once, in the background, when Insights opens.
- **Leftovers from Phase 4:**
  - right-click a move → "Add the line to ‹repertoire›";
  - rename a repertoire;
  - the game review says where the game left your repertoire.
- **Polish:** a **Liquid Glass** switch in Settings → General (macOS 26+, off by default; older macOS keeps
  the normal translucent sidebar). Window titles fixed for the new name (the Mac and Windows window settings
  still said ChessCoach).
- **README.md** for your friend: install on Mac/Windows, getting past the "unknown app" warnings, installing
  and logging into Claude Code, Settings. In English and Portuguese.
- **Release workflow:** pushing a tag like `v1.0.0` makes CI build both installers and attach them to a
  **draft** GitHub release, which stays private until it's published. The version is now **1.0.0**.

### How it was checked
- Tests: Rust 62, Vitest 102, Playwright 60 (30 tests × WebKit/Chromium). All pass.
- Screenshots: `screenshots/phase-5/` (Insights in English and Portuguese, light and dark, Mac and
  Windows look; the review's repertoire line; the Liquid Glass setting).

### Decisions (and why)
- Charts are small in-house SVG components (like the eval graph), no chart library: three lines and some
  bars don't need one. Colours: the first three slots of a palette checked for colour blindness, with
  labels at the line ends and a table, so colour is never the only cue.
- Opening families merge Chess.com's spelling ("Ruy Lopez Opening", "Kings Indian Defense") with the
  opening list's ("Ruy Lopez", "King's Indian Defense").
- The release is a **draft**: you check it on GitHub and press Publish.

### Release
`v1.0.0` is **published**: https://github.com/paalacio/chesscoach/releases/tag/v1.0.0 (the README's "latest
release" link goes there). It was built as a draft ([build](https://github.com/paalacio/chesscoach/actions/runs/45908971986)),
with `Tung.Tung.Chessahur_1.0.0_aarch64.dmg` (Mac), `…_x64-setup.exe` and `…_x64_en-US.msi` (Windows), and
`…_aarch64.app.tar.gz` (the Mac app zipped, for a future auto-updater). Next releases: bump the version, push a
tag, then publish the draft (GitHub → Releases → the draft → Edit → Publish release).

### Click-through checklist (Phase 5, real app)
- [ ] Insights: after a Chess.com sync, check the numbers, hover the chart, try As White / As Black,
      "See the games".
- [ ] Settings → General → Liquid Glass on, then Save. The sidebar should change. Switch it off again if
      it looks wrong.
- [ ] Right-click a move on the analysis board → "Add the line to …"; Repertoire → Rename….
- [ ] Open a reviewed game: the line under the opening says where it left your repertoire.
- [ ] Read README.md as your friend would.

## Phase 4 addition (26 Nov 2026): course / book / study import, and the new name

**Status:** built and tested on this Mac, committed and pushed; **CI green** (tests + macOS + Windows
builds, [run](https://github.com/paalacio/chesscoach/actions/runs/45902521021)). CI also found a real bug, now
fixed: live analysis could stop an Explain's engine search, which then waited 30 s. **Checked with the
real Claude:** a move explanation of 5...Be7 (Ruy Lopez, real Stockfish lines) with a course comment in the
packet. Claude built on the author's idea ("the course's quiet main line", deciding later between ...b5,
...d6 and ...d5), said plainly that Stockfish slightly prefers 5...Nxe4, and named only moves that pass the
app's check.

- **The app is now called "Tung Tung Chessahur"**: window, menus, About, Setup, messages, exported
  file names and installers. The internal ID (`app.chesscoach.desktop`) is unchanged, so your data folder
  and Lichess token stay where they are. Code names and file formats keep "ChessCoach".
- **Repertoire → Import a course** (toolbar, or the first step of the wizard): pick an annotated PGN
  from a course, a book or a Lichess study. A sheet shows what was read (chapters, your moves, replies,
  comments, side lines); you can rename it and choose the side. Then it becomes a repertoire.
  - **The author's notes** show on the Repertoire page for each position: the introduction, a comment
    on each of the course's moves, and the side lines it shows (click a move to play it).
  - **In the trainer,** the author's comment shows under "Play …" while you learn a move, and again
    when you get it wrong.
  - **Claude gets the notes:** Explain, "Why? Ask Claude" and "Explain this opening" include an
    AUTHOR'S NOTES section, and Claude is told to build on them (and to say so when Stockfish
    disagrees). Those answers are cached separately from plain ones.
  - **Privacy:** the file and the notes are kept only in the app's database in its data folder. `*.pgn`
    files are now ignored by git, and the tests use a small course I wrote myself.
- Decisions:
  - your moves come from the course's main line; other moves it shows for your side are kept as side-line
    notes (a repertoire has one move of yours per position);
  - chapters that start from a FEN join if the course reaches that position; otherwise only their
    comments are kept;
  - the course's replies have no "how often played" numbers, so the trainer picks them evenly.
- Tests: Rust 61, Vitest 96, Playwright 50. Screenshots: `screenshots/phase-4/*course*`.
- **New stretch phase** (model games, Maia, generic engines; no local game database) is written into the
  spec. It comes after Phase 5, and only when you say so.

Checklist: Repertoire → Import a course → a Lichess study (Study → Share → Download PGN) or a course
PGN → check the side → Import → step through, read the notes → Train → Learn new lines.

## Phase 4 (26 Nov 2026): repertoire builder, trainer, portable data

**Status:** built and tested on this Mac, committed and pushed; **CI green** (tests + macOS + Windows
builds, [run](https://github.com/paalacio/chesscoach/actions/runs/45874623852)). **Not tried in
the real window yet:**
- building a repertoire with the real Lichess explorer and Stockfish;
- the save and open dialogs;
- backup and restore.

The pieces underneath were checked for real (see "How it was checked").

### What's new
- **Repertoire** (sidebar). You can have several repertoires. The wizard makes one for Black and one per
  first move as White (you play both the Ruy Lopez and the Queen's Gambit, so: "White · 1.e4",
  "White · 1.d4" and "Black").
  - The board shows **your move** as a green arrow and the **opponent replies** you're ready for as
    lighter arrows. The panel lists the replies with how often players at your level choose them.
  - **Change a move:** play another move on the board and click "Use … instead". To add a reply the
    opponent might play, play it and click "Add it". "Add the moves on the board" adds a whole line.
  - **Notes:** each position has a note field. "Why …? Ask Claude" saves Claude's one-line reason.
  - **Fill in from here:** builds the rest of a line automatically.
  - **Where your games left it:** your recent games, each with the first move that left the repertoire,
    either yours or the opponent's. Click one to open it on the board. After a Chess.com sync, the Games
    page says how many new games left your repertoire.
  - **Export PGN / Import PGN**, and Delete (asks with a second click).
- **The wizard** ("New repertoire"):
  1. **Your games:** what you play and face, and your score, from your Chess.com games.
  2. **Your style:** solid / balanced / sharp, how much theory, attacking or not, and the openings you
     want to keep.
  3. **Claude's options:** 2–3 options per situation (for example "Black against 1.e4"), with pros and
     cons, theory load, plans, why each fits you, and the explorer numbers at your level.
  4. **Build:** the app builds each repertoire from your choices. This takes a few minutes with real
     Lichess data, and you can keep using the app meanwhile.
- **Train** (sidebar, or the Train menu: ⌘⇧L / ⌘⇧R):
  - **Learn new lines:** the app shows a line with an arrow on each new move. Then you play it again
    from the start without help, and only that second pass counts. Default: 10 new moves per day, with
    a "Keep learning" button past that.
  - **Review due:** moves that are due again. The app plays the line that leads there, then waits for
    your move, and carries on along the line while more moves are due.
  - **My mistakes:** positions where you went wrong in reviewed games. Any move about as good as
    Stockfish's counts as right.
  - **The app plays the opponent's moves,** choosing more often the replies that are played more.
  - **A wrong answer** shows the right move as a green arrow and yours as a red one, with a one-line
    reason if one is saved ("Why? Ask Claude" asks for one), and the card comes back three cards later.
  - **Daily goal and streak** are a quiet line at the top: "Today: 12 of 20 cards · 4-day streak".
- **Your data** (Settings):
  - export and import the training cards with their history (JSON);
  - back up and restore everything (a SQLite file). Restoring first saves a copy of the current data.
  
  The formats are described in `docs/data-formats.md`.

### How it was checked
- **Tests:** Rust 60 (+6 live checks run by hand), Vitest 89, Playwright 46 (23 tests × WebKit/Chromium).
  All pass.
- **Real Claude:** the proposal request was sent to the `claude` CLI with the app's exact settings, for
  White and Black, in English and Portuguese. Each took 30–50 s.
  - The answers respected your openings: Ruy Lopez lines against 1...e5, the QGD against 1...d5,
    Sicilian lines against 1.e4, King's Indian lines against 1.d4, and a King's Indian setup against
    1.c4/1.Nf3.
  - Every move in every option passed the app's check. A test keeps it that way.
  - These answers are now the mock-mode examples.
- **Real Lichess:** 217 positions of master games were recorded along your openings. Mock mode builds
  its three example repertoires from them, so the numbers in the screenshots are real.
- **Backup and restore** were tested on real SQLite files: back up, change data, restore, refuse a file
  that isn't ChessCoach's.
- **Screenshots:** `screenshots/phase-4/` (repertoire, wizard in English and Portuguese, trainer, data
  settings; light and dark, Mac and Windows look).

### Decisions (and why)
- **Slots follow your openings,** not the London from the spec's example:
  - as White: against 1...e5, the Sicilian, the French and the Caro-Kann (1.e4), and against 1...d5
    and 1...Nf6 (1.d4);
  - as Black: against 1.e4, against 1.d4, and against 1.c4/1.Nf3.
- **One move of yours per position** in each repertoire, as the spec says. That's why there are
  separate White repertoires for 1.e4 and 1.d4.
- **Opponent replies** are kept if at least **5%** of players at your level choose them (the spec's
  default). I added a second limit: the whole line must come up in at least **1%** of your games.
  Without it a 12-move repertoire grows to thousands of positions; with it, it stays at most around 100
  lines. Both numbers are in Settings → Repertoire.
- **Your moves outside Claude's line:** the move masters play most, if Stockfish says it's about as good
  as its own best (within 3 win-% points). Otherwise Stockfish's move. The panel shows where each move
  came from ("chosen line", "theory", "Stockfish", "yours").
- **Building stops at 600 positions** (about 5 minutes against Lichess) and says so; "Continue
  building" goes on. If Lichess says "too many requests", building waits a minute and continues. If
  Lichess can't be reached, it stops and keeps what was built.
- **Without a Lichess token,** opponent replies come from master games; the wizard says so.
- **Scheduling** uses FSRS-7 from ts-fsrs 6 (released this month):
  - right on the first try = "Good", wrong = "Again";
  - a new move answered right comes back in about 5 days, a wrong one within minutes (and three cards
    later in the same session);
  - if you change a repertoire move, its card starts over.
- **"Why" reasons** never cost a Claude request on their own: a saved one shows at once, and "Ask Claude"
  is a click. They're shared with the analysis board's Explain, which uses the same cached request.

### Click-through checklist (Phase 4, real app: `pnpm tauri dev`)
- [ ] Repertoire → the wizard opens. Type your openings, Ask Claude (about a minute per side), pick
      options, then Build. Watch "Building: … positions"; it takes a few minutes. Try Stop once.
- [ ] On the Repertoire page, step through a line, add a note, and click "Why …? Ask Claude".
- [ ] Play a different move on the board and click "Use … instead". Click "Fill in from here".
- [ ] Train → Learn new lines (a lesson), Review due (tomorrow, once cards are due), and My mistakes
      (after a sync and analysis).
- [ ] Export PGN, then open the file in Lichess (Study → Import PGN): the line tree should match.
- [ ] Settings → Your data: Export training cards; Back up…; then Restore… the backup.


## Phase 3 (26 Nov 2026): opening explorer

**Status:** built and tested on this Mac, committed and pushed; **CI green** (tests + macOS + Windows
builds, [run](https://github.com/paalacio/chesscoach/actions/runs/45864556834)). **Lichess games at
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
- Phase 4 left out, for later if you want them:
  - renaming a repertoire (names come from the wizard);
  - "Add to repertoire" on a move's right-click menu (the Repertoire page's "Add the moves on the board"
    does the same);
  - showing "left your repertoire" on the game review page (it's on the Repertoire page and after a
    sync).
- The Windows Credential Manager code for the Lichess token compiles in CI but hasn't been run on Windows.
