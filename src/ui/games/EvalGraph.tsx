// The win-chance graph of a game (White's chance, 0-100%), drawn as plain SVG.
// White's share grows from the bottom like the eval bar. Click or drag to jump.

import { useLayoutEffect, useRef, useState } from "react";
import type { GameReview } from "../../core/review";
import { useT } from "../../i18n";

const HEIGHT = 92;

export function EvalGraph({ review, ply, onSelect }: { review: GameReview; ply: number; onSelect: (ply: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(100, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = review.winCurve.length - 1;
  const x = (i: number) => (n === 0 ? 0 : (i / n) * width);
  const y = (win: number) => (1 - win / 100) * HEIGHT;
  const line = review.winCurve.map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${HEIGHT} L0,${HEIGHT} Z`;

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    onSelect(Math.round(((clientX - box.left) / box.width) * n));
  };

  const dividers = [
    { at: review.division.middlegame, label: t("phase.middlegame") },
    { at: review.division.endgame, label: t("phase.endgame") },
  ].filter((d): d is { at: number; label: string } => d.at !== null && d.at > 0);

  return (
    <div
      ref={ref}
      className="eval-graph"
      role="slider"
      aria-label={t("review.graph")}
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={ply}
      tabIndex={-1}
      onMouseDown={(e) => {
        dragging.current = true;
        pick(e.clientX);
      }}
      onMouseMove={(e) => dragging.current && pick(e.clientX)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
    >
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden>
        <rect className="eg-dark" x={0} y={0} width={width} height={HEIGHT} />
        <path className="eg-light" d={area} />
        <path className="eg-line" d={line} />
        <line className="eg-mid" x1={0} x2={width} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        {dividers.map((d) => (
          <g key={d.label}>
            <line className="eg-divider" x1={x(d.at)} x2={x(d.at)} y1={0} y2={HEIGHT} />
            <text className="eg-label" x={x(d.at) + 4} y={11}>
              {d.label}
            </text>
          </g>
        ))}
        {review.keyMoments.map((idx) => {
          const m = review.moves[idx];
          return <circle key={idx} className={`eg-dot ${m.judgement ?? "swing"}`} cx={x(idx + 1)} cy={y(m.winAfter)} r={3.5} />;
        })}
        <line className="eg-cursor" x1={x(ply)} x2={x(ply)} y1={0} y2={HEIGHT} />
      </svg>
    </div>
  );
}
