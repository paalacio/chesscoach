// The trainer: a home screen with the three modes (and a quiet daily goal and
// streak), and the training session itself (board + what to do).

import type { DrawShape } from "@lichess-org/chessground/draw";
import { chessgroundDests } from "chessops/compat";
import { AlertTriangle, BookOpen, Check, GraduationCap, NotebookPen, RotateCcw, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { positionFromFen, turnOf } from "../../core/chess";
import { useT } from "../../i18n";
import { needsPromotion } from "../../store/analysis";
import { useApp } from "../../store/app";
import { useRepertoire } from "../../store/repertoire";
import { currentStreak, newLeftToday, type Session, todayCount, useTrainer } from "../../store/trainer";
import { useBoardSize } from "../analysis/AnalysisPage";
import { Board } from "../board/Board";
import { Button, Spinner } from "../components/controls";
import { useAccentColor, useReducedMotion } from "../hooks";

export function TrainerPage() {
  const { loaded, session, load } = useTrainer();
  useEffect(() => {
    if (!session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!loaded) {
    return (
      <div className="page-scroll" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }
  return session ? <SessionView session={session} /> : <TrainerHome />;
}

function TrainerHome() {
  const t = useT();
  const { counts, days, reps, mistakes, start, keepLearning } = useTrainer();
  const goal = useApp((s) => s.settings?.dailyGoal ?? 20);
  const setPage = useApp((s) => s.setPage);
  const left = newLeftToday(useTrainer.getState());
  const today = todayCount(days);
  const streak = currentStreak(days);

  if (reps.length === 0 && mistakes.length === 0) {
    return (
      <div className="page-scroll" style={{ display: "flex" }}>
        <div className="empty-state">
          <GraduationCap />
          <h2>{t("train.emptyTitle")}</h2>
          <p>{t("train.emptyText")}</p>
          <Button variant="primary" onClick={() => setPage("repertoire")}>
            {t("train.openRepertoire")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll trainer-home">
      <div className="trainer-inner">
        <p className="trainer-today secondary" aria-label={t("train.todayLabel")}>
          {t("train.today", { done: today, goal })}
          {today >= goal && <Check aria-hidden className="goal-done" />}
          {streak > 0 && <> · {t("train.streak", { count: streak })}</>}
        </p>
        <div className="trainer-modes">
          <ModeCard
            icon={<BookOpen />}
            title={t("train.learn")}
            text={t("train.learnText")}
            count={counts.newMoves > 0 ? t("train.newMoves", { count: counts.newMoves }) : t("train.allLearned")}
            note={counts.newMoves > 0 ? (left > 0 ? t("train.newLeft", { count: Math.min(left, counts.newMoves) }) : t("train.limitReached")) : null}
            action={
              left > 0 ? (
                <Button variant="primary" disabled={counts.newMoves === 0} onClick={() => start("learn")}>
                  {t("train.start")}
                </Button>
              ) : (
                <Button disabled={counts.newMoves === 0} onClick={keepLearning}>
                  {t("train.keepLearning")}
                </Button>
              )
            }
          />
          <ModeCard
            icon={<RotateCcw />}
            title={t("train.review")}
            text={t("train.reviewText")}
            count={counts.due > 0 ? t("train.due", { count: counts.due }) : t("train.nothingDue")}
            action={
              <Button variant="primary" disabled={counts.due === 0} onClick={() => start("review")}>
                {t("train.start")}
              </Button>
            }
          />
          <ModeCard
            icon={<Target />}
            title={t("train.mistakes")}
            text={t("train.mistakesText")}
            count={mistakes.length === 0 ? t("train.noMistakes") : t("train.mistakesCount", { count: counts.mistakes })}
            action={
              <Button variant="primary" disabled={counts.mistakes === 0} onClick={() => start("mistakes")}>
                {t("train.start")}
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

function ModeCard(props: { icon: React.ReactNode; title: string; text: string; count: string; note?: string | null; action: React.ReactNode }) {
  return (
    <section className="mode-card">
      <div className="mode-icon" aria-hidden>
        {props.icon}
      </div>
      <h3>{props.title}</h3>
      <p className="secondary">{props.text}</p>
      <p className="mode-count tabular">{props.count}</p>
      {props.note && <p className="hint">{props.note}</p>}
      <div className="mode-action">{props.action}</div>
    </section>
  );
}

function SessionView({ session: s }: { session: Session }) {
  const t = useT();
  const { move, next, stop, askReason } = useTrainer();
  const settings = useApp((st) => st.settings);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useBoardSize(stageRef);
  const accent = useAccentColor();
  const reduceMotion = useReducedMotion();
  const repName = useRepertoire((st) => (s.card?.repertoireId != null ? st.reps[s.card.repertoireId]?.name : null));

  const pos = useMemo(() => positionFromFen(s.fen), [s.fen]);
  const canMove = s.status === "yourMove" || s.status === "wrong";
  const dests = useMemo(() => (canMove ? (chessgroundDests(pos) as Map<string, string[]>) : new Map<string, string[]>()), [pos, canMove]);

  const shapes: DrawShape[] = [];
  const arrow = (uci: string, brush: string) =>
    shapes.push({ orig: uci.slice(0, 2) as DrawShape["orig"], dest: uci.slice(2, 4) as DrawShape["orig"], brush });
  if (s.hint && s.expected) arrow(s.expected.uci, "green");
  if (s.status === "wrong" && s.wrong) arrow(s.wrong, "red");

  return (
    <div className="analysis trainer-session">
      <div className="board-column">
        <div className="board-stage" ref={stageRef}>
          <div className="board-and-bar" style={{ height: size }}>
            <div
              className={`board-wrap board-theme-${settings?.boardTheme ?? "brown"} pieces-${settings?.pieceSet ?? "cburnett"} trainer-board status-${s.status}`}
              style={{ width: size, height: size }}
              data-testid="trainer-board"
              data-movable={canMove}
            >
              <Board
                fen={s.fen}
                orientation={s.orientation}
                turn={turnOf(s.fen)}
                lastMove={s.lastMove ? [s.lastMove.slice(0, 2), s.lastMove.slice(2, 4)] : undefined}
                check={pos.isCheck()}
                dests={dests}
                onMove={(orig, dest) => move(orig + dest + (needsPromotion(s.fen, orig, dest) ? "q" : ""))}
                autoShapes={shapes}
                coordinates={settings?.showCoordinates ?? true}
                size={size}
                accent={accent}
                reduceMotion={reduceMotion}
              />
            </div>
          </div>
        </div>
      </div>

      <aside className="inspector trainer-panel" data-open="true" aria-label={t("page.train")}>
        <div className="trainer-panel-inner">
          <div className="panel-header">
            <GraduationCap className="coach-icon" aria-hidden />
            <span className="panel-title">{t(`train.${s.mode}`)}</span>
            <span className="right small secondary tabular">
              {s.mode === "learn" ? t(s.pass === "show" ? "train.passShow" : "train.passQuiz") : t("train.progress", { done: s.answered, total: Math.max(s.total, s.answered) })}
            </span>
          </div>
          {repName && <p className="small secondary">{repName}</p>}
          {s.line.length > 0 && <p className="trainer-line">{lineText(s)}</p>}

          <Prompt session={s} onReason={() => void askReason()} />

          <div className="trainer-buttons">
            {(s.status === "right" && s.mode !== "learn" && s.card?.kind === "mistake") || s.status === "lessonDone" ? (
              <Button variant="primary" onClick={next}>
                {s.status === "lessonDone" ? t("train.nextLine") : t("train.continue")}
              </Button>
            ) : null}
            <Button onClick={stop}>{s.status === "done" ? t("train.backHome") : t("train.stop")}</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** The moves so far, with move numbers, e.g. "1.e4 c5 2.Nf3". */
function lineText(s: Session): string {
  // Lines always start from the starting position, so White's moves are the even ones.
  return s.line.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(" ");
}

/** The author's comment from an imported course. */
function CourseNote({ note }: { note: Session["courseNote"] }) {
  const t = useT();
  if (!note?.comment) return null;
  return (
    <p className="trainer-course-note">
      <NotebookPen aria-hidden />
      <span>
        <b>{t("course.authorSays", { title: note.title })}</b> {note.comment}
      </span>
    </p>
  );
}

/** Shows `text` with `bold` (a move) in bold, e.g. "Play <b>Nf3</b>". */
function WithBold({ text, bold }: { text: string; bold: string }) {
  const at = bold ? text.indexOf(bold) : -1;
  // One <span>, so a flex parent doesn't put gaps between the pieces.
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <b>{bold}</b>
      {text.slice(at + bold.length)}
    </span>
  );
}

function Prompt({ session: s, onReason }: { session: Session; onReason: () => void }) {
  const t = useT();
  const expected = s.expected?.san ?? "";
  switch (s.status) {
    case "auto":
      return <p className="trainer-prompt secondary">{t("train.watch")}</p>;
    case "checking":
      return (
        <p className="trainer-prompt secondary">
          <Spinner small /> {t("train.checking")}
        </p>
      );
    case "yourMove":
      return (
        <div className="trainer-prompt">
          {s.mode === "mistakes" || s.card?.kind === "mistake" ? (
            <>
              <p className="big">{t("train.findBetter")}</p>
              {s.card?.mistake && <p className="secondary small">{t("train.fromGame", { name: s.card.mistake.opponent })}</p>}
            </>
          ) : s.hint ? (
            <>
              <p className="big">
                <WithBold text={t("train.playThis", { move: expected })} bold={expected} />
              </p>
              <CourseNote note={s.courseNote} />
            </>
          ) : (
            <p className="big">{s.mode === "learn" && s.pass === "quiz" ? t("train.fromMemory") : t("train.yourMove")}</p>
          )}
        </div>
      );
    case "right":
      return (
        <div className="trainer-prompt right" role="status">
          <p className="big">
            <Check aria-hidden /> {s.alsoGood ? t("train.alsoGood", { move: s.alsoGood, best: s.card?.answer.san ?? "" }) : t("train.right")}
          </p>
          {s.card?.mistake && (
            <p className="secondary small">{t("train.inTheGame", { played: s.card.mistake.playedSan, judgement: t.maybe("judgement.", s.card.mistake.judgement, s.card.mistake.judgement).toLowerCase() })}</p>
          )}
        </div>
      );
    case "wrong":
      return (
        <div className="trainer-prompt wrong" role="status">
          <p className="big">
            <AlertTriangle aria-hidden /> <WithBold text={t("train.wrong", { move: expected })} bold={expected} />
          </p>
          <CourseNote note={s.courseNote} />
          {s.reasonLoading === "asking" ? (
            <p className="secondary small">
              <Spinner small /> {t("coach.asking")}
            </p>
          ) : s.reasonLoading ? (
            <Spinner small />
          ) : s.reason ? (
            <p className="trainer-reason">
              <Sparkles aria-hidden /> {s.reason}
            </p>
          ) : (
            <button type="button" className="link-btn small" onClick={onReason}>
              {t("train.askWhy")}
            </button>
          )}
          <p className="hint">{t("train.playToGoOn", { move: expected })}</p>
        </div>
      );
    case "lessonDone":
      return (
        <div className="trainer-prompt right" role="status">
          <p className="big">
            <Check aria-hidden /> {t("train.lessonDone", { count: s.learned })}
          </p>
        </div>
      );
    case "done":
      return (
        <div className="trainer-prompt" role="status">
          <p className="big">{s.answered ? t("train.summary", { right: s.right, count: s.answered }) : t("train.nothingLeft")}</p>
        </div>
      );
  }
}

