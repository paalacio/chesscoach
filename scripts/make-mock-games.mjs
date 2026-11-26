#!/usr/bin/env node
// Makes up a handful of club-level games for the browser mock mode
// (src/backend/fixtures/games.json): Stockfish plays itself, picking among its
// top moves with some randomness and now and then a random legal move, so the
// games contain amateur-style mistakes. Each game is then analysed like the app
// does (one evaluation per position), so the review screen has real numbers.
//
// The player's name is "{me}"; the mock backend replaces it with the username
// from Settings. These games are invented: they're only for screenshots/tests.
//
//   node scripts/make-mock-games.mjs

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const enginePath = path.join(root, "src-tauri", "binaries", `stockfish-${triple}`);

// A seeded random generator so the output is the same on every run.
let seed = 20261126;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

class Engine {
  constructor() {
    this.p = spawn(enginePath);
    this.buf = "";
    this.waiters = [];
    this.p.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.waiters.forEach((w) => w(line));
      }
    });
    this.send("uci\nsetoption name Threads value 4\nsetoption name Hash value 64");
  }
  send(s) {
    this.p.stdin.write(`${s}\n`);
  }
  /** Returns { lines: [{multipv, score, pv}], best } at the end of the search. */
  search(fen, { depth, multipv = 1 }) {
    return new Promise((resolve) => {
      const lines = new Map();
      const onLine = (line) => {
        if (line.startsWith("info") && line.includes(" pv ") && !line.includes("bound")) {
          const t = line.split(" ");
          const mpv = Number(t[t.indexOf("multipv") + 1] || 1);
          const kind = t[t.indexOf("score") + 1];
          const value = Number(t[t.indexOf("score") + 2]);
          lines.set(mpv, { multipv: mpv, score: { kind, value }, pv: t.slice(t.indexOf("pv") + 1), depth: Number(t[t.indexOf("depth") + 1]) });
        } else if (line.startsWith("bestmove")) {
          this.waiters = this.waiters.filter((w) => w !== onLine);
          resolve({ lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv), best: line.split(" ")[1] });
        }
      };
      this.waiters.push(onLine);
      this.send(`setoption name MultiPV value ${multipv}\nposition fen ${fen}\ngo depth ${depth}`);
    });
  }
  quit() {
    this.send("quit");
  }
}

const fenOf = (pos) => makeFen(pos.toSetup());

/** Plays one game: `opening` moves first, then engine moves with mistakes. */
async function playGame(engine, opening, maxPlies, mistakeRate) {
  const pos = Chess.default();
  const sans = [];
  for (const san of opening) {
    const m = parseSan(pos, san);
    sans.push(makeSanAndPlay(pos, m));
  }
  while (sans.length < maxPlies && !pos.isEnd()) {
    let uci;
    if (rand() < mistakeRate) {
      const moves = [];
      for (const [from, dests] of pos.allDests()) for (const to of dests) moves.push(makeUci({ from, to }));
      uci = moves[Math.floor(rand() * moves.length)];
    } else {
      const { lines } = await engine.search(fenOf(pos), { depth: 8, multipv: 3 });
      const pick = rand() < 0.65 ? 0 : rand() < 0.6 ? 1 : 2;
      uci = (lines[pick] ?? lines[0]).pv[0];
    }
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    // Promotions in made-up games: always a queen.
    if (pos.board.get(move.from)?.role === "pawn" && (move.to >> 3 === 7 || move.to >> 3 === 0)) move.promotion = "queen";
    sans.push(makeSanAndPlay(pos, move));
  }
  const outcome = pos.outcome();
  return { sans, outcome, pos };
}

/** One evaluation per position, White's point of view (like src-tauri/src/review.rs). */
async function analyse(engine, sans) {
  const pos = Chess.default();
  const fens = [fenOf(pos)];
  for (const san of sans) {
    makeSanAndPlay(pos, parseSan(pos, san));
    fens.push(fenOf(pos));
  }
  const evals = [];
  for (const fen of fens) {
    const p = Chess.fromSetup((await import("chessops/fen")).parseFen(fen).unwrap()).unwrap();
    if (p.isEnd()) {
      const score = p.isCheckmate() ? { kind: "mate", value: p.turn === "white" ? -1 : 1 } : { kind: "cp", value: 0 };
      evals.push({ score, best: null, pv: [], depth: 0 });
      continue;
    }
    const { lines, best } = await engine.search(fen, { depth: 12 });
    const top = lines[0];
    const whiteToMove = fen.split(" ")[1] === "w";
    const score = whiteToMove ? top.score : { kind: top.score.kind, value: -top.score.value };
    evals.push({ score, best, pv: top.pv.slice(0, 8), depth: top.depth });
  }
  return { version: 1, engine: "Stockfish 19", depth: 12, evals };
}

