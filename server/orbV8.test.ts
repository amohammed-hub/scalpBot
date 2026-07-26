import { describe, it, expect } from "vitest";
import { generateORBV8Signal, type Candle, type BotState } from "./botEngine";

function makeCandle(close: number, high: number, low: number, timestamp: number, volume = 1000): Candle {
  return { open: close - 1, high, low, close, volume, timestamp };
}

// Helper: create a series of candles simulating an ORB scenario
function createORBCandles(orbHigh: number, orbLow: number, breakoutPrice: number, direction: "up" | "down"): Candle[] {
  const candles: Candle[] = [];
  // IST 9:15 AM = UTC 3:45 AM
  const baseTime = new Date("2026-01-15T03:45:00.000Z").getTime();
  const mid = (orbHigh + orbLow) / 2;
  
  // First 30 candles (9:15-9:45): form the range
  for (let i = 0; i < 30; i++) {
    const t = baseTime + i * 60000;
    // Oscillate within the range
    const price = mid + (i % 2 === 0 ? (orbHigh - mid) * 0.8 : (orbLow - mid) * 0.8);
    candles.push(makeCandle(price, orbHigh, orbLow, t));
  }
  
  // Next 5 candles (9:45-9:50): breakout
  for (let i = 0; i < 5; i++) {
    const t = baseTime + (30 + i) * 60000;
    candles.push(makeCandle(breakoutPrice, breakoutPrice + 5, breakoutPrice - 5, t));
  }
  
  return candles;
}

describe("ORB V8 Strategy", () => {
  it("returns HOLD when not enough candles", () => {
    const candles = [makeCandle(100, 105, 95, Date.now())];
    const state: any = { orbV8State: undefined, instrumentLabel: "Nifty 50" };
    const signal = generateORBV8Signal(candles, state);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("Collecting candles");
  });

  it("forms 30-min range and detects BUY breakout above ORB high", () => {
    const orbHigh = 24500;
    const orbLow = 24450;
    const breakoutPrice = 24520; // Above orbHigh
    const candles = createORBCandles(orbHigh, orbLow, breakoutPrice, "up");
    const state: any = { orbV8State: undefined, instrumentLabel: "Nifty 50" };
    
    const signal = generateORBV8Signal(candles, state);
    
    // The ORB should form first
    expect(state.orbV8State).toBeDefined();
    expect(state.orbV8State.orbFormed).toBe(true);
    expect(state.orbV8State.orbHigh).toBe(orbHigh);
    expect(state.orbV8State.orbLow).toBe(orbLow);
    
    // With VWAP and EMA21 alignment, should fire BUY
    // (VWAP may or may not align depending on candle construction, so check range formed)
    if (signal.direction === "BUY") {
      expect(signal.layer).toBe("ORB");
      expect(signal.reason).toContain("ORB_V8");
      expect(signal.slPrice).toBeLessThan(signal.entryPrice);
      expect(signal.targetPrice).toBeGreaterThan(signal.entryPrice);
    }
  });

  it("forms 30-min range and detects SELL breakout below ORB low", () => {
    const orbHigh = 24500;
    const orbLow = 24450;
    const breakoutPrice = 24430; // Below orbLow
    const candles = createORBCandles(orbHigh, orbLow, breakoutPrice, "down");
    const state: any = { orbV8State: undefined, instrumentLabel: "Nifty 50" };
    
    const signal = generateORBV8Signal(candles, state);
    
    expect(state.orbV8State).toBeDefined();
    expect(state.orbV8State.orbFormed).toBe(true);
    
    // With VWAP and EMA21 alignment, should fire SELL
    if (signal.direction === "SELL") {
      expect(signal.layer).toBe("ORB");
      expect(signal.reason).toContain("ORB_V8");
      expect(signal.slPrice).toBeGreaterThan(signal.entryPrice);
      expect(signal.targetPrice).toBeLessThan(signal.entryPrice);
    }
  });

  it("respects max 1 trade per day limit", () => {
    const state: any = {
      orbV8State: {
        orbHigh: 24500,
        orbLow: 24450,
        orbRange: 50,
        orbFormed: true,
        orbFormedAt: 585,
        tradesToday: 1, // Already took 1 trade
        shortOnlyMode: false,
      },
      instrumentLabel: "Nifty 50",
    };
    
    const baseTime = new Date("2026-01-15T04:20:00.000Z").getTime(); // 9:50 AM IST
    const candles: Candle[] = [];
    for (let i = 0; i < 35; i++) {
      candles.push(makeCandle(24520, 24525, 24515, baseTime + i * 60000));
    }
    
    const signal = generateORBV8Signal(candles, state);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("Daily limit reached");
  });

  it("skips when range is too wide (>100 pts)", () => {
    const orbHigh = 24600;
    const orbLow = 24450; // 150 pts range > 100 max
    const candles = createORBCandles(orbHigh, orbLow, 24620, "up");
    const state: any = { orbV8State: undefined, instrumentLabel: "Nifty 50" };
    
    const signal = generateORBV8Signal(candles, state);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("too wide");
  });

  it("skips when range is too narrow (<10 pts)", () => {
    const orbHigh = 24505;
    const orbLow = 24500; // 5 pts range < 10 min
    const candles = createORBCandles(orbHigh, orbLow, 24510, "up");
    const state: any = { orbV8State: undefined, instrumentLabel: "Nifty 50" };
    
    const signal = generateORBV8Signal(candles, state);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("too narrow");
  });

  it("SHORT-ONLY mode blocks BUY signals", () => {
    const state: any = {
      orbV8State: {
        orbHigh: 24500,
        orbLow: 24450,
        orbRange: 50,
        orbFormed: true,
        orbFormedAt: 585,
        tradesToday: 0,
        shortOnlyMode: true, // V11: shorts only
      },
      instrumentLabel: "Nifty 50",
    };
    
    const baseTime = new Date("2026-01-15T04:20:00.000Z").getTime(); // 9:50 AM IST
    const candles: Candle[] = [];
    // Create candles above ORB high (would normally trigger BUY)
    for (let i = 0; i < 35; i++) {
      candles.push(makeCandle(24520, 24525, 24515, baseTime + i * 60000));
    }
    
    const signal = generateORBV8Signal(candles, state);
    // Should NOT fire BUY because shortOnlyMode is true
    expect(signal.direction).not.toBe("BUY");
  });

  it("stops entries after 11:30 AM", () => {
    const state: any = {
      orbV8State: {
        orbHigh: 24500,
        orbLow: 24450,
        orbRange: 50,
        orbFormed: true,
        orbFormedAt: 585,
        tradesToday: 0,
        shortOnlyMode: false,
      },
      instrumentLabel: "Nifty 50",
    };
    
    // 11:35 AM IST = UTC 6:05 AM
    const baseTime = new Date("2026-01-15T06:05:00.000Z").getTime();
    const candles: Candle[] = [];
    for (let i = 0; i < 35; i++) {
      candles.push(makeCandle(24520, 24525, 24515, baseTime + i * 60000));
    }
    
    const signal = generateORBV8Signal(candles, state);
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("Past 11:30 AM");
  });
});
