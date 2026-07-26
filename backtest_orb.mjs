// ORB (Opening Range Breakout) Strategy Backtest
// Fetches 1-2 years of NIFTY 50 1-minute historical candles from Upstox API
// and simulates the ORB strategy with VWAP + 21 EMA filters

import axios from "axios";
import fs from "fs";

const INSTRUMENT = "NSE_INDEX|Nifty 50";
const ENCODED = encodeURIComponent(INSTRUMENT);

// Upstox historical candle API (non-intraday) supports date range
// Format: /v2/historical-candle/{instrument}/{interval}/{to_date}/{from_date}
// 1minute interval available for up to 30 days per request

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDayCandles(fromDate, toDate) {
  const url = `https://api.upstox.com/v2/historical-candle/${ENCODED}/1minute/${toDate}/${fromDate}`;
  try {
    const resp = await axios.get(url, { 
      headers: { Accept: "application/json" }, 
      timeout: 15000 
    });
    const candles = resp.data?.data?.candles ?? [];
    // Each candle: [timestamp, open, high, low, close, volume, oi]
    return candles.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    })).reverse(); // Upstox returns descending — reverse to ascending
  } catch (e) {
    console.error(`  Failed to fetch ${fromDate} to ${toDate}: ${e.message}`);
    return [];
  }
}

// Generate date ranges (30-day chunks) for the past N months
function generateDateRanges(months) {
  const ranges = [];
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  
  let current = new Date(start);
  while (current < end) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + 29); // 30-day chunks
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    
    ranges.push({
      from: current.toISOString().split("T")[0],
      to: chunkEnd.toISOString().split("T")[0]
    });
    
    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }
  return ranges;
}

// Group candles by trading day
function groupByDay(candles) {
  const days = {};
  for (const c of candles) {
    const d = new Date(c.timestamp);
    const key = d.toISOString().split("T")[0];
    if (!days[key]) days[key] = [];
    days[key].push(c);
  }
  return days;
}

// Calculate VWAP from candles
function calcVWAP(candles) {
  let cumPV = 0, cumVol = 0;
  const vwaps = [];
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumVol += c.volume;
    vwaps.push(cumVol > 0 ? cumPV / cumVol : c.close);
  }
  return vwaps;
}

