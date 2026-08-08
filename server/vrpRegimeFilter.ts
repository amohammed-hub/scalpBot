/**
 * VRP Regime Filter + OI Flow Directional Bias + Max Pain Gravity
 * 
 * Three strategy enhancements inspired by VolGuard system (Reddit IndiaAlgoTrading):
 * 
 * 1. VRP (Volatility Risk Premium) Gate:
 *    - Computes IV vs Realized Volatility (7-day close-to-close RV)
 *    - When VRP < 0 (IV cheaper than RV) → block option BUYING (edge is gone)
 *    - When VRP > 5% → allow buying (premium is rich, big moves expected)
 *    - Simple pre-trade filter that prevents buying expensive options in low-vol regimes
 *
 * 2. OI Flow Directional Bias:
 *    - Analyzes option chain OI for ATM ± 3 strikes
 *    - Heavy Call OI above price → resistance (bearish bias)
 *    - Heavy Put OI below price → support (bullish bias)
 *    - OI unwinding (sudden drop) → breakout signal
 *    - Generates directional confidence boost/penalty for existing signals
 *
 * 3. Max Pain Gravity (expiry day only):
 *    - On expiry day, price gravitates toward max pain strike
 *    - If price > max pain → bias toward puts (price will fall)
 *    - If price < max pain → bias toward calls (price will rise)
 *    - Only active on expiry days (detected via API expiry date)
 */

import type { Candle } from "./botEngine";
import type { OptionsAnalytics } from "./optionsAnalytics";

// ── VRP Computation ─────────────────────────────────────────────────────────

export interface VRPResult {
  vrp: number;           // IV - RV (positive = premium is rich = good for buying)
  iv: number;            // current ATM implied volatility (annualized %)
  rv7: number;           // 7-day realized volatility (annualized %)
  rv14: number;          // 14-day realized volatility (annualized %)
  regime: "RICH" | "FAIR" | "CHEAP" | "INVERTED";
  shouldBlockBuying: boolean;
  reason: string;
}

/**
 * Compute Volatility Risk Premium from daily candles and ATM IV.
 * 
 * VRP = IV - RV. When VRP is negative, IV is cheaper than actual moves,
 * meaning option buying has negative expected value (theta decay > gamma gains).
 * 
 * @param dailyCandles - Last 14+ daily candles (need at least 8 for 7-day RV)
 * @param atmIv - Current ATM implied volatility from option chain (annualized %)
 * @returns VRP analysis with regime classification
 */
export function computeVRP(dailyCandles: Candle[], atmIv: number): VRPResult {
  const defaultResult: VRPResult = {
    vrp: 0, iv: atmIv, rv7: 0, rv14: 0,
    regime: "FAIR", shouldBlockBuying: false,
    reason: "Insufficient data for VRP computation",
  };

  if (!dailyCandles || dailyCandles.length < 8 || atmIv <= 0) return defaultResult;

  // Compute 7-day Realized Volatility (close-to-close, annualized)
  const rv7 = computeRealizedVol(dailyCandles.slice(-8), 7); // need n+1 candles for n returns
  const rv14 = dailyCandles.length >= 15 ? computeRealizedVol(dailyCandles.slice(-15), 14) : rv7;

  // Weighted RV: 70% short-term (7d) + 30% medium-term (14d)
  const weightedRV = rv7 * 0.7 + rv14 * 0.3;

  // VRP = IV - RV (both annualized %)
  const vrp = atmIv - weightedRV;

  // Classify regime
  let regime: VRPResult["regime"];
  let shouldBlockBuying = false;
  let reason: string;

  if (vrp < -2) {
    // IV is significantly cheaper than actual moves — INVERTED
    // This means the market is moving MORE than options imply.
    // Option buying is actually cheap here, but the market is already volatile.
    // Block buying because the big move may already be done.
    regime = "INVERTED";
    shouldBlockBuying = true;
    reason = `VRP INVERTED (${vrp.toFixed(1)}%): IV ${atmIv.toFixed(1)}% < RV ${weightedRV.toFixed(1)}% — options underpriced but market already volatile, avoid buying`;
  } else if (vrp < 2) {
    // IV roughly equals RV — no edge in buying
    regime = "CHEAP";
    shouldBlockBuying = true;
    reason = `VRP CHEAP (${vrp.toFixed(1)}%): IV ${atmIv.toFixed(1)}% ≈ RV ${weightedRV.toFixed(1)}% — no premium edge, theta will eat gains`;
  } else if (vrp < 5) {
    // Moderate VRP — fair value, proceed with caution
    regime = "FAIR";
    shouldBlockBuying = false;
    reason = `VRP FAIR (${vrp.toFixed(1)}%): IV ${atmIv.toFixed(1)}% > RV ${weightedRV.toFixed(1)}% — moderate edge present`;
  } else {
    // High VRP — premium is genuinely rich, big moves expected
    regime = "RICH";
    shouldBlockBuying = false;
    reason = `VRP RICH (${vrp.toFixed(1)}%): IV ${atmIv.toFixed(1)}% >> RV ${weightedRV.toFixed(1)}% — strong edge for option buying`;
  }

  return { vrp, iv: atmIv, rv7, rv14, regime, shouldBlockBuying, reason };
}

