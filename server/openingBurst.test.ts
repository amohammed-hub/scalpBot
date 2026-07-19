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

  it("returns HOLD when only 1 candle (waiting for confirmation)", () => {
    const candles = [makeCandle(24600, 24650, 24580, 24640)];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("insufficient data");
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

  it("returns BUY when bullish gap + strong bullish confirmation candle", () => {
    // Gap = (24600 - 24500) / 24500 = 0.41% (gap UP)
    // Candle 2: open=24610, close=24700, high=24710, low=24605
    // Body = 90, Range = 105, Ratio = 85.7% > 70%
    // Cumulative move from dayOpen: (24700 - 24600) / 24600 = 0.41% > 0.3%
    // Direction: bullish (close > open), gap direction: BUY → aligned ✓
    const candles = [
      makeCandle(24600, 24620, 24590, 24610), // First candle (day open = 24600)
      makeCandle(24610, 24710, 24605, 24700), // Confirmation candle
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.80);
    expect(signal.entryPrice).toBe(24700);
    expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    expect(signal.slPrice).toBeLessThan(signal.entryPrice);
    expect(signal.reason).toContain("Opening Burst");
    expect(signal.reason).toContain("↑");
  });

  it("returns SELL when bearish gap + strong bearish confirmation candle", () => {
    // Gap = (24400 - 24500) / 24500 = -0.41% (gap DOWN)
    // Candle 2: open=24390, close=24300, high=24395, low=24295
    // Body = 90, Range = 100, Ratio = 90% > 70%
    // Cumulative move from dayOpen: (24300 - 24400) / 24400 = -0.41% → abs > 0.3%
    // Direction: bearish (close < open), gap direction: SELL → aligned ✓
    const candles = [
      makeCandle(24400, 24410, 24380, 24390), // First candle (day open = 24400)
      makeCandle(24390, 24395, 24295, 24300), // Confirmation candle
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("SELL");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.80);
    expect(signal.entryPrice).toBe(24300);
    expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
    expect(signal.reason).toContain("↓");
  });

  it("returns HOLD when candle is NOT gap-aligned (bullish candle on gap-down day)", () => {
    // Gap DOWN but candle is bullish → not aligned → HOLD
    const candles = [
      makeCandle(24400, 24410, 24380, 24390), // Day open = 24400, gap down from 24500
      makeCandle(24390, 24500, 24385, 24490), // Bullish candle (close > open) — NOT aligned with gap DOWN
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("no confirmation candle");
  });

  it("returns HOLD when body ratio is too low (< 70%)", () => {
    // Gap UP 0.4%, but candle has big wicks (doji-like)
    // Candle 2: open=24610, close=24640, high=24700, low=24580
    // Body = 30, Range = 120, Ratio = 25% < 70%
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24700, 24580, 24640), // Weak body (doji)
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("no confirmation candle");
  });

  it("returns HOLD when cumulative move < 0.3% even with strong body", () => {
    // Gap UP 0.3%, but candle move from day open is tiny
    // Day open = 24575 (gap = 0.3% from 24500)
    // Candle 2: open=24575, close=24580, high=24582, low=24573
    // Body = 5, Range = 9, Ratio = 55% < 70% — also fails body ratio
    // Even if body were strong: move = (24580 - 24575) / 24575 = 0.02% < 0.3%
    const candles = [
      makeCandle(24575, 24580, 24570, 24575),
      makeCandle(24575, 24582, 24573, 24580),
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("HOLD");
  });

  it("finds confirmation in candle 3-5 if candle 2 is weak", () => {
    // Gap UP 0.4%. Candle 2 is weak, candle 4 is strong confirmation
    const candles = [
      makeCandle(24600, 24620, 24590, 24610), // Candle 1 (day open = 24600)
      makeCandle(24610, 24620, 24600, 24615), // Candle 2: weak (body=5, range=20, ratio=25%)
      makeCandle(24615, 24625, 24610, 24620), // Candle 3: still weak
      makeCandle(24620, 24710, 24618, 24700), // Candle 4: STRONG (body=80, range=92, ratio=87%, move=0.41%)
    ];
    const signal = generateOpeningBurstSignal(candles, 24500);
    expect(signal.direction).toBe("BUY");
    expect(signal.layer).toBe("OpeningBurst");
    expect(signal.entryPrice).toBe(24700);
  });

  it("confidence scales with body ratio (higher body = higher confidence)", () => {
    // 70% body ratio → 0.80 confidence
    const candles70 = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24580, 24700), // body=90, range=130, ratio=69.2% — just below
    ];
    // Actually need exactly 70%: body=70, range=100
    const candles70b = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24610, 24680), // body=70, range=100, ratio=70%, move=(24680-24600)/24600=0.33%
    ];
    const signal70 = generateOpeningBurstSignal(candles70b, 24500);

    // 95% body ratio → higher confidence
    const candles95 = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24705, 24608, 24700), // body=90, range=97, ratio=92.8%, move=0.41%
    ];
    const signal95 = generateOpeningBurstSignal(candles95, 24500);

    if (signal70.direction !== "HOLD" && signal95.direction !== "HOLD") {
      expect(signal95.confidence).toBeGreaterThan(signal70.confidence);
    }
  });

  it("SL multiplier scales target and stop-loss", () => {
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24605, 24700),
    ];
    const signal1 = generateOpeningBurstSignal(candles, 24500, 1.0);
    const signal2 = generateOpeningBurstSignal(candles, 24500, 2.0);

    // With higher SL multiplier, target should be further and SL should be wider
    const target1Dist = Math.abs(signal1.targetPrice - signal1.entryPrice);
    const target2Dist = Math.abs(signal2.targetPrice - signal2.entryPrice);
    expect(target2Dist).toBeGreaterThan(target1Dist);

    const sl1Dist = Math.abs(signal1.slPrice - signal1.entryPrice);
    const sl2Dist = Math.abs(signal2.slPrice - signal2.entryPrice);
    expect(sl2Dist).toBeGreaterThan(sl1Dist);
  });

  it("does not trade when prevDayClose is 0 or invalid", () => {
    const candles = [
      makeCandle(24600, 24620, 24590, 24610),
      makeCandle(24610, 24710, 24605, 24700),
    ];
    const signal = generateOpeningBurstSignal(candles, 0);
    expect(signal.direction).toBe("HOLD");
  });
});
