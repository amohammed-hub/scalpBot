// ORB Strategy Backtest V2 — Optimized configurations
// Uses the data already fetched, tests more parameter combinations

import axios from "axios";
import fs from "fs";

const INSTRUMENT = "NSE_INDEX|Nifty 50";
const ENCODED = encodeURIComponent(INSTRUMENT);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDayCandles(fromDate, toDate) {
  const url = `https://api.upstox.com/v2/historical-candle/${ENCODED}/1minute/${toDate}/${fromDate}`;
  try {
    const resp = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 15000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
    })).reverse();
  } catch (e) {
    console.error(`  Failed: ${fromDate}-${toDate}: ${e.message}`);
    return [];
  }
}

function generateDateRanges(months) {
  const ranges = [];
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setMonth(start.getMonth() - months);
  let current = new Date(start);
  while (current < end) {
    const chunkEnd = new Date(current); chunkEnd.setDate(chunkEnd.getDate() + 29);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    ranges.push({ from: current.toISOString().split("T")[0], to: chunkEnd.toISOString().split("T")[0] });
    current = new Date(chunkEnd); current.setDate(current.getDate() + 1);
  }
  return ranges;
}

function groupByDay(candles) {
  const days = {};
  for (const c of candles) {
    const key = new Date(c.timestamp).toISOString().split("T")[0];
    if (!days[key]) days[key] = [];
    days[key].push(c);
  }
  return days;
}

