/**
 * Precision Metrics Engine
 * Computes comprehensive trading performance metrics from the signal journal and trade log.
 * Used for verifying bot accuracy before going live with subscriptions.
 *
 * Metrics computed:
 *   - Win Rate, Profit Factor, Expectancy per trade
 *   - Sharpe Ratio (annualized, using daily returns)
 *   - Max Drawdown (peak-to-trough on equity curve)
 *   - Signal Precision (% of signals that resulted in profitable trades)
 *   - Per-Layer Accuracy (breakdown by strategy layer)
 *   - Streak Analysis (max consecutive wins/losses)
 *   - Risk-Reward Realization (actual RR vs planned RR)
 */

import { getDb } from "./db";
import { tradeLog, signalJournal } from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";

// IST timezone helper — converts a Date to IST date string (YYYY-MM-DD)
function toISTDateKey(d: Date): string {
  const istMs = d.getTime() + 330 * 60000;
  return new Date(istMs).toISOString().slice(0, 10);
}
// Convert an IST date string (YYYY-MM-DD) to UTC Date at IST midnight (00:00 IST = previous day 18:30 UTC)
function istDateToUTC(dateStr: string, endOfDay = false): Date {
  const base = new Date(dateStr + "T00:00:00Z");
  const utc = new Date(base.getTime() - 330 * 60000);
  if (endOfDay) return new Date(utc.getTime() + 86400000 - 1);
  return utc;
}
// IST hour (0-23) from a Date
function toISTHour(d: Date): number {
  return Math.floor(((d.getUTCHours() * 60 + d.getUTCMinutes()) + 330) % 1440 / 60);
}

// Inferred row types from drizzle select
type TradeRow = typeof tradeLog.$inferSelect;
type SignalRow = typeof signalJournal.$inferSelect;

// ── Types ────────────────────────────────────────────────────────────────────
export interface PrecisionMetrics {
  // Core metrics
  totalSignals: number;
  signalsTaken: number;
  signalsRejected: number;
  signalPrecision: number; // % of taken signals that were profitable
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactor: number;
  expectancy: number; // avg P&L per trade
  avgWin: number;
  avgLoss: number;
  avgRR: number; // average realized risk:reward
  // Risk metrics
  sharpeRatio: number;
  maxDrawdown: number; // % peak-to-trough
  maxDrawdownAmount: number; // ₹ peak-to-trough
  calmarRatio: number; // annualized return / max drawdown
  // Streak analysis
  currentStreak: { type: "win" | "loss" | "none"; count: number };
  maxWinStreak: number;
  maxLossStreak: number;
  // Time analysis
  avgHoldDurationMin: number;
  bestHour: { hour: number; pnl: number; trades: number } | null;
  worstHour: { hour: number; pnl: number; trades: number } | null;
  // Equity curve
  equityCurve: Array<{ date: string; equity: number; trades: number }>;
  // Period
  fromDate: string;
  toDate: string;
  tradingDays: number;
}

export interface LayerAccuracy {
  layer: string;
  totalSignals: number;
  signalsTaken: number;
  signalsRejected: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  profitFactor: number;
  avgConfidence: number;
  avgHoldMin: number;
  bestTrade: number;
  worstTrade: number;
  precision: number; // % of signals that resulted in profit
}

export interface DailyReport {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  signals: number;
  signalsTaken: number;
  bestTrade: number;
  worstTrade: number;
  maxDD: number;
}

