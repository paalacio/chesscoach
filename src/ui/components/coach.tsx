// Pieces shared by the Coach panel (analysis) and the game review: text with
// unverified moves marked, concept tags, and notes about removed moves.

import { AlertTriangle } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { normalizeSan } from "../../core/context-packet";
import type { Judgement, Phase } from "../../core/types";
import { type MoveWarning, sanTokensIn } from "../../core/validate";
import { type Translator, useT } from "../../i18n";

/** Renders text, marking moves Claude mentioned that couldn't be verified. */
export function RichText({ text, flagged }: { text: string; flagged: string[] }): ReactNode {
  const t = useT();
  if (flagged.length === 0) return text;
  const tokens = new Set(sanTokensIn(text).filter((tok) => flagged.includes(tok)));
  if (tokens.size === 0) return text;
  const pattern = new RegExp(`(${[...tokens].map((tok) => tok.replace(/[+=]/g, "\\$&")).join("|")})`, "g");
  return text.split(pattern).map((part, i) =>
    tokens.has(normalizeSan(part)) ? (
      <span key={i} className="unverified" title={t("coach.unverifiedTitle")}>
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Concept tags come from Claude in English (e.g. "king-safety"); show them translated when we know them. */
export function conceptLabel(t: Translator, tag: string): string {
  return t.maybe("concept.", tag.toLowerCase(), tag.replace(/-/g, " "));
}

export function Concepts({ tags }: { tags: string[] }) {
  const t = useT();
  if (tags.length === 0) return null;
  return (
    <div className="concepts">
      {tags.map((tag) => (
        <span className="badge" key={tag}>
          {conceptLabel(t, tag)}
        </span>
      ))}
    </div>
  );
}

export function Warnings({ warnings, flagged }: { warnings: MoveWarning[]; flagged: string[] }) {
  const t = useT();
  if (warnings.length === 0 && flagged.length === 0) return null;
  return (
    <div className="callout warning coach-warning">
      <AlertTriangle aria-hidden />
      <span>
        {warnings.map((w) => t(`warning.${w.code}`, { san: w.san })).join(" ")}
        {flagged.length > 0 && ` ${t("warning.unverified", { moves: flagged.join(", ") })}`}
      </span>
    </div>
  );
}

export const judgementLabel = (t: Translator, j: Judgement) => t(`judgement.${j}`);
export const phaseLabel = (t: Translator, p: Phase) => t(`phase.${p}`);
