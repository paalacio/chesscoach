// Picks the backend: the real Tauri one inside the app, the mock one in a browser.

import { createMockBackend } from "./mock";
import { createTauriBackend } from "./tauri";
import type { Backend } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// A production build always runs inside the app, so there the mock (and its fixtures)
// is left out of the bundle: `import.meta.env.DEV` is false and the branch is dropped.
export const backend: Backend = __MOCK__ || (import.meta.env.DEV && !inTauri) ? createMockBackend() : createTauriBackend();

export * from "./types";
