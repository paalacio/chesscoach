// The chessground board (the one lichess.org uses), wrapped for React.
// chessground manages its own DOM; we create it once and push changes with `set`.

import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { useEffect, useRef } from "react";

export interface BoardProps {
  fen: string;
  orientation: "white" | "black";
  turn: "white" | "black";
  lastMove?: [string, string];
  check: boolean;
  /** Legal moves: from-square -> to-squares. Empty map = no moves allowed. */
  dests: Map<string, string[]>;
  onMove: (orig: string, dest: string) => void;
  autoShapes: DrawShape[];
  coordinates: boolean;
  /** Board size in px; the board is redrawn when it changes. */
  size: number;
  accent: string;
  reduceMotion: boolean;
}

/** Brushes for arrows/circles: mine are green / red / yellow, the engine's are the accent color. */
function brushes(accent: string) {
  return {
    green: { key: "g", color: "#2f9e44", opacity: 1, lineWidth: 10 },
    red: { key: "r", color: "#e03131", opacity: 1, lineWidth: 10 },
    // chessground maps Alt+right-drag to "blue"; we make it yellow too.
    blue: { key: "b", color: "#e8a400", opacity: 1, lineWidth: 10 },
    yellow: { key: "y", color: "#e8a400", opacity: 1, lineWidth: 10 },
    engine: { key: "e", color: accent, opacity: 0.85, lineWidth: 11 },
    // Moves about as good as the best one: same color, lighter and thinner.
    engineAlt: { key: "a", color: accent, opacity: 0.4, lineWidth: 8 },
  };
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  // Keep the latest callback without re-creating chessground.
  const onMove = useRef(props.onMove);
  onMove.current = props.onMove;

  const config = (): Config => ({
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turn,
    lastMove: props.lastMove as Key[] | undefined,
    check: props.check ? props.turn : false,
    coordinates: props.coordinates,
    animation: { enabled: !props.reduceMotion, duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: {
      free: false,
      color: props.dests.size > 0 ? props.turn : undefined,
      dests: props.dests as Map<Key, Key[]>,
      showDests: true,
      events: { after: (orig, dest) => onMove.current(orig, dest) },
    },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    drawable: {
      enabled: true,
      visible: true,
      autoShapes: props.autoShapes,
      brushes: brushes(props.accent) as unknown as NonNullable<Config["drawable"]>["brushes"],
    },
  });

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, config());
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set(config());
  });

  useEffect(() => {
    api.current?.redrawAll();
  }, [props.size, props.coordinates]);

  return <div ref={el} className="cg-host" style={{ width: "100%", height: "100%" }} />;
}
