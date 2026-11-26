#!/usr/bin/env node
// Records real Lichess *masters* explorer answers for a few positions along the
// owner's openings, for the browser mock mode (src/backend/fixtures/explorer.json).
// The masters endpoint works without a token. One request at a time, with pauses,
// as Lichess asks.
//
//   node scripts/record-explorer-fixture.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";

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

const epd = (fen) => fen.split(" ").slice(0, 4).join(" ");
const out = {};
for (const line of LINES) {
  const pos = Chess.default();
  for (const san of line) pos.play(parseSan(pos, san));
  const fen = makeFen(pos.toSetup());
  const url = `https://explorer.lichess.org/masters?moves=12&topGames=0&fen=${encodeURIComponent(`${epd(fen)} 0 1`)}`;
  const res = await fetch(url, { headers: { "User-Agent": "ChessCoach/0.1 (+https://github.com/paalacio/chesscoach)" } });
  if (!res.ok) throw new Error(`${line.join(" ")}: HTTP ${res.status}`);
  const data = await res.json();
  out[epd(fen)] = { white: data.white, draws: data.draws, black: data.black, opening: data.opening, moves: data.moves.map(({ uci, san, averageRating, white, draws, black, opening }) => ({ uci, san, averageRating, white, draws, black, opening })) };
  console.log(`${line.join(" ") || "start"}: ${data.moves.length} moves`);
  await new Promise((r) => setTimeout(r, 1200));
}
const dest = path.join(root, "src", "backend", "fixtures", "explorer.json");
fs.writeFileSync(dest, JSON.stringify({ _note: "Real Lichess masters explorer answers (Nov 2026), for mock mode.", masters: out }));
console.log(`Wrote ${path.relative(root, dest)}`);
