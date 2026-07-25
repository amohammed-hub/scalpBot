/**
 * directionLock.test.ts
 *
 * Unit tests for Cross-Bot Direction Lock v2 (pure function).
 * Rules:
 *   1. Same underlying (both bots on NIFTY) → HARD BLOCK opposite direction
 *   2. Correlated Group 1 (NIFTY/BANKNIFTY/FINNIFTY/SENSEX/BANKEX/MIDCPNIFTY) →
 *      Allow opposite ONLY if signal confidence > 85%, log as "⚠️ Correlation override"
 *   3. Different segments (NSE vs MCX, GOLD vs CRUDE) → NO BLOCK at all
 */

import { describe, it, expect } from "vitest";
import { evaluateDirectionLock, GROUP1_CORRELATED } from "./botEngine";

describe("Cross-Bot Direction Lock v2", () => {

  // ── Rule 1: Same underlying → HARD BLOCK ────────────────────────────────────
  describe("Rule 1: Same underlying HARD BLOCK", () => {
    it("blocks CE entry when same underlying (NIFTY) has PE open", () => {
      const result = evaluateDirectionLock("NIFTY", true, 0.75, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("hard_block");
      expect(result.reason).toContain("Same underlying NIFTY");
    });

    it("blocks PE entry when same underlying (BANKNIFTY) has CE open", () => {
      const result = evaluateDirectionLock("BANKNIFTY", false, 0.95, [
        { symbol: "BANKNIFTY", openTradeSymbol: "BANKNIFTY_CE_52000", botSlot: 1, status: "running" },
      ]);
      expect(result.action).toBe("hard_block");
      expect(result.reason).toContain("Same underlying BANKNIFTY");
    });

    it("hard blocks even with 100% confidence on same underlying", () => {
      const result = evaluateDirectionLock("NIFTY", true, 1.0, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("hard_block");
    });

    it("allows same direction on same underlying (CE + CE)", () => {
      const result = evaluateDirectionLock("NIFTY", true, 0.75, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_CE_24500", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });
  });

  // ── Rule 2: Correlated indices — confidence threshold ───────────────────────
  describe("Rule 2: Correlated indices confidence threshold", () => {
    it("soft blocks CE on BANKNIFTY when NIFTY has PE and confidence ≤ 85%", () => {
      const result = evaluateDirectionLock("BANKNIFTY", true, 0.70, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("soft_block");
      expect(result.reason).toContain("confidence 70% ≤ 85%");
    });

    it("soft blocks at exactly 85% confidence (threshold is > 85, not >=)", () => {
      const result = evaluateDirectionLock("SENSEX", true, 0.85, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("soft_block");
      expect(result.reason).toContain("85% ≤ 85%");
    });

    it("OVERRIDES (allows) at 86% confidence on correlated index", () => {
      const result = evaluateDirectionLock("BANKNIFTY", true, 0.86, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("override");
      expect(result.reason).toContain("Correlation override");
      expect(result.reason).toContain("86%");
    });

    it("OVERRIDES at 95% confidence with 'genuine reversal' assessment", () => {
      const result = evaluateDirectionLock("FINNIFTY", false, 0.95, [
        { symbol: "BANKNIFTY", openTradeSymbol: "BANKNIFTY_CE_52000", botSlot: 1, status: "running" },
      ]);
      expect(result.action).toBe("override");
      expect(result.detail).toContain("genuine reversal");
    });

    it("OVERRIDES at 87% confidence with 'possible divergence' assessment", () => {
      const result = evaluateDirectionLock("SENSEX", true, 0.87, [
        { symbol: "FINNIFTY", openTradeSymbol: "FINNIFTY_PE_22000", botSlot: 2, status: "running" },
      ]);
      expect(result.action).toBe("override");
      expect(result.detail).toContain("possible divergence");
    });

    it("soft blocks PE on SENSEX when FINNIFTY has CE and confidence is 50%", () => {
      const result = evaluateDirectionLock("SENSEX", false, 0.50, [
        { symbol: "FINNIFTY", openTradeSymbol: "FINNIFTY_CE_22000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("soft_block");
      expect(result.detail).toContain("Moderate confidence");
    });

    it("soft blocks with 'Low confidence' assessment at 30%", () => {
      const result = evaluateDirectionLock("BANKEX", true, 0.30, [
        { symbol: "MIDCPNIFTY", openTradeSymbol: "MIDCPNIFTY_PE_12000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("soft_block");
      expect(result.detail).toContain("Low confidence");
    });

    it("allows same direction (CE+CE) on correlated indices without blocking", () => {
      const result = evaluateDirectionLock("BANKNIFTY", true, 0.60, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_CE_24500", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });
  });

  // ── Rule 3: Different segments → NO BLOCK ───────────────────────────────────
  describe("Rule 3: Different segments — no blocking", () => {
    it("does NOT block MCX instruments regardless of NSE positions", () => {
      const result = evaluateDirectionLock("NIFTY", true, 0.60, [
        { symbol: "GOLD", openTradeSymbol: "GOLD_PE_72000", botSlot: 1, status: "running" },
        { symbol: "CRUDEOIL", openTradeSymbol: "CRUDE_PE_6500", botSlot: 2, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });

    it("MCX GOLD is fully independent from NSE indices", () => {
      const result = evaluateDirectionLock("GOLD", true, 0.60, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      // GOLD is not in GROUP1_CORRELATED, so it returns "allow" immediately
      expect(result.action).toBe("allow");
      expect(result.reason).toBe("Not in correlated group");
    });

    it("MCX SILVER is fully independent", () => {
      const result = evaluateDirectionLock("SILVER", false, 0.40, [
        { symbol: "BANKNIFTY", openTradeSymbol: "BANKNIFTY_CE_52000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
      expect(result.reason).toBe("Not in correlated group");
    });

    it("MCX CRUDEOIL is fully independent", () => {
      const result = evaluateDirectionLock("CRUDEOIL", true, 0.90, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });

    it("MCX NATURALGAS is fully independent", () => {
      const result = evaluateDirectionLock("NATURALGAS", false, 0.50, [
        { symbol: "SENSEX", openTradeSymbol: "SENSEX_CE_80000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });

    it("MCX COPPER is fully independent", () => {
      const result = evaluateDirectionLock("COPPER", true, 0.75, [
        { symbol: "FINNIFTY", openTradeSymbol: "FINNIFTY_PE_22000", botSlot: 0, status: "running" },
      ]);
      expect(result.action).toBe("allow");
    });
  });

  // ── Group membership verification ──────────────────────────────────────────
  describe("Group 1 membership", () => {
    it("includes all 6 correlated NSE/BSE indices", () => {
      expect(GROUP1_CORRELATED.has("NIFTY")).toBe(true);
      expect(GROUP1_CORRELATED.has("BANKNIFTY")).toBe(true);
      expect(GROUP1_CORRELATED.has("FINNIFTY")).toBe(true);
      expect(GROUP1_CORRELATED.has("SENSEX")).toBe(true);
      expect(GROUP1_CORRELATED.has("BANKEX")).toBe(true);
      expect(GROUP1_CORRELATED.has("MIDCPNIFTY")).toBe(true);
    });

    it("excludes all MCX commodities", () => {
      expect(GROUP1_CORRELATED.has("GOLD")).toBe(false);
      expect(GROUP1_CORRELATED.has("SILVER")).toBe(false);
      expect(GROUP1_CORRELATED.has("CRUDEOIL")).toBe(false);
      expect(GROUP1_CORRELATED.has("NATURALGAS")).toBe(false);
      expect(GROUP1_CORRELATED.has("COPPER")).toBe(false);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────
  describe("Edge cases", () => {
    it("ignores stopped bots", () => {
      const result = evaluateDirectionLock("BANKNIFTY", true, 0.60, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "stopped" },
      ]);
      expect(result.action).toBe("allow");
    });

    it("returns allow when no other bots exist", () => {
      const result = evaluateDirectionLock("NIFTY", true, 0.60, []);
      expect(result.action).toBe("allow");
    });

    it("handles multiple conflicting bots — first conflict wins", () => {
      const result = evaluateDirectionLock("SENSEX", true, 0.60, [
        { symbol: "NIFTY", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
        { symbol: "BANKNIFTY", openTradeSymbol: "BANKNIFTY_PE_51000", botSlot: 1, status: "running" },
      ]);
      expect(result.action).toBe("soft_block");
      // First conflicting bot (NIFTY) should be in the reason
      expect(result.reason).toContain("NIFTY");
    });

    it("case-insensitive symbol matching", () => {
      const result = evaluateDirectionLock("nifty", true, 0.60, [
        { symbol: "Nifty", openTradeSymbol: "NIFTY_PE_24000", botSlot: 0, status: "running" },
      ]);
      // Same underlying (both NIFTY after uppercasing) → hard block
      expect(result.action).toBe("hard_block");
    });
  });
});
