#!/usr/bin/env node
// Records real Stockfish output for a few positions, for the browser mock mode
// (src/backend/fixtures/engine.json). Run after `pnpm fetch-stockfish`:
//   node scripts/record-engine-fixture.mjs [path-to-stockfish]
//
// We keep the info lines at a few depths so the mock can "replay" a search.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const enginePath = process.argv[2] ?? path.join(root, "src-tauri", "binaries", `stockfish-${triple}`);

const POSITIONS = {
  start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 (Ruy Lopez, Closed)
  ruyLopez: "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6",
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 (Black to move)
  ruyLopezRe1: "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQR1K1 b kq - 5 6",
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O (position before 5...Be7)
  ruyLopezO_O: "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5",
};
const KEEP_DEPTHS = new Set([6, 10, 14, 18, 22]);

function record(fen) {
  return new Promise((resolve, reject) => {
    const sf = spawn(enginePath);
    const lines = [];
    let buf = "";
    sf.stdout.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("info") && line.includes(" pv ") && !line.includes("bound")) {
          const depth = Number(line.match(/ depth (\d+)/)[1]);
          if (KEEP_DEPTHS.has(depth)) lines.push(line);
        } else if (line.startsWith("bestmove")) {
          sf.stdin.write("quit\n");
          resolve(lines);
        }
      }
    });
    sf.on("error", reject);
    sf.stdin.write(`uci\nsetoption name Threads value 4\nsetoption name MultiPV value 3\nisready\nposition fen ${fen}\ngo depth 22\n`);
  });
}

const out = {};
for (const [name, fen] of Object.entries(POSITIONS)) {
  out[fen] = { name, lines: await record(fen) };
  console.log(`${name}: ${out[fen].lines.length} lines`);
}
const dest = path.join(root, "src", "backend", "fixtures", "engine.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`Wrote ${path.relative(root, dest)}`);
