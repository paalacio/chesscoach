// A fake backend so the UI runs in a normal browser (`pnpm dev:mock`), for
// screenshots and quick layout work. Nothing here talks to Stockfish, Claude
// or the network.
//
// - Engine: replays real Stockfish output recorded for a few positions
//   (fixtures/engine.json); for other positions it makes up plausible lines.
// - Claude: real answers recorded for the Ruy Lopez position after 5...Be7
//   (fixtures/claude.json); a generic answer for other positions.
//
// URL options: ?platform=windows  ?mock=errors (setup problems, Claude not logged in)

import { epdOf, positionFromFen, turnOf } from "../core/chess";
import type { EngineEvent, InfoLine } from "../core/types";
import claudeFixtures from "./fixtures/claude.json";
import engineFixtures from "./fixtures/engine.json";
import {
  type AnalyzeOptions,
  type AskReply,
  type AskRequest,
  type Backend,
  BackendError,
  type ContextMenuItem,
  type Platform,
  type Settings,
  type SetupCheck,
} from "./types";
import type { Chess } from "chessops/chess";
import { makeUci, parseUci } from "chessops/util";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const errorsMode = params.get("mock") === "errors";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RUY_BEFORE = "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5";
const RUY_AFTER = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6";

const DEFAULT_SETTINGS: Settings = {
  chesscomUsername: "muripalas",
  contactEmail: "",
  enginePath: "",
  engineThreads: null,
  engineHashMb: 256,
  multipv: 3,
  claudePath: "",
  claudeModel: "sonnet",
  boardTheme: "brown",
  pieceSet: "cburnett",
  showCoordinates: true,
  setupComplete: true,
};

const SETTINGS_KEY = "chesscoach.mock.settings";

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Parses a raw UCI info line (same rules as src-tauri/src/engine/uci.rs). */
function parseInfo(line: string): InfoLine {
  const t = line.split(/\s+/);
  const num = (k: string) => (t.includes(k) ? Number(t[t.indexOf(k) + 1]) : null);
  const scoreAt = t.indexOf("score");
  return {
    depth: num("depth") ?? 0,
    seldepth: num("seldepth"),
    multipv: num("multipv") ?? 1,
    score: { kind: t[scoreAt + 1] === "mate" ? "mate" : "cp", value: Number(t[scoreAt + 2]) },
    bound: null,
    nodes: num("nodes"),
    nps: num("nps"),
    timeMs: num("time"),
    pv: t.includes("pv") ? t.slice(t.indexOf("pv") + 1) : [],
  };
}

/** A small deterministic hash, so made-up lines are the same on every run. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** All legal moves in UCI (promotions to a queen), in a fixed pseudo-random order. */
function legalUcis(pos: Chess, salt: string): string[] {
  const out: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const promotes = piece?.role === "pawn" && (to >> 3 === 7 || to >> 3 === 0);
      out.push(makeUci({ from, to, promotion: promotes ? "queen" : undefined }));
    }
  }
  return out.sort((a, b) => (hash(salt + a) % 997) - (hash(salt + b) % 997));
}

/** A made-up but legal line starting with `first`. */
function madeUpPv(fen: string, first: string, plies: number): string[] {
  const pos = positionFromFen(fen);
  const pv: string[] = [];
  let uci: string | undefined = first;
  for (let i = 0; i <= plies && uci; i++) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    pv.push(uci);
    pos.play(move);
    uci = legalUcis(pos, `${fen}${i}`)[0];
  }
  return pv;
}

/** Info lines grouped by depth (shallow first), limited to `multipv` lines. */
function framesFor(fen: string, multipv: number): InfoLine[][] {
  const fx = (engineFixtures as Record<string, { lines: string[] }>)[fen];
  if (fx) {
    const infos = fx.lines.map(parseInfo).filter((i) => i.multipv <= multipv);
    const depths = [...new Set(infos.map((i) => i.depth))].sort((a, b) => a - b);
    return depths.map((d) => infos.filter((i) => i.depth === d));
  }
  const legal = legalUcis(positionFromFen(fen), fen);
  if (legal.length === 0) return [];
  const base = (hash(epdOf(fen)) % 90) - 35;
  return [6, 10, 14, 18, 22].map((depth) =>
    legal.slice(0, multipv).map((first, k) => ({
      depth,
      seldepth: depth + 6,
      multipv: k + 1,
      score: { kind: "cp" as const, value: base - k * 14 + ((depth * 7) % 11) - 5 },
      bound: null,
      nodes: depth * 310_000 * (k + 1),
      nps: 5_400_000,
      timeMs: depth * 60,
      pv: madeUpPv(fen, first, 9),
    })),
  );
}

