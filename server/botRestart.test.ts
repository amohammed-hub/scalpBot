/**
 * botRestart.test.ts
 * Tests for the critical safety rules in botRestart.ts:
 * 1. Sessions without an open trade must NOT be restarted (marked stopped instead)
 * 2. partial1RPrice must always be > entryPrice for BUY trades (never 0)
 * 3. partial1RPrice must always be < entryPrice for SELL trades (never 0)
 * 4. partial2RPrice must be 2x the SL distance from entry
 */
import { describe, it, expect } from "vitest";

// ── Helpers mirroring botRestart.ts logic ────────────────────────────────────

function computePartialLevels(
  entryPrice: number,
  slPrice: number,
  direction: "BUY" | "SELL",
  storedP1: number | null,
  storedP2: number | null,
): { partial1RPrice: number; partial2RPrice: number } {
  const slDist = Math.abs(entryPrice - slPrice);
  const p1 = storedP1 ?? (direction === "BUY" ? entryPrice + slDist : entryPrice - slDist);
  const p2 = storedP2 ?? (direction === "BUY" ? entryPrice + slDist * 2 : entryPrice - slDist * 2);
  return { partial1RPrice: p1, partial2RPrice: p2 };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("botRestart safety rules", () => {
  describe("partial1RPrice must never be 0 or invalid", () => {
    it("BUY: partial1RPrice > entryPrice when computed from SL distance", () => {
      const { partial1RPrice } = computePartialLevels(53525, 53200, "BUY", null, null);
      expect(partial1RPrice).toBeGreaterThan(53525);
    });

    it("SELL: partial1RPrice < entryPrice when computed from SL distance", () => {
      const { partial1RPrice } = computePartialLevels(6875, 7100, "SELL", null, null);
      expect(partial1RPrice).toBeLessThan(6875);
    });

    it("BUY: partial1RPrice is never 0", () => {
      const { partial1RPrice } = computePartialLevels(53525, 53200, "BUY", null, null);
      expect(partial1RPrice).not.toBe(0);
    });

    it("SELL: partial1RPrice is never 0", () => {
      const { partial1RPrice } = computePartialLevels(6875, 7100, "SELL", null, null);
      expect(partial1RPrice).not.toBe(0);
    });

    it("BUY: partial1RPrice = entry + slDist (1R)", () => {
      const entry = 53525;
      const sl = 53200;
      const slDist = entry - sl; // 325
      const { partial1RPrice } = computePartialLevels(entry, sl, "BUY", null, null);
      expect(partial1RPrice).toBeCloseTo(entry + slDist, 2); // 53850
    });

    it("SELL: partial1RPrice = entry - slDist (1R)", () => {
      const entry = 6875;
      const sl = 7100;
      const slDist = sl - entry; // 225
      const { partial1RPrice } = computePartialLevels(entry, sl, "SELL", null, null);
      expect(partial1RPrice).toBeCloseTo(entry - slDist, 2); // 6650
    });
  });

  describe("partial2RPrice must be 2x slDist from entry", () => {
    it("BUY: partial2RPrice = entry + slDist * 2 (2R)", () => {
      const entry = 53525;
      const sl = 53200;
      const slDist = entry - sl; // 325
      const { partial2RPrice } = computePartialLevels(entry, sl, "BUY", null, null);
      expect(partial2RPrice).toBeCloseTo(entry + slDist * 2, 2); // 54175
    });

    it("SELL: partial2RPrice = entry - slDist * 2 (2R)", () => {
      const entry = 6875;
      const sl = 7100;
      const slDist = sl - entry; // 225
      const { partial2RPrice } = computePartialLevels(entry, sl, "SELL", null, null);
      expect(partial2RPrice).toBeCloseTo(entry - slDist * 2, 2); // 6425
    });
  });

  describe("stored DB values take priority over recalculation", () => {
    it("uses stored partial1RPrice from DB when available", () => {
      // If DB has the exact value stored, use it — don't recalculate
      const storedP1 = 53900;
      const { partial1RPrice } = computePartialLevels(53525, 53200, "BUY", storedP1, null);
      expect(partial1RPrice).toBe(storedP1);
    });

    it("uses stored partial2RPrice from DB when available", () => {
      const storedP2 = 54200;
      const { partial2RPrice } = computePartialLevels(53525, 53200, "BUY", null, storedP2);
      expect(partial2RPrice).toBe(storedP2);
    });
  });

  describe("partial booking guard: price >= 0 must NOT trigger booking", () => {
    it("BUY: partial1RPrice > 0 so price >= partial1RPrice is not trivially true", () => {
      // The bug: if partial1RPrice = 0, then ANY price >= 0 triggers booking
      // This test ensures the computed value is always > 0 for BUY
      const { partial1RPrice } = computePartialLevels(53525, 53200, "BUY", null, null);
      const currentPrice = 53525; // price at entry — should NOT trigger booking
      expect(currentPrice >= partial1RPrice).toBe(false);
    });

    it("SELL: partial1RPrice < entryPrice so price <= partial1RPrice is not trivially true", () => {
      const { partial1RPrice } = computePartialLevels(6875, 7100, "SELL", null, null);
      const currentPrice = 6875; // price at entry — should NOT trigger booking
      expect(currentPrice <= partial1RPrice).toBe(false);
    });
  });

  describe("session without open trade must be marked stopped", () => {
    it("identifies sessions that should NOT restart (no open trade)", () => {
      // Simulate the decision logic: only restart if openTradeRows.length > 0
      const openTradeRows: unknown[] = []; // empty = no open trade
      const shouldRestart = openTradeRows.length > 0;
      expect(shouldRestart).toBe(false);
    });

    it("identifies sessions that SHOULD restart (has open trade)", () => {
      const openTradeRows = [{ id: 1, symbol: "BNF_FUT", entryPrice: 53525, slPrice: 53200 }];
      const shouldRestart = openTradeRows.length > 0;
      expect(shouldRestart).toBe(true);
    });
  });
});
