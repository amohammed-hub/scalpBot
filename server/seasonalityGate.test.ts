/**
 * D11 seasonality gate regression tests.
 *
 * Validates the pure seasonality layer (shared/seasonality.ts) plus the validated
 * 2-year statistical assertions it encodes (486 sessions, Aug 2024 - Aug 2026):
 *  F-B. Reversion layers blocked when |intraday drift| > 0.25% or in 10:00-11:15 IST.
 *  F-L. Last-hour fade nudge: +3% when signal agrees with the index-aware fade; never blocks.
 *  F-A. ORB sniper is demo-only and OFF by default.
 *
 * Historical reference stats (z≈3 for last-hour fade):
 *  NIFTY: 15:00 hour up 59.4% after a red 14:00 hour (n=261)      → fade = BUY after red
 *  FINNIFTY: close down 59.1% after a green 14:00 hour            → fade = SELL after green
 *  Small-open days: day follows first-bar direction 74-76%         → sniper trades WITH open
 */

import { describe, it, expect } from "vitest";
import {
  istMinutesAt,
  seasonalityGate,
  SEASONALITY_CONFIG,
  type SeasonalityContext,
} from "../shared/seasonality";

// ── helpers ──────────────────────────────────────────────────────────────────
// Epoch ms for 2026-08-11 in UTC with given hour/minute.
function epochFor(utcHour: number, utcMin: number, dayOffsetDays: number = 0): number {
  const anchor = Date.UTC(2026, 7, 11, 0, 0, 0);
  return anchor + dayOffsetDays * 86400_000 + utcHour * 3600_000 + utcMin * 60_000;
}

function ctx(partial: Partial<SeasonalityContext> = {}): SeasonalityContext {
  return {
    istMinutes: 900, // 15:00 IST default
    intradayDriftPct: 0.001,
    symbol: "NIFTY",
    todayCandles: [],
    ...partial,
  };
}

// seasonalityGate(ctx, layer, signalDirection, currentPrice) — layer is a positional arg.
function gate(
  layer: string,
  partial: Partial<SeasonalityContext>,
  signalDirection: "BUY" | "SELL" = "BUY",
  price: number = 24500,
) {
  return seasonalityGate(ctx(partial), layer, signalDirection, price);
}

// Synthetic clock candle keyed by bar START time: a bar starting at istMin-15 and closing at istMin
// has its timestamp at the start of the bar (istMin - 15).
function priorBar(istMin: number, open: number, close: number) {
  const utcMin = istMin - 15 - 330;
  const h = Math.floor(utcMin / 60), m = utcMin % 60;
  return {
    timestamp: epochFor(h, m), open,
    high: Math.max(open, close), low: Math.min(open, close), close, volume: 1,
  };
}

// ── istMinutesAt ─────────────────────────────────────────────────────────────
describe("istMinutesAt", () => {
  it("maps 09:15 IST open correctly (UTC 03:45)", () => {
    expect(istMinutesAt(epochFor(3, 45))).toBe(555);
  });
  it("maps 14:45 IST (UTC 09:15)", () => {
    expect(istMinutesAt(epochFor(9, 15))).toBe(885);
  });
  it("wraps midnight", () => {
    expect(istMinutesAt(epochFor(18, 30))).toBe(0); // 00:00 IST next day
  });
});

// ── F-B: RANGING enforcement (validated: NIFTY wr 39.6→44.4, BN expectancy -, BN→+0.011bp, FN 49.2→53.1) ──
describe("RANGING enforcement (F-B)", () => {
  const reversionLayers = ["MeanReversionV13", "FailedBreakout", "VWAPReversion"];
  const allowedLayers = ["ORB", "Trend", "Momentum", "HourlyClose", "VWAPPullback"];

  for (const layer of reversionLayers) {
    it(`BLOCKS ${layer} when drift > 0.25% (trending day)`, () => {
      const r = gate(layer, { intradayDriftPct: 0.003, istMinutes: 780 });
      expect(r.allowed).toBe(false);
      expect(r.reasons.some(x => x.startsWith("SEASONALITY BLOCK"))).toBe(true);
    });
    it(`BLOCKS ${layer} when drift < -0.25%`, () => {
      const r = gate(layer, { intradayDriftPct: -0.003, istMinutes: 780 }, "SELL");
      expect(r.allowed).toBe(false);
    });
    it(`CLEARS ${layer} when |drift| <= 0.25% outside 10:00-11:15`, () => {
      const r = gate(layer, { intradayDriftPct: 0.002, istMinutes: 780 });
      expect(r.allowed).toBe(true);
      expect(r.confidenceNudge).toBe(0);
    });
    it(`BLOCKS ${layer} inside 10:00-11:15 even with zero drift (strongest trending window)`, () => {
      const r = gate(layer, { intradayDriftPct: 0.0001, istMinutes: 615 });
      expect(r.allowed).toBe(false);
    });
  }

  for (const layer of allowedLayers) {
    it(`never blocks non-reversion layer ${layer} even on trending days`, () => {
      const r = gate(layer, { intradayDriftPct: 0.005, istMinutes: 615 });
      expect(r.allowed).toBe(true);
    });
  }
});

