import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Settings as SettingsIcon, Zap, Activity, Calculator, Key,
  ExternalLink, Eye, EyeOff, Save, Trash2, CheckCircle,
  AlertTriangle, ChevronDown, ChevronUp, MousePointer,
  LogIn, Copy, ClipboardPaste, RefreshCw, Info, Send, Bell, Flame, BarChart2
} from "lucide-react";
import { MCX_INSTRUMENTS, getMCXByCategory } from "@shared/mcxInstruments";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const LS_CREDS = "scalpbot_credentials";
const LS_SESSION = "scalpbot_session";
const LS_TELEGRAM = "scalpbot_telegram";

interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

function loadTelegram(): TelegramConfig {
  try {
    return JSON.parse(localStorage.getItem(LS_TELEGRAM) ?? "null") ??
      { botToken: "", chatId: "", enabled: false };
  } catch {
    return { botToken: "", chatId: "", enabled: false };
  }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getSessionToken(): string {
  let token = localStorage.getItem(LS_SESSION);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(LS_SESSION, token);
  }
  return token;
}

// Build the Upstox authorize URL for automatic token capture
function buildUpstoxAuthUrl(apiKey: string, redirectUri: string, sessionToken?: string): string {
  const base = "https://api.upstox.com/v2/login/authorization/dialog";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: apiKey,
    redirect_uri: redirectUri,
  });
  // Pass session token as `state` so the server-side callback can look up credentials
  // without needing cookies or localStorage (which aren't available server-side).
  if (sessionToken) {
    params.set("state", encodeURIComponent(sessionToken));
  }
  return `${base}?${params.toString()}`;
}

interface Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  redirectUri: string;
  tokenSavedAt?: number;
}

function getCallbackUrl(): string {
  // Use the SERVER-SIDE /api/upstox-callback route.
  // The hosting platform's edge layer strips query params from client-side routes,
  // but server-side /api/* routes receive the full URL including ?code=.
  // The server exchanges the code and redirects to /upstox-callback?status=success|error.
  return `${window.location.origin}/api/upstox-callback`;
}

function loadCreds(): Credentials {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CREDS) ?? "null");
    if (saved) return saved;
    return { apiKey: "", apiSecret: "", accessToken: "", redirectUri: getCallbackUrl() };
  } catch {
    return { apiKey: "", apiSecret: "", accessToken: "", redirectUri: getCallbackUrl() };
  }
}

// Visual step card for the token guide
function TokenStep({
  step,
  icon: Icon,
  title,
  description,
  highlight,
  link,
  linkLabel,
  note,
}: {
  step: number;
  icon: React.ElementType;
  title: string;
  description: React.ReactNode;
  highlight?: string;
  link?: string;
  linkLabel?: string;
  note?: string;
}) {
  return (
    <div className="flex gap-4 p-4 bg-white/5 rounded-xl border border-white/10 hover:border-teal-500/30 transition-colors">
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400 font-bold text-sm">
          {step}
        </div>
        <div className="w-px flex-1 bg-white/10 min-h-[16px]" />
      </div>
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="font-semibold text-white text-sm">{title}</span>
        </div>
        <p className="text-white/60 text-sm leading-relaxed">{description}</p>
        {highlight && (
          <div className="mt-2 inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-1.5">
            <span className="text-teal-300 text-xs font-mono">{highlight}</span>
          </div>
        )}
        {link && linkLabel && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 px-3 py-1.5 rounded-lg transition-colors w-fit"
          >
            <ExternalLink className="w-3 h-3" />
            {linkLabel}
          </a>
        )}
        {note && (
          <p className="mt-2 text-amber-400/80 text-xs flex items-start gap-1.5">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Auto Refresh Section ──────────────────────────────────────────────────────
function RestoreSessionInput() {
  const [value, setValue] = useState("");
  const handleRestore = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 20) {
      toast.error("Invalid Session ID — paste the full ID from your other device");
      return;
    }
    localStorage.setItem(LS_SESSION, trimmed);
    toast.success("Session restored — reloading...");
    setTimeout(() => window.location.reload(), 800);
  };
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Paste Session ID here"
        className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-white/20 outline-none focus:border-teal-500/50"
      />
      <button
        onClick={handleRestore}
        className="shrink-0 bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/30 text-teal-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
      >
        Restore
      </button>
    </div>
  );
}

