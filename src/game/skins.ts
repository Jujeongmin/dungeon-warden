import type { StringKey } from "../i18n/strings";
import type { Entitlements } from "./types";

/**
 * What the warden looks like.
 *
 * Cosmetic only: a skin changes the body drawn in the corridor and nothing the
 * simulation reads. There are three ways to have one - the imp everyone starts
 * as, a body earned by the warden's own growth, and one bought in the shop.
 *
 * Adding a skin is a row here plus a model or a tint, and for a paid one the
 * product in server.js PRODUCTS that grants its entitlement.
 */
export type WardenSkinId = "imp" | "puglin" | "ember";

export type SkinUnlock =
  | { kind: "free" }
  | { kind: "level"; level: number }
  | { kind: "entitlement"; key: keyof Entitlements };

export interface WardenSkin {
  id: WardenSkinId;
  label: StringKey;
  /** ModelLibrary key of the body. */
  model: string;
  /** Multiplied into the body's colours, for a skin that is a recolour. */
  tint: number | null;
  /**
   * A colour the whole body smoulders with. A tint alone barely shows on the
   * imp, which is red already - a skin sold in the shop has to look like one.
   */
  glow: number | null;
  unlock: SkinUnlock;
}

export const WARDEN_SKINS: WardenSkin[] = [
  { id: "imp", label: "skin_imp", model: "warden", tint: null, glow: null, unlock: { kind: "free" } },
  // Earned: the warden's third level, reached by what it puts down itself.
  { id: "puglin", label: "skin_puglin", model: "warden_puglin", tint: null, glow: null, unlock: { kind: "level", level: 3 } },
  // Bought: the same imp, charred dark and burning. Product warden_skin_ember in server.js.
  { id: "ember", label: "skin_ember", model: "warden", tint: 0x5a3a2e, glow: 0xff5a1f, unlock: { kind: "entitlement", key: "skinEmber" } },
];

export function skinUnlocked(skin: WardenSkin, wardenLevel: number, entitlements: Entitlements): boolean {
  switch (skin.unlock.kind) {
    case "free":
      return true;
    case "level":
      return wardenLevel >= skin.unlock.level;
    case "entitlement":
      return entitlements[skin.unlock.key] === true;
  }
}

/** The skin to draw: the one chosen if it is still unlocked, the imp otherwise. */
export function activeSkin(chosen: string, wardenLevel: number, entitlements: Entitlements): WardenSkin {
  const skin = WARDEN_SKINS.find((s) => s.id === chosen);
  return skin && skinUnlocked(skin, wardenLevel, entitlements) ? skin : WARDEN_SKINS[0];
}
