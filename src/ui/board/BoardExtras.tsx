// Things drawn next to or over the board: eval bar and promotion picker.

import type { Color } from "../../core/types";
import { useT } from "../../i18n";

/** Slim vertical bar: White's share grows from the bottom (or top if the board is flipped). */
export function EvalBar({ winWhite, label, orientation, height }: { winWhite: number | null; label: string; orientation: Color; height: number }) {
  const t = useT();
  const white = winWhite ?? 50;
  const whiteAtBottom = orientation === "white";
  return (
    <div
      className="eval-bar"
      style={{ height }}
      role="meter"
      aria-label={t("board.evaluation")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={label}
      title={label}
    >
      <div
        className="eval-white"
        style={{
          height: `${white}%`,
          [whiteAtBottom ? "bottom" : "top"]: 0,
        }}
      />
      <div className="eval-mid" />
    </div>
  );
}

const ROLES = ["queen", "rook", "bishop", "knight"] as const;
export type PromotionRole = (typeof ROLES)[number];

/**
 * Four pieces stacked on the promotion file, starting at the edge of the board
 * the pawn moves to (like lichess). Click outside to cancel.
 */
export function PromotionPicker({
  dest,
  color,
  orientation,
  onPick,
  onCancel,
}: {
  dest: string;
  color: Color;
  orientation: Color;
  onPick: (role: PromotionRole) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const file = dest.charCodeAt(0) - 97;
  const col = orientation === "white" ? file : 7 - file;
  // The pawn arrives at the top edge if it moves "up" in the current orientation.
  const atTop = color === orientation;
  return (
    <div className="promotion-overlay cg-wrap" onClick={onCancel} role="dialog" aria-label={t("board.choosePiece")}>
      {ROLES.map((role, i) => (
        <button
          key={role}
          type="button"
          className="promotion-choice"
          aria-label={t(`board.promote.${role}`)}
          style={{ left: `${col * 12.5}%`, [atTop ? "top" : "bottom"]: `${i * 12.5}%` }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(role);
          }}
        >
          <piece className={`${role} ${color}`} />
        </button>
      ))}
    </div>
  );
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