/**
 * Compute annualized realized volatility from daily candles using close-to-close returns.
 * Formula: σ = stdev(daily_returns) × √252
 */
function computeRealizedVol(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;

  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }

  if (returns.length < 2) return 0;

  // Use last `period` returns
  const recentReturns = returns.slice(-period);
  const mean = recentReturns.reduce((s, r) => s + r, 0) / recentReturns.length;
  const variance = recentReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (recentReturns.length - 1);
  const dailyVol = Math.sqrt(variance);

  // Annualize: multiply by √252 (trading days in a year)
  return dailyVol * Math.sqrt(252) * 100; // return as percentage
}

// ── OI Flow Directional Bias ────────────────────────────────────────────────

export interface OIFlowBias {
  direction: "BUY" | "SELL" | "NEUTRAL";
  strength: number;       // 0-100 confidence in the OI-based direction
  callOiAbove: number;    // total call OI above current price (resistance)
  putOiBelow: number;     // total put OI below current price (support)
  pcrAtm: number;         // PCR at ATM ± 1 strike (localized)
  oiWallDistance: number; // distance to nearest OI wall as % of price
  maxPainBias: "UP" | "DOWN" | "NEUTRAL"; // max pain direction
  reason: string;
}

/**
 * Compute OI-based directional bias from option chain analytics.
 * 
 * Logic:
 * - Heavy Call OI above price = resistance = bearish
 * - Heavy Put OI below price = support = bullish
 * - PCR > 1.2 at ATM = heavy put writing = bullish (writers expect support)
 * - PCR < 0.8 at ATM = heavy call writing = bearish (writers expect resistance)
 * - Price far from max pain on expiry day = strong gravity pull
 * 
 * @param analytics - Option chain analytics (from optionsAnalytics.ts)
 * @param currentPrice - Current underlying price
 * @param isExpiryDay - Whether today is expiry day
 */
