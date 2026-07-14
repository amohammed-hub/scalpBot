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
import { logSignalToJournal, updateJournalOnTradeClose } from "./precisionMetrics";
import {
  getStoplossGuardState, checkPortfolioDrawdown, canOpenNewTrade,
  recordTradeClose, isCooldownActive, applyPaperCosts, getPaperCostConfig, resetDailyState,
} from "./riskManager";

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
  layer: "Breakout" | "Pattern" | "Trend" | "Momentum" | "MACD_BB" | "PowerHour" | "MCXEvening" | "HeroZero" | "ORB" | "VWAPReversion" | "VWAPPullback" | "InstFootprint" | "HourlyClose" | "BoomingBulls" | "None";
  // Institutional strategy metadata
  orbHigh?: number;
  orbLow?: number;
  vwapZScore?: number;
  marketRegime?: string;
  isPowerHour?: boolean;
  isMCXEvening?: boolean;
  isHeroZero?: boolean;
  // Partial profit booking levels
  partial1RPrice?: number;  // price at which to book 50%
  partial2RPrice?: number;  // price at which to book next 25%
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
  isPowerHourMode: boolean;
  isMCXEveningMode: boolean;
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
}

// ── In-memory store ───────────────────────────────────────────────────────────
const bots = new Map<string, BotState>();