function EodSummarySection({ sessionToken }: { sessionToken: string }) {
  const { data: status, refetch } = trpc.eodSummary.status.useQuery({ sessionToken });
  const enableMutation = trpc.eodSummary.enable.useMutation({
    onSuccess: () => { refetch(); toast.success("EOD summary enabled! You'll get a daily P&L summary at 11:30 PM IST."); },
    onError: (e) => toast.error(e.message),
  });
  const disableMutation = trpc.eodSummary.disable.useMutation({
    onSuccess: () => { refetch(); toast.success("EOD summary disabled."); },
    onError: (e) => toast.error(e.message),
  });
  const isEnabled = status?.enabled ?? false;
  const isPending = enableMutation.isPending || disableMutation.isPending;
  return (
    <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-white text-sm">Daily P&amp;L Summary (11:30 PM IST)</span>
            {isEnabled
              ? <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Active</span>
              : <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded-full">Disabled</span>
            }
          </div>
          <button
            onClick={() => isEnabled
              ? disableMutation.mutate({ sessionToken })
              : enableMutation.mutate({ sessionToken })
            }
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isEnabled ? 'bg-purple-500' : 'bg-white/20'
            } ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        <p className="mt-2 text-white/50 text-xs leading-relaxed">
          When enabled, a daily cron fires at <strong className="text-white/70">11:30 PM IST</strong> (MCX market close) and sends a Telegram summary of the day — total trades, wins, losses, and net P&amp;L across all 3 bot slots.
        </p>
        {isEnabled && (
          <div className="mt-3 flex items-start gap-2 bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
            <CheckCircle className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <p className="text-purple-300/80 text-xs">
              Summary active. Make sure Telegram Alerts are configured below so you receive the nightly report.
            </p>
          </div>
        )}
        {!isEnabled && (
          <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-300/70 text-xs">
              Enable this after publishing the site. The cron requires a live URL to call back.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AutoRefreshSection({ sessionToken }: { sessionToken: string }) {
  const { data: status, refetch } = trpc.autoRefresh.status.useQuery({ sessionToken });
  const enableMutation = trpc.autoRefresh.enable.useMutation({
    onSuccess: () => { refetch(); toast.success("Auto-refresh enabled! Token will be refreshed at 8:30 AM IST daily."); },
    onError: (e) => toast.error(e.message),
  });
  const disableMutation = trpc.autoRefresh.disable.useMutation({
    onSuccess: () => { refetch(); toast.success("Auto-refresh disabled."); },
    onError: (e) => toast.error(e.message),
  });

  const isEnabled = status?.enabled ?? false;
  const isPending = enableMutation.isPending || disableMutation.isPending;

  return (
    <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-teal-400" />
            <span className="font-semibold text-white text-sm">Daily Token Refresh Reminder</span>
            {isEnabled
              ? <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Active</span>
              : <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded-full">Disabled</span>
            }
          </div>
          <button
            onClick={() => isEnabled
              ? disableMutation.mutate({ sessionToken })
              : enableMutation.mutate({ sessionToken })
            }
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isEnabled ? 'bg-teal-500' : 'bg-white/20'
            } ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        <p className="mt-2 text-white/50 text-xs leading-relaxed">
          When enabled, a daily cron runs at <strong className="text-white/70">8:30 AM IST</strong> and sends a Telegram reminder to refresh your Upstox token before market open.
          Upstox access tokens expire at midnight — this ensures you never miss a trading day.
        </p>
        {isEnabled && (
          <div className="mt-3 flex items-start gap-2 bg-teal-500/10 border border-teal-500/20 rounded-xl p-3">
            <CheckCircle className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <p className="text-teal-300/80 text-xs">
              Reminder active. Make sure Telegram Alerts are configured below so you receive the daily notification.
            </p>
          </div>
        )}
        {!isEnabled && (
          <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-300/70 text-xs">
              Enable this after publishing the site. The cron requires a live URL to call back.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const [, navigate] = useLocation();
  const [creds, setCreds] = useState<Credentials>(loadCreds);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showApiGuide, setShowApiGuide] = useState(false);
  const [showTokenGuide, setShowTokenGuide] = useState(true);
  const [sessionToken] = useState(getSessionToken);

  // Sync the redirect URI to always use the current origin
  useEffect(() => {
    const callbackUrl = getCallbackUrl();
    if (creds.redirectUri !== callbackUrl) {
      setCreds(c => ({ ...c, redirectUri: callbackUrl }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save credentials to DB via tRPC (for server-side token exchange)
  const saveCredsMutation = trpc.credentials.save.useMutation();

  const saveTokenToServer = trpc.credentials.saveAccessToken.useMutation();

  const [autoTokenLoading, setAutoTokenLoading] = useState(false);

  // Save credentials to DB first, then redirect to Upstox OAuth
  const handleGetTokenAuto = async () => {
    if (!creds.apiKey || !creds.apiSecret) {
      toast.error("Enter your API Key and API Secret first, then click Save Credentials.");
      return;
    }
    setAutoTokenLoading(true);
    // ALWAYS use the current domain's callback URL — never use a stale localStorage value.
    // This ensures the redirect_uri sent to Upstox and the one used in token exchange always match.
    const currentCallbackUrl = getCallbackUrl();
    try {
      // Always save to DB before redirecting — this is required for the callback to work
      await saveCredsMutation.mutateAsync({
        sessionToken,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        redirectUri: currentCallbackUrl,
      });
      // Also save to localStorage with fresh redirect URI
      const toSave = { ...creds, redirectUri: currentCallbackUrl };
      localStorage.setItem(LS_CREDS, JSON.stringify(toSave));
      setCreds(c => ({ ...c, redirectUri: currentCallbackUrl }));
      toast.success("Credentials saved — opening Upstox login…");
      // Small delay so toast is visible, then redirect
      setTimeout(() => {
        const url = buildUpstoxAuthUrl(creds.apiKey, currentCallbackUrl, sessionToken);
        window.location.href = url;
      }, 800);
    } catch (err) {
      setAutoTokenLoading(false);
      toast.error("Failed to save credentials to server: " + String(err) + ". Check your internet connection and try again.");
    }
  };

  const handleSave = async () => {
    // Save tokenSavedAt timestamp so Dashboard can check if token is from today
    const toSave = { ...creds, tokenSavedAt: creds.accessToken ? Date.now() : undefined };
    localStorage.setItem(LS_CREDS, JSON.stringify(toSave));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);

    // Save API key/secret to DB
    if (creds.apiKey && creds.apiSecret) {
      try {
        await saveCredsMutation.mutateAsync({
          sessionToken,
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          redirectUri: creds.redirectUri,
        });
      } catch (err) {
        toast.error("Warning: Could not save to server DB: " + String(err) + ". Auto-token may not work.");
        return;
      }
    }

    // If a real access token is pasted, also save it to the server DB
    // so it works from any device (not just this browser)
    if (creds.accessToken && creds.accessToken !== "[auto-fetched]") {
      try {
        await saveTokenToServer.mutateAsync({ sessionToken, accessToken: creds.accessToken });
        toast.success("✅ Credentials & token saved — ready from any device!");
      } catch {
        toast.success("Credentials saved in browser.");
      }
    } else {
      toast.success("Credentials saved.");
    }
  };

  const handleClear = () => {
    localStorage.removeItem(LS_CREDS);
    setCreds({ apiKey: "", apiSecret: "", accessToken: "", redirectUri: getCallbackUrl() });
    toast.info("Credentials cleared.");
  };

  const hasSavedCreds = !!(loadCreds().apiKey);

  // Telegram state
  const [telegram, setTelegram] = useState<TelegramConfig>(loadTelegram);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [telegramSaved, setTelegramSaved] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [showTelegramGuide, setShowTelegramGuide] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<"idle" | "connected" | "failed">("idle");

  // MCX Quick Launch state
  const [mcxCategory, setMcxCategory] = useState<"all" | "metal" | "energy" | "agri">("all");
  const [mcxSlot, setMcxSlot] = useState<1 | 2>(1);
  const [mcxCapital, setMcxCapital] = useState(50000);
  const [mcxLaunching, setMcxLaunching] = useState<string | null>(null);

  const startSecondaryMutation = trpc.multiBots.startSecondary.useMutation({
    onSuccess: (res) => {
      toast.success(`🌙 MCX Evening bot started on Slot ${mcxSlot}!`);
      setMcxLaunching(null);
    },
    onError: (e) => {
      toast.error(`Failed to start MCX bot: ${e.message}`);
      setMcxLaunching(null);
    },
  });

  const handleLaunchMCX = (symbol: string) => {
    const instr = MCX_INSTRUMENTS.find(i => i.symbol === symbol);
    if (!instr) return;
    const tg = JSON.parse(localStorage.getItem("scalpbot_telegram") ?? "{}");
    setMcxLaunching(symbol);
    // Always use ATM Options mode for MCX instruments:
    // isIndexOptions=true means the bot reads futures price for signals but trades ATM CE/PE options.
    const atmLabel = `${instr.label} → ATM Options (Auto)`;
    startSecondaryMutation.mutate({
      sessionToken,
      slot: mcxSlot,
      instrumentToken: instr.instrumentToken,
      instrumentSymbol: instr.symbol,
      instrumentLabel: atmLabel,
      isIndexOptions: true,
      underlyingToken: instr.instrumentToken,
      mode: "paper",
      capital: mcxCapital,
      riskPerTradePct: 1.5,
      maxTradesPerDay: 4,
      dailyLossLimitPct: 3,
      stopLossMultiplier: 1.5,
      targetMultiplier: 2.5,
      minConfidence: 60,
      scanIntervalSec: 30,
      telegramBotToken: tg.botToken ?? "",
      telegramChatId: tg.chatId ?? "",
      telegramEnabled: tg.enabled ?? false,
    });
  };

  const telegramTestMutation = trpc.telegram.test.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setTelegramStatus("connected");
        toast.success("✅ Connected! Check your Telegram for the test message.");
      } else {
        setTelegramStatus("failed");
        toast.error(`❌ Failed: ${result.error ?? "Unknown error"}`);
      }
    },
    onError: () => {
      setTelegramStatus("failed");
      toast.error("❌ Network error — check your Bot Token and Chat ID.");
    },
  });

  const telegramSummaryMutation = trpc.telegram.sendDailySummary.useMutation({
    onSuccess: (result) => {
      if (result.success) toast.success("📊 Daily summary sent to Telegram!");
      else toast.error(`❌ Failed: ${result.error ?? "Unknown error"}`);
    },
    onError: () => toast.error("❌ Network error sending daily summary."),
  });

  const handleSaveTelegram = () => {
    localStorage.setItem(LS_TELEGRAM, JSON.stringify(telegram));
    setTelegramSaved(true);
    toast.success("Telegram settings saved.");
    setTimeout(() => setTelegramSaved(false), 3000);
  };

  const handleTestTelegram = () => {
    if (!telegram.botToken || !telegram.chatId) {
      toast.error("Enter Bot Token and Chat ID first.");
      return;
    }
    setTelegramTesting(true);
    telegramTestMutation.mutate(
      { botToken: telegram.botToken, chatId: telegram.chatId },
      { onSettled: () => setTelegramTesting(false) },
    );
  };

  const handleDailySummary = () => {
    if (!telegram.botToken || !telegram.chatId) {
      toast.error("Enter Bot Token and Chat ID first.");
      return;
    }
    telegramSummaryMutation.mutate({
      sessionToken,
      botToken: telegram.botToken,
      chatId: telegram.chatId,
    });
  };

  // Build the Upstox authorize URL for automatic token capture
  const upstoxAuthUrl = creds.apiKey
    ? buildUpstoxAuthUrl(creds.apiKey, creds.redirectUri || getCallbackUrl(), sessionToken)
    : null;

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 flex flex-col p-4 gap-2 shrink-0 hidden md:flex">
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
          { icon: Activity, label: "Dashboard", path: "/dashboard", active: false },
          { icon: Calculator, label: "Risk Calculator", path: "/risk-calculator", active: false },
          { icon: SettingsIcon, label: "Settings", path: "/settings", active: true },
        ].map((item) => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${item.active ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 md:p-6 max-w-2xl overflow-y-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
          <p className="text-white/50 text-sm">Your credentials are stored securely on the server for bot operation.</p>
        </div>

        {/* Privacy Notice */}
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4 mb-6 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
          <div className="text-sm text-teal-300">
            <strong>Secure &amp; Independent:</strong> Your API credentials are stored securely on the server (encrypted at rest) to enable automated trading. No third-party login required — access via your unique session link.
          </div>
        </div>

        {/* ── GUIDE 1: How to get API Keys ───────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl mb-4 overflow-hidden">
          <button
            onClick={() => setShowApiGuide(v => !v)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-teal-400" />
              <span className="font-semibold text-white text-sm">How to Get Your API Key & Secret</span>
              <span className="text-xs text-white/30">(one-time setup)</span>
            </div>
            {showApiGuide
              ? <ChevronUp className="w-4 h-4 text-white/40" />
              : <ChevronDown className="w-4 h-4 text-white/40" />
            }
          </button>

          {showApiGuide && (
            <div className="px-5 pb-5 space-y-3">
              <TokenStep
                step={1}
                icon={ExternalLink}
                title="Open Upstox Developer Portal"
                description="Click the button below to open the Upstox Developer Apps page in a new tab."
                link="https://account.upstox.com/developer/apps"
                linkLabel="Open Upstox Developer Apps"
              />
              <TokenStep
                step={2}
                icon={MousePointer}
                title='Click "Create New App"'
                description='On the Developer Apps page, click the green "Create New App" button. Give your app any name (e.g. "My ScalpBot").'
              />
              <TokenStep
                step={3}
                icon={ClipboardPaste}
                title="Set the Redirect URL"
                description="In the app creation form, find the Redirect URL field. Copy the Redirect URI shown in the credentials form below and paste it there."
                note={`The Redirect URI is shown in the credentials form below — use the copy button next to it. It looks like: ${window.location.origin}/api/upstox-callback`}
              />
              <TokenStep
                step={4}
                icon={Copy}
                title="Copy API Key and API Secret"
                description='After creating the app, you will see your API Key and API Secret on the app details page. Copy both and paste them into the fields below.'
                note="Keep your API Secret private — never share it with anyone."
              />
            </div>
          )}
        </div>

        {/* ── GUIDE 2: How to get Daily Access Token ─────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl mb-6 overflow-hidden">
          <button
            onClick={() => setShowTokenGuide(v => !v)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-white text-sm">How to Get Your Daily Access Token</span>
              <span className="text-xs text-amber-400/70">(refresh every morning)</span>
            </div>
            {showTokenGuide
              ? <ChevronUp className="w-4 h-4 text-white/40" />
              : <ChevronDown className="w-4 h-4 text-white/40" />
            }
          </button>

          {showTokenGuide && (
            <div className="px-5 pb-5 space-y-3">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-300/90 text-xs">
                  <strong>Important:</strong> The Access Token expires every day at midnight. You must repeat these steps each morning before starting Live trading. Paper trading works without a token.
                </p>
              </div>

              <TokenStep
                step={1}
                icon={ExternalLink}
                title="Open Your Upstox App Page"
                description="Click the button below to go to your Upstox Developer Apps page where your app is listed."
                link="https://account.upstox.com/developer/apps"
                linkLabel="Open Upstox Developer Apps"
              />
              <TokenStep
                step={2}
                icon={MousePointer}
                title='Click "Get Token" on Your App'
                description='Find your app in the list and click the "Get Token" button next to it. This opens the Upstox login page.'
              />
              <TokenStep
                step={3}
                icon={LogIn}
                title="Log In with Your Upstox Account"
                description="Enter your Upstox username and password (or use the mobile OTP option). This is your regular Upstox trading account login."
                note="You are logging into Upstox directly — not into this app."
              />
              <TokenStep
                step={4}
                icon={Copy}
                title="Copy the Access Token"
                description='After logging in, Upstox will show you a long string of characters — this is your Access Token. Select all of it and copy it (Ctrl+C or tap and hold → Copy).'
                note="The token is a very long string, usually 200+ characters. Make sure you copy the entire thing."
              />
              <TokenStep
                step={5}
                icon={ClipboardPaste}
                title="Paste It Below & Save"
                description='Scroll down to the Access Token field below, paste the token (Ctrl+V or tap and hold → Paste), then click "Save Credentials". You are ready for Live trading!'
              />
            </div>
          )}
        </div>

        {/* Credentials Form */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <SettingsIcon className="w-4 h-4 text-teal-400" />
              Upstox API Credentials
            </h2>
            {hasSavedCreds && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
                <CheckCircle className="w-3 h-3" /> Saved
              </span>
            )}
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">API Key</label>
            <input
              type="text"
              value={creds.apiKey}
              onChange={(e) => setCreds(c => ({ ...c, apiKey: e.target.value }))}
              placeholder="e.g. abc123xyz789..."
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-teal-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">API Secret</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={creds.apiSecret}
                onChange={(e) => setCreds(c => ({ ...c, apiSecret: e.target.value }))}
                placeholder="Your API secret key"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-white/20 focus:outline-none focus:border-teal-500 font-mono"
              />
              <button onClick={() => setShowSecret(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Redirect URI — read-only, auto-set to this app's callback URL */}
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">
              Redirect URI
              <span className="text-white/30 ml-1">(copy this into your Upstox app — required for auto-token)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={creds.redirectUri}
                readOnly
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/60 text-xs focus:outline-none font-mono cursor-text"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(creds.redirectUri); toast.success("Redirect URI copied!"); }}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white/60 hover:text-white transition-colors"
                title="Copy"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-white/30">
              Set this exact URL as the Redirect URL in your Upstox Developer App settings.
            </p>
          </div>

          {/* Auto-fetch token OR manual paste */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-white/50 block">
                Access Token <span className="text-white/30">(required for Live mode — refreshed daily)</span>
              </label>
            </div>

            {/* QR code warning — critical for OAuth to work */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300/90 space-y-1">
                <p><strong>⚠️ QR code login does NOT work with the Upstox API.</strong></p>
                <p>On the Upstox login page, use: <strong>Mobile Number → OTP/TOTP → 6-digit PIN</strong>. Do NOT scan the QR code — it will redirect you back without the authorization code.</p>
              </div>
            </div>
            {/* Auto-fetch button — primary method */}
            {creds.apiKey && creds.apiSecret ? (
              <button
                onClick={handleGetTokenAuto}
                disabled={autoTokenLoading}
                className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors mb-3 text-sm"
              >
                {autoTokenLoading ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Saving & Connecting to Upstox…</>
                ) : (
                  <><LogIn className="w-4 h-4" /> Get Token Automatically — Login with Upstox</>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full py-3 px-4 bg-white/5 border border-white/10 text-white/30 rounded-xl mb-3 text-sm">
                <LogIn className="w-4 h-4" />
                Enter your API Key &amp; Secret above to enable auto-login
              </div>
            )}

            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30">or paste manually</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={creds.accessToken}
                onChange={(e) => setCreds(c => ({ ...c, accessToken: e.target.value }))}
                placeholder="Paste your Access Token here if auto-login doesn't work"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-white/20 focus:outline-none focus:border-teal-500 font-mono"
              />
              <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {creds.accessToken && creds.accessToken !== "[auto-fetched]" && (
              <>
                <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Token ready ({creds.accessToken.length} chars) — click Save Credentials to activate
                </p>
                <button
                  onClick={async () => {
                    if (!creds.accessToken || creds.accessToken === "[auto-fetched]") return;
                    try {
                      await saveCredsMutation.mutateAsync({
                        sessionToken,
                        apiKey: creds.apiKey || "manual",
                        apiSecret: creds.apiSecret || "manual",
                        redirectUri: creds.redirectUri,
                      });
                      // Also save the token itself to DB
                      const res = await fetch("/api/trpc/credentials.saveAccessToken", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ json: { sessionToken, accessToken: creds.accessToken } }),
                      });
                      if (res.ok) {
                        const toSave = { ...creds, tokenSavedAt: Date.now() };
                        localStorage.setItem(LS_CREDS, JSON.stringify(toSave));
                        toast.success("✅ Token saved to server — works from any device now!");
                      } else {
                        toast.error("Failed to save token to server. Try again.");
                      }
                    } catch (e) {
                      toast.error("Error saving token: " + String(e));
                    }
                  }}
                  className="mt-2 flex items-center gap-2 w-full py-2.5 px-4 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 rounded-xl text-sm font-medium transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Token to Server (works from any device)
                </button>
              </>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button className="flex-1 bg-teal-500 hover:bg-teal-600 text-white" onClick={handleSave}>
              {saved ? <><CheckCircle className="w-4 h-4 mr-2" /> Saved!</> : <><Save className="w-4 h-4 mr-2" /> Save Credentials</>}
            </Button>
            <Button variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 bg-transparent" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-2" /> Clear
            </Button>
          </div>
        </div>

        {/* ── Telegram Alerts ───────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl mt-6 overflow-hidden">
          <button
            onClick={() => setShowTelegramGuide(v => !v)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-400" />
              <span className="font-semibold text-white text-sm">Telegram Alerts</span>
              {telegram.enabled && telegram.botToken && telegram.chatId
                ? <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Active</span>
                : <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded-full">Not configured</span>
              }
            </div>
            {showTelegramGuide
              ? <ChevronUp className="w-4 h-4 text-white/40" />
              : <ChevronDown className="w-4 h-4 text-white/40" />
            }
          </button>

          {showTelegramGuide && (
            <div className="px-5 pb-5 space-y-4">
              {/* Setup guide */}
              <div className="space-y-3">
                <TokenStep
                  step={1}
                  icon={ExternalLink}
                  title="Create a Telegram Bot"
                  description='Open Telegram and search for @BotFather. Send the command /newbot and follow the steps. Give your bot a name (e.g. "My ScalpBot"). BotFather will give you a Bot Token.'
                  link="https://t.me/BotFather"
                  linkLabel="Open BotFather on Telegram"
                />
                <TokenStep
                  step={2}
                  icon={Copy}
                  title="Copy Your Bot Token"
                  description='BotFather gives you a token like: 1234567890:ABCDefGhIJKlmNoPQRsTUVwxyZ. Copy the entire string and paste it in the Bot Token field below.'
                  note="Keep your bot token private — anyone with it can send messages as your bot."
                />
                <TokenStep
                  step={3}
                  icon={MousePointer}
                  title="Get Your Chat ID"
                  description='Start a chat with your bot (search for it by name in Telegram and click Start). Then search for @userinfobot in Telegram, start it, and it will reply with your Chat ID number.'
                  link="https://t.me/userinfobot"
                  linkLabel="Open userinfobot on Telegram"
                />
                <TokenStep
                  step={4}
                  icon={Send}
                  title="Paste Both Below & Test"
                  description='Enter your Bot Token and Chat ID in the fields below, then click "Send Test Alert" to confirm it works. Enable alerts and save.'
                />
              </div>

              {/* Fields */}
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Bot Token</label>
                  <div className="relative">
                    <input
                      type={showTelegramToken ? "text" : "password"}
                      value={telegram.botToken}
                      onChange={(e) => setTelegram(t => ({ ...t, botToken: e.target.value }))}
                      placeholder="e.g. 1234567890:ABCDefGhIJKlmNoPQRsTUVwxyZ"
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-white/20 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button onClick={() => setShowTelegramToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                      {showTelegramToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Chat ID</label>
                  <input
                    type="text"
                    value={telegram.chatId}
                    onChange={(e) => setTelegram(t => ({ ...t, chatId: e.target.value }))}
                    placeholder="e.g. 123456789"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <button
                    onClick={() => setTelegram(t => ({ ...t, enabled: !t.enabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                      telegram.enabled ? "bg-blue-500" : "bg-white/20"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      telegram.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`} />
                  </button>
                  <div>
                    <p className="text-sm text-white font-medium">Enable Telegram Alerts</p>
                    <p className="text-xs text-white/40">Sends BUY, SELL, and STOP signals to your Telegram chat</p>
                  </div>
                </div>

                {/* Status badge */}
                {telegramStatus !== "idle" && (
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                    telegramStatus === "connected"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${telegramStatus === "connected" ? "bg-emerald-400" : "bg-red-400"}`} />
                    {telegramStatus === "connected" ? "✅ Telegram Connected — alerts will fire automatically" : "❌ Connection failed — check your Bot Token and Chat ID"}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    className="flex-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 bg-transparent"
                    onClick={handleTestTelegram}
                    disabled={telegramTesting || telegramTestMutation.isPending}
                  >
                    {telegramTesting || telegramTestMutation.isPending
                      ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Testing…</>
                      : <><Send className="w-4 h-4 mr-2" /> Test Connection</>
                    }
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 bg-transparent"
                    onClick={handleDailySummary}
                    disabled={telegramSummaryMutation.isPending}
                  >
                    {telegramSummaryMutation.isPending
                      ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                      : <><Activity className="w-4 h-4 mr-2" /> Send Daily Summary</>
                    }
                  </Button>
                  <Button
                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
                    onClick={handleSaveTelegram}
                  >
                    {telegramSaved
                      ? <><CheckCircle className="w-4 h-4 mr-2" /> Saved!</>
                      : <><Save className="w-4 h-4 mr-2" /> Save Settings</>
                    }
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── MCX Quick Launch ─────────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl mt-6 overflow-hidden">
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-5 h-5 text-orange-400" />
              <span className="font-semibold text-white text-sm">🌙 MCX Evening Quick Launch</span>
              <span className="text-xs text-orange-300/70 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">7:30–9:30 PM IST</span>
            </div>
            <p className="text-xs text-white/40">One-click launch of an MCX Evening bot on a parallel slot. Starts in Paper mode — switch to Live in Dashboard after testing.</p>
          </div>
          <div className="p-5 space-y-4">
            {/* Controls row */}
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Category</label>
                <div className="flex gap-1">
                  {(["all", "metal", "energy"] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setMcxCategory(cat)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        mcxCategory === cat
                          ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                          : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                      }`}
                    >
                      {cat === "all" ? "All" : cat === "metal" ? "🧱 Metals" : "⚡ Energy"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Slot</label>
                <div className="flex gap-1">
                  {([1, 2] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setMcxSlot(s)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        mcxSlot === s
                          ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                          : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                      }`}
                    >
                      Slot {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Capital (₹)</label>
                <input
                  type="number"
                  value={mcxCapital}
                  onChange={e => setMcxCapital(Number(e.target.value))}
                  min={10000}
                  step={10000}
                  className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>

            {/* Instrument grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {getMCXByCategory(mcxCategory).map(instr => (
                <div key={instr.symbol} className="bg-white/3 border border-white/10 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">{instr.label}</div>
                      <div className="text-xs text-white/30">{instr.symbol}</div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      instr.category === "metal" ? "bg-yellow-500/20 text-yellow-300" : "bg-blue-500/20 text-blue-300"
                    }`}>{instr.category}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-white/40">
                    <span>Lot: {instr.lotSize.toLocaleString()} units</span>
                    <span>Tick: ₹{instr.tickValue}</span>
                    <span>Margin: ~₹{(instr.margin / 1000).toFixed(0)}K</span>
                  </div>
                  <div className="text-xs text-orange-300/60">⏰ {instr.bestTimes}</div>
                  <Button
                    size="sm"
                    className="w-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 text-xs h-7"
                    onClick={() => handleLaunchMCX(instr.symbol)}
                    disabled={mcxLaunching === instr.symbol || startSecondaryMutation.isPending}
                  >
                    {mcxLaunching === instr.symbol
                      ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Starting…</>
                      : <>🌙 Start MCX Bot → Slot {mcxSlot}</>
                    }
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30">
              Bots start in <strong className="text-white/50">Paper mode</strong>. Monitor on the Dashboard → Parallel Bots panel. Switch to Live after verifying signals.
            </p>
          </div>
        </div>

        {/* ── Auto Token Refresh ─────────────────────────────────────── */}
        <AutoRefreshSection sessionToken={sessionToken} />

        {/* ── EOD Daily Summary ─────────────────────────────────────── */}
        <EodSummarySection sessionToken={sessionToken} />

        {/* ── Cross-Device Session Sharing ──────────────────────────────── */}
        <div className="mt-6 bg-[oklch(0.18_0.03_240)] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">📱</span>
            <h2 className="text-white font-semibold text-sm">Access on Other Devices</h2>
          </div>
          <p className="text-white/50 text-xs mb-3 leading-relaxed">
            Your session is tied to this browser. To view the same bot status, trade log, and P&amp;L on your phone or another computer, copy the Session ID below and paste it on the other device via Settings → Restore Session.
          </p>
          <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl px-3 py-2">
            <span className="flex-1 text-teal-300 text-xs font-mono truncate">{sessionToken}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(sessionToken); toast.success("Session ID copied — paste it on your other device"); }}
              className="shrink-0 text-white/40 hover:text-teal-400 transition-colors"
              title="Copy Session ID"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="text-white/40 text-xs mb-2">Restore session on another device:</p>
            <RestoreSessionInput />
          </div>
        </div>

        <div className="mt-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-400/80 text-sm">
              <strong className="text-amber-400">Reminder:</strong> Always start with Paper Trade mode on the Dashboard. Only switch to Live mode after testing for several days. Never risk more than you can afford to lose.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
