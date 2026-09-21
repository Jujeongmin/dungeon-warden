import { afterEach, describe, expect, it, vi } from "vitest";
import { BUZZ, buzz } from "../src/game/haptics";

/**
 * A buzz where the device has one, and silence everywhere else.
 *
 * The part worth pinning down is the silence: iOS has no vibration, desktops
 * have nothing to vibrate, and a player can turn it off. None of those may
 * throw, and none of them may vibrate.
 */
describe("buzz", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "vibrate");

  afterEach(() => {
    if (original) Object.defineProperty(navigator, "vibrate", original);
    else Reflect.deleteProperty(navigator, "vibrate");
  });

  const giveVibrate = (fn: (pattern: number | number[]) => boolean) =>
    Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true, writable: true });

  it("vibrates with the pattern it is given, where the device can", () => {
    const vibrate = vi.fn(() => true);
    giveVibrate(vibrate);
    buzz(true, BUZZ.leak);
    expect(vibrate).toHaveBeenCalledWith(BUZZ.leak);
  });

  it("does nothing when the player has turned it off", () => {
    const vibrate = vi.fn(() => true);
    giveVibrate(vibrate);
    buzz(false, BUZZ.place);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("is quietly nothing on a device with no vibration at all", () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
    expect(() => buzz(true, BUZZ.leak)).not.toThrow();
  });

  it("swallows a refusal from the page's permissions policy", () => {
    giveVibrate(() => {
      throw new Error("blocked");
    });
    expect(() => buzz(true, BUZZ.leak)).not.toThrow();
  });
});
