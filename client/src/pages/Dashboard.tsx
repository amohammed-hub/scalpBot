import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import QRModal from "@/components/QRModal";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, Calculator, RefreshCw, Bell, X, ShieldCheck, ShieldAlert, ShieldOff,
  Download, QrCode, LogOut, User, Wallet, BadgeIndianRupee, Flame, RotateCcw, ExternalLink
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { trpc } from "@/lib/trpc";
import { MCX_INSTRUMENTS } from "@shared/mcxInstruments";

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
// lotSize: minimum tradeable quantity per lot. Quantity is always rounded to nearest lot.
// spotOnly: true means the index cannot be directly traded — shown for reference/signal only.
// isIndexOptions: when true, bot reads underlying (underlyingToken) for signals and auto-resolves ATM CE/PE at runtime.
// underlyingToken: the index token used to fetch candles and generate signals (only for isIndexOptions instruments).
const INSTRUMENTS = [
  // ── Index Options — Auto-ATM (RECOMMENDED for Nifty/BankNifty) ─────────────────────────────────
  // Bot reads the index for trend signals, then auto-resolves ATM CE (BUY) or PE (SELL) at trade time.
  // Quantity is sized using the option premium price, NOT the underlying index price.
  { token: "NSE_INDEX|Nifty Bank",        symbol: "BANKNIFTY", label: "BankNifty → ATM Options (Auto)",  segment: "Index Options (Auto-ATM)", lotSize: 15, spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Bank" },
  { token: "NSE_INDEX|Nifty 50",          symbol: "NIFTY",     label: "Nifty 50 → ATM Options (Auto)",   segment: "Index Options (Auto-ATM)", lotSize: 25, spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty 50" },
  { token: "NSE_INDEX|Nifty Fin Service", symbol: "FINNIFTY",  label: "FinNifty → ATM Options (Auto)",   segment: "Index Options (Auto-ATM)", lotSize: 40, spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Fin Service" },
  // ── NSE F&O Futures — TRADEABLE ──────────────────────────────────────────────
  { token: "NFO_FUT|BANKNIFTY30JUL2026FUT", symbol: "BNF_FUT",   label: "BankNifty Jul 2026 Futures", segment: "NSE F&O Futures", lotSize: 15, spotOnly: false },
  { token: "NFO_FUT|NIFTY30JUL2026FUT",     symbol: "NIFTY_FUT", label: "Nifty Jul 2026 Futures",     segment: "NSE F&O Futures", lotSize: 25, spotOnly: false },
  // ── NSE F&O Options — Fixed Strike (manual selection) ────────────────────────
  { token: "NFO_OPT|NIFTY10JUL202624800CE",    symbol: "NIFTY_CE",      label: "Nifty 24800 CE (10 Jul)",    segment: "NSE F&O Options", lotSize: 25, spotOnly: false },
  { token: "NFO_OPT|NIFTY10JUL202624800PE",    symbol: "NIFTY_PE",      label: "Nifty 24800 PE (10 Jul)",    segment: "NSE F&O Options", lotSize: 25, spotOnly: false },
  { token: "NFO_OPT|NIFTY10JUL202625000CE",    symbol: "NIFTY_25000CE", label: "Nifty 25000 CE (10 Jul)",    segment: "NSE F&O Options", lotSize: 25, spotOnly: false },
  { token: "NFO_OPT|NIFTY10JUL202625000PE",    symbol: "NIFTY_25000PE", label: "Nifty 25000 PE (10 Jul)",    segment: "NSE F&O Options", lotSize: 25, spotOnly: false },
  { token: "NFO_OPT|BANKNIFTY09JUL202653000CE", symbol: "BNF_CE",       label: "BankNifty 53000 CE (9 Jul)", segment: "NSE F&O Options", lotSize: 15, spotOnly: false },
  { token: "NFO_OPT|BANKNIFTY09JUL202653000PE", symbol: "BNF_PE",       label: "BankNifty 53000 PE (9 Jul)", segment: "NSE F&O Options", lotSize: 15, spotOnly: false },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500CE", symbol: "BNF_53500CE",  label: "BankNifty 53500 CE (9 Jul)", segment: "NSE F&O Options", lotSize: 15, spotOnly: false },
  { token: "NFO_OPT|BANKNIFTY09JUL202653500PE", symbol: "BNF_53500PE",  label: "BankNifty 53500 PE (9 Jul)", segment: "NSE F&O Options", lotSize: 15, spotOnly: false },
  // MCX Commodities
  { token: "MCX_FO|552720", symbol: "MCX_GOLD",     label: "Gold (GOLDGUINEA FUT 31 Jul)",    segment: "MCX Commodities", lotSize: 10,    spotOnly: false },
  { token: "MCX_FO|574822", symbol: "MCX_SILVER",   label: "Silver (SILVER100 FUT 31 Jul)",   segment: "MCX Commodities", lotSize: 100,   spotOnly: false },
  { token: "MCX_FO|520703", symbol: "MCX_CRUDE",    label: "Crude Oil (CRUDEOILM FUT 20 Jul)",segment: "MCX Commodities", lotSize: 100,   spotOnly: false },
  { token: "MCX_FO|538686", symbol: "MCX_NATGAS",   label: "Natural Gas Mini (28 Jul)",        segment: "MCX Commodities", lotSize: 1250,  spotOnly: false },
  { token: "MCX_FO|562048", symbol: "MCX_COPPER",   label: "Copper (FUT 31 Jul)",              segment: "MCX Commodities", lotSize: 1000,  spotOnly: false },
  { token: "MCX_FO|562054", symbol: "MCX_ZINC",     label: "Zinc Mini (FUT 31 Jul)",           segment: "MCX Commodities", lotSize: 1000,  spotOnly: false },
  { token: "MCX_FO|562047", symbol: "MCX_ALUM",     label: "Aluminium (FUT 31 Jul)",           segment: "MCX Commodities", lotSize: 5000,  spotOnly: false },
  { token: "MCX_FO|562050", symbol: "MCX_LEAD",     label: "Lead Mini (FUT 31 Jul)",           segment: "MCX Commodities", lotSize: 1000,  spotOnly: false },
  { token: "MCX_FO|562051", symbol: "MCX_NICKEL",   label: "Nickel (FUT 15 Jul)",              segment: "MCX Commodities", lotSize: 100,   spotOnly: false },
  // NSE Equity
  { token: "NSE_EQ|INE009A01021", symbol: "RELIANCE",  label: "Reliance Industries", segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE467B01029", symbol: "TCS",        label: "TCS",                segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE009B01011", symbol: "INFY",       label: "Infosys",            segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE040A01034", symbol: "HDFC",       label: "HDFC Bank",          segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE030A01027", symbol: "ITC",        label: "ITC",                segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE585B01010", symbol: "SBIN",       label: "SBI",                segment: "NSE Equity", lotSize: 1, spotOnly: false },
  { token: "NSE_EQ|INE062A01020", symbol: "TATAMOTORS", label: "Tata Motors",        segment: "NSE Equity", lotSize: 1, spotOnly: false },
  // BSE
  { token: "BSE_INDEX|SENSEX", symbol: "SENSEX", label: "Sensex", segment: "BSE Index", lotSize: 1, spotOnly: false },
  // NSE Indices (spot) — NOT directly tradeable, shown for price reference only
  { token: "NSE_INDEX|Nifty 50",           symbol: "NIFTY",         label: "Nifty 50 (Spot)",     segment: "NSE Index (Spot Only)", lotSize: 1, spotOnly: true },
  { token: "NSE_INDEX|Nifty Bank",         symbol: "BANKNIFTY",     label: "Bank Nifty (Spot)",   segment: "NSE Index (Spot Only)", lotSize: 1, spotOnly: true },
  { token: "NSE_INDEX|Nifty Fin Service",  symbol: "FINNIFTY",      label: "Fin Nifty (Spot)",    segment: "NSE Index (Spot Only)", lotSize: 1, spotOnly: true },
  { token: "NSE_INDEX|MIDCPNIFTY",         symbol: "MIDCPNIFTY",    label: "Midcap Nifty (Spot)", segment: "NSE Index (Spot Only)", lotSize: 1, spotOnly: true },
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

  // ── tRPC queries ─────────────────────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();

  // Per-slot Quick Start state for the Parallel Bots panel
  const [slotQS, setSlotQS] = useState<Record<number, { symbol: string; capital: number }>>(
    { 1: { symbol: "NIFTY", capital: 50000 }, 2: { symbol: "CRUDEOIL", capital: 50000 } }
  );
  const startSecondaryMutation = trpc.multiBots.startSecondary.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`🤖 Slot ${vars.slot} bot started in Paper mode!`);
      utils.multiBots.allStatus.invalidate();
    },
    onError: (e) => toast.error(`Start failed: ${e.message}`),
  });
  const handleQuickStart = (slot: number) => {
    const qs = slotQS[slot];
    const tg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "{}");
    // Resolve token: check MCX registry first, then fall back to NSE_FO
    const mcxInstr = MCX_INSTRUMENTS.find(i => i.symbol === qs.symbol);
    const resolvedToken = mcxInstr ? mcxInstr.instrumentToken : `NSE_FO|${qs.symbol}`;
    const resolvedLabel = mcxInstr ? mcxInstr.label : qs.symbol;
    startSecondaryMutation.mutate({
      sessionToken, slot: slot as 1 | 2,
      instrumentToken: resolvedToken,
      instrumentSymbol: qs.symbol, instrumentLabel: resolvedLabel,
      mode: "paper", capital: qs.capital, riskPerTradePct: 1.5, maxTradesPerDay: 5,
      dailyLossLimitPct: 3, stopLossMultiplier: 1.5, targetMultiplier: 2.5,
      minConfidence: 60, scanIntervalSec: 30,
      telegramBotToken: tg.botToken ?? "", telegramChatId: tg.chatId ?? "", telegramEnabled: tg.enabled ?? false,
    });
  };

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

  // Daily P&L chart data
  const [pnlRange, setPnlRange] = useState<7 | 30>(7);
  const { data: pnlByDay = [] } = trpc.trades.pnlByDay.useQuery(
    { sessionToken },
    { refetchInterval: 30000, staleTime: 15000 }
  );

  // Open trade from DB
  const { data: openTrade } = trpc.trades.openTrade.useQuery(
    { sessionToken },
    { refetchInterval: 3000, staleTime: 1000 }
  );

  // Multi-bot: all 3 slots
  const { data: allBots } = trpc.multiBots.allStatus.useQuery(
    { sessionToken },
    { refetchInterval: 5000, staleTime: 2000 }
  );
  const stopSecondaryMutation = trpc.multiBots.stopSecondary.useMutation({
    onSuccess: (_, vars) => {
      toast.info(`Slot ${vars.slot} bot stopped.`);
      utils.multiBots.allStatus.invalidate();
    },
    onError: (e) => toast.error(`Stop failed: ${e.message}`),
  });

  // Upstox account profile & balance
  const { data: accountProfile } = trpc.account.profile.useQuery(
    { sessionToken },
    { refetchInterval: 60000, staleTime: 30000, retry: false }
  );
  const { data: accountBalance, refetch: refetchBalance } = trpc.account.balance.useQuery(
    { sessionToken },
    { refetchInterval: 30000, staleTime: 15000, retry: false }
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
  const isPowerHourMode = liveData?.isPowerHourMode ?? false;
  const isMCXEveningMode = liveData?.isMCXEveningMode ?? false;
  const heroZeroMode = liveData?.heroZeroMode ?? false;
  const reEntryCandles = liveData?.reEntryCandles ?? 0;
  const optionPremiumPrice = liveData?.optionPremiumPrice ?? null;
  const isIndexOptions = liveData?.isIndexOptions ?? false;
  const lastTickAt = liveData?.lastTickAt ?? 0;

  // Staleness: track how many seconds since last tick
  const [secondsSinceLastTick, setSecondsSinceLastTick] = useState(0);
  useEffect(() => {
    if (!isRunning || !lastTickAt) { setSecondsSinceLastTick(0); return; }
    const update = () => setSecondsSinceLastTick(Math.floor((Date.now() - lastTickAt) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isRunning, lastTickAt]);
  // Stale if bot is running but last tick was more than 2× the scan interval ago
  const scanIntervalSec = botStatus?.scanIntervalSec ?? 30;
  const isStale = isRunning && lastTickAt > 0 && secondsSinceLastTick > scanIntervalSec * 2;

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

  // Token status — check server DB (authoritative) with localStorage as fallback
  const { data: serverCreds } = trpc.credentials.get.useQuery(
    { sessionToken },
    { refetchInterval: 60000, staleTime: 30000 }
  );
  const [tokenStatus, setTokenStatus] = useState<"valid" | "missing" | "short">("missing");
  useEffect(() => {
    if (serverCreds !== undefined) {
      // Server DB is the source of truth — covers auto-fetched tokens
      if (serverCreds?.hasAccessToken) {
        setTokenStatus("valid");
        // Keep localStorage in sync so other components see the token
        try {
          const creds = JSON.parse(localStorage.getItem("scalpbot_credentials") ?? "null") ?? {};
          if (!creds.accessToken || creds.accessToken === "[auto-fetched]") {
            localStorage.setItem("scalpbot_credentials", JSON.stringify({
              ...creds,
              accessToken: "[auto-fetched]",
              tokenSavedAt: Date.now(),
            }));
          }
        } catch { /* ignore */ }
        return;
      }
      // Server says no token — fall back to localStorage
      try {
        const creds = JSON.parse(localStorage.getItem("scalpbot_credentials") ?? "null");
        if (!creds?.accessToken) setTokenStatus("missing");
        else if (creds.accessToken.length < 100 && creds.accessToken !== "[auto-fetched]") setTokenStatus("short");
        else setTokenStatus("valid");
      } catch { setTokenStatus("missing"); }
    }
  }, [serverCreds]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleStart = () => {
    const selectedInstr = INSTRUMENTS.find(i => i.token === config.instrumentToken);
    const lotSize = selectedInstr?.lotSize ?? 1;
    const isIndexOptions = !!(selectedInstr as any)?.isIndexOptions;
    const underlyingToken = (selectedInstr as any)?.underlyingToken as string | undefined;
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
      lotSize,
      isIndexOptions,
      underlyingToken,
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
  // Prefer inMemOpenTrade (from liveData — has live trailing SL, partial booking state)
  // Fall back to DB openTrade (from trades.openTrade — used after server restart)
  const activeTrade = inMemOpenTrade ? {
    id: inMemOpenTrade.dbId,
    symbolLabel: inMemOpenTrade.symbolLabel,
    direction: inMemOpenTrade.direction,
    entryPrice: inMemOpenTrade.entryPrice,
    quantity: inMemOpenTrade.quantity,
    slPrice: inMemOpenTrade.slPrice,
    targetPrice: inMemOpenTrade.targetPrice,
    confidence: inMemOpenTrade.confidence,
    mode: inMemOpenTrade.mode,
    upstoxOrderId: (inMemOpenTrade as any).upstoxOrderId ?? null,
    partialBooked: (inMemOpenTrade as any).partialBooked ?? 0,
    bookedPnl: (inMemOpenTrade as any).bookedPnl ?? 0,
    bookedQty: (inMemOpenTrade as any).bookedQty ?? 0,
    currentSl: (inMemOpenTrade as any).currentSl ?? inMemOpenTrade.slPrice,
  } : openTrade ? { ...openTrade, upstoxOrderId: openTrade.upstoxOrderId ?? null } : null;

  // Only calculate unrealized P&L when we have a real live price (not 0, not same as entry)
  // For options mode, use option premium price for unrealized P&L; otherwise use underlying price
  const effectiveLivePrice = isIndexOptions && optionPremiumPrice && optionPremiumPrice > 0
    ? optionPremiumPrice
    : currentPrice;
  const unrealizedPnl = activeTrade && effectiveLivePrice > 0
      ? activeTrade.direction === "BUY"
        ? (effectiveLivePrice - activeTrade.entryPrice) * activeTrade.quantity
        : (activeTrade.entryPrice - effectiveLivePrice) * activeTrade.quantity
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
        <button onClick={() => navigate("/hero-zero")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-purple-400 hover:bg-purple-500/10 border border-purple-500/20">
          <span className="text-base">🦸</span>
          Hero Zero Scanner
        </button>
        <button onClick={() => navigate("/pnl-analytics")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-base">📊</span>
          P&amp;L Analytics
        </button>
        <button onClick={() => navigate("/backtest")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-blue-400 hover:bg-blue-500/10 border border-blue-500/20">
          <span className="text-base">🔬</span>
          Backtester
        </button>
        <div className="mt-auto px-2 pb-2 space-y-2">
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            {isRunning ? "Bot Running" : "Bot Stopped"}
          </div>
          {isRunning && countdown > 0 && (
            <div className="text-xs text-white/30 px-3">Next scan in {countdown}s</div>
          )}
          {isPowerHourMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-400 animate-pulse">
              <Flame className="w-3.5 h-3.5" />
              NSE Power Hour
            </div>
          )}
          {isMCXEveningMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 animate-pulse">
              <Flame className="w-3.5 h-3.5" />
              MCX Evening (US Open)
            </div>
          )}
          {heroZeroMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 animate-pulse">
              <span className="text-xs font-bold">0→H</span>
              Hero Zero Active
            </div>
          )}
          {reEntryCandles > 0 && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <RotateCcw className="w-3.5 h-3.5" />
              Re-entry cooldown ({reEntryCandles}/2)
            </div>
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

        {/* Market Status Badge + Auto Square-Off Warning */}
        {(() => {
          const now = new Date();
          const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
          const isMCX = config.instrumentToken.startsWith("MCX");
          const inNSE = istMin >= 555 && istMin <= 930;
          const inMCX = istMin >= 540 && istMin <= 1410;
          const inSession = isMCX ? inMCX : inNSE;
          const squareOffMin = isMCX ? (23 * 60 + 25) : (15 * 60 + 25);
          const stopScanMin  = isMCX ? (23 * 60 + 20) : (15 * 60 + 20);
          const nearClose = istMin >= stopScanMin && istMin < squareOffMin;
          return (
            <>
              {!inSession && (
                <div className="mb-4 flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white/40 text-sm">
                  <span className="w-2 h-2 rounded-full bg-white/20 inline-block" />
                  <span>Market is <strong>closed</strong> — bot will not generate signals until market opens</span>
                </div>
              )}
              {nearClose && activeTrade && (
                <div className="mb-4 flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-amber-400 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Market closing soon — open trade will be <strong>auto squared-off at {isMCX ? "23:25" : "15:25"} IST</strong></span>
                </div>
              )}
            </>
          );
        })()}

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Live Price card — special: shows staleness indicator */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">Live Price</span>
              <div className="flex items-center gap-1.5">
                {isStale && (
                  <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5 animate-pulse">
                    Stale
                  </span>
                )}
                <TrendingUp className="w-4 h-4 text-teal-400" />
              </div>
            </div>
            <div className="text-xl font-bold text-white">
              {currentPrice > 0 ? `₹${currentPrice.toFixed(2)}` : "—"}
            </div>
            {bidPrice > 0 && (
              <div className="text-xs text-white/30 mt-0.5">
                B:₹{bidPrice.toFixed(0)} A:₹{askPrice.toFixed(0)}
              </div>
            )}
            {isRunning && lastTickAt > 0 && (
              <div className={`text-xs mt-0.5 ${isStale ? "text-amber-400/70" : "text-white/20"}`}>
                {isStale
                  ? `⚠ No update for ${secondsSinceLastTick}s`
                  : `Updated ${secondsSinceLastTick}s ago`}
              </div>
            )}
          </div>
          {[
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

        {/* Account Balance & Profile Widget */}
        {(accountProfile || accountBalance) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Profile Card */}
            {accountProfile && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <User className="w-4 h-4 text-teal-400" />
                  <span className="text-xs text-white/40 uppercase tracking-wider">Account Profile</span>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center shrink-0">
                    <span className="text-teal-400 font-bold text-sm">
                      {accountProfile.user_name?.charAt(0)?.toUpperCase() ?? "U"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-semibold text-sm truncate">{accountProfile.user_name ?? "—"}</div>
                    <div className="text-white/40 text-xs truncate">{accountProfile.email ?? "—"}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {accountProfile.user_id && (
                        <span className="text-xs bg-white/5 border border-white/10 rounded-md px-2 py-0.5 text-white/50">
                          UCC: {accountProfile.user_id}
                        </span>
                      )}
                      {accountProfile.broker && (
                        <span className="text-xs bg-teal-500/10 border border-teal-500/20 rounded-md px-2 py-0.5 text-teal-400">
                          {accountProfile.broker}
                        </span>
                      )}
                      {accountProfile.user_type && (
                        <span className="text-xs bg-white/5 border border-white/10 rounded-md px-2 py-0.5 text-white/40">
                          {accountProfile.user_type}
                        </span>
                      )}
                    </div>
                    {accountProfile.exchanges && accountProfile.exchanges.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {accountProfile.exchanges.map(ex => (
                          <span key={ex} className="text-[10px] bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 text-blue-400">{ex}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Balance Card */}
            {accountBalance && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-white/40 uppercase tracking-wider">Funds & Margin</span>
                  </div>
                  <button
                    onClick={() => refetchBalance()}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
                    title="Refresh balance"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                {accountBalance.equity && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-white/50 text-xs">Available Margin</span>
                      <span className="text-emerald-400 font-bold text-base">
                        ₹{(accountBalance.equity.available_margin ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/50 text-xs">Used Margin</span>
                      <span className="text-amber-400 font-semibold text-sm">
                        ₹{(accountBalance.equity.used_margin ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/50 text-xs">Available Cash</span>
                      <span className="text-white/70 text-sm">
                        ₹{(accountBalance.equity.available_cash ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    {(accountBalance.equity.available_margin ?? 0) > 0 && (accountBalance.equity.used_margin ?? 0) > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] text-white/30 mb-1">
                          <span>Used</span>
                          <span>
                            {(((accountBalance.equity.used_margin ?? 0) /
                              ((accountBalance.equity.available_margin ?? 0) + (accountBalance.equity.used_margin ?? 0))) * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all"
                            style={{ width: `${Math.min(100, ((accountBalance.equity.used_margin ?? 0) / ((accountBalance.equity.available_margin ?? 0) + (accountBalance.equity.used_margin ?? 0))) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Power Hour Banner */}
        {isPowerHourMode && (
          <div className="mb-4 flex items-center gap-3 bg-gradient-to-r from-orange-500/15 to-amber-500/10 border border-orange-500/30 rounded-2xl px-5 py-3.5">
            <Flame className="w-5 h-5 text-orange-400 shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="text-orange-300 font-semibold text-sm">⚡ NSE Power Hour — 3:00 to 3:20 PM IST</div>
              <div className="text-orange-400/70 text-xs mt-0.5">Institutional close/build window active. Bot reads full-day candles (VWAP, day trend, volume surge, MACD 5m) for high-conviction entries.</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-orange-400/60">Strategy</div>
              <div className="text-orange-300 font-bold text-sm">PowerHour</div>
            </div>
          </div>
        )}

        {/* MCX Evening Power Hour Banner */}
        {isMCXEveningMode && (
          <div className="mb-4 flex items-center gap-3 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border border-amber-500/30 rounded-2xl px-5 py-3.5">
            <Flame className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="text-amber-300 font-semibold text-sm">🇺🇸 MCX Evening Power Hour — 7:30 to 9:30 PM IST</div>
              <div className="text-amber-400/70 text-xs mt-0.5">US market open window. Crude Oil, Gold &amp; Silver move sharply as NY opens. Bot reads full-day MCX candles + VWAP + MACD 5m for directional bias. EIA Crude data on Wednesdays — SL auto-widened 30%.</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-amber-400/60">Strategy</div>
              <div className="text-amber-300 font-bold text-sm">MCXEvening</div>
            </div>
          </div>
        )}

        {/* Hero Zero Banner */}
        {heroZeroMode && (
          <div className="mb-4 flex items-center gap-3 bg-gradient-to-r from-purple-500/15 to-violet-500/10 border border-purple-500/30 rounded-2xl px-5 py-3.5">
            <div className="w-5 h-5 text-purple-400 shrink-0 font-black text-sm flex items-center justify-center animate-pulse">0→H</div>
            <div className="flex-1 min-w-0">
              <div className="text-purple-300 font-semibold text-sm">🎯 Hero Zero Mode — Expiry Day OTM Options</div>
              <div className="text-purple-400/70 text-xs mt-0.5">Buying deep OTM options at ₹2–50 premium. Target: 5× premium. Cut: 50% loss. Partial booking at 2.5× and 3.5×. Works on NIFTY &amp; BANKNIFTY weekly expiry.</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-purple-400/60">Strategy</div>
              <div className="text-purple-300 font-bold text-sm">HeroZero</div>
            </div>
          </div>
        )}

        {/* Signal + Chart Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
          {/* Signal Card */}
          <div className={`lg:col-span-2 rounded-2xl p-5 ${isPowerHourMode ? "bg-orange-500/5 border border-orange-500/20" : "bg-white/5 border border-white/10"}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-white/40 uppercase tracking-wider">Latest Signal</div>
              {latestSignal?.layer && latestSignal.layer !== "None" && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  latestSignal.layer === "PowerHour"  ? "bg-orange-500/20 border-orange-500/30 text-orange-400" :
                  latestSignal.layer === "MCXEvening" ? "bg-amber-500/20 border-amber-500/30 text-amber-400" :
                  latestSignal.layer === "HeroZero"   ? "bg-purple-500/20 border-purple-500/30 text-purple-400" :
                  latestSignal.layer === "Breakout"   ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-400" :
                  latestSignal.layer === "MACD_BB"    ? "bg-violet-500/20 border-violet-500/30 text-violet-400" :
                  latestSignal.layer === "Pattern"    ? "bg-blue-500/20 border-blue-500/30 text-blue-400" :
                  latestSignal.layer === "Trend"      ? "bg-teal-500/20 border-teal-500/30 text-teal-400" :
                  latestSignal.layer === "Momentum"      ? "bg-pink-500/20 border-pink-500/30 text-pink-400" :
                  latestSignal.layer === "ORB"            ? "bg-lime-500/20 border-lime-500/30 text-lime-400" :
                  latestSignal.layer === "VWAPReversion"  ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400" :
                  latestSignal.layer === "InstFootprint"  ? "bg-rose-500/20 border-rose-500/30 text-rose-400" :
                  "bg-white/10 border-white/20 text-white/50"
                }`}>
                  {latestSignal.layer}
                </span>
              )}
            </div>
            {!latestSignal || latestSignal.direction === "HOLD" ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Minus className="w-6 h-6 text-white/30" />
                  <span className="text-white/30 text-lg font-bold">HOLD</span>
                </div>
                <div className="text-white/30 text-sm">{isRunning ? `Scanning... next in ${countdown}s` : "Start the bot to see signals"}</div>
                {isRunning && latestSignal?.reason && (
                  <div className="mt-2 text-xs text-white/20 leading-relaxed font-mono bg-white/5 rounded-lg px-3 py-2 break-words">
                    {latestSignal.reason}
                  </div>
                )}
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
                  {(latestSignal as any).marketRegime && (
                    <div className="flex justify-between">
                      <span className="text-white/50">Regime</span>
                      <span className="text-white/60 text-xs font-mono max-w-[180px] text-right leading-tight">{(latestSignal as any).marketRegime}</span>
                    </div>
                  )}
                  {(latestSignal as any).orbHigh > 0 && (
                    <div className="flex justify-between">
                      <span className="text-white/50">ORB Range</span>
                      <span className="text-lime-400 font-mono text-xs">₹{(latestSignal as any).orbLow?.toFixed(1)}–₹{(latestSignal as any).orbHigh?.toFixed(1)}</span>
                    </div>
                  )}
                  {(latestSignal as any).vwapZScore !== undefined && (latestSignal as any).vwapZScore !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-white/50">VWAP z-score</span>
                      <span className="text-cyan-400 font-mono">{(latestSignal as any).vwapZScore?.toFixed(2)}σ</span>
                    </div>
                  )}
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
            {/* Warning: bot not running — SL/Target not being monitored */}
            {!isRunning && (
              <div className="flex items-start gap-3 bg-red-500/15 border border-red-500/40 rounded-xl p-3 mb-4">
                <span className="text-red-400 text-lg mt-0.5">&#9888;</span>
                <div>
                  <p className="text-red-400 font-semibold text-sm">Bot is not running — SL &amp; Target are NOT being monitored</p>
                  <p className="text-red-300/70 text-xs mt-0.5">Live price and unrealized P&amp;L will not update until you restart the bot. In live mode this means your stop-loss will not trigger automatically.</p>
                </div>
              </div>
            )}
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
                {/* Upstox order link — only shown for live trades */}
                {activeTrade.mode === "live" && (
                  <a
                    href={activeTrade.upstoxOrderId
                      ? `https://upstox.com/orders/${activeTrade.upstoxOrderId}`
                      : "https://upstox.com/orders"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 transition-colors"
                    title={activeTrade.upstoxOrderId ? `View order ${activeTrade.upstoxOrderId} on Upstox` : "View orders on Upstox"}
                  >
                    <ExternalLink className="w-4 h-4" />
                    View on Upstox
                  </a>
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
                { label: "Current", value: currentPrice > 0 ? currentPrice : null, color: currentPrice > activeTrade.entryPrice ? "text-emerald-400" : currentPrice > 0 && currentPrice < activeTrade.entryPrice ? "text-red-400" : "text-white/40" },
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

            {/* Progress bar — SL on left, Entry in middle, Target on right */}
            {activeTrade.slPrice && activeTrade.targetPrice && (
              <div className="mb-3">
                {(() => {
                  const sl = activeTrade.slPrice!;
                  const tgt = activeTrade.targetPrice!;
                  const entry = activeTrade.entryPrice;
                  const range = Math.abs(tgt - sl);
                  // Entry position as % of SL→Target range
                  const entryPct = Math.max(5, Math.min(95, (Math.abs(entry - sl) / range) * 100));
                  // Current price position (only show cursor when we have a real price)
                  const hasCurrent = currentPrice > 0 && currentPrice !== entry;
                  const curPct = hasCurrent
                    ? Math.max(0, Math.min(100, (activeTrade.direction === "BUY"
                        ? (currentPrice - sl) / range
                        : (sl - currentPrice) / range) * 100))
                    : entryPct;
                  // SL distance and Target distance
                  const slDist = Math.abs(entry - sl);
                  const tgtDist = Math.abs(tgt - entry);
                  const slDistFromCurrent = currentPrice > 0 ? Math.abs(currentPrice - sl) : slDist;
                  const tgtDistFromCurrent = currentPrice > 0 ? Math.abs(tgt - currentPrice) : tgtDist;
                  return (
                    <>
                      <div className="relative h-3 bg-white/10 rounded-full overflow-hidden">
                        {/* Red zone: SL side (left of entry) */}
                        <div className="absolute left-0 top-0 h-full bg-red-500/25 rounded-l-full" style={{ width: `${entryPct}%` }} />
                        {/* Green zone: Target side (right of entry) */}
                        <div className="absolute top-0 h-full bg-emerald-500/25 rounded-r-full" style={{ left: `${entryPct}%`, right: 0 }} />
                        {/* Entry marker */}
                        <div className="absolute top-0 h-full w-0.5 bg-white/40" style={{ left: `${entryPct}%` }} />
                        {/* Current price cursor */}
                        <div
                          className="absolute top-0 h-full w-1.5 bg-white rounded-full shadow-lg transition-all duration-1000"
                          style={{ left: `${curPct}%`, transform: "translateX(-50%)" }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-white/30 mt-1">
                        <span className="text-red-400/70">▼ SL ₹{slDistFromCurrent.toFixed(0)} away</span>
                        <span className="text-white/50">Potential: +₹{(tgtDist * activeTrade.quantity).toFixed(0)}</span>
                        <span className="text-emerald-400/70">▲ Target ₹{tgtDistFromCurrent.toFixed(0)} away</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Partial Booking Progress */}
            {(activeTrade as any).partialBooked !== undefined && (
              <div className="mb-3 bg-white/5 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/50 font-medium">Pyramid Exit Progress</span>
                  <span className="text-xs text-emerald-400 font-mono">
                    {(activeTrade as any).bookedPnl > 0 ? `+₹${(activeTrade as any).bookedPnl.toFixed(0)} locked` : "No partial yet"}
                  </span>
                </div>
                <div className="flex gap-2">
                  {["Entry", "1R (50% booked)", "2R (25% booked)", "Full Target"].map((label, i) => (
                    <div key={i} className="flex-1 text-center">
                      <div className={`h-1.5 rounded-full mb-1 ${
                        i === 0 ? "bg-teal-500" :
                        (activeTrade as any).partialBooked >= i ? "bg-emerald-500" : "bg-white/10"
                      }`} />
                      <div className={`text-[9px] leading-tight ${
                        (activeTrade as any).partialBooked >= i ? "text-emerald-400" : "text-white/30"
                      }`}>{label}</div>
                    </div>
                  ))}
                </div>
                {(activeTrade as any).partialBooked > 0 && (
                  <div className="mt-2 text-xs text-amber-400/70">
                    SL moved to {(activeTrade as any).partialBooked === 1 ? "breakeven" : "1R level"} — remaining qty: {activeTrade.quantity}
                  </div>
                )}
              </div>
            )}

            {/* Hero Zero Premium Tracker */}
            {(activeTrade as any).isHeroZero && (activeTrade as any).heroZeroPremiumEntry && (
              <div className="mb-3 bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-purple-300 font-medium">Hero Zero Premium Tracker</span>
                  <span className="text-xs text-purple-400 font-mono">
                    {currentPrice > 0 ? `${(currentPrice / (activeTrade as any).heroZeroPremiumEntry).toFixed(1)}×` : "—"}
                  </span>
                </div>
                <div className="flex gap-1 text-[10px]">
                  <div className="flex-1 text-center">
                    <div className="text-white/40">Entry</div>
                    <div className="text-white font-mono">₹{(activeTrade as any).heroZeroPremiumEntry.toFixed(1)}</div>
                  </div>
                  <div className="flex-1 text-center">
                    <div className="text-amber-400/70">2.5× (book 50%)</div>
                    <div className="text-amber-400 font-mono">₹{((activeTrade as any).heroZeroPremiumEntry * 2.5).toFixed(1)}</div>
                  </div>
                  <div className="flex-1 text-center">
                    <div className="text-amber-400/70">3.5× (book 25%)</div>
                    <div className="text-amber-400 font-mono">₹{((activeTrade as any).heroZeroPremiumEntry * 3.5).toFixed(1)}</div>
                  </div>
                  <div className="flex-1 text-center">
                    <div className="text-emerald-400/70">5× Target</div>
                    <div className="text-emerald-400 font-mono">₹{((activeTrade as any).heroZeroPremiumEntry * 5).toFixed(1)}</div>
                  </div>
                  <div className="flex-1 text-center">
                    <div className="text-red-400/70">50% Cut</div>
                    <div className="text-red-400 font-mono">₹{((activeTrade as any).heroZeroPremiumEntry * 0.5).toFixed(1)}</div>
                  </div>
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
              {/* Show info badge when an Index Options (Auto-ATM) instrument is selected */}
              {(INSTRUMENTS.find(i => i.token === config.instrumentToken) as any)?.isIndexOptions && (
                <div className="mt-1.5 flex items-start gap-1.5 bg-teal-500/10 border border-teal-500/30 rounded-lg px-2.5 py-1.5">
                  <span className="text-teal-400 text-[10px] leading-tight">
                    <strong>Auto-ATM Options Mode:</strong> Bot reads the index price for signals, then automatically buys the ATM CE (on BUY signal) or ATM PE (on SELL signal). Capital is sized using the option premium price.
                  </span>
                </div>
              )}
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

        {/* Parallel Bots Panel */}
        {allBots && allBots.some(b => b.slot > 0) && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-purple-400" />
                <span className="font-semibold text-white">Parallel Bots</span>
                <span className="text-xs text-white/40">Running simultaneously on different instruments</span>
              </div>
              {/* Combined P&L across all slots */}
              {(() => {
                const combinedPnl = (allBots ?? []).reduce((sum, b) => sum + (b.dailyPnl ?? 0), 0);
                return (
                  <div className={`text-sm font-bold ${
                    combinedPnl > 0 ? "text-emerald-400" : combinedPnl < 0 ? "text-red-400" : "text-white/40"
                  }`}>
                    Combined: {combinedPnl >= 0 ? "+" : ""}₹{combinedPnl.toFixed(0)}
                  </div>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(allBots ?? []).map((bot) => {
                const isActive = bot.status === "running";
                const slotLabel = bot.slot === 0 ? "Primary" : `Slot ${bot.slot}`;
                const slotColor = bot.slot === 0 ? "teal" : bot.slot === 1 ? "purple" : "amber";
                const pnlPositive = (bot.dailyPnl ?? 0) > 0;
                const pnlNegative = (bot.dailyPnl ?? 0) < 0;
                const modeTag = bot.isPowerHourMode ? "⚡ Power Hour" : bot.isMCXEveningMode ? "🌙 MCX Evening" : bot.heroZeroMode ? "🦸 Hero Zero" : null;
                return (
                  <div key={bot.sessionToken} className={`rounded-xl border p-4 ${
                    isActive
                      ? `border-${slotColor}-500/30 bg-${slotColor}-500/5`
                      : "border-white/10 bg-white/3"
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          isActive ? `bg-${slotColor}-500/20 text-${slotColor}-300` : "bg-white/10 text-white/40"
                        }`}>{slotLabel}</span>
                        {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                      </div>
                      {bot.slot > 0 && isActive && (
                        <button
                          onClick={() => stopSecondaryMutation.mutate({ sessionToken, slot: bot.slot })}
                          className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1"
                        >
                          <Square className="w-3 h-3" /> Stop
                        </button>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-white mb-1">
                      {bot.instrumentLabel || (isActive ? "Scanning…" : "—")}
                    </div>
                    {modeTag && (
                      <div className="text-xs text-amber-300 mb-1">{modeTag}</div>
                    )}
                    <div className="flex items-center justify-between text-xs text-white/50 mb-2">
                      <span>₹{(bot.lastPrice ?? 0).toFixed(2)}</span>
                      <span>{bot.tradesCount ?? 0} trades</span>
                    </div>
                    <div className={`text-base font-bold ${
                      pnlPositive ? "text-emerald-400" : pnlNegative ? "text-red-400" : "text-white/40"
                    }`}>
                      {(bot.dailyPnl ?? 0) >= 0 ? "+" : ""}₹{(bot.dailyPnl ?? 0).toFixed(0)}
                      <span className="text-xs font-normal text-white/30 ml-1">today</span>
                    </div>
                    {bot.openTrade && (
                      <div className={`mt-2 text-xs px-2 py-1 rounded-lg ${
                        bot.openTrade.direction === "BUY" ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
                      }`}>
                        {bot.openTrade.direction} @ ₹{bot.openTrade.entryPrice?.toFixed(2)} · SL ₹{(bot.openTrade as any).sl?.toFixed(2) ?? (bot.openTrade as any).stopLoss?.toFixed(2) ?? "—"}
                      </div>
                    )}
                    {bot.lastSignal && !bot.openTrade && (
                      <div className="mt-2 text-xs text-white/30">
                        Last: {bot.lastSignal.direction} · {bot.lastSignal.confidence}%
                      </div>
                    )}
                    {/* Quick Start form for inactive secondary slots */}
                    {bot.slot > 0 && !isActive && (
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                        <div className="text-xs text-white/40 font-medium">Quick Start</div>
                        <div className="flex gap-2">
                          <select
                            value={slotQS[bot.slot]?.symbol ?? "NIFTY"}
                            onChange={e => setSlotQS(s => ({ ...s, [bot.slot]: { ...s[bot.slot], symbol: e.target.value } }))}
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none"
                          >
                            <option value="NIFTY">NIFTY</option>
                            <option value="BANKNIFTY">BANKNIFTY</option>
                            <option value="FINNIFTY">FINNIFTY</option>
                            <option value="CRUDEOIL">Crude Oil (MCX)</option>
                            <option value="GOLDM">Gold Mini (MCX)</option>
                            <option value="SILVERM">Silver Mini (MCX)</option>
                          </select>
                          <input
                            type="number"
                            value={slotQS[bot.slot]?.capital ?? 50000}
                            onChange={e => setSlotQS(s => ({ ...s, [bot.slot]: { ...s[bot.slot], capital: Number(e.target.value) } }))}
                            min={10000} step={10000}
                            className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none"
                            placeholder="Capital"
                          />
                        </div>
                        <button
                          onClick={() => handleQuickStart(bot.slot)}
                          disabled={startSecondaryMutation.isPending}
                          className="w-full text-xs py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 transition-colors disabled:opacity-50"
                        >
                          {startSecondaryMutation.isPending ? "⏳ Starting…" : `▶ Start Slot ${bot.slot} (Paper)`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
            <p className="text-xs text-white/30 mt-3">
              Start additional bots from the <button className="underline text-purple-400" onClick={() => navigate("/hero-zero")}>Hero Zero Scanner</button> or Settings.
            </p>
          </div>
        )}

        {/* Daily P&L Chart */}
        {(() => {
          const days = pnlRange;
          const sorted = [...pnlByDay].sort((a, b) => a.date.localeCompare(b.date));
          const sliced = sorted.slice(-days);
          // Fill missing days with 0
          const filled: { date: string; totalPnl: number; trades: number; wins: number; losses: number }[] = [];
          const today = new Date();
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const found = sliced.find(x => x.date === key);
            filled.push(found ? { date: key, totalPnl: found.totalPnl, trades: found.trades, wins: found.wins, losses: found.losses } : { date: key, totalPnl: 0, trades: 0, wins: 0, losses: 0 });
          }
          const cumPnl = filled.reduce((a, b) => a + b.totalPnl, 0);
          const tradingDays = filled.filter(d => d.trades > 0).length;
          const greenDays = filled.filter(d => d.totalPnl > 0).length;
          return (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-teal-400" />
                  <span className="font-semibold text-white">Daily P&amp;L</span>
                  <span className={`text-sm font-bold ml-1 ${cumPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cumPnl >= 0 ? '+' : ''}₹{cumPnl.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30">{tradingDays} trading days · {greenDays} green</span>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    {([7, 30] as const).map(r => (
                      <button key={r} onClick={() => setPnlRange(r)}
                        className={`px-3 py-1 text-xs transition-colors ${
                          pnlRange === r ? 'bg-teal-500/30 text-teal-300' : 'text-white/40 hover:text-white/70'
                        }`}>{r}D</button>
                    ))}
                  </div>
                </div>
              </div>
              {filled.every(d => d.trades === 0) ? (
                <div className="flex items-center justify-center h-32 text-white/30 text-sm">
                  No closed trades yet — start the bot to see P&amp;L history
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={filled} margin={{ top: 4, right: 4, left: 4, bottom: 4 }} barSize={pnlRange === 7 ? 28 : 14}>
                    <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      tickFormatter={d => { const parts = d.split('-'); return `${parts[2]}/${parts[1]}`; }}
                      axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      tickFormatter={v => v === 0 ? '0' : `${v >= 0 ? '+' : ''}${(v/1000).toFixed(1)}K`}
                      axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
                      formatter={(value: number, _name: string, props: { payload?: { trades?: number; wins?: number; losses?: number } }) => [
                        `${value >= 0 ? '+' : ''}₹${value.toFixed(0)} (${props.payload?.trades ?? 0}T ${props.payload?.wins ?? 0}W/${props.payload?.losses ?? 0}L)`,
                        'P&L'
                      ]}
                      labelFormatter={d => { const parts = d.split('-'); return `${parts[2]}/${parts[1]}/${parts[0]}`; }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                    <Bar dataKey="totalPnl" radius={[3, 3, 0, 0]}>
                      {filled.map((entry, idx) => (
                        <Cell key={idx} fill={entry.totalPnl > 0 ? '#10b981' : entry.totalPnl < 0 ? '#ef4444' : 'rgba(255,255,255,0.1)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          );
        })()}

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
                  const headers = ["Entry Date", "Exit Date", "Symbol", "Direction", "Mode", "Entry Price", "Exit Price", "Quantity", "P&L (INR)", "Status", "Exit Reason"];
                  const rows = trades.map((t: typeof trades[0]) => [
                    t.enteredAt ? new Date(t.enteredAt).toLocaleString("en-IN") : "",
                    t.exitedAt ? new Date(t.exitedAt).toLocaleString("en-IN") : "",
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
                  const csv = [headers, ...rows].map((r: (string | number | null | undefined)[]) => r.map((v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
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
              <button
                onClick={() => navigate("/pnl-analytics")}
                className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <span className="text-xs">📊</span>
                Full Analytics
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
                  <th className="text-left py-2 pr-4">Entry Time</th>
                  <th className="text-left py-2 pr-4">Exit Time</th>
                  <th className="text-right py-2 pr-4">Entry</th>
                  <th className="text-right py-2 pr-4">Exit</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2 pr-4">P&L</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr><td colSpan={10} className="text-center text-white/30 py-8">No trades yet. Start the bot to begin.</td></tr>
                ) : (
                  trades.slice(0, 30).map((t: typeof trades[0]) => {
                    // Compute live P&L for open trades
                    // In options mode use option premium price; otherwise use underlying price
                    const liveEffectivePrice = isIndexOptions && optionPremiumPrice && optionPremiumPrice > 0
                      ? optionPremiumPrice
                      : currentPrice;
                    const livePnl = t.status === "open" && liveEffectivePrice > 0
                      ? t.direction === "BUY"
                        ? (liveEffectivePrice - t.entryPrice) * t.quantity
                        : (t.entryPrice - liveEffectivePrice) * t.quantity
                      : t.pnl;
                    return (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-4 font-medium text-white text-xs">
                          {/* Symbol — clickable link to Upstox order if live, or portfolio if paper */}
                          {t.mode === "live" && t.upstoxOrderId ? (
                            <a
                              href={`https://upstox.com/orders/${t.upstoxOrderId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 hover:text-emerald-400 transition-colors group"
                              title={`View order ${t.upstoxOrderId} on Upstox`}
                            >
                              {t.symbolLabel ?? t.symbol}
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                            </a>
                          ) : t.mode === "live" ? (
                            <a
                              href="https://upstox.com/orders"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 hover:text-emerald-400 transition-colors group"
                              title="View orders on Upstox"
                            >
                              {t.symbolLabel ?? t.symbol}
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                            </a>
                          ) : (
                            t.symbolLabel ?? t.symbol
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`flex items-center gap-1 ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                            {t.direction === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.mode === "paper" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>{t.mode}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-white/50 whitespace-nowrap">
                          {t.enteredAt ? new Date(t.enteredAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-white/50 whitespace-nowrap">
                          {t.exitedAt ? new Date(t.exitedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
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
