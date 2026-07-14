import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Play, BarChart2, TrendingUp, TrendingDown,
  CheckCircle, XCircle, Minus, AlertTriangle, Info
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell
} from "recharts";

const LS_SESSION = "scalpbot_session";
function getSessionToken(): string {
  let t = localStorage.getItem(LS_SESSION);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(LS_SESSION, t); }
  return t;
}

const INSTRUMENTS = [
  { token: "NSE_INDEX|Nifty 50",           label: "Nifty 50 (Spot)" },
  { token: "NSE_INDEX|Nifty Bank",         label: "Bank Nifty (Spot)" },
  { token: "NSE_INDEX|Nifty Fin Service",  label: "Fin Nifty (Spot)" },
  { token: "MCX_FO|552720",               label: "Gold (MCX)" },
  { token: "MCX_FO|471725",               label: "Silver (MCX)" },
  { token: "MCX_FO|520702",               label: "Crude Oil (MCX)" },
  { token: "MCX_FO|538685",               label: "Natural Gas (MCX)" },
  { token: "NSE_EQ|INE009A01021",         label: "Reliance Industries" },
  { token: "NSE_EQ|INE467B01029",         label: "TCS" },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}

type BacktestResult = {
  totalTrades: number; wins: number; losses: number; winRate: number;
  totalPnl: number; avgWin: number; avgLoss: number; profitFactor: number;
  equityCurve: { time: number; equity: number }[];
  trades: Array<{
    entryTime: number; exitTime: number; direction: "BUY" | "SELL";
    entryPrice: number; slPrice: number; targetPrice: number; exitPrice: number;
    pnl: number; result: "WIN" | "LOSS" | "BE"; confidence: number; layer: string;
  }>;
  candleCount: number; fromDate: string; toDate: string;
};

