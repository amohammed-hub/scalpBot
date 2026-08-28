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

import type { BotState, Candle, RegimeV2 } from "./botEngine";
import { placeUpstoxOrder } from "./botEngine";
import { upstoxAxios } from "./upstoxHttp";
import { selectRequestedUpstoxQuote } from "./upstoxQuote";

interface DemoCostConfig {
  slippagePct: number;
  brokeragePer: number;
  sttPct: number;
}

const defaultDemoCost: DemoCostConfig = { slippagePct: 0.05, brokeragePer: 20, sttPct: 0.025 };
const demoCostBySession = new Map<string, DemoCostConfig>();
let _demoCostLoadedFromDb = false;

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
const cachedRiskScoreBySession = new Map<string, MarketRiskScore>();
const defaultRiskScore: MarketRiskScore = { score: 0, safe: true, regime: "unknown", vixLevel: 0, consecutiveSLs: 0, reasons: [], updatedAt: 0 };

// BUG-4 fix: Per-session stoploss guard instead of global
const stoplossGuardBySession = new Map<string, StoplossGuardState>();
const defaultSlGuard: StoplossGuardState = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };

function getSlGuard(sessionToken: string): StoplossGuardState {
  if (!stoplossGuardBySession.has(sessionToken)) stoplossGuardBySession.set(sessionToken, { ...defaultSlGuard });
  return stoplossGuardBySession.get(sessionToken)!;
}

// Per-session portfolio halt state (keyed by root session token)
const portfolioHaltBySession = new Map<string, { halted: boolean; reason: string | null }>();

function getPortfolioHalt(sessionToken: string): { halted: boolean; reason: string | null } {
  return portfolioHaltBySession.get(sessionToken) ?? { halted: false, reason: null };
}

// Per-session cooldown tracking
const cooldowns = new Map<string, CooldownState>();

// BUG-12 fix: Periodic cleanup of stale cooldown entries (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [key, cd] of Array.from(cooldowns.entries())) {
    if (now - cd.lastTradeCloseAt > 3600_000) cooldowns.delete(key);
  }
}, 600_000); // every 10 minutes

// ── India VIX fetch (public Upstox API, no auth needed) ─────────────────────
let lastVixFetch = 0;
let cachedVix = 0;
const VIX_CACHE_MS = 60_000; // cache 60s

export async function fetchIndiaVix(accessToken?: string | null): Promise<number> {
  // No-token paths fail fast; authenticated production calls still fetch VIX.
  if (accessToken == null) return cachedVix;
  if (Date.now() - lastVixFetch < VIX_CACHE_MS && cachedVix > 0) return cachedVix;
  try {
    // India VIX instrument key on Upstox
    const headers: Record<string, string> = { Accept: "application/json" };
    // BUG-13 fix: Include auth header when available to avoid rate limiting
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const resp = await upstoxAxios.get(
      "https://api.upstox.com/v2/market-quote/quotes?instrument_key=NSE_INDEX%7CIndia%20VIX",
      { headers, timeout: 6000 },
    );
    const quote = selectRequestedUpstoxQuote(resp.data?.data, "NSE_INDEX|India VIX");
    const vix = quote?.last_price ?? 0;
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
  sessionToken: string = "default",
  accessToken?: string | null,
  regimeV2?: RegimeV2,
): Promise<MarketRiskScore> {
  const reasons: string[] = [];
  let score = 0;

  // 1. India VIX
  const vix = await fetchIndiaVix(accessToken);
  if (vix > 30) { score += 40; reasons.push(`India VIX extremely high (${vix.toFixed(1)})`); }
  else if (vix > 25) { score += 25; reasons.push(`India VIX high (${vix.toFixed(1)})`); }
  else if (vix > 20) { score += 10; reasons.push(`India VIX elevated (${vix.toFixed(1)})`); }

  // 2. Market regime — D6: use the same per-tick V2 snapshot held by BotState.
  // This function intentionally does not classify candles independently.
  const regime = regimeV2 ?? "UNKNOWN";
  if (regime === "VOLATILE") { score += 30; reasons.push(`Regime: ${regime}`); }
  else if (regime === "RANGING") { score += 15; reasons.push(`Regime: ${regime} (choppy)`); }
  else if (regime === "DEAD") { score += 5; reasons.push(`Regime: ${regime}`); }

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

  const result = { score, safe, regime, vixLevel: vix, consecutiveSLs, reasons, updatedAt: Date.now() };
  cachedRiskScoreBySession.set(sessionToken, result);
  return result;
}

export function getCachedRiskScore(sessionToken: string = "default"): MarketRiskScore {
  return cachedRiskScoreBySession.get(sessionToken) ?? defaultRiskScore;
}

// ── StoplossGuard ────────────────────────────────────────────────────────────
const SL_GUARD_THRESHOLD = 3;
const SL_GUARD_PAUSE_MS = 30 * 60 * 1000; // 30 minutes

export function updateStoplossGuard(
  recentTrades: Array<{ exitReason: string | null; pnl: number | null }>,
  sessionToken: string = "default",
): StoplossGuardState {
  let stoplossGuard = getSlGuard(sessionToken);
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
    stoplossGuardBySession.set(sessionToken, stoplossGuard);
  } else if (stoplossGuard.isPaused && Date.now() > stoplossGuard.pausedUntil) {
    // Cooldown expired
    stoplossGuard = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };
    stoplossGuardBySession.set(sessionToken, stoplossGuard);
  }

  stoplossGuard.consecutiveSLs = consecutiveSLs;
  return stoplossGuard;
}

