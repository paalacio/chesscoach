// The real backend: calls the Rust commands in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform as osPlatform, version as osVersion } from "@tauri-apps/plugin-os";
import type { EngineEvent } from "../core/types";
import {
  type Backend,
  type ContextMenuItem,
  type Platform,
  type ReviewEvent,
  type SyncProgress,
  toBackendError,
} from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toBackendError(e);
  }
}

function detectPlatform(): Platform {
  const p = osPlatform();
  return p === "macos" ? "mac" : p === "windows" ? "windows" : "linux";
}

export function createTauriBackend(): Backend {
  return {
    isMock: false,
    platform: detectPlatform(),
    osVersion: osVersion(),
    appInfo: () => call("app_info"),
    getSettings: () => call("get_settings"),
    saveSettings: (settings) => call("save_settings", { settings }),
    setupChecks: () => call("setup_checks"),

    engineStart: () => call("engine_start"),
    engineAnalyze: (options) => call("engine_analyze", { options }),
    engineStop: () => call("engine_stop"),
    onEngineEvent: (cb) => listen<EngineEvent>("engine:event", (e) => cb(e.payload)),

    claudeAsk: (request) => call("claude_ask", { request }),
    claudeCancel: () => call("claude_cancel"),
    claudeCallsToday: () => call("claude_calls_today"),

    chesscomArchives: () => call("chesscom_archives"),

    gamesSync: () => call("games_sync"),
    onSyncProgress: (cb) => listen<SyncProgress>("sync:progress", (e) => cb(e.payload)),
    gamesList: () => call("games_list"),
    gameGet: (id) => call("game_get", { id }),
    gameSaveReview: (id, summary, cards) => call("game_save_review", { id, summary, cards }),
    reviewStatus: () => call("review_status"),
    reviewSetPaused: (paused) => call("review_set_paused", { paused }),
    reviewPrioritize: (id) => call("review_prioritize", { id }),
    reviewReanalyze: (id) => call("review_reanalyze", { id }),
    onReviewEvent: (cb) => listen<ReviewEvent>("review:event", (e) => cb(e.payload)),

    lichessTokenStatus: () => call("lichess_token_status"),
    lichessTokenSave: (token) => call("lichess_token_save", { token }),
    lichessTokenClear: () => call("lichess_token_clear"),
    explorerQuery: (source, fen, color) => call("explorer_query", { source, fen, color: color ?? null }),

    openUrl: (url) => openUrl(url),
    onMenu: (cb) => listen<string>("menu", (e) => cb(e.payload)),
    async showContextMenu(items: ContextMenuItem[]) {
      return new Promise<string | null>((resolve) => {
        let chosen: string | null = null;
        (async () => {
          const built = await Promise.all(
            items.map((it) =>
              it === "separator"
                ? PredefinedMenuItem.new({ item: "Separator" })
                : MenuItem.new({
                    id: it.id,
                    text: it.label,
                    enabled: it.enabled ?? true,
                    action: (id) => {
                      chosen = id;
                    },
                  }),
            ),
          );
          const menu = await Menu.new({ items: built });
          await menu.popup(); // returns when the menu closes
          // The item action event can arrive just after the menu closes; wait a moment.
          setTimeout(() => resolve(chosen), 60);
        })().catch(() => resolve(null));
      });
    },
  };
}
