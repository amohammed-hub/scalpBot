// Seasonality regime gate — D11
// Time-of-day statistical edge layer, derived from a 2-year (Aug 2024 - Aug 2026,
// 486 sessions) intraday study of NIFTY 50 / BANKNIFTY / FINNIFTY hourly bars.
//
// Findings implemented:
//  F-B. RANGING enforcement for mean-reversion entries: failed-breakout reversion
//       entries taken while intraday drift |cumulative return since open| > 0.25%
//       systematically underperform (win rate 5-10 pts lower, losses ~40-60% larger).
//       Also banned in the 10:15 IST slot (strongest trending window, 10:00-11:00).
//       Backtest: NIFTY wr 39.6->44.4%, BANKNIFTY expectancy -0.011->+0.011bp,
//       FINNIFTY wr 49.2->53.1% (threshold 0.25%; validated across years).
//  F-A. ORB small-open sniper flag (DEMO-ONLY, default OFF): on Bank Nifty,
//       breakouts on days where the first 15m bar moved <=2bp, traded with the
//       open direction, showed positive expectancy (wr 43.9%, Sharpe 1.54, n=41)
//       under a relaxed freshness window. NOT robust under the engine's strict
//       freshness (n=1-11) — therefore demo-observable only until validated.
//  F-L. Last-hour fade: after a red 14:45+ hour, 15:00-15:30 reverts up (NIFTY
//       59.4%, z≈3.0); FINNIFTY inverts (green prior hour -> fade down).
//       Applied as a tiny confidence nudge only — never a standalone entry.
//
// This module is pure (no network, no state) and must stay dependency-free so it
// can be unit-tested deterministically.

