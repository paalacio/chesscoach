import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/board.css";
import "./styles/pieces.css";
import "./styles/analysis.css";
import "./styles/games.css";
import "./styles/study.css";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { backend } from "./backend";
import { useTrainer } from "./store/trainer";

// Platform styling hooks (see styles/tokens.css):
// data-platform: "mac" | "windows" | "linux"
// data-vibrancy: "on" when the native window effect shows through the sidebar.
const root = document.documentElement;
root.dataset.platform = backend.platform;
// Mica exists from Windows 11 (build 22000); on Windows 10 the sidebar is painted instead.
const windowsBuild = Number(backend.osVersion.split(".")[2] ?? 0);
const windows11 = backend.platform === "windows" && windowsBuild >= 22000;
root.dataset.vibrancy = !backend.isMock && (backend.platform === "mac" || windows11) ? "on" : "off";

// Mock mode only: the browser tests read the trainer's expected move from here.
if (backend.isMock) Object.assign(window, { __trainer: useTrainer });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
