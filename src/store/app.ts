// App-wide state: which page is shown, settings, setup checks, open sheets.

import { create } from "zustand";
import { type AppInfo, backend, type Settings, type SetupCheck, toBackendError } from "../backend";

export type Page = "analysis" | "games" | "review" | "explorer" | "repertoire" | "train" | "insights" | "setup";

interface AppState {
  ready: boolean;
  page: Page;
  settings: Settings | null;
  info: AppInfo | null;
  checks: SetupCheck[] | null;
  checking: boolean;
  inspectorOpen: boolean;
  sheet: null | "settings" | "import" | "about";

  init(): Promise<void>;
  setPage(p: Page): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  runChecks(): Promise<void>;
  finishSetup(): Promise<void>;
  toggleInspector(): void;
  openSheet(s: AppState["sheet"]): void;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  page: "analysis",
  settings: null,
  info: null,
  checks: null,
  checking: false,
  inspectorOpen: true,
  sheet: null,

  async init() {
    const [settings, info] = await Promise.all([backend.getSettings(), backend.appInfo()]);
    // First run: start on the setup screen.
    set({ settings, info, ready: true, page: settings.setupComplete ? "analysis" : "setup" });
  },
  setPage: (page) => set({ page }),
  async saveSettings(patch) {
    const current = get().settings;
    if (!current) return;
    const saved = await backend.saveSettings({ ...current, ...patch });
    set({ settings: saved });
  },
  async runChecks() {
    set({ checking: true });
    try {
      set({ checks: await backend.setupChecks() });
    } catch (e) {
      const err = toBackendError(e);
      set({ checks: [{ id: "app", label: "ChessCoach", status: "error", detail: err.message, fix: null, params: {} }] });
    } finally {
      set({ checking: false });
    }
  },
  async finishSetup() {
    await get().saveSettings({ setupComplete: true });
    set({ page: "analysis" });
  },
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  openSheet: (sheet) => set({ sheet }),
}));
