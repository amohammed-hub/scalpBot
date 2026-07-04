import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import QRModal from "@/components/QRModal";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, Calculator, RefreshCw
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
}

interface PricePoint { time: string; price: number; }

// ── Constants ─────────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  { token: "NSE_EQ|INE009A01021", symbol: "RELIANCE", label: "Reliance Industries" },
  { token: "NSE_INDEX|Nifty 50", symbol: "NIFTY", label: "Nifty 50 Index" },
  { token: "NSE_INDEX|Nifty Bank", symbol: "BANKNIFTY", label: "Bank Nifty" },
  { token: "NSE_EQ|INE467B01029", symbol: "TCS", label: "TCS" },
  { token: "NSE_EQ|INE009B01011", symbol: "INFY", label: "Infosys" },
  { token: "NSE_EQ|INE040A01034", symbol: "HDFC", label: "HDFC Bank" },
];

const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2950, NIFTY: 24800, BANKNIFTY: 53200, TCS: 3780, INFY: 1620, HDFC: 1740,
};

const LS_TRADES = "scalpbot_trades";
const LS_CONFIG = "scalpbot_config";

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
    try { return JSON.parse(localStorage.getItem(LS_CONFIG) ?? "null") ?? { instrumentToken: INSTRUMENTS[0].token, instrumentSymbol: INSTRUMENTS[0].symbol, mode: "paper", capital: 100000, riskPerTradePct: 1.0, maxTradesPerDay: 5 }; } catch { return { instrumentToken: INSTRUMENTS[0].token, instrumentSymbol: INSTRUMENTS[0].symbol, mode: "paper", capital: 100000, riskPerTradePct: 1.0, maxTradesPerDay: 5 }; }
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

        {/* Bot Configuration */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Bot className="w-5 h-5 text-teal-400" />
            <span className="font-semibold text-white">Bot Configuration</span>
            {isRunning && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Running</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
            <div className="col-span-2">
              <label className="text-xs text-white/50 mb-1.5 block">Instrument</label>
              <select
                value={config.instrumentToken}
                onChange={(e) => { const inst = INSTRUMENTS.find(i => i.token === e.target.value)!; setConfig(c => ({ ...c, instrumentToken: inst.token, instrumentSymbol: inst.symbol })); }}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              >
                {INSTRUMENTS.map(i => <option key={i.token} value={i.token} className="bg-gray-900">{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Mode</label>
              <div className="flex rounded-lg overflow-hidden border border-white/20">
                <button onClick={() => setConfig(c => ({ ...c, mode: "paper" }))} disabled={isRunning} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${config.mode === "paper" ? "bg-amber-500/30 text-amber-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Paper</button>
                <button onClick={() => setConfig(c => ({ ...c, mode: "live" }))} disabled={isRunning} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${config.mode === "live" ? "bg-red-500/30 text-red-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Live</button>
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Capital (₹)</label>
              <input type="number" value={config.capital} onChange={(e) => setConfig(c => ({ ...c, capital: Number(e.target.value) }))} disabled={isRunning} className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50" />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Risk / Trade (%)</label>
              <input type="number" step="0.1" value={config.riskPerTradePct} onChange={(e) => setConfig(c => ({ ...c, riskPerTradePct: Number(e.target.value) }))} disabled={isRunning} className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50" />
            </div>
            <div>
              {!isRunning ? (
                <Button className="w-full bg-teal-500 hover:bg-teal-600 text-white py-2.5" onClick={handleStart}>
                  <Play className="w-4 h-4 mr-2" /> Start Bot
                </Button>
              ) : (
                <Button className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 py-2.5" onClick={handleStop}>
                  <Square className="w-4 h-4 mr-2" /> Stop Bot
                </Button>
              )}
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
              <button onClick={() => { setTrades([]); openTradeRef.current = null; toast.info("Trade log cleared"); }} className="text-white/30 hover:text-white/60 transition-colors">
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
