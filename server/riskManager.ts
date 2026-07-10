/**
 * Risk Manager — World-class protections inspired by Freqtrade + Remora
 * Provides:
 *   1. Market Regime Risk Gate (India VIX + regime + consecutive SL count)
 *   2. StoplossGuard (pause after 3 consecutive SLs in last 20 trades)
 *   3. Portfolio-level MaxDrawdown halt (unified across all 5 slots)
 *   4. CooldownPeriod (2-candle wait after any trade close)
 *   5. Portfolio exposure check (reject > 80% margin usage)
 *   6. Kill switch (close all positions + halt all bots)
 */

import type { BotState, Candle } from "./botEngine";
import { classifyMarketRegime, placeUpstoxOrder } from "./botEngine";

// ── Types ────────────────────────────────────────────────────────────────────
export interface MarketRiskScore {
  score: number; // 0-100 (0=safest, 100=extreme risk)
  safe: boolean; // true = ok to trade
  regime: string;
  vixLevel: number; // India VIX value (0 if unavailable)
  consecutiveSLs: number;
  reasons: string[];
  updatedAt: number; // unix ms
}

export interface PortfolioStatus {
  totalCapital: number;
  totalExposure: number;
  exposurePct: number;
  aggregateDailyPnl: number;
  aggregateDailyPnlPct: number;
  isHalted: boolean;
  haltReason: string | null;
  runningBots: number;
  openTrades: number;
}

export interface StoplossGuardState {
  isPaused: boolean;
  pausedUntil: number; // unix ms
  consecutiveSLs: number;
  reason: string | null;
}

export interface CooldownState {
  lastTradeCloseAt: number; // unix ms
  cooldownUntil: number; // unix ms (lastTradeCloseAt + 2 * scanInterval)
  isActive: boolean;
}

// ── Module state ─────────────────────────────────────────────────────────────
let cachedRiskScore: MarketRiskScore = {
  score: 0, safe: true, regime: "unknown", vixLevel: 0, consecutiveSLs: 0,
  reasons: [], updatedAt: 0,
};

let stoplossGuard: StoplossGuardState = {
  isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null,
};

let portfolioHalted = false;
let portfolioHaltReason: string | null = null;

// Per-session cooldown tracking
const cooldowns = new Map<string, CooldownState>();

// ── India VIX fetch (public Upstox API, no auth needed) ─────────────────────
let lastVixFetch = 0;
let cachedVix = 0;
const VIX_CACHE_MS = 60_000; // cache 60s

export async function fetchIndiaVix(): Promise<number> {
  if (Date.now() - lastVixFetch < VIX_CACHE_MS && cachedVix > 0) return cachedVix;
  try {
    const { default: axios } = await import("axios");
    // India VIX instrument key on Upstox
    const resp = await axios.get(
      "https://api.upstox.com/v2/market-quote/quotes?instrument_key=NSE_INDEX%7CIndia%20VIX",
      { headers: { Accept: "application/json" }, timeout: 6000 },
    );
    const data = resp.data?.data;
    const key = data ? Object.keys(data)[0] : null;
    const vix = key ? (data[key]?.last_price ?? 0) : 0;
    if (vix > 0) { cachedVix = vix; lastVixFetch = Date.now(); }
    return cachedVix;
  } catch {
    // VIX fetch failed — return cached or 0 (fail-open: don't block trading)
    return cachedVix;
  }
}

// ── Market Risk Gate ─────────────────────────────────────────────────────────
export async function computeMarketRiskScore(
  candles: Candle[],
  recentTrades: Array<{ exitReason: string | null; pnl: number | null }>,
): Promise<MarketRiskScore> {
  const reasons: string[] = [];
  let score = 0;

  // 1. India VIX
  const vix = await fetchIndiaVix();
  if (vix > 30) { score += 40; reasons.push(`India VIX extremely high (${vix.toFixed(1)})`); }
  else if (vix > 25) { score += 25; reasons.push(`India VIX high (${vix.toFixed(1)})`); }
  else if (vix > 20) { score += 10; reasons.push(`India VIX elevated (${vix.toFixed(1)})`); }

  // 2. Market regime
  const { regime, label } = candles.length >= 20
    ? classifyMarketRegime(candles)
    : { regime: "unknown" as const, label: "Insufficient data" };
  if (regime === "high_vol") { score += 30; reasons.push(`Regime: ${label}`); }
  else if (regime === "ranging") { score += 15; reasons.push(`Regime: ${label} (choppy)`); }
  else if (regime === "low_vol") { score += 5; }

  // 3. Consecutive stop-losses (from last 20 trades)
  const last20 = recentTrades.slice(-20);
  let consecutiveSLs = 0;
  for (let i = last20.length - 1; i >= 0; i--) {
    if (last20[i].exitReason?.includes("Stop Loss")) consecutiveSLs++;
    else break;
  }
  if (consecutiveSLs >= 3) { score += 30; reasons.push(`${consecutiveSLs} consecutive stop-losses`); }
  else if (consecutiveSLs >= 2) { score += 15; reasons.push(`${consecutiveSLs} consecutive stop-losses`); }

  const safe = score < 60;
  if (!safe && reasons.length === 0) reasons.push("Combined risk factors exceed threshold");

  cachedRiskScore = { score, safe, regime, vixLevel: vix, consecutiveSLs, reasons, updatedAt: Date.now() };
  return cachedRiskScore;
}

