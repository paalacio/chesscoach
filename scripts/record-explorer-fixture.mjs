#!/usr/bin/env node
// Records real Lichess *masters* explorer answers for the browser mock mode
// (src/backend/fixtures/explorer.json):
// - a few positions along the owner's openings (for the Explorer page), and
// - the positions of the three starter repertoires the mock builds (Repertoire and
//   Train pages): from each chosen line, the replies masters play in at least 10%
//   of games, and the most played move for the repertoire's side, 10 half-moves deep.
// The masters endpoint works without a token. One request at a time, with pauses,
// as Lichess asks.
//
//   node scripts/record-explorer-fixture.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { parseUci } from "chessops/util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINES = [
  [],
  ["e4"],
  ["e4", "e5"],
  ["e4", "e5", "Nf3"],
  ["e4", "e5", "Nf3", "Nc6"],
  ["e4", "e5", "Nf3", "Nc6", "Bb5"],
  ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"],
  ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"],
  ["e4", "c5"],
  ["d4"],
  ["d4", "d5", "c4"],
  ["d4", "Nf6", "c4", "g6"],
];

// The mock's starter repertoires (keep in sync with STARTERS in src/backend/mock-study.ts).
const STARTERS = [
  {
    color: "white",
    lines: ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3", "e4 e6 d4 d5 Nd2", "e4 c6 d4 d5 e5"],
  },
  { color: "white", lines: ["d4 d5 c4 e6 Nc3 Nf6 Bg5", "d4 Nf6 c4 g6 Nc3 Bg7 e4"] },
  { color: "black", lines: ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6", "c4 Nf6 Nc3 g6"] },
];
const MAX_PLIES = 10;
const MIN_SHARE = 0.1;
const MAX_REQUESTS = 220;

const epd = (fen) => fen.split(" ").slice(0, 4).join(" ");
const out = {};
let requests = 0;

async function record(fen) {
  const key = epd(fen);
  if (out[key]) return out[key];
  if (requests >= MAX_REQUESTS) return null;
  requests++;
  const url = `https://explorer.lichess.org/masters?moves=12&topGames=0&fen=${encodeURIComponent(`${key} 0 1`)}`;
  const res = await fetch(url, { headers: { "User-Agent": "ChessCoach/0.1 (+https://github.com/paalacio/chesscoach)" } });
  if (res.status === 429) {
    console.log("Lichess asked to slow down; waiting a minute.");
    await new Promise((r) => setTimeout(r, 61_000));
    requests--;
    return record(fen);
  }
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const data = await res.json();
  out[key] = {
    white: data.white,
    draws: data.draws,
    black: data.black,
    opening: data.opening,
    moves: data.moves.map(({ uci, san, averageRating, white, draws, black, opening }) => ({ uci, san, averageRating, white, draws, black, opening })),
  };
  await new Promise((r) => setTimeout(r, 900));
  return out[key];
}

const posFrom = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

// 1. Positions for the Explorer page.
for (const line of LINES) {
  const pos = Chess.default();
  for (const san of line) pos.play(parseSan(pos, san));
  await record(makeFen(pos.toSetup()));
  console.log(`${line.join(" ") || "start"}`);
}

// 2. The starter repertoires, most common positions first.
for (const starter of STARTERS) {
  // Seed moves: position -> the repertoire's chosen move there.
  const seed = new Map();
  for (const line of starter.lines) {
    const pos = Chess.default();
    for (const san of line.split(" ")) {
      const fen = makeFen(pos.toSetup());
      const move = parseSan(pos, san);
      if (!move) throw new Error(`Bad seed move ${san} in ${line}`);
      if ((pos.turn === starter.color) && !seed.has(epd(fen))) seed.set(epd(fen), move);
      pos.play(move);
    }
  }
  const queue = [{ fen: makeFen(Chess.default().toSetup()), ply: 0, reach: 1 }];
  const seen = new Set();
  while (queue.length && requests < MAX_REQUESTS) {
    queue.sort((a, b) => b.reach - a.reach);
    const { fen, ply, reach } = queue.shift();
    if (seen.has(epd(fen)) || ply >= MAX_PLIES) continue;
    seen.add(epd(fen));
    const pos = posFrom(fen);
    const data = await record(fen);
    if (!data) break;
    const total = data.white + data.draws + data.black;
    const next = (move, p) => {
      const after = pos.clone();
      makeSanAndPlay(after, move);
      queue.push({ fen: makeFen(after.toSetup()), ply: ply + 1, reach: reach * p });
    };
    if (pos.turn === starter.color) {
      const move = seed.get(epd(fen)) ?? (data.moves[0] && parseUci(data.moves[0].uci));
      if (move && pos.isLegal(move)) next(move, 1);
    } else {
      for (const m of data.moves) {
        const share = (m.white + m.draws + m.black) / Math.max(1, total);
        const move = parseUci(m.uci);
        if (share >= MIN_SHARE && move && pos.isLegal(move)) next(move, share);
      }
    }
  }
  console.log(`starter (${starter.color}): ${seen.size} positions, ${requests} requests so far`);
}

const dest = path.join(root, "src", "backend", "fixtures", "explorer.json");
fs.writeFileSync(dest, JSON.stringify({ _note: "Real Lichess masters explorer answers (Nov 2026), for mock mode.", masters: out }));
console.log(`Wrote ${path.relative(root, dest)} (${Object.keys(out).length} positions)`);
