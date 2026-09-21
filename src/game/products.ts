import type { Entitlements } from "./types";

/**
 * What each VX Shop product grants, by product id.
 *
 * The server stores an entitlement under the name a product grants, not under
 * the product's id - `raid_speed_3x` grants `fastForward` - so the shop has
 * to translate before it can tell whether something is already owned.
 * Mirrors PRODUCTS in server.js; tests/products.test.ts pins the two.
 */
export const PRODUCT_GRANTS: Record<string, string> = {
  raid_speed_3x: "fastForward",
};

/** Whether the account already holds what a product sells. */
export function ownsProduct(entitlements: Entitlements, productId: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(PRODUCT_GRANTS, productId)) return false;
  return entitlements[PRODUCT_GRANTS[productId]] === true;
}
