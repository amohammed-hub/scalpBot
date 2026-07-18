/**
 * Backtest: Option Execution Quality Gates Impact
 * 
 * Runs V1 engine on 6 months of 1-min Nifty data and simulates the impact of:
 * - Fix 1: Bid-ask spread > 5% → SKIP
 * - Fix 2: Premium < ₹10 → SKIP  
 * - Fix 3: 0DTE → ATM only (no OTM)
 * 
 * Since we don't have real option chain data for historical dates, we ESTIMATE:
 * - Option premium using Black-Scholes delta approximation
 * - Bid-ask spread from empirical distributions (wider for OTM, expiry day, low premium)
 * - Whether it's expiry day (Nifty weekly expiry = every Thursday)
 */

import { generateSignal } from "./server/botEngine";
import * as fs from "fs";

// Load 6-month data
const rawData = JSON.parse(fs.readFileSync("/home/ubuntu/upstox-scalping-guide/nifty_1min_6months.json", "utf-8"));
const dates = Object.keys(rawData).sort();

interface Candle {
  open: number; high: number; low: number; close: number; volume: number; timestamp: number;
}

interface Trade {
  date: string;
  direction: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  pnl: number;
  layer: string;
  confidence: number;
  estimatedPremium: number;
  estimatedSpreadPct: number;
  isExpiry: boolean;
  isOTM: boolean;
}

// Estimate option premium from underlying price movement potential
function estimateOptionPremium(spotPrice: number, atr: number, direction: "BUY" | "SELL", isOTM: boolean): number {
  // ATM Nifty option premium ≈ 0.4% of spot for weekly options
  // OTM (1 strike = 50 pts away) ≈ 60-70% of ATM premium
  const atmPremium = spotPrice * 0.004 + atr * 2; // base + volatility component
  return isOTM ? atmPremium * 0.65 : atmPremium;
}

// Estimate bid-ask spread percentage
function estimateSpreadPct(premium: number, isExpiry: boolean, isOTM: boolean, timeOfDay: number): number {
  // Base spread: 1-2% for liquid ATM options
  let spread = 1.5;
  
  // OTM options have wider spreads
  if (isOTM) spread += 1.5;
  
  // Low premium = wider spread (₹10-20 options have 5-10% spread)
  if (premium < 20) spread += 3;
  else if (premium < 50) spread += 1;
  
  // Expiry day: spreads widen significantly for OTM
  if (isExpiry && isOTM) spread += 3;
  
  // Opening 15 min and last 15 min: wider spreads
  if (timeOfDay < 570 || timeOfDay > 915) spread += 1.5; // before 9:30 or after 15:15
  
  // Add randomness (±30%)
  spread *= (0.7 + Math.random() * 0.6);
  
  return spread;
}

// Check if a date is a Thursday (Nifty weekly expiry)
function isExpiryDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00+05:30");
  return d.getDay() === 4; // Thursday
}

// Convert Upstox candle format to our Candle interface
function parseCandles(raw: any[]): Candle[] {
  return raw.map(c => ({
    open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0,
    timestamp: new Date(c[0]).getTime()
  })).reverse(); // Upstox returns newest first
}

// Run simulation
interface SimResult {
  trades: Trade[];
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  tradesBlocked: { spread: number; premium: number; zeroDTE: number };
}