export interface IntradayClockCandle {
  /** Bar epoch ms. Kept compatible with both the engine `Candle` (timestamp)
   *  and lightweight synthetic candles (time) used in unit tests. */
  timestamp?: number;
  time?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SeasonalityContext {
  /** Current IST time in minutes since midnight (e.g. 10:15 IST = 615) */
  istMinutes: number;
  /** Daily cumulative return since the day's first candle close: (price - dayOpen) / dayOpen */
  intradayDriftPct: number; // expressed as fraction, e.g. 0.0025 = 0.25%
  /** Index symbol, uppercased: NIFTY, BANKNIFTY, FINNIFTY, etc. */
  symbol: string;
  /** Intraday candles of today (5m/1m), newest last, for first-bar / last-hour detection */
  todayCandles: IntradayClockCandle[];
}

export interface SeasonalityGateResult {
  allowed: boolean;
  reasons: string[];
  /** Confidence nudge in the same scale as VRP/OI boost ([-0.15, +0.15] slice) */
  confidenceNudge: number;
  /** Whether the optional ORB sniper flag (demo-only) would have allowed the trade */
  orbSniperApplies: boolean;
  orbSniperNote: string;
}

// ── Configuration (all user-tunable via environment later; keep defaults here) ──
export const SEASONALITY_CONFIG = {
  /** Ranging threshold: |intraday drift| must be below this for reversion entries (0.25%) */
  rangingDriftThreshold: Number(process.env.SEASON_RANGING_DRIFT ?? 0.0025),
  /** IST minute slots where reversion entries are banned (10:15 IST = 615; window 600-675) */
  bannedReversionSlotsStart: 600, // 10:00
  bannedReversionSlotsEnd: 675,   // 11:15 (covers the 10:15 candle = 10:00-10:15 close + 10:15-11:15 flow)
  /** Last-hour fade window start/end in IST minutes */
  lastHourFadeStart: 885,  // 14:45
  lastHourFadeEnd: 930,    // 15:30
  /** Min magnitude of prior hour move to qualify the fade (2 bp) */
  lastHourFadeMinMove: 0.0002,
  /** Nudge magnitude for the last-hour fade (validated z≈3; keep small) */
  lastHourFadeNudge: 0.03,
  /** DEMO-ONLY ORB sniper: max first-bar move (2 bp) */
  orbSniperMaxFirstBarPct: Number(process.env.SEASON_ORB_SNIPER_FIRST_BAR ?? 0.0002),
  /** DEMO-ONLY ORB sniper enabled flag (default OFF) */
  orbSniperEnabled: process.env.SEASON_ORB_SNIPER === "1",
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Minute-of-day in IST for an epoch-ms timestamp. Pure, no Date-zone side effects:
 *  uses the known IST offset (+5:30) explicitly. */
function candleMs(c: IntradayClockCandle): number {
  return c.timestamp ?? c.time ?? 0;
}

export function istMinutesAt(epochMs: number): number {
  const d = new Date(epochMs);
  // IST = UTC + 5.5h
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMin + 330) % 1440;
}

export function dayOpenReturn(todayCandles: IntradayClockCandle[], price: number): number {
  if (todayCandles.length === 0) return 0;
  const dayOpen = todayCandles[0].open;
  return dayOpen > 0 ? (price - dayOpen) / dayOpen : 0;
}

export function priorHourMove(todayCandles: IntradayClockCandle[], istMinutes: number): number | null {
  // The candle that just closed: whose time spans [istMinutes - 15, istMinutes).
  if (istMinutes < 585) return null; // before 09:45 no prior full bar
  const priorStart = istMinutes - 15;
  const priorEnd = istMinutes;
  const bar = todayCandles.find((c) => {
    const m = istMinutesAt(candleMs(c));
    return m >= priorStart && m < priorEnd;
  });
  if (!bar || bar.open <= 0) return null;
  return (bar.close - bar.open) / bar.open;
}

export function firstBarMove(todayCandles: IntradayClockCandle[]): number | null {
  if (todayCandles.length === 0) return null;
  const b = todayCandles[0];
  if (b.open <= 0) return null;
  return (b.close - b.open) / b.open;
}

/** Minute-of-day in IST for a candle, using its epoch ms (timestamp preferred over time). */
export function istMinutesOf(c: IntradayClockCandle): number {
  return istMinutesAt(candleMs(c));
}

// ── Gate ──────────────────────────────────────────────────────────────────────

export function seasonalityGate(
  ctx: SeasonalityContext,
  layer: string,
  signalDirection: "BUY" | "SELL",
  currentPrice: number,
): SeasonalityGateResult {
  const reasons: string[] = [];
  let allowed = true;
  let confidenceNudge = 0;
  const sym = (ctx.symbol ?? "").toUpperCase();

  // F-B: RANGING enforcement for MeanReversionV13 / FailedBreakout / VWAPReversion layers.
  const isReversionLayer = ["MeanReversionV13", "FailedBreakout", "VWAPReversion"].includes(layer);
  if (isReversionLayer) {
    const trending = Math.abs(ctx.intradayDriftPct) > SEASONALITY_CONFIG.rangingDriftThreshold;
    const inBannedWindow =
      ctx.istMinutes >= SEASONALITY_CONFIG.bannedReversionSlotsStart &&
      ctx.istMinutes < SEASONALITY_CONFIG.bannedReversionSlotsEnd;
    if (trending || inBannedWindow) {
      allowed = false;
      reasons.push(
        `SEASONALITY BLOCK: ${layer} requires RANGING — ` +
        `drift ${(ctx.intradayDriftPct * 100).toFixed(2)}% ` +
        `${trending ? "exceeds 0.25%" : "in range"} | IST ${Math.floor(ctx.istMinutes / 60)}:${String(ctx.istMinutes % 60).padStart(2, "0")} ` +
        `${inBannedWindow ? "in 10:00-11:15 trending window" : "outside banned window"}`
      );
    } else {
      reasons.push("SEASONALITY: RANGING confirmed — reversion layer cleared (drift " +
        `${(ctx.intradayDriftPct * 100).toFixed(2)}%, outside 10:00-11:15)`);
    }
  }

  // F-L: Last-hour fade nudge (never blocks; max ±3% confidence). Index-aware.
  if (ctx.istMinutes >= SEASONALITY_CONFIG.lastHourFadeStart && ctx.istMinutes < SEASONALITY_CONFIG.lastHourFadeEnd) {
    const prev = priorHourMove(ctx.todayCandles, ctx.istMinutes);
    if (prev !== null && Math.abs(prev) >= SEASONALITY_CONFIG.lastHourFadeMinMove) {
      const fadeDirection = sym === "FINNIFTY" ? (prev > 0 ? "SELL" : "BUY") : (prev < 0 ? "BUY" : "SELL");
      if (fadeDirection === signalDirection) {
        confidenceNudge = SEASONALITY_CONFIG.lastHourFadeNudge;
        reasons.push(`SEASONALITY fade confluence (±${(SEASONALITY_CONFIG.lastHourFadeNudge * 100).toFixed(0)}%): ` +
          `fading ${prev < 0 ? "red" : "green"} prior hour ${fadeDirection} in ${sym}`);
      }
    }
  }

  // F-A: ORB sniper (DEMO-ONLY flag, default OFF — validated positive only under
  // relaxed freshness on BANKNIFTY; strict freshness too thin to ship).
  let orbSniperApplies = false;
  let orbSniperNote = SEASONALITY_CONFIG.orbSniperEnabled
    ? "ORB sniper flag OFF by default (pending demo validation)"
    : "ORB sniper flag is demo-only and currently disabled";
  if (SEASONALITY_CONFIG.orbSniperEnabled && layer === "ORB") {
    const fb = firstBarMove(ctx.todayCandles);
    const withOpenDir = fb !== null && Math.sign(fb) === Math.sign(signalDirection === "BUY" ? 1 : -1);
    orbSniperApplies = fb !== null && Math.abs(fb) <= SEASONALITY_CONFIG.orbSniperMaxFirstBarPct && withOpenDir;
    orbSniperNote = `ORB sniper (demo): first bar ${(fb ?? 0) * 100}bp, ${withOpenDir ? "with" : "against"} open direction`;
    if (!orbSniperApplies && fb !== null) {
      reasons.push(`SEASONALITY ORB sniper: skipped — ${orbSniperNote}`);
    }
  }

  confidenceNudge = Math.max(-0.15, Math.min(0.15, confidenceNudge));

  return { allowed, reasons, confidenceNudge, orbSniperApplies, orbSniperNote };
}
