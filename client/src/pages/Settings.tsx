import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Settings as SettingsIcon, Zap, Activity, Calculator, Key, ExternalLink, Eye, EyeOff, Save, Trash2, CheckCircle, AlertTriangle } from "lucide-react";
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
  try { return JSON.parse(localStorage.getItem(LS_CREDS) ?? "null") ?? { apiKey: "", apiSecret: "", accessToken: "", redirectUri: "http://127.0.0.1:8000/callback" }; }
  catch { return { apiKey: "", apiSecret: "", accessToken: "", redirectUri: "http://127.0.0.1:8000/callback" }; }
}

export default function Settings() {
  const [, navigate] = useLocation();
  const [creds, setCreds] = useState<Credentials>(loadCreds);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(LS_CREDS, JSON.stringify(creds));
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
      <main className="flex-1 p-6 max-w-2xl">
        <div className="mb-8">
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

        {/* How to get API keys */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Key className="w-4 h-4 text-teal-400" />
            How to Get Your Upstox API Keys
          </h2>
          <ol className="space-y-2.5 text-sm text-white/60">
            <li className="flex gap-3">
              <span className="text-teal-400 font-bold shrink-0">1.</span>
              Go to <a href="https://account.upstox.com/developer/apps" target="_blank" rel="noreferrer" className="text-teal-400 underline inline-flex items-center gap-1">Upstox Developer Apps <ExternalLink className="w-3 h-3" /></a>
            </li>
            <li className="flex gap-3"><span className="text-teal-400 font-bold shrink-0">2.</span> Click <strong className="text-white">"Create New App"</strong> — give it any name</li>
            <li className="flex gap-3"><span className="text-teal-400 font-bold shrink-0">3.</span> Set Redirect URL to: <code className="bg-white/10 px-2 py-0.5 rounded text-teal-300">http://127.0.0.1:8000/callback</code></li>
            <li className="flex gap-3"><span className="text-teal-400 font-bold shrink-0">4.</span> Copy the <strong className="text-white">API Key</strong> and <strong className="text-white">API Secret</strong> shown on the app page</li>
            <li className="flex gap-3"><span className="text-teal-400 font-bold shrink-0">5.</span> For Live trading, run the Python bot once to get your daily <strong className="text-white">Access Token</strong></li>
          </ol>
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
            <label className="text-xs text-white/50 mb-1.5 block">Redirect URI</label>
            <input
              type="text"
              value={creds.redirectUri}
              onChange={(e) => setCreds(c => ({ ...c, redirectUri: e.target.value }))}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">
              Access Token <span className="text-white/30">(required for Live mode — refreshed daily)</span>
            </label>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={creds.accessToken}
                onChange={(e) => setCreds(c => ({ ...c, accessToken: e.target.value }))}
                placeholder="Paste your daily access token here for live trading"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-white/20 focus:outline-none focus:border-teal-500 font-mono"
              />
              <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
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