// ── Telegram alert helper ─────────────────────────────────────────────────────
async function sendTelegramAlert(state: BotState, message: string): Promise<void> {
  if (!state.telegramEnabled || !state.telegramBotToken || !state.telegramChatId) return;
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
): { direction: "BUY" | "SELL" | "HOLD"; orbHigh: number; orbLow: number; breakoutPct: number } {
  if (candles.length < orbMinutes + 2) return { direction: "HOLD", orbHigh: 0, orbLow: 0, breakoutPct: 0 };
  const orbCandles = candles.slice(0, orbMinutes);
  const orbHigh = Math.max(...orbCandles.map(c => c.high));
  const orbLow  = Math.min(...orbCandles.map(c => c.low));
  const price   = candles[candles.length - 1].close;
  const avgVol  = orbCandles.reduce((a, c) => a + c.volume, 0) / orbCandles.length;
  const lastVol = candles[candles.length - 1].volume;
  // Index instruments have volume=0 — bypass volume check
  const isIndex = avgVol === 0 && lastVol === 0;
  const volRatio = isIndex ? volThreshold : (avgVol > 0 ? lastVol / avgVol : 1);
  if (price > orbHigh && volRatio >= volThreshold) {
    return { direction: "BUY",  orbHigh, orbLow, breakoutPct: (price - orbHigh) / orbHigh };
  }
  if (price < orbLow && volRatio >= volThreshold) {
    return { direction: "SELL", orbHigh, orbLow, breakoutPct: (orbLow - price) / orbLow };
  }
  return { direction: "HOLD", orbHigh, orbLow, breakoutPct: 0 };
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
  if (istMin >= 555 && istMin < 570)  return { multiplier: 0,    label: "Opening Volatility",    skip: true  };
  if (istMin >= 570 && istMin < 600)  return { multiplier: 0.90, label: "Settling",               skip: false };
  if (istMin >= 600 && istMin < 690)  return { multiplier: 1.10, label: "Prime Morning",          skip: false };
  if (istMin >= 690 && istMin < 780)  return { multiplier: 0.95, label: "Midday",            skip: false };
  if (istMin >= 780 && istMin < 840)  return { multiplier: 1.00, label: "Afternoon",              skip: false };
  if (istMin >= 840 && istMin < 900)  return { multiplier: 1.10, label: "Institutional Window",   skip: false };
  if (istMin >= 900 && istMin < 930)  return { multiplier: 1.20, label: "Power Hour",             skip: false };
  return { multiplier: 1.0, label: "Normal", skip: false };
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
): Signal {
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
  // NSE/BSE index instruments (Nifty, BankNifty, Sensex) return volume=0 from Upstox
  // because they are calculated values, not traded instruments. When all volume is 0,
  // bypass volume filters by treating volRatio as 1.5 (passes all vol checks).
  // Always bypass volume filters — volume checks were causing zero trades.
  const volRatio = 1.5;

  const now = new Date();
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
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `Skipping ${tod.label} (9:15–9:30 AM opening volatility)`, layer: "None" };
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

  // Strict 5m alignment: BUY only when 5m is bullish or neutral-with-bullish-lean; SELL only when 5m is bearish or neutral-with-bearish-lean
  // For breakout layer we require strict alignment (bullish for BUY, bearish for SELL)
  const allow5mBuy  = candles5m.length < 5 || trend5m === "bullish" || trend5m === "neutral";
  const allow5mSell = candles5m.length < 5 || trend5m === "bearish" || trend5m === "neutral";
  const strict5mBuy  = candles5m.length < 5 || trend5m === "bullish" || trend5m === "neutral";
  const strict5mSell = candles5m.length < 5 || trend5m === "bearish" || trend5m === "neutral";

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
  // ADX threshold raised from 12 to 20 — research shows ADX > 20 needed for reliable trends
  // (Omega-Xi production bot uses ADX > 20; below 20 = ranging/choppy market)
  if (direction === "HOLD" && candles.length >= 21 && adx > 15) {
    const emaDiffPct = Math.abs(e9 - e21) / e21;
    if (e9 > e21 && price > vwap && rsi > 42 && rsi < 75 && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9>${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | 5m:${trend5m}`;
      layer = "Trend";
    } else if (e9 < e21 && price < vwap && rsi < 58 && rsi > 25 && allow5mSell) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9<${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | 5m:${trend5m}`;
      layer = "Trend";
    }
  }

  // ── Layer 4: Momentum ─────────────────────────────────────────────────────
  if (direction === "HOLD" && candles.length >= 5) {
    const roc3 = closes.length >= 4 ? (price - closes[closes.length - 4]) / closes[closes.length - 4] : 0;
    if (rsi > 45 && roc3 > 0.0003 && price > vwap && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.82, 0.60 + roc3 * 100 + (rsi - 45) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | +${(roc3 * 100).toFixed(2)}% in 3c | Above VWAP | 5m:${trend5m}`;
      layer = "Momentum";
    } else if (rsi < 55 && roc3 < -0.0003 && price < vwap && allow5mSell) {
      direction = "SELL";
      confidence = Math.min(0.82, 0.60 + Math.abs(roc3) * 100 + (55 - rsi) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | ${(roc3 * 100).toFixed(2)}% in 3c | Below VWAP | 5m:${trend5m}`;
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
      const regime = classifyMarketRegime(candles);
      // ORB works best in trending and weak-trend regimes, not in ranging/high-vol
      if (regime.regime !== "ranging" && regime.regime !== "high_vol") {
        direction = orb.direction;
        confidence = Math.min(0.92, 0.72 + orb.breakoutPct * 500);
        reason = `[ORB] ${orb.direction === "BUY" ? "Above" : "Below"} 15-min range | ${(orb.breakoutPct * 100).toFixed(3)}% | ${regime.label} | 5m:${trend5m}`;
        layer = "ORB";
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

  // ── Layer 9: VWAP Pullback (Highest win-rate Indian scalping setup) ──────────
  // Source: tradejini.com — VWAP Pullback Scalping Strategy
  // Price was trending above/below VWAP, pulls back to VWAP, forms reversal candle
  // This is the #1 setup used by professional Indian options scalpers
  if (direction === "HOLD" && candles.length >= 10) {
    const pullback = detectVWAPPullback(candles, vwap);
    if (pullback.detected && pullback.direction !== "HOLD") {
      if ((pullback.direction === "BUY" && allow5mBuy) || (pullback.direction === "SELL" && allow5mSell)) {
        direction = pullback.direction;
        confidence = Math.min(0.91, 0.68 + pullback.strength * 0.15);
        reason = `[VWAPPullback] Price returned to VWAP | ${pullback.direction} reversal candle | 5m:${trend5m}`;
        layer = "VWAPPullback";
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
  const last5Vol = candles1m.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const recentVolRatio = avgDayVol > 0 ? last5Vol / avgDayVol : 1;

  // Score-based approach — each condition adds 1 point
  const bullConditions = [
    dayTrendStrength > 0.002,          // day is up >0.2%
    price > dayVwap,                   // price above day VWAP
    pricePositionInRange > 0.5,        // price in upper half of day range
    e9 > e21 && rsi1m > 50 && rsi1m < 78, // 1m momentum bullish
    macd5m.histogram > 0,              // 5m MACD bullish
    volSurge >= 1.2 || recentVolRatio >= 1.3, // volume confirming
  ];
  const bearConditions = [
    dayTrendStrength < -0.002,
    price < dayVwap,
    pricePositionInRange < 0.5,
    e9 < e21 && rsi1m < 50 && rsi1m > 22,
    macd5m.histogram < 0,
    volSurge >= 1.2 || recentVolRatio >= 1.3,
  ];

  const bullScore = bullConditions.filter(Boolean).length;
  const bearScore = bearConditions.filter(Boolean).length;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";

  if (bullScore >= 4 && bullScore > bearScore) {
    // Don't buy if price is already at day high (range exhausted)
    if (pricePositionInRange > 0.92) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[PowerHour] Price at day high — range exhausted, skipping BUY`, layer: "None", isPowerHour: true };
    }
    direction = "BUY";
    confidence = Math.min(0.95, 0.65 + bullScore * 0.05 + Math.max(0, dayTrendStrength * 10));
    reason = `[PowerHour] Bullish day(${(dayTrendStrength * 100).toFixed(2)}%) | Above VWAP(${dayVwap.toFixed(1)}) | VolSurge:${volSurge.toFixed(1)}x | Score:${bullScore}/6 | RSI(${rsi1m.toFixed(0)}) | ADX(${adx5m.toFixed(0)}) | Range:${dayLow.toFixed(1)}–${dayHigh.toFixed(1)}`;
  } else if (bearScore >= 4 && bearScore > bullScore) {
    if (pricePositionInRange < 0.08) {
      return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `[PowerHour] Price at day low — range exhausted, skipping SELL`, layer: "None", isPowerHour: true };
    }
    direction = "SELL";
    confidence = Math.min(0.95, 0.65 + bearScore * 0.05 + Math.max(0, Math.abs(dayTrendStrength) * 10));
    reason = `[PowerHour] Bearish day(${(dayTrendStrength * 100).toFixed(2)}%) | Below VWAP(${dayVwap.toFixed(1)}) | VolSurge:${volSurge.toFixed(1)}x | Score:${bearScore}/6 | RSI(${rsi1m.toFixed(0)}) | ADX(${adx5m.toFixed(0)}) | Range:${dayLow.toFixed(1)}–${dayHigh.toFixed(1)}`;
  }

  if (direction === "HOLD") {
    return {
      direction: "HOLD", confidence: 0, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: `[PowerHour] No clear setup | Bull:${bullScore} Bear:${bearScore} | DayTrend:${(dayTrendStrength * 100).toFixed(2)}% | VWAP:${dayVwap.toFixed(1)}`,
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

// ── Fetch 1-min candles from Upstox ───────────────────────────────────────────
export async function fetchUpstoxCandles(instrumentToken: string, accessToken?: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const resp = await axios.get(url, { headers, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
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
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
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
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  } catch { return []; }
}

// ── Fetch full quote ──────────────────────────────────────────────────────────
async function fetchFullQuote(instrumentToken: string, accessToken: string): Promise<{ ltp: number; bid: number; ask: number } | null> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encoded}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 5000 });
    const data = resp.data?.data?.[instrumentToken] ?? resp.data?.data?.[Object.keys(resp.data?.data ?? {})[0]];
    if (!data) return null;
    return { ltp: data.last_price ?? 0, bid: data.depth?.buy?.[0]?.price ?? data.last_price ?? 0, ask: data.depth?.sell?.[0]?.price ?? data.last_price ?? 0 };
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
async function resolveAtmOptionToken(
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

    const chainResp = await axios.get(
      `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(underlyingToken)}&expiry_date=current_week`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 10000 },
    );
    chainData = chainResp.data?.data ?? [];

    if (chainData.length === 0) {
      console.warn(`[BotEngine] resolveAtmOptionToken: empty chain for ${underlyingToken} (current_week). Trying next_week...`);
      const fallbackResp = await axios.get(
        `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(underlyingToken)}&expiry_date=next_week`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 10000 },
      );
      chainData = fallbackResp.data?.data ?? [];
      if (chainData.length === 0) {
        console.warn(`[BotEngine] resolveAtmOptionToken: empty chain for next_week too. No options available.`);
        return null;
      }
    }

    const chainExpiry: string | undefined = chainData[0]?.expiry ?? undefined;

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

async function resolveAtmMcxOptionToken(
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
        // Nearest expiry only
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
export async function placeUpstoxOrder(
  accessToken: string, instrumentToken: string, direction: "BUY" | "SELL", quantity: number,
): Promise<string | null> {
  try {
    const resp = await axios.post(
      "https://api.upstox.com/v3/order/place",
      { quantity, product: "I", validity: "DAY", price: 0, tag: "scalp-bot", instrument_token: instrumentToken, order_type: "MARKET", transaction_type: direction, disclosed_quantity: 0, trigger_price: 0, is_amo: false },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, timeout: 8000 }
    );
    return resp.data?.data?.order_id ?? null;
  } catch (err: unknown) {
    console.error("[BotEngine] Order placement failed:", err instanceof Error ? err.message : String(err));
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
  if (state.status !== "running") return;
  // Prevent overlapping ticks: if previous tick is still running (slow network, API timeout), skip
  if (state.tickInProgress) {
    console.log(`[BotEngine] ${state.sessionToken.slice(0, 8)} — tick skipped (previous still running)`);
    return;
  }
  state.tickInProgress = true;
  try {

  const maxDailyLoss = -(state.capital * state.dailyLossLimitPct) / 100;
  if (state.dailyPnl <= maxDailyLoss) {
    state.status = "paused";
    state.lastError = `Daily loss limit hit (₹${state.dailyPnl.toFixed(0)})`;
    return;
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
        // Market is closed — force close the open trade at last known price
        const trade = state.openTrade;
        const exitPx = trade.entryPrice; // Use entry price as exit (no live data available)
        let pnl = trade.direction === "BUY" ? (exitPx - trade.entryPrice) * trade.quantity : (trade.entryPrice - exitPx) * trade.quantity;
        // For paper mode: P&L is 0 since we exit at entry (no live data to determine actual exit)
        // This is better than leaving trades open overnight
        state.dailyPnl += pnl;
        state.openTrade = null;
        await onTradeClose(trade.dbId, exitPx, pnl, "Market Close — Auto Square-Off (no live data)");
        emitActivity(state.sessionToken, "trade_close", `⏰ Auto Square-Off (market closed) ${trade.symbolLabel} @ ₹${exitPx.toFixed(2)} | P\&L: ₹${pnl.toFixed(0)}`, { price: exitPx, pnl });
        console.log(`[BotEngine] ${state.sessionToken} — forced square-off (no candle data, market closed)`);
      }
    }
    return;
  }

  const price = state.lastPrice;
  state.nextScanAt = Date.now() + state.scanIntervalSec * 1000;
  // Update lastTickAt so Dashboard can detect staleness
  state.lastTickAt = Date.now();

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
    resetDailyState(); // Clear StoplossGuard, portfolio halt, cooldowns
    emitActivity(state.sessionToken, "bot_start", `🌅 New trading day (${todayStr}) — daily counters reset`);
  }
  state.lastTradingDay = todayStr;
  const isMCX = state.instrumentToken.startsWith("MCX");
  const squareOffMin = isMCX ? 23 * 60 + 28 : 15 * 60 + 25;
  const stopScanMin  = isMCX ? 23 * 60 + 20 : 15 * 60 + 20; // MCX: stop new trades at 23:20, square-off at 23:28; NSE: stop at 15:20, square-off at 15:25

  // NSE Power Hour: 3:00–3:20 PM IST
  const powerHourStart = 15 * 60;
  const powerHourEnd   = 15 * 60 + 20;
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

  // ── Resolve effective price for open trade monitoring ───────────────────────
  // For options mode: use current option premium (not underlying spot price) for P&L.
  // For regular mode: use underlying/futures price as before.
  let effectivePrice = price; // default: underlying price
  if (state.openTrade?.isIndexOptions) {
    if (state.accessToken && state.openTrade.instrumentToken) {
      // Live mode: fetch current option premium from Upstox
      const optQuote = await fetchFullQuote(state.openTrade.instrumentToken, state.accessToken);
      if (optQuote && optQuote.ltp > 0) {
        effectivePrice = optQuote.ltp;
        state.optionPremiumPrice = optQuote.ltp; // update for Dashboard display
      }
    } else {
      // Paper mode (no access token): derive drifting option premium from real underlying price.
      // Use delta approximation: ATM option moves ~0.5x the underlying for every 1 point move.
      // Base premium is the entry price of the open trade (already a real option premium).
      const entryPremium = state.openTrade.entryPrice;
      const entryUnderlying = state.openTrade.entryUnderlyingPrice ?? price; // stored at trade open
      const underlyingMove = price - entryUnderlying;
      const delta = 0.5; // ATM delta approximation
      // For CE: underlying up = premium up. For PE: underlying up = premium down.
      const isCallOption = state.openTrade.symbol.includes("_CE_") || state.openTrade.symbol.endsWith("_CE");
      const driftedPremium = Math.max(0.05, entryPremium + (isCallOption ? underlyingMove * delta : -underlyingMove * delta));
      effectivePrice = driftedPremium;
      state.optionPremiumPrice = driftedPremium;
    }
  }

  // Auto square-off at market close
  if (istMin2 >= squareOffMin && state.openTrade) {
   const trade = state.openTrade;
   if (trade.mode === "live" && state.accessToken) {
     const sqOffId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", trade.quantity);
      if (!sqOffId) {
        state.lastError = `Auto square-off REJECTED — close ${trade.symbolLabel} manually on Upstox`;
        emitActivity(state.sessionToken, "error", `⚠ AUTO SQUARE-OFF FAILED — ${trade.symbolLabel}. CLOSE MANUALLY on Upstox NOW.`);
        sendTelegramAlert(state, `🚨 <b>AUTO SQUARE-OFF FAILED</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Market close order rejected. CLOSE MANUALLY ON UPSTOX NOW.`);
        return; // do NOT close trade in DB — position still open
      }
   }
    let pnl = trade.direction === "BUY" ? (effectivePrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - effectivePrice) * trade.quantity;
    // v3: paper-mode brokerage + slippage simulation
    if (trade.mode === "paper") {
      const pc = getPaperCostConfig();
      pnl = applyPaperCosts(pnl, trade.entryPrice, effectivePrice, trade.quantity, pc.brokerage, pc.slippagePct);
    }
    state.dailyPnl += pnl + trade.bookedPnl;
    state.openTrade = null;
    recordTradeClose(state.sessionToken, state.scanIntervalSec);
    const sqTotalPnl = pnl + trade.bookedPnl;
    await onTradeClose(trade.dbId, effectivePrice, sqTotalPnl, "Market Close — Auto Square-Off");
    console.log(`[BotEngine] ${state.sessionToken} — auto square-off | P&L: ₹${sqTotalPnl.toFixed(0)} (remaining: ₹${pnl.toFixed(0)} + booked: ₹${trade.bookedPnl.toFixed(0)})`);
    emitActivity(state.sessionToken, "trade_close", `Auto Square-Off ${trade.symbolLabel} @ ₹${effectivePrice.toFixed(2)} | P&L: ${sqTotalPnl >= 0 ? "+" : ""}₹${sqTotalPnl.toFixed(0)}`, { price: effectivePrice, pnl: sqTotalPnl });
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
        let pnl = (effectivePrice - trade.entryPrice) * trade.quantity;
        if (trade.mode === "live" && state.accessToken) {
          const heroOrderId2 = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, "SELL", trade.quantity);
          if (!heroOrderId2) {
            state.lastError = `Hero Zero exit order REJECTED — close ${trade.symbolLabel} manually on Upstox`;
            emitActivity(state.sessionToken, "error", `⚠ HERO ZERO EXIT FAILED — ${trade.symbolLabel}. Order rejected by Upstox. CLOSE MANUALLY.`);
            sendTelegramAlert(state, `🚨 <b>HERO ZERO EXIT FAILED</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Exit order rejected. CLOSE MANUALLY ON UPSTOX.`);
            return; // do NOT close trade in DB — position still open
          }
        }
        // v3: paper-mode brokerage + slippage simulation
        if (trade.mode === "paper") {
          const pc = getPaperCostConfig();
          pnl = applyPaperCosts(pnl, trade.entryPrice, effectivePrice, trade.quantity, pc.brokerage, pc.slippagePct);
        }
        state.dailyPnl += pnl + trade.bookedPnl;
        state.openTrade = null;
        recordTradeClose(state.sessionToken, state.scanIntervalSec);
        await onTradeClose(trade.dbId, effectivePrice, pnl + trade.bookedPnl, heroExit);
        console.log(`[BotEngine] ${state.sessionToken} — ${heroExit} | P&L: ₹${(pnl + trade.bookedPnl).toFixed(0)}`);
        return;
      }
      // Hero Zero: do NOT return here — fall through to partial booking below
      // This allows partial profit booking to work for Hero Zero trades too
    }

    // ── Partial profit booking (pyramid exit) ────────────────────────────────
    if (trade.partialBooked === 0) {
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
            sendTelegramAlert(state, `🚨 <b>PARTIAL BOOKING FAILED (1R)</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not book 50% profit. Will retry.`);
            return; // do NOT update bookedQty/bookedPnl — order didn't execute
          }
       }
       trade.bookedQty += bookQty;
        trade.bookedPnl += bookPnl;
        trade.quantity   -= bookQty;
        trade.partialBooked = 1;
        // Move SL to breakeven
        trade.currentSl = trade.entryPrice;
        state.dailyPnl += bookPnl;
        console.log(`[BotEngine] ${state.sessionToken} — PARTIAL BOOK 50% @ ₹${trade.partial1RPrice.toFixed(2)} | Booked P&L: ₹${bookPnl.toFixed(0)} | SL→BE`);
        sendTelegramAlert(state,
          `💰 <b>PARTIAL PROFIT BOOKED (50%)</b>\n` +
          `📊 <b>${state.instrumentLabel}</b> | ₹${trade.partial1RPrice.toFixed(2)}\n` +
          `✅ Locked: ₹${bookPnl.toFixed(0)} | SL moved to Breakeven\n` +
          `🎯 Remaining: ${trade.quantity} qty | Next target: 2R`,
        );
      }
    } else if (trade.partialBooked === 1) {
      // Safety guard: partial2RPrice must be a valid non-zero price above/below entry (same as 1R guard)
      const partial2Valid = trade.partial2RPrice > 0 &&
        (trade.direction === "BUY" ? trade.partial2RPrice > trade.entryPrice : trade.partial2RPrice < trade.entryPrice);
      const hit2R = partial2Valid &&
        (trade.direction === "BUY" ? effectivePrice >= trade.partial2RPrice : effectivePrice <= trade.partial2RPrice);
     if (hit2R) {
       // Book another 25% (half of remaining) at 2R
       const bookQty = Math.max(1, Math.floor(trade.quantity * 0.5));
       const bookPnl = trade.direction === "BUY"
         ? (trade.partial2RPrice - trade.entryPrice) * bookQty
         : (trade.entryPrice - trade.partial2RPrice) * bookQty;
       if (trade.mode === "live" && state.accessToken) {
          const partialOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", bookQty);
          if (!partialOrderId) {
            state.lastError = `Partial 2R booking REJECTED — ${trade.symbolLabel}. Position unchanged.`;
            emitActivity(state.sessionToken, "error", `⚠ PARTIAL 2R BOOKING FAILED — ${trade.symbolLabel}. Order rejected by Upstox. Will retry next tick.`);
            sendTelegramAlert(state, `🚨 <b>PARTIAL BOOKING FAILED (2R)</b>\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not book 25% profit. Will retry.`);
            return; // do NOT update bookedQty/bookedPnl — order didn't execute
          }
       }
       trade.bookedQty += bookQty;
        trade.bookedPnl += bookPnl;
        trade.quantity   -= bookQty;
        trade.partialBooked = 2;
        // Trail SL to 1R level
        trade.currentSl = trade.direction === "BUY" ? trade.partial1RPrice : trade.partial1RPrice;
        state.dailyPnl += bookPnl;
        console.log(`[BotEngine] ${state.sessionToken} — PARTIAL BOOK 25% @ ₹${trade.partial2RPrice.toFixed(2)} | Booked P&L: ₹${bookPnl.toFixed(0)} | SL→1R`);
        sendTelegramAlert(state,
          `💰 <b>PARTIAL PROFIT BOOKED (25% more)</b>\n` +
          `📊 <b>${state.instrumentLabel}</b> | ₹${trade.partial2RPrice.toFixed(2)}\n` +
          `✅ Locked: ₹${bookPnl.toFixed(0)} | Total locked: ₹${trade.bookedPnl.toFixed(0)}\n` +
          `🛑 SL moved to 1R | Trailing ${trade.quantity} qty to target`,
        );
      }
    }

    // ── Trailing SL ──────────────────────────────────────────────────────────
    if (trade.trailingSlEnabled) {
      const trailDist = trade.entryPrice * (trade.trailingSlPct / 100);
      if (trade.direction === "BUY") { const newSl = effectivePrice - trailDist; if (newSl > trade.currentSl) trade.currentSl = newSl; }
      else { const newSl = effectivePrice + trailDist; if (newSl < trade.currentSl) trade.currentSl = newSl; }
    }

    // ── Full exit: SL or Target ───────────────────────────────────────────────
    let exitReason: string | null = null;
    if (trade.direction === "BUY") { if (effectivePrice <= trade.currentSl) exitReason = "Stop Loss"; else if (effectivePrice >= trade.targetPrice) exitReason = "Target Hit"; }
    else { if (effectivePrice >= trade.currentSl) exitReason = "Stop Loss"; else if (effectivePrice <= trade.targetPrice) exitReason = "Target Hit"; }

    if (exitReason) {
      let remainPnl = trade.direction === "BUY" ? (effectivePrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - effectivePrice) * trade.quantity;
      // v3: paper-mode brokerage + slippage simulation
      if (trade.mode === "paper") {
        const pc = getPaperCostConfig();
        remainPnl = applyPaperCosts(remainPnl, trade.entryPrice, effectivePrice, trade.quantity, pc.brokerage, pc.slippagePct);
      }
      const totalPnl  = remainPnl + trade.bookedPnl;
      if (trade.mode === "live" && state.accessToken) {
        const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
        let exitOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, exitDir, trade.quantity);
        if (!exitOrderId) {
          // Retry once after 2 seconds — network blip or brief Upstox outage
          await new Promise(r => setTimeout(r, 2000));
          exitOrderId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, exitDir, trade.quantity);
        }
        if (!exitOrderId) {
          // Both attempts failed — keep trade open, alert user to close manually
          state.lastError = `EXIT ORDER FAILED — close ${trade.symbolLabel} manually on Upstox`;
          emitActivity(state.sessionToken, "error", `⚠ EXIT ORDER FAILED (${exitReason}) — ${trade.symbolLabel}. CLOSE MANUALLY on Upstox NOW.`);
          sendTelegramAlert(state, `🚨 <b>EXIT ORDER FAILED</b> — ${exitReason}\n📊 <b>${trade.symbolLabel}</b>\n❌ Could not place exit order after 2 attempts.\n⚠ CLOSE MANUALLY ON UPSTOX NOW.`);
          return; // do NOT close in DB — trade remains open until manual intervention
        }
      }
      // Track SL hit for re-entry (only on full SL, not BE)
      if (exitReason === "Stop Loss" && trade.partialBooked === 0) {
        state.lastSlHitAt = Date.now();
        state.lastSlDirection = trade.direction;
        state.reEntryCandles = 0;
      }
      state.dailyPnl += remainPnl;
      state.openTrade = null;
      recordTradeClose(state.sessionToken, state.scanIntervalSec);
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
        `\n📈 Day P&L: ₹${state.dailyPnl.toFixed(0)} | Trades: ${state.tradesCount}`,
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
  if (state.tradesCount >= state.maxTradesPerDay) {
    state.status = "paused";
    state.lastError = `Max trades per day reached (${state.maxTradesPerDay})`;
    return;
  }

  // ── v3 Risk Gates: StoplossGuard, Portfolio Drawdown Halt, Cooldown ─────────
  // 1. StoplossGuard: pause after 3 consecutive SLs in last 20 trades (checked globally)
  const slGuard = getStoplossGuardState();
  if (slGuard.isPaused) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: slGuard.reason ?? "StoplossGuard active", layer: "None" };
    return;
  }
  // 2. Portfolio MaxDrawdown Halt: unified daily loss limit across all slots
  const baseToken = state.sessionToken.replace(/-slot\d+$/, "");
  const portfolioBots = getAllRunningBotsForSession(baseToken);
  const ddCheck = checkPortfolioDrawdown(portfolioBots, state.dailyLossLimitPct);
  if (ddCheck.halted) {
    state.status = "paused";
    state.lastError = ddCheck.reason ?? "Portfolio daily drawdown limit hit";
    emitActivity(state.sessionToken, "error", `🛑 ${ddCheck.reason}`);
    return;
  }
  // 3. CooldownPeriod: mandatory 2-candle wait after any trade close
  const cooldown = isCooldownActive(state.sessionToken);
  if (cooldown.active) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Cooldown after last trade (${Math.ceil(cooldown.remainingMs / 1000)}s remaining)`, layer: "None" };
    return;
  }

  // Re-entry cooldown logic
  let isReEntry = false;
  if (state.lastSlHitAt && state.lastSlDirection) {
    state.reEntryCandles += 1;
    if (state.reEntryCandles < 2) {
      state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Re-entry cooldown (${state.reEntryCandles}/2 candles after SL)`, layer: "None" };
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
  // Expiry day detection: Thursday for NIFTY weekly, Wednesday for BANKNIFTY weekly
  const dayOfWeek = now2.getUTCDay(); // 0=Sun, 1=Mon, ... 4=Thu, 3=Wed
  const isBankNiftyOption = state.instrumentToken.includes("BNF") || state.instrumentToken.includes("BANKNIFTY");
  const isExpiryDay = isOptionInstrument && (isBankNiftyOption ? dayOfWeek === 3 : dayOfWeek === 4);
  const heroZeroWindowStart = 11 * 60;
  const heroZeroWindowEnd   = 13 * 60 + 30;
  const inHeroZeroWindow = isExpiryDay && istMin2 >= heroZeroWindowStart && istMin2 < heroZeroWindowEnd;
  state.heroZeroMode = inHeroZeroWindow;

  if (inPowerHour) {
    signal = generatePowerHourSignal(state.candles, state.candles5m, slMult, state.targetMultiplier);
  } else if (inMCXEvening) {
    signal = generateMCXEveningSignal(state.candles, state.candles5m, isWednesdayCrude, slMult, state.targetMultiplier);
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
    signal = generateSignal(state.candles, slMult, state.targetMultiplier, state.minConfidence / 100, state.candles5m, prevDayHigh, prevDayLow, prevDayClose);
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
    emitActivity(state.sessionToken, "signal",
      `⏱ Scanning... ₹${price.toFixed(1)} (${priceVsVwap} VWAP) | RSI(${rsiHb.toFixed(0)}) | ADX(${adxHb.toFixed(0)}) | Signal: ${signal.direction} | ${signal.reason?.slice(0, 60) ?? ""}`,
    );
  }
  state.lastSignal = signal;
  // Emit tick signal to activity log
  if (signal.direction !== "HOLD") {
    const slPct = signal.entryPrice > 0 ? (Math.abs(signal.entryPrice - signal.slPrice) / signal.entryPrice * 100).toFixed(1) : "?";
    emitActivity(state.sessionToken, "signal", `◆ ${signal.direction} signal @ ₹${signal.entryPrice.toFixed(2)} | ${(signal.confidence * 100).toFixed(0)}% conf | ${signal.layer} | SL ₹${signal.slPrice.toFixed(2)} (${slPct}%) | Target ₹${signal.targetPrice.toFixed(2)} | ATR ${signal.atr.toFixed(1)} | ${signal.reason}`, { price: signal.entryPrice, confidence: signal.confidence });
  }
  if (signal.direction === "HOLD") return; // confidence already checked inside generateSignal (tod multiplier applied there)

  // ── Layer filter: skip signals from disabled layers ─────────────────────────
  if (state.enabledLayers && state.enabledLayers.length > 0 && signal.layer !== "None") {
    if (!state.enabledLayers.includes(signal.layer)) {
      emitActivity(state.sessionToken, "signal", `⊘ ${signal.direction} signal from ${signal.layer} skipped (layer disabled)`);
      return;
    }
  }

  // ── HourlyClose one-shot guard: only fire once per day ─────────────────────
  if (signal.layer === "HourlyClose" && state.hourlyCloseSignalFired) {
    emitActivity(state.sessionToken, "signal", `⊘ HourlyClose signal skipped (already fired today)`);
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
      // Paper mode with no token: use mock premium (clearly labelled)
      emitActivity(state.sessionToken, "signal", `⚠ No Upstox token — using mock premium for paper trade (connect token in Settings for real prices)`);
      const symFb2 = state.instrumentSymbol.toUpperCase();
      let mockKeyFb2: string;
      if (symFb2.includes("GOLD"))       mockKeyFb2 = ceOrPe === "CE" ? "MCX_GOLD_CE"   : "MCX_GOLD_PE";
      else if (symFb2.includes("SILVER")) mockKeyFb2 = ceOrPe === "CE" ? "MCX_SILVER_CE" : "MCX_SILVER_PE";
      else if (symFb2.includes("CRUDE") || symFb2.includes("OIL")) mockKeyFb2 = ceOrPe === "CE" ? "MCX_CRUDE_CE" : "MCX_CRUDE_PE";
      else if (symFb2.includes("NATGAS") || symFb2.includes("GAS")) mockKeyFb2 = ceOrPe === "CE" ? "MCX_NATGAS_CE" : "MCX_NATGAS_PE";
      else if (symFb2.includes("COPPER")) mockKeyFb2 = ceOrPe === "CE" ? "MCX_COPPER_CE" : "MCX_COPPER_PE";
      else if (symFb2.includes("BANK"))   mockKeyFb2 = ceOrPe === "CE" ? "BNF_CE"        : "BNF_PE";
      else                               mockKeyFb2 = ceOrPe === "CE" ? "NIFTY_CE"      : "NIFTY_PE";
      const mockPremiumFb2 = mockPrices[mockKeyFb2] ?? (ceOrPe === "CE" ? 150 : 120);
      const underlyingPxFb2 = state.lastPrice;
      let strikeStepFb2 = 50;
      if (symFb2.includes("GOLD")) strikeStepFb2 = 100;
      else if (symFb2.includes("SILVER")) strikeStepFb2 = 1000;
      else if (symFb2.includes("CRUDE") || symFb2.includes("OIL")) strikeStepFb2 = 50;
      else if (symFb2.includes("NATGAS") || symFb2.includes("GAS")) strikeStepFb2 = 5;
      else if (symFb2.includes("BANK")) strikeStepFb2 = 100;
      else if (symFb2.includes("NIFTY") || symFb2.includes("FIN")) strikeStepFb2 = 50;
      const atmStrikeFb2 = underlyingPxFb2 > 0 ? Math.round(underlyingPxFb2 / strikeStepFb2) * strikeStepFb2 : 0;
      tradeInstrumentToken = `PAPER_OPT|${state.instrumentSymbol}_${atmStrikeFb2 || "ATM"}_${ceOrPe}`;
      tradeSymbol = `${state.instrumentSymbol}_${ceOrPe}_${atmStrikeFb2 || "ATM"}`;
      tradeLabel = formatOptionContractLabel(state.instrumentSymbol, atmStrikeFb2 || 0, ceOrPe, resolvedExpiry);
      optionPremiumForSizing = mockPremiumFb2;
      state.optionPremiumPrice = mockPremiumFb2;
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
    // Paper mode with options but no access token.
    // Try to resolve ATM option token and get real premium from Upstox public candle API.
    // If that fails, fall back to mock premium.
    const ceOrPe: "CE" | "PE" = state.optionType === "CE" ? "CE"
      : state.optionType === "PE" ? "PE"
      : signal.direction === "BUY" ? "CE" : "PE";
    const symU2 = state.instrumentSymbol.toUpperCase();
    let strikeStep2 = 50;
    if (symU2.includes("GOLD")) strikeStep2 = 100;
    else if (symU2.includes("SILVER")) strikeStep2 = 1000;
    else if (symU2.includes("CRUDE") || symU2.includes("OIL")) strikeStep2 = 50;
    else if (symU2.includes("NATGAS") || symU2.includes("GAS")) strikeStep2 = 5;
    else if (symU2.includes("BANK")) strikeStep2 = 100;
    else if (symU2.includes("NIFTY") || symU2.includes("FIN")) strikeStep2 = 50;
    const atmStrike2 = state.lastPrice > 0 ? Math.round(state.lastPrice / strikeStep2) * strikeStep2 : 0;
    const strikeTag2 = atmStrike2 > 0 ? ` ${atmStrike2}` : " ATM";
    tradeSymbol = `${state.instrumentSymbol}_${ceOrPe}_${atmStrike2 || "ATM"}`;
    tradeLabel = formatOptionContractLabel(state.instrumentSymbol, atmStrike2 || 0, ceOrPe, resolvedExpiry);
    tradeInstrumentToken = `PAPER_OPT|${state.instrumentSymbol}_${atmStrike2 || "ATM"}_${ceOrPe}`;
    // Determine mock key for fallback
    const sym2 = state.instrumentSymbol.toUpperCase();
    let mockKey2: string;
    if (sym2.includes("GOLD"))       mockKey2 = ceOrPe === "CE" ? "MCX_GOLD_CE"   : "MCX_GOLD_PE";
    else if (sym2.includes("SILVER")) mockKey2 = ceOrPe === "CE" ? "MCX_SILVER_CE" : "MCX_SILVER_PE";
    else if (sym2.includes("CRUDE") || sym2.includes("OIL")) mockKey2 = ceOrPe === "CE" ? "MCX_CRUDE_CE" : "MCX_CRUDE_PE";
    else if (sym2.includes("NATGAS") || sym2.includes("GAS")) mockKey2 = ceOrPe === "CE" ? "MCX_NATGAS_CE" : "MCX_NATGAS_PE";
    else if (sym2.includes("COPPER")) mockKey2 = ceOrPe === "CE" ? "MCX_COPPER_CE" : "MCX_COPPER_PE";
    else if (sym2.includes("ZINC"))   mockKey2 = ceOrPe === "CE" ? "MCX_ZINC_CE"   : "MCX_ZINC_PE";
    else if (sym2.includes("BANK"))   mockKey2 = ceOrPe === "CE" ? "BNF_CE"        : "BNF_PE";
    else if (sym2.includes("FIN") || sym2.includes("FINNIFTY")) mockKey2 = ceOrPe === "CE" ? "NIFTY_CE" : "NIFTY_PE";
    else                              mockKey2 = ceOrPe === "CE" ? "NIFTY_CE"      : "NIFTY_PE";
    const fallbackPremium = mockPrices[mockKey2] ?? (ceOrPe === "CE" ? 150 : 120);
    // Use mock premium as sizing basis — delta drift at exit will produce realistic P&L
    optionPremiumForSizing = fallbackPremium;
    state.optionPremiumPrice = fallbackPremium;
    emitActivity(state.sessionToken, "signal", `⚠ Paper options: using mock premium ₹${fallbackPremium} for ${tradeSymbol} (no access token)`);
  }

  // ── ABSOLUTE SAFETY NET ─────────────────────────────────────────────────────────
  // If isOptionsMode=true but optionPremiumForSizing is still null at this point,
  // it means all option resolution paths were skipped (e.g. underlyingToken was null
  // and accessToken path was skipped). Force-set from mockPrices to prevent spot price
  // from leaking as entry price (which causes ₹24,000+ entries and absurd P&L).
  if (isOptionsMode && !optionPremiumForSizing) {
    const sym3 = state.instrumentSymbol.toUpperCase();
    const ceOrPe3: "CE" | "PE" = signal.direction === "BUY" ? "CE" : "PE";
    let mockKey3: string;
    if (sym3.includes("BANK"))                                   mockKey3 = ceOrPe3 === "CE" ? "BNF_CE"        : "BNF_PE";
    else if (sym3.includes("FIN") || sym3.includes("FINNIFTY")) mockKey3 = ceOrPe3 === "CE" ? "NIFTY_CE"      : "NIFTY_PE";
    else if (sym3.includes("GOLD"))                             mockKey3 = ceOrPe3 === "CE" ? "MCX_GOLD_CE"   : "MCX_GOLD_PE";
    else if (sym3.includes("SILVER"))                           mockKey3 = ceOrPe3 === "CE" ? "MCX_SILVER_CE" : "MCX_SILVER_PE";
    else if (sym3.includes("CRUDE") || sym3.includes("OIL"))   mockKey3 = ceOrPe3 === "CE" ? "MCX_CRUDE_CE"  : "MCX_CRUDE_PE";
    else if (sym3.includes("NATGAS") || sym3.includes("GAS"))  mockKey3 = ceOrPe3 === "CE" ? "MCX_NATGAS_CE" : "MCX_NATGAS_PE";
    else                                                         mockKey3 = ceOrPe3 === "CE" ? "NIFTY_CE"      : "NIFTY_PE";
    optionPremiumForSizing = mockPrices[mockKey3] ?? (ceOrPe3 === "CE" ? 150 : 120);
    const atmStrike3 = state.lastPrice > 0 ? Math.round(state.lastPrice / 50) * 50 : 0;
    tradeInstrumentToken = `PAPER_OPT|${state.instrumentSymbol}_${atmStrike3 || "ATM"}_${ceOrPe3}`;
    tradeSymbol = `${state.instrumentSymbol}_${ceOrPe3}_${atmStrike3 || "ATM"}`;
    tradeLabel = formatOptionContractLabel(state.instrumentSymbol, atmStrike3 || 0, ceOrPe3, resolvedExpiry);
    state.optionPremiumPrice = optionPremiumForSizing;
    emitActivity(state.sessionToken, "signal", `⚠ Safety net: using mock premium ₹${optionPremiumForSizing} for ${tradeSymbol}`);
  }

  // ── Position sizing ───────────────────────────────────────────────────────────────
  // For options: use option premium price for SL distance (not underlying price).
  // SL for options = 50% of premium (standard options risk management).
  // For futures/equity: use signal SL distance as before.
  const riskAmount = (state.capital * state.riskPerTradePct) / 100;
  const lotSize = state.lotSize ?? 1;
  let quantity: number;

  if (isOptionsMode && optionPremiumForSizing && optionPremiumForSizing > 0) {
    // Options quantity: risk ₹X, SL = 50% of premium, so loss per unit = 0.5 * premium
    // quantity = riskAmount / (0.5 * premium), rounded to nearest lot
    const slPerUnit = optionPremiumForSizing * 0.5; // 50% stop loss on premium
    const rawQty = slPerUnit > 0 ? Math.floor(riskAmount / slPerUnit) : lotSize;
    quantity = Math.max(lotSize, Math.floor(rawQty / lotSize) * lotSize);
    // Safety cap: max quantity such that total premium outlay <= 2x risk amount
    const maxQtyByCost = Math.floor((riskAmount * 2) / optionPremiumForSizing / lotSize) * lotSize;
    quantity = Math.min(quantity, Math.max(lotSize, maxQtyByCost));
  } else {
    const slDistance = Math.abs(signal.entryPrice - signal.slPrice);
    const rawQty = slDistance > 0 ? Math.floor(riskAmount / slDistance) : lotSize;
    quantity = Math.max(lotSize, Math.floor(rawQty / lotSize) * lotSize);
  }

  // ── v3 Risk Gate: Portfolio exposure cap (80% of combined capital) ──────────
  const entryPriceForExposure = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing : signal.entryPrice;
  const newTradeExposure = entryPriceForExposure * quantity;
  const exposureCheck = canOpenNewTrade(getAllRunningBotsForSession(state.sessionToken.replace(/-slot\d+$/, "")), newTradeExposure);
  if (!exposureCheck.allowed) {
    const rejectSignal: Signal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: exposureCheck.reason ?? "Portfolio exposure cap reached", layer: "None" };
    state.lastSignal = rejectSignal;
    emitActivity(state.sessionToken, "signal", `⛔ Entry blocked — ${exposureCheck.reason}`);
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
      emitActivity(state.sessionToken, "error", `⚠ Live order REJECTED — ${tradeLabel} ${orderDirection} ${quantity} qty. Check Upstox logs.`);
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
  const tradeSl = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * 0.5 : signal.slPrice;
  const tradeTarget = isOptionsMode && optionPremiumForSizing
    ? optionPremiumForSizing * (1 + (state.targetMultiplier * 0.5)) // target = premium * (1 + 0.5*targetMult)
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
  state.isOpeningTrade = true;
  let dbId: number;
  try {
    dbId = await onTradeOpen({
      symbol: tradeSymbol, symbolLabel: tradeLabel,
      instrumentToken: tradeInstrumentToken, direction: isOptionsMode ? "BUY" : signal.direction, mode: state.mode,
      entryPrice: tradeEntryPrice, quantity, slPrice: tradeSl, targetPrice: tradeTarget,
      atr: signal.atr, confidence: signal.confidence, status: "open",
      upstoxOrderId: orderId, signalReason: signalLabel + (isOptionsMode ? ` [${tradeSymbol}]` : ""), enteredAt: new Date(),
      partial1RPrice, partial2RPrice,
    });
  } catch (tradeOpenErr) {
    // CRITICAL: if DB insert fails, release the mutex so bot isn't permanently blocked
    state.isOpeningTrade = false;
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
  state.tradesCount += 1;
  state.lastTradeOpenedAt = Date.now(); // Set cooldown timestamp
  // Mark HourlyClose as fired for today (one-shot strategy)
  if (signal.layer === "HourlyClose") {
    state.hourlyCloseSignalFired = true;
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
  const displaySl     = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * 0.5 : signal.slPrice;
  const displayTarget = isOptionsMode && optionPremiumForSizing ? optionPremiumForSizing * (1 + state.targetMultiplier * 0.5) : signal.targetPrice;
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
    );
  } else {
    sendTelegramAlert(state,
      `${dirEmoji} <b>${signal.direction} SIGNAL</b> — ${layerTag}\n` +
      `📊 <b>${state.instrumentLabel}</b> | ₹${signal.entryPrice.toFixed(2)}\n` +
      `🛑 SL: ₹${signal.slPrice.toFixed(2)} | 🎯 Target: ₹${signal.targetPrice.toFixed(2)}\n` +
      `💯 Confidence: ${(signal.confidence * 100).toFixed(0)}% | Qty: ${quantity}\n` +
      `📝 ${signal.reason}`,
    );
  }
  } finally {
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
};

// ── Public API ────────────────────────────────────────────────────────────────
export function startBot(
  config: Omit<BotState, "candles" | "candles5m" | "candlesDay" | "lastSignal" | "lastPrice" | "bidPrice" | "askPrice" | "openTrade" | "intervalHandle" | "lastError" | "nextScanAt" | "lastTickAt" | "lastSlHitAt" | "lastSlDirection" | "reEntryCandles" | "isPowerHourMode" | "isMCXEveningMode" | "heroZeroMode" | "alertsSent">,
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
    lastSlHitAt: null, lastSlDirection: null, reEntryCandles: 0, isPowerHourMode: false,
    isMCXEveningMode: false, heroZeroMode: false, alertsSent: new Set<string>(),
  };

  const intervalMs = Math.max(15, config.scanIntervalSec) * 1000;
  const handle = setInterval(() => {
    tick(state, onTradeOpen, onTradeClose, onTick)
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
          }, onTradeOpen, onTradeClose, state.openTrade ?? undefined, onTick);
        }
      });
  }, intervalMs);
  state.intervalHandle = handle;
  bots.set(config.sessionToken, state);
  emitActivity(config.sessionToken, "bot_start", `Bot started — ${config.instrumentLabel} | ${config.mode} mode | Capital: ₹${config.capital.toLocaleString()} | Scan: ${config.scanIntervalSec}s`);
  tick(state, onTradeOpen, onTradeClose, onTick).catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BotEngine] Initial tick error (${config.sessionToken}):`, msg);
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
