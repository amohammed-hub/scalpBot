import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getMcxRenkoEntryMinimumBrickSize,
  resolveEntryRenkoBrickSize,
} from "./botEngine";

const botEngineSource = readFileSync(new URL("./botEngine.ts", import.meta.url), "utf8");

describe("D8 — frozen Renko ATR entry lattice", () => {
  it("uses a valid session-frozen reference rather than a changing live ATR", () => {
    expect(resolveEntryRenkoBrickSize(2, 7, 1.0)).toBe(7);
    expect(resolveEntryRenkoBrickSize(18, 7, 1.0)).toBe(7);
  });

  it("preserves each strategy's own 1.0x or 0.5x brick multiplier", () => {
    expect(resolveEntryRenkoBrickSize(3, 8, 1.0)).toBe(8);
    expect(resolveEntryRenkoBrickSize(3, 8, 0.5)).toBe(4);
  });

  it("falls back to live ATR only when the stored reference is absent or invalid", () => {
    expect(resolveEntryRenkoBrickSize(6, undefined, 1.0)).toBe(6);
    expect(resolveEntryRenkoBrickSize(6, 0, 1.0)).toBe(6);
    expect(resolveEntryRenkoBrickSize(6, Number.NaN, 0.5)).toBe(3);
  });

  it("enforces a ten-tick entry floor only for recognised MCX instruments", () => {
    // Copper tick size is ₹0.05; its noise floor must be ₹0.50.
    expect(getMcxRenkoEntryMinimumBrickSize("MCX_FO|562048", "MCX_COPPER")).toBeCloseTo(0.5);
    expect(resolveEntryRenkoBrickSize(1, 0.3, 0.5, 0.5)).toBe(0.5);

    // Natural Gas tick size is ₹0.10; its noise floor must be ₹1.00.
    expect(getMcxRenkoEntryMinimumBrickSize("MCX_FO|538685", "MCX_NATGAS")).toBeCloseTo(1);
    expect(resolveEntryRenkoBrickSize(2, 0.3, 0.5, 1)).toBe(1);

    // No unverified floor is inferred for non-MCX instruments.
    expect(getMcxRenkoEntryMinimumBrickSize("NSE_INDEX|Nifty 50", "NIFTY")).toBe(0);
  });

  it("passes one D8 sizing snapshot to every Renko entry generator", () => {
    expect(botEngineSource).toContain("const entryRenkoSizing: RenkoEntrySizing");
    expect(botEngineSource).toContain("generateRenkoSignal(state.candles, undefined, undefined, entryRenkoSizing)");
    expect(botEngineSource).toContain("generatePremiumRenkoSignal(state.candles, undefined, undefined, entryRenkoSizing)");
    expect(botEngineSource).toContain("generateSmartRenkoSignal(state.candles, undefined, undefined, entryRenkoSizing)");
    expect(botEngineSource).toContain("generateAdeebSignal(state.candles, prevDayHigh, prevDayLow, prevDayClose, 0, entryRenkoSizing)");
  });

  it("clears the frozen reference at daily rollover and retains entry-ATR exits", () => {
    expect(botEngineSource).toContain("state.renkoAtrRef = undefined; // Re-freeze the Renko ATR reference after the new day warms up");
    expect(botEngineSource).toContain("state.renkoAtrFrozenAt = undefined;");
    expect(botEngineSource).toContain("state.renkoAtrRef = renkoFreezeAtr;");

    // D8 must never replace open-trade strategy exits with a session-level ATR.
    expect(botEngineSource).toContain("checkRenkoExit(candles, tradeDirection, entryAtr)");
    expect(botEngineSource).toContain("checkSmartRenkoExit(candles, tradeDirection, entryAtr)");
    expect(botEngineSource).toContain("checkAdeebExit(candles, tradeDirection, entryAtr)");
  });
});
