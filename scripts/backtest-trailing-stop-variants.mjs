/**
 * BACKTEST: Trailing Stop Variant Comparison
 * 
 * CURRENT: Activate at +1 ATR, trail at 50% of max profit
 * TEST A: Activate at +1.5 ATR, trail at 60% of max profit (wider)
 * TEST B: Activate at +2 ATR, trail at 70% of max profit (much wider)
 * TEST C: NO trailing stop at all — exit ONLY on SL or target hit
 * TEST D: Trail using Red Bar exit (Dr. Pratap rule — exit when opposite color Renko brick forms)
 * 
 * All use: No time exit (Variant C from previous test), RedBar V2 + quality filters
 * Instruments: NIFTY, BANKNIFTY
 * Period: 18 months (Jan 2025 – Jul 2026)
 * 
 * Usage: node scripts/backtest-trailing-stop-variants.mjs
 */

const INSTRUMENTS = [
  { name: "NIFTY", token: "NSE_INDEX|Nifty 50" },
  { name: "BANKNIFTY", token: "NSE_INDEX|Nifty Bank" },
];

const START_DATE = new Date("2025-01-01");
const END_DATE = new Date("2026-07-25");
const CHUNK_DAYS = 28;

// ── Technical Indicators ──
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return candles.length > 1 ? Math.abs(candles[candles.length-1].high - candles[candles.length-1].low) : 1;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1]?.close ?? candles[i].open;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i-1] * (1 - k));
  }
  return result;
}

function calcADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return 0;
  const pdm = [], mdm = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i-1].high;
    const dn = candles[i-1].low - candles[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return 0;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let pdi = pdm.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let mdi = mdm.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const dxArr = [];
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    pdi = (pdi * (period - 1) + pdm[i]) / period;
    mdi = (mdi * (period - 1) + mdm[i]) / period;
    if (atr === 0) continue;
    const plusDI = 100 * pdi / atr;
    const minusDI = 100 * mdi / atr;
    const sum = plusDI + minusDI;
    dxArr.push(sum > 0 ? 100 * Math.abs(plusDI - minusDI) / sum : 0);
  }
  if (dxArr.length < period) return dxArr.length > 0 ? dxArr.reduce((a, b) => a + b, 0) / dxArr.length : 0;
  return dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── RedBar V2 Strategy (same as previous backtest) ──
