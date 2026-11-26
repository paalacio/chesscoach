// Translations: English (en) and Brazilian Portuguese (pt).
//
// Strings live in en.ts and pt.ts as flat "key": "text" maps. pt.ts is typed
// with en's keys, so a missing translation fails the typecheck. Texts can have
// {placeholders}; keys ending in _one/_other are picked by `count`.
//
// In React components:   const t = useT();  t("nav.analysis")
// Outside React:         tNow("toast.copiedFen")

import { useMemo } from "react";
import { useApp } from "../store/app";
import { en } from "./en";
import { pt } from "./pt";

export type Lang = "en" | "pt";
export type MessageKey = keyof typeof en;
type Vars = Record<string, string | number>;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, pt };

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
];

export function langOf(value: string | null | undefined): Lang {
  return value === "pt" ? "pt" : "en";
}

/** BCP 47 locale for dates and numbers. */
export const localeOf = (lang: Lang) => (lang === "pt" ? "pt-BR" : "en-US");

export function hasKey(key: string): key is MessageKey & string {
  return Object.hasOwn(en, key);
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  let text: string = dictionaries[lang][key] ?? en[key] ?? key;
  if (vars && "count" in vars) {
    const form = `${String(key)}_${Number(vars.count) === 1 ? "one" : "other"}`;
    if (hasKey(form)) text = dictionaries[lang][form];
  }
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  return text;
}

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  lang: Lang;
  locale: string;
  /** Translates `prefix + key` if it exists, else returns `fallback` (for open-ended values like concept tags). */
  maybe(prefix: string, key: string, fallback: string, vars?: Vars): string;
}

export function makeTranslator(lang: Lang): Translator {
  const t = ((key: MessageKey, vars?: Vars) => translate(lang, key, vars)) as Translator;
  t.lang = lang;
  t.locale = localeOf(lang);
  t.maybe = (prefix, key, fallback, vars) => {
    const full = `${prefix}${key}`;
    return hasKey(full) ? translate(lang, full, vars) : fallback;
  };
  return t;
}

export function currentLang(): Lang {
  return langOf(useApp.getState().settings?.language);
}

/** Translate outside React (actions, toasts). */
export function tNow(key: MessageKey, vars?: Vars): string {
  return translate(currentLang(), key, vars);
}

/** The translator for the current language; components re-render when it changes. */
export function useT(): Translator {
  const lang = useApp((s) => langOf(s.settings?.language));
  return useMemo(() => makeTranslator(lang), [lang]);
}
