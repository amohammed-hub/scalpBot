import { readFileSync, writeFileSync } from "fs";
import { generateSignal, generateSignalV2, type Candle } from "./server/botEngine";

const DAYS = [
  { file: "/tmp/nifty_candles_2026-07-14.json", label: "Monday July 14" },
  { file: "/tmp/nifty_candles_2026-07-15.json", label: "Tuesday July 15" },
  { file: "/tmp/nifty_candles_2026-07-16.json", label: "Wednesday July 16" },
  { file: "/tmp/nifty_candles_2026-07-17.json", label: "Thursday July 17" },
];

const CAPITAL = 100000;
const RISK_PCT = 1.0;
const SL_MULT = 1.5;
const TP_MULT = 3.0;
const MIN_CONF = 0.6;
const WINDOW_SIZE = 60;

interface Trade {
  entryTime: number; exitTime: number; direction: string;
  entryPrice: number; slPrice: number; targetPrice: number;
  exitPrice: number; pnl: number; result: "WIN"|"LOSS"|"BE";
  confidence: number; layer: string; regime?: string;
}

function simulateTrades(candles: Candle[], signalFn: (w: Candle[]) => any) {
  const trades: Trade[] = [];
  let i = WINDOW_SIZE;
  while (i < candles.length) {
    const window = candles.slice(Math.max(0, i - WINDOW_SIZE), i + 1);
    const sig = signalFn(window);
    if (sig && sig.direction !== "HOLD" && sig.confidence >= MIN_CONF) {
      const entryCandle = candles[i];
      const entryPrice = entryCandle.close;
      const qty = Math.max(1, Math.floor((CAPITAL * RISK_PCT / 100) / Math.abs(entryPrice - sig.slPrice)));
      let exitPrice = entryPrice, exitTime = entryCandle.timestamp;
      let result: "WIN"|"LOSS"|"BE" = "BE";
      for (let j = i + 1; j < Math.min(i + 120, candles.length); j++) {
        const c = candles[j];
        if (sig.direction === "BUY") {
          if (c.low <= sig.slPrice) { exitPrice = sig.slPrice; exitTime = c.timestamp; result = "LOSS"; break; }
          if (c.high >= sig.targetPrice) { exitPrice = sig.targetPrice; exitTime = c.timestamp; result = "WIN"; break; }
        } else {
          if (c.high >= sig.slPrice) { exitPrice = sig.slPrice; exitTime = c.timestamp; result = "LOSS"; break; }
          if (c.low <= sig.targetPrice) { exitPrice = sig.targetPrice; exitTime = c.timestamp; result = "WIN"; break; }
        }
        exitPrice = c.close; exitTime = c.timestamp;
      }
      const pnl = sig.direction === "BUY" ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;
      trades.push({ entryTime: entryCandle.timestamp, exitTime, direction: sig.direction, entryPrice, slPrice: sig.slPrice, targetPrice: sig.targetPrice, exitPrice, pnl: Math.round(pnl * 100) / 100, result, confidence: Math.round(sig.confidence * 100), layer: sig.layer ?? "Signal", regime: sig.regimeV2 });
      const exitIdx = candles.findIndex(c => c.timestamp >= exitTime);
      i = exitIdx > i ? exitIdx + 1 : i + 1;
    } else { i++; }
  }
  const wins = trades.filter(t => t.result === "WIN").length;
  const losses = trades.filter(t => t.result === "LOSS").length;
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
  const avgWin = wins > 0 ? Math.round(trades.filter(t => t.result === "WIN").reduce((a, t) => a + t.pnl, 0) / wins) : 0;
  const avgLoss = losses > 0 ? Math.round(trades.filter(t => t.result === "LOSS").reduce((a, t) => a + t.pnl, 0) / losses) : 0;
  const profitFactor = avgLoss !== 0 ? Math.round(Math.abs(avgWin * wins / (avgLoss * losses)) * 100) / 100 : (wins > 0 ? 999 : 0);
  let maxDrawdown = 0, peak = CAPITAL, equity = CAPITAL;
  for (const t of trades) { equity += t.pnl; if (equity > peak) peak = equity; const dd = peak - equity; if (dd > maxDrawdown) maxDrawdown = dd; }
  return { trades, totalPnl: Math.round(totalPnl), winRate, totalTrades: trades.length, wins, losses, avgWin, avgLoss, profitFactor, maxDrawdown: Math.round(maxDrawdown) };
}