/** A minimal HTML context menu, standing in for the native one. */
function domContextMenu(items: ContextMenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = document.createElement("div");
    menu.className = "mock-context-menu";
    menu.setAttribute("role", "menu");
    for (const it of items) {
      if (it === "separator") {
        menu.appendChild(Object.assign(document.createElement("hr"), {}));
        continue;
      }
      const b = document.createElement("button");
      b.textContent = it.label;
      b.disabled = it.enabled === false;
      b.onclick = () => done(it.id);
      menu.appendChild(b);
    }
    const { x, y } = lastPointer;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    const onDown = (e: MouseEvent) => !menu.contains(e.target as Node) && done(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done(null);
    setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    });
    function done(id: string | null) {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      menu.remove();
      resolve(id);
    }
  });
}
const lastPointer = { x: 0, y: 0 };
if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", (e) => Object.assign(lastPointer, { x: e.clientX, y: e.clientY }), true);
}

/** First move of each engine line, read back from the prompt text (for the generic answer). */
function engineMovesFromPrompt(prompt: string): string[] {
  const section = prompt.split(/ENGINE LINES[^\n]*\n/).at(-1) ?? "";
  const out: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\d+\. \d+\.(?:\.\.)?(\S+)/);
    if (m) out.push(m[1]);
    else if (line.trim() === "") break;
  }
  return out;
}

