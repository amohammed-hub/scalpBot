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
  layer: "Breakout" | "Pattern" | "Trend" | "Momentum" | "MACD_BB" | "PowerHour" | "None";
  isPowerHour?: boolean;
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
  nextScanAt: number;
  lastSlHitAt: number | null;
  lastSlDirection: "BUY" | "SELL" | null;
  reEntryCandles: number;
  isPowerHourMode: boolean;
}

// ── In-memory store ───────────────────────────────────────────────────────────
const bots = new Map<string, BotState>();

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

function getTimeOfDayMultiplier(istMin: number): { multiplier: number; label: string; skip: boolean } {
  if (istMin >= 555 && istMin < 570)  return { multiplier: 0,    label: "Opening Volatility",    skip: true  };
  if (istMin >= 570 && istMin < 600)  return { multiplier: 0.75, label: "Settling",               skip: false };
  if (istMin >= 600 && istMin < 690)  return { multiplier: 1.15, label: "Prime Morning",          skip: false };
  if (istMin >= 690 && istMin < 780)  return { multiplier: 0.85, label: "Midday Lull",            skip: false };
  if (istMin >= 780 && istMin < 840)  return { multiplier: 0.95, label: "Afternoon",              skip: false };
  if (istMin >= 840 && istMin < 900)  return { multiplier: 1.10, label: "Institutional Window",   skip: false };
  if (istMin >= 900 && istMin < 930)  return { multiplier: 1.20, label: "Power Hour",             skip: false };
  return { multiplier: 1.0, label: "Normal", skip: false };
}

