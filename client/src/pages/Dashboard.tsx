import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import QRModal from "@/components/QRModal";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, Calculator, RefreshCw, Bell, X, ShieldCheck, ShieldAlert, ShieldOff,
  Download, QrCode, LogOut
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";

// ── Session Token ─────────────────────────────────────────────────────────────
// A UUID stored in localStorage — no Manus login needed. Used as the user identity key.
const LS_SESSION = "scalpbot_session";
const LS_CONFIG  = "scalpbot_config";
const LS_TELEGRAM = "scalpbot_telegram";

function getSessionToken(): string {
  let token = localStorage.getItem(LS_SESSION);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(LS_SESSION, token);
  }
  return token;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface BotConfig {
  instrumentToken: string;
  instrumentSymbol: string;
  instrumentLabel: string;
  mode: "paper" | "live";
  capital: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  stopLossMultiplier: number;
  targetMultiplier: number;
  dailyLossLimitPct: number;
  trailingSlEnabled: boolean;
  trailingSlPct: number;
  minConfidence: number;
  scanIntervalSec: number;
}

interface PricePoint { time: string; price: number; }

// ── Instruments ───────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  // NSE Indices (spot)
  { token: "NSE_INDEX|Nifty 50",           symbol: "NIFTY",         label: "Nifty 50 (Spot)",              segment: "NSE Index" },
  { token: "NSE_INDEX|Nifty Bank",         symbol: "BANKNIFTY",     label: "Bank Nifty (Spot)",            segment: "NSE Index" },
  { token: "NSE_INDEX|Nifty Fin Service",  symbol: "FINNIFTY",      label: "Fin Nifty (Spot)",             segment: "NSE Index" },
  { token: "NSE_INDEX|MIDCPNIFTY",         symbol: "MIDCPNIFTY",    label: "Midcap Nifty (Spot)",          segment: "NSE Index" },
  // NSE F&O Options
  { token: "NFO_OPT|NIFTY10JUL202624800CE",  symbol: "NIFTY_CE",      label: "Nifty 24800 CE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202624800PE",  symbol: "NIFTY_PE",      label: "Nifty 24800 PE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202625000CE",  symbol: "NIFTY_25000CE", label: "Nifty 25000 CE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|NIFTY10JUL202625000PE",  symbol: "NIFTY_25000PE", label: "Nifty 25000 PE (10 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653000CE", symbol: "BNF_CE",     label: "BankNifty 53000 CE (9 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653000PE", symbol: "BNF_PE",     label: "BankNifty 53000 PE (9 Jul)",  segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500CE", symbol: "BNF_53500CE", label: "BankNifty 53500 CE (9 Jul)", segment: "NSE F&O Options" },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500PE", symbol: "BNF_53500PE", label: "BankNifty 53500 PE (9 Jul)", segment: "NSE F&O Options" },
  // NSE F&O Futures
  { token: "NFO_FUT|NIFTY30JUL2026FUT",        symbol: "NIFTY_FUT",   label: "Nifty Jul 2026 Futures",      segment: "NSE F&O Futures" },
  { token: "NFO_FUT|BANKNIFTY30JUL2026FUT",    symbol: "BNF_FUT",     label: "BankNifty Jul 2026 Futures",  segment: "NSE F&O Futures" },
  // MCX Commodities
  { token: "MCX_FO|552720", symbol: "MCX_GOLD",     label: "Gold (GOLDGUINEA FUT 31 Jul)",    segment: "MCX Commodities" },
  { token: "MCX_FO|574822", symbol: "MCX_SILVER",   label: "Silver (SILVER100 FUT 31 Jul)",   segment: "MCX Commodities" },
  { token: "MCX_FO|520703", symbol: "MCX_CRUDE",    label: "Crude Oil (CRUDEOILM FUT 20 Jul)",segment: "MCX Commodities" },
  { token: "MCX_FO|538686", symbol: "MCX_NATGAS",   label: "Natural Gas Mini (28 Jul)",        segment: "MCX Commodities" },
  { token: "MCX_FO|562048", symbol: "MCX_COPPER",   label: "Copper (FUT 31 Jul)",              segment: "MCX Commodities" },
  { token: "MCX_FO|562054", symbol: "MCX_ZINC",     label: "Zinc Mini (FUT 31 Jul)",           segment: "MCX Commodities" },
  { token: "MCX_FO|562047", symbol: "MCX_ALUM",     label: "Aluminium (FUT 31 Jul)",           segment: "MCX Commodities" },
  { token: "MCX_FO|562050", symbol: "MCX_LEAD",     label: "Lead Mini (FUT 31 Jul)",           segment: "MCX Commodities" },
  { token: "MCX_FO|562051", symbol: "MCX_NICKEL",   label: "Nickel (FUT 15 Jul)",              segment: "MCX Commodities" },
  // NSE Equity
  { token: "NSE_EQ|INE009A01021", symbol: "RELIANCE",  label: "Reliance Industries", segment: "NSE Equity" },
  { token: "NSE_EQ|INE467B01029", symbol: "TCS",        label: "TCS",                segment: "NSE Equity" },
  { token: "NSE_EQ|INE009B01011", symbol: "INFY",       label: "Infosys",            segment: "NSE Equity" },
  { token: "NSE_EQ|INE040A01034", symbol: "HDFC",       label: "HDFC Bank",          segment: "NSE Equity" },
  { token: "NSE_EQ|INE030A01027", symbol: "ITC",        label: "ITC",                segment: "NSE Equity" },
  { token: "NSE_EQ|INE585B01010", symbol: "SBIN",       label: "SBI",                segment: "NSE Equity" },
  { token: "NSE_EQ|INE062A01020", symbol: "TATAMOTORS", label: "Tata Motors",        segment: "NSE Equity" },
  // BSE
  { token: "BSE_INDEX|SENSEX", symbol: "SENSEX", label: "Sensex", segment: "BSE Index" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMorningWindow(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600000 + now.getTimezoneOffset() * 60000);
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 540 && mins <= 630;
}