export function getCachedRiskScore(): MarketRiskScore {
  return cachedRiskScore;
}

// ── StoplossGuard ────────────────────────────────────────────────────────────
const SL_GUARD_THRESHOLD = 3;
const SL_GUARD_PAUSE_MS = 30 * 60 * 1000; // 30 minutes

export function updateStoplossGuard(
  recentTrades: Array<{ exitReason: string | null; pnl: number | null }>,
): StoplossGuardState {
  // Count consecutive SLs from end of last 20 trades
  const last20 = recentTrades.slice(-20);
  let consecutiveSLs = 0;
  for (let i = last20.length - 1; i >= 0; i--) {
    if (last20[i].exitReason?.includes("Stop Loss")) consecutiveSLs++;
    else break;
  }

  if (consecutiveSLs >= SL_GUARD_THRESHOLD && !stoplossGuard.isPaused) {
    stoplossGuard = {
      isPaused: true,
      pausedUntil: Date.now() + SL_GUARD_PAUSE_MS,
      consecutiveSLs,
      reason: `StoplossGuard: ${consecutiveSLs} consecutive SLs — paused 30 min`,
    };
  } else if (stoplossGuard.isPaused && Date.now() > stoplossGuard.pausedUntil) {
    // Cooldown expired
    stoplossGuard = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };
  }

  stoplossGuard.consecutiveSLs = consecutiveSLs;
  return stoplossGuard;
}

export function getStoplossGuardState(): StoplossGuardState {
  // Auto-expire
  if (stoplossGuard.isPaused && Date.now() > stoplossGuard.pausedUntil) {
    stoplossGuard = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };
  }
  return stoplossGuard;
}

// ── Portfolio MaxDrawdown Halt ───────────────────────────────────────────────
export function checkPortfolioDrawdown(
  allBots: BotState[],
  dailyLossLimitPct: number,
): { halted: boolean; reason: string | null } {
  if (allBots.length === 0) return { halted: portfolioHalted, reason: portfolioHaltReason };

  const totalCapital = allBots.reduce((sum, b) => sum + b.capital, 0);
  const aggregatePnl = allBots.reduce((sum, b) => sum + b.dailyPnl, 0);
  const maxLoss = -(totalCapital * dailyLossLimitPct) / 100;

  if (aggregatePnl <= maxLoss && !portfolioHalted) {
    portfolioHalted = true;
    portfolioHaltReason = `Portfolio daily loss limit hit: ₹${aggregatePnl.toFixed(0)} (limit: ₹${maxLoss.toFixed(0)})`;
  }

  return { halted: portfolioHalted, reason: portfolioHaltReason };
}

export function resetPortfolioHalt(): void {
  portfolioHalted = false;
  portfolioHaltReason = null;
}

// ── Portfolio Exposure ───────────────────────────────────────────────────────
export function getPortfolioStatus(allBots: BotState[]): PortfolioStatus {
  const totalCapital = allBots.reduce((sum, b) => sum + b.capital, 0) || 100000;
  let totalExposure = 0;
  let openTrades = 0;

  for (const bot of allBots) {
    if (bot.openTrade) {
      totalExposure += bot.openTrade.entryPrice * bot.openTrade.quantity;
      openTrades++;
    }
  }

  const exposurePct = totalCapital > 0 ? (totalExposure / totalCapital) * 100 : 0;
  const aggregateDailyPnl = allBots.reduce((sum, b) => sum + b.dailyPnl, 0);
  const aggregateDailyPnlPct = totalCapital > 0 ? (aggregateDailyPnl / totalCapital) * 100 : 0;

  return {
    totalCapital,
    totalExposure,
    exposurePct,
    aggregateDailyPnl,
    aggregateDailyPnlPct,
    isHalted: portfolioHalted,
    haltReason: portfolioHaltReason,
    runningBots: allBots.filter(b => b.status === "running").length,
    openTrades,
  };
}

