// The Repertoire page's inspector: what your repertoire says about the position on
// the board (your move, or the opponent replies you're ready for), a note, Claude's
// "why", building progress, and where your recent games left the repertoire.

import { AlertTriangle, BookMarked, GraduationCap, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { epdOf, playUci, START_FEN, turnOf } from "../../core/chess";
import { addMove, newTree, ROOT } from "../../core/game-tree";
import { indexAnnotations, notesAt } from "../../core/course";
import { type Deviation, nodeAt, repStats } from "../../core/repertoire";
import { useT } from "../../i18n";
import { useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { useRepertoire } from "../../store/repertoire";
import { Button, Segmented, Spinner } from "../components/controls";

export function RepertoirePanel() {
  const t = useT();
  const { list, reps, selected, build, select } = useRepertoire();
  const rep = selected != null ? reps[selected] : null;
  if (!rep) return null;
  const stats = repStats(rep);
  const building = build?.repId === rep.id ? build : null;

  return (
    <section className="panel rep-panel" aria-label={t("page.repertoire")}>
      <div className="panel-header">
        <BookMarked className="coach-icon rep-icon" aria-hidden />
        <span className="panel-title">{t("page.repertoire")}</span>
        <span className="right small secondary tabular">{t("rep.movesCount", { count: stats.myMoves })}</span>
      </div>
      {list.length > 1 && (
        <Segmented<string>
          label={t("rep.choose")}
          value={String(rep.id)}
          onChange={(v) => select(Number(v))}
          options={list.map((r) => ({ value: String(r.id), label: r.name }))}
        />
      )}

      {rep.course && (
        <p className="small secondary rep-course-line" title={rep.course.fileName}>
          <GraduationCap aria-hidden /> {t("course.from", { title: rep.course.title })}
        </p>
      )}

      {building ? (
        <div className="callout info rep-building" role="status">
          <Spinner small />
          <span>
            {building.waiting ? t("rep.buildWaiting") : t("rep.building", { done: building.progress.done, moves: building.progress.moves })}{" "}
            <button type="button" className="link-btn" onClick={() => useRepertoire.getState().cancelBuild()}>
              {t("rep.stop")}
            </button>
          </span>
        </div>
      ) : (
        rep.meta.incomplete && (
          <div className="callout warning rep-building">
            <AlertTriangle aria-hidden />
            <span>
              {t("rep.incomplete")}{" "}
              <button type="button" className="link-btn" onClick={() => useRepertoire.getState().runBuild(rep.id, [])} disabled={!!build}>
                {t("rep.continueBuild")}
              </button>
            </span>
          </div>
        )
      )}

      <PositionInfo />
      <CourseNotes />
      <Deviations />

      <div className="rep-actions">
        <Button size="small" onClick={() => useRepertoire.getState().exportPgn(rep.id)}>
          {t("rep.exportPgn")}
        </Button>
        <Button size="small" onClick={() => useRepertoire.getState().importPgn(rep.id)} disabled={!!build}>
          {t("rep.importPgn")}
        </Button>
        <DeleteButton id={rep.id} />
      </div>
    </section>
  );
}

/** Your move or the opponent's replies in the board's position. */
function PositionInfo() {
  const t = useT();
  const { reps, selected, build, why } = useRepertoire();
  const tree = useAnalysis((s) => s.tree);
  const current = useAnalysis((s) => s.current);
  const playMove = useAnalysis((s) => s.playMove);
  const rep = selected != null ? reps[selected] : null;
  const node = tree.nodes[current];
  const parent = node.parent != null ? tree.nodes[node.parent] : null;
  if (!rep) return null;

  const here = nodeAt(rep, node.fen);
  const before = parent ? nodeAt(rep, parent.fen) : null;
  const myTurn = turnOf(node.fen) === rep.color;
  const busy = !!build;
  const repNote = rep.notes[epdOf(node.fen)];
  const whyState = why[`${rep.id}|${epdOf(node.fen)}`];

  // The move just played on the board, compared with the repertoire.
  let suggestion: ReactNode = null;
  if (parent && before && node.uci) {
    const parentMine = turnOf(parent.fen) === rep.color;
    if (parentMine && before.mine && before.mine.uci !== node.uci) {
      suggestion = (
        <div className="callout info">
          <span>
            {t("rep.differentMove", { played: node.san ?? "", mine: before.mine.san })}{" "}
            <button type="button" className="link-btn" disabled={busy} onClick={() => useRepertoire.getState().useMyMove(parent.fen, node.uci as string)}>
              {t("rep.useInstead", { move: node.san ?? "" })}
            </button>
          </span>
        </div>
      );
    } else if (parentMine && !before.mine) {
      suggestion = (
        <div className="callout info">
          <span>
            <button type="button" className="link-btn" disabled={busy} onClick={() => useRepertoire.getState().useMyMove(parent.fen, node.uci as string)}>
              {t("rep.useThisMove", { move: node.san ?? "" })}
            </button>
          </span>
        </div>
      );
    } else if (!parentMine && !before.replies.some((r) => r.uci === node.uci)) {
      suggestion = (
        <div className="callout info">
          <span>
            {t("rep.newReply", { move: node.san ?? "" })}{" "}
            <button type="button" className="link-btn" disabled={busy} onClick={() => useRepertoire.getState().addOpponentMove(parent.fen, node.uci as string)}>
              {t("rep.addReply")}
            </button>
          </span>
        </div>
      );
    }
  }

  return (
    <div className="rep-position">
      {suggestion}
      {!here ? (
        <div className="rep-out">
          <p className="secondary small">{t("rep.notInRepertoire")}</p>
          {tree.nodes[ROOT].fen === START_FEN && node.ply > 0 && (
            <Button size="small" onClick={() => useRepertoire.getState().addBoardLine()} disabled={busy}>
              {t("rep.addBoardLine")}
            </Button>
          )}
        </div>
      ) : myTurn ? (
        <div className="rep-mine">
          {here.mine ? (
            <>
              <div className="rep-mine-move">
                <span className="secondary">{t("rep.yourMove")}</span>
                <button type="button" className="rep-move-btn" onClick={() => playMove(here.mine?.uci as string)}>
                  {here.mine.san}
                </button>
                <span className={`badge source-${here.mine.source}`}>{t(`rep.source.${here.mine.source}`)}</span>
              </div>
              {repNote?.why ? (
                <p className="rep-why">
                  <Sparkles aria-hidden /> {repNote.why}
                </p>
              ) : whyState?.status === "asking" ? (
                <p className="rep-why secondary">
                  <Spinner small /> {t("coach.asking")}
                </p>
              ) : (
                <button type="button" className="link-btn small" onClick={() => useRepertoire.getState().askWhy(node.fen)}>
                  {t("rep.askWhy", { move: here.mine.san })}
                </button>
              )}
              {whyState?.status === "error" && <p className="error-text small">{whyState.message}</p>}
              <p className="hint">{t("rep.changeHint")}</p>
            </>
          ) : (
            <>
              <p className="secondary small">{t("rep.noMoveYet")}</p>
              <FillButton fen={node.fen} ply={node.ply} reach={here.reach} />
            </>
          )}
        </div>
      ) : (
        <div className="rep-replies">
          <div className="secondary small">{t("rep.replies")}</div>
          {here.replies.length === 0 ? (
            <>
              <p className="secondary small">{t("rep.lineEnds")}</p>
              <FillButton fen={node.fen} ply={node.ply} reach={here.reach} />
            </>
          ) : (
            <ul className="rep-reply-list">
              {here.replies.map((r) => (
                <li key={r.uci}>
                  <button type="button" className="rep-reply" onClick={() => playMove(r.uci)}>
                    <b>{r.san}</b>
                    <span className="rep-share-bar" aria-hidden>
                      <span style={{ width: `${Math.min(100, r.share ?? 0)}%` }} />
                    </span>
                    <span className="tabular secondary small">{r.share != null ? `${Math.round(r.share)}%` : "–"}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn rep-remove"
                    aria-label={t("rep.removeReply", { move: r.san })}
                    title={t("rep.removeReply", { move: r.san })}
                    disabled={busy}
                    onClick={() => useRepertoire.getState().removeMoveAt(r.epd, r.uci)}
                  >
                    <X />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {here && <NoteField key={`${rep.id}|${epdOf(node.fen)}`} epd={epdOf(node.fen)} initial={repNote?.note ?? ""} />}
    </div>
  );
}

function FillButton({ fen, ply, reach }: { fen: string; ply: number; reach: number }) {
  const t = useT();
  const { selected, build } = useRepertoire();
  if (selected == null) return null;
  return (
    <Button size="small" disabled={!!build} onClick={() => useRepertoire.getState().runBuild(selected, [], { fen, ply, reach })}>
      {t("rep.fillFromHere")}
    </Button>
  );
}

function NoteField({ epd, initial }: { epd: string; initial: string }) {
  const t = useT();
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  return (
    <label className="rep-note">
      <span className="secondary small">{t("rep.note")}</span>
      <textarea
        className="text-area small"
        value={text}
        rows={2}
        placeholder={t("rep.notePlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => useRepertoire.getState().setNote(epd, text.trim())}
      />
    </label>
  );
}

/** Where recent games left this repertoire. */
function Deviations() {
  const t = useT();
  const { deviations, selected, build } = useRepertoire();
  const load = useAnalysis((s) => s.load);
  const goto = useAnalysis((s) => s.goto);
  const setPage = useApp((s) => s.setPage);
  const [loading, setLoading] = useState(false);
  const mine = (deviations ?? []).filter((d) => d.repertoireId === selected && d.kind !== "end").slice(0, 8);

  /** Opens the game's moves up to the deviation on the board. */
  function open(d: Deviation) {
    let tree = newTree();
    let id = ROOT;
    let fen = START_FEN;
    for (const m of d.game.moves.filter((m) => m.ply <= d.ply)) {
      const added = addMove(tree, id, m.uci);
      if (!added) break;
      tree = added.tree;
      id = added.id;
      fen = playUci(fen, m.uci)?.fen ?? fen;
    }
    load(tree);
    goto(id);
    setPage("repertoire");
  }

  return (
    <div className="rep-deviations">
      <div className="rep-section-title">
        <span>{t("rep.deviations")}</span>
        <button
          type="button"
          className="link-btn small"
          disabled={loading || !!build}
          onClick={async () => {
            setLoading(true);
            await useRepertoire.getState().loadDeviations();
            setLoading(false);
          }}
        >
          {deviations ? t("rep.checkAgain") : t("rep.checkGames")}
        </button>
      </div>
      {loading && <Spinner small />}
      {deviations && !loading && mine.length === 0 && <p className="secondary small">{t("rep.noDeviations")}</p>}
      {mine.length > 0 && (
        <ul className="rep-deviation-list">
          {mine.map((d) => (
            <li key={`${d.game.gameId}`}>
              <button type="button" className="rep-deviation" onClick={() => open(d)}>
                <span className="secondary small">
                  {t("rep.vsOpponent", { name: d.game.opponent })} · {t("rep.moveN", { n: Math.floor((d.ply + 1) / 2) })}
                </span>
                <span>
                  {d.kind === "mine"
                    ? t("rep.youPlayed", { played: d.played?.san ?? "", mine: d.expected?.san ?? "" })
                    : t("rep.theyPlayed", { played: d.played?.san ?? "" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the course says here: the author's introduction and comments on its moves. */
function CourseNotes() {
  const t = useT();
  const rep = useRepertoire((s) => (s.selected != null ? s.reps[s.selected] : null));
  const fen = useAnalysis((s) => s.tree.nodes[s.current].fen);
  const playMove = useAnalysis((s) => s.playMove);
  const index = useMemo(() => indexAnnotations(rep?.annotations ?? []), [rep?.annotations]);
  if (!rep?.course) return null;
  const here = notesAt(index, fen);
  if (!here.about && here.moves.length === 0) return null;
  return (
    <div className="course-notes">
      <div className="rep-section-title">
        <span>{t("course.notes")}</span>
      </div>
      {here.about && <p className="course-about">{here.about}</p>}
      <ul>
        {here.moves.map((m) => (
          <li key={m.uci}>
            <button type="button" className="course-move" onClick={() => playMove(m.uci)}>
              {m.san}
              {m.nags}
            </button>
            {!m.main && <span className="badge">{t("course.sideLine")}</span>} {m.comment && <span className="course-comment">{m.comment}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two clicks to delete, so it can't happen by accident. */
function DeleteButton({ id }: { id: number }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      size="small"
      className={armed ? "danger" : ""}
      onClick={() => (armed ? useRepertoire.getState().remove(id) : setArmed(true))}
      disabled={!!useRepertoire.getState().build}
    >
      {armed ? t("rep.deleteConfirm") : t("rep.delete")}
    </Button>
  );
}
