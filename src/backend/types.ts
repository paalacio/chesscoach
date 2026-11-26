// The frontend's view of the backend. Two implementations exist:
// - tauri.ts: the real one (Rust commands via `invoke`, events via `listen`);
// - mock.ts:  a fake one with fixture data, so the UI runs in a normal browser.
// These types mirror the Rust structs in src-tauri/src (serde camelCase).

import type { RequestKind } from "../core/context-packet";
import type { EngineEvent } from "../core/types";

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
}

export type CheckStatus = "ok" | "warning" | "error" | "info";

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix: string | null;
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

/** Errors from the backend: `kind` is e.g. "notLoggedIn", "usageLimit", "chesscom". */
export class BackendError extends Error {
  constructor(
    public kind: string,
    message: string,
  ) {
    super(message);
  }
}

export function toBackendError(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { kind?: string; message: string };
    return new BackendError(o.kind ?? "error", String(o.message));
  }
  return new BackendError("error", String(e));
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

  openUrl(url: string): Promise<void>;
  /** Native menu bar clicks (menu item ids, see src-tauri/src/menu.rs). */
  onMenu(cb: (id: string) => void): Promise<() => void>;
  /** Shows a native right-click menu; resolves with the chosen id (or null). */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
}