function todayDismissKey(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600000 + now.getTimezoneOffset() * 60000);
  return `scalpbot_reminder_${ist.getFullYear()}_${ist.getMonth()}_${ist.getDate()}`;
}

async function fireTelegramAlert(text: string): Promise<void> {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "null");
    if (!cfg?.enabled || !cfg?.botToken || !cfg?.chatId) return;
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML" }),
    });
  } catch { /* silent */ }
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, navigate] = useLocation();
  const [qrOpen, setQrOpen] = useState(false);
  const sessionToken = getSessionToken();

  // Config — persisted in localStorage (not sensitive, just UI preferences)
  const [config, setConfig] = useState<BotConfig>(() => {
    const defaults: BotConfig = {
      instrumentToken: INSTRUMENTS[0].token,
      instrumentSymbol: INSTRUMENTS[0].symbol,
      instrumentLabel: INSTRUMENTS[0].label,
      mode: "paper",
      capital: 100000,
      riskPerTradePct: 1.0,
      maxTradesPerDay: 5,
      stopLossMultiplier: 1.5,
      targetMultiplier: 3.0,
      dailyLossLimitPct: 3.0,
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      minConfidence: 60,
      scanIntervalSec: 60,
    };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_CONFIG) ?? "null") }; }
    catch { return defaults; }
  });
  useEffect(() => { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }, [config]);

  // Morning reminder
  const [showReminder, setShowReminder] = useState(false);
  useEffect(() => {
    const check = () => setShowReminder(isMorningWindow() && !localStorage.getItem(todayDismissKey()));
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // Price chart state (client-side only — visual only)
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);

  // ── tRPC queries ─────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();

  // Bot status — poll every 3s when running
  const { data: botStatus } = trpc.bot.status.useQuery(
    { sessionToken },
    { refetchInterval: 3000, staleTime: 1000 }
  );

  // Live data — poll every 3s
  const { data: liveData } = trpc.bot.liveData.useQuery(
    { sessionToken },
    { refetchInterval: 3000, staleTime: 1000 }
  );

  // Trades list — poll every 5s
  const { data: trades = [], refetch: refetchTrades } = trpc.trades.list.useQuery(
    { sessionToken, limit: 50 },
    { refetchInterval: 5000, staleTime: 2000 }
  );

  // Today stats
  const { data: todayStats } = trpc.trades.todayStats.useQuery(
    { sessionToken },
    { refetchInterval: 5000, staleTime: 2000 }
  );

  // All-time stats
  const { data: allStats } = trpc.trades.stats.useQuery(
    { sessionToken },
    { refetchInterval: 10000, staleTime: 5000 }
  );

  // Open trade from DB
  const { data: openTrade } = trpc.trades.openTrade.useQuery(
    { sessionToken },
    { refetchInterval: 3000, staleTime: 1000 }
  );

  // ── Mutations ────────────────────────────────────────────────────────────────
  const startMutation = trpc.bot.start.useMutation({
    onSuccess: () => {
      toast.success(`Bot started in ${config.mode.toUpperCase()} mode — scanning every ${config.scanIntervalSec}s`);
      utils.bot.status.invalidate();
      utils.bot.liveData.invalidate();
    },
    onError: (e) => toast.error(`Failed to start bot: ${e.message}`),
  });

  const stopMutation = trpc.bot.stop.useMutation({
    onSuccess: () => {
      toast.info("Bot stopped.");
      utils.bot.status.invalidate();
    },
    onError: (e) => toast.error(`Failed to stop bot: ${e.message}`),
  });

  const manualExitMutation = trpc.bot.manualExit.useMutation({
    onSuccess: (data) => {
      const pnl = data.pnl;
      toast[pnl >= 0 ? "success" : "error"](`Trade closed manually: ${pnl >= 0 ? "+" : ""}₹${pnl.toFixed(0)}`);
      utils.trades.list.invalidate();
      utils.trades.openTrade.invalidate();
      utils.trades.todayStats.invalidate();
      utils.bot.liveData.invalidate();
    },
    onError: (e) => toast.error(`Exit failed: ${e.message}`),
  });

  // ── Derived state ─────────────────────────────────────────────────────────────
  const isRunning = botStatus?.status === "running";
  const currentPrice = liveData?.price ?? botStatus?.lastPrice ?? 0;
  const bidPrice = liveData?.bid ?? botStatus?.bidPrice ?? 0;
  const askPrice = liveData?.ask ?? botStatus?.askPrice ?? 0;
  const latestSignal = liveData?.signal ?? null;
  const inMemOpenTrade = liveData?.openTrade ?? null;
  const nextScanAt = liveData?.nextScanAt ?? 0;

  // Countdown to next scan
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (!isRunning || !nextScanAt) { setCountdown(0); return; }
    const tick = () => {
      const secs = Math.max(0, Math.round((nextScanAt - Date.now()) / 1000));
      setCountdown(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, nextScanAt]);

  // Update price chart from live data
  useEffect(() => {
    if (currentPrice > 0 && isRunning) {
      const now = new Date();
      const label = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setPriceHistory(h => [...h.slice(-59), { time: label, price: parseFloat(currentPrice.toFixed(2)) }]);
    }
  }, [currentPrice, isRunning]);

  // Token status check
  const [tokenStatus, setTokenStatus] = useState<"valid" | "missing" | "short">(() => {
    try {
      const creds = JSON.parse(localStorage.getItem("scalpbot_credentials") ?? "null");
      if (!creds?.accessToken) return "missing";
      if (creds.accessToken.length < 100) return "short";
      return "valid";
    } catch { return "missing"; }
  });
  useEffect(() => {
    const check = () => {
      try {
        const creds = JSON.parse(localStorage.getItem("scalpbot_credentials") ?? "null");
        if (!creds?.accessToken) setTokenStatus("missing");
        else if (creds.accessToken.length < 100) setTokenStatus("short");
        else setTokenStatus("valid");
      } catch { setTokenStatus("missing"); }
    };
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleStart = () => {
    startMutation.mutate({
      sessionToken,
      instrumentToken: config.instrumentToken,
      instrumentSymbol: config.instrumentSymbol,
      instrumentLabel: config.instrumentLabel,
      mode: config.mode,
      capital: config.capital,
      riskPerTradePct: config.riskPerTradePct,
      maxTradesPerDay: config.maxTradesPerDay,
      dailyLossLimitPct: config.dailyLossLimitPct,
      stopLossMultiplier: config.stopLossMultiplier,
      targetMultiplier: config.targetMultiplier,
      trailingSlEnabled: config.trailingSlEnabled,
      trailingSlPct: config.trailingSlPct,
      minConfidence: config.minConfidence,
      scanIntervalSec: config.scanIntervalSec,
    });
  };

  const handleStop = () => stopMutation.mutate({ sessionToken });

  const handleManualExit = () => {
    const trade = openTrade ?? (inMemOpenTrade ? { id: inMemOpenTrade.dbId, entryPrice: inMemOpenTrade.entryPrice, direction: inMemOpenTrade.direction, quantity: inMemOpenTrade.quantity } : null);
    if (!trade || !trade.id) { toast.error("No open trade to exit."); return; }
    if (!currentPrice) { toast.error("No current price available."); return; }
    manualExitMutation.mutate({ sessionToken, tradeId: trade.id, exitPrice: currentPrice });
  };

  // ── Open trade panel helpers ──────────────────────────────────────────────────
  const activeTrade = openTrade ?? (inMemOpenTrade ? {
    id: inMemOpenTrade.dbId,
    symbolLabel: inMemOpenTrade.symbolLabel,
    direction: inMemOpenTrade.direction,
    entryPrice: inMemOpenTrade.entryPrice,
    quantity: inMemOpenTrade.quantity,
    slPrice: inMemOpenTrade.slPrice,
    targetPrice: inMemOpenTrade.targetPrice,
    confidence: inMemOpenTrade.confidence,
    mode: inMemOpenTrade.mode,
  } : null);

  const unrealizedPnl = activeTrade && currentPrice
    ? activeTrade.direction === "BUY"
      ? (currentPrice - activeTrade.entryPrice) * activeTrade.quantity
      : (activeTrade.entryPrice - currentPrice) * activeTrade.quantity
    : null;

  const progressPct = activeTrade && currentPrice
    ? (() => {
        const sl = activeTrade.slPrice ?? 0;
        const tgt = activeTrade.targetPrice ?? 0;
        if (!sl || !tgt || sl === tgt) return 50;
        const range = Math.abs(tgt - sl);
        const pos = activeTrade.direction === "BUY"
          ? currentPrice - sl
          : sl - currentPrice;
        return Math.max(0, Math.min(100, (pos / range) * 100));
      })()
    : null;

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const todayTradesCount = todayStats?.todayTrades ?? 0;
  const todayPnl = todayStats?.todayPnl ?? 0;
  const winRate = allStats && allStats.totalTrades > 0 ? `${allStats.winRate.toFixed(0)}%` : "—";
  const totalPnl = allStats?.totalPnl ?? 0;

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white flex">
      {/* Morning Reminder Banner */}
      {showReminder && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-amber-500 text-black text-sm font-medium shadow-lg">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 shrink-0" />
            <span>
              <strong>Good morning!</strong> Market opens soon — remember to{" "}
              <button onClick={() => navigate("/settings")} className="underline font-bold hover:opacity-80">
                refresh your Access Token
              </button>{" "}
              in Settings before switching to Live mode.
            </span>
          </div>
          <button onClick={() => { localStorage.setItem(todayDismissKey(), "1"); setShowReminder(false); }}
            className="shrink-0 p-1 hover:bg-black/10 rounded-full transition-colors">
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
        <div className="mt-auto px-2 pb-2 space-y-2">
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            {isRunning ? "Bot Running" : "Bot Stopped"}
          </div>
          {isRunning && countdown > 0 && (
            <div className="text-xs text-white/30 px-3">Next scan in {countdown}s</div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Trading Dashboard</h1>
            <p className="text-white/50 text-sm">Automated scalping — Candle breakout + EMA + VWAP + RSI</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/settings")}
              title={tokenStatus === "valid" ? "Access Token: OK" : tokenStatus === "missing" ? "No Access Token" : "Token looks incomplete"}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                tokenStatus === "valid" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                : tokenStatus === "missing" ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 animate-pulse"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
              }`}>
              {tokenStatus === "valid" ? <><ShieldCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token OK</span></>
               : tokenStatus === "missing" ? <><ShieldOff className="w-3.5 h-3.5" /><span className="hidden sm:inline">No Token</span></>
               : <><ShieldAlert className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token?</span></>}
            </button>
            <button onClick={() => setQrOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-teal-500/15 border border-teal-500/30 text-teal-400 hover:bg-teal-500/25 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
              <span className="hidden sm:inline">Get on Phone</span>
            </button>
            <Badge variant="outline" className={`border-none text-sm px-3 py-1 ${config.mode === "paper" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
              {config.mode === "paper" ? "Paper Trade" : "⚠ Live Trade"}
            </Badge>
          </div>
        </div>

        {/* Token warning */}
        {tokenStatus !== "valid" && config.mode === "live" && !showReminder && (
          <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            <ShieldOff className="w-4 h-4 shrink-0" />
            <span><strong>Live mode requires an Access Token.</strong>{" "}
              <button onClick={() => navigate("/settings")} className="underline hover:opacity-80">Go to Settings to add it</button>
              {" "}— or switch to Paper mode.
            </span>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Live Price", value: currentPrice > 0 ? `₹${currentPrice.toFixed(2)}` : "—", sub: bidPrice > 0 ? `B:₹${bidPrice.toFixed(0)} A:₹${askPrice.toFixed(0)}` : null, icon: TrendingUp, color: "teal" },
            { label: "Today P&L", value: `${todayPnl >= 0 ? "+" : ""}₹${todayPnl.toFixed(0)}`, sub: unrealizedPnl !== null ? `Unrealized: ${unrealizedPnl >= 0 ? "+" : ""}₹${unrealizedPnl.toFixed(0)}` : null, icon: DollarSign, color: todayPnl >= 0 ? "emerald" : "red" },
            { label: "Trades Today", value: `${todayTradesCount} / ${config.maxTradesPerDay}`, sub: null, icon: Activity, color: "blue" },
            { label: "Win Rate", value: winRate, sub: allStats ? `${allStats.wins}W / ${allStats.losses}L` : null, icon: CheckCircle, color: "purple" },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/50 text-xs">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.color === "teal" ? "text-teal-400" : s.color === "emerald" ? "text-emerald-400" : s.color === "red" ? "text-red-400" : s.color === "blue" ? "text-blue-400" : "text-purple-400"}`} />
              </div>
              <div className={`text-xl font-bold ${s.color === "red" ? "text-red-400" : s.color === "emerald" ? "text-emerald-400" : "text-white"}`}>{s.value}</div>
              {s.sub && <div className="text-xs text-white/30 mt-0.5">{s.sub}</div>}
            </div>
          ))}
        </div>

        {/* Signal + Chart Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
          {/* Signal Card */}
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Latest Signal</div>
            {!latestSignal || latestSignal.direction === "HOLD" ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Minus className="w-6 h-6 text-white/30" />
                  <span className="text-white/30 text-lg font-bold">HOLD</span>
                </div>
                <div className="text-white/30 text-sm">{isRunning ? `Scanning... next in ${countdown}s` : "Start the bot to see signals"}</div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  {latestSignal.direction === "BUY" ? <TrendingUp className="w-8 h-8 text-emerald-400" /> : <TrendingDown className="w-8 h-8 text-red-400" />}
                  <div>
                    <div className={`text-2xl font-black ${latestSignal.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{latestSignal.direction}</div>
                    <div className="text-xs text-white/40">Confidence: {(latestSignal.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-white/50">Entry</span><span className="text-white font-mono">₹{latestSignal.entryPrice?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Stop Loss</span><span className="text-red-400 font-mono">₹{latestSignal.slPrice?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Target</span><span className="text-emerald-400 font-mono">₹{latestSignal.targetPrice?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">ATR</span><span className="text-white/70 font-mono">₹{latestSignal.atr?.toFixed(2)}</span></div>
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

        {/* Open Trade Panel */}
        {activeTrade && (
          <div className="bg-white/5 border border-teal-500/30 rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full animate-pulse ${activeTrade.direction === "BUY" ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="font-semibold text-white">Open Trade</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${activeTrade.direction === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {activeTrade.direction}
                </span>
                <span className="text-xs text-white/40">{activeTrade.symbolLabel ?? ('symbol' in activeTrade ? activeTrade.symbol : null) ?? config.instrumentLabel}</span>
              </div>
              <div className="flex items-center gap-3">
                {unrealizedPnl !== null && (
                  <span className={`text-lg font-bold ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {unrealizedPnl >= 0 ? "+" : ""}₹{unrealizedPnl.toFixed(0)}
                  </span>
                )}
                <button
                  onClick={handleManualExit}
                  disabled={manualExitMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors disabled:opacity-50"
                >
                  <LogOut className="w-4 h-4" />
                  {manualExitMutation.isPending ? "Exiting..." : "Exit Now"}
                </button>
              </div>
            </div>

            {/* Price levels */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: "Entry", value: activeTrade.entryPrice, color: "text-white" },
                { label: "Current", value: currentPrice, color: currentPrice > activeTrade.entryPrice ? "text-emerald-400" : "text-red-400" },
                { label: "Stop Loss", value: activeTrade.slPrice, color: "text-red-400" },
                { label: "Target", value: activeTrade.targetPrice, color: "text-emerald-400" },
              ].map(item => (
                <div key={item.label} className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-xs text-white/40 mb-1">{item.label}</div>
                  <div className={`font-mono font-bold text-sm ${item.color}`}>
                    {item.value ? `₹${item.value.toFixed(2)}` : "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            {progressPct !== null && (
              <div className="mb-3">
                <div className="relative h-3 bg-white/10 rounded-full overflow-hidden">
                  <div className="absolute left-0 top-0 h-full w-1/3 bg-red-500/30 rounded-l-full" />
                  <div className="absolute right-0 top-0 h-full w-1/3 bg-emerald-500/30 rounded-r-full" />
                  <div
                    className="absolute top-0 h-full w-1 bg-white rounded-full shadow-lg transition-all duration-1000"
                    style={{ left: `${progressPct}%`, transform: "translateX(-50%)" }}
                  />
                </div>
                <div className="flex justify-between text-xs text-white/30 mt-1">
                  <span>▼ SL ₹{activeTrade.slPrice ? (currentPrice - activeTrade.slPrice).toFixed(0) : "—"} away</span>
                  <span className="text-white/50">Potential: +₹{activeTrade.targetPrice ? (Math.abs(activeTrade.targetPrice - activeTrade.entryPrice) * activeTrade.quantity).toFixed(0) : "—"}</span>
                  <span>▲ Target ₹{activeTrade.targetPrice ? (activeTrade.targetPrice - currentPrice).toFixed(0) : "—"} away</span>
                </div>
              </div>
            )}

            {/* Trade details row */}
            <div className="flex items-center gap-6 text-xs text-white/40">
              <span>Qty: <span className="text-white">{activeTrade.quantity}</span></span>
              <span>Mode: <span className={activeTrade.mode === "paper" ? "text-amber-400" : "text-red-400"}>{activeTrade.mode}</span></span>
              {activeTrade.confidence && <span>Confidence: <span className="text-teal-400">{(activeTrade.confidence * 100).toFixed(0)}%</span></span>}
              {activeTrade.slPrice && activeTrade.targetPrice && (
                <span>R:R <span className="text-white">{(Math.abs(activeTrade.targetPrice - activeTrade.entryPrice) / Math.abs(activeTrade.slPrice - activeTrade.entryPrice)).toFixed(1)}:1</span></span>
              )}
            </div>
          </div>
        )}

        {/* Bot Configuration */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-teal-400" />
              <span className="font-semibold text-white">Bot Configuration & Risk Settings</span>
              {isRunning && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Running</span>}
            </div>
            <div className="flex gap-2">
              {!isRunning ? (
                <button
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                  className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  {startMutation.isPending ? "Starting..." : "Start Bot"}
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  disabled={stopMutation.isPending}
                  className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Square className="w-4 h-4" />
                  {stopMutation.isPending ? "Stopping..." : "Stop Bot"}
                </button>
              )}
            </div>
          </div>

          {/* Row 1: Instrument + Mode + Capital */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Instrument</label>
              <select
                value={config.instrumentToken}
                onChange={(e) => {
                  const inst = INSTRUMENTS.find(i => i.token === e.target.value);
                  if (inst) setConfig(c => ({ ...c, instrumentToken: inst.token, instrumentSymbol: inst.symbol, instrumentLabel: inst.label }));
                }}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              >
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
                <button onClick={() => setConfig(c => ({ ...c, mode: "paper" }))} disabled={isRunning}
                  className={`flex-1 text-sm font-medium transition-colors ${config.mode === "paper" ? "bg-amber-500/30 text-amber-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Paper</button>
                <button onClick={() => setConfig(c => ({ ...c, mode: "live" }))} disabled={isRunning}
                  className={`flex-1 text-sm font-medium transition-colors ${config.mode === "live" ? "bg-red-500/30 text-red-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Live</button>
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Capital (₹)</label>
              <input type="number" value={config.capital}
                onChange={(e) => setConfig(c => ({ ...c, capital: Number(e.target.value) }))}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50" />
            </div>
          </div>

          <div className="border-t border-white/10 mb-5" />
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">Risk & Stop-Loss Parameters</span>
          </div>

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
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>1×</span><span className="text-white/50">R:R = {(config.targetMultiplier / config.stopLossMultiplier).toFixed(1)}:1</span><span>8×</span></div>
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
            {/* Min Confidence */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-white/60">Min Signal Confidence</label>
                <span className="text-sm font-bold text-purple-400">{config.minConfidence}%</span>
              </div>
              <input type="range" min="40" max="95" step="5" value={config.minConfidence} disabled={isRunning}
                onChange={(e) => setConfig(c => ({ ...c, minConfidence: Number(e.target.value) }))}
                className="w-full accent-purple-500 disabled:opacity-50" />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>40% (more)</span><span className="text-white/50">Recommended: 60%</span><span>95% (fewer)</span></div>
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
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>15s (fast)</span><span className="text-white/50">Recommended: 60s</span><span>5min</span></div>
            </div>
          </div>

          {/* Trailing SL */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => !isRunning && setConfig(c => ({ ...c, trailingSlEnabled: !c.trailingSlEnabled }))}
                disabled={isRunning}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${config.trailingSlEnabled ? "bg-teal-500" : "bg-white/20"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${config.trailingSlEnabled ? "translate-x-5" : "translate-x-0"}`} />
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
          <div className="mt-4">
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs text-white/60">Max Trades per Day</label>
              <span className="text-sm font-bold text-white">{config.maxTradesPerDay}</span>
            </div>
            <input type="range" min="1" max="20" step="1" value={config.maxTradesPerDay} disabled={isRunning}
              onChange={(e) => setConfig(c => ({ ...c, maxTradesPerDay: Number(e.target.value) }))}
              className="w-full accent-white/60 disabled:opacity-50" />
            <div className="flex justify-between text-[10px] text-white/30 mt-0.5"><span>1</span><span className="text-white/50">Recommended: 5</span><span>20</span></div>
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
              <span className="text-white/40">Total: <span className="text-white">{allStats?.totalTrades ?? 0}</span></span>
              <span className="text-emerald-400">Wins: {allStats?.wins ?? 0}</span>
              <span className="text-red-400">Losses: {allStats?.losses ?? 0}</span>
              <span className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>P&L: {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(0)}</span>
              <button
                onClick={() => {
                  if (trades.length === 0) { toast.info("No trades to export."); return; }
                  const headers = ["Date", "Symbol", "Direction", "Mode", "Entry Price", "Exit Price", "Quantity", "P&L (INR)", "Status", "Exit Reason"];
                  const rows = trades.map(t => [
                    new Date(t.enteredAt).toLocaleString("en-IN"),
                    t.symbolLabel ?? t.symbol,
                    t.direction,
                    t.mode,
                    t.entryPrice.toFixed(2),
                    t.exitPrice ? t.exitPrice.toFixed(2) : "",
                    t.quantity,
                    t.pnl !== null && t.pnl !== undefined ? t.pnl.toFixed(2) : "",
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
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
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
                  trades.slice(0, 30).map((t) => {
                    // Compute live P&L for open trades
                    const livePnl = t.status === "open" && currentPrice > 0
                      ? t.direction === "BUY"
                        ? (currentPrice - t.entryPrice) * t.quantity
                        : (t.entryPrice - currentPrice) * t.quantity
                      : t.pnl;
                    return (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-4 font-medium text-white text-xs">{t.symbolLabel ?? t.symbol}</td>
                        <td className="py-2.5 pr-4">
                          <span className={`flex items-center gap-1 ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                            {t.direction === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.mode === "paper" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>{t.mode}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-white/80">₹{t.entryPrice.toFixed(2)}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-white/60">{t.exitPrice ? `₹${t.exitPrice.toFixed(2)}` : "—"}</td>
                        <td className="py-2.5 pr-4 text-right text-white/60">{t.quantity}</td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-semibold ${(livePnl ?? 0) > 0 ? "text-emerald-400" : (livePnl ?? 0) < 0 ? "text-red-400" : "text-white/40"}`}>
                          {livePnl !== undefined && livePnl !== null
                            ? `${livePnl > 0 ? "+" : ""}₹${livePnl.toFixed(0)}${t.status === "open" ? " ●" : ""}`
                            : "—"}
                        </td>
                        <td className="py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            t.status === "open" ? "bg-blue-500/20 text-blue-400"
                            : (t.pnl ?? 0) > 0 ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                          }`}>
                            {t.status === "open" ? "Open" : t.exitReason ?? "Closed"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
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
