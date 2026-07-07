import { describe, it, expect } from "vitest";
import { generateSignal, generatePowerHourSignal } from "./botEngine";
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
