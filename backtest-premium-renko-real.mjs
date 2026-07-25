/**
 * PremiumRenko Backtest — REAL OPTION PREMIUM DATA
 * ═══════════════════════════════════════════════════════════════
 * Uses Upstox Analytics Token to fetch actual 1-min option premium candles
 * and applies Red Bar Theory (Lesson 7) on them.
 *
 * Strategy:
 *   - Brick sizes: NIFTY=10, BANKNIFTY=15
 *   - BUY: Premium uptrend → red pullback → green breakout above red HIGH
 *   - SELL: Premium downtrend → green pullback → red breakdown below green LOW
 *   - Exit: 1:2 R:R target OR SL below red LOW OR first opposite brick
 *
 * Data: Real 1-min option premium candles from Upstox Historical API
 * Period: Last 30 trading days (API limit for intraday data)
 *
 * Usage: node backtest-premium-renko-real.mjs
 */

import axios from "axios";

const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIzWENXTEMiLCJqdGkiOiI2YTY1NDczNGFhOTQxMTE3NTk3OGRhZjQiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzg1MDIyMjYwLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTY2MzkyMDB9.tNxI93mR4H7Knn6hRloRMDjfGVrHGqgEkyoMhp_9oG0";

const CONFIG = {
  instruments: [
    { name: "NIFTY", indexKey: "NSE_INDEX|Nifty 50", brickSize: 10 },
    { name: "BANKNIFTY", indexKey: "NSE_INDEX|Nifty Bank", brickSize: 15 },
  ],
  riskRewardRatio: 2,
  daysBack: 30, // Upstox allows ~30 days of intraday historical
};

const HEADERS = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };

// ═══════════════════════════════════════════════════════════════════════════════
// RENKO BRICK BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
function buildRenkoBricks(candles, brickSize) {
  if (!candles || candles.length < 2 || brickSize <= 0) return [];
  const bricks = [];
  let basePrice = candles[0].close;

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const diff = price - basePrice;
    if (Math.abs(diff) >= brickSize) {
      const numBricks = Math.floor(Math.abs(diff) / brickSize);
      const direction = diff > 0 ? 1 : -1;
      for (let b = 0; b < numBricks; b++) {
        const open = basePrice;
        const close = basePrice + direction * brickSize;
        bricks.push({
          open, close,
          high: Math.max(open, close),
          low: Math.min(open, close),
          color: direction > 0 ? "green" : "red",
          timestamp: candles[i].timestamp,
        });
        basePrice = close;
      }
    }
  }
  return bricks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMA
