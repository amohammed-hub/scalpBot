/**
 * PremiumRenko V4 Backtest — SL Optimization Study
 * Tests multiple SL strategies on real option premium data:
 * A) Original: SL = Red brick LOW (1 brick)
 * B) Wider SL: SL = Red brick LOW - 0.5 brick (1.5x brick)
 * C) Trailing SL: Move SL to breakeven after 1 brick profit
 * D) Wider SL + 1:1.5 R:R target (instead of 1:2)
 * E) Wider SL + Trailing after 1 brick
 */
import https from "https";

const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwidHlwIjoiSldUIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIyYzFjNTU0OS05MWI3LTQyODMtOTdmNi1mMGUyZThkZTBiMTQiLCJqdGkiOiIxNzUzNDkxNjY0NjM0IiwiaXNNdWx0aUNsaWVudCI6ZmFsc2UsImlhdCI6MTc1MzQ5MTY2NCwiaXNzIjoiYW5hbHl0aWNzLWFwaSIsImV4cCI6MTc4NTAyNzY2NH0.7dNYTy-Nj3PZSoN-vUFpBTHjZzrqvHcBfkgVYnKqFDo";

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ status: "error" }); } });
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

// ── V4 Signal Generator ──
function generateSignal(candles, brickSize, timestamp) {
  if (!candles || candles.length < 20) return null;

  // Time filter: 9:45 AM - 3:20 PM IST
  if (timestamp) {
    const ist = new Date(timestamp + 5.5 * 60 * 60 * 1000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (mins < 585 || mins > 920) return null;
  }

  const bricks = buildRenkoBricks(candles, brickSize);
  if (bricks.length < 5) return null;

  // Sideways detection
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

  // BUY SETUP
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
          return { direction: "BUY", entry: price, redLow: red.low, brickSize };
        }
      }
    }
  }

  // SELL SETUP
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
          return { direction: "SELL", entry: price, greenHigh: green.high, brickSize };
        }
      }
    }
  }

  return null;
}

// ── Trade Simulator with configurable SL strategy ──
function simulateTrade(signal, candles, startIdx, strategy) {
  const { direction, entry, redLow, greenHigh, brickSize } = signal;
  
  let sl, target;
  if (direction === "BUY") {
    switch (strategy) {
      case "A": sl = redLow; target = entry + (entry - redLow) * 2; break;
      case "B": sl = redLow - brickSize * 0.5; target = entry + (entry - sl) * 2; break;
      case "C": sl = redLow; target = entry + (entry - redLow) * 2; break;
      case "D": sl = redLow - brickSize * 0.5; target = entry + (entry - sl) * 1.5; break;
      case "E": sl = redLow - brickSize * 0.5; target = entry + (entry - sl) * 2; break;
    }
  } else {
    switch (strategy) {
      case "A": sl = greenHigh; target = entry - (greenHigh - entry) * 2; break;
      case "B": sl = greenHigh + brickSize * 0.5; target = entry - (sl - entry) * 2; break;
      case "C": sl = greenHigh; target = entry - (greenHigh - entry) * 2; break;
      case "D": sl = greenHigh + brickSize * 0.5; target = entry - (sl - entry) * 1.5; break;
      case "E": sl = greenHigh + brickSize * 0.5; target = entry - (sl - entry) * 2; break;
    }
  }

  const risk = direction === "BUY" ? entry - sl : sl - entry;
  if (risk <= 0 || risk > entry * 0.5) return null;

  let currentSl = sl;
  let trailedToBreakeven = false;

  for (let j = startIdx + 1; j < candles.length; j++) {
    const c = candles[j];
    
    // Trailing SL logic (strategies C and E)
    if ((strategy === "C" || strategy === "E") && !trailedToBreakeven) {
      if (direction === "BUY" && c.high >= entry + brickSize) {
        currentSl = entry; // Move SL to breakeven
        trailedToBreakeven = true;
      } else if (direction === "SELL" && c.low <= entry - brickSize) {
        currentSl = entry;
        trailedToBreakeven = true;
      }
    }

    if (direction === "BUY") {
      if (c.low <= currentSl) return { pnl: currentSl - entry, reason: trailedToBreakeven ? "TRAIL_BE" : "SL" };
      if (c.high >= target) return { pnl: target - entry, reason: "TARGET" };
    } else {
      if (c.high >= currentSl) return { pnl: entry - currentSl, reason: trailedToBreakeven ? "TRAIL_BE" : "SL" };
      if (c.low <= target) return { pnl: entry - target, reason: "TARGET" };
    }
  }
  
  // EOD exit at last candle close
  const lastClose = candles[candles.length - 1].close;
  const pnl = direction === "BUY" ? lastClose - entry : entry - lastClose;
  return { pnl, reason: "EOD" };
}