export function computeOIFlowBias(
  analytics: OptionsAnalytics | null,
  currentPrice: number,
  isExpiryDay: boolean = false,
): OIFlowBias {
  const neutral: OIFlowBias = {
    direction: "NEUTRAL", strength: 0,
    callOiAbove: 0, putOiBelow: 0, pcrAtm: 1,
    oiWallDistance: 0, maxPainBias: "NEUTRAL",
    reason: "No option chain data available",
  };

  if (!analytics || !analytics.strikes || analytics.strikes.length === 0) return neutral;

  const { strikes, maxPain, underlyingPrice } = analytics;
  const price = currentPrice > 0 ? currentPrice : underlyingPrice;
  if (price <= 0) return neutral;

  // 1. Compute Call OI above price and Put OI below price
  const strikesAbove = strikes.filter(s => s.strike > price);
  const strikesBelow = strikes.filter(s => s.strike < price);
  const callOiAbove = strikesAbove.reduce((sum, s) => sum + s.ceOi, 0);
  const putOiBelow = strikesBelow.reduce((sum, s) => sum + s.peOi, 0);

  // 2. Localized PCR: ATM ± 2 strikes
  const sortedByDist = [...strikes].sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmStrikes = sortedByDist.slice(0, 5); // ATM ± 2
  const localCeOi = atmStrikes.reduce((s, x) => s + x.ceOi, 0);
  const localPeOi = atmStrikes.reduce((s, x) => s + x.peOi, 0);
  const pcrAtm = localCeOi > 0 ? localPeOi / localCeOi : 1;

  // 3. OI Wall distance
  const nearestCallWall = strikesAbove.length > 0
    ? strikesAbove.reduce((best, s) => s.ceOi > best.ceOi ? s : best, strikesAbove[0])
    : null;
  const nearestPutWall = strikesBelow.length > 0
    ? strikesBelow.reduce((best, s) => s.peOi > best.peOi ? s : best, strikesBelow[0])
    : null;

  const callWallDist = nearestCallWall ? (nearestCallWall.strike - price) / price * 100 : 99;
  const putWallDist = nearestPutWall ? (price - nearestPutWall.strike) / price * 100 : 99;
  const oiWallDistance = Math.min(callWallDist, putWallDist);

  // 4. Max Pain gravity
  let maxPainBias: "UP" | "DOWN" | "NEUTRAL" = "NEUTRAL";
  const maxPainDist = maxPain > 0 ? (maxPain - price) / price * 100 : 0;
  if (maxPainDist > 0.3) maxPainBias = "UP";    // price below max pain → gravity pulls UP
  else if (maxPainDist < -0.3) maxPainBias = "DOWN"; // price above max pain → gravity pulls DOWN

  // 5. Score directional bias
  let score = 0; // positive = bullish, negative = bearish
  const reasons: string[] = [];

  // PCR signal (strongest)
  if (pcrAtm > 1.3) { score += 30; reasons.push(`PCR ATM ${pcrAtm.toFixed(2)} (heavy put writing = bullish)`); }
  else if (pcrAtm > 1.1) { score += 15; reasons.push(`PCR ATM ${pcrAtm.toFixed(2)} (moderate put writing)`); }
  else if (pcrAtm < 0.7) { score -= 30; reasons.push(`PCR ATM ${pcrAtm.toFixed(2)} (heavy call writing = bearish)`); }
  else if (pcrAtm < 0.9) { score -= 15; reasons.push(`PCR ATM ${pcrAtm.toFixed(2)} (moderate call writing)`); }

  // OI wall asymmetry
  const oiRatio = putOiBelow > 0 && callOiAbove > 0 ? putOiBelow / callOiAbove : 1;
  if (oiRatio > 1.5) { score += 20; reasons.push(`Put OI wall ${(oiRatio).toFixed(1)}× stronger than Call OI wall (support)`); }
  else if (oiRatio < 0.67) { score -= 20; reasons.push(`Call OI wall ${(1/oiRatio).toFixed(1)}× stronger than Put OI wall (resistance)`); }

  // Max pain gravity (stronger on expiry day)
  const mpWeight = isExpiryDay ? 25 : 10;
  if (maxPainBias === "UP") { score += mpWeight; reasons.push(`Max Pain ${maxPain} above price by ${maxPainDist.toFixed(1)}% (gravity UP)${isExpiryDay ? " [EXPIRY]" : ""}`); }
  else if (maxPainBias === "DOWN") { score -= mpWeight; reasons.push(`Max Pain ${maxPain} below price by ${Math.abs(maxPainDist).toFixed(1)}% (gravity DOWN)${isExpiryDay ? " [EXPIRY]" : ""}`); }

  // Proximity to OI wall (if very close, expect reversal)
  if (callWallDist < 0.5 && callWallDist < putWallDist) {
    score -= 15;
    reasons.push(`Price within 0.5% of Call OI wall at ${nearestCallWall?.strike} (resistance)`);
  }
  if (putWallDist < 0.5 && putWallDist < callWallDist) {
    score += 15;
    reasons.push(`Price within 0.5% of Put OI wall at ${nearestPutWall?.strike} (support)`);
  }

  // Determine direction
  let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  const absScore = Math.abs(score);
  if (score >= 25) direction = "BUY";
  else if (score <= -25) direction = "SELL";

  return {
    direction,
    strength: Math.min(100, absScore),
    callOiAbove,
    putOiBelow,
    pcrAtm,
    oiWallDistance,
    maxPainBias,
    reason: reasons.join(" | ") || "Balanced OI — no clear directional bias",
  };
}

