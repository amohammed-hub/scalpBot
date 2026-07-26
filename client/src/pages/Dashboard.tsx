import { Badge } from "@/components/ui/badge";
import { AdminPanel } from "@/components/AdminPanel";
import { useLocation, Link } from "wouter";
import CandlestickChart from "@/components/CandlestickChart";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, Calculator, RefreshCw, Bell, X, ShieldCheck, ShieldAlert, ShieldOff,
  Download, LogOut, User, BadgeIndianRupee, Flame, RotateCcw, ExternalLink, XCircle, Trash2
} from "lucide-react";
import { Shield, Skull, Layers, Target, Gauge, Power, Award, ChevronDown, Moon } from "lucide-react";
import { Gift, Copy, Users as UsersIcon } from "lucide-react";
import { Pencil } from "lucide-react";
import { Clock, Timer, Trophy, Ban, ArrowDownUp } from "lucide-react";
import { Infinity as InfinityIcon } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { trpc } from "@/lib/trpc";
import { MCX_INSTRUMENTS } from "@shared/mcxInstruments";
import { getTierLimits, FEATURE_MIN_PLAN, type TierLimits } from "@shared/tierLimits";
import { getCurrentSession, getAllSessionDefaults, hasSessionChanged, type TradingSession } from "@shared/sessionDefaults";
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
  enabledLayers: string[];
  partial1Pct: number;  // Book 50% at this % profit (e.g., 30 = +30%)
  partial2Pct: number;  // Book 25% at this % profit (e.g., 60 = +60%)
  openingBurstEnabled: boolean;
  crudeOilCorrelation: boolean;
}

interface PricePoint { time: string; price: number; }

