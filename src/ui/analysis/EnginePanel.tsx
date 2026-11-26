// Engine section of the inspector: on/off switch, depth and speed, top lines.

import { Cpu } from "lucide-react";
import { formatMoves } from "../../core/chess";
import { linesDepth } from "../../core/engine-lines";
import { formatScore } from "../../core/winprob";
import { useT } from "../../i18n";
import { useAnalysis } from "../../store/analysis";
import { useApp } from "../../store/app";
import { Switch } from "../components/controls";

function formatNps(nps: number | null): string {
  if (!nps) return "";
  if (nps >= 1e6) return `${(nps / 1e6).toFixed(1)} Mn/s`;
  return `${Math.round(nps / 1e3)} kn/s`;
}

function formatNodes(nodes: number | null): string {
  if (!nodes) return "";
  if (nodes >= 1e9) return `${(nodes / 1e9).toFixed(1)}B nodes`;
  if (nodes >= 1e6) return `${(nodes / 1e6).toFixed(1)}M nodes`;
  return `${Math.round(nodes / 1e3)}k nodes`;
}

export function EnginePanel() {
  const t = useT();
  const { engineOn, engineName, engineError, lines, linesFen, current, tree, preview } = useAnalysis();
  const setEngine = useAnalysis((s) => s.setEngine);
  const setPreview = useAnalysis((s) => s.setPreview);
  const playPreview = useAnalysis((s) => s.playPreview);
  const setPage = useApp((s) => s.setPage);
  const fen = tree.nodes[current].fen;
  const fresh = linesFen === fen;
  const depth = linesDepth(lines);
  const top = lines[0];
  const thinking = engineOn && (!fresh || lines.length === 0);

  return (
    <section className="panel engine-panel" aria-label={t("engine.title")}>
      <div className="panel-header">
        <Switch checked={engineOn} onChange={setEngine} label={t("engine.toggle")} disabled={!!engineError && !engineName} />
        <span className="engine-name">
          <Cpu aria-hidden />
          {engineName ?? "Stockfish"}
        </span>
        <span className="right engine-stats tabular">
          {engineOn && depth > 0 && fresh && (
            <>
              <span title={t("engine.depthTitle")}>{t("engine.depth", { depth })}</span>
              {top?.nps ? <span title={formatNodes(top.nodes)}>{formatNps(top.nps)}</span> : null}
            </>
          )}
          {thinking && <span className="spinner small" aria-label={t("engine.analysing")} />}
        </span>
      </div>

      {engineError ? (
        <div className="callout error">
          <span>
            {engineError}{" "}
            <button type="button" className="link-btn" onClick={() => setPage("setup")}>
              {t("common.openSetup")}
            </button>
          </span>
        </div>
      ) : (
        <div className={`engine-lines ${engineOn ? "" : "stale"}`} role="list">
          {!engineOn && <p className="secondary small engine-off">{t("engine.off")}</p>}
          {(fresh ? lines : []).map((line, i) => (
            <div key={line.multipv} className={`engine-line ${preview?.line === i ? "previewing" : ""}`} role="listitem">
              <span className={`score tabular ${line.scoreWhite.value >= 0 ? "pos" : "neg"}`}>{formatScore(line.scoreWhite)}</span>
              <span className="pv">
                {line.pvSan.map((san, k) => {
                  const label = formatMoves(fen, line.pvSan.slice(0, k + 1)).split(" ").at(-1) as string;
                  // Show move numbers like "6.Re1 b5 7.Bb3".
                  const text = k === 0 || label.includes(".") ? label : san;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`pv-move ${preview?.line === i && preview.plies === k + 1 ? "active" : ""}`}
                      onClick={() => setPreview({ line: i, plies: k + 1 })}
                      onDoubleClick={() => {
                        setPreview({ line: i, plies: k + 1 });
                        playPreview();
                      }}
                      title={t("engine.pvTitle")}
                    >
                      {text}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
          {engineOn && (!fresh || lines.length === 0) && (
            <>
              <div className="skeleton" style={{ width: "92%" }} />
              <div className="skeleton" style={{ width: "80%" }} />
              <div className="skeleton" style={{ width: "86%" }} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