// ── Max Pain Gravity Strategy (Expiry Day Only) ─────────────────────────────

export interface MaxPainGravitySignal {
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  maxPain: number;
  currentPrice: number;
  distancePct: number;  // how far price is from max pain (%)
  reason: string;
}

/**
 * Max Pain Gravity Strategy — only fires on expiry day.
 * 
 * Theory: On expiry day, the underlying price gravitates toward the max pain strike
 * because option writers (who have the most capital) benefit from price settling there.
 * 
 * Rules:
 * - Only active on expiry day
 * - Price must be > 0.5% away from max pain (otherwise no edge)
 * - Direction: toward max pain
 * - Confidence scales with distance (more distance = stronger gravity)
 * - Time decay: stronger effect in last 2 hours of trading
 * 
 * @param analytics - Option chain analytics with max pain computed
 * @param currentPrice - Current underlying price
 * @param istMinutes - Current time in IST minutes since midnight
 */
export function computeMaxPainGravity(
  analytics: OptionsAnalytics | null,
  currentPrice: number,
  istMinutes: number,
): MaxPainGravitySignal {
  const hold: MaxPainGravitySignal = {
    direction: "HOLD", confidence: 0,
    maxPain: 0, currentPrice, distancePct: 0,
    reason: "Max Pain Gravity inactive",
  };

  if (!analytics || analytics.maxPain <= 0 || currentPrice <= 0) return hold;

  const { maxPain } = analytics;
  const distancePct = ((currentPrice - maxPain) / currentPrice) * 100;
  const absDistance = Math.abs(distancePct);

  // Must be at least 0.3% away from max pain for a signal
  if (absDistance < 0.3) {
    return { ...hold, maxPain, distancePct, reason: `Price within 0.3% of Max Pain ${maxPain} — no gravity signal` };
  }

  // Direction: toward max pain
  const direction: "BUY" | "SELL" = distancePct < 0 ? "BUY" : "SELL";
  // Price below max pain → BUY (expect price to rise toward max pain)
  // Price above max pain → SELL (expect price to fall toward max pain)

  // Confidence: scales with distance and time of day
  let confidence = 0.50; // base

  // Distance factor: more distance = stronger pull (up to 2%)
  if (absDistance > 1.5) confidence += 0.15;
  else if (absDistance > 1.0) confidence += 0.10;
  else if (absDistance > 0.5) confidence += 0.05;

  // Time factor: stronger in last 2 hours (after 1:30 PM for NSE)
  if (istMinutes >= 810) confidence += 0.10; // after 1:30 PM
  if (istMinutes >= 870) confidence += 0.10; // after 2:30 PM (last hour)

  // Cap at 85%
  confidence = Math.min(0.85, confidence);

  const reason = `[MaxPainGravity] Price ${currentPrice.toFixed(0)} is ${absDistance.toFixed(1)}% ${direction === "BUY" ? "below" : "above"} Max Pain ${maxPain} — gravity pulls ${direction === "BUY" ? "UP" : "DOWN"}${istMinutes >= 810 ? " (late-day boost)" : ""}`;

  return { direction, confidence, maxPain, currentPrice, distancePct, reason };
}

// ── Combined Strategy Gate ──────────────────────────────────────────────────

export interface StrategyGateResult {
  allowed: boolean;
  vrp: VRPResult | null;
  oiBias: OIFlowBias | null;
  maxPainSignal: MaxPainGravitySignal | null;
  confidenceBoost: number;  // -0.15 to +0.15 adjustment to signal confidence
  reason: string;
}

/**
 * Combined pre-trade gate that evaluates VRP, OI Flow, and Max Pain.
 * 
 * @param dailyCandles - Last 14+ daily candles for VRP computation
 * @param analytics - Option chain analytics (PCR, max pain, OI)
 * @param signalDirection - The signal direction from the main engine
 * @param currentPrice - Current underlying price
 * @param isExpiryDay - Whether today is expiry day
 * @param istMinutes - Current IST time in minutes
 * @param isMCX - Whether this is an MCX instrument (VRP less relevant for commodities)
 */
