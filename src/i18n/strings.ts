/**
 * UI text.
 *
 * Verse8 is a global platform, so Korean-only would hide the game from most of
 * its audience. One file per language under locales/, rather than strings
 * scattered through components, so a missing translation is a gap in a table
 * rather than a stray Korean sentence in an English build.
 */

import { ko } from "./locales/ko";
import { en } from "./locales/en";
import { ja } from "./locales/ja";
import { zhHant } from "./locales/zh-Hant";
import { zhHans } from "./locales/zh-Hans";

export type Locale = "ko" | "en" | "ja" | "zh-Hant" | "zh-Hans";

/** Each written in its own language — a language picker in English helps nobody. */
export const LOCALE_LABEL: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
};

export type StringKey = keyof typeof ko;

const TABLES: Record<Locale, Record<StringKey, string>> = {
  ko,
  en,
  ja,
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
};

/**
 * Best match for the browser's language.
 *
 * Chinese is the only one that needs more than a prefix: zh-TW, zh-HK and
 * zh-MO are traditional, everything else zh is simplified. Anything unknown
 * gets English rather than Korean, because an unreadable UI is worse than a
 * second language.
 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const tag = navigator.language.toLowerCase();

  if (tag.startsWith("ko")) return "ko";
  if (tag.startsWith("ja")) return "ja";
  if (tag.startsWith("zh")) {
    const traditional = /(hant|tw|hk|mo)/.test(tag);
    return traditional ? "zh-Hant" : "zh-Hans";
  }
  return "en";
}
/**
 * Looks up a string and fills `{name}` placeholders.
 * Falls back to Korean, then to the key itself, so a gap is visible instead of
 * rendering as blank.
 */
export function translate(
  locale: Locale,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const text = TABLES[locale]?.[key] ?? ko[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

