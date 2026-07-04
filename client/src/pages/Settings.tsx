import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Settings as SettingsIcon, Zap, Activity, Calculator, Key,
  ExternalLink, Eye, EyeOff, Save, Trash2, CheckCircle,
  AlertTriangle, ChevronDown, ChevronUp, MousePointer,
  LogIn, Copy, ClipboardPaste, RefreshCw, Info
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LS_CREDS = "scalpbot_credentials";

interface Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  redirectUri: string;
}

function loadCreds(): Credentials {
  try {
    return JSON.parse(localStorage.getItem(LS_CREDS) ?? "null") ??
      { apiKey: "", apiSecret: "", accessToken: "", redirectUri: "http://127.0.0.1:8000/callback" };
  } catch {
    return { apiKey: "", apiSecret: "", accessToken: "", redirectUri: "http://127.0.0.1:8000/callback" };
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

export default function Settings() {
  const [, navigate] = useLocation();
  const [creds, setCreds] = useState<Credentials>(loadCreds);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showApiGuide, setShowApiGuide] = useState(false);
  const [showTokenGuide, setShowTokenGuide] = useState(true);

  const handleSave = () => {
    // Save tokenSavedAt timestamp so Dashboard can check if token is from today
    const toSave = { ...creds, tokenSavedAt: creds.accessToken ? Date.now() : undefined };
    localStorage.setItem(LS_CREDS, JSON.stringify(toSave));
    setSaved(true);
    toast.success("Credentials saved securely in your browser.");
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClear = () => {
    localStorage.removeItem(LS_CREDS);
    setCreds({ apiKey: "", apiSecret: "", accessToken: "", redirectUri: "http://127.0.0.1:8000/callback" });
    toast.info("Credentials cleared.");
  };

  const hasSavedCreds = !!(loadCreds().apiKey);

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
          <p className="text-white/50 text-sm">Your credentials are stored only in your browser — never sent to any server.</p>
        </div>

        {/* Privacy Notice */}
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4 mb-6 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
          <div className="text-sm text-teal-300">
            <strong>100% Private & Independent:</strong> All credentials are saved in your browser's localStorage. They never leave your device and are not stored on any server. No login required.
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
                description="In the app creation form, find the Redirect URL field and paste exactly this value:"
                highlight="http://127.0.0.1:8000/callback"
                note="This exact URL is required. Do not change it."
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

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Redirect URI <span className="text-white/20">(do not change)</span></label>
            <input
              type="text"
              value={creds.redirectUri}
              onChange={(e) => setCreds(c => ({ ...c, redirectUri: e.target.value }))}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-white/50 block">
                Access Token <span className="text-white/30">(required for Live mode — refreshed daily)</span>
              </label>
              <a
                href="https://account.upstox.com/developer/apps"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 px-2 py-1 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Get Token from Upstox
              </a>
            </div>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={creds.accessToken}
                onChange={(e) => setCreds(c => ({ ...c, accessToken: e.target.value }))}
                placeholder="Paste your Access Token from Upstox Developer Portal"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-white/20 focus:outline-none focus:border-teal-500 font-mono"
              />
              <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {creds.accessToken && (
              <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Token entered ({creds.accessToken.length} characters) — remember to refresh it each morning
              </p>
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
