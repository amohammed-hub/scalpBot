/**
 * MCX Backtest V4 — Strategy B (Wider SL + 1:2 R:R)
 * Gold: brick=50, Crude: brick=10
 * Uses Upstox Analytics Token for historical data
 * MCX instrument keys: MCX_FO|GOLD, MCX_FO|CRUDEOIL
 */
import https from "https";

const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwidHlwIjoiSldUIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIyYzFjNTU0OS05MWI3LTQyODMtOTdmNi1mMGUyZThkZTBiMTQiLCJqdGkiOiIxNzUzNDkxNjY0NjM0IiwiaXNNdWx0aUNsaWVudCI6ZmFsc2UsImlhdCI6MTc1MzQ5MTY2NCwiaXNzIjoiYW5hbHl0aWNzLWFwaSIsImV4cCI6MTc4NTAyNzY2NH0.7dNYTy-Nj3PZSoN-vUFpBTHjZzrqvHcBfkgVYnKqFDo";

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ status: "error", raw: data }); } });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Renko Logic ──
function buildRenkoBricks(candles, brickSize) {
  if (!candles.length || brickSize <= 0) return [];
  const bricks = [];
  let base = candles[0].close;
  for (const c of candles) {
    while (c.close >= base + brickSize) {
      const open = base; base += brickSize;
      bricks.push({ open, close: base, high: base, low: open, color: "green", ts: c.timestamp });
    }
    while (c.close <= base - brickSize) {
      const open = base; base -= brickSize;
      bricks.push({ open, close: base, high: open, low: base, color: "red", ts: c.timestamp });
    }
  }
  return bricks;
}

function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [data.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < data.length; i++) {
    result.push(data[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

// ── V4 Signal Generator (Strategy B: wider SL + 1:2 R:R) ──
function generateSignal(candles, brickSize, timestamp) {
  if (!candles || candles.length < 20) return null;

  // Time filter: MCX Gold 9:00-11:30 PM, Crude 9:00-11:30 PM (IST)
  // But for backtesting we use 9:15 AM - 11:25 PM IST (full MCX session)
  if (timestamp) {
    const ist = new Date(timestamp + 5.5 * 60 * 60 * 1000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    // MCX session: 9:00 AM to 11:30 PM IST = 540 to 1410 mins
    // Skip first 15 mins: start at 9:15 = 555 mins
    if (mins < 555 || mins > 1390) return null;
  }

  const bricks = buildRenkoBricks(candles, brickSize);
  if (bricks.length < 5) return null;

  // Sideways detection: 5+ color changes in last 8 bricks = choppy
  if (bricks.length >= 8) {
    const last8 = bricks.slice(-8);
    let changes = 0;
    for (let i = 1; i < last8.length; i++) if (last8[i].color !== last8[i-1].color) changes++;
    if (changes >= 5) return null;
  }

  // EMA trend
  const closes = bricks.map(b => b.close);
  const ema10 = ema(closes, 10);
  const ema30 = ema(closes, 30);
  if (!ema10.length) return null;
  const e10 = ema10[ema10.length - 1];
  const e30 = ema30.length > 0 ? ema30[ema30.length - 1] : e10;
  const price = candles[candles.length - 1].close;
  const use30 = bricks.length >= 30;
  const isUp = price > e10 && (!use30 || e10 >= e30);
  const isDown = price < e10 && (!use30 || e10 <= e30);

  // BUY SETUP: 3+ green → red pullback → breakout above red HIGH
  if (isUp) {
    let redIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "red") { redIdx = i; break; }
    }
    if (redIdx >= 0 && redIdx < bricks.length - 1) {
      const red = bricks[redIdx];
      let breakout = false;
      for (let g = redIdx + 1; g < bricks.length; g++) {
        if (bricks[g].color !== "green") break;
        if (bricks[g].close >= red.high) { breakout = true; break; }
      }
      if (breakout) {
        let greenBefore = 0;
        for (let i = redIdx - 1; i >= 0 && i >= redIdx - 8; i--) {
          if (bricks[i].color === "green") greenBefore++; else break;
        }
        if (greenBefore >= 3) {
          // Strategy B: SL = Red LOW - 0.5 brick (wider)
          const sl = red.low - brickSize * 0.5;
          const risk = price - sl;
          const target = price + risk * 2; // 1:2 R:R
          return { direction: "BUY", entry: price, sl, target, risk };
        }
      }
    }
  }

  // SELL SETUP: 3+ red → green pullback → breakdown below green LOW
  if (isDown) {
    let greenIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "green") { greenIdx = i; break; }
    }
    if (greenIdx >= 0 && greenIdx < bricks.length - 1) {
      const green = bricks[greenIdx];
      let breakout = false;
      for (let r = greenIdx + 1; r < bricks.length; r++) {
        if (bricks[r].color !== "red") break;
        if (bricks[r].close <= green.low) { breakout = true; break; }
      }
      if (breakout) {
        let redBefore = 0;
        for (let i = greenIdx - 1; i >= 0 && i >= greenIdx - 8; i--) {
          if (bricks[i].color === "red") redBefore++; else break;
        }
        if (redBefore >= 3) {
          const sl = green.high + brickSize * 0.5;
          const risk = sl - price;
          const target = price - risk * 2;
          return { direction: "SELL", entry: price, sl, target, risk };
        }
      }
    }
  }

  return null;
}

