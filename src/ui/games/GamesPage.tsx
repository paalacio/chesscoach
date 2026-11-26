// The list of imported games, with filters and the analysis status of each.

import { RefreshCw, Swords } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { GameSummary } from "../../backend";
import { useT } from "../../i18n";
import { useApp } from "../../store/app";
import { filteredGames, useGames } from "../../store/games";
import { errorText } from "../analysis/CoachPanel";
import { Button, Segmented, Spinner } from "../components/controls";

export function opponentOf(g: GameSummary) {
  return g.myColor === "white" ? { name: g.black, elo: g.blackElo } : { name: g.white, elo: g.whiteElo };
}

export function GamesPage() {
  const t = useT();
  const { games, loaded, filter, setFilter, syncing, syncError, worker, init, openGame } = useGames();
  const setPage = useApp((s) => s.setPage);
  const openSheet = useApp((s) => s.openSheet);
  const settings = useApp((s) => s.settings);
  const sync = useGames((s) => s.sync);

  useEffect(() => {
    init();
  }, [init]);

  const shown = useMemo(() => filteredGames(games, filter), [games, filter]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", year: "numeric" }), [t.locale]);

  const open = (id: number) => {
    openGame(id);
    setPage("review");
  };

  if (loaded && games.length === 0) {
    const missing = !settings?.chesscomUsername || !settings?.contactEmail;
    return (
      <div className="page-scroll" style={{ display: "flex" }}>
        <div className="empty-state">
          <Swords />
          <h2>{t("games.emptyTitle")}</h2>
          <p>{missing ? t("games.emptyNeedsSettings") : t("games.emptyText")}</p>
          {missing ? (
            <Button variant="primary" onClick={() => openSheet("settings")}>
              {t("games.openSettings")}
            </Button>
          ) : (
            <Button variant="primary" onClick={sync} disabled={syncing}>
              {syncing ? <Spinner small /> : <RefreshCw />} {t("games.importNow")}
            </Button>
          )}
          {syncError && <p className="error-text">{errorText(t, syncError)}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="games-page">
      <div className="games-filters">
        <Segmented
          label={t("games.filterColor")}
          value={filter.color}
          onChange={(color) => setFilter({ color })}
          options={[
            { value: "all", label: t("games.all") },
            { value: "white", label: t("games.asWhite") },
            { value: "black", label: t("games.asBlack") },
          ]}
        />
        <Segmented
          label={t("games.filterResult")}
          value={filter.result}
          onChange={(result) => setFilter({ result })}
          options={[
            { value: "all", label: t("games.all") },
            { value: "win", label: t("games.wins") },
            { value: "loss", label: t("games.losses") },
            { value: "draw", label: t("games.draws") },
          ]}
        />
        <div className="search-field" style={{ flex: "0 1 240px" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder={t("games.search")}
            aria-label={t("games.search")}
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
          />
        </div>
        <span className="toolbar-spacer" />
        <span className="small secondary">{t("games.count", { count: shown.length })}</span>
      </div>
      {syncError && (
        <div className="callout error games-callout" role="alert">
          {errorText(t, syncError)}
        </div>
      )}

      <div className="games-table" role="table" aria-label={t("page.games")}>
        <div className="games-row head" role="row">
          <span role="columnheader">{t("games.colDate")}</span>
          <span role="columnheader">{t("games.colOpponent")}</span>
          <span role="columnheader">{t("games.colResult")}</span>
          <span role="columnheader">{t("games.colOpening")}</span>
          <span role="columnheader" className="num">
            {t("games.colAccuracy")}
          </span>
        </div>
        {shown.map((g) => {
          const opp = opponentOf(g);
          const s = g.reviewSummary;
          const analysing = worker?.currentGame === g.id;
          return (
            <button key={g.id} type="button" className="games-row" role="row" onClick={() => open(g.id)}>
              <span role="cell" className="secondary tabular">
                {g.endTime ? dateFmt.format(new Date(g.endTime * 1000)) : "–"}
              </span>
              <span role="cell" className="opp">
                <span className={`color-dot ${g.myColor === "white" ? "black" : "white"}`} title={g.myColor === "white" ? t("games.youWhite") : t("games.youBlack")} />
                <span className="opp-name">{opp.name}</span>
                {opp.elo && <span className="secondary tabular">{opp.elo}</span>}
              </span>
              <span role="cell">
                <span className={`badge result ${g.myResult}`}>{t(`result.${g.myResult}`)}</span>
              </span>
              <span role="cell" className="opening-cell">
                {s?.openingEco ?? g.eco ? <span className="eco">{s?.openingEco ?? g.eco}</span> : null} {s?.openingName ?? g.opening ?? ""}
              </span>
              <span role="cell" className="num tabular">
                {s?.accuracy != null ? (
                  <span title={t("games.mistakesTitle", { inaccuracies: s.inaccuracies, mistakes: s.mistakes, blunders: s.blunders })}>
                    {Math.round(s.accuracy)}%
                    {s.blunders > 0 && <span className="glyph blunder"> ??{s.blunders > 1 ? `×${s.blunders}` : ""}</span>}
                  </span>
                ) : analysing ? (
                  <span className="analysing">
                    <Spinner small /> {Math.round(((worker?.ply ?? 0) / Math.max(1, worker?.plies ?? 1)) * 100)}%
                  </span>
                ) : g.analysisStatus === "error" ? (
                  <span className="secondary" title={t("games.analysisFailed")}>!</span>
                ) : (
                  <span className="secondary">{t("games.waiting")}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