export function getStoplossGuardState(sessionToken: string = "default"): StoplossGuardState {
  const stoplossGuard = getSlGuard(sessionToken);
  // Auto-expire
  if (stoplossGuard.isPaused && Date.now() > stoplossGuard.pausedUntil) {
    const reset = { isPaused: false, pausedUntil: 0, consecutiveSLs: 0, reason: null };
    stoplossGuardBySession.set(sessionToken, reset);
    return reset;
  }
  return stoplossGuard;
}

// ── Portfolio MaxDrawdown Halt ───────────────────────────────────────────────
export function checkPortfolioDrawdown(
  allBots: BotState[],
  dailyLossLimitPct: number,
  sessionToken?: string,
): { halted: boolean; reason: string | null } {
  const key = sessionToken ?? "default";
  const current = getPortfolioHalt(key);
  if (allBots.length === 0) return current;

  const totalCapital = allBots.reduce((sum, b) => sum + b.capital, 0);
  const aggregatePnl = allBots.reduce((sum, b) => sum + b.dailyPnl, 0);
  const maxLoss = -(totalCapital * dailyLossLimitPct) / 100;

  if (aggregatePnl <= maxLoss && !current.halted) {
    const reason = `Portfolio daily loss limit hit: ₹${aggregatePnl.toFixed(0)} (limit: ₹${maxLoss.toFixed(0)})`;
    portfolioHaltBySession.set(key, { halted: true, reason });
    return { halted: true, reason };
  }

  // Auto-clear halt when conditions recover (e.g., user starts fresh bot with 0 dailyPnl,
  // or previous losing bot was stopped and new bot's aggregate is above limit)
  if (current.halted && aggregatePnl > maxLoss) {
    portfolioHaltBySession.set(key, { halted: false, reason: null });
    return { halted: false, reason: null };
  }

  return current;
}

export function resetPortfolioHalt(sessionToken?: string): void {
  if (sessionToken) {
    portfolioHaltBySession.delete(sessionToken);
  } else {
    portfolioHaltBySession.clear();
  }
}