function calcVWAP(candles) {
  let cumPV = 0, cumVol = 0;
  return candles.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume; cumVol += c.volume;
    return cumVol > 0 ? cumPV / cumVol : c.close;
  });
}

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) ema.push(values[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function runORB(dayCandles, config) {
  const {
    orbPeriod, entryWindow, maxRange, minRange, slCap, targetMultiple,
    trailAfterTarget, useVWAPFilter, useEMAFilter, emaPeriod,
    maxEntryTime, exitTime, longOnly, shortOnly, trailPct
  } = config;

  if (dayCandles.length < orbPeriod + 20) return null;

  const orbCandles = dayCandles.slice(0, orbPeriod);
  const orbHigh = Math.max(...orbCandles.map(c => c.high));
  const orbLow = Math.min(...orbCandles.map(c => c.low));
  const orbRange = orbHigh - orbLow;

  if (orbRange > maxRange || orbRange < (minRange || 5)) return null;

  const vwaps = calcVWAP(dayCandles);
  const closes = dayCandles.map(c => c.close);
  const ema = calcEMA(closes, emaPeriod);

  let trade = null;

  for (let i = orbPeriod; i < Math.min(dayCandles.length - 1, maxEntryTime); i += entryWindow) {
    if (trade) break;
    const chunk = dayCandles.slice(i, i + entryWindow);
    if (chunk.length < entryWindow) break;
    
    const fiveMinClose = chunk[chunk.length - 1].close;
    const currentVWAP = vwaps[i + entryWindow - 1];
    const currentEMA = ema[i + entryWindow - 1];
    const prevEMA = ema[Math.max(0, i + entryWindow - 6)];
    const emaRising = currentEMA > prevEMA;
    const emaFalling = currentEMA < prevEMA;

    // LONG
    if (!shortOnly && fiveMinClose > orbHigh) {
      let valid = true;
      if (useVWAPFilter && fiveMinClose < currentVWAP) valid = false;
      if (useEMAFilter && !emaRising) valid = false;
      if (valid) {
        const sl = Math.min(orbRange, slCap);
        trade = { direction: "LONG", entry: fiveMinClose, stopLoss: fiveMinClose - sl, 
                  target: fiveMinClose + (orbRange * targetMultiple), entryIdx: i + entryWindow - 1, sl };
      }
    }
    // SHORT
    else if (!longOnly && fiveMinClose < orbLow) {
      let valid = true;
      if (useVWAPFilter && fiveMinClose > currentVWAP) valid = false;
      if (useEMAFilter && !emaFalling) valid = false;
      if (valid) {
        const sl = Math.min(orbRange, slCap);
        trade = { direction: "SHORT", entry: fiveMinClose, stopLoss: fiveMinClose + sl,
                  target: fiveMinClose - (orbRange * targetMultiple), entryIdx: i + entryWindow - 1, sl };
      }
    }
  }

  if (!trade) return null;

  // Simulate
  let trailingStop = trade.stopLoss;
  let targetHit = false;
  let result = null;
  const tp = trailPct || 0.6;

  for (let i = trade.entryIdx + 1; i < dayCandles.length && i <= exitTime; i++) {
    const c = dayCandles[i];
    if (trade.direction === "LONG") {
      if (c.low <= trailingStop) {
        result = { pnl: trailingStop - trade.entry, exitType: targetHit ? "TRAIL" : "SL", exitIdx: i };
        break;
      }
      if (c.high >= trade.target && !targetHit) {
        targetHit = true;
        if (!trailAfterTarget) { result = { pnl: trade.target - trade.entry, exitType: "TARGET", exitIdx: i }; break; }
        trailingStop = trade.entry + 2;
      }
      if (targetHit) {
        const newTrail = trade.entry + (c.high - trade.entry) * tp;
        if (newTrail > trailingStop) trailingStop = newTrail;
      }
    } else {
      if (c.high >= trailingStop) {
        result = { pnl: trade.entry - trailingStop, exitType: targetHit ? "TRAIL" : "SL", exitIdx: i };
        break;
      }
      if (c.low <= trade.target && !targetHit) {
        targetHit = true;
        if (!trailAfterTarget) { result = { pnl: trade.entry - trade.target, exitType: "TARGET", exitIdx: i }; break; }
        trailingStop = trade.entry - 2;
      }
      if (targetHit) {
        const newTrail = trade.entry - (trade.entry - c.low) * tp;
        if (newTrail < trailingStop) trailingStop = newTrail;
      }
    }
  }

  if (!result) {
    const exitCandle = dayCandles[Math.min(exitTime, dayCandles.length - 1)];
    const pnl = trade.direction === "LONG" ? exitCandle.close - trade.entry : trade.entry - exitCandle.close;
    result = { pnl, exitType: "TIME" };
  }

  return {
    date: new Date(dayCandles[0].timestamp).toISOString().split("T")[0],
    direction: trade.direction,
    entry: trade.entry, sl: trade.sl, orbRange: Math.round(orbRange * 100) / 100,
    pnl: Math.round(result.pnl * 100) / 100, exitType: result.exitType
  };
}

function calcMaxDrawdown(trades) {
  let peak = 0, maxDD = 0, cumPnL = 0;
  for (const t of trades) {
    cumPnL += t.pnl;
    if (cumPnL > peak) peak = cumPnL;
    const dd = peak - cumPnL;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcConsecutiveLosses(trades) {
  let max = 0, current = 0;
  for (const t of trades) {
    if (t.pnl <= 0) { current++; if (current > max) max = current; }
    else current = 0;
  }
  return max;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ORB STRATEGY BACKTEST V2 — OPTIMIZED CONFIGS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const MONTHS = 18;
  const ranges = generateDateRanges(MONTHS);
  console.log(`Fetching ${MONTHS} months of 1-min data...`);
  
  let allCandles = [];
  for (let i = 0; i < ranges.length; i++) {
    const { from, to } = ranges[i];
    process.stdout.write(`  ${i + 1}/${ranges.length}: ${from}→${to} `);
    const candles = await fetchDayCandles(from, to);
    console.log(`${candles.length}`);
    allCandles = allCandles.concat(candles);
    await sleep(250);
  }

  console.log(`\nTotal: ${allCandles.length} candles`);
  const days = groupByDay(allCandles);
  const tradingDays = Object.keys(days).sort();
  console.log(`Days: ${tradingDays.length} (${tradingDays[0]} → ${tradingDays[tradingDays.length - 1]})\n`);

  const configs = [
    { name: "V5: 15min ORB, VWAP+EMA21, 20pt SL, 60% target, trail@50%",
      orbPeriod: 15, entryWindow: 5, maxRange: 60, minRange: 8, slCap: 20,
      targetMultiple: 0.6, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 120, exitTime: 345, longOnly: false, shortOnly: false, trailPct: 0.5 },
    { name: "V6: 15min ORB, VWAP+EMA21, 25pt SL, 75% target, trail@60%",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, minRange: 8, slCap: 25,
      targetMultiple: 0.75, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 135, exitTime: 360, longOnly: false, shortOnly: false, trailPct: 0.6 },
    { name: "V7: 15min ORB, VWAP only, 25pt SL, 100% target (range), no trail",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, minRange: 8, slCap: 25,
      targetMultiple: 1.0, trailAfterTarget: false, useVWAPFilter: true, useEMAFilter: false,
      emaPeriod: 21, maxEntryTime: 135, exitTime: 360, longOnly: false, shortOnly: false, trailPct: 0.6 },
    { name: "V8: 30min ORB, VWAP+EMA21, 30pt SL, 50% target, trail@60%",
      orbPeriod: 30, entryWindow: 5, maxRange: 100, minRange: 10, slCap: 30,
      targetMultiple: 0.5, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 150, exitTime: 360, longOnly: false, shortOnly: false, trailPct: 0.6 },
    { name: "V9: 30min ORB, VWAP+EMA21, 30pt SL, 75% target, trail@50%",
      orbPeriod: 30, entryWindow: 5, maxRange: 100, minRange: 10, slCap: 30,
      targetMultiple: 0.75, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 150, exitTime: 360, longOnly: false, shortOnly: false, trailPct: 0.5 },
    { name: "V10: 15min ORB, VWAP+EMA21, 25pt SL, 50% target, LONG ONLY",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, minRange: 8, slCap: 25,
      targetMultiple: 0.5, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 135, exitTime: 360, longOnly: true, shortOnly: false, trailPct: 0.6 },
    { name: "V11: 15min ORB, VWAP+EMA21, 25pt SL, 50% target, SHORT ONLY",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, minRange: 8, slCap: 25,
      targetMultiple: 0.5, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 135, exitTime: 360, longOnly: false, shortOnly: true, trailPct: 0.6 },
    { name: "V12: 15min ORB, VWAP+EMA21, 20pt SL, 50% target, trail@70% (tight trail)",
      orbPeriod: 15, entryWindow: 5, maxRange: 80, minRange: 8, slCap: 20,
      targetMultiple: 0.5, trailAfterTarget: true, useVWAPFilter: true, useEMAFilter: true,
      emaPeriod: 21, maxEntryTime: 120, exitTime: 345, longOnly: false, shortOnly: false, trailPct: 0.7 },
  ];

  const summary = [];

  for (const config of configs) {
    const trades = [];
    for (const day of tradingDays) {
      const dayData = days[day];
      const marketCandles = dayData.filter(c => {
        const d = new Date(c.timestamp);
        const h = d.getUTCHours(), m = d.getUTCMinutes();
        const istH = h + 5 + Math.floor((m + 30) / 60);
        const istM = (m + 30) % 60;
        const totalMin = istH * 60 + istM;
        return totalMin >= 9 * 60 + 15 && totalMin <= 15 * 60 + 30;
      });
      if (marketCandles.length < config.orbPeriod + 20) continue;
      const result = runORB(marketCandles, config);
      if (result) trades.push(result);
    }

    const totalTrades = trades.length;
    const winners = trades.filter(t => t.pnl > 0);
    const losers = trades.filter(t => t.pnl <= 0);
    const winRate = totalTrades > 0 ? (winners.length / totalTrades * 100).toFixed(1) : "0";
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
    const pf = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : Infinity;
    const maxDD = calcMaxDrawdown(trades);
    const maxConsecLoss = calcConsecutiveLosses(trades);

    // Monthly
    const monthly = {};
    for (const t of trades) {
      const m = t.date.substring(0, 7);
      if (!monthly[m]) monthly[m] = { pnl: 0, trades: 0, wins: 0 };
      monthly[m].pnl += t.pnl; monthly[m].trades++; if (t.pnl > 0) monthly[m].wins++;
    }
    const months = Object.keys(monthly).sort();
    const profitableMonths = months.filter(m => monthly[m].pnl > 0).length;

    const row = {
      name: config.name, trades: totalTrades, winRate, pf: pf.toFixed(2),
      totalPnL: totalPnL.toFixed(1), maxDD: maxDD.toFixed(1), avgWin: avgWin.toFixed(1),
      avgLoss: avgLoss.toFixed(1), maxConsecLoss, profMonths: `${profitableMonths}/${months.length}`
    };
    summary.push(row);

    console.log(`\n${config.name}`);
    console.log(`  Trades: ${totalTrades} | WR: ${winRate}% | PF: ${pf.toFixed(2)} | P&L: ${totalPnL.toFixed(1)} pts | MaxDD: ${maxDD.toFixed(1)} | AvgW: +${avgWin.toFixed(1)} | AvgL: -${avgLoss.toFixed(1)} | ConsecL: ${maxConsecLoss} | ProfMonths: ${profitableMonths}/${months.length}`);
    
    // Print monthly for best ones
    if (pf >= 1.2) {
      console.log(`  Monthly: ${months.map(m => `${m}:${monthly[m].pnl >= 0 ? "+" : ""}${monthly[m].pnl.toFixed(0)}`).join(" | ")}`);
    }
  }

  console.log(`\n\n═══════════════════════════════════════════════════════════════`);
  console.log(`  FINAL COMPARISON (sorted by P&L)`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  summary.sort((a, b) => parseFloat(b.totalPnL) - parseFloat(a.totalPnL));
  console.log(`${"Config".padEnd(65)} | Tr  | WR%   | PF   | P&L pts  | MaxDD  | ConsL | ProfMo`);
  console.log("─".repeat(130));
  for (const r of summary) {
    console.log(`${r.name.padEnd(65)} | ${String(r.trades).padEnd(3)} | ${(r.winRate+"%").padEnd(5)} | ${r.pf.padEnd(4)} | ${(r.totalPnL).padEnd(8)} | ${r.maxDD.padEnd(6)} | ${String(r.maxConsecLoss).padEnd(5)} | ${r.profMonths}`);
  }
  console.log(`\n⭐ Best: ${summary[0].name}`);
  console.log(`   ${summary[0].totalPnL} pts | WR ${summary[0].winRate}% | PF ${summary[0].pf} | MaxDD ${summary[0].maxDD} pts`);

  fs.writeFileSync("/tmp/orb_v2_results.json", JSON.stringify(summary, null, 2));
}

main().catch(console.error);
