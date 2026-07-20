/**
 * Bot Engine — runs in-process on the Node.js server.
 * Manages per-session bot instances, generates candle-based signals,
 * monitors open trade SL/Target, and places paper or live orders via Upstox API.
 *
 * Keyed by sessionToken (browser-generated UUID) — no Manus login required.
 *
 * === v2 Improvements ===
 * 1. Multi-timeframe confirmation (5-min trend before 1-min entry)
 * 2. Dynamic breakout threshold (ATR-relative, not fixed 0.03%)
 * 3. MACD + Bollinger Band squeeze as Layer 5
 * 4. Support/Resistance proximity filter (daily pivot points)
 * 5. Time-of-day bias filter (avoid 9:15–9:30, boost 10:00–11:30 and 14:00–15:00)
 * 6. Re-entry logic after stop loss (if signal still valid 2 candles later)
 * 7. Power Hour strategy (3:00–3:20 PM) — reads whole-day candles for institutional-level trades
 */

import axios from "axios";
import { emitActivity } from "./activityLog";
import { getNseIndexLotSize } from "../shared/lotSizes";
import { logSignalToJournal, updateJournalOnTradeClose } from "./precisionMetrics";
import {
  getStoplossGuardState, checkPortfolioDrawdown, canOpenNewTrade,
  recordTradeClose, isCooldownActive, applyPaperCosts, getPaperCostConfig, resetDailyState,
  recordDirectionalLoss, recordDirectionalWin, isDirectionBlocked, resetDirectionStreak,
} from "./riskManager";
import { fetchIndiaVix } from "./riskManager";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Signal {
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0–1
  entryPrice: number;
  slPrice: number;
  targetPrice: number;
  atr: number;
  reason: string;
  layer: "Breakout" | "Pattern" | "Trend" | "Momentum" | "MACD_BB" | "PowerHour" | "MCXEvening" | "MCXLateSession" | "HeroZero" | "ORB" | "VWAPReversion" | "VWAPPullback" | "InstFootprint" | "HourlyClose" | "BoomingBulls" | "FailedBreakout" | "OpeningBurst" | "None";
  // Institutional strategy metadata
  orbHigh?: number;
  orbLow?: number;
  vwapZScore?: number;
  marketRegime?: string;
  isPowerHour?: boolean;
  isMCXEvening?: boolean;
  isMCXLateSession?: boolean;
  isHeroZero?: boolean;
  // Partial profit booking levels
  partial1RPrice?: number;  // price at which to book 50%
  partial2RPrice?: number;  // price at which to book next 25%
  // V2 regime-based additions
  sizeReduction?: number;   // 0.5 for VOLATILE regime (reduce position size by 50%)
  regimeV2?: string;        // TRENDING | RANGING | VOLATILE | DEAD
}

export interface OpenTrade {
  dbId: number;
  symbol: string;
  symbolLabel: string;
  instrumentToken: string;
  direction: "BUY" | "SELL";
  mode: "paper" | "live";
  entryPrice: number;
  quantity: number;
  slPrice: number;
  targetPrice: number;
  atr: number;
  confidence: number;
  upstoxOrderId?: string;
  enteredAt: Date;
  trailingSlEnabled: boolean;
  trailingSlPct: number;
  currentSl: number;
  isReEntry?: boolean;
  // Partial profit booking
  partial1RPrice: number;   // book 50% at this price
  partial2RPrice: number;   // book 25% at this price
  partialBooked: 0 | 1 | 2; // 0=none, 1=50% booked, 2=75% booked
  bookedQty: number;        // units already closed
  bookedPnl: number;        // P&L from closed portion
  isHeroZero?: boolean;
  heroZeroPremiumEntry?: number; // premium paid for OTM option
  // Options mode: when true, exit price must be fetched from option chain, not underlying price
  isIndexOptions?: boolean;
  optionMockKey?: string; // e.g. "BNF_CE" or "BNF_PE" for paper mode premium lookup
  entryUnderlyingPrice?: number; // underlying index price at trade entry (for paper mode delta P&L drift)
  signalReason?: string; // full signal reason string
  signalLayer?: string; // extracted layer name e.g. "Breakout", "MCXEvening"
  carryForward?: boolean; // user chose to hold overnight
  bookedPnlAddedToDaily?: boolean; // true if bookedPnl was already added to dailyPnl in this session
  // Averaging/DCA fields
  averageCount?: number;         // 0 = no averaging done, 1 = averaged once (max 1)
  averagedAt?: number;           // timestamp (ms) of last averaging
  originalEntryPrice?: number;   // first entry price before any averaging (for analytics)
}

export interface BotState {
  sessionToken: string;
  sessionId: number;
  status: "running" | "stopped" | "paused" | "error";
  mode: "paper" | "live";
  instrumentToken: string;
  instrumentSymbol: string;
  instrumentLabel: string;
  capital: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  dailyLossLimitPct: number;
  stopLossMultiplier: number;
  targetMultiplier: number;
  trailingSlEnabled: boolean;
  trailingSlPct: number;
  minConfidence: number;
  scanIntervalSec: number;
  tradesCount: number;
  dailyPnl: number;
  lastSignal: Signal | null;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  candles: Candle[];
  candles5m: Candle[];
  candlesDay: Candle[];
  openTrade: OpenTrade | null;
  accessToken: string | null;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastError: string | null;
  consecutiveTickErrors: number; // auto-restart after 3 consecutive failures
  nextScanAt: number;
  // Timestamp of the last completed tick (unix ms) — used for staleness detection
  lastTickAt: number;
  lastSlHitAt: number | null;
  lastSlDirection: "BUY" | "SELL" | null;
  reEntryCandles: number;
  // P1: Direction-aware cooldown — after SL, track direction to penalize same-direction re-entry
  lastSlExitDirection: "BUY" | "SELL" | null;
  lastSlExitAt: number | null;
  consecutiveSameDirectionSLs: number;
  // P2: Underlying-level cooldown — after 2 SLs on same underlying (any direction), block for 15 min
  consecutiveUnderlyingSLs: number;
  lastUnderlyingSLAt: number | null;
  isPowerHourMode: boolean;
  isMCXEveningMode: boolean;
  isMCXLateSessionMode: boolean;
  heroZeroMode: boolean; // true when Hero Zero panel is active
  // Telegram alert config
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramEnabled: boolean;
  // Multi-bot slot
  botSlot: number;
  // Lot size for quantity rounding (1 for equity, 15 for BankNifty futures, etc.)
  lotSize: number;
  // Track which alert types have already been sent this session (avoid spam)
  alertsSent: Set<string>;
  // Options mode: when set, bot reads candles from underlyingToken but trades optionTradeToken
  // underlyingToken: NSE_INDEX|Nifty Bank, NSE_INDEX|Nifty 50, etc.
  // optionTradeToken: the actual CE/PE instrument key resolved at runtime (e.g. NFO_OPT|BANKNIFTY...)
  // optionType: "CE" | "PE" | "auto" — auto = CE for BUY signal, PE for SELL signal
  isIndexOptions: boolean; // true = auto-resolve ATM CE/PE at trade time
  underlyingToken?: string;
  optionType?: "CE" | "PE" | "auto";
  optionTradeToken?: string; // resolved at runtime from option chain
  optionPremiumPrice?: number; // last fetched option premium (for quantity sizing)
  isOpeningTrade?: boolean; // mutex: prevents duplicate trade opens from concurrent ticks
  tickInProgress?: boolean; // lock: prevents overlapping ticks from running concurrently
  // Layer selection: user can enable/disable specific strategy layers
  enabledLayers?: string[];
  // HourlyClose: track if first-hour signal already fired today
  // Partial profit booking config (% profit levels)
  partial1Pct: number;  // Book 50% at this % profit (e.g., 30 = +30%)
  partial2Pct: number;  // Book 25% at this % profit (e.g., 60 = +60%)
  hourlyCloseSignalFired?: boolean;
  // Daily reset: track last trading day (IST date string YYYY-MM-DD) to reset counters
  lastTradingDay?: string;
  // Cooldown: prevent rapid-fire entries (minimum 2 minutes between trades)
  lastTradeOpenedAt?: number; // Unix timestamp ms
  // Heartbeat: track tick count for periodic activity logging
  tickCount?: number;
  lastHeartbeatAt?: number; // Unix timestamp ms
  // Daily loss limit: acknowledged on first tick so bot doesn't pause from PREVIOUS losses
  dailyLossAcknowledged?: boolean;
  // Carry-forward: if true, skip auto square-off at market close and keep trade open overnight
  carryForward?: boolean;
  // Pending option token resolution promise (awaited before first tick)
  _pendingOptionResolve?: Promise<void>;
  // Averaging settings (configurable from frontend)
  averagingEnabled?: boolean;       // default true
  averagingLossThreshold?: number;  // min loss % to trigger averaging (default 0.20 = 20%)
  // Recent rejected signals (in-memory ring buffer for dashboard display)
  recentRejectedSignals?: Array<{
    direction: "BUY" | "SELL";
    layer: string;
    confidence: number;
    reason: string;
    rejectedAt: number; // unix ms
    rejectReason: string;
  }>;
  // Shadow mode: new logic (P0+P1) logs only, old logic executes trades
  shadowMode?: boolean;
  shadowLog?: ShadowLogEntry[];
  // V2 engine: when true, use generateSignalV2 (regime-based) instead of V1
  useV2Engine?: boolean;
  // Unlimited trades: admin-only, bypasses maxTradesPerDay limit
  unlimitedTrades?: boolean;
  // Opening Burst Strategy (9:15-9:25 AM)
  openingBurstMode?: boolean;
  openingBurstTradeTaken?: boolean; // true after burst trade taken today (reset daily)
  openingBurstEnabled?: boolean; // user toggle (default true for NSE)
}

// Shadow mode log entry
export interface ShadowLogEntry {
  timestamp: number; // unix ms
  signal: string; // e.g. "BUY 83% [ORB]"
  oldDecision: string; // what old logic did: "ENTER" | "HOLD" | "BLOCKED_BY_COOLDOWN"
  newDecision: string; // what new logic would do: "ENTER" | "HOLD" | "BLOCKED_BY_P0" | "BLOCKED_BY_P1"
  difference: string; // "SAME" | description of difference
  price: number;
}

// Shadow mode EOD summary
export interface ShadowSummary {
  date: string;
  totalSignals: number;
  agreements: number;
  disagreements: number;
  newBlockedOldAllowed: number; // new logic would have blocked, old allowed (potential saves)
  newAllowedOldBlocked: number; // new logic would have allowed, old blocked (potential misses)
  entries: ShadowLogEntry[];
}

// ── In-memory store ───────────────────────────────────────────────────────────
const bots = new Map<string, BotState>();

// ── Telegram alert helper ─────────────────────────────────────────────────────
export type AlertCategory = "tradeEntry" | "tradeExit" | "dailySummary" | "criticalAlerts" | "announcements";

