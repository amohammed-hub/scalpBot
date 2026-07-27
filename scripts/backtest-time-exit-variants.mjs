/**
 * BACKTEST: Time-Exit Variant Comparison
 * 
 * Variant A (Current): Fixed 20-min time exit for ALL trades
 * Variant B (Proposed): Smart exit — loss@20min=exit, profit@20min=hold, breakeven±1%@20min=extend to 30min
 * Variant C (No time exit): Exit ONLY on SL, target, or trailing stop
 * 
 * Strategy: RedBar V2 + Quality Filters (RSI, ADX, EMA alignment)
 * Instruments: NIFTY, BANKNIFTY
 * Period: 18 months (Jan 2025 – Jul 2026)
 * Data: Upstox public historical API (1-min candles)
 * 
 * Usage: node scripts/backtest-time-exit-variants.mjs
 */

const INSTRUMENTS = [
  { name: "NIFTY", token: "NSE_INDEX|Nifty 50" },
  { name: "BANKNIFTY", token: "NSE_INDEX|Nifty Bank" },
];

const START_DATE = new Date("2025-01-01");
const END_DATE = new Date("2026-07-25");
const CHUNK_DAYS = 28;
const CAPITAL = 200000;

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

// ── RedBar V2 Strategy ──
function generateRedBarSignal(candles) {
  if (candles.length < 30) return null;
  
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  if (atr <= 0) return null;
  
  // Quality filters
  const rsi = calcRSI(closes, 14);
  const adx = calcADX(candles, 14);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema9v = ema9[ema9.length - 1];
  const ema21v = ema21[ema21.length - 1];
  
  if (adx < 25) return null; // No trend
  
  // Build Renko bricks
  const brickSize = atr;
  const bricks = [];
  let lastBrickClose = candles[0].close;
  for (const c of candles) {
    while (c.close >= lastBrickClose + brickSize) {
      lastBrickClose += brickSize;
      bricks.push("up");
    }
    while (c.close <= lastBrickClose - brickSize) {
      lastBrickClose -= brickSize;
      bricks.push("down");
    }
  }
  if (bricks.length < 3) return null;
  
  // Count consecutive same-direction bricks from end
  const lastDir = bricks[bricks.length - 1];
  let count = 0;
  for (let i = bricks.length - 1; i >= 0 && bricks[i] === lastDir; i--) count++;
  
  if (count < 3) return null;
  
  const confidence = Math.min(0.85, 0.65 + (count - 3) * 0.05);
  if (confidence < 0.60) return null;
  
  if (lastDir === "up") {
    // BUY signal — quality filters
    if (rsi <= 42) return null; // RSI too low for BUY
    if (ema9v <= ema21v) return null; // EMA not aligned for BUY
    return { direction: "BUY", confidence, sl: price - atr * 1.5, tp: price + atr * 3, atr, price };
  } else {
    // SELL signal — quality filters
    if (rsi >= 58) return null; // RSI too high for SELL
    if (ema9v >= ema21v) return null; // EMA not aligned for SELL
    return { direction: "SELL", confidence, sl: price + atr * 1.5, tp: price - atr * 3, atr, price };
  }
}