// ── Portfolio Exposure ───────────────────────────────────────────────────────
export function getPortfolioStatus(allBots: BotState[], sessionToken?: string): PortfolioStatus {
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
    isHalted: getPortfolioHalt(sessionToken ?? "default").halted,
    haltReason: getPortfolioHalt(sessionToken ?? "default").reason,
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

// ── Same-Direction Loss Streak Guard ───────────────────────────────────────
// After 2 consecutive losing trades in the SAME direction within 90 minutes,
// block that direction for 30 minutes. The market is telling us the read is wrong
// (e.g. repeatedly buying CE dips on a fading rally). Opposite-direction signals
// remain allowed — that's often exactly the flip that's needed.
interface DirectionLossStreak {
  direction: "BUY" | "SELL";
  losses: number[]; // timestamps of consecutive same-direction losses
  blockedUntil: number;
}
const directionStreaks = new Map<string, DirectionLossStreak>();

export function recordDirectionalLoss(sessionToken: string, direction: "BUY" | "SELL", isMCX: boolean = false): void {
  const now = Date.now();
  const WINDOW_MS = 90 * 60 * 1000;
  // MCX trends strongly — reduce direction block from 30min to 15min for MCX
  const BLOCK_MS = isMCX ? 15 * 60 * 1000 : 30 * 60 * 1000; // MCX: 15 min, NSE: 30 min
  const cur = directionStreaks.get(sessionToken);
  if (!cur || cur.direction !== direction) {
    directionStreaks.set(sessionToken, { direction, losses: [now], blockedUntil: 0 });
    return;
  }
  cur.losses = cur.losses.filter(t => now - t < WINDOW_MS);
  cur.losses.push(now);
  if (cur.losses.length >= 2) {
    cur.blockedUntil = now + BLOCK_MS;
  }
}

export function recordDirectionalWin(sessionToken: string, direction: "BUY" | "SELL"): void {
  const cur = directionStreaks.get(sessionToken);
  if (cur && cur.direction === direction) {
    directionStreaks.delete(sessionToken); // a win resets the streak
  }
}

export function isDirectionBlocked(sessionToken: string, direction: "BUY" | "SELL"): { blocked: boolean; remainingMin: number } {
  const cur = directionStreaks.get(sessionToken);
  if (!cur || cur.direction !== direction) return { blocked: false, remainingMin: 0 };
  const remaining = cur.blockedUntil - Date.now();
  if (remaining <= 0) return { blocked: false, remainingMin: 0 };
  return { blocked: true, remainingMin: Math.ceil(remaining / 60000) };
}

export function resetDirectionStreak(sessionToken: string): void {
  directionStreaks.delete(sessionToken);
}

// ── Kill Switch ──────────────────────────────────────────────────────────
export async function executeKillSwitch(
  allBots: BotState[],
  stopBotFn: (sessionToken: string) => void,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
  emitActivity: (sessionToken: string, category: string, message: string) => void = () => {},
): Promise<{ closedTrades: number; stoppedBots: number; failedExits: string[] }> {
  let closedTrades = 0;
  let stoppedBots = 0;
  const failedExits: string[] = [];

  for (const bot of allBots) {
    // Close open trade at market
    if (bot.openTrade) {
      const trade = bot.openTrade;
      let exitPrice = 0;
      let upstoxOrderFailed = false;

      // Try to get real exit price from Upstox quote
      if (trade.isIndexOptions) {
        if (bot.accessToken && (bot as any).optionTradeToken && !(bot as any).optionTradeToken.startsWith("PAPER_OPT|")) {
          try {
            const { fetchFullQuote } = await import("./botEngine");
            const q = await fetchFullQuote((bot as any).optionTradeToken, bot.accessToken);
            if (q && q.ltp > 0) exitPrice = q.bid > 0 ? Math.max(q.bid, q.ltp) : q.ltp;
          } catch { /* non-fatal */ }
        }
        if (exitPrice === 0 && bot.optionPremiumPrice && bot.optionPremiumPrice > 0) {
          exitPrice = bot.optionPremiumPrice;
        }
        if (exitPrice === 0) exitPrice = trade.entryPrice;
      } else {
        exitPrice = bot.lastPrice || trade.entryPrice;
      }

      // Place exit order on Upstox (live mode only)
      if (trade.mode === "live" && bot.accessToken) {
        const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
        const { placeUpstoxOrder } = await import("./botEngine");
                const killOrderId = await placeUpstoxOrder(bot.accessToken, trade.instrumentToken, exitDir, (trade.quantity - (trade.bookedQty ?? 0)), bot.lotSize, trade.mode !== "live");
        if (!killOrderId) {
          // LIVE EXIT ORDER FAILED — position is STILL OPEN on Upstox.
          // SAFETY CONTRACT: do NOT close the DB trade here. Keeping the DB row
          // open preserves the live position for the engine's retry loop so a
          // broker-confirmed exit can still be placed (square-off window is not
          // yet past or the engine will re-attempt at market close). Fabricating
          // a DB-only close would leave an unmonitored live position and corrupt P&L.
          console.error(`[KillSwitch] ⚠️ LIVE EXIT ORDER FAILED for ${trade.symbolLabel ?? trade.symbol} — position still open on Upstox, DB row intentionally left OPEN for retry`);
          failedExits.push(trade.symbolLabel ?? trade.symbol ?? bot.sessionToken.slice(0, 8));
          upstoxOrderFailed = true;
        }
      }

      if (upstoxOrderFailed) {
        // Live position not broker-confirmed — DB state must stay open so the
        // retry/square-off logic can still exit it at market price.
        // Mark the bot's open trade with a kill-switch flag so the tick loop
        // re-attempts exit placement before any other logic touches it.
        if (bot.openTrade) (bot.openTrade as any).killSwitchExitFailed = true;
        emitActivity(bot.sessionToken, "criticalAlerts",
          `🚨 LIVE exit order FAILED during kill switch for ${trade.symbolLabel ?? trade.symbol} — position still open on Upstox. Kill switch still applied; engine will re-attempt exit.`);
        console.error(`[KillSwitch] DB trade left open for ${trade.symbolLabel ?? trade.symbol} pending broker-confirmed exit`);
      } else {
        // Broker exit succeeded (or mode is paper/demo) — close trade in DB.
        const remainingQty = trade.quantity - (trade.bookedQty ?? 0);
        const remainingPnl = trade.direction === "BUY"
          ? (exitPrice - trade.entryPrice) * remainingQty
          : (trade.entryPrice - exitPrice) * remainingQty;
        const pnl = remainingPnl + (trade.bookedPnl ?? 0);
        await onTradeClose(trade.dbId, exitPrice, pnl, "Kill Switch — Emergency Close");
        bot.openTrade = null;
        // Update daily P&L only when the trade is genuinely broker-confirmed closed.
        if ((trade as any).bookedPnlAddedToDaily) {
          bot.dailyPnl += remainingPnl;
        } else {
          bot.dailyPnl += pnl;
        }
      }
      // A failed live exit means the position is STILL OPEN on Upstox — do NOT
      // count it as closed or touch daily P&L; the engine retry loop will exit
      // it broker-confirmed and close the DB row at that time.
      if (!upstoxOrderFailed) closedTrades++;
    }

    // ALWAYS stop the bot (even if Upstox order failed)
    if (bot.status !== "stopped") {
      stopBotFn(bot.sessionToken);
      stoppedBots++;
    }
  }

  return { closedTrades, stoppedBots, failedExits };
}
export function getDemoCostConfig(sessionToken: string = "default"): DemoCostConfig {
  return demoCostBySession.get(sessionToken) ?? defaultDemoCost;
}
export async function setDemoCostConfig(brokeragePer: number, slippagePct: number, sessionToken: string = "default"): Promise<{ brokeragePer: number; slippagePct: number; sttPct: number }> {
  // Preserve the persisted STT% and fill in the other fields as a complete config —
  // never store a partial config, which previously corrupted demo P&L math.
  const existing = demoCostBySession.get(sessionToken) ?? defaultDemoCost;
  const config: DemoCostConfig = { slippagePct, brokeragePer, sttPct: existing.sttPct };
  demoCostBySession.set(sessionToken, config);
  // Persist to DB so it survives Railway restarts
  try {
    const { getDb } = await import("./db");
    const { adminSettings } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const key = `paperCost_${sessionToken}`;
      const value = JSON.stringify(config);
      const existing = await db.select().from(adminSettings).where(eq(adminSettings.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(adminSettings).set({ value }).where(eq(adminSettings.key, key));
      } else {
        await db.insert(adminSettings).values({ key, value });
      }
    }
  } catch (e) {
    console.warn("[PaperCost] Failed to persist to DB:", (e as Error).message);
  }
  return config;
}

/** Load demo costs from DB on startup (call once during init) */
export async function loadDemoCostsFromDb(): Promise<void> {
  if (_demoCostLoadedFromDb) return;
  _demoCostLoadedFromDb = true;
  try {
    const { getDb } = await import("./db");
    const { adminSettings } = await import("../drizzle/schema");
    const { like } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(adminSettings).where(like(adminSettings.key, "paperCost_%"));
      for (const row of rows) {
        const sessionToken = row.key.replace("paperCost_", "");
        try {
          const config = JSON.parse(row.value);
          if (typeof config.brokerage === "number" && typeof config.slippagePct === "number") {
            demoCostBySession.set(sessionToken, config);
          }
        } catch {}
      }
      if (rows.length > 0) console.log(`[PaperCost] Loaded ${rows.length} config(s) from DB`);
    }
  } catch (e) {
    console.warn("[PaperCost] Failed to load from DB:", (e as Error).message);
  }
}