export async function sendTelegramAlert(state: BotState, message: string, category?: AlertCategory): Promise<void> {
  if (!state.telegramEnabled || !state.telegramBotToken || !state.telegramChatId) return;
  // Check master switch and user notification preferences
  if (category) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb();
      const { adminSettings, notificationPreferences } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      // Master switch — if OFF, block all alerts
      const [masterRow] = await db.select().from(adminSettings).where(eq(adminSettings.key, "telegram_master_switch")).limit(1);
      if (masterRow && masterRow.value === "off") return;
      // User preference — if category disabled, block
      const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.sessionToken, state.sessionToken)).limit(1);
      if (prefs && prefs[category] === 0) return;
    } catch {
      // Fail-open: if DB check fails, still send the alert
    }
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${state.telegramBotToken}/sendMessage`,
      { chat_id: state.telegramChatId, text: message, parse_mode: "HTML" },
      { timeout: 8000 },
    );
  } catch {
    // Telegram errors are non-critical — don't crash the bot
  }
}

/** Standalone Telegram send (for use outside bot tick loop, e.g. kill switch) */
export async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<void> {
  if (!botToken || !chatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: message, parse_mode: "HTML" },
      { timeout: 8000 },
    );
  } catch {
    // non-critical
  }
}

// ── Rejected signal ring buffer helper ────────────────────────────────────────
function pushRejectedSignal(state: BotState, signal: { direction: "BUY" | "SELL"; layer: string; confidence: number; reason: string }, rejectReason: string): void {
  if (!state.recentRejectedSignals) state.recentRejectedSignals = [];
  state.recentRejectedSignals.push({
    direction: signal.direction,
    layer: signal.layer,
    confidence: signal.confidence,
    reason: signal.reason,
    rejectedAt: Date.now(),
    rejectReason,
  });
  // Keep only last 10
  if (state.recentRejectedSignals.length > 10) {
    state.recentRejectedSignals = state.recentRejectedSignals.slice(-10);
  }
}

// ── Indicator helpers ─────────────────────────────────────────────────────────
function ema(values: number[], period: number): number[] {
  if (values.length < period) return [values[values.length - 1] ?? 0];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return (candles[candles.length - 1]?.close ?? 0) * 0.005;
  const trs = candles.slice(-(period + 1)).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calcVWAP(candles: Candle[]): number {
  let cumPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? candles[candles.length - 1]?.close ?? 0 : cumPV / cumVol;
}

/**
 * Supertrend Indicator — used by all major Indian production algo bots
 * ATR period=10, multiplier=3.0 (standard for Indian intraday)
 * Returns: direction ("BUY"=uptrend, "SELL"=downtrend) and the band value
 */
function calcSupertrend(
  candles: Candle[],
  atrPeriod = 10,
  multiplier = 3.0,
): { direction: "BUY" | "SELL"; band: number; flipped: boolean } {
  if (candles.length < atrPeriod + 2) {
    return { direction: "BUY", band: 0, flipped: false };
  }
  // Compute ATR for each candle
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atrs.push(tr);
  }
  // Smooth ATR using Wilder's method
  const smoothedAtrs: number[] = [atrs.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod];
  for (let i = atrPeriod; i < atrs.length; i++) {
    smoothedAtrs.push((smoothedAtrs[smoothedAtrs.length - 1] * (atrPeriod - 1) + atrs[i]) / atrPeriod);
  }
  // Compute basic upper/lower bands
  let prevUpperBand = 0, prevLowerBand = 0;
  let direction: "BUY" | "SELL" = "BUY";
  let prevDir: "BUY" | "SELL" = "BUY";
  let band = 0;
  let penultimateDir: "BUY" | "SELL" = "BUY"; // direction at second-to-last iteration
  const startIdx = candles.length - smoothedAtrs.length;
  for (let i = 0; i < smoothedAtrs.length; i++) {
    const c = candles[startIdx + i];
    const hl2 = (c.high + c.low) / 2;
    const atr = smoothedAtrs[i];
    let upperBand = hl2 + multiplier * atr;
    let lowerBand = hl2 - multiplier * atr;
    // Adjust bands to prevent widening
    if (prevUpperBand > 0) upperBand = (upperBand < prevUpperBand || candles[startIdx + i - 1]?.close > prevUpperBand) ? upperBand : prevUpperBand;
    if (prevLowerBand > 0) lowerBand = (lowerBand > prevLowerBand || candles[startIdx + i - 1]?.close < prevLowerBand) ? lowerBand : prevLowerBand;
    // Direction
    if (prevDir === "BUY") {
      direction = c.close < lowerBand ? "SELL" : "BUY";
    } else {
      direction = c.close > upperBand ? "BUY" : "SELL";
    }
    band = direction === "BUY" ? lowerBand : upperBand;
    prevUpperBand = upperBand;
    prevLowerBand = lowerBand;
    penultimateDir = prevDir; // save BEFORE updating prevDir
    prevDir = direction;
  }
  // Detect flip: compare final direction vs the one before it
  const flipped = direction !== penultimateDir;
  return { direction, band, flipped };
}

/**
 * Convert raw candles to Heiken Ashi candles.
 * Heiken Ashi smooths price noise — reduces false signals on 1m/3m charts.
 * Used by quantitative-trading-bot for BankNifty with Supertrend.
 */
function toHeikenAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const ha: Candle[] = [];
  let prevHaOpen = (candles[0].open + candles[0].close) / 2;
  let prevHaClose = (candles[0].open + candles[0].high + candles[0].low + candles[0].close) / 4;
  ha.push({ ...candles[0], open: prevHaOpen, close: prevHaClose });
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow  = Math.min(c.low,  haOpen, haClose);
    ha.push({ ...c, open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return ha;
}

/**
 * VWAP Pullback Detection — explicit pullback-to-VWAP pattern
 * Price was away from VWAP (>0.2%), now returning toward it and forming a reversal candle.
 * This is the highest win-rate setup for Indian intraday scalping.
 */
function detectVWAPPullback(
  candles: Candle[],
  vwap: number,
): { detected: boolean; direction: "BUY" | "SELL" | "HOLD"; strength: number } {
  if (candles.length < 5) return { detected: false, direction: "HOLD", strength: 0 };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const price = last.close;
  const prevPrice = prev.close;
  // Trend: price was above VWAP (bullish) or below VWAP (bearish)
  const isBullishTrend = candles.slice(-5, -1).every(c => c.close > vwap);
  const isBearishTrend = candles.slice(-5, -1).every(c => c.close < vwap);
  // Pullback: price approached VWAP (within 0.15%)
  const nearVWAP = Math.abs(price - vwap) / vwap < 0.0015;
  // Reversal candle: bullish candle (close > open) after pullback in uptrend
  const bullishCandle = last.close > last.open && Math.abs(last.close - last.open) > (last.high - last.low) * 0.4;
  const bearishCandle = last.close < last.open && Math.abs(last.close - last.open) > (last.high - last.low) * 0.4;
  if (isBullishTrend && nearVWAP && bullishCandle) {
    const strength = Math.min(1, 0.6 + Math.abs(price - vwap) / vwap * 100);
    return { detected: true, direction: "BUY", strength };
  }
  if (isBearishTrend && nearVWAP && bearishCandle) {
    const strength = Math.min(1, 0.6 + Math.abs(price - vwap) / vwap * 100);
    return { detected: true, direction: "SELL", strength };
  }
  return { detected: false, direction: "HOLD", strength: 0 };
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcADX(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 0;
  const slice = candles.slice(-(period * 2));
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i < slice.length; i++) {
    const curr = slice[i], prev = slice[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    tr += Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
  }
  if (tr === 0) return 0;
  const di_plus = (plusDM / tr) * 100;
  const di_minus = (minusDM / tr) * 100;
  return di_plus + di_minus === 0 ? 0 : (Math.abs(di_plus - di_minus) / (di_plus + di_minus)) * 100;
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const offset = ema12.length - ema26.length;
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
  const signalLine = ema(macdLine, 9);
  const macdVal = macdLine[macdLine.length - 1];
  const sigVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: sigVal, histogram: macdVal - sigVal };
}

function calcBollingerBands(closes: number[], period = 20, stdDevMult = 2): {
  upper: number; middle: number; lower: number; width: number; squeeze: boolean;
} {
  if (closes.length < period) {
    const p = closes[closes.length - 1] ?? 0;
    return { upper: p, middle: p, lower: p, width: 0, squeeze: false };
  }
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMult * stdDev;
  const lower = mean - stdDevMult * stdDev;
  const width = (upper - lower) / mean;
  // Squeeze: width is in bottom 25% of recent 30-candle range
  const recentWidths = closes.length >= 50
    ? Array.from({ length: 30 }, (_, i) => {
        const s = closes.slice(-(50 - i), closes.length - i);
        if (s.length < period) return width;
        const m = s.slice(-period).reduce((a, b) => a + b, 0) / period;
        const v = s.slice(-period).reduce((a, b) => a + Math.pow(b - m, 2), 0) / period;
        const sd = Math.sqrt(v);
        return (m + 2 * sd - (m - 2 * sd)) / m;
      })
    : [width];
  const minWidth = Math.min(...recentWidths);
  const maxWidth = Math.max(...recentWidths);
  const squeeze = width <= minWidth + (maxWidth - minWidth) * 0.25;
  return { upper, middle: mean, lower, width, squeeze };
}

function calcPivotPoints(prevHigh: number, prevLow: number, prevClose: number) {
  const pp = (prevHigh + prevLow + prevClose) / 3;
  return {
    pp,
    r1: 2 * pp - prevLow,
    r2: pp + (prevHigh - prevLow),
    r3: prevHigh + 2 * (pp - prevLow),
    s1: 2 * pp - prevHigh,
    s2: pp - (prevHigh - prevLow),
    s3: prevLow - 2 * (prevHigh - pp),
  };
}

function isNearSupportResistance(price: number, levels: number[], thresholdPct = 0.001): boolean {
  return levels.some(level => level > 0 && Math.abs(price - level) / level < thresholdPct);
}

function get5mTrend(candles5m: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles5m.length < 5) return "neutral";
  const closes = candles5m.map(c => c.close);
  const e9 = ema(closes, Math.min(9, closes.length));
  const e21 = ema(closes, Math.min(21, closes.length));
  const lastE9 = e9[e9.length - 1];
  const lastE21 = e21[e21.length - 1];
  const price = closes[closes.length - 1];
  const vwap5m = calcVWAP(candles5m);
  if (lastE9 > lastE21 && price > vwap5m) return "bullish";
  if (lastE9 < lastE21 && price < vwap5m) return "bearish";
  return "neutral";
}

// ── Institutional Strategy Helpers ──────────────────────────────────────────

/**
 * Strategy 1: Opening Range Breakout (ORB)
 * Source: SSRN #5198458 — Optimizing Intraday Breakout Strategies on the NSE
 * The first 15 minutes of trading establish the day's range. A close outside
 * that range with volume surge (1.5×) is a high-conviction directional trade.
 * Best for: 9:30–11:30 AM NSE, 9:15–10:00 AM MCX
 */
export function calcORBSignal(
  candles: Candle[],
  orbMinutes = 15,
  volThreshold = 1.5,
): { direction: "BUY" | "SELL" | "HOLD"; orbHigh: number; orbLow: number; breakoutPct: number; breakoutCandleIndex: number } {
  if (candles.length < orbMinutes + 2) return { direction: "HOLD", orbHigh: 0, orbLow: 0, breakoutPct: 0, breakoutCandleIndex: -1 };
  const orbCandles = candles.slice(0, orbMinutes);
  const orbHigh = Math.max(...orbCandles.map(c => c.high));
  const orbLow  = Math.min(...orbCandles.map(c => c.low));
  const price   = candles[candles.length - 1].close;
  const avgVol  = orbCandles.reduce((a, c) => a + c.volume, 0) / orbCandles.length;
  const lastVol = candles[candles.length - 1].volume;
  // Index instruments have volume=0 — bypass volume check
  const isIndex = avgVol === 0 && lastVol === 0;
  const volRatio = isIndex ? volThreshold : (avgVol > 0 ? lastVol / avgVol : 1);

  // Find the MOST RECENT breakout candle — last time price crossed FROM below to above (BUY)
  // or FROM above to below (SELL). This captures re-tests, not just the first cross.
  let breakoutCandleIndex = -1;
  if (price > orbHigh && volRatio >= volThreshold) {
    // Find the LAST candle that was below/at orbHigh — the next candle is the breakout
    for (let i = candles.length - 2; i >= orbMinutes; i--) {
      if (candles[i].close <= orbHigh) { breakoutCandleIndex = i + 1; break; }
    }
    if (breakoutCandleIndex === -1) breakoutCandleIndex = orbMinutes; // never dipped back
    return { direction: "BUY",  orbHigh, orbLow, breakoutPct: (price - orbHigh) / orbHigh, breakoutCandleIndex };
  }
  if (price < orbLow && volRatio >= volThreshold) {
    // Find the LAST candle that was above/at orbLow — the next candle is the breakout
    for (let i = candles.length - 2; i >= orbMinutes; i--) {
      if (candles[i].close >= orbLow) { breakoutCandleIndex = i + 1; break; }
    }
    if (breakoutCandleIndex === -1) breakoutCandleIndex = orbMinutes; // never recovered
    return { direction: "SELL", orbHigh, orbLow, breakoutPct: (orbLow - price) / orbLow, breakoutCandleIndex };
  }
  return { direction: "HOLD", orbHigh, orbLow, breakoutPct: 0, breakoutCandleIndex: -1 };
}

/**
 * Strategy 2: VWAP Deviation Bands (Institutional Mean Reversion)
 * Source: SSRN #4631351 — VWAP: The Holy Grail for Day Trading Systems
 * Price stretched >1.5 standard deviations from VWAP tends to revert.
 * Institutions use VWAP as their benchmark — they buy below and sell above.
 * Best for: 10:30 AM–2:30 PM (trending days excluded via ADX filter)
 */
export function calcVWAPDeviation(
  candles: Candle[],
): { deviation: number; stdDev: number; zScore: number; signal: "BUY" | "SELL" | "HOLD" } {
  if (candles.length < 20) return { deviation: 0, stdDev: 0, zScore: 0, signal: "HOLD" };
  const vwap = calcVWAP(candles);
  const price = candles[candles.length - 1].close;
  // Compute rolling std dev of (close - vwap) over last 20 candles
  const diffs = candles.slice(-20).map(c => c.close - vwap);
  const mean  = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / diffs.length;
  const stdDev = Math.sqrt(variance) || 1;
  const deviation = price - vwap;
  const zScore = deviation / stdDev;
  // Mean reversion: fade extreme deviations (|z| > 1.5) — price will snap back
  if (zScore < -1.5) return { deviation, stdDev, zScore, signal: "BUY" };  // too far below VWAP
  if (zScore >  1.5) return { deviation, stdDev, zScore, signal: "SELL" }; // too far above VWAP
  return { deviation, stdDev, zScore, signal: "HOLD" };
}

/**
 * Strategy 3: Market Regime Classifier
 * Source: SSRN #6769178 — Regime-Adaptive Trading Framework for Indian Equities
 * Classifies market into 5 regimes and routes to the best strategy.
 * Regime detection uses ADX (trend strength), BB width (volatility), and
 * RSI (momentum direction) — all available from 1-min candles.
 */
export type MarketRegime = "strong_trend" | "weak_trend" | "ranging" | "high_vol" | "low_vol";
export function classifyMarketRegime(candles: Candle[]): { regime: MarketRegime; label: string } {
  if (candles.length < 30) return { regime: "ranging", label: "Insufficient data" };
  const closes = candles.map(c => c.close);
  const adx = calcADX(candles, 14);
  const bb  = calcBollingerBands(closes, 20, 2);
  const rsi = calcRSI(closes, 14);
  // High volatility: BB width > 3% of price (explosive moves)
  if (bb.width > 0.03) return { regime: "high_vol",    label: "High Volatility — widen SL, reduce size" };
  // Strong trend: ADX > 30, RSI not extreme
  if (adx > 30 && rsi > 40 && rsi < 70) return { regime: "strong_trend", label: "Strong Trend — ride momentum, no mean reversion" };
  // Weak trend: ADX 20–30
  if (adx >= 20 && adx <= 30) return { regime: "weak_trend",   label: "Weak Trend — use breakout + momentum" };
  // Low volatility: BB width < 0.8% (squeeze forming)
  if (bb.width < 0.008) return { regime: "low_vol",     label: "Low Volatility / Squeeze — wait for BB expansion" };
  // Default: ranging
  return { regime: "ranging", label: "Ranging — use VWAP mean reversion" };
}

/**
 * Strategy 4: Volume-Weighted Momentum (Institutional Footprint)
 * Source: QuantInsti — Momentum Trading Strategies; FII/DII volume analysis
 * Large institutional players leave a volume footprint when they enter.
 * A candle with volume > 2× average AND strong body (>70% of range) AND
 * aligned with VWAP direction = institutional directional bet.
 * Best for: any time, especially 10:00–11:30 AM and 2:00–3:00 PM
 */
export function calcInstitutionalFootprint(
  candles: Candle[],
): { detected: boolean; direction: "BUY" | "SELL" | "HOLD"; strength: number; reason: string } {
  if (candles.length < 10) return { detected: false, direction: "HOLD", strength: 0, reason: "Insufficient data" };
  const last = candles[candles.length - 1];
  const avgVol = candles.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const isIndex = avgVol === 0 && last.volume === 0;
  const volRatio = isIndex ? 2.5 : (avgVol > 0 ? last.volume / avgVol : 1);
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const bodyRatio = range > 0 ? body / range : 0;
  const vwap = calcVWAP(candles);
  const isBullish = last.close > last.open;
  const isBearish = last.close < last.open;
  // Institutional candle: volume > 2×, body > 70% of range
  // For index instruments (volume=0), rely on body strength alone (bodyRatio >= 0.80)
  if ((isIndex ? bodyRatio >= 0.80 : (volRatio >= 2.0 && bodyRatio >= 0.70))) {
    if (isBullish && last.close > vwap) {
      return { detected: true, direction: "BUY",  strength: Math.min(1, volRatio / 4), reason: `Inst footprint BUY | vol ${volRatio.toFixed(1)}x | body ${(bodyRatio * 100).toFixed(0)}%` };
    }
    if (isBearish && last.close < vwap) {
      return { detected: true, direction: "SELL", strength: Math.min(1, volRatio / 4), reason: `Inst footprint SELL | vol ${volRatio.toFixed(1)}x | body ${(bodyRatio * 100).toFixed(0)}%` };
    }
  }
  return { detected: false, direction: "HOLD", strength: 0, reason: "No institutional footprint" };
}

/**
 * Strategy 5: Intraday Time-Series Momentum (Last-Half-Hour Effect)
 * Source: CentAUR — Intraday Time Series Momentum: International Evidence
 * The last 30 minutes of NSE trading (3:00–3:30 PM) exhibits strong
 * continuation of the day's direction. If the day is up >0.3%, the last
 * 30 min is statistically more likely to close higher. This is the academic
 * basis for the Power Hour strategy already implemented.
 * This helper provides the day-direction score used by Power Hour.
 */
export function calcDayMomentumScore(
  candles1m: Candle[],
): { score: number; direction: "BUY" | "SELL" | "HOLD"; dayReturnPct: number; label: string } {
  if (candles1m.length < 30) return { score: 0, direction: "HOLD", dayReturnPct: 0, label: "Insufficient data" };
  const open  = candles1m[0].open;
  const price = candles1m[candles1m.length - 1].close;
  const dayReturnPct = (price - open) / open * 100;
  const vwap = calcVWAP(candles1m);
  const adx  = calcADX(candles1m, 14);
  const rsi  = calcRSI(candles1m.map(c => c.close), 14);
  let score = 0;
  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  if (dayReturnPct > 0.3)  { score += 2; direction = "BUY"; }
  if (dayReturnPct < -0.3) { score += 2; direction = "SELL"; }
  if (price > vwap && direction === "BUY")  score += 1;
  if (price < vwap && direction === "SELL") score += 1;
  if (adx > 20) score += 1;
  if (direction === "BUY"  && rsi > 50 && rsi < 75) score += 1;
  if (direction === "SELL" && rsi < 50 && rsi > 25) score += 1;
  const label = direction === "HOLD" ? "No day momentum" :
    `Day ${dayReturnPct > 0 ? "+" : ""}${dayReturnPct.toFixed(2)}% | ADX(${adx.toFixed(0)}) | RSI(${rsi.toFixed(0)}) | score:${score}/5`;
  return { score, direction, dayReturnPct, label };
}

function getTimeOfDayMultiplier(istMin: number): { multiplier: number; label: string; skip: boolean } {
  if (istMin >= 555 && istMin < 565)  return { multiplier: 0,    label: "Opening Volatility",    skip: true  };
  if (istMin >= 565 && istMin < 600)  return { multiplier: 0.90, label: "Settling",               skip: false };
  if (istMin >= 600 && istMin < 690)  return { multiplier: 1.10, label: "Prime Morning",          skip: false };
  if (istMin >= 690 && istMin < 780)  return { multiplier: 0.95, label: "Midday",            skip: false };
  if (istMin >= 780 && istMin < 840)  return { multiplier: 1.00, label: "Afternoon",              skip: false };
  if (istMin >= 840 && istMin < 900)  return { multiplier: 1.10, label: "Institutional Window",   skip: false };
  if (istMin >= 900 && istMin < 930)  return { multiplier: 1.20, label: "Power Hour",             skip: false };
  return { multiplier: 1.0, label: "Normal", skip: false };
}

/**
 * Failed Breakout / Range-Top Rejection Detection (bearish) and mirror (bullish)
 * Classic trend-change setup: price breaks above the recent N-candle high,
 * fails to hold, and closes back below the breakout level within a few candles.
 * This traps breakout buyers and typically leads to a sharp reversal.
 * Critically, this fires even when price is still ABOVE VWAP — catching the
 * turn early on rally-then-fade days where VWAP-gated SELL layers stay silent.
 */
export function detectFailedBreakout(
  candles: Candle[],
  lookback = 30,
): { detected: boolean; direction: "BUY" | "SELL" | "HOLD"; level: number; reason: string } {
  if (candles.length < lookback + 5) return { detected: false, direction: "HOLD", level: 0, reason: "" };
  const recent = candles.slice(-5);            // last 5 candles = breakout + failure window
  const prior  = candles.slice(-(lookback + 5), -5); // range before the breakout attempt
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow  = Math.min(...prior.map(c => c.low));
  const last = recent[recent.length - 1];

  // Bearish failed breakout: some candle in the window poked above priorHigh,
  // but the last candle closed back below priorHigh AND is a red candle.
  const pokedAbove = recent.slice(0, -1).some(c => c.high > priorHigh * 1.0003);
  const failedDown = last.close < priorHigh * 0.9995 && last.close < last.open;
  if (pokedAbove && failedDown) {
    return { detected: true, direction: "SELL", level: priorHigh, reason: `Failed breakout above ${priorHigh.toFixed(1)} — rejection, trapped buyers` };
  }
  // Bullish failed breakdown (mirror): poked below priorLow, closed back above.
  const pokedBelow = recent.slice(0, -1).some(c => c.low < priorLow * 0.9997);
  const failedUp = last.close > priorLow * 1.0005 && last.close > last.open;
  if (pokedBelow && failedUp) {
    return { detected: true, direction: "BUY", level: priorLow, reason: `Failed breakdown below ${priorLow.toFixed(1)} — rejection, trapped sellers` };
  }
  return { detected: false, direction: "HOLD", level: 0, reason: "" };
}

/**
 * Uptrend Exhaustion Detection — filters buy-the-dip signals on fading rallies.
 * Returns true when the rally is showing exhaustion:
 *  - The most recent swing high is LOWER than the previous swing high (lower high), OR
 *  - Price has retraced more than 50% of the last visible up-leg, OR
 *  - RSI has fallen more than 15 points from its recent peak (momentum bleed).
 * Used to veto VWAP-pullback / dip-buy entries after a range-top rejection.
 */
export function detectUptrendExhaustion(candles: Candle[]): { exhausted: boolean; reason: string } {
  if (candles.length < 30) return { exhausted: false, reason: "" };
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const n = candles.length;

  // Find swing highs: local maxima with 3 candles on each side
  const swings: { idx: number; high: number }[] = [];
  for (let i = 3; i < n - 3; i++) {
    const h = highs[i];
    if (h >= Math.max(...highs.slice(i - 3, i)) && h >= Math.max(...highs.slice(i + 1, i + 4))) {
      swings.push({ idx: i, high: h });
    }
  }
  if (swings.length >= 2) {
    const lastSwing = swings[swings.length - 1];
    const prevSwing = swings[swings.length - 2];
    // Lower high within the last ~25 candles = rally rolling over
    if (lastSwing.high < prevSwing.high * 0.9995 && n - lastSwing.idx <= 25) {
      return { exhausted: true, reason: `Lower high ${lastSwing.high.toFixed(1)} < ${prevSwing.high.toFixed(1)}` };
    }
  }

  // Retracement depth: from the day-window high, how much of the up-leg is given back?
  const windowHigh = Math.max(...highs.slice(-40));
  const windowLowBeforeHigh = Math.min(...closes.slice(-40, -5));
  const price = closes[n - 1];
  const upLeg = windowHigh - windowLowBeforeHigh;
  if (upLeg > 0) {
    const retraced = (windowHigh - price) / upLeg;
    if (retraced > 0.5) {
      return { exhausted: true, reason: `Retraced ${(retraced * 100).toFixed(0)}% of up-leg from ${windowHigh.toFixed(1)}` };
    }
  }

  // RSI momentum bleed: RSI peak in last 30 candles vs now
  let rsiPeak = 0;
  for (let i = Math.max(15, n - 30); i <= n; i++) {
    const r = calcRSI(closes.slice(0, i), 14);
    if (r > rsiPeak) rsiPeak = r;
  }
  const rsiNow = calcRSI(closes, 14);
  if (rsiPeak >= 60 && rsiPeak - rsiNow > 15) {
    return { exhausted: true, reason: `RSI bled ${rsiPeak.toFixed(0)}→${rsiNow.toFixed(0)}` };
  }

  return { exhausted: false, reason: "" };
}

// ── Main signal generator (5-layer) ──────────────────────────────────────────
export function generateSignal(
  candles: Candle[],
  slMultiplier = 1.5,
  tpMultiplier = 3.0,
  minConf = 0.55, // lowered from 0.65 — was too strict, caused zero trades during midday hours
  candles5m: Candle[] = [],
  prevDayHigh = 0,
  prevDayLow = 0,
  prevDayClose = 0,
  skipOrbFreshnessGate = false, // Shadow mode: skip P0 ORB freshness gate to simulate old logic
): Signal {
  // Defensive: if candles is empty or undefined, return HOLD immediately
  if (!candles || candles.length === 0) {
    return { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "No candle data available", layer: "None" };
  }
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const vwap = calcVWAP(candles);
  const rsi = calcRSI(closes, 14);
  const adx = calcADX(candles, 14);

  const e9arr = ema(closes, 9);
  const e21arr = ema(closes, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];

  const avgVol = candles.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const lastVol = candles[candles.length - 1].volume;
  // NSE/BSE index instruments (Nifty, BankNifty, Sensex) return volume=0 from Upstox.
  // Only bypass volume filters for instruments where ALL candles have 0 volume (index instruments).
  // MCX instruments (CRUDEOIL, GOLD, SILVER) DO have real volume data — use it.
  const allVolZero = candles.slice(-10).every(c => c.volume === 0);
  const volRatio = allVolZero ? 1.5 : (avgVol > 0 ? lastVol / avgVol : 1.0);

  const now = new Date(candles[candles.length - 1].timestamp);
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const inNSESession = istMin >= 555 && istMin <= 930;
  const inMCXSession = istMin >= 540 && istMin <= 1410;
  const inSession = inNSESession || inMCXSession;

  if (!inSession) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: "Market closed", layer: "None" };
  }
  if (candles.length < 20) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `Collecting data (${candles.length}/20 candles)`, layer: "None" };
  }

  // Time-of-day filter
  const tod = getTimeOfDayMultiplier(istMin);
  if (tod.skip) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `Skipping ${tod.label} (9:15–9:25 AM opening volatility)`, layer: "None" };
  }

  // Multi-timeframe confirmation
  const trend5m = get5mTrend(candles5m);

  // Dynamic breakout threshold (ATR-relative)
  const dynamicBreakoutThreshold = Math.max(0.0002, (atr / price) * 0.5);

  // Support/Resistance levels from previous day
  let srLevels: number[] = [];
  if (prevDayHigh > 0 && prevDayLow > 0 && prevDayClose > 0) {
    const pivots = calcPivotPoints(prevDayHigh, prevDayLow, prevDayClose);
    srLevels = [pivots.pp, pivots.r1, pivots.r2, pivots.s1, pivots.s2];
  }
  // Tightened S/R proximity filter: 0.05% (was 0.1%) — 0.1% was too wide for BankNifty
  // e.g. BankNifty at 53000: 0.1% = ±53 pts (too many rejections), 0.05% = ±26 pts
  const nearSR = srLevels.length > 0 && isNearSupportResistance(price, srLevels, 0.0002);

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";
  let layer: Signal["layer"] = "None";

  // ── Layer 1: Breakout (dynamic threshold) ────────────────────────────────
  const lookback = candles.slice(-20);
  const highestHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
  const lowestLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
  const lastCandle = candles[candles.length - 1];
  const breakoutUpPct = (lastCandle.close - highestHigh) / highestHigh;
  const breakoutDnPct = (lowestLow - lastCandle.close) / lowestLow;

  // ── FIX #1: Soft bias instead of hard gate ──────────────────────────────────
  // BEFORE: allow5mBuy/Sell was a boolean that BLOCKED signals entirely when 5m trend disagreed.
  // AFTER: All signals are ALLOWED through, but counter-trend signals receive a confidence penalty.
  // This ensures strong counter-trend signals (e.g., gap-up fade) can still fire with reduced confidence.
  const against5mPenalty = 0.15; // 15% confidence reduction for counter-trend trades
  const allow5mBuy  = true; // Never hard-block — penalty applied post-generation
  const allow5mSell = true; // Never hard-block — penalty applied post-generation
  const strict5mBuy  = true; // Never hard-block — penalty applied post-generation
  const strict5mSell = true; // Never hard-block — penalty applied post-generation
  // Calculate per-direction penalty based on 5m trend disagreement
  const buyPenalty  = (candles5m.length >= 5 && trend5m === "bearish") ? against5mPenalty : 0;
  const sellPenalty = (candles5m.length >= 5 && trend5m === "bullish") ? against5mPenalty : 0;

  if (breakoutUpPct > dynamicBreakoutThreshold && volRatio >= 1.0 && rsi > 45 && rsi < 80 && strict5mBuy) {
    direction = "BUY";
    confidence = Math.min(0.95, 0.65 + breakoutUpPct * 200 + (volRatio - 1.0) * 0.1);
    reason = `[Breakout] Above ${highestHigh.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)}) | 5m:${trend5m} | thr:${(dynamicBreakoutThreshold * 100).toFixed(3)}%`;
    layer = "Breakout";
  } else if (breakoutDnPct > dynamicBreakoutThreshold && volRatio >= 1.0 && rsi < 55 && rsi > 20 && strict5mSell) {
    direction = "SELL";
    confidence = Math.min(0.95, 0.65 + breakoutDnPct * 200 + (volRatio - 1.0) * 0.1);
    reason = `[Breakout] Below ${lowestLow.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)}) | 5m:${trend5m} | thr:${(dynamicBreakoutThreshold * 100).toFixed(3)}%`;
    layer = "Breakout";
  }

  // ── Layer 2: Candlestick Pattern ──────────────────────────────────────────
  if (direction === "HOLD" && candles.length >= 3) {
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    const body2 = Math.abs(c2.close - c2.open);
    const body1 = Math.abs(c1.close - c1.open);
    const range2 = c2.high - c2.low;

    if (c1.close < c1.open && c2.close > c2.open && c2.close > c1.open && c2.open < c1.close && volRatio >= 1.0 && price > vwap && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.68 + (body2 / (body1 || 1) - 1) * 0.1);
      reason = `[Pattern] Bullish Engulfing | Vol ${volRatio.toFixed(1)}x | Above VWAP | 5m:${trend5m}`;
      layer = "Pattern";
    } else if (c1.close > c1.open && c2.close < c2.open && c2.close < c1.open && c2.open > c1.close && volRatio >= 1.0 && price < vwap && allow5mSell) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.68 + (body2 / (body1 || 1) - 1) * 0.1);
      reason = `[Pattern] Bearish Engulfing | Vol ${volRatio.toFixed(1)}x | Below VWAP | 5m:${trend5m}`;
      layer = "Pattern";
    } else if (c2.close > c2.open && (c2.open - c2.low) > body2 * 2 && (c2.high - c2.close) < body2 * 0.5 && rsi < 45 && allow5mBuy) {
      direction = "BUY"; confidence = 0.70;
      reason = `[Pattern] Hammer | RSI(${rsi.toFixed(0)}) oversold | Vol ${volRatio.toFixed(1)}x`;
      layer = "Pattern";
    } else if (c2.close < c2.open && (c2.high - c2.open) > body2 * 2 && (c2.close - c2.low) < body2 * 0.5 && rsi > 55 && allow5mSell) {
      direction = "SELL"; confidence = 0.70;
      reason = `[Pattern] Shooting Star | RSI(${rsi.toFixed(0)}) overbought | Vol ${volRatio.toFixed(1)}x`;
      layer = "Pattern";
    } else if (body2 > range2 * 0.85 && volRatio >= 1.5) {
      if (c2.close > c2.open && price > vwap && allow5mBuy) {
        direction = "BUY";
        confidence = Math.min(0.85, 0.65 + volRatio * 0.05);
        reason = `[Pattern] Bull Marubozu | Vol ${volRatio.toFixed(1)}x | Above VWAP`;
        layer = "Pattern";
      } else if (c2.close < c2.open && price < vwap && allow5mSell) {
        direction = "SELL";
        confidence = Math.min(0.85, 0.65 + volRatio * 0.05);
        reason = `[Pattern] Bear Marubozu | Vol ${volRatio.toFixed(1)}x | Below VWAP`;
        layer = "Pattern";
      }
    }
  }

  // ── Layer 3: EMA/VWAP Trend ───────────────────────────────────────────────
  // ADX threshold raised to 20 — research shows ADX > 20 needed for reliable trends
  // (Omega-Xi production bot uses ADX > 20; below 20 = ranging/choppy market)
  // RSI tightened: BUY only when RSI > 55 (confirmed uptrend) or RSI < 40 (oversold bounce)
  // No entries in RSI 40-55 no-man's land (choppy, no conviction)
  // Pullback requirement: price must be within 0.15% of EMA9 or VWAP (don't chase)
  if (direction === "HOLD" && candles.length >= 21 && adx > 20) {
    const emaDiffPct = Math.abs(e9 - e21) / e21;
    const distFromEma9 = Math.abs(price - e9) / e9;
    const distFromVwap = Math.abs(price - vwap) / vwap;
    const nearPullback = distFromEma9 < 0.0015 || distFromVwap < 0.0015; // within 0.15% of EMA9 or VWAP
    if (e9 > e21 && price > vwap && (rsi > 55 || rsi < 40) && allow5mBuy && nearPullback) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 20) * 0.005);
      reason = `[Trend] EMA9>${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | pullback | 5m:${trend5m}`;
      layer = "Trend";
    } else if (e9 < e21 && price < vwap && (rsi < 45 || rsi > 60) && allow5mSell && nearPullback) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 20) * 0.005);
      reason = `[Trend] EMA9<${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | pullback | 5m:${trend5m}`;
      layer = "Trend";
    }
  }

  // ── Layer 4: Momentum ─────────────────────────────────────────────────────
  // Momentum threshold raised from 0.03% to 0.1% — 0.03% is noise, not real momentum
  // Pullback requirement: price must be within 0.15% of EMA9 or VWAP (don't chase)
  if (direction === "HOLD" && candles.length >= 5) {
    const roc3 = closes.length >= 4 ? (price - closes[closes.length - 4]) / closes[closes.length - 4] : 0;
    const distFromEma9_m = Math.abs(price - e9) / e9;
    const distFromVwap_m = Math.abs(price - vwap) / vwap;
    const nearPullback_m = distFromEma9_m < 0.0015 || distFromVwap_m < 0.0015;
    if (rsi > 55 && roc3 > 0.001 && price > vwap && allow5mBuy && nearPullback_m) {
      direction = "BUY";
      confidence = Math.min(0.82, 0.60 + roc3 * 100 + (rsi - 55) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | +${(roc3 * 100).toFixed(2)}% in 3c | Above VWAP | pullback | 5m:${trend5m}`;
      layer = "Momentum";
    } else if (rsi < 45 && roc3 < -0.001 && price < vwap && allow5mSell && nearPullback_m) {
      direction = "SELL";
      confidence = Math.min(0.82, 0.60 + Math.abs(roc3) * 100 + (45 - rsi) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | ${(roc3 * 100).toFixed(2)}% in 3c | Below VWAP | pullback | 5m:${trend5m}`;
      layer = "Momentum";
    }
  }

  // ── Layer 5: MACD + Bollinger Band Squeeze ────────────────────────────────
  if (direction === "HOLD" && candles.length >= 30) {
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20, 2);
    if (bb.squeeze) {
      if (macd.histogram > 0 && macd.macd > macd.signal && price > bb.middle && price > vwap && allow5mBuy) {
        direction = "BUY";
        confidence = Math.min(0.90, 0.70 + Math.abs(macd.histogram) / price * 1000);
        reason = `[MACD+BB] Squeeze breakout UP | hist:${macd.histogram.toFixed(2)} | BBw:${(bb.width * 100).toFixed(2)}% | 5m:${trend5m}`;
        layer = "MACD_BB";
      } else if (macd.histogram < 0 && macd.macd < macd.signal && price < bb.middle && price < vwap && allow5mSell) {
        direction = "SELL";
        confidence = Math.min(0.90, 0.70 + Math.abs(macd.histogram) / price * 1000);
        reason = `[MACD+BB] Squeeze breakout DOWN | hist:${macd.histogram.toFixed(2)} | BBw:${(bb.width * 100).toFixed(2)}% | 5m:${trend5m}`;
        layer = "MACD_BB";
      }
    }
  }

  // ── Layer 6: Opening Range Breakout (ORB) ─────────────────────────────────
  // Valid from 9:30 AM to 2:00 PM only (no new ORB entries after 2 PM — backtested result)
  // Volume threshold raised from 1.5x to 2.0x — research shows 2x+ needed for reliable breakouts
  // Added minimum range width filter: 0.2% of price (filters weak ORB days)
  if (direction === "HOLD" && istMin >= 570 && istMin <= 840 && candles.length >= 17) {
    const orbMinRangeWidth = price * 0.002; // 0.2% minimum range width
    const orb = calcORBSignal(candles, 15, 2.0);
    const orbRangeWidth = orb.orbHigh - orb.orbLow;
   if (orb.direction !== "HOLD" && orbRangeWidth >= orbMinRangeWidth) {
      // ── ORB Freshness Gate ──────────────────────────────────────────────────
      // Shadow mode bypass: when skipOrbFreshnessGate=true, skip freshness check (old behavior)
      if (skipOrbFreshnessGate) {
        const regime = classifyMarketRegime(candles);
        if (regime.regime !== "ranging" && regime.regime !== "high_vol") {
          direction = orb.direction;
          confidence = Math.min(0.92, 0.72 + orb.breakoutPct * 500);
          reason = `[ORB] ${orb.direction === "BUY" ? "Above" : "Below"} 15-min range | ${(orb.breakoutPct * 100).toFixed(3)}% | ${regime.label} | 5m:${trend5m} | LEGACY(no freshness gate)`;
          layer = "ORB";
        }
      } else {
      // Rule 1: Only fire within 3 candles of the ACTUAL breakout candle
      // Rule 2: After 3 candles, require price within 0.1% of breakout level
      // Rule 3: If price has already moved 40+ pts from ORB edge, it's CHASING — reject
      const currentCandleIdx = candles.length - 1;
      // The engine needs ~20 candles minimum to generate signals, so breakouts
      // before candle 20 should not count as "stale" — the engine couldn't have acted earlier.
      const MIN_ENGINE_CANDLES = 20;
      const effectiveBreakoutStart = orb.breakoutCandleIndex >= 0
        ? Math.max(orb.breakoutCandleIndex, MIN_ENGINE_CANDLES)
        : -1;
      const candlesSinceBreakout = effectiveBreakoutStart >= 0
        ? currentCandleIdx - effectiveBreakoutStart
        : 999; // no breakout found = stale

      const orbEdge = orb.direction === "BUY" ? orb.orbHigh : orb.orbLow;
      const distFromEdge = Math.abs(price - orbEdge);
      const distPct = distFromEdge / orbEdge; // distance as percentage

      // Determine freshness window: initial breakout gets 10 candles (engine couldn't act earlier),
      // re-tests (price dipped back and crossed again) get strict 3-candle window
      const isInitialBreakout = orb.breakoutCandleIndex <= MIN_ENGINE_CANDLES;
      const freshnessWindow = isInitialBreakout ? 10 : 3;

      let orbFresh = false;
      let orbRejectReason = "";

      if (candlesSinceBreakout <= freshnessWindow) {
        // Within freshness window — fresh, but still reject if chasing
        if (distPct <= 0.0015) {
          orbFresh = true;
        } else {
          orbRejectReason = `chasing(${distFromEdge.toFixed(1)}pts / ${(distPct*100).toFixed(3)}% from ORB edge, even within 3-candle window)`;
        }
      } else {
        // After freshness window — ORB is STALE, do not fire regardless of proximity
        orbRejectReason = `stale(${candlesSinceBreakout} candles since breakout, window=${freshnessWindow})`;
      }

      if (orbFresh) {
        const regime = classifyMarketRegime(candles);
        // ORB works best in trending and weak-trend regimes, not in ranging/high-vol
        if (regime.regime !== "ranging" && regime.regime !== "high_vol") {
          direction = orb.direction;
          confidence = Math.min(0.92, 0.72 + orb.breakoutPct * 500);
          reason = `[ORB] ${orb.direction === "BUY" ? "Above" : "Below"} 15-min range | ${(orb.breakoutPct * 100).toFixed(3)}% | ${regime.label} | 5m:${trend5m} | fresh(${candlesSinceBreakout})`;
          layer = "ORB";
        }
      }
      }
    }
  }

  // ── Layer 7: VWAP Deviation Mean Reversion ───────────────────────────────────
  // Only valid in midday lull (10:30 AM–2:30 PM) when market is ranging (ADX < 25)
  if (direction === "HOLD" && istMin >= 630 && istMin <= 870 && candles.length >= 20) {
    const vwapDev = calcVWAPDeviation(candles);
    const regime = classifyMarketRegime(candles);
    // Mean reversion only works in ranging/low-vol regimes, NOT in strong trends
    if (vwapDev.signal !== "HOLD" && (regime.regime === "ranging" || regime.regime === "low_vol")) {
      const revDir = vwapDev.signal;
      if ((revDir === "BUY" && allow5mBuy) || (revDir === "SELL" && allow5mSell)) {
        direction = revDir;
        confidence = Math.min(0.85, 0.62 + Math.abs(vwapDev.zScore) * 0.08);
        reason = `[VWAPRev] z=${vwapDev.zScore.toFixed(2)} | dev=${vwapDev.deviation.toFixed(1)} | ${regime.label} | 5m:${trend5m}`;
        layer = "VWAPReversion";
      }
    }
  }

  // ── Layer 8: Institutional Footprint ─────────────────────────────────────────
  // Valid all day — detects large institutional candles (vol >2×, body >70%)
  if (direction === "HOLD" && candles.length >= 10) {
    const inst = calcInstitutionalFootprint(candles);
    if (inst.detected && inst.direction !== "HOLD") {
      if ((inst.direction === "BUY" && allow5mBuy) || (inst.direction === "SELL" && allow5mSell)) {
        direction = inst.direction;
        confidence = Math.min(0.93, 0.70 + inst.strength * 0.3);
        reason = `[InstFootprint] ${inst.reason} | 5m:${trend5m}`;
        layer = "InstFootprint";
      }
    }
  }

  // ── Layer 8.5: Failed Breakout / Range Rejection (trend-change detector) ─────
  // Fires when price breaks a recent extreme, fails, and closes back inside the range.
  // Deliberately NOT gated on price-vs-VWAP: on rally-then-fade days VWAP stays below
  // price all afternoon, which previously made SELL signals impossible (all-CE bias).
  if (direction === "HOLD" && candles.length >= 35) {
    const fb = detectFailedBreakout(candles, 30);
    if (fb.detected && fb.direction !== "HOLD") {
      if ((fb.direction === "BUY" && allow5mBuy) || (fb.direction === "SELL" && allow5mSell)) {
        // Confirmation: RSI must have turned in the signal direction (avoid catching one-candle noise)
        const rsiOkFb = fb.direction === "SELL" ? rsi < 60 : rsi > 40;
        if (rsiOkFb) {
          direction = fb.direction;
          confidence = 0.74;
          reason = `[FailedBreakout] ${fb.reason} | RSI(${rsi.toFixed(0)}) | 5m:${trend5m}`;
          layer = "FailedBreakout";
        }
      }
    }
  }

  // ── Layer 9: VWAP Pullback (Highest win-rate Indian scalping setup) ──────────
  // Source: tradejini.com — VWAP Pullback Scalping Strategy
  // Price was trending above/below VWAP, pulls back to VWAP, forms reversal candle
  // This is the #1 setup used by professional Indian options scalpers
  // EXHAUSTION VETO: skip BUY pullbacks when the rally shows exhaustion (lower highs,
  // deep retracement, or RSI bleed) — prevents buying every dip of a failing rally.
  if (direction === "HOLD" && candles.length >= 10) {
    const pullback = detectVWAPPullback(candles, vwap);
    if (pullback.detected && pullback.direction !== "HOLD") {
      if ((pullback.direction === "BUY" && allow5mBuy) || (pullback.direction === "SELL" && allow5mSell)) {
        const exhaustion = pullback.direction === "BUY" ? detectUptrendExhaustion(candles) : { exhausted: false, reason: "" };
        if (exhaustion.exhausted) {
          // Rally is rolling over — do not buy this dip; log via reason passthrough
          reason = `[VWAPPullback] BUY vetoed — uptrend exhaustion: ${exhaustion.reason}`;
        } else {
          direction = pullback.direction;
          confidence = Math.min(0.91, 0.68 + pullback.strength * 0.15);
          reason = `[VWAPPullback] Price returned to VWAP | ${pullback.direction} reversal candle | 5m:${trend5m}`;
          layer = "VWAPPullback";
        }
      }
    }
  }

  // ── Layer 10: Supertrend on Heiken Ashi (production bot standard) ────────────
  // Source: henilcalagiya/quantitative-trading-bot — BankNifty live trading
  // Supertrend(10, 3.0) on Heiken Ashi candles — smooths noise, reduces false signals
  // Only fires when Supertrend just flipped direction (fresh signal, not stale)
  if (direction === "HOLD" && candles.length >= 15) {
    const haCandles = toHeikenAshi(candles);
    const st = calcSupertrend(haCandles, 10, 3.0);
    if (st.flipped && st.direction !== ("HOLD" as any)) {
      const stDir = st.direction as "BUY" | "SELL";
      if ((stDir === "BUY" && allow5mBuy) || (stDir === "SELL" && allow5mSell)) {
        // Additional confirmation: RSI must agree with direction
        const rsiOk = stDir === "BUY" ? rsi > 45 && rsi < 80 : rsi < 55 && rsi > 20;
        if (rsiOk) {
          direction = stDir;
          confidence = Math.min(0.92, 0.72 + (stDir === "BUY" ? Math.max(0, rsi - 50) : Math.max(0, 50 - rsi)) * 0.003);
          reason = `[Supertrend] HA-Supertrend(10,3) flipped ${stDir} | band:${st.band.toFixed(1)} | RSI(${rsi.toFixed(0)}) | 5m:${trend5m}`;
          layer = "Trend";
        }
      }
    }
  }

  // ── Layer 11: 1-Hour Candle Close Strategy (HourlyClose) ────────────────────
  // Wait for the first 1-hour candle (9:15–10:15 AM IST) to close.
  // If body > 60% of total range → strong directional signal.
  // Fires ONCE per day. SL at opposite end of the hourly candle.
  if (direction === "HOLD" && candles.length >= 60 && istMin >= 615 && istMin <= 625) {
    // Aggregate first ~60 one-minute candles to form the 1-hour candle (9:15–10:15)
    const firstHourCandles = candles.slice(0, Math.min(60, candles.length));
    const hourOpen = firstHourCandles[0].open;
    const hourClose = firstHourCandles[firstHourCandles.length - 1].close;
    const hourHigh = Math.max(...firstHourCandles.map(c => c.high));
    const hourLow = Math.min(...firstHourCandles.map(c => c.low));
    const hourRange = hourHigh - hourLow;
    const hourBody = Math.abs(hourClose - hourOpen);
    const bodyRatio = hourRange > 0 ? hourBody / hourRange : 0;

    if (bodyRatio > 0.60 && hourRange > atr * 0.5) {
      const isBullish = hourClose > hourOpen;
      const hourDir: "BUY" | "SELL" = isBullish ? "BUY" : "SELL";
      if ((hourDir === "BUY" && allow5mBuy) || (hourDir === "SELL" && allow5mSell)) {
        direction = hourDir;
        confidence = Math.min(0.93, 0.70 + bodyRatio * 0.2 + (adx > 25 ? 0.05 : 0));
        reason = `[HourlyClose] 1H candle body ${(bodyRatio * 100).toFixed(0)}% of range | O:${hourOpen.toFixed(0)} C:${hourClose.toFixed(0)} H:${hourHigh.toFixed(0)} L:${hourLow.toFixed(0)} | ADX(${adx.toFixed(0)}) | 5m:${trend5m}`;
        layer = "HourlyClose";
      }
    }
  }

  // ── Layer 12: Booming Bulls Strategy (ADX + Supertrend + Pivot Breakout) ────
  // Source: Anish Singh Thakur / Booming Bulls
  // Triple confirmation: ADX > 20 (trending) + Supertrend direction + Pivot level breakout
  // This is the most popular retail intraday strategy in India.
  if (direction === "HOLD" && candles.length >= 15 && srLevels.length > 0) {
    const haCandles = toHeikenAshi(candles);
    const st = calcSupertrend(haCandles, 10, 3.0);
    const stDir = st.direction as "BUY" | "SELL";

    // ADX must be above 20 (trending market)
    if (adx > 20) {
      // Check if price just broke through a pivot level in the Supertrend direction
      const prevCandle = candles[candles.length - 2];
      const currCandle = candles[candles.length - 1];

      let pivotBroken = false;
      let brokenLevel = 0;
      let nextTarget = 0;

      if (stDir === "BUY") {
        // For BUY: price must cross ABOVE a resistance level (R1, R2, R3 or PP)
        for (const level of srLevels) {
          if (prevCandle.close <= level && currCandle.close > level && currCandle.close > level * 1.0001) {
            pivotBroken = true;
            brokenLevel = level;
            // Target: next resistance level above
            const higherLevels = srLevels.filter(l => l > level).sort((a, b) => a - b);
            nextTarget = higherLevels.length > 0 ? higherLevels[0] : level + atr * 2;
            break;
          }
        }
      } else {
        // For SELL: price must cross BELOW a support level (S1, S2, S3 or PP)
        for (const level of srLevels) {
          if (prevCandle.close >= level && currCandle.close < level && currCandle.close < level * 0.9999) {
            pivotBroken = true;
            brokenLevel = level;
            // Target: next support level below
            const lowerLevels = srLevels.filter(l => l < level).sort((a, b) => b - a);
            nextTarget = lowerLevels.length > 0 ? lowerLevels[0] : level - atr * 2;
            break;
          }
        }
      }

      if (pivotBroken) {
        // Additional VWAP confirmation (enhanced version)
        const vwapOk = stDir === "BUY" ? price > vwap : price < vwap;
        if (vwapOk) {
          if ((stDir === "BUY" && allow5mBuy) || (stDir === "SELL" && allow5mSell)) {
            direction = stDir;
            confidence = Math.min(0.94, 0.72 + (adx - 20) * 0.005 + (vwapOk ? 0.05 : 0));
            reason = `[BoomingBulls] ADX(${adx.toFixed(0)}) + Supertrend(${stDir}) + Pivot break ₹${brokenLevel.toFixed(0)} | VWAP ₹${vwap.toFixed(0)} | Target ₹${nextTarget.toFixed(0)} | 5m:${trend5m}`;
            layer = "BoomingBulls";
          }
        }
      }
    }
  }

  // S/R proximity filter — reject entries near major levels
  if (direction !== "HOLD" && nearSR) {
    return {
      direction: "HOLD", confidence: 0, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: `Near S/R level — entry rejected (within 0.02% of pivot/support/resistance)`,
      layer: "None",
    };
  }

  // ── 2-Candle Confirmation Filter ─────────────────────────────────────────────
  // Require at least 2 consecutive candles in the signal direction before entry.
  // This prevents entering on a single spike candle (falling knife / dead cat bounce).
  // Only applies to Trend, Momentum, MACD_BB layers (not Breakout/Pattern which have their own confirmation).
  // EXCEPTION: When ADX > 30 (strong trend), the trend itself is confirmation — skip this filter.
  // This was causing BankNifty to miss strong trend entries because 1-min candles often have
  // micro-bounces even in a strong directional move (e.g. RSI 23, ADX 35, but last 2 candles green).
  const strongTrend = adx > 30;
  if (direction !== "HOLD" && !strongTrend && (layer === "Trend" || layer === "Momentum" || layer === "MACD_BB")) {
    const len = candles.length;
    if (len >= 3) {
      const c_2 = candles[len - 2]; // second-to-last candle
      const c_1 = candles[len - 1]; // last candle
      const bullish2 = c_2.close > c_2.open && c_1.close > c_1.open;
      const bearish2 = c_2.close < c_2.open && c_1.close < c_1.open;
      const confirmed = direction === "BUY" ? bullish2 : bearish2;
      if (!confirmed) {
        return {
          direction: "HOLD", confidence: 0, entryPrice: price,
          slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
          reason: `2-candle confirmation failed — waiting for consecutive ${direction === "BUY" ? "bullish" : "bearish"} candles | ${reason}`,
          layer: "None",
        };
    }
    }
  }

  // ── Apply 5m trend soft bias penalty (Fix #1) ──────────────────────────────
  // Reduce confidence for counter-trend signals instead of blocking them entirely.
  // A strong signal (0.75) against 5m trend becomes 0.60 — still above minConf (0.55).
  // A weak signal (0.58) against 5m trend becomes 0.43 — filtered out by minConf.
  if (direction === "BUY" && buyPenalty > 0) {
    reason += ` | 5m-penalty:-${(buyPenalty * 100).toFixed(0)}%`;
    confidence -= buyPenalty;
  } else if (direction === "SELL" && sellPenalty > 0) {
    reason += ` | 5m-penalty:-${(sellPenalty * 100).toFixed(0)}%`;
    confidence -= sellPenalty;
  }

  if (direction === "HOLD" || confidence < minConf) {
    return {
      direction: "HOLD", confidence, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: direction === "HOLD"
        ? (reason || `No signal | EMA9(${e9.toFixed(1)}) vs EMA21(${e21.toFixed(1)}) | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | 5m:${trend5m} | ${tod.label}`)
        : `Confidence ${(confidence * 100).toFixed(0)}% below threshold`,
      layer: "None",
    };
  }

  const adjustedConfidence = Math.min(0.98, confidence * tod.multiplier);
  const slPrice = direction === "BUY" ? price - atr * slMultiplier : price + atr * slMultiplier;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;
  const regime = classifyMarketRegime(candles);

  return {
    direction, confidence: adjustedConfidence, entryPrice: price, slPrice, targetPrice, atr,
    reason: `${reason} | ${tod.label}`,
    layer,
    marketRegime: regime.label,
  };
}
// ── V2 Regime Detection ─────────────────────────────────────────────────────
export type RegimeV2 = "TRENDING" | "RANGING" | "VOLATILE" | "DEAD";

export function detectRegimeV2(candles: Candle[]): { regime: RegimeV2; label: string; adx: number; atrRatio: number } {
  if (candles.length < 30) return { regime: "DEAD", label: "Insufficient data", adx: 0, atrRatio: 0 };
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const adx = calcADX(candles, 14);
  const vwap = calcVWAP(candles);
  const atr = calcATR(candles, 14);
  // Average ATR: compute ATR at multiple points and average
  const atrSamples: number[] = [];
  for (let i = Math.max(30, candles.length - 50); i < candles.length; i += 5) {
    const slice = candles.slice(Math.max(0, i - 14), i + 1);
    if (slice.length >= 3) atrSamples.push(calcATR(slice, Math.min(14, slice.length - 1)));
  }
  const avgAtr = atrSamples.length > 0 ? atrSamples.reduce((a, b) => a + b, 0) / atrSamples.length : atr;
  const atrRatio = avgAtr > 0 ? atr / avgAtr : 1;
  // Volume analysis
  const avgVol = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
  const recentVol = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const volRatio = avgVol > 0 ? recentVol / avgVol : 1;
  const allVolZero = candles.slice(-20).every(c => c.volume === 0);

  // VOLATILE: ATR > 1.5x average (explosive moves)
  if (atrRatio > 1.5) return { regime: "VOLATILE", label: `Volatile — ATR ${atrRatio.toFixed(1)}x avg`, adx, atrRatio };
  // DEAD: ADX < 15 with low ATR, or very low volume
  if (atrRatio < 0.5 && !allVolZero && volRatio < 0.6) return { regime: "DEAD", label: `Dead — ATR ${atrRatio.toFixed(1)}x, vol ${volRatio.toFixed(1)}x`, adx, atrRatio };
  if (adx < 15 && atrRatio < 0.6) return { regime: "DEAD", label: `Dead — ADX(${adx.toFixed(0)}), ATR ${atrRatio.toFixed(1)}x`, adx, atrRatio };
  // TRENDING: ADX > 25
  const vwapDist = Math.abs(price - vwap) / vwap;
  if (adx > 25 && vwapDist > 0.001) return { regime: "TRENDING", label: `Trending — ADX(${adx.toFixed(0)}) ${price > vwap ? "above" : "below"} VWAP`, adx, atrRatio };
  // Weak trend (ADX 20-25): still TRENDING but lower confidence
  if (adx >= 20 && adx <= 25) return { regime: "TRENDING", label: `Weak trend — ADX(${adx.toFixed(0)})`, adx, atrRatio };
  // RANGING: ADX < 20
  return { regime: "RANGING", label: `Ranging — ADX(${adx.toFixed(0)})`, adx, atrRatio };
}

// Build 15m candles from 1m candles
function build15mCandles(candles1m: Candle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 14 < candles1m.length; i += 15) {
    const slice = candles1m.slice(i, i + 15);
    result.push({
      open: slice[0].open, high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)), close: slice[slice.length - 1].close,
      volume: slice.reduce((a, c) => a + c.volume, 0), timestamp: slice[0].timestamp,
    });
  }
  return result;
}

// Get 15m trend direction
function get15mTrend(candles1m: Candle[]): "bullish" | "bearish" | "neutral" {
  const candles15m = build15mCandles(candles1m);
  if (candles15m.length < 3) return "neutral";
  const closes = candles15m.map(c => c.close);
  const e9 = ema(closes, Math.min(9, closes.length));
  const e21 = ema(closes, Math.min(21, closes.length));
  const lastE9 = e9[e9.length - 1];
  const lastE21 = e21[e21.length - 1];
  const price = closes[closes.length - 1];
  const vwap15m = calcVWAP(candles15m);
  if (lastE9 > lastE21 && price > vwap15m) return "bullish";
  if (lastE9 < lastE21 && price < vwap15m) return "bearish";
  return "neutral";
}

// Check if price is near a key level (PDH/PDL/VWAP/round number/pivots)
function isNearKeyLevelV2(price: number, vwap: number, prevDayHigh: number, prevDayLow: number, prevDayClose: number, threshold = 0.003): boolean {
  const levels: number[] = [vwap];
  if (prevDayHigh > 0) levels.push(prevDayHigh);
  if (prevDayLow > 0) levels.push(prevDayLow);
  if (prevDayClose > 0) levels.push(prevDayClose);
  // Round numbers
  const round100 = Math.round(price / 100) * 100;
  const round50 = Math.round(price / 50) * 50;
  levels.push(round100, round50);
  // Pivot points
  if (prevDayHigh > 0 && prevDayLow > 0 && prevDayClose > 0) {
    const pp = (prevDayHigh + prevDayLow + prevDayClose) / 3;
    levels.push(pp, 2 * pp - prevDayLow, 2 * pp - prevDayHigh);
  }
  return levels.some(level => Math.abs(price - level) / price < threshold);
}

/**
 * generateSignalV2 — 2-Layer Regime-Based Signal Engine
 *
 * Layer 1: Detect market regime (TRENDING / RANGING / VOLATILE / DEAD)
 * Layer 2: Only run strategies that match the current regime
 *
 * TRENDING → Trend (EMA/VWAP) + Momentum + Supertrend
 * RANGING  → VWAP Mean Reversion + Failed Breakout + VWAP Pullback
 * VOLATILE → Breakout (with volume confirmation), 50% position size
 * DEAD     → No trades (return HOLD)
 *
 * Additional quality filters applied AFTER signal generation:
 * 1. 15m trend must agree with direction
 * 2. Price within 0.3% of a key level (support/resistance/VWAP/round)
 * 3. R:R must be >= 1:2 (target distance / SL distance)
 * 4. No entry in first 15 min (9:15–9:30 AM)
 * 5. After 2 consecutive SLs same direction, require 75% confidence
 */
export function generateSignalV2(
  candles: Candle[],
  slMultiplier = 1.5,
  tpMultiplier = 3.0,
  minConf = 0.55,
  candles5m: Candle[] = [],
  prevDayHigh = 0,
  prevDayLow = 0,
  prevDayClose = 0,
  consecutiveSameDirectionSLs = 0,
  lastSlExitDirection: "BUY" | "SELL" | null = null,
): Signal {
  // ── Early returns ──────────────────────────────────────────────────────────
  if (!candles || candles.length === 0) {
    return { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "No candle data", layer: "None" };
  }
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const vwap = calcVWAP(candles);
  const rsi = calcRSI(closes, 14);
  const adx = calcADX(candles, 14);
  const e9arr = ema(closes, 9);
  const e21arr = ema(closes, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];
  const avgVol = candles.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const lastVol = candles[candles.length - 1].volume;
  const allVolZero = candles.slice(-10).every(c => c.volume === 0);
  const volRatio = allVolZero ? 1.5 : (avgVol > 0 ? lastVol / avgVol : 1.0);

  const now = new Date(candles[candles.length - 1].timestamp);
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const inNSESession = istMin >= 555 && istMin <= 930;
  const inMCXSession = istMin >= 540 && istMin <= 1410;
  if (!inNSESession && !inMCXSession) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: "Market closed", layer: "None" };
  }
  if (candles.length < 20) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `Collecting data (${candles.length}/20)`, layer: "None" };
  }

  // ── Quality Filter 4: No entry in first 15 min (9:15–9:30 AM) ─────────────
  if (istMin < 565) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: "Skipping first 10 min (opening volatility)", layer: "None" };
  }

  // ── LAYER 1: Regime Detection ─────────────────────────────────────────────
  const regime = detectRegimeV2(candles);

  // DEAD regime → no trades
  if (regime.regime === "DEAD") {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[DEAD] ${regime.label} — no trades`, layer: "None", regimeV2: "DEAD" };
  }

  // Time-of-day multiplier
  const tod = getTimeOfDayMultiplier(istMin);

  // Multi-timeframe: 5m and 15m trends
  const trend5m = get5mTrend(candles5m);
  const trend15m = get15mTrend(candles);

  // S/R levels from previous day
  let srLevels: number[] = [];
  if (prevDayHigh > 0 && prevDayLow > 0 && prevDayClose > 0) {
    const pivots = calcPivotPoints(prevDayHigh, prevDayLow, prevDayClose);
    srLevels = [pivots.pp, pivots.r1, pivots.r2, pivots.s1, pivots.s2];
  }

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";
  let layer: Signal["layer"] = "None";
  let sizeReduction: number | undefined;

  // ── LAYER 1.5: High-Confidence Early-Day Patterns (regime-independent) ────
  // These fire regardless of regime because they are time-gated and high-confidence.
  // HourlyClose: fires at 10:15 AM when first hour candle has strong directional body
  // ORB: fires 9:30-14:00 when price breaks the 15-min opening range
  if (direction === "HOLD" && candles.length >= 60 && istMin >= 615 && istMin <= 625) {
    const firstHourCandles = candles.slice(0, Math.min(60, candles.length));
    const hourOpen = firstHourCandles[0].open;
    const hourClose = firstHourCandles[firstHourCandles.length - 1].close;
    const hourHigh = Math.max(...firstHourCandles.map(c => c.high));
    const hourLow = Math.min(...firstHourCandles.map(c => c.low));
    const hourRange = hourHigh - hourLow;
    const hourBody = Math.abs(hourClose - hourOpen);
    const bodyRatio = hourRange > 0 ? hourBody / hourRange : 0;
    if (bodyRatio > 0.60 && hourRange > atr * 0.5) {
      const isBullish = hourClose > hourOpen;
      direction = isBullish ? "BUY" : "SELL";
      confidence = Math.min(0.93, 0.70 + bodyRatio * 0.2 + (adx > 25 ? 0.05 : 0));
      reason = `[V2:HourlyClose] 1H body ${(bodyRatio * 100).toFixed(0)}% | O:${hourOpen.toFixed(0)} C:${hourClose.toFixed(0)} H:${hourHigh.toFixed(0)} L:${hourLow.toFixed(0)} | ADX(${adx.toFixed(0)}) | ${regime.regime}`;
      layer = "HourlyClose";
    }
  }
  // ORB: Opening Range Breakout — fresh breakout of 15-min range, no chasing
  if (direction === "HOLD" && istMin >= 570 && istMin <= 840 && candles.length >= 17) {
    const orbMinRangeWidth = price * 0.002;
    const orb = calcORBSignal(candles, 15, 2.0);
    const orbRangeWidth = orb.orbHigh - orb.orbLow;
    if (orb.direction !== "HOLD" && orbRangeWidth >= orbMinRangeWidth) {
      const currentCandleIdx = candles.length - 1;
      const MIN_ENGINE_CANDLES = 20;
      const effectiveBreakoutStart = orb.breakoutCandleIndex >= 0
        ? Math.max(orb.breakoutCandleIndex, MIN_ENGINE_CANDLES) : -1;
      const candlesSinceBreakout = effectiveBreakoutStart >= 0
        ? currentCandleIdx - effectiveBreakoutStart : 999;
      const isInitialBreakout = orb.breakoutCandleIndex <= MIN_ENGINE_CANDLES;
      const freshnessWindow = isInitialBreakout ? 10 : 3;
      const orbEdge = orb.direction === "BUY" ? orb.orbHigh : orb.orbLow;
      const distFromEdge = Math.abs(price - orbEdge);
      const distPct = distFromEdge / orbEdge;
      // Anti-chasing: must be within 0.15% of breakout edge AND within freshness window
      if (candlesSinceBreakout <= freshnessWindow && distPct <= 0.0015) {
        direction = orb.direction;
        confidence = Math.min(0.92, 0.72 + orb.breakoutPct * 500);
        reason = `[V2:ORB] ${orb.direction === "BUY" ? "Above" : "Below"} 15-min range | ${(orb.breakoutPct * 100).toFixed(3)}% | ${regime.regime} | fresh(${candlesSinceBreakout})`;
        layer = "ORB";
      }
    }
  }

  // ── LAYER 2: Regime-Filtered Strategies ───────────────────────────────────
  if (regime.regime === "TRENDING") {
    // ── TRENDING: Trend + Momentum + Supertrend ─────────────────────────────

    // Strategy A: EMA/VWAP Trend (same as old Layer 3)
    if (direction === "HOLD" && candles.length >= 21 && adx > 20) {
      const emaDiffPct = Math.abs(e9 - e21) / e21;
      const distFromEma9 = Math.abs(price - e9) / e9;
      const distFromVwap = Math.abs(price - vwap) / vwap;
      const nearPullback = distFromEma9 < 0.0015 || distFromVwap < 0.0015;
      if (e9 > e21 && price > vwap && (rsi > 55 || rsi < 40) && nearPullback) {
        direction = "BUY";
        confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 20) * 0.005);
        reason = `[V2:Trend] EMA9>${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | pullback`;
        layer = "Trend";
      } else if (e9 < e21 && price < vwap && (rsi < 45 || rsi > 60) && nearPullback) {
        direction = "SELL";
        confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 20) * 0.005);
        reason = `[V2:Trend] EMA9<${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | pullback`;
        layer = "Trend";
      }
    }

    // Strategy B: Momentum (same as old Layer 4)
    if (direction === "HOLD" && candles.length >= 5) {
      const roc3 = closes.length >= 4 ? (price - closes[closes.length - 4]) / closes[closes.length - 4] : 0;
      const distFromEma9_m = Math.abs(price - e9) / e9;
      const distFromVwap_m = Math.abs(price - vwap) / vwap;
      const nearPullback_m = distFromEma9_m < 0.0015 || distFromVwap_m < 0.0015;
      if (rsi > 55 && roc3 > 0.001 && price > vwap && nearPullback_m) {
        direction = "BUY";
        confidence = Math.min(0.82, 0.60 + roc3 * 100 + (rsi - 55) * 0.005);
        reason = `[V2:Momentum] RSI(${rsi.toFixed(0)}) | +${(roc3 * 100).toFixed(2)}% in 3c | Above VWAP | pullback`;
        layer = "Momentum";
      } else if (rsi < 45 && roc3 < -0.001 && price < vwap && nearPullback_m) {
        direction = "SELL";
        confidence = Math.min(0.82, 0.60 + Math.abs(roc3) * 100 + (45 - rsi) * 0.005);
        reason = `[V2:Momentum] RSI(${rsi.toFixed(0)}) | ${(roc3 * 100).toFixed(2)}% in 3c | Below VWAP | pullback`;
        layer = "Momentum";
      }
    }

    // Strategy C: Supertrend on Heiken Ashi (same as old Layer 10)
    if (direction === "HOLD" && candles.length >= 15) {
      const haCandles = toHeikenAshi(candles);
      const st = calcSupertrend(haCandles, 10, 3.0);
      if (st.flipped && st.direction !== ("HOLD" as any)) {
        const stDir = st.direction as "BUY" | "SELL";
        const rsiOk = stDir === "BUY" ? rsi > 45 && rsi < 80 : rsi < 55 && rsi > 20;
        if (rsiOk) {
          direction = stDir;
          confidence = Math.min(0.92, 0.72 + (stDir === "BUY" ? Math.max(0, rsi - 50) : Math.max(0, 50 - rsi)) * 0.003);
          reason = `[V2:Supertrend] HA-Supertrend(10,3) flipped ${stDir} | band:${st.band.toFixed(1)} | RSI(${rsi.toFixed(0)})`;
          layer = "Trend";
        }
      }
    }

  } else if (regime.regime === "RANGING") {
    // ── RANGING: ONLY mean-reversion at range extremes ──────────────────────
    // FIX: No FailedBreakout entries (all 6 lost in Stage 1 replay)
    // FIX: Require price at range extreme (top 30% for SELL, bottom 30% for BUY)
    // FIX: Anti-chasing: last 5 candles must show price moving TOWARD extreme (retracement)
    // Strategy A: VWAP Deviation Mean Reversion — only at range extremes
    if (direction === "HOLD" && candles.length >= 20) {
      const vwapDev = calcVWAPDeviation(candles);
      if (vwapDev.signal !== "HOLD") {
        // Anti-chasing: check if entry is at range extreme
        const lookback20 = candles.slice(-20);
        const rangeHigh = Math.max(...lookback20.map(c => c.high));
        const rangeLow = Math.min(...lookback20.map(c => c.low));
        const rangeWidth = rangeHigh - rangeLow;
        const posInRange = rangeWidth > 0 ? (price - rangeLow) / rangeWidth : 0.5;
        // For SELL: price must be in top 30% of range (posInRange > 0.70)
        // For BUY: price must be in bottom 30% of range (posInRange < 0.30)
        const atExtreme = (vwapDev.signal === "SELL" && posInRange > 0.70) ||
                          (vwapDev.signal === "BUY" && posInRange < 0.30);
        // Anti-chasing: last 5 candles must show price moved TOWARD the extreme (retracement)
        // For SELL at top: price should have risen (retraced up) in last 5 candles
        // For BUY at bottom: price should have fallen (retraced down) in last 5 candles
        const last5Closes = candles.slice(-5).map(c => c.close);
        const recentMove = last5Closes[last5Closes.length - 1] - last5Closes[0];
        const notChasing = (vwapDev.signal === "SELL" && recentMove > 0) ||
                           (vwapDev.signal === "BUY" && recentMove < 0);
        if (atExtreme && notChasing) {
          direction = vwapDev.signal;
          confidence = Math.min(0.85, 0.62 + Math.abs(vwapDev.zScore) * 0.08);
          reason = `[V2:VWAPRev] z=${vwapDev.zScore.toFixed(2)} | pos=${(posInRange*100).toFixed(0)}% | ${regime.label} | at-extreme`;
          layer = "VWAPReversion";
        }
      }
    }
    // Strategy B: VWAP Pullback — only at range extremes with anti-chasing
    if (direction === "HOLD" && candles.length >= 10) {
      const pullback = detectVWAPPullback(candles, vwap);
      if (pullback.detected && pullback.direction !== "HOLD") {
        const exhaustion = pullback.direction === "BUY" ? detectUptrendExhaustion(candles) : { exhausted: false, reason: "" };
        if (!exhaustion.exhausted) {
          // Anti-chasing: check range position
          const lookback20 = candles.slice(-20);
          const rangeHigh = Math.max(...lookback20.map(c => c.high));
          const rangeLow = Math.min(...lookback20.map(c => c.low));
          const rangeWidth = rangeHigh - rangeLow;
          const posInRange = rangeWidth > 0 ? (price - rangeLow) / rangeWidth : 0.5;
          const atExtreme = (pullback.direction === "SELL" && posInRange > 0.65) ||
                            (pullback.direction === "BUY" && posInRange < 0.35);
          // Anti-chasing: last 5 candles must show retracement (price moved toward entry)
          const last5Closes = candles.slice(-5).map(c => c.close);
          const recentMove = last5Closes[last5Closes.length - 1] - last5Closes[0];
          const notChasing = (pullback.direction === "SELL" && recentMove > 0) ||
                             (pullback.direction === "BUY" && recentMove < 0);
          if (atExtreme && notChasing) {
            direction = pullback.direction;
            confidence = Math.min(0.91, 0.68 + pullback.strength * 0.15);
            reason = `[V2:VWAPPullback] VWAP pullback | pos=${(posInRange*100).toFixed(0)}% | ${pullback.direction} | at-extreme`;
            layer = "VWAPPullback";
          }
        }
      }
    }
    // Strategy C: Breakout in RANGING (balanced)
    // Fires when: (1) before 14:00 IST, (2) real breakout of 20-candle range,
    // (3) strong candle body (>45%), (4) RSI confirms direction
    if (direction === "HOLD" && candles.length >= 20 && istMin < 840) {
      const lookback = candles.slice(-20);
      const highestHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
      const lowestLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
      const lastCandle = candles[candles.length - 1];
      const breakoutUpPct = (lastCandle.close - highestHigh) / highestHigh;
      const breakoutDnPct = (lowestLow - lastCandle.close) / lowestLow;
      const dynamicThreshold = Math.max(0.0004, (atr / price) * 0.6);
      // Strong candle body requirement (>45% of candle range)
      const candleRange = lastCandle.high - lastCandle.low;
      const candleBody = Math.abs(lastCandle.close - lastCandle.open);
      const bodyStrong = candleRange > 0 ? candleBody / candleRange > 0.45 : false;
      if (bodyStrong) {
        if (breakoutUpPct > dynamicThreshold && (volRatio >= 1.2 || allVolZero) && rsi > 52 && rsi < 78) {
          direction = "BUY";
          confidence = Math.min(0.88, 0.65 + breakoutUpPct * 250);
          reason = `[V2:Breakout] Above ${highestHigh.toFixed(1)} | ${(breakoutUpPct*100).toFixed(3)}% | body ${(candleBody/candleRange*100).toFixed(0)}% | RSI(${rsi.toFixed(0)}) | RANGING`;
          layer = "Breakout";
        } else if (breakoutDnPct > dynamicThreshold && (volRatio >= 1.2 || allVolZero) && rsi < 48 && rsi > 22) {
          direction = "SELL";
          confidence = Math.min(0.88, 0.65 + breakoutDnPct * 250);
          reason = `[V2:Breakout] Below ${lowestLow.toFixed(1)} | ${(breakoutDnPct*100).toFixed(3)}% | body ${(candleBody/candleRange*100).toFixed(0)}% | RSI(${rsi.toFixed(0)}) | RANGING`;
          layer = "Breakout";
        }
      }
    }
  } else if (regime.regime === "VOLATILE") {
    // ── VOLATILE: Only Breakout with strong volume confirmation, 50% size ───
    sizeReduction = 0.5; // Half position size in volatile regime

    if (direction === "HOLD" && candles.length >= 20) {
      const lookback = candles.slice(-20);
      const highestHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
      const lowestLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
      const lastCandle = candles[candles.length - 1];
      const breakoutUpPct = (lastCandle.close - highestHigh) / highestHigh;
      const breakoutDnPct = (lowestLow - lastCandle.close) / lowestLow;
      const dynamicThreshold = Math.max(0.0005, (atr / price) * 0.7); // Higher threshold for volatile

      // Require STRONG volume confirmation (2x avg) in volatile regime
      if (breakoutUpPct > dynamicThreshold && volRatio >= 2.0 && rsi > 50 && rsi < 80) {
        direction = "BUY";
        confidence = Math.min(0.90, 0.65 + breakoutUpPct * 150 + (volRatio - 2.0) * 0.05);
        reason = `[V2:Breakout] Above ${highestHigh.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)}) | VOLATILE(50% size)`;
        layer = "Breakout";
      } else if (breakoutDnPct > dynamicThreshold && volRatio >= 2.0 && rsi < 50 && rsi > 20) {
        direction = "SELL";
        confidence = Math.min(0.90, 0.65 + breakoutDnPct * 150 + (volRatio - 2.0) * 0.05);
        reason = `[V2:Breakout] Below ${lowestLow.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)}) | VOLATILE(50% size)`;
        layer = "Breakout";
      }
    }
  }

  // ── If no signal generated, return HOLD ───────────────────────────────────
  if (direction === "HOLD") {
    return {
      direction: "HOLD", confidence: 0, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: reason || `[V2] No signal | Regime:${regime.regime} | ADX(${adx.toFixed(0)}) | RSI(${rsi.toFixed(0)}) | EMA9(${e9.toFixed(1)}) vs EMA21(${e21.toFixed(1)})`,
      layer: "None", regimeV2: regime.regime,
    };
  }

  // ── QUALITY FILTERS (applied after signal generation) ─────────────────────

  // Filter 1: 15m trend must agree with direction
  if (trend15m !== "neutral") {
    if ((direction === "BUY" && trend15m === "bearish") || (direction === "SELL" && trend15m === "bullish")) {
      // Penalize counter-15m signals by 20% confidence
      confidence -= 0.20;
      reason += ` | 15m-against(${trend15m}):-20%`;
      if (confidence < minConf) {
        return {
          direction: "HOLD", confidence, entryPrice: price,
          slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
          reason: `[V2] Rejected: 15m trend(${trend15m}) against ${direction} | conf ${(confidence * 100).toFixed(0)}% < ${(minConf * 100).toFixed(0)}%`,
          layer: "None", regimeV2: regime.regime,
        };
      }
    }
  }

  // Filter 2: Price should be near a key level (entry at support/resistance = better R:R)
  const nearKey = isNearKeyLevelV2(price, vwap, prevDayHigh, prevDayLow, prevDayClose, 0.003);
  if (!nearKey) {
    // Not near key level — reduce confidence by 10% (soft filter, not hard block)
    confidence -= 0.10;
    reason += ` | not-near-key-level:-10%`;
    if (confidence < minConf) {
      return {
        direction: "HOLD", confidence, entryPrice: price,
        slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
        reason: `[V2] Rejected: not near key level | conf ${(confidence * 100).toFixed(0)}% < ${(minConf * 100).toFixed(0)}%`,
        layer: "None", regimeV2: regime.regime,
      };
    }
  }

  // Filter 3: R:R must be >= 1:2
  const slPrice = direction === "BUY" ? price - atr * slMultiplier : price + atr * slMultiplier;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;
  const slDistance = Math.abs(price - slPrice);
  const tpDistance = Math.abs(targetPrice - price);
  const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;
  if (rrRatio < 2.0) {
    return {
      direction: "HOLD", confidence, entryPrice: price, slPrice, targetPrice, atr,
      reason: `[V2] Rejected: R:R ${rrRatio.toFixed(1)}:1 < 2:1 minimum | ${reason}`,
      layer: "None", regimeV2: regime.regime,
    };
  }

  // Filter 5: After 2 consecutive SLs same direction, require 75% confidence
  if (consecutiveSameDirectionSLs >= 2 && lastSlExitDirection === direction) {
    if (confidence < 0.75) {
      return {
        direction: "HOLD", confidence, entryPrice: price, slPrice, targetPrice, atr,
        reason: `[V2] Rejected: ${consecutiveSameDirectionSLs} consecutive ${direction} SLs, need 75% conf (have ${(confidence * 100).toFixed(0)}%)`,
        layer: "None", regimeV2: regime.regime,
      };
    }
  }

  // ── Apply time-of-day multiplier ──────────────────────────────────────────
  const adjustedConfidence = Math.min(0.98, confidence * tod.multiplier);

  // ── Final confidence check ────────────────────────────────────────────────
  if (adjustedConfidence < minConf) {
    return {
      direction: "HOLD", confidence: adjustedConfidence, entryPrice: price, slPrice, targetPrice, atr,
      reason: `[V2] Confidence ${(adjustedConfidence * 100).toFixed(0)}% below threshold ${(minConf * 100).toFixed(0)}% | ${reason}`,
      layer: "None", regimeV2: regime.regime,
    };
  }

  return {
    direction, confidence: adjustedConfidence, entryPrice: price, slPrice, targetPrice, atr,
    reason: `${reason} | Regime:${regime.regime} | 15m:${trend15m} | 5m:${trend5m} | R:R=${rrRatio.toFixed(1)} | ${tod.label}`,
    layer,
    marketRegime: regime.label,
    regimeV2: regime.regime,
    sizeReduction,
  };
}

