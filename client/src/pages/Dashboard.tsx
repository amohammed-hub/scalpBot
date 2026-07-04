import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import QRModal from "@/components/QRModal";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, Calculator, RefreshCw, Bell, X, ShieldCheck, ShieldAlert, ShieldOff,
  Download, QrCode
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Signal {
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  entryPrice: number;
  slPrice: number;
  targetPrice: number;
  atr: number;
  reason: string;
}

interface Trade {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  mode: "paper" | "live";
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  slPrice: number;
  targetPrice: number;
  status: "open" | "closed";
  exitReason?: string;
  pnl?: number;
  enteredAt: number;
  exitedAt?: number;
}

interface BotConfig {
  instrumentToken: string;
  instrumentSymbol: string;
  mode: "paper" | "live";
  capital: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  // Risk & Stop-Loss parameters
  stopLossMultiplier: number;   // ATR multiplier for stop-loss (e.g. 1.5 = 1.5× ATR)
  targetMultiplier: number;     // ATR multiplier for target (e.g. 3.0 = 3× ATR)
  dailyLossLimitPct: number;    // Max daily loss as % of capital before bot stops
  trailingSlEnabled: boolean;   // Enable trailing stop-loss
  trailingSlPct: number;        // Trailing SL distance as % of entry price
  minConfidence: number;        // Minimum signal confidence (0–100%) to place trade
  scanIntervalSec: number;      // How often bot scans for signals (seconds)
}

interface PricePoint { time: string; price: number; }