function fmt(ts: number) { return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }); }

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("  STAGE 1: HISTORICAL REPLAY — V1 vs V2 Engine Comparison");
console.log("  Instrument: Nifty 50 (Spot) | Capital: ₹1,00,000 | Risk: 1%/trade");
console.log("  SL: 1.5x ATR | TP: 3x ATR | Min Confidence: 60%");
console.log("  Data Source: Yahoo Finance (REAL 1-min candles, July 14-17, 2026)");
console.log("═══════════════════════════════════════════════════════════════════════════\n");

const allResults: any[] = [];
for (const day of DAYS) {
  const raw = JSON.parse(readFileSync(day.file, "utf-8")) as Candle[];
  console.log(`\n${"─".repeat(70)}`);
  console.log(`▶ ${day.label} — ${raw.length} candles`);
  console.log(`${"─".repeat(70)}`);
  const v1 = simulateTrades(raw, (w) => generateSignal(w, SL_MULT, TP_MULT, MIN_CONF));
  const v2 = simulateTrades(raw, (w) => generateSignalV2(w, SL_MULT, TP_MULT, MIN_CONF));
  
  console.log(`\n  V1 (Current): ${v1.totalTrades} trades | Win: ${v1.winRate}% | P&L: ₹${v1.totalPnl} | PF: ${v1.profitFactor} | MaxDD: ₹${v1.maxDrawdown}`);
  for (const t of v1.trades) {
    const icon = t.result === "WIN" ? "✅" : t.result === "LOSS" ? "❌" : "⬜";
    console.log(`    ${icon} ${fmt(t.entryTime)}→${fmt(t.exitTime)} ${t.direction} @₹${t.entryPrice.toFixed(1)}→₹${t.exitPrice.toFixed(1)} P&L:₹${t.pnl} ${t.layer}(${t.confidence}%)`);
  }
  
  console.log(`\n  V2 (Regime): ${v2.totalTrades} trades | Win: ${v2.winRate}% | P&L: ₹${v2.totalPnl} | PF: ${v2.profitFactor} | MaxDD: ₹${v2.maxDrawdown}`);
  for (const t of v2.trades) {
    const icon = t.result === "WIN" ? "✅" : t.result === "LOSS" ? "❌" : "⬜";
    console.log(`    ${icon} ${fmt(t.entryTime)}→${fmt(t.exitTime)} ${t.direction} @₹${t.entryPrice.toFixed(1)}→₹${t.exitPrice.toFixed(1)} P&L:₹${t.pnl} ${t.layer}(${t.confidence}%) [${t.regime ?? "?"}]`);
  }
  
  const winner = v2.totalPnl > v1.totalPnl ? "V2 ✓" : v1.totalPnl > v2.totalPnl ? "V1" : "TIE";
  console.log(`\n  ⚡ WINNER: ${winner} | Δ P&L: ${v2.totalPnl - v1.totalPnl >= 0 ? "+" : ""}₹${v2.totalPnl - v1.totalPnl}`);
  allResults.push({ day: day.label, v1, v2, winner });
}

console.log(`\n\n${"═".repeat(70)}`);
console.log(`  FINAL SUMMARY`);
console.log(`${"═".repeat(70)}`);
let v2Wins = 0, totalV1 = 0, totalV2 = 0;
for (const r of allResults) {
  if (r.winner === "V2 ✓") v2Wins++;
  totalV1 += r.v1.totalPnl; totalV2 += r.v2.totalPnl;
  console.log(`  ${r.day.padEnd(20)} V1: ₹${String(r.v1.totalPnl).padStart(7)} (${r.v1.totalTrades}t) | V2: ₹${String(r.v2.totalPnl).padStart(7)} (${r.v2.totalTrades}t) → ${r.winner}`);
}
console.log(`  ${"─".repeat(66)}`);
console.log(`  TOTAL              V1: ₹${String(totalV1).padStart(7)}      | V2: ₹${String(totalV2).padStart(7)}`);
console.log(`  V2 wins ${v2Wins}/4 days | Net improvement: ${totalV2 - totalV1 >= 0 ? "+" : ""}₹${totalV2 - totalV1}`);
const verdict = v2Wins >= 3 ? "✅ PASS" : v2Wins >= 2 ? "⚠️ MIXED" : "❌ FAIL";
console.log(`  VERDICT: ${verdict}`);
console.log(`${"═".repeat(70)}\n`);

writeFileSync("/tmp/stage1_report.json", JSON.stringify(allResults, null, 2));
process.exit(0);
