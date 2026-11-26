// Tiny transient messages ("Copied FEN") shown at the bottom of the window.

import { create } from "zustand";

interface ToastState {
  message: string | null;
  show(message: string): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show(message) {
    if (timer) clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), 1800);
  },
}));