// ── Fetch 1-min candles in 3-day chunks ──
async function fetchCandles(exchangeToken, fromDate, toDate) {
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

    const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(exchangeToken)}/1minute/${toStr}/${from}`;
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

// ── Run backtest for one strategy ──
function backtestStrategy(dayMap, brickSize, strategy) {
  let wins = 0, losses = 0, targetHits = 0, slHits = 0, trailBE = 0, eodExits = 0;
  let totalPnl = 0, maxDD = 0, peak = 0;
  const MAX_TRADES = 2;

  for (const [day, dayCandles] of dayMap) {
    let dayTrades = 0;
    for (let i = 30; i < dayCandles.length && dayTrades < MAX_TRADES; i++) {
      const window = dayCandles.slice(0, i + 1);
      const signal = generateSignal(window, brickSize, window[window.length - 1].timestamp);
      if (!signal) continue;

      const result = simulateTrade(signal, dayCandles, i, strategy);
      if (!result) continue;

      dayTrades++;
      totalPnl += result.pnl;
      if (result.pnl > 0) wins++; else losses++;
      if (result.reason === "TARGET") targetHits++;
      else if (result.reason === "SL") slHits++;
      else if (result.reason === "TRAIL_BE") trailBE++;
      else eodExits++;

      peak = Math.max(peak, totalPnl);
      maxDD = Math.max(maxDD, peak - totalPnl);
      i += 10;
    }
  }

  const total = wins + losses;
  return { strategy, total, wins, losses, winRate: total > 0 ? (wins/total*100).toFixed(1) : "0", totalPnl: totalPnl.toFixed(2), maxDD: maxDD.toFixed(2), targetHits, slHits, trailBE, eodExits };
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  PREMIUM RENKO V4 — SL OPTIMIZATION STUDY                  ║");
  console.log("║  Testing 5 SL strategies on real NIFTY option premium data  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("\nStrategies:");
  console.log("  A) Original: SL = Red brick LOW, Target = 1:2 R:R");
  console.log("  B) Wider SL: SL = Red LOW - 0.5 brick, Target = 1:2 R:R");
  console.log("  C) Original SL + Trail to breakeven after 1 brick profit");
  console.log("  D) Wider SL + 1:1.5 R:R target (easier target)");
  console.log("  E) Wider SL + Trail to breakeven after 1 brick profit");

  const contracts = [
    { token: "NSE_FO|63929", label: "NIFTY 23800 CE (Jul Monthly)", from: "2026-07-07", to: "2026-07-26", brick: 10 },
    { token: "NSE_FO|63927", label: "NIFTY 23750 CE (Jul Monthly)", from: "2026-07-07", to: "2026-07-26", brick: 10 },
  ];

  for (const contract of contracts) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`${contract.label}`);
    console.log(`Brick: ₹${contract.brick} | ${contract.from} → ${contract.to}`);
    console.log("═".repeat(60));

    const candles = await fetchCandles(contract.token, contract.from, contract.to);
    if (!candles.length) { console.log("ERROR: No data"); continue; }

    // Group by day
    const dayMap = new Map();
    for (const c of candles) {
      const day = new Date(c.timestamp + 5.5 * 3600000).toISOString().split("T")[0];
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(c);
    }
    console.log(`Candles: ${candles.length} | Days: ${dayMap.size}`);

    // Run all strategies
    const results = [];
    for (const strat of ["A", "B", "C", "D", "E"]) {
      results.push(backtestStrategy(dayMap, contract.brick, strat));
    }

    // Print comparison table
    console.log("\n┌──────────┬────────┬──────────┬──────────┬─────────┬────────┬─────────┬────────┐");
    console.log("│ Strategy │ Trades │ Win Rate │ Total PL │ Max DD  │ Target │ SL Hit  │ Trail  │");
    console.log("├──────────┼────────┼──────────┼──────────┼─────────┼────────┼─────────┼────────┤");
    for (const r of results) {
      console.log(`│    ${r.strategy}     │  ${String(r.total).padStart(3)}   │  ${r.winRate.padStart(5)}%  │ ₹${r.totalPnl.padStart(7)} │ ₹${r.maxDD.padStart(6)} │  ${String(r.targetHits).padStart(3)}   │   ${String(r.slHits).padStart(3)}   │  ${String(r.trailBE).padStart(3)}   │`);
    }
    console.log("└──────────┴────────┴──────────┴──────────┴─────────┴────────┴─────────┴────────┘");
  }
}

main().catch(console.error);
