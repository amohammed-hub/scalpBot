/**
 * PremiumRenko Backtest — Lesson 7 (Dr. Devendra Pratap Singh)
 * ═══════════════════════════════════════════════════════════════
 * Applies Red Bar Theory on OPTION PREMIUM candles.
 *
 * Since option premium historical data requires authentication,
 * this backtest uses a SYNTHETIC PREMIUM MODEL:
 *   - Fetches real NIFTY/BANKNIFTY 1-min index candles (public API, no auth needed)
 *   - Derives ATM option premium using Black-Scholes delta approximation:
 *     • ATM CE premium ≈ base_premium + delta × (spot_change)
 *     • Delta for ATM ≈ 0.5, with time decay and vol adjustments
 *   - This gives realistic premium movement patterns for strategy validation
 *
 * Brick sizes per Lesson 7: NIFTY=10, BANKNIFTY=15
 * Entry: Premium uptrend → red pullback → green above red HIGH
 * Exit: First opposite-color brick OR 1:2 R:R target OR SL below red LOW
 *
 * Usage: node backtest-premium-renko.mjs
 */

import axios from "axios";

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
  instruments: [
    { name: "NIFTY", token: "NSE_INDEX|Nifty 50", brickSize: 10, basePremium: 120 },
    { name: "BANKNIFTY", token: "NSE_INDEX|Nifty Bank", brickSize: 15, basePremium: 200 },
  ],
  // Fetch last N days of intraday data (Upstox public API gives today only for intraday)
  // We'll use historical daily + simulate intraday from daily moves
  daysBack: 90,
  riskRewardRatio: 2, // 1:2 R:R
  delta: 0.50, // ATM option delta
  theta: -0.05, // daily time decay as % of premium
  vega: 0.02, // vol sensitivity
};

// ═══════════════════════════════════════════════════════════════════════════════
// RENKO BRICK BUILDER (same logic as botEngine.ts)
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
          open,
          close,
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
// EMA CALCULATOR
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
// PREMIUM RENKO SIGNAL GENERATOR (mirrors botEngine.ts generatePremiumRenkoSignal)
// ═══════════════════════════════════════════════════════════════════════════════
function generatePremiumRenkoSignal(premiumCandles, brickSize) {
  if (!premiumCandles || premiumCandles.length < 20) return null;

  const premium = premiumCandles[premiumCandles.length - 1].close;
  if (premium <= 0) return null;

  const bricks = buildRenkoBricks(premiumCandles, brickSize);
  if (bricks.length < 5) return null;

  // EMA 10 on brick close prices
  const brickCloses = bricks.map(b => b.close);
  const ema10arr = ema(brickCloses, 10);
  if (ema10arr.length === 0) return null;
  const currentEma10 = ema10arr[ema10arr.length - 1];

  const isPremiumUptrend = premium > currentEma10;
  const isPremiumDowntrend = premium < currentEma10;

  // BUY SETUP: Premium uptrend → pullback → breakout
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
              return { direction: "BUY", entry: premium, sl: slPrice, target: targetPrice, risk, bricks: bricks.length };
            }
          }
        }
      }
    }
  }

  // SELL SETUP: Premium downtrend → pullback → breakdown
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
              return { direction: "SELL", entry: premium, sl: slPrice, target: targetPrice, risk, bricks: bricks.length };
            }
          }
        }
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHETIC PREMIUM GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════
// Converts index 1-min candles into synthetic ATM option premium candles
// using simplified Black-Scholes delta model
function derivePremiumCandles(indexCandles, basePremium, delta = 0.5) {
  if (indexCandles.length < 2) return [];
  const premiumCandles = [];
  let currentPremium = basePremium;

  for (let i = 0; i < indexCandles.length; i++) {
    const c = indexCandles[i];
    // Premium change = delta × index change (from previous candle)
    if (i > 0) {
      const indexChange = c.close - indexCandles[i - 1].close;
      // For NIFTY: 1 point index move ≈ 0.5 point premium move (ATM delta)
      // But option premium is more volatile relative to its own price
      // Scale: if index moves 10 pts and premium is 120, that's ~5 pts on premium (4.2%)
      const premiumChange = delta * indexChange;
      // Gamma effect: premium accelerates when moving ITM
      const gamma = 0.003 * Math.abs(indexChange);
      currentPremium += premiumChange + gamma * Math.abs(indexChange) * Math.sign(indexChange);
      // Time decay: small negative drift per candle (375 candles per day)
      currentPremium -= basePremium * 0.00005; // ~1.9% daily decay spread across candles
    }
    // Floor at 5 (option can't go below intrinsic + small time value)
    currentPremium = Math.max(5, currentPremium);

    // Derive OHLC for premium candle
    const openPremium = currentPremium;
    const highDelta = Math.abs(c.high - c.close) * delta * 1.2;
    const lowDelta = Math.abs(c.close - c.low) * delta * 1.2;
    premiumCandles.push({
      timestamp: c.timestamp,
      open: openPremium,
      high: currentPremium + highDelta,
      low: Math.max(2, currentPremium - lowDelta),
      close: currentPremium,
      volume: c.volume,
    });
  }
  return premiumCandles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH HISTORICAL DATA FROM UPSTOX (public API — no auth needed for index)
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchDailyCandles(token, daysBack) {
  const toDate = new Date().toISOString().split("T")[0];
  const fromDate = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().split("T")[0];
  const encoded = encodeURIComponent(token);
  const url = `https://api.upstox.com/v2/historical-candle/${encoded}/day/${toDate}/${fromDate}`;
  try {
    const resp = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 10000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    })).reverse(); // ascending order
  } catch (e) {
    console.error(`Failed to fetch daily candles for ${token}:`, e.message);
    return [];
  }
}

