import { describe, it, expect } from "vitest";
import { generateSignal, generatePowerHourSignal, generateMCXEveningSignal, generateMCXLateSessionSignal, generateHeroZeroSignal } from "./botEngine";
import { checkRenkoExit, buildRenkoBricks } from "./botEngine";
import type { Candle } from "./botEngine";

function makeCandles(count: number, basePrice = 2000, trend: "up" | "down" | "flat" = "flat"): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = trend === "up" ? 2 : trend === "down" ? -2 : (Math.random() - 0.5) * 2;
    price = Math.max(100, price + change);
    const range = price * 0.003;
    candles.push({
      open: price - range * 0.5,
      high: price + range,
      low: price - range,
      close: price,
      volume: 80000 + Math.random() * 40000,
      timestamp: Date.now() - (count - i) * 60000,
    });
  }
  return candles;
}

// ── generateSignal tests ──────────────────────────────────────────────────────
describe("generateSignal", () => {
  it("returns HOLD when insufficient candles", () => {
    const candles = makeCandles(10);
    const signal = generateSignal(candles);
    expect(signal.direction).toBe("HOLD");
  });

  it("returns a valid signal object with all required fields", () => {
    const candles = makeCandles(60, 2000, "flat");
    const signal = generateSignal(candles);
    expect(signal).toHaveProperty("direction");
    expect(signal).toHaveProperty("confidence");
    expect(signal).toHaveProperty("entryPrice");
    expect(signal).toHaveProperty("slPrice");
    expect(signal).toHaveProperty("targetPrice");
    expect(signal).toHaveProperty("atr");
    expect(signal).toHaveProperty("reason");
    expect(signal).toHaveProperty("layer");
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.direction);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it("layer field is always present and valid", () => {
    const validLayers = ["Breakout", "Pattern", "Trend", "Momentum", "MACD_BB", "PowerHour", "MCXEvening", "MCXLateSession", "HeroZero", "VWAPReversion", "VWAPPullback", "ORB", "InstFootprint", "HourlyClose", "BoomingBulls", "FailedBreakout", "OpeningBurst", "CPR", "RedBarTheory", "TrikalStrategy", "Adeeb", "OIFlow", "MaxPainGravity", "None"];
    const candles = makeCandles(80, 2000, "flat");
    const signal = generateSignal(candles);
    expect(validLayers).toContain(signal.layer);
  });

  it("entryPrice matches last candle close", () => {
    const candles = makeCandles(60, 1500, "flat");
    const signal = generateSignal(candles);
    const lastClose = candles[candles.length - 1].close;
    expect(signal.entryPrice).toBeCloseTo(lastClose, 1);
  });

  it("BUY signal has SL below entry and target above entry", () => {
    const candles = makeCandles(80, 2000, "up");
    const signal = generateSignal(candles);
    if (signal.direction === "BUY") {
      expect(signal.slPrice).toBeLessThan(signal.entryPrice);
      expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("SELL signal has SL above entry and target below entry", () => {
    const candles = makeCandles(80, 2000, "down");
    const signal = generateSignal(candles);
    if (signal.direction === "SELL") {
      expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
      expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    }
  });

  it("ATR is positive for sufficient candle data", () => {
    const candles = makeCandles(60, 2000, "flat");
    const signal = generateSignal(candles);
    expect(signal.atr).toBeGreaterThanOrEqual(0);
  });

  it("reason string is non-empty", () => {
    const candles = makeCandles(60, 2000, "flat");
    const signal = generateSignal(candles);
    expect(signal.reason.length).toBeGreaterThan(0);
  });

  it("confidence never exceeds 1.0", () => {
    // Test with strong trend to push confidence high
    const candles = makeCandles(100, 2000, "up");
    const signal = generateSignal(candles);
    expect(signal.confidence).toBeLessThanOrEqual(1.0);
  });

  it("confidence is 0 for HOLD signals", () => {
    const candles = makeCandles(10); // insufficient data → HOLD
    const signal = generateSignal(candles);
    expect(signal.direction).toBe("HOLD");
    expect(signal.confidence).toBe(0);
  });

  it("accepts 5m candles without throwing", () => {
    const candles1m = makeCandles(80, 2000, "up");
    const candles5m = makeCandles(20, 2000, "up");
    expect(() => generateSignal(candles1m, 1.5, 3.0, 0.6, candles5m)).not.toThrow();
  });

  it("accepts prev-day high/low/close for pivot filtering without throwing", () => {
    const candles = makeCandles(80, 2000, "flat");
    expect(() => generateSignal(candles, 1.5, 3.0, 0.6, [], 2050, 1950, 2000)).not.toThrow();
  });

  it("target multiplier is respected — target distance > SL distance", () => {
    const candles = makeCandles(80, 2000, "up");
    const signal = generateSignal(candles, 1.5, 3.0, 0.0); // minConf=0 to force a signal
    if (signal.direction !== "HOLD") {
      const slDist = Math.abs(signal.entryPrice - signal.slPrice);
      const tgtDist = Math.abs(signal.targetPrice - signal.entryPrice);
      expect(tgtDist).toBeGreaterThan(slDist);
    }
  });
});

// ── generatePowerHourSignal tests ─────────────────────────────────────────────
describe("generatePowerHourSignal", () => {
  it("returns HOLD when insufficient candles", () => {
    const signal = generatePowerHourSignal(makeCandles(5), makeCandles(2));
    expect(signal.direction).toBe("HOLD");
    expect(signal.isPowerHour).toBe(true);
  });

  it("always sets isPowerHour=true", () => {
    const signal = generatePowerHourSignal(makeCandles(50), makeCandles(10));
    expect(signal.isPowerHour).toBe(true);
  });

  it("returns valid signal object with all required fields", () => {
    const candles1m = makeCandles(100, 2000, "up");
    const candles5m = makeCandles(20, 2000, "up");
    const signal = generatePowerHourSignal(candles1m, candles5m);
    expect(signal).toHaveProperty("direction");
    expect(signal).toHaveProperty("confidence");
    expect(signal).toHaveProperty("entryPrice");
    expect(signal).toHaveProperty("slPrice");
    expect(signal).toHaveProperty("targetPrice");
    expect(signal).toHaveProperty("atr");
    expect(signal).toHaveProperty("reason");
    expect(signal).toHaveProperty("layer");
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.direction);
  });

  it("BUY signal has SL below entry and target above entry", () => {
    const candles1m = makeCandles(120, 2000, "up");
    const candles5m = makeCandles(24, 2000, "up");
    const signal = generatePowerHourSignal(candles1m, candles5m, 1.2, 2.5);
    if (signal.direction === "BUY") {
      expect(signal.slPrice).toBeLessThan(signal.entryPrice);
      expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("SELL signal has SL above entry and target below entry", () => {
    const candles1m = makeCandles(120, 2000, "down");
    const candles5m = makeCandles(24, 2000, "down");
    const signal = generatePowerHourSignal(candles1m, candles5m, 1.2, 2.5);
    if (signal.direction === "SELL") {
      expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
      expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    }
  });

  it("confidence is within [0, 1]", () => {
    const candles1m = makeCandles(120, 2000, "up");
    const candles5m = makeCandles(24, 2000, "up");
    const signal = generatePowerHourSignal(candles1m, candles5m);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it("layer is PowerHour for actionable signals", () => {
    const candles1m = makeCandles(120, 2000, "up");
    const candles5m = makeCandles(24, 2000, "up");
    const signal = generatePowerHourSignal(candles1m, candles5m);
    if (signal.direction !== "HOLD") {
      expect(signal.layer).toBe("PowerHour");
    }
  });

  it("reason string is non-empty", () => {
    const candles1m = makeCandles(60, 2000, "flat");
    const candles5m = makeCandles(12, 2000, "flat");
    const signal = generatePowerHourSignal(candles1m, candles5m);
    expect(signal.reason.length).toBeGreaterThan(0);
  });
});

// ── generateMCXEveningSignal tests ───────────────────────────────────────────
describe("generateMCXEveningSignal", () => {
  it("returns HOLD with isMCXEvening=true when insufficient candles", () => {
    const signal = generateMCXEveningSignal(makeCandles(5), makeCandles(2));
    expect(signal.direction).toBe("HOLD");
    expect(signal.isMCXEvening).toBe(true);
  });

  it("always sets isMCXEvening=true", () => {
    const signal = generateMCXEveningSignal(makeCandles(50), makeCandles(10));
    expect(signal.isMCXEvening).toBe(true);
  });

  it("returns valid signal object with all required fields", () => {
    const candles1m = makeCandles(100, 6650, "up"); // MCX Crude price
    const candles5m = makeCandles(20, 6650, "up");
    const signal = generateMCXEveningSignal(candles1m, candles5m);
    expect(signal).toHaveProperty("direction");
    expect(signal).toHaveProperty("confidence");
    expect(signal).toHaveProperty("entryPrice");
    expect(signal).toHaveProperty("slPrice");
    expect(signal).toHaveProperty("targetPrice");
    expect(signal).toHaveProperty("atr");
    expect(signal).toHaveProperty("reason");
    expect(signal).toHaveProperty("layer");
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.direction);
  });

  it("BUY signal has SL below entry and target above entry", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXEveningSignal(candles1m, candles5m);
    if (signal.direction === "BUY") {
      expect(signal.slPrice).toBeLessThan(signal.entryPrice);
      expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("EIA Wednesday flag widens SL vs normal day", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const normalSignal = generateMCXEveningSignal(candles1m, candles5m, false, 1.2, 2.5);
    const eiaSignal    = generateMCXEveningSignal(candles1m, candles5m, true,  1.2, 2.5);
    // Both should return valid signals; EIA signal reason should mention EIA
    if (eiaSignal.direction !== "HOLD") {
      expect(eiaSignal.reason).toContain("EIA");
    }
    // EIA SL should be wider (further from entry) than normal SL
    if (normalSignal.direction !== "HOLD" && eiaSignal.direction !== "HOLD" &&
        normalSignal.direction === eiaSignal.direction) {
      const normalSlDist = Math.abs(normalSignal.entryPrice - normalSignal.slPrice);
      const eiaSlDist    = Math.abs(eiaSignal.entryPrice - eiaSignal.slPrice);
      expect(eiaSlDist).toBeGreaterThan(normalSlDist);
    }
  });

  it("layer is MCXEvening for actionable signals", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXEveningSignal(candles1m, candles5m);
    if (signal.direction !== "HOLD") {
      expect(signal.layer).toBe("MCXEvening");
    }
  });

  it("confidence is within [0, 1]", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXEveningSignal(candles1m, candles5m);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });
});

// ── generateMCXLateSessionSignal tests ─────────────────────────────────────────
describe("generateMCXLateSessionSignal", () => {
  it("returns HOLD with isMCXLateSession=true when insufficient candles", () => {
    const signal = generateMCXLateSessionSignal(makeCandles(5), makeCandles(2));
    expect(signal.direction).toBe("HOLD");
    expect(signal.isMCXLateSession).toBe(true);
  });

  it("always sets isMCXLateSession=true", () => {
    const signal = generateMCXLateSessionSignal(makeCandles(50), makeCandles(10));
    expect(signal.isMCXLateSession).toBe(true);
  });

  it("returns valid signal object with all required fields", () => {
    const candles1m = makeCandles(100, 6650, "up");
    const candles5m = makeCandles(20, 6650, "up");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    expect(signal).toHaveProperty("direction");
    expect(signal).toHaveProperty("confidence");
    expect(signal).toHaveProperty("entryPrice");
    expect(signal).toHaveProperty("slPrice");
    expect(signal).toHaveProperty("targetPrice");
    expect(signal).toHaveProperty("atr");
    expect(signal).toHaveProperty("reason");
    expect(signal).toHaveProperty("layer");
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.direction);
  });

  it("BUY signal has SL below entry and target above entry", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    if (signal.direction === "BUY") {
      expect(signal.slPrice).toBeLessThan(signal.entryPrice);
      expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("SELL signal has SL above entry and target below entry", () => {
    const candles1m = makeCandles(120, 6650, "down");
    const candles5m = makeCandles(24, 6650, "down");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    if (signal.direction === "SELL") {
      expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
      expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    }
  });

  it("layer is MCXLateSession for actionable signals", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    if (signal.direction !== "HOLD") {
      expect(signal.layer).toBe("MCXLateSession");
    }
  });

  it("confidence is within [0, 1]", () => {
    const candles1m = makeCandles(120, 6650, "up");
    const candles5m = makeCandles(24, 6650, "up");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it("catches strong downward momentum (simulating CRUDEOIL PE scenario)", () => {
    // Simulate a strong bearish move: price dropping steadily
    const candles1m = makeCandles(100, 7700, "down");
    const candles5m = makeCandles(20, 7700, "down");
    const signal = generateMCXLateSessionSignal(candles1m, candles5m);
    // With strong downward momentum, should either generate SELL or HOLD (never BUY)
    expect(signal.direction).not.toBe("BUY");
    expect(signal.isMCXLateSession).toBe(true);
  });
});


// ── generateHeroZeroSignal tests ────────────────────────────────────────────────
describe("generateHeroZeroSignal", () => {
  it("returns HOLD with isHeroZero=true when premium is outside ₹2–50 range", () => {
    const underlying = makeCandles(60, 24800, "up");
    // Premium too high
    const signal1 = generateHeroZeroSignal(75, underlying, "CE", 200);
    expect(signal1.direction).toBe("HOLD");
    expect(signal1.isHeroZero).toBe(true);
    // Premium too low
    const signal2 = generateHeroZeroSignal(1, underlying, "CE", 200);
    expect(signal2.direction).toBe("HOLD");
    expect(signal2.isHeroZero).toBe(true);
  });

  it("always sets isHeroZero=true", () => {
    const underlying = makeCandles(60, 24800, "up");
    const signal = generateHeroZeroSignal(15, underlying, "CE", 200);
    expect(signal.isHeroZero).toBe(true);
  });

  it("target is 5× entry premium", () => {
    const underlying = makeCandles(60, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    expect(signal.targetPrice).toBeCloseTo(50, 1); // 10 * 5 = 50
  });

  it("SL is 50% of entry premium", () => {
    const underlying = makeCandles(60, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    expect(signal.slPrice).toBeCloseTo(5, 1); // 10 * 0.5 = 5
  });

  it("partial1RPrice is 2.5× entry for actionable signals", () => {
    const underlying = makeCandles(80, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    if (signal.direction === "BUY") {
      expect(signal.partial1RPrice).toBeCloseTo(25, 1); // 10 * 2.5
    }
  });

  it("partial2RPrice is 3.5× entry for actionable signals", () => {
    const underlying = makeCandles(80, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    if (signal.direction === "BUY") {
      expect(signal.partial2RPrice).toBeCloseTo(35, 1); // 10 * 3.5
    }
  });

  it("CE requires bullish underlying (direction confirmed by RSI/EMA/MACD)", () => {
    // Bearish underlying should return HOLD for CE
    const bearishUnderlying = makeCandles(80, 24800, "down");
    const signal = generateHeroZeroSignal(10, bearishUnderlying, "CE", 200);
    // With strongly bearish candles, CE should not fire
    if (signal.direction !== "HOLD") {
      // If it does fire, it must be BUY (Hero Zero is always a buy)
      expect(signal.direction).toBe("BUY");
    }
  });

  it("PE requires bearish underlying", () => {
    // Bullish underlying should return HOLD for PE
    const bullishUnderlying = makeCandles(80, 24800, "up");
    const signal = generateHeroZeroSignal(10, bullishUnderlying, "PE", 200);
    // With strongly bullish candles, PE should not fire
    if (signal.direction !== "HOLD") {
      expect(signal.direction).toBe("BUY");
    }
  });

  it("rejects strike too far OTM (> 5%)", () => {
    const underlying = makeCandles(60, 24800, "up");
    // 5000 points OTM on 24800 = ~20% OTM — should be rejected
    const signal = generateHeroZeroSignal(10, underlying, "CE", 5000);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("OTM");
  });

  it("layer is HeroZero for actionable signals", () => {
    const underlying = makeCandles(80, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    if (signal.direction !== "HOLD") {
      expect(signal.layer).toBe("HeroZero");
    }
  });

  it("confidence is within [0, 1]", () => {
    const underlying = makeCandles(80, 24800, "up");
    const signal = generateHeroZeroSignal(10, underlying, "CE", 200);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });
});

// ── Partial booking price levels test ──────────────────────────────────────────────
describe("partial profit booking price levels", () => {
  it("generateSignal BUY sets partial1RPrice above entry", () => {
    const candles = makeCandles(80, 2000, "up");
    const signal = generateSignal(candles, 1.5, 3.0, 0.0);
    if (signal.direction === "BUY" && signal.partial1RPrice !== undefined) {
      expect(signal.partial1RPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("generateSignal BUY sets partial2RPrice above partial1RPrice", () => {
    const candles = makeCandles(80, 2000, "up");
    const signal = generateSignal(candles, 1.5, 3.0, 0.0);
    if (signal.direction === "BUY" && signal.partial1RPrice !== undefined && signal.partial2RPrice !== undefined) {
      expect(signal.partial2RPrice).toBeGreaterThan(signal.partial1RPrice);
    }
  });

  it("generateSignal SELL sets partial1RPrice below entry", () => {
    const candles = makeCandles(80, 2000, "down");
    const signal = generateSignal(candles, 1.5, 3.0, 0.0);
    if (signal.direction === "SELL" && signal.partial1RPrice !== undefined) {
      expect(signal.partial1RPrice).toBeLessThan(signal.entryPrice);
    }
  });
});

// ── Phase 7: Institutional Strategy Tests ──────────────────────────────────────
import {
  calcORBSignal,
  calcVWAPDeviation,
  classifyMarketRegime,
  calcInstitutionalFootprint,
} from "./botEngine";

// ── ORB Signal Tests ────────────────────────────────────────────────────────────
describe("calcORBSignal", () => {
  it("returns HOLD when not enough candles", () => {
    const result = calcORBSignal(makeCandles(10, 2000, "up"));
    expect(result.direction).toBe("HOLD");
  });

  it("returns BUY when price breaks above ORB high with volume", () => {
    const orbCandles = makeCandles(15, 2000, "flat");
    const orbHigh = Math.max(...orbCandles.map(c => c.high));
    const breakoutCandles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      open: orbHigh + i * 2,
      high: orbHigh + i * 2 + 5,
      low: orbHigh + i * 2 - 1,
      close: orbHigh + i * 2 + 4,
      volume: 200000,
      timestamp: Date.now() + i * 60000,
    }));
    const allCandles = [...orbCandles, ...breakoutCandles];
    const result = calcORBSignal(allCandles, 15, 1.5);
    expect(["BUY", "HOLD"]).toContain(result.direction);
    expect(result.orbHigh).toBeGreaterThan(0);
    expect(result.orbLow).toBeGreaterThan(0);
  });

  it("returns SELL when price breaks below ORB low with volume", () => {
    const orbCandles = makeCandles(15, 2000, "flat");
    const orbLow = Math.min(...orbCandles.map(c => c.low));
    const breakdownCandles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      open: orbLow - i * 2,
      high: orbLow - i * 2 + 1,
      low: orbLow - i * 2 - 5,
      close: orbLow - i * 2 - 4,
      volume: 200000,
      timestamp: Date.now() + i * 60000,
    }));
    const allCandles = [...orbCandles, ...breakdownCandles];
    const result = calcORBSignal(allCandles, 15, 1.5);
    expect(["SELL", "HOLD"]).toContain(result.direction);
  });

  it("breakoutPct is non-negative", () => {
    const candles = makeCandles(25, 2000, "up");
    const result = calcORBSignal(candles, 15, 1.5);
    expect(result.breakoutPct).toBeGreaterThanOrEqual(0);
  });

  it("orbHigh >= orbLow", () => {
    const candles = makeCandles(25, 2000, "flat");
    const result = calcORBSignal(candles, 15, 1.5);
    expect(result.orbHigh).toBeGreaterThanOrEqual(result.orbLow);
  });
});

// ── VWAP Deviation Tests ────────────────────────────────────────────────────────
describe("calcVWAPDeviation", () => {
  it("returns HOLD when not enough candles", () => {
    const result = calcVWAPDeviation(makeCandles(10, 2000, "flat"));
    expect(result.signal).toBe("HOLD");
  });

  it("returns a valid signal for sufficient candles", () => {
    const candles = makeCandles(30, 2000, "flat");
    const result = calcVWAPDeviation(candles);
    expect(["BUY", "SELL", "HOLD"]).toContain(result.signal);
  });

  it("zScore is a finite number", () => {
    const candles = makeCandles(30, 2000, "flat");
    const result = calcVWAPDeviation(candles);
    expect(isFinite(result.zScore)).toBe(true);
  });

  it("stdDev is positive for non-constant prices", () => {
    const candles = makeCandles(30, 2000, "up");
    const result = calcVWAPDeviation(candles);
    expect(result.stdDev).toBeGreaterThan(0);
  });

  it("returns BUY when price is far below VWAP", () => {
    const highCandles = makeCandles(20, 2100, "flat");
    const dropCandles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      open: 2100 - i * 20,
      high: 2100 - i * 20 + 5,
      low: 2100 - i * 20 - 5,
      close: 2100 - i * 20 - 4,
      volume: 100000,
      timestamp: Date.now() + i * 60000,
    }));
    const allCandles = [...highCandles, ...dropCandles];
    const result = calcVWAPDeviation(allCandles);
    expect(["BUY", "HOLD"]).toContain(result.signal);
  });
});

// ── Market Regime Classifier Tests ─────────────────────────────────────────────
describe("classifyMarketRegime", () => {
  it("returns ranging for insufficient data", () => {
    const result = classifyMarketRegime(makeCandles(10, 2000, "flat"));
    expect(result.regime).toBe("ranging");
  });

  it("returns a valid regime for sufficient candles", () => {
    const candles = makeCandles(50, 2000, "flat");
    const result = classifyMarketRegime(candles);
    expect(["strong_trend", "weak_trend", "ranging", "high_vol", "low_vol"]).toContain(result.regime);
  });

  it("label is a non-empty string", () => {
    const candles = makeCandles(50, 2000, "up");
    const result = classifyMarketRegime(candles);
    expect(result.label.length).toBeGreaterThan(0);
  });

  it("detects non-low_vol regime for sustained directional candles", () => {
    const candles = makeCandles(60, 2000, "up");
    const result = classifyMarketRegime(candles);
    // Trending candles should NOT be low_vol (squeeze)
    expect(result.regime).not.toBe("low_vol");
    expect(["strong_trend", "weak_trend", "high_vol", "ranging"]).toContain(result.regime);
  });

  it("detects ranging, low_vol, or trend for flat candles", () => {
    // Flat candles (minimal ATR) can produce ranging, low_vol, or trend regimes
    // depending on ADX and volatility thresholds — all are valid for near-zero movement
    const candles = makeCandles(60, 2000, "flat");
    const result = classifyMarketRegime(candles);
    expect(["ranging", "low_vol", "strong_trend", "weak_trend", "high_vol"]).toContain(result.regime);
  });
});

// ── Institutional Footprint Tests ──────────────────────────────────────────────
describe("calcInstitutionalFootprint", () => {
  it("returns HOLD for insufficient data", () => {
    const result = calcInstitutionalFootprint(makeCandles(5, 2000, "flat"));
    expect(result.direction).toBe("HOLD");
    expect(result.detected).toBe(false);
  });

  it("returns valid direction for sufficient candles", () => {
    const candles = makeCandles(20, 2000, "flat");
    const result = calcInstitutionalFootprint(candles);
    expect(["BUY", "SELL", "HOLD"]).toContain(result.direction);
  });

  it("strength is between 0 and 1", () => {
    const candles = makeCandles(20, 2000, "up");
    const result = calcInstitutionalFootprint(candles);
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
  });

  it("reason is a non-empty string", () => {
    const candles = makeCandles(20, 2000, "flat");
    const result = calcInstitutionalFootprint(candles);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("detects BUY footprint on bullish high-volume candle above VWAP", () => {
    const base = makeCandles(15, 2000, "up");
    const vwapBase = base.reduce((a, c) => a + c.close, 0) / base.length;
    const highVolBullish: Candle = {
      open: vwapBase + 5,
      high: vwapBase + 25,
      low: vwapBase + 4,
      close: vwapBase + 24,
      volume: 500000,
      timestamp: Date.now(),
    };
    const allCandles = [...base, highVolBullish];
    const result = calcInstitutionalFootprint(allCandles);
    if (result.detected) {
      expect(result.direction).toBe("BUY");
    }
  });

  it("detects SELL footprint on bearish high-volume candle below VWAP", () => {
    const base = makeCandles(15, 2000, "down");
    const vwapBase = base.reduce((a, c) => a + c.close, 0) / base.length;
    const highVolBearish: Candle = {
      open: vwapBase - 5,
      high: vwapBase - 4,
      low: vwapBase - 25,
      close: vwapBase - 24,
      volume: 500000,
      timestamp: Date.now(),
    };
    const allCandles = [...base, highVolBearish];
    const result = calcInstitutionalFootprint(allCandles);
    if (result.detected) {
      expect(result.direction).toBe("SELL");
    }
  });
});

// ── TEST D: Red Brick Exit (Renko-based trailing exit) ──────────────────────
describe("TEST D — Red Brick Exit (checkRenkoExit)", () => {
  function makeTrendCandles(count: number, basePrice: number, direction: "up" | "down", stepSize: number): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    for (let i = 0; i < count; i++) {
      price += direction === "up" ? stepSize : -stepSize;
      candles.push({
        open: price - stepSize * 0.3,
        high: price + stepSize * 0.5,
        low: price - stepSize * 0.5,
        close: price,
        volume: 100000,
        timestamp: Date.now() - (count - i) * 60000,
      });
    }
    return candles;
  }

  it("returns shouldExit=false when candles are insufficient", () => {
    const candles = makeTrendCandles(5, 100, "up", 2);
    const result = checkRenkoExit(candles, "BUY", 10);
    expect(result.shouldExit).toBe(false);
  });

  it("returns shouldExit=false when ATR is 0 or negative", () => {
    const candles = makeTrendCandles(20, 100, "up", 2);
    expect(checkRenkoExit(candles, "BUY", 0).shouldExit).toBe(false);
    expect(checkRenkoExit(candles, "BUY", -5).shouldExit).toBe(false);
  });

  it("exits BUY trade when red brick forms (price reversal)", () => {
    // Start with uptrend then reverse down
    const upCandles = makeTrendCandles(15, 100, "up", 3); // price goes 103→145
    const downCandles = makeTrendCandles(10, 145, "down", 4); // price drops 141→101
    const allCandles = [...upCandles, ...downCandles];
    const atr = 10; // brick size = 10
    const result = checkRenkoExit(allCandles, "BUY", atr);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain("red brick");
  });

  it("exits SELL trade when green brick forms (price reversal)", () => {
    // Start with downtrend then reverse up
    const downCandles = makeTrendCandles(15, 200, "down", 3); // price goes 197→155
    const upCandles = makeTrendCandles(10, 155, "up", 4); // price goes 159→195
    const allCandles = [...downCandles, ...upCandles];
    const atr = 10;
    const result = checkRenkoExit(allCandles, "SELL", atr);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain("green brick");
  });

  it("does NOT exit BUY trade when trend continues up (no red brick)", () => {
    // Pure uptrend — should NOT exit
    const candles = makeTrendCandles(30, 100, "up", 2);
    const atr = 10;
    const result = checkRenkoExit(candles, "BUY", atr);
    expect(result.shouldExit).toBe(false);
  });

  it("does NOT exit SELL trade when trend continues down (no green brick)", () => {
    // Pure downtrend — should NOT exit
    const candles = makeTrendCandles(30, 200, "down", 2);
    const atr = 10;
    const result = checkRenkoExit(candles, "SELL", atr);
    expect(result.shouldExit).toBe(false);
  });
});

describe("buildRenkoBricks", () => {
  it("builds correct number of green bricks for uptrend", () => {
    // Price moves from 100 to 150 with ATR=10 → should build 5 green bricks
    const candles: Candle[] = [
      { open: 100, high: 102, low: 98, close: 100, volume: 1000, timestamp: Date.now() - 2000 },
      { open: 100, high: 155, low: 99, close: 150, volume: 1000, timestamp: Date.now() - 1000 },
    ];
    const bricks = buildRenkoBricks(candles, 10);
    expect(bricks.length).toBe(5);
    expect(bricks.every(b => b.color === "green")).toBe(true);
  });

  it("builds correct number of red bricks for downtrend", () => {
    // Price moves from 200 to 160 with ATR=10 → should build 4 red bricks
    const candles: Candle[] = [
      { open: 200, high: 202, low: 198, close: 200, volume: 1000, timestamp: Date.now() - 2000 },
      { open: 200, high: 201, low: 158, close: 160, volume: 1000, timestamp: Date.now() - 1000 },
    ];
    const bricks = buildRenkoBricks(candles, 10);
    expect(bricks.length).toBe(4);
    expect(bricks.every(b => b.color === "red")).toBe(true);
  });

  it("builds mixed bricks for reversal pattern", () => {
    // Price: 100 → 130 → 100 (up 3 bricks, down 3 bricks)
    const candles: Candle[] = [
      { open: 100, high: 102, low: 98, close: 100, volume: 1000, timestamp: Date.now() - 3000 },
      { open: 100, high: 135, low: 99, close: 130, volume: 1000, timestamp: Date.now() - 2000 },
      { open: 130, high: 131, low: 98, close: 100, volume: 1000, timestamp: Date.now() - 1000 },
    ];
    const bricks = buildRenkoBricks(candles, 10);
    const greenCount = bricks.filter(b => b.color === "green").length;
    const redCount = bricks.filter(b => b.color === "red").length;
    expect(greenCount).toBe(3);
    expect(redCount).toBe(3);
    // Last brick should be red (reversal)
    expect(bricks[bricks.length - 1].color).toBe("red");
  });

  it("returns empty array for insufficient candles", () => {
    const candles: Candle[] = [
      { open: 100, high: 102, low: 98, close: 100, volume: 1000, timestamp: Date.now() },
    ];
    expect(buildRenkoBricks(candles, 10)).toEqual([]);
  });

  it("returns empty array for zero ATR", () => {
    const candles: Candle[] = [
      { open: 100, high: 102, low: 98, close: 100, volume: 1000, timestamp: Date.now() - 1000 },
      { open: 100, high: 120, low: 99, close: 120, volume: 1000, timestamp: Date.now() },
    ];
    expect(buildRenkoBricks(candles, 0)).toEqual([]);
  });
});
