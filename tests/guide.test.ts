import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDE, SERVER_RULES, WAVE_TIMEOUT_SECONDS } from "../src/game/guide";
import { translate, type Locale } from "../src/i18n/strings";
import { JAIL_CELLS_PER_ROOM } from "../src/game/rooms";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const server = read("../server.js");
const sim = read("../src/game/sim/RaidSim.ts");

/** The number a `const NAME = ...;` line in server.js evaluates to. */
function serverConst(name: string): number {
  const match = server.match(new RegExp(`^const ${name} = ([^;]+);`, "m"));
  if (!match) throw new Error(`${name} not found in server.js`);
  return Number(Function(`return (${match[1]});`)());
}

describe("the guide", () => {
  it("quotes the server's own numbers", () => {
    expect(serverConst("BASE_REVIVE_MS")).toBe(SERVER_RULES.reviveSeconds * 1000);
    expect(serverConst("THREAT_DECAY_MS")).toBe(SERVER_RULES.threatDecayMinutes * 60 * 1000);
    expect(serverConst("RAID_PLUNDER_RATE") * 100).toBeCloseTo(SERVER_RULES.plunderPercent);
    expect(serverConst("RAID_PLUNDER_CAP")).toBe(SERVER_RULES.plunderCap);
    expect(serverConst("CONVERT_MS_PER_LEVEL")).toBe(SERVER_RULES.convertSecondsPerLevel * 1000);
    expect(serverConst("ADVENTURER_RETURN_MS")).toBe(SERVER_RULES.adventurerReturnSeconds * 1000);
    expect(serverConst("BARRACKS_MINION_BONUS")).toBe(SERVER_RULES.barracksMinions);
    expect(serverConst("TREASURY_REWARD")).toBe(SERVER_RULES.treasuryGold);
    expect(serverConst("RAID_CHAMPION_REWARD")).toBe(SERVER_RULES.championGold);
    expect(serverConst("JAIL_CELLS_PER_ROOM")).toBe(JAIL_CELLS_PER_ROOM);
  });

  it("quotes the simulation's wave timeout", () => {
    expect(sim).toMatch(new RegExp(`const RAID_TIMEOUT_SECONDS = ${WAVE_TIMEOUT_SECONDS};`));
  });

  it("fills every placeholder in every language", () => {
    const locales: Locale[] = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
    for (const locale of locales) {
      for (const section of GUIDE) {
        expect(translate(locale, section.title)).not.toBe("");
        for (const line of section.lines) {
          const text = translate(locale, line.key, line.vars);
          expect(text, `${locale} ${line.key}`).not.toMatch(/\{\w+\}/);
          expect(text, `${locale} ${line.key}`).toMatch(/^\*\*[^*]+\*\* /);
          if (line.touchKey) {
            const touch = translate(locale, line.touchKey, line.vars);
            expect(touch, `${locale} ${line.touchKey}`).toMatch(/^\*\*[^*]+\*\* /);
          }
        }
      }
    }
  });
});
