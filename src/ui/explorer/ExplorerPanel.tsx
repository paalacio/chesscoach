// The opening explorer, in the inspector of the Explorer page: Lichess masters,
// Lichess games at the player's level, or the player's own games, with a
// win/draw/loss bar and a Stockfish evaluation for each move.

import { AlertTriangle, BookOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { ExplorerSource } from "../../backend";
import { compactCount, explorerRows } from "../../core/explorer";
import { formatScore } from "../../core/winprob";
import { hasKey, useT } from "../../i18n";
import { useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { overviewOf, replyKey, useExplorer } from "../../store/explorer";
import { CardFooter, errorText } from "../analysis/CoachPanel";
import { Concepts, RichText, Warnings } from "../components/coach";
import { Button, Segmented, Spinner } from "../components/controls";

const RATING_GROUPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200];
const SPEEDS = ["bullet", "blitz", "rapid", "classical"];

export function ExplorerPanel() {
  const t = useT();
  const fen = useAnalysis((s) => s.tree.nodes[s.current].fen);
  const playMove = useAnalysis((s) => s.playMove);
  const { source, mineColor, replies, loading, evals, tokenSaved, setSource, setMineColor, load } = useExplorer();
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const openSheet = useApp((s) => s.openSheet);

  // Load when the position, source or filters change (after a short pause while stepping through moves).
  useEffect(() => {
    const timer = setTimeout(() => load(fen), 200);
    return () => clearTimeout(timer);
  }, [fen, source, mineColor, load, settings?.explorerRatings, settings?.explorerSpeeds]);

  const key = replyKey(source, mineColor, fen);
  const reply = replies[key];
  const rows = useMemo(() => (reply?.result ? explorerRows(fen, reply.result) : []), [reply, fen]);
  const total = reply?.result ? reply.result.white + reply.result.draws + reply.result.black : 0;
  const moveEvals = evals[fen] ?? {};
  const errKey = reply?.errorKind ? `explorer.error.${reply.errorKind}` : null;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <section className="panel explorer-panel" aria-label={t("page.explorer")}>
      <div className="panel-header">
        <BookOpen className="coach-icon explorer-icon" aria-hidden />
        <span className="panel-title">{t("page.explorer")}</span>
        <span className="right small secondary tabular">
          {loading === key ? <Spinner small /> : total ? t("explorer.games", { count: total, n: compactCount(total, t.locale) }) : null}
        </span>
      </div>
      <Segmented<ExplorerSource>
        label={t("explorer.sourceLabel")}
        value={source}
        onChange={setSource}
        options={[
          { value: "masters", label: t("explorer.source.masters") },
          { value: "lichess", label: t("explorer.source.lichess") },
          { value: "mine", label: t("explorer.source.mine") },
        ]}
      />

      {source === "lichess" && settings && (
        <div className="explorer-filters">
          <div className="chips" role="group" aria-label={t("explorer.ratings")}>
            {RATING_GROUPS.map((r) => (
              <button
                key={r}
                type="button"
                className="chip"
                aria-pressed={settings.explorerRatings.includes(r)}
                onClick={() => saveSettings({ explorerRatings: toggle(settings.explorerRatings, r).sort((a, b) => a - b) })}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label={t("explorer.speeds")}>
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                className="chip"
                aria-pressed={settings.explorerSpeeds.includes(sp)}
                onClick={() => saveSettings({ explorerSpeeds: toggle(settings.explorerSpeeds, sp) })}
              >
                {t.maybe("timeClass.", sp, sp)}
              </button>
            ))}
          </div>
        </div>
      )}
      {source === "mine" && (
        <div className="explorer-filters">
          <Segmented<"white" | "black">
            label={t("explorer.mineColor")}
            value={mineColor}
            onChange={setMineColor}
            options={[
              { value: "white", label: t("explorer.asWhite") },
              { value: "black", label: t("explorer.asBlack") },
            ]}
          />
        </div>
      )}

      {reply?.errorKind && (
        <div className={`callout ${reply.result ? "warning" : "error"} explorer-callout`} role="status">
          <AlertTriangle aria-hidden />
          <span>
            {errKey && hasKey(errKey) ? t(errKey, { detail: reply.errorDetail ?? "" }) : (reply.errorDetail ?? reply.errorKind)}
            {reply.stale && ` ${t("explorer.showingOld")}`}{" "}
            {(reply.errorKind === "lichessNeedsToken" || reply.errorKind === "lichessBadToken") && (
              <button type="button" className="link-btn" onClick={() => openSheet("settings")}>
                {t("explorer.addToken")}
              </button>
            )}{" "}
            {!reply.result && (
              <button type="button" className="link-btn" onClick={() => setSource(tokenSaved === false && source === "lichess" ? "masters" : "mine")}>
                {source === "lichess" ? t("explorer.useMasters") : t("explorer.useMine")}
              </button>
            )}
          </span>
        </div>
      )}

      {reply?.result && rows.length === 0 && <p className="small secondary explorer-empty">{t("explorer.noGames")}</p>}

      {rows.length > 0 && (
        <div className="explorer-table" role="table" aria-label={t("page.explorer")}>
          <div className="explorer-row head" role="row">
            <span role="columnheader">{t("explorer.colMove")}</span>
            <span role="columnheader" className="num">
              {t("explorer.colGames")}
            </span>
            <span role="columnheader" title={t("explorer.colResultsTitle")}>
              {t("explorer.colResults")}
            </span>
            <span role="columnheader" className="num">
              {t("explorer.colEval")}
            </span>
          </div>
          {rows.map((r) => {
            const ev = moveEvals[r.uci];
            return (
              <button
                key={r.uci}
                type="button"
                className="explorer-row"
                role="row"
                title={r.opening ? `${r.opening.eco} ${r.opening.name}` : undefined}
                onClick={() => playMove(r.uci)}
              >
                <span role="cell" className="ex-move">
                  <b>{r.san}</b>
                  {r.opening && <span className="ex-opening">{r.opening.name}</span>}
                </span>
                <span role="cell" className="num tabular ex-games">
                  <span className="ex-share">{Math.round(r.share)}%</span>
                  <span className="secondary small">{compactCount(r.games, t.locale)}</span>
                </span>
                <span
                  role="cell"
                  className="wdl"
                  aria-label={t("explorer.wdlLabel", { w: Math.round(r.whitePct), d: Math.round(r.drawPct), b: Math.round(r.blackPct) })}
                >
                  <span className="w" style={{ width: `${r.whitePct}%` }}>
                    {r.whitePct >= 12 ? `${Math.round(r.whitePct)}` : ""}
                  </span>
                  <span className="d" style={{ width: `${r.drawPct}%` }}>
                    {r.drawPct >= 12 ? `${Math.round(r.drawPct)}` : ""}
                  </span>
                  <span className="b" style={{ width: `${r.blackPct}%` }}>
                    {r.blackPct >= 12 ? `${Math.round(r.blackPct)}` : ""}
                  </span>
                </span>
                <span role="cell" className="num tabular ex-eval">
                  {ev ? formatScore(ev.scoreWhite) : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <OpeningOverviewCard />
    </section>
  );
}

function OpeningOverviewCard() {
  const t = useT();
  const fen = useAnalysis((s) => s.tree.nodes[s.current].fen);
  const busy = useAnalysis((s) => !!s.job && s.job.status !== "error");
  const state = useExplorer((s) => overviewOf(s, fen));
  const explain = useExplorer((s) => s.explainOpening);
  const r = state.result?.data;
  const flagged = state.result?.flagged ?? [];
  return (
    <div className="opening-overview">
      {state.status === "idle" && (
        <>
          <Button onClick={() => explain()} disabled={busy}>
            {t("explorer.explainOpening")}
          </Button>
          <p className="coach-hint secondary">{t("explorer.explainHint")}</p>
        </>
      )}
      {state.status === "asking" && (
        <div className="coach-loading" aria-live="polite">
          <div className="coach-step">
            <Spinner small />
            {t("coach.asking")}
          </div>
          <div className="skeleton" style={{ width: "92%" }} />
          <div className="skeleton" style={{ width: "76%" }} />
        </div>
      )}
      {state.status === "error" && state.error && (
        <div className="callout error">
          <AlertTriangle aria-hidden />
          <span>
            {errorText(t, state.error)}{" "}
            <button type="button" className="link-btn" onClick={() => explain(true)}>
              {t("common.tryAgain")}
            </button>
          </span>
        </div>
      )}
      {state.status === "done" && r && (
        <article className="coach-card">
          <p className="coach-summary">
            <RichText text={r.summary} flagged={flagged} />
          </p>
          {r.pawnStructure && (
            <>
              <h4>{t("explorer.structure")}</h4>
              <p>
                <RichText text={r.pawnStructure} flagged={flagged} />
              </p>
            </>
          )}
          <h4>{t("explorer.plansWhite")}</h4>
          <ul className="coach-ideas">
            {r.plansWhite.map((p, i) => (
              <li key={i}>
                <RichText text={p} flagged={flagged} />
              </li>
            ))}
          </ul>
          <h4>{t("explorer.plansBlack")}</h4>
          <ul className="coach-ideas">
            {r.plansBlack.map((p, i) => (
              <li key={i}>
                <RichText text={p} flagged={flagged} />
              </li>
            ))}
          </ul>
          {r.traps.length > 0 && (
            <>
              <h4>{t("explorer.traps")}</h4>
              <ul className="coach-ideas">
                {r.traps.map((tr, i) => (
                  <li key={i}>
                    <b>{tr.name}</b> <RichText text={tr.description} flagged={flagged} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.commonMistakes.length > 0 && (
            <>
              <h4>{t("explorer.mistakes")}</h4>
              <ul className="coach-ideas">
                {r.commonMistakes.map((m, i) => (
                  <li key={i}>
                    <RichText text={m} flagged={flagged} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.middlegame && (
            <>
              <h4>{t("explorer.middlegame")}</h4>
              <p>
                <RichText text={r.middlegame} flagged={flagged} />
              </p>
            </>
          )}
          <Concepts tags={r.concepts} />
          <Warnings warnings={state.result?.warnings ?? []} flagged={flagged} />
          <CardFooter cached={state.cached} model={state.model} onRetry={() => explain(true)} disabled={busy} />
        </article>
      )}
    </div>
  );
}
