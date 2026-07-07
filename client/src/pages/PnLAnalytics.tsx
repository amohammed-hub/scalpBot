import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import * as XLSX from "xlsx";

function getSessionToken(): string {
  try {
    return localStorage.getItem("scalpbot_session") ?? "";
  } catch {
    return "";
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => {
  const sign = n >= 0 ? "+" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const pct = (n: number) => `${n}%`;
const clr = (n: number) => n >= 0 ? "text-emerald-400" : "text-red-400";
const bgClr = (n: number) => n >= 0 ? "#10b981" : "#ef4444";

type Tab = "daily" | "weekly" | "monthly";

// ── summary card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === undefined ? "text-white" : positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function PnLAnalytics() {
  const sessionToken = getSessionToken();
  const [tab, setTab] = useState<Tab>("daily");

  const { data: dayData = [], isLoading: dayLoading } = trpc.trades.pnlByDay.useQuery(
    { sessionToken },
    { enabled: !!sessionToken, refetchInterval: 60000 }
  );
  const { data: weekData = [], isLoading: weekLoading } = trpc.trades.pnlByWeek.useQuery(
    { sessionToken },
    { enabled: !!sessionToken, refetchInterval: 60000 }
  );
  const { data: monthData = [], isLoading: monthLoading } = trpc.trades.pnlByMonth.useQuery(
    { sessionToken },
    { enabled: !!sessionToken, refetchInterval: 60000 }
  );
  const { data: exportRows = [] } = trpc.trades.exportData.useQuery(
    { sessionToken },
    { enabled: !!sessionToken }
  );

  // ── summary stats ────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!dayData.length) return null;
    const allPnls = dayData.map(d => d.totalPnl);
    const totalPnl = allPnls.reduce((a, b) => a + b, 0);
    const totalTrades = dayData.reduce((a, d) => a + d.trades, 0);
    const totalWins = dayData.reduce((a, d) => a + d.wins, 0);
    const bestDay = dayData.reduce((best, d) => d.totalPnl > best.totalPnl ? d : best, dayData[0]);
    const worstDay = dayData.reduce((worst, d) => d.totalPnl < worst.totalPnl ? d : worst, dayData[0]);
    const avgDailyPnl = dayData.length > 0 ? totalPnl / dayData.length : 0;
    const overallWinRate = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100) : 0;
    return { totalPnl, totalTrades, totalWins, bestDay, worstDay, avgDailyPnl, overallWinRate };
  }, [dayData]);

  // ── bar chart data (last 30 days, oldest first) ──────────────────────────
  const chartData = useMemo(() => {
    return [...dayData].slice(0, 30).reverse().map(d => ({
      date: d.date.slice(5), // MM-DD
      pnl: d.totalPnl,
    }));
  }, [dayData]);

  // ── CSV export ───────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!exportRows.length) return;
    const headers = ["Date", "Time", "Symbol", "Direction", "Mode", "Entry", "Exit", "Qty", "SL", "Target", "P&L", "Status", "Exit Reason", "Confidence", "Bot Slot"];
    const rows = exportRows.map((r: typeof exportRows[0]) => [
      r.date, r.time, r.symbol, r.direction, r.mode,
      r.entryPrice, r.exitPrice, r.quantity, r.stopLoss, r.target,
      r.pnl, r.status, r.exitReason, r.confidence, r.botSlot,
    ]);
    const csv = [headers, ...rows].map((row: (string | number | null | undefined)[]) => row.map((v: string | number | null | undefined) => `"${v ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scalpbot_trades_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Excel export ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: All Trades
    const allHeaders = ["Date", "Time", "Symbol", "Direction", "Mode", "Entry", "Exit", "Qty", "SL", "Target", "P&L", "Status", "Exit Reason", "Confidence", "Bot Slot"];
    const allRows = exportRows.map((r: typeof exportRows[0]) => [
      r.date, r.time, r.symbol, r.direction, r.mode,
      r.entryPrice, r.exitPrice, r.quantity, r.stopLoss, r.target,
      r.pnl, r.status, r.exitReason, r.confidence, r.botSlot,
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([allHeaders, ...allRows]);
    ws1["!cols"] = allHeaders.map((h, i) => ({ wch: [10, 10, 20, 10, 8, 10, 10, 6, 10, 10, 10, 10, 20, 12, 8][i] }));
    XLSX.utils.book_append_sheet(wb, ws1, "All Trades");

    // Sheet 2: Daily
    const dayHeaders = ["Date", "Trades", "Wins", "Losses", "Win Rate", "Total P&L", "Best Trade", "Worst Trade", "Avg P&L", "Instruments"];
    const dayRows = dayData.map(d => [d.date, d.trades, d.wins, d.losses, `${d.winRate}%`, d.totalPnl, d.bestTrade, d.worstTrade, d.avgPnl, d.instruments]);
    const ws2 = XLSX.utils.aoa_to_sheet([dayHeaders, ...dayRows]);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Daily");

    // Sheet 3: Weekly
    const weekHeaders = ["Week", "Range", "Trades", "Wins", "Losses", "Win Rate", "Total P&L", "Best Trade", "Worst Trade", "Best Day"];
    const weekRows = weekData.map(w => [w.weekKey, w.weekRange, w.trades, w.wins, w.losses, `${w.winRate}%`, w.totalPnl, w.bestTrade, w.worstTrade, w.bestDay]);
    const ws3 = XLSX.utils.aoa_to_sheet([weekHeaders, ...weekRows]);
    ws3["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Weekly");

    // Sheet 4: Monthly
    const monthHeaders = ["Month", "Trades", "Wins", "Losses", "Win Rate", "Total P&L", "Best Trade", "Worst Trade", "Avg Daily P&L", "Trading Days", "Consistency"];
    const monthRows = monthData.map(m => [m.monthLabel, m.trades, m.wins, m.losses, `${m.winRate}%`, m.totalPnl, m.bestTrade, m.worstTrade, m.avgDailyPnl, m.tradingDays, `${m.consistency}%`]);
    const ws4 = XLSX.utils.aoa_to_sheet([monthHeaders, ...monthRows]);
    ws4["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, "Monthly");

    XLSX.writeFile(wb, `scalpbot_pnl_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const isLoading = dayLoading || weekLoading || monthLoading;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-2xl">📊</span> P&amp;L Analytics
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">Day / Week / Month breakdown with export</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            disabled={!exportRows.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg disabled:opacity-40 transition-colors"
          >
            <span>📄</span> Export CSV
          </button>
          <button
            onClick={exportExcel}
            disabled={!exportRows.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 rounded-lg disabled:opacity-40 transition-colors font-medium"
          >
            <span>📊</span> Export Excel (4 sheets)
          </button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-7xl mx-auto">
        {/* Summary Cards */}
        {summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Total P&L" value={fmt(summary.totalPnl)} positive={summary.totalPnl >= 0} />
            <StatCard label="Total Trades" value={String(summary.totalTrades)} sub={`${summary.totalWins}W / ${summary.totalTrades - summary.totalWins}L`} />
            <StatCard label="Win Rate" value={pct(summary.overallWinRate)} positive={summary.overallWinRate >= 50} />
            <StatCard label="Avg Daily P&L" value={fmt(summary.avgDailyPnl)} positive={summary.avgDailyPnl >= 0} />
            <StatCard label="Best Day" value={fmt(summary.bestDay.totalPnl)} sub={summary.bestDay.date} positive />
            <StatCard label="Worst Day" value={fmt(summary.worstDay.totalPnl)} sub={summary.worstDay.date} positive={false} />
            <StatCard label="Trading Days" value={String(dayData.length)} sub="with closed trades" />
          </div>
        ) : !isLoading && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium">No closed trades yet</p>
            <p className="text-sm mt-1">Start the bot and complete some trades to see analytics here.</p>
          </div>
        )}

        {/* Bar Chart — Last 30 Days */}
        {chartData.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-zinc-400 mb-3">Daily P&amp;L — Last {chartData.length} Trading Days</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [fmt(value), "P&L"]}
                />
                <ReferenceLine y={0} stroke="#3f3f46" />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={bgClr(entry.pnl)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800">
            {(["daily", "weekly", "monthly"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? "text-white border-b-2 border-emerald-500 bg-zinc-800"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "daily" ? "📅 Daily" : t === "weekly" ? "📆 Weekly" : "🗓️ Monthly"}
              </button>
            ))}
          </div>

          {/* Daily Table */}
          {tab === "daily" && (
            <div className="overflow-x-auto">
              {dayLoading ? (
                <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
              ) : dayData.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800">
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-right">Trades</th>
                      <th className="px-4 py-3 text-right">W / L</th>
                      <th className="px-4 py-3 text-right">Win Rate</th>
                      <th className="px-4 py-3 text-right">Total P&amp;L</th>
                      <th className="px-4 py-3 text-right">Best Trade</th>
                      <th className="px-4 py-3 text-right">Worst Trade</th>
                      <th className="px-4 py-3 text-right">Avg P&amp;L</th>
                      <th className="px-4 py-3 text-left">Instruments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayData.map((d, i) => (
                      <tr key={d.date} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-zinc-900/50"}`}>
                        <td className="px-4 py-3 font-mono text-zinc-300">{d.date}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{d.trades}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-emerald-400">{d.wins}</span>
                          <span className="text-zinc-600"> / </span>
                          <span className="text-red-400">{d.losses}</span>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${clr(d.winRate - 50)}`}>{pct(d.winRate)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${clr(d.totalPnl)}`}>{fmt(d.totalPnl)}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{fmt(d.bestTrade)}</td>
                        <td className="px-4 py-3 text-right text-red-400">{fmt(d.worstTrade)}</td>
                        <td className={`px-4 py-3 text-right ${clr(d.avgPnl)}`}>{fmt(d.avgPnl)}</td>
                        <td className="px-4 py-3 text-zinc-500 text-xs max-w-[160px] truncate">{d.instruments || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Weekly Table */}
          {tab === "weekly" && (
            <div className="overflow-x-auto">
              {weekLoading ? (
                <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
              ) : weekData.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800">
                      <th className="px-4 py-3 text-left">Week</th>
                      <th className="px-4 py-3 text-left">Range</th>
                      <th className="px-4 py-3 text-right">Trades</th>
                      <th className="px-4 py-3 text-right">W / L</th>
                      <th className="px-4 py-3 text-right">Win Rate</th>
                      <th className="px-4 py-3 text-right">Total P&amp;L</th>
                      <th className="px-4 py-3 text-right">Best Trade</th>
                      <th className="px-4 py-3 text-right">Worst Trade</th>
                      <th className="px-4 py-3 text-right">Best Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekData.map((w, i) => (
                      <tr key={w.weekKey} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-zinc-900/50"}`}>
                        <td className="px-4 py-3 font-mono text-zinc-300 text-xs">{w.weekKey}</td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">{w.weekRange}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{w.trades}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-emerald-400">{w.wins}</span>
                          <span className="text-zinc-600"> / </span>
                          <span className="text-red-400">{w.losses}</span>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${clr(w.winRate - 50)}`}>{pct(w.winRate)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${clr(w.totalPnl)}`}>{fmt(w.totalPnl)}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{fmt(w.bestTrade)}</td>
                        <td className="px-4 py-3 text-right text-red-400">{fmt(w.worstTrade)}</td>
                        <td className="px-4 py-3 text-right text-zinc-400 text-xs">{w.bestDay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Monthly Table */}
          {tab === "monthly" && (
            <div className="overflow-x-auto">
              {monthLoading ? (
                <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
              ) : monthData.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 uppercase border-b border-zinc-800">
                      <th className="px-4 py-3 text-left">Month</th>
                      <th className="px-4 py-3 text-right">Trades</th>
                      <th className="px-4 py-3 text-right">W / L</th>
                      <th className="px-4 py-3 text-right">Win Rate</th>
                      <th className="px-4 py-3 text-right">Total P&amp;L</th>
                      <th className="px-4 py-3 text-right">Best Trade</th>
                      <th className="px-4 py-3 text-right">Worst Trade</th>
                      <th className="px-4 py-3 text-right">Avg Daily P&amp;L</th>
                      <th className="px-4 py-3 text-right">Trading Days</th>
                      <th className="px-4 py-3 text-right">Consistency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthData.map((m, i) => (
                      <tr key={m.monthKey} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-zinc-900/50"}`}>
                        <td className="px-4 py-3 font-medium text-zinc-200">{m.monthLabel}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{m.trades}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-emerald-400">{m.wins}</span>
                          <span className="text-zinc-600"> / </span>
                          <span className="text-red-400">{m.losses}</span>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${clr(m.winRate - 50)}`}>{pct(m.winRate)}</td>
                        <td className={`px-4 py-3 text-right font-bold text-lg ${clr(m.totalPnl)}`}>{fmt(m.totalPnl)}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{fmt(m.bestTrade)}</td>
                        <td className="px-4 py-3 text-right text-red-400">{fmt(m.worstTrade)}</td>
                        <td className={`px-4 py-3 text-right ${clr(m.avgDailyPnl)}`}>{fmt(m.avgDailyPnl)}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">{m.tradingDays}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${m.consistency >= 60 ? "text-emerald-400" : m.consistency >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                            {pct(m.consistency)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Footer note */}
        <p className="text-xs text-zinc-600 text-center pb-4">
          All times in IST (UTC+5:30). Only closed trades are included. Open trades are excluded from P&amp;L calculations.
        </p>
      </div>
    </div>
  );
}