export function evaluateStrategyGate(
  dailyCandles: Candle[],
  analytics: OptionsAnalytics | null,
  signalDirection: "BUY" | "SELL",
  currentPrice: number,
  isExpiryDay: boolean,
  istMinutes: number,
  isMCX: boolean = false,
): StrategyGateResult {
  let allowed = true;
  let confidenceBoost = 0;
  const reasons: string[] = [];

  // 1. VRP Gate (only for NSE options — MCX options have different vol dynamics)
  let vrp: VRPResult | null = null;
  if (!isMCX && analytics && analytics.atmIv > 0 && dailyCandles.length >= 8) {
    vrp = computeVRP(dailyCandles, analytics.atmIv);
    if (vrp.shouldBlockBuying) {
      // VRP says don't buy options — but we still allow if signal is very strong
      // Instead of hard block, apply a confidence penalty
      confidenceBoost -= 0.10;
      reasons.push(`VRP penalty (-10%): ${vrp.reason}`);
    } else if (vrp.regime === "RICH") {
      // Rich VRP = strong edge for option buying
      confidenceBoost += 0.08;
      reasons.push(`VRP boost (+8%): ${vrp.reason}`);
    }
  }

  // 2. OI Flow Directional Bias
  let oiBias: OIFlowBias | null = null;
  if (analytics) {
    oiBias = computeOIFlowBias(analytics, currentPrice, isExpiryDay);
    if (oiBias.direction !== "NEUTRAL") {
      if (oiBias.direction === signalDirection) {
        // OI agrees with signal — boost confidence
        const boost = Math.min(0.10, oiBias.strength / 1000);
        confidenceBoost += boost;
        reasons.push(`OI confluence (+${(boost * 100).toFixed(0)}%): ${oiBias.reason}`);
      } else {
        // OI disagrees with signal — penalize
        const penalty = Math.min(0.08, oiBias.strength / 1200);
        confidenceBoost -= penalty;
        reasons.push(`OI divergence (-${(penalty * 100).toFixed(0)}%): ${oiBias.reason}`);
      }
    }
  }

  // 3. Max Pain Gravity (expiry day only)
  let maxPainSignal: MaxPainGravitySignal | null = null;
  if (isExpiryDay && analytics) {
    maxPainSignal = computeMaxPainGravity(analytics, currentPrice, istMinutes);
    if (maxPainSignal.direction !== "HOLD") {
      if (maxPainSignal.direction === signalDirection) {
        // Max pain agrees — boost
        confidenceBoost += 0.07;
        reasons.push(`MaxPain agrees (+7%): ${maxPainSignal.reason}`);
      } else {
        // Max pain disagrees — strong penalty on expiry day
        confidenceBoost -= 0.12;
        reasons.push(`MaxPain OPPOSES (-12%): ${maxPainSignal.reason}`);
      }
    }
  }

  // Clamp confidence boost
  confidenceBoost = Math.max(-0.20, Math.min(0.15, confidenceBoost));

  // Hard block: if VRP is INVERTED AND OI disagrees AND it's not expiry day with max pain support
  if (vrp?.regime === "INVERTED" && oiBias?.direction !== "NEUTRAL" && oiBias?.direction !== signalDirection) {
    if (!isExpiryDay || maxPainSignal?.direction !== signalDirection) {
      allowed = false;
      reasons.push("BLOCKED: VRP inverted + OI divergence — no edge for option buying");
    }
  }

    // ── OI FLOW VETO ───────────────────────────────────────────────────────────
  const OI_VETO_STRENGTH = 40;
  if (
    oiBias &&
    oiBias.direction !== "NEUTRAL" &&
    oiBias.direction !== signalDirection &&
    oiBias.strength >= OI_VETO_STRENGTH
  ) {
    const maxPainRescue = isExpiryDay && maxPainSignal?.direction === signalDirection;
    if (!maxPainRescue) {
      allowed = false;
      reasons.push(
        `BLOCKED: OI structure opposes ${signalDirection} ` +
        `(strength ${oiBias.strength.toFixed(0)} >= ${OI_VETO_STRENGTH}) — ${oiBias.reason}`
      );
    }
  }

  return {
    allowed,
    vrp,
    oiBias,
    maxPainSignal,
    confidenceBoost,
    reason: reasons.join(" | ") || "All gates passed — no adjustment",
  };
}
