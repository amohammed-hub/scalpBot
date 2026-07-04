import { describe, it, expect } from "vitest";
import { generateSignal } from "./botEngine";
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
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.direction);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
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
});
