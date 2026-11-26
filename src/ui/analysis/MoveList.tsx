// The move list: main line in two columns, variations inline in parentheses.
// Right-click a move for a (native) context menu.

import { Fragment, useEffect, useRef } from "react";
import { backend } from "../../backend";
import * as T from "../../core/game-tree";
import { tNow, useT } from "../../i18n";
import { useAnalysis } from "../../store/analysis";
import { useToast } from "../../store/toast";
import { copyText } from "../components/controls";

const moveNumber = (ply: number) => Math.ceil(ply / 2);
const isWhiteMove = (ply: number) => ply % 2 === 1;

type Row =
  | { type: "pair"; num: number; white: T.TreeNode | null; black: T.TreeNode | null }
  | { type: "variations"; parent: string; ids: string[] };

/** Lays out the main line as numbered rows, breaking a row where variations branch off. */
function buildRows(tree: T.GameTree): Row[] {
  const rows: Row[] = [];
  let open: Extract<Row, { type: "pair" }> | null = null;
  for (const n of T.mainlineFrom(tree, T.ROOT).slice(1)) {
    const alts = tree.nodes[n.parent as string].children.slice(1);
    if (isWhiteMove(n.ply)) {
      open = { type: "pair", num: moveNumber(n.ply), white: n, black: null };
      rows.push(open);
    } else if (open && !open.black && open.num === moveNumber(n.ply)) {
      open.black = n;
    } else {
      open = { type: "pair", num: moveNumber(n.ply), white: null, black: n };
      rows.push(open);
    }
    if (alts.length) {
      rows.push({ type: "variations", parent: n.parent as string, ids: alts });
      open = null; // the next move starts a fresh row ("3... Nf6")
    }
  }
  return rows;
}

function useMoveMenu() {
  const { tree, explain, goto, promote, remove } = useAnalysis();
  const toast = useToast((s) => s.show);
  return async (id: string) => {
    const node = tree.nodes[id];
    goto(id);
    const choice = await backend.showContextMenu([
      { id: "explain", label: tNow("menu.explainMove", { move: node.san ?? "" }) },
      { id: "plan", label: tNow("coach.planButton") },
      "separator",
      { id: "promote", label: tNow("menu.promote"), enabled: !T.isMainline(tree, id) },
      { id: "delete", label: tNow("menu.deleteFromHere") },
      "separator",
      { id: "copy-fen", label: tNow("menu.copyFen") },
      { id: "repertoire", label: tNow("menu.addToRepertoire"), enabled: false },
    ]);
    if (choice === "explain") explain("moveExplanation");
    else if (choice === "plan") explain("positionPlan");
    else if (choice === "promote") promote(id);
    else if (choice === "delete") remove(id);
    else if (choice === "copy-fen") {
      await copyText(node.fen);
      toast(tNow("toast.copiedFen"));
    }
  };
}

function MoveButton({ node, current, label, onMenu }: { node: T.TreeNode; current: string; label?: string; onMenu: (id: string) => void }) {
  const goto = useAnalysis((s) => s.goto);
  const ref = useRef<HTMLButtonElement>(null);
  const active = node.id === current;
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      className={`move ${active ? "current" : ""}`}
      aria-current={active ? "step" : undefined}
      onClick={() => goto(node.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(node.id);
      }}
    >
      {label && <span className="move-num">{label}</span>}
      {node.san}
    </button>
  );
}

/** One variation (and the variations inside it), as inline text. */
function Variation({ tree, startId, current, onMenu }: { tree: T.GameTree; startId: string; current: string; onMenu: (id: string) => void }) {
  const line = T.mainlineFrom(tree, startId);
  return (
    <>
      {line.map((n, i) => {
        const label = isWhiteMove(n.ply) ? `${moveNumber(n.ply)}.` : i === 0 ? `${moveNumber(n.ply)}...` : undefined;
        const alts = i > 0 ? tree.nodes[n.parent as string].children.slice(1) : [];
        return (
          <Fragment key={n.id}>
            <MoveButton node={n} current={current} label={label} onMenu={onMenu} />
            {alts.map((a) => (
              <span key={a} className="subvariation">
                (<Variation tree={tree} startId={a} current={current} onMenu={onMenu} />)
              </span>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

export function MoveList() {
  const t = useT();
  const { tree, current } = useAnalysis();
  const onMenu = useMoveMenu();
  const rows = buildRows(tree);
  const rootComment = tree.nodes[T.ROOT].children.length === 0;

  return (
    <section className="panel moves-panel" aria-label={t("moves.title")}>
      <div className="panel-header">
        <span className="panel-title">{t("moves.title")}</span>
      </div>
      <div className="move-list tabular selectable">
        {rootComment && <p className="secondary small">{t("moves.empty")}</p>}
        {rows.map((row, i) =>
          row.type === "pair" ? (
            <div className="move-row" key={i}>
              <span className="move-num">{row.num}</span>
              {row.white ? <MoveButton node={row.white} current={current} onMenu={onMenu} /> : <span className="move empty">…</span>}
              {row.black ? <MoveButton node={row.black} current={current} onMenu={onMenu} /> : <span />}
            </div>
          ) : (
            <div className="variations" key={i}>
              {row.ids.map((id) => (
                <div className="variation" key={id}>
                  <Variation tree={tree} startId={id} current={current} onMenu={onMenu} />
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </section>
  );
}