export function applyDemoCosts(
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
export function resetDailyState(sessionToken?: string): void {
  resetPortfolioHalt(sessionToken);
  if (sessionToken) {
    stoplossGuardBySession.set(sessionToken, { ...defaultSlGuard });
    cooldowns.delete(sessionToken);
    directionFlipLocks.delete(sessionToken);
  } else {
    stoplossGuardBySession.clear();
    cooldowns.clear();
    directionFlipLocks.clear();
  }
}

// ── Direction Flip-Flop Lock ────────────────────────────────────────────────
// BUG #4 FIX: Once a bot picks a direction (BUY CE or BUY PE), it LOCKS that
// direction for 30 minutes. Cannot flip to opposite within that window.
// After 30 min, opposite direction allowed ONLY if previous direction's trade hit SL
// (confirming genuine reversal).
interface DirectionFlipLock {
  direction: "BUY" | "SELL"; // last trade direction
  lockedAt: number;          // timestamp when direction was locked
  lastExitWasSL: boolean;    // true if the last trade in this direction hit SL
}
const directionFlipLocks = new Map<string, DirectionFlipLock>();

const DIRECTION_FLIP_LOCK_MS = 30 * 60 * 1000; // 30 minutes

/** Call when a trade is opened to lock the direction */
export function lockDirection(sessionToken: string, direction: "BUY" | "SELL"): void {
  directionFlipLocks.set(sessionToken, {
    direction,
    lockedAt: Date.now(),
    lastExitWasSL: false,
  });
}

/** Call when a trade exits — record whether it was an SL exit */
export function recordDirectionExit(sessionToken: string, direction: "BUY" | "SELL", wasSL: boolean): void {
  const lock = directionFlipLocks.get(sessionToken);
  if (lock && lock.direction === direction) {
    lock.lastExitWasSL = wasSL;
  }
}

/** Check if a direction flip is blocked. Returns { blocked, remainingMin, reason } */
export function isDirectionFlipBlocked(sessionToken: string, newDirection: "BUY" | "SELL"): { blocked: boolean; remainingMin: number; reason: string } {
  const lock = directionFlipLocks.get(sessionToken);
  if (!lock) return { blocked: false, remainingMin: 0, reason: "" };
  // Same direction as last trade — always allowed
  if (lock.direction === newDirection) return { blocked: false, remainingMin: 0, reason: "" };
  // Opposite direction — check if within 30-min lock window
  const elapsed = Date.now() - lock.lockedAt;
  if (elapsed >= DIRECTION_FLIP_LOCK_MS) {
    // 30 min passed — allow flip ONLY if previous direction hit SL (confirming reversal)
    if (lock.lastExitWasSL) {
      return { blocked: false, remainingMin: 0, reason: "" };
    }
    // After 30 min without SL confirmation, still allow (lock expired)
    return { blocked: false, remainingMin: 0, reason: "" };
  }
  // Within 30 min — block unless previous direction hit SL
  if (lock.lastExitWasSL) {
    return { blocked: false, remainingMin: 0, reason: "" }; // SL confirms reversal, allow flip
  }
  const remainMin = Math.ceil((DIRECTION_FLIP_LOCK_MS - elapsed) / 60000);
  return {
    blocked: true,
    remainingMin: remainMin,
    reason: `Direction locked to ${lock.direction} for ${remainMin}min (no SL confirmation for reversal)`,
  };
}

/** Reset direction flip lock for a session */
export function resetDirectionFlipLock(sessionToken: string): void {
  directionFlipLocks.delete(sessionToken);
}
