// Sidebar and the toolbar strip at the top of the content area.

import {
  ArrowDownUp,
  ArrowLeft,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
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
  WandSparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { backend } from "../backend";
import { type MessageKey, useT } from "../i18n";
import { treeFromPgn } from "../core/game-tree";
import { useAnalysis } from "../store/analysis";
import { useGames } from "../store/games";
import { type Page, useApp } from "../store/app";
import { useRepertoireBoard, useRepertoire } from "../store/repertoire";
import { runAction } from "./actions";
import { useOpeningAndPhase } from "./analysis/AnalysisPage";
import { IconButton, Kbd, shortcut, Spinner } from "./components/controls";
import { opponentOf } from "./games/GamesPage";

const NAV: { page: Page; icon: ReactNode }[] = [
  { page: "analysis", icon: <ScanSearch /> },
  { page: "games", icon: <Swords /> },
  { page: "explorer", icon: <Compass /> },
  { page: "repertoire", icon: <BookOpen /> },
  { page: "train", icon: <GraduationCap /> },
  { page: "insights", icon: <ChartLine /> },
];

/** Translation key of each page's title. */
export const PAGE_TITLE_KEY: Record<Page, MessageKey> = {
  analysis: "page.analysis",
  games: "page.games",
  review: "page.review",
  explorer: "page.explorer",
  repertoire: "page.repertoire",
  train: "page.train",
  insights: "page.insights",
  setup: "page.setup",
};

export function Sidebar() {
  const t = useT();
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const openSheet = useApp((s) => s.openSheet);
  const checks = useApp((s) => s.checks);
  const problems = checks?.filter((c) => c.status === "error").length ?? 0;
  return (
    <aside className="sidebar" aria-label={t("sidebar.title")}>
      {/* The traffic lights sit here on Mac; the strip moves the window. */}
      <div className="sidebar-top" data-tauri-drag-region />
      <nav className="sidebar-section" aria-label={t("sidebar.sections")}>
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            className="sidebar-item"
            aria-current={page === item.page || (item.page === "games" && page === "review") ? "page" : undefined}
            onClick={() => setPage(item.page)}
          >
            {item.icon}
            {t(PAGE_TITLE_KEY[item.page])}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="sidebar-item" aria-current={page === "setup" ? "page" : undefined} onClick={() => setPage("setup")}>
          <Stethoscope />
          {t("page.setup")}
          {problems > 0 && <span className="badge" style={{ background: "var(--red)", color: "#fff" }}>{problems}</span>}
        </button>
        <button type="button" className="sidebar-item" onClick={() => openSheet("settings")}>
          <SettingsIcon />
          {t("page.settings")}
        </button>
      </div>
    </aside>
  );
}

export function Toolbar() {
  const t = useT();
  const page = useApp((s) => s.page);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const repBoard = useRepertoireBoard() && page === "repertoire";
  const board = page === "analysis" || page === "explorer" || repBoard;
  const title =
    page === "analysis" || page === "explorer" || repBoard ? (
      <AnalysisTitle page={page as "analysis" | "explorer" | "repertoire"} />
    ) : page === "review" ? (
      <ReviewTitle />
    ) : page === "games" ? (
      <GamesTitle />
    ) : (
      <div className="toolbar-title" data-tauri-drag-region>
        <h1 data-tauri-drag-region>{t(PAGE_TITLE_KEY[page])}</h1>
      </div>
    );
  return (
    <header className="toolbar" data-tauri-drag-region>
      {title}
      <div className="toolbar-spacer" data-tauri-drag-region />
      {board && <AnalysisTools />}
      {repBoard && (
        <div className="toolbar-group">
          <span className="toolbar-divider" />
          <button type="button" className="icon-btn" onClick={() => useRepertoire.getState().openWizard(true)} title={t("rep.newTitle")}>
            <WandSparkles />
            <span className="label">{t("rep.new")}</span>
          </button>
        </div>
      )}
      {page === "games" && <GamesTools />}
      {page === "review" && <ReviewTools />}
      {(board || page === "review") && (
        <div className="toolbar-group">
          <span className="toolbar-divider" />
          <IconButton label={t("toolbar.inspector")} pressed={inspectorOpen} onClick={() => runAction("toggle-inspector")}>
            <PanelRight />
          </IconButton>
        </div>
      )}
      {backend.isMock && <span className="badge" title={t("toolbar.mockTitle")}>Mock</span>}
    </header>
  );
}

function GamesTitle() {
  const t = useT();
  const games = useGames((s) => s.games);
  return (
    <div className="toolbar-title" data-tauri-drag-region>
      <h1 data-tauri-drag-region>{t("page.games")}</h1>
      <span className="subtitle" data-tauri-drag-region>
        {t("games.subtitle", { count: games.length })}
      </span>
    </div>
  );
}

/** Sync button and the background-analysis status. */
function GamesTools() {
  const t = useT();
  const { syncing, syncProgress, worker, sync, setPaused } = useGames();
  const pending = worker?.pending ?? 0;
  return (
    <div className="toolbar-group">
      {worker && (pending > 0 || worker.paused) && (
        <span className="worker-status small secondary" aria-live="polite">
          {worker.paused
            ? t("games.analysisPaused", { count: pending })
            : worker.currentGame !== null
              ? t("games.analysing", { count: pending, percent: Math.round((worker.ply / Math.max(1, worker.plies)) * 100) })
              : t("games.analysisQueued", { count: pending })}
        </span>
      )}
      {worker && (pending > 0 || worker.paused) && (
        <IconButton
          label={worker.paused ? t("games.resume") : t("games.pause")}
          onClick={() => setPaused(!worker.paused)}
        >
          {worker.paused ? <Play /> : <Pause />}
        </IconButton>
      )}
      <span className="toolbar-divider" />
      <button type="button" className="icon-btn" onClick={sync} disabled={syncing} title={t("games.syncTitle")}>
        {syncing ? <Spinner small /> : <RefreshCw />}
        <span className="label">
          {syncing && syncProgress ? t("games.syncing", { archive: syncProgress.archive, index: syncProgress.index, total: syncProgress.total }) : t("games.sync")}
        </span>
      </button>
    </div>
  );
}

function ReviewTitle() {
  const t = useT();
  const open = useGames((s) => s.open);
  const setPage = useApp((s) => s.setPage);
  const opp = open ? opponentOf(open.detail) : null;
  return (
    <div className="toolbar-title-row" data-tauri-drag-region>
      <IconButton label={t("review.back")} onClick={() => setPage("games")}>
        <ArrowLeft />
      </IconButton>
      <div className="toolbar-title" data-tauri-drag-region>
        <h1 data-tauri-drag-region>{opp ? t("review.title", { opponent: opp.name }) : t("page.review")}</h1>
        <span className="subtitle" data-tauri-drag-region>
          {open?.review?.opening ? `${open.review.opening.eco} · ${open.review.opening.name}` : (open?.detail.opening ?? "")}
        </span>
      </div>
    </div>
  );
}

function ReviewTools() {
  const t = useT();
  const { open, flip, reanalyze } = useGames();
  const setPage = useApp((s) => s.setPage);
  if (!open) return null;
  const toAnalysis = () => {
    // Load the game on the analysis board at the same position.
    const tree = treeFromPgn(open.detail.pgn);
    const a = useAnalysis.getState();
    a.load(tree);
    a.goto(open.moves.slice(0, open.ply).map((m) => m.uci).join(" "));
    setPage("analysis");
  };
  return (
    <div className="toolbar-group">
      <IconButton label={t("toolbar.flip")} onClick={flip}>
        <ArrowDownUp />
      </IconButton>
      <IconButton label={t("review.reanalyze")} onClick={reanalyze} disabled={!open.review}>
        <RotateCw />
      </IconButton>
      <button type="button" className="icon-btn" onClick={toAnalysis} title={t("review.openInAnalysisTitle")}>
        <ScanSearch />
        <span className="label">{t("review.openInAnalysis")}</span>
      </button>
    </div>
  );
}

function AnalysisTitle({ page }: { page: "analysis" | "explorer" | "repertoire" }) {
  const t = useT();
  const { opening } = useOpeningAndPhase();
  const repName = useRepertoire((s) => (s.selected != null ? s.reps[s.selected]?.name : null));
  const openingText = opening.opening ? `${opening.opening.eco} · ${opening.opening.name}` : null;
  return (
    <div className="toolbar-title" data-tauri-drag-region>
      <h1 data-tauri-drag-region>{t(`page.${page}`)}</h1>
      <span className="subtitle" data-tauri-drag-region>
        {page === "repertoire" ? [repName, openingText].filter(Boolean).join(" · ") : (openingText ?? t("toolbar.freeAnalysis"))}
      </span>
    </div>
  );
}

function AnalysisTools() {
  const t = useT();
  const engineOn = useAnalysis((s) => s.engineOn);
  const busy = useAnalysis((s) => !!s.job && s.job.status !== "error");
  return (
    <div className="toolbar-group">
      <IconButton label={t("toolbar.new")} onClick={() => runAction("new-game")}>
        <Plus />
      </IconButton>
      <IconButton label={t("toolbar.import")} onClick={() => runAction("import")}>
        <ClipboardPaste />
      </IconButton>
      <IconButton label={t("toolbar.flip")} onClick={() => runAction("flip")}>
        <ArrowDownUp />
      </IconButton>
      <IconButton label={t("toolbar.engine")} pressed={engineOn} onClick={() => runAction("toggle-engine")}>
        <Cpu />
      </IconButton>
      <button type="button" className="icon-btn explain-btn" onClick={() => runAction("explain")} disabled={busy} title={`${t("toolbar.explain")} (${shortcut("E")})`}>
        <Sparkles />
        <span className="label">{t("toolbar.explain")}</span>
        <Kbd>{shortcut("E")}</Kbd>
      </button>
    </div>
  );
}
