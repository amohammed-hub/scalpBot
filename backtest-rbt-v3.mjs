/**
 * Red Bar Theory V3 Backtest — with Quality Filters from Dr. Pratap's video lessons
 * 
 * FILTERS ADDED:
 * 1. Time filter: Skip before 9:45 AM IST, skip after 3:20 PM IST
 * 2. Trade limit: Max 2 trades per day
 * 3. Sideways detection: Skip if last 8 bricks have 5+ color changes
 * 4. EMA 30 Trend Cloud: Price > EMA10 > EMA30 for buys (when 30+ bricks)
 * 5. Strong momentum: Min 3 green/red bricks before pullback (up from 2)
 * 
 * Uses Upstox Analytics Token for real data.
 */
import https from "https";

const TOKEN = process.env.UPSTOX_TOKEN || "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwidHlwIjoiSldUIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIyYzFjNTU0OS05MWI3LTQyODMtOTdmNi1mMGUyZThkZTBiMTQiLCJqdGkiOiIxNzUzNDkxNjY0NjM0IiwiaXNNdWx0aUNsaWVudCI6ZmFsc2UsImlhdCI6MTc1MzQ5MTY2NCwiaXNzIjoiYW5hbHl0aWNzLWFwaSIsImV4cCI6MTc4NTAyNzY2NH0.7dNYTy-Nj3PZSoN-vUFpBTHjZzrqvHcBfkgVYnKqFDo";

function fetch(url, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    https.get(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ status: "error", data: data }); }
      });
    }).on("error", reject);
  });
}

