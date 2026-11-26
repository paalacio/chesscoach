// "Why is this move good?" for a move in a position, outside the analysis board
// (the trainer and the repertoire page use it). It sends the same request as
// Explain on the analysis board, so the answers are cached and shared with it.

import { backend, toBackendError } from "../backend";
import { playUci, turnOf } from "../core/chess";
import { buildPacket, buildPrompt, type MoveContext } from "../core/context-packet";
import { checkMoveExplanation } from "../core/validate";
import { currentLang } from "../i18n";
import { EXPLAIN_DEPTH, useAnalysis } from "./analysis";

export interface WhyAnswer {
  /** Claude's short summary of the move. */
  summary: string;
  cached: boolean;
}

/** A saved answer, if there is one (never starts a Claude request). */
export async function cachedWhy(fen: string, uci: string): Promise<WhyAnswer | null> {
  try {
    const reply = await backend.claudeAsk({ kind: "moveExplanation", fen, movePlayed: uci, prompt: "", cacheOnly: true });
    const summary = (reply.data as { summary?: unknown })?.summary;
    return typeof summary === "string" && summary ? { summary, cached: true } : null;
  } catch {
    return null;
  }
}

/** Asks Claude why `uci` is played in `fen` (after a quick engine check of both positions). */
export async function askWhy(fen: string, uci: string, history: { fen: string; san: string | null }[] = []): Promise<WhyAnswer> {
  const played = playUci(fen, uci);
  if (!played) throw toBackendError(new Error("That move isn't legal here."));
  const a = useAnalysis.getState();
  const linesBefore = await a.evaluatePosition(fen, EXPLAIN_DEPTH);
  const lines = await a.evaluatePosition(played.fen, EXPLAIN_DEPTH);
  const move: MoveContext = { san: played.san, uci: played.uci, color: turnOf(fen), fenBefore: fen, linesBefore };
  const path = history.length ? history : [{ fen, san: null }];
  const packet = buildPacket({ fen: played.fen, lines, history: [...path, { fen: played.fen, san: played.san }], move });
  const prompt = buildPrompt("moveExplanation", packet, move, currentLang());
  const reply = await backend.claudeAsk({ kind: "moveExplanation", fen, movePlayed: played.uci, prompt });
  const checked = checkMoveExplanation(reply.data, packet.allowed);
  return { summary: checked.data.summary, cached: reply.cached };
}