// ── Compute Precision Metrics ────────────────────────────────────────────────
export async function computePrecisionMetrics(
  sessionToken: string,
  fromDate?: string,
  toDate?: string,
  capital: number = 100000,
): Promise<PrecisionMetrics | null> {
  const db = await getDb();
  if (!db) return null;

  // Build date filters
  const dateFilters = [];
  if (fromDate) dateFilters.push(gte(tradeLog.enteredAt, istDateToUTC(fromDate)));
  if (toDate) dateFilters.push(lte(tradeLog.enteredAt, istDateToUTC(toDate, true)));

  // Fetch all closed trades for this session (including slots)
  const tokens = [sessionToken, `${sessionToken}-slot1`, `${sessionToken}-slot2`, `${sessionToken}-slot3`];
  const trades: TradeRow[] = await db
    .select()
    .from(tradeLog)
    .where(and(
      inArray(tradeLog.sessionToken, tokens),
      eq(tradeLog.status, "closed"),
      ...dateFilters,
    ))
    .orderBy(tradeLog.enteredAt);

  if (trades.length === 0) return null;

  // Fetch signal journal
  const signalFilters = [];
  if (fromDate) signalFilters.push(gte(signalJournal.signalAt, istDateToUTC(fromDate)));
  if (toDate) signalFilters.push(lte(signalJournal.signalAt, istDateToUTC(toDate, true)));

  const signals: SignalRow[] = await db
    .select()
    .from(signalJournal)
    .where(and(
      inArray(signalJournal.sessionToken, tokens),
      ...signalFilters,
    ))
    .orderBy(signalJournal.signalAt);

  // ── Core Metrics ───────────────────────────────────────────────────────────
  const totalTrades = trades.length;
  const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const losses = trades.filter(t => (t.pnl ?? 0) < 0).length;
  const breakeven = trades.filter(t => (t.pnl ?? 0) === 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const grossProfit = trades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(trades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const expectancy = totalTrades > 0 ? totalPnl / totalTrades : 0;

  const winTrades = trades.filter(t => (t.pnl ?? 0) > 0);
  const lossTrades = trades.filter(t => (t.pnl ?? 0) < 0);
  const avgWin = winTrades.length > 0 ? winTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / winTrades.length : 0;
  const avgLoss = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / lossTrades.length) : 0;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

  // ── Signal Precision ───────────────────────────────────────────────────────
  const totalSignals = signals.length;
  const signalsTaken = signals.filter(s => s.outcome === "traded").length;
  const signalsRejected = signals.filter(s => s.outcome === "rejected").length;
  const profitableSignals = signals.filter(s => s.outcome === "traded" && (s.pnl ?? 0) > 0).length;
  const signalPrecision = signalsTaken > 0 ? (profitableSignals / signalsTaken) * 100 : 0;

  // ── Equity Curve & Max Drawdown ────────────────────────────────────────────
  let runningEquity = capital;
  let peak = capital;
  let maxDrawdown = 0;
  let maxDrawdownAmount = 0;

  const equityByDate = new Map<string, { equity: number; trades: number }>();
  for (const t of trades) {
    runningEquity += (t.pnl ?? 0);
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak > 0 ? ((peak - runningEquity) / peak) * 100 : 0;
    const ddAmt = peak - runningEquity;
    if (dd > maxDrawdown) { maxDrawdown = dd; maxDrawdownAmount = ddAmt; }

    const dateKey = toISTDateKey(t.exitedAt ?? t.enteredAt);
    const existing = equityByDate.get(dateKey) ?? { equity: capital, trades: 0 };
    equityByDate.set(dateKey, { equity: runningEquity, trades: existing.trades + 1 });
  }

  const equityCurve = Array.from(equityByDate.entries()).map(([date, v]) => ({
    date,
    equity: Math.round(v.equity),
    trades: v.trades,
  }));

  // ── Sharpe Ratio (annualized from daily returns) ───────────────────────────
  const dailyReturns: number[] = [];
  const tradesByDay = new Map<string, number>();
  for (const t of trades) {
    const dateKey = toISTDateKey(t.exitedAt ?? t.enteredAt);
    tradesByDay.set(dateKey, (tradesByDay.get(dateKey) ?? 0) + (t.pnl ?? 0));
  }
  for (const pnl of Array.from(tradesByDay.values())) {
    dailyReturns.push(pnl / capital);
  }
  const tradingDays = dailyReturns.length;
  const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const stdDev = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  // Calmar ratio: annualized return / max drawdown
  const annualizedReturn = tradingDays > 0 ? (totalPnl / capital) * (252 / tradingDays) * 100 : 0;
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // ── Streak Analysis ────────────────────────────────────────────────────────
  let maxWinStreak = 0, maxLossStreak = 0;
  let currentWinStreak = 0, currentLossStreak = 0;
  for (const t of trades) {
    if ((t.pnl ?? 0) > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else if ((t.pnl ?? 0) < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    } else {
      // Breakeven: reset both streaks
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }
  const lastTrade = trades[trades.length - 1];
  const currentStreak = currentWinStreak > 0
    ? { type: "win" as const, count: currentWinStreak }
    : currentLossStreak > 0
      ? { type: "loss" as const, count: currentLossStreak }
      : { type: "none" as const, count: 0 };

  // ── Time Analysis (best/worst hour) ────────────────────────────────────────
  const byHour = new Map<number, { pnl: number; trades: number }>();
  for (const t of trades) {
    const hour = toISTHour(t.enteredAt);
    const existing = byHour.get(hour) ?? { pnl: 0, trades: 0 };
    byHour.set(hour, { pnl: existing.pnl + (t.pnl ?? 0), trades: existing.trades + 1 });
  }
  let bestHour: { hour: number; pnl: number; trades: number } | null = null;
  let worstHour: { hour: number; pnl: number; trades: number } | null = null;
  for (const [hour, data] of Array.from(byHour.entries())) {
    if (!bestHour || data.pnl > bestHour.pnl) bestHour = { hour, ...data };
    if (!worstHour || data.pnl < worstHour.pnl) worstHour = { hour, ...data };
  }

  // ── Avg Hold Duration ──────────────────────────────────────────────────────
  const holdDurations = trades
    .filter(t => t.exitedAt && t.enteredAt)
    .map(t => (t.exitedAt!.getTime() - t.enteredAt.getTime()) / 60000);
  const avgHoldDurationMin = holdDurations.length > 0
    ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length
    : 0;

  // ── Date range ─────────────────────────────────────────────────────────────
  const actualFrom = toISTDateKey(trades[0].enteredAt);
  const actualTo = toISTDateKey(trades[trades.length - 1].enteredAt);

  return {
    totalSignals, signalsTaken, signalsRejected, signalPrecision,
    totalTrades, wins, losses, breakeven, winRate, profitFactor, expectancy,
    avgWin, avgLoss, avgRR,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownAmount: Math.round(maxDrawdownAmount),
    calmarRatio: Math.round(calmarRatio * 100) / 100,
    currentStreak, maxWinStreak, maxLossStreak,
    avgHoldDurationMin: Math.round(avgHoldDurationMin),
    bestHour, worstHour,
    equityCurve,
    fromDate: actualFrom, toDate: actualTo, tradingDays,
  };
}

// ── Per-Layer Accuracy ───────────────────────────────────────────────────────
export async function computeLayerAccuracy(
  sessionToken: string,
  fromDate?: string,
  toDate?: string,
): Promise<LayerAccuracy[]> {
  const db = await getDb();
  if (!db) return [];

  const tokens = [sessionToken, `${sessionToken}-slot1`, `${sessionToken}-slot2`, `${sessionToken}-slot3`];


  // Fetch signals grouped by layer
  const signalFilters = [];
  if (fromDate) signalFilters.push(gte(signalJournal.signalAt, istDateToUTC(fromDate)));
  if (toDate) signalFilters.push(lte(signalJournal.signalAt, istDateToUTC(toDate, true)));

  const signals: SignalRow[] = await db
    .select()
    .from(signalJournal)
    .where(and(inArray(signalJournal.sessionToken, tokens), ...signalFilters));

  // Fetch closed trades
  const dateFilters = [];
  if (fromDate) dateFilters.push(gte(tradeLog.enteredAt, istDateToUTC(fromDate)));
  if (toDate) dateFilters.push(lte(tradeLog.enteredAt, istDateToUTC(toDate, true)));

  const trades: TradeRow[] = await db
    .select()
    .from(tradeLog)
    .where(and(inArray(tradeLog.sessionToken, tokens), eq(tradeLog.status, "closed"), ...dateFilters));

  // Group signals by layer
  const byLayer = new Map<string, { signals: typeof signals; trades: typeof trades }>();
  for (const s of signals) {
    const layer = s.layer || "Unknown";
    if (!byLayer.has(layer)) byLayer.set(layer, { signals: [], trades: [] });
    byLayer.get(layer)!.signals.push(s);
  }

  // Match trades to layers by extracting [LayerName] tag from signalReason
  for (const t of trades) {
    const reason = t.signalReason ?? "";
    // Extract layer from [LayerName] tag at the start of signalReason (e.g. "[Breakout] ..." → "Breakout")
    const tagMatch = reason.match(/^(?:\[Re-entry\]\s*)?\[([^\]]+)\]/);
    const matched = tagMatch ? tagMatch[1] : "Other";
    if (!byLayer.has(matched)) byLayer.set(matched, { signals: [], trades: [] });
    byLayer.get(matched)!.trades.push(t);
  }

  // Compute per-layer stats
  const results: LayerAccuracy[] = [];
  for (const [layer, data] of Array.from(byLayer.entries())) {
    const layerTrades = data.trades;
    const layerSignals = data.signals;
    const tradeCount = layerTrades.length;
    const layerWins = layerTrades.filter(t => (t.pnl ?? 0) > 0).length;
    const layerLosses = layerTrades.filter(t => (t.pnl ?? 0) <= 0).length;
    const layerWinRate = tradeCount > 0 ? (layerWins / tradeCount) * 100 : 0;
    const layerTotalPnl = layerTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const layerAvgPnl = tradeCount > 0 ? layerTotalPnl / tradeCount : 0;
    const layerGrossProfit = layerTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
    const layerGrossLoss = Math.abs(layerTrades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0));
    const layerPF = layerGrossLoss > 0 ? layerGrossProfit / layerGrossLoss : layerGrossProfit > 0 ? 99 : 0;
    const avgConf = layerTrades.length > 0
      ? layerTrades.reduce((s, t) => s + (t.confidence ?? 0), 0) / layerTrades.length
      : 0;
    const holdDurations = layerTrades
      .filter(t => t.exitedAt && t.enteredAt)
      .map(t => (t.exitedAt!.getTime() - t.enteredAt.getTime()) / 60000);
    const avgHoldMin = holdDurations.length > 0 ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length : 0;
    const bestTrade = layerTrades.length > 0 ? Math.max(...layerTrades.map(t => t.pnl ?? 0)) : 0;
    const worstTrade = layerTrades.length > 0 ? Math.min(...layerTrades.map(t => t.pnl ?? 0)) : 0;

    const signalsTaken = layerSignals.filter(s => s.outcome === "traded").length;
    const signalsRejected = layerSignals.filter(s => s.outcome === "rejected").length;
    const profitableSignals = layerSignals.filter(s => s.outcome === "traded" && (s.pnl ?? 0) > 0).length;
    const precision = signalsTaken > 0 ? (profitableSignals / signalsTaken) * 100 : layerWinRate;

    results.push({
      layer,
      totalSignals: layerSignals.length,
      signalsTaken,
      signalsRejected,
      trades: tradeCount,
      wins: layerWins,
      losses: layerLosses,
      winRate: Math.round(layerWinRate * 10) / 10,
      totalPnl: Math.round(layerTotalPnl),
      avgPnl: Math.round(layerAvgPnl),
      profitFactor: Math.round(layerPF * 100) / 100,
      avgConfidence: Math.round(avgConf),
      avgHoldMin: Math.round(avgHoldMin),
      bestTrade: Math.round(bestTrade),
      worstTrade: Math.round(worstTrade),
      precision: Math.round(precision * 10) / 10,
    });
  }

  return results.sort((a, b) => b.trades - a.trades);
}

// ── Daily Reports ────────────────────────────────────────────────────────────
export async function computeDailyReports(
  sessionToken: string,
  days: number = 30,
): Promise<DailyReport[]> {
  const db = await getDb();
  if (!db) return [];

  const tokens = [sessionToken, `${sessionToken}-slot1`, `${sessionToken}-slot2`, `${sessionToken}-slot3`];

  const since = new Date(Date.now() - days * 86400000);

  const trades: TradeRow[] = await db
    .select()
    .from(tradeLog)
    .where(and(
      inArray(tradeLog.sessionToken, tokens),
      eq(tradeLog.status, "closed"),
      gte(tradeLog.enteredAt, since),
    ))
    .orderBy(tradeLog.enteredAt);

  const signals: SignalRow[] = await db
    .select()
    .from(signalJournal)
    .where(and(
      inArray(signalJournal.sessionToken, tokens),
      gte(signalJournal.signalAt, since),
    ));

  // Group by date
  const byDate = new Map<string, { trades: TradeRow[]; signals: SignalRow[] }>();
  for (const t of trades) {
    const dateKey = toISTDateKey(t.enteredAt);
    if (!byDate.has(dateKey)) byDate.set(dateKey, { trades: [], signals: [] });
    byDate.get(dateKey)!.trades.push(t);
  }
  for (const s of signals) {
    const dateKey = toISTDateKey(s.signalAt);
    if (!byDate.has(dateKey)) byDate.set(dateKey, { trades: [], signals: [] });
    byDate.get(dateKey)!.signals.push(s);
  }

  const reports: DailyReport[] = [];
  for (const [date, data] of Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))) {
    const dayTrades = data.trades;
    const daySignals = data.signals;
    const dayWins = dayTrades.filter(t => (t.pnl ?? 0) > 0).length;
    const dayLosses = dayTrades.filter(t => (t.pnl ?? 0) < 0).length;
    const dayPnl = dayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const dayWinRate = dayTrades.length > 0 ? (dayWins / dayTrades.length) * 100 : 0;
    const bestTrade = dayTrades.length > 0 ? Math.max(...dayTrades.map(t => t.pnl ?? 0)) : 0;
    const worstTrade = dayTrades.length > 0 ? Math.min(...dayTrades.map(t => t.pnl ?? 0)) : 0;

    // Intra-day max drawdown
    let dayPeak = 0, dayMaxDD = 0, dayRunning = 0;
    for (const t of dayTrades) {
      dayRunning += (t.pnl ?? 0);
      if (dayRunning > dayPeak) dayPeak = dayRunning;
      const dd = dayPeak > 0 ? dayPeak - dayRunning : 0;
      if (dd > dayMaxDD) dayMaxDD = dd;
    }

    reports.push({
      date,
      trades: dayTrades.length,
      wins: dayWins,
      losses: dayLosses,
      pnl: Math.round(dayPnl),
      winRate: Math.round(dayWinRate),
      signals: daySignals.length,
      signalsTaken: daySignals.filter(s => s.outcome === "traded").length,
      bestTrade: Math.round(bestTrade),
      worstTrade: Math.round(worstTrade),
      maxDD: Math.round(dayMaxDD),
    });
  }

  return reports;
}