// ── Renko + Signal Logic (V3 with quality filters) ──
function buildRenkoBricks(candles, brickSize) {
  if (!candles.length || brickSize <= 0) return [];
  const bricks = [];
  let base = candles[0].close;
  for (const c of candles) {
    const price = c.close;
    while (price >= base + brickSize) {
      const open = base; base += brickSize;
      bricks.push({ open, close: base, high: base, low: open, color: "green", timestamp: c.timestamp });
    }
    while (price <= base - brickSize) {
      const open = base; base -= brickSize;
      bricks.push({ open, close: base, high: open, low: base, color: "red", timestamp: c.timestamp });
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

function generateSignalV3(candles, brickSize, timestamp) {
  if (!candles || candles.length < 20) return { direction: "HOLD", reason: "insufficient data" };

  // ── Filter 1: TIME FILTER ──
  if (timestamp) {
    const ist = new Date(timestamp + 5.5 * 60 * 60 * 1000);
    const istHour = ist.getUTCHours();
    const istMin = ist.getUTCMinutes();
    const istTimeMinutes = istHour * 60 + istMin;
    if (istTimeMinutes < 585) return { direction: "HOLD", reason: "time filter: before 9:45 AM" };
    if (istTimeMinutes > 920) return { direction: "HOLD", reason: "time filter: after 3:20 PM" };
  }

  const bricks = buildRenkoBricks(candles, brickSize);
  if (bricks.length < 5) return { direction: "HOLD", reason: `only ${bricks.length} bricks` };

  // ── Filter 3: SIDEWAYS DETECTION ──
  if (bricks.length >= 8) {
    const last8 = bricks.slice(-8);
    let colorChanges = 0;
    for (let i = 1; i < last8.length; i++) {
      if (last8[i].color !== last8[i - 1].color) colorChanges++;
    }
    if (colorChanges >= 5) return { direction: "HOLD", reason: `sideways: ${colorChanges} changes` };
  }

  // ── EMA 10 + EMA 30 Trend Cloud ──
  const brickCloses = bricks.map(b => b.close);
  const ema10arr = ema(brickCloses, 10);
  const ema30arr = ema(brickCloses, 30);
  if (ema10arr.length === 0) return { direction: "HOLD", reason: "EMA calc failed" };
  const currentEma10 = ema10arr[ema10arr.length - 1];
  const currentEma30 = ema30arr.length > 0 ? ema30arr[ema30arr.length - 1] : currentEma10;
  const price = candles[candles.length - 1].close;

  // ── Filter 4: EMA30 Cloud (only when 30+ bricks) ──
  const useEma30 = bricks.length >= 30;
  const isUptrend = price > currentEma10 && (!useEma30 || currentEma10 >= currentEma30);
  const isDowntrend = price < currentEma10 && (!useEma30 || currentEma10 <= currentEma30);
  if (!isUptrend && !isDowntrend) return { direction: "HOLD", reason: "no clear trend" };

  // ── BUY SETUP ──
  if (isUptrend) {
    let redIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "red") { redIdx = i; break; }
    }
    if (redIdx >= 0 && redIdx < bricks.length - 1) {
      const redBrick = bricks[redIdx];
      let breakoutConfirmed = false;
      for (let gi = redIdx + 1; gi < bricks.length; gi++) {
        if (bricks[gi].color !== "green") break;
        if (bricks[gi].close >= redBrick.high) { breakoutConfirmed = true; break; }
      }
      if (breakoutConfirmed) {
        // ── Filter 5: STRONG MOMENTUM — min 3 green bricks ──
        let greenBefore = 0;
        for (let i = redIdx - 1; i >= 0 && i >= redIdx - 8; i--) {
          if (bricks[i].color === "green") greenBefore++;
          else break;
        }
        if (greenBefore >= 3) {
          const bricksSince = bricks.length - 1 - redIdx;
          if (bricksSince <= 3) {
            const sl = redBrick.low;
            const risk = price - sl;
            if (risk > 0) {
              return { direction: "BUY", entry: price, sl, target: price + risk * 2, risk, greenBefore, reason: "V3 BUY" };
            }
          }
        }
      }
    }
  }

  // ── SELL SETUP ──
  if (isDowntrend) {
    let greenIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "green") { greenIdx = i; break; }
    }
    if (greenIdx >= 0 && greenIdx < bricks.length - 1) {
      const greenBrick = bricks[greenIdx];
      let breakoutSell = false;
      for (let ri = greenIdx + 1; ri < bricks.length; ri++) {
        if (bricks[ri].color !== "red") break;
        if (bricks[ri].close <= greenBrick.low) { breakoutSell = true; break; }
      }
      if (breakoutSell) {
        let redBefore = 0;
        for (let i = greenIdx - 1; i >= 0 && i >= greenIdx - 8; i--) {
          if (bricks[i].color === "red") redBefore++;
          else break;
        }
        if (redBefore >= 3) {
          const bricksSince = bricks.length - 1 - greenIdx;
          if (bricksSince <= 3) {
            const sl = greenBrick.high;
            const risk = sl - price;
            if (risk > 0) {
              return { direction: "SELL", entry: price, sl, target: price - risk * 2, risk, redBefore, reason: "V3 SELL" };
            }
          }
        }
      }
    }
  }

  return { direction: "HOLD", reason: "no pattern" };
}