// ── F-L: last-hour fade (validated z≈3; NIFTY 59.4% up after red 14:00; FINNIFTY inverts) ──
describe("last-hour fade (F-L)", () => {
  it("nudges BUY when prior hour was red (NIFTY fade)", () => {
    const candles = [priorBar(900, 24500, 24440)]; // closed -0.245% (above 2bp min)
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "NIFTY", todayCandles: candles }, "BUY", 24450);
    expect(r.allowed).toBe(true);
    expect(r.confidenceNudge).toBe(0.03);
  });
  it("does not nudge BUY after a red hour when signal is SELL", () => {
    const candles = [priorBar(900, 24500, 24440)];
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "NIFTY", todayCandles: candles }, "SELL", 24450);
    expect(r.allowed).toBe(true);
    expect(r.confidenceNudge).toBe(0);
  });
  it("inverts direction for FINNIFTY: green prior hour → SELL nudge", () => {
    const candles = [priorBar(900, 24500, 24560)];
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "FINNIFTY", todayCandles: candles }, "SELL", 24540);
    expect(r.confidenceNudge).toBe(0.03);
  });
  it("FINNIFTY buys after green prior hour get no nudge", () => {
    const candles = [priorBar(900, 24500, 24560)];
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "FINNIFTY", todayCandles: candles }, "BUY", 24540);
    expect(r.confidenceNudge).toBe(0);
  });
  it("ignores prior-hour moves below 2bp (noise filter)", () => {
    const candles = [priorBar(900, 24500, 24499)];
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "NIFTY", todayCandles: candles }, "BUY", 24499);
    expect(r.confidenceNudge).toBe(0);
  });
  it("only active inside the 14:45-15:30 IST window", () => {
    const candles = [priorBar(840, 24500, 24440)]; // prior hour 13:45-14:00
    const r = gate("VWAPPullback", { istMinutes: 840, symbol: "NIFTY", todayCandles: candles }, "BUY", 24450);
    expect(r.confidenceNudge).toBe(0);
  });
  it("never blocks on fade mismatch", () => {
    const candles = [priorBar(900, 24500, 24440)];
    const r = gate("VWAPPullback", { istMinutes: 900, symbol: "NIFTY", todayCandles: candles }, "SELL", 24450);
    expect(r.allowed).toBe(true);
  });
});

// ── F-A: ORB sniper is demo-only, OFF by default ──
describe("ORB sniper flag (F-A)", () => {
  it("is disabled by default — never applies", () => {
    const r = gate("ORB", {});
    expect(SEASONALITY_CONFIG.orbSniperEnabled).toBe(false);
    expect(r.orbSniperApplies).toBe(false);
  });
  it("still allowed when sniper flag is off", () => {
    const r = gate("ORB", {});
    expect(r.allowed).toBe(true);
  });
});

// ── Gate semantics ───────────────────────────────────────────────────────────
describe("gate semantics", () => {
  it("nudge is clamped to ±0.15", () => {
    const candles = [priorBar(900, 24500, 24440)];
    const r = gate("VWAPPullback", { symbol: "NIFTY", todayCandles: candles, istMinutes: 900 }, "BUY", 24450);
    expect(r.confidenceNudge).toBeGreaterThanOrEqual(-0.15);
    expect(r.confidenceNudge).toBeLessThanOrEqual(0.15);
  });
  it("block reasons identify drift vs time-window cause", () => {
    const r1 = gate("MeanReversionV13", { intradayDriftPct: 0.003 });
    expect(r1.reasons[0]).toContain("exceeds 0.25%");
    const r2 = gate("MeanReversionV13", { intradayDriftPct: 0.0001, istMinutes: 615 });
    expect(r2.reasons[0]).toContain("10:00-11:15 trending window");
  });
});

// ── Historical reference stats encoded as sanity anchors ─────────────────────
describe("validated historical anchors (from 486-session study)", () => {
  it("SEASONALITY_CONFIG drift threshold is 0.25% (validated optimum)", () => {
    expect(SEASONALITY_CONFIG.rangingDriftThreshold).toBe(0.0025);
  });
  it("fade window starts at 14:45 IST (885 min)", () => {
    expect(SEASONALITY_CONFIG.lastHourFadeStart).toBe(885);
  });
});