// Calculate EMA
function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ORB Strategy Logic
function runORBStrategy(dayCandles, config) {
  const {
    orbPeriod = 15,       // First 15 candles (9:15-9:30)
    entryWindow = 5,      // 5-min candle close for entry (aggregate 5 one-min candles)
    maxRange = 80,        // Skip if range > 80 pts
    slCap = 25,           // Max SL 25 pts
    targetMultiple = 0.5, // Target = 50% of range
    trailAfterTarget = true,
    useVWAPFilter = true,
    useEMAFilter = true,
    emaPeriod = 21,
    maxEntryTime = 135,   // Max entry at candle index 135 (11:30 AM = 9:15 + 135 min)
    exitTime = 360        // Force exit at 3:15 PM (9:15 + 360 min)
  } = config;

  if (dayCandles.length < orbPeriod + 20) return null; // Not enough data

  // Step 1: Calculate Opening Range (first 15 candles: 9:15-9:30)
  const orbCandles = dayCandles.slice(0, orbPeriod);
  const orbHigh = Math.max(...orbCandles.map(c => c.high));
  const orbLow = Math.min(...orbCandles.map(c => c.low));
  const orbRange = orbHigh - orbLow;

  // Skip if range too large or too small
  if (orbRange > maxRange || orbRange < 5) return null;

  // Step 2: Calculate VWAP and 21 EMA for the full day
  const vwaps = calcVWAP(dayCandles);
  const closes = dayCandles.map(c => c.close);
  const ema21 = calcEMA(closes, emaPeriod);

  // Step 3: Look for breakout after ORB period
  // We check 5-min aggregated candles (every 5 one-min candles)
  let trade = null;

  for (let i = orbPeriod; i < Math.min(dayCandles.length - 1, maxEntryTime); i += entryWindow) {
    if (trade) break; // Only 1 trade per day

    // Aggregate 5 one-min candles into one 5-min candle
    const chunk = dayCandles.slice(i, i + entryWindow);
    if (chunk.length < entryWindow) break;
    
    const fiveMinHigh = Math.max(...chunk.map(c => c.high));
    const fiveMinLow = Math.min(...chunk.map(c => c.low));
    const fiveMinClose = chunk[chunk.length - 1].close;
    const fiveMinOpen = chunk[0].open;

    const currentVWAP = vwaps[i + entryWindow - 1];
    const currentEMA = ema21[i + entryWindow - 1];
    const prevEMA = ema21[Math.max(0, i - 1)];
    const emaRising = currentEMA > prevEMA;
    const emaFalling = currentEMA < prevEMA;

    // LONG breakout: 5-min candle CLOSES above ORB High
    if (fiveMinClose > orbHigh) {
      let valid = true;
      if (useVWAPFilter && fiveMinClose < currentVWAP) valid = false;
      if (useEMAFilter && !emaRising) valid = false;
      
      if (valid) {
        const sl = Math.min(orbRange, slCap);
        const entry = fiveMinClose;
        const stopLoss = entry - sl;
        const target = entry + (orbRange * targetMultiple);
        trade = { direction: "LONG", entry, stopLoss, target, entryIdx: i + entryWindow - 1, sl };
      }
    }
    // SHORT breakout: 5-min candle CLOSES below ORB Low
    else if (fiveMinClose < orbLow) {
      let valid = true;
      if (useVWAPFilter && fiveMinClose > currentVWAP) valid = false;
      if (useEMAFilter && !emaFalling) valid = false;
      
      if (valid) {
        const sl = Math.min(orbRange, slCap);
        const entry = fiveMinClose;
        const stopLoss = entry + sl;
        const target = entry - (orbRange * targetMultiple);
        trade = { direction: "SHORT", entry, stopLoss, target, entryIdx: i + entryWindow - 1, sl };
      }
    }
  }

  if (!trade) return null;

  // Step 4: Simulate trade outcome
  let result = null;
  let trailingStop = trade.stopLoss;
  let targetHit = false;

  for (let i = trade.entryIdx + 1; i < dayCandles.length && i <= exitTime; i++) {
    const c = dayCandles[i];

    if (trade.direction === "LONG") {
      // Check SL hit
      if (c.low <= trailingStop) {
        const exitPrice = trailingStop;
        result = { pnl: exitPrice - trade.entry, exitType: targetHit ? "TRAIL" : "SL", exitIdx: i };
        break;
      }
      // Check target hit
      if (c.high >= trade.target && !targetHit) {
        targetHit = true;
        // Move SL to breakeven + 2 pts
        trailingStop = trade.entry + 2;
        // Continue with trailing
        if (trailAfterTarget) {
          // Trail at entry + 60% of move
          const move = c.high - trade.entry;
          const newTrail = trade.entry + move * 0.6;
          if (newTrail > trailingStop) trailingStop = newTrail;
        } else {
          result = { pnl: trade.target - trade.entry, exitType: "TARGET", exitIdx: i };
          break;
        }
      }
      // Update trailing stop if target was hit
      if (targetHit && trailAfterTarget) {
        const move = c.high - trade.entry;
        const newTrail = trade.entry + move * 0.6;
        if (newTrail > trailingStop) trailingStop = newTrail;
      }
    } else {
      // SHORT
      if (c.high >= trailingStop) {
        const exitPrice = trailingStop;
        result = { pnl: trade.entry - exitPrice, exitType: targetHit ? "TRAIL" : "SL", exitIdx: i };
        break;
      }
      if (c.low <= trade.target && !targetHit) {
        targetHit = true;
        trailingStop = trade.entry - 2;
        if (trailAfterTarget) {
          const move = trade.entry - c.low;
          const newTrail = trade.entry - move * 0.6;
          if (newTrail < trailingStop) trailingStop = newTrail;
        } else {
          result = { pnl: trade.entry - trade.target, exitType: "TARGET", exitIdx: i };
          break;
        }
      }
      if (targetHit && trailAfterTarget) {
        const move = trade.entry - c.low;
        const newTrail = trade.entry - move * 0.6;
        if (newTrail < trailingStop) trailingStop = newTrail;
      }
    }
  }

  // Time exit if no result yet
  if (!result) {
    const exitCandle = dayCandles[Math.min(exitTime, dayCandles.length - 1)];
    const exitPrice = exitCandle.close;
    const pnl = trade.direction === "LONG" ? exitPrice - trade.entry : trade.entry - exitPrice;
    result = { pnl, exitType: "TIME", exitIdx: Math.min(exitTime, dayCandles.length - 1) };
  }

  return {
    date: new Date(dayCandles[0].timestamp).toISOString().split("T")[0],
    direction: trade.direction,
    entry: trade.entry,
    sl: trade.sl,
    orbRange: Math.round(orbRange * 100) / 100,
    pnl: Math.round(result.pnl * 100) / 100,
    exitType: result.exitType,
    target: Math.round(trade.target * 100) / 100
  };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ORB STRATEGY BACKTEST — NIFTY 50 (1-2 Years)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Fetch 18 months of data (maximum practical range)
  const MONTHS = 18;
  const ranges = generateDateRanges(MONTHS);
  console.log(`Fetching ${MONTHS} months of 1-min data in ${ranges.length} chunks...`);
  
  let allCandles = [];
  
  for (let i = 0; i < ranges.length; i++) {
    const { from, to } = ranges[i];
    process.stdout.write(`  Chunk ${i + 1}/${ranges.length}: ${from} → ${to} ... `);
    const candles = await fetchDayCandles(from, to);
    console.log(`${candles.length} candles`);
    allCandles = allCandles.concat(candles);
    await sleep(300); // Rate limiting
  }

  console.log(`\nTotal candles fetched: ${allCandles.length}`);
  
  // Group by trading day
  const days = groupByDay(allCandles);
  const tradingDays = Object.keys(days).sort();
  console.log(`Trading days: ${tradingDays.length}`);
  console.log(`Date range: ${tradingDays[0]} to ${tradingDays[tradingDays.length - 1]}`);
  console.log("");

  // Run backtest with different configurations
  const configs = [
    {
      name: "ORB v1 (Conservative: VWAP+EMA, 25pt SL, 50% target, trail)",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, slCap: 25,
      targetMultiple: 0.5, trailAfterTarget: true,
      useVWAPFilter: true, useEMAFilter: true, emaPeriod: 21,
      maxEntryTime: 135, exitTime: 360
    },
    {
      name: "ORB v2 (Aggressive: VWAP only, 30pt SL, 75% target, no trail)",
      orbPeriod: 15, entryWindow: 5, maxRange: 100, slCap: 30,
      targetMultiple: 0.75, trailAfterTarget: false,
      useVWAPFilter: true, useEMAFilter: false, emaPeriod: 21,
      maxEntryTime: 135, exitTime: 360
    },
    {
      name: "ORB v3 (Pure: No filters, 25pt SL, 50% target, trail)",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, slCap: 25,
      targetMultiple: 0.5, trailAfterTarget: true,
      useVWAPFilter: false, useEMAFilter: false, emaPeriod: 21,
      maxEntryTime: 135, exitTime: 360
    },
    {
      name: "ORB v4 (30-min range: VWAP+EMA, 30pt SL, 50% target, trail)",
      orbPeriod: 30, entryWindow: 5, maxRange: 100, slCap: 30,
      targetMultiple: 0.5, trailAfterTarget: true,
      useVWAPFilter: true, useEMAFilter: true, emaPeriod: 21,
      maxEntryTime: 150, exitTime: 360
    }
  ];

  const allResults = {};

  for (const config of configs) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${config.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const trades = [];
    let skippedDays = 0;

    for (const day of tradingDays) {
      const dayData = days[day];
      // Filter to market hours only (9:15 AM - 3:30 PM IST)
      const marketCandles = dayData.filter(c => {
        const d = new Date(c.timestamp);
        const h = d.getUTCHours(); // IST = UTC+5:30
        const m = d.getUTCMinutes();
        const istH = h + 5 + Math.floor((m + 30) / 60);
        const istM = (m + 30) % 60;
        const totalMin = istH * 60 + istM;
        return totalMin >= 9 * 60 + 15 && totalMin <= 15 * 60 + 30;
      });

      if (marketCandles.length < config.orbPeriod + 20) {
        skippedDays++;
        continue;
      }

      const result = runORBStrategy(marketCandles, config);
      if (result) trades.push(result);
    }

    // Calculate statistics
    const totalTrades = trades.length;
    const winners = trades.filter(t => t.pnl > 0);
    const losers = trades.filter(t => t.pnl <= 0);
    const winRate = totalTrades > 0 ? (winners.length / totalTrades * 100).toFixed(1) : 0;
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : Infinity;
    const maxDD = calcMaxDrawdown(trades);
    const longs = trades.filter(t => t.direction === "LONG");
    const shorts = trades.filter(t => t.direction === "SHORT");
    const longWinRate = longs.length > 0 ? (longs.filter(t => t.pnl > 0).length / longs.length * 100).toFixed(1) : 0;
    const shortWinRate = shorts.length > 0 ? (shorts.filter(t => t.pnl > 0).length / shorts.length * 100).toFixed(1) : 0;

    // Monthly breakdown
    const monthly = {};
    for (const t of trades) {
      const m = t.date.substring(0, 7);
      if (!monthly[m]) monthly[m] = { pnl: 0, trades: 0, wins: 0 };
      monthly[m].pnl += t.pnl;
      monthly[m].trades++;
      if (t.pnl > 0) monthly[m].wins++;
    }

    // Exit type breakdown
    const exitTypes = {};
    for (const t of trades) {
      if (!exitTypes[t.exitType]) exitTypes[t.exitType] = { count: 0, pnl: 0 };
      exitTypes[t.exitType].count++;
      exitTypes[t.exitType].pnl += t.pnl;
    }

    console.log(`\n  RESULTS:`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Total Trading Days:  ${tradingDays.length}`);
    console.log(`  Days with Signal:    ${totalTrades} (${(totalTrades/tradingDays.length*100).toFixed(0)}% hit rate)`);
    console.log(`  Skipped Days:        ${skippedDays} (insufficient data)`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Total Trades:        ${totalTrades}`);
    console.log(`  Winners:             ${winners.length}`);
    console.log(`  Losers:              ${losers.length}`);
    console.log(`  Win Rate:            ${winRate}%`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Total P&L:           ${totalPnL.toFixed(1)} pts`);
    console.log(`  Avg Win:             +${avgWin.toFixed(1)} pts`);
    console.log(`  Avg Loss:            -${avgLoss.toFixed(1)} pts`);
    console.log(`  Profit Factor:       ${profitFactor.toFixed(2)}`);
    console.log(`  Max Drawdown:        ${maxDD.toFixed(1)} pts`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Longs:               ${longs.length} (${longWinRate}% win)`);
    console.log(`  Shorts:              ${shorts.length} (${shortWinRate}% win)`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Exit Types:`);
    for (const [type, data] of Object.entries(exitTypes)) {
      console.log(`    ${type.padEnd(8)}: ${data.count} trades, ${data.pnl.toFixed(1)} pts`);
    }

    console.log(`\n  MONTHLY BREAKDOWN:`);
    console.log(`  ${"Month".padEnd(10)} | ${"Trades".padEnd(7)} | ${"Wins".padEnd(5)} | ${"WR%".padEnd(6)} | P&L (pts)`);
    console.log(`  ${"─".repeat(55)}`);
    const months = Object.keys(monthly).sort();
    let profitableMonths = 0;
    for (const m of months) {
      const d = monthly[m];
      const wr = (d.wins / d.trades * 100).toFixed(0);
      const pnlStr = d.pnl >= 0 ? `+${d.pnl.toFixed(1)}` : d.pnl.toFixed(1);
      console.log(`  ${m.padEnd(10)} | ${String(d.trades).padEnd(7)} | ${String(d.wins).padEnd(5)} | ${(wr + "%").padEnd(6)} | ${pnlStr}`);
      if (d.pnl > 0) profitableMonths++;
    }
    console.log(`\n  Profitable Months: ${profitableMonths}/${months.length} (${(profitableMonths/months.length*100).toFixed(0)}%)`);

    allResults[config.name] = {
      totalTrades, winRate, totalPnL: totalPnL.toFixed(1), profitFactor: profitFactor.toFixed(2),
      maxDD: maxDD.toFixed(1), avgWin: avgWin.toFixed(1), avgLoss: avgLoss.toFixed(1),
      profitableMonths: `${profitableMonths}/${months.length}`
    };
  }

  // Summary comparison
  console.log(`\n\n═══════════════════════════════════════════════════════════════`);
  console.log(`  STRATEGY COMPARISON SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`\n  ${"Config".padEnd(60)} | ${"Trades".padEnd(7)} | ${"WR%".padEnd(6)} | ${"PF".padEnd(5)} | ${"P&L".padEnd(10)} | MaxDD`);
  console.log(`  ${"─".repeat(105)}`);
  for (const [name, r] of Object.entries(allResults)) {
    const shortName = name.substring(0, 58);
    console.log(`  ${shortName.padEnd(60)} | ${String(r.totalTrades).padEnd(7)} | ${(r.winRate + "%").padEnd(6)} | ${r.profitFactor.padEnd(5)} | ${(r.totalPnL + " pts").padEnd(10)} | ${r.maxDD} pts`);
  }

  // Save detailed results to file
  const bestConfig = Object.entries(allResults).sort((a, b) => parseFloat(b[1].totalPnL) - parseFloat(a[1].totalPnL))[0];
  console.log(`\n  ⭐ BEST CONFIG: ${bestConfig[0]}`);
  console.log(`     P&L: ${bestConfig[1].totalPnL} pts | WR: ${bestConfig[1].winRate}% | PF: ${bestConfig[1].profitFactor}`);

  fs.writeFileSync("/tmp/orb_backtest_results.json", JSON.stringify(allResults, null, 2));
  console.log(`\n  Results saved to /tmp/orb_backtest_results.json`);
}

function calcMaxDrawdown(trades) {
  let peak = 0, dd = 0, maxDD = 0;
  let cumPnL = 0;
  for (const t of trades) {
    cumPnL += t.pnl;
    if (cumPnL > peak) peak = cumPnL;
    dd = peak - cumPnL;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

main().catch(console.error);