export function canOpenNewTrade(allBots: BotState[], newTradeExposure: number): { allowed: boolean; reason: string | null } {
  const totalCapital = allBots.reduce((sum, b) => sum + b.capital, 0) || 100000;
  let currentExposure = 0;
  for (const bot of allBots) {
    if (bot.openTrade) currentExposure += bot.openTrade.entryPrice * bot.openTrade.quantity;
  }
  const newExposurePct = ((currentExposure + newTradeExposure) / totalCapital) * 100;
  if (newExposurePct > 80) {
    return { allowed: false, reason: `Portfolio exposure would exceed 80% (${newExposurePct.toFixed(1)}%)` };
  }
  return { allowed: true, reason: null };
}

// ── Cooldown Period ──────────────────────────────────────────────────────────
export function recordTradeClose(sessionToken: string, scanIntervalSec: number): void {
  const cooldownMs = scanIntervalSec * 2 * 1000; // 2 candles
  cooldowns.set(sessionToken, {
    lastTradeCloseAt: Date.now(),
    cooldownUntil: Date.now() + cooldownMs,
    isActive: true,
  });
}

export function isCooldownActive(sessionToken: string): { active: boolean; remainingMs: number } {
  const cd = cooldowns.get(sessionToken);
  if (!cd) return { active: false, remainingMs: 0 };
  const remaining = cd.cooldownUntil - Date.now();
  if (remaining <= 0) {
    cd.isActive = false;
    return { active: false, remainingMs: 0 };
  }
  return { active: true, remainingMs: remaining };
}

// ── Kill Switch ──────────────────────────────────────────────────────────────
export async function executeKillSwitch(
  allBots: BotState[],
  stopBotFn: (sessionToken: string) => void,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
): Promise<{ closedTrades: number; stoppedBots: number }> {
  let closedTrades = 0;
  let stoppedBots = 0;

  for (const bot of allBots) {
    // Close open trade at market
    if (bot.openTrade) {
      const trade = bot.openTrade;
      const exitPrice = bot.lastPrice || trade.entryPrice;

      if (trade.mode === "live" && bot.accessToken) {
        const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
        await placeUpstoxOrder(bot.accessToken, trade.instrumentToken, exitDir, trade.quantity);
      }

      const pnl = trade.direction === "BUY"
        ? (exitPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - exitPrice) * trade.quantity;

      await onTradeClose(trade.dbId, exitPrice, pnl, "Kill Switch — Emergency Close");
      bot.openTrade = null;
      bot.dailyPnl += pnl;
      closedTrades++;
    }

    // Stop the bot
    if (bot.status === "running") {
      stopBotFn(bot.sessionToken);
      stoppedBots++;
    }
  }

  return { closedTrades, stoppedBots };
}

// ── Slippage & Brokerage for Paper Mode ──────────────────────────────────────
const paperCostConfig = { brokerage: 20, slippagePct: 0.05 };

export function getPaperCostConfig(): { brokerage: number; slippagePct: number } {
  return paperCostConfig;
}

export function setPaperCostConfig(brokerage: number, slippagePct: number): { brokerage: number; slippagePct: number } {
  paperCostConfig.brokerage = brokerage;
  paperCostConfig.slippagePct = slippagePct;
  return paperCostConfig;
}

export function applyPaperCosts(
  rawPnl: number,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  brokerage: number = 20,
  slippagePct: number = 0.05,
): number {
  // Slippage: applied on both entry and exit (adverse direction)
  const slippageEntry = entryPrice * (slippagePct / 100) * quantity;
  const slippageExit = exitPrice * (slippagePct / 100) * quantity;
  // Brokerage: flat fee per trade (entry + exit = 1 trade round-trip)
  const totalCosts = slippageEntry + slippageExit + brokerage;
  return rawPnl - totalCosts;
}

// ── Daily reset (call at market open) ────────────────────────────────────────
export function resetDailyState(): void {
  portfolioHalted = false;
  portfolioHaltReason = null;
  stoplossGuard = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };
  cooldowns.clear();
}
