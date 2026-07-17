/**
 * Options Analytics Engine — Sensibull/QuantsApp-style analytics
 * Fetches Upstox option chain (/v2/option/chain) and computes:
 *   - PCR (Put-Call Ratio by OI)
 *   - Max Pain strike
 *   - OI walls (highest OI strikes = support/resistance)
 *   - Greeks (delta, theta, IV from Upstox chain response)
 *   - Smart strike selection (delta 0.4-0.6 band)
 *   - Probability of Profit (PoP) approximation from delta
 */
import axios from "axios";

export interface OptionChainStrike {
  strike: number;
  ceOi: number;
  peOi: number;
  ceLtp: number;
  peLtp: number;
  ceDelta: number;
  peDelta: number;
  ceTheta: number;
  peTheta: number;
  ceIv: number;
  peIv: number;
  ceToken: string | null;
  peToken: string | null;
}

export interface OptionsAnalytics {
  underlying: string;
  underlyingPrice: number;
  expiry: string;
  pcr: number; // put OI / call OI — >1 bullish, <1 bearish
  maxPain: number; // strike with min total pain
  oiSupport: number; // highest PE OI strike below price
  oiResistance: number; // highest CE OI strike above price
  atmIv: number;
  atmStrike: number;
  bias: "bullish" | "bearish" | "neutral";
  biasReason: string;
  strikes: OptionChainStrike[];
  updatedAt: number;
}

// Cache per underlying (avoid hammering the API)
const analyticsCache = new Map<string, OptionsAnalytics & { _expiry?: string }>();
const CACHE_TTL_MS = 120_000; // 2 min

/** Fetch full option chain with Greeks from Upstox and compute analytics */
export async function fetchOptionsAnalytics(
  underlyingToken: string,
  accessToken: string,
): Promise<OptionsAnalytics | null> {
  const cached = analyticsCache.get(underlyingToken);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return cached;

  try {
    // Step 1: nearest expiry from contract API
    const contractResp = await axios.get(
      `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(underlyingToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 },
    );
    const contracts: Array<{ expiry?: string }> = contractResp.data?.data ?? [];
    const expiries = Array.from(new Set(contracts.map(c => c.expiry).filter(Boolean))) as string[];
    expiries.sort();
    const today = new Date().toISOString().slice(0, 10);
    const nearestExpiry = expiries.find(e => e >= today) ?? expiries[0];
    if (!nearestExpiry) return null;

    // Step 2: full PC chain with Greeks
    const chainResp = await axios.get(
      `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(underlyingToken)}&expiry_date=${nearestExpiry}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 10000 },
    );
    const rows: Array<{
      strike_price?: number;
      underlying_spot_price?: number;
      call_options?: { instrument_key?: string; market_data?: { ltp?: number; oi?: number }; option_greeks?: { delta?: number; theta?: number; iv?: number } };
      put_options?: { instrument_key?: string; market_data?: { ltp?: number; oi?: number }; option_greeks?: { delta?: number; theta?: number; iv?: number } };
    }> = chainResp.data?.data ?? [];
    if (rows.length === 0) return null;

    const underlyingPrice = rows[0]?.underlying_spot_price ?? 0;
    const strikes: OptionChainStrike[] = rows.map(r => ({
      strike: r.strike_price ?? 0,
      ceOi: r.call_options?.market_data?.oi ?? 0,
      peOi: r.put_options?.market_data?.oi ?? 0,
      ceLtp: r.call_options?.market_data?.ltp ?? 0,
      peLtp: r.put_options?.market_data?.ltp ?? 0,
      ceDelta: r.call_options?.option_greeks?.delta ?? 0,
      peDelta: r.put_options?.option_greeks?.delta ?? 0,
      ceTheta: r.call_options?.option_greeks?.theta ?? 0,
      peTheta: r.put_options?.option_greeks?.theta ?? 0,
      ceIv: r.call_options?.option_greeks?.iv ?? 0,
      peIv: r.put_options?.option_greeks?.iv ?? 0,
      ceToken: r.call_options?.instrument_key ?? null,
      peToken: r.put_options?.instrument_key ?? null,
    })).filter(s => s.strike > 0);

    const analytics = computeAnalytics(underlyingToken, underlyingPrice, nearestExpiry, strikes);
    analyticsCache.set(underlyingToken, analytics);
    return analytics;
  } catch (err) {
    console.error("[OptionsAnalytics] fetch failed:", err instanceof Error ? err.message : String(err));
    return cached ?? null;
  }
}