// ── Constants ─────────────────────────────────────────────────────────────────
// Instruments are grouped by segment. The bot trades ONE selected instrument at a time.
// NSE_EQ = NSE Cash/Equity | NSE_INDEX = NSE Index | BSE_INDEX = BSE Index
// NFO = NSE F&O segment (futures & options on indices and stocks)
// NOTE: F&O tokens below use the current-week expiry format. Update the token each week
// by replacing the expiry date (e.g. 25JUL25 → 01AUG25) in your Upstox instrument list.
const INSTRUMENTS = [
  // ── NSE Indices (spot — for reference / paper trading) ──
  { token: "NSE_INDEX|Nifty 50",           symbol: "NIFTY",         label: "Nifty 50 (Spot)",         segment: "NSE Index" },
  { token: "NSE_INDEX|Nifty Bank",         symbol: "BANKNIFTY",     label: "Bank Nifty (Spot)",       segment: "NSE Index" },
  { token: "NSE_INDEX|Nifty Fin Service",  symbol: "FINNIFTY",      label: "Fin Nifty (Spot)",        segment: "NSE Index" },
  { token: "NSE_INDEX|MIDCPNIFTY",         symbol: "MIDCPNIFTY",    label: "Midcap Nifty (Spot)",     segment: "NSE Index" },
  // ── NSE F&O — Nifty Options (weekly expiry — most liquid for scalping) ──
  // NOTE: Nifty weekly options expire every Thursday. Update the expiry date each week.
  // Current week expiry: 10 Jul 2026 (format: DDMMMYYYY in token, e.g. 10JUL2026)
  // To find the exact token string, go to Upstox → Developer → Instruments → search "NIFTY" in NFO segment.
  { token: "NFO_OPT|NIFTY10JUL202624800CE",  symbol: "NIFTY_CE",      label: "Nifty 24800 CE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202624800PE",  symbol: "NIFTY_PE",      label: "Nifty 24800 PE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202625000CE",  symbol: "NIFTY_25000CE", label: "Nifty 25000 CE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202625000PE",  symbol: "NIFTY_25000PE", label: "Nifty 25000 PE (10 Jul)",  segment: "NSE F&O Options" },
  // ── NSE F&O — Bank Nifty Options (weekly expiry — expires every Wednesday) ──
  // Current week expiry: 09 Jul 2026
  { token: "NFO_OPT|BANKNIFTY09JUL202653000CE", symbol: "BNF_CE",     label: "BankNifty 53000 CE (9 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653000PE", symbol: "BNF_PE",     label: "BankNifty 53000 PE (9 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500CE", symbol: "BNF_53500CE", label: "BankNifty 53500 CE (9 Jul)", segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500PE", symbol: "BNF_53500PE", label: "BankNifty 53500 PE (9 Jul)", segment: "NSE F&O Options" },
  // ── NSE F&O — Index Futures (monthly expiry — last Thursday of the month) ──
  // Current month expiry: 30 Jul 2026
  { token: "NFO_FUT|NIFTY30JUL2026FUT",        symbol: "NIFTY_FUT",     label: "Nifty Jul 2026 Futures",      segment: "NSE F&O Futures" },
  { token: "NFO_FUT|BANKNIFTY30JUL2026FUT",    symbol: "BNF_FUT",       label: "BankNifty Jul 2026 Futures",  segment: "NSE F&O Futures" },
  // ── NSE Equity (large-cap) ──
  { token: "NSE_EQ|INE009A01021",          symbol: "RELIANCE",      label: "Reliance Industries",     segment: "NSE Equity" },
  { token: "NSE_EQ|INE467B01029",          symbol: "TCS",           label: "TCS",                     segment: "NSE Equity" },
  { token: "NSE_EQ|INE009B01011",          symbol: "INFY",          label: "Infosys",                 segment: "NSE Equity" },
  { token: "NSE_EQ|INE040A01034",          symbol: "HDFC",          label: "HDFC Bank",               segment: "NSE Equity" },
  { token: "NSE_EQ|INE030A01027",          symbol: "ITC",           label: "ITC",                     segment: "NSE Equity" },
  { token: "NSE_EQ|INE585B01010",          symbol: "SBIN",          label: "State Bank of India",     segment: "NSE Equity" },
  { token: "NSE_EQ|INE062A01020",          symbol: "TATAMOTORS",    label: "Tata Motors",             segment: "NSE Equity" },
  { token: "NSE_EQ|INE081A01012",          symbol: "TATASTEEL",     label: "Tata Steel",              segment: "NSE Equity" },
  // ── BSE ──
  { token: "BSE_INDEX|SENSEX",             symbol: "SENSEX",        label: "Sensex",                  segment: "BSE Index" },
];

const BASE_PRICES: Record<string, number> = {
  NIFTY: 24800, BANKNIFTY: 53200, FINNIFTY: 23500, MIDCPNIFTY: 12800,
  NIFTY_CE: 120, NIFTY_PE: 95, NIFTY_25000CE: 45, NIFTY_25000PE: 180,
  BNF_CE: 250, BNF_PE: 200, BNF_53500CE: 130, BNF_53500PE: 310,
  NIFTY_FUT: 24820, BNF_FUT: 53250,
  RELIANCE: 2950, TCS: 3780, INFY: 1620, HDFC: 1740, ITC: 465,
  SBIN: 820, TATAMOTORS: 960, TATASTEEL: 165,
  SENSEX: 81500,
};

const LS_TRADES = "scalpbot_trades";
const LS_CONFIG = "scalpbot_config";
const LS_CREDS = "scalpbot_credentials";
const LS_REMINDER_DISMISSED = "scalpbot_reminder_dismissed";
const LS_TELEGRAM = "scalpbot_telegram";

// Send a Telegram message using the stored bot token and chat ID
async function fireTelegramAlert(text: string): Promise<void> {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "null");
    if (!cfg?.enabled || !cfg?.botToken || !cfg?.chatId) return;
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML" }),
    });
  } catch {
    // Silently ignore Telegram errors — never block the bot
  }
}

// Returns true if it is morning (9:00 AM – 10:30 AM IST) — prime reminder window
function isMorningWindow(): boolean {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMs = now.getTime() + istOffsetMs + now.getTimezoneOffset() * 60 * 1000;
  const ist = new Date(istMs);
  const h = ist.getHours();
  const m = ist.getMinutes();
  const totalMin = h * 60 + m;
  return totalMin >= 9 * 60 && totalMin <= 10 * 60 + 30;
}

// Returns the dismissal key for today (resets each day)
function todayDismissKey(): string {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMs = now.getTime() + istOffsetMs + now.getTimezoneOffset() * 60 * 1000;
  const ist = new Date(istMs);
  return `${LS_REMINDER_DISMISSED}_${ist.getFullYear()}_${ist.getMonth()}_${ist.getDate()}`;
}

