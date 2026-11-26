// Sidebar and the toolbar strip at the top of the content area.

import {
  ArrowDownUp,
  BookOpen,
  ChartLine,
  ClipboardPaste,
  Compass,
  Cpu,
  GraduationCap,
  PanelRight,
  Plus,
  ScanSearch,
  Settings as SettingsIcon,
  Sparkles,
  Stethoscope,
  Swords,
} from "lucide-react";
import type { ReactNode } from "react";
import { backend } from "../backend";
import { useAnalysis } from "../store/analysis";
import { type Page, useApp } from "../store/app";
import { runAction } from "./actions";
import { useOpeningAndPhase } from "./analysis/AnalysisPage";
import { IconButton, Kbd, shortcut } from "./components/controls";

const NAV: { page: Page; label: string; icon: ReactNode; phase?: number }[] = [
  { page: "analysis", label: "Analysis", icon: <ScanSearch /> },
  { page: "games", label: "Games", icon: <Swords />, phase: 2 },
  { page: "explorer", label: "Explorer", icon: <Compass />, phase: 3 },
  { page: "repertoire", label: "Repertoire", icon: <BookOpen />, phase: 4 },
  { page: "train", label: "Train", icon: <GraduationCap />, phase: 4 },
  { page: "insights", label: "Insights", icon: <ChartLine />, phase: 5 },
];

export const PAGE_TITLES: Record<Page, string> = {
  analysis: "Analysis",
  games: "Games",
  explorer: "Explorer",
  repertoire: "Repertoire",
  train: "Train",
  insights: "Insights",
  setup: "Setup",
};

export function Sidebar() {
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const openSheet = useApp((s) => s.openSheet);
  const checks = useApp((s) => s.checks);
  const problems = checks?.filter((c) => c.status === "error").length ?? 0;
  return (
    <aside className="sidebar" aria-label="Sidebar">
      {/* The traffic lights sit here on Mac; the strip moves the window. */}
      <div className="sidebar-top" data-tauri-drag-region />
      <nav className="sidebar-section" aria-label="Sections">
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            className="sidebar-item"
            aria-current={page === item.page ? "page" : undefined}
            onClick={() => setPage(item.page)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="sidebar-item" aria-current={page === "setup" ? "page" : undefined} onClick={() => setPage("setup")}>
          <Stethoscope />
          Setup
          {problems > 0 && <span className="badge" style={{ background: "var(--red)", color: "#fff" }}>{problems}</span>}
        </button>
        <button type="button" className="sidebar-item" onClick={() => openSheet("settings")}>
          <SettingsIcon />
          Settings
        </button>
      </div>
    </aside>
  );
}

export function Toolbar() {
  const page = useApp((s) => s.page);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  return (
    <header className="toolbar" data-tauri-drag-region>
      {page === "analysis" ? <AnalysisTitle /> : (
        <div className="toolbar-title" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{PAGE_TITLES[page]}</h1>
        </div>
      )}
      <div className="toolbar-spacer" data-tauri-drag-region />
      {page === "analysis" && (
        <div className="toolbar-group">
          <AnalysisTools />
          <span className="toolbar-divider" />
          <IconButton label="Show inspector" pressed={inspectorOpen} onClick={() => runAction("toggle-inspector")}>
            <PanelRight />
          </IconButton>
        </div>
      )}
      {backend.isMock && <span className="badge" title="Browser mock mode: fixture data, no real engine or Claude">Mock</span>}
    </header>
  );
}

function AnalysisTitle() {
  const { opening } = useOpeningAndPhase();
  return (
    <div className="toolbar-title" data-tauri-drag-region>
      <h1 data-tauri-drag-region>Analysis</h1>
      <span className="subtitle" data-tauri-drag-region>
        {opening.opening ? `${opening.opening.eco} · ${opening.opening.name}` : "Free analysis"}
      </span>
    </div>
  );
}

function AnalysisTools() {
  const engineOn = useAnalysis((s) => s.engineOn);
  const busy = useAnalysis((s) => !!s.job && s.job.status !== "error");
  return (
    <>
      <IconButton label="New analysis" onClick={() => runAction("new-game")}>
        <Plus />
      </IconButton>
      <IconButton label="Import PGN or FEN" onClick={() => runAction("import")}>
        <ClipboardPaste />
      </IconButton>
      <IconButton label="Flip board (F)" onClick={() => runAction("flip")}>
        <ArrowDownUp />
      </IconButton>
      <IconButton label="Engine on/off (Space)" pressed={engineOn} onClick={() => runAction("toggle-engine")}>
        <Cpu />
      </IconButton>
      <button type="button" className="icon-btn explain-btn" onClick={() => runAction("explain")} disabled={busy} title={`Explain (${shortcut("E")})`}>
        <Sparkles />
        <span className="label">Explain</span>
        <Kbd>{shortcut("E")}</Kbd>
      </button>
    </>
  );
}
