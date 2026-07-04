/**
 * Bot Engine — runs in-process on the Node.js server.
 * Manages per-session bot instances, generates EMA/VWAP/ADX signals,
 * and places paper or live orders via the Upstox API.
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
}

export interface BotState {
  sessionToken: string;
  sessionId: number;
  status: "running" | "stopped" | "paused" | "error";
  mode: "paper" | "live";
  instrumentToken: string;
  instrumentSymbol: string;
  capital: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  dailyLossLimitPct: number;
  tradesCount: number;
  dailyPnl: number;
  lastSignal: Signal | null;
  lastPrice: number;
  candles: Candle[];
  accessToken: string | null;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastError: string | null;
}

// ── In-memory store (keyed by sessionToken) ───────────────────────────────────
const bots = new Map<string, BotState>();

// ── Indicator helpers ─────────────────────────────────────────────────────────
function ema(values: number[], period: number): number[] {
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
  if (candles.length < period + 1) return 0;
  const trs = candles.slice(-period - 1).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calcVWAP(candles: Candle[]): number {
  let cumPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? 0 : cumPV / cumVol;
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
  const dx = di_plus + di_minus === 0 ? 0 : (Math.abs(di_plus - di_minus) / (di_plus + di_minus)) * 100;
  return dx;
}

// ── Signal generator ──────────────────────────────────────────────────────────
export function generateSignal(candles: Candle[]): Signal {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const vwap = calcVWAP(candles);
  const adx = calcADX(candles, 14);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);

  const e9 = ema9[ema9.length - 1];
  const e21 = ema21[ema21.length - 1];
  const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : e21;

  // RSI
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const rsiPeriod = 14;
  const avgGain = gains.slice(-rsiPeriod).reduce((a, b) => a + b, 0) / rsiPeriod;
  const avgLoss = losses.slice(-rsiPeriod).reduce((a, b) => a + b, 0) / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // Volume confirmation
  const avgVol = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
  const lastVol = candles[candles.length - 1].volume;
  const volConfirm = lastVol > avgVol * 1.2;

  // Market hours filter (IST 9:30–15:00)
  const now = new Date();
  const istHour = (now.getUTCHours() + 5) % 24;
  const istMin = (now.getUTCMinutes() + 30) % 60;
  const istTime = istHour * 60 + istMin;
  const inSession = istTime >= 570 && istTime <= 900; // 9:30–15:00

  // Trend strength filter
  const trendStrong = adx > 20;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  const reasons: string[] = [];

  if (inSession && trendStrong && candles.length >= 50) {
    // BUY conditions
    const buyScore =
      (e9 > e21 ? 1 : 0) +
      (e21 > e50 ? 1 : 0) +
      (price > vwap ? 1 : 0) +
      (rsi > 50 && rsi < 70 ? 1 : 0) +
      (volConfirm ? 1 : 0);

    // SELL conditions
    const sellScore =
      (e9 < e21 ? 1 : 0) +
      (e21 < e50 ? 1 : 0) +
      (price < vwap ? 1 : 0) +
      (rsi < 50 && rsi > 30 ? 1 : 0) +
      (volConfirm ? 1 : 0);

    if (buyScore >= 4) {
      direction = "BUY";
      confidence = buyScore / 5;
      reasons.push(`EMA9>${e9.toFixed(1)}>EMA21>${e21.toFixed(1)}`, `Price>VWAP`, `RSI=${rsi.toFixed(1)}`, `ADX=${adx.toFixed(1)}`);
    } else if (sellScore >= 4) {
      direction = "SELL";
      confidence = sellScore / 5;
      reasons.push(`EMA9<${e9.toFixed(1)}<EMA21<${e21.toFixed(1)}`, `Price<VWAP`, `RSI=${rsi.toFixed(1)}`, `ADX=${adx.toFixed(1)}`);
    }
  } else if (!inSession) {
    reasons.push("Market closed (outside 9:30–15:00 IST)");
  } else if (!trendStrong) {
    reasons.push(`ADX=${adx.toFixed(1)} < 20 (choppy market, skipping)`);
  } else {
    reasons.push("Insufficient candle data");
  }

  const slMultiplier = 1.5;
  const tpMultiplier = 3.0;
  const slPrice =
    direction === "BUY"
      ? price - atr * slMultiplier
      : direction === "SELL"
        ? price + atr * slMultiplier
        : price - atr * slMultiplier;
  const targetPrice =
    direction === "BUY"
      ? price + atr * tpMultiplier
      : direction === "SELL"
        ? price - atr * tpMultiplier
        : price + atr * tpMultiplier;

  return { direction, confidence, entryPrice: price, slPrice, targetPrice, atr, reason: reasons.join(" | ") };
}

// ── Mock price generator (used when no Upstox token) ─────────────────────────
const mockPrices: Record<string, number> = {
  RELIANCE: 2950,
  NIFTY: 24500,
  BANKNIFTY: 52000,
  INFY: 1780,
  TCS: 3920,
};

function getMockPrice(symbol: string): number {
  const base = mockPrices[symbol] ?? 1000;
  const change = (Math.random() - 0.5) * base * 0.002;
  mockPrices[symbol] = base + change;
  return parseFloat((base + change).toFixed(2));
}

function buildMockCandle(symbol: string): Candle {
  const close = getMockPrice(symbol);
  const range = close * 0.005;
  return {
    open: close - range * Math.random(),
    high: close + range * Math.random(),
    low: close - range * Math.random(),
    close,
    volume: Math.floor(50000 + Math.random() * 100000),
    timestamp: Date.now(),
  };
}

// ── Fetch real candles from Upstox ────────────────────────────────────────────
async function fetchUpstoxCandles(instrumentToken: string, accessToken: string): Promise<Candle[]> {
  try {
    const encoded = encodeURIComponent(instrumentToken);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      timeout: 5000,
    });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map((c: number[]) => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  } catch {
    return [];
  }
}

// ── Place order via Upstox API ────────────────────────────────────────────────
export async function placeUpstoxOrder(
  accessToken: string,
  instrumentToken: string,
  direction: "BUY" | "SELL",
  quantity: number,
  price: number
): Promise<string | null> {
  try {
    const resp = await axios.post(
      "https://api.upstox.com/v3/order/place",
      {
        quantity,
        product: "I", // Intraday
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
async function tick(state: BotState, onTradeCallback: (trade: Omit<InsertTrade, "sessionToken" | "sessionId">) => Promise<void>) {
  if (state.status !== "running") return;

  // Daily loss limit check
  const maxDailyLoss = -(state.capital * state.dailyLossLimitPct) / 100;
  if (state.dailyPnl <= maxDailyLoss) {
    state.status = "paused";
    state.lastError = `Daily loss limit hit (₹${state.dailyPnl.toFixed(0)})`;
    return;
  }

  // Max trades check
  if (state.tradesCount >= state.maxTradesPerDay) {
    state.status = "paused";
    state.lastError = `Max trades per day reached (${state.maxTradesPerDay})`;
    return;
  }

  // Fetch/build candles
  let newCandle: Candle;
  if (state.accessToken) {
    const candles = await fetchUpstoxCandles(state.instrumentToken, state.accessToken);
    if (candles.length > 0) {
      state.candles = candles.slice(-100);
      newCandle = candles[candles.length - 1];
    } else {
      newCandle = buildMockCandle(state.instrumentSymbol);
      state.candles.push(newCandle);
    }
  } else {
    newCandle = buildMockCandle(state.instrumentSymbol);
    state.candles.push(newCandle);
    if (state.candles.length > 100) state.candles.shift();
  }

  state.lastPrice = newCandle.close;

  if (state.candles.length < 50) return;

  const signal = generateSignal(state.candles);
  state.lastSignal = signal;

  if (signal.direction === "HOLD") return;

  // Position sizing
  const riskAmount = (state.capital * state.riskPerTradePct) / 100;
  const slDistance = Math.abs(signal.entryPrice - signal.slPrice);
  const quantity = slDistance > 0 ? Math.max(1, Math.floor(riskAmount / slDistance)) : 1;

  // Place order
  let orderId: string | null = null;
  if (state.mode === "live" && state.accessToken) {
    orderId = await placeUpstoxOrder(state.accessToken, state.instrumentToken, signal.direction, quantity, signal.entryPrice);
  }

  // Simulate P&L for paper trades
  const simulatedExit = signal.direction === "BUY" ? signal.targetPrice : signal.slPrice;
  const pnl = signal.direction === "BUY"
    ? (simulatedExit - signal.entryPrice) * quantity
    : (signal.entryPrice - simulatedExit) * quantity;

  state.tradesCount += 1;
  state.dailyPnl += state.mode === "paper" ? pnl * 0.5 : 0; // paper: partial simulation

  await onTradeCallback({
    symbol: state.instrumentSymbol,
    instrumentToken: state.instrumentToken,
    direction: signal.direction,
    mode: state.mode,
    entryPrice: signal.entryPrice,
    exitPrice: state.mode === "paper" ? simulatedExit : undefined,
    quantity,
    slPrice: signal.slPrice,
    targetPrice: signal.targetPrice,
    atr: signal.atr,
    confidence: signal.confidence,
    status: state.mode === "paper" ? "closed" : "open",
    exitReason: state.mode === "paper" ? "paper_simulation" : undefined,
    pnl: state.mode === "paper" ? pnl : undefined,
    pnlPct: state.mode === "paper" ? (pnl / state.capital) * 100 : undefined,
    upstoxOrderId: orderId ?? undefined,
    signalReason: signal.reason,
    enteredAt: new Date(),
    exitedAt: state.mode === "paper" ? new Date() : undefined,
  });
}

type InsertTrade = {
  sessionToken: string;
  sessionId: number;
  symbol: string;
  instrumentToken: string;
  direction: "BUY" | "SELL";
  mode: "paper" | "live";
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  slPrice: number;
  targetPrice: number;
  atr: number;
  confidence: number;
  status: "open" | "closed" | "cancelled";
  exitReason?: string;
  pnl?: number;
  pnlPct?: number;
  upstoxOrderId?: string;
  signalReason: string;
  enteredAt: Date;
  exitedAt?: Date;
};

// ── Public API ────────────────────────────────────────────────────────────────
export function startBot(
  config: Omit<BotState, "candles" | "lastSignal" | "lastPrice" | "intervalHandle" | "lastError">,
  onTrade: (trade: Omit<InsertTrade, "sessionToken" | "sessionId">) => Promise<void>
) {
  const existing = bots.get(config.sessionToken);
  if (existing?.intervalHandle) clearInterval(existing.intervalHandle);

  const state: BotState = {
    ...config,
    candles: [],
    lastSignal: null,
    lastPrice: 0,
    intervalHandle: null,
    lastError: null,
  };

  const handle = setInterval(() => tick(state, onTrade), 60_000);
  state.intervalHandle = handle;
  bots.set(config.sessionToken, state);

  // Run first tick immediately
  tick(state, onTrade);
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
