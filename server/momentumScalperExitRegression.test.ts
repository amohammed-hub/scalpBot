import { describe, expect, it } from "vitest";
import {
  shouldMomentumScalperLoserTimeout,
  updateMomentumScalperTrailingStop,
} from "./momentumScalperExits";

describe("PDF Step 3 Momentum Scalper exits", () => {
  const entry = 100;
  const now = 10 * 60 * 60 * 1000;
  const enteredAt = now - 60 * 60 * 1000;

  it("times out a losing Demo trade at 60 minutes", () => {
    expect(shouldMomentumScalperLoserTimeout(entry, 95, enteredAt, now)).toBe(true);
    expect(shouldMomentumScalperLoserTimeout(entry, 95, enteredAt, now - 1)).toBe(false);
  });

  it("never applies the loser timeout to a profitable trade", () => {
    expect(shouldMomentumScalperLoserTimeout(entry, 105, enteredAt, now)).toBe(false);
    expect(shouldMomentumScalperLoserTimeout(entry, 100, enteredAt, now)).toBe(true);
  });

  it.each([
    [105, 100, "BREAKEVEN"],
    [110, 105, "LOCK_5"],
    [115, 109, "LOCK_9"],
    [120, 114, "LOCK_14"],
  ] as const)("applies the %s premium ladder stage", (price, expectedSl, stage) => {
    const result = updateMomentumScalperTrailingStop(entry, price, 95, "BUY");
    expect(result.stage).toBe(stage);
    expect(result.currentSl).toBeCloseTo(expectedSl, 8);
  });

  it("never widens a BUY or SELL stop", () => {
    expect(updateMomentumScalperTrailingStop(entry, 110, 106, "BUY").currentSl).toBe(106);
    expect(updateMomentumScalperTrailingStop(entry, 90, 94, "SELL").currentSl).toBe(94);
  });

  it("mirrors the ladder for SELL option-premium positions", () => {
    const result = updateMomentumScalperTrailingStop(entry, 80, 105, "SELL");
    expect(result.stage).toBe("LOCK_14");
    expect(result.currentSl).toBe(86);
  });
});
