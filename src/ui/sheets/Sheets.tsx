// Settings, Import and About sheets.

import { useEffect, useState } from "react";
import { backend, type Settings, toBackendError } from "../../backend";
import { treeFromText } from "../../core/game-tree";
import { LANGUAGES, type Lang, langOf, useT } from "../../i18n";
import { useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { useExplorer } from "../../store/explorer";
import { backupDatabase, exportTraining, importTraining, restoreDatabase } from "../../store/data";
import { Button, Segmented, Sheet, Switch } from "../components/controls";

export function SettingsSheet() {
  const t = useT();
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
      title={t("settings.title")}
      wide
      footer={
        <>
          <Button onClick={close}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await saveSettings(draft);
              close();
              runChecks();
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="sheet-section-title">{t("settings.general")}</div>
      <div className="field">
        <label>{t("settings.language")}</label>
        <Segmented<Lang> label={t("settings.language")} value={langOf(draft.language)} onChange={(v) => set("language", v)} options={LANGUAGES} />
        <p className="hint">{t("settings.languageHint")}</p>
      </div>

      <div className="sheet-section-title">Chess.com</div>
      <div className="field">
        <label htmlFor="s-user">{t("settings.username")}</label>
        <input id="s-user" className="text-input" value={draft.chesscomUsername} onChange={(e) => set("chesscomUsername", e.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="s-mail">{t("settings.contact")}</label>
        <input id="s-mail" className="text-input" type="email" value={draft.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} spellCheck={false} />
        <p className="hint">{t("settings.contactHint")}</p>
      </div>

      <LichessTokenField />

      <div className="sheet-section-title">{t("settings.board")}</div>
      <div className="field">
        <label>{t("settings.squares")}</label>
        <Segmented
          label={t("settings.squares")}
          value={draft.boardTheme as "brown" | "blue" | "green"}
          onChange={(v) => set("boardTheme", v)}
          options={[
            { value: "brown", label: t("settings.theme.brown") },
            { value: "blue", label: t("settings.theme.blue") },
            { value: "green", label: t("settings.theme.green") },
          ]}
        />
      </div>
      <div className="field">
        <label>{t("settings.pieces")}</label>
        <Segmented
          label={t("settings.pieces")}
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
        <label>{t("settings.coordinates")}</label>
        <Switch checked={draft.showCoordinates} onChange={(v) => set("showCoordinates", v)} label={t("settings.coordinates")} />
      </div>

      <div className="sheet-section-title">{t("settings.engine")}</div>
      <div className="field">
        <label>{t("settings.lines")}</label>
        <Segmented
          label={t("settings.lines")}
          value={String(draft.multipv) as "1" | "2" | "3" | "4" | "5"}
          onChange={(v) => set("multipv", Number(v))}
          options={["1", "2", "3", "4", "5"].map((n) => ({ value: n as "1", label: n }))}
        />
      </div>
      <div className="field">
        <label htmlFor="s-threads">{t("settings.threads")}</label>
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
        <p className="hint">{t("settings.threadsHint", { n: info?.defaultThreads ?? "" })}</p>
      </div>
      <div className="field">
        <label htmlFor="s-hash">{t("settings.hash")}</label>
        <input id="s-hash" className="text-input" style={{ width: 90 }} type="number" min={16} max={8192} value={draft.engineHashMb} onChange={(e) => set("engineHashMb", Number(e.target.value) || 256)} />
      </div>
      <div className="field">
        <label htmlFor="s-engine">{t("settings.customEngine")}</label>
        <input id="s-engine" className="text-input" placeholder={t("settings.bundledEngine")} value={draft.enginePath} onChange={(e) => set("enginePath", e.target.value)} spellCheck={false} />
        <p className="hint">{t("settings.customEngineHint")}</p>
      </div>

      <div className="sheet-section-title">{t("settings.review")}</div>
      <div className="field">
        <label>{t("settings.autoAnalyze")}</label>
        <Switch checked={draft.autoAnalyze} onChange={(v) => set("autoAnalyze", v)} label={t("settings.autoAnalyze")} />
      </div>
      <div className="field">
        <label htmlFor="s-depth">{t("settings.reviewDepth")}</label>
        <input id="s-depth" className="text-input" style={{ width: 90 }} type="number" min={8} max={30} value={draft.reviewDepth} onChange={(e) => set("reviewDepth", Number(e.target.value) || 16)} />
      </div>
      <div className="field">
        <label htmlFor="s-ms">{t("settings.reviewTime")}</label>
        <input id="s-ms" className="text-input" style={{ width: 90 }} type="number" min={100} max={10000} step={100} value={draft.reviewMovetimeMs} onChange={(e) => set("reviewMovetimeMs", Number(e.target.value) || 1500)} />
        <p className="hint">{t("settings.reviewHint")}</p>
      </div>

      <div className="sheet-section-title">{t("settings.repertoire")}</div>
      <div className="field">
        <label htmlFor="s-share">{t("settings.repMinShare")}</label>
        <input id="s-share" className="text-input" style={{ width: 90 }} type="number" min={1} max={50} step={0.5} value={draft.repMinShare} onChange={(e) => set("repMinShare", Number(e.target.value) || 5)} />
        <p className="hint">{t("settings.repMinShareHint")}</p>
      </div>
      <div className="field">
        <label htmlFor="s-reach">{t("settings.repMinReach")}</label>
        <input id="s-reach" className="text-input" style={{ width: 90 }} type="number" min={0.1} max={20} step={0.1} value={draft.repMinReach} onChange={(e) => set("repMinReach", Number(e.target.value) || 1)} />
        <p className="hint">{t("settings.repMinReachHint")}</p>
      </div>
      <div className="field">
        <label htmlFor="s-depth-rep">{t("settings.repDepth")}</label>
        <input id="s-depth-rep" className="text-input" style={{ width: 90 }} type="number" min={4} max={20} value={draft.repDepth} onChange={(e) => set("repDepth", Number(e.target.value) || 12)} />
      </div>

      <div className="sheet-section-title">{t("settings.training")}</div>
      <div className="field">
        <label htmlFor="s-new">{t("settings.newPerDay")}</label>
        <input id="s-new" className="text-input" style={{ width: 90 }} type="number" min={1} max={100} value={draft.newCardsPerDay} onChange={(e) => set("newCardsPerDay", Number(e.target.value) || 10)} />
      </div>
      <div className="field">
        <label htmlFor="s-goal">{t("settings.dailyGoal")}</label>
        <input id="s-goal" className="text-input" style={{ width: 90 }} type="number" min={1} max={500} value={draft.dailyGoal} onChange={(e) => set("dailyGoal", Number(e.target.value) || 20)} />
      </div>

      <DataSection />

      <div className="sheet-section-title">Claude</div>
      <div className="field">
        <label htmlFor="s-model">{t("settings.model")}</label>
        <select id="s-model" className="select" style={{ width: 260 }} value={draft.claudeModel} onChange={(e) => set("claudeModel", e.target.value)}>
          <option value="sonnet">{t("settings.model.sonnet")}</option>
          <option value="haiku">{t("settings.model.haiku")}</option>
          <option value="opus">{t("settings.model.opus")}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="s-claude">{t("settings.claudePath")}</label>
        <input id="s-claude" className="text-input" placeholder={t("settings.claudePathAuto")} value={draft.claudePath} onChange={(e) => set("claudePath", e.target.value)} spellCheck={false} />
      </div>
    </Sheet>
  );
}

/** Exports, imports and backups. These act at once (not with the Save button). */
function DataSection() {
  const t = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <>
      <div className="sheet-section-title">{t("settings.data")}</div>
      <div className="field">
        <label>{t("settings.trainingData")}</label>
        <div className="token-row">
          <Button size="small" onClick={exportTraining}>
            {t("settings.exportTraining")}
          </Button>
          <Button size="small" onClick={importTraining}>
            {t("settings.importTraining")}
          </Button>
        </div>
        <p className="hint">{t("settings.trainingDataHint")}</p>
      </div>
      <div className="field">
        <label>{t("settings.backup")}</label>
        <div className="token-row">
          <Button size="small" onClick={backupDatabase}>
            {t("settings.backupNow")}
          </Button>
          <Button size="small" className={armed ? "danger" : ""} onClick={() => (armed ? (setArmed(false), void restoreDatabase()) : setArmed(true))}>
            {armed ? t("settings.restoreConfirm") : t("settings.restore")}
          </Button>
        </div>
        <p className="hint">{t("settings.backupHint")}</p>
      </div>
    </>
  );
}

/** The Lichess token is saved straight to the keychain (not with the other settings). */
function LichessTokenField() {
  const t = useT();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = useExplorer((s) => s.refreshToken);
  useEffect(() => {
    backend.lichessTokenStatus().then(setSaved).catch(() => setSaved(false));
  }, []);
  async function save() {
    try {
      await backend.lichessTokenSave(value);
      setSaved(true);
      setValue("");
      setMessage({ ok: true, text: t("settings.lichessSaved") });
      refresh();
    } catch (e) {
      const err = toBackendError(e);
      setMessage({ ok: false, text: err.kind === "invalidToken" ? t("settings.lichessInvalid") : err.message });
    }
  }
  async function clear() {
    await backend.lichessTokenClear().catch(() => {});
    setSaved(false);
    setMessage(null);
    refresh();
  }
  return (
    <>
      <div className="sheet-section-title">Lichess</div>
      <div className="field">
        <label htmlFor="s-lichess">{t("settings.lichessToken")}</label>
        <div className="token-row">
          {saved ? (
            <>
              <span className="token-saved">{t("settings.lichessHasToken")}</span>
              <Button size="small" onClick={clear}>
                {t("settings.lichessRemove")}
              </Button>
            </>
          ) : (
            <>
              <input
                id="s-lichess"
                className="text-input"
                type="password"
                autoComplete="off"
                placeholder="lip_…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
              />
              <Button size="small" onClick={save} disabled={!value.trim()}>
                {t("settings.lichessSave")}
              </Button>
            </>
          )}
        </div>
        <p className="hint">
          {t("settings.lichessHint")}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => backend.openUrl("https://lichess.org/account/oauth/token/create?description=Tung%20Tung%20Chessahur")}
          >
            {t("settings.lichessCreate")}
          </button>
        </p>
        {message && <p className={`hint ${message.ok ? "ok-text" : "error-text"}`}>{message.text}</p>}
      </div>
    </>
  );
}

export function ImportSheet() {
  const t = useT();
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
      title={t("import.title")}
      description={t("import.description")}
      footer={
        <>
          <Button onClick={close}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={doImport} disabled={!text.trim()}>
            {t("import.button")}
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
        aria-label={t("import.label")}
      />
      {error && <p className="error-text" role="alert">{error}</p>}
    </Sheet>
  );
}

export function AboutSheet() {
  const t = useT();
  const { sheet, openSheet, info } = useApp();
  const link = (url: string, label: string) => (
    <button type="button" className="link-btn" onClick={() => backend.openUrl(url)}>
      {label}
    </button>
  );
  return (
    <Sheet open={sheet === "about"} onClose={() => openSheet(null)} title={t("about.title")} footer={<Button onClick={() => openSheet(null)}>{t("common.done")}</Button>}>
      <div className="about">
        <p>{t("about.license", { version: info?.version ?? "" })}</p>
        <h4>{t("about.includes")}</h4>
        <ul>
          <li>
            <b>Stockfish 19</b> — {t("about.stockfish")} {link("https://github.com/official-stockfish/Stockfish", "github.com/official-stockfish/Stockfish")}
          </li>
          <li>
            <b>chessground</b>, <b>chessops</b> — {t("about.lichessLibs")}
          </li>
          <li>
            {t("about.pieces")} <b>cburnett</b> (Colin M.L. Burnett, GPLv2+), <b>merida</b> (Armando Hernandez Marroquin, GPLv2+),{" "}
            <b>chessnut</b> (Alexis Luengas, Apache-2.0) — {link("https://github.com/lichess-org/lila", "lichess")}
          </li>
          <li>
            {t("about.openings")} {link("https://github.com/lichess-org/chess-openings", "lichess-org/chess-openings")} (CC0)
          </li>
          <li>{t("about.formulas")}</li>
          <li>{t("about.claude")}</li>
        </ul>
        {info && <p className="small secondary selectable">{t("about.dataFolder", { path: info.dataDir })}</p>}
      </div>
    </Sheet>
  );
}