// ── Power Hour Signal (3:00–3:20 PM) — whole-day context ─────────────────────
// Institutional players close/build positions in this window.
// We read the full day's candle history to determine trend, range, and conviction.
export function generatePowerHourSignal(
  candles1m: Candle[],
  candles5m: Candle[],
  slMultiplier = 1.2,
  tpMultiplier = 2.5,
): Signal {
  if (candles1m.length < 30 || candles5m.length < 6) {
    return { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "Insufficient data for Power Hour", layer: "None", isPowerHour: true };
  }

  const price = candles1m[candles1m.length - 1].close;
  const atr = calcATR(candles1m, 14);

  // Day context
  const dayHigh = Math.max(...candles1m.map(c => c.high));
  const dayLow = Math.min(...candles1m.map(c => c.low));
  const dayVwap = calcVWAP(candles1m);
  const dayRange = dayHigh - dayLow;

  // Day trend: compare first-quarter avg vs last-quarter avg
  const q1 = candles1m.slice(0, Math.max(1, Math.floor(candles1m.length / 4)));
  const q4 = candles1m.slice(-Math.max(1, Math.floor(candles1m.length / 4)));
  const q1Avg = q1.reduce((a, c) => a + c.close, 0) / q1.length;
  const q4Avg = q4.reduce((a, c) => a + c.close, 0) / q4.length;
  const dayTrendStrength = (q4Avg - q1Avg) / q1Avg;

  // Price position in day range (0=at low, 1=at high)
  const pricePositionInRange = dayRange > 0 ? (price - dayLow) / dayRange : 0.5;

  // Volume surge in last 30 candles vs day average
  const avgDayVol = candles1m.reduce((a, c) => a + c.volume, 0) / candles1m.length;
  const last30 = candles1m.slice(-30);
  const last30Vol = last30.reduce((a, c) => a + c.volume, 0) / last30.length;
  const volSurge = avgDayVol > 0 ? last30Vol / avgDayVol : 1;

  // 5-min precision indicators
  const closes5m = candles5m.map(c => c.close);
  const adx5m = calcADX(candles5m, Math.min(14, candles5m.length));
  const macd5m = calcMACD(closes5m);

  // 1-min recent momentum
  const closes1m = candles1m.map(c => c.close);
  const rsi1m = calcRSI(closes1m, 14);
  const e9arr = ema(closes1m, 9);
  const e21arr = ema(closes1m, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];
  // Index instruments (NIFTY, BANKNIFTY) return volume=0 — bypass volume condition entirely
  const isIndexInstrument = avgDayVol === 0;
  const last5Vol = candles1m.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const recentVolRatio = avgDayVol > 0 ? last5Vol / avgDayVol : 1;
  // Volume condition: always true for index instruments (they have no volume data)
  const volConditionMet = isIndexInstrument ? true : (volSurge >= 1.2 || recentVolRatio >= 1.3);

  // Score-based approach — 5 core conditions (volume excluded for index instruments)
  // Threshold: 3/5 for entry (was 4/6 which was too strict with volume always failing)
  const bullConditions = [
    dayTrendStrength > 0.001,          // day is up >0.1% (relaxed from 0.2%)
    price > dayVwap,                   // price above day VWAP
    pricePositionInRange > 0.4,        // price in upper 60% of day range (relaxed from 50%)
    e9 > e21 && rsi1m > 45 && rsi1m < 80, // 1m momentum bullish (relaxed RSI)
    macd5m.histogram > 0,              // 5m MACD bullish
  ];
  const bearConditions = [
    dayTrendStrength < -0.001,         // day is down >0.1%
    price < dayVwap,
    pricePositionInRange < 0.6,        // price in lower 60% of day range
    e9 < e21 && rsi1m < 55 && rsi1m > 20, // 1m momentum bearish (relaxed RSI)
    macd5m.histogram < 0,
  ];

  const bullScore = bullConditions.filter(Boolean).length;
  const bearScore = bearConditions.filter(Boolean).length;
  // Effective threshold: 3/5 core conditions + volume must be met (auto-true for index)
  const POWER_HOUR_THRESHOLD = 3;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";

  if (bullScore >= POWER_HOUR_THRESHOLD && bullScore > bearScore && volConditionMet) {
    // Don't buy if price is already at day high (range exhausted)
    if (pricePositionInRange > 0.95) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[PowerHour] Price at day high — range exhausted, skipping BUY`, layer: "None", isPowerHour: true };
    }
    direction = "BUY";
    confidence = Math.min(0.95, 0.65 + bullScore * 0.06 + Math.max(0, dayTrendStrength * 10));
    reason = `[PowerHour] Bullish day(${(dayTrendStrength * 100).toFixed(2)}%) | Above VWAP(${dayVwap.toFixed(1)}) | Vol:${isIndexInstrument ? "idx-bypass" : volSurge.toFixed(1) + "x"} | Score:${bullScore}/5 | RSI(${rsi1m.toFixed(0)}) | ADX(${adx5m.toFixed(0)}) | Range:${dayLow.toFixed(1)}–${dayHigh.toFixed(1)}`;
  } else if (bearScore >= POWER_HOUR_THRESHOLD && bearScore > bullScore && volConditionMet) {
    if (pricePositionInRange < 0.05) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[PowerHour] Price at day low — range exhausted, skipping SELL`, layer: "None", isPowerHour: true };
    }
    direction = "SELL";
    confidence = Math.min(0.95, 0.65 + bearScore * 0.06 + Math.max(0, Math.abs(dayTrendStrength) * 10));
    reason = `[PowerHour] Bearish day(${(dayTrendStrength * 100).toFixed(2)}%) | Below VWAP(${dayVwap.toFixed(1)}) | Vol:${isIndexInstrument ? "idx-bypass" : volSurge.toFixed(1) + "x"} | Score:${bearScore}/5 | RSI(${rsi1m.toFixed(0)}) | ADX(${adx5m.toFixed(0)}) | Range:${dayLow.toFixed(1)}–${dayHigh.toFixed(1)}`;
  }

  if (direction === "HOLD") {
    return {
      direction: "HOLD", confidence: 0, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: `[PowerHour] No clear setup | Bull:${bullScore}/5 Bear:${bearScore}/5 (need ${POWER_HOUR_THRESHOLD}) | DayTrend:${(dayTrendStrength * 100).toFixed(2)}% | VWAP:${dayVwap.toFixed(1)} | EMA9${e9 > e21 ? ">" : "<"}EMA21 | RSI(${rsi1m.toFixed(0)}) | MACD:${macd5m.histogram > 0 ? "+" : "-"} | Vol:${isIndexInstrument ? "idx(bypass)" : volSurge.toFixed(1) + "x"}`,
      layer: "None", isPowerHour: true,
    };
  }

  const slPrice = direction === "BUY" ? price - atr * slMultiplier : price + atr * slMultiplier;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;
  return { direction, confidence, entryPrice: price, slPrice, targetPrice, atr, reason, layer: "PowerHour", isPowerHour: true };
}

// ── MCX Evening Power Hour Signal (7:30–9:30 PM IST) ────────────────────────
/**
 * Reads whole-day 1m candles + 5m MACD to identify the day's directional bias,
 * then applies a high-conviction entry for the US market open window.
 * Crude Oil, Natural Gas, Gold, Silver all move sharply when NY opens.
 */
export function generateMCXEveningSignal(
  candles1m: Candle[],
  candles5m: Candle[],
  isWednesdayCrude = false,  // EIA data day — widen SL
  slMultiplier = 1.2,
  tpMultiplier = 2.5,
): Signal {
  if (candles1m.length < 30 || candles5m.length < 6) {
    return { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "Insufficient data for MCX Evening", layer: "None", isMCXEvening: true };
  }

  const price = candles1m[candles1m.length - 1].close;
  const atr = calcATR(candles1m, 14);
  const slMult = isWednesdayCrude ? slMultiplier * 1.3 : slMultiplier;  // EIA day: wider SL

  // Day context from all 1m candles accumulated since MCX 9:00 AM
  const dayHigh = Math.max(...candles1m.map(c => c.high));
  const dayLow  = Math.min(...candles1m.map(c => c.low));
  const dayVwap = calcVWAP(candles1m);
  const dayRange = dayHigh - dayLow;

  // Day trend: first quarter vs last quarter
  const q1 = candles1m.slice(0, Math.max(1, Math.floor(candles1m.length / 4)));
  const q4 = candles1m.slice(-Math.max(1, Math.floor(candles1m.length / 4)));
  const q1Avg = q1.reduce((a, c) => a + c.close, 0) / q1.length;
  const q4Avg = q4.reduce((a, c) => a + c.close, 0) / q4.length;
  const dayTrendStrength = (q4Avg - q1Avg) / q1Avg;

  // Price position in day range
  const pricePos = dayRange > 0 ? (price - dayLow) / dayRange : 0.5;

  // Volume: US open surge (last 30 candles vs day avg)
  // MCX futures return real volume, but in paper mode (mock candles) volume may be 0.
  // When all volume is 0 (paper mode / thin market), bypass the volSurge check by treating it as 1.2.
  const avgDayVol = candles1m.reduce((a, c) => a + c.volume, 0) / candles1m.length;
  const last30Vol = candles1m.slice(-30).reduce((a, c) => a + c.volume, 0) / 30;
  const allVolumeZero = avgDayVol === 0 && last30Vol === 0;
  const volSurge  = allVolumeZero ? 1.2 : (avgDayVol > 0 ? last30Vol / avgDayVol : 1);

  // 5m MACD for medium-term momentum
  const closes5m = candles5m.map(c => c.close);
  const macd5m   = calcMACD(closes5m);

  // 1m short-term indicators
  const closes1m = candles1m.map(c => c.close);
  const rsi1m    = calcRSI(closes1m, 14);
  const e9arr    = ema(closes1m, 9);
  const e21arr   = ema(closes1m, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];

  // 6-point scoring (same structure as NSE Power Hour but tuned for MCX)
  const bullConditions = [
    dayTrendStrength > 0.001,           // day is up >0.1% (MCX moves smaller %)
    price > dayVwap,                    // above day VWAP
    pricePos > 0.45,                    // in upper half of day range
    e9 > e21 && rsi1m > 48 && rsi1m < 80, // 1m momentum bullish
    macd5m.histogram > 0,               // 5m MACD bullish
    volSurge >= 1.15,                   // US open volume surge
  ];
  const bearConditions = [
    dayTrendStrength < -0.001,
    price < dayVwap,
    pricePos < 0.55,
    e9 < e21 && rsi1m < 52 && rsi1m > 20,
    macd5m.histogram < 0,
    volSurge >= 1.15,
  ];

  const bullScore = bullConditions.filter(Boolean).length;
  const bearScore = bearConditions.filter(Boolean).length;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";

  if (bullScore >= 4 && bullScore > bearScore) {
    if (pricePos > 0.93) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMult, targetPrice: price + atr * tpMultiplier, atr, reason: `[MCXEvening] At day high — range exhausted`, layer: "None", isMCXEvening: true };
    }
    direction = "BUY";
    confidence = Math.min(0.95, 0.62 + bullScore * 0.05 + Math.max(0, dayTrendStrength * 8));
    reason = `[MCXEvening] Bullish day(${(dayTrendStrength * 100).toFixed(2)}%) | Above VWAP(${dayVwap.toFixed(1)}) | VolSurge:${volSurge.toFixed(1)}x | Score:${bullScore}/6 | RSI(${rsi1m.toFixed(0)})${isWednesdayCrude ? " | EIA-day SL widened" : ""}`;
  } else if (bearScore >= 4 && bearScore > bullScore) {
    if (pricePos < 0.07) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price + atr * slMult, targetPrice: price - atr * tpMultiplier, atr, reason: `[MCXEvening] At day low — range exhausted`, layer: "None", isMCXEvening: true };
    }
    direction = "SELL";
    confidence = Math.min(0.95, 0.62 + bearScore * 0.05 + Math.max(0, Math.abs(dayTrendStrength) * 8));
    reason = `[MCXEvening] Bearish day(${(dayTrendStrength * 100).toFixed(2)}%) | Below VWAP(${dayVwap.toFixed(1)}) | VolSurge:${volSurge.toFixed(1)}x | Score:${bearScore}/6 | RSI(${rsi1m.toFixed(0)})${isWednesdayCrude ? " | EIA-day SL widened" : ""}`;
  }

  if (direction === "HOLD") {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMult, targetPrice: price + atr * tpMultiplier, atr, reason: `[MCXEvening] No clear setup | Bull:${bullScore} Bear:${bearScore} | DayTrend:${(dayTrendStrength * 100).toFixed(2)}%`, layer: "None", isMCXEvening: true };
  }

  const slPrice = direction === "BUY" ? price - atr * slMult : price + atr * slMult;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;
  return { direction, confidence, entryPrice: price, slPrice, targetPrice, atr, reason, layer: "MCXEvening", isMCXEvening: true };
}


// ── MCX Late Session Signal (9:30–11:20 PM IST) ─────────────────────────────
/**
 * MCX Late Session: 21:30–23:20 IST — after US market open volatility settles.
 * This window catches MOMENTUM CONTINUATION moves that start during MCX Evening
 * (19:30–21:30) and continue into the late session. The CRUDEOIL 4.5× move
 * (₹22→₹101 on 16JUL26) happened in this exact window.
 *
 * Key differences from generic signal generator:
 * 1. NO pullback requirement — strong MCX moves don't pull back, they accelerate
 * 2. Looser 5m trend confirmation — we trust 1m momentum more in late session
 * 3. Lower score threshold (3/6 with strong momentum) — MCX late moves are decisive
 * 4. Higher target multiplier — late session moves tend to be larger
 * 5. Momentum-first approach — ROC and EMA slope are primary signals
 */
