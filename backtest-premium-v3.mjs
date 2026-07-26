/**
 * PremiumRenko V3 Backtest — Real Option Premium Data
 * Uses NIFTY26JUL23800CE (NSE_FO|63929) — exchange token format
 * Fetches 1-min candles in 3-day chunks, applies V3 quality filters
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

// ── V3 Signal Generator with Quality Filters ──
function generateSignalV3(candles, brickSize, timestamp) {
  if (!candles || candles.length < 20) return { direction: "HOLD", reason: "insufficient data" };

  // Filter 1: TIME (9:45 AM - 3:20 PM IST)
  if (timestamp) {
    const ist = new Date(timestamp + 5.5 * 60 * 60 * 1000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (mins < 585 || mins > 920) return { direction: "HOLD", reason: "time filter" };
  }

  const bricks = buildRenkoBricks(candles, brickSize);
  if (bricks.length < 5) return { direction: "HOLD", reason: "not enough bricks" };

  // Filter 3: SIDEWAYS DETECTION
  if (bricks.length >= 8) {
    const last8 = bricks.slice(-8);
    let changes = 0;
    for (let i = 1; i < last8.length; i++) if (last8[i].color !== last8[i-1].color) changes++;
    if (changes >= 5) return { direction: "HOLD", reason: "sideways" };
  }

  // EMA 10 + EMA 30 Cloud
  const closes = bricks.map(b => b.close);
  const ema10 = ema(closes, 10);
  const ema30 = ema(closes, 30);
  if (!ema10.length) return { direction: "HOLD", reason: "EMA failed" };
  const e10 = ema10[ema10.length - 1];
  const e30 = ema30.length > 0 ? ema30[ema30.length - 1] : e10;
  const price = candles[candles.length - 1].close;

  const use30 = bricks.length >= 30;
  const isUp = price > e10 && (!use30 || e10 >= e30);
  const isDown = price < e10 && (!use30 || e10 <= e30);
  if (!isUp && !isDown) return { direction: "HOLD", reason: "no trend" };

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
          const since = bricks.length - 1 - redIdx;
          if (since <= 3) {
            const sl = red.low;
            const risk = price - sl;
            if (risk > 0 && risk < price * 0.5) {
              return { direction: "BUY", entry: price, sl, target: price + risk * 2, risk, greenBefore };
            }
          }
        }
      }
    }
  }

  // SELL SETUP (for PE premium — premium going down means PE is losing value, skip)
  // For CE options, we only look for BUY setups (premium going up)
  // For completeness, include SELL (premium declining = exit signal)
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
          const since = bricks.length - 1 - greenIdx;
          if (since <= 3) {
            const sl = green.high;
            const risk = sl - price;
            if (risk > 0 && risk < price * 0.5) {
              return { direction: "SELL", entry: price, sl, target: price - risk * 2, risk, redBefore };
            }
          }
        }
      }
    }
  }

  return { direction: "HOLD", reason: "no pattern" };
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

// ── Backtest a single contract ──
async function backtestContract(exchangeToken, label, brickSize, fromDate, toDate) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${label} — PremiumRenko V3 Backtest`);
  console.log(`Brick: ₹${brickSize} | ${fromDate} → ${toDate}`);
  console.log(`Filters: Time(9:45-3:20) + Sideways + EMA30Cloud + 3brickMin + Max2/day`);
  console.log("═".repeat(60));

  const candles = await fetchCandles(exchangeToken, fromDate, toDate);
  if (!candles.length) { console.log("ERROR: No data"); return null; }

  // Group by day
  const dayMap = new Map();
  for (const c of candles) {
    const day = new Date(c.timestamp + 5.5 * 3600000).toISOString().split("T")[0];
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push(c);
  }
  console.log(`Candles: ${candles.length} | Days: ${dayMap.size}`);

  const trades = [];
  let totalPnl = 0, wins = 0, losses = 0, targetHits = 0, slHits = 0, eodExits = 0;
  let maxDD = 0, peak = 0;
  const MAX_TRADES = 2;

  for (const [day, dayCandles] of dayMap) {
    let dayTrades = 0;

    for (let i = 30; i < dayCandles.length && dayTrades < MAX_TRADES; i++) {
      const window = dayCandles.slice(0, i + 1);
      const signal = generateSignalV3(window, brickSize, window[window.length - 1].timestamp);
      if (signal.direction === "HOLD") continue;

      // Simulate trade
      const { entry, sl, target, direction } = signal;
      let exitPrice = entry, exitReason = "EOD";

      for (let j = i + 1; j < dayCandles.length; j++) {
        const c = dayCandles[j];
        if (direction === "BUY") {
          if (c.low <= sl) { exitPrice = sl; exitReason = "SL"; break; }
          if (c.high >= target) { exitPrice = target; exitReason = "TARGET"; break; }
        } else {
          if (c.high >= sl) { exitPrice = sl; exitReason = "SL"; break; }
          if (c.low <= target) { exitPrice = target; exitReason = "TARGET"; break; }
        }
      }

      const pnl = direction === "BUY" ? exitPrice - entry : entry - exitPrice;
      totalPnl += pnl;
      dayTrades++;
      if (pnl > 0) wins++; else losses++;
      if (exitReason === "TARGET") targetHits++;
      else if (exitReason === "SL") slHits++;
      else eodExits++;

      peak = Math.max(peak, totalPnl);
      maxDD = Math.max(maxDD, peak - totalPnl);

      trades.push({ day, direction, entry: entry.toFixed(1), sl: sl.toFixed(1), target: target.toFixed(1), exit: exitPrice.toFixed(1), pnl: pnl.toFixed(2), exitReason });
      i += 10; // skip ahead
    }
  }

  const total = wins + losses;
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : "0";

  console.log(`\n── RESULTS ──`);
  console.log(`Total Trades: ${total}`);
  console.log(`Win Rate: ${winRate}% (${wins}W / ${losses}L)`);
  console.log(`Total P&L: ₹${totalPnl.toFixed(2)}`);
  console.log(`Target Hits: ${targetHits} (${total > 0 ? (targetHits/total*100).toFixed(0) : 0}%)`);
  console.log(`SL Hits: ${slHits} (${total > 0 ? (slHits/total*100).toFixed(0) : 0}%)`);
  console.log(`EOD Exits: ${eodExits} (${total > 0 ? (eodExits/total*100).toFixed(0) : 0}%)`);
  console.log(`Max Drawdown: ₹${maxDD.toFixed(2)}`);
  console.log(`Avg P&L/Trade: ₹${total > 0 ? (totalPnl/total).toFixed(2) : 0}`);

  if (trades.length > 0) {
    const maxWin = Math.max(...trades.map(t => +t.pnl));
    const maxLoss = Math.min(...trades.map(t => +t.pnl));
    console.log(`Max Win: ₹${maxWin.toFixed(2)} | Max Loss: ₹${maxLoss.toFixed(2)}`);
  }

  // Show sample trades
  console.log(`\n── Sample Trades (first 10) ──`);
  trades.slice(0, 10).forEach(t => {
    console.log(`  ${t.day} ${t.direction} entry:₹${t.entry} sl:₹${t.sl} tgt:₹${t.target} → exit:₹${t.exit} P&L:₹${t.pnl} [${t.exitReason}]`);
  });

  return { total, winRate, totalPnl, maxDD, targetHits, slHits };
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  PREMIUM RENKO V3 — REAL OPTION PREMIUM DATA BACKTEST      ║");
  console.log("║  Filters: Time + Sideways + EMA30 Cloud + 3-Brick + 2/Day  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // NIFTY 23800 CE July monthly (NSE_FO|63929) — 2 weeks of data
  await backtestContract("NSE_FO|63929", "NIFTY 23800 CE (Jul Monthly)", 10, "2026-07-14", "2026-07-26");

  // NIFTY 23750 CE July monthly (NSE_FO|63927)
  await backtestContract("NSE_FO|63927", "NIFTY 23750 CE (Jul Monthly)", 10, "2026-07-14", "2026-07-26");

  // NIFTY 23800 CE Aug 4 weekly (NSE_FO|65684)
  await backtestContract("NSE_FO|65684", "NIFTY 23800 CE (Aug 4 Weekly)", 10, "2026-07-21", "2026-07-26");
}

main().catch(console.error);
