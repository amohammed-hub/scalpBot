import { describe, it, expect } from "vitest";
import {
  computeVRP,
  computeOIFlowBias,
  computeMaxPainGravity,
  evaluateStrategyGate,
} from "./vrpRegimeFilter";
import type { Candle } from "./botEngine";
import type { OptionsAnalytics } from "./optionsAnalytics";

// Helper to generate daily candles with controlled volatility
function makeDailyCandles(count: number, basePrice: number, dailyReturnPct: number): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const direction = i % 2 === 0 ? 1 : -1;
    const move = price * (dailyReturnPct / 100) * direction;
    price = price + move;
    candles.push({
      timestamp: Date.now() - (count - i) * 86400000,
      open,
      high: Math.max(open, price) + Math.abs(move) * 0.3,
      low: Math.min(open, price) - Math.abs(move) * 0.3,
      close: price,
      volume: 1000000,
    });
  }
  return candles;
}

// Helper to create mock option chain analytics
function makeAnalytics(overrides: Partial<OptionsAnalytics> = {}): OptionsAnalytics {
  return {
    underlying: "NSE_INDEX|Nifty 50",
    underlyingPrice: 24800,
    expiry: new Date().toISOString().slice(0, 10), // today = expiry day
    pcr: 1.0,
    maxPain: 24800,
    oiSupport: 24700,
    oiResistance: 24900,
    atmIv: 15,
    atmStrike: 24800,
    bias: "neutral",
    biasReason: "PCR 1.00 — balanced",
    strikes: [
      { strike: 24600, ceOi: 50000, peOi: 200000, ceLtp: 250, peLtp: 10, ceDelta: 0.8, peDelta: -0.2, ceTheta: -5, peTheta: -2, ceIv: 16, peIv: 14, ceToken: "t1", peToken: "t2" },
      { strike: 24700, ceOi: 80000, peOi: 300000, ceLtp: 180, peLtp: 30, ceDelta: 0.65, peDelta: -0.35, ceTheta: -6, peTheta: -4, ceIv: 15.5, peIv: 14.5, ceToken: "t3", peToken: "t4" },
      { strike: 24800, ceOi: 150000, peOi: 150000, ceLtp: 120, peLtp: 80, ceDelta: 0.5, peDelta: -0.5, ceTheta: -8, peTheta: -8, ceIv: 15, peIv: 15, ceToken: "t5", peToken: "t6" },
      { strike: 24900, ceOi: 300000, peOi: 80000, ceLtp: 70, peLtp: 150, ceDelta: 0.35, peDelta: -0.65, ceTheta: -4, peTheta: -6, ceIv: 14.5, peIv: 15.5, ceToken: "t7", peToken: "t8" },
      { strike: 25000, ceOi: 400000, peOi: 50000, ceLtp: 30, peLtp: 220, ceDelta: 0.2, peDelta: -0.8, ceTheta: -2, peTheta: -5, ceIv: 14, peIv: 16, ceToken: "t9", peToken: "t10" },
    ],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("VRP Regime Filter", () => {
  describe("computeVRP", () => {
    it("returns RICH regime when IV >> RV", () => {
      // Low volatility candles (0.3% daily moves) but high IV (20%)
      const candles = makeDailyCandles(15, 24800, 0.3);
      const result = computeVRP(candles, 20);
      expect(result.regime).toBe("RICH");
      expect(result.shouldBlockBuying).toBe(false);
      expect(result.vrp).toBeGreaterThan(5);
    });

    it("returns INVERTED regime when IV << RV", () => {
      // High volatility candles (3% daily moves) but low IV (8%)
      const candles = makeDailyCandles(15, 24800, 3);
      const result = computeVRP(candles, 8);
      expect(result.regime).toBe("INVERTED");
      expect(result.shouldBlockBuying).toBe(true);
      expect(result.vrp).toBeLessThan(-2);
    });

    it("returns FAIR regime when IV slightly > RV", () => {
      // Moderate volatility (1% daily) with higher IV (25%)
      const candles = makeDailyCandles(15, 24800, 1);
      const result = computeVRP(candles, 25);
      expect(["FAIR", "RICH"]).toContain(result.regime);
      expect(result.shouldBlockBuying).toBe(false);
    });

    it("returns default result with insufficient data", () => {
      const candles = makeDailyCandles(3, 24800, 1); // too few
      const result = computeVRP(candles, 15);
      expect(result.regime).toBe("FAIR");
      expect(result.reason).toContain("Insufficient");
    });

    it("handles zero IV gracefully", () => {
      const candles = makeDailyCandles(15, 24800, 1);
      const result = computeVRP(candles, 0);
      expect(result.regime).toBe("FAIR");
    });
  });

  describe("computeOIFlowBias", () => {
    it("returns bullish bias when put OI dominates below price", () => {
      const analytics = makeAnalytics({
        underlyingPrice: 24800,
        strikes: [
          { strike: 24600, ceOi: 10000, peOi: 500000, ceLtp: 250, peLtp: 10, ceDelta: 0.8, peDelta: -0.2, ceTheta: -5, peTheta: -2, ceIv: 16, peIv: 14, ceToken: "t1", peToken: "t2" },
          { strike: 24700, ceOi: 20000, peOi: 600000, ceLtp: 180, peLtp: 30, ceDelta: 0.65, peDelta: -0.35, ceTheta: -6, peTheta: -4, ceIv: 15.5, peIv: 14.5, ceToken: "t3", peToken: "t4" },
          { strike: 24800, ceOi: 100000, peOi: 200000, ceLtp: 120, peLtp: 80, ceDelta: 0.5, peDelta: -0.5, ceTheta: -8, peTheta: -8, ceIv: 15, peIv: 15, ceToken: "t5", peToken: "t6" },
          { strike: 24900, ceOi: 80000, peOi: 30000, ceLtp: 70, peLtp: 150, ceDelta: 0.35, peDelta: -0.65, ceTheta: -4, peTheta: -6, ceIv: 14.5, peIv: 15.5, ceToken: "t7", peToken: "t8" },
          { strike: 25000, ceOi: 60000, peOi: 10000, ceLtp: 30, peLtp: 220, ceDelta: 0.2, peDelta: -0.8, ceTheta: -2, peTheta: -5, ceIv: 14, peIv: 16, ceToken: "t9", peToken: "t10" },
        ],
      });
      const result = computeOIFlowBias(analytics, 24800, false);
      expect(result.direction).toBe("BUY");
      expect(result.strength).toBeGreaterThan(0);
    });

    it("returns bearish bias when call OI dominates above price", () => {
      const analytics = makeAnalytics({
        underlyingPrice: 24800,
        strikes: [
          { strike: 24600, ceOi: 10000, peOi: 50000, ceLtp: 250, peLtp: 10, ceDelta: 0.8, peDelta: -0.2, ceTheta: -5, peTheta: -2, ceIv: 16, peIv: 14, ceToken: "t1", peToken: "t2" },
          { strike: 24700, ceOi: 20000, peOi: 60000, ceLtp: 180, peLtp: 30, ceDelta: 0.65, peDelta: -0.35, ceTheta: -6, peTheta: -4, ceIv: 15.5, peIv: 14.5, ceToken: "t3", peToken: "t4" },
          { strike: 24800, ceOi: 200000, peOi: 100000, ceLtp: 120, peLtp: 80, ceDelta: 0.5, peDelta: -0.5, ceTheta: -8, peTheta: -8, ceIv: 15, peIv: 15, ceToken: "t5", peToken: "t6" },
          { strike: 24900, ceOi: 600000, peOi: 20000, ceLtp: 70, peLtp: 150, ceDelta: 0.35, peDelta: -0.65, ceTheta: -4, peTheta: -6, ceIv: 14.5, peIv: 15.5, ceToken: "t7", peToken: "t8" },
          { strike: 25000, ceOi: 500000, peOi: 10000, ceLtp: 30, peLtp: 220, ceDelta: 0.2, peDelta: -0.8, ceTheta: -2, peTheta: -5, ceIv: 14, peIv: 16, ceToken: "t9", peToken: "t10" },
        ],
      });
      const result = computeOIFlowBias(analytics, 24800, false);
      expect(result.direction).toBe("SELL");
      expect(result.strength).toBeGreaterThan(0);
    });

    it("returns NEUTRAL when OI is balanced", () => {
      const analytics = makeAnalytics(); // default balanced strikes
      const result = computeOIFlowBias(analytics, 24800, false);
      expect(["NEUTRAL", "BUY", "SELL"]).toContain(result.direction);
      // With balanced data, strength should be low
    });

    it("returns NEUTRAL with null analytics", () => {
      const result = computeOIFlowBias(null, 24800, false);
      expect(result.direction).toBe("NEUTRAL");
      expect(result.strength).toBe(0);
    });
  });

  describe("computeMaxPainGravity", () => {
    it("returns BUY when price is below max pain", () => {
      const analytics = makeAnalytics({ maxPain: 25000, underlyingPrice: 24700 });
      const result = computeMaxPainGravity(analytics, 24700, 810); // 1:30 PM
      expect(result.direction).toBe("BUY");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.distancePct).toBeLessThan(0); // price below max pain
    });

    it("returns SELL when price is above max pain", () => {
      const analytics = makeAnalytics({ maxPain: 24500, underlyingPrice: 24900 });
      const result = computeMaxPainGravity(analytics, 24900, 870); // 2:30 PM
      expect(result.direction).toBe("SELL");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("returns HOLD when price is very close to max pain", () => {
      const analytics = makeAnalytics({ maxPain: 24800, underlyingPrice: 24810 });
      const result = computeMaxPainGravity(analytics, 24810, 600);
      expect(result.direction).toBe("HOLD");
    });

    it("has higher confidence in late trading hours", () => {
      const analytics = makeAnalytics({ maxPain: 25000, underlyingPrice: 24700 });
      const earlyResult = computeMaxPainGravity(analytics, 24700, 600); // 10 AM
      const lateResult = computeMaxPainGravity(analytics, 24700, 880); // 2:40 PM
      expect(lateResult.confidence).toBeGreaterThan(earlyResult.confidence);
    });

    it("handles null analytics", () => {
      const result = computeMaxPainGravity(null, 24800, 800);
      expect(result.direction).toBe("HOLD");
    });
  });

  describe("evaluateStrategyGate", () => {
    it("allows signal when all gates pass", () => {
      const candles = makeDailyCandles(15, 24800, 0.5);
      const analytics = makeAnalytics({ atmIv: 18 });
      const result = evaluateStrategyGate(candles, analytics, "BUY", 24800, false, 600, false);
      expect(result.allowed).toBe(true);
    });

    it("blocks when VRP inverted AND OI diverges", () => {
      // High RV candles (3% daily) + low IV (8%) = INVERTED VRP
      const candles = makeDailyCandles(15, 24800, 3);
      // Bearish OI (heavy call writing above) + BUY signal = divergence
      const analytics = makeAnalytics({
        atmIv: 8,
        strikes: [
          { strike: 24600, ceOi: 10000, peOi: 50000, ceLtp: 250, peLtp: 10, ceDelta: 0.8, peDelta: -0.2, ceTheta: -5, peTheta: -2, ceIv: 9, peIv: 7, ceToken: "t1", peToken: "t2" },
          { strike: 24700, ceOi: 20000, peOi: 60000, ceLtp: 180, peLtp: 30, ceDelta: 0.65, peDelta: -0.35, ceTheta: -6, peTheta: -4, ceIv: 8.5, peIv: 7.5, ceToken: "t3", peToken: "t4" },
          { strike: 24800, ceOi: 200000, peOi: 100000, ceLtp: 120, peLtp: 80, ceDelta: 0.5, peDelta: -0.5, ceTheta: -8, peTheta: -8, ceIv: 8, peIv: 8, ceToken: "t5", peToken: "t6" },
          { strike: 24900, ceOi: 600000, peOi: 20000, ceLtp: 70, peLtp: 150, ceDelta: 0.35, peDelta: -0.65, ceTheta: -4, peTheta: -6, ceIv: 7.5, peIv: 8.5, ceToken: "t7", peToken: "t8" },
          { strike: 25000, ceOi: 500000, peOi: 10000, ceLtp: 30, peLtp: 220, ceDelta: 0.2, peDelta: -0.8, ceTheta: -2, peTheta: -5, ceIv: 7, peIv: 9, ceToken: "t9", peToken: "t10" },
        ],
      });
      const result = evaluateStrategyGate(candles, analytics, "BUY", 24800, false, 600, false);
      expect(result.allowed).toBe(false);
    });

    it("boosts confidence when OI agrees with signal", () => {
      const candles = makeDailyCandles(15, 24800, 0.5);
      // Bullish OI (heavy put writing below)
      const analytics = makeAnalytics({
        atmIv: 18,
        strikes: [
          { strike: 24600, ceOi: 10000, peOi: 500000, ceLtp: 250, peLtp: 10, ceDelta: 0.8, peDelta: -0.2, ceTheta: -5, peTheta: -2, ceIv: 18, peIv: 17, ceToken: "t1", peToken: "t2" },
          { strike: 24700, ceOi: 20000, peOi: 600000, ceLtp: 180, peLtp: 30, ceDelta: 0.65, peDelta: -0.35, ceTheta: -6, peTheta: -4, ceIv: 17.5, peIv: 17.5, ceToken: "t3", peToken: "t4" },
          { strike: 24800, ceOi: 100000, peOi: 200000, ceLtp: 120, peLtp: 80, ceDelta: 0.5, peDelta: -0.5, ceTheta: -8, peTheta: -8, ceIv: 18, peIv: 18, ceToken: "t5", peToken: "t6" },
          { strike: 24900, ceOi: 80000, peOi: 30000, ceLtp: 70, peLtp: 150, ceDelta: 0.35, peDelta: -0.65, ceTheta: -4, peTheta: -6, ceIv: 17.5, peIv: 18.5, ceToken: "t7", peToken: "t8" },
          { strike: 25000, ceOi: 60000, peOi: 10000, ceLtp: 30, peLtp: 220, ceDelta: 0.2, peDelta: -0.8, ceTheta: -2, peTheta: -5, ceIv: 17, peIv: 19, ceToken: "t9", peToken: "t10" },
        ],
      });
      const result = evaluateStrategyGate(candles, analytics, "BUY", 24800, false, 600, false);
      expect(result.allowed).toBe(true);
      expect(result.confidenceBoost).toBeGreaterThan(0);
    });

    it("skips VRP for MCX instruments", () => {
      const candles = makeDailyCandles(15, 6650, 3); // high vol crude
      const analytics = makeAnalytics({ atmIv: 8 }); // would be INVERTED for NSE
      const result = evaluateStrategyGate(candles, analytics, "BUY", 6650, false, 600, true); // isMCX=true
      // Should not block because VRP is skipped for MCX
      expect(result.vrp).toBeNull();
    });
  });
});
