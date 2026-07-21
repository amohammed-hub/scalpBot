/**
 * BACKTEST MATRIX — Per-Strategy Per-Instrument (6 months × 6 instruments × 10 strategies)
 * 
 * Fetches 1-min candle data from Upstox public historical API (no auth needed)
 * and runs each strategy individually on each instrument.
 * 
 * Usage: node backtest-matrix.mjs
 * Output: backtest-results.json + console matrix
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── Import signal generators from botEngine ──
// We can't directly import TS, so we'll implement the core signal logic inline
// using the same algorithms as the bot engine.

const fetch = globalThis.fetch;

// ── Configuration ──
const INSTRUMENTS = [
  { name: "NIFTY", token: "NSE_INDEX|Nifty 50", type: "nse" },
  { name: "BANKNIFTY", token: "NSE_INDEX|Nifty Bank", type: "nse" },
  { name: "FINNIFTY", token: "NSE_INDEX|Nifty Fin Service", type: "nse" },
  { name: "GOLD", token: "MCX_FO|552720", type: "mcx" },
  { name: "SILVER", token: "MCX_FO|471725", type: "mcx" },
  { name: "CRUDEOIL", token: "MCX_FO|560977", type: "mcx" },
];

const STRATEGIES = [
  "Breakout", "Pattern", "Trend", "Momentum", "MACD_BB",
  "ORB", "VWAPReversion", "RedBarTheory", "TrikalStrategy", "Adeeb"
];

// Date range: Jan 2026 – Jul 2026 (fetch in 28-day chunks)
const START_DATE = new Date("2026-01-01");
const END_DATE = new Date("2026-07-21");
const CHUNK_DAYS = 28;

// ── Technical Indicators ──
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return candles.length > 1 ? Math.abs(candles[candles.length-1].high - candles[candles.length-1].low) : 1;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1]?.close ?? candles[i].open;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i-1] * (1 - k));
  }
  return result;
}

function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(data[i]); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcADX(candles, period = 14) {
  if (candles.length < period * 2) return 20;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1]?.close ?? candles[i].open;
    tr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const up = h - (candles[i-1]?.high ?? h);
    const down = (candles[i-1]?.low ?? l) - l;
    if (up > down && up > 0) plusDM += up;
    if (down > up && down > 0) minusDM += down;
  }
  if (tr === 0) return 20;
  const pdi = (plusDM / tr) * 100;
  const mdi = (minusDM / tr) * 100;
  const dx = Math.abs(pdi - mdi) / (pdi + mdi + 0.0001) * 100;
  return dx;
}

function calcVWAP(candles) {
  let cumVol = 0, cumTP = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumVol += vol;
    cumTP += tp * vol;
  }
  return cumVol > 0 ? cumTP / cumVol : candles[candles.length-1]?.close ?? 0;
}

function calcBollingerBands(closes, period = 20) {
  if (closes.length < period) return { upper: closes[closes.length-1], middle: closes[closes.length-1], lower: closes[closes.length-1] };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a,b) => a+b, 0) / period;
  const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / period);
  return { upper: mean + 2*std, middle: mean, lower: mean - 2*std };
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

// ── Strategy Signal Generators ──
// Each returns: { direction: "BUY"|"SELL"|"HOLD", confidence, sl, tp }

function strategyBreakout(candles, atr, price) {
  if (candles.length < 20) return null;
  const lookback = candles.slice(-20);
  const high20 = Math.max(...lookback.map(c => c.high));
  const low20 = Math.min(...lookback.map(c => c.low));
  const range = high20 - low20;
  if (range < atr * 0.5) return null;
  
  if (price > high20 && candles[candles.length-1].volume > candles[candles.length-2].volume * 1.2) {
    return { direction: "BUY", confidence: 0.68, sl: price - atr * 1.5, tp: price + atr * 3 };
  }
  if (price < low20 && candles[candles.length-1].volume > candles[candles.length-2].volume * 1.2) {
    return { direction: "SELL", confidence: 0.68, sl: price + atr * 1.5, tp: price - atr * 3 };
  }
  return null;
}

function strategyPattern(candles, atr, price) {
  if (candles.length < 5) return null;
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  
  // Engulfing
  if (c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close) {
    return { direction: "BUY", confidence: 0.65, sl: price - atr * 1.5, tp: price + atr * 2.5 };
  }
  if (c.close < c.open && p.close > p.open && c.open > p.close && c.close < p.open) {
    return { direction: "SELL", confidence: 0.65, sl: price + atr * 1.5, tp: price - atr * 2.5 };
  }
  // Hammer / Shooting star
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    return { direction: "BUY", confidence: 0.60, sl: c.low - atr * 0.5, tp: price + atr * 2 };
  }
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    return { direction: "SELL", confidence: 0.60, sl: c.high + atr * 0.5, tp: price - atr * 2 };
  }
  return null;
}

function strategyTrend(candles, atr, price) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const adx = calcADX(candles, 14);
  const rsi = calcRSI(closes, 14);
  
  const e9v = e9[e9.length - 1], e21v = e21[e21.length - 1];
  
  if (adx > 25 && e9v > e21v && rsi > 50 && rsi < 75 && price > e9v) {
    return { direction: "BUY", confidence: 0.70, sl: price - atr * 1.5, tp: price + atr * 3 };
  }
  if (adx > 25 && e9v < e21v && rsi < 50 && rsi > 25 && price < e9v) {
    return { direction: "SELL", confidence: 0.70, sl: price + atr * 1.5, tp: price - atr * 3 };
  }
  return null;
}

function strategyMomentum(candles, atr, price) {
  if (candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const prevRsi = calcRSI(closes.slice(0, -1), 14);
  const adx = calcADX(candles, 14);
  
  // RSI momentum shift
  if (rsi > 60 && prevRsi < 60 && adx > 20) {
    return { direction: "BUY", confidence: 0.65, sl: price - atr * 1.5, tp: price + atr * 2.5 };
  }
  if (rsi < 40 && prevRsi > 40 && adx > 20) {
    return { direction: "SELL", confidence: 0.65, sl: price + atr * 1.5, tp: price - atr * 2.5 };
  }
  return null;
}

function strategyMACDBB(candles, atr, price) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const { macd, signal, histogram } = calcMACD(closes);
  const bb = calcBollingerBands(closes, 20);
  
  // MACD cross + BB position
  const prevCloses = closes.slice(0, -1);
  const prevMACD = calcMACD(prevCloses);
  
  if (macd > signal && prevMACD.macd <= prevMACD.signal && price < bb.middle) {
    return { direction: "BUY", confidence: 0.67, sl: price - atr * 1.5, tp: price + atr * 2.5 };
  }
  if (macd < signal && prevMACD.macd >= prevMACD.signal && price > bb.middle) {
    return { direction: "SELL", confidence: 0.67, sl: price + atr * 1.5, tp: price - atr * 2.5 };
  }
  return null;
}

function strategyORB(candles, atr, price, dayCandles) {
  // Opening Range Breakout - first 15 min range
  if (!dayCandles || dayCandles.length < 15) return null;
  const orbCandles = dayCandles.slice(0, 15);
  const orbHigh = Math.max(...orbCandles.map(c => c.high));
  const orbLow = Math.min(...orbCandles.map(c => c.low));
  const orbRange = orbHigh - orbLow;
  
  if (orbRange < atr * 0.3) return null; // Too narrow
  if (dayCandles.length < 16 || dayCandles.length > 60) return null; // Only valid 9:30-10:15
  
  if (price > orbHigh + atr * 0.1) {
    return { direction: "BUY", confidence: 0.70, sl: orbLow, tp: price + orbRange * 2 };
  }
  if (price < orbLow - atr * 0.1) {
    return { direction: "SELL", confidence: 0.70, sl: orbHigh, tp: price - orbRange * 2 };
  }
  return null;
}

function strategyVWAPReversion(candles, atr, price) {
  if (candles.length < 30) return null;
  const vwap = calcVWAP(candles);
  const dist = (price - vwap) / atr;
  const rsi = calcRSI(candles.map(c => c.close), 14);
  
  // Mean reversion to VWAP
  if (dist < -1.5 && rsi < 35) {
    return { direction: "BUY", confidence: 0.65, sl: price - atr * 1.2, tp: vwap };
  }
  if (dist > 1.5 && rsi > 65) {
    return { direction: "SELL", confidence: 0.65, sl: price + atr * 1.2, tp: vwap };
  }
  return null;
}

function strategyRedBarTheory(candles, atr, price) {
  if (candles.length < 20) return null;
  // Build Renko bricks
  const brickSize = atr;
  if (brickSize <= 0) return null;
  
  const bricks = [];
  let lastBrickClose = candles[0].close;
  
  for (const c of candles) {
    while (c.close >= lastBrickClose + brickSize) {
      lastBrickClose += brickSize;
      bricks.push({ direction: "up", close: lastBrickClose });
    }
    while (c.close <= lastBrickClose - brickSize) {
      lastBrickClose -= brickSize;
      bricks.push({ direction: "down", close: lastBrickClose });
    }
  }
  
  if (bricks.length < 3) return null;
  
  // Count consecutive same-direction bricks from end
  const lastDir = bricks[bricks.length - 1].direction;
  let count = 0;
  for (let i = bricks.length - 1; i >= 0 && bricks[i].direction === lastDir; i--) count++;
  
  if (count >= 3) {
    const confidence = Math.min(0.85, 0.65 + (count - 3) * 0.05);
    if (lastDir === "up") {
      return { direction: "BUY", confidence, sl: price - atr * 1.5, tp: price + atr * 3 };
    } else {
      return { direction: "SELL", confidence, sl: price + atr * 1.5, tp: price - atr * 3 };
    }
  }
  return null;
}

function strategyTrikal(candles, atr, price) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  
  // Trikal: Renko + Ichimoku cloud + SuperTrend alignment
  // Simplified: 3 confirmations needed
  const e9 = ema(closes, 9);
  const e26 = ema(closes, 26);
  const rsi = calcRSI(closes, 14);
  const adx = calcADX(candles, 14);
  
  const e9v = e9[e9.length-1], e26v = e26[e26.length-1];
  const trendUp = e9v > e26v;
  const momentumOk = trendUp ? rsi > 55 : rsi < 45;
  const strongTrend = adx > 22;
  
  // SuperTrend approximation
  const hl2 = (candles[candles.length-1].high + candles[candles.length-1].low) / 2;
  const upperBand = hl2 + 2 * atr;
  const lowerBand = hl2 - 2 * atr;
  const superTrendBull = price > lowerBand;
  const superTrendBear = price < upperBand;
  
  if (trendUp && momentumOk && strongTrend && superTrendBull) {
    return { direction: "BUY", confidence: 0.72, sl: price - atr * 1.5, tp: price + atr * 2.5 };
  }
  if (!trendUp && momentumOk && strongTrend && superTrendBear) {
    return { direction: "SELL", confidence: 0.72, sl: price + atr * 1.5, tp: price - atr * 2.5 };
  }
  return null;
}

function strategyAdeeb(candles, atr, price, prevDayHigh, prevDayLow, prevDayClose) {
  if (candles.length < 28 || !prevDayHigh) return null;
  const closes = candles.map(c => c.close);
  
  // Adeeb: CPR + Renko + Volume confirmation
  const pivot = (prevDayHigh + prevDayLow + prevDayClose) / 3;
  const bc = (prevDayHigh + prevDayLow) / 2;
  const tc = 2 * pivot - bc;
  const cprWidth = Math.abs(tc - bc);
  const narrowCPR = cprWidth < atr * 0.8;
  
  const rsi = calcRSI(closes, 14);
  const e9 = ema(closes, 9);
  const e9v = e9[e9.length-1];
  
  // Renko bricks
  const brickSize = atr * 0.5;
  let lastBrick = candles[0].close;
  let greenBricks = 0, redBricks = 0;
  for (const c of candles.slice(-15)) {
    if (c.close >= lastBrick + brickSize) { greenBricks++; lastBrick += brickSize; redBricks = 0; }
    else if (c.close <= lastBrick - brickSize) { redBricks++; lastBrick -= brickSize; greenBricks = 0; }
  }
  
  if (narrowCPR && price > tc && greenBricks >= 2 && rsi > 55 && price > e9v) {
    return { direction: "BUY", confidence: 0.70, sl: Math.min(bc, price - atr * 1.2), tp: price + atr * 2.5 };
  }
  if (narrowCPR && price < bc && redBricks >= 2 && rsi < 45 && price < e9v) {
    return { direction: "SELL", confidence: 0.70, sl: Math.max(tc, price + atr * 1.2), tp: price - atr * 2.5 };
  }
  return null;
}

// ── Strategy dispatcher ──
function runStrategy(name, candles, atr, price, dayCandles, prevDayHigh, prevDayLow, prevDayClose) {
  switch (name) {
    case "Breakout": return strategyBreakout(candles, atr, price);
    case "Pattern": return strategyPattern(candles, atr, price);
    case "Trend": return strategyTrend(candles, atr, price);
    case "Momentum": return strategyMomentum(candles, atr, price);
    case "MACD_BB": return strategyMACDBB(candles, atr, price);
    case "ORB": return strategyORB(candles, atr, price, dayCandles);
    case "VWAPReversion": return strategyVWAPReversion(candles, atr, price);
    case "RedBarTheory": return strategyRedBarTheory(candles, atr, price);
    case "TrikalStrategy": return strategyTrikal(candles, atr, price);
    case "Adeeb": return strategyAdeeb(candles, atr, price, prevDayHigh, prevDayLow, prevDayClose);
    default: return null;
  }
}

// ── Data Fetching ──
async function fetchCandles(token, toDate, fromDate) {
  const encoded = encodeURIComponent(token);
  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/1minute/${toDate}/${fromDate}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) { console.error(`API error: ${resp.status} for ${token} ${fromDate}-${toDate}`); return []; }
  const json = await resp.json();
  const raw = json?.data?.candles ?? [];
  return raw.map(c => ({
    timestamp: new Date(c[0]).getTime(),
    open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0
  })).sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchAllCandles(token) {
  const allCandles = [];
  let current = new Date(START_DATE);
  
  while (current < END_DATE) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    if (chunkEnd > END_DATE) chunkEnd.setTime(END_DATE.getTime());
    
    const fromStr = current.toISOString().split("T")[0];
    const toStr = chunkEnd.toISOString().split("T")[0];
    
    const candles = await fetchCandles(token, toStr, fromStr);
    allCandles.push(...candles);
    
    // Rate limit: 1 req/sec
    await new Promise(r => setTimeout(r, 1100));
    current = new Date(chunkEnd);
  }
  
  // Deduplicate by timestamp
  const seen = new Set();
  const unique = [];
  for (const c of allCandles) {
    if (!seen.has(c.timestamp)) { seen.add(c.timestamp); unique.push(c); }
  }
  return unique.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Backtest Engine ──
function backtestStrategy(strategyName, candles, capital = 100000) {
  const WINDOW = 60;
  const trades = [];
  let i = WINDOW;
  let prevDayHigh = 0, prevDayLow = 0, prevDayClose = 0;
  let currentDay = "";
  let dayStart = 0;
  
  while (i < candles.length) {
    const window = candles.slice(Math.max(0, i - WINDOW), i);
    const price = window[window.length - 1].close;
    const atr = calcATR(window, 14);
    
    // Track day boundaries for ORB and prev day data
    const candleDate = new Date(candles[i].timestamp).toISOString().split("T")[0];
    if (candleDate !== currentDay) {
      if (currentDay && dayStart > 0) {
        const dayCandles = candles.slice(dayStart, i);
        if (dayCandles.length > 0) {
          prevDayHigh = Math.max(...dayCandles.map(c => c.high));
          prevDayLow = Math.min(...dayCandles.map(c => c.low));
          prevDayClose = dayCandles[dayCandles.length - 1].close;
        }
      }
      currentDay = candleDate;
      dayStart = i;
    }
    
    const dayCandles = candles.slice(dayStart, i);
    const signal = runStrategy(strategyName, window, atr, price, dayCandles, prevDayHigh, prevDayLow, prevDayClose);
    
    if (signal && signal.direction !== "HOLD" && signal.confidence >= 0.60) {
      // Entry at next candle open
      const entryCandle = candles[i];
      if (!entryCandle) { i++; continue; }
      const entryPrice = entryCandle.open;
      const slDist = Math.abs(entryPrice - signal.sl);
      const qty = slDist > 0 ? Math.max(1, Math.floor((capital * 0.01) / slDist)) : 1;
      
      // Walk forward to find SL/TP hit (max 120 candles = 2 hours)
      let exitPrice = entryPrice;
      let exitTime = entryCandle.timestamp;
      let result = "TIMEOUT";
      
      for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
        const c = candles[j];
        if (signal.direction === "BUY") {
          if (c.low <= signal.sl) { exitPrice = signal.sl; exitTime = c.timestamp; result = "LOSS"; break; }
          if (c.high >= signal.tp) { exitPrice = signal.tp; exitTime = c.timestamp; result = "WIN"; break; }
        } else {
          if (c.high >= signal.sl) { exitPrice = signal.sl; exitTime = c.timestamp; result = "LOSS"; break; }
          if (c.low <= signal.tp) { exitPrice = signal.tp; exitTime = c.timestamp; result = "WIN"; break; }
        }
        exitPrice = c.close; exitTime = c.timestamp;
      }
      
      if (result === "TIMEOUT") {
        // Close at last candle in window
        result = exitPrice > entryPrice ? (signal.direction === "BUY" ? "WIN" : "LOSS") : (signal.direction === "SELL" ? "WIN" : "LOSS");
      }
      
      const pnl = signal.direction === "BUY"
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;
      
      trades.push({ entryTime: entryCandle.timestamp, exitTime, direction: signal.direction, entryPrice, exitPrice, pnl, result, confidence: signal.confidence });
      
      // Skip to after exit
      const exitIdx = candles.findIndex(c => c.timestamp >= exitTime);
      i = exitIdx > i ? exitIdx + 1 : i + 5; // minimum 5 candle cooldown
    } else {
      i++;
    }
  }
  
  // Compute stats
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.result === "WIN").length;
  const losses = trades.filter(t => t.result === "LOSS").length;
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const maxDrawdown = computeMaxDrawdown(trades);
  const profitFactor = computeProfitFactor(trades);
  
  return { totalTrades, wins, losses, totalPnl: Math.round(totalPnl), winRate: Math.round(winRate * 10) / 10, avgPnl: Math.round(avgPnl), maxDrawdown: Math.round(maxDrawdown), profitFactor: Math.round(profitFactor * 100) / 100 };
}

function computeMaxDrawdown(trades) {
  let peak = 0, maxDD = 0, cumPnl = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeProfitFactor(trades) {
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  BACKTEST MATRIX — 6 Instruments × 10 Strategies × 6 Months ║");
  console.log("║  Period: January 2026 – July 2026 (1-min candles)            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  
  const results = {};
  
  for (const inst of INSTRUMENTS) {
    console.log(`\n📊 Fetching ${inst.name} (${inst.token})...`);
    const candles = await fetchAllCandles(inst.token);
    console.log(`   → ${candles.length} candles loaded (${(candles.length/375).toFixed(0)} trading days)`);
    
    if (candles.length < 100) {
      console.log(`   ⚠ Insufficient data for ${inst.name}, skipping.`);
      results[inst.name] = {};
      for (const s of STRATEGIES) results[inst.name][s] = { totalTrades: 0, totalPnl: 0, winRate: 0, error: "insufficient data" };
      continue;
    }
    
    results[inst.name] = {};
    for (const strategy of STRATEGIES) {
      process.stdout.write(`   Testing ${strategy}... `);
      const stats = backtestStrategy(strategy, candles);
      results[inst.name][strategy] = stats;
      const emoji = stats.totalPnl > 0 ? "✅" : stats.totalPnl < -5000 ? "❌" : "⚠️";
      console.log(`${emoji} ${stats.totalTrades} trades | WR: ${stats.winRate}% | PnL: ₹${stats.totalPnl.toLocaleString()} | PF: ${stats.profitFactor}`);
    }
  }
  
  // ── Print Matrix ──
  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("                    RESULTS MATRIX (₹ P&L)");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  // Header
  const header = "Strategy".padEnd(16) + INSTRUMENTS.map(i => i.name.padStart(12)).join("");
  console.log(header);
  console.log("─".repeat(header.length));
  
  for (const strategy of STRATEGIES) {
    let row = strategy.padEnd(16);
    for (const inst of INSTRUMENTS) {
      const r = results[inst.name][strategy];
      const pnl = r?.totalPnl ?? 0;
      const cell = pnl >= 0 ? `+${pnl}` : `${pnl}`;
      row += cell.padStart(12);
    }
    console.log(row);
  }
  
  // ── Identify profitable combos ──
  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("              PROFITABLE COMBOS (PnL > 0 & WR > 50%)");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  const profitableCombos = {};
  for (const inst of INSTRUMENTS) {
    profitableCombos[inst.name] = [];
    for (const strategy of STRATEGIES) {
      const r = results[inst.name][strategy];
      if (r && r.totalPnl > 0 && r.winRate > 50 && r.totalTrades >= 10 && r.profitFactor > 1.2) {
        profitableCombos[inst.name].push({ strategy, ...r });
      }
    }
    if (profitableCombos[inst.name].length > 0) {
      console.log(`${inst.name}: ${profitableCombos[inst.name].map(c => c.strategy).join(", ")}`);
    } else {
      console.log(`${inst.name}: No consistently profitable strategy found`);
    }
  }
  
  // Save results
  const fs = await import('fs');
  fs.writeFileSync('/home/ubuntu/upstox-scalping-guide/backtest-results.json', JSON.stringify({ results, profitableCombos, meta: { period: "2026-01-01 to 2026-07-21", instruments: INSTRUMENTS.map(i=>i.name), strategies: STRATEGIES } }, null, 2));
  console.log("\n✅ Results saved to backtest-results.json");
  
  return { results, profitableCombos };
}

main().catch(console.error);
