// The frontend's view of the backend. Two implementations exist:
// - tauri.ts: the real one (Rust commands via `invoke`, events via `listen`);
// - mock.ts:  a fake one with fixture data, so the UI runs in a normal browser.
// These types mirror the Rust structs in src-tauri/src (serde camelCase).

import type { RequestKind } from "../core/context-packet";
import type { GameAnalysis, ReviewSummary, TrainingCard } from "../core/review";
import type { Color, EngineEvent } from "../core/types";

export type Platform = "mac" | "windows" | "linux";

export interface Settings {
  chesscomUsername: string;
  contactEmail: string;
  enginePath: string;
  engineThreads: number | null;
  engineHashMb: number;
  multipv: number;
  claudePath: string;
  claudeModel: string;
  boardTheme: string;
  pieceSet: string;
  showCoordinates: boolean;
  setupComplete: boolean;
  reviewDepth: number;
  reviewMovetimeMs: number;
  reviewThreads: number | null;
  autoAnalyze: boolean;
  /** "en" | "pt" */
  language: string;
  /** Lichess explorer filters: rating groups (1000 = 1000-1199, ...) and speeds. */
  explorerRatings: number[];
  explorerSpeeds: string[];
}

export interface AppInfo {
  version: string;
  dataDir: string;
  os: string;
  defaultThreads: number;
}

export interface EngineStatus {
  running: boolean;
  name: string | null;
  path: string | null;
  threads: number;
  hashMb: number;
}

export interface AnalyzeOptions {
  analysisId: number;
  fen: string;
  multipv: number;
  depth?: number | null;
  movetimeMs?: number | null;
  /** Only search these moves (UCI). */
  searchmoves?: string[] | null;
}

export type CheckStatus = "ok" | "warning" | "error" | "info";

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** English fallbacks; the UI shows a translated text built from id + status + params. */
  detail: string;
  fix: string | null;
  params: Record<string, string>;
}

export interface AskRequest {
  kind: RequestKind;
  fen: string;
  movePlayed: string | null;
  prompt: string;
  force?: boolean;
}

export interface AskReply {
  data: unknown;
  cached: boolean;
  callsToday: number;
  model: string;
}

export interface Archive {
  year: number;
  month: number;
  url: string;
}

/**
 * Errors from the backend: `kind` is e.g. "notLoggedIn", "usageLimit",
 * "missingContact"; `detail` holds the value inside (a username, a limit message).
 * The UI shows a translated text for known kinds (see i18n "error.*").
 */
export class BackendError extends Error {
  constructor(
    public kind: string,
    message: string,
    public detail: string | null = null,
  ) {
    super(message);
  }
}

export function toBackendError(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { kind?: string; message: string; detail?: string | null };
    return new BackendError(o.kind ?? "error", String(o.message), o.detail ?? null);
  }
  return new BackendError("error", String(e));
}

// ---------- games (Phase 2) ----------

export type AnalysisStatus = "pending" | "running" | "done" | "error";

export interface GameSummary {
  id: number;
  url: string;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  myColor: Color;
  result: "1-0" | "0-1" | "1/2-1/2";
  myResult: "win" | "loss" | "draw";
  termination: string | null;
  timeClass: string | null;
  timeControl: string | null;
  /** Unix seconds. */
  endTime: number | null;
  eco: string | null;
  opening: string | null;
  plyCount: number;
  analysisStatus: AnalysisStatus;
  reviewSummary: ReviewSummary | null;
}

export interface GameDetail extends GameSummary {
  pgn: string;
  analysis: GameAnalysis | null;
  analysisError: string | null;
}

export interface SyncProgress {
  archive: string;
  index: number;
  total: number;
  newGames: number;
}

export interface SyncReport {
  months: number;
  fetched: number;
  newGames: number;
  totalGames: number;
}

export interface WorkerStatus {
  paused: boolean;
  currentGame: number | null;
  ply: number;
  plies: number;
  pending: number;
}

export type ReviewEvent =
  | { type: "progress"; gameId: number; ply: number; plies: number; pending: number }
  | { type: "gameDone"; gameId: number; pending: number }
  | { type: "gameError"; gameId: number; message: string }
  | { type: "status"; status: WorkerStatus };

// ---------- opening explorer (Phase 3) ----------

export type ExplorerSource = "masters" | "lichess" | "mine";

export interface ExplorerMove {
  uci: string;
  san: string;
  averageRating: number | null;
  white: number;
  draws: number;
  black: number;
  opening: { eco: string; name: string } | null;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
}

export interface ExplorerReply {
  result: ExplorerResult | null;
  cached: boolean;
  /** An old cached answer, shown because Lichess couldn't be reached. */
  stale: boolean;
  /** Why Lichess couldn't be asked: "lichessNeedsToken", "lichessRateLimited", ... */
  errorKind: string | null;
  errorDetail: string | null;
}

export type ContextMenuItem = { id: string; label: string; enabled?: boolean } | "separator";

export interface Backend {
  readonly isMock: boolean;
  readonly platform: Platform;
  /** OS version, e.g. "10.0.22631" on Windows 11, "" when unknown. */
  readonly osVersion: string;
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  setupChecks(): Promise<SetupCheck[]>;

  engineStart(): Promise<EngineStatus>;
  engineAnalyze(o: AnalyzeOptions): Promise<void>;
  engineStop(): Promise<void>;
  onEngineEvent(cb: (ev: EngineEvent) => void): Promise<() => void>;

  claudeAsk(r: AskRequest): Promise<AskReply>;
  claudeCancel(): Promise<void>;
  claudeCallsToday(): Promise<number>;

  chesscomArchives(): Promise<Archive[]>;

  gamesSync(): Promise<SyncReport>;
  onSyncProgress(cb: (p: SyncProgress) => void): Promise<() => void>;
  gamesList(): Promise<GameSummary[]>;
  gameGet(id: number): Promise<GameDetail>;
  /** Saves the review summary (for the list) and training cards; returns new cards. */
  gameSaveReview(id: number, summary: ReviewSummary, cards: TrainingCard[]): Promise<number>;
  reviewStatus(): Promise<WorkerStatus>;
  reviewSetPaused(paused: boolean): Promise<void>;
  reviewPrioritize(id: number): Promise<void>;
  reviewReanalyze(id: number): Promise<void>;
  onReviewEvent(cb: (ev: ReviewEvent) => void): Promise<() => void>;

  lichessTokenStatus(): Promise<boolean>;
  lichessTokenSave(token: string): Promise<void>;
  lichessTokenClear(): Promise<void>;
  /** `color` is for "mine": the user's games with that colour. */
  explorerQuery(source: ExplorerSource, fen: string, color?: Color): Promise<ExplorerReply>;

  openUrl(url: string): Promise<void>;
  /** Native menu bar clicks (menu item ids, see src-tauri/src/menu.rs). */
  onMenu(cb: (id: string) => void): Promise<() => void>;
  /** Shows a native right-click menu; resolves with the chosen id (or null). */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
}
