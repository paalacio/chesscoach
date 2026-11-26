// Review of one imported game: board + win-chance graph on the left; players,
// accuracy per phase, key moments, Claude's review and the moves on the right.

import { AlertTriangle, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useRef } from "react";
import { moveLabel, positionFromFen, turnOf } from "../../core/chess";
import type { GameReview, MoveReview } from "../../core/review";
import { judgementGlyph } from "../../core/review";
import type { Color, Phase } from "../../core/types";
import { formatScore } from "../../core/winprob";
import { useT } from "../../i18n";
import { terminationText } from "../../i18n/termination";
import { useApp } from "../../store/app";
import { useGames } from "../../store/games";
import { EVAL_BAR_SPACE, useBoardSize } from "../analysis/AnalysisPage";
import { CardFooter, errorText } from "../analysis/CoachPanel";
import { Board } from "../board/Board";
import { EvalBar } from "../board/BoardExtras";
import { conceptLabel, judgementLabel, phaseLabel, RichText, Warnings } from "../components/coach";
import { Button, IconButton, Spinner } from "../components/controls";
import { useAccentColor, useReducedMotion } from "../hooks";
import { EvalGraph } from "./EvalGraph";
import { opponentOf } from "./GamesPage";

const NO_DESTS = new Map<string, string[]>();