export function generateMCXLateSessionSignal(
  candles1m: Candle[],
  candles5m: Candle[],
  slMultiplier = 1.3,
  tpMultiplier = 3.0,
): Signal {
  if (candles1m.length < 20 || candles5m.length < 4) {
    return { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "Insufficient data for MCX Late Session", layer: "None", isMCXLateSession: true };
  }

  const price = candles1m[candles1m.length - 1].close;
  const atr = calcATR(candles1m, 14);

  // Context from all accumulated candles
  const dayHigh = Math.max(...candles1m.map(c => c.high));
  const dayLow  = Math.min(...candles1m.map(c => c.low));
  const dayVwap = calcVWAP(candles1m);
  const dayRange = dayHigh - dayLow;

  // Recent momentum: last 30 candles (last ~30 minutes of action)
  const recent30 = candles1m.slice(-30);
  const recentOpen = recent30[0].open;
  const recentClose = recent30[recent30.length - 1].close;
  const recentMovePercent = ((recentClose - recentOpen) / recentOpen) * 100;

  // Rate of change: 5-candle and 10-candle ROC (momentum acceleration)
  const closes1m = candles1m.map(c => c.close);
  const roc5 = closes1m.length >= 6 ? (price - closes1m[closes1m.length - 6]) / closes1m[closes1m.length - 6] : 0;
  const roc10 = closes1m.length >= 11 ? (price - closes1m[closes1m.length - 11]) / closes1m[closes1m.length - 11] : 0;

  // EMA slope: is EMA9 accelerating? (compare last 3 EMA9 values)
  const e9arr = ema(closes1m, 9);
  const e21arr = ema(closes1m, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];
  const e9Prev = e9arr.length >= 4 ? e9arr[e9arr.length - 4] : e9;
  const emaSlope = (e9 - e9Prev) / e9Prev; // positive = accelerating up

  // RSI: trending (not just oversold/overbought)
  const rsi1m = calcRSI(closes1m, 14);

  // 5m MACD for medium-term momentum
  const closes5m = candles5m.map(c => c.close);
  const macd5m = calcMACD(closes5m);

  // Volume: late session surge vs day average
  const avgDayVol = candles1m.reduce((a, c) => a + c.volume, 0) / candles1m.length;
  const last15Vol = candles1m.slice(-15).reduce((a, c) => a + c.volume, 0) / 15;
  const allVolumeZero = avgDayVol === 0 && last15Vol === 0;
  const volSurge = allVolumeZero ? 1.2 : (avgDayVol > 0 ? last15Vol / avgDayVol : 1);

  // ADX: trend strength
  const adx = calcADX(candles1m, 14);

  // Price position in day range
  const pricePos = dayRange > 0 ? (price - dayLow) / dayRange : 0.5;

  // ── 6-point scoring: momentum continuation focus ──────────────────────────
  // Unlike MCX Evening (which looks for US-open setups), Late Session looks for
  // CONTINUATION of moves that already started. Key: ROC, EMA slope, trend strength.
  const bullConditions = [
    roc5 > 0.001,                          // 5-candle momentum positive (>0.1%)
    roc10 > 0.002,                         // 10-candle momentum positive (>0.2%) — sustained
    emaSlope > 0.0005,                     // EMA9 accelerating upward
    e9 > e21,                              // Short-term above long-term
    price > dayVwap,                       // Above day VWAP
    adx > 18 || volSurge >= 1.1,          // Trending OR volume surge (looser than Evening)
  ];
  const bearConditions = [
    roc5 < -0.001,                         // 5-candle momentum negative
    roc10 < -0.002,                        // 10-candle momentum negative — sustained
    emaSlope < -0.0005,                    // EMA9 accelerating downward
    e9 < e21,                              // Short-term below long-term
    price < dayVwap,                       // Below day VWAP
    adx > 18 || volSurge >= 1.1,          // Trending OR volume surge
  ];

  const bullScore = bullConditions.filter(Boolean).length;
  const bearScore = bearConditions.filter(Boolean).length;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";

  // Lower threshold: 3/6 with strong momentum override (vs 4/6 for MCX Evening)
  // Strong momentum override: if ROC10 > 0.5% AND EMA slope confirms, enter with just 3 conditions
  const strongMomentumBull = roc10 > 0.005 && emaSlope > 0.001 && e9 > e21;
  const strongMomentumBear = roc10 < -0.005 && emaSlope < -0.001 && e9 < e21;

  if ((bullScore >= 4 || (bullScore >= 3 && strongMomentumBull)) && bullScore > bearScore) {
    // Don't enter at absolute day high (range exhaustion)
    if (pricePos > 0.95) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[MCXLate] At day high — range exhausted (${(pricePos * 100).toFixed(0)}%)`, layer: "None", isMCXLateSession: true };
    }
    direction = "BUY";
    confidence = Math.min(0.93, 0.60 + bullScore * 0.06 + Math.abs(roc10) * 30 + (adx > 25 ? 0.05 : 0));
    reason = `[MCXLate] Bullish momentum | ROC5:+${(roc5 * 100).toFixed(2)}% ROC10:+${(roc10 * 100).toFixed(2)}% | EMAslope:${(emaSlope * 100).toFixed(3)}% | ADX(${adx.toFixed(0)}) | Vol:${volSurge.toFixed(1)}x | Score:${bullScore}/6 | RSI(${rsi1m.toFixed(0)})`;
  } else if ((bearScore >= 4 || (bearScore >= 3 && strongMomentumBear)) && bearScore > bullScore) {
    // Don't enter at absolute day low
    if (pricePos < 0.05) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price + atr * slMultiplier, targetPrice: price - atr * tpMultiplier, atr, reason: `[MCXLate] At day low — range exhausted (${(pricePos * 100).toFixed(0)}%)`, layer: "None", isMCXLateSession: true };
    }
    direction = "SELL";
    confidence = Math.min(0.93, 0.60 + bearScore * 0.06 + Math.abs(roc10) * 30 + (adx > 25 ? 0.05 : 0));
    reason = `[MCXLate] Bearish momentum | ROC5:${(roc5 * 100).toFixed(2)}% ROC10:${(roc10 * 100).toFixed(2)}% | EMAslope:${(emaSlope * 100).toFixed(3)}% | ADX(${adx.toFixed(0)}) | Vol:${volSurge.toFixed(1)}x | Score:${bearScore}/6 | RSI(${rsi1m.toFixed(0)})`;
  }

  if (direction === "HOLD") {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[MCXLate] No momentum setup | Bull:${bullScore} Bear:${bearScore} | ROC10:${(roc10 * 100).toFixed(2)}% | ADX(${adx.toFixed(0)}) | Recent:${recentMovePercent.toFixed(2)}%`, layer: "None", isMCXLateSession: true };
  }

  const slPrice = direction === "BUY" ? price - atr * slMultiplier : price + atr * slMultiplier;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;
  return { direction, confidence, entryPrice: price, slPrice, targetPrice, atr, reason, layer: "MCXLateSession", isMCXLateSession: true };
}
// ── Hero Zero Signal (Expiry-day OTM options) ────────────────────────────────
/**
 * Hero Zero: buy deep OTM options on weekly expiry day when premium is ₹2–50.
 * Target: 5× premium. Cut: 50% loss. Window: 11:00 AM – 1:30 PM IST.
 * Works on NIFTY and BANKNIFTY weekly expiry options.
 *
 * NOTE: This function receives the current OTM option premium as `price`
 * (i.e., candles1m are the option's own 1m candles, not the index).
 * The caller must pass the underlying index candles separately for direction.
 */
export function generateHeroZeroSignal(
  optionPremium: number,       // current OTM option premium (₹)
  underlyingCandles: Candle[], // index 1m candles for direction bias
  optionType: "CE" | "PE",     // call or put
  strikeDistance: number,      // how far OTM in points (e.g., 200 for Nifty)
  slMultiplier = 1.0,
): Signal {
  // Entry filter: premium must be ₹2–50 (deep OTM, near-zero)
  if (optionPremium < 2 || optionPremium > 50) {
    return { direction: "HOLD", confidence: 0, entryPrice: optionPremium, slPrice: optionPremium * 0.5, targetPrice: optionPremium * 5, atr: 0, reason: `[HeroZero] Premium ₹${optionPremium.toFixed(1)} outside ₹2–50 range`, layer: "None", isHeroZero: true };
  }

  if (underlyingCandles.length < 20) {
    return { direction: "HOLD", confidence: 0, entryPrice: optionPremium, slPrice: optionPremium * 0.5, targetPrice: optionPremium * 5, atr: 0, reason: "[HeroZero] Insufficient underlying data", layer: "None", isHeroZero: true };
  }

  const closes = underlyingCandles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const e9arr = ema(closes, 9);
  const e21arr = ema(closes, 21);
  const e9 = e9arr[e9arr.length - 1];
  const e21 = e21arr[e21arr.length - 1];
  const macd = calcMACD(closes);
  const price = closes[closes.length - 1];

  // Volume surge in last 10 candles
  const avgVol = underlyingCandles.reduce((a, c) => a + c.volume, 0) / underlyingCandles.length;
  const last10Vol = underlyingCandles.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const volSurge = avgVol > 0 ? last10Vol / avgVol : 1;

  // Strike distance filter: 1–5% OTM for Nifty (50pt = 0.2%, 500pt = 2%)
  const otmPct = (strikeDistance / price) * 100;
  if (otmPct > 5) {
    return { direction: "HOLD", confidence: 0, entryPrice: optionPremium, slPrice: optionPremium * 0.5, targetPrice: optionPremium * 5, atr: 0, reason: `[HeroZero] Strike too far OTM (${otmPct.toFixed(1)}% > 5%)`, layer: "None", isHeroZero: true };
  }

  // Direction check: CE needs bullish underlying, PE needs bearish
  const isBullish = e9 > e21 && rsi > 52 && macd.histogram > 0;
  const isBearish = e9 < e21 && rsi < 48 && macd.histogram < 0;

  const directionOk = optionType === "CE" ? isBullish : isBearish;
  if (!directionOk) {
    return { direction: "HOLD", confidence: 0, entryPrice: optionPremium, slPrice: optionPremium * 0.5, targetPrice: optionPremium * 5, atr: 0, reason: `[HeroZero] ${optionType} direction not confirmed | RSI:${rsi.toFixed(0)} | EMA:${e9 > e21 ? "bull" : "bear"} | MACD:${macd.histogram > 0 ? "+" : "-"}`, layer: "None", isHeroZero: true };
  }

  // Confidence: based on how strongly directional + volume
  const baseConf = 0.55;
  const volBonus = volSurge >= 1.5 ? 0.1 : volSurge >= 1.2 ? 0.05 : 0;
  const rsiBonus = optionType === "CE" ? Math.max(0, (rsi - 52) / 100) : Math.max(0, (48 - rsi) / 100);
  const confidence = Math.min(0.90, baseConf + volBonus + rsiBonus);

  const direction = "BUY"; // Hero Zero is always a buy (buying cheap OTM option)
  const reason = `[HeroZero] ${optionType} ₹${optionPremium.toFixed(1)} | OTM:${otmPct.toFixed(1)}% | RSI:${rsi.toFixed(0)} | VolSurge:${volSurge.toFixed(1)}x | Target:₹${(optionPremium * 5).toFixed(0)} | Cut:₹${(optionPremium * 0.5).toFixed(0)}`;

  return {
    direction,
    confidence,
    entryPrice: optionPremium,
    slPrice: optionPremium * 0.5,          // 50% loss cut
    targetPrice: optionPremium * 5,        // 5× target
    atr: optionPremium * 0.2,             // ATR proxy for options
    reason,
    layer: "HeroZero",
    isHeroZero: true,
    // Do NOT set partial1RPrice/partial2RPrice here — let the trade-open code use configurable state.partial1Pct/partial2Pct
  };
}

// ── Opening Burst Strategy (9:15-9:25 AM IST) ────────────────────────────────
// V2: Captures the biggest move of the day — the opening gap follow-through.
// PREMIUM-BASED RULES (options move 5-10x at open due to gamma + IV):
// 1. Gap must be > 0.2% from previous close (skip flat opens < 0.1%)
// 2. Wait for 2nd/3rd candle confirmation: body > 70% of range AND move > 0.3% from open
// 3. Direction must align with gap direction (gap-aligned filter)
// 4. Candle contradiction filter: first 2 candles must NOT contradict (1 green + 1 red = skip)
// 5. Target: 80-100% premium gain (NOT ATR-based — options move differently at open)
// 6. SL: 30% premium drop (fixed %, NOT ATR-based)
// 7. Full exit at target — NO partial booking (moves happen in 2-3 min, reversals violent)
// 8. Time limit: 10 minutes max. If not at target by 9:25, close at market.
// 9. Only 1 trade per day in this window (win or lose, done)
// 10. VIX > 20 = skip (whipsaws more likely)
export function generateOpeningBurstSignal(
  candles: Candle[],
  prevDayClose: number,
  slMultiplier = 1.5,
  vixValue = 0,
): Signal {
  const hold: Signal = { direction: "HOLD", confidence: 0, entryPrice: 0, slPrice: 0, targetPrice: 0, atr: 0, reason: "Opening Burst: waiting", layer: "OpeningBurst" };

  if (!candles || candles.length < 2 || prevDayClose <= 0) {
    return { ...hold, reason: "Opening Burst: insufficient data" };
  }

  // VIX filter: skip if VIX > 20 (whipsaws more likely)
  if (vixValue > 20) {
    return { ...hold, reason: `Opening Burst: VIX too high (${vixValue.toFixed(1)} > 20) — whipsaw risk` };
  }

  // Day open = first candle's open price
  const dayOpen = candles[0].open;
  if (dayOpen <= 0) return { ...hold, reason: "Opening Burst: invalid day open" };

  // Calculate gap
  const gapPct = (dayOpen - prevDayClose) / prevDayClose;
  const absGap = Math.abs(gapPct);

  // Safety: skip flat opens (< 0.1% gap = no burst)
  if (absGap < 0.001) {
    return { ...hold, reason: `Opening Burst: flat open (gap ${(gapPct * 100).toFixed(3)}% < 0.1%)` };
  }

  // Minimum gap filter: require > 0.2% for trade
  if (absGap < 0.002) {
    return { ...hold, reason: `Opening Burst: gap too small (${(gapPct * 100).toFixed(3)}% < 0.2%)` };
  }

  const gapDirection: "BUY" | "SELL" = gapPct > 0 ? "BUY" : "SELL";

  // Candle contradiction filter: first 2 candles must agree on direction
  // If candle 1 is green and candle 2 is red (or vice versa), skip — confusion signal
  if (candles.length >= 2) {
    const c1Bullish = candles[0].close > candles[0].open;
    const c2Bullish = candles[1].close > candles[1].open;
    if (c1Bullish !== c2Bullish) {
      return { ...hold, reason: "Opening Burst: candle contradiction (1 green + 1 red = confusion)" };
    }
  }

  // Look for confirmation candle (2nd or 3rd candle — don't trade candle 1)
  // Confirmation: body > 70% of range AND cumulative move > 0.3% from day open AND gap-aligned
  let confirmationCandle: Candle | null = null;
  let bodyRatio = 0;

  for (let i = 1; i < Math.min(candles.length, 5); i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range <= 0) continue;

    const ratio = body / range;
    const cumMove = Math.abs(c.close - dayOpen) / dayOpen;

    if (ratio >= 0.70 && cumMove >= 0.003) {
      // Check direction alignment with gap
      const candleBullish = c.close > c.open;
      const gapAligned = (gapDirection === "BUY" && candleBullish) || (gapDirection === "SELL" && !candleBullish);

      if (gapAligned) {
        confirmationCandle = c;
        bodyRatio = ratio;
        break;
      }
    }
  }

  if (!confirmationCandle) {
    return { ...hold, reason: "Opening Burst: no confirmation candle (body<70% or move<0.3% or not gap-aligned)" };
  }

  // Entry on close of confirmation candle
  const entryPrice = confirmationCandle.close;
  const isBullish = confirmationCandle.close > confirmationCandle.open;
  const direction: "BUY" | "SELL" = isBullish ? "BUY" : "SELL";

  // Confidence: map body ratio (0.70-1.0) to confidence (0.80-0.95)
  // Require 80%+ confidence threshold (only strong bursts)
  const confidence = Math.min(0.80 + (bodyRatio - 0.70) * 0.67, 1.0);

  // PREMIUM-BASED exits (NOT ATR-based — options move differently at open):
  // Target: 80-100% premium gain → index move ~0.4-0.5% (gamma amplifies at open)
  // SL: 30% premium drop → index move ~0.15%
  // These are FIXED percentages because ATR hasn't formed yet at 9:15
  const targetMove = 0.004; // 0.4% index move ≈ 80-100% premium gain at open
  const slMove = 0.0015; // 0.15% index move ≈ 30% premium drop

  let targetPrice: number;
  let slPrice: number;

  if (isBullish) {
    targetPrice = entryPrice * (1 + targetMove);
    slPrice = entryPrice * (1 - slMove);
  } else {
    targetPrice = entryPrice * (1 - targetMove);
    slPrice = entryPrice * (1 + slMove);
  }

  const atr = calcATR(candles);

  return {
    direction,
    confidence,
    entryPrice,
    slPrice,
    targetPrice,
    atr,
    reason: `Opening Burst: gap ${(gapPct * 100).toFixed(2)}% ${gapDirection === "BUY" ? "↑" : "↓"} | body ${(bodyRatio * 100).toFixed(0)}% | conf ${(confidence * 100).toFixed(0)}%`,
    layer: "OpeningBurst",
  };
}

// ── Fetch 1-min candles from Upstox ───────────────────────────────────────────
export async function fetchUpstoxCandles(instrumentToken: string, accessToken?: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const resp = await axios.get(url, { headers, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })).reverse(); // Upstox returns descending order — reverse to ascending
  } catch { return []; }
}

// ── Fetch daily candles from Upstox (last 7 days) ───────────────────────────
async function fetchUpstoxDayCandles(instrumentToken: string, accessToken?: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const toDate = new Date().toISOString().split("T")[0];
    const fromDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0];
    const url = `https://api.upstox.com/v2/historical-candle/${encoded}/day/${toDate}/${fromDate}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const resp = await axios.get(url, { headers, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })).reverse(); // Upstox returns descending — reverse to ascending
  } catch { return []; }
}

// ── Fetch 5-min candles from Upstox ──────────────────────────────────────────
export async function fetchUpstox5mCandles(instrumentToken: string, accessToken?: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/5minute`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const resp = await axios.get(url, { headers, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })).reverse(); // Upstox returns descending — reverse to ascending
  } catch { return []; }
}

// ── Fetch full quote ──────────────────────────────────────────────────────────
export async function fetchFullQuote(instrumentToken: string, accessToken: string): Promise<{ ltp: number; bid: number; ask: number } | null> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encoded}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 5000 });
    const data = resp.data?.data?.[instrumentToken] ?? resp.data?.data?.[Object.keys(resp.data?.data ?? {})[0]];
    if (!data) return null;
    const ltp = data.last_price ?? 0;
    const bid = data.depth?.buy?.[0]?.price ?? ltp;
    const ask = data.depth?.sell?.[0]?.price ?? ltp;
    return { ltp, bid, ask };
  } catch { return null; }
}

// ── Mock price generator ──────────────────────────────────────────────────────
const mockPrices: Record<string, number> = {
  RELIANCE: 2950, NIFTY: 24800, BANKNIFTY: 53200, FINNIFTY: 23500, MIDCPNIFTY: 12800,
  NIFTY_CE: 120, NIFTY_PE: 95, BNF_CE: 250, BNF_PE: 200,
  NIFTY_FUT: 24820, BNF_FUT: 53250,
  MCX_GOLD: 117700, MCX_SILVER: 98500, MCX_CRUDEOIL: 6650, MCX_NATGAS: 310,
  MCX_COPPER: 850, MCX_ZINC: 275, MCX_ALUMINIUM: 235, MCX_LEAD: 190, MCX_NICKEL: 1580,
  // MCX option premiums (paper-mode mock prices)
  MCX_GOLD_CE: 320, MCX_GOLD_PE: 280,
  MCX_SILVER_CE: 1800, MCX_SILVER_PE: 1500,
  MCX_CRUDE_CE: 85, MCX_CRUDE_PE: 70,
  MCX_NATGAS_CE: 8, MCX_NATGAS_PE: 6,
  MCX_COPPER_CE: 12, MCX_COPPER_PE: 10,
  MCX_ZINC_CE: 4, MCX_ZINC_PE: 3,
  INFY: 1780, TCS: 3920, HDFC: 1740, ITC: 465, SBIN: 820, TATAMOTORS: 960, TATASTEEL: 165,
  SENSEX: 81500,
};

function buildMockCandle(symbol: string): Candle {
  const base = mockPrices[symbol] ?? 1000;
  const change = (Math.random() - 0.48) * base * 0.003;
  const close = parseFloat((base + change).toFixed(2));
  mockPrices[symbol] = close;
  const range = close * 0.004;
  return {
    open: parseFloat((close - range * Math.random()).toFixed(2)),
    high: parseFloat((close + range * Math.random()).toFixed(2)),
    low: parseFloat((close - range * Math.random()).toFixed(2)),
    close, volume: Math.floor(50000 + Math.random() * 100000), timestamp: Date.now(),
  };
}

function build5mFromMock(candles1m: Candle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 4 < candles1m.length; i += 5) {
    const slice = candles1m.slice(i, i + 5);
    result.push({
      open: slice[0].open, high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)), close: slice[slice.length - 1].close,
      volume: slice.reduce((a, c) => a + c.volume, 0), timestamp: slice[0].timestamp,
    });
  }
  return result;
}

// ── Fetch option chain and resolve ATM/OTM CE/PE token ─────────────────────────
export async function resolveAtmOptionToken(
  underlyingToken: string,
  optionType: "CE" | "PE",
  accessToken: string,
): Promise<ResolvedOption | null> {
  try {
    // Step 1: get current underlying price
    const quoteResp = await axios.get(
      `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(underlyingToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 6000 },
    );
    const qData = quoteResp.data?.data;
    const qKey = qData ? Object.keys(qData)[0] : null;
    const underlyingPrice: number = qKey ? (qData[qKey]?.last_price ?? 0) : 0;
    if (!underlyingPrice) return null;

    // Step 2: fetch option chain (current week expiry — auto-rolls after each expiry)
    let chainData: Array<{
      expiry?: string;
      strike_price?: number;
      underlying_spot_price?: number;
      call_options?: { instrument_key?: string; market_data?: { ltp?: number } };
      put_options?: { instrument_key?: string; market_data?: { ltp?: number } };
    }> = [];

    // BankNifty no longer has weekly expiry (discontinued 2024). Nifty has weekly (Tuesday).
    // Strategy: BankNifty → current_month first; Nifty → current_week first; both fall through all options.
    const isBankNifty = underlyingToken.toLowerCase().includes("nifty bank") || underlyingToken.toLowerCase().includes("banknifty");
    const expiryOrder = isBankNifty
      ? ["current_month", "next_month"]
      : ["current_week", "next_week", "current_month", "next_month"];

    for (const expiry of expiryOrder) {
      try {
        const resp = await axios.get(
          `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(underlyingToken)}&expiry_date=${expiry}`,
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 10000 },
        );
        chainData = resp.data?.data ?? [];
        if (chainData.length > 0) {
          console.log(`[BotEngine] resolveAtmOptionToken: found ${chainData.length} contracts for ${underlyingToken} (${expiry})`);
          break;
        }
        console.warn(`[BotEngine] resolveAtmOptionToken: empty chain for ${underlyingToken} (${expiry}). Trying next...`);
      } catch (e) {
        console.warn(`[BotEngine] resolveAtmOptionToken: error fetching ${expiry} for ${underlyingToken}:`, e instanceof Error ? e.message : String(e));
      }
    }
    if (chainData.length === 0) {
      console.warn(`[BotEngine] resolveAtmOptionToken: no options found after trying all expiries (${expiryOrder.join(', ')}) for ${underlyingToken}`);
      return null;
    }

    const chainExpiry: string | undefined = chainData[0]?.expiry ?? undefined;

    // NOTE: Same-day expiry is ALLOWED — expiry day has highest gamma = biggest moves for scalping.
    // The key is tighter SL + faster exit on expiry day, not avoiding it entirely.
    if (chainExpiry) {
      console.log(`[BotEngine] NSE: using chain expiry ${chainExpiry} (same-day expiry allowed for high-gamma scalping)`);
    }

    // Upstox API returns data[] as flat array: each element = { strike_price, call_options: {obj}, put_options: {obj} }
    // Build sorted list of valid options by distance from underlying price
    const sorted = chainData
      .filter(row => {
        const opt = optionType === "CE" ? row.call_options : row.put_options;
        return opt?.instrument_key && (opt?.market_data?.ltp ?? 0) > 0.5;
      })
      .map(row => {
        const opt = (optionType === "CE" ? row.call_options : row.put_options)!;
        return {
          strike: row.strike_price ?? 0,
          token: opt.instrument_key!,
          premium: opt.market_data?.ltp ?? 0,
          dist: Math.abs((row.strike_price ?? 0) - underlyingPrice),
        };
      })
      .sort((a, b) => a.dist - b.dist);

    if (sorted.length === 0) {
      console.warn(`[BotEngine] resolveAtmOptionToken: no valid options in chain for ${underlyingToken} ${optionType}`);
      return null;
    }

    // Strategy: pick 1 strike OTM for lower premium (better lot sizing & profit potential).
    // For CE: 1 strike ABOVE ATM. For PE: 1 strike BELOW ATM.
    // If OTM not available or premium too low (<5), fall back to ATM.
    const atm = sorted[0]; // closest to spot

    // Find 1-strike OTM candidates
    const otmCandidates = sorted.filter(s => {
      if (optionType === "CE") return s.strike > atm.strike;
      return s.strike < atm.strike;
    }).sort((a, b) => {
      if (optionType === "CE") return a.strike - b.strike; // smallest above ATM
      return b.strike - a.strike; // largest below ATM
    });

    let best: ResolvedOption | null = null;
    const otm1 = otmCandidates[0]; // 1 strike OTM

    if (otm1 && otm1.premium >= 5) {
      // Use 1-OTM: lower premium = more lots = better profit potential
      best = { token: otm1.token, premium: otm1.premium, strike: otm1.strike, expiry: chainExpiry };
      console.log(`[BotEngine] Selected 1-OTM ${optionType}: strike ${otm1.strike} premium Rs${otm1.premium.toFixed(1)} (ATM was ${atm.strike} @ Rs${atm.premium.toFixed(1)})`);
    } else {
      // Fallback to ATM if OTM is illiquid
      best = { token: atm.token, premium: atm.premium, strike: atm.strike, expiry: chainExpiry };
      console.log(`[BotEngine] Selected ATM ${optionType}: strike ${atm.strike} premium Rs${atm.premium.toFixed(1)}`);
    }
    return best;
  } catch (err) {
    console.error("[BotEngine] resolveAtmOptionToken failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
// ── MCX: Resolve front-month futures instrument_key ─────────────────────────
// MCX futures tokens are numeric IDs that change every month (e.g. MCX_FO|226593).
// Placeholder tokens like MCX_FO|GOLDM (no numeric ID) must be resolved before use.
// This function works WITHOUT an access token by downloading the public Upstox instruments JSON.
async function resolveMcxFuturesToken(
  symbol: string,
  accessToken?: string | null,
): Promise<string | null> {
  // Method 1: Try Upstox instruments search API (requires auth)
  if (accessToken) {
    try {
      const url = `https://api.upstox.com/v2/instruments/search` +
        `?query=${encodeURIComponent(symbol)}` +
        `&exchanges=MCX&segments=COMM&instrument_types=FUTCOM` +
        `&expiry=current_month&records=10`;
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        timeout: 8000,
      });
      const items: Array<{ instrument_key: string; trading_symbol: string }> =
        resp.data?.data ?? [];
      const match = items.find(i =>
        i.trading_symbol.toUpperCase().startsWith(symbol.toUpperCase())
      );
      if (match) {
        console.log(`[BotEngine] Resolved MCX futures token (API): ${symbol} → ${match.instrument_key} (${match.trading_symbol})`);
        return match.instrument_key;
      }
    } catch (err) {
      console.warn(`[BotEngine] resolveMcxFuturesToken API failed for ${symbol}:`, err instanceof Error ? err.message : String(err));
    }
  }
  // Method 2: Download public Upstox instruments JSON (no auth needed)
  // NOTE: MCX instruments JSON has empty trading_symbol but populated 'name' field.
  // Match by name (e.g. symbol="CRUDEOIL" matches name="CRUDE OIL", symbol="GOLD" matches name="GOLD").
  try {
    const instruments = await getMcxInstruments();
    const now = Date.now();
    // Build a normalized name from symbol for matching:
    // CRUDEOIL → CRUDE OIL, NATURALGAS → NATURALGAS, GOLD → GOLD, SILVER → SILVER
    const normalizedSymbol = symbol.toUpperCase()
      .replace('CRUDEOIL', 'CRUDE OIL')
      .replace('CRUDEOILM', 'CRUDE OIL MINI');
    const futures = instruments.filter(x =>
      x.instrument_type === "FUT" &&
      (x.expiry ?? 0) > now &&
      (x.name ?? "").toUpperCase() === normalizedSymbol
    );
    futures.sort((a, b) => (a.expiry ?? 0) - (b.expiry ?? 0));
    if (futures.length > 0) {
      console.log(`[BotEngine] Resolved MCX futures token (instruments JSON): ${symbol} → ${futures[0].instrument_key} (name=${futures[0].name})`);
      return futures[0].instrument_key;
    }
    // Fallback: partial name match
    const partialFutures = instruments.filter(x =>
      x.instrument_type === "FUT" &&
      (x.expiry ?? 0) > now &&
      (x.name ?? "").toUpperCase().includes(symbol.replace('CRUDEOIL','CRUDE').toUpperCase())
    );
    partialFutures.sort((a, b) => (a.expiry ?? 0) - (b.expiry ?? 0));
    if (partialFutures.length > 0) {
      console.log(`[BotEngine] Resolved MCX futures token (partial match): ${symbol} → ${partialFutures[0].instrument_key} (name=${partialFutures[0].name})`);
      return partialFutures[0].instrument_key;
    }
  } catch (err) {
    console.error(`[BotEngine] resolveMcxFuturesToken instruments JSON failed for ${symbol}:`, err instanceof Error ? err.message : String(err));
  }
  return null;
}

// ── MCX: Resolve ATM option using /v2/option/contract (MCX-specific path) ────
// Note: /v2/option/chain does NOT work for MCX. Use /v2/option/contract instead.
// ── MCX instruments JSON cache (shared by futures + options resolvers) ───────
interface McxInstrumentRow {
  instrument_key: string;
  trading_symbol?: string;
  name?: string;
  instrument_type?: string;
  strike_price?: number;
  expiry?: number;
  lot_size?: number;
  underlying_key?: string;
}
let mcxInstrumentsCache: McxInstrumentRow[] | null = null;
let mcxInstrumentsCacheAt = 0;
const MCX_INSTRUMENTS_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

async function getMcxInstruments(): Promise<McxInstrumentRow[]> {
  if (mcxInstrumentsCache && Date.now() - mcxInstrumentsCacheAt < MCX_INSTRUMENTS_CACHE_MS) {
    return mcxInstrumentsCache;
  }
  const resp = await axios.get("https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz", {
    responseType: "arraybuffer",
    timeout: 20000,
  });
  const { gunzipSync } = await import("zlib");
  const json = gunzipSync(Buffer.from(resp.data));
  mcxInstrumentsCache = JSON.parse(json.toString()) as McxInstrumentRow[];
  mcxInstrumentsCacheAt = Date.now();
  console.log(`[BotEngine] MCX instruments JSON cached: ${mcxInstrumentsCache.length} rows`);
  return mcxInstrumentsCache;
}

export interface ResolvedOption {
  token: string;
  premium: number;
  strike: number;
  expiry?: string;       // YYYY-MM-DD
  lotSize?: number;
  tradingSymbol?: string;
}

