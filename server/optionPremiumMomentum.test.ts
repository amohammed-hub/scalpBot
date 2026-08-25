import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREMIUM_MOMENTUM_CONFIG,
  generatePremiumMomentumSignal,
  simulatePremiumMomentum,
  type PremiumCandle,
} from "./optionPremiumMomentum";

function candlesFromCloses(closes: number[], volume = 100): PremiumCandle[] {
  return closes.map((close, index) => ({
    timestamp: Date.UTC(2026, 7, 24, 9, index),
    open: index === 0 ? close : closes[index - 1],
    high: Math.max(index === 0 ? close : closes[index - 1], close) + 0.2,
    low: Math.min(index === 0 ? close : closes[index - 1], close) - 0.2,
    close,
    volume,
  }));
}

describe("option premium momentum breakout", () => {
  it("triggers only after a completed premium-range breakout with trend and volume confirmation", () => {
    const base = candlesFromCloses([100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 100.4, 100.6, 100.5, 100.7, 100.6, 100.8, 101.0, 101.4, 102.0, 103.0, 104.5, 106.5, 110.0], 100);
    base[base.length - 1].open = 106.5;
    base[base.length - 1].high = 110.2;
    base[base.length - 1].low = 106.4;
    base[base.length - 1].volume = 250;
    const signal = generatePremiumMomentumSignal(base, 0.04);
    expect(signal).not.toBeNull();
    expect(signal?.direction).toBe("BUY");
    expect(signal?.target).toBeCloseTo(signal!.entry + (signal!.entry - signal!.stopLoss) * 2, 8);
    expect(signal?.confidence).toBeGreaterThan(0.55);
  });

  it("does not look ahead: a pre-breakout candle cannot trigger", () => {
    const candles = candlesFromCloses([100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 100.4, 100.6, 100.5, 100.7, 100.6, 100.8, 101.0], 100);
    expect(generatePremiumMomentumSignal(candles, 0.04)).toBeNull();
  });

  it("rejects a breakout when the quoted spread exceeds the configured D51 ceiling", () => {
    const candles = candlesFromCloses([100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 100.4, 100.6, 100.5, 100.7, 100.6, 100.8, 101.0, 101.4, 102.0, 103.0, 104.5, 106.5, 110.0], 100);
    candles.at(-1)!.open = 106.5;
    candles.at(-1)!.high = 110.2;
    candles.at(-1)!.low = 106.4;
    candles.at(-1)!.volume = 250;
    expect(generatePremiumMomentumSignal(candles, DEFAULT_PREMIUM_MOMENTUM_CONFIG.maxSpreadPercent + 0.001)).toBeNull();
  });

  it("simulates target and stop outcomes without fabricating an option strike", () => {
    const candles = candlesFromCloses([100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 100.4, 100.6, 100.5, 100.7, 100.6, 100.8, 101.0, 101.4, 102.0, 103.0, 104.5, 106.5, 110.0, 112.0, 114.0], 100);
    candles[20].open = 106.5; candles[20].high = 106.8; candles[20].low = 106.3; candles[20].close = 106.5; candles[20].volume = 100;
    candles[21].open = 106.5; candles[21].high = 110.2; candles[21].low = 106.4; candles[21].close = 110.0; candles[21].volume = 250;
    candles[22].high = 114.2; candles[22].low = 113.5;
    const results = simulatePremiumMomentum(candles, new Map([[21, 0.04]]));
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].direction).toBe("BUY");
    expect(results[0].target - results[0].entry).toBeCloseTo((results[0].entry - results[0].stopLoss) * 2, 8);
  });
});

