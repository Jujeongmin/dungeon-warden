import { describe, expect, it } from "vitest";
import { minionStatsFor } from "../src/game/sim/units";
import { LOOT_DAMAGE_BONUS, type LootItem, type PlacedMinion } from "../src/game/types";

/**
 * The pairing rule behind "equip best", stated where it can be checked.
 *
 * Kept identical to the body of equipBest in useDungeonSave: the hook needs
 * React to run, and the thing actually worth pinning is the claim that this
 * ordering maximises the garrison's damage — not the setState around it.
 */
function pairing(minions: PlacedMinion[], loot: LootItem[]): Map<string, string | null> {
  const ranked = [...minions].sort(
    (a, b) => minionStatsFor(b, 0).damage - minionStatsFor(a, 0).damage,
  );
  const best = [...loot].sort((a, b) => b.tier - a.tier);
  const assigned = new Map<string, string | null>();
  ranked.forEach((minion, i) => assigned.set(minion.id, best[i]?.id ?? null));
  return assigned;
}

function totalDamage(
  minions: PlacedMinion[],
  loot: LootItem[],
  assigned: Map<string, string | null>,
): number {
  const tierOf = new Map(loot.map((item) => [item.id, item.tier]));
  return minions.reduce((sum, minion) => {
    const tier = tierOf.get(assigned.get(minion.id) ?? "") ?? 0;
    return sum + minionStatsFor(minion, tier).damage;
  }, 0);
}

const warrior = (id: string): PlacedMinion => ({ id, type: "warrior", x: 0, y: 0 });
const mage = (id: string): PlacedMinion => ({ id, type: "mage", x: 0, y: 0 });

describe("equip best", () => {
  it("puts the highest tier on the hardest hitter", () => {
    // Warrior hits for 9, mage for 7, so the T3 belongs on the warrior.
    const minions = [mage("m-mage"), warrior("m-warrior")];
    const loot: LootItem[] = [
      { id: "w-low", srcCls: "knight", tier: 1 },
      { id: "w-high", srcCls: "knight", tier: 3 },
    ];
    const assigned = pairing(minions, loot);
    expect(assigned.get("m-warrior")).toBe("w-high");
    expect(assigned.get("m-mage")).toBe("w-low");
  });

  it("beats every other pairing of the same weapons", () => {
    const minions = [warrior("a"), mage("b"), warrior("c")];
    const loot: LootItem[] = [
      { id: "t1", srcCls: "knight", tier: 1 },
      { id: "t3", srcCls: "knight", tier: 3 },
    ];
    const best = totalDamage(minions, loot, pairing(minions, loot));

    // Every assignment of the two weapons to three minions, one each.
    const ids = minions.map((m) => m.id);
    for (const first of ids) {
      for (const second of ids) {
        if (first === second) continue;
        const rival = new Map<string, string | null>(ids.map((id) => [id, null]));
        rival.set(first, "t3");
        rival.set(second, "t1");
        expect(best).toBeGreaterThanOrEqual(totalDamage(minions, loot, rival));
      }
    }
  });

  it("gives the spare minions nothing rather than sharing a weapon", () => {
    const minions = [warrior("a"), warrior("b"), warrior("c")];
    const loot: LootItem[] = [{ id: "only", srcCls: "knight", tier: 2 }];
    const assigned = pairing(minions, loot);
    const held = [...assigned.values()].filter((w) => w !== null);
    expect(held).toEqual(["only"]);
  });

  it("clears a weapon off anyone the new pairing leaves out", () => {
    // The weak one is holding the loot; re-pairing must take it back rather
    // than leave a second copy in play.
    const minions = [{ ...mage("weak"), weaponId: "t3" }, warrior("strong")];
    const loot: LootItem[] = [{ id: "t3", srcCls: "knight", tier: 3 }];
    const assigned = pairing(minions, loot);
    expect(assigned.get("strong")).toBe("t3");
    expect(assigned.get("weak")).toBeNull();
  });

  it("ranks by unarmed damage, so what a minion already holds cannot move it", () => {
    // A mage carrying a T3 hits as hard as a bare warrior. It is still the mage.
    // (It used to hit harder; the warrior was raised to 10 and they now tie,
    // which is still the case the ordering has to get right.)
    const minions = [{ ...mage("m"), weaponId: "t3" }, warrior("w")];
    const armed = minionStatsFor(minions[0], 3).damage;
    expect(armed).toBeGreaterThanOrEqual(minionStatsFor(minions[1], 0).damage);

    const loot: LootItem[] = [{ id: "t3", srcCls: "knight", tier: 3 }];
    expect(pairing(minions, loot).get("w")).toBe("t3");
  });

  it("scales the bonus off the holder, which is why the ordering matters", () => {
    const w = minionStatsFor(warrior("a"), 0).damage;
    expect(minionStatsFor(warrior("a"), 2).damage).toBe(
      Math.round(w * (1 + LOOT_DAMAGE_BONUS * 2)),
    );
  });
});