function generateRedBarSignal(candles) {
  if (candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  if (atr <= 0) return null;
  
  const rsi = calcRSI(closes, 14);
  const adx = calcADX(candles, 14);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema9v = ema9[ema9.length - 1];
  const ema21v = ema21[ema21.length - 1];
  
  if (adx < 25) return null;
  
  const brickSize = atr;
  const bricks = [];
  let lastBrickClose = candles[0].close;
  for (const c of candles) {
    while (c.close >= lastBrickClose + brickSize) { lastBrickClose += brickSize; bricks.push("up"); }
    while (c.close <= lastBrickClose - brickSize) { lastBrickClose -= brickSize; bricks.push("down"); }
  }
  if (bricks.length < 3) return null;
  
  const lastDir = bricks[bricks.length - 1];
  let count = 0;
  for (let i = bricks.length - 1; i >= 0 && bricks[i] === lastDir; i--) count++;
  if (count < 3) return null;
  
  const confidence = Math.min(0.85, 0.65 + (count - 3) * 0.05);
  if (confidence < 0.60) return null;
  
  if (lastDir === "up") {
    if (rsi <= 42 || ema9v <= ema21v) return null;
    return { direction: "BUY", confidence, sl: price - atr * 1.5, tp: price + atr * 3, atr, price };
  } else {
    if (rsi >= 58 || ema9v >= ema21v) return null;
    return { direction: "SELL", confidence, sl: price + atr * 1.5, tp: price - atr * 3, atr, price };
  }
}

// ── Trailing Stop Configurations ──
const TRAIL_CONFIGS = {
  "CURRENT": { activateATR: 1.0, trailPct: 0.50, label: "Current (+1ATR, 50%)" },
  "A":       { activateATR: 1.5, trailPct: 0.60, label: "A (+1.5ATR, 60%)" },
  "B":       { activateATR: 2.0, trailPct: 0.70, label: "B (+2ATR, 70%)" },
  "C":       { activateATR: Infinity, trailPct: 0, label: "C (No trail)" },  // Never activates
  "D":       { activateATR: 0, trailPct: 0, label: "D (Red brick exit)", useRenko: true },
};

// ── Trade Simulation with configurable trailing stop ──
function simulateTrade(candles, entryIdx, signal, trailConfig) {
  const entryPrice = candles[entryIdx].close;
  const entryTime = candles[entryIdx].timestamp;
  const atr = signal.atr;
  const sl = signal.sl;
  const tp = signal.tp;
  
  let trailActive = false;
  let trailSl = sl;
  let maxProfit = 0;
  
  // For TEST D: track Renko bricks during trade
  let renkoBase = entryPrice;
  let lastBrickDir = signal.direction === "BUY" ? "up" : "down";
  
  const maxCandles = 120; // 2-hour absolute safety net
  let exitPrice = entryPrice;
  let exitTime = entryTime;
  let exitReason = "TIMEOUT";
  
  for (let j = entryIdx + 1; j < Math.min(entryIdx + maxCandles, candles.length); j++) {
    const c = candles[j];
    const currentPnl = signal.direction === "BUY" ? c.close - entryPrice : entryPrice - c.close;
    if (currentPnl > maxProfit) maxProfit = currentPnl;
    
    // ── TEST D: Red Brick Exit (Dr. Pratap's original rule) ──
    if (trailConfig.useRenko) {
      // Build Renko bricks during trade
      const brickSize = atr;
      while (c.close >= renkoBase + brickSize) { renkoBase += brickSize; lastBrickDir = "up"; }
      while (c.close <= renkoBase - brickSize) { renkoBase -= brickSize; lastBrickDir = "down"; }
      
      // Exit when opposite color brick forms (only after at least 1 ATR profit to avoid premature exit)
      if (currentPnl > atr * 0.5) { // Small buffer to avoid noise exits
        if (signal.direction === "BUY" && lastBrickDir === "down") {
          exitPrice = c.close; exitTime = c.timestamp; exitReason = "RED_BRICK"; break;
        }
        if (signal.direction === "SELL" && lastBrickDir === "up") {
          exitPrice = c.close; exitTime = c.timestamp; exitReason = "GREEN_BRICK"; break;
        }
      }
    }
    
    // ── Percentage-based trailing stop (CURRENT, A, B) ──
    if (!trailConfig.useRenko && trailConfig.activateATR < Infinity) {
      if (!trailActive && currentPnl >= atr * trailConfig.activateATR) {
        trailActive = true;
      }
      if (trailActive) {
        const newTrailSl = signal.direction === "BUY"
          ? entryPrice + maxProfit * trailConfig.trailPct
          : entryPrice - maxProfit * trailConfig.trailPct;
        if (signal.direction === "BUY" && newTrailSl > trailSl) trailSl = newTrailSl;
        if (signal.direction === "SELL" && newTrailSl < trailSl) trailSl = newTrailSl;
      }
    }
    
    // Check SL hit (original SL or trailing SL)
    const effectiveSl = trailActive ? trailSl : sl;
    if (signal.direction === "BUY") {
      if (c.low <= effectiveSl) {
        exitPrice = effectiveSl; exitTime = c.timestamp;
        exitReason = trailActive ? "TRAIL_SL" : "STOP_LOSS"; break;
      }
    } else {
      if (c.high >= effectiveSl) {
        exitPrice = effectiveSl; exitTime = c.timestamp;
        exitReason = trailActive ? "TRAIL_SL" : "STOP_LOSS"; break;
      }
    }
    
    // Check Target hit
    if (signal.direction === "BUY") {
      if (c.high >= tp) { exitPrice = tp; exitTime = c.timestamp; exitReason = "TARGET"; break; }
    } else {
      if (c.low <= tp) { exitPrice = tp; exitTime = c.timestamp; exitReason = "TARGET"; break; }
    }
    
    // No time exit (Variant C confirmed)
    exitPrice = c.close; exitTime = c.timestamp;
  }
  
  const pnl = signal.direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
  const duration = (exitTime - entryTime) / 60000;
  return { entryPrice, exitPrice, entryTime, exitTime, pnl, duration, exitReason, targetHit: exitReason === "TARGET", direction: signal.direction };
}

// ── Data Fetching ──
async function fetchCandles(token, toDate, fromDate) {
  const encoded = encodeURIComponent(token);
  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/1minute/${toDate}/${fromDate}`;
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const json = await resp.json();
    const raw = json?.data?.candles ?? [];
    return raw.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0
    })).sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) { return []; }
}

async function fetchAllCandles(token, name) {
  const allCandles = [];
  let current = new Date(START_DATE);
  let chunkCount = 0;
  const totalChunks = Math.ceil((END_DATE - START_DATE) / (CHUNK_DAYS * 86400000));
  
  while (current < END_DATE) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    if (chunkEnd > END_DATE) chunkEnd.setTime(END_DATE.getTime());
    const fromStr = current.toISOString().split("T")[0];
    const toStr = chunkEnd.toISOString().split("T")[0];
    const candles = await fetchCandles(token, toStr, fromStr);
    allCandles.push(...candles);
    chunkCount++;
    if (chunkCount % 5 === 0) process.stdout.write(`  [${name}] ${chunkCount}/${totalChunks} chunks...\r`);
    await new Promise(r => setTimeout(r, 1100));
    current = new Date(chunkEnd);
  }
  
  const seen = new Set();
  const unique = [];
  for (const c of allCandles) { if (!seen.has(c.timestamp)) { seen.add(c.timestamp); unique.push(c); } }
  console.log(`  [${name}] Total: ${unique.length} unique candles (${chunkCount} chunks)`);
  return unique.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Backtest Engine ──
function runBacktest(candles, trailConfig) {
  const WINDOW = 60;
  const trades = [];
  let i = WINDOW;
  let lastTradeExit = 0;
  let dailyTradeCount = {};
  
  while (i < candles.length) {
    if (i < lastTradeExit + 5) { i++; continue; }
    
    const candleDate = new Date(candles[i].timestamp);
    const hours = candleDate.getUTCHours();
    const mins = candleDate.getUTCMinutes();
    const istHour = hours + 5 + Math.floor((mins + 30) / 60);
    const istMin = (mins + 30) % 60;
    const istTime = istHour * 100 + istMin;
    if (istTime < 920 || istTime > 1520) { i++; continue; }
    
    const dayKey = candleDate.toISOString().split("T")[0];
    if (!dailyTradeCount[dayKey]) dailyTradeCount[dayKey] = 0;
    if (dailyTradeCount[dayKey] >= 2) { i++; continue; }
    
    const window = candles.slice(Math.max(0, i - WINDOW), i + 1);
    const signal = generateRedBarSignal(window);
    
    if (signal) {
      const trade = simulateTrade(candles, i, signal, trailConfig);
      trades.push(trade);
      dailyTradeCount[dayKey]++;
      const exitIdx = candles.findIndex((c, idx) => idx > i && c.timestamp >= trade.exitTime);
      lastTradeExit = exitIdx > i ? exitIdx : i + 5;
      i = lastTradeExit + 1;
    } else {
      i++;
    }
  }
  return trades;
}

// ── Stats ──
function computeStats(trades) {
  if (trades.length === 0) return { totalTrades: 0, winRate: "0", avgWin: "0", avgLoss: "0", totalPnl: "0", maxDrawdown: "0", targetHitRate: "0", avgDuration: "0", profitFactor: "0" };
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const targetHits = trades.filter(t => t.targetHit);
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
  const avgDuration = trades.reduce((a, t) => a + t.duration, 0) / trades.length;
  let peak = 0, maxDD = 0, cumPnl = 0;
  for (const t of trades) { cumPnl += t.pnl; if (cumPnl > peak) peak = cumPnl; const dd = peak - cumPnl; if (dd > maxDD) maxDD = dd; }
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  return {
    totalTrades: trades.length, wins: wins.length, losses: losses.length,
    winRate: (wins.length / trades.length * 100).toFixed(1),
    avgWin: avgWin.toFixed(1), avgLoss: avgLoss.toFixed(1),
    totalPnl: totalPnl.toFixed(0), maxDrawdown: maxDD.toFixed(0),
    targetHitRate: (targetHits.length / trades.length * 100).toFixed(1),
    avgDuration: avgDuration.toFixed(1), profitFactor: profitFactor.toFixed(2),
  };
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  TRAILING STOP VARIANT BACKTEST — RedBar V2 + No Time Exit      ║");
  console.log("║  Period: Jan 2025 – Jul 2026 (18 months, 1-min candles)         ║");
  console.log("║  Instruments: NIFTY, BANKNIFTY                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  
  const results = {};
  
  for (const inst of INSTRUMENTS) {
    console.log(`\n📊 Fetching ${inst.name} data...`);
    const candles = await fetchAllCandles(inst.token, inst.name);
    if (candles.length < 100) { console.log(`  ⚠ Insufficient data. Skipping.`); continue; }
    
    console.log(`  Running 5 trailing stop variants on ${candles.length} candles...`);
    
    for (const [key, config] of Object.entries(TRAIL_CONFIGS)) {
      const trades = runBacktest(candles, config);
      const stats = computeStats(trades);
      const rKey = `${inst.name}_${key}`;
      results[rKey] = { instrument: inst.name, variant: key, label: config.label, ...stats, trades };
      console.log(`  ${config.label}: ${stats.totalTrades} trades, WR ${stats.winRate}%, P&L ${stats.totalPnl} pts, PF ${stats.profitFactor}`);
    }
  }
  
  // ── Print Comparison Table ──
  console.log("\n\n" + "═".repeat(110));
  console.log("  TRAILING STOP COMPARISON TABLE");
  console.log("═".repeat(110));
  console.log("| Instrument | Trail Config         | Trades | Win Rate | Avg Win | Avg Loss | Total P&L | Max DD | Target% | Avg Dur  | PF   |");
  console.log("|------------|----------------------|--------|----------|---------|----------|-----------|--------|---------|----------|------|");
  
  for (const inst of INSTRUMENTS) {
    for (const key of Object.keys(TRAIL_CONFIGS)) {
      const rKey = `${inst.name}_${key}`;
      const r = results[rKey];
      if (!r) continue;
      console.log(`| ${inst.name.padEnd(10)} | ${r.label.padEnd(20)} | ${String(r.totalTrades).padStart(6)} | ${(r.winRate + "%").padStart(8)} | ${String(r.avgWin).padStart(7)} | ${String(r.avgLoss).padStart(8)} | ${String(r.totalPnl).padStart(9)} | ${String(r.maxDrawdown).padStart(6)} | ${(r.targetHitRate + "%").padStart(7)} | ${(r.avgDuration + "m").padStart(8)} | ${String(r.profitFactor).padStart(4)} |`);
    }
    console.log("|------------|----------------------|--------|----------|---------|----------|-----------|--------|---------|----------|------|");
  }
  
  // ── Exit Reason Breakdown ──
  console.log("\n" + "═".repeat(80));
  console.log("  EXIT REASON BREAKDOWN");
  console.log("═".repeat(80));
  for (const inst of INSTRUMENTS) {
    for (const key of Object.keys(TRAIL_CONFIGS)) {
      const rKey = `${inst.name}_${key}`;
      const r = results[rKey];
      if (!r || !r.trades) continue;
      const reasons = {};
      for (const t of r.trades) reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1;
      console.log(`  ${inst.name} — ${r.label}:`);
      for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason.padEnd(15)} ${String(count).padStart(4)} (${(count / r.trades.length * 100).toFixed(1)}%)`);
      }
      console.log("");
    }
  }
  
  // Save results
  const summary = {};
  for (const [key, val] of Object.entries(results)) { const { trades, ...rest } = val; summary[key] = rest; }
  const fs = await import("fs");
  fs.writeFileSync("scripts/backtest-trailing-stop-results.json", JSON.stringify(summary, null, 2));
  console.log("\n✅ Results saved to scripts/backtest-trailing-stop-results.json");
}

main().catch(console.error);
