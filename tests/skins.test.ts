import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WARDEN_SKINS, activeSkin, skinUnlocked } from "../src/game/skins";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const server = lf(readFileSync(new URL("../server.js", import.meta.url), "utf8"));
const library = lf(readFileSync(new URL("../src/game/assets/ModelLibrary.ts", import.meta.url), "utf8"));

const skin = (id: string) => WARDEN_SKINS.find((s) => s.id === id)!;

/**
 * The warden's looks: one free, one earned, one bought - and whatever is
 * chosen, only what is actually unlocked gets drawn.
 */
describe("warden skins", () => {
  it("start as the imp, which nobody has to earn", () => {
    expect(WARDEN_SKINS[0].id).toBe("imp");
    expect(skinUnlocked(skin("imp"), 1, {})).toBe(true);
    expect(activeSkin("imp", 1, {}).id).toBe("imp");
  });

  it("open the puglin at warden level 3", () => {
    expect(skinUnlocked(skin("puglin"), 2, {})).toBe(false);
    expect(skinUnlocked(skin("puglin"), 3, {})).toBe(true);
  });

  it("open the ember imp only with what the shop grants", () => {
    expect(skinUnlocked(skin("ember"), 6, {})).toBe(false);
    expect(skinUnlocked(skin("ember"), 1, { skinEmber: true })).toBe(true);
  });

  it("fall back to the imp for a choice that is locked or unknown", () => {
    expect(activeSkin("puglin", 2, {}).id).toBe("imp");
    expect(activeSkin("ember", 6, {}).id).toBe("imp");
    expect(activeSkin("nonsense", 6, {}).id).toBe("imp");
  });

  it("are sold by a product that grants each paid skin's entitlement", () => {
    for (const s of WARDEN_SKINS) {
      if (s.unlock.kind !== "entitlement") continue;
      expect(server).toContain(`grants: "${s.unlock.key}"`);
    }
  });

  it("each wear a model the library knows", () => {
    for (const s of WARDEN_SKINS) expect(library).toContain(`  ${s.model}: [`);
  });
});
