# Tung Tung Chessahur

A desktop app (macOS and Windows) for studying chess openings and plans.
**Stockfish calculates, Claude explains**: the engine finds the moves, and Claude (through your
own Claude subscription) explains them in plain words, in English or Brazilian Portuguese.

- **Analysis**: a board with Stockfish, and "Explain" for any move or position.
- **Games**: imports your Chess.com games, analyses them in the background, and reviews each one
  (accuracy per phase, key moments, a Claude review with 3 lessons).
- **Explorer**: master games, games at your level (Lichess), and your own games, move by move.
- **Repertoire**: a wizard where Claude suggests openings for your style, then builds a repertoire;
  or import a course, a book or a Lichess study (annotated PGN).
- **Train**: spaced repetition of your repertoire and of your own mistakes.
- **Insights**: results by opening, accuracy per phase over time, what to work on next.

*(Em português: veja [mais abaixo](#em-português).)*

## Install

Download the installer for your computer from the
[latest release](https://github.com/paalacio/chesscoach/releases/latest):

- **Mac** (Apple Silicon: M1 or newer): `Tung.Tung.Chessahur_…_aarch64.dmg`. Open it and drag the
  app into Applications.
- **Windows** (64-bit): `Tung.Tung.Chessahur_…_x64-setup.exe`. Run it.

The app isn't signed with a paid developer certificate, so the system warns you the first time:

- **Mac**: macOS says it can't check the app. In Applications, **right-click** the app → **Open**
  → **Open**. (Or: System Settings → Privacy & Security → "Open Anyway".) After that it opens
  normally.
- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info** → **Run anyway**.

## Set up Claude (needed for the explanations)

The app uses **Claude Code** with your own **Claude Pro or Max** subscription (no API key).

1. Install Claude Code:
   - **Mac**: open Terminal and run
     ```bash
     curl -fsSL https://claude.ai/install.sh | bash
     ```
   - **Windows**: open PowerShell and run
     ```powershell
     irm https://claude.ai/install.ps1 | iex
     ```
2. Log in: in the same window, run `claude`, choose to log in with your Claude account, and
   follow the browser. Then close the window.
3. Open Tung Tung Chessahur. The **Setup** screen checks everything (engine, Claude, login) and
   tells you exactly what's missing, with the fix.

Stockfish (the engine) comes inside the app; nothing to install.

## Your games and the explorer

In **Settings**:

- **Chess.com**: your username, and a contact email. Chess.com asks apps to include one in their
  requests; it's only sent to Chess.com.
- **Lichess** (optional): a free API token, for the explorer's "games at your level" (master
  games work without it). Settings → Lichess → "Create a token on lichess.org", tick nothing,
  create, paste, Save. It's kept in your computer's keychain, never in a file.

## Your data

Everything stays on your computer: games, analysis, repertoires, training cards, and any course
you import. Settings → Your data lets you export your training cards, back up everything, and
restore. The formats are described in [docs/data-formats.md](docs/data-formats.md).

---

## Em português

**Instalar:** baixe o instalador na [última versão](https://github.com/paalacio/chesscoach/releases/latest).
No **Mac**, abra o `.dmg` e arraste o app para Aplicativos. No **Windows**, rode o `…_x64-setup.exe`.

Na primeira vez o sistema avisa que o app não é assinado:
- **Mac**: em Aplicativos, clique com o **botão direito** no app → **Abrir** → **Abrir**.
- **Windows**: em "O Windows protegeu o computador", clique em **Mais informações** → **Executar assim mesmo**.

**Claude (para as explicações):** o app usa o **Claude Code** com a sua assinatura **Claude Pro ou Max**.
1. No **Mac**, abra o Terminal e rode `curl -fsSL https://claude.ai/install.sh | bash`.
   No **Windows**, abra o PowerShell e rode `irm https://claude.ai/install.ps1 | iex`.
2. Na mesma janela, rode `claude` e faça login com a sua conta do Claude.
3. Abra o Tung Tung Chessahur: a tela **Verificação** confere tudo e diz o que falta.

**Ajustes:** escolha **Português** em Ajustes → Geral. Coloque seu usuário do **Chess.com** e um e-mail
de contato (só é enviado ao Chess.com). Opcional: um token do **Lichess** para ver partidas do seu nível
no explorador.

Tudo fica no seu computador. Em Ajustes → Seus dados você exporta os cartões de treino e faz backup.

---

*For developers: see [CLAUDE.md](CLAUDE.md) (how the code is organised, commands) and the
[spec](CHESS_COACH_SPEC.md). Licensed GPL-3.0-or-later (it bundles Stockfish, GPL-3.0).*
