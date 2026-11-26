// One place for app actions, used by the native menu bar, keyboard shortcuts and
// toolbar buttons. Menu item ids (src-tauri/src/menu.rs) are the keys.

import { treeToPgn } from "../core/game-tree";
import { tNow } from "../i18n";
import { useAnalysis } from "../store/analysis";
import { type Page, useApp } from "../store/app";
import { useGames } from "../store/games";
import { useToast } from "../store/toast";
import { copyText } from "./components/controls";

export const ACTIONS: Record<string, () => void> = {
  about: () => useApp.getState().openSheet("about"),
  settings: () => useApp.getState().openSheet("settings"),
  setup: () => useApp.getState().setPage("setup"),
  "help-setup": () => useApp.getState().setPage("setup"),
  "new-game": () => {
    useApp.getState().setPage("analysis");
    useAnalysis.getState().newGame();
  },
  import: () => useApp.getState().openSheet("import"),
  "copy-fen": async () => {
    const a = useAnalysis.getState();
    await copyText(a.tree.nodes[a.current].fen);
    useToast.getState().show(tNow("toast.copiedFen"));
  },
  "copy-pgn": async () => {
    await copyText(treeToPgn(useAnalysis.getState().tree));
    useToast.getState().show(tNow("toast.copiedPgn"));
  },
  flip: () => useAnalysis.getState().flip(),
  "toggle-engine": () => {
    const a = useAnalysis.getState();
    a.setEngine(!a.engineOn);
  },
  "toggle-inspector": () => useApp.getState().toggleInspector(),
  explain: () => {
    useApp.getState().setPage("analysis");
    useAnalysis.getState().explain();
  },
  plan: () => {
    useApp.getState().setPage("analysis");
    useAnalysis.getState().explain("positionPlan");
  },
  prev: () => useAnalysis.getState().prev(),
  next: () => useAnalysis.getState().next(),
  first: () => useAnalysis.getState().first(),
  last: () => useAnalysis.getState().last(),
};

for (const page of ["analysis", "games", "explorer", "repertoire", "train", "insights"] as Page[]) {
  ACTIONS[`page:${page}`] = () => useApp.getState().setPage(page);
}

export function runAction(id: string) {
  ACTIONS[id]?.();
}

/** True when typing in a field, so single-key shortcuts must not fire. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/**
 * Keyboard shortcuts. Shortcuts with ⌘/Ctrl are also native menu accelerators in
 * the real app, so there we let the menu handle them (`handleModified = false`)
 * to avoid running them twice.
 */
export function installShortcuts(handleModified: boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    const app = useApp.getState();
    if (app.sheet) return; // sheets handle their own keys
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      if (!handleModified) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = { e: e.shiftKey ? "plan" : "explain", ",": "settings", n: "new-game", o: "import" };
      if (map[k]) {
        e.preventDefault();
        runAction(map[k]);
      }
      return;
    }
    if (typing(e) || e.altKey) return;
    const onAnalysis = app.page === "analysis";
    const keys: Record<string, string> = {
      ArrowLeft: "prev",
      ArrowRight: "next",
      ArrowUp: "first",
      ArrowDown: "last",
      f: "flip",
      F: "flip",
      " ": "toggle-engine",
    };
    if (onAnalysis && keys[e.key]) {
      e.preventDefault();
      runAction(keys[e.key]);
    } else if (app.page === "review") {
      const g = useGames.getState();
      const open = g.open;
      const reviewKeys: Record<string, () => void> = {
        ArrowLeft: () => g.step(-1),
        ArrowRight: () => g.step(1),
        ArrowUp: () => g.goto(0),
        ArrowDown: () => open && g.goto(open.moves.length),
        f: g.flip,
        F: g.flip,
      };
      if (reviewKeys[e.key]) {
        e.preventDefault();
        reviewKeys[e.key]();
      }
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
