/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import process from "node:process";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// `pnpm dev` serves the UI for `pnpm tauri dev`.
// `pnpm dev:mock` (mode "mock") serves the same UI in a normal browser with a fake
// backend (src/backend/mock.ts), for screenshots and quick layout work.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __MOCK__: JSON.stringify(mode === "mock"),
  },

  // Vite options tailored for Tauri development:
  // 1. prevent Vite from obscuring Rust errors
  clearScreen: false,
  // 2. Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // 3. tell Vite to ignore watching `src-tauri`
    watch: { ignored: ["**/src-tauri/**"] },
  },

  build: {
    // The bundled opening-names list is ~450 KB. A desktop app loads it from
    // disk, so one big chunk is fine.
    chunkSizeWarningLimit: 1500,
  },

  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
