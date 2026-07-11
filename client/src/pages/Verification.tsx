import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine, Area, AreaChart } from "recharts";
import { toast } from "sonner";

function getSessionToken(): string {
  try { return localStorage.getItem("scalpbot_session") ?? ""; } catch { return ""; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => `${n >= 0 ? "+" : ""}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const clr = (n: number) => n >= 0 ? "text-emerald-400" : "text-red-400";

function MetricCard({ label, value, sub, positive, icon }: { label: string; value: string; sub?: string; positive?: boolean; icon?: string }) {
  const color = positive === undefined ? "text-white" : positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1 hover:border-zinc-700 transition-colors">
      <div className="flex items-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
      </div>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

function GradeIndicator({ score }: { score: number }) {
  const grade = score >= 80 ? "A+" : score >= 70 ? "A" : score >= 60 ? "B+" : score >= 50 ? "B" : score >= 40 ? "C" : "D";
  const gradeColor = score >= 70 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const ringColor = score >= 70 ? "stroke-emerald-400" : score >= 50 ? "stroke-amber-400" : "stroke-red-400";
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" strokeWidth="6" className="stroke-zinc-800" />
          <circle cx="50" cy="50" r="45" fill="none" strokeWidth="6" className={ringColor}
            strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease-out" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${gradeColor}`}>{grade}</span>
          <span className="text-xs text-zinc-500">{score}%</span>
        </div>
      </div>
      <span className="text-xs text-zinc-500 uppercase tracking-wide">Precision Score</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Verification() {
  const [, navigate] = useLocation();
  const sessionToken = getSessionToken();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<"overview" | "layers" | "daily">("overview");

  const fromDate = useMemo(() => {
    const d = new Date(Date.now() - days * 86400000);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const { data: metrics, isLoading: metricsLoading } = trpc.precision.metrics.useQuery(
    { sessionToken, fromDate, capital: 100000 },
    { enabled: !!sessionToken, refetchInterval: 60000 }
  );

  const { data: layers = [], isLoading: layersLoading } = trpc.precision.layerAccuracy.useQuery(
    { sessionToken, fromDate },
    { enabled: !!sessionToken && tab === "layers", refetchInterval: 60000 }
  );

  const { data: dailyReports = [], isLoading: dailyLoading } = trpc.precision.dailyReports.useQuery(
    { sessionToken, days },
    { enabled: !!sessionToken && tab === "daily", refetchInterval: 60000 }
  );

  // Compute precision score (composite of win rate, profit factor, sharpe, drawdown)
  const precisionScore = useMemo(() => {
    if (!metrics) return 0;
    const wrScore = Math.min(metrics.winRate / 60 * 30, 30); // max 30 pts for 60%+ win rate
    const pfScore = Math.min((metrics.profitFactor / 2) * 25, 25); // max 25 pts for PF >= 2
    const shScore = Math.min((metrics.sharpeRatio / 2) * 25, 25); // max 25 pts for Sharpe >= 2
    const ddScore = Math.max(0, 20 - metrics.maxDrawdown); // max 20 pts for < 20% DD
    return Math.round(wrScore + pfScore + shScore + ddScore);
  }, [metrics]);

  if (!sessionToken) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">No session found. Start trading first.</p>
          <button onClick={() => navigate("/dashboard")} className="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-zinc-400 hover:text-white transition-colors">
              ← Dashboard
            </button>
            <h1 className="text-lg font-semibold">Precision Verification</h1>
            <span className="text-xs bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800">
              {metrics ? `${metrics.totalTrades} trades` : "Loading..."}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last 1 year</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
          {(["overview", "layers", "daily"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "overview" ? "📊 Overview" : t === "layers" ? "🎯 Layer Accuracy" : "📅 Daily Reports"}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {tab === "overview" && (
          <>
            {metricsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-24 animate-pulse" />
                ))}
              </div>
            ) : !metrics ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <p className="text-zinc-400 text-lg mb-2">No trading data yet</p>
                <p className="text-zinc-500 text-sm">Start the bot in paper mode and let it run for a few days to collect precision data.</p>
              </div>
            ) : (
              <>
                {/* Precision Score + Key Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex items-center justify-center">
                    <GradeIndicator score={precisionScore} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard icon="🎯" label="Win Rate" value={pct(metrics.winRate)} positive={metrics.winRate >= 50} sub={`${metrics.wins}W / ${metrics.losses}L`} />
                    <MetricCard icon="📈" label="Profit Factor" value={metrics.profitFactor.toFixed(2)} positive={metrics.profitFactor >= 1.5} sub={metrics.profitFactor >= 2 ? "Excellent" : metrics.profitFactor >= 1.5 ? "Good" : "Needs work"} />
                    <MetricCard icon="⚡" label="Sharpe Ratio" value={metrics.sharpeRatio.toFixed(2)} positive={metrics.sharpeRatio >= 1} sub={metrics.sharpeRatio >= 2 ? "Outstanding" : metrics.sharpeRatio >= 1 ? "Good" : "Below average"} />
                    <MetricCard icon="📉" label="Max Drawdown" value={pct(metrics.maxDrawdown)} positive={metrics.maxDrawdown < 10} sub={fmt(-metrics.maxDrawdownAmount)} />
                    <MetricCard icon="💰" label="Expectancy" value={fmt(metrics.expectancy)} positive={metrics.expectancy > 0} sub="Per trade avg" />
                    <MetricCard icon="🔄" label="Avg R:R" value={metrics.avgRR.toFixed(2) + ":1"} positive={metrics.avgRR >= 1.5} sub={`Avg Win: ${fmt(metrics.avgWin)}`} />
                    <MetricCard icon="🎪" label="Signal Precision" value={pct(metrics.signalPrecision)} positive={metrics.signalPrecision >= 50} sub={`${metrics.signalsTaken}/${metrics.totalSignals} taken`} />
                    <MetricCard icon="📊" label="Calmar Ratio" value={metrics.calmarRatio.toFixed(2)} positive={metrics.calmarRatio >= 1} sub={`${metrics.tradingDays} trading days`} />
                  </div>
                </div>

                {/* Equity Curve */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Equity Curve</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={metrics.equityCurve}>
                      <defs>
                        <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                        labelStyle={{ color: "#a1a1aa" }}
                        formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Equity"]}
                      />
                      <ReferenceLine y={100000} stroke="#3f3f46" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#equityGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Streaks + Time Analysis */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-zinc-400 mb-3">Streak Analysis</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Current Streak</span>
                        <span className={`font-bold ${metrics.currentStreak.type === "win" ? "text-emerald-400" : metrics.currentStreak.type === "loss" ? "text-red-400" : "text-zinc-400"}`}>
                          {metrics.currentStreak.count > 0 ? `${metrics.currentStreak.count} ${metrics.currentStreak.type === "win" ? "wins" : "losses"}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Max Win Streak</span>
                        <span className="font-bold text-emerald-400">{metrics.maxWinStreak}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Max Loss Streak</span>
                        <span className="font-bold text-red-400">{metrics.maxLossStreak}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Avg Hold Duration</span>
                        <span className="font-bold text-white">{metrics.avgHoldDurationMin} min</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-zinc-400 mb-3">Time Analysis</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Best Hour</span>
                        <span className="font-bold text-emerald-400">
                          {metrics.bestHour ? `${metrics.bestHour.hour}:00 (${fmt(metrics.bestHour.pnl)})` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Worst Hour</span>
                        <span className="font-bold text-red-400">
                          {metrics.worstHour ? `${metrics.worstHour.hour}:00 (${fmt(metrics.worstHour.pnl)})` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Period</span>
                        <span className="font-bold text-white">{metrics.fromDate} → {metrics.toDate}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 text-sm">Trading Days</span>
                        <span className="font-bold text-white">{metrics.tradingDays}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Subscription Readiness */}
                <div className={`border rounded-xl p-4 ${precisionScore >= 60 ? "bg-emerald-950/30 border-emerald-800" : "bg-amber-950/30 border-amber-800"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{precisionScore >= 60 ? "✅" : "⚠️"}</span>
                    <div>
                      <h3 className={`font-semibold ${precisionScore >= 60 ? "text-emerald-400" : "text-amber-400"}`}>
                        {precisionScore >= 60 ? "Ready for Subscription" : "Not Yet Ready"}
                      </h3>
                      <p className="text-sm text-zinc-400">
                        {precisionScore >= 60
                          ? `Precision score of ${precisionScore}% meets the threshold for paid subscriptions. Your bot has demonstrated consistent profitability.`
                          : `Precision score of ${precisionScore}% is below the 60% threshold. Continue paper trading to improve metrics before offering subscriptions.`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Layer Accuracy Tab */}
        {tab === "layers" && (
          <>
            {layersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-16 animate-pulse" />
                ))}
              </div>
            ) : layers.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <p className="text-zinc-400">No layer data yet. Start trading to see per-strategy accuracy.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-[1fr_80px_80px_80px_100px_80px_80px] gap-2 px-4 text-xs text-zinc-500 uppercase tracking-wide">
                  <span>Layer</span>
                  <span className="text-right">Trades</span>
                  <span className="text-right">Win Rate</span>
                  <span className="text-right">PF</span>
                  <span className="text-right">Total P&L</span>
                  <span className="text-right">Avg P&L</span>
                  <span className="text-right">Precision</span>
                </div>
                {layers.map(layer => (
                  <div key={layer.layer} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 grid grid-cols-[1fr_80px_80px_80px_100px_80px_80px] gap-2 items-center hover:border-zinc-700 transition-colors">
                    <div>
                      <span className="font-medium text-white">{layer.layer}</span>
                      <span className="text-xs text-zinc-500 ml-2">({layer.totalSignals} signals)</span>
                    </div>
                    <span className="text-right text-sm text-zinc-300">{layer.trades}</span>
                    <span className={`text-right text-sm font-medium ${layer.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                      {layer.winRate.toFixed(0)}%
                    </span>
                    <span className={`text-right text-sm font-medium ${layer.profitFactor >= 1.5 ? "text-emerald-400" : layer.profitFactor >= 1 ? "text-amber-400" : "text-red-400"}`}>
                      {layer.profitFactor.toFixed(2)}
                    </span>
                    <span className={`text-right text-sm font-bold ${layer.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmt(layer.totalPnl)}
                    </span>
                    <span className={`text-right text-sm ${layer.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmt(layer.avgPnl)}
                    </span>
                    <span className={`text-right text-sm font-medium ${layer.precision >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                      {layer.precision.toFixed(0)}%
                    </span>
                  </div>
                ))}

                {/* Layer Summary */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mt-4">
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Layer Performance Heatmap</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {layers.map(layer => {
                      const intensity = Math.min(1, Math.max(0, (layer.winRate - 30) / 40));
                      const bg = layer.totalPnl >= 0
                        ? `rgba(16, 185, 129, ${0.1 + intensity * 0.4})`
                        : `rgba(239, 68, 68, ${0.1 + (1 - intensity) * 0.4})`;
                      return (
                        <div key={layer.layer} className="rounded-lg p-3 border border-zinc-800" style={{ background: bg }}>
                          <div className="text-xs font-medium text-white truncate">{layer.layer}</div>
                          <div className="text-lg font-bold mt-1" style={{ color: layer.totalPnl >= 0 ? "#10b981" : "#ef4444" }}>
                            {fmt(layer.totalPnl)}
                          </div>
                          <div className="text-xs text-zinc-400">{layer.trades} trades • {layer.winRate.toFixed(0)}% WR</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Daily Reports Tab */}
        {tab === "daily" && (
          <>
            {dailyLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-12 animate-pulse" />
                ))}
              </div>
            ) : dailyReports.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <p className="text-zinc-400">No daily data yet. Start trading to see daily performance reports.</p>
              </div>
            ) : (
              <>
                {/* Daily P&L Chart */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Daily P&L</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[...dailyReports].reverse()}>
                      <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={v => `₹${v}`} />
                      <Tooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                        labelStyle={{ color: "#a1a1aa" }}
                        formatter={(value: number) => [fmt(value), "P&L"]}
                      />
                      <ReferenceLine y={0} stroke="#3f3f46" />
                      <Bar dataKey="pnl">
                        {[...dailyReports].reverse().map((entry, i) => (
                          <Cell key={i} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Daily Table */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
                        <th className="text-left p-3">Date</th>
                        <th className="text-right p-3">Trades</th>
                        <th className="text-right p-3">W/L</th>
                        <th className="text-right p-3">Win Rate</th>
                        <th className="text-right p-3">P&L</th>
                        <th className="text-right p-3">Best</th>
                        <th className="text-right p-3">Worst</th>
                        <th className="text-right p-3">Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReports.map(day => (
                        <tr key={day.date} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                          <td className="p-3 font-medium text-white">{day.date}</td>
                          <td className="p-3 text-right text-zinc-300">{day.trades}</td>
                          <td className="p-3 text-right">
                            <span className="text-emerald-400">{day.wins}</span>
                            <span className="text-zinc-600">/</span>
                            <span className="text-red-400">{day.losses}</span>
                          </td>
                          <td className={`p-3 text-right font-medium ${day.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                            {day.winRate}%
                          </td>
                          <td className={`p-3 text-right font-bold ${day.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {fmt(day.pnl)}
                          </td>
                          <td className="p-3 text-right text-emerald-400">{fmt(day.bestTrade)}</td>
                          <td className="p-3 text-right text-red-400">{fmt(day.worstTrade)}</td>
                          <td className="p-3 text-right text-zinc-400">{day.signalsTaken}/{day.signals}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
