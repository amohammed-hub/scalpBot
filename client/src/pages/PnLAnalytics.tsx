import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import PullToRefresh from "@/components/PullToRefresh";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, CartesianGrid,
} from "recharts";
import * as XLSX from "xlsx";

// ── types ────────────────────────────────────────────────────────────────────
interface TradeRow {
  id: number;
  date: string;
  time: string;
  exitTime: string;
  exitDate: string;
  symbol: string;
  direction: string;
  mode: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  stopLoss: number;
  target: number;
  pnl: number;
  status: string;
  exitReason: string;
  confidence: number;
  botSlot: number;
  strategy: string;
  partialProfit: number;
  duration: string;
  enteredAt: Date | string | null;
  exitedAt: Date | string | null;
}

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

type ChartView = "per-trade" | "cumulative";
type TimeTab = "daily" | "weekly" | "monthly";

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
  const [, navigate] = useLocation();
  const sessionToken = getSessionToken();

  // ── Auth Gate ──────────────────────────────────────────────────────────────
  const meQuery = trpc.mobileAuth.me.useQuery(undefined, { staleTime: 5_000, retry: 2 });
  useEffect(() => {
    if (meQuery.isFetched && !meQuery.data) {
      localStorage.removeItem("scalpbot_auth_token");
      navigate("/login");
    }
  }, [meQuery.isFetched, meQuery.data, navigate]);

  const [chartView, setChartView] = useState<ChartView>("per-trade");
  const [botFilter, setBotFilter] = useState<string>("all");
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [timeTab, setTimeTab] = useState<TimeTab>("daily");

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
  const { data: exportRows = [], isLoading: exportLoading } = trpc.trades.exportData.useQuery(
    { sessionToken },
    { enabled: !!sessionToken }
  );

  // ── derived: unique bots and instruments for filters ────────────────────
  const { botOptions, instrumentOptions } = useMemo(() => {
    const bots = new Set<string>();
    const instruments = new Set<string>();
    (exportRows as TradeRow[]).forEach((r: TradeRow) => {
      const botLabel = r.botSlot === 0 ? "Bot 1" : r.botSlot === 1 ? "Bot 2" : "Bot 3";
      bots.add(botLabel);
      if (r.symbol) instruments.add(r.symbol);
    });
    return {
      botOptions: Array.from(bots).sort(),
      instrumentOptions: Array.from(instruments).sort(),
    };
  }, [exportRows]);

  // ── filtered trades ─────────────────────────────────────────────────────
  const filteredTrades = useMemo(() => {
    return (exportRows as TradeRow[]).filter((r: TradeRow) => {
      if (botFilter !== "all") {
        const botLabel = r.botSlot === 0 ? "Bot 1" : r.botSlot === 1 ? "Bot 2" : "Bot 3";
        if (botLabel !== botFilter) return false;
      }
      if (instrumentFilter !== "all" && r.symbol !== instrumentFilter) return false;
      return true;
    });
  }, [exportRows, botFilter, instrumentFilter]);

  // ── summary stats (from filtered trades) ────────────────────────────────
  const summary = useMemo(() => {
    const closed = filteredTrades.filter((t: TradeRow) => t.status === "closed");
    if (!closed.length) return null;
    const pnls = closed.map((t: TradeRow) => t.pnl);
    const totalPnl = pnls.reduce((a: number, b: number) => a + b, 0);
    const wins = closed.filter((t: TradeRow) => t.pnl > 0).length;
    const losses = closed.filter((t: TradeRow) => t.pnl <= 0).length;
    const winRate = Math.round((wins / closed.length) * 100);
    const bestTrade = Math.max(...pnls);
    const worstTrade = Math.min(...pnls);
    const avgPnl = totalPnl / closed.length;
    // Unique trading days
    const tradingDays = new Set(closed.map((t: TradeRow) => t.date)).size;
    const avgDailyPnl = tradingDays > 0 ? totalPnl / tradingDays : 0;
    return { totalPnl, totalTrades: closed.length, wins, losses, winRate, bestTrade, worstTrade, avgPnl, avgDailyPnl, tradingDays };
  }, [filteredTrades]);

  // ── per-trade chart data (last 50 closed trades, oldest first) ──────────
  const perTradeChartData = useMemo(() => {
    const closed = filteredTrades.filter((t: TradeRow) => t.status === "closed");
    return closed.slice(0, 50).reverse().map((t: TradeRow, i: number) => ({
      idx: i + 1,
      label: `#${closed.length - 49 + i > 0 ? closed.length - 49 + i : i + 1}`,
      pnl: t.pnl,
      symbol: t.symbol,
      time: t.time,
    }));
  }, [filteredTrades]);

  // ── cumulative P&L chart data ───────────────────────────────────────────
  const cumulativeChartData = useMemo(() => {
    const closed = filteredTrades.filter((t: TradeRow) => t.status === "closed");
    let cumulative = 0;
    return [...closed].reverse().map((t, i) => {
      cumulative += t.pnl;
      return {
        idx: i + 1,
        cumPnl: cumulative,
        date: t.date,
      };
    });
  }, [filteredTrades]);

  // ── Excel export (2 sheets only) ───────────────────────────────────────
  const exportExcel = () => {
    if (!exportRows.length) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: All Trades — Full trade journal
    const allHeaders = [
      "Date", "Entry Time", "Exit Time", "Bot", "Symbol", "Direction",
      "Entry Price (₹)", "Exit Price (₹)", "Quantity", "Stop-Loss", "Target",
      "P&L (₹)", "Partial Profit (₹)", "Exit Reason", "Strategy Layer",
      "Confidence %", "Duration", "Mode",
    ];
    const allRows = (exportRows as TradeRow[]).map((r: TradeRow) => {
      const botLabel = r.botSlot === 0 ? "Bot 1" : r.botSlot === 1 ? "Bot 2" : "Bot 3";
      return [
        r.date, r.time, r.exitTime || "—", botLabel, r.symbol, r.direction,
        r.entryPrice, r.exitPrice || "—", r.quantity, r.stopLoss || "—", r.target || "—",
        r.pnl, r.partialProfit || "—", r.exitReason || "—", r.strategy || "—",
        r.confidence ? `${Math.round(r.confidence * 100)}%` : "—", r.duration || "—", r.mode,
      ];
    });
    const ws1 = XLSX.utils.aoa_to_sheet([allHeaders, ...allRows]);
    ws1["!cols"] = allHeaders.map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, ws1, "All Trades");

    // Sheet 2: Daily Summary
    const dayHeaders = ["Date", "Trades", "Wins", "Losses", "Win Rate", "Total P&L (₹)", "Best Trade (₹)", "Worst Trade (₹)", "Avg P&L (₹)", "Instruments"];
    const dayRows = dayData.map(d => [d.date, d.trades, d.wins, d.losses, `${d.winRate}%`, d.totalPnl, d.bestTrade, d.worstTrade, d.avgPnl, d.instruments]);
    const ws2 = XLSX.utils.aoa_to_sheet([dayHeaders, ...dayRows]);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Daily Summary");

    XLSX.writeFile(wb, `ScalpBot_Trade_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── CSV export (flat all-trades) ────────────────────────────────────────
  const exportCSV = () => {
    if (!exportRows.length) return;
    const headers = [
      "Date", "Entry Time", "Exit Time", "Bot", "Symbol", "Direction",
      "Entry Price", "Exit Price", "Quantity", "Stop-Loss", "Target",
      "P&L", "Partial Profit", "Exit Reason", "Strategy Layer",
      "Confidence %", "Duration", "Mode",
    ];
    const rows = (exportRows as TradeRow[]).map((r: TradeRow) => {
      const botLabel = r.botSlot === 0 ? "Bot 1" : r.botSlot === 1 ? "Bot 2" : "Bot 3";
      return [
        r.date, r.time, r.exitTime || "", botLabel, r.symbol, r.direction,
        r.entryPrice, r.exitPrice || "", r.quantity, r.stopLoss || "", r.target || "",
        r.pnl, r.partialProfit || "", r.exitReason || "", r.strategy || "",
        r.confidence ? `${Math.round(r.confidence * 100)}%` : "", r.duration || "", r.mode,
      ];
    });
    const csv = [headers, ...rows].map((row: (string | number | null | undefined)[]) => row.map((v: string | number | null | undefined) => `"${v ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ScalpBot_Trade_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = dayLoading || weekLoading || monthLoading || exportLoading;

  return (
    <PullToRefresh
      onRefresh={async () => {
        const utils = trpc.useUtils();
        await Promise.all([
          utils.trades.pnlByDay.invalidate(),
          utils.trades.pnlByWeek.invalidate(),
          utils.trades.pnlByMonth.invalidate(),
          utils.trades.exportData.invalidate(),
        ]);
      }}
      className="min-h-screen bg-zinc-950 text-white"
    >
      {/* Header with Back Button */}
      <div className="border-b border-zinc-800 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors w-fit"
          >
            <span>←</span> Back to Dashboard
          </button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">📊</span> P&amp;L Analytics
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Complete trade journal with per-trade breakdown</p>
          </div>
        </div>
        <div className={`flex gap-2 ${!exportRows.length ? 'hidden' : ''}`}>
          <button
            onClick={exportCSV}
            disabled={!exportRows.length}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg disabled:opacity-40 transition-colors"
          >
            <span>📄</span> CSV
          </button>
          <button
            onClick={exportExcel}
            disabled={!exportRows.length}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 rounded-lg disabled:opacity-40 transition-colors font-medium"
          >
            <span>📊</span> Excel (2 sheets)
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-24 md:pb-6">
        {/* Summary Cards */}
        {summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
            <StatCard label="Total P&L" value={fmt(summary.totalPnl)} positive={summary.totalPnl >= 0} />
            <StatCard label="Total Trades" value={String(summary.totalTrades)} sub={`${summary.wins}W / ${summary.losses}L`} />
            <StatCard label="Win Rate" value={pct(summary.winRate)} positive={summary.winRate >= 50} />
            <StatCard label="Avg Trade P&L" value={fmt(summary.avgPnl)} positive={summary.avgPnl >= 0} />
            <StatCard label="Best Trade" value={fmt(summary.bestTrade)} positive />
            <StatCard label="Worst Trade" value={fmt(summary.worstTrade)} positive={false} />
            <StatCard label="Trading Days" value={String(summary.tradingDays)} sub={`Avg ${fmt(summary.avgDailyPnl)}/day`} />
          </div>
        ) : !isLoading && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium">No closed trades yet</p>
            <p className="text-sm mt-1">Start the bot and complete some trades to see analytics here.</p>
          </div>
        )}

        {/* Filters + Chart Toggle */}
        {exportRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Bot filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Bot:</span>
              <select
                value={botFilter}
                onChange={(e) => setBotFilter(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="all">All Bots</option>
                {botOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            {/* Instrument filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Instrument:</span>
              <select
                value={instrumentFilter}
                onChange={(e) => setInstrumentFilter(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="all">All Instruments</option>
                {instrumentOptions.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            {/* Chart view toggle */}
            <div className="ml-auto flex bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setChartView("per-trade")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${chartView === "per-trade" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Per-Trade P&amp;L
              </button>
              <button
                onClick={() => setChartView("cumulative")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${chartView === "cumulative" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Cumulative P&amp;L
              </button>
            </div>
          </div>
        )}

        {/* Chart */}
        {chartView === "per-trade" && perTradeChartData.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-zinc-400 mb-3">Per-Trade P&amp;L — Last {perTradeChartData.length} Trades</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perTradeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={v => `₹${v}`} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [fmt(value), "P&L"]}
                  labelFormatter={(label: string, payload: Array<{ payload?: { symbol?: string; time?: string } }>) => {
                    const item = payload?.[0]?.payload;
                    return item ? `${item.symbol} @ ${item.time}` : label;
                  }}
                />
                <ReferenceLine y={0} stroke="#3f3f46" />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {perTradeChartData.map((entry, i) => (
                    <Cell key={i} fill={bgClr(entry.pnl)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {chartView === "cumulative" && cumulativeChartData.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-zinc-400 mb-3">Cumulative P&amp;L Over Time — {cumulativeChartData.length} Trades</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cumulativeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="idx" tick={{ fontSize: 9, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={v => `₹${v}`} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [fmt(value), "Cumulative P&L"]}
                  labelFormatter={(_: string, payload: Array<{ payload?: { date?: string } }>) => {
                    const item = payload?.[0]?.payload;
                    return item?.date ?? "";
                  }}
                />
                <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="cumPnl"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#10b981" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Day / Week / Month Breakdown with Tabs */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800">
            {(["daily", "weekly", "monthly"] as TimeTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTimeTab(t)}
                className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${
                  timeTab === t
                    ? "text-white border-b-2 border-emerald-500 bg-zinc-800"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "daily" ? "📅 Daily" : t === "weekly" ? "📆 Weekly" : "🗓️ Monthly"}
              </button>
            ))}
          </div>

          {/* Daily Table */}
          {timeTab === "daily" && (
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
          {timeTab === "weekly" && (
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
          {timeTab === "monthly" && (
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

        {/* Full Trade Journal Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">📋 Trade Journal — All Trades</h2>
            <span className="text-xs text-zinc-500">{filteredTrades.length} trades</span>
          </div>
          <div className="overflow-x-auto">
            {exportLoading ? (
              <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
            ) : filteredTrades.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-sm">No trades found</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-zinc-500 uppercase border-b border-zinc-800">
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Entry</th>
                    <th className="px-3 py-2 text-left">Exit</th>
                    <th className="px-3 py-2 text-left">Bot</th>
                    <th className="px-3 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Dir</th>
                    <th className="px-3 py-2 text-right">Entry ₹</th>
                    <th className="px-3 py-2 text-right">Exit ₹</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">SL</th>
                    <th className="px-3 py-2 text-right">Target</th>
                    <th className="px-3 py-2 text-right font-bold">P&amp;L</th>
                    <th className="px-3 py-2 text-left">Exit Reason</th>
                    <th className="px-3 py-2 text-left">Strategy</th>
                    <th className="px-3 py-2 text-right">Conf</th>
                    <th className="px-3 py-2 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map((t, i) => {
                    const botLabel = t.botSlot === 0 ? "B1" : t.botSlot === 1 ? "B2" : "B3";
                    return (
                      <tr key={t.id} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-zinc-900/50"}`}>
                        <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{t.date}</td>
                        <td className="px-3 py-2 text-zinc-300 font-mono whitespace-nowrap">{t.time}</td>
                        <td className="px-3 py-2 text-zinc-400 font-mono whitespace-nowrap">{t.exitTime || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.botSlot === 0 ? "bg-blue-900/50 text-blue-300" : t.botSlot === 1 ? "bg-purple-900/50 text-purple-300" : "bg-amber-900/50 text-amber-300"}`}>
                            {botLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-200 font-medium whitespace-nowrap max-w-[120px] truncate">{t.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.direction === "BUY" ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-300 font-mono">₹{t.entryPrice}</td>
                        <td className="px-3 py-2 text-right text-zinc-400 font-mono">{t.exitPrice ? `₹${t.exitPrice}` : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-400">{t.quantity}</td>
                        <td className="px-3 py-2 text-right text-zinc-500 font-mono">{t.stopLoss ? `₹${t.stopLoss}` : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-500 font-mono">{t.target ? `₹${t.target}` : "—"}</td>
                        <td className={`px-3 py-2 text-right font-bold ${clr(t.pnl)}`}>{fmt(t.pnl)}</td>
                        <td className="px-3 py-2 text-zinc-400 whitespace-nowrap max-w-[100px] truncate">{t.exitReason || "—"}</td>
                        <td className="px-3 py-2 text-zinc-500 whitespace-nowrap max-w-[100px] truncate" title={t.strategy}>{t.strategy ? t.strategy.slice(0, 20) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-400">{t.confidence ? `${Math.round(t.confidence * 100)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">{t.duration || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-zinc-600 text-center pb-4">
          All times in IST (UTC+5:30). Only closed trades are included. Open trades are excluded from P&amp;L calculations.
        </p>
      </div>
    </PullToRefresh>
  );
}
