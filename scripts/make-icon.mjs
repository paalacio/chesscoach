#!/usr/bin/env node
// Renders assets/icon.svg to a 1024x1024 PNG with Playwright's Chromium, then
// runs `tauri icon` to produce every size the app bundles need.
//   node scripts/make-icon.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(root, "assets", "icon.svg"), "utf8");
const out = path.join(root, "assets", "icon-1024.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator("svg").screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`Rendered ${path.relative(root, out)}`);

execFileSync("pnpm", ["tauri", "icon", out], { cwd: root, stdio: "inherit" });
fs.copyFileSync(path.join(root, "src-tauri", "icons", "128x128@2x.png"), path.join(root, "public", "app-icon.png"));