// ═══════════════════════════════════════════════════════════════════════════════
function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREMIUM RENKO SIGNAL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════
function generatePremiumRenkoSignal(premiumCandles, brickSize) {
  if (!premiumCandles || premiumCandles.length < 20) return null;
  const premium = premiumCandles[premiumCandles.length - 1].close;
  if (premium <= 0) return null;

  const bricks = buildRenkoBricks(premiumCandles, brickSize);
  if (bricks.length < 5) return null;

  const brickCloses = bricks.map(b => b.close);
  const ema10arr = ema(brickCloses, 10);
  if (ema10arr.length === 0) return null;
  const currentEma10 = ema10arr[ema10arr.length - 1];

  const isPremiumUptrend = premium > currentEma10;
  const isPremiumDowntrend = premium < currentEma10;

  // BUY SETUP
  if (isPremiumUptrend) {
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
            const risk = premium - slPrice;
            if (risk > 0 && risk < premium * 0.5) {
              const targetPrice = premium + risk * CONFIG.riskRewardRatio;
              return { direction: "BUY", entry: premium, sl: slPrice, target: targetPrice, risk };
            }
          }
        }
      }
    }
  }

  // SELL SETUP
  if (isPremiumDowntrend) {
    let greenIdx = -1;
    for (let i = bricks.length - 1; i >= Math.max(0, bricks.length - 6); i--) {
      if (bricks[i].color === "green") { greenIdx = i; break; }
    }
    if (greenIdx >= 0 && greenIdx < bricks.length - 1) {
      const greenBrick = bricks[greenIdx];
      let breakoutConfirmedSell = false;
      for (let ri = greenIdx + 1; ri < bricks.length; ri++) {
        if (bricks[ri].color !== "red") break;
        if (bricks[ri].close <= greenBrick.low) { breakoutConfirmedSell = true; break; }
      }
      if (breakoutConfirmedSell) {
        let redBeforePullback = 0;
        for (let i = greenIdx - 1; i >= 0 && i >= greenIdx - 8; i--) {
          if (bricks[i].color === "red") redBeforePullback++;
          else break;
        }
        if (redBeforePullback >= 2) {
          const bricksSinceBreakout = bricks.length - 1 - greenIdx;
          if (bricksSinceBreakout <= 3) {
            const slPrice = greenBrick.high;
            const risk = slPrice - premium;
            if (risk > 0 && risk < premium * 0.5) {
              const targetPrice = Math.max(0, premium - risk * CONFIG.riskRewardRatio);
              return { direction: "SELL", entry: premium, sl: slPrice, target: targetPrice, risk };
            }
          }
        }
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getOptionContracts(indexKey) {
  const url = `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(indexKey)}`;
  const resp = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return resp.data?.data ?? [];
}

async function getIndexPrice(indexKey) {
  // Get latest daily candle to determine current price
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().split("T")[0];
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(indexKey)}/day/${today}/${yesterday}`;
  const resp = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const candles = resp.data?.data?.candles ?? [];
  if (candles.length > 0) return candles[0][4]; // latest close
  return null;
}

async function fetch1MinCandles(instrumentKey, fromDate, toDate) {
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrumentKey)}/1minute/${toDate}/${fromDate}`;
  try {
    const resp = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    })).reverse(); // ascending order
  } catch (e) {
    if (e.response?.status === 429) {
      console.log("      Rate limited, waiting 2s...");
      await sleep(2000);
      return fetch1MinCandles(instrumentKey, fromDate, toDate);
    }
    return [];
  }
}

function getTradingDays(daysBack) {
  const days = [];
  let d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.length < daysBack) {
    d = new Date(d.getTime() - 24 * 3600 * 1000);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) { // skip weekends
      days.push(d.toISOString().split("T")[0]);
    }
  }
  return days.reverse();
}

function findATMOption(contracts, spotPrice, optionType, expiryDate) {
  // Find the closest strike to spot price for the given expiry
  const filtered = contracts.filter(c =>
    c.instrument_type === optionType &&
    c.expiry === expiryDate
  );
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => Math.abs(a.strike_price - spotPrice) - Math.abs(b.strike_price - spotPrice));
  return filtered[0];
}

