// Settings, Import and About sheets.

import { useEffect, useState } from "react";
import { backend, type Settings } from "../../backend";
import { treeFromText } from "../../core/game-tree";
import { useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { Button, Segmented, Sheet, Switch } from "../components/controls";

export function SettingsSheet() {
  const { sheet, openSheet, settings, saveSettings, info, runChecks } = useApp();
  const [draft, setDraft] = useState<Settings | null>(settings);
  useEffect(() => {
    if (sheet === "settings") setDraft(settings);
  }, [sheet, settings]);
  if (!draft) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });
  const close = () => openSheet(null);

  return (
    <Sheet
      open={sheet === "settings"}
      onClose={close}
      title="Settings"
      wide
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await saveSettings(draft);
              close();
              runChecks();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="sheet-section-title">Chess.com</div>
      <div className="field">
        <label htmlFor="s-user">Username</label>
        <input id="s-user" className="text-input" value={draft.chesscomUsername} onChange={(e) => set("chesscomUsername", e.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="s-mail">Contact email</label>
        <input id="s-mail" className="text-input" type="email" value={draft.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} spellCheck={false} />
        <p className="hint">Chess.com asks apps to include a contact in each request. It's stored only on this computer and sent only to Chess.com.</p>
      </div>

      <div className="sheet-section-title">Board</div>
      <div className="field">
        <label>Squares</label>
        <Segmented
          label="Board colors"
          value={draft.boardTheme as "brown" | "blue" | "green"}
          onChange={(v) => set("boardTheme", v)}
          options={[
            { value: "brown", label: "Brown" },
            { value: "blue", label: "Blue-gray" },
            { value: "green", label: "Green" },
          ]}
        />
      </div>
      <div className="field">
        <label>Pieces</label>
        <Segmented
          label="Piece set"
          value={draft.pieceSet as "cburnett" | "merida" | "chessnut"}
          onChange={(v) => set("pieceSet", v)}
          options={[
            { value: "cburnett", label: "Cburnett" },
            { value: "merida", label: "Merida" },
            { value: "chessnut", label: "Chessnut" },
          ]}
        />
      </div>
      <div className="field">
        <label>Coordinates</label>
        <Switch checked={draft.showCoordinates} onChange={(v) => set("showCoordinates", v)} label="Show coordinates" />
      </div>

      <div className="sheet-section-title">Engine</div>
      <div className="field">
        <label htmlFor="s-lines">Lines shown</label>
        <Segmented
          label="Number of engine lines"
          value={String(draft.multipv) as "1" | "2" | "3" | "4" | "5"}
          onChange={(v) => set("multipv", Number(v))}
          options={["1", "2", "3", "4", "5"].map((n) => ({ value: n as "1", label: n }))}
        />
      </div>
      <div className="field">
        <label htmlFor="s-threads">Threads</label>
        <input
          id="s-threads"
          className="text-input"
          style={{ width: 90 }}
          type="number"
          min={1}
          max={64}
          placeholder={String(info?.defaultThreads ?? "")}
          value={draft.engineThreads ?? ""}
          onChange={(e) => set("engineThreads", e.target.value ? Number(e.target.value) : null)}
        />
        <p className="hint">Empty = all CPU cores but one ({info?.defaultThreads}).</p>
      </div>
      <div className="field">
        <label htmlFor="s-hash">Hash (MB)</label>
        <input id="s-hash" className="text-input" style={{ width: 90 }} type="number" min={16} max={8192} value={draft.engineHashMb} onChange={(e) => set("engineHashMb", Number(e.target.value) || 256)} />
      </div>
      <div className="field">
        <label htmlFor="s-engine">Custom engine</label>
        <input id="s-engine" className="text-input" placeholder="Bundled Stockfish 19" value={draft.enginePath} onChange={(e) => set("enginePath", e.target.value)} spellCheck={false} />
        <p className="hint">Path to another UCI engine, e.g. /opt/homebrew/bin/stockfish. Leave empty for the bundled one.</p>
      </div>

      <div className="sheet-section-title">Claude</div>
      <div className="field">
        <label htmlFor="s-model">Model</label>
        <select id="s-model" className="select" style={{ width: 200 }} value={draft.claudeModel} onChange={(e) => set("claudeModel", e.target.value)}>
          <option value="sonnet">Sonnet (recommended)</option>
          <option value="haiku">Haiku (fastest, lightest on limits)</option>
          <option value="opus">Opus (most capable, uses more of your limits)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="s-claude">Claude Code path</label>
        <input id="s-claude" className="text-input" placeholder="Found automatically" value={draft.claudePath} onChange={(e) => set("claudePath", e.target.value)} spellCheck={false} />
      </div>
    </Sheet>
  );
}

export function ImportSheet() {
  const { sheet, openSheet, setPage } = useApp();
  const load = useAnalysis((s) => s.load);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    openSheet(null);
    setError(null);
  };
  function doImport() {
    try {
      load(treeFromText(text));
      setPage("analysis");
      setText("");
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet
      open={sheet === "import"}
      onClose={close}
      title="Import a game or position"
      description="Paste a PGN (with variations and comments) or a FEN."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={doImport} disabled={!text.trim()}>
            Import
          </Button>
        </>
      }
    >
      <textarea
        className="text-area"
        value={text}
        autoFocus
        spellCheck={false}
        placeholder={'[Event "Live Chess"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doImport();
        }}
        aria-label="PGN or FEN"
      />
      {error && <p className="error-text" role="alert">{error}</p>}
    </Sheet>
  );
}

export function AboutSheet() {
  const { sheet, openSheet, info } = useApp();
  const link = (url: string, label: string) => (
    <button type="button" className="link-btn" onClick={() => backend.openUrl(url)}>
      {label}
    </button>
  );
  return (
    <Sheet open={sheet === "about"} onClose={() => openSheet(null)} title="About ChessCoach" footer={<Button onClick={() => openSheet(null)}>Done</Button>}>
      <div className="about">
        <p>
          Version {info?.version}. Free software under the GNU General Public License, version 3 or later. You may share and
          change it under the terms of that license.
        </p>
        <h4>Includes</h4>
        <ul>
          <li>
            <b>Stockfish 19</b>, the chess engine, by the Stockfish developers. GPL-3.0. Source code:{" "}
            {link("https://github.com/official-stockfish/Stockfish", "github.com/official-stockfish/Stockfish")}
          </li>
          <li>
            <b>chessground</b> (board) and <b>chessops</b> (chess rules) by the lichess.org team. GPL-3.0.
          </li>
          <li>
            Piece sets: <b>cburnett</b> by Colin M.L. Burnett (GPLv2+), <b>merida</b> by Armando Hernandez Marroquin (GPLv2+),{" "}
            <b>chessnut</b> by Alexis Luengas (Apache-2.0), via {link("https://github.com/lichess-org/lila", "lichess")}.
          </li>
          <li>
            Opening names: {link("https://github.com/lichess-org/chess-openings", "lichess-org/chess-openings")} (CC0).
          </li>
          <li>Win-chance formula and game phases follow Lichess (scalachess, MIT).</li>
          <li>Explanations by Claude, through Claude Code on your own Claude plan.</li>
        </ul>
        {info && <p className="small secondary selectable">Data folder: {info.dataDir}</p>}
      </div>
    </Sheet>
  );
}
