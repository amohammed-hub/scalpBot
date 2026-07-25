/**
 * Standalone Backtest: Red Bar Theory V2 (Dr. Pratap's Pullback-Breakout)
 * Fetches 3 months of NIFTY 1-min candles from Upstox and runs the strategy.
 * Usage: node backtest-rbt-v2.mjs
 */
import { createConnection } from "mysql2/promise";
import { URL } from "url";

// ── Config ──
const INSTRUMENTS = [
  { token: "NSE_INDEX|Nifty 50", symbol: "NIFTY", brickSize: 10 },
  { token: "NSE_INDEX|Nifty Bank", symbol: "BANKNIFTY", brickSize: 15 },
];
const CAPITAL = 100000;
const RISK_PCT = 1.0;
const MONTHS_BACK = 3;

// ── Renko Brick Builder (same logic as botEngine) ──
function buildRenkoBricks(candles, brickSize) {
  if (candles.length < 2 || brickSize <= 0) return [];
  const bricks = [];
  let basePrice = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const diff = price - basePrice;
    if (diff >= brickSize) {
      const numBricks = Math.floor(diff / brickSize);
      for (let j = 0; j < numBricks; j++) {
        const brickOpen = basePrice + j * brickSize;
        const brickClose = brickOpen + brickSize;
        bricks.push({ open: brickOpen, close: brickClose, high: brickClose, low: brickOpen, color: "green" });
      }
      basePrice = basePrice + numBricks * brickSize;
    } else if (diff <= -brickSize) {
      const numBricks = Math.floor(Math.abs(diff) / brickSize);
      for (let j = 0; j < numBricks; j++) {
        const brickOpen = basePrice - j * brickSize;
        const brickClose = brickOpen - brickSize;
        bricks.push({ open: brickOpen, close: brickClose, high: brickOpen, low: brickClose, color: "red" });
      }
      basePrice = basePrice - numBricks * brickSize;
    }
  }
  return bricks;
}

// ── EMA Calculator ──
function ema(values, period) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

// ── Red Bar Theory V2 Signal Generator ──
function generateRedBarSignal(candles, brickSize) {
  if (candles.length < 30) return { direction: "HOLD" };
  
  const bricks = buildRenkoBricks(candles, brickSize);
  if (bricks.length < 5) return { direction: "HOLD" };
  
  const price = candles[candles.length - 1].close;
  const closes = candles.slice(-30).map(c => c.close);
  const currentEma10 = ema(closes, 10);
  
  // Trend: last 10 bricks majority color
  const last10 = bricks.slice(-10);
  const greenCount = last10.filter(b => b.color === "green").length;
  const redCount = last10.filter(b => b.color === "red").length;
  const isUptrend = greenCount > redCount && price > currentEma10;
  const isDowntrend = redCount > greenCount && price < currentEma10;
  
  // BUY SETUP: Scan backwards for Red→Green breakout in uptrend
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
        let greenBeforePullback = 0;
        for (let i = redIdx - 1; i >= 0 && i >= redIdx - 8; i--) {
          if (bricks[i].color === "green") greenBeforePullback++;
          else break;
        }
        if (greenBeforePullback >= 2) {
          const bricksSinceBreakout = bricks.length - 1 - redIdx;
          if (bricksSinceBreakout <= 3) {
            const slPrice = redBrick.low;
            const risk = price - slPrice;
            if (risk > 0) {
              const targetPrice = price + risk * 2;
              return { direction: "BUY", entryPrice: price, slPrice, targetPrice, confidence: Math.min(0.88, 0.70 + greenBeforePullback * 0.04) };
            }
          }
        }
      }
    }
  }
  
  // SELL SETUP: Scan backwards for Green→Red breakout in downtrend
  if (isDowntrend) {
    let greenIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "green") { greenIdx = i; break; }
    }
    if (greenIdx >= 0 && greenIdx < bricks.length - 1) {
      const greenBrick = bricks[greenIdx];
      let breakoutConfirmed = false;
      for (let ri = greenIdx + 1; ri < bricks.length; ri++) {
        if (bricks[ri].color !== "red") break;
        if (bricks[ri].close <= greenBrick.low) { breakoutConfirmed = true; break; }
      }
      if (breakoutConfirmed) {
        let redBeforePullback = 0;
        for (let i = greenIdx - 1; i >= 0 && i >= greenIdx - 8; i--) {
          if (bricks[i].color === "red") redBeforePullback++;
          else break;
        }
        if (redBeforePullback >= 2) {
          const bricksSinceBreakout = bricks.length - 1 - greenIdx;
          if (bricksSinceBreakout <= 3) {
            const slPrice = greenBrick.high;
            const risk = slPrice - price;
            if (risk > 0) {
              const targetPrice = price - risk * 2;
              return { direction: "SELL", entryPrice: price, slPrice, targetPrice, confidence: Math.min(0.88, 0.70 + redBeforePullback * 0.04) };
            }
          }
        }
      }
    }
  }
  
  return { direction: "HOLD" };
}

