// Small React hooks shared by the UI.

import { useEffect, useState } from "react";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
export const useDarkMode = () => useMediaQuery("(prefers-color-scheme: dark)");

/**
 * The accent color as an actual rgb() value. CSS variables can't be used inside
 * chessground's SVG arrows, so we resolve `var(--accent)` with a hidden element.
 * Re-resolved when light/dark changes.
 */
export function useAccentColor(): string {
  const dark = useDarkMode();
  const [color, setColor] = useState("#007aff");
  useEffect(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    probe.style.display = "none";
    document.body.appendChild(probe);
    setColor(getComputedStyle(probe).color || "#007aff");
    probe.remove();
  }, [dark]);
  return color;
}