export async function resolveAtmMcxOptionToken(
  futuresToken: string,
  optionType: "CE" | "PE",
  accessToken: string,
): Promise<ResolvedOption | null> {
  try {
    // Step 1: get current futures price
    const quoteResp = await axios.get(
      `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(futuresToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 6000 },
    );
    const qData = quoteResp.data?.data;
    const qKey = qData ? Object.keys(qData)[0] : null;
    const underlyingPrice: number = qKey ? (qData[qKey]?.last_price ?? 0) : 0;
    if (!underlyingPrice) {
      console.warn(`[BotEngine] resolveAtmMcxOptionToken: could not fetch futures LTP for ${futuresToken} (token may be expired)`);
      return null;
    }

    // Step 2 (PRIMARY): Use the public MCX instruments JSON — it lists every live
    // option contract with its REAL expiry, strike, lot size, and underlying_key
    // linking it directly to the futures contract. No expiry guessing needed.
    // (Previous approach guessed Tuesdays — but e.g. Crude Oil options expire on
    //  a Thursday, so every guess failed and trades were wrongly skipped.)
    try {
      const instruments = await getMcxInstruments();
      const nowMs = Date.now();
      const candidates = instruments.filter(x =>
        x.underlying_key === futuresToken &&
        (x.instrument_type ?? "").toUpperCase() === optionType &&
        (x.expiry ?? 0) > nowMs,
      );
      // FALLBACK: If no options match the exact underlying_key (e.g., SILVER100 has no options,
      // only SILVER/SILVERM do), try matching by commodity name instead.
      let optionCandidates = candidates;
      let effectiveUnderlyingPrice = underlyingPrice; // May be overridden if price scales differ
      if (optionCandidates.length === 0) {
        // Find the name of the futures contract we're using
        const futuresRow = instruments.find(x => x.instrument_key === futuresToken);
        const commodityName = futuresRow?.name?.toUpperCase() ?? "";
        if (commodityName) {
          // Match all options with the same commodity name (e.g., "SILVER", "NATURALGAS")
          optionCandidates = instruments.filter(x =>
            (x.name ?? "").toUpperCase() === commodityName &&
            (x.instrument_type ?? "").toUpperCase() === optionType &&
            (x.expiry ?? 0) > nowMs,
          );
          if (optionCandidates.length > 0) {
            console.log(`[BotEngine] MCX: exact underlying_key match failed for ${futuresToken}, using name-based fallback (${commodityName}): found ${optionCandidates.length} options`);
            // The options may be linked to a different futures contract with a different price scale
            // (e.g., SILVER100 is per 10g ~₹2163, but SILVER options use per-KG strikes ~₹99,500)
            // Fetch the ACTUAL underlying price that the options are based on
            const optionsUnderlyingKey = optionCandidates[0].underlying_key;
            if (optionsUnderlyingKey && optionsUnderlyingKey !== futuresToken) {
              try {
                const ulResp = await axios.get(
                  `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(optionsUnderlyingKey)}`,
                  { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 6000 },
                );
                const ulData = ulResp.data?.data;
                const ulKey = ulData ? Object.keys(ulData)[0] : null;
                const realUlPrice: number = ulKey ? (ulData[ulKey]?.last_price ?? 0) : 0;
                if (realUlPrice > 0) {
                  console.log(`[BotEngine] MCX: options underlying ${optionsUnderlyingKey} price = ₹${realUlPrice} (bot futures price was ₹${underlyingPrice})`);
                  effectiveUnderlyingPrice = realUlPrice;
                }
              } catch (ulErr) {
                console.warn(`[BotEngine] MCX: could not fetch options underlying price, using bot futures price for ATM matching`);
              }
            }
          }
        }
      }
      if (optionCandidates.length > 0) {
        // NOTE: Same-day expiry is ALLOWED — expiry day has highest gamma = biggest moves for scalping.
        // MCX options on expiry day have maximum gamma → fast premium moves → ideal for scalping.
        const nearestExpiry = Math.min(...optionCandidates.map(c => c.expiry ?? Infinity));
        const chain = optionCandidates
          .filter(c => c.expiry === nearestExpiry)
          .sort((a, b) => Math.abs((a.strike_price ?? 0) - effectiveUnderlyingPrice) - Math.abs((b.strike_price ?? 0) - effectiveUnderlyingPrice));
        // Take the 4 strikes closest to ATM and fetch their live premiums in one call
        const near = chain.slice(0, 4).filter(c => c.instrument_key);
        if (near.length > 0) {
          const keys = near.map(c => c.instrument_key).join(",");
          const optQuoteResp = await axios.get(
            `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(keys)}`,
            { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 },
          );
          const oqData: Record<string, { last_price?: number; instrument_token?: string }> = optQuoteResp.data?.data ?? {};
          // Map premiums back to candidates (response keys use trading-symbol format like "MCX_FO:CRUDEOIL 6900 CE 16 JUL 26")
          const premiumByToken = new Map<string, number>();
          for (const v of Object.values(oqData)) {
            if (v?.instrument_token) premiumByToken.set(v.instrument_token, v.last_price ?? 0);
          }
          for (const c of near) {
            const premium = premiumByToken.get(c.instrument_key) ?? 0;
            if (premium > 0.5) {
              const expDate = new Date(c.expiry!);
              const expiryStr = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, "0")}-${String(expDate.getDate()).padStart(2, "0")}`;
              console.log(`[BotEngine] MCX ATM ${optionType} resolved (instruments JSON): ${c.trading_symbol} | strike ${c.strike_price}, premium ₹${premium.toFixed(2)}, expiry ${expiryStr}, lot ${c.lot_size}`);
              return {
                token: c.instrument_key,
                premium,
                strike: c.strike_price ?? 0,
                expiry: expiryStr,
                lotSize: c.lot_size,
                tradingSymbol: c.trading_symbol,
              };
            }
          }
          console.warn(`[BotEngine] MCX ${optionType}: found ${near.length} ATM contracts but no live premium > 0.5 (market may be closed)`);
        }
      } else {
        console.warn(`[BotEngine] MCX instruments JSON: no live ${optionType} options with underlying_key=${futuresToken}`);
      }
    } catch (jsonErr) {
      console.warn(`[BotEngine] MCX instruments JSON path failed, falling back to contract API:`, jsonErr instanceof Error ? jsonErr.message : String(jsonErr));
    }

    // Step 3 (FALLBACK): /v2/option/contract without expiry guessing
    let contracts: Array<{
      instrument_key?: string;
      strike_price?: number;
      instrument_type?: string;
      expiry?: string;
      lot_size?: number;
      trading_symbol?: string;
      market_data?: { ltp?: number };
    }> = [];
    try {
      const fallbackResp = await axios.get(
        `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(futuresToken)}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 },
      );
      contracts = fallbackResp.data?.data ?? [];
      if (contracts.length > 0) {
        console.log(`[BotEngine] MCX option contracts found via contract API fallback: ${contracts.length}`);
      }
    } catch (apiErr) {
      console.warn(`[BotEngine] contract API fallback also failed:`, apiErr instanceof Error ? apiErr.message : String(apiErr));
    }

    // Filter by option type (CE or PE) and find ATM strike
    const filtered = contracts.filter(c =>
      (c.instrument_type ?? "").toUpperCase() === optionType
    );

    let best: ResolvedOption | null = null;
    let bestDist = Infinity;
    for (const opt of filtered) {
      const strike = opt.strike_price ?? 0;
      const dist = Math.abs(strike - underlyingPrice);
      const premium = opt.market_data?.ltp ?? 0;
      if (dist < bestDist && premium > 0.5 && opt.instrument_key) {
        bestDist = dist;
        best = { token: opt.instrument_key, premium, strike, expiry: opt.expiry, lotSize: opt.lot_size, tradingSymbol: opt.trading_symbol };
      }
    }
    if (best) {
      console.log(`[BotEngine] MCX ATM ${optionType} resolved: strike ${best.strike}, premium ₹${best.premium.toFixed(2)}, token: ${best.token}`);
    }
    return best;
  } catch (err) {
    console.error(`[BotEngine] resolveAtmMcxOptionToken(${futuresToken}) failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Place order via Upstox API ────────────────────────────────────────────────
// Last rejection reason per instrument — surfaced in activity log so the user
// sees the REAL Upstox error (e.g. lot size mismatch) instead of a generic message.
let lastOrderRejectionReason: string | null = null;
export function getLastOrderRejectionReason(): string | null {
  return lastOrderRejectionReason;
}

export async function placeUpstoxOrder(
  accessToken: string, instrumentToken: string, direction: "BUY" | "SELL", quantity: number,
): Promise<string | null> {
  try {
    const resp = await axios.post(
      "https://api.upstox.com/v3/order/place",
      { quantity, product: "I", validity: "DAY", price: 0, tag: "scalp-bot", instrument_token: instrumentToken, order_type: "MARKET", transaction_type: direction, disclosed_quantity: 0, trigger_price: 0, is_amo: false },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, timeout: 8000 }
    );
    lastOrderRejectionReason = null;
    return resp.data?.data?.order_id ?? null;
  } catch (err: unknown) {
    // Extract the REAL Upstox rejection reason from the error response body
    let reason = err instanceof Error ? err.message : String(err);
    if (axios.isAxiosError(err) && err.response?.data) {
      const body = err.response.data as { errors?: Array<{ message?: string; errorCode?: string; error_code?: string }> };
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        reason = body.errors.map(e => `${e.errorCode ?? e.error_code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
      }
    }
    lastOrderRejectionReason = reason;
    console.error(`[BotEngine] Order placement failed (${instrumentToken} ${direction} qty=${quantity}):`, reason);
    return null;
  }
}

// ── NSE lot size resolution (live, self-correcting) ─────────────────────────
// The option/chain API does NOT return lot_size, so we fetch it once per day per
// underlying from /v2/option/contract. Falls back to the shared static map.
const nseLotSizeCache = new Map<string, { lotSize: number; fetchedAt: number }>();
export async function resolveNseLotSize(underlyingToken: string, accessToken: string): Promise<number | null> {
  const cached = nseLotSizeCache.get(underlyingToken);
  if (cached && Date.now() - cached.fetchedAt < 12 * 3600 * 1000) return cached.lotSize;
  try {
    const resp = await axios.get(
      `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(underlyingToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 },
    );
    const contracts: Array<{ lot_size?: number; expiry?: string }> = resp.data?.data ?? [];
    // Use the nearest-expiry contract's lot size (revisions apply per-expiry)
    const withLot = contracts.filter(c => (c.lot_size ?? 0) > 0).sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
    const lot = withLot[0]?.lot_size ?? null;
    if (lot && lot > 0) {
      nseLotSizeCache.set(underlyingToken, { lotSize: lot, fetchedAt: Date.now() });
      console.log(`[BotEngine] resolveNseLotSize: ${underlyingToken} → lot ${lot} (live from Upstox)`);
      return lot;
    }
    return null;
  } catch (err) {
    console.warn("[BotEngine] resolveNseLotSize failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Bot tick ──────────────────────────────────────────────────────────────────
// Helper: format option contract label like "NIFTY 21JUL26 24100 PE" or "CRUDEOIL 20JUL26 7150 PE"
function formatOptionContractLabel(symbol: string, strike: number, ceOrPe: string, expiry?: string): string {
  // Clean up symbol: remove MCX_ prefix, use standard short names
  let sym = symbol.replace(/^MCX_/, "").replace(/_/g, "").toUpperCase();
  if (sym.includes("CRUDE") || sym.includes("OIL")) sym = "CRUDEOIL";
  else if (sym.includes("NATGAS") || sym.includes("GAS")) sym = "NATURALGAS";
  else if (sym.includes("BANKNIFTY")) sym = "BANKNIFTY";
  else if (sym.includes("FINNIFTY")) sym = "FINNIFTY";
  else if (sym.includes("NIFTY")) sym = "NIFTY";
  // Format expiry from YYYY-MM-DD to DDMMMYY
  let expiryStr = "";
  let effectiveExpiry = expiry;
  if (!effectiveExpiry) {
    // Estimate next weekly expiry: Thursday for NSE, last Thursday of month for MCX
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 4=Thu
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7; // next Thursday (or today if Thursday and before market close)
    const istHour = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
    const isThursdayBeforeClose = dayOfWeek === 4 && istHour < 16;
    const daysToAdd = isThursdayBeforeClose ? 0 : daysUntilThursday;
    const nextExpiry = new Date(now.getTime() + daysToAdd * 86400000);
    effectiveExpiry = nextExpiry.toISOString().slice(0, 10);
  }
  if (effectiveExpiry) {
    const d = new Date(effectiveExpiry + "T00:00:00Z");
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, "0");
      const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
      const mon = months[d.getUTCMonth()];
      const yr = String(d.getUTCFullYear()).slice(2);
      expiryStr = ` ${day}${mon}${yr}`;
    }
  }

  return `${sym}${expiryStr} ${strike} ${ceOrPe}`;
}

async function tick(
  state: BotState,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
  onTick?: (state: BotState) => Promise<void>,
) {
  if (state.status !== "running") { console.log(`[tick] SKIP — status=${state.status} (${state.sessionToken.slice(0,8)})`); return; }
  // Prevent overlapping ticks: if previous tick is still running (slow network, API timeout), skip
  if (state.tickInProgress) {
    console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — tick skipped (previous still running)`);
    return;
  }
  state.tickInProgress = true;
  console.log(`[tick] START — ${state.sessionToken.slice(0,8)} | status=${state.status} | candles=${state.candles.length} | openTrade=${!!state.openTrade}`);
  try {

  const maxDailyLoss = -(state.capital * state.dailyLossLimitPct) / 100;
  if (state.dailyPnl <= maxDailyLoss) {
    if ((state.tickCount ?? 0) <= 1) {
      // User manually started despite existing losses — warn but don't block
      console.warn(`[tick] ⚠ Daily loss limit already reached — ${state.sessionToken.slice(0,8)} | dailyPnl=₹${state.dailyPnl.toFixed(0)} | maxLoss=₹${maxDailyLoss.toFixed(0)} — Bot will only pause on NEW losses`);
      emitActivity(state.sessionToken, "error", `⚠ Daily loss limit already reached (₹${state.dailyPnl.toFixed(0)}). Bot will only pause on NEW losses.`);
      state.dailyLossAcknowledged = true;
    } else if (!state.dailyLossAcknowledged) {
      // New losses pushed past limit — pause
      console.warn(`[tick] 🛑 DAILY LOSS LIMIT HIT — ${state.sessionToken.slice(0,8)} | dailyPnl=₹${state.dailyPnl.toFixed(0)} | maxLoss=₹${maxDailyLoss.toFixed(0)} — PAUSING`);
      state.status = "paused";
      state.lastError = `Daily loss limit reached (₹${state.dailyPnl.toFixed(0)})`;
      emitActivity(state.sessionToken, "bot_stop", `🛑 Daily loss limit hit — P&L: ₹${state.dailyPnl.toFixed(0)} exceeds ₹${maxDailyLoss.toFixed(0)} limit`);
      // Telegram: critical alert for daily loss limit
      sendTelegramAlert(state,
        `🚨 <b>DAILY LOSS LIMIT HIT</b>\n` +
        `📊 <b>${state.instrumentLabel}</b>\n` +
        `💸 Day P&L: ₹${state.dailyPnl.toFixed(0)} | Limit: ₹${maxDailyLoss.toFixed(0)}\n` +
        `⏸ Bot PAUSED — no new trades until tomorrow\n` +
        `⚠️ Review positions and risk settings`
      , "criticalAlerts");
      return;
    }
  }

  // ── Options mode: determine which token to use for candle/signal vs which to trade ──
  // isOptionsMode = true when user selected an index (NIFTY/BANKNIFTY) and wants to trade options.
  // In this mode:
  //   - Candles + signals come from underlyingToken (the futures/index)
  //   - Orders are placed on optionTradeToken (the ATM CE or PE resolved from option chain)
  //   - lastPrice shown on Dashboard = underlying price (for context)
  //   - optionPremiumPrice = current option premium (used for quantity sizing)
  // isOptionsMode: triggered by isIndexOptions flag OR by presence of underlyingToken
  // When isIndexOptions=true, the instrument IS the underlying (NSE_INDEX|...) and we must
  // use it for signals while trading the ATM CE/PE option.
  const isOptionsMode = state.isIndexOptions || !!(state.underlyingToken);
  const signalToken = isOptionsMode && state.underlyingToken ? state.underlyingToken : state.instrumentToken;

  // Fetch candles + quote
  // The Upstox intraday candle API works WITHOUT authentication for NSE_INDEX and MCX_FO tokens.
  // Paper mode uses real candle data from Upstox — no access token needed.
  let newCandle: Candle;
  const [candles1m, candles5m, dayCandles, quote] = await Promise.all([
    fetchUpstoxCandles(signalToken, state.accessToken ?? undefined),
    fetchUpstox5mCandles(signalToken, state.accessToken ?? undefined),
    state.candlesDay.length < 2 ? fetchUpstoxDayCandles(signalToken, state.accessToken ?? undefined) : Promise.resolve(state.candlesDay),
    state.accessToken ? fetchFullQuote(signalToken, state.accessToken) : Promise.resolve(null),
  ]);
  if (candles1m.length > 0) {
    state.candles = candles1m.slice(-400); // full day
    newCandle = candles1m[candles1m.length - 1];
    state.candles5m = candles5m.length > 0 ? candles5m.slice(-80) : build5mFromMock(state.candles);
    if (dayCandles.length > 0) state.candlesDay = dayCandles.slice(-10);
    if (quote) { state.lastPrice = quote.ltp; state.bidPrice = quote.bid; state.askPrice = quote.ask; }
    else { state.lastPrice = newCandle.close; state.bidPrice = newCandle.close * 0.9999; state.askPrice = newCandle.close * 1.0001; }
  } else {
    // Real candle fetch returned empty — market closed, token error, or outside trading hours.
    // DO NOT generate fake/mock candles. Set HOLD signal and return early.
    // The bot will retry on the next tick interval.
    state.lastSignal = {
      direction: "HOLD", confidence: 0,
      entryPrice: state.lastPrice, slPrice: state.lastPrice, targetPrice: state.lastPrice, atr: 0,
      reason: "No real candle data — market closed or outside trading hours",
      layer: "None",
    };
    state.nextScanAt = Date.now() + state.scanIntervalSec * 1000;
    state.lastTickAt = Date.now();
    // Log to activity so the user can see the bot is alive and waiting for market data
    emitActivity(state.sessionToken, "signal",
      `⏳ Waiting for market data — token: ${signalToken} | Next scan in ${state.scanIntervalSec}s`);
    if (onTick) onTick(state).catch(() => {});
    // CRITICAL: If market is closed and there is an open trade, force square-off NOW.
    // This handles the case where server restarts after market close — candles are empty
    // but open trades must not carry overnight.
    if (state.openTrade) {
      const now3 = new Date();
      const istMin3 = ((now3.getUTCHours() * 60 + now3.getUTCMinutes()) + 330) % 1440;
      const isMCX3 = state.instrumentToken.startsWith("MCX");
      const sqOffMin3 = isMCX3 ? 23 * 60 + 28 : 15 * 60 + 25;
      if (istMin3 >= sqOffMin3 || (!isMCX3 && (istMin3 < 9 * 60 + 15))) {
        // Respect carry-forward: if user chose to hold overnight, skip force-close
        if (state.carryForward) {
          console.log(`[BotEngine] ${state.sessionToken} — carry forward active, skipping force-close (no candle data)`);
        } else {
        // Market is closed — force close the open trade at last known price
        const trade = state.openTrade;
        const exitPx = trade.isIndexOptions
          ? (state.optionPremiumPrice && state.optionPremiumPrice > 0 ? state.optionPremiumPrice : trade.entryPrice)
          : (state.lastPrice > 0 ? state.lastPrice : trade.entryPrice);
        const noDataRemQty = trade.quantity - (trade.bookedQty ?? 0);
        const remainderPnl = trade.direction === "BUY" ? (exitPx - trade.entryPrice) * noDataRemQty : (trade.entryPrice - exitPx) * noDataRemQty;
        // Only add bookedPnl if it wasn't already added to dailyPnl during this session
        const bookedPnlToAdd = trade.bookedPnlAddedToDaily ? 0 : (trade.bookedPnl ?? 0);
        let pnl = remainderPnl + bookedPnlToAdd;
        // Add only the remainder P&L to dailyPnl if bookedPnl was already counted
        if (trade.bookedPnlAddedToDaily) {
          state.dailyPnl += remainderPnl;
        } else {
          state.dailyPnl += pnl;
        }
        state.openTrade = null;
        if (pnl < 0) recordDirectionalLoss(state.sessionToken, trade.direction); else recordDirectionalWin(state.sessionToken, trade.direction);
        await onTradeClose(trade.dbId, exitPx, pnl, "Market Close — Auto Square-Off (no live data)");
        emitActivity(state.sessionToken, "trade_close", `⏰ Auto Square-Off (market closed) ${trade.symbolLabel} @ ₹${exitPx.toFixed(2)} | P\&L: ₹${pnl.toFixed(0)}`, { price: exitPx, pnl });
        console.log(`[BotEngine] ${state.sessionToken} — forced square-off (no candle data, market closed)`);
        // Telegram: auto square-off alert
        const sqPnlSign1 = pnl >= 0 ? "+" : "";
        sendTelegramAlert(state,
          `⏰ <b>AUTO SQUARE-OFF</b> (market closed)\n` +
          `📊 <b>${trade.symbolLabel}</b> | Exit: ₹${exitPx.toFixed(2)}\n` +
          `💰 P&L: ${sqPnlSign1}₹${pnl.toFixed(0)}\n` +
          `📈 Day P&L: ₹${state.dailyPnl.toFixed(0)} | Trades: ${state.tradesCount}`
        );
        }
      }
    }
    return;
  }

  const price = state.lastPrice;
  // Update lastTickAt so Dashboard can detect staleness
  state.lastTickAt = Date.now();

  console.log(`[tick] CANDLES OK — ${state.sessionToken.slice(0,8)} | price=${price} | candles1m=${state.candles.length} | 5m=${state.candles5m.length}`);

  // Persist live price to DB on every tick — fires regardless of open trade state
  // This is the primary mechanism for keeping the Dashboard current price updated
  if (onTick) onTick(state).catch(() => {});

  // Time calculations
  const now2 = new Date();
  const istMin2 = ((now2.getUTCHours() * 60 + now2.getUTCMinutes()) + 330) % (24 * 60);
  // ── Daily reset: detect new trading day and reset daily counters ──────────
  const istDate = new Date(now2.getTime() + 330 * 60000);
  const todayStr = istDate.toISOString().slice(0, 10);
  if (state.lastTradingDay && state.lastTradingDay !== todayStr) {
    // New trading day detected — reset daily counters
    state.dailyPnl = 0;
    state.tradesCount = 0;
    state.hourlyCloseSignalFired = false;
    state.isOpeningTrade = false; // Clear stale mutex from previous day
    state.lastTradeOpenedAt = undefined; // Clear cooldown from previous day
    state.status = "running"; // un-pause if paused from previous day limits
    state.lastError = null;
    state.alertsSent.clear(); // BUG-8 FIX: Clear daily alerts so Power Hour/MCX alerts re-fire each day
    state.openingBurstTradeTaken = false; // Reset Opening Burst for new day
    state.dailyLossAcknowledged = false; // Reset so new day's losses trigger pause correctly
    resetDailyState(state.sessionToken); // Clear StoplossGuard, portfolio halt, cooldowns
    resetDirectionStreak(state.sessionToken); // Clear same-direction loss streak
    emitActivity(state.sessionToken, "bot_start", `🌅 New trading day (${todayStr}) — daily counters reset`);
  }
  state.lastTradingDay = todayStr;
  const isMCX = state.instrumentToken.startsWith("MCX");
  const squareOffMin = isMCX ? 23 * 60 + 28 : 15 * 60 + 25;
  const stopScanMin  = isMCX ? 23 * 60 + 20 : 15 * 60 + 22; // MCX: stop new trades at 23:20, square-off at 23:28; NSE: stop at 15:22 (3 min buffer before square-off at 15:25)

  // NSE Power Hour: 3:00–3:25 PM IST (extended from 3:20 — the last 5 mins are prime institutional action)
  const powerHourStart = 15 * 60;
  const powerHourEnd   = 15 * 60 + 25;
  const inPowerHour = !isMCX && istMin2 >= powerHourStart && istMin2 < powerHourEnd;
  // Send Telegram alert when Power Hour window opens (once per session)
  if (inPowerHour && !state.alertsSent.has("powerHour")) {
    state.alertsSent.add("powerHour");
    const vwap = calcVWAP(state.candles);
    const dayHigh = Math.max(...state.candles.map(c => c.high));
    const dayLow  = Math.min(...state.candles.map(c => c.low));
    const side = price > vwap ? "↑ BULLISH" : "↓ BEARISH";
    const dayRange = dayHigh - dayLow;
    const dayTrend = price > vwap && price > (dayLow + dayRange * 0.6) ? "🟢 BULLISH" : price < vwap && price < (dayHigh - dayRange * 0.6) ? "🔴 BEARISH" : "🟡 NEUTRAL";
    const phScore = [price > vwap, dayRange > 0, state.candles5m.length >= 10].filter(Boolean).length;
    sendTelegramAlert(state,
      `⚡ <b>POWER HOUR ACTIVATED</b> ⚡\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${price.toFixed(2)}\n` +
      `📈 Day: H₹${dayHigh.toFixed(0)} / L₹${dayLow.toFixed(0)} / VWAP₹${vwap.toFixed(0)}\n` +
      `🧭 Trend: ${dayTrend} | ${side}\n` +
      `💯 Institutional Score: ${phScore}/3\n` +
      `⏰ Window: 3:00–3:20 PM IST | High-conviction institutional trades`,
    );
  }
  state.isPowerHourMode = inPowerHour;

  // EIA Crude Oil inventory: Wednesday ~8:00 PM IST — widen SL for Crude
  const isWednesday = now2.getUTCDay() === 3; // Wednesday UTC (IST Wed evening = UTC Wed)
  const isCrude = state.instrumentToken.includes("CRUDEOIL") || state.instrumentToken.includes("CRUDE");
  const isEIAWindow = isWednesday && istMin2 >= 19 * 60 + 55 && istMin2 <= 20 * 60 + 5;
  const isWednesdayCrude = isCrude && isEIAWindow;

  // MCX Evening Power Hour: 7:30–9:30 PM IST (US market open)
  const mcxEveningStart = 19 * 60 + 30;
  const mcxEveningEnd   = 21 * 60 + 30;
  const inMCXEvening = isMCX && istMin2 >= mcxEveningStart && istMin2 < mcxEveningEnd;
  // Send Telegram alert when MCX Evening window opens (once per session)
  if (inMCXEvening && !state.alertsSent.has("mcxEvening")) {
    state.alertsSent.add("mcxEvening");
    const eiaNote = isWednesdayCrude ? "\n⚠️ <b>EIA Wednesday</b> — SL widened 30% for Crude Oil" : "";
    sendTelegramAlert(state,
      `🌙 <b>MCX EVENING POWER HOUR</b> 🌙\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${price.toFixed(2)}\n` +
      `🇺🇸 US Market Open window: 7:30–9:30 PM IST\n` +
      `🔥 High-volatility institutional moves expected${eiaNote}`,
    );
  }
  state.isMCXEveningMode = inMCXEvening;
  // MCX Late Session: 9:30–11:20 PM IST (momentum continuation after US open settles)
  const mcxLateStart = 21 * 60 + 30;
  const mcxLateEnd   = 23 * 60 + 20; // same as stopScanMin for MCX
  const inMCXLateSession = isMCX && istMin2 >= mcxLateStart && istMin2 < mcxLateEnd;
  // Send Telegram alert when MCX Late Session window opens (once per session)
  if (inMCXLateSession && !state.alertsSent.has("mcxLateSession")) {
    state.alertsSent.add("mcxLateSession");
    sendTelegramAlert(state,
      `🌃 <b>MCX LATE SESSION</b> 🌃\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${price.toFixed(2)}\n` +
      `🔄 Momentum continuation window: 9:30–11:20 PM IST\n` +
      `📈 Tracking strong directional moves from US session`,
    );
  }
  state.isMCXLateSessionMode = inMCXLateSession;

  // ── Opening Burst Window: 9:15-9:25 AM IST (NSE only) ──────────────────────
  const openingBurstStart = 9 * 60 + 15; // 555 min
  const openingBurstEnd   = 9 * 60 + 25; // 565 min
  const inOpeningBurst = !isMCX && istMin2 >= openingBurstStart && istMin2 < openingBurstEnd
    && (state.openingBurstEnabled !== false) // default enabled
    && !state.openingBurstTradeTaken; // only 1 trade per day in this window
  state.openingBurstMode = inOpeningBurst;

  // Send Telegram alert when Opening Burst window opens (once per session)
  if (inOpeningBurst && !state.alertsSent.has("openingBurst")) {
    state.alertsSent.add("openingBurst");
    const prevDayC = state.candlesDay.length >= 2 ? state.candlesDay[state.candlesDay.length - 2]?.close ?? 0 : 0;
    const gapPct = prevDayC > 0 ? ((price - prevDayC) / prevDayC * 100).toFixed(2) : "?";
    sendTelegramAlert(state,
      `🚀 <b>OPENING BURST ACTIVATED</b> 🚀\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${price.toFixed(2)}\n` +
      `📈 Gap: ${gapPct}% from prev close\n` +
      `⏰ Window: 9:15–9:25 AM IST | Waiting for confirmation candle\n` +
      `🎯 Rules: Body>70% + Move>0.3% + Gap-aligned`,
    );
  }

  // ── Resolve effective price for open trade monitoring ───────────────────────
  // For options mode: use current option premium (not underlying spot price) for P&L.
  // For regular mode: use underlying/futures price as before.
  let effectivePrice = price; // default: underlying price
  if (state.openTrade?.isIndexOptions) {
    if (state.accessToken && state.openTrade.instrumentToken) {
      // Fetch current option premium from Upstox using the REAL option token
      // state.optionTradeToken has the resolved real token (e.g. MCX_FO|..., NFO_OPT|...)
      // trade.instrumentToken may be a fake PAPER_OPT|... token that Upstox won't recognize
      const realOptToken = state.optionTradeToken ?? state.openTrade.instrumentToken;
      const isPaperToken = realOptToken.startsWith("PAPER_OPT|");
      const optQuote = isPaperToken ? null : await fetchFullQuote(realOptToken, state.accessToken);
      if (optQuote && optQuote.ltp > 0) {
        // For options we hold (BUY direction): the exit price is the BID (what we can sell at).
        // Use bid when available and > 0; if bid is significantly higher than LTP (illiquid option),
        // prefer bid as it represents the real market value for exit.
        const bestExitPrice = optQuote.bid > 0 ? Math.max(optQuote.bid, optQuote.ltp) : optQuote.ltp;
        effectivePrice = bestExitPrice;
        state.optionPremiumPrice = bestExitPrice; // update for Dashboard display
      } else {
        // fetchFullQuote failed — fall back to delta approximation instead of using underlying price
        const entryPremium = state.openTrade.entryPrice;
        const entryUnderlying = state.openTrade.entryUnderlyingPrice;
        // If no reliable entryUnderlyingPrice, use entryPrice as effectivePrice (safety guard will block exits)
        if (!entryUnderlying || entryUnderlying <= 0) {
          effectivePrice = entryPremium;
          state.optionPremiumPrice = entryPremium;
        } else {
        const underlyingMove = price - entryUnderlying;
        // BUG-15 fix: Dynamic delta based on moneyness (OTM ~0.3, ATM ~0.5, ITM ~0.7)
        const movePct = entryUnderlying > 0 ? Math.abs(underlyingMove) / entryUnderlying : 0;
        const delta = movePct < 0.005 ? 0.5 : movePct < 0.015 ? 0.4 : 0.3; // decays as option moves OTM
        const isCallOption = state.openTrade.symbol.includes("_CE_") || state.openTrade.symbol.endsWith("_CE")
          || (state.openTrade.symbolLabel ?? "").includes(" CE");
        const driftedPremium = Math.max(0.05, entryPremium + (isCallOption ? underlyingMove * delta : -underlyingMove * delta));
        effectivePrice = driftedPremium;
        state.optionPremiumPrice = driftedPremium;
        }
      }
    } else {
      // Paper mode (no access token): derive drifting option premium from real underlying price.
      // Use delta approximation: ATM option moves ~0.5x the underlying for every 1 point move.
      // Base premium is the entry price of the open trade (already a real option premium).
      const entryPremium = state.openTrade.entryPrice;
      const entryUnderlying = state.openTrade.entryUnderlyingPrice;
      // If no reliable entryUnderlyingPrice, use current price as a rough reference
      // (better than freezing at entry which prevents SL from ever firing)
      if (!entryUnderlying || entryUnderlying <= 0) {
        // No entryUnderlyingPrice means we can't compute delta drift.
        // Use the last known optionPremiumPrice if available, otherwise keep entryPremium.
        // This ensures SL can still fire if the premium was previously tracked.
        effectivePrice = state.optionPremiumPrice && state.optionPremiumPrice > 0
          ? state.optionPremiumPrice
          : entryPremium;
      } else {
      const underlyingMove = price - entryUnderlying;
      // BUG-15 fix: Dynamic delta based on moneyness (OTM ~0.3, ATM ~0.5, ITM ~0.7)
      const movePct = entryUnderlying > 0 ? Math.abs(underlyingMove) / entryUnderlying : 0;
      const delta = movePct < 0.005 ? 0.5 : movePct < 0.015 ? 0.4 : 0.3; // decays as option moves OTM
      // For CE: underlying up = premium up. For PE: underlying up = premium down.
      const isCallOption = state.openTrade.symbol.includes("_CE_") || state.openTrade.symbol.endsWith("_CE")
        || (state.openTrade.symbolLabel ?? "").includes(" CE");
      const driftedPremium = Math.max(0.05, entryPremium + (isCallOption ? underlyingMove * delta : -underlyingMove * delta));
      effectivePrice = driftedPremium;
      state.optionPremiumPrice = driftedPremium;
      }
    }
  }

  // Auto square-off at market close
  if (istMin2 >= squareOffMin && state.openTrade) {
    // If user selected carry-forward, skip auto square-off and keep trade open overnight
    if (state.carryForward) {
      if (!state.alertsSent.has("carry_forward_active")) {
        state.alertsSent.add("carry_forward_active");
        const trade = state.openTrade;
        const cfRemQty = trade.quantity - (trade.bookedQty ?? 0);
        const unrealizedPnl = trade.direction === "BUY"
          ? (effectivePrice - trade.entryPrice) * cfRemQty
          : (trade.entryPrice - effectivePrice) * cfRemQty;
        const totalPnl = unrealizedPnl + (trade.bookedPnlAddedToDaily ? 0 : trade.bookedPnl);
        emitActivity(state.sessionToken, "market_closed", `🌙 Carry Forward Active — ${trade.symbolLabel} held overnight | Unrealized P&L: ${totalPnl >= 0 ? "+" : ""}₹${totalPnl.toFixed(0)}`, { price: effectivePrice, pnl: totalPnl });
        sendTelegramAlert(state, `🌙 <b>CARRY FORWARD</b>\n📊 <b>${trade.symbolLabel}</b>\n💰 Unrealized P&L: ${totalPnl >= 0 ? "+" : ""}₹${totalPnl.toFixed(0)}\n⏰ Trade held overnight — will resume tomorrow`, "tradeExit");
        console.log(`[BotEngine] ${state.sessionToken} — carry forward active, skipping auto square-off | Unrealized P&L: ₹${totalPnl.toFixed(0)}`);
      }
      return; // Skip square-off — trade stays open
    }
   const trade = state.openTrade;
   if (trade.mode === "live" && state.accessToken) {
     const sqOffId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", (trade.quantity - (trade.bookedQty ?? 0)));
      if (!sqOffId) {
        state.lastError = `Auto square-off REJECTED — close ${trade.symbolLabel} manually on Upstox`;
        emitActivity(state.sessionToken, "error", `⚠ AUTO SQUARE-OFF FAILED — ${trade.symbolLabel}. CLOSE MANUALLY on Upstox NOW.`);
        sendTelegramAlert(state, `🚨 <b>AUTO SQUARE-OFF FAILED</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Market close order rejected. CLOSE MANUALLY ON UPSTOX NOW.`, "criticalAlerts");
        return; // do NOT close trade in DB — position still open
      }
   }
    const sqRemaining = trade.quantity - (trade.bookedQty ?? 0);
    let pnl = trade.direction === "BUY" ? (effectivePrice - trade.entryPrice) * sqRemaining : (trade.entryPrice - effectivePrice) * sqRemaining;
    // v3: paper-mode brokerage + slippage simulation
    if (trade.mode === "paper") {
      const pc = getPaperCostConfig(state.sessionToken);
      pnl = applyPaperCosts(pnl, trade.entryPrice, effectivePrice, sqRemaining, pc.brokerage, pc.slippagePct);
    }
    if (trade.bookedPnlAddedToDaily) {
      state.dailyPnl += pnl;
    } else {
      state.dailyPnl += pnl + trade.bookedPnl;
    }
    state.openTrade = null;
    recordTradeClose(state.sessionToken, state.scanIntervalSec);
    const sqTotalPnl = pnl + trade.bookedPnl;
    if (sqTotalPnl < 0) recordDirectionalLoss(state.sessionToken, trade.direction); else recordDirectionalWin(state.sessionToken, trade.direction);
    await onTradeClose(trade.dbId, effectivePrice, sqTotalPnl, "Market Close — Auto Square-Off");
    console.log(`[BotEngine] ${state.sessionToken} — auto square-off | P&L: ₹${sqTotalPnl.toFixed(0)} (remaining: ₹${pnl.toFixed(0)} + booked: ₹${trade.bookedPnl.toFixed(0)})`);
    emitActivity(state.sessionToken, "trade_close", `Auto Square-Off ${trade.symbolLabel} @ ₹${effectivePrice.toFixed(2)} | P&L: ${sqTotalPnl >= 0 ? "+" : ""}₹${sqTotalPnl.toFixed(0)}`, { price: effectivePrice, pnl: sqTotalPnl });
    // Telegram: auto square-off alert
    const sqPnlSign2 = sqTotalPnl >= 0 ? "+" : "";
    sendTelegramAlert(state,
      `⏰ <b>AUTO SQUARE-OFF</b> (market closing)\n` +
      `📊 <b>${trade.symbolLabel}</b> | Exit: ₹${effectivePrice.toFixed(2)}\n` +
      `💰 P&L: ${sqPnlSign2}₹${sqTotalPnl.toFixed(0)}` +
      (trade.bookedPnl > 0 ? ` (locked: ₹${trade.bookedPnl.toFixed(0)})` : "") +
      `\n📈 Day P&L: ₹${state.dailyPnl.toFixed(0)} | Trades: ${state.tradesCount}`
    );
    return;
  }

  const nearClose = istMin2 >= stopScanMin;
  if (nearClose) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: "Market closing soon — no new trades", layer: "None" };
  }

  // Monitor open trade SL/Target
  if (state.openTrade) {
    const trade = state.openTrade;

    // ── Hero Zero exit: 5× premium = take profit; 50% loss = cut ─────────────
    if (trade.isHeroZero && trade.heroZeroPremiumEntry) {
      const heroTarget = trade.heroZeroPremiumEntry * 5;
      const heroCut    = trade.heroZeroPremiumEntry * 0.5;
      let heroExit: string | null = null;
      if (effectivePrice >= heroTarget) heroExit = "Hero Zero — 5× Target Hit";
      else if (effectivePrice <= heroCut) heroExit = "Hero Zero — 50% Cut";
      if (heroExit) {
        const heroRemQty = trade.quantity - (trade.bookedQty ?? 0);
        let pnl = (effectivePrice - trade.entryPrice) * heroRemQty;
        if (trade.mode === "live" && state.accessToken) {
          const heroOrderId2 = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, "SELL", heroRemQty);
          if (!heroOrderId2) {
            state.lastError = `Hero Zero exit order REJECTED — close ${trade.symbolLabel} manually on Upstox`;
            emitActivity(state.sessionToken, "error", `⚠ HERO ZERO EXIT FAILED — ${trade.symbolLabel}. Order rejected by Upstox. CLOSE MANUALLY.`);
            sendTelegramAlert(state, `🚨 <b>HERO ZERO EXIT FAILED</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Exit order rejected. CLOSE MANUALLY ON UPSTOX.`, "criticalAlerts");
            return; // do NOT close trade in DB — position still open
          }
        }
        // v3: paper-mode brokerage + slippage simulation
        if (trade.mode === "paper") {
          const pc = getPaperCostConfig(state.sessionToken);
          pnl = applyPaperCosts(pnl, trade.entryPrice, effectivePrice, heroRemQty, pc.brokerage, pc.slippagePct);
        }
        if (trade.bookedPnlAddedToDaily) {
          state.dailyPnl += pnl;
        } else {
          state.dailyPnl += pnl + trade.bookedPnl;
        }
        state.openTrade = null;
        recordTradeClose(state.sessionToken, state.scanIntervalSec);
        if (pnl + trade.bookedPnl < 0) recordDirectionalLoss(state.sessionToken, trade.direction); else recordDirectionalWin(state.sessionToken, trade.direction);
        await onTradeClose(trade.dbId, effectivePrice, pnl + trade.bookedPnl, heroExit);
        console.log(`[BotEngine] ${state.sessionToken} — ${heroExit} | P&L: ₹${(pnl + trade.bookedPnl).toFixed(0)}`);
        return;
      }
      // Hero Zero: do NOT return here — fall through to partial booking below
      // This allows partial profit booking to work for Hero Zero trades too
    }

    // ── Partial profit booking (pyramid exit) ────────────────────────────────
    // SKIP partial booking for Opening Burst trades — full exit at target (moves are fast, reversals violent)
    if (trade.partialBooked === 0 && trade.signalLayer !== "OpeningBurst") {
      // Safety guard: partial1RPrice must be a valid non-zero price above/below entry
      // A value of 0 would immediately trigger on any price (e.g. after DB restore without recalculation)
      const partial1Valid = trade.partial1RPrice > 0 &&
        (trade.direction === "BUY" ? trade.partial1RPrice > trade.entryPrice : trade.partial1RPrice < trade.entryPrice);
      const hit1R = partial1Valid &&
        (trade.direction === "BUY" ? effectivePrice >= trade.partial1RPrice : effectivePrice <= trade.partial1RPrice);
     if (hit1R) {
       // Book 50% of position at 1R
       const bookQty = Math.max(1, Math.floor(trade.quantity * 0.5));
       const bookPnl = trade.direction === "BUY"
         ? (trade.partial1RPrice - trade.entryPrice) * bookQty
         : (trade.entryPrice - trade.partial1RPrice) * bookQty;
       if (trade.mode === "live" && state.accessToken) {
          const partialOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", bookQty);
          if (!partialOrderId) {
            state.lastError = `Partial 1R booking REJECTED — ${trade.symbolLabel}. Position unchanged.`;
            emitActivity(state.sessionToken, "error", `⚠ PARTIAL 1R BOOKING FAILED — ${trade.symbolLabel}. Order rejected by Upstox. Will retry next tick.`);
            sendTelegramAlert(state, `🚨 <b>PARTIAL BOOKING FAILED (1R)</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not book 50% profit. Will retry.`, "criticalAlerts");
            return; // do NOT update bookedQty/bookedPnl — order didn't execute
          }
       }
       trade.bookedQty += bookQty;
        trade.bookedPnl += bookPnl;
        trade.partialBooked = 1;
        // Move SL to breakeven
        trade.currentSl = trade.entryPrice;
        state.dailyPnl += bookPnl;
        trade.bookedPnlAddedToDaily = true;
        console.log(`[BotEngine] ${state.sessionToken} — PARTIAL BOOK 50% @ ₹${trade.partial1RPrice.toFixed(2)} | Booked P&L: ₹${bookPnl.toFixed(0)} | SL→BE`);
        sendTelegramAlert(state,
          `💰 <b>PARTIAL PROFIT BOOKED (50%)</b>\n` +
          `📊 <b>${state.instrumentLabel}</b> | ₹${trade.partial1RPrice.toFixed(2)}\n` +
          `✅ Locked: ₹${bookPnl.toFixed(0)} | SL moved to Breakeven\n` +
          `🎯 Remaining: ${trade.quantity - trade.bookedQty} qty | Next target: 2R`,
        );
        // Persist partial booking state to DB so it survives server restarts
        // Fire-and-forget DB persist (non-blocking to avoid slowing the tick)
        (async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const { tradeLog: tl0 } = await import("../drizzle/schema"); const { eq: eq0 } = await import("drizzle-orm"); const { getDb: getDb0 } = await import("./db"); const db0 = await getDb0();
              if (db0 && trade.dbId) {
                await db0.update(tl0).set({ partialBooked: 1, bookedQty: trade.bookedQty, bookedPnl: trade.bookedPnl }).where(eq0(tl0.id, trade.dbId!));
              }
              break; // success
            } catch (e) {
              if (attempt === 1) console.error("[BotEngine] Failed to persist partial booking 1R (2 attempts):", e);
              else await new Promise(r => setTimeout(r, 500)); // wait 500ms before retry
            }
          }
        })();
      }
    } else if (trade.partialBooked === 1 && trade.signalLayer !== "OpeningBurst") {
     // Safety guard: partial2RPrice must be a valid non-zero price above/below entry (same as 1R guard)
     const partial2Valid = trade.partial2RPrice > 0 &&
       (trade.direction === "BUY" ? trade.partial2RPrice > trade.entryPrice : trade.partial2RPrice < trade.entryPrice);
     const hit2R = partial2Valid &&
       (trade.direction === "BUY" ? effectivePrice >= trade.partial2RPrice : effectivePrice <= trade.partial2RPrice);
    if (hit2R) {
      // Book another 25% (half of remaining) at 2R
       const bookQty = Math.max(1, Math.floor((trade.quantity - trade.bookedQty) * 0.5));
      const bookPnl = trade.direction === "BUY"
        ? (trade.partial2RPrice - trade.entryPrice) * bookQty
        : (trade.entryPrice - trade.partial2RPrice) * bookQty;
       if (trade.mode === "live" && state.accessToken) {
          const partialOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", bookQty);
          if (!partialOrderId) {
            state.lastError = `Partial 2R booking REJECTED — ${trade.symbolLabel}. Position unchanged.`;
            emitActivity(state.sessionToken, "error", `⚠ PARTIAL 2R BOOKING FAILED — ${trade.symbolLabel}. Order rejected by Upstox. Will retry next tick.`);
            sendTelegramAlert(state, `🚨 <b>PARTIAL BOOKING FAILED (2R)</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not book 25% profit. Will retry.`, "criticalAlerts");
            return; // do NOT update bookedQty/bookedPnl — order didn't execute
          }
       }
       trade.bookedQty += bookQty;
        trade.bookedPnl += bookPnl;
        trade.partialBooked = 2;
        // Trail SL to 1R level
        trade.currentSl = trade.partial1RPrice;
        state.dailyPnl += bookPnl;
        trade.bookedPnlAddedToDaily = true;
        console.log(`[BotEngine] ${state.sessionToken} — PARTIAL BOOK 25% @ ₹${trade.partial2RPrice.toFixed(2)} | Booked P&L: ₹${bookPnl.toFixed(0)} | SL→1R`);
        sendTelegramAlert(state,
          `💰 <b>PARTIAL PROFIT BOOKED (25% more)</b>\n` +
          `📊 <b>${state.instrumentLabel}</b> | ₹${trade.partial2RPrice.toFixed(2)}\n` +
          `✅ Locked: ₹${bookPnl.toFixed(0)} | Total locked: ₹${trade.bookedPnl.toFixed(0)}\n` +
          `🛑 SL moved to 1R | Trailing ${trade.quantity - trade.bookedQty} qty to target`,
        );
        // Persist partial booking state to DB so it survives server restarts
        // Fire-and-forget DB persist (non-blocking to avoid slowing the tick)
        (async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const { tradeLog: tl1 } = await import("../drizzle/schema"); const { eq: eq1 } = await import("drizzle-orm"); const { getDb: getDb1 } = await import("./db"); const db1 = await getDb1();
              if (db1 && trade.dbId) {
                await db1.update(tl1).set({ partialBooked: 2, bookedQty: trade.bookedQty, bookedPnl: trade.bookedPnl }).where(eq1(tl1.id, trade.dbId!));
              }
              break; // success
            } catch (e) {
              if (attempt === 1) console.error("[BotEngine] Failed to persist partial booking 2R (2 attempts):", e);
              else await new Promise(r => setTimeout(r, 500)); // wait 500ms before retry
            }
          }
        })();
      }
    }

    // ── Trailing SL ──────────────────────────────────────────────────────────
    if (trade.trailingSlEnabled) {
      // Only trail if we have a reliable effectivePrice (not broken delta approximation)
      const trailReliable = !(trade.isIndexOptions && !state.optionTradeToken && Math.abs(effectivePrice - trade.entryPrice) / trade.entryPrice < 0.02);
      if (trailReliable) {
        const trailDist = trade.entryPrice * (trade.trailingSlPct / 100);
        if (trade.direction === "BUY") { const newSl = effectivePrice - trailDist; if (newSl > trade.currentSl) trade.currentSl = newSl; }
        else { const newSl = effectivePrice + trailDist; if (newSl < trade.currentSl) trade.currentSl = newSl; }
      }
    }

    // ── AVERAGING/DCA: Add to losing position when reversal signal is clear ──────
    // Logic: If trade is in significant loss AND candles show clear reversal pattern,
    // buy more at the lower price to bring average entry down. This allows profitable
    // exits on bounces that wouldn't reach the original entry price.
    // Example: Entry ₹59, drops to ₹30, average at ₹30 → new avg ₹44.5. Bounce to ₹51 = profit.
    if ((state.averagingEnabled ?? true) && (trade.averageCount ?? 0) === 0 && trade.partialBooked === 0) {
      const avgTradeAge = trade.enteredAt ? Date.now() - new Date(trade.enteredAt).getTime() : 0;
      const lossPct = trade.direction === "BUY"
        ? (trade.entryPrice - effectivePrice) / trade.entryPrice
        : (effectivePrice - trade.entryPrice) / trade.entryPrice;

      // Conditions for averaging:
      // 1. Trade is in loss by 20-50% (significant loss but not catastrophic)
      // 2. Trade age > 5 min (give original entry time to work)
      // 3. Not near market close (30 min buffer)
      // 4. Daily loss limit not close to being hit (< 70% of limit used)
      // 5. Clear reversal candle pattern detected
      const avgThreshold = state.averagingLossThreshold ?? 0.20;
      const isInLoss = lossPct > avgThreshold && lossPct < 0.50;
      const isOldEnough = avgTradeAge > 5 * 60 * 1000; // > 5 minutes
      const nowUtc = new Date();
      const istMinNow = ((nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes()) + 330) % 1440;
      const isMCXInst = state.instrumentToken.startsWith("MCX");
      const closeMin = isMCXInst ? 23 * 60 + 25 : 15 * 60 + 25; // MCX 23:25, NSE 15:25
      const notNearClose = istMinNow < closeMin - 30; // at least 30 min before close
      const dailyLossUsed = Math.abs(Math.min(0, state.dailyPnl)) / (state.capital * state.dailyLossLimitPct / 100);
      const hasCapitalHeadroom = dailyLossUsed < 0.70; // less than 70% of daily loss limit used

      if (isInLoss && isOldEnough && notNearClose && hasCapitalHeadroom && state.candles.length >= 5) {
        // Check for CLEAR reversal signal in candles:
        // For BUY trades: 2 consecutive green candles + RSI turning up from oversold
        // For SELL trades: 2 consecutive red candles + RSI turning down from overbought
        const len = state.candles.length;
        const c_2 = state.candles[len - 2];
        const c_1 = state.candles[len - 1]; // most recent candle
        const closes = state.candles.map(c => c.close);
        const rsiNow = calcRSI(closes, 14);
        const rsiPrev = calcRSI(closes.slice(0, -1), 14);
        const vwapNow = calcVWAP(state.candles);

        // Volume confirmation: current candle volume > 1.5x average (shows conviction)
        const avgVolRecent = state.candles.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
        const allVolZeroAvg = state.candles.slice(-10).every(c => c.volume === 0);
        const volConfirmed = allVolZeroAvg || (c_1.volume > avgVolRecent * 1.3);

        let reversalDetected = false;
        if (trade.direction === "BUY") {
          // Reversal for BUY: 2 green candles + RSI was < 35 and now turning up + volume
          const twoGreen = c_2.close > c_2.open && c_1.close > c_1.open;
          const rsiOversoldTurning = rsiPrev < 35 && rsiNow > rsiPrev;
          const priceRecovering = c_1.close > c_2.close; // higher close
          reversalDetected = twoGreen && rsiOversoldTurning && priceRecovering && volConfirmed;
        } else {
          // Reversal for SELL: 2 red candles + RSI was > 65 and now turning down + volume
          const twoRed = c_2.close < c_2.open && c_1.close < c_1.open;
          const rsiOverboughtTurning = rsiPrev > 65 && rsiNow < rsiPrev;
          const priceFalling = c_1.close < c_2.close; // lower close
          reversalDetected = twoRed && rsiOverboughtTurning && priceFalling && volConfirmed;
        }

        if (reversalDetected) {
          // Calculate averaging quantity (same as original or limited by remaining capital)
          const avgPrice = effectivePrice;
          const maxAvgCapital = state.capital * (state.riskPerTradePct / 100) * 2; // Allow 2x risk for averaging
          const maxQtyByCapital = Math.floor(maxAvgCapital / avgPrice);
          const lotSize = state.lotSize || 1;
          let avgQty = Math.min(trade.quantity, maxQtyByCapital);
          avgQty = Math.max(lotSize, Math.floor(avgQty / lotSize) * lotSize); // Round to lot size

          // For live mode: place the order first
          if (trade.mode === "live" && state.accessToken) {
            const avgOrderDir = trade.direction; // Same direction as original trade
            const avgOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, avgOrderDir, avgQty);
            if (!avgOrderId) {
              // Order failed — don't average, just log
              console.warn(`[BotEngine] ${state.sessionToken} — AVERAGING order REJECTED by Upstox`);
              emitActivity(state.sessionToken, "error", `⚠ Averaging order rejected — ${trade.symbolLabel} ${avgOrderDir} ${avgQty} qty`);
              // Don't try again — set averageCount to prevent retry spam
              trade.averageCount = 1;
              return;
            }
          }

          // Calculate new weighted average entry price
          const oldTotal = trade.entryPrice * trade.quantity;
          const newTotal = avgPrice * avgQty;
          const combinedQty = trade.quantity + avgQty;
          const newAvgEntry = (oldTotal + newTotal) / combinedQty;

          // Store original entry for analytics (first time only)
          if (!trade.originalEntryPrice) {
            trade.originalEntryPrice = trade.entryPrice;
          }

          // Update trade with new averaged values
          const atrNow = calcATR(state.candles, 14);
          trade.entryPrice = newAvgEntry;
          trade.quantity = combinedQty;
          trade.averageCount = 1;
          trade.averagedAt = Date.now();

          // New SL: tighter — new average - ATR * 0.8 (protect the larger position)
          const newSlDist = atrNow * 0.8;
          trade.slPrice = trade.direction === "BUY" ? newAvgEntry - newSlDist : newAvgEntry + newSlDist;
          trade.currentSl = trade.slPrice;

          // New Target: new average + ATR * 1.5 (realistic recovery target)
          trade.targetPrice = trade.direction === "BUY" ? newAvgEntry + atrNow * 1.5 : newAvgEntry - atrNow * 1.5;

          // Recalculate partial booking levels based on new average
          const p1Pct = state.partial1Pct / 100;
          const p2Pct = state.partial2Pct / 100;
          trade.partial1RPrice = trade.direction === "BUY"
            ? newAvgEntry * (1 + p1Pct)
            : newAvgEntry * (1 - p1Pct);
          trade.partial2RPrice = trade.direction === "BUY"
            ? newAvgEntry * (1 + p2Pct)
            : newAvgEntry * (1 - p2Pct);

          // Persist to DB (fire-and-forget)
          (async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const { tradeLog: tl } = await import("../drizzle/schema");
                const { eq } = await import("drizzle-orm");
                const { getDb } = await import("./db");
                const db = await getDb();
                if (db && trade.dbId) {
                  await db.update(tl).set({
                    entryPrice: newAvgEntry,
                    quantity: combinedQty,
                    slPrice: trade.slPrice,
                    targetPrice: trade.targetPrice,
                    partial1RPrice: trade.partial1RPrice,
                    partial2RPrice: trade.partial2RPrice,
                  }).where(eq(tl.id, trade.dbId));
                }
                break; // success
              } catch (e) {
                if (attempt === 1) console.error("[BotEngine] Failed to persist averaging state (2 attempts):", e);
                else await new Promise(r => setTimeout(r, 500));
              }
            }
          })();

          const avgMsg = `📊 <b>AVERAGING DOWN</b>\n` +
            `📈 <b>${trade.symbolLabel}</b>\n` +
            `➕ Added ${avgQty} qty @ ₹${avgPrice.toFixed(2)}\n` +
            `📉 Original entry: ₹${trade.originalEntryPrice?.toFixed(2)} → New avg: ₹${newAvgEntry.toFixed(2)}\n` +
            `📦 Total qty: ${combinedQty} | New SL: ₹${trade.slPrice.toFixed(2)} | Target: ₹${trade.targetPrice.toFixed(2)}\n` +
            `🔄 RSI: ${rsiNow.toFixed(0)} (was ${rsiPrev.toFixed(0)}) | Loss was ${(lossPct * 100).toFixed(0)}%`;
          console.log(`[BotEngine] ${state.sessionToken} — AVERAGING: +${avgQty} @ ₹${avgPrice.toFixed(2)} | New avg: ₹${newAvgEntry.toFixed(2)} | Old: ₹${trade.originalEntryPrice?.toFixed(2)}`);
          emitActivity(state.sessionToken, "trade_open", `📊 AVERAGING ${trade.symbolLabel} +${avgQty} @ ₹${avgPrice.toFixed(2)} | New avg: ₹${newAvgEntry.toFixed(2)} | SL: ₹${trade.slPrice.toFixed(2)} | Target: ₹${trade.targetPrice.toFixed(2)}`, { price: avgPrice, confidence: 0.7 });
          sendTelegramAlert(state, avgMsg);
          return; // Don't check SL/Target this tick — let the new average settle
        }
      }
    }

    // ── Full exit: SL or Target ───────────────────────────────────────────────
    let exitReason: string | null = null;
    const tradeAgeMs = trade.enteredAt ? Date.now() - new Date(trade.enteredAt).getTime() : Infinity;
    // ── TIME-BASED EXIT: Exit if trade is stagnant/losing after max hold time ──
    // For options: theta decay kills you if you hold too long without movement.
    // Exit if: (1) trade is older than 20 minutes, AND (2) trade is in loss or flat.
    // This prevents holding losing options that slowly bleed to zero.
    // If trade was averaged, give more time (30 min) since the new avg entry is lower
    // Opening Burst: strict 10-minute limit (moves happen in 2-3 min, don't hold long)
    const MAX_HOLD_MINUTES = trade.signalLayer === "OpeningBurst" ? 10 : (trade.averageCount ?? 0) > 0 ? 30 : 20;
    if (!exitReason && trade.isIndexOptions && tradeAgeMs > MAX_HOLD_MINUTES * 60 * 1000) {
      const currentPnlPerUnit = trade.direction === "BUY"
        ? effectivePrice - trade.entryPrice
        : trade.entryPrice - effectivePrice;
      // Opening Burst: ALWAYS exit at time limit (win or lose, done)
      // Regular trades: exit only if in loss or barely profitable
      if (trade.signalLayer === "OpeningBurst") {
        exitReason = `Opening Burst Time Exit (${MAX_HOLD_MINUTES}min) — close at market`;
        emitActivity(state.sessionToken, "signal", `🚀⏰ Opening Burst time limit: held ${Math.floor(tradeAgeMs / 60000)}min — closing at market | P&L ₹${(currentPnlPerUnit * (trade.quantity - (trade.bookedQty ?? 0))).toFixed(0)}`);
      } else if (currentPnlPerUnit < trade.entryPrice * 0.05) {
        exitReason = `Time Exit (${MAX_HOLD_MINUTES}min) — no momentum`;
        emitActivity(state.sessionToken, "signal", `⏰ Time-based exit: held ${Math.floor(tradeAgeMs / 60000)}min with P&L ₹${(currentPnlPerUnit * (trade.quantity - (trade.bookedQty ?? 0))).toFixed(0)} — cutting losses`);
      }
    }

    // SAFETY GUARD: For options trades using delta approximation without a real quote,
    // only skip SL/Target checks for the FIRST 5 minutes after trade open (grace period for token resolution).
    // After 5 minutes, trust the delta approximation and enforce SL/Target — never leave a trade unprotected.
    const isOptionsWithBrokenDelta = trade.isIndexOptions
      && !state.optionTradeToken
      && Math.abs(effectivePrice - trade.entryPrice) / trade.entryPrice < 0.01
      && tradeAgeMs < 5 * 60 * 1000; // Only skip for first 5 minutes
    if (isOptionsWithBrokenDelta) {
      // Grace period: don't check SL/Target for first 5 minutes while token resolves
      if (!state.alertsSent.has("broken_delta_guard")) {
        state.alertsSent.add("broken_delta_guard");
        console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — SAFETY: skipping SL/Target for 5min grace period (delta approx unreliable, effectivePrice ₹${effectivePrice.toFixed(2)} ≈ entry ₹${trade.entryPrice.toFixed(2)})`);
        emitActivity(state.sessionToken, "error", `⚠ Delta approximation unreliable — grace period (5min) for token resolution. SL/Target will activate after.`);
      }
    } else {
      // For options: direction in trade is always "BUY" (we buy CE or PE).
      // SL triggers when premium drops below SL price. Target triggers when premium rises above target.
      if (trade.direction === "BUY") { if (effectivePrice <= trade.currentSl) exitReason = "Stop Loss"; else if (effectivePrice >= trade.targetPrice) exitReason = "Target Hit"; }
      else { if (effectivePrice >= trade.currentSl) exitReason = "Stop Loss"; else if (effectivePrice <= trade.targetPrice) exitReason = "Target Hit"; }
    }

    if (exitReason) {
      // Use remaining quantity (after partial booking) for P&L on the remaining position
      const remainingQty = trade.quantity - (trade.bookedQty ?? 0);
      let remainPnl = trade.direction === "BUY" ? (effectivePrice - trade.entryPrice) * remainingQty : (trade.entryPrice - effectivePrice) * remainingQty;
      // v3: paper-mode brokerage + slippage simulation
      if (trade.mode === "paper") {
        const pc = getPaperCostConfig(state.sessionToken);
        remainPnl = applyPaperCosts(remainPnl, trade.entryPrice, effectivePrice, remainingQty, pc.brokerage, pc.slippagePct);
      }
      const totalPnl  = remainPnl + trade.bookedPnl;
      if (trade.mode === "live" && state.accessToken) {
        const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
        let exitOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, exitDir, remainingQty);
        if (!exitOrderId) {
          // Retry once after 2 seconds — network blip or brief Upstox outage
          await new Promise(r => setTimeout(r, 2000));
          exitOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, exitDir, remainingQty);
        }
        if (!exitOrderId) {
          // Both attempts failed — keep trade open, alert user to close manually
          state.lastError = `EXIT ORDER FAILED — close ${trade.symbolLabel} manually on Upstox`;
          emitActivity(state.sessionToken, "error", `⚠ EXIT ORDER FAILED (${exitReason}) — ${trade.symbolLabel}. CLOSE MANUALLY on Upstox NOW.`);
          sendTelegramAlert(state, `🚨 <b>EXIT ORDER FAILED</b> — ${exitReason}\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not place exit order after 2 attempts.\n⚠ CLOSE MANUALLY ON UPSTOX NOW.`, "criticalAlerts");
          return; // do NOT close in DB — trade remains open until manual intervention
        }
      }
      // Track SL hit for re-entry (only on full SL, not BE)
      if (exitReason === "Stop Loss" && trade.partialBooked === 0) {
        state.lastSlHitAt = Date.now();
        state.lastSlDirection = trade.direction;
        state.reEntryCandles = 0;
        // P1: Direction-aware cooldown tracking
        if (state.lastSlExitDirection === trade.direction) {
          state.consecutiveSameDirectionSLs += 1;
        } else {
          state.consecutiveSameDirectionSLs = 1;
        }
        state.lastSlExitDirection = trade.direction;
        state.lastSlExitAt = Date.now();
      }
      // P2: Underlying-level cooldown — track consecutive SLs regardless of direction (CE/PE)
      state.consecutiveUnderlyingSLs += 1;
      state.lastUnderlyingSLAt = Date.now();
      // If bookedPnl was already added to dailyPnl during partial booking in THIS session,
      // only add remainPnl. Otherwise (restart case), add totalPnl (includes bookedPnl).
      if (trade.bookedPnlAddedToDaily) {
        state.dailyPnl += remainPnl;
      } else {
        state.dailyPnl += totalPnl;
      }
      state.openTrade = null;
      recordTradeClose(state.sessionToken, state.scanIntervalSec);
      if (totalPnl < 0) recordDirectionalLoss(state.sessionToken, trade.direction); else recordDirectionalWin(state.sessionToken, trade.direction);
      // P2: Reset underlying cooldown on a winning trade
      if (totalPnl >= 0) {
        state.consecutiveUnderlyingSLs = 0;
        state.lastUnderlyingSLAt = null;
      }
      await onTradeClose(trade.dbId, effectivePrice, totalPnl, exitReason + (trade.bookedPnl > 0 ? ` (+₹${trade.bookedPnl.toFixed(0)} partial)` : ""));
      console.log(`[BotEngine] ${state.sessionToken} — ${exitReason} | Total P&L: ₹${totalPnl.toFixed(0)} (partial: ₹${trade.bookedPnl.toFixed(0)})`);
      emitActivity(state.sessionToken, "trade_close", `${exitReason} ${trade.symbolLabel} @ ₹${effectivePrice.toFixed(2)} | P&L: ${totalPnl >= 0 ? "+" : ""}₹${totalPnl.toFixed(0)} | Day: ₹${state.dailyPnl.toFixed(0)}`, { price: effectivePrice, pnl: totalPnl });
      // Telegram exit alert
      const exitEmoji = totalPnl >= 0 ? "✅" : "❌";
      const pnlSign = totalPnl >= 0 ? "+" : "";
      sendTelegramAlert(state,
        `${exitEmoji} <b>TRADE CLOSED — ${exitReason.toUpperCase()}</b>\n` +
        `📊 <b>${state.instrumentLabel}</b> | Exit: ₹${effectivePrice.toFixed(2)}\n` +
        `💰 Total P&L: ${pnlSign}₹${totalPnl.toFixed(0)}` +
        (trade.bookedPnl > 0 ? ` (locked: ₹${trade.bookedPnl.toFixed(0)})` : "") +
        `\n📈 Day P&L: ${state.dailyPnl.toFixed(0)} | Trades: ${state.tradesCount}`,
        "tradeExit",
      );
    }
    return;
  }

  if (nearClose) return;
  // Mutex guard: prevent duplicate trade opens from concurrent ticks
  if (state.isOpeningTrade) return;
  // Cooldown guard: minimum 2 minutes between trade entries to prevent rapid-fire
  if (state.lastTradeOpenedAt && Date.now() - state.lastTradeOpenedAt < 120_000) {
    return;
  }
  if (state.tradesCount >= state.maxTradesPerDay && !state.openTrade && !state.unlimitedTrades) {
    // Don't pause — just block new trade entries. Bot continues monitoring open trades & prices.
    if ((state.tickCount ?? 0) % 20 === 1) {
      console.warn(`[tick] ⚠ Max trades reached — ${state.sessionToken.slice(0,8)} | trades=${state.tradesCount}/${state.maxTradesPerDay} — blocking new entries only`);
    }
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Max trades reached (${state.tradesCount}/${state.maxTradesPerDay})`, layer: "None" };
    return;
  }

  // ── v3 Risk Gates: StoplossGuard, Portfolio Drawdown Halt, Cooldown ─────────
  // 1. StoplossGuard: pause after 3 consecutive SLs in last 20 trades (checked globally)
  const slGuard = getStoplossGuardState(state.sessionToken);
  if (slGuard.isPaused) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: slGuard.reason ?? "StoplossGuard active", layer: "None" };
    return;
  }
  // 2. Portfolio MaxDrawdown Halt: unified daily loss limit across all slots
  const baseToken = state.sessionToken.replace(/-slot\d+$/, "");
  const portfolioBots = getAllRunningBotsForSession(baseToken);
  const ddCheck = checkPortfolioDrawdown(portfolioBots, state.dailyLossLimitPct, baseToken);
  if (ddCheck.halted && !state.openTrade) {
    // Never pause — just block new trade entries. Bot continues monitoring & managing open trades.
    if ((state.tickCount ?? 0) % 20 === 1) {
      console.warn(`[tick] ⚠ Portfolio drawdown active — ${state.sessionToken.slice(0,8)} | ${ddCheck.reason} — blocking new trades only`);
    }
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: ddCheck.reason ?? "Portfolio drawdown limit — no new trades", layer: "None" };
    return;
  }
  // 3. CooldownPeriod: mandatory 2-candle wait after any trade close
  const cooldown = isCooldownActive(state.sessionToken);
  if (cooldown.active) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Cooldown after last trade (${Math.ceil(cooldown.remainingMs / 1000)}s remaining)`, layer: "None" };
    return;
  }

  // Re-entry cooldown logic — time-based (120s = 2 candles worth regardless of scan interval)
  let isReEntry = false;
  if (state.lastSlHitAt && state.lastSlDirection) {
    const elapsedSinceSlMs = Date.now() - state.lastSlHitAt;
    if (elapsedSinceSlMs < 120_000) {
      const remainingSec = Math.ceil((120_000 - elapsedSinceSlMs) / 1000);
      state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Re-entry cooldown (${remainingSec}s remaining after SL)`, layer: "None" };
      return;
    }
    isReEntry = true;
    state.lastSlHitAt = null;
    state.lastSlDirection = null;
    state.reEntryCandles = 0;
  }

  // Generate signal — extract prev-day OHLC from daily candles for S/R pivot filter
  const slMult = isReEntry ? state.stopLossMultiplier * 0.8 : state.stopLossMultiplier;
  let signal: Signal;

  // Previous trading day candle (index -2 from today = yesterday's candle)
  const prevDayCandle = state.candlesDay.length >= 2 ? state.candlesDay[state.candlesDay.length - 2] : null;
  const prevDayHigh  = prevDayCandle?.high  ?? 0;
  const prevDayLow   = prevDayCandle?.low   ?? 0;
  const prevDayClose = prevDayCandle?.close ?? 0;

  // Hero Zero: expiry-day OTM options (11:00 AM – 1:30 PM IST, NIFTY/BANKNIFTY option instruments)
  const isOptionInstrument = state.instrumentToken.includes("_CE") || state.instrumentToken.includes("_PE");
  const optionType: "CE" | "PE" = state.instrumentToken.includes("_CE") ? "CE" : "PE";
  // Expiry day detection:
  // - NIFTY: weekly expiry every Thursday (dayOfWeek === 4)
  // - BANKNIFTY: monthly expiry on LAST THURSDAY of month (weekly discontinued Nov 2024)
  const dayOfWeek = now2.getUTCDay(); // 0=Sun, 1=Mon, ... 4=Thu, 3=Wed
  const isBankNiftyOption = state.instrumentToken.includes("BNF") || state.instrumentToken.includes("BANKNIFTY");
  const isLastThursdayOfMonth = (() => {
    if (dayOfWeek !== 4) return false; // Must be Thursday
    const istDate = new Date(now2.getTime() + 5.5 * 60 * 60 * 1000);
    const dayOfMonth = istDate.getUTCDate();
    // Check if there's another Thursday this month (i.e., day + 7 <= days in month)
    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return (dayOfMonth + 7) > daysInMonth; // No more Thursdays left = last Thursday
  })();
  const isExpiryDay = isOptionInstrument && (isBankNiftyOption ? isLastThursdayOfMonth : dayOfWeek === 4);
  const heroZeroWindowStart = 11 * 60;
  const heroZeroWindowEnd   = 13 * 60 + 30;
  const inHeroZeroWindow = isExpiryDay && istMin2 >= heroZeroWindowStart && istMin2 < heroZeroWindowEnd;
  state.heroZeroMode = inHeroZeroWindow;

  console.log(`[tick] PRE-SIGNAL — ${state.sessionToken.slice(0,8)} | openingBurst=${inOpeningBurst} | powerHour=${inPowerHour} | mcxEve=${inMCXEvening} | mcxLate=${inMCXLateSession} | heroZero=${inHeroZeroWindow}`);
  if (inOpeningBurst && state.candles.length >= 2) {
    // Fetch VIX for Opening Burst filter (cached 60s, fail-open returns 0)
    const vixNow = await fetchIndiaVix(state.accessToken ?? undefined);
    signal = generateOpeningBurstSignal(state.candles, prevDayClose, slMult, vixNow);
    // If Opening Burst fires a BUY/SELL, mark as taken so we don't re-enter
    if (signal.direction !== "HOLD") {
      emitActivity(state.sessionToken, "signal", `🚀 Opening Burst: ${signal.direction} | gap-aligned | conf=${(signal.confidence * 100).toFixed(0)}% | VIX=${vixNow.toFixed(1)}`);
    }
    // Scan every candle during Opening Burst: override nextScanAt to 15s (minimum interval)
    // Normal scan might be 30-60s, but burst moves happen in 1-2 candles
    state.nextScanAt = Date.now() + 15_000;
  } else if (inPowerHour) {
    signal = generatePowerHourSignal(state.candles, state.candles5m, slMult, state.targetMultiplier);
  } else if (inMCXEvening) {
    signal = generateMCXEveningSignal(state.candles, state.candles5m, isWednesdayCrude, slMult, state.targetMultiplier);
  } else if (inMCXLateSession) {
    signal = generateMCXLateSessionSignal(state.candles, state.candles5m, slMult, state.targetMultiplier);
  } else if (inHeroZeroWindow && state.candles.length > 0) {
    // Hero Zero: current price IS the option premium (bot is tracking the option instrument)
    const optionPremium = price;
    // Strike distance: approximate from instrument token (e.g. NIFTY_25000CE → |25000 - spot|)
    // For simplicity, use 1% of current price as proxy when exact strike not parseable
    const strikeMatch = state.instrumentToken.match(/(\d{4,6})(CE|PE)/);
    const strikePrice = strikeMatch ? parseInt(strikeMatch[1]) : 0;
    const underlyingApprox = strikePrice > 0 ? strikePrice : price * 1.02; // fallback
    const strikeDistance = Math.abs(underlyingApprox - price);
    signal = generateHeroZeroSignal(optionPremium, state.candles, optionType, strikeDistance, slMult);
  } else {
    if (state.useV2Engine) {
      signal = generateSignalV2(
        state.candles, slMult, state.targetMultiplier, state.minConfidence / 100,
        state.candles5m, prevDayHigh, prevDayLow, prevDayClose,
        state.consecutiveSameDirectionSLs, state.lastSlExitDirection,
      );
    } else {
      signal = generateSignal(state.candles, slMult, state.targetMultiplier, state.minConfidence / 100, state.candles5m, prevDayHigh, prevDayLow, prevDayClose);
    }
  }

  console.log(`[tick] SIGNAL OK — ${state.sessionToken.slice(0,8)} | dir=${signal.direction} | conf=${signal.confidence.toFixed(2)} | layer=${signal.layer}`);

  // ── Shadow Mode: compare old logic vs new logic ───────────────────────────
  // When shadowMode=true: OLD logic (no P0, no P1) executes trades.
  // NEW logic (P0+P1) only LOGS decisions for comparison.
  if (state.shadowMode && !inOpeningBurst && !inPowerHour && !inMCXEvening && !inMCXLateSession && !inHeroZeroWindow) {
    try {
    const newSignal = signal; // current signal already has P0 ORB freshness gate
    // Generate OLD signal: same params but skip ORB freshness gate
    const oldSignal = generateSignal(state.candles, slMult, state.targetMultiplier, state.minConfidence / 100, state.candles5m, prevDayHigh, prevDayLow, prevDayClose, true);

    // Determine what NEW logic would decide (including P1 cooldown simulation)
    let newDecision = newSignal.direction === "HOLD" ? "HOLD" : "ENTER";
    if (newSignal.direction !== "HOLD" && state.lastSlExitAt && state.lastSlExitDirection) {
      const elapsedSinceSl = Date.now() - state.lastSlExitAt;
      const matchesSL = newSignal.direction === state.lastSlExitDirection;
      if (matchesSL) {
        if (state.consecutiveSameDirectionSLs >= 2 && elapsedSinceSl < 600_000) {
          newDecision = "BLOCKED_BY_P1(consecutive_SLs)";
        } else if (elapsedSinceSl < 180_000) {
          newDecision = "BLOCKED_BY_P1(3min_cooldown)";
        } else if (elapsedSinceSl < 300_000 && newSignal.confidence < 0.75) {
          newDecision = "BLOCKED_BY_P1(conf<75%)";
        }
      }
    }
    // Check if P0 blocked the new signal (new=HOLD but old=non-HOLD means P0 blocked it)
    if (newSignal.direction === "HOLD" && oldSignal.direction !== "HOLD") {
      newDecision = "BLOCKED_BY_P0(ORB_stale)";
    }

    // OLD decision: no P1 cooldown, no P0 gate — just whether signal fires
    const oldDecision = oldSignal.direction === "HOLD" ? "HOLD" : "ENTER";

    // Only log when at least one side has a non-HOLD signal (skip pure HOLD/HOLD)
    if (oldDecision !== "HOLD" || newDecision !== "HOLD") {
      const signalDesc = oldSignal.direction !== "HOLD"
        ? `${oldSignal.direction} ${(oldSignal.confidence * 100).toFixed(0)}% [${oldSignal.layer}]`
        : newSignal.direction !== "HOLD"
        ? `${newSignal.direction} ${(newSignal.confidence * 100).toFixed(0)}% [${newSignal.layer}]`
        : "HOLD";
      const difference = oldDecision === newDecision ? "SAME" :
        newDecision.startsWith("BLOCKED") ? `NEW_BLOCKED: ${newDecision}` :
        oldDecision === "HOLD" && newDecision === "ENTER" ? "NEW_ALLOWED_OLD_BLOCKED" :
        `OLD=${oldDecision} vs NEW=${newDecision}`;

      if (!state.shadowLog) state.shadowLog = [];
      state.shadowLog.push({
        timestamp: Date.now(),
        signal: signalDesc,
        oldDecision,
        newDecision,
        difference,
        price,
      });
      // Ring buffer: keep last 200 entries
      if (state.shadowLog.length > 200) {
        state.shadowLog = state.shadowLog.slice(-200);
      }

      // Emit activity log for disagreements only
      if (difference !== "SAME") {
        emitActivity(state.sessionToken, "signal", `👁 SHADOW: ${signalDesc} | Old: ${oldDecision} | New: ${newDecision} | ${difference}`);
      }
    }

    signal = oldSignal;
    } catch (shadowErr: unknown) {
      // Shadow mode crash should NOT kill the tick — just log and continue with current signal
      console.error(`[BotEngine] Shadow mode error (${state.sessionToken.slice(0, 8)}):`, shadowErr);
      emitActivity(state.sessionToken, "error", `Shadow mode error: ${shadowErr instanceof Error ? shadowErr.message : String(shadowErr)}`);
    }
  }

  // ── Heartbeat: emit periodic activity so user knows bot is alive ──────────
  state.tickCount = (state.tickCount ?? 0) + 1;
  const heartbeatIntervalMs = 5 * 60 * 1000; // 5 minutes
  const now4 = Date.now();
  if (!state.lastHeartbeatAt || (now4 - state.lastHeartbeatAt) >= heartbeatIntervalMs) {
    state.lastHeartbeatAt = now4;
    const rsiHb = calcRSI(state.candles.map(c => c.close), 14);
    const adxHb = calcADX(state.candles, 14);
    const vwapHb = calcVWAP(state.candles);
    const priceVsVwap = price > vwapHb ? "above" : "below";
    // Enhanced heartbeat: show Power Hour score breakdown when in Power Hour mode
    const heartbeatMsg = state.isPowerHourMode
      ? `⚡ PowerHour Scanning... ₹${price.toFixed(1)} (${priceVsVwap} VWAP) | RSI(${rsiHb.toFixed(0)}) | ADX(${adxHb.toFixed(0)}) | ${signal.reason ?? "HOLD"}`
      : state.isMCXEveningMode
      ? `🌙 MCXEvening Scanning... ₹${price.toFixed(1)} (${priceVsVwap} VWAP) | RSI(${rsiHb.toFixed(0)}) | ADX(${adxHb.toFixed(0)}) | ${signal.reason?.slice(0, 80) ?? "HOLD"}`
      : state.isMCXLateSessionMode
      ? `🌃 MCXLate Scanning... ₹${price.toFixed(1)} (${priceVsVwap} VWAP) | RSI(${rsiHb.toFixed(0)}) | ADX(${adxHb.toFixed(0)}) | ${signal.reason?.slice(0, 80) ?? "HOLD"}`
      : `⏱ Scanning... ₹${price.toFixed(1)} (${priceVsVwap} VWAP) | RSI(${rsiHb.toFixed(0)}) | ADX(${adxHb.toFixed(0)}) | Signal: ${signal.direction} | ${signal.reason?.slice(0, 80) ?? ""}`;
    emitActivity(state.sessionToken, "signal", heartbeatMsg);
  }
  state.lastSignal = signal;
  // Emit tick signal to activity log
  if (signal.direction !== "HOLD") {
    const slPct = signal.entryPrice > 0 ? (Math.abs(signal.entryPrice - signal.slPrice) / signal.entryPrice * 100).toFixed(1) : "?";
    emitActivity(state.sessionToken, "signal", `◆ ${signal.direction} signal @ ₹${signal.entryPrice.toFixed(2)} | ${(signal.confidence * 100).toFixed(0)}% conf | ${signal.layer} | SL ₹${signal.slPrice.toFixed(2)} (${slPct}%) | Target ₹${signal.targetPrice.toFixed(2)} | ATR ${signal.atr.toFixed(1)} | ${signal.reason}`, { price: signal.entryPrice, confidence: signal.confidence });
  }
  if (signal.direction === "HOLD") return; // confidence already checked inside generateSignal (tod multiplier applied there)

  // ── P2: Underlying-Level Cooldown (any direction) ───────────────────────────
  // After 2+ consecutive SLs on this underlying (regardless of CE/PE direction), block for 15 min
  if (state.consecutiveUnderlyingSLs >= 2 && state.lastUnderlyingSLAt) {
    const elapsedSinceUnderlyingSL = Date.now() - state.lastUnderlyingSLAt;
    if (elapsedSinceUnderlyingSL < 900_000) { // 15 minutes
      const remainMin = Math.ceil((900_000 - elapsedSinceUnderlyingSL) / 60000);
      emitActivity(state.sessionToken, "signal", `⊘ Underlying cooldown — ${state.consecutiveUnderlyingSLs} consecutive SLs on ${state.instrumentLabel} (${remainMin}min remaining)`);
      pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Underlying cooldown: ${state.consecutiveUnderlyingSLs} SLs in ${state.instrumentLabel}`);
      return;
    } else {
      // Cooldown expired — reset counter
      state.consecutiveUnderlyingSLs = 0;
      state.lastUnderlyingSLAt = null;
    }
  }
  // ── P1: Direction-Aware Cooldown ─────────────────────────────────────────────
  // After SL, penalize same-direction signals:
  // - Within 3 minutes: BLOCK same direction entirely (market proved you wrong)
  // - 3-5 minutes: require 75% confidence for same direction (higher bar)
  // - After 2+ consecutive same-direction SLs: BLOCK that direction for 10 minutes
  if (state.lastSlExitAt && state.lastSlExitDirection) {
    const elapsedSinceSl = Date.now() - state.lastSlExitAt;
    const signalMatchesSLDirection = signal.direction === state.lastSlExitDirection;

    if (signalMatchesSLDirection) {
      // 2+ consecutive SLs in same direction → block for 10 minutes
      if (state.consecutiveSameDirectionSLs >= 2 && elapsedSinceSl < 600_000) {
        const remainMin = Math.ceil((600_000 - elapsedSinceSl) / 60000);
        emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} blocked — ${state.consecutiveSameDirectionSLs} consecutive ${signal.direction} SLs (${remainMin}min cooldown remaining)`);
        pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Direction cooldown: ${state.consecutiveSameDirectionSLs} consecutive ${signal.direction} SLs`);
        return;
      }
      // Within 3 minutes of SL → block same direction
      if (elapsedSinceSl < 180_000) {
        const remainSec = Math.ceil((180_000 - elapsedSinceSl) / 1000);
        emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} blocked — same direction as recent SL (${remainSec}s cooldown)`);
        pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Same-direction cooldown (${remainSec}s remaining)`);
        return;
      }
      // 3-5 minutes: require higher confidence (75%)
      if (elapsedSinceSl < 300_000 && signal.confidence < 0.75) {
        emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} needs ≥75% conf after SL (got ${(signal.confidence*100).toFixed(0)}%)`);
        pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Post-SL confidence gate: needs 75%, got ${(signal.confidence*100).toFixed(0)}%`);
        return;
      }
    } else {
      // Opposite direction signal after SL — this is GOOD (market flipped), clear the cooldown
      state.lastSlExitDirection = null;
      state.lastSlExitAt = null;
      state.consecutiveSameDirectionSLs = 0;
    }
  }

  // ── Layer filter: skip signals from disabled layers ─────────────────────────
  // Time-window strategies (PowerHour, MCXEvening, MCXLateSession, HeroZero) bypass this filter
  // because they are activated by TIME, not user selection. The filter only applies to generic signal layers.
  const timeWindowLayers = new Set(["PowerHour", "MCXEvening", "MCXLateSession", "HeroZero", "OpeningBurst"]);
  if (state.enabledLayers && state.enabledLayers.length > 0 && signal.layer !== "None" && !timeWindowLayers.has(signal.layer)) {
    if (!state.enabledLayers.includes(signal.layer)) {
      emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} signal from ${signal.layer} skipped (layer disabled)`);
      pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Layer ${signal.layer} disabled`);
      return;
    }
  }

  // ── HourlyClose one-shot guard: only fire once per day ─────────────────────
  // ── Same-direction loss-streak guard: block direction after 2 consecutive losses ─
  // If the last 2 trades in this direction were losses within 90 min, the read is
  // wrong (e.g. buying CE dips on a fading rally). Block that direction for 30 min;
  // opposite-direction signals stay allowed — that's the flip the market is signaling.
  const dirBlock = isDirectionBlocked(state.sessionToken, signal.direction as "BUY" | "SELL");
  if (dirBlock.blocked) {
    emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} signal blocked — 2 consecutive ${signal.direction} losses, direction cooldown ${dirBlock.remainingMin}min (opposite direction still allowed)`);
    pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Direction blocked after consecutive losses (${dirBlock.remainingMin}min left)`);
    return;
  }

  if (signal.layer === "HourlyClose" && state.hourlyCloseSignalFired) {
    emitActivity(state.sessionToken, "signal", `⊘ HourlyClose signal skipped (already fired today)`);
    pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, "HourlyClose already fired today");
    return;
  }

  // ── Options mode: resolve ATM option token based on signal direction ──────────────────────
  // When isOptionsMode=true, the bot reads the underlying (Nifty/BankNifty futures) for signals
  // but places the actual order on the ATM CE (for BUY) or ATM PE (for SELL).
  // The option premium price is used for quantity sizing, NOT the underlying price.
  let tradeInstrumentToken = state.instrumentToken;
  let tradeSymbol = state.instrumentSymbol;
  let tradeLabel = state.instrumentLabel;
  let optionPremiumForSizing: number | null = null;
  let resolvedExpiry: string | undefined; // YYYY-MM-DD from option chain

  // Safety: ensure underlyingToken is always set when isIndexOptions=true
  // If it was not saved to DB, derive it from instrumentToken
  if (isOptionsMode && !state.underlyingToken) {
    state.underlyingToken = state.instrumentToken;
  }

  if (isOptionsMode && state.accessToken) {
    // Determine CE or PE based on signal direction (or explicit optionType override)
    const ceOrPe: "CE" | "PE" = state.optionType === "CE" ? "CE"
      : state.optionType === "PE" ? "PE"
      : signal.direction === "BUY" ? "CE" : "PE";

    // Detect MCX placeholder token (e.g. MCX_FO|GOLDM — no numeric ID)
    // MCX uses /v2/option/contract; NSE/NFO uses /v2/option/chain
    const rawUnderlying = state.underlyingToken!;
    const isMcxPlaceholder = rawUnderlying.startsWith("MCX_FO|") && !/\|\d+$/.test(rawUnderlying);
    let resolvedUnderlying = rawUnderlying;

    if (isMcxPlaceholder) {
      // Extract symbol from placeholder (e.g. "MCX_FO|GOLDM" → "GOLDM")
      const symbol = rawUnderlying.split("|")[1];
      const realToken = await resolveMcxFuturesToken(symbol, state.accessToken);
      if (realToken) {
        resolvedUnderlying = realToken;
        // Cache resolved token back into state so subsequent ticks skip the search call
        state.underlyingToken = realToken;
        emitActivity(state.sessionToken, "signal", `✅ MCX futures resolved: ${symbol} → ${realToken}`);
      } else {
        // MCX futures token resolve failed.
        // Skip the trade in ALL cases when a token is present — the token is likely expired.
        // Only use mock premiums when there is NO token at all (no-token paper mode).
        console.warn(`[BotEngine] ${state.sessionToken} — Could not resolve MCX futures token for ${symbol}. Skipping trade.`);
        emitActivity(state.sessionToken, "error", `⚠ MCX futures resolve failed for ${symbol} — cannot find active futures contract. Upstox instruments API may be down or token expired. Refresh token in Settings.`);
        return;
      }
    } // end isMcxPlaceholder

    // Use MCX-specific resolver for MCX tokens, NSE chain resolver for everything else.
    // Skip if optionPremiumForSizing was already set by the MCX placeholder fallback above.
    if (!optionPremiumForSizing) {
    const isMcxToken = resolvedUnderlying.startsWith("MCX_FO|");
    const resolved = isMcxToken
      ? await resolveAtmMcxOptionToken(resolvedUnderlying, ceOrPe, state.accessToken)
      : await resolveAtmOptionToken(resolvedUnderlying, ceOrPe, state.accessToken);

    if (!resolved) {
      // Option resolve failed.
      // In paper mode WITH a token: the token is likely expired — skip the trade, do NOT use fake mock premiums.
      // In paper mode WITHOUT a token: fall back to mock premium (handled by the else-if block below).
      // In live mode: always skip.
      if (state.mode === "live" || state.accessToken) {
        // Compute what the bot WOULD have bought for the activity log
        const symSkip = state.instrumentSymbol.toUpperCase();
        let strikeStepSkip = 50;
        if (symSkip.includes("GOLD")) strikeStepSkip = 100;
        else if (symSkip.includes("SILVER")) strikeStepSkip = 1000;
        else if (symSkip.includes("CRUDE") || symSkip.includes("OIL")) strikeStepSkip = 50;
        else if (symSkip.includes("NATGAS") || symSkip.includes("GAS")) strikeStepSkip = 5;
        else if (symSkip.includes("BANK")) strikeStepSkip = 100;
        const estimatedStrike = state.lastPrice > 0 ? Math.round(state.lastPrice / strikeStepSkip) * strikeStepSkip : 0;
        const wouldBuy = `${state.instrumentLabel} ${estimatedStrike} ${ceOrPe}`;
        const reason = state.mode === "live" ? "live mode — cannot trade without confirmed contract" : "option contract lookup failed (price quote OK → token valid, but no matching option contracts found for this expiry)";
        console.warn(`[BotEngine] ${state.sessionToken} — Could not resolve ATM ${ceOrPe} option (${reason}). Skipping trade.`);
        emitActivity(state.sessionToken, "error", `⚠ SKIPPED: Would buy ${wouldBuy} but option contract lookup failed. Underlying price ₹${state.lastPrice.toFixed(2)} fetched OK (token valid). Issue: no live option contracts matched for ${resolvedUnderlying}. Check: is this contract expired? Try refreshing token or restarting bot.`);
        return;
      }
      // Paper mode with no token: SKIP the trade (never use mock prices — they create fake trades)
      console.warn(`[BotEngine] ${state.sessionToken} — No access token, cannot resolve option. Skipping trade.`);
      emitActivity(state.sessionToken, "error", `⚠ SKIPPED: No Upstox access token — cannot get real option prices. Go to Settings → connect your Upstox account.`);
      return;
    } else {
      tradeInstrumentToken = resolved.token;
      tradeSymbol = `${state.instrumentSymbol}_${ceOrPe}_${resolved.strike}`;
      resolvedExpiry = resolved.expiry;
      tradeLabel = formatOptionContractLabel(state.instrumentSymbol, resolved.strike, ceOrPe, resolved.expiry);
      optionPremiumForSizing = resolved.premium;
      state.optionTradeToken = resolved.token;
      state.optionPremiumPrice = resolved.premium;
      // Use the contract's actual lot size when available (MCX lot sizes vary per commodity)
      if (resolved.lotSize && resolved.lotSize > 0) {
        state.lotSize = resolved.lotSize;
      } else if (state.accessToken && resolvedUnderlying.startsWith("NSE_INDEX|")) {
        // NSE option chain doesn't return lot_size — fetch it live from /v2/option/contract
        // (self-correcting: exchanges revise lot sizes; stale client configs sent 25 for NIFTY → rejected orders)
        const liveLot = await resolveNseLotSize(resolvedUnderlying, state.accessToken);
        const fallbackLot = getNseIndexLotSize(state.instrumentSymbol);
        const correctLot = liveLot ?? fallbackLot;
        if (correctLot && correctLot > 0 && correctLot !== state.lotSize) {
          emitActivity(state.sessionToken, "signal", `⚙ Lot size corrected: ${state.lotSize} → ${correctLot} (${liveLot ? "live from Upstox" : "NSE Jan-2026 revision"}) — orders must be lot multiples`);
          state.lotSize = correctLot;
        }
      }
      const contractName = resolved.tradingSymbol ?? `${state.instrumentSymbol} ${resolved.strike} ${ceOrPe}`;
      emitActivity(
        state.sessionToken,
        "signal",
        `📋 Contract: ${contractName} | Strike ${resolved.strike} | Premium ₹${resolved.premium.toFixed(2)}${resolved.expiry ? ` | Expiry ${resolved.expiry}` : ""}${resolved.lotSize ? ` | Lot ${resolved.lotSize}` : ""}`,
      );
      console.log(`[BotEngine] ${state.sessionToken} — Options mode: ${ceOrPe} @ strike ${resolved.strike}, premium ₹${resolved.premium.toFixed(2)}, token: ${resolved.token}`);
    }
    } // end !optionPremiumForSizing guard
  } else if (isOptionsMode && !state.accessToken) {
    // No access token — SKIP the trade entirely (never use mock prices)
    console.warn(`[BotEngine] ${state.sessionToken} — Options mode but no access token. Skipping trade.`);
    emitActivity(state.sessionToken, "error", `⚠ SKIPPED: No Upstox access token — cannot resolve option contract or get real prices. Connect your account in Settings.`);
    return;
  }

  // ── SAFETY NET: Skip if no option premium resolved ─────────────────────────────
  // If isOptionsMode=true but optionPremiumForSizing is still null/0, skip the trade.
  // This prevents spot price from leaking as entry price (₹24,000+ entries).
  if (isOptionsMode && !optionPremiumForSizing) {
    console.warn(`[BotEngine] ${state.sessionToken} — Options mode but optionPremiumForSizing is null/0. Skipping trade to prevent fake entry.`);
    emitActivity(state.sessionToken, "error", `⚠ SKIPPED: Could not determine option premium. This usually means the option contract lookup failed. Try refreshing your Upstox token.`);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // ── OPTION EXECUTION QUALITY GATES ─────────────────────────────────────────────
  // Three pre-entry filters to eliminate trades with guaranteed slippage loss.
  // ══════════════════════════════════════════════════════════════════════════════════
  if (isOptionsMode && optionPremiumForSizing && optionPremiumForSizing > 0) {
    // ── FIX 2: Minimum Premium Floor ─────────────────────────────────────────────
    // Options with premium < ₹10 are illiquid garbage — wide spreads eat you alive on exit.
    if (optionPremiumForSizing < 10) {
      const reason = `Entry blocked — premium too low (₹${optionPremiumForSizing.toFixed(1)} < ₹10 floor). Illiquid option.`;
      console.log(`[BotEngine] ${state.sessionToken} — ${reason}`);
      emitActivity(state.sessionToken, "signal", `⛔ ${reason}`);
      pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, "Premium < ₹10");
      logSignalToJournal({
        sessionToken: state.sessionToken, symbol: state.instrumentSymbol, instrumentToken: state.instrumentToken,
        direction: signal.direction, layer: signal.layer, confidence: signal.confidence,
        entryPrice: signal.entryPrice, suggestedSl: signal.slPrice, suggestedTarget: signal.targetPrice,
        atr: signal.atr, regime: signal.marketRegime, outcome: "rejected", rejectReason: "Premium < ₹10",
      });
      return;
    }

    // ── FIX 3: Expiry-Day ATM Only (no OTM on 0DTE) ─────────────────────────────
    // On expiry day, OTM options have extreme theta decay. Force ATM selection.
    if (resolvedExpiry) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const isZeroDTE = resolvedExpiry === today;
      if (isZeroDTE && tradeInstrumentToken !== state.instrumentToken) {
        emitActivity(state.sessionToken, "signal", `📋 0DTE enforcement: forcing ATM selection (OTM theta decay too high on expiry day)`);
        console.log(`[BotEngine] ${state.sessionToken} — 0DTE: re-resolving to ATM (was OTM)`);
        const ceOrPe0dte = signal.direction === "BUY" ? "CE" as const : "PE" as const;
        const resolvedUnderlying0dte = state.underlyingToken || state.instrumentToken;
        if (state.accessToken) {
          const isMcx0dte = resolvedUnderlying0dte.startsWith("MCX_FO|");
          const atmResolved = isMcx0dte
            ? await resolveAtmMcxOptionToken(resolvedUnderlying0dte, ceOrPe0dte, state.accessToken)
            : await resolveAtmOptionToken(resolvedUnderlying0dte, ceOrPe0dte, state.accessToken);
          if (atmResolved) {
            tradeInstrumentToken = atmResolved.token;
            optionPremiumForSizing = atmResolved.premium;
            state.optionTradeToken = atmResolved.token;
            state.optionPremiumPrice = atmResolved.premium;
          }
        }
      }
    }

    // ── FIX 1: Bid-Ask Spread Check (HIGH PRIORITY) ─────────────────────────────
    // Before entering ANY trade, check the spread. If spread > 5% of premium, SKIP.
    // Wide spread = guaranteed slippage loss on entry AND exit.
    if (state.accessToken && tradeInstrumentToken) {
      const optQuote = await fetchFullQuote(tradeInstrumentToken, state.accessToken);
      if (optQuote && optQuote.bid > 0 && optQuote.ask > 0) {
        const spreadAbs = optQuote.ask - optQuote.bid;
        const midPrice = (optQuote.ask + optQuote.bid) / 2;
        const spreadPct = midPrice > 0 ? (spreadAbs / midPrice) * 100 : 0;
        if (spreadPct > 5) {
          const reason = `Entry blocked — spread too wide (${spreadPct.toFixed(1)}%). Bid: ₹${optQuote.bid.toFixed(1)}, Ask: ₹${optQuote.ask.toFixed(1)}, Spread: ₹${spreadAbs.toFixed(1)}`;
          console.log(`[BotEngine] ${state.sessionToken} — ${reason}`);
          emitActivity(state.sessionToken, "signal", `⛔ ${reason}`);
          pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Spread too wide (${spreadPct.toFixed(1)}%)`);
          logSignalToJournal({
            sessionToken: state.sessionToken, symbol: state.instrumentSymbol, instrumentToken: state.instrumentToken,
            direction: signal.direction, layer: signal.layer, confidence: signal.confidence,
            entryPrice: signal.entryPrice, suggestedSl: signal.slPrice, suggestedTarget: signal.targetPrice,
            atr: signal.atr, regime: signal.marketRegime, outcome: "rejected", rejectReason: `Spread ${spreadPct.toFixed(1)}% > 5%`,
          });
          return;
        }
        // Update premium with live mid-price for more accurate sizing
        if (midPrice > 0 && Math.abs(midPrice - optionPremiumForSizing) / optionPremiumForSizing < 0.2) {
          optionPremiumForSizing = midPrice;
          state.optionPremiumPrice = midPrice;
        }
      }
      // If quote fetch fails, proceed with LTP-based premium (don't block on API failure)
    }
  }
  // ══════════════════════════════════════════════════════════════════════════════════

  // ── Position sizing ───────────────────────────────────────────────────────────────
  // For options: use option premium price for SL distance (not underlying price).
  // SL for options = 50% of premium (standard options risk management).
  // For futures/equity: use signal SL distance as before.
  const riskAmount = (state.capital * state.riskPerTradePct) / 100;
  const lotSize = state.lotSize ?? 1;
  let quantity: number;

  if (isOptionsMode && optionPremiumForSizing && optionPremiumForSizing > 0) {
    // Options sizing: CAPITAL-BASED — use max lots that capital allows
    // SL tightening (below) will control actual risk per trade
    const maxQtyByCapital = Math.floor(state.capital / optionPremiumForSizing / lotSize) * lotSize;
    if (maxQtyByCapital < lotSize) {
      // Capital too low for even 1 lot — reject trade entirely
      const reason = `Insufficient capital for 1 lot (need ${(optionPremiumForSizing * lotSize).toFixed(0)}, have ${state.capital.toFixed(0)})`;
      const rejectSignal: Signal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason, layer: "None" };
      state.lastSignal = rejectSignal;
      emitActivity(state.sessionToken, "signal", `⛔ ${reason}`);
      return;
    } else {
      quantity = maxQtyByCapital;
    }
  } else {
    const slDistance = Math.abs(signal.entryPrice - signal.slPrice);
    const rawQty = slDistance > 0 ? Math.floor(riskAmount / slDistance) : lotSize;
    quantity = Math.max(lotSize, Math.floor(rawQty / lotSize) * lotSize);
    // Per-bot capital cap for non-options: total trade cost must NOT exceed bot's own capital
    const maxQtyByCapital = Math.floor(state.capital / signal.entryPrice / lotSize) * lotSize;
    if (maxQtyByCapital < lotSize) {
      // Capital too low for even 1 lot — reject trade entirely
      const reason = `Insufficient capital for 1 lot (need ${(signal.entryPrice * lotSize).toFixed(0)}, have ${state.capital.toFixed(0)})`;
      const rejectSignal: Signal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason, layer: "None" };
      state.lastSignal = rejectSignal;
      emitActivity(state.sessionToken, "signal", `⛔ ${reason}`);
      return;
    } else {
      quantity = Math.min(quantity, maxQtyByCapital);
    }
  }

  // ── v3 Risk Gate: Portfolio exposure cap (80% of combined capital) ──────────
  // ── V2 Regime Size Reduction: halve position in VOLATILE regime ─────────────
  if (signal.sizeReduction && signal.sizeReduction > 0 && signal.sizeReduction < 1) {
    const reducedQty = Math.max(lotSize, Math.floor((quantity * signal.sizeReduction) / lotSize) * lotSize);
    if (reducedQty < quantity) {
      console.log(`[tick] SIZE REDUCTION — ${state.sessionToken.slice(0,8)} | regime=${signal.regimeV2} | qty ${quantity} → ${reducedQty} (${(signal.sizeReduction * 100).toFixed(0)}% reduction)`);
      quantity = reducedQty;
    }
  }

  const entryPriceForExposure = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing : signal.entryPrice;
  const newTradeExposure = entryPriceForExposure * quantity;
  const exposureCheck = canOpenNewTrade(getAllRunningBotsForSession(state.sessionToken.replace(/-slot\d+$/, "")), newTradeExposure);
  if (!exposureCheck.allowed) {
    const rejectSignal: Signal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: exposureCheck.reason ?? "Portfolio exposure cap reached", layer: "None" };
    state.lastSignal = rejectSignal;
    emitActivity(state.sessionToken, "signal", `⛔ Entry blocked — ${exposureCheck.reason}`);
    pushRejectedSignal(state, { direction: signal.direction as "BUY" | "SELL", layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, exposureCheck.reason ?? "Exposure cap");
    logSignalToJournal({
      sessionToken: state.sessionToken, symbol: state.instrumentSymbol, instrumentToken: state.instrumentToken,
      direction: signal.direction, layer: signal.layer, confidence: signal.confidence,
      entryPrice: signal.entryPrice, suggestedSl: signal.slPrice, suggestedTarget: signal.targetPrice,
      atr: signal.atr, regime: signal.marketRegime, outcome: "rejected", rejectReason: exposureCheck.reason ?? "Exposure cap",
    });
    return;
  }

  // ── Place order ─────────────────────────────────────────────────────────────────────────────
  // For options mode: always BUY the option (CE or PE) regardless of signal direction.
  // The direction (BUY/SELL) in the trade log refers to the underlying signal direction.
  // The actual order placed is always a BUY of the option contract.
  let orderId: string | undefined;
  if (state.mode === "live" && state.accessToken) {
    // Options: always BUY the option (CE for bullish, PE for bearish)
    // Futures/equity: use signal direction directly
    const orderDirection = isOptionsMode ? "BUY" : signal.direction;
    const oid = await placeUpstoxOrder(state.accessToken, tradeInstrumentToken, orderDirection, quantity);
    if (!oid) {
      // CRITICAL: if the order was rejected by Upstox, do NOT record a phantom trade.
      // Log the failure and skip this tick entirely.
      state.lastError = `Order rejected by Upstox — ${tradeInstrumentToken} ${orderDirection} ${quantity} qty`;
      const rejReason = getLastOrderRejectionReason();
      emitActivity(state.sessionToken, "error", `⚠ Live order REJECTED — ${tradeLabel} ${orderDirection} ${quantity} qty${rejReason ? ` | Upstox: ${rejReason}` : ". Check Upstox logs."}`);
      console.error(`[BotEngine] ${state.sessionToken} — Live order rejected, trade NOT recorded.`);
      return;
    }
    orderId = oid;
  }

  const signalLabel = signal.isPowerHour
    ? signal.reason
    : isReEntry ? `[Re-entry] ${signal.reason}` : signal.reason;

  // Compute partial profit levels BEFORE calling onTradeOpen so they are stored in DB
  // For options: use option premium price for partial levels (not underlying SL distance)
  const p1Pct = state.partial1Pct / 100; // e.g., 30 → 0.30
  const p2Pct = state.partial2Pct / 100; // e.g., 60 → 0.60
  const slDist = isOptionsMode && optionPremiumForSizing
    ? optionPremiumForSizing * p1Pct  // Use configurable partial1Pct for options (e.g., 30% of ₹252 = ₹76)
    : Math.abs(signal.entryPrice - signal.slPrice);
  const optionEntry = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing : signal.entryPrice;
  // For options: book 50% at partial1Pct profit, book 25% at partial2Pct profit
  // e.g., entry ₹252 with partial1Pct=30 → partial1R = ₹328, partial2Pct=60 → partial2R = ₹403
  const partial1RPrice = signal.partial1RPrice ?? (isOptionsMode
    ? optionEntry * (1 + p1Pct)  // e.g., ₹252 × 1.30 = ₹328
    : (signal.direction === "BUY" ? optionEntry + slDist : optionEntry - slDist));
  const partial2RPrice = signal.partial2RPrice ?? (isOptionsMode
    ? optionEntry * (1 + p2Pct)  // e.g., ₹252 × 1.60 = ₹403
    : (signal.direction === "BUY" ? optionEntry + slDist * (p2Pct / p1Pct) : optionEntry - slDist * (p2Pct / p1Pct)));

  // For options: entry/SL/target are based on option premium, not underlying price
  const tradeEntryPrice = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing : signal.entryPrice;
  let tradeSl = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * 0.80 : signal.slPrice;
  // ── CRITICAL: Adjust SL when quantity exceeds what risk formula allows ──────
  // If the minimum lot size forces quantity above rawQty, the default SL (50% of premium)
  // would cause actual monetary loss > riskAmount. Fix: tighten SL proportionally.
  // Example: premium=₹59.40, default SL=₹29.70, qty=100, actual risk=₹2970 but riskAmount=₹1500
  // Fix: SL = entry - (riskAmount/qty) = 59.40 - 15 = ₹44.40, actual risk = ₹1500 ✓
  if (isOptionsMode && optionPremiumForSizing && optionPremiumForSizing > 0) {
    const defaultSlDist = tradeEntryPrice - tradeSl; // e.g., 59.40 - 29.70 = 29.70
    const actualMaxLoss = defaultSlDist * quantity;  // e.g., 29.70 * 100 = 2970
    if (actualMaxLoss > riskAmount * 1.05) { // 5% tolerance
      const adjustedSlDist = riskAmount / quantity; // e.g., 1500 / 100 = 15
      tradeSl = tradeEntryPrice - adjustedSlDist;   // e.g., 59.40 - 15 = 44.40
      // Ensure SL doesn't go below 10% of entry (minimum breathing room)
      const minSl = tradeEntryPrice * 0.10;
      if (tradeSl < minSl) tradeSl = minSl;
      emitActivity(state.sessionToken, "signal", `⚠ SL tightened: ₹${(tradeEntryPrice - adjustedSlDist).toFixed(2)} → keeps risk within ₹${riskAmount.toFixed(0)} (qty forced to min lot ${lotSize})`);
    }
  }
  const tradeTarget = isOptionsMode && optionPremiumForSizing
    ? optionPremiumForSizing * (1 + p2Pct) // target = premium * (1 + partial2Pct), e.g., 556 * 1.60 = ₹890 (60% gain)
    : signal.targetPrice;

  // Set mutex before async DB write to prevent concurrent duplicate opens
  // DB-level guard: check if there's already an open trade for this session in the database.
  // This catches edge cases where openTrade state was lost (server restart, crash) but DB still has an open trade.
  try {
    const { getDb } = await import("./db");
    const dbCheck = await getDb();
    if (dbCheck) {
      const { tradeLog } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const existingOpen = await dbCheck
        .select({ id: tradeLog.id })
        .from(tradeLog)
        .where(and(eq(tradeLog.sessionToken, state.sessionToken), eq(tradeLog.status, "open")))
        .limit(1);
      if (existingOpen.length > 0) {
        console.warn(`[BotEngine] ${state.sessionToken.slice(0, 8)} — DB has open trade #${existingOpen[0].id}, skipping new entry`);
        emitActivity(state.sessionToken, "signal", `⊘ Signal skipped — DB already has open trade #${existingOpen[0].id}`);
        state.isOpeningTrade = false;
        return;
      }
    }
  } catch (dbErr) {
    console.error(`[BotEngine] DB guard check failed:`, dbErr);
    // Continue anyway — the in-memory guard is still active
  }
  // ── Cross-bot duplicate guard: prevent same instrument being traded by multiple bots simultaneously ──
  for (const [otherKey, otherState] of Array.from(bots.entries())) {
    if (otherKey === state.sessionToken) continue; // skip self
    if (!otherState.openTrade) continue;
    if (otherState.openTrade.instrumentToken === tradeInstrumentToken && otherState.openTrade.direction === (isOptionsMode ? "BUY" : signal.direction)) {
      console.warn(`[BotEngine] ${state.sessionToken.slice(0, 8)} — Duplicate blocked: ${otherKey.slice(0, 8)} already has ${tradeInstrumentToken} ${otherState.openTrade.direction}`);
      emitActivity(state.sessionToken, "signal", `⊘ Duplicate blocked — slot ${otherState.botSlot} already has this position`);
      pushRejectedSignal(state, { direction: signal.direction, layer: signal.layer, confidence: signal.confidence, reason: signal.reason }, `Duplicate: slot ${otherState.botSlot} already in ${tradeInstrumentToken}`);
      state.isOpeningTrade = false;
      return;
    }
  }
  // FINAL SAFETY: Double-check no open trade exists (guards against any code path that might skip the early return)
  if (state.openTrade) {
    emitActivity(state.sessionToken, "signal", `⊘ Trade blocked — already has open position`);
    return;
  }
  state.isOpeningTrade = true;
  // CRITICAL: Increment trade counter IMMEDIATELY when mutex is acquired
  // This prevents race conditions where another tick could pass the maxTradesPerDay check
  state.tradesCount += 1;
  state.lastTradeOpenedAt = Date.now();
  let dbId: number;
  try {
    dbId = await onTradeOpen({
      symbol: tradeSymbol, symbolLabel: tradeLabel,
      instrumentToken: tradeInstrumentToken, direction: isOptionsMode ? "BUY" : signal.direction, mode: state.mode,
      entryPrice: tradeEntryPrice, quantity, slPrice: tradeSl, targetPrice: tradeTarget,
      atr: signal.atr, confidence: signal.confidence, status: "open",
      upstoxOrderId: orderId, signalReason: signalLabel + (isOptionsMode ? ` [${tradeSymbol}]` : ""), enteredAt: new Date(),
      partial1RPrice, partial2RPrice,
      entryUnderlyingPrice: isOptionsMode ? price : undefined,
    });
  } catch (tradeOpenErr) {
    state.isOpeningTrade = false;
    // Rollback counter on failure
    state.tradesCount -= 1;
    state.lastTradeOpenedAt = undefined;
    const errMsg = tradeOpenErr instanceof Error ? tradeOpenErr.message : String(tradeOpenErr);
    state.lastError = `Trade open DB write failed: ${errMsg}`;
    console.error(`[BotEngine] ${state.sessionToken} — onTradeOpen failed, mutex released:`, errMsg);
    emitActivity(state.sessionToken, "error", `⚠ Trade open failed (DB write error): ${errMsg}. Mutex released — bot will retry next signal.`);
    return;
  }

  // Determine mock key for paper-mode option premium lookup at exit time
  // Must match the same logic used at entry time above
  let optionMockKey: string | undefined;
  if (isOptionsMode) {
    const sym2 = state.instrumentSymbol.toUpperCase();
    const ceOrPe2: "CE" | "PE" = signal.direction === "BUY" ? "CE" : "PE";
    if (sym2.includes("GOLD"))       optionMockKey = ceOrPe2 === "CE" ? "MCX_GOLD_CE"   : "MCX_GOLD_PE";
    else if (sym2.includes("SILVER")) optionMockKey = ceOrPe2 === "CE" ? "MCX_SILVER_CE" : "MCX_SILVER_PE";
    else if (sym2.includes("CRUDE") || sym2.includes("OIL")) optionMockKey = ceOrPe2 === "CE" ? "MCX_CRUDE_CE" : "MCX_CRUDE_PE";
    else if (sym2.includes("NATGAS") || sym2.includes("GAS")) optionMockKey = ceOrPe2 === "CE" ? "MCX_NATGAS_CE" : "MCX_NATGAS_PE";
    else if (sym2.includes("COPPER")) optionMockKey = ceOrPe2 === "CE" ? "MCX_COPPER_CE" : "MCX_COPPER_PE";
    else if (sym2.includes("ZINC"))   optionMockKey = ceOrPe2 === "CE" ? "MCX_ZINC_CE"   : "MCX_ZINC_PE";
    else if (sym2.includes("BANK"))   optionMockKey = ceOrPe2 === "CE" ? "BNF_CE"        : "BNF_PE";
    else                              optionMockKey = ceOrPe2 === "CE" ? "NIFTY_CE"      : "NIFTY_PE";
  }

  state.openTrade = {
    dbId, symbol: tradeSymbol, symbolLabel: tradeLabel,
    instrumentToken: tradeInstrumentToken, direction: isOptionsMode ? "BUY" : signal.direction, mode: state.mode,
    entryPrice: tradeEntryPrice, quantity, slPrice: tradeSl, targetPrice: tradeTarget,
    atr: signal.atr, confidence: signal.confidence, upstoxOrderId: orderId,
    enteredAt: new Date(), trailingSlEnabled: state.trailingSlEnabled,
    trailingSlPct: state.trailingSlPct, currentSl: tradeSl, isReEntry,
    partial1RPrice, partial2RPrice, partialBooked: 0, bookedQty: 0, bookedPnl: 0,
    isHeroZero: signal.isHeroZero, heroZeroPremiumEntry: signal.isHeroZero ? signal.entryPrice : undefined,
    isIndexOptions: isOptionsMode, optionMockKey,
    entryUnderlyingPrice: isOptionsMode ? price : undefined, // underlying price at entry for paper mode delta drift
    signalReason: signalLabel, signalLayer: signal.layer,
  };

  state.isOpeningTrade = false; // Release mutex after openTrade is set
  // Mark HourlyClose as fired for today (one-shot strategy)
  if (signal.layer === "HourlyClose") {
    state.hourlyCloseSignalFired = true;
  }
  // Mark Opening Burst as taken AFTER trade actually opens (not at signal generation)
  if (signal.layer === "OpeningBurst") {
    state.openingBurstTradeTaken = true;
  }
  // Log signal as traded in journal
  logSignalToJournal({
    sessionToken: state.sessionToken, symbol: state.instrumentSymbol, instrumentToken: state.instrumentToken,
    direction: signal.direction, layer: signal.layer, confidence: signal.confidence,
    entryPrice: signal.entryPrice, suggestedSl: signal.slPrice, suggestedTarget: signal.targetPrice,
    atr: signal.atr, regime: signal.marketRegime, outcome: "traded", tradeId: dbId,
  });
  const tradeType = signal.isPowerHour ? "⚡ POWER HOUR" : isReEntry ? "↩ RE-ENTRY" : "TRADE";
  // For options mode: show option premium prices in activity log (not underlying index price)
  const displayEntry  = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing : signal.entryPrice;
  const displaySl     = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * 0.80 : signal.slPrice;
  const displayTarget = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * (1 + p2Pct) : signal.targetPrice;
  const displayLabel  = isOptionsMode && optionPremiumForSizing ? `${tradeLabel} (premium)` : state.instrumentLabel;
  console.log(`[BotEngine] ${state.sessionToken} — ${tradeType}: ${signal.direction} ${state.instrumentSymbol} @ ₹${displayEntry.toFixed(2)} | Conf: ${(signal.confidence * 100).toFixed(0)}% | Layer: ${signal.layer}`);
  const capitalDeployed = displayEntry * quantity;
  emitActivity(state.sessionToken, "trade_open", `${tradeType} ${signal.direction} ${displayLabel} @ ₹${displayEntry.toFixed(2)} | SL: ₹${displaySl.toFixed(2)} | Target: ₹${displayTarget.toFixed(2)} | Qty: ${quantity} (${Math.floor(quantity / lotSize)} lot${Math.floor(quantity / lotSize) > 1 ? "s" : ""}) | 💰 Capital: ₹${capitalDeployed.toLocaleString("en-IN", { maximumFractionDigits: 0 })} | Risk: ₹${riskAmount.toFixed(0)} | ${(signal.confidence * 100).toFixed(0)}% conf | ${signal.layer}`, { price: displayEntry, confidence: signal.confidence });

  // Telegram: send trade alert
  const dirEmoji = signal.direction === "BUY" ? "🟢" : "🔴";
  const layerTag = signal.isHeroZero ? "🦸 HERO ZERO" : signal.isPowerHour ? "⚡ POWER HOUR" : signal.isMCXEvening ? "🌙 MCX EVENING" : isReEntry ? "↩ RE-ENTRY" : `📊 ${signal.layer}`;
  if (signal.isHeroZero) {
    sendTelegramAlert(state,
      `🦸 <b>HERO ZERO SIGNAL</b> ${dirEmoji}\n` +
      `📊 <b>${state.instrumentLabel}</b>\n` +
      `💰 Premium: ₹${signal.entryPrice.toFixed(1)} | Target: ₹${signal.targetPrice.toFixed(1)} (5×)\n` +
      `✂️ Cut: ₹${signal.slPrice.toFixed(1)} (50% loss)\n` +
      `📊 Book 50% at ₹${partial1RPrice.toFixed(1)} | 25% at ₹${partial2RPrice.toFixed(1)}\n` +
      `💯 Confidence: ${(signal.confidence * 100).toFixed(0)}%`,
      "tradeEntry",
    );
  } else {
    sendTelegramAlert(state,
      `${dirEmoji} <b>${signal.direction} SIGNAL</b> — ${layerTag}\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${signal.entryPrice.toFixed(2)}\n` +
      `🛑 SL: ₹${signal.slPrice.toFixed(2)} | 🎯 Target: ₹${signal.targetPrice.toFixed(2)}\n` +
      `💯 Confidence: ${(signal.confidence * 100).toFixed(0)}% | Qty: ${quantity}\n` +
      `📝 ${signal.reason}`,
      "tradeEntry",
    );
  }
  } catch (tickErr: unknown) {
    // Defensive: log any uncaught error in tick to prevent silent crashes
    const errMsg = tickErr instanceof Error ? tickErr.message : String(tickErr);
    const errStack = tickErr instanceof Error ? tickErr.stack : "";
    console.error(`[BotEngine] UNCAUGHT tick error (${state.sessionToken.slice(0, 8)}): ${errMsg}\n${errStack}`);
    state.lastError = `Tick crash: ${errMsg}`;
    emitActivity(state.sessionToken, "error", `🔴 Tick crash: ${errMsg}`);
    // Re-throw so the setInterval .catch() handler counts it toward the 3-error auto-restart
    throw tickErr;
  } finally {
    // BUG-8+10 fix: Set nextScanAt at END of tick so Opening Burst 15s override is reflected
    // If Opening Burst already set nextScanAt to 15s, don't overwrite it with the default interval
    if (!state.nextScanAt || state.nextScanAt <= Date.now()) {
      state.nextScanAt = Date.now() + state.scanIntervalSec * 1000;
    }
    state.tickInProgress = false;
  }
}