// ── Trade Simulator ──
function simulateTrade(signal, candles, startIdx) {
  const { direction, entry, sl, target } = signal;
  for (let j = startIdx + 1; j < candles.length; j++) {
    const c = candles[j];
    if (direction === "BUY") {
      if (c.low <= sl) return { pnl: sl - entry, reason: "SL" };
      if (c.high >= target) return { pnl: target - entry, reason: "TARGET" };
    } else {
      if (c.high >= sl) return { pnl: entry - sl, reason: "SL" };
      if (c.low <= target) return { pnl: entry - target, reason: "TARGET" };
    }
  }
  const lastClose = candles[candles.length - 1].close;
  const pnl = direction === "BUY" ? lastClose - entry : entry - lastClose;
  return { pnl, reason: "EOD" };
}

// ── Fetch 1-min candles in 3-day chunks ──
async function fetchCandles(instrumentKey, fromDate, toDate) {
  const allCandles = [];
  const startMs = new Date(fromDate).getTime();
  const endMs = new Date(toDate).getTime();
  const chunkMs = 3 * 86400000;

  let cur = startMs;
  while (cur < endMs) {
    const to = Math.min(cur + chunkMs, endMs);
    const from = new Date(cur).toISOString().split("T")[0];
    const toStr = new Date(to).toISOString().split("T")[0];
    if (from === toStr) { cur = to + 86400000; continue; }

    const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrumentKey)}/1minute/${toStr}/${from}`;
    const resp = await httpGet(url);
    if (resp.status === "success" && resp.data?.candles?.length) {
      for (const c of resp.data.candles) {
        allCandles.push({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
      }
    }
    cur = to;
    await sleep(350);
  }

  allCandles.sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set();
  return allCandles.filter(c => { if (seen.has(c.timestamp)) return false; seen.add(c.timestamp); return true; });
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  MCX BACKTEST V4 — Strategy B (Wider SL + 1:2 R:R)         ║");
  console.log("║  Gold: brick=₹50 | Crude Oil: brick=₹10                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // MCX instruments — use continuous futures contracts
  const instruments = [
    { key: "MCX_FO|466583", label: "GOLD FUT 05 AUG 26", brick: 50, from: "2026-06-01", to: "2026-07-26", lotValue: 100 },
    { key: "MCX_FO|560977", label: "CRUDEOIL FUT 19 AUG 26", brick: 10, from: "2026-06-01", to: "2026-07-26", lotValue: 100 },
  ];
  const workingInstruments = instruments;

  const MAX_TRADES_PER_DAY = 2;

  for (const inst of workingInstruments) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`${inst.label} | Brick: ₹${inst.brick}`);
    console.log(`Period: ${inst.from} → ${inst.to}`);
    console.log("═".repeat(60));

    const candles = await fetchCandles(inst.key, inst.from, inst.to);
    if (!candles.length) { console.log("ERROR: No candle data fetched"); continue; }

    // Group by day
    const dayMap = new Map();
    for (const c of candles) {
      const day = new Date(c.timestamp + 5.5 * 3600000).toISOString().split("T")[0];
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(c);
    }
    console.log(`Candles: ${candles.length} | Days: ${dayMap.size}`);

    let wins = 0, losses = 0, targetHits = 0, slHits = 0, eodExits = 0;
    let totalPnl = 0, maxDD = 0, peak = 0, maxWin = 0, maxLoss = 0;
    const dailyPnl = [];

    for (const [day, dayCandles] of dayMap) {
      let dayTrades = 0, dayPnl = 0;
      for (let i = 30; i < dayCandles.length && dayTrades < MAX_TRADES_PER_DAY; i++) {
        const window = dayCandles.slice(0, i + 1);
        const signal = generateSignal(window, inst.brick, window[window.length - 1].timestamp);
        if (!signal) continue;

        const result = simulateTrade(signal, dayCandles, i);
        if (!result) continue;

        dayTrades++;
        totalPnl += result.pnl;
        dayPnl += result.pnl;
        if (result.pnl > 0) { wins++; maxWin = Math.max(maxWin, result.pnl); }
        else { losses++; maxLoss = Math.min(maxLoss, result.pnl); }
        if (result.reason === "TARGET") targetHits++;
        else if (result.reason === "SL") slHits++;
        else eodExits++;

        peak = Math.max(peak, totalPnl);
        maxDD = Math.max(maxDD, peak - totalPnl);
        i += 10; // Skip 10 candles after trade to avoid re-entry
      }
      if (dayTrades > 0) dailyPnl.push({ day, pnl: dayPnl, trades: dayTrades });
    }

    const total = wins + losses;
    console.log(`\n┌────────────────────────────────────────────┐`);
    console.log(`│ RESULTS — Strategy B (Wider SL + 1:2 R:R)  │`);
    console.log(`├────────────────────────────────────────────┤`);
    console.log(`│ Total Trades:    ${String(total).padStart(5)}                    │`);
    console.log(`│ Win Rate:        ${total > 0 ? (wins/total*100).toFixed(1) : "0.0"}%                   │`);
    console.log(`│ Total P&L:       ₹${totalPnl.toFixed(2).padStart(8)}              │`);
    console.log(`│ Max Win:         ₹${maxWin.toFixed(2).padStart(8)}              │`);
    console.log(`│ Max Loss:        ₹${maxLoss.toFixed(2).padStart(8)}              │`);
    console.log(`│ Max Drawdown:    ₹${maxDD.toFixed(2).padStart(8)}              │`);
    console.log(`│ Target Hits:     ${String(targetHits).padStart(5)} (${total > 0 ? (targetHits/total*100).toFixed(0) : 0}%)               │`);
    console.log(`│ SL Hits:         ${String(slHits).padStart(5)} (${total > 0 ? (slHits/total*100).toFixed(0) : 0}%)               │`);
    console.log(`│ EOD Exits:       ${String(eodExits).padStart(5)} (${total > 0 ? (eodExits/total*100).toFixed(0) : 0}%)               │`);
    console.log(`│ Avg/Trade:       ₹${total > 0 ? (totalPnl/total).toFixed(2) : "0.00"}                  │`);
    console.log(`│ Lot Value:       ₹${inst.lotValue}/pt                   │`);
    console.log(`│ Total (lot adj):  ₹${(totalPnl * inst.lotValue).toFixed(0).padStart(7)}             │`);
    console.log(`└────────────────────────────────────────────┘`);

    // Best/worst days
    if (dailyPnl.length) {
      dailyPnl.sort((a, b) => b.pnl - a.pnl);
      console.log(`\nBest days:`);
      for (const d of dailyPnl.slice(0, 5)) console.log(`  ${d.day}: ₹${d.pnl.toFixed(2)} (${d.trades} trades)`);
      console.log(`Worst days:`);
      for (const d of dailyPnl.slice(-3)) console.log(`  ${d.day}: ₹${d.pnl.toFixed(2)} (${d.trades} trades)`);
    }
  }
}

main().catch(console.error);
