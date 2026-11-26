// Claude's explanations, in the inspector (never in a modal).

import { AlertTriangle, RotateCcw, Sparkles } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { moveLabel, sanToUci } from "../../core/chess";
import { normalizeSan } from "../../core/context-packet";
import { classifyMove, winFor } from "../../core/winprob";
import { sanTokensIn } from "../../core/validate";
import { EXPLAIN_DEPTH, explanationKey, useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { Button, Kbd, shortcut, Spinner } from "../components/controls";

/** Renders text, marking moves Claude mentioned that couldn't be verified. */
function RichText({ text, flagged }: { text: string; flagged: string[] }): ReactNode {
  if (flagged.length === 0) return text;
  const tokens = new Set(sanTokensIn(text).filter((t) => flagged.includes(t)));
  if (tokens.size === 0) return text;
  const pattern = new RegExp(`(${[...tokens].map((t) => t.replace(/[+=]/g, "\\$&")).join("|")})`, "g");
  return text.split(pattern).map((part, i) =>
    tokens.has(normalizeSan(part)) ? (
      <span key={i} className="unverified" title="This move isn't in the engine lines or the legal moves">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const JUDGEMENT_LABEL = { inaccuracy: "Inaccuracy", mistake: "Mistake", blunder: "Blunder" } as const;

function Concepts({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="concepts">
      {tags.map((t) => (
        <span className="badge" key={t}>
          {t.replace(/-/g, " ")}
        </span>
      ))}
    </div>
  );
}

function Warnings({ warnings, flagged }: { warnings: string[]; flagged: string[] }) {
  if (warnings.length === 0 && flagged.length === 0) return null;
  return (
    <div className="callout warning coach-warning">
      <AlertTriangle aria-hidden />
      <span>
        {warnings.join(" ")}
        {flagged.length > 0 && ` Moves marked like this weren't verified: ${flagged.join(", ")}.`}
      </span>
    </div>
  );
}

export function CoachPanel() {
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
  let judgement: keyof typeof JUDGEMENT_LABEL | null = null;
  if (parent) {
    const before = evalCache[parent.fen]?.[0];
    const after = evalCache[node.fen]?.[0];
    if (before && after) {
      const mover = parent.fen.split(" ")[1] === "w" ? "white" : "black";
      judgement = classifyMove(winFor(mover, before.winWhite), winFor(mover, after.winWhite));
    }
  }

  return (
    <section className="panel coach-panel" aria-label="Coach">
      <div className="panel-header">
        <Sparkles className="coach-icon" aria-hidden />
        <span className="panel-title">Coach</span>
        <span className="right small secondary tabular" title="Real Claude requests today (cached answers don't count)">
          {callsToday ?? "–"} Claude call{callsToday === 1 ? "" : "s"} today
        </span>
      </div>

      <div className="coach-actions">
        {/* Once an answer is shown, its button disappears ("Ask again" is on the card). */}
        {label && !moveExp && (
          <Button variant="primary" onClick={() => explain("moveExplanation")} disabled={!!busy}>
            Explain {label}
            <Kbd>{shortcut("E")}</Kbd>
          </Button>
        )}
        {!planExp && (
          <Button variant={!label || moveExp ? "primary" : undefined} onClick={() => explain("positionPlan")} disabled={!!busy}>
            Plan for this position
            <Kbd>{label ? shortcut("E", { shift: true }) : shortcut("E")}</Kbd>
          </Button>
        )}
      </div>

      {jobHere && jobHere.status !== "error" && (
        <div className="coach-loading" aria-live="polite">
          <div className="coach-step">
            <Spinner small />
            {jobHere.status === "evaluating" ? `Checking with Stockfish (depth ${EXPLAIN_DEPTH})…` : "Asking Claude…"}
            <button type="button" className="link-btn" onClick={cancel}>
              Cancel
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
            {jobHere.error.message}{" "}
            {["notLoggedIn", "notFound"].includes(jobHere.error.kind) && (
              <button type="button" className="link-btn" onClick={() => setPage("setup")}>
                Open setup
              </button>
            )}{" "}
            <button type="button" className="link-btn" onClick={() => explain(jobHere.kind, true)}>
              Try again
            </button>
          </span>
        </div>
      )}

      {moveExp?.kind === "moveExplanation" && (
        <article className="coach-card">
          <header>
            <h3>{moveExp.label}</h3>
            {judgement && <span className={`badge judgement ${judgement}`}>{JUDGEMENT_LABEL[judgement]}</span>}
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
                title="Play this move as a variation"
                onClick={() => {
                  const san = moveExp.result.data.better_move?.san;
                  goto(parent.id); // zustand updates synchronously, so the move is played from here
                  if (san) playSan(parent.fen, san, playMove);
                }}
              >
                Better: {moveExp.result.data.better_move.san}
              </button>
              <span>
                <RichText text={moveExp.result.data.better_move.why} flagged={moveExp.result.flagged} />
              </span>
            </div>
          )}
          <h4>Next few moves</h4>
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
            <h3>Plan for {node.fen.split(" ")[1] === "w" ? "White" : "Black"}</h3>
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
              <h4>Candidate moves</h4>
              <ul className="candidates">
                {planExp.result.data.candidate_moves.map((c) => (
                  <li key={c.san}>
                    <button type="button" className="badge accent" title="Play this move" onClick={() => playSan(node.fen, c.san, playMove)}>
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
              <h4>What your opponent wants</h4>
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

      {!moveExp && !planExp && !jobHere && (
        <p className="coach-hint secondary">
          Stockfish finds the moves; Claude explains them in plain words. Each new explanation uses one request from your Claude
          plan, and answers are saved so asking again is free.
        </p>
      )}
    </section>
  );
}

function CardFooter({ cached, model, onRetry, disabled }: { cached: boolean; model: string; onRetry: () => void; disabled: boolean }) {
  return (
    <footer className="coach-footer small secondary">
      <span>
        {cached ? "Saved answer" : "New answer"} · Claude {model}
      </span>
      <button type="button" className="link-btn" onClick={onRetry} disabled={disabled} title="Ask Claude again (uses a request)">
        <RotateCcw size={11} /> Ask again
      </button>
    </footer>
  );
}

/** Plays a SAN move on the board (via its UCI form). */
function playSan(fen: string, san: string, play: (uci: string) => boolean) {
  const uci = sanToUci(fen, san);
  if (uci) play(uci);
}
