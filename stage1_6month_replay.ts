/**
 * Stage 1: 6-Month Historical Replay — V1 vs V2 Engine
 * Uses REAL 1-min Nifty 50 data from Upstox (120 trading days, Jan 19 - Jul 16, 2026)
 * 
 * Runs both generateSignal (V1) and generateSignalV2 (V2) on each day's candles,
 * simulates trades with realistic SL/TP, and computes comprehensive metrics.
 */

import { generateSignal, generateSignalV2 } from "./server/botEngine";
import * as fs from "fs";

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  day: string;
  entryTime: string;
  exitTime: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp: number;
  pnl: number;
  exitReason: string;
  strategy: string;
  confidence: number;
}

// Load 6 months of 1-min data
const rawData = JSON.parse(fs.readFileSync("/tmp/nifty50_1min_6months.json", "utf-8"));
console.log(`Loaded ${rawData.length} candles`);

// Convert to our Candle format and group by day
const dayCandles: Map<string, Candle[]> = new Map();

for (const c of rawData) {
  const ts = new Date(c.timestamp).getTime();
  const dt = new Date(c.timestamp);
  const day = c.timestamp.substring(0, 10); // YYYY-MM-DD from ISO string
  
  if (!dayCandles.has(day)) dayCandles.set(day, []);
  dayCandles.get(day)!.push({
    timestamp: ts,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0
  });
}

console.log(`Grouped into ${dayCandles.size} trading days`);

// Bot state template
const LOT_SIZE = 75; // Nifty lot
const CAPITAL = 500000;

interface DayResult {
  day: string;
  v1Trades: Trade[];
  v2Trades: Trade[];
  v1Pnl: number;
  v2Pnl: number;
}

