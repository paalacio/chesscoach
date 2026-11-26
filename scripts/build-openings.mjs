#!/usr/bin/env node
// Builds src/data/openings.json from the CC0 dataset lichess-org/chess-openings
// (files a.tsv ... e.tsv with columns: eco, name, pgn).
//
// For every opening we play its moves with chessops and store the final position
// as an EPD (a FEN without the move counters), so the app can name a position
// no matter which move order reached it (transpositions).
//
// Output: { "<epd>": ["C65", "Ruy Lopez: Berlin Defense"], ... }

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";

const BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function epd(pos) {
  // makeFen gives "board turn castling ep halfmove fullmove"; keep the first 4 fields.
  return makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");
}

const out = {};
let count = 0;
for (const letter of ["a", "b", "c", "d", "e"]) {
  const res = await fetch(`${BASE}/${letter}.tsv`);
  if (!res.ok) throw new Error(`${letter}.tsv: HTTP ${res.status}`);
  const lines = (await res.text()).trim().split("\n").slice(1); // skip header
  for (const line of lines) {
    const [eco, name, pgn] = line.split("\t");
    const pos = Chess.default();
    for (const token of pgn.split(/\s+/)) {
      if (/^\d+\.+$/.test(token) || token === "") continue; // move numbers like "1." or "3..."
      const move = parseSan(pos, token.replace(/^\d+\.+/, ""));
      if (!move) throw new Error(`Bad move ${token} in ${eco} ${name}`);
      pos.play(move);
    }
    // If two openings reach the same position, keep the first (shorter / more general) name.
    out[epd(pos)] ??= [eco, name];
    count++;
  }
}

fs.mkdirSync(path.join(root, "src", "data"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "data", "openings.json"), JSON.stringify(out));
console.log(`Read ${count} openings, ${Object.keys(out).length} distinct positions -> src/data/openings.json`);