function findNearestExpiry(contracts, targetDate) {
  // Find the nearest weekly/monthly expiry on or after targetDate
  const expiries = [...new Set(contracts.map(c => c.expiry))].sort();
  return expiries.find(e => e >= targetDate) || expiries[expiries.length - 1];
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
function backtestDay(premiumCandles, brickSize) {
  const trades = [];
  let openTrade = null;
  const LOOKBACK = 60;

  for (let i = LOOKBACK; i < premiumCandles.length; i++) {
    const windowCandles = premiumCandles.slice(Math.max(0, i - 200), i + 1);
    const currentPrice = premiumCandles[i].close;

    if (openTrade) {
      if (openTrade.direction === "BUY") {
        if (currentPrice <= openTrade.sl) {
          trades.push({ ...openTrade, exit: openTrade.sl, pnl: openTrade.sl - openTrade.entry, exitReason: "SL", exitIdx: i });
          openTrade = null;
        } else if (currentPrice >= openTrade.target) {
          trades.push({ ...openTrade, exit: openTrade.target, pnl: openTrade.target - openTrade.entry, exitReason: "TARGET", exitIdx: i });
          openTrade = null;
        } else {
          const entryCandles = premiumCandles.slice(openTrade.entryIdx, i + 1);
          const bricks = buildRenkoBricks(entryCandles, brickSize);
          if (bricks.length >= 2 && bricks[bricks.length - 1]?.color === "red") {
            trades.push({ ...openTrade, exit: currentPrice, pnl: currentPrice - openTrade.entry, exitReason: "RENKO_EXIT", exitIdx: i });
            openTrade = null;
          }
        }
      } else {
        if (currentPrice >= openTrade.sl) {
          trades.push({ ...openTrade, exit: openTrade.sl, pnl: openTrade.entry - openTrade.sl, exitReason: "SL", exitIdx: i });
          openTrade = null;
        } else if (currentPrice <= openTrade.target) {
          trades.push({ ...openTrade, exit: openTrade.target, pnl: openTrade.entry - openTrade.target, exitReason: "TARGET", exitIdx: i });
          openTrade = null;
        } else {
          const entryCandles = premiumCandles.slice(openTrade.entryIdx, i + 1);
          const bricks = buildRenkoBricks(entryCandles, brickSize);
          if (bricks.length >= 2 && bricks[bricks.length - 1]?.color === "green") {
            trades.push({ ...openTrade, exit: currentPrice, pnl: openTrade.entry - currentPrice, exitReason: "RENKO_EXIT", exitIdx: i });
            openTrade = null;
          }
        }
      }
      continue;
    }

    const signal = generatePremiumRenkoSignal(windowCandles, brickSize);
    if (signal) {
      openTrade = { ...signal, entryIdx: i, timestamp: premiumCandles[i].timestamp };
    }
  }

  // Close open trade at EOD
  if (openTrade) {
    const lastPrice = premiumCandles[premiumCandles.length - 1].close;
    const pnl = openTrade.direction === "BUY" ? lastPrice - openTrade.entry : openTrade.entry - lastPrice;
    trades.push({ ...openTrade, exit: lastPrice, pnl, exitReason: "EOD", exitIdx: premiumCandles.length - 1 });
  }

  return trades;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  PremiumRenko Backtest — REAL OPTION PREMIUM DATA");
  console.log("  Red Bar Theory on Option Premium Charts (Lesson 7)");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const tradingDays = getTradingDays(CONFIG.daysBack);
  console.log(`  Period: ${tradingDays[0]} to ${tradingDays[tradingDays.length - 1]} (${tradingDays.length} days)\n`);

  const allResults = [];

  for (const inst of CONFIG.instruments) {
    console.log(`\n── ${inst.name} (brick: ₹${inst.brickSize}) ──`);

    // Get current spot price
    const spotPrice = await getIndexPrice(inst.indexKey);
    console.log(`   Current spot: ${spotPrice}`);

    // Get all option contracts
    console.log("   Fetching option contracts...");
    const contracts = await getOptionContracts(inst.indexKey);
    console.log(`   Got ${contracts.length} contracts`);

    let totalTrades = 0, totalPnl = 0, wins = 0, losses = 0;
    let targetHits = 0, slHits = 0, renkoExits = 0, eodExits = 0;
    let maxWin = 0, maxLoss = 0;
    const dailyPnls = [];
    const allTrades = [];
    let daysProcessed = 0;

    for (let di = 0; di < tradingDays.length; di++) {
      const day = tradingDays[di];
      const nextDay = di < tradingDays.length - 1 ? tradingDays[di + 1] : new Date().toISOString().split("T")[0];

      // Find nearest expiry for this day
      const expiry = findNearestExpiry(contracts, day);
      if (!expiry) continue;

      // Find ATM CE option for this day
      const atmCE = findATMOption(contracts, spotPrice, "CE", expiry);
      if (!atmCE) continue;

      // Fetch 1-min candles for this option on this day
      const candles = await fetch1MinCandles(atmCE.instrument_key, day, nextDay);
      await sleep(350); // Rate limit: ~3 req/sec

      if (candles.length < 60) {
        process.stdout.write(".");
        continue;
      }

      daysProcessed++;
      const trades = backtestDay(candles, inst.brickSize);

      let dayPnl = 0;
      for (const t of trades) {
        totalTrades++;
        dayPnl += t.pnl;
        totalPnl += t.pnl;
        if (t.pnl >= 0) { wins++; maxWin = Math.max(maxWin, t.pnl); }
        else { losses++; maxLoss = Math.min(maxLoss, t.pnl); }
        if (t.exitReason === "TARGET") targetHits++;
        else if (t.exitReason === "SL") slHits++;
        else if (t.exitReason === "RENKO_EXIT") renkoExits++;
        else if (t.exitReason === "EOD") eodExits++;
        allTrades.push({ ...t, day, option: atmCE.trading_symbol });
      }
      dailyPnls.push({ day, pnl: dayPnl, trades: trades.length, option: atmCE.trading_symbol });

      if (trades.length > 0) {
        process.stdout.write(`✓`);
      } else {
        process.stdout.write(`○`);
      }
    }

    console.log(""); // newline after progress dots

    const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : "0.0";
    const avgTradesPerDay = daysProcessed > 0 ? (totalTrades / daysProcessed).toFixed(1) : "0";
    const profitDays = dailyPnls.filter(p => p.pnl > 0).length;
    const lossDays = dailyPnls.filter(p => p.pnl < 0).length;

    // Drawdown
    let peak = 0, maxDrawdown = 0, equity = 0;
    for (const dp of dailyPnls) {
      equity += dp.pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const result = {
      instrument: inst.name, brickSize: inst.brickSize,
      daysProcessed, totalTrades, wins, losses,
      winRate: parseFloat(winRate), totalPnl,
      avgTradesPerDay: parseFloat(avgTradesPerDay),
      targetHits, slHits, renkoExits, eodExits,
      maxWin, maxLoss, maxDrawdown, profitDays, lossDays,
    };
    allResults.push(result);

    console.log(`\n   ┌─────────────────────────────────────────────────────────┐`);
    console.log(`   │  ${inst.name} PremiumRenko — REAL DATA (${daysProcessed} days)          │`);
    console.log(`   ├─────────────────────────────────────────────────────────┤`);
    console.log(`   │  Total Trades:     ${String(totalTrades).padStart(6)}                          │`);
    console.log(`   │  Win Rate:         ${winRate.padStart(6)}%                         │`);
    console.log(`   │  Total P&L:       ₹${totalPnl.toFixed(2).padStart(9)}                       │`);
    console.log(`   │  Avg Trades/Day:   ${avgTradesPerDay.padStart(6)}                          │`);
    console.log(`   │  Max Win:         ₹${maxWin.toFixed(2).padStart(9)}                       │`);
    console.log(`   │  Max Loss:        ₹${maxLoss.toFixed(2).padStart(9)}                       │`);
    console.log(`   │  Max Drawdown:    ₹${maxDrawdown.toFixed(2).padStart(9)}                       │`);
    console.log(`   │  Profit Days:      ${String(profitDays).padStart(3)} / ${daysProcessed}                          │`);
    console.log(`   ├─────────────────────────────────────────────────────────┤`);
    console.log(`   │  Exit Breakdown:                                        │`);
    console.log(`   │    Target (1:2):   ${String(targetHits).padStart(4)} (${(targetHits/Math.max(1,totalTrades)*100).toFixed(0)}%)                         │`);
    console.log(`   │    Stop Loss:      ${String(slHits).padStart(4)} (${(slHits/Math.max(1,totalTrades)*100).toFixed(0)}%)                         │`);
    console.log(`   │    Renko Exit:     ${String(renkoExits).padStart(4)} (${(renkoExits/Math.max(1,totalTrades)*100).toFixed(0)}%)                         │`);
    console.log(`   │    EOD Close:      ${String(eodExits).padStart(4)} (${(eodExits/Math.max(1,totalTrades)*100).toFixed(0)}%)                         │`);
    console.log(`   └─────────────────────────────────────────────────────────┘`);

    // Print daily breakdown
    console.log(`\n   Daily P&L Breakdown:`);
    for (const dp of dailyPnls) {
      if (dp.trades > 0) {
        const emoji = dp.pnl >= 0 ? "🟢" : "🔴";
        console.log(`     ${dp.day} | ${emoji} ₹${dp.pnl.toFixed(2).padStart(8)} | ${dp.trades} trades | ${dp.option}`);
      }
    }
  }

  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("  FINAL SUMMARY — REAL OPTION PREMIUM DATA");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const r of allResults) {
    console.log(`  ${r.instrument}: ${r.totalTrades} trades | Win: ${r.winRate}% | P&L: ₹${r.totalPnl.toFixed(2)} | MaxDD: ₹${r.maxDrawdown.toFixed(2)}`);
  }
  console.log("\n  This uses REAL 1-min option premium candles from Upstox.");
  console.log("  Each day uses the ATM CE option for the nearest weekly expiry.");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