export function computeAnalytics(
  underlying: string,
  underlyingPrice: number,
  expiry: string,
  strikes: OptionChainStrike[],
): OptionsAnalytics {
  // PCR
  const totalCeOi = strikes.reduce((s, x) => s + x.ceOi, 0);
  const totalPeOi = strikes.reduce((s, x) => s + x.peOi, 0);
  const pcr = totalCeOi > 0 ? totalPeOi / totalCeOi : 0;

  // Max Pain: strike where total option-writer pain is minimized
  let maxPain = 0;
  let minPain = Infinity;
  for (const candidate of strikes) {
    let pain = 0;
    for (const s of strikes) {
      // CE writers pay when expiry > strike
      if (candidate.strike > s.strike) pain += s.ceOi * (candidate.strike - s.strike);
      // PE writers pay when expiry < strike
      if (candidate.strike < s.strike) pain += s.peOi * (s.strike - candidate.strike);
    }
    if (pain < minPain) { minPain = pain; maxPain = candidate.strike; }
  }

  // OI walls
  const below = strikes.filter(s => s.strike < underlyingPrice);
  const above = strikes.filter(s => s.strike > underlyingPrice);
  const oiSupport = below.length > 0
    ? below.reduce((best, s) => (s.peOi > best.peOi ? s : best), below[0]).strike
    : 0;
  const oiResistance = above.length > 0
    ? above.reduce((best, s) => (s.ceOi > best.ceOi ? s : best), above[0]).strike
    : 0;

  // ATM strike + IV
  const atm = strikes.reduce((best, s) =>
    Math.abs(s.strike - underlyingPrice) < Math.abs(best.strike - underlyingPrice) ? s : best,
    strikes[0]);
  const atmStrike = atm?.strike ?? 0;
  const atmIv = atm ? (atm.ceIv + atm.peIv) / 2 : 0;

  // Bias from PCR
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  let biasReason = `PCR ${pcr.toFixed(2)} — balanced`;
  if (pcr > 1.2) { bias = "bullish"; biasReason = `PCR ${pcr.toFixed(2)} > 1.2 — heavy put writing (bullish)`; }
  else if (pcr < 0.8) { bias = "bearish"; biasReason = `PCR ${pcr.toFixed(2)} < 0.8 — heavy call writing (bearish)`; }

  return {
    underlying, underlyingPrice, expiry, pcr, maxPain,
    oiSupport, oiResistance, atmIv, atmStrike, bias, biasReason,
    strikes, updatedAt: Date.now(),
  };
}

/** Smart strike selection: pick the strike with |delta| in the 0.4–0.6 band closest to 0.5 */
export function selectSmartStrike(
  analytics: OptionsAnalytics,
  optionType: "CE" | "PE",
): { token: string; premium: number; strike: number; delta: number; pop: number } | null {
  let best: { token: string; premium: number; strike: number; delta: number; pop: number } | null = null;
  let bestScore = Infinity;

  for (const s of analytics.strikes) {
    const delta = optionType === "CE" ? s.ceDelta : Math.abs(s.peDelta);
    const token = optionType === "CE" ? s.ceToken : s.peToken;
    const premium = optionType === "CE" ? s.ceLtp : s.peLtp;
    if (!token || premium <= 0.5) continue;
    if (delta < 0.4 || delta > 0.6) continue;
    const score = Math.abs(delta - 0.5);
    if (score < bestScore) {
      bestScore = score;
      best = { token, premium, strike: s.strike, delta, pop: deltaToPop(delta) };
    }
  }

  // Fallback: no strike in delta band — use ATM
  if (!best) {
    const atm = analytics.strikes.reduce((b, s) =>
      Math.abs(s.strike - analytics.underlyingPrice) < Math.abs(b.strike - analytics.underlyingPrice) ? s : b,
      analytics.strikes[0]);
    if (atm) {
      const token = optionType === "CE" ? atm.ceToken : atm.peToken;
      const premium = optionType === "CE" ? atm.ceLtp : atm.peLtp;
      const delta = optionType === "CE" ? atm.ceDelta : Math.abs(atm.peDelta);
      if (token && premium > 0.5) {
        best = { token, premium, strike: atm.strike, delta, pop: deltaToPop(delta || 0.5) };
      }
    }
  }
  return best;
}

/** Approximate Probability of Profit for a long option from its delta.
 *  Delta ≈ probability of expiring ITM; for intraday scalps with a 1:2 RR
 *  target, PoP for the trade is approximated as delta * 0.9 (premium decay drag). */
export function deltaToPop(delta: number): number {
  const d = Math.min(1, Math.max(0, Math.abs(delta)));
  return Math.round(d * 0.9 * 100);
}

/** Directional confluence: does the options-flow bias agree with the signal? */
export function checkOiConfluence(
  analytics: OptionsAnalytics | null,
  signalDirection: "BUY" | "SELL",
): { agrees: boolean; note: string } {
  if (!analytics) return { agrees: true, note: "No options data — skipping OI check" };
  if (analytics.bias === "neutral") return { agrees: true, note: analytics.biasReason };
  const agrees = (signalDirection === "BUY" && analytics.bias === "bullish")
    || (signalDirection === "SELL" && analytics.bias === "bearish");
  return {
    agrees,
    note: agrees
      ? `OI confluence: ${analytics.biasReason} agrees with ${signalDirection}`
      : `OI divergence: ${analytics.biasReason} vs ${signalDirection} signal`,
  };
}

export function getCachedAnalytics(underlyingToken: string): OptionsAnalytics | null {
  const cached = analyticsCache.get(underlyingToken);
  if (!cached) return null;
  // Return null if stale (> 5 minutes) — avoids serving hours-old data
  if (Date.now() - cached.updatedAt > 300_000) return null;
  return cached;
}
