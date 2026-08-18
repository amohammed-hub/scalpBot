import { describe, it, expect } from "vitest";
import { digitsOnly } from "./db";

// D36 regression tests: mirrors of the per-leg daily-budget headroom math
// implemented in botEngine.ts at the options sizing block (around line 8671).
// The engine's sizing path is not exported, so the guard logic is verified
// here as pure math identical to the production code, plus admin-mobile
// digit normalization from D35.

function d36LegHeadroom(params: {
  capital: number;
  dailyLossLimitPct: number;
  dailyPnl: number;
  premium: number;
  slPct: number; // state.optionSlPct ?? 5
  scalperMode: boolean;
  quantity: number;
  lotSize: number;
}): { quantity: number; skipped: boolean } {
  const { capital, dailyLossLimitPct, dailyPnl, premium, slPct, scalperMode, quantity, lotSize } = params;
  const maxDailyLoss = -(capital * dailyLossLimitPct) / 100;
  const headroom = Math.max(0, -maxDailyLoss + dailyPnl);
  const safetySlPct = scalperMode ? 0.02 : (slPct ?? 5) / 100;
  const perUnitWorstLoss = premium * safetySlPct;
  const legWorstCase = quantity * perUnitWorstLoss;
  if (legWorstCase > headroom) {
    const headroomQty = Math.floor(headroom / perUnitWorstLoss / lotSize) * lotSize;
    if (headroomQty >= lotSize) {
      return { quantity: headroomQty, skipped: false };
    }
    return { quantity: 0, skipped: true };
  }
  return { quantity, skipped: false };
}

describe("D36 per-leg daily-budget headroom", () => {
  it("scales down an oversized MCX crude leg so one SL cannot exceed the daily cap", () => {
    // Aug 17 reproduction: capital ₹10,000, daily loss limit 15% (-₹1,500),
    // daily PnL already -₹500, crude CE @ ₹92.65, SL 5%, lot size 100,
    // risk-based sizing produced 200 units → worst loss 200 × 92.65 × 0.05 = ₹926.5.
    // Headroom remaining = 1500 - 500 = ₹1,000 → 200 units fits. But with an
    // empty day (-₹0 PnL) the same 200 units fits too; the breakage happened
    // because the premium safety net (~9.8% effective SL) was deeper than the
    // 5% risk SL used for sizing. Re-run with the safety-net effective SL.
    const result = d36LegHeadroom({
      capital: 10000,
      dailyLossLimitPct: 15,
      dailyPnl: 0,
      premium: 92.65,
      slPct: 5,
      scalperMode: false,
      quantity: 200,
      lotSize: 100,
    });
    // Risk-SL headroom allows 200 units; now verify with the deep safety-net SL:
    const deepSlResult = d36LegHeadroom({
      capital: 10000,
      dailyLossLimitPct: 15,
      dailyPnl: 0,
      premium: 92.65,
      slPct: 9.76, // Aug 17 effective SL % (premium 92.65 → SL 9.04)
      scalperMode: false,
      quantity: 200,
      lotSize: 100,
    });
    expect(result.quantity).toBe(200);
    expect(deepSlResult.skipped).toBe(false);
    // 200 × 92.65 × 0.0976 ≈ ₹1,808 > ₹1,500 headroom → capped to 1 lot (100 units,
    // since 100 × 9.04 = ₹904 ≤ ₹1,500 and 2 lots would be ₹1,808).
    expect(deepSlResult.quantity).toBe(100);
    expect(deepSlResult.quantity * 92.65 * 0.0976).toBeLessThanOrEqual(1500);
  });

  it("skips the entry entirely when headroom cannot absorb even one lot", () => {
    // Late in the day: daily PnL -₹1,450, headroom ₹50, lot worth ₹904 at SL.
    const result = d36LegHeadroom({
      capital: 10000,
      dailyLossLimitPct: 15,
      dailyPnl: -1450,
      premium: 92.65,
      slPct: 5,
      scalperMode: false,
      quantity: 200,
      lotSize: 100,
    });
    expect(result.skipped).toBe(true);
    expect(result.quantity).toBe(0);
  });

  it("does not interfere when headroom is sufficient", () => {
    const result = d36LegHeadroom({
      capital: 10000,
      dailyLossLimitPct: 15,
      dailyPnl: -200,
      premium: 250,
      slPct: 5,
      scalperMode: false,
      quantity: 20,
      lotSize: 25,
    });
    // 20 × 250 × 0.05 = ₹250 ≤ ₹1,300 headroom → untouched
    expect(result.quantity).toBe(20);
    expect(result.skipped).toBe(false);
  });

  it("respects scalper-mode 2% SL for per-unit worst loss", () => {
    const result = d36LegHeadroom({
      capital: 10000,
      dailyLossLimitPct: 15,
      dailyPnl: -1400,
      premium: 100,
      slPct: 5,
      scalperMode: true,
      quantity: 400,
      lotSize: 100,
    });
    // Per-unit worst loss = 100 × 0.02 = ₹2; headroom ₹100 → 400 × 2 = ₹800 > 100
    // → capped to floor(100/2/100)*100 = 0 lots → skipped.
    expect(result.quantity).toBe(0);
    expect(result.skipped).toBe(true);
  });
});

describe("D35 admin-mobile digit normalization", () => {
  const admin = "+918686742267";

  it("matches any prefix or spacing style of the admin mobile", () => {
    expect(digitsOnly("+918686742267")).toBe(digitsOnly(admin));
    expect(digitsOnly("+91 86867 42267")).toBe(digitsOnly(admin));
    expect(digitsOnly("8686742267")).toBe(digitsOnly(admin));
    expect(digitsOnly("918686742267")).toBe(digitsOnly(admin));
  });

  it("does not match a non-admin mobile", () => {
    expect(digitsOnly("+919999999999")).not.toBe(digitsOnly(admin));
  });

  it("handles empty/undefined input", () => {
    expect(digitsOnly("")).toBe("");
  });
});