export default function Backtest() {
  const [, navigate] = useLocation();
  const sessionToken = getSessionToken();

  const [instrumentToken, setInstrumentToken] = useState(INSTRUMENTS[0].token);
  const [fromDate, setFromDate] = useState(daysAgoStr(30));
  const [toDate, setToDate] = useState(todayStr());
  const [capital, setCapital] = useState(100000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [slMultiplier, setSlMultiplier] = useState(1.5);
  const [tpMultiplier, setTpMultiplier] = useState(3.0);
  const [minConfidence, setMinConfidence] = useState(60);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [tab, setTab] = useState<"equity" | "trades" | "distribution">("equity");

  const runMutation = trpc.backtest.run.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(`Backtest complete — ${data.totalTrades} trades on ${data.candleCount} candles`);
    },
    onError: (e) => toast.error(`Backtest failed: ${e.message}`),
  });

  const handleRun = () => {
    if (fromDate >= toDate) { toast.error("From date must be before To date"); return; }
    runMutation.mutate({
      sessionToken, instrumentToken, fromDate, toDate,
      capital, riskPct, slMultiplier, tpMultiplier,
      minConfidence: minConfidence / 100,
    });
  };

  const equityCurveData = useMemo(() => {
    if (!result) return [];
    return [{ time: 0, equity: capital }, ...result.equityCurve];
  }, [result, capital]);

  const pnlDistribution = useMemo(() => {
    if (!result) return [];
    const buckets: Record<string, number> = {};
    for (const t of result.trades) {
      const bucket = Math.round(t.pnl / 500) * 500;
      const key = bucket >= 0 ? `+${bucket}` : `${bucket}`;
      buckets[key] = (buckets[key] ?? 0) + 1;
    }
    return Object.entries(buckets)
      .map(([k, v]) => ({ label: k, count: v, positive: !k.startsWith("-") }))
      .sort((a, b) => parseFloat(a.label) - parseFloat(b.label));
  }, [result]);

  const maxDD = useMemo(() => {
    if (!equityCurveData.length) return 0;
    let peak = equityCurveData[0].equity;
    let maxDrawdown = 0;
    for (const p of equityCurveData) {
      if (p.equity > peak) peak = p.equity;
      const dd = (peak - p.equity) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    return Math.round(maxDrawdown * 100) / 100;
  }, [equityCurveData]);

  return (
    <div className="min-h-screen bg-[oklch(0.11_0.025_240)] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </button>
        <div className="w-px h-4 bg-white/20" />
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-teal-400" />
          <span className="font-bold text-white">Strategy Backtester</span>
        </div>
        <span className="text-xs text-white/30 ml-auto">Replay 1-min candles through the ScalpBot signal engine</span>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Config Panel */}
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-4">Backtest Parameters</div>

            {/* Instrument */}
            <label className="block mb-3">
              <span className="text-xs text-white/50 mb-1 block">Instrument</span>
              <select value={instrumentToken} onChange={e => setInstrumentToken(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500/50">
                {INSTRUMENTS.map(i => (
                  <option key={i.token} value={i.token} className="bg-zinc-900">{i.label}</option>
                ))}
              </select>
            </label>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <label>
                <span className="text-xs text-white/50 mb-1 block">From Date</span>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  max={toDate}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500/50 [color-scheme:dark]" />
              </label>
              <label>
                <span className="text-xs text-white/50 mb-1 block">To Date</span>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  min={fromDate} max={todayStr()}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500/50 [color-scheme:dark]" />
              </label>
            </div>

            {/* Capital */}
            <label className="block mb-3">
              <span className="text-xs text-white/50 mb-1 block">Starting Capital (₹)</span>
              <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
                min={10000} step={10000}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500/50" />
            </label>

            {/* Risk per trade */}
            <label className="block mb-3">
              <span className="text-xs text-white/50 mb-1 block">Risk per Trade (%)</span>
              <div className="flex items-center gap-3">
                <input type="range" min={0.5} max={5} step={0.5} value={riskPct}
                  onChange={e => setRiskPct(Number(e.target.value))}
                  className="flex-1 accent-teal-500" />
                <span className="text-sm text-teal-400 w-10 text-right">{riskPct}%</span>
              </div>
            </label>

            {/* SL Multiplier */}
            <label className="block mb-3">
              <span className="text-xs text-white/50 mb-1 block">SL Multiplier (ATR×)</span>
              <div className="flex items-center gap-3">
                <input type="range" min={0.5} max={4} step={0.5} value={slMultiplier}
                  onChange={e => setSlMultiplier(Number(e.target.value))}
                  className="flex-1 accent-teal-500" />
                <span className="text-sm text-teal-400 w-10 text-right">{slMultiplier}×</span>
              </div>
            </label>

            {/* TP Multiplier */}
            <label className="block mb-3">
              <span className="text-xs text-white/50 mb-1 block">TP Multiplier (ATR×)</span>
              <div className="flex items-center gap-3">
                <input type="range" min={1} max={8} step={0.5} value={tpMultiplier}
                  onChange={e => setTpMultiplier(Number(e.target.value))}
                  className="flex-1 accent-teal-500" />
                <span className="text-sm text-teal-400 w-10 text-right">{tpMultiplier}×</span>
              </div>
            </label>

            {/* Min Confidence */}
            <label className="block mb-4">
              <span className="text-xs text-white/50 mb-1 block">Min Signal Confidence (%)</span>
              <div className="flex items-center gap-3">
                <input type="range" min={40} max={90} step={5} value={minConfidence}
                  onChange={e => setMinConfidence(Number(e.target.value))}
                  className="flex-1 accent-teal-500" />
                <span className="text-sm text-teal-400 w-10 text-right">{minConfidence}%</span>
              </div>
            </label>

            <button onClick={handleRun} disabled={runMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-xl py-3 transition-colors active:scale-[0.98]">
              {runMutation.isPending
                ? <><span className="animate-spin border-2 border-black/30 border-t-black rounded-full w-4 h-4" /> Running…</>
                : <><Play className="w-4 h-4" /> Run Backtest</>
              }
            </button>
          </div>

          {/* Info box */}
          <div className="bg-white/3 border border-white/8 rounded-xl p-4 flex items-start gap-2">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <p className="text-xs text-white/40 leading-relaxed">
              Backtesting uses the same multi-layer signal engine as the live bot.
              Requires a valid Upstox access token in Settings. Historical 1-min candles
              are fetched from Upstox for the selected date range. Max 30 days recommended.
            </p>
          </div>
        </div>

        {/* Results Panel */}
        <div className="space-y-4">
          {!result && !runMutation.isPending && (
            <div className="bg-white/5 border border-white/10 rounded-2xl flex flex-col items-center justify-center py-24 text-center gap-4">
              <BarChart2 className="w-12 h-12 text-white/20" />
              <div>
                <p className="text-white/40 font-medium">No backtest run yet</p>
                <p className="text-white/25 text-sm mt-1">Configure parameters and click Run Backtest</p>
              </div>
            </div>
          )}

          {runMutation.isPending && (
            <div className="bg-white/5 border border-white/10 rounded-2xl flex flex-col items-center justify-center py-24 text-center gap-4">
              <span className="animate-spin border-2 border-teal-500/30 border-t-teal-400 rounded-full w-10 h-10" />
              <div>
                <p className="text-white/60 font-medium">Fetching candles & replaying signals…</p>
                <p className="text-white/30 text-sm mt-1">This may take up to 15 seconds</p>
              </div>
            </div>
          )}

          {result && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Trades", value: String(result.totalTrades), color: "text-white" },
                  { label: "Win Rate", value: `${result.winRate}%`, color: result.winRate >= 50 ? "text-emerald-400" : "text-red-400" },
                  { label: "Net P&L", value: `${result.totalPnl >= 0 ? "+" : ""}₹${result.totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: result.totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
                  { label: "Profit Factor", value: result.profitFactor === 999 ? "∞" : String(result.profitFactor), color: result.profitFactor >= 1.5 ? "text-emerald-400" : result.profitFactor >= 1 ? "text-amber-400" : "text-red-400" },
                  { label: "Avg Win", value: `+₹${result.avgWin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "text-emerald-400" },
                  { label: "Avg Loss", value: `₹${result.avgLoss.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "text-red-400" },
                  { label: "Max Drawdown", value: `${maxDD}%`, color: maxDD < 10 ? "text-emerald-400" : maxDD < 20 ? "text-amber-400" : "text-red-400" },
                  { label: "Candles", value: result.candleCount.toLocaleString(), color: "text-white/60" },
                ].map(s => (
                  <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="text-xs text-white/40 mb-1">{s.label}</div>
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Win/Loss bar */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">{result.wins} Wins</span>
                </div>
                <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${result.totalTrades > 0 ? (result.wins / result.totalTrades) * 100 : 0}%` }} />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-semibold">{result.losses} Losses</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="flex border-b border-white/10">
                  {(["equity", "trades", "distribution"] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`px-5 py-3 text-sm font-medium transition-colors capitalize ${
                        tab === t ? "text-teal-400 border-b-2 border-teal-400 bg-teal-500/5" : "text-white/40 hover:text-white/70"
                      }`}>
                      {t === "equity" ? "Equity Curve" : t === "trades" ? "Trade Log" : "P&L Distribution"}
                    </button>
                  ))}
                </div>

                <div className="p-5">
                  {/* Equity Curve */}
                  {tab === "equity" && (
                    <div>
                      <p className="text-xs text-white/30 mb-3">Cumulative equity starting from ₹{capital.toLocaleString("en-IN")}</p>
                      {equityCurveData.length < 2 ? (
                        <div className="flex items-center justify-center h-48 text-white/30 text-sm">No trades to plot</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
                          <LineChart data={equityCurveData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                            <XAxis dataKey="time" hide />
                            <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                              tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`}
                              axisLine={false} tickLine={false} width={56} />
                            <Tooltip
                              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                              labelStyle={{ display: "none" }}
                              formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Equity"]}
                            />
                            <ReferenceLine y={capital} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                            <Line type="monotone" dataKey="equity" stroke="#14b8a6" strokeWidth={2} dot={false}
                              activeDot={{ r: 4, fill: "#14b8a6" }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  )}

                  {/* Trade Log */}
                  {tab === "trades" && (
                    <div className="overflow-x-auto">
                      {result.trades.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-white/30 text-sm">No trades generated</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-white/40 border-b border-white/10">
                              <th className="text-left py-2 pr-4">Time</th>
                              <th className="text-left py-2 pr-4">Dir</th>
                              <th className="text-right py-2 pr-4">Entry</th>
                              <th className="text-right py-2 pr-4">Exit</th>
                              <th className="text-right py-2 pr-4">P&L</th>
                              <th className="text-left py-2 pr-4">Layer</th>
                              <th className="text-center py-2">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.trades.map((t, i) => (
                              <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                                <td className="py-2 pr-4 text-white/40">
                                  {new Date(t.entryTime).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td className="py-2 pr-4">
                                  <span className={`flex items-center gap-1 font-medium ${t.direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                                    {t.direction === "BUY" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                    {t.direction}
                                  </span>
                                </td>
                                <td className="py-2 pr-4 text-right text-white/70">₹{t.entryPrice.toFixed(2)}</td>
                                <td className="py-2 pr-4 text-right text-white/70">₹{t.exitPrice.toFixed(2)}</td>
                                <td className={`py-2 pr-4 text-right font-semibold ${t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-red-400" : "text-white/40"}`}>
                                  {t.pnl >= 0 ? "+" : ""}₹{t.pnl.toFixed(0)}
                                </td>
                                <td className="py-2 pr-4">
                                  <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-white/50">{t.layer}</span>
                                </td>
                                <td className="py-2 text-center">
                                  {t.result === "WIN"
                                    ? <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" />
                                    : t.result === "LOSS"
                                    ? <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                                    : <Minus className="w-4 h-4 text-white/30 mx-auto" />
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {result.trades.length === 200 && (
                        <p className="text-xs text-white/30 mt-3 text-center">Showing first 200 trades</p>
                      )}
                    </div>
                  )}

                  {/* P&L Distribution */}
                  {tab === "distribution" && (
                    <div>
                      <p className="text-xs text-white/30 mb-3">Trade P&L bucketed in ₹500 intervals</p>
                      {pnlDistribution.length === 0 ? (
                        <div className="flex items-center justify-center h-48 text-white/30 text-sm">No trades to plot</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={pnlDistribution} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                            <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                              axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                              axisLine={false} tickLine={false} width={28} />
                            <Tooltip
                              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: number) => [v, "Trades"]}
                            />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                              {pnlDistribution.map((entry, idx) => (
                                <Cell key={idx} fill={entry.positive ? "#10b981" : "#ef4444"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-300/70 text-xs leading-relaxed">
                  <strong className="text-amber-400">Disclaimer:</strong> Past performance does not guarantee future results.
                  Backtesting assumes ideal fill at candle open/close prices and does not account for slippage, brokerage, or market impact.
                  Always validate with paper trading before going live.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