// ── Signal Journal Write Helpers ────────────────────────────────────────────

export interface JournalEntry {
  sessionToken: string;
  symbol: string;
  instrumentToken?: string;
  direction: "BUY" | "SELL";
  layer: string;
  confidence: number;
  entryPrice: number;
  suggestedSl?: number;
  suggestedTarget?: number;
  atr?: number;
  regime?: string;
  vixLevel?: number;
  oiBias?: string;
  outcome: "traded" | "rejected" | "pending";
  rejectReason?: string;
  tradeId?: number;
}

/**
 * Log a signal to the journal (fire-and-forget, non-blocking).
 * Called from botEngine on every signal that passes through risk gates.
 */
export function logSignalToJournal(entry: JournalEntry): void {
  // Fire-and-forget to avoid blocking the tick loop
  (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(signalJournal).values({
        sessionToken: entry.sessionToken,
        symbol: entry.symbol,
        instrumentToken: entry.instrumentToken ?? null,
        direction: entry.direction,
        layer: entry.layer,
        confidence: entry.confidence,
        entryPrice: entry.entryPrice,
        suggestedSl: entry.suggestedSl ?? null,
        suggestedTarget: entry.suggestedTarget ?? null,
        atr: entry.atr ?? null,
        regime: entry.regime ?? null,
        vixLevel: entry.vixLevel ?? null,
        oiBias: entry.oiBias ?? null,
        outcome: entry.outcome,
        rejectReason: entry.rejectReason ?? null,
        tradeId: entry.tradeId ?? null,
        exitPrice: null,
        pnl: null,
        exitReason: null,
        holdDurationMs: null,
        maxFavorableExcursion: null,
        maxAdverseExcursion: null,
        signalAt: new Date(),
        outcomeAt: entry.outcome !== "pending" ? new Date() : null,
      });
    } catch (err) {
      console.error("[PrecisionMetrics] Failed to log signal:", err);
    }
  })();
}

/**
 * Update a journal entry when its associated trade closes.
 * Called from the onTradeClose callback in routers.ts.
 */
export async function updateJournalOnTradeClose(tradeId: number, exitPrice: number, pnl: number, exitReason: string, holdDurationMs: number, mfe?: number, mae?: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(signalJournal)
      .set({
        exitPrice,
        pnl,
        exitReason,
        holdDurationMs: BigInt(holdDurationMs),
        maxFavorableExcursion: mfe ?? null,
        maxAdverseExcursion: mae ?? null,
        outcomeAt: new Date(),
      })
      .where(eq(signalJournal.tradeId, tradeId));
  } catch (err) {
    console.error("[PrecisionMetrics] Failed to update journal on close:", err);
  }
}