function pgnOf(headers, sans, result) {
  const tags = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join("\n");
  const moves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
  return `${tags}\n\n${moves} ${result}\n`;
}

const GAMES = [
  { me: "white", opp: "knightowl_88", oppElo: 1121, myElo: 1098, opening: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"], eco: "C84", name: "Ruy-Lopez-Opening-Morphy-Defense-Closed-Variation", days: 1, mistakes: 0.05 },
  { me: "black", opp: "pawnstorm42", oppElo: 1154, myElo: 1102, opening: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3"], eco: "B56", name: "Sicilian-Defense-Open-Classical-Variation", days: 2, mistakes: 0.06 },
  { me: "white", opp: "gambit_gary", oppElo: 1060, myElo: 1094, opening: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7"], eco: "D53", name: "Queens-Gambit-Declined", days: 3, mistakes: 0.04 },
  { me: "black", opp: "rook_n_roll", oppElo: 1088, myElo: 1089, opening: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O"], eco: "E90", name: "Kings-Indian-Defense-Normal-Variation", days: 5, mistakes: 0.06 },
  { me: "white", opp: "silentbishop", oppElo: 1132, myElo: 1081, opening: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "O-O", "Nxe4"], eco: "C67", name: "Ruy-Lopez-Opening-Berlin-Defense", days: 6, mistakes: 0.07 },
  { me: "black", opp: "queenbee_77", oppElo: 1047, myElo: 1085, opening: ["e4", "c5", "Nc3", "Nc6", "g3", "g6", "Bg2", "Bg7"], eco: "B26", name: "Sicilian-Defense-Closed", days: 8, mistakes: 0.05 },
];

const engine = new Engine();
const out = [];
let id = 1;
for (const g of GAMES) {
  const { sans, outcome } = await playGame(engine, g.opening, 70 + Math.floor(rand() * 30), g.mistakes);
  // Decide a result: real outcome if the game ended, else by the final evaluation.
  let result = "1/2-1/2";
  if (outcome?.winner) result = outcome.winner === "white" ? "1-0" : "0-1";
  else if (!outcome) {
    const pos = Chess.default();
    for (const san of sans) makeSanAndPlay(pos, parseSan(pos, san));
    const { lines } = await engine.search(fenOf(pos), { depth: 12 });
    const s = lines[0].score;
    const whiteToMove = pos.turn === "white";
    const v = s.kind === "mate" ? (s.value > 0 ? 1 : -1) * 2000 : s.value;
    const white = whiteToMove ? v : -v;
    result = white > 250 ? "1-0" : white < -250 ? "0-1" : "1/2-1/2";
  }
  const white = g.me === "white" ? "{me}" : g.opp;
  const black = g.me === "black" ? "{me}" : g.opp;
  const end = Date.UTC(2026, 10, 25 - g.days, 18, 30) / 1000;
  const date = new Date(end * 1000).toISOString().slice(0, 10).replace(/-/g, ".");
  const winner = result === "1-0" ? white : result === "0-1" ? black : null;
  const termination = winner
    ? `${winner} won ${outcome?.winner ? "by checkmate" : "by resignation"}`
    : outcome ? "Game drawn by stalemate" : "Game drawn by agreement";
  const headers = {
    Event: "Live Chess", Site: "Chess.com", Date: date, White: white, Black: black, Result: result,
    ECO: g.eco, ECOUrl: `https://www.chess.com/openings/${g.name}`,
    WhiteElo: g.me === "white" ? g.myElo : g.oppElo, BlackElo: g.me === "black" ? g.myElo : g.oppElo,
    TimeControl: "600", Termination: termination,
  };
  const myResult = result === "1/2-1/2" ? "draw" : (result === "1-0") === (g.me === "white") ? "win" : "loss";
  const analysis = await analyse(engine, sans);
  out.push({
    id: id++,
    url: `https://www.chess.com/game/live/mock-${id}`,
    white, black,
    whiteElo: headers.WhiteElo, blackElo: headers.BlackElo,
    myColor: g.me, result, myResult, termination,
    timeClass: "rapid", timeControl: "600", endTime: end,
    eco: g.eco, opening: g.name.replace(/-/g, " "),
    plyCount: sans.length,
    pgn: pgnOf(headers, sans, result),
    analysis,
  });
  console.log(`${g.eco} ${g.me} ${result} ${sans.length} plies`);
}
engine.quit();
const dest = path.join(root, "src", "backend", "fixtures", "games.json");
fs.writeFileSync(dest, JSON.stringify({ _note: "Made-up games (Stockfish self-play with random mistakes) for the browser mock mode. {me} = the username from Settings.", games: out }));
console.log(`Wrote ${path.relative(root, dest)}`);