export type TradeInsert = {
  symbol: string; symbolLabel: string; instrumentToken: string;
  direction: "BUY" | "SELL"; mode: "paper" | "live";
  entryPrice: number; quantity: number; slPrice: number; targetPrice: number;
  atr: number; confidence: number; status: "open" | "closed" | "cancelled";
  upstoxOrderId?: string; signalReason: string; enteredAt: Date;
  // Partial profit levels — stored in DB so they survive server restarts exactly
  partial1RPrice: number;
  partial2RPrice: number;
  // Options mode: underlying price at entry (for delta approximation when live premium unavailable)
  entryUnderlyingPrice?: number;
};

// ── Public API ────────────────────────────────────────────────────────────────
export function startBot(
  config: Omit<BotState, "candles" | "candles5m" | "candlesDay" | "lastSignal" | "lastPrice" | "bidPrice" | "askPrice" | "openTrade" | "intervalHandle" | "lastError" | "nextScanAt" | "lastTickAt" | "lastSlHitAt" | "lastSlDirection" | "reEntryCandles" | "lastSlExitDirection" | "lastSlExitAt" | "consecutiveSameDirectionSLs" | "isPowerHourMode" | "isMCXEveningMode" | "isMCXLateSessionMode" | "heroZeroMode" | "alertsSent">,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,  
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
  existingOpenTrade?: OpenTrade | null,
  onTick?: (state: BotState) => Promise<void>,
) {
  const existing = bots.get(config.sessionToken);
  if (existing?.intervalHandle) clearInterval(existing.intervalHandle);

  // No pre-warm: the Upstox intraday candle API works without auth and returns the
  // full day's history on the first tick. Using mock candles would pollute the signal
  // engine with fake prices. The bot will collect real candles from the first tick.
  const state: BotState = {
    ...config,
    candles: [],
    candles5m: [],
    candlesDay: [],
    lastSignal: null, lastPrice: 0, bidPrice: 0, askPrice: 0,
    openTrade: existingOpenTrade ?? null, intervalHandle: null, lastError: null,
    nextScanAt: Date.now() + config.scanIntervalSec * 1000,
    lastTickAt: 0,
    lastSlHitAt: null, lastSlDirection: null, reEntryCandles: 0,
    lastSlExitDirection: null, lastSlExitAt: null, consecutiveSameDirectionSLs: 0, consecutiveUnderlyingSLs: 0, lastUnderlyingSLAt: null,
    isPowerHourMode: false,
    isMCXEveningMode: false, isMCXLateSessionMode: false, heroZeroMode: false,
    openingBurstMode: false, openingBurstTradeTaken: false,
    alertsSent: new Set<string>(),
  };

  // Restore optionTradeToken from existing open trade so live quote fetching works after restart
  if (existingOpenTrade && existingOpenTrade.isIndexOptions && existingOpenTrade.instrumentToken) {
    const token = existingOpenTrade.instrumentToken;
    // Only restore if it's a real option token (not a fake PAPER_OPT|... token)
    if (!token.startsWith("PAPER_OPT|")) {
      state.optionTradeToken = token;
    } else if (state.accessToken) {
      // Paper mode with PAPER_OPT token: try to re-resolve the real option token
      // so we can fetch live quotes for accurate P&L display
      // MUST resolve synchronously before starting tick interval
      state._pendingOptionResolve = (async () => {
        try {
          const sym = (existingOpenTrade.symbolLabel ?? existingOpenTrade.symbol ?? "").toUpperCase();
          const ceOrPe: "CE" | "PE" = sym.includes("CE") ? "CE" : "PE";
          const underlyingToken = state.underlyingToken ?? state.instrumentToken;
          const isMcxToken = underlyingToken.startsWith("MCX_FO|");
          
          // Try to extract exact strike from symbol (e.g., "NIFTY 16JUL26 24100 CE" → 24100)
          // Handles both "NIFTY 16JUL26 24100 CE" and "NIFTY_CE_24100" formats
          const strikeMatch = sym.match(/(\d{3,6})\s*(CE|PE)|(CE|PE)[_\s]*(\d{3,6})/);
          const exactStrike = strikeMatch
            ? parseInt(strikeMatch[1] ?? strikeMatch[4] ?? "0", 10)
            : 0;
          
          let resolvedToken: string | null = null;
          
          // Priority 1: Resolve the EXACT strike (most accurate)
          if (exactStrike > 0) {
            if (isMcxToken) {
              // MCX: use ATM resolver but filter for exact strike match
              const mcxResolved = await resolveAtmMcxOptionToken(underlyingToken, ceOrPe, state.accessToken!);
              if (mcxResolved?.token && Math.abs(mcxResolved.strike - exactStrike) < 100) {
                resolvedToken = mcxResolved.token;
                console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — MCX resolved strike ${mcxResolved.strike} ${ceOrPe} (target: ${exactStrike}): ${resolvedToken}`);
                emitActivity(state.sessionToken, "bot_start", `✓ MCX Resolved strike ${mcxResolved.strike} ${ceOrPe} → token ${resolvedToken.slice(-20)}`, { price: exactStrike });
              }
            } else {
              resolvedToken = await resolveSpecificOptionToken(underlyingToken, ceOrPe, exactStrike, state.accessToken!);
              if (resolvedToken) {
                console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — resolved EXACT strike ${exactStrike} ${ceOrPe}: ${resolvedToken}`);
                emitActivity(state.sessionToken, "bot_start", `✓ Resolved EXACT strike ${exactStrike} ${ceOrPe} → token ${resolvedToken.slice(-20)}`, { price: exactStrike });
              }
            }
          }
          
          // Priority 2: Fall back to ATM resolution (might be wrong strike but better than nothing)
          if (!resolvedToken) {
            const resolved = isMcxToken
              ? await resolveAtmMcxOptionToken(underlyingToken, ceOrPe, state.accessToken!)
              : await resolveAtmOptionToken(underlyingToken, ceOrPe, state.accessToken!);
            if (resolved?.token) {
              resolvedToken = resolved.token;
              console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — fell back to ATM resolution: ${resolvedToken}`);
              emitActivity(state.sessionToken, "bot_start", `⚠ Fell back to ATM resolution (not exact strike): ${resolvedToken?.slice(-20)}`, { price: 0 });
            }
          }
          
          if (resolvedToken) {
            state.optionTradeToken = resolvedToken;
            // Also fetch initial quote to set optionPremiumPrice immediately
            const quote = await fetchFullQuote(resolvedToken, state.accessToken!);
            if (quote && quote.ltp > 0) {
              state.optionPremiumPrice = quote.ltp;
            }
            console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — option token set: ${resolvedToken} | premium: ₹${state.optionPremiumPrice ?? "N/A"}`);
            emitActivity(state.sessionToken, "bot_start", `Option token restored — premium ₹${(state.optionPremiumPrice ?? 0).toFixed(1)} | token: ...${resolvedToken.slice(-15)}`, { price: state.optionPremiumPrice ?? 0 });
          } else {
            console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — option re-resolution returned no token`);
            emitActivity(state.sessionToken, "error", `Option token re-resolution FAILED — P&L will show ₹0 until next tick resolves it`);
          }
        } catch (e) {
          console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — failed to re-resolve option token: ${(e as Error).message}`);
          emitActivity(state.sessionToken, "error", `Option token re-resolve error: ${(e as Error).message}`);
        }
      })();
    }
  }

  const intervalMs = Math.max(15, config.scanIntervalSec) * 1000;
  const handle = setInterval(() => {
    // Wait for pending option token resolution before first tick
    const doTick = async () => {
      if (state._pendingOptionResolve) {
        await state._pendingOptionResolve;
        state._pendingOptionResolve = undefined;
      }
      await tick(state, onTradeOpen, onTradeClose, onTick);
    };
    doTick()
      .then(() => {
        // Reset consecutive error counter on successful tick
        state.consecutiveTickErrors = 0;
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BotEngine] Tick error (${config.sessionToken}):`, msg);
        state.lastError = `Tick error: ${msg}`;
        state.consecutiveTickErrors = (state.consecutiveTickErrors ?? 0) + 1;
        emitActivity(config.sessionToken, "error", `⚠ Tick error (${state.consecutiveTickErrors}/3): ${msg}`);
        // Auto-restart after 3 consecutive failures
        if (state.consecutiveTickErrors >= 3) {
          console.warn(`[BotEngine] Auto-restarting bot ${config.sessionToken} after 3 consecutive tick failures`);
          emitActivity(config.sessionToken, "bot_start", `🔄 Auto-restarting bot after 3 consecutive tick errors — preserving open trade`);
          sendTelegramAlert(state,
            `🔄 <b>BOT AUTO-RESTARTED</b> — ${state.instrumentLabel}\n` +
            `Reason: 3 consecutive tick errors\nLast error: ${msg}\nMode: ${state.mode}`
          ).catch(() => {});
          // Clear the old interval and restart
          clearInterval(handle);
          state.intervalHandle = null;
          state.consecutiveTickErrors = 0;
          state.lastError = null;
          // Re-start the bot with current state fields (not the stale config closure).
          // This ensures updated fields like underlyingToken (MCX resolved token) are preserved.
          startBot({
            sessionToken: state.sessionToken,
            sessionId: state.sessionId,
            status: "running",
            mode: state.mode,
            instrumentToken: state.instrumentToken,
            instrumentSymbol: state.instrumentSymbol,
            instrumentLabel: state.instrumentLabel,
            capital: state.capital,
            riskPerTradePct: state.riskPerTradePct,
            maxTradesPerDay: state.maxTradesPerDay,
            dailyLossLimitPct: state.dailyLossLimitPct,
            stopLossMultiplier: state.stopLossMultiplier,
            targetMultiplier: state.targetMultiplier,
            trailingSlEnabled: state.trailingSlEnabled,
            trailingSlPct: state.trailingSlPct,
            minConfidence: state.minConfidence,
            scanIntervalSec: state.scanIntervalSec,
            tradesCount: state.tradesCount,
            dailyPnl: state.dailyPnl,
            accessToken: state.accessToken,
            telegramBotToken: state.telegramBotToken,
            telegramChatId: state.telegramChatId,
            telegramEnabled: state.telegramEnabled,
            botSlot: state.botSlot,
            lotSize: state.lotSize,
            isIndexOptions: state.isIndexOptions,
            underlyingToken: state.underlyingToken,
            optionType: state.optionType,
            consecutiveTickErrors: 0,
           enabledLayers: state.enabledLayers,
            partial1Pct: state.partial1Pct,
           partial2Pct: state.partial2Pct,
           carryForward: state.carryForward,
           unlimitedTrades: state.unlimitedTrades,
           averagingEnabled: state.averagingEnabled,
           averagingLossThreshold: state.averagingLossThreshold,
           openingBurstEnabled: state.openingBurstEnabled,
           consecutiveUnderlyingSLs: state.consecutiveUnderlyingSLs, lastUnderlyingSLAt: state.lastUnderlyingSLAt,
         }, onTradeOpen, onTradeClose, state.openTrade ?? undefined, onTick);
        }
      });
  }, intervalMs);
  state.intervalHandle = handle;
  bots.set(config.sessionToken, state);
  console.log(`[startBot] ✓ Bot added to Map — token=${config.sessionToken.slice(0,8)}, mapSize=${bots.size}, status=${state.status}`);
  emitActivity(config.sessionToken, "bot_start", `Bot started — ${config.instrumentLabel} | ${config.mode} mode | Capital: ₹${config.capital.toLocaleString()} | Scan: ${config.scanIntervalSec}s | MapSize: ${bots.size}`);
  tick(state, onTradeOpen, onTradeClose, onTick).catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[BotEngine] ⚠ INITIAL TICK ERROR (${config.sessionToken}):\n  MSG: ${msg}\n  STACK: ${stack}`);
    state.lastError = `Tick error: ${msg}`;
    emitActivity(config.sessionToken, "error", `⚠ Initial tick error: ${msg}`);
  });
}
export function stopBot(sessionToken: string) {
  const state = bots.get(sessionToken);
  if (state?.intervalHandle) { clearInterval(state.intervalHandle); state.intervalHandle = null; state.status = "stopped"; }
  emitActivity(sessionToken, "bot_stop", `Bot stopped | Day P&L: ₹${state?.dailyPnl?.toFixed(0) ?? "0"} | Trades: ${state?.tradesCount ?? 0}`);
  if (state) {
    const pnlSign = (state.dailyPnl ?? 0) >= 0 ? "+" : "";
    sendTelegramAlert(state,
      `⏹ <b>BOT STOPPED</b> — ${state.instrumentLabel}\n` +
      `Mode: ${state.mode} | Day P&L: ${pnlSign}₹${(state.dailyPnl ?? 0).toFixed(0)} | Trades: ${state.tradesCount ?? 0}`
    );
  }
  // Clean up: remove from bots Map to prevent memory leak (unbounded growth)
  bots.delete(sessionToken);
}