// ── Instruments ───────────────────────────────────────────────────────────────
// lotSize: minimum tradeable quantity per lot. Quantity is always rounded to nearest lot.
// spotOnly: true means the index cannot be directly traded — shown for reference/signal only.
// isIndexOptions: when true, bot reads underlying (underlyingToken) for signals and auto-resolves ATM CE/PE at runtime.
// underlyingToken: the index token used to fetch candles and generate signals (only for isIndexOptions instruments).
// Bot reads the underlying index/futures for signals and auto-resolves 1-OTM CE/PE option at trade time.
// 1-OTM = one strike away from ATM for lower premiums, better lot sizing, and higher profit potential.
// Quantity is sized using the option PREMIUM price (~₹100–500), NOT the underlying futures price.
const INSTRUMENTS = [
  // ── NSE Index Options — Auto OTM ─────────────────────────────────────────────
  // NSE lot sizes revised Jan 2026 (circular FAOP70616): NIFTY 65, BANKNIFTY 30, FINNIFTY 60
  { token: "NSE_INDEX|Nifty Bank",        symbol: "BANKNIFTY", label: "BankNifty → OTM Options (Auto)",  segment: "NSE Index Options", lotSize: 30,   spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Bank" },
  { token: "NSE_INDEX|Nifty 50",          symbol: "NIFTY",     label: "Nifty 50 → OTM Options (Auto)",   segment: "NSE Index Options", lotSize: 65,   spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty 50" },
  { token: "NSE_INDEX|Nifty Fin Service", symbol: "FINNIFTY",  label: "FinNifty → OTM Options (Auto)",   segment: "NSE Index Options", lotSize: 60,   spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Fin Service" },
  { token: "BSE_INDEX|SENSEX",             symbol: "SENSEX",    label: "Sensex → OTM Options (Auto)",     segment: "BSE Index Options", lotSize: 10,   spotOnly: false, isIndexOptions: true, underlyingToken: "BSE_INDEX|SENSEX" },
  { token: "BSE_INDEX|BANKEX",             symbol: "BANKEX",    label: "Bankex → OTM Options (Auto)",     segment: "BSE Index Options", lotSize: 15,   spotOnly: false, isIndexOptions: true, underlyingToken: "BSE_INDEX|BANKEX" },
  { token: "NSE_INDEX|NIFTY MID SELECT",   symbol: "MIDCPNIFTY", label: "MidcpNifty → OTM Options (Auto)", segment: "NSE Index Options", lotSize: 75,   spotOnly: false, isIndexOptions: true, underlyingToken: "NSE_INDEX|NIFTY MID SELECT" },
  // ── MCX Commodity Options — Auto OTM ─────────────────────────────────────────
  // Tokens are numeric front-month IDs verified from Upstox instrument master (Jul 2026).
  // These auto-resolve to the correct front-month contract via resolveMcxFuturesToken() at runtime.
  { token: "MCX_FO|560977",  symbol: "MCX_CRUDE",  label: "Crude Oil → OTM Options (Auto)",    segment: "MCX Commodity Options", lotSize: 100,  spotOnly: false, isIndexOptions: true, underlyingToken: "MCX_FO|560977" },
  { token: "MCX_FO|555922",  symbol: "MCX_GOLD",   label: "Gold → OTM Options (Auto)",         segment: "MCX Commodity Options", lotSize: 100,  spotOnly: false, isIndexOptions: true, underlyingToken: "MCX_FO|555922" },
  { token: "MCX_FO|471725",  symbol: "MCX_SILVER", label: "Silver → OTM Options (Auto)",       segment: "MCX Commodity Options", lotSize: 30,   spotOnly: false, isIndexOptions: true, underlyingToken: "MCX_FO|471725" },
  { token: "MCX_FO|538685",  symbol: "MCX_NATGAS", label: "Natural Gas → OTM Options (Auto)",  segment: "MCX Commodity Options", lotSize: 1250, spotOnly: false, isIndexOptions: true, underlyingToken: "MCX_FO|538685" },
  { token: "MCX_FO|562048",  symbol: "MCX_COPPER", label: "Copper → OTM Options (Auto)",       segment: "MCX Commodity Options", lotSize: 2500, spotOnly: false, isIndexOptions: true, underlyingToken: "MCX_FO|562048" },
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

// ── Bot Health Indicator ──────────────────────────────────────────────────────
type BotHealth = "green" | "amber" | "red" | "idle";

/**
 * Compute health based on how long ago the last tick fired.
 * green  = last tick within 2× scanInterval (healthy)
 * amber  = 2–5× scanInterval (possibly stalled)
 * red    = >5× scanInterval OR lastError set (tick died)
 * idle   = bot is stopped / never ran
 */
function getBotHealth(
  status: string,
  lastTickAt: number,
  scanIntervalSec: number,
  lastError: string | null,
): BotHealth {
  if (status !== "running") return "idle";
  if (lastTickAt === 0) return "amber"; // running but no tick yet (just started)
  const elapsedMs = Date.now() - lastTickAt;
  const intervalMs = Math.max(15, scanIntervalSec) * 1000;
  if (lastError && elapsedMs > intervalMs * 3) return "red";
  if (elapsedMs <= intervalMs * 2) return "green";
  if (elapsedMs <= intervalMs * 5) return "amber";
  return "red";
}

function HealthDot({
  status,
  lastTickAt,
  scanIntervalSec,
  lastError,
  onRestart,
}: {
  status: string;
  lastTickAt: number;
  scanIntervalSec: number;
  lastError: string | null;
  onRestart?: () => void;
}) {
  const health = getBotHealth(status, lastTickAt, scanIntervalSec, lastError);
  const elapsedSec = lastTickAt > 0 ? Math.round((Date.now() - lastTickAt) / 1000) : null;

  const colorClass = {
    green: "bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]",
    amber: "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]",
    red:   "bg-red-500 shadow-[0_0_6px_2px_rgba(239,68,68,0.5)]",
    idle:  "bg-white/20",
  }[health];

  const label = {
    green: `Healthy — last scan ${elapsedSec !== null ? `${elapsedSec}s ago` : "just now"}`,
    amber: `Slow — last scan ${elapsedSec !== null ? `${elapsedSec}s ago` : "unknown"}`,
    red:   lastError ? `Error: ${lastError}` : `Stalled — last scan ${elapsedSec !== null ? `${elapsedSec}s ago` : "unknown"}`,
    idle:  "Bot is stopped",
  }[health];

  if (health === "red" && onRestart) {
    return (
      <button
        onClick={onRestart}
        title={`${label} — Click to restart`}
        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded-md transition-colors active:scale-95"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} />
        Restart
      </button>
    );
  }

  return (
    <span
      title={label}
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all duration-500 cursor-help ${colorClass}`}
    />
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [location, navigate] = useLocation();
  // ── Tab State (URL-based) ─────────────────────────────────────────────────
  type DashTab = "command" | "trades" | "log";
  const activeTab: DashTab = location.startsWith("/dashboard/trades") ? "trades"
    : location.startsWith("/dashboard/log") ? "log"
    : "command";
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const sessionToken = getSessionToken();

  // ── Mobile Auth Check ──────────────────────────────────────────────────────
  const meQuery = trpc.mobileAuth.me.useQuery(undefined, {
    staleTime: 5_000,
    retry: 2,
    retryDelay: 500,
  });

  useEffect(() => {
    // SECURITY FIX: Always redirect to login if server confirms no valid session.
    // The server is the source of truth — localStorage tokens can be stale/forged.
    if (meQuery.isFetched && !meQuery.data) {
      // Clear stale localStorage token to prevent loops
      localStorage.removeItem("scalpbot_auth_token");
      navigate("/login");
    }
  }, [meQuery.isFetched, meQuery.data, navigate]);

  // ── Name Prompt for users who haven't set their name ──────────────────────
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const updateNameMutation = trpc.mobileAuth.updateName.useMutation({
    onSuccess: () => {
      toast.success(`Welcome, ${nameInput}!`);
      setShowNamePrompt(false);
      meQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  useEffect(() => {
    if (meQuery.data && !meQuery.data.name) {
      setShowNamePrompt(true);
    }
  }, [meQuery.data]);


  const logoutMutation = trpc.mobileAuth.logout.useMutation({
    onSuccess: () => {
      localStorage.removeItem("scalpbot_auth_token");
      navigate("/login");
    },
  });

  // ── Subscription Access Control ────────────────────────────────────────────
  const accessQuery = trpc.subscription.checkAccess.useQuery(
    { sessionToken },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );
  // Derived tier limits for access control
  const isAdmin = accessQuery.data?.isAdmin ?? meQuery.data?.role === "admin";
  const currentTierLimits: TierLimits = accessQuery.data?.tierLimits ?? getTierLimits(accessQuery.data?.plan, isAdmin);
  const hasMcxAccess = isAdmin || currentTierLimits.mcxAccess;
  const hasTelegramAccess = isAdmin || currentTierLimits.telegram;

  const startTrialMutation = trpc.subscription.startTrial.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("2-day free trial activated! Paper trading NSE only.");
        accessQuery.refetch();
      } else {
        toast.error(data.error || "Could not start trial");
      }
    },
    onError: (e) => toast.error(e.message),
  });

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
      enabledLayers: ["Pattern", "Trend", "Momentum", "MACD_BB", "VWAPReversion", "RedBarTheory", "TrikalStrategy", "Adeeb"],
      partial1Pct: 30,
      partial2Pct: 60,
      openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
    };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_CONFIG) ?? "null") }; }
    catch { return defaults; }
  });
  useEffect(() => { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }, [config]);

  // Unlimited trades toggle (admin-only, persisted in localStorage)
  const [unlimitedTrades, setUnlimitedTrades] = useState(() => localStorage.getItem("scalpbot_unlimited_trades") === "true");
  useEffect(() => { localStorage.setItem("scalpbot_unlimited_trades", unlimitedTrades ? "true" : "false"); }, [unlimitedTrades]);

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
    () => {
      // Load saved overrides from localStorage
      const saved = localStorage.getItem("scalpbot_slot_qs");
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
      // Otherwise, use session-based defaults
      const session = getCurrentSession();
      const defaults = getAllSessionDefaults(session);
      const symbolMap: Record<string, string> = {
        "MCX_GOLD": "MCX_GOLD", "MCX_CRUDE": "MCX_CRUDE", "MCX_SILVER": "MCX_SILVER",
        "NIFTY": "NIFTY", "BANKNIFTY": "BANKNIFTY", "FINNIFTY": "FINNIFTY", "SENSEX": "SENSEX", "BANKEX": "BANKEX", "MIDCPNIFTY": "MIDCPNIFTY",
      };
      return {
        0: { symbol: defaults[0]?.symbol ?? "NIFTY", capital: 50000 },
        1: { symbol: defaults[1]?.symbol ?? "BANKNIFTY", capital: 50000 },
        2: { symbol: defaults[2]?.symbol ?? "FINNIFTY", capital: 50000 },
        3: { symbol: defaults[3]?.symbol ?? "BANKNIFTY", capital: 50000 },
      };
    }
  );

  // ── Session Auto-Switch ─────────────────────────────────────────────────────
  const [lastSession, setLastSession] = useState<TradingSession>(getCurrentSession());
  const [userOverride, setUserOverride] = useState<Record<number, boolean>>({});

  // Track user manual instrument changes
  const handleManualInstrumentChange = (slot: number, newSymbol: string, newCapital: number) => {
    setUserOverride(prev => ({ ...prev, [slot]: true }));
    setSlotQS(s => ({ ...s, [slot]: { symbol: newSymbol, capital: newCapital } }));
    localStorage.setItem("scalpbot_user_override", JSON.stringify({ ...userOverride, [slot]: true }));
  };

  // Check for session change every 30 seconds
  useEffect(() => {
    const checkSession = () => {
      const current = getCurrentSession();
      if (hasSessionChanged(lastSession, current)) {
        // Session changed! Auto-switch non-overridden bots
        const defaults = getAllSessionDefaults(current);
        const savedOverrides = JSON.parse(localStorage.getItem("scalpbot_user_override") ?? "{}");
        const newSlotQS: Record<number, { symbol: string; capital: number }> = {};
        let switched = false;
        for (let i = 0; i < 4; i++) {
          if (savedOverrides[i]) {
            // User manually set this slot — keep their choice
            newSlotQS[i] = slotQS[i];
          } else {
            // Auto-switch to session default
            newSlotQS[i] = { symbol: defaults[i]?.symbol ?? "NIFTY", capital: slotQS[i]?.capital ?? 50000 };
            switched = true;
          }
        }
        if (switched) {
          setSlotQS(newSlotQS);
          localStorage.setItem("scalpbot_slot_qs", JSON.stringify(newSlotQS));
          toast.info(`Session changed → Instruments updated to ${current === "evening" ? "MCX" : "NSE"} defaults`, { duration: 5000 });
        }
        setLastSession(current);
        // Reset user overrides on session change (they can override again)
        setUserOverride({});
        localStorage.removeItem("scalpbot_user_override");
      }
    };
    const interval = setInterval(checkSession, 30_000);
    return () => clearInterval(interval);
  }, [lastSession, slotQS, userOverride]);

  // Persist slotQS changes
  useEffect(() => {
    localStorage.setItem("scalpbot_slot_qs", JSON.stringify(slotQS));
  }, [slotQS]);

  const startSecondaryMutation = trpc.multiBots.startSecondary.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`🤖 Bot ${(vars.slot ?? 0) + 1} started in ${config.mode.toUpperCase()} mode!`);
      // Cancel in-flight queries to prevent stale "stopped" responses from overwriting optimistic update
      utils.multiBots.allStatus.cancel();
      // Optimistic: immediately update the slot to "running"
      utils.multiBots.allStatus.setData({ sessionToken, isAdmin: meQuery.data?.role === "admin" }, (old: any) => {
        if (!old) return old;
        return old.map((b: any) => b.slot === vars.slot ? { ...b, status: "running" } : b);
      });
      setTimeout(() => { utils.multiBots.allStatus.invalidate(); utils.multiBots.livePrices.invalidate(); }, 2000);
    },
    onError: (e) => toast.error(`Start failed: ${e.message}`),
  });
  const handleQuickStart = (slot: number) => {
    const qs = slotQS[slot];
    // MCX access gate
    if (qs?.symbol?.startsWith("MCX_") && !hasMcxAccess) {
      toast.error("MCX markets require 3-Month plan or higher. Upgrade → Pricing page.");
      return;
    }
    console.log(`[QuickStart] slot=${slot}, symbol=${qs?.symbol}, capital=${qs?.capital}`);
    toast.info(`Starting Bot ${slot + 1}...`);
    const tg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "{}");
    const resolved = resolveInstrument(qs.symbol);
    if (slot === 0) {
      console.log(`[QuickStart] Calling bot.start for slot 0, token=${resolved.token}, mode=${config.mode}`);
      startMutation.mutate({
        sessionToken,
        instrumentToken: resolved.token,
        instrumentSymbol: qs.symbol,
        instrumentLabel: resolved.label,
        mode: config.mode,
        capital: qs.capital,
        riskPerTradePct: 1.5,
        maxTradesPerDay: 5,
        dailyLossLimitPct: 3,
        stopLossMultiplier: 1.5,
        targetMultiplier: 2.5,
        minConfidence: 60,
        scanIntervalSec: 30,
        lotSize: resolved.lotSize,
        isIndexOptions: true,
        underlyingToken: resolved.token,
        enabledLayers: config.enabledLayers,
        partial1Pct: config.partial1Pct,
        partial2Pct: config.partial2Pct,
        trailingSlEnabled: config.trailingSlEnabled,
        trailingSlPct: config.trailingSlPct,
        averagingEnabled: localStorage.getItem("scalpbot_averaging_enabled") !== "false",
        averagingLossThreshold: parseInt(localStorage.getItem("scalpbot_averaging_threshold") ?? "20", 10) / 100,
        useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
        unlimitedTrades,
        openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
      slStrategy: (localStorage.getItem("scalpbot_sl_strategy") as "B" | "D") || "B",
      });
    } else {
      console.log(`[QuickStart] Calling startSecondary for slot ${slot}, token=${resolved.token}, mode=${config.mode}`);
      startSecondaryMutation.mutate({
        sessionToken, slot: slot as 1 | 2 | 3,
        instrumentToken: resolved.token,
        instrumentSymbol: qs.symbol, instrumentLabel: resolved.label,
        mode: config.mode, capital: qs.capital, riskPerTradePct: 1.5, maxTradesPerDay: 5,
        dailyLossLimitPct: 3, stopLossMultiplier: 1.5, targetMultiplier: 2.5,
        minConfidence: 60, scanIntervalSec: 30,
        lotSize: resolved.lotSize,
        isIndexOptions: true,
        underlyingToken: resolved.token,
        telegramBotToken: tg.botToken ?? "", telegramChatId: tg.chatId ?? "", telegramEnabled: tg.enabled ?? false,
        enabledLayers: config.enabledLayers,
        partial1Pct: config.partial1Pct, partial2Pct: config.partial2Pct,
        trailingSlEnabled: config.trailingSlEnabled, trailingSlPct: config.trailingSlPct,
        useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
        unlimitedTrades,
        openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
      slStrategy: (localStorage.getItem("scalpbot_sl_strategy") as "B" | "D") || "B",
      });
    }
  };

  // ── Resolve instrument symbol to token/label/lotSize ──────────────────────────
  const resolveInstrument = (symbol: string) => {
    const NSE_INDEX_MAP: Record<string, { token: string; label: string; lotSize: number }> = {
      // NSE lot sizes revised Jan 2026: NIFTY 65, BANKNIFTY 30, FINNIFTY 60
      NIFTY:     { token: "NSE_INDEX|Nifty 50",          label: "Nifty 50 → OTM Options (Auto)",   lotSize: 65 },
      BANKNIFTY: { token: "NSE_INDEX|Nifty Bank",        label: "BankNifty → OTM Options (Auto)",  lotSize: 30 },
      FINNIFTY:  { token: "NSE_INDEX|Nifty Fin Service", label: "FinNifty → OTM Options (Auto)",   lotSize: 60 },
      SENSEX:    { token: "BSE_INDEX|SENSEX",            label: "Sensex → OTM Options (Auto)",     lotSize: 10 },
      BANKEX:    { token: "BSE_INDEX|BANKEX",            label: "Bankex → OTM Options (Auto)",     lotSize: 15 },
      MIDCPNIFTY: { token: "NSE_INDEX|NIFTY MID SELECT", label: "MidcpNifty → OTM Options (Auto)", lotSize: 75 },
    };
    const MCX_SYMBOL_MAP: Record<string, string> = {
      MCX_CRUDE: "CRUDEOIL",
      MCX_GOLD: "GOLD",
      MCX_SILVER: "SILVER",
      MCX_NATGAS: "NATURALGAS",
      MCX_COPPER: "COPPER",
      MCX_ZINC: "ZINC",
      MCX_ALUMINIUM: "ALUMINIUM",
      MCX_LEAD: "LEAD",
      MCX_NICKEL: "NICKEL",
    };
    const mcxSymbol = MCX_SYMBOL_MAP[symbol] ?? symbol;
    const mcxInstr = MCX_INSTRUMENTS.find(i => i.symbol === mcxSymbol);
    const nseInstr = NSE_INDEX_MAP[symbol];
    return {
      token: mcxInstr ? mcxInstr.instrumentToken : nseInstr ? nseInstr.token : `NSE_INDEX|Nifty 50`,
      label: mcxInstr ? mcxInstr.label : nseInstr ? nseInstr.label : symbol,
      lotSize: mcxInstr ? (mcxInstr.lotSize ?? 1) : nseInstr ? nseInstr.lotSize : 25,
    };
  };

  // ── Instrument Switch (stop → change → restart) ──────────────────────────────
  const [switchingSlot, setSwitchingSlot] = useState<number | null>(null);
  const handleInstrumentSwitch = async (slot: number, newSymbol: string, newCapital: number) => {
    // MCX access gate
    if (newSymbol.startsWith("MCX_") && !hasMcxAccess) {
      toast.error("MCX markets require 3-Month plan or higher. Upgrade → Pricing page.");
      return;
    }
    setSwitchingSlot(slot);
    toast.info(`Switching Bot ${slot + 1} to ${newSymbol}...`);
    // Mark as user override so session auto-switch won't override this choice
    setUserOverride(prev => ({ ...prev, [slot]: true }));
    localStorage.setItem("scalpbot_user_override", JSON.stringify({ ...userOverride, [slot]: true }));
    try {
      // Step 1: Stop the bot
      if (slot === 0) {
        await stopMutation.mutateAsync({ sessionToken });
      } else {
        await stopSecondaryMutation.mutateAsync({ sessionToken, slot: slot as 1 | 2 | 3 });
      }
      // Step 2: Wait briefly for cleanup
      await new Promise(r => setTimeout(r, 1500));
      // Step 3: Update slotQS and restart with new instrument
      setSlotQS(s => ({ ...s, [slot]: { symbol: newSymbol, capital: newCapital } }));
      const resolved = resolveInstrument(newSymbol);
      const tg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "{}");
      if (slot === 0) {
        startMutation.mutate({
          sessionToken,
          instrumentToken: resolved.token,
          instrumentSymbol: newSymbol,
          instrumentLabel: resolved.label,
          mode: config.mode,
          capital: newCapital,
          riskPerTradePct: 1.5,
          maxTradesPerDay: 5,
          dailyLossLimitPct: 3,
          stopLossMultiplier: 1.5,
          targetMultiplier: 2.5,
          minConfidence: 60,
          scanIntervalSec: 30,
          lotSize: resolved.lotSize,
          isIndexOptions: true,
          underlyingToken: resolved.token,
          enabledLayers: config.enabledLayers,
          partial1Pct: config.partial1Pct,
          partial2Pct: config.partial2Pct,
          trailingSlEnabled: config.trailingSlEnabled,
          trailingSlPct: config.trailingSlPct,
          averagingEnabled: localStorage.getItem("scalpbot_averaging_enabled") !== "false",
          averagingLossThreshold: parseInt(localStorage.getItem("scalpbot_averaging_threshold") ?? "20", 10) / 100,
          useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
          unlimitedTrades,
          openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
      slStrategy: (localStorage.getItem("scalpbot_sl_strategy") as "B" | "D") || "B",
        });
      } else {
        startSecondaryMutation.mutate({
          sessionToken, slot: slot as 1 | 2 | 3,
          instrumentToken: resolved.token,
          instrumentSymbol: newSymbol, instrumentLabel: resolved.label,
          mode: config.mode, capital: newCapital, riskPerTradePct: 1.5, maxTradesPerDay: 5,
          dailyLossLimitPct: 3, stopLossMultiplier: 1.5, targetMultiplier: 2.5,
          minConfidence: 60, scanIntervalSec: 30,
          lotSize: resolved.lotSize,
          isIndexOptions: true,
          underlyingToken: resolved.token,
          telegramBotToken: tg.botToken ?? "", telegramChatId: tg.chatId ?? "", telegramEnabled: tg.enabled ?? false,
          enabledLayers: config.enabledLayers,
          partial1Pct: config.partial1Pct, partial2Pct: config.partial2Pct,
          trailingSlEnabled: config.trailingSlEnabled, trailingSlPct: config.trailingSlPct,
          useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
          unlimitedTrades,
          openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
      slStrategy: (localStorage.getItem("scalpbot_sl_strategy") as "B" | "D") || "B",
        });
      }
      toast.success(`Bot ${slot + 1} switched to ${resolved.label}`);
    } catch (e: any) {
      toast.error(`Switch failed: ${e.message}`);
    } finally {
      setSwitchingSlot(null);
    }
  };

  // Smart Scanner state
  const [showScanner, setShowScanner] = useState<number | null>(null);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const { data: scanData, isLoading: scanLoading, refetch: refetchScan } = trpc.scanner.smartScan.useQuery(
    { sessionToken },
    { enabled: scanEnabled, staleTime: 30000, refetchOnWindowFocus: false }
  );

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
  // Cross-Market Correlation: Crude Oil bias (only fetched when toggle is ON)
  const { data: crudeOilBias } = trpc.bot.crudeOilBias.useQuery(
    { sessionToken },
    { refetchInterval: 60000, staleTime: 30000, enabled: config.crudeOilCorrelation }
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
    { sessionToken, isAdmin: meQuery.data?.role === "admin" || (accessQuery.data as any)?.extraBotSlots > 0 },
    { refetchInterval: 3000, staleTime: 1000 }
  );
  // Lightweight live price polling — updates every 5 seconds independently of scan interval
  const { data: livePricesData } = trpc.multiBots.livePrices.useQuery(
    { sessionToken },
    { refetchInterval: 5000, staleTime: 2000 }
  );
  const stopSecondaryMutation = trpc.multiBots.stopSecondary.useMutation({
    onSuccess: (_, vars) => {
      toast.info(`Bot ${vars.slot + 1} stopped.`);
      // Optimistic: immediately update the slot to "stopped"
      utils.multiBots.allStatus.setData({ sessionToken, isAdmin: meQuery.data?.role === "admin" }, (old: any) => {
        if (!old) return old;
        return old.map((b: any) => b.slot === vars.slot ? { ...b, status: "stopped" } : b);
      });
      setTimeout(() => { utils.multiBots.allStatus.invalidate(); }, 500);
    },
    onError: (e) => toast.error(`Stop failed: ${e.message}`),
  });

  // ── Risk Manager Queries ────────────────────────────────────────────────────
  const { data: riskScore } = trpc.riskManager.score.useQuery(
    { sessionToken },
    { refetchInterval: 5000, staleTime: 2000 }
  );
  const { data: portfolioStatus } = trpc.riskManager.portfolio.useQuery(
    { sessionToken },
    { refetchInterval: 5000, staleTime: 2000 }
  );
  const { data: cooldownInfo } = trpc.riskManager.cooldown.useQuery(
    { sessionToken },
    { refetchInterval: 3000, staleTime: 1000 }
  );

  // ── Layer Tracker ────────────────────────────────────────────────────────────
  const { data: layerStats = [] } = trpc.layerTracker.stats.useQuery(
    { sessionToken },
    { refetchInterval: 10000, staleTime: 5000 }
  );

  // ── Presets ──────────────────────────────────────────────────────────────────
  const { data: presetsList = [] } = trpc.presets.list.useQuery(undefined, { staleTime: 60000 });

  // ── Readiness ────────────────────────────────────────────────────────────────
  const { data: readinessData } = trpc.readiness.check.useQuery(
    { sessionToken },
    { refetchInterval: 15000, staleTime: 10000 }
  );

  // ── Paper Costs ──────────────────────────────────────────────────────────────
  const { data: paperCosts } = trpc.paperCosts.get.useQuery(undefined, { staleTime: 30000 });
  const [localBrokerage, setLocalBrokerage] = useState(20);
  const [localSlippage, setLocalSlippage] = useState(0.05);
  useEffect(() => { if (paperCosts) { setLocalBrokerage(paperCosts.brokerage); setLocalSlippage(paperCosts.slippagePct); } }, [paperCosts]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const startMutation = trpc.bot.start.useMutation({
    onSuccess: () => {
      toast.success(`Bot started in ${config.mode.toUpperCase()} mode — scanning every ${config.scanIntervalSec}s`);
      // Cancel in-flight queries to prevent stale "stopped" responses from overwriting optimistic update
      utils.bot.status.cancel();
      utils.multiBots.allStatus.cancel();
      // Optimistic: immediately set bot.status cache to "running" so UI updates instantly
      utils.bot.status.setData({ sessionToken }, (old: any) => old ? { ...old, status: "running" } : { status: "running" });
      // Optimistic: immediately update allBots slot 0 to "running"
      utils.multiBots.allStatus.setData({ sessionToken, isAdmin: meQuery.data?.role === "admin" }, (old: any) => {
        if (!old) return old;
        return old.map((b: any) => b.slot === 0 ? { ...b, status: "running" } : b);
      });
      // Then invalidate to get fresh data from server (confirms the optimistic update).
      // Use longer delay (2s) to ensure server has fully processed the start and the bot is in memory.
      setTimeout(() => {
        utils.bot.status.invalidate();
        utils.bot.liveData.invalidate();
        utils.multiBots.allStatus.invalidate();
        utils.multiBots.livePrices.invalidate();
      }, 2000);
    },
    onError: (e) => toast.error(`Failed to start bot: ${e.message}`),
  });

  const stopMutation = trpc.bot.stop.useMutation({
    onSuccess: () => {
      toast.info("Bot stopped.");
      // Optimistic: immediately set bot.status cache to "stopped"
      utils.bot.status.setData({ sessionToken }, (old: any) => old ? { ...old, status: "stopped" } : { status: "stopped" });
      // Optimistic: immediately update allBots slot 0 to "stopped"
      utils.multiBots.allStatus.setData({ sessionToken, isAdmin: meQuery.data?.role === "admin" }, (old: any) => {
        if (!old) return old;
        return old.map((b: any) => b.slot === 0 ? { ...b, status: "stopped" } : b);
      });
      setTimeout(() => {
        utils.bot.status.invalidate();
        utils.bot.liveData.invalidate();
        utils.multiBots.allStatus.invalidate();
      }, 500);
    },
    onError: (e) => toast.error(`Failed to stop bot: ${e.message}`),
  });

  const restartMutation = trpc.bot.restart.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Bot restarted — ${data?.instrumentLabel ?? "Bot"}`);
      utils.bot.status.invalidate();
      utils.multiBots.allStatus.invalidate();
    },
    onError: (e) => toast.error(`Restart failed: ${e.message}`),
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
  const forceAverageMutation = trpc.bot.forceAverage.useMutation({
    onSuccess: () => { toast.success("Average down executed!"); },
    onError: (err: any) => { toast.error(err.message || "Force average failed"); },
  });

  const deleteTradeByIdMutation = trpc.trades.deleteById.useMutation({
    onSuccess: () => {
      toast.success("Trade deleted.");
      utils.trades.list.invalidate();
      utils.trades.todayStats.invalidate();
      utils.trades.stats.invalidate();
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });
  const resetPnlMutation = trpc.trades.resetPnlCounter.useMutation({
    onSuccess: (data) => {
      const fixMsg = (data as any).fixedTrades > 0 ? ` (${(data as any).fixedTrades} trade(s) auto-corrected)` : "";
      toast.success(`P&L recalculated: ₹${(data.recalculatedPnl ?? 0).toFixed(0)} from ${data.tradeCount} trades.${fixMsg}`);
      utils.bot.status.invalidate();
      utils.trades.todayStats.invalidate();
      utils.trades.stats.invalidate();
      utils.trades.list.invalidate();
    },
    onError: (e) => toast.error(`Reset failed: ${e.message}`),
  });
  const correctExitMutation = trpc.trades.correctTradeExit.useMutation({
    onSuccess: (data) => {
      toast.success(`Exit corrected: ₹${(data.oldExit ?? 0).toFixed(0)} → ₹${data.newExit.toFixed(0)} | P&L: ₹${(data.oldPnl ?? 0).toFixed(0)} → ₹${data.newPnl.toFixed(0)}`);
      utils.trades.list.invalidate();
      utils.trades.todayStats.invalidate();
      utils.trades.stats.invalidate();
      utils.bot.status.invalidate();
    },
    onError: (e) => toast.error(`Correction failed: ${e.message}`),
  });
  const closeAllOpenMutation = trpc.trades.closeAllOpen.useMutation({
    onSuccess: (data) => {
      toast.success(`Closed ${data.closed} open trade(s)`);
      utils.trades.list.invalidate();
      utils.trades.todayStats.invalidate();
      utils.trades.stats.invalidate();
    },
    onError: (e) => toast.error(`Close failed: ${e.message}`),
  });
  const clearAllHistoryMutation = trpc.trades.clearAllHistory.useMutation({
    onSuccess: () => { toast.success("All trade history cleared — fresh start!"); utils.trades.list.invalidate(); utils.trades.todayStats.invalidate(); utils.trades.stats.invalidate(); },
    onError: (e) => toast.error("Failed to clear: " + e.message),
  });

  // Kill Switch — ONE button to rule them all
  const killSwitchMutation = trpc.riskManager.killSwitch.useMutation({
    onSuccess: (data: any) => {
      const failures = data.failures ?? [];
      if (failures.length > 0) {
        toast.error(`🚨 KILL SWITCH — ${data.stoppedBots} bots stopped, ${data.closedTrades} trades closed. ⚠️ FAILED to close: ${failures.join(", ")}`, { duration: 10000 });
      } else {
        toast.success(`✅ All bots stopped. ${data.closedTrades} position${data.closedTrades !== 1 ? "s" : ""} closed.`, { duration: 8000 });
      }
      utils.bot.status.invalidate();
      utils.multiBots.allStatus.invalidate();
      utils.trades.list.invalidate();
      utils.trades.todayStats.invalidate();
    },
    onError: (e) => {
      toast.error(`❌ Kill switch error: ${e.message}. Retrying...`, { duration: 5000 });
      // Auto-retry once on failure
      setTimeout(() => killSwitchMutation.mutate({ sessionToken }), 2000);
    },
  });

  // Carry Forward
  const carryForwardMutation = trpc.bot.setCarryForward.useMutation({
    onSuccess: (data) => {
      if (data.carryForward) {
        toast.success("🌙 Carry Forward enabled — trade will be held overnight");
      } else {
        toast("Auto square-off re-enabled — trade will close at market close");
      }
      utils.bot.status.invalidate();
      utils.bot.liveData.invalidate();
      utils.multiBots.allStatus.invalidate();
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  // Preset Apply
  const applyPresetMutation = trpc.presets.applyPreset.useMutation({
    onSuccess: (data: { applied: string; botsUpdated: number }) => {
      toast.success(`✅ Preset "${data.applied}" applied to ${data.botsUpdated} bot(s).`);
      utils.bot.status.invalidate();
      utils.multiBots.allStatus.invalidate();
    },
    onError: (e: { message: string }) => toast.error(`Preset failed: ${e.message}`),
  });

  // Paper Costs Update
  const updatePaperCostsMutation = trpc.paperCosts.update.useMutation({
    onSuccess: () => toast.success("Paper costs updated."),
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  // ── Hot-update strategy layers on running bot ──────────────────────────────
  const updateLayersMutation = trpc.bot.updateLayers.useMutation({
    onError: (e) => toast.error(`Layer update failed: ${e.message}`),
  });

  // Helper: toggle a layer and persist to running bot if active
  const toggleLayer = (layerId: string) => {
    setConfig(c => {
      const isEnabled = c.enabledLayers.includes(layerId);
      const newLayers = isEnabled
        ? c.enabledLayers.filter((l: string) => l !== layerId)
        : [...c.enabledLayers, layerId];
      // If bot is running, hot-update the running bot's layers in memory
      if (isRunning) {
        updateLayersMutation.mutate({ sessionToken, enabledLayers: newLayers });
      }
      return { ...c, enabledLayers: newLayers };
    });
  };

  // ── Activity log ─────────────────────────────────────────────────────────────
  const [activityAfterId, setActivityAfterId] = useState(0);
  type ActivityEvent = { id: number; ts: number; type: string; slot: number; message: string; price?: number; pnl?: number; confidence?: number };
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const { data: newActivityEvents } = trpc.activity.log.useQuery(
    { sessionToken, limit: 50, afterId: activityAfterId },
    { refetchInterval: 2000, enabled: !!sessionToken }
  );
  useEffect(() => {
    if (!newActivityEvents || newActivityEvents.length === 0) return;
    setActivityEvents(prev => {
      const combined = [...prev, ...newActivityEvents];
      return combined.slice(-200);
    });
    const lastId = newActivityEvents[newActivityEvents.length - 1]?.id;
    if (lastId) setActivityAfterId(lastId);
    setTimeout(() => {
      if (activityScrollRef.current) {
        activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
      }
    }, 50);
  }, [newActivityEvents]);

  // ── Derived state ─────────────────────────────────────────────────────────────
  const isRunning = botStatus?.status === "running" || (allBots ?? []).some((b: any) => b.status === "running");
  // Use livePricesData (updates every 5s) as primary source, fallback to liveData (3s but only updates on scan tick)
  const primaryLivePrice = livePricesData?.find(lp => lp.slot === 0)?.livePrice;
  const currentPrice = primaryLivePrice ?? liveData?.price ?? botStatus?.lastPrice ?? 0;
  const bidPrice = liveData?.bid ?? botStatus?.bidPrice ?? 0;
  const askPrice = liveData?.ask ?? botStatus?.askPrice ?? 0;
  const latestSignal = liveData?.signal ?? null;
  const inMemOpenTrade = liveData?.openTrade ?? null;
  const nextScanAt = liveData?.nextScanAt ?? 0;
  const isPowerHourMode = liveData?.isPowerHourMode ?? false;
  const isMCXEveningMode = liveData?.isMCXEveningMode ?? false;
  const isMCXLateSessionMode = liveData?.isMCXLateSessionMode ?? false;
  const heroZeroMode = liveData?.heroZeroMode ?? false;
  const openingBurstMode = (liveData as any)?.openingBurstMode ?? false;
  const reEntryCandles = liveData?.reEntryCandles ?? 0;
  const optionPremiumPrice = liveData?.optionPremiumPrice ?? null;
  const isIndexOptions = liveData?.isIndexOptions ?? false;
  const lastTickAt = liveData?.lastTickAt ?? 0;

  const recentRejectedSignals = (liveData as any)?.recentRejectedSignals ?? [];
  const averagingEnabled = (liveData as any)?.averagingEnabled ?? true;
  const averagingLossThreshold = (liveData as any)?.averagingLossThreshold ?? 0.20;

  // Adaptive Regime info
  const currentRegime = (liveData as any)?.currentRegime as "trending" | "choppy" | null;
  const currentADX = (liveData as any)?.currentADX as number | null;

  // VRP / OI Flow / Max Pain state
  const vrpRegime = (liveData as any)?.vrpRegime as "RICH" | "FAIR" | "CHEAP" | "INVERTED" | null;
  const vrpValue = (liveData as any)?.vrpValue as number | null;
  const oiFlowDirection = (liveData as any)?.oiFlowDirection as "BUY" | "SELL" | "NEUTRAL" | null;
  const oiFlowStrength = (liveData as any)?.oiFlowStrength as number | null;
  const maxPainStrike = (liveData as any)?.maxPainStrike as number | null;
  const maxPainBias = (liveData as any)?.maxPainBias as "UP" | "DOWN" | "NEUTRAL" | null;

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

  // Health dot refresh — force re-render every 10s so elapsed time in tooltip stays current
  const [, setHealthTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setHealthTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, [isRunning]);

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
  // Real-time token health check via Upstox API
  const tokenHealthQuery = trpc.credentials.tokenHealth.useQuery(
    { sessionToken },
    { enabled: !!sessionToken, refetchInterval: 60000, staleTime: 30000 }
  );
  const tokenHealthStatus = tokenHealthQuery.data?.status;
  const tokenHealthMessage = tokenHealthQuery.data?.message;

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

  // ── Trade Event Sound & Toast Notifications ──────────────────────────────────
  const prevOpenTradeRef = useRef<any>(null);
  const prevTradesLenRef = useRef<number>(0);
  useEffect(() => {
    const currentOT = openTrade ?? inMemOpenTrade ?? null;
    const prevOT = prevOpenTradeRef.current;

    // Detect ENTRY: no previous open trade → now have one
    if (!prevOT && currentOT) {
      const symbol = currentOT.instrumentLabel || currentOT.instrumentSymbol || "Unknown";
      const direction = currentOT.direction === "BUY" ? "BUY" : "SELL";
      const optType = currentOT.optionType ? ` ${currentOT.optionType}` : "";
      const price = currentOT.entryPrice ? ` @ ₹${Number(currentOT.entryPrice).toFixed(0)}` : "";
      playEntrySound();
      pushTradeNotification({
        type: "entry",
        message: `Bot 1: ${direction} ${symbol}${optType}${price}`,
      });
    }

    // Detect EXIT: had open trade → now gone (trade closed)
    if (prevOT && !currentOT) {
      // Check latest trade for P&L info
      const latestTrade = trades?.[0];
      if (latestTrade && latestTrade.exitPrice) {
        const pnl = Number(latestTrade.pnl ?? 0);
        const isProfit = pnl >= 0;
        const symbol = latestTrade.instrumentLabel || latestTrade.instrumentSymbol || "Unknown";
        const reason = latestTrade.exitReason || (isProfit ? "Target hit" : "Stop Loss");
        if (isProfit) {
          playProfitSound();
          pushTradeNotification({
            type: "profit",
            message: `Bot 1: EXIT +₹${Math.abs(pnl).toLocaleString("en-IN")} (${reason})`,
          });
        } else {
          playLossSound();
          pushTradeNotification({
            type: "loss",
            message: `Bot 1: EXIT -₹${Math.abs(pnl).toLocaleString("en-IN")} (${reason})`,
          });
        }
      } else {
        // Fallback — trade closed but no P&L info yet
        playLossSound();
        pushTradeNotification({
          type: "loss",
          message: `Bot 1: Trade closed`,
        });
      }
    }

    prevOpenTradeRef.current = currentOT;
    prevTradesLenRef.current = trades?.length ?? 0;
  }, [openTrade, inMemOpenTrade, trades]);

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
      enabledLayers: config.enabledLayers,
      partial1Pct: config.partial1Pct,
      partial2Pct: config.partial2Pct,
      averagingEnabled: localStorage.getItem("scalpbot_averaging_enabled") !== "false",
     averagingLossThreshold: parseInt(localStorage.getItem("scalpbot_averaging_threshold") ?? "20", 10) / 100,
     unlimitedTrades,
     useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
     openingBurstEnabled: localStorage.getItem("scalpbot_opening_burst") === "true",
      crudeOilCorrelation: localStorage.getItem("scalpbot_crude_correlation") === "true",
      adaptiveRegimeEnabled: localStorage.getItem("scalpbot_adaptive_regime") !== "false", // default ON
      slStrategy: (localStorage.getItem("scalpbot_sl_strategy") as "B" | "D") || "B",
   });
 };

  const handleStop = () => stopMutation.mutate({ sessionToken });

  const handleManualExit = () => {
    const trade = openTrade ?? (inMemOpenTrade ? { id: inMemOpenTrade.dbId, entryPrice: inMemOpenTrade.entryPrice, direction: inMemOpenTrade.direction, quantity: inMemOpenTrade.quantity } : null);
    if (!trade || !trade.id) { toast.error("No open trade to exit."); return; }
    // For options mode: use option premium price (not underlying spot) as exit price
    const exitPriceToUse = isIndexOptions
      ? (effectiveLivePrice > 0 ? effectiveLivePrice : 0)
      : currentPrice;
    if (!exitPriceToUse) { toast.error("No option premium price available. Wait for bot to fetch it, or use 'Close All Open' button."); return; }
    manualExitMutation.mutate({ sessionToken, tradeId: trade.id, exitPrice: exitPriceToUse });
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
    averageCount: (inMemOpenTrade as any).averageCount ?? 0,
    originalEntryPrice: (inMemOpenTrade as any).originalEntryPrice ?? inMemOpenTrade.entryPrice,
  } : openTrade ? { ...openTrade, upstoxOrderId: openTrade.upstoxOrderId ?? null } : null;

  // Only calculate unrealized P&L when we have a real live price (not 0, not same as entry)
  // For options mode, use option premium price for unrealized P&L; otherwise use underlying price
  // IMPORTANT: For options, NEVER use underlying price as fallback — it gives absurd P&L
  const effectiveLivePrice = (() => {
    if (!isIndexOptions) return currentPrice;
    // Priority: liveData optionPremiumPrice > livePrices optionPremiumPrice > NOTHING (no fake delta)
    if (optionPremiumPrice && optionPremiumPrice > 0) return optionPremiumPrice;
    const lpPrimary = livePricesData?.find(lp => lp.slot === 0);
    const lpOptPremium = (lpPrimary as any)?.optionPremiumPrice ?? 0;
    if (lpOptPremium > 0) return lpOptPremium;
    // NO delta approximation — it gives FAKE P&L. Return 0 → shows "—" in UI.
    return 0;
  })();
  const unrealizedPnl = activeTrade && effectiveLivePrice > 0
      ? activeTrade.direction === "BUY"
        ? (effectiveLivePrice - activeTrade.entryPrice) * activeTrade.quantity
        : (activeTrade.entryPrice - effectiveLivePrice) * activeTrade.quantity
      : null;

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const todayTradesCount = todayStats?.todayTrades ?? 0;
  const todayPnl = todayStats?.todayPnl ?? 0;
  const winRate = allStats && allStats.totalTrades > 0 ? `${allStats.winRate.toFixed(0)}%` : "—";
  const [showAllTrades, setShowAllTrades] = useState(false);
  const totalPnl = showAllTrades ? (allStats?.totalPnl ?? 0) : (todayStats?.todayPnl ?? 0);
  // Filter trades to show only today's by default
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const filteredTrades = useMemo(() => {
    if (showAllTrades) return trades;
    return trades.filter((t: any) => {
      const enteredAt = new Date(t.enteredAt).getTime();
      return enteredAt >= todayStart;
    });
  }, [trades, showAllTrades, todayStart]);


  // ── Auth Loading Gate ─────────────────────────────────────────────────────
  // Show loading screen while auth is being checked to prevent flash of dashboard content
  // This MUST be after all hooks to comply with React Rules of Hooks
  if (!meQuery.isFetched || meQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[oklch(0.10_0.02_240)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-teal-500 rounded-xl flex items-center justify-center animate-pulse">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <p className="text-white/50 text-sm">Loading ScalpBot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white flex flex-col md:flex-row">
      {/* ── Name Prompt Dialog ────────────────────────────────────────────────── */}
      {showNamePrompt && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-[oklch(0.15_0.02_240)] border border-teal-500/30 rounded-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-white text-center">What should we call you?</h3>
            <p className="text-white/50 text-sm text-center">Enter your name to personalize your experience</p>
            <input
              type="text"
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && nameInput.trim()) updateNameMutation.mutate({ name: nameInput.trim() }); }}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-teal-500/50"
              autoFocus
            />
            <button
              onClick={() => { if (nameInput.trim()) updateNameMutation.mutate({ name: nameInput.trim() }); }}
              disabled={!nameInput.trim() || updateNameMutation.isPending}
              className="w-full py-3 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg transition-all active:scale-[0.97] disabled:opacity-50"
            >
              {updateNameMutation.isPending ? "Saving..." : "Continue"}
            </button>
          </div>
        </div>
      )}
      {/* ── Subscription Paywall Overlay ─────────────────────────────────────── */}
      {accessQuery.data && !accessQuery.data.hasAccess && meQuery.data?.role !== "admin" && !accessQuery.data?.plan?.includes("yearly") && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[oklch(0.15_0.02_240)] border border-white/10 rounded-2xl p-8 text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-teal-500/20 rounded-full flex items-center justify-center">
              <ShieldAlert className="w-8 h-8 text-teal-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Subscription Required</h2>
            <p className="text-white/60 text-sm leading-relaxed">
              {accessQuery.data.trialUsed
                ? "Your free trial has expired. Subscribe to continue using ScalpBot for live and paper trading."
                : "Start your 2-day free trial to explore ScalpBot with paper trading on NSE (NIFTY/BANKNIFTY). No payment required."}
            </p>
            <div className="flex flex-col gap-3">
              {!accessQuery.data.trialUsed && (
                <button
                  onClick={() => startTrialMutation.mutate({ sessionToken })}
                  disabled={startTrialMutation.isPending}
                  className="w-full py-3 px-6 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg transition-all active:scale-[0.97] disabled:opacity-50"
                >
                  {startTrialMutation.isPending ? "Activating..." : "Start Free Trial (2 Days)"}
                </button>
              )}
              <button
                onClick={() => navigate("/")}
                className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg border border-white/20 transition-all active:scale-[0.97]"
              >
                View Pricing Plans
              </button>
              <button
                onClick={() => logoutMutation.mutate()}
                className="w-full py-2 px-6 text-white/40 hover:text-white/70 text-xs underline transition-colors"
              >
                Logout & Re-login
              </button>
            </div>
            <p className="text-white/30 text-xs">
              Trial: Paper trade NSE only | No MCX | No live trading
            </p>
          </div>
        </div>
      )}

     {/* ── Trial/Plan Banner ────────────────────────────────────────────────── */}
      {accessQuery.data?.hasAccess && accessQuery.data.plan === "trial" && !isAdmin && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-2 bg-teal-600 text-white text-sm font-medium shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              <strong>Free Trial</strong> — {accessQuery.data.daysLeft} day{accessQuery.data.daysLeft !== 1 ? "s" : ""} remaining.
              Paper trading NSE only.
            </span>
          </div>
          <button onClick={() => navigate("/")} className="shrink-0 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-md transition-colors">
            Upgrade
          </button>
        </div>
      )}
      {accessQuery.data?.hasAccess && accessQuery.data.plan && accessQuery.data.plan !== "trial" && !isAdmin && (
        <div className="fixed top-0 left-0 md:left-64 right-0 z-40 flex items-center gap-2 px-4 py-1.5 bg-emerald-600/80 text-white text-xs font-medium">
          <Award className="w-3.5 h-3.5" />
          <span>{accessQuery.data.plan.replace("_", " ").replace(/^\w/, (c: string) => c.toUpperCase())} Plan — {accessQuery.data.daysLeft} days left</span>
        </div>
      )}

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
      <aside className="hidden md:flex w-64 border-r border-white/10 flex-col p-4 gap-1.5 shrink-0 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2 mb-6 px-2">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm">ScalpBot</div>
            <div className="text-xs text-white/40">Upstox Trading</div>
          </div>
        </div>
        {/* Account Profile — top of sidebar */}
        {meQuery.data && (
          <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 mb-3">
            <div className="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center shrink-0">
              <span className="text-teal-400 font-bold text-[10px]">
                {meQuery.data.name?.charAt(0)?.toUpperCase() ?? meQuery.data.mobile?.slice(-2) ?? "U"}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white/80 font-medium truncate text-xs">{meQuery.data.name || meQuery.data.mobile}</div>
              <div className="text-white/40 text-[10px] font-mono">{meQuery.data.mobile}</div>
            </div>
            <button
              onClick={() => {
                if (confirm("Logout from ScalpBot?")) {
                  logoutMutation.mutate();
                }
              }}
              className="text-white/30 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
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
        <button onClick={() => navigate("/pnl-analytics?tab=verify")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-amber-400 hover:bg-amber-500/10 border border-amber-500/20">
          <span className="text-base">📊</span>
          Precision Verify
        </button>
        {/* Refer & Earn — visible to all users */}
        <ReferAndEarnSidebar sessionToken={sessionToken} />
        {/* Admin Panel — only visible to admin users */}
        {isAdmin && (
          <button onClick={() => setShowAdminPanel(!showAdminPanel)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${showAdminPanel ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-red-400 hover:bg-red-500/10 border border-red-500/20"}`}>
            <Shield className="w-4 h-4" />
            Admin Panel
          </button>
        )}
        <div className="mt-auto px-2 pb-2 space-y-2">
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
            <HealthDot
              status={botStatus?.status ?? "stopped"}
              lastTickAt={(botStatus as any)?.lastTickAt ?? 0}
              scanIntervalSec={(botStatus as any)?.scanIntervalSec ?? 60}
              lastError={(botStatus as any)?.lastError ?? null}
              onRestart={() => restartMutation.mutate({ sessionToken })}
            />
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
          {isMCXLateSessionMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 animate-pulse">
              <Moon className="w-3.5 h-3.5" />
              MCX Late Session
            </div>
          )}
          {heroZeroMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 animate-pulse">
              <span className="text-xs font-bold">0→H</span>
              Hero Zero Active
            </div>
          )}
          {openingBurstMode && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 animate-pulse">
              <Rocket className="w-3.5 h-3.5" />
              Opening Burst (9:15-9:25)
            </div>
          )}
          {reEntryCandles > 0 && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <RotateCcw className="w-3.5 h-3.5" />
              Re-entry cooldown ({reEntryCandles}/2)
            </div>
          )}
          {/* Adaptive Regime Badge */}
          {isRunning && currentRegime && (
            <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg ${
              currentRegime === "trending"
                ? "bg-teal-500/15 border border-teal-500/30 text-teal-400"
                : "bg-amber-500/15 border border-amber-500/30 text-amber-400"
            }`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              {currentRegime === "trending" ? "Trending" : "Choppy"} (ADX {currentADX?.toFixed(0) ?? "?"})
            </div>
          )}
          {/* VRP Regime Badge */}
          {isRunning && vrpRegime && (
            <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg ${
              vrpRegime === "RICH" ? "bg-green-500/15 border border-green-500/30 text-green-400"
              : vrpRegime === "FAIR" ? "bg-blue-500/15 border border-blue-500/30 text-blue-400"
              : vrpRegime === "CHEAP" ? "bg-amber-500/15 border border-amber-500/30 text-amber-400"
              : "bg-red-500/15 border border-red-500/30 text-red-400"
            }`}>
              <span className="text-[10px] font-bold">VRP</span>
              {vrpRegime} ({vrpValue?.toFixed(1) ?? "?"}%)
            </div>
          )}
          {/* OI Flow Badge */}
          {isRunning && oiFlowDirection && oiFlowDirection !== "NEUTRAL" && (
            <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg ${
              oiFlowDirection === "BUY"
                ? "bg-green-500/15 border border-green-500/30 text-green-400"
                : "bg-red-500/15 border border-red-500/30 text-red-400"
            }`}>
              <span className="text-[10px] font-bold">OI</span>
              {oiFlowDirection} ({oiFlowStrength ?? 0}%)
            </div>
          )}
          {/* Max Pain Badge */}
          {isRunning && maxPainStrike && maxPainStrike > 0 && (
            <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg ${
              maxPainBias === "UP" ? "bg-green-500/15 border border-green-500/30 text-green-400"
              : maxPainBias === "DOWN" ? "bg-red-500/15 border border-red-500/30 text-red-400"
              : "bg-white/5 border border-white/10 text-white/50"
            }`}>
              <span className="text-[10px] font-bold">MP</span>
              {maxPainStrike.toLocaleString()} {maxPainBias === "UP" ? "↑" : maxPainBias === "DOWN" ? "↓" : "—"}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      {showAdminPanel && meQuery.data?.role === "admin" ? (
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
      ) : (
      <PullToRefresh
        onRefresh={async () => {
          await Promise.all([
            utils.multiBots.allStatus.invalidate(),
            utils.multiBots.livePrices.invalidate(),
            utils.trades.list.invalidate(),
            utils.activity.log.invalidate(),
          ]);
        }}
        className="flex-1 p-3 sm:p-4 md:p-6 pb-20 md:pb-6"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-white/5 gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-white truncate">Trading Dashboard</h1>
            <p className="text-white/50 text-xs sm:text-sm truncate">Automated scalping — Multi-Layer Signal Engine</p>
          </div>
         <div className="flex items-center gap-2 sm:gap-3 flex-wrap shrink-0">
         <button onClick={() => navigate("/settings")}
             title={tokenHealthMessage ?? (tokenStatus === "valid" ? "Access Token: OK" : tokenStatus === "missing" ? "No Access Token" : "Token looks incomplete")}
             className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
               (tokenStatus === "valid" && tokenHealthStatus !== "expired") ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
               : tokenStatus === "missing" ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 animate-pulse"
               : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
             }`}>
             {(tokenStatus === "valid" && tokenHealthStatus === "valid") ? <><ShieldCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token OK ✓</span></>
              : (tokenHealthStatus === "expired") ? <><ShieldAlert className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token Expired!</span></>
              : tokenStatus === "valid" ? <><ShieldCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token OK</span></>
              : tokenStatus === "missing" ? <><ShieldOff className="w-3.5 h-3.5" /><span className="hidden sm:inline">No Token</span></>
              : <><ShieldAlert className="w-3.5 h-3.5" /><span className="hidden sm:inline">Token?</span></>}
           </button>
            <Badge variant="outline" className={`border-none text-sm px-3 py-1.5 font-bold ${config.mode === "paper" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`}>
              {config.mode === "paper" ? "🟡 PAPER MODE" : "🟢 LIVE"}
            </Badge>
          </div>
        </div>
        {/* ── Sticky Sub-Bar: Bot Status + Kill Switch ────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-4 px-3 sm:px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl text-xs">
          {/* Bot Running Status */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <span className={`font-semibold ${isRunning ? "text-emerald-400" : "text-white/40"}`}>Bot {isRunning ? "Running" : "Stopped"}</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          {/* Mode indicator */}
          <span className={`font-bold ${config.mode === "paper" ? "text-amber-400" : "text-emerald-400"}`}>
            {config.mode === "paper" ? "PAPER MODE — No real money" : "⚡ LIVE — Real trades"}
          </span>
          <div className="flex-1" />
          {/* KILL SWITCH — always visible, big red button */}
          <button
            onClick={() => { if (confirm("⚠️ KILL SWITCH\n\nThis will:\n• STOP all running bots\n• CLOSE all open positions at market\n• Cancel pending orders\n\nContinue?")) killSwitchMutation.mutate({ sessionToken }); }}
            disabled={killSwitchMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-600/30 hover:bg-red-600/50 border-2 border-red-500/60 text-red-300 rounded-lg font-black text-xs transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-900/20"
          >
            {killSwitchMutation.isPending ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> KILLING...</>
            ) : (
              <><Zap className="w-4 h-4" /> KILL SWITCH</>
            )}
          </button>
        </div>
        {/* ── Tab Navigation ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 mb-5 p-1 bg-white/5 rounded-xl border border-white/10 sticky top-0 z-20 overflow-x-auto">
          {([
            { id: "command" as const, label: "Command Center", icon: "🎯", path: "/dashboard" },
            { id: "trades" as const, label: "Trade Log", icon: "📊", path: "/dashboard/trades" },
            { id: "log" as const, label: "Activity Log", icon: "📜", path: "/dashboard/log" },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-teal-500/20 text-teal-400 border border-teal-500/30 shadow-sm"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
              }`}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {activeTab === "command" && (<>
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

        {/* ── Trading Mode Toggle (Paper / Live) ─────────────────────────────── */}
        <div className="flex items-center gap-4 mb-4 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <span className="text-xs text-white/50 font-medium">Trading Mode</span>
          <div className="flex rounded-lg overflow-hidden border border-white/20 h-[36px]">
            <button onClick={() => setConfig(c => ({ ...c, mode: "paper" }))} disabled={isRunning}
              className={`px-5 text-sm font-medium transition-colors ${config.mode === "paper" ? "bg-amber-500/30 text-amber-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Paper</button>
            <button onClick={() => setConfig(c => ({ ...c, mode: "live" }))} disabled={isRunning}
              className={`px-5 text-sm font-medium transition-colors ${config.mode === "live" ? "bg-red-500/30 text-red-400" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>Live</button>
          </div>
          <span className="text-xs text-white/30 ml-auto">{config.mode === "paper" ? "Simulated trades, no real money" : "⚠ Real orders via Upstox"}</span>
        </div>

        {/* Opening Burst Quick Toggle — 4 contextual states */}
        <div className="text-[10px] text-white/30 mb-1 ml-1">Scans for gap-up/gap-down trades during 9:15–9:25 AM window only</div>
        {(() => {
          const now = new Date();
          const burstIstMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
          const isBeforeWindow = burstIstMin < 555; // Before 9:15
          const isInWindow = burstIstMin >= 555 && burstIstMin <= 565; // 9:15-9:25
          const isAfterWindow = burstIstMin > 565; // After 9:25
          const enabled = config.openingBurstEnabled;

          // Determine state label and styling
          let stateLabel: React.ReactNode;
          let borderColor: string;
          let bgColor: string;

          if (!enabled) {
            stateLabel = <span className="text-white/30 text-xs">Opening Burst: Disabled</span>;
            borderColor = "border-white/10";
            bgColor = "bg-white/5";
          } else if (isBeforeWindow) {
            stateLabel = <span className="text-amber-400 text-xs">Opening Burst: Ready — activates at 9:15</span>;
            borderColor = "border-amber-500/30";
            bgColor = "bg-amber-500/5";
          } else if (isInWindow) {
            stateLabel = (
              <span className="text-emerald-400 text-xs flex items-center gap-1.5 animate-pulse">
                <Rocket className="w-3 h-3" />
                Burst Mode Active — scanning for gap
              </span>
            );
            borderColor = "border-emerald-500/40";
            bgColor = "bg-emerald-500/10";
          } else {
            stateLabel = <span className="text-white/25 text-xs">Opening Burst: Done for today</span>;
            borderColor = "border-white/5";
            bgColor = "bg-white/[0.02]";
          }

          return (
            <div className={`mb-4 flex flex-wrap items-center gap-2 sm:gap-3 ${bgColor} border ${borderColor} rounded-xl px-3 sm:px-4 py-2.5 transition-all duration-300`}>
              <div className="flex items-center gap-2">
                <span className={`text-base ${!enabled || isAfterWindow ? "opacity-30" : ""}`}>🚀</span>
                <span className={`text-sm font-medium ${!enabled || isAfterWindow ? "text-white/30" : "text-white/80"}`}>Opening Burst</span>
              </div>
              <button
                onClick={() => {
                  const current = localStorage.getItem("scalpbot_opening_burst") === "true";
                  localStorage.setItem("scalpbot_opening_burst", current ? "false" : "true");
                  setConfig(prev => ({ ...prev, openingBurstEnabled: !current }));
                }}
                className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                  enabled
                    ? "bg-emerald-500/60 border border-emerald-400/50"
                    : "bg-white/10 border border-white/20"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                  enabled
                    ? "translate-x-5 bg-emerald-300"
                    : "translate-x-0 bg-white/40"
                }`} />
              </button>
              <div className="ml-auto">
                {stateLabel}
              </div>
            </div>
          );
        })()}
        {/* Cross-Market Correlation: Crude Oil → NIFTY */}
        <div className="text-[10px] text-white/30 mb-1 ml-1">Crude Oil correlation filter — adjusts NIFTY signal confidence based on crude momentum</div>
        {(() => {
          const enabled = config.crudeOilCorrelation;
          const isMCXInstrument = config.instrumentToken.startsWith("MCX");
          // Only show for NIFTY/BANKNIFTY instruments (not MCX)
          if (isMCXInstrument) return null;
          return (
            <div className={`mb-4 flex flex-wrap items-center gap-2 sm:gap-3 ${enabled ? "bg-orange-500/5 border-orange-500/30" : "bg-white/5 border-white/10"} border rounded-xl px-3 sm:px-4 py-2.5 transition-all duration-300`}>
              <div className="flex items-center gap-2">
                <span className={`text-base ${!enabled ? "opacity-30" : ""}`}>🛢️</span>
                <span className={`text-sm font-medium ${!enabled ? "text-white/30" : "text-white/80"}`}>Crude Oil Correlation</span>
              </div>
              <button
                onClick={() => {
                  const current = localStorage.getItem("scalpbot_crude_correlation") === "true";
                  localStorage.setItem("scalpbot_crude_correlation", current ? "false" : "true");
                  setConfig(prev => ({ ...prev, crudeOilCorrelation: !current }));
                }}
                className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                  enabled
                    ? "bg-orange-500/60 border border-orange-400/50"
                    : "bg-white/10 border border-white/20"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                  enabled
                    ? "translate-x-5 bg-orange-300"
                    : "translate-x-0 bg-white/40"
                }`} />
              </button>
              <div className="ml-auto">
                {enabled
                  ? crudeOilBias && crudeOilBias.bias !== "Neutral"
                    ? <span className={`text-xs ${crudeOilBias.bias === "CrudeUp" ? "text-red-400" : "text-emerald-400"}`}>
                        Crude Oil: {crudeOilBias.changePct > 0 ? "+" : ""}{crudeOilBias.changePct.toFixed(1)}% {crudeOilBias.bias === "CrudeUp" ? "↑" : "↓"} ({crudeOilBias.bias === "CrudeUp" ? "Nifty bearish bias" : "Nifty bullish bias"})
                      </span>
                    : <span className="text-orange-400 text-xs">Active — Crude within ±1% (no bias)</span>
                  : <span className="text-white/30 text-xs">Cross-Market Correlation: OFF</span>
                }
              </div>
            </div>
          );
        })()}

        {/* Market Status Badge + Auto Square-Off Warning */}
        {(() => {
          const now = new Date();
          const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
          const isMCX = config.instrumentToken.startsWith("MCX");
          const inNSE = istMin >= 555 && istMin <= 930;
          const inMCX = istMin >= 540 && istMin <= 1410;
          const inSession = isMCX ? inMCX : inNSE;
          const squareOffMin = isMCX ? (23 * 60 + 25) : (15 * 60 + 25);
          const promptMin = isMCX ? (23 * 60 + 15) : (15 * 60 + 15); // Show carry-forward prompt 10 min before square-off
          const nearClose = istMin >= promptMin && istMin <= squareOffMin + 3; // Show until 3 min after square-off time (in case of delay)
          return (
            <>
              {!inSession && (
                <div className="mb-4 flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white/40 text-sm">
                  <span className="w-2 h-2 rounded-full bg-white/20 inline-block" />
                  <span>
                    {isMCX
                      ? <><strong>MCX market is closed</strong> — trading hours: 9:00 AM–11:30 PM IST (Mon–Fri). Bot will not generate signals outside market hours.</>  
                      : <><strong>NSE market is closed</strong> — trading hours: 9:15 AM–3:30 PM IST (Mon–Fri). Bot will not generate signals outside market hours.</>
                    }
                  </span>
                </div>
              )}
              {nearClose && activeTrade && (
                <div className="mb-4 bg-gradient-to-r from-amber-500/10 to-purple-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 text-amber-400 mb-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">Market Closing — Choose Action</span>
                    <span className="ml-auto text-xs text-white/40">Auto square-off at {isMCX ? "23:28" : "15:25"} IST</span>
                  </div>
                  {(() => {
                    const trade = activeTrade;
                    // Use effectiveLivePrice for options-safe P&L (option premium, not underlying)
                    const cfPrice = effectiveLivePrice > 0 ? effectiveLivePrice : currentPrice;
                    const unrealizedPnl = trade.direction === "BUY"
                      ? (cfPrice - trade.entryPrice) * trade.quantity
                      : (trade.entryPrice - cfPrice) * trade.quantity;
                    const totalPnl = unrealizedPnl + (trade.bookedPnl ?? 0);
                    const isCarryActive = botStatus?.carryForward ?? false;
                    return (
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <div className="flex items-center gap-4 text-white/70 text-xs">
                          <span>Entry: <strong className="text-white">₹{trade.entryPrice.toFixed(2)}</strong></span>
                          <span>LTP: <strong className="text-white">₹{cfPrice.toFixed(2)}</strong></span>
                          <span>Unrealized P&L: <strong className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(0)}</strong></span>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          {isCarryActive ? (
                            <span className="flex items-center gap-1.5 text-purple-300 text-xs bg-purple-500/15 border border-purple-500/30 rounded-lg px-3 py-1.5">
                              <Moon className="w-3.5 h-3.5" />
                              Carry Forward Active
                              <button
                                onClick={() => carryForwardMutation.mutate({ sessionToken, carryForward: false })}
                                className="ml-2 text-white/50 hover:text-white underline"
                              >Cancel</button>
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => carryForwardMutation.mutate({ sessionToken, carryForward: true })}
                                className="flex items-center gap-1.5 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                              >
                                <Moon className="w-3.5 h-3.5" />
                                Carry Forward
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm("Square off now at market price?")) {
                                    handleManualExit();
                                  }
                                }}
                                className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Square Off Now
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          );
        })()}

        {/* MARKET SESSION TIMER + BEST/WORST TRADE */}
        {(() => {
          const now2 = new Date();
          const istMin2 = ((now2.getUTCHours() * 60 + now2.getUTCMinutes()) + 330) % (24 * 60);
          const isMCXInstrument = config.instrumentToken.startsWith("MCX");
          const sessionStart = isMCXInstrument ? 540 : 555;
          const sessionEnd = isMCXInstrument ? 1410 : 930;
          const dayOfWeek = new Date(now2.getTime() + 330 * 60000).getUTCDay(); // IST day: 0=Sun, 6=Sat (must use getUTCDay since we already added IST offset)
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const inSessionNow = !isWeekend && istMin2 >= sessionStart && istMin2 <= sessionEnd;
          const elapsed = inSessionNow ? istMin2 - sessionStart : 0;
          const total = sessionEnd - sessionStart;
          const remaining = inSessionNow ? sessionEnd - istMin2 : 0;
          const progressPct = inSessionNow ? Math.min(100, (elapsed / total) * 100) : 0;
          const remainHrs = Math.floor(remaining / 60);
          const remainMins = remaining % 60;
          const closedToday2 = trades.filter((t: any) => t.status === "closed" && new Date(t.enteredAt).getTime() >= todayStart);
          const bestTrade = closedToday2.length > 0 ? closedToday2.reduce((best: any, t: any) => (t.pnl ?? 0) > (best.pnl ?? 0) ? t : best, closedToday2[0]) : null;
          const worstTrade = closedToday2.length > 0 ? closedToday2.reduce((worst: any, t: any) => (t.pnl ?? 0) < (worst.pnl ?? 0) ? t : worst, closedToday2[0]) : null;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] uppercase tracking-wide text-white/50">{isMCXInstrument ? "MCX" : "NSE"} Session</span>
                  {inSessionNow && <span className="ml-auto text-[10px] text-emerald-400 font-medium animate-pulse">LIVE</span>}
                </div>
                {inSessionNow ? (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-white/60">{remainHrs}h {remainMins}m remaining</span>
                      <span className="text-[10px] text-white/30">{Math.round(progressPct)}% elapsed</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-white/30">{isWeekend ? "Weekend — Market closed" : "Market closed"}</div>
                )}
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] uppercase tracking-wide text-white/50">Best Trade</span>
                </div>
                {bestTrade && (bestTrade.pnl ?? 0) > 0 ? (
                  <div>
                    <div className="text-lg font-bold text-emerald-400">+₹{(bestTrade.pnl ?? 0).toFixed(0)}</div>
                    <div className="text-[10px] text-white/30 truncate">{bestTrade.symbolLabel ?? bestTrade.symbol ?? "—"}</div>
                  </div>
                ) : (
                  <div className="text-xs text-white/30">No winning trades today</div>
                )}
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-[11px] uppercase tracking-wide text-white/50">Worst Trade</span>
                </div>
                {worstTrade && (worstTrade.pnl ?? 0) < 0 ? (
                  <div>
                    <div className="text-lg font-bold text-red-400">₹{(worstTrade.pnl ?? 0).toFixed(0)}</div>
                    <div className="text-[10px] text-white/30 truncate">{worstTrade.symbolLabel ?? worstTrade.symbol ?? "—"}</div>
                  </div>
                ) : (
                  <div className="text-xs text-white/30">No losing trades today</div>
                )}
              </div>
            </div>
          );
        })()}
        {/* Stats Row */}
        {/* ═══════════════════════════════════════════════════════════════════════════
            TOP METRICS STRIP — 5 cards: Realized, Unrealized, Win Rate, Avg Win, Profit Factor
        ═══════════════════════════════════════════════════════════════════════════ */}
        {(() => {
          // Compute derived metrics client-side from trades array
          const closedTrades = trades.filter((t: any) => t.status === "closed");
          const todayClosed = closedTrades.filter((t: any) => new Date(t.enteredAt).getTime() >= todayStart);
          const todayWins = todayClosed.filter((t: any) => (t.pnl ?? 0) > 0);
          const todayLosses = todayClosed.filter((t: any) => (t.pnl ?? 0) < 0);
          const grossProfit = todayWins.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
          const grossLoss = Math.abs(todayLosses.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0));
          const avgWin = todayWins.length > 0 ? grossProfit / todayWins.length : 0;
          const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
          const todayWinRate = todayClosed.length > 0 ? (todayWins.length / todayClosed.length) * 100 : 0;

          // Total unrealized across all open positions (all slots)
          let totalUnrealized = unrealizedPnl ?? 0;
          (allBots ?? []).forEach((bot: any) => {
            if (bot.slot === 0) return; // primary already counted
            const ot = bot.openTrade;
            if (!ot) return;
            const isOpts = ot.isIndexOptions ?? bot.isIndexOptions ?? false;
            const lpEntry = livePricesData?.find((lp: any) => lp.slot === bot.slot);
            let liveP = 0;
            if (isOpts) {
              liveP = (lpEntry as any)?.optionPremiumPrice ?? bot.optionPremiumPrice ?? 0;
              if (liveP === 0 && ot.entryUnderlyingPrice && (lpEntry?.livePrice ?? bot.lastPrice) > 0) {
                const curU = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                const move = curU - ot.entryUnderlyingPrice;
                const isCall = (ot.symbol ?? "").includes("CE") || (ot.symbolLabel ?? "").includes(" CE");
                liveP = Math.max(0.05, ot.entryPrice + (isCall ? move * 0.5 : -move * 0.5));
              }
            } else {
              liveP = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
            }
            if (liveP > 0) {
              const dir = ot.direction === "BUY" ? 1 : -1;
              totalUnrealized += (liveP - ot.entryPrice) * dir * (ot.quantity - (ot.bookedQty ?? 0));
            }
          });

          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-6 animate-in fade-in duration-500">
              {/* Realized P&L (Today) */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-teal-500/30 transition-all duration-200 hover:shadow-[0_0_20px_oklch(0.78_0.18_195/0.08)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px] uppercase tracking-wide">Realized P&L</span>
                  <DollarSign className={`w-3.5 h-3.5 ${todayPnl >= 0 ? "text-emerald-400" : "text-red-400"}`} />
                </div>
                <div className={`text-xl font-bold tabular-nums ${todayPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {todayPnl >= 0 ? "+" : ""}₹{todayPnl.toFixed(0)}
                </div>
                <div className="text-[10px] text-white/30 mt-0.5">{todayClosed.length} closed today</div>
              </div>

              {/* Unrealized P&L */}
              <div className={`bg-white/5 border rounded-2xl p-4 transition-all duration-200 ${totalUnrealized !== 0 ? "border-teal-500/20 shadow-[0_0_15px_oklch(0.78_0.18_195/0.05)]" : "border-white/10"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px] uppercase tracking-wide">Unrealized</span>
                  <Activity className={`w-3.5 h-3.5 ${totalUnrealized >= 0 ? "text-teal-400" : "text-red-400"}`} />
                </div>
                <div className={`text-xl font-bold tabular-nums ${totalUnrealized > 0 ? "text-teal-400" : totalUnrealized < 0 ? "text-red-400" : "text-white/40"}`}>
                  {totalUnrealized !== 0 ? `${totalUnrealized > 0 ? "+" : ""}₹${totalUnrealized.toFixed(0)}` : "—"}
                </div>
                <div className="text-[10px] text-white/30 mt-0.5">
                  {(allBots ?? []).filter((b: any) => b.openTrade).length + (activeTrade ? 1 : 0) > 0
                    ? `${(allBots ?? []).filter((b: any) => b.openTrade && b.slot > 0).length + (activeTrade ? 1 : 0)} open position(s)`
                    : "No open positions"}
                </div>
              </div>

              {/* Win Rate */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-all duration-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px] uppercase tracking-wide">Win Rate</span>
                  <CheckCircle className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="text-xl font-bold tabular-nums text-white">
                  {todayClosed.length > 0 ? `${todayWinRate.toFixed(0)}%` : winRate}
                </div>
                <div className="text-[10px] text-white/30 mt-0.5">
                  {todayWins.length}W / {todayLosses.length}L today
                </div>
              </div>

              {/* Avg Win */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-all duration-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px] uppercase tracking-wide">Avg Win</span>
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-xl font-bold tabular-nums text-emerald-400">
                  {avgWin > 0 ? `+₹${avgWin.toFixed(0)}` : "—"}
                </div>
                <div className="text-[10px] text-white/30 mt-0.5">per winning trade</div>
              </div>

              {/* Profit Factor */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-all duration-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white/50 text-[11px] uppercase tracking-wide">Profit Factor</span>
                  <BarChart2 className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className={`text-xl font-bold tabular-nums ${profitFactor >= 1.5 ? "text-emerald-400" : profitFactor >= 1 ? "text-amber-400" : profitFactor > 0 ? "text-red-400" : "text-white/40"}`}>
                  {profitFactor > 0 ? (profitFactor >= 99 ? "∞" : profitFactor.toFixed(2)) : "—"}
                </div>
                <div className="text-[10px] text-white/30 mt-0.5">gross profit / loss</div>
              </div>
            </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════════════════════
            OPEN POSITIONS PANEL
        ═══════════════════════════════════════════════════════════════════════════ */}
        <div className="mb-6">
          {/* Open Positions Panel — full width */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              <span className="font-semibold text-white text-sm">Open Positions</span>
            </div>
            {(() => {
              // Collect all open positions across all slots
              type OpenPos = { symbol: string; direction: string; entry: number; current: number; pnl: number; qty: number; slot: number; isOptions: boolean; openedAt?: number; instrumentToken?: string; optionTradeToken?: string };
             const positions: OpenPos[] = [];
             // Primary slot
              if (activeTrade) {
                const liveP = effectiveLivePrice > 0 ? effectiveLivePrice : activeTrade.entryPrice;
                const dir = activeTrade.direction === "BUY" ? 1 : -1;
                positions.push({
                  symbol: activeTrade.symbolLabel ?? config.instrumentLabel,
                  direction: activeTrade.direction,
                  entry: activeTrade.entryPrice,
                  current: liveP,
                  pnl: (liveP - activeTrade.entryPrice) * dir * activeTrade.quantity,
                  qty: activeTrade.quantity,
                  slot: 0,
                  isOptions: isIndexOptions,
                  openedAt: activeTrade.openedAt ?? activeTrade.entryTime,
                  instrumentToken: (activeTrade as any).instrumentToken ?? config.instrumentToken,
                  optionTradeToken: (inMemOpenTrade as any)?.optionTradeToken ?? null,
                });
              }
              // Secondary slots
              (allBots ?? []).forEach((bot: any) => {
                if (bot.slot === 0) return;
                const ot = bot.openTrade;
                if (!ot) return;
                // Check both openTrade-level AND bot-level isIndexOptions (handles legacy/DB-restored trades)
                const isOpts = ot.isIndexOptions ?? bot.isIndexOptions ?? false;
                const lpEntry = livePricesData?.find((lp: any) => lp.slot === bot.slot);
                let liveP = 0;
                if (isOpts) {
                  liveP = (lpEntry as any)?.optionPremiumPrice ?? bot.optionPremiumPrice ?? 0;
                  if (liveP === 0 && ot.entryUnderlyingPrice && (lpEntry?.livePrice ?? bot.lastPrice) > 0) {
                    const curU = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                    const move = curU - ot.entryUnderlyingPrice;
                    const isCall = (ot.symbol ?? "").includes("CE") || (ot.symbolLabel ?? "").includes(" CE");
                    liveP = Math.max(0.05, ot.entryPrice + (isCall ? move * 0.5 : -move * 0.5));
                  }
                } else {
                  liveP = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                }
                if (liveP > 0) {
                  const dir = ot.direction === "BUY" ? 1 : -1;
                  positions.push({
                    symbol: ot.symbolLabel ?? bot.instrumentLabel ?? `Bot ${bot.slot + 1}`,
                    direction: ot.direction,
                    entry: ot.entryPrice,
                    current: liveP,
                    pnl: (liveP - ot.entryPrice) * dir * (ot.quantity - (ot.bookedQty ?? 0)),
                    qty: ot.quantity - (ot.bookedQty ?? 0),
                    slot: bot.slot,
                    isOptions: isOpts,
                    openedAt: ot.openedAt ?? ot.entryTime,
                    instrumentToken: ot.instrumentToken ?? bot.instrumentToken ?? "",
                    optionTradeToken: bot.optionTradeToken ?? null,
                  });
                }
              });

              if (positions.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center h-24 gap-2">
                    <div className="text-white/40 text-sm">No open positions</div>
                    {isRunning && countdown > 0 && (
                      <div className="text-white/20 text-xs">Next scan in {countdown}s</div>
                    )}
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/40 border-b border-white/10">
                        <th className="text-left py-1.5 px-1 font-medium">Bot</th>
                        <th className="text-left py-1.5 px-1 font-medium">Symbol</th>
                        <th className="text-left py-1.5 px-1 font-medium">Dir</th>
                        <th className="text-right py-1.5 px-1 font-medium">Entry</th>
                        <th className="text-right py-1.5 px-1 font-medium">Current</th>
                        <th className="text-right py-1.5 px-1 font-medium">P&L</th>
                        <th className="text-right py-1.5 px-1 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos, idx) => {
                        const isPos = pos.pnl >= 0;
                        // Calculate duration from trade open time if available
                        const openTime = (pos as any).openedAt;
                        let durationStr = "—";
                        if (openTime) {
                          const elapsed = Math.floor((Date.now() - openTime) / 1000);
                          if (elapsed < 60) durationStr = `${elapsed}s`;
                          else if (elapsed < 3600) durationStr = `${Math.floor(elapsed / 60)}m`;
                          else durationStr = `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
                        }
                        return (
                          <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer active:scale-[0.98]"
                            onClick={() => {
                              // Deep-link to Upstox: try app first, fallback to web
                              const token = pos.optionTradeToken || pos.instrumentToken || "";
                              if (!token) return;
                              // Upstox Pro web chart URL format: https://pro.upstox.com/chart/{encoded_instrument_key}
                              const encodedToken = encodeURIComponent(token);
                              const webUrl = `https://pro.upstox.com/chart/${encodedToken}`;
                              // Try Android intent first (will silently fail on iOS/web)
                              const intentUrl = `upstox://instrument/${encodedToken}`;
                              // Use a hidden iframe to try the intent, fallback to web after timeout
                              const iframe = document.createElement("iframe");
                              iframe.style.display = "none";
                              iframe.src = intentUrl;
                              document.body.appendChild(iframe);
                              setTimeout(() => {
                                document.body.removeChild(iframe);
                                // If we're still here, the app didn't open — use web
                                window.open(webUrl, "_blank");
                              }, 1500);
                            }}
                          >
                            <td className="py-1.5 px-1 text-white/70">Bot {pos.slot + 1}</td>
                            <td className="py-1.5 px-1 text-white font-medium truncate max-w-[100px]">
                              <span className="flex items-center gap-1">
                                {pos.symbol}
                                <svg className="w-3 h-3 text-teal-400 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </span>
                            </td>
                            <td className="py-1.5 px-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.direction === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                {pos.direction}
                              </span>
                            </td>
                            <td className="py-1.5 px-1 text-right text-white/60 tabular-nums">₹{pos.entry.toFixed(2)}</td>
                            <td className="py-1.5 px-1 text-right text-white/80 tabular-nums">₹{pos.current.toFixed(2)}</td>
                            <td className={`py-1.5 px-1 text-right font-bold tabular-nums ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                              {isPos ? "+" : ""}₹{pos.pnl.toFixed(0)}
                            </td>
                            <td className="py-1.5 px-1 text-right text-white/40 tabular-nums">{durationStr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════════
            REDESIGNED BOT SLOT CARDS — 3 cards with clear Realized vs Unrealized
        ═══════════════════════════════════════════════════════════════════════════ */}
        <div className="text-[10px] text-white/30 mb-1.5 ml-1">Each bot slot runs independently on a different instrument — start/stop individually</div>
        <div className={`grid gap-2 sm:gap-3 mb-6 grid-cols-1 sm:grid-cols-2 ${(() => {
          const totalSlots = isAdmin ? 6 : 3 + ((accessQuery.data as any)?.extraBotSlots ?? 0);
          return totalSlots >= 5 ? "lg:grid-cols-3 xl:grid-cols-6" : totalSlots >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
        })()}`}>
          {((allBots && allBots.length > 0) ? allBots : (() => {
            const totalSlots = isAdmin ? 6 : 3 + ((accessQuery.data as any)?.extraBotSlots ?? 0);
            const slots = [];
            for (let i = 0; i < totalSlots; i++) {
              const tok = i === 0 ? sessionToken : `${sessionToken}-slot${i}`;
              slots.push({ sessionToken: tok, slot: i, status: "stopped", dailyPnl: 0, tradesCount: 0 });
            }
            return slots;
          })()).map((bot: any) => {
            const isActive = bot.status === "running";
            const slotLabel = `Bot ${bot.slot + 1}`;
            const slotClasses = bot.slot === 0
              ? { border: "border-teal-500/30", borderActive: "border-teal-500/40", bg: "bg-teal-500/5", badge: "bg-teal-500/20", text: "text-teal-300", glow: "shadow-[0_0_20px_oklch(0.78_0.18_195/0.06)]" }
              : bot.slot === 1
                ? { border: "border-purple-500/30", borderActive: "border-purple-500/40", bg: "bg-purple-500/5", badge: "bg-purple-500/20", text: "text-purple-300", glow: "shadow-[0_0_20px_oklch(0.7_0.15_280/0.06)]" }
                : bot.slot === 2
                  ? { border: "border-amber-500/30", borderActive: "border-amber-500/40", bg: "bg-amber-500/5", badge: "bg-amber-500/20", text: "text-amber-300", glow: "shadow-[0_0_20px_oklch(0.78_0.17_65/0.06)]" }
                  : bot.slot === 3
                    ? { border: "border-rose-500/30", borderActive: "border-rose-500/40", bg: "bg-rose-500/5", badge: "bg-rose-500/20", text: "text-rose-300", glow: "shadow-[0_0_20px_oklch(0.7_0.18_15/0.06)]" }
                    : bot.slot === 4
                      ? { border: "border-sky-500/30", borderActive: "border-sky-500/40", bg: "bg-sky-500/5", badge: "bg-sky-500/20", text: "text-sky-300", glow: "shadow-[0_0_20px_oklch(0.75_0.15_230/0.06)]" }
                      : { border: "border-emerald-500/30", borderActive: "border-emerald-500/40", bg: "bg-emerald-500/5", badge: "bg-emerald-500/20", text: "text-emerald-300", glow: "shadow-[0_0_20px_oklch(0.78_0.17_160/0.06)]" };
            const hasOpenTrade = !!bot.openTrade;
            const modeTag = bot.openingBurstMode ? "🚀 Opening Burst" : bot.isPowerHourMode ? "⚡ Power Hour" : bot.isMCXEveningMode ? "🌙 MCX Evening" : bot.isMCXLateSessionMode ? "🌃 MCX Late" : bot.heroZeroMode ? "🦸 Hero Zero" : null;

            return (
              <div key={bot.sessionToken} className={`rounded-xl sm:rounded-2xl border p-2 sm:p-4 transition-all duration-300 ${
                isActive && hasOpenTrade
                  ? `${slotClasses.borderActive} ${slotClasses.bg} ${slotClasses.glow}`
                  : isActive
                    ? `${slotClasses.border} bg-white/[0.02]`
                    : "border-white/10 bg-white/[0.02]"
              }`}>
                {/* Header: Slot label + Health + Stop */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isActive ? `${slotClasses.badge} ${slotClasses.text}` : "bg-white/10 text-white/40"
                    }`}>{slotLabel}</span>
                    {isActive && bot.pendingRestore && (
                      <span className="text-[10px] text-amber-300 animate-pulse" title="Server restarted — bot is being restored automatically">⟳ reconnecting</span>
                    )}
                    {isActive && !bot.pendingRestore && (
                      <HealthDot
                        status={bot.status}
                        lastTickAt={(bot as any).lastTickAt ?? 0}
                        scanIntervalSec={(bot as any).scanIntervalSec ?? 60}
                        lastError={(bot as any).lastError ?? null}
                        onRestart={() => restartMutation.mutate({ sessionToken: bot.sessionToken })}
                      />
                    )}
                    {modeTag && <span className="text-[10px] text-amber-300">{modeTag}</span>}
                  </div>
                  {isActive && (
                    <button
                      onClick={() => bot.slot === 0 ? stopMutation.mutate({ sessionToken }) : stopSecondaryMutation.mutate({ sessionToken, slot: bot.slot })}
                      className="text-red-400/60 hover:text-red-400 text-[10px] flex items-center gap-0.5 transition-colors"
                    >
                      <Square className="w-2.5 h-2.5" /> Stop
                    </button>
                  )}
                </div>

                {/* Instrument name */}
                {isActive ? (
                  <div className="flex items-center gap-1.5 mb-2">
                    <select
                      value={(() => {
                        // Reverse-map current instrument to dropdown value
                        const sym = (bot as any).instrumentSymbol ?? "";
                        if (["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "BANKEX", "MIDCPNIFTY"].includes(sym)) return sym;
                        if (sym.startsWith("MCX_")) return sym;
                        // Try matching by label
                        const lbl = (bot.instrumentLabel ?? "").toLowerCase();
                        if (lbl.includes("crude")) return "MCX_CRUDE";
                        if (lbl.includes("gold")) return "MCX_GOLD";
                        if (lbl.includes("silver")) return "MCX_SILVER";
                        if (lbl.includes("natural") || lbl.includes("natgas")) return "MCX_NATGAS";
                        if (lbl.includes("copper")) return "MCX_COPPER";
                        if (lbl.includes("bankex")) return "BANKEX";
                        if (lbl.includes("midcp") || lbl.includes("mid select")) return "MIDCPNIFTY";
                        if (lbl.includes("sensex")) return "SENSEX";
                        if (lbl.includes("banknifty") || lbl.includes("bank")) return "BANKNIFTY";
                        if (lbl.includes("finnifty") || lbl.includes("fin")) return "FINNIFTY";
                        if (lbl.includes("nifty")) return "NIFTY";
                        return sym || "NIFTY";
                      })()}
                      onChange={e => {
                        const newSym = e.target.value;
                        const cap = (bot as any).capital ?? config.capital ?? 50000;
                        handleInstrumentSwitch(bot.slot, newSym, cap);
                      }}
                      disabled={switchingSlot === bot.slot || !!bot.openTrade}
                      title={bot.openTrade ? "Close open trade before switching instrument" : "Switch instrument (will stop & restart bot)"}
                      className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-white text-[11px] font-semibold focus:outline-none focus:border-white/30 disabled:opacity-50 cursor-pointer appearance-none truncate"
                    >
                     <option value="NIFTY">Nifty 50</option>
                     <option value="BANKNIFTY">BankNifty</option>
                     <option value="FINNIFTY">FinNifty</option>
                     <option value="SENSEX">Sensex</option>
                     <option value="BANKEX">Bankex</option>
                     <option value="MIDCPNIFTY">MidcpNifty</option>
                      <option value="MCX_CRUDE" disabled={!hasMcxAccess}>{hasMcxAccess ? "Crude Oil" : "🔒 Crude Oil"}</option>
                      <option value="MCX_GOLD" disabled={!hasMcxAccess}>{hasMcxAccess ? "Gold" : "🔒 Gold"}</option>
                      <option value="MCX_SILVER" disabled={!hasMcxAccess}>{hasMcxAccess ? "Silver" : "🔒 Silver"}</option>
                      <option value="MCX_NATGAS" disabled={!hasMcxAccess}>{hasMcxAccess ? "Natural Gas" : "🔒 Natural Gas"}</option>
                      <option value="MCX_COPPER" disabled={!hasMcxAccess}>{hasMcxAccess ? "Copper" : "🔒 Copper"}</option>
                    </select>
                    <input
                      key={`cap-${bot.slot}-${(bot as any).capital ?? config.capital ?? 50000}`}
                      type="number"
                      defaultValue={(bot as any).capital ?? config.capital ?? 50000}
                      onBlur={e => {
                        const newCap = Number(e.target.value);
                        const currentCap = (bot as any).capital ?? config.capital ?? 50000;
                        if (newCap >= 5000 && newCap <= 5000000 && newCap !== currentCap) {
                          const sym = (() => {
                            const s = (bot as any).instrumentSymbol ?? "";
                            if (["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "BANKEX", "MIDCPNIFTY"].includes(s) || s.startsWith("MCX_")) return s;
                            const lbl = (bot.instrumentLabel ?? "").toLowerCase();
                            if (lbl.includes("crude")) return "MCX_CRUDE";
                            if (lbl.includes("gold")) return "MCX_GOLD";
                            if (lbl.includes("silver")) return "MCX_SILVER";
                            if (lbl.includes("natural")) return "MCX_NATGAS";
                            if (lbl.includes("copper")) return "MCX_COPPER";
                            if (lbl.includes("bankex")) return "BANKEX";
                            if (lbl.includes("midcp") || lbl.includes("mid select")) return "MIDCPNIFTY";
                            if (lbl.includes("sensex")) return "SENSEX";
                            if (lbl.includes("banknifty")) return "BANKNIFTY";
                            if (lbl.includes("finnifty")) return "FINNIFTY";
                            return "NIFTY";
                          })();
                          handleInstrumentSwitch(bot.slot, sym, newCap);
                        }
                      }}
                      disabled={switchingSlot === bot.slot || !!bot.openTrade}
                      min={5000} max={5000000}
                      step={10000}
                      className="w-[70px] bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-white text-[10px] font-mono focus:outline-none focus:border-white/30 disabled:opacity-50"
                    />
                    {switchingSlot === bot.slot && (
                      <span className="text-[10px] text-amber-300 animate-pulse">⟳</span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-white/40 mb-2">Inactive</div>
                )}

                {/* Live Price + Trades */}
                {isActive && (
                  <div className="flex items-center justify-between text-xs mb-2">
                    {(() => {
                      const lpEntry = livePricesData?.find((lp: any) => lp.slot === bot.slot);
                      const displayPrice = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                      const isLive = !!(lpEntry && lpEntry.livePrice > 0 && (Date.now() - lpEntry.updatedAt) < 15000);
                      return (
                        <span className="font-mono text-white/70">
                          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />}
                          ₹{displayPrice > 0 ? displayPrice.toFixed(2) : "—"}
                        </span>
                      );
                    })()}
                   <span className="text-white/40">{bot.tradesCount ?? 0} trades</span>
                    {!isAdmin && currentTierLimits.maxTradesPerDay > 0 && (
                      <span className={`text-[10px] ${(bot.tradesCount ?? 0) >= currentTierLimits.maxTradesPerDay ? "text-red-400" : "text-white/30"}`}>
                        ({bot.tradesCount ?? 0}/{currentTierLimits.maxTradesPerDay})
                      </span>
                    )}
                  </div>
                )}

                {/* Open trade mini-card OR scanning state */}
                {isActive && hasOpenTrade ? (
                  <div className={`rounded-lg border p-2.5 mb-2 ${
                    bot.openTrade.direction === "BUY" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
                  }`}>
                    <div className="text-[10px] text-white/50 mb-1 font-medium">● IN TRADE</div>
                    {(() => {
                      const ot = bot.openTrade;
                      const isOpts = ot.isIndexOptions ?? bot.isIndexOptions ?? false;
                      const lpEntry = livePricesData?.find((lp: any) => lp.slot === bot.slot);
                      let liveP = 0;
                      if (isOpts) {
                        liveP = (lpEntry as any)?.optionPremiumPrice ?? bot.optionPremiumPrice ?? 0;
                        if (liveP === 0 && ot.entryUnderlyingPrice && (lpEntry?.livePrice ?? bot.lastPrice) > 0) {
                          const curU = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                          const move = curU - ot.entryUnderlyingPrice;
                          const isCall = (ot.symbol ?? "").includes("CE") || (ot.symbolLabel ?? "").includes(" CE");
                          liveP = Math.max(0.05, ot.entryPrice + (isCall ? move * 0.5 : -move * 0.5));
                        }
                      } else {
                        liveP = lpEntry?.livePrice ?? bot.lastPrice ?? 0;
                      }
                      const dir = ot.direction === "BUY" ? 1 : -1;
                      const unrealised = liveP > 0 ? (liveP - ot.entryPrice) * dir * (ot.quantity - (ot.bookedQty ?? 0)) : 0;
                      const symbolShort = ot.symbolLabel ?? ot.symbol ?? "";
                      return (
                        <>
                          <div className="text-[11px] text-white/80 font-medium">
                            {ot.direction} {symbolShort.includes("CE") ? "CE" : symbolShort.includes("PE") ? "PE" : ""} ₹{ot.entryPrice?.toFixed(2)} → {liveP > 0 ? `₹${liveP.toFixed(2)}` : "…"}
                          </div>
                          <div className={`text-sm font-bold mt-1 tabular-nums ${unrealised >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {unrealised >= 0 ? "+" : ""}₹{unrealised.toFixed(0)}
                          </div>
                          <button
                            className="mt-1.5 text-[9px] text-teal-400/70 hover:text-teal-300 flex items-center gap-0.5 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              const token = bot.optionTradeToken || ot.instrumentToken || bot.instrumentToken || "";
                              if (!token) return;
                              const encoded = encodeURIComponent(token);
                              const webUrl = `https://pro.upstox.com/chart/${encoded}`;
                              const intentUrl = `upstox://instrument/${encoded}`;
                              const iframe = document.createElement("iframe");
                              iframe.style.display = "none";
                              iframe.src = intentUrl;
                              document.body.appendChild(iframe);
                              setTimeout(() => { document.body.removeChild(iframe); window.open(webUrl, "_blank"); }, 1500);
                            }}
                          >
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            View in Upstox
                          </button>
                        </>
                      );
                    })()}
                  </div>
                ) : isActive ? (
                  <div className="text-xs text-white/30 mb-2 py-1.5">
                    <div className="text-white/40">● No open position</div>
                    {bot.lastSignal?.reason && (
                      <div className="text-[10px] text-white/20 mt-0.5 truncate">{bot.lastSignal.direction} · {bot.lastSignal.reason}</div>
                    )}
                  </div>
                ) : null}

                {/* Realized Today — compact line */}
                {isActive && (
                  <div className="flex items-center justify-between text-[10px] border-t border-white/5 pt-1.5 mt-1">
                    <span className="text-white/30">Today</span>
                    <span className={`font-bold tabular-nums ${
                      (bot.dailyPnl ?? 0) > 0 ? "text-emerald-400" : (bot.dailyPnl ?? 0) < 0 ? "text-red-400" : "text-white/30"
                    }`}>{(bot.dailyPnl ?? 0) >= 0 ? "+" : ""}₹{(bot.dailyPnl ?? 0).toFixed(0)}</span>
                  </div>
                )}

                {/* Candle readiness */}
                {isActive && (() => {
                  const count = (bot as any).candlesCount ?? 0;
                  const hasReal = (bot as any).hasRealData ?? false;
                  const ready = count >= 20;
                  return (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 bg-white/10 rounded-full h-1 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${ready ? "bg-emerald-400" : "bg-amber-400"}`}
                          style={{ width: `${Math.min(100, (count / 20) * 100)}%` }} />
                      </div>
                      <span className={`text-[10px] ${ready ? "text-emerald-400" : "text-amber-400"}`}>
                        {ready ? "✓" : `${count}/20`}
                      </span>
                      <span className={`text-[10px] px-1 py-0.5 rounded ${hasReal ? "text-emerald-300" : "text-orange-300"}`}>
                        {hasReal ? "Live" : "Mock"}
                      </span>
                    </div>
                  );
                })()}

                {/* Quick Start for inactive secondary slots */}
                {!isActive && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                    <div className="text-[10px] text-white/40 font-medium">Quick Start</div>
                    <div className="flex gap-1 mb-2">
                      <button onClick={() => setShowScanner(null)}
                        className={`flex-1 text-[10px] py-1 rounded-l-lg border transition-colors ${
                          showScanner !== bot.slot ? "bg-purple-500/30 text-purple-200 border-purple-500/50" : "bg-white/5 text-white/40 border-white/10"
                        }`}>Pick</button>
                      <button onClick={() => { setShowScanner(bot.slot); setScanEnabled(true); refetchScan(); }}
                        className={`flex-1 text-[10px] py-1 rounded-r-lg border transition-colors ${
                          showScanner === bot.slot ? "bg-cyan-500/30 text-cyan-200 border-cyan-500/50" : "bg-white/5 text-white/40 border-white/10"
                        }`}>⚡ Scan</button>
                    </div>
                    {showScanner !== bot.slot ? (
                      <>
                        <div className="flex gap-2">
                          <select value={slotQS[bot.slot]?.symbol ?? "NIFTY"}
                           onChange={e => setSlotQS(s => ({ ...s, [bot.slot]: { ...s[bot.slot], symbol: e.target.value } }))}
                           className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-[10px] focus:outline-none">
                           <option value="NIFTY">NIFTY</option>
                           <option value="BANKNIFTY">BANKNIFTY</option>
                           <option value="FINNIFTY">FINNIFTY</option>
                           <option value="SENSEX">SENSEX</option>
                           <option value="BANKEX">BANKEX</option>
                           <option value="MIDCPNIFTY">MIDCPNIFTY</option>
                            <option value="MCX_CRUDE" disabled={!hasMcxAccess}>{hasMcxAccess ? "Crude Oil" : "🔒 Crude Oil"}</option>
                            <option value="MCX_GOLD" disabled={!hasMcxAccess}>{hasMcxAccess ? "Gold" : "🔒 Gold"}</option>
                            <option value="MCX_SILVER" disabled={!hasMcxAccess}>{hasMcxAccess ? "Silver" : "🔒 Silver"}</option>
                            <option value="MCX_NATGAS" disabled={!hasMcxAccess}>{hasMcxAccess ? "Natural Gas" : "🔒 Natural Gas"}</option>
                            <option value="MCX_COPPER" disabled={!hasMcxAccess}>{hasMcxAccess ? "Copper" : "🔒 Copper"}</option>
                          </select>
                          <input type="number" value={slotQS[bot.slot]?.capital ?? 50000}
                            onChange={e => setSlotQS(s => ({ ...s, [bot.slot]: { ...s[bot.slot], capital: Number(e.target.value) } }))}
                            min={5000} max={5000000} step={5000}
                            className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-[10px] focus:outline-none" />
                        </div>
                        <button onClick={() => handleQuickStart(bot.slot)} disabled={bot.slot === 0 ? startMutation.isPending : startSecondaryMutation.isPending}
                          className="w-full text-[10px] py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 transition-colors disabled:opacity-50">
                          {(bot.slot === 0 ? startMutation.isPending : startSecondaryMutation.isPending) ? "⏳" : `▶ Start (${config.mode === "live" ? "Live" : "Paper"})`}
                        </button>
                      </>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-white/40">
                            {scanLoading ? "Scanning…" : scanData ? `${scanData.results.length} found` : "Tap Scan"}
                          </span>
                          <button onClick={() => { setScanEnabled(true); refetchScan(); }} disabled={scanLoading}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 disabled:opacity-50">
                            {scanLoading ? "⏳" : "↺"}
                          </button>
                        </div>
                        {scanData && scanData.results.length > 0 && (
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {scanData.results.slice(0, 5).map((r: any, idx: number) => (
                              <div key={r.token}
                                className={`flex items-center gap-1.5 p-1.5 rounded-lg border cursor-pointer transition-colors text-[10px] ${
                                  r.isActionable ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20" : "bg-white/3 border-white/10 opacity-60"
                                }`}
                                onClick={() => {
                                  if (!r.isActionable) return;
                                  const tg = JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "{}");
                                  if (bot.slot === 0) {
                                    startMutation.mutate({
                                      sessionToken,
                                      instrumentToken: r.token, instrumentSymbol: r.symbol, instrumentLabel: r.label,
                                      mode: config.mode, capital: slotQS[bot.slot]?.capital ?? 50000,
                                      riskPerTradePct: 1.5, maxTradesPerDay: 5, dailyLossLimitPct: 3,
                                      stopLossMultiplier: 1.5, targetMultiplier: 2.5, minConfidence: 60, scanIntervalSec: 30,
                                      lotSize: r.lotSize, isIndexOptions: true, underlyingToken: r.token,
                                      enabledLayers: config.enabledLayers,
                                      partial1Pct: config.partial1Pct, partial2Pct: config.partial2Pct,
                                      trailingSlEnabled: config.trailingSlEnabled, trailingSlPct: config.trailingSlPct,
                                      averagingEnabled: localStorage.getItem("scalpbot_averaging_enabled") !== "false",
                                      averagingLossThreshold: parseInt(localStorage.getItem("scalpbot_averaging_threshold") ?? "20", 10) / 100,
                                      useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
                                      unlimitedTrades,
                                    });
                                  } else {
                                    startSecondaryMutation.mutate({
                                      sessionToken, slot: bot.slot as 1 | 2 | 3,
                                      instrumentToken: r.token, instrumentSymbol: r.symbol, instrumentLabel: r.label,
                                      mode: config.mode, capital: slotQS[bot.slot]?.capital ?? 50000,
                                      riskPerTradePct: 1.5, maxTradesPerDay: 5, dailyLossLimitPct: 3,
                                      stopLossMultiplier: 1.5, targetMultiplier: 2.5, minConfidence: 60, scanIntervalSec: 30,
                                      lotSize: r.lotSize, isIndexOptions: true, underlyingToken: r.token,
                                      telegramBotToken: tg.botToken ?? "", telegramChatId: tg.chatId ?? "", telegramEnabled: tg.enabled ?? false,
                                      partial1Pct: config.partial1Pct, partial2Pct: config.partial2Pct,
                                      trailingSlEnabled: config.trailingSlEnabled, trailingSlPct: config.trailingSlPct, enabledLayers: config.enabledLayers,
                                      useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true",
                                      unlimitedTrades,
                                    });
                                  }
                                }}>
                                <span className="text-white/50 w-3">{idx + 1}</span>
                                <span className="text-white truncate flex-1">{r.label.replace(/ → (?:ATM|OTM) Options.*/, "")}</span>
                                <span className={r.direction === "BUY" ? "text-green-400 font-bold" : r.direction === "SELL" ? "text-red-400 font-bold" : "text-white/40"}>{r.direction}</span>
                                {r.isActionable && <span className="text-green-300">▶</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Risk & Portfolio Command Center ─────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Market Risk Score */}
          <div className={`rounded-2xl p-4 border ${
            riskScore?.safe ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">Market Risk Score</span>
              <Gauge className={`w-4 h-4 ${riskScore?.safe ? "text-emerald-400" : "text-red-400"}`} />
            </div>
            <div className={`text-2xl font-bold ${riskScore?.safe ? "text-emerald-400" : "text-red-400"}`}>
              {riskScore?.score ?? "—"}<span className="text-sm text-white/30">/100</span>
            </div>
            <div className="text-xs text-white/40 mt-1">
              {riskScore?.regime ?? "—"} · VIX: {riskScore?.vixLevel?.toFixed(1) ?? "—"}
            </div>
            {riskScore && !riskScore.safe && (
              <div className="text-xs text-red-400 mt-1 font-medium">{riskScore.reasons?.[0] ?? "Unsafe"}</div>
            )}
            {cooldownInfo?.active && (
              <div className="text-xs text-amber-400 mt-1">Cooldown: {Math.ceil((cooldownInfo.remainingMs ?? 0) / 1000)}s</div>
            )}
          </div>

          {/* Portfolio Exposure */}
          <div className={`rounded-2xl p-4 border ${
            (portfolioStatus?.exposurePct ?? 0) > 80 ? "bg-red-500/5 border-red-500/20" : "bg-white/5 border-white/10"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">Portfolio Exposure</span>
              <Shield className={`w-4 h-4 ${(portfolioStatus?.exposurePct ?? 0) > 80 ? "text-red-400" : "text-teal-400"}`} />
            </div>
            <div className="text-2xl font-bold text-white">
              {(portfolioStatus?.exposurePct ?? 0).toFixed(0)}%
            </div>
            <div className="text-xs text-white/40 mt-1">
              {portfolioStatus?.runningBots ?? 0} bots · ₹{((portfolioStatus?.totalExposure ?? 0) / 1000).toFixed(1)}K used
            </div>
            {portfolioStatus?.isHalted && (
              <div className="text-xs text-red-400 mt-1 font-medium">DRAWDOWN HALT</div>
            )}
          </div>

          {/* Aggregate Daily P&L */}
          <div className="rounded-2xl p-4 border bg-white/5 border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">Aggregate Daily P&L</span>
              <DollarSign className={`w-4 h-4 ${(portfolioStatus?.aggregateDailyPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`} />
            </div>
            <div className={`text-2xl font-bold ${(portfolioStatus?.aggregateDailyPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {(portfolioStatus?.aggregateDailyPnl ?? 0) >= 0 ? "+" : ""}₹{(portfolioStatus?.aggregateDailyPnl ?? 0).toFixed(0)}
            </div>
            <div className="text-xs text-white/40 mt-1">
              Across all {portfolioStatus?.runningBots ?? 0} active slot(s)
            </div>
          </div>

          {/* Readiness */}
          <div className="rounded-2xl p-4 border bg-white/5 border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">System Readiness</span>
              <Award className="w-4 h-4 text-emerald-400" />
            </div>
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
              readinessData?.ready ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-amber-500/10 border border-amber-500/20"
            }`}>
              <Award className={`w-4 h-4 ${readinessData?.ready ? "text-emerald-400" : "text-amber-400"}`} />
              <span className={`text-xs font-medium ${readinessData?.ready ? "text-emerald-400" : "text-amber-400"}`}>
                {readinessData?.ready ? "Ready to Go Live!" : `Readiness: ${readinessData?.score ?? 0}%`}
              </span>
            </div>
          </div>
        </div>

        {/* Account Balance & Profile Widget */}

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

        {/* MCX Late Session Banner */}
        {isMCXLateSessionMode && (
          <div className="mb-4 flex items-center gap-3 bg-gradient-to-r from-indigo-500/15 to-purple-500/10 border border-indigo-500/30 rounded-2xl px-5 py-3.5">
            <Moon className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="text-indigo-300 font-semibold text-sm">🌃 MCX Late Session — 9:30 to 11:20 PM IST</div>
              <div className="text-indigo-400/70 text-xs mt-0.5">Momentum continuation window. Catches strong directional moves that started during US open and continue into late session. Uses ROC, EMA slope &amp; ADX for trend-following entries. No pullback required — rides the wave.</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-indigo-400/60">Strategy</div>
              <div className="text-indigo-300 font-bold text-sm">MCXLate</div>
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

          {/* Price Chart — Real Candlestick */}
          <div className="lg:col-span-3 bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-white/40 uppercase tracking-wider">Live Price — {config.instrumentSymbol} (1m candles)</div>
              {(liveData?.candles?.length ?? 0) > 0 && (
                <span className="text-[10px] text-emerald-400/60">{liveData?.candles?.length} candles</span>
              )}
            </div>
            {(liveData?.candles?.length ?? 0) < 2 ? (
              <div className="flex flex-col items-center justify-center h-[200px] gap-2">
                <div className="text-white/30 text-sm">{isRunning ? "Collecting candles..." : "Start bot to see live chart"}</div>
                <div className="text-white/20 text-xs">Uses real-time Upstox price feed</div>
              </div>
            ) : (
              <CandlestickChart
                candles={liveData?.candles ?? []}
                height={200}
                entryPrice={activeTrade?.entryPrice}
                slPrice={activeTrade?.currentSl ?? activeTrade?.slPrice}
                targetPrice={activeTrade?.targetPrice}
              />
            )}
          </div>
        </div>
        {/* ═══ REJECTED SIGNALS FEED ═══ */}
        {recentRejectedSignals.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Ban className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">Recent Rejected Signals</span>
              <span className="text-[10px] text-white/30 ml-auto">{recentRejectedSignals.length} signals</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {recentRejectedSignals.slice().reverse().map((rs: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${rs.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{rs.direction}</span>
                    <span className="text-white/40">{rs.layer}</span>
                    <span className="text-white/20">|</span>
                    <span className="text-white/50">{rs.confidence}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400/80 text-[10px] max-w-[180px] truncate">{rs.rejectReason}</span>
                    <span className="text-white/20 text-[10px]">{new Date(rs.rejectedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open Trade Panel */}
        {activeTrade && (
          <div className="bg-white/5 border border-teal-500/30 rounded-2xl p-5 mb-6 shadow-[0_0_30px_oklch(0.78_0.18_195/0.08)] transition-all">
            {/* Warning: bot not running — SL/Target not being monitored */}
            {!isRunning && (
              <div className="flex items-start justify-between gap-3 bg-red-500/15 border border-red-500/40 rounded-xl p-3 mb-4">
                <div className="flex items-start gap-3">
                  <span className="text-red-400 text-lg mt-0.5">&#9888;</span>
                  <div>
                    <p className="text-red-400 font-semibold text-sm">Bot is not running — SL &amp; Target are NOT being monitored</p>
                    <p className="text-red-300/70 text-xs mt-0.5">Live price and unrealized P&amp;L will not update until you restart the bot. In live mode this means your stop-loss will not trigger automatically.</p>
                  </div>
                </div>
                <button
                  onClick={() => restartMutation.mutate({ sessionToken })}
                  disabled={restartMutation.isPending}
                  className="shrink-0 flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/35 border border-red-500/50 text-red-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {restartMutation.isPending ? (
                    <span className="animate-spin text-xs">↻</span>
                  ) : (
                    <span>↻</span>
                  )}
                  Restart Bot
                </button>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${activeTrade.direction === "BUY" ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="font-semibold text-white">Open Trade</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${activeTrade.direction === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {activeTrade.direction}
                  </span>
                </div>
                {/* Option name — shown prominently when in options mode */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-teal-300">
                    {activeTrade.symbolLabel ?? ('symbol' in activeTrade ? activeTrade.symbol : null) ?? config.instrumentLabel}
                  </span>
                  {isIndexOptions && effectiveLivePrice > 0 && (
                    <span className="text-xs bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full">
                      Premium ₹{effectiveLivePrice.toFixed(1)}{!optionPremiumPrice || optionPremiumPrice === 0 ? " ~" : ""}
                    </span>
                  )}
                  {isIndexOptions && currentPrice > 0 && (
                    <span className="text-xs text-white/30">
                      Underlying ₹{currentPrice.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {unrealizedPnl !== null && (
                  <span className={`text-lg font-bold ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {unrealizedPnl >= 0 ? "+" : ""}₹{unrealizedPnl.toFixed(0)}
                  </span>
                )}
                {/* Deep-link to Upstox chart — works for both paper and live */}
                <button
                  onClick={() => {
                    const token = (inMemOpenTrade as any)?.optionTradeToken || (activeTrade as any).instrumentToken || config.instrumentToken || "";
                    if (!token) return;
                    const encoded = encodeURIComponent(token);
                    const webUrl = `https://pro.upstox.com/chart/${encoded}`;
                    const intentUrl = `upstox://instrument/${encoded}`;
                    const iframe = document.createElement("iframe");
                    iframe.style.display = "none";
                    iframe.src = intentUrl;
                    document.body.appendChild(iframe);
                    setTimeout(() => { document.body.removeChild(iframe); window.open(webUrl, "_blank"); }, 1500);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 transition-colors"
                  title="Open chart in Upstox app or web"
                >
                  <ExternalLink className="w-4 h-4" />
                  Chart
                </button>
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
              {(() => {
                // In options mode: Entry/Current/SL/Target are all in option premium space
                // currentPrice is the underlying — use effectiveLivePrice (already includes all fallbacks)
                const displayCurrent = isIndexOptions
                  ? (effectiveLivePrice > 0 ? effectiveLivePrice : null)
                  : (currentPrice > 0 ? currentPrice : null);
                const currentLabel = isIndexOptions ? "Premium Now" : "Current";
                const currentColor = displayCurrent && displayCurrent > activeTrade.entryPrice
                  ? "text-emerald-400"
                  : displayCurrent && displayCurrent < activeTrade.entryPrice
                  ? "text-red-400" : "text-white/40";
                return [
                  { label: "Entry", value: activeTrade.entryPrice, color: "text-white" },
                  { label: currentLabel, value: displayCurrent, color: currentColor },
                  { label: "Stop Loss", value: activeTrade.slPrice, color: "text-red-400" },
                  { label: "Target", value: activeTrade.targetPrice, color: "text-emerald-400" },
                ].map(item => (
                  <div key={item.label} className="bg-white/5 rounded-xl p-3 text-center">
                    <div className="text-xs text-white/40 mb-1">{item.label}</div>
                    <div className={`font-mono font-bold text-sm ${item.color}`}>
                      {item.value ? `₹${item.value.toFixed(2)}` : "—"}
                    </div>
                  </div>
                ));
              })()}
            </div>
            {/* Averaging Status Indicator */}
            {(activeTrade as any).averageCount > 0 ? (
              <div className="flex items-center gap-3 bg-purple-500/10 border border-purple-500/30 rounded-xl px-4 py-2.5 mb-3">
                <ArrowDownUp className="w-4 h-4 text-purple-400 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-purple-400">AVERAGED</span>
                    <span className="text-[10px] text-white/30">Original: ₹{((activeTrade as any).originalEntryPrice ?? activeTrade.entryPrice).toFixed(2)}</span>
                    <span className="text-[10px] text-white/30">→ New Avg: ₹{activeTrade.entryPrice.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-white/40 mt-0.5">Qty: {activeTrade.quantity} (doubled) | Extended hold: 30 min</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => forceAverageMutation.mutate({ sessionToken })}
                  disabled={forceAverageMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/40 hover:border-purple-400 text-purple-300 rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" />
                  {forceAverageMutation.isPending ? "Averaging..." : "Force Average"}
                </button>
                <span className="text-[10px] text-white/30">Buy more at current price to lower avg entry</span>
              </div>
            )}

            {/* Progress bar — SL on left, Entry in middle, Target on right */}
            {activeTrade.slPrice && activeTrade.targetPrice && (
              <div className="mb-3">
                {(() => {
                  const sl = activeTrade.slPrice!;
                  const tgt = activeTrade.targetPrice!;
                  const entry = activeTrade.entryPrice;
                  const range = Math.abs(tgt - sl) || 1; // prevent division by zero
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
              {(activeTrade as any).signalLayer && (
                <span>Layer: <span className="text-purple-400">{(activeTrade as any).signalLayer}</span></span>
              )}
              {activeTrade.slPrice && activeTrade.targetPrice && (
                <span>R:R <span className="text-white">{(Math.abs(activeTrade.targetPrice - activeTrade.entryPrice) / Math.abs(activeTrade.slPrice - activeTrade.entryPrice)).toFixed(1)}:1</span></span>
              )}
              {(activeTrade as any).signalReason && (
                <span className="text-white/30 italic text-xs truncate max-w-xs" title={(activeTrade as any).signalReason}>{(activeTrade as any).signalReason}</span>
              )}
            </div>
          </div>
        )}

        </>)}
        {activeTab === "trades" && (<>

        {/* ── Layer Scorecard ──────────────────────────────────────────────────── */}
        {meQuery.data?.role === "admin" && layerStats.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-cyan-400" />
              <span className="font-semibold text-white">Strategy Layer Scorecard</span>
              <span className="text-xs text-white/40">Auto-disables layers below 30% win rate (last 20 trades)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="text-left py-2 px-2">Layer</th>
                    <th className="text-center py-2 px-2">Trades</th>
                    <th className="text-center py-2 px-2">W/L</th>
                    <th className="text-center py-2 px-2">Win Rate</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-center py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {layerStats.map((l) => (
                    <tr key={l.layer} className={`border-b border-white/5 ${l.disabled ? "opacity-50" : ""}`}>
                      <td className="py-2 px-2 text-white font-medium">{l.layer}</td>
                      <td className="py-2 px-2 text-center text-white/60">{l.totalTrades}</td>
                      <td className="py-2 px-2 text-center text-white/60">{l.wins}/{l.losses}</td>
                      <td className={`py-2 px-2 text-center font-bold ${l.winRate >= 50 ? "text-emerald-400" : l.winRate >= 30 ? "text-amber-400" : "text-red-400"}`}>
                        {l.winRate.toFixed(0)}%
                      </td>
                      <td className={`py-2 px-2 text-right font-bold ${l.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {l.totalPnl >= 0 ? "+" : ""}₹{l.totalPnl.toFixed(0)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {l.disabled ? (
                          <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold">DISABLED</span>
                        ) : (
                          <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold">ACTIVE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Trade Log */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-teal-400" />
              <span className="font-semibold text-white">Trade Log</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-[10px] text-white/25 hidden lg:inline">Paper trades unless Live mode + valid token</span>
              <span className="text-white/40">Total: <span className="text-white">{showAllTrades ? (allStats?.totalTrades ?? 0) : (todayStats?.todayTrades ?? 0)}</span></span>
              <span className="text-emerald-400">Wins: {showAllTrades ? (allStats?.wins ?? 0) : (todayStats?.wins ?? 0)}</span>
              <span className="text-red-400">Losses: {showAllTrades ? (allStats?.losses ?? 0) : (todayStats?.losses ?? 0)}</span>
              <span className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>P&L: {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(0)}</span>
              <button
                onClick={() => setShowAllTrades(!showAllTrades)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition ${showAllTrades ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/10 text-white/60 border border-white/10"}`}
              >
                {showAllTrades ? "All Time" : "Today"}
              </button>
              <button
                onClick={() => {
                  if (trades.length === 0) { toast.info("No trades to export."); return; }
                  const headers = ["Entry Date", "Exit Date", "Symbol", "Direction", "Mode", "Entry Price", "SL Price", "Target Price", "Exit Price", "Quantity", "Capital Used", "P&L (INR)", "P&L %", "Status", "Exit Reason"];
                  const rows = trades.map((t: typeof trades[0]) => [
                    t.enteredAt ? new Date(t.enteredAt).toLocaleString("en-IN") : "",
                    t.exitedAt ? new Date(t.exitedAt).toLocaleString("en-IN") : "",
                    t.symbolLabel ?? t.symbol,
                    t.direction,
                    t.mode,
                    t.entryPrice.toFixed(2),
                    (t as any).slPrice ? (t as any).slPrice.toFixed(2) : "",
                    (t as any).targetPrice ? (t as any).targetPrice.toFixed(2) : "",
                    t.exitPrice ? t.exitPrice.toFixed(2) : "",
                    t.quantity,
                    (t.entryPrice * t.quantity).toFixed(2),
                    t.pnl !== null && t.pnl !== undefined ? t.pnl.toFixed(2) : "",
                    (t as any).pnlPct !== null && (t as any).pnlPct !== undefined ? (t as any).pnlPct.toFixed(2) : "",
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
              <button
                onClick={() => {
                  if (!confirm("Recalculate and fix the P&L counter from actual closed trades? This does NOT delete any trades.")) return;
                  resetPnlMutation.mutate({ sessionToken });
                }}
                className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Fix P&L counter if it shows wrong total"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Fix P&L
              </button>
              <button
                onClick={() => {
                  const openCount = trades.filter((t: any) => t.status === "open").length;
                  if (openCount === 0) { toast.info("No open trades to close."); return; }
                  if (!confirm(`Close all ${openCount} open trade(s) at entry price (P\&L = 0)? This cannot be undone.`)) return;
                  closeAllOpenMutation.mutate({ sessionToken });
                }}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Force-close all open trades at entry price"
              >
                <XCircle className="w-3.5 h-3.5" />
                Close All Open
              </button>
              <button
                onClick={() => {
                  if (!confirm("DELETE ALL trade history, sessions, and signal journal? This cannot be undone. You will start completely fresh.")) return;
                  clearAllHistoryMutation.mutate();
                }}
                className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Delete ALL trade history and start fresh"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All History
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10 sticky top-0 bg-[oklch(0.10_0.02_240)]">
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-left py-2 pr-4">Direction</th>
                  <th className="text-left py-2 pr-4">Mode</th>
                  <th className="text-left py-2 pr-4">Entry Time</th>
                  <th className="text-left py-2 pr-4">Exit Time</th>
                  <th className="text-right py-2 pr-4">Entry</th>
                  <th className="text-right py-2 pr-4">SL</th>
                  <th className="text-right py-2 pr-4">Target</th>
                  <th className="text-right py-2 pr-4">Exit</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2 pr-4">Lots</th>
                  <th className="text-right py-2 pr-4">Capital</th>
                  <th className="text-right py-2 pr-4">P&L</th>
                  <th className="text-center py-2 pr-4">Partial</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-right py-2">Del</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                      <tr><td colSpan={15} className="text-center text-white/30 py-8">No trades yet. Start the bot to begin.</td></tr>
                ) : (
                  filteredTrades.slice(0, 30).map((t: typeof trades[0]) => {
                    // Compute live P&L for open trades
                    // For slot 1/2 trades, use that slot's lastPrice from allBots instead of primary currentPrice
                    const tradeSlot = (t as any).botSlot ?? 0;
                    const slotBot = tradeSlot > 0
                      ? (allBots ?? []).find(b => b.slot === tradeSlot)
                      : null;
                    // Use livePricesData for more real-time price (updates every 5s)
                    const lpSlot = livePricesData?.find(lp => lp.slot === tradeSlot);
                    const slotLastPrice = lpSlot?.livePrice ?? slotBot?.lastPrice ?? 0;
                    // For primary slot: use currentPrice (live data) or livePrices; for other slots: use livePrices
                    const slotEffectivePrice = tradeSlot === 0
                      ? (lpSlot?.livePrice ?? currentPrice)
                      : slotLastPrice;
                    // In options mode use option premium price from multiple sources:
                    // 1. livePrices endpoint (updates every 5s, now includes optionPremiumPrice)
                    // 2. allBots data (from full tick cycle)
                    // 3. Delta approximation fallback (when bot hasn't ticked or isn't running)
                    const lpOptionPremium = (lpSlot as any)?.optionPremiumPrice ?? 0;
                    const slotOptionPremium = lpOptionPremium || (slotBot?.optionPremiumPrice ?? 0);
                    // Detect if this trade is an options trade (symbol contains CE or PE)
                    const isOptionTrade = (t.symbol ?? "").includes("CE") || (t.symbol ?? "").includes("PE") ||
                      (t.symbolLabel ?? "").includes(" CE") || (t.symbolLabel ?? "").includes(" PE");
                    // For options trades: ONLY use option premium price, NEVER fall back to underlying
                    // Using underlying price (e.g. 7700) with option entry (e.g. 252) gives absurd P&L
                    let liveEffectivePrice = 0;
                    if (isOptionTrade) {
                      // Options: use option premium price from best available source
                      // Source priority: liveData optionPremiumPrice > livePrices optionPremiumPrice > allBots optionPremiumPrice
                      if (tradeSlot === 0 && optionPremiumPrice && optionPremiumPrice > 0) {
                        liveEffectivePrice = optionPremiumPrice;
                      } else if (tradeSlot === 0 && lpOptionPremium > 0) {
                        liveEffectivePrice = lpOptionPremium;
                      } else if (tradeSlot > 0 && slotOptionPremium > 0) {
                        liveEffectivePrice = slotOptionPremium;
                      }
                      // NO delta approximation fallback — it gives FAKE P&L.
                      // If liveEffectivePrice is still 0, livePnl will show stored DB pnl (for closed) or 0 (for open).
                    } else {
                      // Non-options: use underlying/futures price as before
                      liveEffectivePrice = slotEffectivePrice;
                    }
                    const livePnl = t.status === "open" && liveEffectivePrice > 0
                      ? t.direction === "BUY"
                        ? (liveEffectivePrice - t.entryPrice) * (t.quantity - (t.bookedQty ?? 0))
                        : (t.entryPrice - liveEffectivePrice) * (t.quantity - (t.bookedQty ?? 0))
                      : t.pnl;
                    return (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-4 font-medium text-white text-xs">
                          {/* Symbol — clickable link to Upstox order if live, or portfolio if paper */}
                         <a
                           href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              const token = (t as any).instrumentToken || "";
                              if (!token) {
                                window.open("https://pro.upstox.com/trading-charts", "_blank");
                                return;
                              }
                              const encoded = encodeURIComponent(token);
                              const webUrl = `https://pro.upstox.com/chart/${encoded}`;
                              const intentUrl = `upstox://instrument/${encoded}`;
                              const iframe = document.createElement("iframe");
                              iframe.style.display = "none";
                              iframe.src = intentUrl;
                              document.body.appendChild(iframe);
                              setTimeout(() => { document.body.removeChild(iframe); window.open(webUrl, "_blank"); }, 1500);
                            }}
                            className="flex items-center gap-1 hover:text-teal-400 transition-colors group cursor-pointer"
                            title={`View ${t.symbolLabel ?? t.symbol} chart in Upstox`}
                          >
                            {t.symbolLabel ?? t.symbol}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                          </a>
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
                        <td className="py-2.5 pr-4 text-right font-mono text-red-400/70">{(t as any).slPrice ? `₹${(t as any).slPrice.toFixed(2)}` : "—"}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-emerald-400/70">{(t as any).targetPrice ? `₹${(t as any).targetPrice.toFixed(2)}` : "—"}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-white/60">{t.exitPrice ? `₹${t.exitPrice.toFixed(2)}` : "—"}</td>
                        <td className="py-2.5 pr-4 text-right text-white/60">{t.quantity}</td>
                        <td className="py-2.5 pr-4 text-right text-white/40 text-xs">
                          {(() => {
                            // Match instrument by checking if the trade symbol/label contains the instrument name
                            const instr = INSTRUMENTS.find(i => {
                              const sym = t.symbol ?? '';
                              const lbl = t.symbolLabel ?? '';
                              // Direct symbol match
                              if (sym === i.symbol) return true;
                              // Check if trade label contains instrument label prefix (e.g., "Crude Oil")
                              const instrName = i.label.split(' →')[0];
                              if (lbl.includes(instrName)) return true;
                              // Check common patterns: CRUDEOIL in symbol → MCX_CRUDE
                              if (sym.includes('CRUDEOIL') && i.symbol === 'MCX_CRUDE') return true;
                              if (sym.includes('GOLD') && i.symbol === 'MCX_GOLD') return true;
                              if (sym.includes('SILVER') && i.symbol === 'MCX_SILVER') return true;
                              if (sym.includes('NATGAS') && i.symbol === 'MCX_NATGAS') return true;
                              if (sym.includes('COPPER') && i.symbol === 'MCX_COPPER') return true;
                              if (sym.includes('NIFTY') && !sym.includes('BANK') && !sym.includes('FIN') && i.symbol === 'NIFTY') return true;
                              if (sym.includes('BANKNIFTY') && i.symbol === 'BANKNIFTY') return true;
                              if (sym.includes('FINNIFTY') && i.symbol === 'FINNIFTY') return true;
                              if (sym.includes('SENSEX') && i.symbol === 'SENSEX') return true;
                              if (sym.includes('BANKEX') && i.symbol === 'BANKEX') return true;
                              if (sym.includes('MIDCPNIFTY') && i.symbol === 'MIDCPNIFTY') return true;
                              return false;
                            });
                            const ls = instr?.lotSize ?? 1;
                            const lots = ls > 1 ? Math.round(t.quantity / ls) : null;
                            return lots !== null ? `${lots}L` : '—';
                          })()}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-cyan-400/80 text-xs">
                          ₹{(t.entryPrice * t.quantity).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-semibold ${(livePnl ?? 0) > 0 ? "text-emerald-400" : (livePnl ?? 0) < 0 ? "text-red-400" : "text-white/40"}`}>
                          {livePnl !== undefined && livePnl !== null
                            ? `${livePnl > 0 ? "+" : ""}₹${livePnl.toFixed(0)}${t.status === "open" ? " ●" : ""}`
                            : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-center">
                          {(t as any).partialBooked > 0 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                                  {(t as any).partialBooked === 1 ? "50% booked" : "75% booked"}
                                </span>
                              </div>
                              {(t as any).bookedPnl ? (
                                <span className={`text-[10px] font-mono ${(t as any).bookedPnl > 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                  {(t as any).bookedPnl > 0 ? "+" : ""}₹{Number((t as any).bookedPnl).toFixed(0)}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-white/20 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            t.status === "open" ? "bg-blue-500/20 text-blue-400"
                            : (t.pnl ?? 0) > 0 ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                          }`}>
                            {t.status === "open" ? "Open" : t.exitReason ?? "Closed"}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          {t.status === "closed" && (
                            <button
                              onClick={() => {
                                const currentExit = t.exitPrice ?? t.entryPrice;
                                const input = prompt(`Correct exit price for ${t.symbolLabel ?? t.symbol}\n\nCurrent exit: ₹${currentExit}\nEntry: ₹${t.entryPrice}\n\nEnter the correct exit price:`, String(currentExit));
                                if (!input) return;
                                const newExit = parseFloat(input);
                                if (isNaN(newExit) || newExit <= 0) { toast.error("Invalid price"); return; }
                                correctExitMutation.mutate({ tradeId: t.id, correctExitPrice: newExit });
                              }}
                              className="text-blue-400/60 hover:text-blue-400 transition-colors p-1 rounded hover:bg-blue-500/10 mr-1"
                              title="Correct exit price"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (!confirm(`Delete trade #${t.id} (${t.symbolLabel ?? t.symbol})? This cannot be undone.`)) return;
                              deleteTradeByIdMutation.mutate({ sessionToken, tradeId: t.id });
                            }}
                            className="text-red-400/60 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                            title="Delete this trade record"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        </>)}
        {activeTab === "log" && (<>
        {/* Bot Activity Log */}
        <div className="mt-6 rounded-xl border border-white/10 bg-[oklch(0.14_0.02_240)] overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 200px)" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-white text-sm">Bot Activity Log</span>
              <span className="text-white/30 text-xs">(last 200 events — live)</span>
              <span className="text-white/20 text-[10px] hidden sm:inline">— signals, trades, errors, and system events</span>
            </div>
            <button
              onClick={() => { setActivityEvents([]); setActivityAfterId(0); }}
              className="text-white/30 hover:text-white/60 text-xs transition-colors"
            >Clear</button>
          </div>
          <div
            ref={activityScrollRef}
            className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5"
          >
            {activityEvents.length === 0 ? (
              <div className="text-white/20 text-center py-8">No activity yet — start the bot to see live events here.</div>
            ) : (
              activityEvents.map((ev) => {
                const time = new Date(ev.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const slotTag = ev.slot === 0 ? "" : ev.slot === 1 ? " [S1]" : " [S2]";
                const color =
                  ev.type === "trade_open" ? "text-emerald-400" :
                  ev.type === "trade_close" ? (ev.pnl != null && ev.pnl >= 0 ? "text-emerald-300" : "text-red-400") :
                  ev.type === "signal" ? "text-cyan-400" :
                  ev.type === "bot_start" ? "text-blue-400" :
                  ev.type === "bot_stop" ? "text-orange-400" :
                  ev.type === "bot_crash" ? "text-red-500" :
                  ev.type === "partial_book" ? "text-yellow-400" :
                  ev.type === "error" ? "text-red-400" :
                  "text-white/50";
                const icon =
                  ev.type === "trade_open" ? "▶" :
                  ev.type === "trade_close" ? "■" :
                  ev.type === "signal" ? "◆" :
                  ev.type === "bot_start" ? "▷" :
                  ev.type === "bot_stop" ? "□" :
                  ev.type === "partial_book" ? "◐" :
                  ev.type === "error" ? "⚠" : "•";
                return (
                  <div key={ev.id} className={`flex gap-2 ${color}`}>
                    <span className="text-white/20 shrink-0">{time}{slotTag}</span>
                    <span className="shrink-0">{icon}</span>
                    <span className="break-all">{ev.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        </>)}
      </PullToRefresh>
      )}

      {/* ── Mobile Bottom Tab Navigation ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[oklch(0.12_0.02_240)] border-t border-white/10 backdrop-blur-lg safe-area-bottom">
        <div className="flex items-stretch justify-around">
          {[
            { icon: "🎯", label: "Dashboard", path: "/dashboard", active: location.startsWith("/dashboard") },
            { icon: "⚙️", label: "Settings", path: "/settings", active: false },
            { icon: "🦸", label: "Hero Zero", path: "/hero-zero", active: false },
            { icon: "📊", label: "P&L", path: "/pnl-analytics", active: false },
            { icon: "🔬", label: "Backtest", path: "/backtest", active: false },
          ].map((tab) => (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-2 min-h-[56px] min-w-[56px] transition-colors ${
                tab.active
                  ? "text-teal-400"
                  : "text-white/40 active:text-white/70"
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
import { Rocket } from "lucide-react";
import { playEntrySound, playProfitSound, playLossSound } from "@/lib/sounds";
import { pushTradeNotification } from "@/components/TradeToast";
import AppFooter from "@/components/AppFooter";
import PullToRefresh from "@/components/PullToRefresh";

// ── Refer & Earn Sidebar Component ─────────────────────────────────────────────
function ReferAndEarnSidebar({ sessionToken }: { sessionToken: string }) {
  const [expanded, setExpanded] = useState(false);
  const referralQuery = trpc.referral.myReferral.useQuery({ sessionToken });
  const code = referralQuery.data?.referralCode;
  const refCount = referralQuery.data?.referralCount ?? 0;
  const extraSlots = referralQuery.data?.extraBotSlots ?? 0;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-teal-400 hover:bg-teal-500/10 border border-teal-500/20 w-full"
      >
        <Gift className="w-4 h-4" />
        <span>Refer &amp; Earn</span>
        {extraSlots > 0 && (
          <span className="ml-auto text-[10px] bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded-full">+{extraSlots} slot</span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 mx-1 p-3 bg-[oklch(0.16_0.02_240)] border border-teal-500/20 rounded-xl space-y-2">
          <p className="text-[11px] text-white/50 leading-relaxed">
            Share your code. When friends sign up, you earn an <strong className="text-teal-300">extra bot slot</strong>.
          </p>
          {code ? (
            <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
              <span className="text-sm font-mono font-bold text-teal-300 tracking-wider">{code}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(code); toast.success("Referral code copied!"); }}
                className="text-white/40 hover:text-teal-400 transition-colors ml-auto"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="text-xs text-white/30">Loading...</div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-white/50">
            <span className="flex items-center gap-1"><UsersIcon className="w-3 h-3 text-purple-400" />{refCount} referral{refCount !== 1 ? "s" : ""}</span>
            <span className="flex items-center gap-1"><Gift className="w-3 h-3 text-amber-400" />{extraSlots} bonus slot{extraSlots !== 1 ? "s" : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