function runBacktest(applySpreadFilter: boolean, applyPremiumFloor: boolean, applyZeroDTEATM: boolean): SimResult {
  const trades: Trade[] = [];
  const blocked = { spread: 0, premium: 0, zeroDTE: 0 };
  let equity = 500000;
  let peakEquity = equity;
  let maxDD = 0;

  for (const date of dates) {
    const rawCandles = rawData[date];
    if (!rawCandles || rawCandles.length < 50) continue;
    
    const candles = parseCandles(rawCandles);
    const isExpiry = isExpiryDay(date);
    
    let dailyTrades = 0;
    let openTrade: { direction: "BUY"|"SELL"; entry: number; sl: number; tp: number; layer: string; confidence: number; premium: number; spreadPct: number; isOTM: boolean } | null = null;
    
    // Simulate candle-by-candle
    for (let i = 50; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      
      // Check open trade SL/TP
      if (openTrade) {
        const c = candles[i];
        let exitPrice = 0;
        if (openTrade.direction === "BUY") {
          if (c.low <= openTrade.sl) exitPrice = openTrade.sl;
          else if (c.high >= openTrade.tp) exitPrice = openTrade.tp;
        } else {
          if (c.high >= openTrade.sl) exitPrice = openTrade.sl;
          else if (c.low <= openTrade.tp) exitPrice = openTrade.tp;
        }
        
        // EOD exit at 15:15
        const candleTime = new Date(candles[i].timestamp);
        const istMin = candleTime.getUTCHours() * 60 + candleTime.getUTCMinutes() + 330;
        if (istMin >= 915 && !exitPrice) {
          exitPrice = c.close;
        }
        
        if (exitPrice) {
          const pnl = openTrade.direction === "BUY" 
            ? (exitPrice - openTrade.entry) * 50 // Nifty lot = 50
            : (openTrade.entry - exitPrice) * 50;
          
          trades.push({
            date, direction: openTrade.direction, entry: openTrade.entry,
            sl: openTrade.sl, tp: openTrade.tp, pnl, layer: openTrade.layer,
            confidence: openTrade.confidence, estimatedPremium: openTrade.premium,
            estimatedSpreadPct: openTrade.spreadPct, isExpiry, isOTM: openTrade.isOTM,
          });
          
          equity += pnl;
          peakEquity = Math.max(peakEquity, equity);
          maxDD = Math.max(maxDD, peakEquity - equity);
          openTrade = null;
        }
        continue; // Don't generate new signals while in trade
      }
      
      if (dailyTrades >= 3) continue; // Max 3 trades per day
      
      // Generate signal
      const signal = generateSignal(slice, 1.5, 3.0, 0.65, []);
      if (!signal || signal.direction === "HOLD") continue;
      
      // Simulate option resolution
      const atr = signal.atr;
      const isOTM = true; // Default: bot picks 1-OTM
      const premium = estimateOptionPremium(candles[i].close, atr, signal.direction, isOTM);
      
      const candleTime = new Date(candles[i].timestamp);
      const istMin = candleTime.getUTCHours() * 60 + candleTime.getUTCMinutes() + 330;
      const spreadPct = estimateSpreadPct(premium, isExpiry, isOTM, istMin);
      
      // Apply filters
      let blocked_this = false;
      
      // Fix 2: Premium floor
      if (applyPremiumFloor && premium < 10) {
        blocked.premium++;
        blocked_this = true;
      }
      
      // Fix 3: 0DTE ATM only
      let effectivePremium = premium;
      let effectiveIsOTM = isOTM;
      if (applyZeroDTEATM && isExpiry && isOTM) {
        // Force ATM: premium increases, spread decreases
        effectivePremium = estimateOptionPremium(candles[i].close, atr, signal.direction, false);
        effectiveIsOTM = false;
        blocked.zeroDTE++; // Count as "modified" not blocked
      }
      
      // Fix 1: Spread check (recalculate with potentially updated premium)
      const effectiveSpread = estimateSpreadPct(effectivePremium, isExpiry, effectiveIsOTM, istMin);
      if (applySpreadFilter && effectiveSpread > 5) {
        blocked.spread++;
        blocked_this = true;
      }
      
      if (blocked_this) continue;
      
      // Open trade
      openTrade = {
        direction: signal.direction,
        entry: signal.entryPrice,
        sl: signal.slPrice,
        tp: signal.targetPrice,
        layer: signal.layer,
        confidence: signal.confidence,
        premium: effectivePremium,
        spreadPct: effectiveSpread,
        isOTM: effectiveIsOTM,
      };
      dailyTrades++;
    }
    
    // Force close at EOD if still open
    if (openTrade) {
      const lastCandle = candles[candles.length - 1];
      const pnl = openTrade.direction === "BUY"
        ? (lastCandle.close - openTrade.entry) * 50
        : (openTrade.entry - lastCandle.close) * 50;
      trades.push({
        date, direction: openTrade.direction, entry: openTrade.entry,
        sl: openTrade.sl, tp: openTrade.tp, pnl, layer: openTrade.layer,
        confidence: openTrade.confidence, estimatedPremium: openTrade.premium,
        estimatedSpreadPct: openTrade.spreadPct, isExpiry, isOTM: openTrade.isOTM,
      });
      equity += pnl;
      peakEquity = Math.max(peakEquity, equity);
      maxDD = Math.max(maxDD, peakEquity - equity);
      openTrade = null;
    }
  }
  
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  
  return {
    trades,
    totalPnl: trades.reduce((s, t) => s + t.pnl, 0),
    winRate: trades.length > 0 ? wins.length / trades.length * 100 : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0,
    maxDrawdown: maxDD,
    tradesBlocked: blocked,
  };
}

console.log(`\n${"═".repeat(80)}`);
console.log(`  OPTION EXECUTION QUALITY GATES — 6-MONTH BACKTEST`);
console.log(`  Data: ${dates.length} trading days | ${dates[0]} to ${dates[dates.length-1]}`);
console.log(`${"═".repeat(80)}\n`);

