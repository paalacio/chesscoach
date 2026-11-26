// The repertoire wizard (a full page): your games, your style, Claude's options
// per slot, and building the repertoires you choose.

import { AlertTriangle, Check, Sparkles } from "lucide-react";
import { useEffect } from "react";
import type { Color } from "../../core/types";
import type { Attacking, FirstMove, Style, TheoryAppetite } from "../../core/repertoire-proposal";
import { useT } from "../../i18n";
import { useExplorer } from "../../store/explorer";
import { useRepertoire } from "../../store/repertoire";
import { type ProposalState, useWizard, type WizardFact } from "../../store/wizard";
import { errorText } from "../analysis/CoachPanel";
import { Button, Segmented, Spinner, Switch } from "../components/controls";

const STEPS = ["wizard.step.games", "wizard.step.style", "wizard.step.options", "wizard.step.build"] as const;

export function RepertoireWizard() {
  const t = useT();
  const w = useWizard();
  const hasRepertoires = useRepertoire((s) => s.list.length > 0);

  useEffect(() => {
    if (!w.facts) void w.loadFacts();
  }, [w.facts, w.loadFacts]);

  const sides = (["white", "black"] as Color[]).filter((c) => w.sides[c]);

  return (
    <div className="page-scroll wizard">
      <div className="wizard-inner">
        <header className="wizard-head">
          <h2>{t("wizard.title")}</h2>
          {hasRepertoires && (
            <Button size="small" onClick={() => useRepertoire.getState().openWizard(false)}>
              {t("common.cancel")}
            </Button>
          )}
        </header>
        <ol className="wizard-steps" aria-label={t("wizard.steps")}>
          {STEPS.map((k, i) => (
            <li key={k} aria-current={w.step === i ? "step" : undefined} className={w.step > i ? "done" : ""}>
              <span className="n">{w.step > i ? <Check aria-hidden /> : i + 1}</span>
              {t(k)}
            </li>
          ))}
        </ol>

        {w.step === 0 && (
          <section className="wizard-card">
            <h3>{t("wizard.games.title")}</h3>
            <p className="secondary">{t("wizard.games.text")}</p>
            {!w.facts ? (
              <Spinner />
            ) : w.facts.white.length + w.facts.black.length === 0 ? (
              <div className="callout info">
                <span>{t("wizard.games.none")}</span>
              </div>
            ) : (
              <div className="wizard-facts">
                {(["white", "black"] as Color[]).map((c) => (
                  <div key={c}>
                    <h4>{t(c === "white" ? "color.asWhite" : "color.asBlack")}</h4>
                    <ul>
                      {(w.facts?.[c] ?? []).map((f) => (
                        <li key={f.label}>
                          <FactLine fact={f} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <div className="wizard-nav">
              <Button variant="primary" onClick={() => w.setStep(1)}>
                {t("wizard.next")}
              </Button>
            </div>
          </section>
        )}

        {w.step === 1 && (
          <section className="wizard-card">
            <h3>{t("wizard.style.title")}</h3>
            <div className="field">
              <label>{t("wizard.style.sides")}</label>
              <div className="wizard-row">
                {(["white", "black"] as Color[]).map((c) => (
                  <span key={c} className="wizard-switch">
                    <Switch checked={w.sides[c]} onChange={(v) => w.setSide(c, v)} label={t(c === "white" ? "color.white" : "color.black")} />
                    {t(c === "white" ? "color.white" : "color.black")}
                  </span>
                ))}
              </div>
            </div>
            {w.sides.white && (
              <div className="field">
                <label>{t("wizard.style.firstMove")}</label>
                <div className="chips" role="group" aria-label={t("wizard.style.firstMove")}>
                  {(["e4", "d4"] as FirstMove[]).map((m) => (
                    <button key={m} type="button" className="chip" aria-pressed={w.firstMoves.includes(m)} onClick={() => w.toggleFirstMove(m)}>
                      1.{m}
                    </button>
                  ))}
                </div>
                <p className="hint">{t("wizard.style.firstMoveHint")}</p>
              </div>
            )}
            <div className="field">
              <label>{t("wizard.style.style")}</label>
              <Segmented<Style>
                label={t("wizard.style.style")}
                value={w.answers.style}
                onChange={(style) => w.setAnswers({ style })}
                options={(["solid", "balanced", "sharp"] as Style[]).map((v) => ({ value: v, label: t(`wizard.style.${v}`) }))}
              />
            </div>
            <div className="field">
              <label>{t("wizard.style.theory")}</label>
              <Segmented<TheoryAppetite>
                label={t("wizard.style.theory")}
                value={w.answers.theory}
                onChange={(theory) => w.setAnswers({ theory })}
                options={(["little", "some", "lots"] as TheoryAppetite[]).map((v) => ({ value: v, label: t(`wizard.theory.${v}`) }))}
              />
            </div>
            <div className="field">
              <label>{t("wizard.style.attacking")}</label>
              <Segmented<Attacking>
                label={t("wizard.style.attacking")}
                value={w.answers.attacking}
                onChange={(attacking) => w.setAnswers({ attacking })}
                options={(["attack", "either", "maneuver"] as Attacking[]).map((v) => ({ value: v, label: t(`wizard.attacking.${v}`) }))}
              />
            </div>
            <div className="field">
              <label htmlFor="w-openings">{t("wizard.style.openings")}</label>
              <textarea
                id="w-openings"
                className="text-area small"
                rows={2}
                value={w.answers.openings}
                placeholder={t("wizard.style.openingsPlaceholder")}
                onChange={(e) => w.setAnswers({ openings: e.target.value })}
              />
              <p className="hint">{t("wizard.style.openingsHint")}</p>
            </div>
            <div className="wizard-nav">
              <Button onClick={() => w.setStep(0)}>{t("wizard.back")}</Button>
              <Button
                variant="primary"
                disabled={sides.length === 0}
                onClick={async () => {
                  w.setStep(2);
                  for (const c of sides) if (useWizard.getState().proposals[c]?.status !== "done") await useWizard.getState().ask(c);
                }}
              >
                <Sparkles aria-hidden /> {t("wizard.askClaude")}
              </Button>
            </div>
          </section>
        )}

        {w.step === 2 && (
          <section className="wizard-card wide">
            <h3>{t("wizard.options.title")}</h3>
            <p className="secondary">{t("wizard.options.text")}</p>
            {sides.map((c) => (
              <SideProposal key={c} color={c} state={w.proposals[c]} />
            ))}
            <div className="wizard-nav">
              <Button onClick={() => w.setStep(1)}>{t("wizard.back")}</Button>
              <Button variant="primary" disabled={!sides.some((c) => w.proposals[c]?.status === "done")} onClick={() => w.setStep(3)}>
                {t("wizard.next")}
              </Button>
            </div>
          </section>
        )}

        {w.step === 3 && <BuildStep sides={sides} />}
      </div>
    </div>
  );
}

function FactLine({ fact }: { fact: WizardFact }) {
  const t = useT();
  const label = fact.move ? t(`wizard.fact.${fact.kind}`, { move: fact.move }) : t(`wizard.fact.${fact.kind}`);
  return (
    <span>
      <b>{label}</b> · {t("wizard.fact.games", { count: fact.games, score: Math.round(fact.score) })}
      {fact.top.length > 0 && <span className="secondary"> · {fact.top.join(", ")}</span>}
    </span>
  );
}

function SideProposal({ color, state }: { color: Color; state: ProposalState | undefined }) {
  const t = useT();
  const w = useWizard();
  if (!state || state.status === "idle") return null;
  return (
    <div className="wizard-side">
      <h4>{t(color === "white" ? "color.asWhite" : "color.asBlack")}</h4>
      {state.status === "asking" && (
        <div className="coach-loading" aria-live="polite">
          <div className="coach-step">
            <Spinner small /> {t("wizard.asking")}
          </div>
          <div className="skeleton" style={{ width: "90%" }} />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      )}
      {state.status === "error" && state.error && (
        <div className="callout error">
          <AlertTriangle aria-hidden />
          <span>
            {errorText(t, state.error)}{" "}
            <button type="button" className="link-btn" onClick={() => w.ask(color, true)}>
              {t("common.tryAgain")}
            </button>
          </span>
        </div>
      )}
      {state.status === "done" && state.proposal && (
        <>
          {state.proposal.summary && <p className="wizard-summary">{state.proposal.summary}</p>}
          {state.proposal.dropped > 0 && <p className="hint">{t("wizard.dropped", { count: state.proposal.dropped })}</p>}
          {state.proposal.slots.map(({ slot, options }) => (
            <div key={slot.id} className="wizard-slot">
              <div className="wizard-slot-title">{t.maybe("slot.", slot.id, slot.describe)}</div>
              {options.length === 0 ? (
                <p className="secondary small">{t("wizard.noOptions")}</p>
              ) : (
                <div className="wizard-options" role="radiogroup" aria-label={t.maybe("slot.", slot.id, slot.describe)}>
                  {options.map((o, i) => {
                    const chosen = (w.choices[slot.id] ?? 0) === i;
                    const stats = w.stats[`${slot.id}:${i}`];
                    return (
                      <button
                        key={o.moves}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        className={`wizard-option ${chosen ? "chosen" : ""}`}
                        onClick={() => w.choose(slot.id, i)}
                      >
                        <span className="wizard-option-head">
                          <b>{o.name}</b>
                          {chosen && <Check aria-hidden className="tick" />}
                        </span>
                        <span className="wizard-line">{noBreak(o.moves)}</span>
                        <span className="wizard-badges">
                          <span className="badge">{t(`wizard.style.${o.style}`)}</span>
                          <span className="badge">{t(`wizard.load.${o.theory}`)}</span>
                          {stats === "loading" ? (
                            <Spinner small />
                          ) : stats ? (
                            <span className="small secondary tabular">
                              {t(stats.source === "lichess" ? "wizard.statsLevel" : "wizard.statsMasters", { count: stats.games, score: Math.round(stats.score) })}
                            </span>
                          ) : null}
                        </span>
                        {o.whyForYou && <span className="wizard-why">{o.whyForYou}</span>}
                        <span className="wizard-lists">
                          {o.pros.map((p) => (
                            <span key={p} className="pro">
                              + {p}
                            </span>
                          ))}
                          {o.cons.map((p) => (
                            <span key={p} className="con">
                              − {p}
                            </span>
                          ))}
                        </span>
                        {o.plans.length > 0 && (
                          <span className="wizard-plans small secondary">
                            {t("wizard.plans")}: {o.plans.join(" · ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <p className="hint">
            {state.cached ? t("coach.savedAnswer") : t("wizard.fromClaude")}{" "}
            <button type="button" className="link-btn" onClick={() => w.ask(color, true)}>
              {t("wizard.askAgain")}
            </button>
          </p>
        </>
      )}
    </div>
  );
}

function BuildStep({ sides }: { sides: Color[] }) {
  const t = useT();
  const w = useWizard();
  const list = useRepertoire((s) => s.list);
  const tokenSaved = useExplorer((s) => s.tokenSaved);
  const chosen = sides.flatMap((c) =>
    (w.proposals[c]?.proposal?.slots ?? [])
      .map(({ slot, options }) => ({ slot, option: options[w.choices[slot.id] ?? 0] }))
      .filter((x) => x.option),
  );
  return (
    <section className="wizard-card">
      <h3>{t("wizard.build.title")}</h3>
      <ul className="wizard-chosen">
        {chosen.map(({ slot, option }) => (
          <li key={slot.id}>
            <span className="secondary">{t.maybe("slot.", slot.id, slot.describe)}:</span> <b>{option.name}</b> <span className="wizard-line">{noBreak(option.moves)}</span>
          </li>
        ))}
      </ul>
      <p>{t("wizard.build.text")}</p>
      {tokenSaved === false && <p className="hint">{t("wizard.build.noToken")}</p>}
      {list.length > 0 && <p className="hint">{t("wizard.build.replaces")}</p>}
      <div className="wizard-nav">
        <Button onClick={() => w.setStep(2)}>{t("wizard.back")}</Button>
        <Button variant="primary" disabled={chosen.length === 0 || w.building} onClick={() => void w.buildChosen()}>
          {w.building ? <Spinner small /> : null} {t("wizard.build.button")}
        </Button>
      </div>
    </section>
  );
}

/** Castling with non-breaking hyphens, so "O-O" never wraps in the middle. */
const noBreak = (line: string) => line.replace(/O-O(-O)?/g, (m) => m.replace(/-/g, "\u2011"));
