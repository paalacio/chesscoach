// Pages that arrive in later phases. Games already has the Chess.com connection check.

import { BookOpen, ChartLine, Compass, GraduationCap, Swords } from "lucide-react";
import { useState } from "react";
import { type Archive, backend, toBackendError } from "../../backend";
import { useApp } from "../../store/app";
import { Button, Spinner } from "../components/controls";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GamesPage() {
  const settings = useApp((s) => s.settings);
  const openSheet = useApp((s) => s.openSheet);
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; archives?: Archive[]; error?: string }>({
    status: "idle",
  });

  async function check() {
    setState({ status: "loading" });
    try {
      setState({ status: "done", archives: await backend.chesscomArchives() });
    } catch (e) {
      setState({ status: "error", error: toBackendError(e).message });
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <div className="empty-state" style={{ paddingBottom: 20 }}>
          <Swords />
          <h2>Your Chess.com games</h2>
          <p>Importing and reviewing your games arrives in the next version. For now you can check that ChessCoach can reach Chess.com.</p>
        </div>
        <div className="group">
          <div className="group-row" style={{ alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div className="check-label">Chess.com account</div>
              <p className="secondary small">
                {settings?.chesscomUsername ? `Username: ${settings.chesscomUsername}` : "No username yet."}{" "}
                {settings?.contactEmail ? "Contact email set." : "No contact email yet (Chess.com asks for one)."}
              </p>
            </div>
            <Button onClick={() => openSheet("settings")}>Edit…</Button>
            <Button variant="primary" onClick={check} disabled={state.status === "loading"}>
              Check connection
            </Button>
          </div>
          {state.status === "loading" && (
            <div className="group-row">
              <Spinner small /> <span className="secondary">Asking Chess.com for your monthly archives…</span>
            </div>
          )}
          {state.status === "error" && (
            <div className="group-row">
              <div className="callout error" style={{ flex: 1 }}>
                {state.error}
              </div>
            </div>
          )}
          {state.status === "done" && state.archives && (
            <div className="group-row archives">
              <div>
                <div className="check-label">
                  Found {state.archives.length} month{state.archives.length === 1 ? "" : "s"} of games
                </div>
                <div className="archive-chips">
                  {state.archives.map((a) => (
                    <span className="badge" key={a.url}>
                      {MONTHS[a.month - 1]} {a.year}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PLACEHOLDERS = {
  explorer: { icon: <Compass />, title: "Opening explorer", phase: 3, text: "Masters games, games at your rating on Lichess, and your own games, move by move." },
  repertoire: { icon: <BookOpen />, title: "Your repertoire", phase: 4, text: "A wizard that looks at your games and helps you choose openings that suit you." },
  train: { icon: <GraduationCap />, title: "Trainer", phase: 4, text: "Spaced-repetition drills of your repertoire and of your own mistakes." },
  insights: { icon: <ChartLine />, title: "Insights", phase: 5, text: "Results by opening, accuracy per phase over time, and what to fix next." },
};

export function PlaceholderPage({ page }: { page: keyof typeof PLACEHOLDERS }) {
  const p = PLACEHOLDERS[page];
  return (
    <div className="page-scroll" style={{ display: "flex" }}>
      <div className="empty-state">
        {p.icon}
        <h2>{p.title}</h2>
        <p>{p.text}</p>
        <span className="badge">Coming in a later version</span>
      </div>
    </div>
  );
}