// ── Trade Simulation ──
function simulateTrade(candles, entryIdx, signal, variant) {
  const entryPrice = candles[entryIdx].close;
  const entryTime = candles[entryIdx].timestamp;
  const atr = signal.atr;
  const sl = signal.sl;
  const tp = signal.tp;
  
  // Trailing stop state
  let trailActive = false;
  let trailSl = sl;
  let maxProfit = 0;
  
  // Walk forward
  const maxCandles = 120; // 2-hour absolute safety net
  let exitPrice = entryPrice;
  let exitTime = entryTime;
  let exitReason = "TIMEOUT";
  
  for (let j = entryIdx + 1; j < Math.min(entryIdx + maxCandles, candles.length); j++) {
    const c = candles[j];
    const elapsed = (c.timestamp - entryTime) / 60000; // minutes
    const currentPnl = signal.direction === "BUY" ? c.close - entryPrice : entryPrice - c.close;
    const currentPnlPct = currentPnl / entryPrice;
    
    // Update max profit for trailing
    if (currentPnl > maxProfit) maxProfit = currentPnl;
    
    // Activate trailing stop at +1 ATR profit
    if (!trailActive && currentPnl >= atr) {
      trailActive = true;
      trailSl = signal.direction === "BUY" 
        ? entryPrice + maxProfit * 0.5 
        : entryPrice - maxProfit * 0.5;
    }
    
    // Update trailing stop
    if (trailActive) {
      const newTrailSl = signal.direction === "BUY"
        ? entryPrice + maxProfit * 0.5
        : entryPrice - maxProfit * 0.5;
      if (signal.direction === "BUY" && newTrailSl > trailSl) trailSl = newTrailSl;
      if (signal.direction === "SELL" && newTrailSl < trailSl) trailSl = newTrailSl;
    }
    
    // Check SL hit
    const effectiveSl = trailActive ? trailSl : sl;
    if (signal.direction === "BUY") {
      if (c.low <= effectiveSl) {
        exitPrice = effectiveSl;
        exitTime = c.timestamp;
        exitReason = trailActive ? "TRAIL_SL" : "STOP_LOSS";
        break;
      }
    } else {
      if (c.high >= effectiveSl) {
        exitPrice = effectiveSl;
        exitTime = c.timestamp;
        exitReason = trailActive ? "TRAIL_SL" : "STOP_LOSS";
        break;
      }
    }
    
    // Check Target hit
    if (signal.direction === "BUY") {
      if (c.high >= tp) { exitPrice = tp; exitTime = c.timestamp; exitReason = "TARGET"; break; }
    } else {
      if (c.low <= tp) { exitPrice = tp; exitTime = c.timestamp; exitReason = "TARGET"; break; }
    }
    
    // ── TIME EXIT LOGIC (variant-specific) ──
    if (variant === "A") {
      // Variant A: Fixed 20-min exit for ALL trades
      if (elapsed >= 20) {
        exitPrice = c.close;
        exitTime = c.timestamp;
        exitReason = "TIME_EXIT_20";
        break;
      }
    } else if (variant === "B") {
      // Variant B: Smart exit
      if (elapsed >= 20 && elapsed < 21) {
        // Check at 20 min mark
        if (currentPnl < 0) {
          // In loss → exit immediately
          exitPrice = c.close;
          exitTime = c.timestamp;
          exitReason = "TIME_EXIT_LOSS";
          break;
        } else if (Math.abs(currentPnlPct) <= 0.01) {
          // Breakeven (±1%) → extend to 30 min, will be caught below
          // Do nothing, let it continue
        }
        // If in profit → do nothing, hold until SL/Target/Trail
      }
      // Breakeven extension: exit at 30 min if still breakeven
      if (elapsed >= 30) {
        // Hard exit at 30 min for breakeven trades (profitable trades continue)
        if (currentPnlPct <= 0.01) {
          exitPrice = c.close;
          exitTime = c.timestamp;
          exitReason = "TIME_EXIT_30_BE";
          break;
        }
      }
    }
    // Variant C: No time exit at all — only SL/Target/Trail (handled above)
    
    // Update exit price for TIMEOUT case
    exitPrice = c.close;
    exitTime = c.timestamp;
  }
  
  const pnl = signal.direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
  const duration = (exitTime - entryTime) / 60000; // minutes
  const targetHit = exitReason === "TARGET";
  
  return { entryPrice, exitPrice, entryTime, exitTime, pnl, duration, exitReason, targetHit, direction: signal.direction };
}

