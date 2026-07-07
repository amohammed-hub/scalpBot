/**
 * Bot Engine — runs in-process on the Node.js server.
 * Manages per-session bot instances, generates candle-based signals,
 * monitors open trade SL/Target, and places paper or live orders via Upstox API.
 *
 * Keyed by sessionToken (browser-generated UUID) — no Manus login required.
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
  layer: "Breakout" | "Pattern" | "Trend" | "Momentum" | "None";
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
  currentSl: number; // tracks trailing SL movement
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
  openTrade: OpenTrade | null;
  accessToken: string | null;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastError: string | null;
  nextScanAt: number; // timestamp of next scan
}

// ── In-memory store (keyed by sessionToken) ───────────────────────────────────
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

// ── Signal generator (4-layer candle analysis) ────────────────────────────────
export function generateSignal(candles: Candle[], slMultiplier = 1.5, tpMultiplier = 3.0, minConf = 0.6): Signal {
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

  // Market hours filter (IST 9:15–15:30 for NSE, 9:00–23:30 for MCX)
  const now = new Date();
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const inNSESession = istMin >= 555 && istMin <= 930; // 9:15–15:30
  const inMCXSession = istMin >= 540 && istMin <= 1410; // 9:00–23:30
  const inSession = inNSESession || inMCXSession;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";
  let layer: Signal["layer"] = "None";

  if (!inSession) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: "Market closed", layer: "None" };
  }

  if (candles.length < 20) {
    return { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price - atr * slMultiplier, targetPrice: price + atr * tpMultiplier, atr, reason: `Collecting data (${candles.length}/20 candles)`, layer: "None" };
  }

  // ── Layer 1: Breakout (fastest — fires on breakout candle) ────────────────
  const lookback = candles.slice(-20);
  const highestHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
  const lowestLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
  const lastCandle = candles[candles.length - 1];
  const breakoutUpPct = (lastCandle.close - highestHigh) / highestHigh;
  const breakoutDnPct = (lowestLow - lastCandle.close) / lowestLow;

  if (breakoutUpPct > 0.0003 && volRatio >= 1.3 && rsi > 45 && rsi < 80) {
    direction = "BUY";
    confidence = Math.min(0.95, 0.65 + breakoutUpPct * 200 + (volRatio - 1.3) * 0.1);
    reason = `[Breakout] Above ${highestHigh.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)})`;
    layer = "Breakout";
  } else if (breakoutDnPct > 0.0003 && volRatio >= 1.3 && rsi < 55 && rsi > 20) {
    direction = "SELL";
    confidence = Math.min(0.95, 0.65 + breakoutDnPct * 200 + (volRatio - 1.3) * 0.1);
    reason = `[Breakout] Below ${lowestLow.toFixed(1)} | Vol ${volRatio.toFixed(1)}x | RSI(${rsi.toFixed(0)})`;
    layer = "Breakout";
  }

  // ── Layer 2: Candlestick Pattern ──────────────────────────────────────────
  if (direction === "HOLD" && candles.length >= 3) {
    const c0 = candles[candles.length - 3];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    const body2 = Math.abs(c2.close - c2.open);
    const body1 = Math.abs(c1.close - c1.open);
    const range2 = c2.high - c2.low;

    // Bullish Engulfing
    if (c1.close < c1.open && c2.close > c2.open && c2.close > c1.open && c2.open < c1.close && volRatio >= 1.2 && price > vwap) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.68 + (body2 / body1 - 1) * 0.1);
      reason = `[Pattern] Bullish Engulfing | Vol ${volRatio.toFixed(1)}x | Above VWAP`;
      layer = "Pattern";
    }
    // Bearish Engulfing
    else if (c1.close > c1.open && c2.close < c2.open && c2.close < c1.open && c2.open > c1.close && volRatio >= 1.2 && price < vwap) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.68 + (body2 / body1 - 1) * 0.1);
      reason = `[Pattern] Bearish Engulfing | Vol ${volRatio.toFixed(1)}x | Below VWAP`;
      layer = "Pattern";
    }
    // Hammer (bullish reversal)
    else if (c2.close > c2.open && (c2.open - c2.low) > body2 * 2 && (c2.high - c2.close) < body2 * 0.5 && rsi < 45) {
      direction = "BUY";
      confidence = 0.70;
      reason = `[Pattern] Hammer | RSI(${rsi.toFixed(0)}) oversold | Vol ${volRatio.toFixed(1)}x`;
      layer = "Pattern";
    }
    // Shooting Star (bearish reversal)
    else if (c2.close < c2.open && (c2.high - c2.open) > body2 * 2 && (c2.close - c2.low) < body2 * 0.5 && rsi > 55) {
      direction = "SELL";
      confidence = 0.70;
      reason = `[Pattern] Shooting Star | RSI(${rsi.toFixed(0)}) overbought | Vol ${volRatio.toFixed(1)}x`;
      layer = "Pattern";
    }
    // Marubozu (strong momentum candle)
    else if (body2 > range2 * 0.85 && volRatio >= 1.5) {
      if (c2.close > c2.open && price > vwap) {
        direction = "BUY";
        confidence = Math.min(0.85, 0.65 + volRatio * 0.05);
        reason = `[Pattern] Bull Marubozu | Vol ${volRatio.toFixed(1)}x | Above VWAP`;
        layer = "Pattern";
      } else if (c2.close < c2.open && price < vwap) {
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
    if (e9 > e21 && price > vwap && rsi > 50 && rsi < 72) {
      direction = "BUY";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9(${e9.toFixed(1)})>EMA21(${e21.toFixed(1)}) | VWAP(${vwap.toFixed(1)}) | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)})`;
      layer = "Trend";
    } else if (e9 < e21 && price < vwap && rsi < 50 && rsi > 28) {
      direction = "SELL";
      confidence = Math.min(0.88, 0.55 + emaDiffPct * 200 + (adx - 18) * 0.005);
      reason = `[Trend] EMA9(${e9.toFixed(1)})<EMA21(${e21.toFixed(1)}) | VWAP(${vwap.toFixed(1)}) | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)})`;
      layer = "Trend";
    }
  }

  // ── Layer 4: Momentum ─────────────────────────────────────────────────────
  if (direction === "HOLD" && candles.length >= 5) {
    const roc3 = closes.length >= 4 ? (price - closes[closes.length - 4]) / closes[closes.length - 4] : 0;
    if (rsi > 62 && roc3 > 0.0008 && price > vwap) {
      direction = "BUY";
      confidence = Math.min(0.82, 0.60 + roc3 * 100 + (rsi - 62) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | +${(roc3 * 100).toFixed(2)}% in 3 candles | Above VWAP`;
      layer = "Momentum";
    } else if (rsi < 38 && roc3 < -0.0008 && price < vwap) {
      direction = "SELL";
      confidence = Math.min(0.82, 0.60 + Math.abs(roc3) * 100 + (38 - rsi) * 0.005);
      reason = `[Momentum] RSI(${rsi.toFixed(0)}) | ${(roc3 * 100).toFixed(2)}% in 3 candles | Below VWAP`;
      layer = "Momentum";
    }
  }

  if (direction === "HOLD" || confidence < minConf) {
    return {
      direction: "HOLD", confidence, entryPrice: price,
      slPrice: price - atr * slMultiplier,
      targetPrice: price + atr * tpMultiplier,
      atr,
      reason: direction === "HOLD" ? (reason || `EMA9(${e9.toFixed(1)}) vs EMA21(${e21.toFixed(1)}) — No clear signal | RSI(${rsi.toFixed(0)}) | ADX(${adx.toFixed(0)})`) : `Confidence ${(confidence * 100).toFixed(0)}% below threshold`,
      layer: "None",
    };
  }

  const slPrice = direction === "BUY" ? price - atr * slMultiplier : price + atr * slMultiplier;
  const targetPrice = direction === "BUY" ? price + atr * tpMultiplier : price - atr * tpMultiplier;

  return { direction, confidence, entryPrice: price, slPrice, targetPrice, atr, reason, layer };
}

// ── Fetch real candles from Upstox ────────────────────────────────────────────
async function fetchUpstoxCandles(instrumentToken: string, accessToken: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      timeout: 8000,
    });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    }));
  } catch {
    return [];
  }
}

// ── Fetch full quote (LTP + bid + ask) from Upstox ────────────────────────────
async function fetchFullQuote(instrumentToken: string, accessToken: string): Promise<{ ltp: number; bid: number; ask: number } | null> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encoded}`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      timeout: 5000,
    });
    const data = resp.data?.data?.[instrumentToken] ?? resp.data?.data?.[Object.keys(resp.data?.data ?? {})[0]];
    if (!data) return null;
    return {
      ltp: data.last_price ?? 0,
      bid: data.depth?.buy?.[0]?.price ?? data.last_price ?? 0,
      ask: data.depth?.sell?.[0]?.price ?? data.last_price ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Mock price generator (used when no Upstox token) ─────────────────────────
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
    close,
    volume: Math.floor(50000 + Math.random() * 100000),
    timestamp: Date.now(),
  };
}

// ── Place order via Upstox API ────────────────────────────────────────────────
export async function placeUpstoxOrder(
  accessToken: string,
  instrumentToken: string,
  direction: "BUY" | "SELL",
  quantity: number,
): Promise<string | null> {
  try {
    const resp = await axios.post(
      "https://api.upstox.com/v3/order/place",
      {
        quantity,
        product: "I",
        validity: "DAY",
        price: 0,
        tag: "scalp-bot",
        instrument_token: instrumentToken,
        order_type: "MARKET",
        transaction_type: direction,
        disclosed_quantity: 0,
        trigger_price: 0,
        is_amo: false,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 8000,
      }
    );
    return resp.data?.data?.order_id ?? null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[BotEngine] Order placement failed:", msg);
    return null;
  }
}

// ── Bot tick (called every interval) ─────────────────────────────────────────
async function tick(
  state: BotState,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
) {
  if (state.status !== "running") return;

  // Daily loss limit check
  const maxDailyLoss = -(state.capital * state.dailyLossLimitPct) / 100;
  if (state.dailyPnl <= maxDailyLoss) {
    state.status = "paused";
    state.lastError = `Daily loss limit hit (₹${state.dailyPnl.toFixed(0)})`;
    console.log(`[BotEngine] ${state.sessionToken} — daily loss limit hit`);
    return;
  }

  // Fetch candles + quote
  let newCandle: Candle;
  if (state.accessToken) {
    const [candles, quote] = await Promise.all([
      fetchUpstoxCandles(state.instrumentToken, state.accessToken),
      fetchFullQuote(state.instrumentToken, state.accessToken),
    ]);
    if (candles.length > 0) {
      state.candles = candles.slice(-100);
      newCandle = candles[candles.length - 1];
    } else {
      newCandle = buildMockCandle(state.instrumentSymbol);
      state.candles.push(newCandle);
      if (state.candles.length > 100) state.candles.shift();
    }
    if (quote) {
      state.lastPrice = quote.ltp;
      state.bidPrice = quote.bid;
      state.askPrice = quote.ask;
    } else {
      state.lastPrice = newCandle.close;
    }
  } else {
    newCandle = buildMockCandle(state.instrumentSymbol);
    state.candles.push(newCandle);
    if (state.candles.length > 100) state.candles.shift();
    state.lastPrice = newCandle.close;
    state.bidPrice = newCandle.close - newCandle.close * 0.0001;
    state.askPrice = newCandle.close + newCandle.close * 0.0001;
  }

  const price = state.lastPrice;
  state.nextScanAt = Date.now() + state.scanIntervalSec * 1000;

  // ── Monitor open trade SL/Target ──────────────────────────────────────────
  if (state.openTrade) {
    const trade = state.openTrade;

    // Trailing SL update
    if (trade.trailingSlEnabled) {
      const trailDist = trade.entryPrice * (trade.trailingSlPct / 100);
      if (trade.direction === "BUY") {
        const newSl = price - trailDist;
        if (newSl > trade.currentSl) trade.currentSl = newSl;
      } else {
        const newSl = price + trailDist;
        if (newSl < trade.currentSl) trade.currentSl = newSl;
      }
    }

    let exitReason: string | null = null;
    if (trade.direction === "BUY") {
      if (price <= trade.currentSl) exitReason = "Stop Loss";
      else if (price >= trade.targetPrice) exitReason = "Target Hit";
    } else {
      if (price >= trade.currentSl) exitReason = "Stop Loss";
      else if (price <= trade.targetPrice) exitReason = "Target Hit";
    }

    if (exitReason) {
      const pnl = trade.direction === "BUY"
        ? (price - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - price) * trade.quantity;

      // Place exit order in live mode
      if (trade.mode === "live" && state.accessToken) {
        const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
        await placeUpstoxOrder(state.accessToken, trade.instrumentToken, exitDir, trade.quantity);
      }

      state.dailyPnl += pnl;
      state.openTrade = null;
      await onTradeClose(trade.dbId, price, pnl, exitReason);
      console.log(`[BotEngine] ${state.sessionToken} — trade closed: ${exitReason} | P&L: ₹${pnl.toFixed(0)}`);
    }
    return; // Don't open new trade while one is open
  }

  // ── Generate signal and open new trade ───────────────────────────────────
  if (state.tradesCount >= state.maxTradesPerDay) {
    state.status = "paused";
    state.lastError = `Max trades per day reached (${state.maxTradesPerDay})`;
    return;
  }

  const signal = generateSignal(state.candles, state.stopLossMultiplier, state.targetMultiplier, state.minConfidence / 100);
  state.lastSignal = signal;

  if (signal.direction === "HOLD" || signal.confidence < state.minConfidence / 100) return;

  // Position sizing
  const riskAmount = (state.capital * state.riskPerTradePct) / 100;
  const slDistance = Math.abs(signal.entryPrice - signal.slPrice);
  const quantity = slDistance > 0 ? Math.max(1, Math.floor(riskAmount / slDistance)) : 1;

  // Place entry order in live mode
  let orderId: string | undefined;
  if (state.mode === "live" && state.accessToken) {
    const oid = await placeUpstoxOrder(state.accessToken, state.instrumentToken, signal.direction, quantity);
    orderId = oid ?? undefined;
  }

  const dbId = await onTradeOpen({
    symbol: state.instrumentSymbol,
    symbolLabel: state.instrumentLabel,
    instrumentToken: state.instrumentToken,
    direction: signal.direction,
    mode: state.mode,
    entryPrice: signal.entryPrice,
    quantity,
    slPrice: signal.slPrice,
    targetPrice: signal.targetPrice,
    atr: signal.atr,
    confidence: signal.confidence,
    status: "open",
    upstoxOrderId: orderId,
    signalReason: signal.reason,
    enteredAt: new Date(),
  });

  state.openTrade = {
    dbId,
    symbol: state.instrumentSymbol,
    symbolLabel: state.instrumentLabel,
    instrumentToken: state.instrumentToken,
    direction: signal.direction,
    mode: state.mode,
    entryPrice: signal.entryPrice,
    quantity,
    slPrice: signal.slPrice,
    targetPrice: signal.targetPrice,
    atr: signal.atr,
    confidence: signal.confidence,
    upstoxOrderId: orderId,
    enteredAt: new Date(),
    trailingSlEnabled: state.trailingSlEnabled,
    trailingSlPct: state.trailingSlPct,
    currentSl: signal.slPrice,
  };

  state.tradesCount += 1;
  console.log(`[BotEngine] ${state.sessionToken} — new trade: ${signal.direction} ${state.instrumentSymbol} @ ₹${signal.entryPrice.toFixed(2)} | Conf: ${(signal.confidence * 100).toFixed(0)}%`);
}

type TradeInsert = {
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
  status: "open" | "closed" | "cancelled";
  upstoxOrderId?: string;
  signalReason: string;
  enteredAt: Date;
};

// ── Public API ────────────────────────────────────────────────────────────────
export function startBot(
  config: Omit<BotState, "candles" | "lastSignal" | "lastPrice" | "bidPrice" | "askPrice" | "openTrade" | "intervalHandle" | "lastError" | "nextScanAt">,
  onTradeOpen: (trade: TradeInsert) => Promise<number>,
  onTradeClose: (dbId: number, exitPrice: number, pnl: number, exitReason: string) => Promise<void>,
  existingOpenTrade?: OpenTrade | null,
) {
  const existing = bots.get(config.sessionToken);
  if (existing?.intervalHandle) clearInterval(existing.intervalHandle);

  const state: BotState = {
    ...config,
    candles: [],
    lastSignal: null,
    lastPrice: 0,
    bidPrice: 0,
    askPrice: 0,
    openTrade: existingOpenTrade ?? null,
    intervalHandle: null,
    lastError: null,
    nextScanAt: Date.now() + config.scanIntervalSec * 1000,
  };

  const intervalMs = Math.max(15, config.scanIntervalSec) * 1000;
  const handle = setInterval(() => tick(state, onTradeOpen, onTradeClose), intervalMs);
  state.intervalHandle = handle;
  bots.set(config.sessionToken, state);

  // Run first tick immediately
  tick(state, onTradeOpen, onTradeClose);
}

export function stopBot(sessionToken: string) {
  const state = bots.get(sessionToken);
  if (state?.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
    state.status = "stopped";
  }
}

export function getBotState(sessionToken: string): BotState | undefined {
  return bots.get(sessionToken);
}

export function getLivePrice(sessionToken: string): number {
  return bots.get(sessionToken)?.lastPrice ?? 0;
}
