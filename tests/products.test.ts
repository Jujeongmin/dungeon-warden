import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_GRANTS, ownsProduct } from "../src/game/products";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("the shop's products", () => {
  it("grant what the server grants", () => {
    const block = server.slice(server.indexOf("const PRODUCTS = {"), server.indexOf("\n};\n", server.indexOf("const PRODUCTS = {")));
    const rows = [...block.matchAll(/^\s+([a-z0-9_]+): \{ grants: "([A-Za-z]+)"/gm)];
    expect(Object.fromEntries(rows.map((m) => [m[1], m[2]]))).toEqual(PRODUCT_GRANTS);
  });

  it("count as owned by what they grant, not by their id", () => {
    expect(ownsProduct({ fastForward: true }, "raid_speed_3x")).toBe(true);
    expect(ownsProduct({ raid_speed_3x: true }, "raid_speed_3x")).toBe(false);
    expect(ownsProduct({ skinEmber: true }, "warden_skin_ember")).toBe(false);
    expect(ownsProduct({ toString: true } as never, "toString")).toBe(false);
  });
});
