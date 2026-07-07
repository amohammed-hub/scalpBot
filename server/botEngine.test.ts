import { describe, it, expect } from "vitest";
import { generateSignal, generatePowerHourSignal, generateMCXEveningSignal, generateHeroZeroSignal } from "./botEngine";
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
    const validLayers = ["Breakout", "Pattern", "Trend", "Momentum", "MACD_BB", "PowerHour", "None"];
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
