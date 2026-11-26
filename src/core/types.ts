// Shared types for the chess core. No React in src/core: everything here is plain
// TypeScript so it can be tested on its own (and reused later, e.g. on a phone).

export type Color = "white" | "black";

/** An engine score: centipawns (100 = a pawn) or "mate in N" (negative = getting mated). */
export interface Score {
  kind: "cp" | "mate";
  value: number;
}

/** One `info` line from the engine, as sent by the Rust backend. Scores are from the side to move. */
export interface InfoLine {
  depth: number;
  seldepth: number | null;
  multipv: number;
  score: Score;
  bound: "lower" | "upper" | null;
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
  /** Moves in UCI notation, e.g. "e2e4". */
  pv: string[];
}

export type EngineEvent =
  | { type: "info"; analysisId: number; fen: string; info: InfoLine }
  | { type: "bestMove"; analysisId: number; fen: string; best: string | null; ponder: string | null }
  | { type: "exited"; message: string };

/** A candidate line, ready for display. */
export interface EngineLine {
  multipv: number;
  depth: number;
  /** Score from White's point of view. */
  scoreWhite: Score;
  /** White's win chance, 0-100. */
  winWhite: number;
  pvUci: string[];
  pvSan: string[];
  nodes: number | null;
  nps: number | null;
}

export type Phase = "opening" | "middlegame" | "endgame";

export type Judgement = "inaccuracy" | "mistake" | "blunder";