export function ReviewPage() {
  const t = useT();
  const { open, openError, worker, goto, step } = useGames();
  const settings = useApp((s) => s.settings);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useBoardSize(stageRef);
  const accent = useAccentColor();
  const reduceMotion = useReducedMotion();

  if (openError) {
    return (
      <div className="page-scroll" style={{ display: "flex" }}>
        <div className="empty-state">
          <AlertTriangle />
          <p>{openError}</p>
        </div>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="page-scroll" style={{ display: "flex" }}>
        <div className="empty-state">
          <Spinner />
        </div>
      </div>
    );
  }

  const { moves, review, ply, orientation, detail } = open;
  const fen = ply === 0 ? open.startFen : moves[ply - 1].fenAfter;
  const lastUci = ply > 0 ? moves[ply - 1].uci : null;
  const pos = positionFromFen(fen);
  const winWhite = review ? review.winCurve[ply] : null;
  const evalScore = review && detail.analysis ? detail.analysis.evals[ply]?.score : null;
  const current = ply > 0 ? review?.moves[ply - 1] : undefined;
  const bestArrow =
    review && ply < moves.length && detail.analysis?.evals[ply]?.best
      ? [{ orig: detail.analysis.evals[ply].best!.slice(0, 2), dest: detail.analysis.evals[ply].best!.slice(2, 4), brush: "engine" }]
      : [];
  const analysing = worker?.currentGame === detail.id;

  return (
    <div className="analysis review">
      <div className="board-column">
        <div className="board-stage" ref={stageRef}>
          <div className="board-and-bar" style={{ height: size }}>
            <EvalBar winWhite={winWhite} label={evalScore ? formatScore(evalScore) : t("board.noEval")} orientation={orientation} height={size} />
            <div
              className={`board-wrap board-theme-${settings?.boardTheme ?? "brown"} pieces-${settings?.pieceSet ?? "cburnett"}`}
              style={{ width: size, height: size }}
              data-testid="board"
            >
              <Board
                fen={fen}
                orientation={orientation}
                turn={turnOf(fen)}
                lastMove={lastUci ? [lastUci.slice(0, 2), lastUci.slice(2, 4)] : undefined}
                check={pos.isCheck()}
                dests={NO_DESTS}
                onMove={() => {}}
                autoShapes={bestArrow as never}
                coordinates={settings?.showCoordinates ?? true}
                size={size}
                accent={accent}
                reduceMotion={reduceMotion}
              />
            </div>
          </div>
        </div>
        <div style={{ width: size + EVAL_BAR_SPACE }}>
          {review ? (
            <EvalGraph review={review} ply={ply} onSelect={goto} />
          ) : (
            <div className="eval-graph pending">
              <Spinner small />
              {analysing ? t("review.analysingProgress", { ply: worker?.ply ?? 0, plies: worker?.plies ?? 0 }) : t("review.queued")}
            </div>
          )}
        </div>
        <div className="board-caption" style={{ width: size + EVAL_BAR_SPACE }}>
          {current && (
            <>
              <span className={`badge phase-${current.phase}`}>{phaseLabel(t, current.phase)}</span>
              <span className="opening-name">
                <b>{moveLabel(current.fenBefore, current.san)}</b>
                <span className={`glyph ${current.judgement ?? ""}`}>{judgementGlyph(current.judgement)}</span>
                {current.judgement && <span className="secondary"> {judgementLabel(t, current.judgement)}</span>}
                {current.judgement && current.bestSan && (
                  <span className="secondary"> · {t("review.bestWas", { move: current.bestSan })}</span>
                )}
              </span>
            </>
          )}
          {!current && <span className="opening-name secondary">{t("opening.start")}</span>}
          <span className="nav-buttons">
            <IconButton label={t("nav.first")} onClick={() => goto(0)} disabled={ply === 0}>
              <ChevronFirst />
            </IconButton>
            <IconButton label={t("nav.prev")} onClick={() => step(-1)} disabled={ply === 0}>
              <ChevronLeft />
            </IconButton>
            <IconButton label={t("nav.next")} onClick={() => step(1)} disabled={ply === moves.length}>
              <ChevronRight />
            </IconButton>
            <IconButton label={t("nav.last")} onClick={() => goto(moves.length)} disabled={ply === moves.length}>
              <ChevronLast />
            </IconButton>
          </span>
        </div>
      </div>

      <aside className="inspector" data-open={inspectorOpen} aria-label={t("inspector.title")} aria-hidden={!inspectorOpen}>
        <div className="inspector-scroll">
          <GameHeader />
          {review ? (
            <>
              <AccuracyPanel review={review} myColor={detail.myColor} />
              <KeyMoments review={review} />
              <ClaudeReview />
              <ReviewMoves review={review} ply={ply} onSelect={goto} />
            </>
          ) : (
            <section className="panel">
              <p className="secondary small">{t("review.waitingForAnalysis")}</p>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function GameHeader() {
  const t = useT();
  const open = useGames((s) => s.open);
  if (!open) return null;
  const d = open.detail;
  const opp = opponentOf(d);
  const date = d.endTime ? new Intl.DateTimeFormat(t.locale, { dateStyle: "medium" }).format(new Date(d.endTime * 1000)) : "";
  const opening = open.review?.opening;
  return (
    <section className="panel game-header">
      <div className="players">
        <span className={`color-dot ${d.myColor}`} />
        <b>{t("review.you")}</b>
        <span className="secondary">{t("review.versus")}</span>
        <span className={`color-dot ${d.myColor === "white" ? "black" : "white"}`} />
        <b>{opp.name}</b>
        {opp.elo && <span className="secondary tabular">({opp.elo})</span>}
        <span className={`badge result ${d.myResult}`} style={{ marginLeft: "auto" }}>
          {t(`result.${d.myResult}`)}
        </span>
      </div>
      <p className="small secondary">
        {[date, d.timeClass ? t.maybe("timeClass.", d.timeClass, d.timeClass) : null, terminationText(t, d.termination)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {opening && (
        <p className="small">
          <span className="eco">{opening.eco}</span> {opening.name}
        </p>
      )}
      {open.review?.leftBook && <LeftBook review={open.review} />}
    </section>
  );
}

function LeftBook({ review }: { review: GameReview }) {
  const t = useT();
  const goto = useGames((s) => s.goto);
  const lb = review.leftBook!;
  const m = review.moves[lb.index];
  return (
    <p className="small secondary left-book">
      {lb.byMe ? t("review.leftBookYou") : t("review.leftBookOpponent")}{" "}
      <button type="button" className="link-btn" onClick={() => goto(lb.index + 1)}>
        {moveLabel(m.fenBefore, m.san)}
      </button>{" "}
      <span className="faint">{t("review.repertoireLater")}</span>
    </p>
  );
}

function AccuracyPanel({ review, myColor }: { review: GameReview; myColor: Color }) {
  const t = useT();
  const opp: Color = myColor === "white" ? "black" : "white";
  const phases: (Phase | "overall")[] = ["opening", "middlegame", "endgame", "overall"];
  const cell = (c: Color, p: Phase | "overall") => {
    const v = review.accuracy[c][p];
    return v === null ? "–" : `${Math.round(v)}`;
  };
  const counts = (c: Color) => review.counts[c];
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">{t("review.accuracy")}</span>
        <span className="right small secondary" title={t("review.accuracyTitle")}>
          Lichess
        </span>
      </div>
      <table className="accuracy-table tabular">
        <thead>
          <tr>
            <th />
            {phases.map((p) => (
              <th key={p}>{p === "overall" ? t("review.overall") : phaseLabel(t, p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[myColor, opp].map((c) => (
            <tr key={c}>
              <th>{c === myColor ? t("review.you") : t("review.opponent")}</th>
              {phases.map((p) => (
                <td key={p} className={p === "overall" ? "overall" : ""}>
                  {cell(c, p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mistake-counts small" title={t("review.mistakeColumnsTitle")}>
        {[myColor, opp].map((c) => (
          <span key={c}>
            <b>{c === myColor ? t("review.you") : t("review.opponent")}</b>
            <span className="glyph inaccuracy">{counts(c).inaccuracy}?!</span>
            <span className="glyph mistake">{counts(c).mistake}?</span>
            <span className="glyph blunder">{counts(c).blunder}??</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function KeyMoments({ review }: { review: GameReview }) {
  const t = useT();
  const { open, goto, claude } = useGames();
  if (!open) return null;
  const comments = new Map(claude.result?.data.keyMoments.map((k) => [k.index, k]) ?? []);
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">{t("review.keyMoments")}</span>
      </div>
      {review.keyMoments.length === 0 && <p className="small secondary">{t("review.noKeyMoments")}</p>}
      <ol className="key-moments">
        {review.keyMoments.map((idx) => {
          const m = review.moves[idx];
          const mine = m.color === open.detail.myColor;
          const comment = comments.get(idx);
          return (
            <li key={idx} className={open.ply === idx + 1 ? "active" : ""}>
              <button type="button" className="moment" onClick={() => goto(idx + 1)}>
                <span className="moment-move">
                  {moveLabel(m.fenBefore, m.san)}
                  <span className={`glyph ${m.judgement ?? ""}`}>{judgementGlyph(m.judgement)}</span>
                </span>
                <span className="secondary small">{mine ? t("review.byYou") : t("review.byOpponent")}</span>
                <span className="moment-drop tabular small">
                  {Math.round(m.moverBefore)}% → {Math.round(m.moverAfter)}%
                </span>
              </button>
              {m.bestSan && (
                <p className="small secondary">{t("review.engineWanted", { move: moveLabel(m.fenBefore, m.bestSan) })}</p>
              )}
              {comment && (
                <p className="moment-comment">
                  <RichText text={comment.comment} flagged={claude.result?.flagged ?? []} />
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ClaudeReview() {
  const t = useT();
  const { claude, askClaude, cancelClaude } = useGames();
  const setPage = useApp((s) => s.setPage);
  const r = claude.result?.data;
  return (
    <section className="panel coach-panel">
      <div className="panel-header">
        <Sparkles className="coach-icon" aria-hidden />
        <span className="panel-title">{t("coach.title")}</span>
      </div>
      {claude.status === "idle" && (
        <>
          <Button variant="primary" onClick={() => askClaude()}>
            {t("review.askClaude")}
          </Button>
          <p className="coach-hint secondary" style={{ marginTop: 8 }}>
            {t("review.askClaudeHint")}
          </p>
        </>
      )}
      {claude.status === "asking" && (
        <div className="coach-loading" aria-live="polite">
          <div className="coach-step">
            <Spinner small />
            {t("coach.asking")}
            <button type="button" className="link-btn" onClick={cancelClaude}>
              {t("common.cancel")}
            </button>
          </div>
          <div className="skeleton" style={{ width: "95%" }} />
          <div className="skeleton" style={{ width: "80%" }} />
        </div>
      )}
      {claude.status === "error" && claude.error && (
        <div className="callout error">
          <AlertTriangle aria-hidden />
          <span>
            {errorText(t, claude.error)}{" "}
            {["notLoggedIn", "notFound"].includes(claude.error.kind) && (
              <button type="button" className="link-btn" onClick={() => setPage("setup")}>
                {t("common.openSetup")}
              </button>
            )}{" "}
            <button type="button" className="link-btn" onClick={() => askClaude(true)}>
              {t("common.tryAgain")}
            </button>
          </span>
        </div>
      )}
      {claude.status === "done" && r && (
        <article className="coach-card">
          <p className="coach-summary">
            <RichText text={r.summary} flagged={claude.result!.flagged} />
          </p>
          <h4>{t("review.lessons")}</h4>
          <ol className="lessons">
            {r.lessons.map((l, i) => (
              <li key={i}>
                <div className="lesson-title">
                  <b>
                    <RichText text={l.title} flagged={claude.result!.flagged} />
                  </b>
                  <span className={`badge phase-${l.phase}`}>{phaseLabel(t, l.phase)}</span>
                </div>
                <p>
                  <RichText text={l.explanation} flagged={claude.result!.flagged} />
                </p>
                {l.concept && <span className="badge">{conceptLabel(t, l.concept)}</span>}
              </li>
            ))}
          </ol>
          <Warnings warnings={claude.result!.warnings} flagged={claude.result!.flagged} />
          <CardFooter cached={claude.cached} model={claude.model} onRetry={() => askClaude(true)} disabled={false} />
        </article>
      )}
    </section>
  );
}

function ReviewMoves({ review, ply, onSelect }: { review: GameReview; ply: number; onSelect: (ply: number) => void }) {
  const t = useT();
  const rows: { num: number; white?: MoveReview; black?: MoveReview }[] = [];
  for (const m of review.moves) {
    const num = Math.ceil(m.ply / 2);
    const last = rows.at(-1);
    if (m.color === "white" || !last || last.num !== num) rows.push({ num, [m.color]: m });
    else last.black = m;
  }
  const cell = (m?: MoveReview) =>
    m ? (
      <button type="button" className={`move ${ply === m.index + 1 ? "current" : ""}`} onClick={() => onSelect(m.index + 1)}>
        {m.san}
        {m.judgement && <span className={`glyph ${m.judgement}`}>{judgementGlyph(m.judgement)}</span>}
      </button>
    ) : (
      <span className="move empty">…</span>
    );
  return (
    <section className="panel moves-panel">
      <div className="panel-header">
        <span className="panel-title">{t("moves.title")}</span>
      </div>
      <div className="move-list tabular">
        {rows.map((r) => (
          <div className="move-row" key={r.num}>
            <span className="move-num">{r.num}</span>
            {cell(r.white)}
            {r.black ? cell(r.black) : <span />}
          </div>
        ))}
      </div>
    </section>
  );
}
