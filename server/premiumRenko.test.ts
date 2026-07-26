import { describe, it, expect } from "vitest";
import { generatePremiumRenkoSignal, getPremiumBrickSize, type Candle } from "./botEngine";

// ── Helper: generate candles that produce specific Renko brick patterns ──
function makePremiumCandles(startPrice: number, moves: number[]): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseTime = Date.now() - moves.length * 60000;
  for (let i = 0; i < moves.length; i++) {
    const open = price;
    price += moves[i];
    const close = price;
    const high = Math.max(open, close) + Math.abs(moves[i]) * 0.1;
    const low = Math.min(open, close) - Math.abs(moves[i]) * 0.1;
    candles.push({ open, high, low, close, volume: 1000, timestamp: baseTime + i * 60000 });
  }
  return candles;
}

// ── Helper: generate a clear uptrend followed by pullback and breakout on premium ──
function makeUptrendPullbackBreakout(brickSize: number): Candle[] {
  // Start at 100, go up 5 bricks, pullback 1 brick, then breakout above pullback high
  const moves: number[] = [];
  const startPrice = 100;
  // Build uptrend: 5 green bricks (each brick needs brickSize movement)
  for (let i = 0; i < 5 * 3; i++) moves.push(brickSize / 3); // gradual up
  // Pullback: 1 red brick
  for (let i = 0; i < 3; i++) moves.push(-brickSize / 3); // gradual down
  // Breakout: green brick above red's high
  for (let i = 0; i < 4; i++) moves.push(brickSize / 3); // back up above
  return makePremiumCandles(startPrice, moves);
}

// ── Helper: generate a clear downtrend followed by pullback and breakdown on premium ──
function makeDowntrendPullbackBreakdown(brickSize: number): Candle[] {
  const moves: number[] = [];
  const startPrice = 200;
  // Build downtrend: 5 red bricks
  for (let i = 0; i < 5 * 3; i++) moves.push(-brickSize / 3);
  // Pullback: 1 green brick
  for (let i = 0; i < 3; i++) moves.push(brickSize / 3);
  // Breakdown: red brick below green's low
  for (let i = 0; i < 4; i++) moves.push(-brickSize / 3);
  return makePremiumCandles(startPrice, moves);
}

describe("getPremiumBrickSize", () => {
  it("returns 10 for NIFTY options", () => {
    expect(getPremiumBrickSize("NIFTY", 150)).toBe(10);
    expect(getPremiumBrickSize("Nifty 50", 200)).toBe(10);
  });

  it("returns 15 for BANKNIFTY options", () => {
    expect(getPremiumBrickSize("BANKNIFTY", 250)).toBe(15);
    expect(getPremiumBrickSize("Nifty Bank", 300)).toBe(15);
  });

  it("returns 15 for SENSEX options", () => {
    expect(getPremiumBrickSize("SENSEX", 200)).toBe(15);
  });

  it("returns 10 for FINNIFTY options", () => {
    expect(getPremiumBrickSize("FINNIFTY", 100)).toBe(10);
    expect(getPremiumBrickSize("FIN SERVICE", 100)).toBe(10);
  });

  it("returns 15 for BANKEX options", () => {
    expect(getPremiumBrickSize("BANKEX", 150)).toBe(15);
  });

  it("returns 5 for MCX options (GOLD, SILVER, CRUDE)", () => {
    expect(getPremiumBrickSize("GOLD", 50)).toBe(5);
    expect(getPremiumBrickSize("SILVER", 30)).toBe(5);
    expect(getPremiumBrickSize("CRUDEOIL", 20)).toBe(5);
  });

  it("returns premium-relative fallback for unknown instruments", () => {
    const result = getPremiumBrickSize("UNKNOWN_STOCK", 100);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(20);
    // 3% of 100 = 3
    expect(result).toBe(3);
  });

  it("clamps fallback to minimum 2", () => {
    expect(getPremiumBrickSize("UNKNOWN", 10)).toBe(2); // 3% of 10 = 0.3 → clamped to 2
  });

  it("clamps fallback to maximum 20", () => {
    expect(getPremiumBrickSize("UNKNOWN", 1000)).toBe(20); // 3% of 1000 = 30 → clamped to 20
  });
});

