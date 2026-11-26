// First-run setup: checks each dependency and explains how to fix it.

import { AlertCircle, CheckCircle2, Info, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { backend, type CheckStatus, type SetupCheck, toBackendError } from "../../backend";
import { hasKey, type Translator, useT } from "../../i18n";
import { useApp } from "../../store/app";
import { errorText } from "../analysis/CoachPanel";
import { Button, Spinner } from "../components/controls";

const ICON: Record<CheckStatus, React.ReactNode> = {
  ok: <CheckCircle2 className="check-icon ok" aria-hidden />,
  warning: <TriangleAlert className="check-icon warning" aria-hidden />,
  error: <AlertCircle className="check-icon error" aria-hidden />,
  info: <Info className="check-icon info" aria-hidden />,
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

/** Translated label, detail and fix for a check; English from the backend when we don't know the case. */
function checkTexts(t: Translator, c: SetupCheck): { label: string; detail: string; fix: string | null } {
  const params = { ...c.params };
  if (c.params.missing) params.missing = t(`setup.missing.${c.params.missing as "both" | "username" | "contact"}`);
  const label = hasKey(`setup.${c.id}.label`) ? t(`setup.${c.id}.label` as never) : c.label;
  const base = `setup.${c.id}.${c.status}`;
  const detail = hasKey(base) ? t(base, params) : c.detail;
  const fix = hasKey(`${base}.fix`) ? t(`${base}.fix` as never, params) : c.fix;
  return { label, detail, fix };
}

export function SetupPage() {
  const t = useT();
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
        prompt:
          t.lang === "pt"
            ? "Say hello to a new chess student and give one opening tip. Write in Brazilian Portuguese."
            : "Say hello to a new chess student and give one opening tip.",
        force: true,
      });
      const d = r.data as { greeting?: string; tip?: string };
      setHello({ state: "done", text: `${d.greeting ?? ""} ${d.tip ?? ""}`.trim(), json: JSON.stringify(r.data, null, 2) });
    } catch (e) {
      setHello({ state: "error", text: errorText(t, toBackendError(e)) });
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-narrow setup">
        <div className="setup-hero">
          <img src="/app-icon.png" alt="" width={64} height={64} />
          <div>
            <h2>{settings?.setupComplete ? t("setup.titleCheck") : t("setup.titleWelcome")}</h2>
            <p className="secondary">{t("setup.intro")}</p>
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
          {checks?.map((c) => {
            const text = checkTexts(t, c);
            return (
              <div className="group-row check-row" key={c.id} data-status={c.status}>
                {ICON[c.status]}
                <div className="check-text">
                  <div className="check-label">{text.label}</div>
                  <p className="check-detail selectable">{text.detail}</p>
                  {text.fix && <FixText text={text.fix} />}
                  {c.id === "chesscom" && c.status !== "ok" && (
                    <button type="button" className="link-btn small" onClick={() => openSheet("settings")}>
                      {t("setup.openSettings")}
                    </button>
                  )}
                  {c.id === "claudeLogin" && claudeOk && (
                    <div className="claude-test">
                      <Button size="small" onClick={testClaude} disabled={hello.state === "asking"}>
                        <Sparkles /> {t("setup.testClaude")}
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
            );
          })}
        </div>

        <div className="setup-actions">
          <Button onClick={runChecks} disabled={checking}>
            <RefreshCw /> {t("setup.checkAgain")}
          </Button>
          <span className="toolbar-spacer" />
          {blocking && checks && <span className="small secondary">{t("setup.canContinue")}</span>}
          <Button variant="primary" size="large" onClick={finishSetup}>
            {settings?.setupComplete ? t("setup.back") : t("setup.start")}
          </Button>
        </div>
      </div>
    </div>
  );
}
