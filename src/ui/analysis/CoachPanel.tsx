// Claude's explanations, in the inspector (never in a modal).

import { AlertTriangle, RotateCcw, Sparkles } from "lucide-react";
import { moveLabel, sanToUci } from "../../core/chess";
import { classifyMove, winFor } from "../../core/winprob";
import type { Judgement } from "../../core/types";
import { hasKey, useT } from "../../i18n";
import { EXPLAIN_DEPTH, explanationKey, useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { Concepts, judgementLabel, RichText, Warnings } from "../components/coach";
import { Button, Kbd, shortcut, Spinner } from "../components/controls";

/** Error text for the user: a translated message for known kinds, else the backend's message. */
export function errorText(t: ReturnType<typeof useT>, error: { kind: string; message: string }): string {
  const key = `error.${error.kind}`;
  return hasKey(key) ? t(key, { detail: error.message }) : error.message;
}

export function CoachPanel() {
  const t = useT();
  const { tree, current, explanations, job, callsToday, evalCache } = useAnalysis();
  const explain = useAnalysis((s) => s.explain);
  const cancel = useAnalysis((s) => s.cancelExplain);
  const goto = useAnalysis((s) => s.goto);
  const playMove = useAnalysis((s) => s.playMove);
  const setPage = useApp((s) => s.setPage);
  const node = tree.nodes[current];
  const parent = node.parent !== null ? tree.nodes[node.parent] : null;
  const moveExp = explanations[explanationKey("moveExplanation", current)];
  const planExp = explanations[explanationKey("positionPlan", current)];
  const busy = job && job.status !== "error" ? job : null;
  const jobHere = job?.nodeId === current ? job : null;
  const label = parent && node.san ? moveLabel(parent.fen, node.san) : null;

  // Judgement badge from the engine (not from Claude).
  let judgement: Judgement | null = null;
  if (parent) {
    const before = evalCache[parent.fen]?.[0];
    const after = evalCache[node.fen]?.[0];
    if (before && after) {
      const mover = parent.fen.split(" ")[1] === "w" ? "white" : "black";
      judgement = classifyMove(winFor(mover, before.winWhite), winFor(mover, after.winWhite));
    }
  }

  return (
    <section className="panel coach-panel" aria-label={t("coach.title")}>
      <div className="panel-header">
        <Sparkles className="coach-icon" aria-hidden />
        <span className="panel-title">{t("coach.title")}</span>
        <span className="right small secondary tabular" title={t("coach.callsTitle")}>
          {callsToday === null ? "–" : t("coach.callsToday", { count: callsToday })}
        </span>
      </div>

      <div className="coach-actions">
        {/* Once an answer is shown, its button disappears ("Ask again" is on the card). */}
        {label && !moveExp && (
          <Button variant="primary" onClick={() => explain("moveExplanation")} disabled={!!busy}>
            {t("coach.explainMove", { move: label })}
            <Kbd>{shortcut("E")}</Kbd>
          </Button>
        )}
        {!planExp && (
          <Button variant={!label || moveExp ? "primary" : undefined} onClick={() => explain("positionPlan")} disabled={!!busy}>
            {t("coach.planButton")}
            <Kbd>{label ? shortcut("E", { shift: true }) : shortcut("E")}</Kbd>
          </Button>
        )}
      </div>

      {jobHere && jobHere.status !== "error" && (
        <div className="coach-loading" aria-live="polite">
          <div className="coach-step">
            <Spinner small />
            {jobHere.status === "evaluating" ? t("coach.evaluating", { depth: EXPLAIN_DEPTH }) : t("coach.asking")}
            <button type="button" className="link-btn" onClick={cancel}>
              {t("common.cancel")}
            </button>
          </div>
          <div className="skeleton" style={{ width: "95%" }} />
          <div className="skeleton" style={{ width: "88%" }} />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      )}

      {jobHere?.status === "error" && jobHere.error && (
        <div className="callout error">
          <AlertTriangle aria-hidden />
          <span>
            {errorText(t, jobHere.error)}{" "}
            {["notLoggedIn", "notFound"].includes(jobHere.error.kind) && (
              <button type="button" className="link-btn" onClick={() => setPage("setup")}>
                {t("common.openSetup")}
              </button>
            )}{" "}
            <button type="button" className="link-btn" onClick={() => explain(jobHere.kind, true)}>
              {t("common.tryAgain")}
            </button>
          </span>
        </div>
      )}

      {moveExp?.kind === "moveExplanation" && (
        <article className="coach-card">
          <header>
            <h3>{moveExp.label}</h3>
            {judgement && <span className={`badge judgement ${judgement}`}>{judgementLabel(t, judgement)}</span>}
          </header>
          <p className="coach-summary">
            <RichText text={moveExp.result.data.summary} flagged={moveExp.result.flagged} />
          </p>
          {moveExp.result.data.ideas.length > 0 && (
            <ul className="coach-ideas">
              {moveExp.result.data.ideas.map((idea, i) => (
                <li key={i}>
                  <RichText text={idea} flagged={moveExp.result.flagged} />
                </li>
              ))}
            </ul>
          )}
          {moveExp.result.data.better_move && parent && (
            <div className="better-move">
              <button
                type="button"
                className="badge accent"
                title={t("coach.playAsVariation")}
                onClick={() => {
                  const san = moveExp.result.data.better_move?.san;
                  goto(parent.id); // zustand updates synchronously, so the move is played from here
                  if (san) playSan(parent.fen, san, playMove);
                }}
              >
                {t("coach.better", { move: moveExp.result.data.better_move.san })}
              </button>
              <span>
                <RichText text={moveExp.result.data.better_move.why} flagged={moveExp.result.flagged} />
              </span>
            </div>
          )}
          <h4>{t("coach.nextMoves")}</h4>
          <p>
            <RichText text={moveExp.result.data.plan_next} flagged={moveExp.result.flagged} />
          </p>
          <Concepts tags={moveExp.result.data.concepts} />
          <Warnings warnings={moveExp.result.warnings} flagged={moveExp.result.flagged} />
          <CardFooter cached={moveExp.cached} model={moveExp.model} onRetry={() => explain("moveExplanation", true)} disabled={!!busy} />
        </article>
      )}

      {planExp?.kind === "positionPlan" && (
        <article className="coach-card">
          <header>
            <h3>{node.fen.split(" ")[1] === "w" ? t("coach.planForWhite") : t("coach.planForBlack")}</h3>
          </header>
          <p className="coach-summary">
            <RichText text={planExp.result.data.summary} flagged={planExp.result.flagged} />
          </p>
          {planExp.result.data.phase_focus && (
            <p className="phase-focus">
              <RichText text={planExp.result.data.phase_focus} flagged={planExp.result.flagged} />
            </p>
          )}
          <ol className="coach-plan">
            {planExp.result.data.plan.map((step, i) => (
              <li key={i}>
                <RichText text={step} flagged={planExp.result.flagged} />
              </li>
            ))}
          </ol>
          {planExp.result.data.candidate_moves.length > 0 && (
            <>
              <h4>{t("coach.candidates")}</h4>
              <ul className="candidates">
                {planExp.result.data.candidate_moves.map((c) => (
                  <li key={c.san}>
                    <button type="button" className="badge accent" title={t("coach.playMove")} onClick={() => playSan(node.fen, c.san, playMove)}>
                      {c.san}
                    </button>
                    <span>
                      <RichText text={c.idea} flagged={planExp.result.flagged} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {planExp.result.data.opponent_ideas.length > 0 && (
            <>
              <h4>{t("coach.opponentWants")}</h4>
              <ul className="coach-ideas">
                {planExp.result.data.opponent_ideas.map((idea, i) => (
                  <li key={i}>
                    <RichText text={idea} flagged={planExp.result.flagged} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <Concepts tags={planExp.result.data.concepts} />
          <Warnings warnings={planExp.result.warnings} flagged={planExp.result.flagged} />
          <CardFooter cached={planExp.cached} model={planExp.model} onRetry={() => explain("positionPlan", true)} disabled={!!busy} />
        </article>
      )}

      {!moveExp && !planExp && !jobHere && <p className="coach-hint secondary">{t("coach.hint")}</p>}
    </section>
  );
}

export function CardFooter({ cached, model, onRetry, disabled }: { cached: boolean; model: string; onRetry: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <footer className="coach-footer small secondary">
      <span>
        {cached ? t("coach.savedAnswer") : t("coach.newAnswer")} · Claude {model}
      </span>
      <button type="button" className="link-btn" onClick={onRetry} disabled={disabled} title={t("coach.askAgainTitle")}>
        <RotateCcw size={11} /> {t("coach.askAgain")}
      </button>
    </footer>
  );
}

/** Plays a SAN move on the board (via its UCI form). */
function playSan(fen: string, san: string, play: (uci: string) => boolean) {
  const uci = sanToUci(fen, san);
  if (uci) play(uci);
}
