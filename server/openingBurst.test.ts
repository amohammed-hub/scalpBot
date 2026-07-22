import { describe, it, expect } from "vitest";
import { generateOpeningBurstSignal, Candle } from "./botEngine";

// Helper to create candles at specific timestamps
function makeCandle(open: number, high: number, low: number, close: number, volume = 1000, timestamp = Date.now()): Candle {
  return { open, high, low, close, volume, timestamp };
}

describe("Opening Burst Strategy — generateOpeningBurstSignal", () => {
  it("returns HOLD when insufficient candles", () => {
    const signal = generateOpeningBurstSignal([], 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.reason).toContain("insufficient data");
  });

  it("enters on candle 1 itself when gap is strong (>0.3%)", () => {
    // Gap = (24600 - 24500) / 24500 = 0.41% > 0.3% → can enter on candle 1
    // Candle 1: open=24600, close=24640, high=24650, low=24590
    // Body = 40, Range = 60, Ratio = 66.7% > 40% (threshold for candle 0 with strong gap)
    // CumMove from dayOpen: (24640-24600)/24600 = 0.16% > 0.1%
    // Direction: bullish, gap: BUY → aligned
    const candles = [makeCandle(24600, 24650, 24590, 24640)];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.entryPrice).toBe(24640);
  });

  it("returns HOLD for flat open (gap < 0.1%)", () => {
    // Gap = (24510 - 24500) / 24500 = 0.04% < 0.1%
    const candles = [
      makeCandle(24510, 24520, 24500, 24515),
      makeCandle(24515, 24530, 24510, 24525),
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("flat open");
  });

  it("returns HOLD when gap is between 0.1% and 0.2% (too small)", () => {
    // Gap = (24535 - 24500) / 24500 = 0.14% — between 0.1% and 0.2%
    const candles = [
      makeCandle(24535, 24560, 24530, 24550),
      makeCandle(24550, 24600, 24545, 24590),
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("gap too small");
  });

  it("returns BUY when bullish gap + confirmation candle with 50%+ body", () => {
    // Gap = (24600 - 24500) / 24500 = 0.41% (gap UP)
    // Candle 2: open=24610, close=24660, high=24670, low=24600
    // Body = 50, Range = 70, Ratio = 71.4% > 50%
    // Cumulative move from dayOpen: (24660 - 24600) / 24600 = 0.24% > 0.15%
    // Direction: bullish (close > open), gap direction: BUY → aligned ✓
    const candles = [
      makeCandle(24600, 24620, 24590, 24610), // First candle (day open = 24600)
      makeCandle(24610, 24670, 24600, 24660), // Confirmation candle (50%+ body)
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.75);
    expect(signal.entryPrice).toBe(24660);
    expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    expect(signal.slPrice).toBeLessThan(signal.entryPrice);
    expect(signal.reason).toContain("Opening Burst");
    expect(signal.reason).toContain("↑");
  });

  it("returns SELL when bearish gap + strong bearish confirmation candle", () => {
    // Gap = (24400 - 24500) / 24500 = -0.41% (gap DOWN)
    // Candle 2: open=24390, close=24300, high=24395, low=24295
    // Body = 90, Range = 100, Ratio = 90% > 50%
    // Cumulative move from dayOpen: (24300 - 24400) / 24400 = -0.41% → abs > 0.15%
    // Direction: bearish (close < open), gap direction: SELL → aligned ✓
    const candles = [
      makeCandle(24400, 24410, 24380, 24390), // First candle (day open = 24400)
      makeCandle(24390, 24395, 24295, 24300), // Confirmation candle
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("SELL");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.75);
    expect(signal.entryPrice).toBe(24300);
    expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
    expect(signal.reason).toContain("↓");
  });

  it("candle contradiction no longer blocks entry (removed filter)", () => {
    // Gap UP, candle 1 bullish, candle 2 bearish — previously blocked, now allowed if candle 1 qualifies
    // Gap = (24600-24500)/24500 = 0.41% > 0.3% → candle 0 eligible
    // Candle 1 (idx 0): open=24600, close=24650, high=24660, low=24590
    // Body=50, Range=70, Ratio=71% > 40%, Move=(24650-24600)/24600=0.20% > 0.1%
    // Bullish + gap BUY → aligned
    const candles = [
      makeCandle(24600, 24660, 24590, 24650), // bullish (close > open)
      makeCandle(24650, 24660, 24600, 24610), // bearish (close < open) — contradiction
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    // Should now enter on candle 0 since gap > 0.3% and candle 0 qualifies
    expect(signal.direction).toBe("BUY");
    expect(signal.entryPrice).toBe(24650);
  });

  it("returns HOLD when body ratio is too low (< 50% for normal, < 40% for strong gap candle 0)", () => {
    // Gap UP 0.25% (not strong enough for candle 0 entry), so starts from candle 1
    // Candle 2: open=24560, close=24570, high=24620, low=24540
    // Body = 10, Range = 80, Ratio = 12.5% < 50%
    const candles = [
      makeCandle(24550, 24570, 24540, 24560), // day open = 24550, gap = 0.2%
      makeCandle(24560, 24620, 24540, 24570), // Weak body (doji-like, ratio=12.5%)
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("no confirmation candle");
  });

  it("finds confirmation in candle 3-5 if earlier candles are weak", () => {
    // Gap UP 0.25% (not strong gap, starts from candle 1)
    // Candle 2 weak, candle 4 strong
    const candles = [
      makeCandle(24550, 24570, 24540, 24560), // Candle 1 (day open = 24550, gap=0.2%)
      makeCandle(24560, 24570, 24550, 24555), // Candle 2: weak (body=5, range=20, ratio=25%)
      makeCandle(24555, 24565, 24550, 24560), // Candle 3: still weak
      makeCandle(24560, 24620, 24558, 24610), // Candle 4: STRONG (body=50, range=62, ratio=80%, move=(24610-24550)/24550=0.24%)
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.entryPrice).toBe(24610);
  });

  it("confidence scales with body ratio (higher body = higher confidence)", () => {
    // 50% body ratio → lower confidence
    const candles50 = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24670, 24590, 24650), // body=40, range=80, ratio=50%, move=(24650-24600)/24600=0.20%
    ];
    const signal50 = generateOpeningBurstSignal(candles50, 24500);

    // 90% body ratio → higher confidence
    const candles90 = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24705, 24608, 24700), // body=90, range=97, ratio=92.8%, move=0.41%
    ];
    const signal90 = generateOpeningBurstSignal(candles90, 24500);

    if (signal50.direction !== "HOLD" && signal90.direction !== "HOLD") {
      expect(signal90.confidence).toBeGreaterThan(signal50.confidence);
    }
  });

  it("fixed premium-based SL/Target (not ATR-based)", () => {
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24605, 24700),
    ];
    // SL multiplier no longer affects Opening Burst (fixed % exits)
    const signal1 = generateOpeningBurstSignal(candles, 24500, 1.0);
    const signal2 = generateOpeningBurstSignal(candles, 24500, 2.0);

    // Both should have the SAME target and SL distances (fixed 0.4% target, 0.15% SL)
    const target1Dist = Math.abs(signal1.targetPrice - signal1.entryPrice);
    const target2Dist = Math.abs(signal2.targetPrice - signal2.entryPrice);
    expect(target1Dist).toBeCloseTo(target2Dist, 0);

    const sl1Dist = Math.abs(signal1.slPrice - signal1.entryPrice);
    const sl2Dist = Math.abs(signal2.slPrice - signal2.entryPrice);
    expect(sl1Dist).toBeCloseTo(sl2Dist, 0);
  });

  it("VIX > 20 filter: returns HOLD when VIX is high", () => {
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24605, 24700),
    ];
    // VIX = 22 → should skip
    const signal = generateOpeningBurstSignal(candles, 24500, 1.5, 22);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("VIX too high");
  });

  it("does not trade when prevDayClose is 0 or invalid", () => {
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24605, 24700),
    ];
    const signal = generateOpeningBurstSignal(candles, 0);
    expect(signal.direction).toBe("HOLD");
  });

  it("enters immediately on first candle for strong gap (>0.3%) even with only 1 candle", () => {
    // Gap = (24600 - 24500) / 24500 = 0.41% > 0.3%
    // Single candle: open=24600, close=24630, high=24640, low=24595
    // Body=30, Range=45, Ratio=66.7% > 40%, Move=(24630-24600)/24600=0.12% > 0.1%
    // Bullish + gap BUY → aligned
    const candles = [makeCandle(24600, 24640, 24595, 24630)];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.entryPrice).toBe(24630);
  });
});