function simulateDay(day: string, candles: Candle[], engine: "V1" | "V2"): Trade[] {
  const trades: Trade[] = [];
  let activeTrade: {
    direction: "BUY" | "SELL";
    entryPrice: number;
    entryTime: string;
    sl: number;
    tp: number;
    strategy: string;
    confidence: number;
  } | null = null;
  
  const MAX_TRADES_PER_DAY = 5;
  
  // Build candle buffer progressively (simulating real-time)
  for (let i = 20; i < candles.length; i++) { // Start after 20 candles warmup
    const currentCandles = candles.slice(0, i + 1);
    const c = candles[i];
    const dt = new Date(c.timestamp);
    const timeStr = dt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
    const istHour = parseInt(dt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
    const istMin = parseInt(dt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", minute: "2-digit" }));
    const istMinutes = istHour * 60 + istMin;
    
    // Check exit for active trade
    if (activeTrade) {
      let exited = false;
      if (activeTrade.direction === "BUY") {
        if (c.low <= activeTrade.sl) {
          trades.push({
            day, entryTime: activeTrade.entryTime, exitTime: timeStr,
            direction: "BUY", entryPrice: activeTrade.entryPrice,
            exitPrice: activeTrade.sl, sl: activeTrade.sl, tp: activeTrade.tp,
            pnl: (activeTrade.sl - activeTrade.entryPrice) * LOT_SIZE,
            exitReason: "SL", strategy: activeTrade.strategy, confidence: activeTrade.confidence
          });
          exited = true;
        } else if (c.high >= activeTrade.tp) {
          trades.push({
            day, entryTime: activeTrade.entryTime, exitTime: timeStr,
            direction: "BUY", entryPrice: activeTrade.entryPrice,
            exitPrice: activeTrade.tp, sl: activeTrade.sl, tp: activeTrade.tp,
            pnl: (activeTrade.tp - activeTrade.entryPrice) * LOT_SIZE,
            exitReason: "TP", strategy: activeTrade.strategy, confidence: activeTrade.confidence
          });
          exited = true;
        }
      } else { // SELL
        if (c.high >= activeTrade.sl) {
          trades.push({
            day, entryTime: activeTrade.entryTime, exitTime: timeStr,
            direction: "SELL", entryPrice: activeTrade.entryPrice,
            exitPrice: activeTrade.sl, sl: activeTrade.sl, tp: activeTrade.tp,
            pnl: (activeTrade.entryPrice - activeTrade.sl) * LOT_SIZE,
            exitReason: "SL", strategy: activeTrade.strategy, confidence: activeTrade.confidence
          });
          exited = true;
        } else if (c.low <= activeTrade.tp) {
          trades.push({
            day, entryTime: activeTrade.entryTime, exitTime: timeStr,
            direction: "SELL", entryPrice: activeTrade.entryPrice,
            exitPrice: activeTrade.tp, sl: activeTrade.sl, tp: activeTrade.tp,
            pnl: (activeTrade.entryPrice - activeTrade.tp) * LOT_SIZE,
            exitReason: "TP", strategy: activeTrade.strategy, confidence: activeTrade.confidence
          });
          exited = true;
        }
      }
      
      // Force exit at 15:15 (square off)
      if (!exited && istMinutes >= 915) {
        const exitPx = c.close;
        const pnl = activeTrade.direction === "BUY" 
          ? (exitPx - activeTrade.entryPrice) * LOT_SIZE
          : (activeTrade.entryPrice - exitPx) * LOT_SIZE;
        trades.push({
          day, entryTime: activeTrade.entryTime, exitTime: timeStr,
          direction: activeTrade.direction, entryPrice: activeTrade.entryPrice,
          exitPrice: exitPx, sl: activeTrade.sl, tp: activeTrade.tp,
          pnl, exitReason: "EOD", strategy: activeTrade.strategy, confidence: activeTrade.confidence
        });
        exited = true;
      }
      
      if (exited) activeTrade = null;
      if (activeTrade) continue; // Still in trade, skip signal generation
    }
    
    // Max trades per day
    if (trades.length >= MAX_TRADES_PER_DAY) continue;
    
    // No new entries after 14:30 (except existing trade management)
    if (istMinutes >= 870) continue;
    
    // Generate signal (every 5 candles to simulate 5-min signal check on 1-min data)
    if (i % 5 !== 0) continue;
    
    // Use 5-min equivalent candles for signal generation (aggregate 1-min to 5-min)
    const candles5m: Candle[] = [];
    for (let j = 0; j <= i - 4; j += 5) {
      const chunk = candles.slice(j, j + 5);
      if (chunk.length === 5) {
        candles5m.push({
          timestamp: chunk[0].timestamp,
          open: chunk[0].open,
          high: Math.max(...chunk.map(x => x.high)),
          low: Math.min(...chunk.map(x => x.low)),
          close: chunk[chunk.length - 1].close,
          volume: chunk.reduce((s, x) => s + x.volume, 0)
        });
      }
    }
    
    if (candles5m.length < 15) continue; // Need enough history
    
    try {
      const signal = engine === "V1" 
        ? generateSignal(candles5m, 1.5, 3.0, 0.65)
        : generateSignalV2(candles5m, 1.5, 3.0, 0.65);
      
      if (signal.direction !== "HOLD" && signal.confidence >= 0.65) {
        activeTrade = {
          direction: signal.direction as "BUY" | "SELL",
          entryPrice: signal.entryPrice,
          entryTime: timeStr,
          sl: signal.slPrice,
          tp: signal.targetPrice,
          strategy: signal.layer || "Unknown",
          confidence: signal.confidence
        };
      }
    } catch (e) {
      // Skip errors
    }
  }
  
  // Force exit any remaining trade
  if (activeTrade && candles.length > 0) {
    const last = candles[candles.length - 1];
    const pnl = activeTrade.direction === "BUY"
      ? (last.close - activeTrade.entryPrice) * LOT_SIZE
      : (activeTrade.entryPrice - last.close) * LOT_SIZE;
    trades.push({
      day, entryTime: activeTrade.entryTime, exitTime: "15:30",
      direction: activeTrade.direction, entryPrice: activeTrade.entryPrice,
      exitPrice: last.close, sl: activeTrade.sl, tp: activeTrade.tp,
      pnl, exitReason: "EOD", strategy: activeTrade.strategy, confidence: activeTrade.confidence
    });
  }
  
  return trades;
}

// Run simulation
const results: DayResult[] = [];
const sortedDays = Array.from(dayCandles.keys()).sort();

console.log(`\nRunning V1 vs V2 replay on ${sortedDays.length} days...\n`);

for (const day of sortedDays) {
  const candles = dayCandles.get(day)!;
  const v1Trades = simulateDay(day, candles, "V1");
  const v2Trades = simulateDay(day, candles, "V2");
  
  results.push({
    day,
    v1Trades,
    v2Trades,
    v1Pnl: v1Trades.reduce((s, t) => s + t.pnl, 0),
    v2Pnl: v2Trades.reduce((s, t) => s + t.pnl, 0)
  });
}

// Compute metrics
function computeMetrics(allTrades: Trade[]) {
  const wins = allTrades.filter(t => t.pnl > 0);
  const losses = allTrades.filter(t => t.pnl <= 0);
  const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  
  // Max drawdown
  let peak = 0, maxDD = 0, running = 0;
  for (const t of allTrades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Sharpe (daily)
  const dailyPnls = new Map<string, number>();
  for (const t of allTrades) {
    dailyPnls.set(t.day, (dailyPnls.get(t.day) || 0) + t.pnl);
  }
  const dailyReturns = Array.from(dailyPnls.values());
  const avgReturn = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1);
  const stdReturn = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1 || 1));
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  
  // Strategy breakdown
  const strategyStats = new Map<string, { count: number; wins: number; pnl: number }>();
  for (const t of allTrades) {
    const s = strategyStats.get(t.strategy) || { count: 0, wins: 0, pnl: 0 };
    s.count++;
    if (t.pnl > 0) s.wins++;
    s.pnl += t.pnl;
    strategyStats.set(t.strategy, s);
  }
  
  return {
    totalTrades: allTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: allTrades.length > 0 ? (wins.length / allTrades.length * 100) : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    totalPnl,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : 0,
    maxDD,
    maxDDPct: (maxDD / CAPITAL) * 100,
    sharpe,
    expectancy: allTrades.length > 0 ? totalPnl / allTrades.length : 0,
    strategyStats
  };
}