// ── Main signal generator (5-layer) ──────────────────────────────────────────
export function generateSignal(
  candles: Candle[],
  slMultiplier = 1.5,
  tpMultiplier = 3.0,
  minConf = 0.6,
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
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

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
  const nearSR = srLevels.length > 0 && isNearSupportResistance(price, srLevels, 0.001);

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
  const strict5mBuy  = candles5m.length < 5 || trend5m === "bullish";
  const strict5mSell = candles5m.length < 5 || trend5m === "bearish";

  if (breakoutUpPct > dynamicBreakoutThreshold && volRatio >= 1.3 && rsi > 45 && rsi < 80 && strict5mBuy) {
    direction = "BUY";
    confidence = Math.min(0.95, 0.65 + breakoutUpPct * 200 + (volRatio - 1.3) * 0.1);
    reason = `[Breakout] Above ${highestHigh.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)}) | 5m:${trend5m} | thr:${(dynamicBreakoutThreshold * 100).toFixed(3)}%`;
    layer = "Breakout";
  } else if (breakoutDnPct > dynamicBreakoutThreshold && volRatio >= 1.3 && rsi < 55 && rsi > 20 && strict5mSell) {
    direction = "SELL";
    confidence = Math.min(0.95, 0.65 + breakoutDnPct * 200 + (volRatio - 1.3) * 0.1);
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

    if (c1.close < c1.open && c2.close > c2.open && c2.close > c1.open && c2.open < c1.close && volRatio >= 1.2 && price > vwap && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.68 + (body2 / (body1 || 1) - 1) * 0.1);
      reason = `[Pattern] Bullish Engulfing | Vol ${volRatio.toFixed(1)}x | Above VWAP | 5m:${trend5m}`;
      layer = "Pattern";
    } else if (c1.close > c1.open && c2.close < c2.open && c2.close < c1.open && c2.open > c1.close && volRatio >= 1.2 && price < vwap && allow5mSell) {
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
  if (direction === "HOLD" && candles.length >= 21 && adx > 18) {
    const emaDiffPct = Math.abs(e9 - e21) / e21;
    if (e9 > e21 && price > vwap && rsi > 50 && rsi < 72 && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9>${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | 5m:${trend5m}`;
      layer = "Trend";
    } else if (e9 < e21 && price < vwap && rsi < 50 && rsi > 28 && allow5mSell) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9<${e21.toFixed(1)} | VWAP | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)}) | 5m:${trend5m}`;
      layer = "Trend";
    }
  }

  // ── Layer 4: Momentum ─────────────────────────────────────────────────────
  if (direction === "HOLD" && candles.length >= 5) {
    const roc3 = closes.length >= 4 ? (price - closes[closes.length - 4]) / closes[closes.length - 4] : 0;
    if (rsi > 62 && roc3 > 0.0008 && price > vwap && allow5mBuy) {
      direction = "BUY";
      confidence = Math.min(0.82, 0.60 + roc3 * 100 + (rsi - 62) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | +${(roc3 * 100).toFixed(2)}% in 3c | Above VWAP | 5m:${trend5m}`;
      layer = "Momentum";
    } else if (rsi < 38 && roc3 < -0.0008 && price < vwap && allow5mSell) {
      direction = "SELL";
      confidence = Math.min(0.82, 0.60 + Math.abs(roc3) * 100 + (38 - rsi) * 0.005);
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

  // S/R proximity filter — reject entries near major levels
  if (direction !== "HOLD" && nearSR) {
    return {
      direction: "HOLD", confidence: 0, entryPrice: price,
      slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr,
      reason: `Near S/R level — entry rejected (within 0.1% of pivot/support/resistance)`,
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

  return { direction, confidence: adjustedConfidence, entryPrice: price, slPrice, targetPrice, atr, reason: `${reason} | ${tod.label}`, layer };
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

// ── Fetch 1-min candles from Upstox ──────────────────────────────────────────
async function fetchUpstoxCandles(instrumentToken: string, accessToken: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  } catch { return []; }
}

// ── Fetch daily candles from Upstox (last 7 days) ───────────────────────────
async function fetchUpstoxDayCandles(instrumentToken: string, accessToken: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const toDate = new Date().toISOString().split("T")[0];
    const fromDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0];
    const url = `https://api.upstox.com/v2/historical-candle/${encoded}/day/${toDate}/${fromDate}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  } catch { return []; }
}

// ── Fetch 5-min candles from Upstox ──────────────────────────────────────────
async function fetchUpstox5mCandles(instrumentToken: string, accessToken: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/5minute`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, timeout: 8000 });
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
async function tick(
  state: BotState,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
) {
  if (state.status !== "running") return;

  const maxDailyLoss = -(state.capital * state.dailyLossLimitPct) / 100;
  if (state.dailyPnl <= maxDailyLoss) {
    state.status = "paused";
    state.lastError = `Daily loss limit hit (₹${state.dailyPnl.toFixed(0)})`;
    return;
  }

  // Fetch candles + quote
  let newCandle: Candle;
  if (state.accessToken) {
    const [candles1m, candles5m, dayCandles, quote] = await Promise.all([
      fetchUpstoxCandles(state.instrumentToken, state.accessToken),
      fetchUpstox5mCandles(state.instrumentToken, state.accessToken),
      // Only re-fetch daily candles once per session (they don't change intraday)
      state.candlesDay.length < 2 ? fetchUpstoxDayCandles(state.instrumentToken, state.accessToken) : Promise.resolve(state.candlesDay),
      fetchFullQuote(state.instrumentToken, state.accessToken),
    ]);
    if (candles1m.length > 0) {
      state.candles = candles1m.slice(-400); // full day
      newCandle = candles1m[candles1m.length - 1];
    } else {
      newCandle = buildMockCandle(state.instrumentSymbol);
      state.candles.push(newCandle);
      if (state.candles.length > 400) state.candles.shift();
    }
    state.candles5m = candles5m.length > 0 ? candles5m.slice(-80) : build5mFromMock(state.candles);
    if (dayCandles.length > 0) state.candlesDay = dayCandles.slice(-10);
    if (quote) { state.lastPrice = quote.ltp; state.bidPrice = quote.bid; state.askPrice = quote.ask; }
    else { state.lastPrice = newCandle.close; }
  } else {
    newCandle = buildMockCandle(state.instrumentSymbol);
    state.candles.push(newCandle);
    if (state.candles.length > 400) state.candles.shift();
    state.candles5m = build5mFromMock(state.candles);
    state.lastPrice = newCandle.close;
    state.bidPrice = newCandle.close * 0.9999;
    state.askPrice = newCandle.close * 1.0001;
  }

  const price = state.lastPrice;
  state.nextScanAt = Date.now() + state.scanIntervalSec * 1000;

  // Time calculations
  const now2 = new Date();
  const istMin2 = ((now2.getUTCHours() * 60 + now2.getUTCMinutes()) + 330) % (24 * 60);
  const isMCX = state.instrumentToken.startsWith("MCX");
  const squareOffMin = isMCX ? 23 * 60 + 25 : 15 * 60 + 25;
  const stopScanMin  = isMCX ? 23 * 60 + 20 : 15 * 60 + 20;
  const powerHourStart = 15 * 60;
  const powerHourEnd   = 15 * 60 + 20;
  const inPowerHour = !isMCX && istMin2 >= powerHourStart && istMin2 < powerHourEnd;
  state.isPowerHourMode = inPowerHour;

  // Auto square-off at market close
  if (istMin2 >= squareOffMin && state.openTrade) {
    const trade = state.openTrade;
    if (trade.mode === "live" && state.accessToken) {
      const sqOffId = await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", trade.quantity);
      if (!sqOffId) { state.lastError = `Auto square-off rejected — close ${trade.symbolLabel} manually`; return; }
    }
    const pnl = trade.direction === "BUY" ? (price - trade.entryPrice) * trade.quantity : (trade.entryPrice - price) * trade.quantity;
    state.dailyPnl += pnl;
    state.openTrade = null;
    await onTradeClose(trade.dbId, price, pnl, "Market Close — Auto Square-Off");
    console.log(`[BotEngine] ${state.sessionToken} — auto square-off | P&L: ₹${pnl.toFixed(0)}`);
    return;
  }

  const nearClose = istMin2 >= stopScanMin;
  if (nearClose) {
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: "Market closing soon — no new trades", layer: "None" };
  }

  // Monitor open trade SL/Target
  if (state.openTrade) {
    const trade = state.openTrade;
    if (trade.trailingSlEnabled) {
      const trailDist = trade.entryPrice * (trade.trailingSlPct / 100);
      if (trade.direction === "BUY") { const newSl = price - trailDist; if (newSl > trade.currentSl) trade.currentSl = newSl; }
      else { const newSl = price + trailDist; if (newSl < trade.currentSl) trade.currentSl = newSl; }
    }
    let exitReason: string | null = null;
    if (trade.direction === "BUY") { if (price <= trade.currentSl) exitReason = "Stop Loss"; else if (price >= trade.targetPrice) exitReason = "Target Hit"; }
    else { if (price >= trade.currentSl) exitReason = "Stop Loss"; else if (price <= trade.targetPrice) exitReason = "Target Hit"; }

    if (exitReason) {
      const pnl = trade.direction === "BUY" ? (price - trade.entryPrice) * trade.quantity : (trade.entryPrice - price) * trade.quantity;
      if (trade.mode === "live" && state.accessToken) {
        await placeUpstoxOrder(state.accessToken, trade.instrumentToken, trade.direction === "BUY" ? "SELL" : "BUY", trade.quantity);
      }
      // Track SL hit for re-entry
      if (exitReason === "Stop Loss") {
        state.lastSlHitAt = Date.now();
        state.lastSlDirection = trade.direction;
        state.reEntryCandles = 0;
      }
      state.dailyPnl += pnl;
      state.openTrade = null;
      await onTradeClose(trade.dbId, price, pnl, exitReason);
      console.log(`[BotEngine] ${state.sessionToken} — ${exitReason} | P&L: ₹${pnl.toFixed(0)}`);
    }
    return;
  }

  if (nearClose) return;
  if (state.tradesCount >= state.maxTradesPerDay) {
    state.status = "paused";
    state.lastError = `Max trades per day reached (${state.maxTradesPerDay})`;
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

  if (inPowerHour) {
    signal = generatePowerHourSignal(state.candles, state.candles5m, slMult, state.targetMultiplier);
  } else {
    signal = generateSignal(state.candles, slMult, state.targetMultiplier, state.minConfidence / 100, state.candles5m, prevDayHigh, prevDayLow, prevDayClose);
  }

  state.lastSignal = signal;
  if (signal.direction === "HOLD" || signal.confidence < state.minConfidence / 100) return;

  // Position sizing
  const riskAmount = (state.capital * state.riskPerTradePct) / 100;
  const slDistance = Math.abs(signal.entryPrice - signal.slPrice);
  const quantity = slDistance > 0 ? Math.max(1, Math.floor(riskAmount / slDistance)) : 1;

  let orderId: string | undefined;
  if (state.mode === "live" && state.accessToken) {
    const oid = await placeUpstoxOrder(state.accessToken, state.instrumentToken, signal.direction, quantity);
    orderId = oid ?? undefined;
  }

  const signalLabel = signal.isPowerHour
    ? signal.reason
    : isReEntry ? `[Re-entry] ${signal.reason}` : signal.reason;

  const dbId = await onTradeOpen({
    symbol: state.instrumentSymbol, symbolLabel: state.instrumentLabel,
    instrumentToken: state.instrumentToken, direction: signal.direction, mode: state.mode,
    entryPrice: signal.entryPrice, quantity, slPrice: signal.slPrice, targetPrice: signal.targetPrice,
    atr: signal.atr, confidence: signal.confidence, status: "open",
    upstoxOrderId: orderId, signalReason: signalLabel, enteredAt: new Date(),
  });

  state.openTrade = {
    dbId, symbol: state.instrumentSymbol, symbolLabel: state.instrumentLabel,
    instrumentToken: state.instrumentToken, direction: signal.direction, mode: state.mode,
    entryPrice: signal.entryPrice, quantity, slPrice: signal.slPrice, targetPrice: signal.targetPrice,
    atr: signal.atr, confidence: signal.confidence, upstoxOrderId: orderId,
    enteredAt: new Date(), trailingSlEnabled: state.trailingSlEnabled,
    trailingSlPct: state.trailingSlPct, currentSl: signal.slPrice, isReEntry,
  };

  state.tradesCount += 1;
  const tradeType = signal.isPowerHour ? "⚡ POWER HOUR" : isReEntry ? "↩ RE-ENTRY" : "TRADE";
  console.log(`[BotEngine] ${state.sessionToken} — ${tradeType}: ${signal.direction} ${state.instrumentSymbol} @ ₹${signal.entryPrice.toFixed(2)} | Conf: ${(signal.confidence * 100).toFixed(0)}% | Layer: ${signal.layer}`);
}

type TradeInsert = {
  symbol: string; symbolLabel: string; instrumentToken: string;
  direction: "BUY" | "SELL"; mode: "paper" | "live";
  entryPrice: number; quantity: number; slPrice: number; targetPrice: number;
  atr: number; confidence: number; status: "open" | "closed" | "cancelled";
  upstoxOrderId?: string; signalReason: string; enteredAt: Date;
};

// ── Public API ────────────────────────────────────────────────────────────────
export function startBot(
  config: Omit<BotState, "candles" | "candles5m" | "candlesDay" | "lastSignal" | "lastPrice" | "bidPrice" | "askPrice" | "openTrade" | "intervalHandle" | "lastError" | "nextScanAt" | "lastSlHitAt" | "lastSlDirection" | "reEntryCandles" | "isPowerHourMode">,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
  existingOpenTrade?: OpenTrade | null,
) {
  const existing = bots.get(config.sessionToken);
  if (existing?.intervalHandle) clearInterval(existing.intervalHandle);

  const state: BotState = {
    ...config, candles: [], candles5m: [], candlesDay: [],
    lastSignal: null, lastPrice: 0, bidPrice: 0, askPrice: 0,
    openTrade: existingOpenTrade ?? null, intervalHandle: null, lastError: null,
    nextScanAt: Date.now() + config.scanIntervalSec * 1000,
    lastSlHitAt: null, lastSlDirection: null, reEntryCandles: 0, isPowerHourMode: false,
  };

  const intervalMs = Math.max(15, config.scanIntervalSec) * 1000;
  const handle = setInterval(() => tick(state, onTradeOpen, onTradeClose), intervalMs);
  state.intervalHandle = handle;
  bots.set(config.sessionToken, state);
  tick(state, onTradeOpen, onTradeClose);
}

export function stopBot(sessionToken: string) {
  const state = bots.get(sessionToken);
  if (state?.intervalHandle) { clearInterval(state.intervalHandle); state.intervalHandle = null; state.status = "stopped"; }
}

export function getBotState(sessionToken: string): BotState | undefined {
  return bots.get(sessionToken);
}

export function getLivePrice(sessionToken: string): number {
  return bots.get(sessionToken)?.lastPrice ?? 0;
}
