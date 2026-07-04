import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import {
  Bot, TrendingUp, TrendingDown, Minus, Play, Square, Settings,
  BarChart2, AlertTriangle, CheckCircle, Activity, DollarSign,
  Zap, LogOut, Calculator
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const INSTRUMENTS = [
  { token: "NSE_EQ|INE009A01021", symbol: "RELIANCE", label: "Reliance Industries" },
  { token: "NSE_INDEX|Nifty 50", symbol: "NIFTY", label: "Nifty 50 Index" },
  { token: "NSE_INDEX|Nifty Bank", symbol: "BANKNIFTY", label: "Bank Nifty" },
  { token: "NSE_EQ|INE467B01029", symbol: "TCS", label: "TCS" },
  { token: "NSE_EQ|INE009B01011", symbol: "INFY", label: "Infosys" },
  { token: "NSE_EQ|INE040A01034", symbol: "HDFC", label: "HDFC Bank" },
];

export default function Dashboard() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [selectedInstrument, setSelectedInstrument] = useState(INSTRUMENTS[0]);
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [capital, setCapital] = useState(100000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [maxTrades, setMaxTrades] = useState(5);

  const botStatus = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000 });
  const liveData = trpc.bot.liveData.useQuery(undefined, { refetchInterval: 10000 });
  const tradeStats = trpc.trades.stats.useQuery();
  const tradeList = trpc.trades.list.useQuery({ limit: 20 });
  const utils = trpc.useUtils();

  const startBot = trpc.bot.start.useMutation({
    onSuccess: () => {
      toast.success("Bot started! Scanning market every minute...");
      utils.bot.status.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stopBot = trpc.bot.stop.useMutation({
    onSuccess: () => {
      toast.success("Bot stopped.");
      utils.bot.status.invalidate();
    },
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [loading, isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[oklch(0.10_0.02_240)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const status = botStatus.data;
  const live = liveData.data;
  const stats = tradeStats.data;
  const isRunning = status?.status === "running";
  const signal = live?.signal;

  const signalColor = signal?.direction === "BUY" ? "text-emerald-400" : signal?.direction === "SELL" ? "text-red-400" : "text-white/50";
  const signalBg = signal?.direction === "BUY" ? "bg-emerald-500/10 border-emerald-500/30" : signal?.direction === "SELL" ? "bg-red-500/10 border-red-500/30" : "bg-white/5 border-white/10";

  // Build mini chart from candles
  const chartData = (live?.candles ?? []).slice(-20).map((c, i) => ({ i, price: c.close }));

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
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${item.active ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="border-t border-white/10 pt-4">
          <div className="px-3 py-2 text-xs text-white/40 mb-2">{user?.name ?? "Trader"}</div>
          <button onClick={logout} className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/60 hover:bg-white/5 hover:text-white w-full transition-colors">
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Trading Dashboard</h1>
            <p className="text-white/50 text-sm">Automated scalping — EMA + VWAP + ADX strategy</p>
          </div>
          <div className="flex items-center gap-3">
            {isRunning && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1.5 text-emerald-400 text-sm">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                Bot Running
              </div>
            )}
            <Badge variant="outline" className={`${mode === "paper" ? "border-amber-500/50 text-amber-400" : "border-red-500/50 text-red-400"}`}>
              {mode === "paper" ? "Paper Trade" : "Live Trade"}
            </Badge>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Live Price", value: live?.price ? `₹${live.price.toFixed(2)}` : "—", icon: TrendingUp, color: "teal" },
            { label: "Daily P&L", value: status?.dailyPnl != null ? `₹${status.dailyPnl.toFixed(0)}` : "₹0", icon: DollarSign, color: (status?.dailyPnl ?? 0) >= 0 ? "emerald" : "red" },
            { label: "Trades Today", value: `${status?.tradesCount ?? 0} / ${status?.maxTradesPerDay ?? 5}`, icon: BarChart2, color: "purple" },
            { label: "Win Rate", value: stats?.winRate != null ? `${stats.winRate.toFixed(1)}%` : "—", icon: CheckCircle, color: "amber" },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/50 text-xs">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.color === "teal" ? "text-teal-400" : s.color === "emerald" ? "text-emerald-400" : s.color === "red" ? "text-red-400" : s.color === "purple" ? "text-purple-400" : "text-amber-400"}`} />
              </div>
              <div className={`text-xl font-bold ${s.color === "red" ? "text-red-400" : s.color === "emerald" ? "text-emerald-400" : "text-white"}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Signal + Chart row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Signal card */}
          <div className={`border rounded-2xl p-5 ${signalBg}`}>
            <div className="text-white/50 text-xs mb-3 uppercase tracking-wider">Latest Signal</div>
            {signal ? (
              <>
                <div className={`text-4xl font-black mb-2 ${signalColor}`}>
                  {signal.direction === "BUY" ? "▲ BUY" : signal.direction === "SELL" ? "▼ SELL" : "— HOLD"}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-white/50">Entry</span><span className="text-white font-mono">₹{signal.entryPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Stop Loss</span><span className="text-red-400 font-mono">₹{signal.slPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Target</span><span className="text-emerald-400 font-mono">₹{signal.targetPrice.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Confidence</span><span className="text-white font-mono">{(signal.confidence * 100).toFixed(0)}%</span></div>
                </div>
                <div className="mt-3 text-xs text-white/40 bg-white/5 rounded-lg p-2">{signal.reason}</div>
              </>
            ) : (
              <div className="text-white/30 text-sm mt-4">
                {isRunning ? "Waiting for next signal scan..." : "Start the bot to see signals"}
              </div>
            )}
          </div>

          {/* Mini chart */}
          <div className="md:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-white/50 text-xs mb-3 uppercase tracking-wider">Price Feed — {status?.instrumentSymbol ?? selectedInstrument.symbol}</div>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={["auto", "auto"]} hide />
                  <Tooltip
                    contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                    formatter={(v: number) => [`₹${v.toFixed(2)}`, "Price"]}
                  />
                  <Line type="monotone" dataKey="price" stroke="#2dd4bf" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-white/30 text-sm">
                {isRunning ? "Building price history..." : "Start bot to see live price chart"}
              </div>
            )}
          </div>
        </div>

        {/* Bot Control Panel */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2"><Bot className="w-5 h-5 text-teal-400" /> Bot Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Instrument</label>
              <select
                value={selectedInstrument.token}
                onChange={(e) => setSelectedInstrument(INSTRUMENTS.find((i) => i.token === e.target.value) ?? INSTRUMENTS[0])}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              >
                {INSTRUMENTS.map((i) => <option key={i.token} value={i.token} className="bg-gray-900">{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Mode</label>
              <div className="flex gap-2">
                {(["paper", "live"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={isRunning}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${mode === m ? (m === "paper" ? "bg-amber-500/20 border border-amber-500/50 text-amber-400" : "bg-red-500/20 border border-red-500/50 text-red-400") : "bg-white/5 border border-white/10 text-white/50 hover:bg-white/10"}`}
                  >
                    {m === "paper" ? "Paper" : "Live"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Capital (₹)</label>
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Risk per Trade (%)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="3"
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Max Trades / Day</label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxTrades}
                onChange={(e) => setMaxTrades(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
              />
            </div>
            <div className="flex items-end">
              {isRunning ? (
                <Button
                  className="w-full bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
                  onClick={() => stopBot.mutate()}
                  disabled={stopBot.isPending}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop Bot
                </Button>
              ) : (
                <Button
                  className="w-full bg-teal-500 hover:bg-teal-600 text-white"
                  onClick={() =>
                    startBot.mutate({
                      instrumentToken: selectedInstrument.token,
                      instrumentSymbol: selectedInstrument.symbol,
                      mode,
                      capital,
                      riskPerTradePct: riskPct,
                      maxTradesPerDay: maxTrades,
                      dailyLossLimitPct: 3.0,
                    })
                  }
                  disabled={startBot.isPending}
                >
                  <Play className="w-4 h-4 mr-2" />
                  {startBot.isPending ? "Starting..." : "Start Bot"}
                </Button>
              )}
            </div>
          </div>

          {mode === "live" && !isRunning && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <strong>Live Mode Warning:</strong> The bot will place real orders using your Upstox account. Make sure you have configured your API credentials in Settings and tested with Paper mode first.
              </div>
            </div>
          )}

          {status?.lastError && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 mt-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div><strong>Bot stopped:</strong> {status.lastError}</div>
            </div>
          )}
        </div>

        {/* Trade Log */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2"><BarChart2 className="w-5 h-5 text-teal-400" /> Trade Log</h2>
            <div className="flex gap-4 text-sm">
              <span className="text-white/50">Total: <span className="text-white">{stats?.totalTrades ?? 0}</span></span>
              <span className="text-emerald-400">Wins: {stats?.wins ?? 0}</span>
              <span className="text-red-400">Losses: {stats?.losses ?? 0}</span>
              <span className={`font-semibold ${(stats?.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                P&L: ₹{(stats?.totalPnl ?? 0).toFixed(0)}
              </span>
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
                {(tradeList.data ?? []).length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-white/30">No trades yet. Start the bot to begin.</td></tr>
                ) : (
                  (tradeList.data ?? []).map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-white">{t.symbol}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`flex items-center gap-1 ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                          {t.direction === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="outline" className={`text-xs ${t.mode === "paper" ? "border-amber-500/40 text-amber-400" : "border-red-500/40 text-red-400"}`}>{t.mode}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/80">₹{t.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/80">{t.exitPrice ? `₹${t.exitPrice.toFixed(2)}` : "—"}</td>
                      <td className="py-2.5 pr-4 text-right text-white/80">{t.quantity}</td>
                      <td className={`py-2.5 pr-4 text-right font-mono font-semibold ${(t.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {t.pnl != null ? `₹${t.pnl.toFixed(0)}` : "—"}
                      </td>
                      <td className="py-2.5">
                        <Badge variant="outline" className={`text-xs ${t.status === "open" ? "border-teal-500/40 text-teal-400" : t.status === "closed" ? "border-white/20 text-white/50" : "border-red-500/40 text-red-400"}`}>{t.status}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