async function fetchIntradayCandles(token) {
  const encoded = encodeURIComponent(token);
  const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
  try {
    const resp = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 10000 });
    const candles = resp.data?.data?.candles ?? [];
    return candles.map(c => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    })).reverse();
  } catch (e) {
    console.error(`Failed to fetch intraday candles for ${token}:`, e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATE INTRADAY FROM DAILY CANDLES
// ═══════════════════════════════════════════════════════════════════════════════
// Since we can't get historical intraday without auth, we simulate 1-min candles
// from daily OHLC using a random walk that respects the day's range.
function simulateIntradayFromDaily(dailyCandle, numCandles = 375) {
  const { open, high, low, close, timestamp } = dailyCandle;
  const range = high - low;
  const candles = [];
  let price = open;
  const drift = (close - open) / numCandles;

  for (let i = 0; i < numCandles; i++) {
    // Random walk with drift toward close
    const noise = (Math.random() - 0.5) * range * 0.04;
    const meanRevert = (close - price) * 0.003; // gentle pull toward close
    price += drift + noise + meanRevert;
    // Clamp within day's range
    price = Math.max(low, Math.min(high, price));

    const candleOpen = price;
    const candleNoise = (Math.random() - 0.5) * range * 0.025;
    const candleClose = Math.max(low, Math.min(high, price + candleNoise));
    const candleHigh = Math.max(candleOpen, candleClose) + Math.random() * range * 0.012;
    const candleLow = Math.min(candleOpen, candleClose) - Math.random() * range * 0.012;

    candles.push({
      timestamp: timestamp + i * 60000,
      open: candleOpen,
      high: Math.min(high, candleHigh),
      low: Math.max(low, candleLow),
      close: candleClose,
      volume: Math.floor(Math.random() * 50000 + 10000),
    });
    price = candleClose;
  }
  // Force last candle to close at day's close
  if (candles.length > 0) candles[candles.length - 1].close = close;
  return candles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
function backtestDay(premiumCandles, brickSize, instrumentName) {
  const trades = [];
  let openTrade = null;
  const LOOKBACK = 60; // need at least 60 candles before first signal

  for (let i = LOOKBACK; i < premiumCandles.length; i++) {
    const windowCandles = premiumCandles.slice(Math.max(0, i - 200), i + 1);
    const currentPrice = premiumCandles[i].close;

    // Check open trade for exit
    if (openTrade) {
      if (openTrade.direction === "BUY") {
        if (currentPrice <= openTrade.sl) {
          // SL hit
          const pnl = openTrade.sl - openTrade.entry;
          trades.push({ ...openTrade, exit: openTrade.sl, pnl, exitReason: "SL", exitIdx: i });
          openTrade = null;
        } else if (currentPrice >= openTrade.target) {
          // Target hit
          const pnl = openTrade.target - openTrade.entry;
          trades.push({ ...openTrade, exit: openTrade.target, pnl, exitReason: "TARGET", exitIdx: i });
          openTrade = null;
        }
        // Also check Renko exit (first red brick after entry)
        else {
          const entryCandles = premiumCandles.slice(openTrade.entryIdx, i + 1);
          const bricks = buildRenkoBricks(entryCandles, brickSize);
          const lastBrick = bricks[bricks.length - 1];
          if (bricks.length >= 2 && lastBrick && lastBrick.color === "red") {
            const pnl = currentPrice - openTrade.entry;
            trades.push({ ...openTrade, exit: currentPrice, pnl, exitReason: "RENKO_EXIT", exitIdx: i });
            openTrade = null;
          }
        }
      } else if (openTrade.direction === "SELL") {
        if (currentPrice >= openTrade.sl) {
          const pnl = openTrade.entry - openTrade.sl;
          trades.push({ ...openTrade, exit: openTrade.sl, pnl, exitReason: "SL", exitIdx: i });
          openTrade = null;
        } else if (currentPrice <= openTrade.target) {
          const pnl = openTrade.entry - openTrade.target;
          trades.push({ ...openTrade, exit: openTrade.target, pnl, exitReason: "TARGET", exitIdx: i });
          openTrade = null;
        } else {
          const entryCandles = premiumCandles.slice(openTrade.entryIdx, i + 1);
          const bricks = buildRenkoBricks(entryCandles, brickSize);
          const lastBrick = bricks[bricks.length - 1];
          if (bricks.length >= 2 && lastBrick && lastBrick.color === "green") {
            const pnl = openTrade.entry - currentPrice;
            trades.push({ ...openTrade, exit: currentPrice, pnl, exitReason: "RENKO_EXIT", exitIdx: i });
            openTrade = null;
          }
        }
      }
      continue; // Don't look for new signals while in a trade
    }

    // Look for new signal
    const signal = generatePremiumRenkoSignal(windowCandles, brickSize);
    if (signal) {
      openTrade = {
        direction: signal.direction,
        entry: signal.entry,
        sl: signal.sl,
        target: signal.target,
        risk: signal.risk,
        entryIdx: i,
        timestamp: premiumCandles[i].timestamp,
      };
    }
  }

  // Close any open trade at end of day
  if (openTrade) {
    const lastPrice = premiumCandles[premiumCandles.length - 1].close;
    const pnl = openTrade.direction === "BUY"
      ? lastPrice - openTrade.entry
      : openTrade.entry - lastPrice;
    trades.push({ ...openTrade, exit: lastPrice, pnl, exitReason: "EOD", exitIdx: premiumCandles.length - 1 });
  }

  return trades;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  PremiumRenko Backtest — Lesson 7 (Dr. Devendra Pratap Singh)");
  console.log("  Red Bar Theory on Option Premium Charts");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const allResults = [];

  for (const inst of CONFIG.instruments) {
    console.log(`\n── ${inst.name} (brick: ₹${inst.brickSize}, base premium: ₹${inst.basePremium}) ──`);
    console.log(`   Fetching ${CONFIG.daysBack} days of daily candles...`);

    const dailyCandles = await fetchDailyCandles(inst.token, CONFIG.daysBack);
    if (dailyCandles.length === 0) {
      console.log(`   ⚠ No data available for ${inst.name}. Skipping.`);
      continue;
    }
    console.log(`   Got ${dailyCandles.length} daily candles (${new Date(dailyCandles[0].timestamp).toISOString().slice(0,10)} to ${new Date(dailyCandles[dailyCandles.length-1].timestamp).toISOString().slice(0,10)})`);

    let totalTrades = 0;
    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    let targetHits = 0;
    let slHits = 0;
    let renkoExits = 0;
    let eodExits = 0;
    let maxWin = 0;
    let maxLoss = 0;
    let totalRisk = 0;
    const dailyPnls = [];

    for (const day of dailyCandles) {
      // Simulate intraday candles from daily OHLC
      const intradayCandles = simulateIntradayFromDaily(day, 375);

      // Derive premium candles from index movement
      const premiumCandles = derivePremiumCandles(intradayCandles, inst.basePremium, CONFIG.delta);

      // Run backtest on this day
      const trades = backtestDay(premiumCandles, inst.brickSize, inst.name);

      let dayPnl = 0;
      for (const t of trades) {
        totalTrades++;
        dayPnl += t.pnl;
        totalPnl += t.pnl;
        totalRisk += t.risk;
        if (t.pnl >= 0) { wins++; maxWin = Math.max(maxWin, t.pnl); }
        else { losses++; maxLoss = Math.min(maxLoss, t.pnl); }
        if (t.exitReason === "TARGET") targetHits++;
        else if (t.exitReason === "SL") slHits++;
        else if (t.exitReason === "RENKO_EXIT") renkoExits++;
        else if (t.exitReason === "EOD") eodExits++;
      }
      dailyPnls.push(dayPnl);
    }

    const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : "0.0";
    const avgWin = wins > 0 ? (totalPnl > 0 ? totalPnl / wins : 0).toFixed(2) : "0";
    const avgLoss = losses > 0 ? (Math.abs(totalPnl < 0 ? totalPnl : 0) / losses).toFixed(2) : "0";
    const profitFactor = losses > 0 && slHits > 0
      ? (wins * Math.abs(maxWin) / (losses * Math.abs(maxLoss))).toFixed(2)
      : "∞";
    const avgTradesPerDay = (totalTrades / dailyCandles.length).toFixed(1);
    const profitDays = dailyPnls.filter(p => p > 0).length;
    const lossDays = dailyPnls.filter(p => p < 0).length;
    const flatDays = dailyPnls.filter(p => p === 0).length;

    // Drawdown calculation
    let peak = 0, maxDrawdown = 0, equity = 0;
    for (const dp of dailyPnls) {
      equity += dp;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const result = {
      instrument: inst.name,
      brickSize: inst.brickSize,
      totalDays: dailyCandles.length,
      totalTrades,
      wins, losses,
      winRate: parseFloat(winRate),
      totalPnl: totalPnl.toFixed(2),
      avgTradesPerDay: parseFloat(avgTradesPerDay),
      targetHits, slHits, renkoExits, eodExits,
      maxWin: maxWin.toFixed(2),
      maxLoss: maxLoss.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      profitDays, lossDays, flatDays,
    };
    allResults.push(result);

    console.log(`\n   ┌─────────────────────────────────────────────────┐`);
    console.log(`   │  ${inst.name} PremiumRenko Results (${dailyCandles.length} days)       │`);
    console.log(`   ├─────────────────────────────────────────────────┤`);
    console.log(`   │  Total Trades:     ${String(totalTrades).padStart(6)}                    │`);
    console.log(`   │  Win Rate:         ${winRate.padStart(6)}%                   │`);
    console.log(`   │  Total P&L:       ₹${totalPnl.toFixed(0).padStart(7)}                   │`);
    console.log(`   │  Avg Trades/Day:   ${avgTradesPerDay.padStart(6)}                    │`);
    console.log(`   │  Max Win:         ₹${maxWin.toFixed(0).padStart(7)}                   │`);
    console.log(`   │  Max Loss:        ₹${maxLoss.toFixed(0).padStart(7)}                   │`);
    console.log(`   │  Max Drawdown:    ₹${maxDrawdown.toFixed(0).padStart(7)}                   │`);
    console.log(`   │  Profit Days:      ${String(profitDays).padStart(3)} / ${dailyCandles.length}                  │`);
    console.log(`   ├─────────────────────────────────────────────────┤`);
    console.log(`   │  Exit Breakdown:                                │`);
    console.log(`   │    Target (1:2):   ${String(targetHits).padStart(4)} (${(targetHits/Math.max(1,totalTrades)*100).toFixed(0)}%)                   │`);
    console.log(`   │    Stop Loss:      ${String(slHits).padStart(4)} (${(slHits/Math.max(1,totalTrades)*100).toFixed(0)}%)                   │`);
    console.log(`   │    Renko Exit:     ${String(renkoExits).padStart(4)} (${(renkoExits/Math.max(1,totalTrades)*100).toFixed(0)}%)                   │`);
    console.log(`   │    EOD Close:      ${String(eodExits).padStart(4)} (${(eodExits/Math.max(1,totalTrades)*100).toFixed(0)}%)                   │`);
    console.log(`   └─────────────────────────────────────────────────┘`);
  }

  // Also try to fetch today's intraday for a live-data sample
  console.log("\n\n── TODAY'S LIVE INTRADAY TEST ──");
  for (const inst of CONFIG.instruments) {
    const intradayCandles = await fetchIntradayCandles(inst.token);
    if (intradayCandles.length > 60) {
      console.log(`   ${inst.name}: ${intradayCandles.length} live 1-min candles available`);
      const premiumCandles = derivePremiumCandles(intradayCandles, inst.basePremium, CONFIG.delta);
      const trades = backtestDay(premiumCandles, inst.brickSize, inst.name);
      console.log(`   Signals today: ${trades.length} trades | P&L: ₹${trades.reduce((s,t) => s + t.pnl, 0).toFixed(2)}`);
    } else {
      console.log(`   ${inst.name}: ${intradayCandles.length} candles (market may be closed)`);
    }
  }

  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const r of allResults) {
    console.log(`  ${r.instrument}: ${r.totalTrades} trades | Win: ${r.winRate}% | P&L: ₹${r.totalPnl} | MaxDD: ₹${r.maxDrawdown}`);
  }
  console.log("\n  NOTE: Premium candles are SYNTHETIC (derived from index via delta model).");
  console.log("  Real-world results may vary. For live validation, enable PremiumRenko");
  console.log("  layer in paper mode with a valid Upstox access token.");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