const allV1Trades = results.flatMap(r => r.v1Trades);
const allV2Trades = results.flatMap(r => r.v2Trades);

const v1Metrics = computeMetrics(allV1Trades);
const v2Metrics = computeMetrics(allV2Trades);

// Count days where V2 beats V1
let v2WinDays = 0, v1WinDays = 0, tieDays = 0;
for (const r of results) {
  if (r.v2Pnl > r.v1Pnl) v2WinDays++;
  else if (r.v1Pnl > r.v2Pnl) v1WinDays++;
  else tieDays++;
}

// Print results
console.log("═".repeat(70));
console.log("6-MONTH BACKTEST: V1 vs V2 ENGINE — NIFTY 50 (1-min, Upstox data)");
console.log("═".repeat(70));
console.log(`Period: Jan 19 – Jul 16, 2026 | Trading Days: ${sortedDays.length}`);
console.log(`Lot Size: 75 | Capital: ₹5,00,000`);
console.log();

console.log("─".repeat(70));
console.log("METRIC                    V1 ENGINE          V2 ENGINE");
console.log("─".repeat(70));
console.log(`Total Trades:             ${v1Metrics.totalTrades.toString().padEnd(20)}${v2Metrics.totalTrades}`);
console.log(`Wins/Losses:              ${v1Metrics.wins}/${v1Metrics.losses}`.padEnd(46) + `${v2Metrics.wins}/${v2Metrics.losses}`);
console.log(`Win Rate:                 ${v1Metrics.winRate.toFixed(1)}%`.padEnd(46) + `${v2Metrics.winRate.toFixed(1)}%`);
console.log(`Profit Factor:            ${v1Metrics.profitFactor.toFixed(2)}`.padEnd(46) + `${v2Metrics.profitFactor.toFixed(2)}`);
console.log(`Total P&L:                ₹${v1Metrics.totalPnl.toFixed(0)}`.padEnd(46) + `₹${v2Metrics.totalPnl.toFixed(0)}`);
console.log(`Avg Win:                  ₹${v1Metrics.avgWin.toFixed(0)}`.padEnd(46) + `₹${v2Metrics.avgWin.toFixed(0)}`);
console.log(`Avg Loss:                 ₹${v1Metrics.avgLoss.toFixed(0)}`.padEnd(46) + `₹${v2Metrics.avgLoss.toFixed(0)}`);
console.log(`Expectancy/Trade:         ₹${v1Metrics.expectancy.toFixed(0)}`.padEnd(46) + `₹${v2Metrics.expectancy.toFixed(0)}`);
console.log(`Max Drawdown:             ₹${v1Metrics.maxDD.toFixed(0)} (${v1Metrics.maxDDPct.toFixed(1)}%)`.padEnd(46) + `₹${v2Metrics.maxDD.toFixed(0)} (${v2Metrics.maxDDPct.toFixed(1)}%)`);
console.log(`Sharpe Ratio:             ${v1Metrics.sharpe.toFixed(2)}`.padEnd(46) + `${v2Metrics.sharpe.toFixed(2)}`);
console.log("─".repeat(70));
console.log(`Days V2 > V1:             ${v2WinDays}/${sortedDays.length} (${(v2WinDays/sortedDays.length*100).toFixed(0)}%)`);
console.log(`Days V1 > V2:             ${v1WinDays}/${sortedDays.length}`);
console.log(`Tie Days:                 ${tieDays}/${sortedDays.length}`);

