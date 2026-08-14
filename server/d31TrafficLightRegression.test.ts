/**
 * D31 Traffic-Light Regime Regression Tests.
 *
 * Evidence basis (scripts/trafficlight_backtest.py, 60 days of real 5m data):
 * - The D29 11:00-13:00 kill zone made results WORSE in every segment
 *   (BankNifty -822 vs -597 pts; Nifty -208 vs -180 pts) and was removed.
 * - The traffic-light gate (GREEN entries only) kept Nifty win rate within 0.3%
 *   while cutting drawdown ~27% — implemented as the new Scalper Mode entry gate.
 *
 * Light rules (calcTrafficLight):
 * - RED:   ATR14 < 35% of 20-candle trailing-median ATR (dead chop)
 * - GREEN: spread(EMA9-EMA21) >= 0.3*ATR14 AND >= 0.15*medianATR AND ATR14 >= 50% median
 * - YELLOW: otherwise
 * The median-based absolute floor prevents GREEN flicker when ATR collapses but
 * EMAs still lag the last trend. Exits are NEVER gated by the light.
 */
import { describe, it, expect } from "vitest";
import { calcTrafficLight, calcATR, calcEMA } from "./botEngine";
import type { Candle } from "./botEngine";

// ── Candle builders ───────────────────────────────────────────────────────────
function mkCandle(t: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp: t, open, high, low, close, volume: 1000 };
}

/** Volatile uptrend: strong spread, healthy ATR → GREEN */
function trendingCandles(n = 60): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 53200 + i * 10;
    const noise = (i % 3) * 4;
    out.push(mkCandle(i * 60_000, base + noise, base + noise + 15, base + noise - 5, base + noise + 8));
  }
  return out;
}

/** Volatility collapse: first candles volatile (sets median), then dead-flat → RED */
function collapsingCandles(n = 60, volatileCount = 45): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    if (i < volatileCount) {
      const wobble = (i % 2) * 40;
      out.push(mkCandle(i * 60_000, 53000 + wobble, 53000 + wobble + 30, 53000 + wobble - 30, 53000 + wobble + 5));
    } else {
      out.push(mkCandle(i * 60_000, 53000, 53000.01, 52999.99, 53000));
    }
  }
  return out;
}

/** Flat-dead from the start: ATR near zero, EMA spread zero → YELLOW (not RED:
 *  median ATR == current ATR, so no collapse is detected — consistent with the
 *  real-market semantics where RED requires volatility to have DECAYED). */
function flatFromStartCandles(n = 60): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(mkCandle(i * 60_000, 53000, 53000.01, 52999.99, 53000));
  }
  return out;
}

/** Choppy sideways with a weak EMA spread → YELLOW */
function choppyCandles(n = 60): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 53000 + (i % 6) * 5; // small range oscillation, spread below 0.3*ATR
    out.push(mkCandle(i * 60_000, base, base + 12, base - 4, base + 3));
  }
  return out;
}

describe("D31 — Traffic-Light Scalper Entry Gate (calcTrafficLight)", () => {
  it("returns GREEN for a strong trend with healthy volatility", () => {
    expect(calcTrafficLight(trendingCandles())).toBe("GREEN");
  });

  it("returns RED when volatility collapses after a volatile period", () => {
    expect(calcTrafficLight(collapsingCandles())).toBe("RED");
  });

  it("returns YELLOW for flat-dead candles where no decay is detectable", () => {
    // Median ATR == current ATR in a uniform flat market — the gate only flags
    // RED when volatility DECAYS relative to its recent history.
    expect(calcTrafficLight(flatFromStartCandles())).toBe("YELLOW");
  });

  it("returns YELLOW for choppy sideways markets with weak spread", () => {
    expect(calcTrafficLight(choppyCandles())).toBe("YELLOW");
  });

  it("returns null for insufficient candle history (warmup)", () => {
    expect(calcTrafficLight(trendingCandles(20))).toBeNull();
  });

  it("allows entries only on GREEN — the light never permits RED/YELLOW entries", () => {
    expect(calcTrafficLight(trendingCandles())).toBe("GREEN");
    expect(calcTrafficLight(collapsingCandles())).not.toBe("GREEN");
    expect(calcTrafficLight(choppyCandles())).not.toBe("GREEN");
  });
});

// ── Source-level regression: the kill zone is gone ────────────────────────────
describe("D31 — Kill zone removal", () => {
  it("has no residual 11:00-13:00 kill zone gating in the scalper path", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "botEngine.ts"), "utf8");
    expect(src).not.toContain("kill zone — 11:00-13:00");
    expect(src).not.toMatch(/istMin >= 660 && istMin < 780/);
    expect(src).toContain("calcTrafficLight"); // new gate is in place
  });
});