// Run 4 scenarios
const baseline = runBacktest(false, false, false);
const withSpread = runBacktest(true, false, false);
const withPremium = runBacktest(false, true, false);
const withZeroDTE = runBacktest(false, false, true);
const withAll = runBacktest(true, true, true);

function printResult(name: string, r: SimResult) {
  console.log(`  ${name.padEnd(35)} | Trades: ${String(r.trades.length).padStart(3)} | WR: ${r.winRate.toFixed(1)}% | PF: ${r.profitFactor.toFixed(2)} | P&L: ₹${r.totalPnl.toFixed(0).padStart(8)} | MaxDD: ₹${r.maxDrawdown.toFixed(0).padStart(7)} | Blocked: Spread=${r.tradesBlocked.spread} Prem=${r.tradesBlocked.premium} 0DTE=${r.tradesBlocked.zeroDTE}`);
}

printResult("BASELINE (no filters)", baseline);
printResult("Fix 1: Spread > 5% → SKIP", withSpread);
printResult("Fix 2: Premium < ₹10 → SKIP", withPremium);
printResult("Fix 3: 0DTE → ATM only", withZeroDTE);
printResult("ALL 3 COMBINED", withAll);

// Detailed analysis of blocked trades
console.log(`\n${"─".repeat(80)}`);
console.log(`  BLOCKED TRADE ANALYSIS (Fix 1 — Spread Filter)`);
console.log(`${"─".repeat(80)}`);

// Find trades that exist in baseline but not in withSpread
const baselineDates = baseline.trades.map(t => `${t.date}_${t.direction}_${t.entry}`);
const spreadDates = withSpread.trades.map(t => `${t.date}_${t.direction}_${t.entry}`);
const blockedTrades = baseline.trades.filter(t => !spreadDates.includes(`${t.date}_${t.direction}_${t.entry}`));

if (blockedTrades.length > 0) {
  const blockedWins = blockedTrades.filter(t => t.pnl > 0).length;
  const blockedLosses = blockedTrades.filter(t => t.pnl <= 0).length;
  const blockedPnl = blockedTrades.reduce((s, t) => s + t.pnl, 0);
  console.log(`  Trades blocked by spread filter: ${blockedTrades.length}`);
  console.log(`  Of those: ${blockedWins} would have won, ${blockedLosses} would have lost`);
  console.log(`  Net P&L of blocked trades: ₹${blockedPnl.toFixed(0)}`);
  console.log(`  Avg spread of blocked: ${(blockedTrades.reduce((s,t) => s + t.estimatedSpreadPct, 0) / blockedTrades.length).toFixed(1)}%`);
  
  // Show expiry day breakdown
  const expiryBlocked = blockedTrades.filter(t => t.isExpiry);
  console.log(`  Blocked on expiry days: ${expiryBlocked.length}/${blockedTrades.length}`);
}

console.log(`\n${"─".repeat(80)}`);
console.log(`  EXPIRY DAY ANALYSIS`);
console.log(`${"─".repeat(80)}`);
const expiryDays = dates.filter(d => isExpiryDay(d));
const expiryTrades = baseline.trades.filter(t => t.isExpiry);
const nonExpiryTrades = baseline.trades.filter(t => !t.isExpiry);
console.log(`  Expiry days in period: ${expiryDays.length}`);
console.log(`  Trades on expiry: ${expiryTrades.length} | WR: ${expiryTrades.length > 0 ? (expiryTrades.filter(t=>t.pnl>0).length/expiryTrades.length*100).toFixed(1) : 0}% | P&L: ₹${expiryTrades.reduce((s,t)=>s+t.pnl,0).toFixed(0)}`);
console.log(`  Trades non-expiry: ${nonExpiryTrades.length} | WR: ${nonExpiryTrades.length > 0 ? (nonExpiryTrades.filter(t=>t.pnl>0).length/nonExpiryTrades.length*100).toFixed(1) : 0}% | P&L: ₹${nonExpiryTrades.reduce((s,t)=>s+t.pnl,0).toFixed(0)}`);

console.log(`\n${"═".repeat(80)}`);
console.log(`  VERDICT`);
console.log(`${"═".repeat(80)}`);
const improvement = withAll.totalPnl - baseline.totalPnl;
const ddReduction = ((baseline.maxDrawdown - withAll.maxDrawdown) / baseline.maxDrawdown * 100);
console.log(`  Combined filters P&L change: ₹${improvement.toFixed(0)} (${improvement > 0 ? "+" : ""}${(improvement/Math.abs(baseline.totalPnl)*100).toFixed(1)}%)`);
console.log(`  Max Drawdown reduction: ${ddReduction.toFixed(1)}%`);
console.log(`  Profit Factor change: ${baseline.profitFactor.toFixed(2)} → ${withAll.profitFactor.toFixed(2)}`);
