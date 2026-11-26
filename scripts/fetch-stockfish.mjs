#!/usr/bin/env node
// Downloads the official Stockfish release binary and puts it where Tauri
// expects a "sidecar": src-tauri/binaries/stockfish-<target-triple>[.exe]
//
// Usage:
//   node scripts/fetch-stockfish.mjs                 # for this machine
//   node scripts/fetch-stockfish.mjs --target x86_64-pc-windows-msvc
//   node scripts/fetch-stockfish.mjs --force         # re-download even if present
//
// Stockfish is GPL-3.0 (https://github.com/official-stockfish/Stockfish).
// Since Stockfish 19 the release ships "universal" builds that pick the best
// CPU code path at runtime, so we no longer choose between avx2/bmi2/etc.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_TAG = "sf_19";
const BASE_URL = `https://github.com/official-stockfish/Stockfish/releases/download/${RELEASE_TAG}`;

// Rust target triple -> release asset name
const ASSETS = {
  "aarch64-apple-darwin": "stockfish-macos-universal.tar.gz",
  "x86_64-apple-darwin": "stockfish-macos-universal.tar.gz",
  "x86_64-pc-windows-msvc": "stockfish-windows-x86-64-universal.zip",
  "aarch64-pc-windows-msvc": "stockfish-windows-arm64-universal.zip",
  "x86_64-unknown-linux-gnu": "stockfish-linux-x86-64-universal.tar.gz",
  "aarch64-unknown-linux-gnu": "stockfish-linux-arm64-universal.tar.gz",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src-tauri", "binaries");

function hostTriple() {
  // `rustc -vV` prints a line like "host: aarch64-apple-darwin"
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("Could not read the host target from `rustc -vV`");
  return line.slice("host:".length).trim();
}

function parseArgs(argv) {
  const args = { target: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--force") args.force = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// Recursively list files under a folder.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const { target: targetArg, force } = parseArgs(process.argv.slice(2));
  const target = targetArg ?? hostTriple();
  const asset = ASSETS[target];
  if (!asset) throw new Error(`No Stockfish build known for target ${target}`);

  const isWindows = target.includes("windows");
  const dest = path.join(outDir, `stockfish-${target}${isWindows ? ".exe" : ""}`);
  if (fs.existsSync(dest) && !force) {
    console.log(`Already present: ${path.relative(root, dest)} (use --force to re-download)`);
    return;
  }

  const url = `${BASE_URL}/${asset}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  console.log(`  ${(bytes.length / 1e6).toFixed(1)} MB, sha256 ${createHash("sha256").update(bytes).digest("hex")}`);

  // Extract into a fresh temp folder. `tar` reads .tar.gz everywhere and also
  // .zip on Windows 10+ (bsdtar), so we need no extra npm packages.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stockfish-"));
  const archive = path.join(tmp, asset);
  fs.writeFileSync(archive, bytes);
  const extractDir = path.join(tmp, "x");
  fs.mkdirSync(extractDir);
  execFileSync("tar", ["-xf", archive, "-C", extractDir], { stdio: "inherit" });

  // The archive contains source + docs + the binary. The binary is the biggest
  // file whose name starts with "stockfish" (and ends in .exe on Windows).
  const candidates = walk(extractDir).filter((p) => {
    const name = path.basename(p).toLowerCase();
    if (!name.startsWith("stockfish")) return false;
    return isWindows ? name.endsWith(".exe") : !name.includes(".");
  });
  if (candidates.length === 0) throw new Error("No Stockfish binary found in the archive");
  const binary = candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(binary, dest);
  if (!isWindows) fs.chmodSync(dest, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Installed ${path.relative(root, dest)}`);
}

main().catch((err) => {
  console.error(`fetch-stockfish: ${err.message}`);
  process.exit(1);
});
