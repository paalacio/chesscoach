import { describe, expect, it } from "vitest";
import { en } from "./en";
import { makeTranslator, translate } from "./index";
import { pt } from "./pt";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  it("Portuguese has exactly the English keys", () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  });

  it("every Portuguese text uses the same {placeholders} as the English one", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(pt[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("no text is left empty or untranslated by accident", () => {
    for (const key of Object.keys(pt) as (keyof typeof en)[]) expect(pt[key].trim(), key).not.toBe("");
  });

  it("fills placeholders and picks plural forms", () => {
    expect(translate("en", "coach.callsToday", { count: 1 })).toBe("1 Claude call today");
    expect(translate("en", "coach.callsToday", { count: 3 })).toBe("3 Claude calls today");
    expect(translate("pt", "coach.callsToday", { count: 1 })).toBe("1 consulta ao Claude hoje");
    expect(translate("pt", "games.analysing", { count: 2, percent: 40 })).toBe("Analisando · 40% · faltam 2");
    expect(translate("pt", "judgement.blunder")).toBe("Capivarada");
  });

  it("translates open-ended values only when known", () => {
    const t = makeTranslator("pt");
    expect(t.maybe("concept.", "king-safety", "king safety")).toBe("segurança do rei");
    expect(t.maybe("concept.", "something-new", "something new")).toBe("something new");
    expect(t.locale).toBe("pt-BR");
  });
});