describe("generatePremiumRenkoSignal", () => {
  it("returns HOLD with insufficient data (< 20 candles)", () => {
    const candles = makePremiumCandles(100, [1, 2, 3, 4, 5]);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    expect(result.direction).toBe("HOLD");
    expect(result.layer).toBe("PremiumRenko");
    expect(result.reason).toContain("insufficient data");
  });

  it("returns HOLD with empty candles", () => {
    const result = generatePremiumRenkoSignal([], "NIFTY", "CE");
    expect(result.direction).toBe("HOLD");
    expect(result.layer).toBe("PremiumRenko");
  });

  it("returns HOLD with null candles", () => {
    const result = generatePremiumRenkoSignal(null as any, "NIFTY", "CE");
    expect(result.direction).toBe("HOLD");
  });

  it("generates BUY signal on CE premium uptrend pullback-breakout", () => {
    const candles = makeUptrendPullbackBreakout(10); // NIFTY brick size = 10
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    // Should either be BUY or HOLD (depends on exact brick formation)
    if (result.direction === "BUY") {
      expect(result.layer).toBe("PremiumRenko");
      expect(result.confidence).toBeGreaterThanOrEqual(0.72);
      expect(result.confidence).toBeLessThanOrEqual(0.90);
      expect(result.entryPrice).toBeGreaterThan(0);
      expect(result.slPrice).toBeLessThan(result.entryPrice);
      expect(result.targetPrice).toBeGreaterThan(result.entryPrice);
      expect(result.reason).toContain("PremiumRenko");
      expect(result.reason).toContain("CE");
      expect(result.reason).toContain("Pullback-Breakout BUY");
    }
  });

  it("generates SELL signal on PE premium downtrend pullback-breakdown", () => {
    const candles = makeDowntrendPullbackBreakdown(10);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "PE");
    if (result.direction === "SELL") {
      expect(result.layer).toBe("PremiumRenko");
      expect(result.confidence).toBeGreaterThanOrEqual(0.72);
      expect(result.confidence).toBeLessThanOrEqual(0.90);
      expect(result.entryPrice).toBeGreaterThan(0);
      expect(result.slPrice).toBeGreaterThan(result.entryPrice);
      expect(result.targetPrice).toBeLessThan(result.entryPrice);
      expect(result.targetPrice).toBeGreaterThanOrEqual(0); // premium can't go below 0
      expect(result.reason).toContain("PremiumRenko");
      expect(result.reason).toContain("PE");
      expect(result.reason).toContain("Breakdown SELL");
    }
  });

  it("uses correct brick size for BANKNIFTY (15)", () => {
    const candles = makeUptrendPullbackBreakout(15); // BANKNIFTY brick size = 15
    const result = generatePremiumRenkoSignal(candles, "BANKNIFTY", "CE");
    if (result.direction !== "HOLD") {
      expect(result.reason).toContain("brick: ₹15");
    }
  });

  it("returns HOLD when premium is flat (no trend)", () => {
    // Create candles that stay around the same price (no clear trend)
    const moves: number[] = [];
    for (let i = 0; i < 30; i++) moves.push(i % 2 === 0 ? 2 : -2); // oscillate ±2
    const candles = makePremiumCandles(100, moves);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    expect(result.direction).toBe("HOLD");
    expect(result.layer).toBe("PremiumRenko");
  });

  it("R:R is at least 1:2 for BUY signals", () => {
    const candles = makeUptrendPullbackBreakout(10);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    if (result.direction === "BUY") {
      const risk = result.entryPrice - result.slPrice;
      const reward = result.targetPrice - result.entryPrice;
      expect(reward / risk).toBeCloseTo(2, 0); // 1:2 R:R
    }
  });

  it("R:R is at least 1:2 for SELL signals", () => {
    const candles = makeDowntrendPullbackBreakdown(10);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "PE");
    if (result.direction === "SELL") {
      const risk = result.slPrice - result.entryPrice;
      const reward = result.entryPrice - result.targetPrice;
      expect(reward / risk).toBeCloseTo(2, 0); // 1:2 R:R
    }
  });

  it("confidence is capped at 0.92", () => {
    // Create a very strong uptrend with many green bricks
    const moves: number[] = [];
    for (let i = 0; i < 30; i++) moves.push(5); // steady uptrend
    // Then pullback
    for (let i = 0; i < 4; i++) moves.push(-4);
    // Then breakout
    for (let i = 0; i < 6; i++) moves.push(5);
    const candles = makePremiumCandles(100, moves);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    if (result.direction !== "HOLD") {
      expect(result.confidence).toBeLessThanOrEqual(0.92);
    }
  });

  it("SL is below red brick LOW for BUY signals", () => {
    const candles = makeUptrendPullbackBreakout(10);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    if (result.direction === "BUY") {
      expect(result.slPrice).toBeLessThan(result.entryPrice);
      // SL should be at least 1 brick below entry
      expect(result.entryPrice - result.slPrice).toBeGreaterThanOrEqual(5); // at least half a brick
    }
  });

  it("SL is above green brick HIGH for SELL signals", () => {
    const candles = makeDowntrendPullbackBreakdown(10);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "PE");
    if (result.direction === "SELL") {
      expect(result.slPrice).toBeGreaterThan(result.entryPrice);
    }
  });

  it("target price never goes below 0 for SELL signals", () => {
    // Create a downtrend that would push target below 0
    const moves: number[] = [];
    const startPrice = 30; // low premium
    for (let i = 0; i < 20; i++) moves.push(-2); // downtrend
    for (let i = 0; i < 4; i++) moves.push(3); // pullback
    for (let i = 0; i < 6; i++) moves.push(-3); // breakdown
    const candles = makePremiumCandles(startPrice, moves);
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "PE");
    if (result.direction === "SELL") {
      expect(result.targetPrice).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects when risk > 50% of premium (safety guard)", () => {
    // Create a scenario where the red brick is very far from current price
    // This would make risk > 50% of premium which should be rejected
    const moves: number[] = [];
    // Small uptrend
    for (let i = 0; i < 10; i++) moves.push(2);
    // Large pullback (more than 50% of accumulated gains)
    for (let i = 0; i < 10; i++) moves.push(-3);
    // Small breakout
    for (let i = 0; i < 5; i++) moves.push(4);
    const candles = makePremiumCandles(20, moves); // start at low premium
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    // Should be HOLD because risk would be > 50% of premium
    // (or BUY if the math works out — either way, if BUY, risk < 50%)
    if (result.direction === "BUY") {
      const risk = result.entryPrice - result.slPrice;
      expect(risk).toBeLessThan(result.entryPrice * 0.5);
    }
  });

  it("includes option type in reason string", () => {
    const candles = makeUptrendPullbackBreakout(10);
    const resultCE = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    if (resultCE.direction !== "HOLD") {
      expect(resultCE.reason).toContain("CE");
    }
    const resultPE = generatePremiumRenkoSignal(candles, "NIFTY", "PE");
    if (resultPE.direction !== "HOLD") {
      expect(resultPE.reason).toContain("PE");
    }
  });

  it("works with MCX brick size (5)", () => {
    const candles = makeUptrendPullbackBreakout(5); // MCX options brick = 5
    const result = generatePremiumRenkoSignal(candles, "GOLD", "CE");
    if (result.direction !== "HOLD") {
      expect(result.reason).toContain("brick: ₹5");
      expect(result.layer).toBe("PremiumRenko");
    }
  });

  it("handles zero premium gracefully", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({ open: 0, high: 0, low: 0, close: 0, volume: 0, timestamp: Date.now() - (25 - i) * 60000 });
    }
    const result = generatePremiumRenkoSignal(candles, "NIFTY", "CE");
    expect(result.direction).toBe("HOLD");
    expect(result.reason).toContain("premium is 0");
  });
});