// Strategy breakdown
console.log("\n" + "═".repeat(70));
console.log("V2 STRATEGY BREAKDOWN");
console.log("═".repeat(70));
console.log("Strategy".padEnd(20) + "Trades".padEnd(10) + "Win%".padEnd(10) + "P&L");
console.log("─".repeat(50));
for (const [name, stats] of v2Metrics.strategyStats) {
  const wr = stats.count > 0 ? (stats.wins / stats.count * 100).toFixed(1) : "0.0";
  console.log(`${name.padEnd(20)}${stats.count.toString().padEnd(10)}${wr}%`.padEnd(40) + `₹${stats.pnl.toFixed(0)}`);
}

// Deployment criteria
console.log("\n" + "═".repeat(70));
console.log("DEPLOYMENT CRITERIA (V2)");
console.log("═".repeat(70));
const wrPass = v2Metrics.winRate > 55;
const pfPass = v2Metrics.profitFactor > 1.3;
const ddPass = v2Metrics.maxDDPct < 15;
console.log(`Win Rate > 55%:           ${v2Metrics.winRate.toFixed(1)}% → ${wrPass ? "✅ PASS" : "❌ FAIL"}`);
console.log(`Profit Factor > 1.3:      ${v2Metrics.profitFactor.toFixed(2)} → ${pfPass ? "✅ PASS" : "❌ FAIL"}`);
console.log(`Max Drawdown < 15%:       ${v2Metrics.maxDDPct.toFixed(1)}% → ${ddPass ? "✅ PASS" : "❌ FAIL"}`);
console.log(`\nOVERALL: ${wrPass && pfPass && ddPass ? "✅ DEPLOY" : "❌ NEEDS WORK"}`);

// Monthly breakdown
console.log("\n" + "═".repeat(70));
console.log("MONTHLY P&L BREAKDOWN");
console.log("═".repeat(70));
console.log("Month".padEnd(12) + "V1 P&L".padEnd(15) + "V2 P&L".padEnd(15) + "V2 Trades".padEnd(12) + "V2 Win%");
console.log("─".repeat(60));
const monthlyData = new Map<string, { v1: number; v2: number; v2Trades: number; v2Wins: number }>();
for (const r of results) {
  const month = r.day.substring(0, 7);
  const m = monthlyData.get(month) || { v1: 0, v2: 0, v2Trades: 0, v2Wins: 0 };
  m.v1 += r.v1Pnl;
  m.v2 += r.v2Pnl;
  m.v2Trades += r.v2Trades.length;
  m.v2Wins += r.v2Trades.filter(t => t.pnl > 0).length;
  monthlyData.set(month, m);
}
for (const [month, data] of Array.from(monthlyData.entries()).sort()) {
  const wr = data.v2Trades > 0 ? (data.v2Wins / data.v2Trades * 100).toFixed(0) : "N/A";
  console.log(`${month.padEnd(12)}₹${data.v1.toFixed(0).padEnd(14)}₹${data.v2.toFixed(0).padEnd(14)}${data.v2Trades.toString().padEnd(12)}${wr}%`);
}

// Save detailed results to file
const output = {
  summary: {
    period: "2026-01-19 to 2026-07-16",
    tradingDays: sortedDays.length,
    v1: v1Metrics,
    v2: v2Metrics,
    v2WinDays,
    v1WinDays,
    tieDays
  },
  dailyResults: results.map(r => ({
    day: r.day,
    v1Pnl: Math.round(r.v1Pnl),
    v2Pnl: Math.round(r.v2Pnl),
    v1Trades: r.v1Trades.length,
    v2Trades: r.v2Trades.length,
    winner: r.v2Pnl > r.v1Pnl ? "V2" : r.v1Pnl > r.v2Pnl ? "V1" : "TIE"
  }))
};

fs.writeFileSync("/tmp/stage1_6month_results.json", JSON.stringify(output, null, 2));
console.log("\n\nDetailed results saved to /tmp/stage1_6month_results.json");