export function getBotState(sessionToken: string): BotState | undefined {
  return bots.get(sessionToken);
}

export function getLivePrice(sessionToken: string): number {
  return bots.get(sessionToken)?.lastPrice ?? 0;
}

// Returns the first running bot whose sessionToken starts with the given prefix
// Used to find the primary bot when the client sessionToken matches the bot's base token
export function getBotStateByPrefix(sessionToken: string): BotState | undefined {
  // Exact match first
  const exact = bots.get(sessionToken);
  if (exact) return exact;
  // Then try prefix match (e.g. sessionToken is the base, bot key is sessionToken-slot1)
  for (const [key, state] of Array.from(bots.entries())) {
    if (key.startsWith(sessionToken) && state.status === 'running') return state;
  }
  return undefined;
}

/** Return all currently running bot states for a given base sessionToken (all slots) */
export function getAllRunningBotsForSession(sessionToken: string): BotState[] {
  const results: BotState[] = [];
  for (const [key, state] of Array.from(bots.entries())) {
    if ((key === sessionToken || key.startsWith(sessionToken + '-slot')) && state.status === 'running') {
      results.push(state);
    }
  }
  return results;
}

/**
 * Force manual average-down on the current open trade.
 * Called from the dashboard "Force Average" button.
 * Bypasses the automatic reversal detection — user decides when to average.
 * Still respects: max 1 average per trade, not already averaged, has open trade.
 */
