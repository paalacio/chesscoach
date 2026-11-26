// Insights: your results by opening and colour, accuracy per phase over time, your
// most common mistake themes (from Claude's game reviews) and the openings to fix next.

import { ChartLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../../backend";
import { accuracyTrend, type FixItem, type InsightGame, openingsToFix, resultsByOpening, topConcepts, totals, type TrendPoint } from "../../core/insights";
import type { Color, Phase } from "../../core/types";
import { useT } from "../../i18n";
import { useApp } from "../../store/app";
import { useGames } from "../../store/games";
import { conceptLabel, phaseLabel } from "../components/coach";
import { Button, Segmented, Spinner } from "../components/controls";

const PHASES: Phase[] = ["opening", "middlegame", "endgame"];
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x)}%`);

export function InsightsPage() {
  const t = useT();
  const { games, loaded, upgrading, upgradeSummaries } = useGames();
  const setPage = useApp((s) => s.setPage);
  const [concepts, setConcepts] = useState<{ tag: string; count: number }[] | null>(null);
  const [color, setColor] = useState<Color>("white");

  useEffect(() => {
    void upgradeSummaries();
    backend.conceptCounts().then(setConcepts).catch(() => setConcepts([]));
  }, [upgradeSummaries]);

  const data: InsightGame[] = games;
  const all = useMemo(() => totals(data), [data]);
  const rows = useMemo(() => resultsByOpening(data), [data]);
  const trend = useMemo(() => accuracyTrend(data), [data]);
  const fix = useMemo(() => openingsToFix(data), [data]);

  if (!loaded) return <div className="page-scroll insights-center"><Spinner /></div>;
  if (games.length === 0) {
    return (
      <div className="page-scroll" style={{ display: "flex" }}>
        <div className="empty-state">
          <ChartLine />
          <h2>{t("insights.emptyTitle")}</h2>
          <p>{t("insights.emptyText")}</p>
          <Button variant="primary" onClick={() => setPage("games")}>
            {t("insights.openGames")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll insights">
      <div className="insights-inner">
        {upgrading && (
          <p className="small secondary insights-upgrading">
            <Spinner small /> {t("insights.updating", { done: upgrading.done, total: upgrading.total })}
          </p>
        )}

        <section className="stat-row" aria-label={t("insights.overview")}>
          <Stat label={t("insights.games")} value={String(all.games)} />
          <Stat label={t("insights.score")} value={pct(all.score)} />
          <Stat label={t("insights.accuracy")} value={pct(all.accuracy.overall)} />
          {PHASES.map((p) => (
            <Stat key={p} label={t("insights.phaseAccuracy", { phase: phaseLabel(t, p) })} value={pct(all.accuracy[p])} />
          ))}
        </section>

        <section className="insights-card">
          <h3>{t("insights.fixTitle")}</h3>
          {fix.length === 0 ? (
            <p className="secondary">{t("insights.fixNone")}</p>
          ) : (
            <ul className="fix-list">
              {fix.map((f) => (
                <FixRow key={`${f.row.color}|${f.row.family}`} item={f} />
              ))}
            </ul>
          )}
        </section>

        <section className="insights-card">
          <div className="insights-card-head">
            <h3>{t("insights.byOpening")}</h3>
            <Segmented<Color>
              label={t("insights.byOpening")}
              value={color}
              onChange={setColor}
              options={[
                { value: "white", label: t("color.asWhite") },
                { value: "black", label: t("color.asBlack") },
              ]}
            />
          </div>
          <OpeningTable rows={rows.filter((r) => r.color === color)} />
        </section>

        <section className="insights-card">
          <h3>{t("insights.trendTitle")}</h3>
          <p className="small secondary">{t("insights.trendText", { count: trend.window })}</p>
          {trend.points.length < 2 ? <p className="secondary">{t("insights.trendFew")}</p> : <TrendChart points={trend.points} />}
        </section>

        <section className="insights-card">
          <h3>{t("insights.themesTitle")}</h3>
          <p className="small secondary">{t("insights.themesText")}</p>
          {concepts === null ? (
            <Spinner small />
          ) : concepts.length === 0 ? (
            <p className="secondary">{t("insights.themesNone")}</p>
          ) : (
            <ThemeBars items={topConcepts(concepts)} />
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value tabular">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function FixRow({ item }: { item: FixItem }) {
  const t = useT();
  const setFilter = useGames((s) => s.setFilter);
  const setPage = useApp((s) => s.setPage);
  const reason = (r: FixItem["reasons"][number]) =>
    r.kind === "lowScore"
      ? t("insights.reason.lowScore", { score: Math.round(r.score), count: r.games })
      : r.kind === "lowOpeningAccuracy"
        ? t("insights.reason.lowOpeningAccuracy", { accuracy: Math.round(r.accuracy), average: Math.round(r.average) })
        : t("insights.reason.mistakes", { perGame: r.perGame.toFixed(1) });
  return (
    <li className="fix-item">
      <div>
        <b>{item.row.family}</b> <span className="secondary small">· {t(item.row.color === "white" ? "color.asWhite" : "color.asBlack")}</span>
        <ul className="fix-reasons">
          {item.reasons.map((r) => (
            <li key={r.kind}>{reason(r)}</li>
          ))}
        </ul>
      </div>
      <Button
        size="small"
        onClick={() => {
          setFilter({ query: item.row.family, color: item.row.color, result: "all" });
          setPage("games");
        }}
      >
        {t("insights.seeGames")}
      </Button>
    </li>
  );
}

function OpeningTable({ rows }: { rows: ReturnType<typeof resultsByOpening> }) {
  const t = useT();
  if (rows.length === 0) return <p className="secondary">{t("insights.noGamesColor")}</p>;
  return (
    <div className="opening-table" role="table" aria-label={t("insights.byOpening")}>
      <div className="opening-row head" role="row">
        <span role="columnheader">{t("insights.colOpening")}</span>
        <span role="columnheader" className="num">
          {t("insights.colGames")}
        </span>
        <span role="columnheader">{t("insights.colResults")}</span>
        <span role="columnheader" className="num">
          {t("insights.colScore")}
        </span>
        <span role="columnheader" className="num">
          {t("insights.colAccuracy")}
        </span>
      </div>
      {rows.slice(0, 12).map((r) => {
        const w = (100 * r.wins) / r.games;
        const d = (100 * r.draws) / r.games;
        const l = 100 - w - d;
        return (
          <div className="opening-row" role="row" key={r.family}>
            <span role="cell" className="opening-family">
              {r.family}
            </span>
            <span role="cell" className="num tabular">
              {r.games}
            </span>
            <span role="cell" className="wdl-mine" aria-label={t("insights.wdlLabel", { w: r.wins, d: r.draws, l: r.losses })} title={t("insights.wdlLabel", { w: r.wins, d: r.draws, l: r.losses })}>
              {w > 0 && <span className="w" style={{ width: `${w}%` }} />}
              {d > 0 && <span className="d" style={{ width: `${d}%` }} />}
              {l > 0 && <span className="l" style={{ width: `${l}%` }} />}
            </span>
            <span role="cell" className="num tabular">
              {pct(r.score)}
            </span>
            <span role="cell" className="num tabular">
              {pct(r.accuracy)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- accuracy per phase over time (line chart) ----------

const SERIES: { phase: Phase; cls: string }[] = [
  { phase: "opening", cls: "s1" },
  { phase: "middlegame", cls: "s2" },
  { phase: "endgame", cls: "s3" },
];

function TrendChart({ points }: { points: TrendPoint[] }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const pad = { l: 34, r: 92, t: 10, b: 24 };
  const values = points.flatMap((p) => SERIES.map((s) => p[s.phase])).filter((v): v is number => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10);
  const date = (s: number | null) => (s ? new Date(s * 1000).toLocaleDateString(t.locale, { day: "numeric", month: "short" }) : "");

  const path = (phase: Phase) =>
    points
      .map((p, i) => (p[phase] == null ? null : `${x(i).toFixed(1)},${y(p[phase] as number).toFixed(1)}`))
      .filter(Boolean)
      .map((pt, i) => `${i ? "L" : "M"}${pt}`)
      .join(" ");
  const last = points[points.length - 1];
  // End labels, nudged apart so they don't overlap.
  const ends = SERIES.filter((s) => last[s.phase] != null)
    .map((s) => ({ ...s, y: y(last[s.phase] as number) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    <div className="trend" ref={ref}>
      <div className="chart-legend" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.phase}>
            <i className={`swatch ${s.cls}`} /> {phaseLabel(t, s.phase)}
          </span>
        ))}
      </div>
      <svg width={width} height={H} role="img" aria-label={t("insights.trendTitle")}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text className="axis" x={pad.l} y={H - 6}>
          {date(points[0].time)}
        </text>
        <text className="axis" x={width - pad.r} y={H - 6} textAnchor="end">
          {date(last.time)}
        </text>
        {SERIES.map((s) => (
          <path key={s.phase} className={`line ${s.cls}`} d={path(s.phase)} />
        ))}
        {ends.map((s) => (
          <text key={s.phase} className="end-label" x={width - pad.r + 8} y={s.y + 4}>
            {phaseLabel(t, s.phase)} {Math.round(last[s.phase] as number)}
          </text>
        ))}
        {hover != null && (
          <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
            {SERIES.map((s) =>
              points[hover][s.phase] == null ? null : (
                <circle key={s.phase} className={`dot ${s.cls}`} cx={x(hover)} cy={y(points[hover][s.phase] as number)} r={4.5} />
              ),
            )}
          </g>
        )}
        <rect
          className="hit"
          x={pad.l}
          y={pad.t}
          width={width - pad.l - pad.r}
          height={H - pad.t - pad.b}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(x(hover) + 10, width - 170), top: 34 }}>
          <b>{date(points[hover].time)}</b>
          {SERIES.map((s) => (
            <span key={s.phase}>
              <i className={`swatch ${s.cls}`} /> {phaseLabel(t, s.phase)}: {pct(points[hover][s.phase])}
            </span>
          ))}
        </div>
      )}
      <details className="chart-table">
        <summary>{t("insights.showNumbers")}</summary>
        <table>
          <thead>
            <tr>
              <th>{t("insights.colDate")}</th>
              {SERIES.map((s) => (
                <th key={s.phase}>{phaseLabel(t, s.phase)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.slice(-12).map((p, i) => (
              <tr key={i}>
                <td>{date(p.time)}</td>
                {SERIES.map((s) => (
                  <td key={s.phase} className="tabular">
                    {pct(p[s.phase])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------- mistake themes (horizontal bars) ----------

function ThemeBars({ items }: { items: { tag: string; count: number }[] }) {
  const t = useT();
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="theme-bars">
      {items.map((i) => (
        <li key={i.tag} title={t("insights.themeTip", { count: i.count })}>
          <span className="theme-name">{conceptLabel(t, i.tag)}</span>
          <span className="theme-track">
            <span className="theme-bar" style={{ width: `${(100 * i.count) / max}%` }} />
          </span>
          <span className="theme-count tabular">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}
