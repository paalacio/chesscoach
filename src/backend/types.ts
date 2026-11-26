// The frontend's view of the backend. Two implementations exist:
// - tauri.ts: the real one (Rust commands via `invoke`, events via `listen`);
// - mock.ts:  a fake one with fixture data, so the UI runs in a normal browser.
// These types mirror the Rust structs in src-tauri/src (serde camelCase).

import type { RequestKind } from "../core/context-packet";
import type { CourseAnnotation, CourseInfo } from "../core/course";
import type { GameLine, RepertoireMeta, RepMove, RepNote } from "../core/repertoire";
import type { StoredCard, StoredReview } from "../core/srs";
import type { MistakeInfo } from "../core/trainer";
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
  /** Repertoire builder: min % of games for an opponent reply, min % of your games for a line. */
  repMinShare: number;
  repMinReach: number;
  /** Lines are built this many (full) moves deep. */
  repDepth: number;
  /** Trainer: new moves per day, and the daily goal (cards). */
  newCardsPerDay: number;
  dailyGoal: number;
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
  /** Only return a saved answer; never start a request (error kind "notCached"). */
  cacheOnly?: boolean;
  /** Extra context that changes the answer (notes from an imported course); part of the cache key. */
  variant?: string | null;
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

// ---------- repertoire & trainer (Phase 4) ----------

export interface RepertoireInfo {
  id: number;
  name: string;
  color: Color;
  meta: RepertoireMeta;
  moveCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RepertoireData {
  info: RepertoireInfo;
  moves: RepMove[];
  notes: RepNote[];
  /** Set when the repertoire was imported from a course / book / study. */
  course: CourseInfo | null;
  annotations: CourseAnnotation[];
}

export interface ReviewDay {
  /** Local date, "2026-11-26". */
  day: string;
  count: number;
  /** Cards reviewed for the first time that day (new moves learned). */
  newCards: number;
}

/** Trainer cards and their review history (the training export file holds this). */
export interface SrsData {
  cards: StoredCard[];
  reviews: StoredReview[];
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

  repertoireList(): Promise<RepertoireInfo[]>;
  repertoireCreate(name: string, color: Color, meta: RepertoireMeta): Promise<number>;
  repertoireGet(id: number): Promise<RepertoireData>;
  /** Replaces all the moves of a repertoire. */
  repertoireSaveMoves(id: number, moves: RepMove[]): Promise<void>;
  repertoireUpdate(id: number, name: string | null, meta: RepertoireMeta | null): Promise<void>;
  /** Saves an imported course (the file as it was, and the author's notes) for a repertoire. */
  courseSave(id: number, title: string, fileName: string, pgn: string, annotations: CourseAnnotation[]): Promise<void>;
  repertoireDelete(id: number): Promise<void>;
  /** null leaves that field as it is. */
  repertoireSetNote(id: number, epd: string, note: string | null, why: string | null): Promise<void>;
  srsList(): Promise<StoredCard[]>;
  srsRecord(card: StoredCard, review: StoredReview): Promise<void>;
  srsReviewDays(): Promise<ReviewDay[]>;
  srsExport(): Promise<SrsData>;
  srsImport(data: SrsData): Promise<{ cards: number; reviews: number }>;
  /** "Find the better move" cards from reviewed games. */
  mistakeCards(): Promise<MistakeInfo[]>;
  /** The first moves of the most recent games (for the repertoire report). */
  recentGameMoves(limit?: number, maxPly?: number): Promise<GameLine[]>;

  /** Asks where to save, writes the text; resolves with the file name, or null if cancelled. */
  fileSaveText(defaultName: string, filterName: string, extension: string, contents: string): Promise<string | null>;
  /** Asks for a file and reads it; null if cancelled. */
  fileOpenText(filterName: string, extensions: string[]): Promise<{ name: string; contents: string } | null>;
  /** Saves a copy of the whole database; resolves with the file name, or null if cancelled. */
  dbBackup(): Promise<string | null>;
  /** Replaces all data with a backup (the app reloads afterwards). */
  dbRestore(): Promise<string | null>;

  openUrl(url: string): Promise<void>;
  /** Native menu bar clicks (menu item ids, see src-tauri/src/menu.rs). */
  onMenu(cb: (id: string) => void): Promise<() => void>;
  /** Shows a native right-click menu; resolves with the chosen id (or null). */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
}
