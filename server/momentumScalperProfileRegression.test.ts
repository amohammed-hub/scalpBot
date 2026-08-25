import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREMIUM_MOMENTUM_CONFIG,
  generatePremiumMomentumSignal,
  selectMomentumScalperWinner,
  type PremiumFirstScanResult,
} from "./optionPremiumMomentum";

function candlesFromCloses(closes: number[]) {
  return closes.map((close, index) => ({
    timestamp: index * 60_000,
    open: close - 0.1,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 100,
  }));
}

describe("Momentum Scalper profile", () => {
  it("requires a bullish premium signal before selecting a long option", () => {
    const base = {
      candidate: { token: "PE", symbol: "PE_100", optionType: "PE" as const, strike: 100, premium: 20, spreadPercent: 0.02, timestamp: Date.now() },
      reason: "test",
    };
    const bearish: PremiumFirstScanResult = { ...base, signal: { direction: "SELL", entry: 20, stopLoss: 20.3, target: 19.4, atr: 0.25, breakoutLevel: 20.2, bodyRatio: 0.8, volumeRatio: 2, fastEma: 20, slowEma: 20.1, confidence: 0.9 } };
    const bullish: PremiumFirstScanResult = { ...base, signal: { ...bearish.signal!, direction: "BUY", stopLoss: 19.7, target: 20.6 } };
    expect(selectMomentumScalperWinner([bearish], 0.7)).toBeNull();
    expect(selectMomentumScalperWinner([bearish, bullish], 0.7)).toBe(bullish);
  });

  it("rejects stale or wide-spread premium candles through the scanner contract", () => {
    const candles = candlesFromCloses(Array.from({ length: 24 }, (_, i) => 100 + i * 0.05));
    expect(generatePremiumMomentumSignal(candles, DEFAULT_PREMIUM_MOMENTUM_CONFIG.maxSpreadPercent + 0.01)).toBeNull();
  });

  it("keeps Momentum Scalper defaults at a bounded 1:2 premium risk profile", () => {
    expect(DEFAULT_PREMIUM_MOMENTUM_CONFIG.stopAtrMultiplier).toBeGreaterThan(0);
    expect(DEFAULT_PREMIUM_MOMENTUM_CONFIG.stopPercent).toBeGreaterThan(0);
    expect(DEFAULT_PREMIUM_MOMENTUM_CONFIG.rewardRisk).toBe(2);
    expect(DEFAULT_PREMIUM_MOMENTUM_CONFIG.maxSpreadPercent).toBeLessThanOrEqual(0.1);
  });
});