// ── Fetch historical candles ──
async function fetchCandles(instrumentKey, fromDate, toDate, interval = "1minute") {
  // Upstox 1-min API only allows ~3-5 day range per request
  // Paginate in 3-day chunks
  const allCandles = [];
  const startMs = new Date(fromDate).getTime();
  const endMs = new Date(toDate).getTime();
  const chunkMs = 3 * 86400000; // 3 days
  
  let curFrom = startMs;
  while (curFrom < endMs) {
    let curTo = Math.min(curFrom + chunkMs, endMs);
    const from = new Date(curFrom).toISOString().split("T")[0];
    const to = new Date(curTo).toISOString().split("T")[0];
    if (from === to) { curFrom = curTo + 86400000; continue; }
    
    const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${to}/${from}`;
    const resp = await fetch(url, TOKEN);
    if (resp.status === "success" && resp.data?.candles?.length) {
      const chunk = resp.data.candles.map(c => ({
        timestamp: new Date(c[0]).getTime(),
        open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0,
      }));
      allCandles.push(...chunk);
    }
    curFrom = curTo;
    // Rate limit: small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Sort oldest first and deduplicate
  allCandles.sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set();
  return allCandles.filter(c => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
}

// ── Backtest Engine ──
async function runBacktest(instrumentKey, brickSize, label, days = 30) {
  const toDate = new Date().toISOString().split("T")[0];
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${label} — V3 Backtest (${days} days)`);
  console.log(`Brick: ₹${brickSize} | From: ${fromDate} | To: ${toDate}`);
  console.log(`Filters: Time(9:45-3:20) + Sideways(5+chg) + EMA30Cloud + 3brickMin + Max2/day`);
  console.log("=".repeat(60));

  const allCandles = await fetchCandles(instrumentKey, fromDate, toDate);
  if (!allCandles.length) { console.log("ERROR: No candle data received"); return; }
  console.log(`Total candles fetched: ${allCandles.length}`);

  // Group by day
  const dayMap = new Map();
  for (const c of allCandles) {
    const day = new Date(c.timestamp + 5.5 * 3600000).toISOString().split("T")[0];
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push(c);
  }

  const trades = [];
  let totalPnl = 0, wins = 0, losses = 0, targetHits = 0, slHits = 0, renkoExits = 0;
  let maxDrawdown = 0, peakPnl = 0;
  const dailyResults = [];

  for (const [day, dayCandles] of dayMap) {
    let dayTrades = 0;
    let dayPnl = 0;
    const MAX_TRADES_PER_DAY = 2;

    for (let i = 30; i < dayCandles.length; i++) {
      // ── Filter 2: TRADE LIMIT ──
      if (dayTrades >= MAX_TRADES_PER_DAY) break;

      const window = dayCandles.slice(0, i + 1);
      const currentTimestamp = window[window.length - 1].timestamp;
      const signal = generateSignalV3(window, brickSize, currentTimestamp);

      if (signal.direction === "HOLD") continue;

      // Simulate trade
      const entry = signal.entry;
      const sl = signal.sl;
      const target = signal.target;
      let exitPrice = entry;
      let exitReason = "EOD";

      // Walk forward to find exit
      for (let j = i + 1; j < dayCandles.length; j++) {
        const c = dayCandles[j];
        if (signal.direction === "BUY") {
          if (c.low <= sl) { exitPrice = sl; exitReason = "SL"; break; }
          if (c.high >= target) { exitPrice = target; exitReason = "TARGET"; break; }
          // Renko exit: check if a red brick forms
          const subWindow = dayCandles.slice(0, j + 1);
          const bricks = buildRenkoBricks(subWindow, brickSize);
          if (bricks.length > 0 && bricks[bricks.length - 1].color === "red" && bricks[bricks.length - 1].close < entry) {
            exitPrice = c.close; // exitReason = "RENKO_EXIT"; break; // DISABLED
          }
        } else {
          if (c.high >= sl) { exitPrice = sl; exitReason = "SL"; break; }
          if (c.low <= target) { exitPrice = target; exitReason = "TARGET"; break; }
          const subWindow = dayCandles.slice(0, j + 1);
          const bricks = buildRenkoBricks(subWindow, brickSize);
          if (bricks.length > 0 && bricks[bricks.length - 1].color === "green" && bricks[bricks.length - 1].close > entry) {
            exitPrice = c.close; // exitReason = "RENKO_EXIT"; break; // DISABLED
          }
        }
      }

      const pnl = signal.direction === "BUY" ? exitPrice - entry : entry - exitPrice;
      totalPnl += pnl;
      dayPnl += pnl;
      dayTrades++;

      if (pnl > 0) wins++;
      else losses++;
      if (exitReason === "TARGET") targetHits++;
      if (exitReason === "SL") slHits++;
      if (exitReason === "RENKO_EXIT") renkoExits++;

      peakPnl = Math.max(peakPnl, totalPnl);
      maxDrawdown = Math.max(maxDrawdown, peakPnl - totalPnl);

      trades.push({ day, direction: signal.direction, entry, sl, target, exitPrice, pnl: pnl.toFixed(2), exitReason, greenBefore: signal.greenBefore || signal.redBefore });

      // Skip ahead past this trade
      i += 10;
    }

    if (dayTrades > 0) {
      dailyResults.push({ day, trades: dayTrades, pnl: dayPnl.toFixed(2) });
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : "0";

  console.log(`\n── RESULTS ──`);
  console.log(`Total Trades: ${totalTrades} (max 2/day × ${dayMap.size} days)`);
  console.log(`Win Rate: ${winRate}% (${wins}W / ${losses}L)`);
  console.log(`Total P&L: ₹${totalPnl.toFixed(2)}`);
  console.log(`Target Hits: ${targetHits} (${totalTrades > 0 ? (targetHits/totalTrades*100).toFixed(0) : 0}%)`);
  console.log(`SL Hits: ${slHits} (${totalTrades > 0 ? (slHits/totalTrades*100).toFixed(0) : 0}%)`);
  console.log(`Renko Exits: ${renkoExits} (${totalTrades > 0 ? (renkoExits/totalTrades*100).toFixed(0) : 0}%)`);
  console.log(`Max Drawdown: ₹${maxDrawdown.toFixed(2)}`);
  console.log(`Avg P&L/Trade: ₹${totalTrades > 0 ? (totalPnl/totalTrades).toFixed(2) : 0}`);
  console.log(`Trading Days: ${dailyResults.length}/${dayMap.size}`);

  if (trades.length > 0) {
    const maxWin = Math.max(...trades.map(t => parseFloat(t.pnl)));
    const maxLoss = Math.min(...trades.map(t => parseFloat(t.pnl)));
    console.log(`Max Win: ₹${maxWin.toFixed(2)} | Max Loss: ₹${maxLoss.toFixed(2)}`);
  }

  // Show top 5 best and worst days
  if (dailyResults.length > 0) {
    console.log(`\n── Top 5 Best Days ──`);
    dailyResults.sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl));
    dailyResults.slice(0, 5).forEach(d => console.log(`  ${d.day}: ₹${d.pnl} (${d.trades} trades)`));
    console.log(`── Top 5 Worst Days ──`);
    dailyResults.slice(-5).reverse().forEach(d => console.log(`  ${d.day}: ₹${d.pnl} (${d.trades} trades)`));
  }

  return { totalTrades, winRate, totalPnl, maxDrawdown, targetHits, slHits, renkoExits };
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  RED BAR THEORY V3 BACKTEST — WITH QUALITY FILTERS         ║");
  console.log("║  Filters: Time + Sideways + EMA30 Cloud + 3-Brick + 2/Day  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // NIFTY 50 Index (brick = 10)
  await runBacktest("NSE_INDEX|Nifty 50", 10, "NIFTY 50 (Index)", 60);

  // NIFTY BANK Index (brick = 15)
  await runBacktest("NSE_INDEX|Nifty Bank", 15, "NIFTY BANK (Index)", 60);

  // Also run on real option premium data
  console.log("\n\n" + "═".repeat(60));
  console.log("PREMIUM RENKO V3 — Real Option Premium Data");
  console.log("═".repeat(60));

  // Get current NIFTY level to find ATM strike
  const niftyCandles = await fetchCandles("NSE_INDEX|Nifty 50", 
    new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0],
    new Date().toISOString().split("T")[0], "day");
  
  if (niftyCandles.length > 0) {
    const niftyLevel = niftyCandles[niftyCandles.length - 1].close;
    const atmStrike = Math.round(niftyLevel / 50) * 50;
    
    // Find next Thursday expiry
    const today = new Date();
    const daysToThursday = (4 - today.getDay() + 7) % 7 || 7;
    const nextExpiry = new Date(today.getTime() + daysToThursday * 86400000);
    const expiryStr = nextExpiry.toISOString().split("T")[0].replace(/-/g, "").slice(2); // YYMMDD
    
    // Try NIFTY CE option
    const ceKey = `NSE_FO|NIFTY${expiryStr}${atmStrike}CE`;
    console.log(`\nTrying: ${ceKey} (ATM: ${atmStrike}, Expiry: ${nextExpiry.toISOString().split("T")[0]})`);
    await runBacktest(ceKey, 10, `NIFTY ${atmStrike} CE Premium`, 5);
  }
}

main().catch(console.error);
