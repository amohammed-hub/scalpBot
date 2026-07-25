/**
 * Red Bar Theory V2 — Dr. Devendra Pratap's Exact Rules
 * Tests the pullback-breakout pattern with fixed brick sizes and EMA 10 filter.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateRenkoSignal, getFixedBrickSize, checkRenkoExit } from "./botEngine";
import type { Candle } from "./botEngine";

// Mock time to IST 10:00 AM (within market hours)
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T04:30:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

// ── Helper: Generate candles with a specific price pattern ──
function makeCandles(prices: number[], startTime = Date.now() - 100 * 60000): Candle[] {
  return prices.map((p, i) => ({
    open: i > 0 ? prices[i - 1] : p - 2,
    high: p + 3,
    low: p - 3,
    close: p,
    volume: 100000,
    timestamp: startTime + i * 60000,
  }));
}

describe("getFixedBrickSize", () => {
  it("returns 10 for NIFTY", () => {
    expect(getFixedBrickSize("NIFTY", 50)).toBe(10);
  });
  it("returns 15 for BANKNIFTY", () => {
    expect(getFixedBrickSize("BANKNIFTY", 100)).toBe(15);
  });
  it("returns 30 for SENSEX", () => {
    expect(getFixedBrickSize("SENSEX", 200)).toBe(30);
  });
  it("returns 50 for GOLD", () => {
    expect(getFixedBrickSize("GOLD", 100)).toBe(50);
  });
  it("returns 500 for SILVER", () => {
    expect(getFixedBrickSize("SILVER", 1000)).toBe(500);
  });
  it("returns 10 for CRUDEOIL", () => {
    expect(getFixedBrickSize("CRUDEOIL", 30)).toBe(10);
  });
  it("returns ATR*0.5 fallback for unknown symbol", () => {
    expect(getFixedBrickSize("UNKNOWN", 40)).toBe(20);
  });
  it("handles case-insensitive matching", () => {
    expect(getFixedBrickSize("nifty", 50)).toBe(10);
    expect(getFixedBrickSize("BankNifty", 100)).toBe(15);
  });
});

describe("generateRenkoSignal — Pullback-Breakout BUY", () => {
  it("generates BUY when uptrend + red pullback + green above red HIGH", () => {
    const prices: number[] = [];
    let p = 24000;
    // 20 flat candles (stable base for ATR)
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Up 80 pts = 8 green bricks of 10
    for (let i = 0; i < 80; i++) { p += 1; prices.push(p); }
    // Down 15 pts = 1 red brick (base moves from 24080 to 24070)
    for (let i = 0; i < 15; i++) { p -= 1; prices.push(p); }
    // Up 25 pts = 2 green bricks (close at 24090 >= red HIGH 24080) ✓
    for (let i = 0; i < 25; i++) { p += 1; prices.push(p); }
    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "NIFTY");

    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("RedBarTheory");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.70);
    expect(signal.slPrice).toBeLessThan(signal.entryPrice);
    // Verify 1:2 R:R
    const risk = signal.entryPrice - signal.slPrice;
    const reward = signal.targetPrice - signal.entryPrice;
    expect(reward / risk).toBeCloseTo(2, 0);
    expect(signal.reason).toContain("Pullback-Breakout BUY");
  });

  it("returns HOLD when no pullback exists (pure momentum)", () => {
    // Pure uptrend with no pullback — should NOT trigger (this was the old broken behavior)
    const prices: number[] = [];
    let p = 24000;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Straight up: 100 candles * 1 pt = 100 pts = 10 green bricks, no red
    for (let i = 0; i < 100; i++) { p += 1; prices.push(p); }

    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "NIFTY");

    // Should be HOLD because there's no pullback (no red brick followed by green above red HIGH)
    expect(signal.direction).toBe("HOLD");
  });

  it("returns HOLD when price is below EMA 10 (wrong trend)", () => {
    // Downtrend trying to generate BUY — should be blocked by EMA filter
    const prices: number[] = [];
    let p = 24100;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Down 80 pts, then tiny up 20
    for (let i = 0; i < 80; i++) { p -= 1; prices.push(p); }
    for (let i = 0; i < 12; i++) { p += 1; prices.push(p); }
    for (let i = 0; i < 15; i++) { p -= 1.5; prices.push(p); }

    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "NIFTY");

    // Should not be BUY — price is below EMA 10
    expect(signal.direction).not.toBe("BUY");
  });
});

describe("generateRenkoSignal — Pullback-Breakout SELL", () => {
  it("generates SELL when downtrend + green pullback + red below green LOW", () => {
    const prices: number[] = [];
    let p = 24200;
    // 20 flat candles
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Down 80 pts = 8 red bricks of 10
    for (let i = 0; i < 80; i++) { p -= 1; prices.push(p); }
    // Up 15 pts = 1 green brick (base moves from 24120 to 24130)
    for (let i = 0; i < 15; i++) { p += 1; prices.push(p); }
    // Down 25 pts = 2 red bricks (close at 24110 <= green LOW 24120) ✓
    for (let i = 0; i < 25; i++) { p -= 1; prices.push(p); }
    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "NIFTY");

    expect(signal.direction).toBe("SELL");
    expect(signal.layer).toBe("RedBarTheory");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.70);
    expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
    // Verify 1:2 R:R
    const risk = signal.slPrice - signal.entryPrice;
    const reward = signal.entryPrice - signal.targetPrice;
    expect(reward / risk).toBeCloseTo(2, 0);
    expect(signal.reason).toContain("Pullback-Breakout SELL");
  });
});

describe("generateRenkoSignal — Fixed Brick Sizes", () => {
  it("uses brick=15 for BANKNIFTY", () => {
    // BankNifty needs 15-pt bricks. Create uptrend that generates bricks at 15-pt intervals.
    const prices: number[] = [];
    let p = 52000;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Up 90 pts (6 bricks of 15), then down 18 (1 red), then up 35 (2 green above red HIGH)
    for (let i = 0; i < 90; i++) { p += 1; prices.push(p); }
    for (let i = 0; i < 18; i++) { p -= 1; prices.push(p); }
    for (let i = 0; i < 23; i++) { p += 1.5; prices.push(p); }

    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "BANKNIFTY");

    expect(signal.direction).toBe("BUY");
    expect(signal.reason).toContain("brick: ₹15");
  });

  it("uses brick=30 for SENSEX", () => {
    // Sensex needs 30-pt bricks
    const prices: number[] = [];
    let p = 80000;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    // Up 180 pts (6 bricks of 30), then down 35 (1 red), then up 65 (2 green)
    for (let i = 0; i < 180; i++) { p += 1; prices.push(p); }
    for (let i = 0; i < 35; i++) { p -= 1; prices.push(p); }
    for (let i = 0; i < 44; i++) { p += 1.5; prices.push(p); }

    const candles = makeCandles(prices);
    const signal = generateRenkoSignal(candles, "SENSEX");

    expect(signal.direction).toBe("BUY");
    expect(signal.reason).toContain("brick: ₹30");
  });
});

describe("checkRenkoExit — opposite brick exit", () => {
  it("exits BUY trade when red brick forms", () => {
    // Uptrend then reversal
    const prices: number[] = [];
    let p = 24000;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    for (let i = 0; i < 50; i++) { p += 1; prices.push(p); } // 5 green bricks
    for (let i = 0; i < 15; i++) { p -= 1; prices.push(p); } // 1 red brick

    const candles = makeCandles(prices);
    const result = checkRenkoExit(candles, "BUY", 10);

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain("red brick formed");
  });

  it("does NOT exit BUY trade when still in green bricks", () => {
    const prices: number[] = [];
    let p = 24000;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    for (let i = 0; i < 50; i++) { p += 1; prices.push(p); } // 5 green bricks, no red

    const candles = makeCandles(prices);
    const result = checkRenkoExit(candles, "BUY", 10);

    expect(result.shouldExit).toBe(false);
  });

  it("exits SELL trade when green brick forms", () => {
    const prices: number[] = [];
    let p = 24200;
    for (let i = 0; i < 20; i++) { prices.push(p); }
    for (let i = 0; i < 50; i++) { p -= 1; prices.push(p); } // 5 red bricks
    for (let i = 0; i < 15; i++) { p += 1; prices.push(p); } // 1 green brick

    const candles = makeCandles(prices);
    const result = checkRenkoExit(candles, "SELL", 10);

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain("green brick formed");
  });
});
