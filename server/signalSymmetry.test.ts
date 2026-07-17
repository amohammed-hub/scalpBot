/**
 * Tests for the CE/PE signal symmetry fixes (R19):
 * 1. detectFailedBreakout — range-top rejection produces SELL even when price > VWAP
 * 2. detectUptrendExhaustion — vetoes dip-buying on a fading rally
 * 3. Same-direction loss-streak guard — blocks a direction after 2 consecutive losses
 */
import { describe, it, expect } from "vitest";
import { detectFailedBreakout, detectUptrendExhaustion, type Candle } from "./botEngine";
import { recordDirectionalLoss, recordDirectionalWin, isDirectionBlocked, resetDirectionStreak } from "./riskManager";

function mkCandle(open: number, close: number, high?: number, low?: number, volume = 1000): Candle {
  return {
    open,
    close,
    high: high ?? Math.max(open, close) + 2,
    low: low ?? Math.min(open, close) - 2,
    volume,
    timestamp: Date.now(),
  } as Candle;
}

describe("detectFailedBreakout", () => {
  it("detects bearish failed breakout (poke above range high, close back below, red candle)", () => {
    const candles: Candle[] = [];
    // 30 candles ranging 24150–24250 (prior range)
    for (let i = 0; i < 30; i++) {
      const base = 24200 + Math.sin(i) * 40;
      candles.push(mkCandle(base, base + 5, base + 15, base - 15));
    }
    // Breakout attempt: pokes above 24250s high...
    candles.push(mkCandle(24240, 24280, 24295, 24235)); // strong push above range
    candles.push(mkCandle(24280, 24290, 24300, 24270)); // new high 24300
    candles.push(mkCandle(24290, 24270, 24292, 24260)); // stalls
    candles.push(mkCandle(24270, 24245, 24272, 24240)); // falls back
    candles.push(mkCandle(24245, 24215, 24248, 24210)); // red candle, closed back inside range
    const fb = detectFailedBreakout(candles, 30);
    expect(fb.detected).toBe(true);
    expect(fb.direction).toBe("SELL");
  });

  it("detects bullish failed breakdown (mirror)", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const base = 24200 + Math.sin(i) * 40;
      candles.push(mkCandle(base, base - 5, base + 15, base - 15));
    }
    candles.push(mkCandle(24170, 24140, 24175, 24135));
    candles.push(mkCandle(24140, 24120, 24145, 24110)); // pokes below range low
    candles.push(mkCandle(24120, 24135, 24140, 24115));
    candles.push(mkCandle(24135, 24160, 24165, 24130));
    candles.push(mkCandle(24160, 24195, 24200, 24155)); // green candle, back inside range
    const fb = detectFailedBreakout(candles, 30);
    expect(fb.detected).toBe(true);
    expect(fb.direction).toBe("BUY");
  });

  it("does not fire on a clean breakout that holds", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const base = 24200 + Math.sin(i) * 40;
      candles.push(mkCandle(base, base + 5, base + 15, base - 15));
    }
    // Clean breakout: closes keep rising above prior high
    candles.push(mkCandle(24240, 24270, 24280, 24235));
    candles.push(mkCandle(24270, 24300, 24310, 24265));
    candles.push(mkCandle(24300, 24330, 24340, 24295));
    candles.push(mkCandle(24330, 24350, 24360, 24325));
    candles.push(mkCandle(24350, 24380, 24390, 24345));
    const fb = detectFailedBreakout(candles, 30);
    expect(fb.detected).toBe(false);
  });
});

describe("detectUptrendExhaustion", () => {
  it("flags exhaustion when rally makes lower highs and retraces >50%", () => {
    const candles: Candle[] = [];
    // Base at 24100
    for (let i = 0; i < 10; i++) candles.push(mkCandle(24100, 24105, 24110, 24095));
    // Rally up to 24290
    for (let i = 0; i < 15; i++) {
      const base = 24100 + i * 13;
      candles.push(mkCandle(base, base + 13, base + 18, base - 5));
    }
    // Rolling over: lower highs, giving back more than half of the up-leg
    const highs = [24280, 24260, 24240, 24215, 24190, 24170, 24150];
    for (const h of highs) {
      candles.push(mkCandle(h, h - 20, h, h - 25));
    }
    const ex = detectUptrendExhaustion(candles);
    expect(ex.exhausted).toBe(true);
  });

  it("does not flag a healthy uptrend making higher highs", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const base = 24100 + i * 5;
      candles.push(mkCandle(base, base + 5, base + 8, base - 3));
    }
    const ex = detectUptrendExhaustion(candles);
    expect(ex.exhausted).toBe(false);
  });
});

describe("same-direction loss streak guard", () => {
  it("blocks a direction after 2 consecutive same-direction losses, allows opposite", () => {
    const token = "test-streak-1";
    resetDirectionStreak(token);
    recordDirectionalLoss(token, "BUY");
    expect(isDirectionBlocked(token, "BUY").blocked).toBe(false); // 1 loss — not yet
    recordDirectionalLoss(token, "BUY");
    expect(isDirectionBlocked(token, "BUY").blocked).toBe(true);  // 2 losses — blocked
    expect(isDirectionBlocked(token, "SELL").blocked).toBe(false); // opposite still allowed
    resetDirectionStreak(token);
  });

  it("a win in the same direction resets the streak", () => {
    const token = "test-streak-2";
    resetDirectionStreak(token);
    recordDirectionalLoss(token, "BUY");
    recordDirectionalWin(token, "BUY");
    recordDirectionalLoss(token, "BUY");
    expect(isDirectionBlocked(token, "BUY").blocked).toBe(false); // streak was reset by win
    resetDirectionStreak(token);
  });

  it("an opposite-direction loss restarts the streak fresh", () => {
    const token = "test-streak-3";
    resetDirectionStreak(token);
    recordDirectionalLoss(token, "BUY");
    recordDirectionalLoss(token, "SELL"); // switches tracked direction
    expect(isDirectionBlocked(token, "BUY").blocked).toBe(false);
    expect(isDirectionBlocked(token, "SELL").blocked).toBe(false); // only 1 SELL loss
    resetDirectionStreak(token);
  });
});
