import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translate, type Locale, type StringKey } from "./strings";

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

const LocaleContext = createContext<{ locale: Locale; t: Translate }>({
  locale: "en",
  t: (key) => translate("en", key),
});

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, t: (key: StringKey, vars?: Record<string, string | number>) => translate(locale, key, vars) }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): Translate {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export { type Locale, type StringKey } from "./strings";
export { LOCALE_LABEL, detectLocale, translate } from "./strings";
