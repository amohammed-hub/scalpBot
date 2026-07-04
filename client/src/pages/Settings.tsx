import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { Settings as SettingsIcon, Key, ExternalLink, CheckCircle, AlertTriangle, ArrowLeft, Zap, Activity, Calculator } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost:8000/callback");

  const creds = trpc.credentials.get.useQuery();
  const utils = trpc.useUtils();

  const saveCreds = trpc.credentials.save.useMutation({
    onSuccess: () => {
      toast.success("API credentials saved!");
      utils.credentials.get.invalidate();
      setApiKey("");
      setApiSecret("");
    },
    onError: (e) => toast.error(e.message),
  });

  const saveToken = trpc.credentials.saveAccessToken.useMutation({
    onSuccess: () => {
      toast.success("Access token saved! Bot can now place live orders.");
      utils.credentials.get.invalidate();
      setAccessToken("");
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) window.location.href = getLoginUrl();
  }, [loading, isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[oklch(0.10_0.02_240)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${item.active ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate("/dashboard")} className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-white/50 text-sm">Configure your Upstox API credentials for live trading</p>
          </div>
        </div>

        {/* Step 1 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-4">
          <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
            <span className="w-6 h-6 bg-teal-500 rounded-full text-xs flex items-center justify-center font-bold">1</span>
            Create Upstox Developer App
          </h2>
          <p className="text-white/50 text-sm mb-4 ml-8">Get your free API Key and Secret from the Upstox Developer Portal.</p>
          <a
            href="https://account.upstox.com/developer/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-8 inline-flex items-center gap-2 bg-teal-500/20 border border-teal-500/40 text-teal-400 rounded-lg px-4 py-2 text-sm hover:bg-teal-500/30 transition-colors"
          >
            Open Upstox Developer Portal
            <ExternalLink className="w-4 h-4" />
          </a>
          <div className="ml-8 mt-4 bg-white/5 rounded-xl p-4 text-sm text-white/60 space-y-1">
            <p>1. Log in to Upstox → Go to <strong className="text-white">My Account → Apps</strong></p>
            <p>2. Click <strong className="text-white">New App</strong> → Fill in App Name</p>
            <p>3. Set Redirect URL to: <code className="text-teal-400 bg-teal-500/10 px-1 rounded">http://localhost:8000/callback</code></p>
            <p>4. Copy your <strong className="text-white">API Key</strong> and <strong className="text-white">API Secret</strong></p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-4">
          <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
            <span className="w-6 h-6 bg-teal-500 rounded-full text-xs flex items-center justify-center font-bold">2</span>
            Enter API Credentials
          </h2>
          {creds.data && (
            <div className="ml-8 mb-4 flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              Credentials saved — API Key: {creds.data.apiKey.slice(0, 8)}...
            </div>
          )}
          <div className="ml-8 space-y-3">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">API Key</label>
              <input
                type="text"
                placeholder="Paste your Upstox API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 placeholder-white/30"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">API Secret</label>
              <input
                type="password"
                placeholder="Paste your Upstox API Secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 placeholder-white/30"
              />
            </div>
            <Button
              className="bg-teal-500 hover:bg-teal-600 text-white"
              onClick={() => saveCreds.mutate({ apiKey, apiSecret, redirectUri })}
              disabled={!apiKey || !apiSecret || saveCreds.isPending}
            >
              <Key className="w-4 h-4 mr-2" />
              {saveCreds.isPending ? "Saving..." : "Save Credentials"}
            </Button>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-4">
          <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
            <span className="w-6 h-6 bg-teal-500 rounded-full text-xs flex items-center justify-center font-bold">3</span>
            Get Daily Access Token (for Live Trading)
          </h2>
          <p className="text-white/50 text-sm mb-4 ml-8">Upstox requires a fresh access token every day. Use the one-click bot starter or generate it manually.</p>
          <div className="ml-8 space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-400 flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <strong>Paper Trade mode does not need an access token.</strong> Only Live mode requires it. Always test with Paper mode first.
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Access Token (from Upstox login)</label>
              <input
                type="password"
                placeholder="Paste today's access token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500 placeholder-white/30"
              />
            </div>
            {creds.data?.hasAccessToken && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                Access token is saved and active
              </div>
            )}
            <Button
              className="bg-teal-500 hover:bg-teal-600 text-white"
              onClick={() => saveToken.mutate({ accessToken })}
              disabled={!accessToken || saveToken.isPending}
            >
              {saveToken.isPending ? "Saving..." : "Save Access Token"}
            </Button>
          </div>
        </div>

        {/* Account info */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-teal-400" /> Account
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/50">Name</span><span className="text-white">{user?.name ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Email</span><span className="text-white">{user?.email ?? "—"}</span></div>
          </div>
          <Button variant="outline" className="mt-4 border-white/20 text-white/60 hover:bg-white/10" onClick={logout}>
            Logout
          </Button>
        </div>
      </main>
    </div>
  );
}
