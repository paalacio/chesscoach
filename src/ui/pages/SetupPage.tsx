// First-run setup: checks each dependency and explains how to fix it.

import { AlertCircle, CheckCircle2, Info, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { backend, type CheckStatus, toBackendError } from "../../backend";
import { useApp } from "../../store/app";
import { Button, Spinner } from "../components/controls";

const ICON: Record<CheckStatus, React.ReactNode> = {
  ok: <CheckCircle2 className="check-icon ok" aria-label="OK" />,
  warning: <TriangleAlert className="check-icon warning" aria-label="Warning" />,
  error: <AlertCircle className="check-icon error" aria-label="Problem" />,
  info: <Info className="check-icon info" aria-label="Info" />,
};

/** Shows commands (text between double spaces) in a monospace chip. */
function FixText({ text }: { text: string }) {
  const parts = text.split(/ {2}(.+?) {2}/);
  return (
    <p className="check-fix">
      {parts.map((p, i) => (i % 2 === 1 ? <code key={i} className="selectable">{p}</code> : <span key={i}>{p}</span>))}
    </p>
  );
}

export function SetupPage() {
  const { checks, checking, runChecks, finishSetup, settings, openSheet } = useApp();
  const [hello, setHello] = useState<{ state: "idle" | "asking" | "done" | "error"; text?: string; json?: string }>({ state: "idle" });

  useEffect(() => {
    if (!checks && !checking) runChecks();
  }, [checks, checking, runChecks]);

  const blocking = checks?.some((c) => c.status === "error") ?? true;
  const claudeOk = checks?.find((c) => c.id === "claudeLogin")?.status === "ok";

  async function testClaude() {
    setHello({ state: "asking" });
    try {
      const r = await backend.claudeAsk({
        kind: "hello",
        fen: "-",
        movePlayed: null,
        prompt: "Say hello to a new chess student and give one opening tip.",
        force: true,
      });
      const d = r.data as { greeting?: string; tip?: string };
      setHello({ state: "done", text: `${d.greeting ?? ""} ${d.tip ?? ""}`.trim(), json: JSON.stringify(r.data, null, 2) });
    } catch (e) {
      setHello({ state: "error", text: toBackendError(e).message });
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-narrow setup">
        <div className="setup-hero">
          <img src="/app-icon.png" alt="" width={64} height={64} />
          <div>
            <h2>{settings?.setupComplete ? "Setup check" : "Welcome to ChessCoach"}</h2>
            <p className="secondary">
              Stockfish calculates the moves, Claude explains them. ChessCoach needs a few things on this computer; here's how they
              look.
            </p>
          </div>
        </div>

        <div className="group" aria-busy={checking}>
          {!checks &&
            [0, 1, 2, 3].map((i) => (
              <div className="group-row" key={i}>
                <Spinner small />
                <div className="skeleton" style={{ width: `${50 + i * 9}%`, marginTop: 3 }} />
              </div>
            ))}
          {checks?.map((c) => (
            <div className="group-row check-row" key={c.id} data-status={c.status}>
              {ICON[c.status]}
              <div className="check-text">
                <div className="check-label">{c.label}</div>
                <p className="check-detail selectable">{c.detail}</p>
                {c.fix && <FixText text={c.fix} />}
                {c.id === "chesscom" && c.status !== "ok" && (
                  <button type="button" className="link-btn small" onClick={() => openSheet("settings")}>
                    Open Settings…
                  </button>
                )}
                {c.id === "claudeLogin" && claudeOk && (
                  <div className="claude-test">
                    <Button size="small" onClick={testClaude} disabled={hello.state === "asking"}>
                      <Sparkles /> Send a test question
                    </Button>
                    {hello.state === "asking" && <Spinner small />}
                    {hello.state === "done" && (
                      <details className="claude-answer">
                        <summary>{hello.text}</summary>
                        <pre className="selectable">{hello.json}</pre>
                      </details>
                    )}
                    {hello.state === "error" && <span className="error-text">{hello.text}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="setup-actions">
          <Button onClick={runChecks} disabled={checking}>
            <RefreshCw /> Check again
          </Button>
          <span className="toolbar-spacer" />
          {blocking && checks && <span className="small secondary">You can continue, but some features won't work yet.</span>}
          <Button variant="primary" size="large" onClick={finishSetup}>
            {settings?.setupComplete ? "Back to analysis" : "Start analysing"}
          </Button>
        </div>
      </div>
    </div>
  );
}