// ── Fetch historical candles from Upstox ──
async function fetchCandles(instrumentToken, accessToken, fromDate, toDate) {
  const encoded = encodeURIComponent(instrumentToken);
  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/1minute/${toDate}/${fromDate}`;
  console.log(`  Fetching: ${fromDate} to ${toDate}...`);
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upstox API error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const rawCandles = json.data?.candles ?? [];
  return rawCandles
    .map(c => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ── Simulate trades ──
function simulateTrades(candles, brickSize, capital, riskPct) {
  const WINDOW = 60;
  const trades = [];
  let i = WINDOW;
  
  while (i < candles.length) {
    const window = candles.slice(i - WINDOW, i);
    const sig = generateRedBarSignal(window, brickSize);
    
    if (sig.direction !== "HOLD") {
      const entryCandle = candles[i];
      if (!entryCandle) { i++; continue; }
      const entryPrice = entryCandle.open;
      const risk = Math.abs(entryPrice - sig.slPrice);
      if (risk <= 0) { i++; continue; }
      const qty = Math.max(1, Math.floor((capital * riskPct / 100) / risk));
      
      let exitPrice = entryPrice;
      let exitTime = entryCandle.timestamp;
      let result = "BE";
      
      // Walk forward max 120 candles to find SL/TP
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
      
      const pnl = sig.direction === "BUY"
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;
      
      trades.push({
        entryTime: new Date(entryCandle.timestamp).toISOString(),
        exitTime: new Date(exitTime).toISOString(),
        direction: sig.direction,
        entryPrice: Math.round(entryPrice * 100) / 100,
        slPrice: Math.round(sig.slPrice * 100) / 100,
        targetPrice: Math.round(sig.targetPrice * 100) / 100,
        exitPrice: Math.round(exitPrice * 100) / 100,
        qty,
        pnl: Math.round(pnl * 100) / 100,
        result,
      });
      
      // Skip to after exit
      const exitIdx = candles.findIndex(c => c.timestamp >= exitTime);
      i = exitIdx > i ? exitIdx + 1 : i + 1;
    } else {
      i++;
    }
  }
  return trades;
}

// ── Main ──
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  RED BAR THEORY V2 BACKTEST — Dr. Devendra Pratap's Rules");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  // Upstox historical candle API works without auth for index data
  const accessToken = "";
  console.log("✓ Using public Upstox historical API (no auth needed for index data)\n");
  
  // Date range: last 3 months
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - MONTHS_BACK);
  const toStr = toDate.toISOString().split("T")[0];
  const fromStr = fromDate.toISOString().split("T")[0];
  
  console.log(`Date Range: ${fromStr} → ${toStr} (${MONTHS_BACK} months)`);
  console.log(`Capital: ₹${CAPITAL.toLocaleString()} | Risk: ${RISK_PCT}% per trade\n`);
  
  for (const inst of INSTRUMENTS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${inst.symbol} (Brick Size: ${inst.brickSize})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    try {
      // Fetch candles in weekly chunks (Upstox limits per request)
      let allCandles = [];
      const chunkDays = 5; // 5 trading days per chunk
      let current = new Date(fromDate);
      
      while (current < toDate) {
        const chunkEnd = new Date(current);
        chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
        if (chunkEnd > toDate) chunkEnd.setTime(toDate.getTime());
        
        const f = current.toISOString().split("T")[0];
        const t = chunkEnd.toISOString().split("T")[0];
        
        try {
          const candles = await fetchCandles(inst.token, accessToken, f, t);
          allCandles = allCandles.concat(candles);
        } catch (e) {
          // Skip weekends/holidays that return no data
          if (!e.message.includes("Not enough")) {
            console.log(`  ⚠ Chunk ${f}→${t}: ${e.message.slice(0, 80)}`);
          }
        }
        
        current.setDate(current.getDate() + chunkDays + 1);
        // Rate limit: 250ms between requests
        await new Promise(r => setTimeout(r, 250));
      }
      
      // Deduplicate by timestamp
      const seen = new Set();
      allCandles = allCandles.filter(c => {
        if (seen.has(c.timestamp)) return false;
        seen.add(c.timestamp);
        return true;
      }).sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`\n  Total candles: ${allCandles.toLocaleString()}`);
      
      if (allCandles.length < 100) {
        console.log("  ⚠ Not enough data for meaningful backtest. Skipping.");
        continue;
      }
      
      // Run backtest
      const trades = simulateTrades(allCandles, inst.brickSize, CAPITAL, RISK_PCT);
      
      // Calculate stats
      const wins = trades.filter(t => t.result === "WIN").length;
      const losses = trades.filter(t => t.result === "LOSS").length;
      const be = trades.filter(t => t.result === "BE").length;
      const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
      const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : "0";
      const avgWin = wins > 0 ? trades.filter(t => t.result === "WIN").reduce((a, t) => a + t.pnl, 0) / wins : 0;
      const avgLoss = losses > 0 ? trades.filter(t => t.result === "LOSS").reduce((a, t) => a + t.pnl, 0) / losses : 0;
      const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins / (avgLoss * losses)) : 0;
      
      // Max drawdown
      let maxDrawdown = 0, peak = CAPITAL, equity = CAPITAL;
      for (const t of trades) {
        equity += t.pnl;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
      
      // Sharpe-like ratio (daily returns)
      const dailyPnl = {};
      for (const t of trades) {
        const day = t.entryTime.split("T")[0];
        dailyPnl[day] = (dailyPnl[day] || 0) + t.pnl;
      }
      const dailyReturns = Object.values(dailyPnl);
      const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
      const stdDev = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)) : 1;
      const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
      
      console.log(`\n  ┌─────────────────────────────────────────────────┐`);
      console.log(`  │  RESULTS: ${inst.symbol} Red Bar Theory V2          │`);
      console.log(`  ├─────────────────────────────────────────────────┤`);
      console.log(`  │  Total Trades:    ${String(trades.length).padStart(6)}                      │`);
      console.log(`  │  Wins:            ${String(wins).padStart(6)} (${winRate}%)                │`);
      console.log(`  │  Losses:          ${String(losses).padStart(6)}                      │`);
      console.log(`  │  Break-even:      ${String(be).padStart(6)}                      │`);
      console.log(`  │  Total P&L:     ₹${totalPnl.toFixed(0).padStart(8)}                  │`);
      console.log(`  │  Avg Win:       ₹${avgWin.toFixed(0).padStart(8)}                  │`);
      console.log(`  │  Avg Loss:      ₹${avgLoss.toFixed(0).padStart(8)}                  │`);
      console.log(`  │  Profit Factor:   ${profitFactor.toFixed(2).padStart(6)}                      │`);
      console.log(`  │  Max Drawdown:  ₹${maxDrawdown.toFixed(0).padStart(8)}                  │`);
      console.log(`  │  Sharpe Ratio:    ${sharpe.toFixed(2).padStart(6)}                      │`);
      console.log(`  │  Trading Days:    ${String(Object.keys(dailyPnl).length).padStart(6)}                      │`);
      console.log(`  └─────────────────────────────────────────────────┘`);
      
      // Show first 10 trades
      if (trades.length > 0) {
        console.log(`\n  Sample Trades (first 10):`);
        console.log(`  ${"Date".padEnd(12)} ${"Dir".padEnd(5)} ${"Entry".padStart(8)} ${"SL".padStart(8)} ${"TP".padStart(8)} ${"Exit".padStart(8)} ${"P&L".padStart(8)} Result`);
        console.log(`  ${"─".repeat(75)}`);
        for (const t of trades.slice(0, 10)) {
          const date = t.entryTime.split("T")[0].slice(5);
          console.log(`  ${date.padEnd(12)} ${t.direction.padEnd(5)} ${t.entryPrice.toFixed(1).padStart(8)} ${t.slPrice.toFixed(1).padStart(8)} ${t.targetPrice.toFixed(1).padStart(8)} ${t.exitPrice.toFixed(1).padStart(8)} ${("₹" + t.pnl.toFixed(0)).padStart(8)} ${t.result}`);
        }
      }
      
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Backtest Complete");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exit(1); });
