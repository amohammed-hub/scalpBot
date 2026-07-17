import { readFileSync } from "fs";
import { generateSignalV2, type Candle } from "./server/botEngine";

// The 8 losing V2 trades from Stage 1:
// Mon Jul 14: 3 trades (all SELL)
//   10:37 SELL @24083.5 [RANGING] FailedBreakout
//   11:42 SELL @24104.3 [TRENDING] Trend
//   13:00 SELL @24065.0 [RANGING] FailedBreakout
// Tue Jul 15: 0 trades
// Wed Jul 16: 3 trades (all SELL)
//   10:23 SELL @24126.8 [RANGING] VWAPPullback
//   14:21 SELL @24084.0 [RANGING] FailedBreakout
//   15:03 SELL @24072.5 [RANGING] FailedBreakout
// Thu Jul 17: 2 trades
//   12:53 SELL @24271.5 [RANGING] FailedBreakout
//   13:27 SELL @24261.4 [TRENDING] Trend

interface TradeEntry {
  day: string; file: string; approxTime: string; entryPrice: number;
  direction: string; layer: string; regime: string;
}

const LOSING_TRADES: TradeEntry[] = [
  { day: "Jul14", file: "/tmp/nifty_candles_2026-07-14.json", approxTime: "10:37", entryPrice: 24083.5, direction: "SELL", layer: "FailedBreakout", regime: "RANGING" },
  { day: "Jul14", file: "/tmp/nifty_candles_2026-07-14.json", approxTime: "11:42", entryPrice: 24104.3, direction: "SELL", layer: "Trend", regime: "TRENDING" },
  { day: "Jul14", file: "/tmp/nifty_candles_2026-07-14.json", approxTime: "13:00", entryPrice: 24065.0, direction: "SELL", layer: "FailedBreakout", regime: "RANGING" },
  { day: "Jul16", file: "/tmp/nifty_candles_2026-07-16.json", approxTime: "10:23", entryPrice: 24126.8, direction: "SELL", layer: "VWAPPullback", regime: "RANGING" },
  { day: "Jul16", file: "/tmp/nifty_candles_2026-07-16.json", approxTime: "14:21", entryPrice: 24084.0, direction: "SELL", layer: "FailedBreakout", regime: "RANGING" },
  { day: "Jul16", file: "/tmp/nifty_candles_2026-07-16.json", approxTime: "15:03", entryPrice: 24072.5, direction: "SELL", layer: "FailedBreakout", regime: "RANGING" },
  { day: "Jul17", file: "/tmp/nifty_candles_2026-07-17.json", approxTime: "12:53", entryPrice: 24271.5, direction: "SELL", layer: "FailedBreakout", regime: "RANGING" },
  { day: "Jul17", file: "/tmp/nifty_candles_2026-07-17.json", approxTime: "13:27", entryPrice: 24261.4, direction: "SELL", layer: "Trend", regime: "TRENDING" },
];

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i-1] * (1-k));
  return result;
}

function analyzeEntry(trade: TradeEntry) {
  const candles: Candle[] = JSON.parse(readFileSync(trade.file, "utf-8"));
  
  // Find the entry candle by approximate time
  const [h, m] = trade.approxTime.split(":").map(Number);
  const targetIST = h * 60 + m;
  
  let entryIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const dt = new Date(candles[i].timestamp);
    const candleIST = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
    if (Math.abs(candleIST - targetIST) <= 1) {
      entryIdx = i;
      break;
    }
  }
  
  if (entryIdx < 0) { console.log(`  ⚠️ Could not find candle for ${trade.approxTime}`); return; }
  
  // Get context: last 20 candles before entry
  const lookback = candles.slice(Math.max(0, entryIdx - 20), entryIdx + 1);
  const closes = lookback.map(c => c.close);
  const highs = lookback.map(c => c.high);
  const lows = lookback.map(c => c.low);
  
  // Key levels
  const recentHigh = Math.max(...highs);
  const recentLow = Math.min(...lows);
  const range = recentHigh - recentLow;
  const entryPrice = trade.entryPrice;
  
  // Where is entry relative to range?
  const posInRange = range > 0 ? ((entryPrice - recentLow) / range * 100).toFixed(0) : "N/A";
  
  // EMA9 at entry
  const allCloses = candles.slice(0, entryIdx + 1).map(c => c.close);
  const ema9 = calcEMA(allCloses, 9);
  const ema9AtEntry = ema9[ema9.length - 1];
  
  // Was price moving TOWARD or AWAY from entry direction before signal?
  // For SELL: was price falling (good - pullback to sell) or rising (bad - chasing)?
  // For BUY: was price rising (good - pullback to buy) or falling (bad - chasing)?
  const last5 = closes.slice(-5);
  const priceChange5 = last5[last5.length - 1] - last5[0];
  
  let isChasing = false;
  if (trade.direction === "SELL") {
    // Chasing a SELL = price was already falling before entry
    isChasing = priceChange5 < 0;
  } else {
    // Chasing a BUY = price was already rising before entry
    isChasing = priceChange5 > 0;
  }
  
  // Swing analysis: find last swing high/low
  let lastSwingHigh = recentHigh;
  let lastSwingLow = recentLow;
  const lastSwing = recentHigh - recentLow;
  const retracePct = trade.direction === "SELL" 
    ? ((recentHigh - entryPrice) / lastSwing * 100).toFixed(0)
    : ((entryPrice - recentLow) / lastSwing * 100).toFixed(0);
  
  // Distance from EMA9
  const distFromEma = ((entryPrice - ema9AtEntry) / ema9AtEntry * 100).toFixed(3);
  
  console.log(`\n  ${trade.day} ${trade.approxTime} | ${trade.direction} @₹${entryPrice} | ${trade.layer} [${trade.regime}]`);
  console.log(`    Range(20): ₹${recentLow.toFixed(1)} – ₹${recentHigh.toFixed(1)} (₹${range.toFixed(1)} width)`);
  console.log(`    Entry position in range: ${posInRange}% (0%=low, 100%=high)`);
  console.log(`    EMA9: ₹${ema9AtEntry.toFixed(1)} | Distance: ${distFromEma}%`);
  console.log(`    Last 5-candle move: ${priceChange5 > 0 ? "+" : ""}₹${priceChange5.toFixed(1)}`);
  console.log(`    Retracement of last swing: ${retracePct}%`);
  console.log(`    CHASING? ${isChasing ? "YES ⚠️ — entered AFTER move started" : "NO — entering against recent move (pullback)"}`);
  
  // Verdict
  if (trade.direction === "SELL") {
    if (Number(posInRange) < 40) {
      console.log(`    PROBLEM: Selling near BOTTOM of range (${posInRange}%) — should sell near TOP`);
    }
    if (Number(retracePct) < 30) {
      console.log(`    PROBLEM: Only ${retracePct}% retracement — price hasn't bounced enough to sell`);
    }
  } else {
    if (Number(posInRange) > 60) {
      console.log(`    PROBLEM: Buying near TOP of range (${posInRange}%) — should buy near BOTTOM`);
    }
  }
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  ENTRY TIMING ANALYSIS — All 8 Losing V2 Trades");
console.log("  Question: Was V2 chasing or entering at pullbacks?");
console.log("═══════════════════════════════════════════════════════════════");

for (const trade of LOSING_TRADES) {
  analyzeEntry(trade);
}

console.log("\n\n═══════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");

process.exit(0);
