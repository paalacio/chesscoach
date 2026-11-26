import { useEffect } from "react";
import { backend } from "./backend";
import { useAnalysis } from "./store/analysis";
import { useApp } from "./store/app";
import { useToast } from "./store/toast";
import { installShortcuts, runAction } from "./ui/actions";
import { AnalysisPage } from "./ui/analysis/AnalysisPage";
import { GamesPage, PlaceholderPage } from "./ui/pages/OtherPages";
import { SetupPage } from "./ui/pages/SetupPage";
import { Sidebar, Toolbar } from "./ui/Shell";
import { AboutSheet, ImportSheet, SettingsSheet } from "./ui/sheets/Sheets";

export default function App() {
  const { ready, page, init, settings } = useApp();
  const toast = useToast((s) => s.message);

  useEffect(() => {
    init();
    useAnalysis.getState().init();
    const offKeys = installShortcuts(backend.isMock);
    let offMenu: (() => void) | undefined;
    backend.onMenu(runAction).then((off) => (offMenu = off));
    return () => {
      offKeys();
      offMenu?.();
    };
  }, [init]);

  // Keep the analysis store's MultiPV in sync with Settings.
  useEffect(() => {
    if (settings) useAnalysis.setState({ multipv: settings.multipv });
  }, [settings]);

  if (!ready) return <div className="app" />;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Toolbar />
        <div className="page">
          {/* The analysis page stays mounted so the board doesn't reset. */}
          <div style={{ display: page === "analysis" ? "contents" : "none" }}>
            <AnalysisPage />
          </div>
          {page === "setup" && <SetupPage />}
          {page === "games" && <GamesPage />}
          {(page === "explorer" || page === "repertoire" || page === "train" || page === "insights") && <PlaceholderPage page={page} />}
        </div>
      </main>
      <SettingsSheet />
      <ImportSheet />
      <AboutSheet />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
