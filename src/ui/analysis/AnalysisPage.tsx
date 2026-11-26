// Analysis: big square board + inspector (engine, coach, moves).

import type { DrawShape } from "@lichess-org/chessground/draw";
import { chessgroundDests } from "chessops/compat";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fenOf, positionFromFen, turnOf } from "../../core/chess";
import { pathTo } from "../../core/game-tree";
import { openingOfLine } from "../../core/openings";
import { phaseOfLine } from "../../core/phase";
import { formatScore } from "../../core/winprob";
import { useT } from "../../i18n";
import { needsPromotion, useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { Board } from "../board/Board";
import { EvalBar, type PromotionRole, PromotionPicker } from "../board/BoardExtras";
import { phaseLabel } from "../components/coach";
import { IconButton } from "../components/controls";
import { useAccentColor, useReducedMotion } from "../hooks";
import { CoachPanel } from "./CoachPanel";
import { EnginePanel } from "./EnginePanel";
import { MoveList } from "./MoveList";
import { parseUci } from "chessops/util";

const PROMO_LETTER: Record<PromotionRole, string> = { queen: "q", rook: "r", bishop: "b", knight: "n" };
export const EVAL_BAR_SPACE = 22; // eval bar width + gap, px

/** Measures the free space and returns the largest board size that fits (a multiple of 8). */
export function useBoardSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState(480);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const s = Math.floor(Math.min(width - EVAL_BAR_SPACE, height) / 8) * 8;
      setSize(Math.max(240, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function useOpeningAndPhase() {
  const { tree, current } = useAnalysis();
  return useMemo(() => {
    const fens = pathTo(tree, current).map((n) => n.fen);
    return { opening: openingOfLine(fens), phase: phaseOfLine(fens) };
  }, [tree, current]);
}

export function AnalysisPage() {
  const t = useT();
  const a = useAnalysis();
  const settings = useApp((s) => s.settings);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useBoardSize(stageRef);
  const accent = useAccentColor();
  const reduceMotion = useReducedMotion();
  const [promotion, setPromotion] = useState<{ orig: string; dest: string } | null>(null);
  const { opening, phase } = useOpeningAndPhase();

  const node = a.tree.nodes[a.current];

  // While previewing an engine line, show the position after its first N moves.
  const view = useMemo(() => {
    const line = a.preview ? a.lines[a.preview.line] : null;
    if (!line || !a.preview) return { fen: node.fen, lastUci: node.uci };
    const pos = positionFromFen(node.fen);
    let last: string | null = node.uci;
    for (const uci of line.pvUci.slice(0, a.preview.plies)) {
      const m = parseUci(uci);
      if (!m || !pos.isLegal(m)) break;
      pos.play(m);
      last = uci;
    }
    return { fen: fenOf(pos), lastUci: last };
  }, [a.preview, a.lines, node]);

  const pos = useMemo(() => positionFromFen(view.fen), [view.fen]);
  const dests = useMemo(
    () => (a.preview ? new Map<string, string[]>() : (chessgroundDests(pos) as Map<string, string[]>)),
    [pos, a.preview],
  );

  const fresh = a.linesFen === node.fen;
  const top = fresh ? a.lines[0] : (a.evalCache[node.fen]?.[0] ?? null);
  const shapes: DrawShape[] =
    a.engineOn && top && top.pvUci[0] && !a.preview
      ? [{ orig: top.pvUci[0].slice(0, 2) as DrawShape["orig"], dest: top.pvUci[0].slice(2, 4) as DrawShape["orig"], brush: "engine" }]
      : [];

  // Escape leaves the line preview.
  useEffect(() => {
    if (!a.preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && a.setPreview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a.preview, a.setPreview]);

  function onMove(orig: string, dest: string) {
    if (needsPromotion(node.fen, orig, dest)) {
      setPromotion({ orig, dest });
      return;
    }
    a.playMove(orig + dest);
  }

  return (
    <div className="analysis">
      <div className="board-column">
        <div className="board-stage" ref={stageRef}>
          <div className="board-and-bar" style={{ height: size }}>
            <EvalBar
              winWhite={top ? top.winWhite : null}
              label={top ? formatScore(top.scoreWhite) : t("board.noEval")}
              orientation={a.orientation}
              height={size}
            />
            <div
              className={`board-wrap board-theme-${settings?.boardTheme ?? "brown"} pieces-${settings?.pieceSet ?? "cburnett"}`}
              style={{ width: size, height: size }}
              data-testid="board"
            >
              <Board
                fen={view.fen}
                orientation={a.orientation}
                turn={turnOf(view.fen)}
                lastMove={view.lastUci ? [view.lastUci.slice(0, 2), view.lastUci.slice(2, 4)] : undefined}
                check={pos.isCheck()}
                dests={dests}
                onMove={onMove}
                autoShapes={shapes}
                coordinates={settings?.showCoordinates ?? true}
                size={size}
                accent={accent}
                reduceMotion={reduceMotion}
              />
              {promotion && (
                <PromotionPicker
                  dest={promotion.dest}
                  color={turnOf(node.fen)}
                  orientation={a.orientation}
                  onPick={(role) => {
                    a.playMove(promotion.orig + promotion.dest + PROMO_LETTER[role]);
                    setPromotion(null);
                  }}
                  onCancel={() => setPromotion(null)}
                />
              )}
              {a.preview && (
                <div className="preview-banner">
                  <span>{t("preview.title")}</span>
                  <button type="button" className="btn small primary" onClick={a.playPreview}>
                    {t("preview.play")}
                  </button>
                  <button type="button" className="icon-btn" aria-label={t("preview.stop")} onClick={() => a.setPreview(null)}>
                    <X />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="board-caption" style={{ width: size + EVAL_BAR_SPACE }}>
          <span className={`badge phase-${phase}`} title={t("phase.title")}>
            {phaseLabel(t, phase)}
          </span>
          <span className="opening-name" title={opening.opening ? `${opening.opening.eco} ${opening.opening.name}` : undefined}>
            {opening.opening ? (
              <>
                <span className="eco">{opening.opening.eco}</span> {opening.opening.name}
                {!opening.inBook && node.ply > 0 && <span className="secondary"> · {t("opening.outOfBook")}</span>}
              </>
            ) : (
              <span className="secondary">{node.ply === 0 ? t("opening.start") : t("opening.unnamed")}</span>
            )}
          </span>
          <span className="nav-buttons">
            <IconButton label={t("nav.first")} onClick={a.first} disabled={node.parent === null}>
              <ChevronFirst />
            </IconButton>
            <IconButton label={t("nav.prev")} onClick={a.prev} disabled={node.parent === null}>
              <ChevronLeft />
            </IconButton>
            <IconButton label={t("nav.next")} onClick={a.next} disabled={node.children.length === 0}>
              <ChevronRight />
            </IconButton>
            <IconButton label={t("nav.last")} onClick={a.last} disabled={node.children.length === 0}>
              <ChevronLast />
            </IconButton>
          </span>
        </div>
      </div>

      <aside className="inspector" data-open={inspectorOpen} aria-label={t("inspector.title")} aria-hidden={!inspectorOpen}>
        <EnginePanel />
        <div className="inspector-split">
          <div className="inspector-scroll coach-scroll">
            <CoachPanel />
          </div>
          <div className="inspector-scroll moves-scroll">
            <MoveList />
          </div>
        </div>
      </aside>
    </div>
  );
}