// Check if the saved access token looks valid:
// - must be present and long enough (Upstox tokens are typically 200+ chars)
// - must have been saved today (IST date) — tokens expire at midnight IST
function getTokenStatus(): "valid" | "missing" | "short" {
  try {
    const creds = JSON.parse(localStorage.getItem(LS_CREDS) ?? "null");
    if (!creds?.accessToken) return "missing";
    if (creds.accessToken.length < 100) return "short";

    // Check if token was saved today (IST)
    if (creds.tokenSavedAt) {
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const savedIst = new Date(creds.tokenSavedAt + istOffsetMs + new Date(creds.tokenSavedAt).getTimezoneOffset() * 60 * 1000);
      const nowIst = new Date(Date.now() + istOffsetMs + new Date().getTimezoneOffset() * 60 * 1000);
      const savedDay = `${savedIst.getFullYear()}-${savedIst.getMonth()}-${savedIst.getDate()}`;
      const todayDay = `${nowIst.getFullYear()}-${nowIst.getMonth()}-${nowIst.getDate()}`;
      if (savedDay !== todayDay) return "short"; // expired (saved on a previous day)
    }

    return "valid";
  } catch {
    return "missing";
  }
}

// ── Simple EMA helper ─────────────────────────────────────────────────────────
function ema(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function generateSignalFromPrices(prices: number[], symbol: string): Signal {
  const last = prices[prices.length - 1];
  if (prices.length < 26) return { direction: "HOLD", confidence: 0, entryPrice: last, slPrice: last * 0.99, targetPrice: last * 1.02, atr: last * 0.005, reason: "Insufficient data" };

  const ema9 = ema(prices, 9);
  const ema21 = ema(prices, 21);
  const vwap = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atr = Math.abs(prices[prices.length - 1] - prices[prices.length - 2]) * 2.5 + last * 0.003;

  let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reason = "";

  if (ema9 > ema21 && last > vwap) {
    direction = "BUY";
    confidence = Math.min(0.95, 0.55 + (ema9 - ema21) / ema21 * 20);
    reason = `EMA9(${ema9.toFixed(0)}) > EMA21(${ema21.toFixed(0)}) | Price above VWAP(${vwap.toFixed(0)})`;
  } else if (ema9 < ema21 && last < vwap) {
    direction = "SELL";
    confidence = Math.min(0.95, 0.55 + (ema21 - ema9) / ema21 * 20);
    reason = `EMA9(${ema9.toFixed(0)}) < EMA21(${ema21.toFixed(0)}) | Price below VWAP(${vwap.toFixed(0)})`;
  } else {
    reason = `EMA9(${ema9.toFixed(0)}) vs EMA21(${ema21.toFixed(0)}) — No clear trend`;
  }

  const slPrice = direction === "BUY" ? last - atr * 1.5 : direction === "SELL" ? last + atr * 1.5 : last * 0.99;
  const targetPrice = direction === "BUY" ? last + atr * 3 : direction === "SELL" ? last - atr * 3 : last * 1.02;

  return { direction, confidence, entryPrice: last, slPrice, targetPrice, atr, reason };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, navigate] = useLocation();
  const [qrOpen, setQrOpen] = useState(false);

  // Config state (persisted)
  const [config, setConfig] = useState<BotConfig>(() => {
    const defaults: BotConfig = { instrumentToken: INSTRUMENTS[0].token, instrumentSymbol: INSTRUMENTS[0].symbol, mode: "paper", capital: 100000, riskPerTradePct: 1.0, maxTradesPerDay: 5, stopLossMultiplier: 1.5, targetMultiplier: 3.0, dailyLossLimitPct: 3.0, trailingSlEnabled: false, trailingSlPct: 0.5, minConfidence: 60, scanIntervalSec: 60 };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_CONFIG) ?? "null") }; } catch { return defaults; }
  });

  // Bot runtime state
  const [isRunning, setIsRunning] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [priceBuffer, setPriceBuffer] = useState<number[]>([]);
  const [latestSignal, setLatestSignal] = useState<Signal | null>(null);
  const [trades, setTrades] = useState<Trade[]>(() => { try { return JSON.parse(localStorage.getItem(LS_TRADES) ?? "[]"); } catch { return []; } });
  const [todayTrades, setTodayTrades] = useState(0);
  const [dailyPnl, setDailyPnl] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const openTradeRef = useRef<Trade | null>(null);

  // Morning reminder & token status state
  const [showReminder, setShowReminder] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<"valid" | "missing" | "short">(getTokenStatus);

  // Re-check both reminder visibility and token status every 30 seconds
  // This ensures the banner appears even if the app was opened before 9 AM IST
  useEffect(() => {
    const check = () => {
      setTokenStatus(getTokenStatus());
      // Show reminder if: morning window AND not dismissed today
      const shouldShow = isMorningWindow() && !localStorage.getItem(todayDismissKey());
      setShowReminder(shouldShow);
    };
    check(); // run immediately on mount
    const id = setInterval(check, 30_000); // re-check every 30s
    return () => clearInterval(id);
  }, []);

  const dismissReminder = () => {
    localStorage.setItem(todayDismissKey(), "1");
    setShowReminder(false);
  };

  // Persist config
  useEffect(() => { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }, [config]);
  // Persist trades
  useEffect(() => { localStorage.setItem(LS_TRADES, JSON.stringify(trades)); }, [trades]);

  // Compute today stats from trades
  useEffect(() => {
    const today = new Date().toDateString();
    const todayList = trades.filter(t => new Date(t.enteredAt).toDateString() === today);
    setTodayTrades(todayList.length);
    setDailyPnl(todayList.reduce((a, t) => a + (t.pnl ?? 0), 0));
  }, [trades]);

  // Simulate price movement
  const simulatePrice = useCallback(() => {
    const base = BASE_PRICES[config.instrumentSymbol] ?? 2000;
    setCurrentPrice(prev => {
      const p = prev === 0 ? base : prev;
      const change = (Math.random() - 0.48) * p * 0.003;
      const next = Math.max(p * 0.9, p + change);
      setPriceBuffer(buf => [...buf.slice(-59), next]);
      setPriceHistory(hist => {
        const now = new Date();
        const label = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        return [...hist.slice(-29), { time: label, price: parseFloat(next.toFixed(2)) }];
      });
      return next;
    });
  }, [config.instrumentSymbol]);

  // Bot tick — generate signal and place paper trades
  const botTick = useCallback(() => {
    setPriceBuffer(buf => {
      if (buf.length < 10) return buf;
      const signal = generateSignalFromPrices(buf, config.instrumentSymbol);
      setLatestSignal(signal);

      // Check open trade for SL/TP hit
      if (openTradeRef.current) {
        const trade = openTradeRef.current;
        const price = buf[buf.length - 1];
        let exitReason: string | null = null;
        if (trade.direction === "BUY") {
          if (price <= trade.slPrice) exitReason = "Stop Loss";
          else if (price >= trade.targetPrice) exitReason = "Target Hit";
        } else {
          if (price >= trade.slPrice) exitReason = "Stop Loss";
          else if (price <= trade.targetPrice) exitReason = "Target Hit";
        }
        if (exitReason) {
          const pnl = trade.direction === "BUY" ? (price - trade.entryPrice) * trade.quantity : (trade.entryPrice - price) * trade.quantity;
          const closed: Trade = { ...trade, exitPrice: price, status: "closed", exitReason, pnl, exitedAt: Date.now() };
          openTradeRef.current = null;
          setTrades(prev => prev.map(t => t.id === closed.id ? closed : t));
          toast[pnl > 0 ? "success" : "error"](`${exitReason}: ${pnl > 0 ? "+" : ""}₹${pnl.toFixed(0)} on ${trade.symbol}`);
          // Fire Telegram alert for trade exit
          fireTelegramAlert(
            `${pnl > 0 ? "✅" : "❌"} <b>ScalpBot Trade Closed</b>\n` +
            `• Instrument: <b>${trade.symbol}</b>\n` +
            `• Direction: ${trade.direction}\n` +
            `• Exit Reason: <b>${exitReason}</b>\n` +
            `• Entry: ₹${trade.entryPrice.toFixed(2)} → Exit: ₹${price.toFixed(2)}\n` +
            `• P&L: <b>${pnl > 0 ? "+" : ""}₹${pnl.toFixed(0)}</b> (Qty: ${trade.quantity})`
          );
        }
        return buf;
      }

      // Open new trade if signal is strong enough and no open trade
      if (signal.direction !== "HOLD" && signal.confidence > 0.6 && !openTradeRef.current) {
        setTodayTrades(prev => {
          if (prev >= config.maxTradesPerDay) return prev;
          const riskAmt = config.capital * (config.riskPerTradePct / 100);
          const slDist = Math.abs(signal.entryPrice - signal.slPrice);
          const qty = Math.max(1, Math.floor(riskAmt / slDist));
          const newTrade: Trade = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            symbol: config.instrumentSymbol,
            direction: signal.direction as "BUY" | "SELL",
            mode: config.mode,
            entryPrice: signal.entryPrice,
            quantity: qty,
            slPrice: signal.slPrice,
            targetPrice: signal.targetPrice,
            status: "open",
            enteredAt: Date.now(),
          };
          openTradeRef.current = newTrade;
          setTrades(prev => [newTrade, ...prev]);
          toast.info(`${signal.direction} signal: ${config.instrumentSymbol} @ ₹${signal.entryPrice.toFixed(0)} | SL: ₹${signal.slPrice.toFixed(0)} | Target: ₹${signal.targetPrice.toFixed(0)}`);
          // Fire Telegram alert for new trade signal
          fireTelegramAlert(
            `⚡ <b>ScalpBot ${signal.direction} Signal</b>\n` +
            `• Instrument: <b>${config.instrumentSymbol}</b>\n` +
            `• Mode: ${config.mode.toUpperCase()}\n` +
            `• Entry: <b>₹${signal.entryPrice.toFixed(2)}</b>\n` +
            `• Stop-Loss: ₹${signal.slPrice.toFixed(2)}\n` +
            `• Target: ₹${signal.targetPrice.toFixed(2)}\n` +
            `• Qty: ${qty} | Confidence: ${(signal.confidence * 100).toFixed(0)}%\n` +
            `• Reason: ${signal.reason}`
          );
          return prev + 1;
        });
      }
      return buf;
    });
  }, [config]);

  // Start/stop bot
  const handleStart = () => {
    if (isRunning) return;
    setIsRunning(true);
    setPriceBuffer([]);
    setPriceHistory([]);
    openTradeRef.current = null;
    toast.success(`Bot started in ${config.mode.toUpperCase()} mode — scanning every 5 seconds`);
    intervalRef.current = setInterval(() => {
      simulatePrice();
      botTick();
    }, 5000);
    simulatePrice();
  };

  const handleStop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setIsRunning(false);
    toast.info("Bot stopped.");
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  // Stats
  const closedTrades = trades.filter(t => t.status === "closed");
  const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(0) : "—";
  const totalPnl = closedTrades.reduce((a, t) => a + (t.pnl ?? 0), 0);

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white flex">
      {/* Morning Reminder Banner */}
      {showReminder && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-amber-500 text-black text-sm font-medium shadow-lg">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 shrink-0" />
            <span>
              <strong>Good morning!</strong> Market opens soon — remember to{" "}
              <button
                onClick={() => navigate("/settings")}
                className="underline font-bold hover:opacity-80"
              >
                refresh your Access Token
              </button>{" "}
              in Settings before switching to Live mode.
            </span>
          </div>
          <button
            onClick={dismissReminder}
            className="shrink-0 p-1 hover:bg-black/10 rounded-full transition-colors"
            title="Dismiss for today"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 flex flex-col p-4 gap-2 shrink-0">
        <div className="flex items-center gap-2 mb-6 px-2">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm">ScalpBot</div>
            <div className="text-xs text-white/40">Upstox Trading</div>
          </div>
        </div>
        {[
          { icon: Activity, label: "Dashboard", path: "/dashboard", active: true },
          { icon: Calculator, label: "Risk Calculator", path: "/risk-calculator", active: false },
          { icon: Settings, label: "Settings", path: "/settings", active: false },
        ].map((item) => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${item.active ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
        <div className="mt-auto px-2 pb-2">
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            {isRunning ? "Bot Running" : "Bot Stopped"}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Trading Dashboard</h1>
            <p className="text-white/50 text-sm">Automated scalping — EMA + VWAP + ADX strategy</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Token Status Indicator */}
            <button
              onClick={() => navigate("/settings")}
              title={tokenStatus === "valid" ? "Access Token: OK — click to manage" : tokenStatus === "missing" ? "No Access Token — click to add" : "Access Token looks incomplete — click to fix"}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                tokenStatus === "valid"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                  : tokenStatus === "missing"
                  ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 animate-pulse"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              {tokenStatus === "valid" ? (
                <><ShieldCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token OK</span></>
              ) : tokenStatus === "missing" ? (
                <><ShieldOff className="w-3.5 h-3.5" /><span className="hidden sm:inline">No Token</span></>
              ) : (
                <><ShieldAlert className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token?</span></>
              )}
            </button>

            <button
              onClick={() => setQrOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-teal-500/15 border border-teal-500/30 text-teal-400 hover:bg-teal-500/25 transition-all"
              title="Get on Phone / Share"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
              <span className="hidden sm:inline">Get on Phone</span>
            </button>
            <Badge variant="outline" className={`border-none text-sm px-3 py-1 ${config.mode === "paper" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
              {config.mode === "paper" ? "Paper Trade" : "⚠ Live Trade"}
            </Badge>
          </div>
        </div>

        {/* Token missing warning (outside morning hours) */}
        {tokenStatus !== "valid" && config.mode === "live" && !showReminder && (
          <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            <ShieldOff className="w-4 h-4 shrink-0" />
            <span>
              <strong>Live mode requires an Access Token.</strong>{" "}
              <button onClick={() => navigate("/settings")} className="underline hover:opacity-80">
                Go to Settings to add it
              </button>{" "}
              — or switch to Paper mode to trade without a token.
            </span>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Live Price", value: currentPrice > 0 ? `₹${currentPrice.toFixed(2)}` : "—", icon: TrendingUp, color: "teal" },
            { label: "Daily P&L", value: `₹${dailyPnl.toFixed(0)}`, icon: DollarSign, color: dailyPnl >= 0 ? "emerald" : "red" },
            { label: "Trades Today", value: `${todayTrades} / ${config.maxTradesPerDay}`, icon: Activity, color: "blue" },
            { label: "Win Rate", value: winRate === "—" ? "—" : `${winRate}%`, icon: CheckCircle, color: "purple" },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/50 text-xs">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.color === "teal" ? "text-teal-400" : s.color === "emerald" ? "text-emerald-400" : s.color === "red" ? "text-red-400" : s.color === "blue" ? "text-blue-400" : "text-purple-400"}`} />
              </div>
              <div className={`text-xl font-bold ${s.color === "red" ? "text-red-400" : s.color === "emerald" ? "text-emerald-400" : "text-white"}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Signal + Chart Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
          {/* Signal Card */}
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Latest Signal</div>
            {!latestSignal ? (
              <div className="text-white/30 text-sm">Start the bot to see signals</div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  {latestSignal.direction === "BUY" ? <TrendingUp className="w-8 h-8 text-emerald-400" /> : latestSignal.direction === "SELL" ? <TrendingDown className="w-8 h-8 text-red-400" /> : <Minus className="w-8 h-8 text-white/40" />}
                  <div>
                    <div className={`text-2xl font-black ${latestSignal.direction === "BUY" ? "text-emerald-400" : latestSignal.direction === "SELL" ? "text-red-400" : "text-white/40"}`}>{latestSignal.direction}</div>
                    <div className="text-xs text-white/40">Confidence: {(latestSignal.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-white/50">Entry</span><span className="text-white font-mono">₹{latestSignal.entryPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Stop Loss</span><span className="text-red-400 font-mono">₹{latestSignal.slPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Target</span><span className="text-emerald-400 font-mono">₹{latestSignal.targetPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">ATR</span><span className="text-white/70 font-mono">₹{latestSignal.atr.toFixed(2)}</span></div>
                </div>
                <div className="mt-3 text-xs text-white/30 leading-relaxed">{latestSignal.reason}</div>
              </div>
            )}
          </div>

          {/* Price Chart */}
          <div className="lg:col-span-3 bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Price Feed — {config.instrumentSymbol}</div>
            {priceHistory.length < 2 ? (
              <div className="flex items-center justify-center h-32 text-white/30 text-sm">Start bot to see live price chart</div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={priceHistory}>
                  <XAxis dataKey="time" tick={{ fill: "#ffffff30", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "#ffffff30", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v}`} width={70} />
                  <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #ffffff20", borderRadius: 8, color: "#fff", fontSize: 12 }} formatter={(v: number) => [`₹${v.toFixed(2)}`, "Price"]} />
                  <Line type="monotone" dataKey="price" stroke="#14b8a6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bot Configuration + Risk Settings */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-teal-400" />
              <span className="font-semibold text-white">Bot Configuration & Risk Settings</span>
              {isRunning && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Running</span>}
            </div>
            <div className="flex gap-2">
              {!isRunning ? (
                <Button className="bg-teal-500 hover:bg-teal-600 text-white px-5" onClick={handleStart}>
                  <Play className="w-4 h-4 mr-2" /> Start Bot
                </Button>
              ) : (
                <Button className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-5" onClick={handleStop}>
                  <Square className="w-4 h-4 mr-2" /> Stop Bot
                </Button>
              )}
            </div>
          </div>

          {/* Row 1: Instrument + Mode + Capital */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Instrument</label>
              <select value={config.instrumentToken} onChange={(e) => { const inst = INSTRUMENTS.find(i => i.token === e.target.value)!; setConfig(c => ({ ...c, instrumentToken: inst.token, instrumentSymbol: inst.symbol })); }} disabled={isRunning} className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50">
                {Array.from(new Set(INSTRUMENTS.map(i => i.segment))).map(seg => (
                  <optgroup key={seg} label={seg} className="bg-gray-900 text-white/50">
                    {INSTRUMENTS.filter(i => i.segment === seg).map(i => (
                      <option key={i.token} value={i.token} className="bg-gray-900">{i.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Trading Mode</label>
              <div className="flex rounded-lg overflow-hidden border border-white/20 h-[42px]">
                <button onClick={() => setConfig(c => ({ ...c, mode: "paper" }))} disabled={isRunning} className={`flex-1 text-sm font-medium transition-colors ${config.mode === "paper" ? "bg-amber-500/30 text-amber-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Paper</button>
                <button onClick={() => setConfig(c => ({ ...c, mode: "live" }))} disabled={isRunning} className={`flex-1 text-sm font-medium transition-colors ${config.mode === "live" ? "bg-red-500/30 text-red-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Live</button>
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Capital (₹)</label>
              <input type="number" value={config.capital} onChange={(e) => setConfig(c => ({ ...c, capital: Number(e.target.value) }))} disabled={isRunning} className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50" />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/10 mb-5" />
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">Risk & Stop-Loss Parameters</span>
            <span className="text-xs text-white/40 ml-1">(saved automatically)</span>
          </div>

          {/* Sliders Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">

            {/* Risk per Trade */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Risk per Trade</label>
                <span className="text-sm font-bold text-teal-400">{config.riskPerTradePct.toFixed(1)}%</span>
              </div>
              <input type="range" min="0.1" max="5" step="0.1" value={config.riskPerTradePct} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, riskPerTradePct: Number(e.target.value) }))}
                className="w-full accent-teal-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>0.1%</span><span className="text-white/50">Recommended: 1%</span><span>5%</span></div>
            </div>

            {/* Stop-Loss Multiplier */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Stop-Loss (ATR ×)</label>
                <span className="text-sm font-bold text-red-400">{config.stopLossMultiplier.toFixed(1)}×</span>
              </div>
              <input type="range" min="0.5" max="4" step="0.1" value={config.stopLossMultiplier} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, stopLossMultiplier: Number(e.target.value) }))}
                className="w-full accent-red-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>0.5× (tight)</span><span className="text-white/50">Recommended: 1.5×</span><span>4× (wide)</span></div>
            </div>

            {/* Target Multiplier */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Target (ATR ×)</label>
                <span className="text-sm font-bold text-emerald-400">{config.targetMultiplier.toFixed(1)}×</span>
              </div>
              <input type="range" min="1" max="8" step="0.1" value={config.targetMultiplier} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, targetMultiplier: Number(e.target.value) }))}
                className="w-full accent-emerald-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>1× (low)</span><span className="text-white/50">R:R = {(config.targetMultiplier / config.stopLossMultiplier).toFixed(1)}:1</span><span>8× (high)</span></div>
            </div>

            {/* Daily Loss Limit */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Daily Loss Limit</label>
                <span className="text-sm font-bold text-amber-400">{config.dailyLossLimitPct.toFixed(1)}% = ₹{(config.capital * config.dailyLossLimitPct / 100).toFixed(0)}</span>
              </div>
              <input type="range" min="0.5" max="10" step="0.5" value={config.dailyLossLimitPct} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, dailyLossLimitPct: Number(e.target.value) }))}
                className="w-full accent-amber-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>0.5%</span><span className="text-white/50">Bot stops at this loss</span><span>10%</span></div>
            </div>

            {/* Min Signal Confidence */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Min Signal Confidence</label>
                <span className="text-sm font-bold text-purple-400">{config.minConfidence}%</span>
              </div>
              <input type="range" min="40" max="95" step="5" value={config.minConfidence} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, minConfidence: Number(e.target.value) }))}
                className="w-full accent-purple-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>40% (more trades)</span><span className="text-white/50">Recommended: 60%</span><span>95% (fewer)</span></div>
            </div>

            {/* Scan Interval */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Scan Interval</label>
                <span className="text-sm font-bold text-blue-400">{config.scanIntervalSec}s</span>
              </div>
              <input type="range" min="15" max="300" step="15" value={config.scanIntervalSec} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, scanIntervalSec: Number(e.target.value) }))}
                className="w-full accent-blue-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>15s (fast)</span><span className="text-white/50">Recommended: 60s</span><span>5min (slow)</span></div>
            </div>

          </div>

          {/* Trailing SL Toggle */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => !isRunning && setConfig(c => ({ ...c, trailingSlEnabled: !c.trailingSlEnabled }))}
                disabled={isRunning}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                  config.trailingSlEnabled ? "bg-teal-500" : "bg-white/20"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                  config.trailingSlEnabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
              <div>
                <div className="text-sm font-medium text-white">Trailing Stop-Loss</div>
                <div className="text-xs text-white/40">Locks in profit as price moves in your favour</div>
              </div>
            </div>
            {config.trailingSlEnabled && (
              <div className="flex items-center gap-4 min-w-[220px]">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-white/60">Trail Distance</label>
                    <span className="text-sm font-bold text-teal-400">{config.trailingSlPct.toFixed(1)}%</span>
                  </div>
                  <input type="range" min="0.1" max="3" step="0.1" value={config.trailingSlPct} disabled={isRunning}
                    onChange={(e) => setConfig(c => ({ ...c, trailingSlPct: Number(e.target.value) }))}
                    className="w-full accent-teal-500 disabled:opacity-50" />
                </div>
              </div>
            )}
          </div>

          {/* Max Trades per Day */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Max Trades per Day</label>
                <span className="text-sm font-bold text-white">{config.maxTradesPerDay}</span>
              </div>
              <input type="range" min="1" max="20" step="1" value={config.maxTradesPerDay} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, maxTradesPerDay: Number(e.target.value) }))}
                className="w-full accent-white/60 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>1</span><span className="text-white/50">Recommended: 5</span><span>20</span></div>
            </div>
          </div>

          {config.mode === "live" && (
            <div className="mt-4 flex items-start gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Live mode requires your Upstox access token. Go to <button className="underline" onClick={() => navigate("/settings")}>Settings</button> to add it. Always test in Paper mode first.</span>
            </div>
          )}
        </div>

        {/* Trade Log */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-teal-400" />
              <span className="font-semibold text-white">Trade Log</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-white/40">Total: <span className="text-white">{closedTrades.length}</span></span>
              <span className="text-emerald-400">Wins: {wins}</span>
              <span className="text-red-400">Losses: {closedTrades.length - wins}</span>
              <span className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>P&L: ₹{totalPnl.toFixed(0)}</span>
              <button
                onClick={() => {
                  if (trades.length === 0) { toast.info("No trades to export."); return; }
                  const headers = ["Date", "Symbol", "Direction", "Mode", "Entry Price", "Exit Price", "Quantity", "P&L (INR)", "Status", "Exit Reason"];
                  const rows = trades.map(t => [
                    new Date(t.enteredAt).toLocaleString("en-IN"),
                    t.symbol,
                    t.direction,
                    t.mode,
                    t.entryPrice.toFixed(2),
                    t.exitPrice ? t.exitPrice.toFixed(2) : "",
                    t.quantity,
                    t.pnl !== undefined ? t.pnl.toFixed(2) : "",
                    t.status,
                    t.exitReason ?? "",
                  ]);
                  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `scalpbot_trades_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Exported ${trades.length} trades to CSV`);
                }}
                className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Download trade history as CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button onClick={() => { setTrades([]); openTradeRef.current = null; toast.info("Trade log cleared"); }} className="text-white/30 hover:text-white/60 transition-colors" title="Clear trade log">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10">
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-left py-2 pr-4">Direction</th>
                  <th className="text-left py-2 pr-4">Mode</th>
                  <th className="text-right py-2 pr-4">Entry</th>
                  <th className="text-right py-2 pr-4">Exit</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2 pr-4">P&L</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-white/30 py-8">No trades yet. Start the bot to begin.</td></tr>
                ) : (
                  trades.slice(0, 20).map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-white">{t.symbol}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`flex items-center gap-1 ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                          {t.direction === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4"><span className={`text-xs px-2 py-0.5 rounded-full ${t.mode === "paper" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>{t.mode}</span></td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/80">₹{t.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/60">{t.exitPrice ? `₹${t.exitPrice.toFixed(2)}` : "—"}</td>
                      <td className="py-2.5 pr-4 text-right text-white/60">{t.quantity}</td>
                      <td className={`py-2.5 pr-4 text-right font-mono font-semibold ${(t.pnl ?? 0) > 0 ? "text-emerald-400" : (t.pnl ?? 0) < 0 ? "text-red-400" : "text-white/40"}`}>
                        {t.pnl !== undefined ? `${t.pnl > 0 ? "+" : ""}₹${t.pnl.toFixed(0)}` : "—"}
                      </td>
                      <td className="py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === "open" ? "bg-blue-500/20 text-blue-400" : (t.pnl ?? 0) > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {t.status === "open" ? "Open" : t.exitReason ?? "Closed"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* QR Modal */}
      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
}