// ── Data Fetching ──
async function fetchCandles(token, toDate, fromDate) {
  const encoded = encodeURIComponent(token);
  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/1minute/${toDate}/${fromDate}`;
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) { return []; }
    const json = await resp.json();
    const raw = json?.data?.candles ?? [];
    return raw.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0
    })).sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    return [];
  }
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
    
    if (chunkCount % 5 === 0) {
      process.stdout.write(`  [${name}] Fetched ${chunkCount}/${totalChunks} chunks (${allCandles.length} candles)...\r`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 1100));
    current = new Date(chunkEnd);
  }
  
  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const c of allCandles) {
    if (!seen.has(c.timestamp)) { seen.add(c.timestamp); unique.push(c); }
  }
  console.log(`  [${name}] Total: ${unique.length} unique candles (${chunkCount} chunks)`);
  return unique.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Backtest Engine ──
function runBacktest(candles, variant, instrumentName) {
  const WINDOW = 60; // 60 candles lookback for indicators
  const trades = [];
  let i = WINDOW;
  let lastTradeExit = 0; // Cooldown between trades (5 candles min)
  let dailyTradeCount = {};
  
  while (i < candles.length) {
    // Cooldown: skip if too close to last trade
    if (i < lastTradeExit + 5) { i++; continue; }
    
    // Only trade during market hours (9:15 AM - 3:20 PM IST)
    const candleDate = new Date(candles[i].timestamp);
    const hours = candleDate.getUTCHours(); // UTC
    const mins = candleDate.getUTCMinutes();
    const istHour = hours + 5 + Math.floor((mins + 30) / 60);
    const istMin = (mins + 30) % 60;
    const istTime = istHour * 100 + istMin;
    
    if (istTime < 920 || istTime > 1520) { i++; continue; } // Skip pre-market and close
    
    // Max 2 trades per day (per the user's intended limit)
    const dayKey = candleDate.toISOString().split("T")[0];
    if (!dailyTradeCount[dayKey]) dailyTradeCount[dayKey] = 0;
    if (dailyTradeCount[dayKey] >= 2) { i++; continue; }
    
    const window = candles.slice(Math.max(0, i - WINDOW), i + 1);
    const signal = generateRedBarSignal(window);
    
    if (signal) {
      const trade = simulateTrade(candles, i, signal, variant);
      trades.push(trade);
      dailyTradeCount[dayKey]++;
      
      // Skip to after exit
      const exitIdx = candles.findIndex((c, idx) => idx > i && c.timestamp >= trade.exitTime);
      lastTradeExit = exitIdx > i ? exitIdx : i + 5;
      i = lastTradeExit + 1;
    } else {
      i++;
    }
  }
  
  return trades;
}

// ── Stats Computation ──
function computeStats(trades) {
  if (trades.length === 0) return { totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, totalPnl: 0, maxDrawdown: 0, targetHitRate: 0, avgDuration: 0, profitFactor: 0 };
  
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const targetHits = trades.filter(t => t.targetHit);
  
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
  const avgDuration = trades.reduce((a, t) => a + t.duration, 0) / trades.length;
  
  // Max drawdown
  let peak = 0, maxDD = 0, cumPnl = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Profit factor
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  
  return {
    totalTrades: trades.length,
    winRate: (wins.length / trades.length * 100).toFixed(1),
    avgWin: avgWin.toFixed(1),
    avgLoss: avgLoss.toFixed(1),
    totalPnl: totalPnl.toFixed(0),
    maxDrawdown: maxDD.toFixed(0),
    targetHitRate: (targetHits.length / trades.length * 100).toFixed(1),
    avgDuration: avgDuration.toFixed(1),
    profitFactor: profitFactor.toFixed(2),
    wins: wins.length,
    losses: losses.length,
  };
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  TIME-EXIT VARIANT BACKTEST — RedBar V2 + Quality Filters       ║");
  console.log("║  Period: Jan 2025 – Jul 2026 (18 months, 1-min candles)         ║");
  console.log("║  Instruments: NIFTY, BANKNIFTY                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  
  const results = {};
  
  for (const inst of INSTRUMENTS) {
    console.log(`\n📊 Fetching ${inst.name} data...`);
    const candles = await fetchAllCandles(inst.token, inst.name);
    
    if (candles.length < 100) {
      console.log(`  ⚠ Insufficient data for ${inst.name} (${candles.length} candles). Skipping.`);
      continue;
    }
    
    console.log(`  Running backtests on ${candles.length} candles...`);
    
    for (const variant of ["A", "B", "C"]) {
      const trades = runBacktest(candles, variant, inst.name);
      const stats = computeStats(trades);
      const key = `${inst.name}_${variant}`;
      results[key] = { instrument: inst.name, variant, ...stats, trades };
      console.log(`  Variant ${variant}: ${stats.totalTrades} trades, WR ${stats.winRate}%, P&L ${stats.totalPnl} pts`);
    }
  }
  
  // ── Print Comparison Table ──
  console.log("\n\n" + "═".repeat(100));
  console.log("  COMPARISON TABLE — Time-Exit Variants");
  console.log("═".repeat(100));
  
  const header = "| Instrument | Variant | Trades | Win Rate | Avg Win | Avg Loss | Total P&L | Max DD | Target Hit% | Avg Duration | PF |";
  const sep =    "|------------|---------|--------|----------|---------|----------|-----------|--------|-------------|--------------|------|";
  console.log(header);
  console.log(sep);
  
  for (const inst of INSTRUMENTS) {
    for (const v of ["A", "B", "C"]) {
      const key = `${inst.name}_${v}`;
      const r = results[key];
      if (!r) continue;
      const label = v === "A" ? "A (20min all)" : v === "B" ? "B (smart)" : "C (no time)";
      console.log(`| ${inst.name.padEnd(10)} | ${label.padEnd(13)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRate + "%").padStart(8)} | ${String(r.avgWin).padStart(7)} | ${String(r.avgLoss).padStart(8)} | ${String(r.totalPnl).padStart(9)} | ${String(r.maxDrawdown).padStart(6)} | ${String(r.targetHitRate + "%").padStart(11)} | ${String(r.avgDuration + " min").padStart(12)} | ${String(r.profitFactor).padStart(4)} |`);
    }
    console.log(sep);
  }
  
  // ── Exit Reason Breakdown ──
  console.log("\n\n" + "═".repeat(80));
  console.log("  EXIT REASON BREAKDOWN");
  console.log("═".repeat(80));
  
  for (const inst of INSTRUMENTS) {
    for (const v of ["A", "B", "C"]) {
      const key = `${inst.name}_${v}`;
      const r = results[key];
      if (!r || !r.trades) continue;
      const reasons = {};
      for (const t of r.trades) {
        reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1;
      }
      const label = v === "A" ? "A (20min all)" : v === "B" ? "B (smart)" : "C (no time)";
      console.log(`  ${inst.name} — Variant ${label}:`);
      for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
        const pct = (count / r.trades.length * 100).toFixed(1);
        console.log(`    ${reason.padEnd(20)} ${String(count).padStart(4)} (${pct}%)`);
      }
      console.log("");
    }
  }
  
  // Save results (without individual trades for readability)
  const summary = {};
  for (const [key, val] of Object.entries(results)) {
    const { trades, ...rest } = val;
    summary[key] = rest;
  }
  
  const fs = await import("fs");
  fs.writeFileSync("scripts/backtest-time-exit-results.json", JSON.stringify(summary, null, 2));
  console.log("\n✅ Results saved to scripts/backtest-time-exit-results.json");
}

main().catch(console.error);