export async function forceAverageDown(sessionToken: string): Promise<{ success: boolean; error?: string; newAvgEntry?: number; addedQty?: number }> {
  const state = getBotState(sessionToken) ?? getBotStateByPrefix(sessionToken);
  if (!state) return { success: false, error: "Bot not running" };
  
  const trade = state.openTrade;
  if (!trade) return { success: false, error: "No open trade" };
  if ((trade.averageCount ?? 0) > 0) return { success: false, error: "Already averaged once" };
  if (trade.partialBooked > 0) return { success: false, error: "Cannot average after partial booking" };
  
  // For options trades: use the option premium price, not the underlying index price
  const effectivePrice = (trade.isIndexOptions && state.optionPremiumPrice && state.optionPremiumPrice > 0)
    ? state.optionPremiumPrice
    : state.lastPrice;
  if (!effectivePrice || effectivePrice <= 0) return { success: false, error: "No live price available" };
  
  // Check if trade is actually in loss (no point averaging if in profit)
  const lossPct = trade.direction === "BUY"
    ? (trade.entryPrice - effectivePrice) / trade.entryPrice
    : (effectivePrice - trade.entryPrice) / trade.entryPrice;
  if (lossPct <= 0) return { success: false, error: "Trade is in profit — no need to average" };
  
  // Calculate averaging quantity
  const avgPrice = effectivePrice;
  const maxAvgCapital = state.capital * (state.riskPerTradePct / 100) * 2;
  const maxQtyByCapital = Math.floor(maxAvgCapital / avgPrice);
  const lotSize = state.lotSize || 1;
  let avgQty = Math.min(trade.quantity, maxQtyByCapital);
  avgQty = Math.max(lotSize, Math.floor(avgQty / lotSize) * lotSize);
  
  // For live mode: place the order
  if (trade.mode === "live" && state.accessToken) {
    const avgOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction, avgQty);
    if (!avgOrderId) {
      trade.averageCount = 1; // Prevent retry spam
      return { success: false, error: "Upstox order rejected" };
    }
  }
  
  // Calculate new weighted average entry price
  const oldTotal = trade.entryPrice * trade.quantity;
  const newTotal = avgPrice * avgQty;
  const combinedQty = trade.quantity + avgQty;
  const newAvgEntry = (oldTotal + newTotal) / combinedQty;
  
  // Store original entry
  if (!trade.originalEntryPrice) {
    trade.originalEntryPrice = trade.entryPrice;
  }
  
  // Update trade
  const atrNow = calcATR(state.candles, 14);
  trade.entryPrice = newAvgEntry;
  trade.quantity = combinedQty;
  trade.averageCount = 1;
  trade.averagedAt = Date.now();
  
  // New SL: tighter
  const newSlDist = atrNow * 0.8;
  trade.slPrice = trade.direction === "BUY" ? newAvgEntry - newSlDist : newAvgEntry + newSlDist;
  trade.currentSl = trade.slPrice;
  
  // New Target: realistic recovery
  trade.targetPrice = trade.direction === "BUY" ? newAvgEntry + atrNow * 1.5 : newAvgEntry - atrNow * 1.5;
  
  // Recalculate partial booking levels
  const p1Pct = state.partial1Pct / 100;
  const p2Pct = state.partial2Pct / 100;
  trade.partial1RPrice = trade.direction === "BUY" ? newAvgEntry * (1 + p1Pct) : newAvgEntry * (1 - p1Pct);
  trade.partial2RPrice = trade.direction === "BUY" ? newAvgEntry * (1 + p2Pct) : newAvgEntry * (1 - p2Pct);
  
  // Persist to DB
  try {
    const { tradeLog: tl } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("./db");
    const db = await getDb();
    if (db && trade.dbId) {
      await db.update(tl).set({
        entryPrice: newAvgEntry,
        quantity: combinedQty,
        slPrice: trade.slPrice,
        targetPrice: trade.targetPrice,
        partial1RPrice: trade.partial1RPrice,
        partial2RPrice: trade.partial2RPrice,
      }).where(eq(tl.id, trade.dbId));
    }
  } catch (e) { console.error("[BotEngine] Failed to persist manual averaging:", e); }
  
  // Send Telegram alert
  const avgMsg = `📊 <b>MANUAL AVERAGE DOWN</b>\n` +
    `📈 <b>${trade.symbolLabel}</b>\n` +
    `➕ Added ${avgQty} qty @ ₹${avgPrice.toFixed(2)}\n` +
    `📉 Original: ₹${trade.originalEntryPrice?.toFixed(2)} → New avg: ₹${newAvgEntry.toFixed(2)}\n` +
    `📦 Total qty: ${combinedQty} | SL: ₹${trade.slPrice.toFixed(2)} | Target: ₹${trade.targetPrice.toFixed(2)}\n` +
    `⚡ Manual override — loss was ${(lossPct * 100).toFixed(0)}%`;
  sendTelegramAlert(state, avgMsg);
  emitActivity(state.sessionToken, "trade_open", `📊 MANUAL AVG ${trade.symbolLabel} +${avgQty} @ ₹${avgPrice.toFixed(2)} | New avg: ₹${newAvgEntry.toFixed(2)}`, { price: avgPrice, confidence: 1.0 });
  
  return { success: true, newAvgEntry, addedQty: avgQty };
}

// Resolve a specific option token by strike price (for restoring open trades after restart)
export async function resolveSpecificOptionToken(
  underlyingToken: string,
  optionType: "CE" | "PE",
  strike: number,
  accessToken: string,
): Promise<string | null> {
  try {
    // MCX not supported here — use resolveAtmMcxOptionToken
    if (underlyingToken.startsWith("MCX_FO|")) return null;
    
    // Use same API as resolveAtmOptionToken: instrument_key + expiry_date
    const isBankNifty = underlyingToken.toLowerCase().includes("nifty bank");
    const expiryOrder = isBankNifty
      ? ["current_month", "next_month"]
      : ["current_week", "next_week", "current_month", "next_month"];
    
    let chainData: any[] = [];
    for (const expiry of expiryOrder) {
      try {
        const resp = await axios.get(
          `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(underlyingToken)}&expiry_date=${expiry}`,
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 },
        );
        chainData = resp.data?.data ?? [];
        if (chainData.length > 0) break;
      } catch { /* try next expiry */ }
    }
    if (chainData.length === 0) {
      console.log(`[resolveSpecificOptionToken] No chain data for ${underlyingToken} strike ${strike} ${optionType}`);
      return null;
    }
    
    // Find the exact strike
    for (const row of chainData) {
      if (Math.abs((row.strike_price ?? 0) - strike) < 1) {
        const opt = optionType === "CE" ? row.call_options : row.put_options;
        if (opt?.instrument_key) {
          console.log(`[resolveSpecificOptionToken] ✓ Resolved ${underlyingToken} ${strike} ${optionType} → ${opt.instrument_key}`);
          return opt.instrument_key;
        }
      }
    }
    console.log(`[resolveSpecificOptionToken] Strike ${strike} not found in ${chainData.length} rows for ${underlyingToken}`);
    return null;
  } catch (e) {
    console.log(`[resolveSpecificOptionToken] Failed for ${underlyingToken} ${strike} ${optionType}:`, (e as Error).message);
    return null;
  }
}

// ── Shadow Mode API helpers ──────────────────────────────────────────────────

/** Toggle shadow mode on/off for a specific bot slot */
export function toggleShadowMode(sessionToken: string, enabled: boolean): { success: boolean; error?: string } {
  const state = getBotState(sessionToken) ?? getBotStateByPrefix(sessionToken);
  if (!state) return { success: false, error: "Bot not running" };
  state.shadowMode = enabled;
  if (enabled && !state.shadowLog) {
    state.shadowLog = [];
  }
  emitActivity(state.sessionToken, "signal", `👁 Shadow mode ${enabled ? "ENABLED" : "DISABLED"} — ${enabled ? "old logic trades, new logic (P0+P1) logs only" : "normal mode resumed"}`);
  return { success: true };
}

/** Get shadow mode summary for a bot session */
export function getShadowSummary(sessionToken: string): ShadowSummary | null {
  const state = getBotState(sessionToken) ?? getBotStateByPrefix(sessionToken);
  if (!state || !state.shadowLog || state.shadowLog.length === 0) return null;

  const entries = state.shadowLog;
  const totalSignals = entries.length;
  const agreements = entries.filter(e => e.difference === "SAME").length;
  const disagreements = totalSignals - agreements;
  const newBlockedOldAllowed = entries.filter(e => e.difference.startsWith("NEW_BLOCKED")).length;
  const newAllowedOldBlocked = entries.filter(e => e.difference === "NEW_ALLOWED_OLD_BLOCKED").length;

  // Use IST date for the summary
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const date = istDate.toISOString().split("T")[0];

  return {
    date,
    totalSignals,
    agreements,
    disagreements,
    newBlockedOldAllowed,
    newAllowedOldBlocked,
    entries,
  };
}

/** Clear shadow log for a bot session */
export function clearShadowLog(sessionToken: string): { success: boolean } {
  const state = getBotState(sessionToken) ?? getBotStateByPrefix(sessionToken);
  if (!state) return { success: false };
  state.shadowLog = [];
  return { success: true };
}

/**
 * Get ALL bots for a session (running, paused, or any status) — used by Kill Switch.
 * Unlike getAllRunningBotsForSession which only returns running bots.
 */
export function getAllBotsForSession(sessionToken: string): BotState[] {
  const results: BotState[] = [];
  for (const [key, state] of Array.from(bots.entries())) {
    if (key === sessionToken || key.startsWith(sessionToken + '-slot')) {
      results.push(state);
    }
  }
  return results;
}
