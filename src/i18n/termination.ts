import type { Translator } from "./index";

/**
 * Chess.com writes how the game ended in English ("someone won by resignation",
 * "Game drawn by repetition"); translate the usual phrases, keep anything else.
 */
export function terminationText(t: Translator, text: string | null): string | null {
  if (!text) return null;
  const won = text.match(/^(.+) won (?:by|on) (resignation|checkmate|time|abandonment)$/i);
  if (won) return t(`termination.won.${won[2].toLowerCase() as "resignation"}`, { player: won[1] });
  const DRAWN: Record<string, string> = {
    agreement: "agreement",
    repetition: "repetition",
    stalemate: "stalemate",
    "insufficient material": "insufficientMaterial",
    "timeout vs insufficient material": "timeoutVsInsufficientMaterial",
    "50-move rule": "50MoveRule",
  };
  const drawn = text.match(/^Game drawn by (.+)$/i);
  const kind = drawn ? DRAWN[drawn[1].toLowerCase()] : undefined;
  if (kind) return t.maybe("termination.drawn.", kind, text);
  return text;
}
