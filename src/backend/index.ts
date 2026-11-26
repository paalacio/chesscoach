// Picks the backend: the real Tauri one inside the app, the mock one in a browser.

import { createMockBackend } from "./mock";
import { createTauriBackend } from "./tauri";
import type { Backend } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const backend: Backend = __MOCK__ || !inTauri ? createMockBackend() : createTauriBackend();

export * from "./types";
