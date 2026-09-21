import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/game/guide";
import { translate, type Locale } from "../src/i18n/strings";

describe("the guide", () => {
  it("fills every placeholder in every language, and leads each line in bold", () => {
    const locales: Locale[] = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
    for (const locale of locales) {
      for (const section of GUIDE) {
        expect(translate(locale, section.title)).not.toBe("");
        for (const line of section.lines) {
          const text = translate(locale, line.key, line.vars);
          expect(text, `${locale} ${line.key}`).not.toMatch(/\{\w+\}/);
          expect(text, `${locale} ${line.key}`).toMatch(/^\*\*[^*]+\*\* /);
        }
      }
    }
  });
});