export function createMockBackend(): Backend {
  const platform: Platform = params.get("platform") === "windows" ? "windows" : "mac";
  let settings = loadSettings();
  let timers: ReturnType<typeof setTimeout>[] = [];
  const listeners = new Set<(ev: EngineEvent) => void>();
  const emit = (ev: EngineEvent) => listeners.forEach((l) => l(ev));
  const answered = new Set<string>();
  let calls = 3;
  let cancel: (() => void) | null = null;

  return {
    isMock: true,
    platform,
    osVersion: "",
    appInfo: async () => ({ version: "0.1.0", dataDir: "~/Library/Application Support/app.chesscoach.desktop", os: platform === "mac" ? "macos" : "windows", defaultThreads: 9 }),
    getSettings: async () => settings,
    async saveSettings(s) {
      settings = s;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      return s;
    },
    async setupChecks(): Promise<SetupCheck[]> {
      await delay(500);
      const contactMissing = !settings.contactEmail.trim();
      return [
        errorsMode
          ? { id: "engine", label: "Chess engine", status: "error", detail: "Stockfish was not found. Reinstall the app or set an engine path in Settings.", fix: "Reinstall ChessCoach, or choose a Stockfish binary under Settings → Engine." }
          : { id: "engine", label: "Chess engine", status: "ok", detail: "Stockfish 19 is ready (9 threads, 256 MB hash)", fix: null },
        errorsMode
          ? { id: "claude", label: "Claude Code", status: "ok", detail: "Found 2.1.311 (Claude Code) at ~/.local/bin/claude", fix: null }
          : { id: "claude", label: "Claude Code", status: "ok", detail: "Found 2.1.311 (Claude Code) at ~/.local/bin/claude", fix: null },
        errorsMode
          ? { id: "claudeLogin", label: "Claude login", status: "error", detail: "Claude Code is not logged in.", fix: "Open a terminal, run  claude  and log in with your Claude account (Pro or Max). Then click Check again." }
          : { id: "claudeLogin", label: "Claude login", status: "ok", detail: "Logged in with a Claude subscription (pro)", fix: null },
        contactMissing
          ? { id: "chesscom", label: "Chess.com", status: "warning", detail: "Missing your Chess.com contact email.", fix: "Add them under Settings → Chess.com. The contact email is only sent to Chess.com, which asks apps to identify themselves." }
          : { id: "chesscom", label: "Chess.com", status: "ok", detail: `Importing games for ${settings.chesscomUsername}`, fix: null },
        { id: "lichess", label: "Lichess explorer", status: "info", detail: "Needed for the opening explorer, which arrives in a later version.", fix: null },
      ];
    },

    async engineStart() {
      if (errorsMode) throw new BackendError("error", "Stockfish was not found. Reinstall the app or set an engine path in Settings.");
      return { running: true, name: "Stockfish 19", path: "(mock)", threads: 9, hashMb: 256 };
    },
    async engineAnalyze(o: AnalyzeOptions) {
      if (errorsMode) throw new BackendError("error", "Stockfish was not found. Reinstall the app or set an engine path in Settings.");
      timers.forEach(clearTimeout);
      timers = [];
      const frames = framesFor(o.fen, o.multipv);
      const limited = o.depth != null || o.movetimeMs != null;
      const step = limited ? 60 : 260;
      frames.forEach((frame, i) => {
        timers.push(
          setTimeout(() => frame.forEach((info) => emit({ type: "info", analysisId: o.analysisId, fen: o.fen, info })), 80 + i * step),
        );
      });
      if (limited || frames.length === 0) {
        const best = frames.at(-1)?.[0]?.pv[0] ?? null;
        timers.push(
          setTimeout(() => emit({ type: "bestMove", analysisId: o.analysisId, fen: o.fen, best, ponder: null }), 100 + frames.length * step),
        );
      }
    },
    async engineStop() {
      timers.forEach(clearTimeout);
      timers = [];
    },
    async onEngineEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async claudeAsk(r: AskRequest): Promise<AskReply> {
      const key = `${r.kind}|${r.fen}|${r.movePlayed}`;
      if (answered.has(key) && !r.force) return { data: pick(r), cached: true, callsToday: calls, model: settings.claudeModel };
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.kind === "hello" ? 700 : 1600);
        cancel = () => {
          clearTimeout(t);
          reject(new BackendError("cancelled", "Cancelled."));
        };
      });
      cancel = null;
      if (errorsMode) {
        throw new BackendError("notLoggedIn", "Claude Code is not logged in. Open a terminal, run `claude` and log in with your Claude account.");
      }
      calls++;
      if (r.kind !== "hello") answered.add(key);
      return { data: pick(r), cached: false, callsToday: calls, model: settings.claudeModel };
    },
    async claudeCancel() {
      cancel?.();
    },
    claudeCallsToday: async () => calls,

    async chesscomArchives() {
      await delay(400);
      if (!settings.contactEmail.trim()) {
        throw new BackendError("chesscom", "Add a contact email in Settings. Chess.com asks apps to include one in every request.");
      }
      return [9, 10, 11].map((month) => ({
        year: 2026,
        month,
        url: `https://api.chess.com/pub/player/${settings.chesscomUsername}/games/2026/${String(month).padStart(2, "0")}`,
      }));
    },

    openUrl: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    onMenu: async () => () => {},
    showContextMenu: domContextMenu,
  };
}

function pick(r: AskRequest): unknown {
  const fx = claudeFixtures as Record<string, unknown>;
  if (r.kind === "hello") return fx.hello;
  if (r.kind === "moveExplanation" && r.fen === RUY_BEFORE && r.movePlayed === "f8e7") return fx.moveExplanation;
  if (r.kind === "positionPlan" && epdOf(r.fen) === epdOf(RUY_AFTER)) return fx.positionPlan;
  // Generic answer: no move names except the engine's own first moves.
  const moves = engineMovesFromPrompt(r.prompt);
  const side = turnOf(r.fen) === "white" ? "White" : "Black";
  if (r.kind === "moveExplanation") {
    return {
      summary: "This is a sample explanation from the mock backend. In the real app, Claude explains the move here.",
      ideas: ["The real answer lists up to three ideas.", "It only mentions moves from the engine lines."],
      better_move: null,
      plan_next: "The real answer gives a plan for the next few moves.",
      concepts: ["development", "center"],
    };
  }
  return {
    summary: `Sample plan from the mock backend for ${side} to move.`,
    phase_focus: "The real answer says what matters most in this phase.",
    plan: ["Finish developing your pieces.", "Castle to keep the king safe.", "Look for a pawn break in the center."],
    opponent_ideas: ["The opponent wants to do the same."],
    candidate_moves: moves.slice(0, 3).map((san) => ({ san, idea: "One of the engine's top moves." })),
    concepts: ["development", "king-safety"],
  };
}
