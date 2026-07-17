import axios from "axios";

// Fetch BankNifty 1-min candles
const token = "NSE_INDEX|Nifty Bank";
const encoded = encodeURIComponent(token);
const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/1minute`;
const resp = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 8000 });
const rawCandles = resp.data?.data?.candles ?? [];
const candles = rawCandles.map(c => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));

console.log(`BankNifty candles: ${candles.length}`);
if (candles.length === 0) { console.log("NO CANDLES"); process.exit(1); }

const price = candles[candles.length - 1].close;
console.log(`Current price: ₹${price.toFixed(2)}`);

// Calculate key indicators
const closes = candles.map(c => c.close);

// EMA
function ema(arr, period) {
  const k = 2 / (period + 1);
  let result = [arr[0]];
  for (let i = 1; i < arr.length; i++) result.push(arr[i] * k + result[i-1] * (1-k));
  return result;
}
const e9arr = ema(closes, 9);
const e21arr = ema(closes, 21);
const e9 = e9arr[e9arr.length - 1];
const e21 = e21arr[e21arr.length - 1];

// VWAP
let cumVol = 0, cumTP = 0;
for (const c of candles) { const tp = (c.high + c.low + c.close) / 3; cumVol += (c.volume || 1); cumTP += tp * (c.volume || 1); }
const vwap = cumTP / cumVol;

// RSI
function calcRSI(data, period) {
  if (data.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const diff = data[i] - data[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
const rsi = calcRSI(closes, 14);

// ADX (simplified)
function calcADX(candles, period) {
  if (candles.length < period * 2) return 0;
  let plusDMs = [], minusDMs = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevHigh = candles[i-1].high, prevLow = candles[i-1].low, prevClose = candles[i-1].close;
    const plusDM = Math.max(0, high - prevHigh);
    const minusDM = Math.max(0, prevLow - low);
    if (plusDM > minusDM) { plusDMs.push(plusDM); minusDMs.push(0); }
    else { plusDMs.push(0); minusDMs.push(minusDM); }
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const smooth = (arr) => { let s = arr.slice(0, period).reduce((a,b)=>a+b,0); let r = [s]; for (let i = period; i < arr.length; i++) { s = s - s/period + arr[i]; r.push(s); } return r; };
  const sTR = smooth(trs); const sPDM = smooth(plusDMs); const sMDM = smooth(minusDMs);
  let dxs = [];
  for (let i = 0; i < sTR.length; i++) { const pdi = sPDM[i]/sTR[i]*100; const mdi = sMDM[i]/sTR[i]*100; dxs.push(Math.abs(pdi-mdi)/(pdi+mdi||1)*100); }
  if (dxs.length < period) return dxs[dxs.length-1] || 0;
  let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0)/period;
  for (let i = period; i < dxs.length; i++) adx = (adx * (period-1) + dxs[i]) / period;
  return adx;
}
const adx = calcADX(candles, 14);

// ATR
function calcATR(candles, period) {
  if (candles.length < 2) return 0;
  let trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i-1].close), Math.abs(candles[i].low - candles[i-1].close)));
  }
  return trs.slice(-period).reduce((a,b)=>a+b,0) / Math.min(period, trs.length);
}
const atr = calcATR(candles, 14);

// Distances
const distFromEma9 = Math.abs(price - e9) / e9;
const distFromVwap = Math.abs(price - vwap) / vwap;
const nearPullback = distFromEma9 < 0.0015 || distFromVwap < 0.0015;

console.log(`\n=== DIAGNOSTIC ===`);
console.log(`EMA9: ${e9.toFixed(2)} | EMA21: ${e21.toFixed(2)} | EMA9 > EMA21: ${e9 > e21}`);
console.log(`VWAP: ${vwap.toFixed(2)} | Price vs VWAP: ${price > vwap ? "ABOVE" : "BELOW"}`);
console.log(`RSI: ${rsi.toFixed(1)} | ADX: ${adx.toFixed(1)}`);
console.log(`ATR: ${atr.toFixed(2)} (${(atr/price*100).toFixed(3)}% of price)`);
console.log(`\n=== FILTER CHECKS ===`);
console.log(`Dist from EMA9: ${(distFromEma9 * 100).toFixed(4)}% (threshold: 0.15%) → ${distFromEma9 < 0.0015 ? "PASS" : "FAIL (too far from EMA9)"}`);
console.log(`Dist from VWAP: ${(distFromVwap * 100).toFixed(4)}% (threshold: 0.15%) → ${distFromVwap < 0.0015 ? "PASS" : "FAIL (too far from VWAP)"}`);
console.log(`Near Pullback: ${nearPullback ? "YES" : "NO — THIS IS BLOCKING TREND/MOMENTUM LAYERS"}`);
console.log(`ADX > 20: ${adx > 20 ? "YES" : "NO — THIS IS BLOCKING TREND LAYER"}`);
console.log(`RSI zone: ${rsi > 55 ? "Bullish (>55)" : rsi < 45 ? "Bearish (<45)" : "NO-MAN'S-LAND (40-55) — BLOCKING TREND LAYER"}`);

// Check S/R proximity
// Simulate prev day data
const url2 = `https://api.upstox.com/v2/historical-candle/${encoded}/day/${new Date().toISOString().split("T")[0]}/${new Date(Date.now() - 7*24*3600*1000).toISOString().split("T")[0]}`;
const resp2 = await axios.get(url2, { headers: { Accept: "application/json" }, timeout: 8000 });
const dayCandles = resp2.data?.data?.candles ?? [];
if (dayCandles.length >= 2) {
  const prevDay = dayCandles[1]; // yesterday
  const prevH = prevDay[2], prevL = prevDay[3], prevC = prevDay[4];
  const pp = (prevH + prevL + prevC) / 3;
  const r1 = 2 * pp - prevL;
  const r2 = pp + (prevH - prevL);
  const s1 = 2 * pp - prevH;
  const s2 = pp - (prevH - prevL);
  const srLevels = [pp, r1, r2, s1, s2];
  console.log(`\nPivot levels: PP=${pp.toFixed(0)} R1=${r1.toFixed(0)} R2=${r2.toFixed(0)} S1=${s1.toFixed(0)} S2=${s2.toFixed(0)}`);
  const nearSR = srLevels.some(l => Math.abs(price - l) / price < 0.0002);
  console.log(`Near S/R (0.02%): ${nearSR ? "YES — BLOCKING ALL ENTRIES" : "NO (not near any pivot)"}`);
  for (const l of srLevels) {
    const dist = Math.abs(price - l);
    const distPct = dist / price * 100;
    console.log(`  ${l.toFixed(0)}: dist=${dist.toFixed(0)} pts (${distPct.toFixed(4)}%) ${distPct < 0.02 ? "← BLOCKING" : ""}`);
  }
}

// Check breakout conditions
const lookback = candles.slice(-20);
const highestHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
const lowestLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
const lastCandle = candles[candles.length - 1];
const breakoutUpPct = (lastCandle.close - highestHigh) / highestHigh;
const breakoutDnPct = (lowestLow - lastCandle.close) / lowestLow;
const dynamicBreakoutThreshold = Math.max(0.0002, (atr / price) * 0.5);
console.log(`\n=== BREAKOUT CHECK ===`);
console.log(`20-bar High: ${highestHigh.toFixed(2)} | Low: ${lowestLow.toFixed(2)}`);
console.log(`Breakout Up: ${(breakoutUpPct*100).toFixed(4)}% (need >${(dynamicBreakoutThreshold*100).toFixed(4)}%) → ${breakoutUpPct > dynamicBreakoutThreshold ? "PASS" : "FAIL"}`);
console.log(`Breakout Dn: ${(breakoutDnPct*100).toFixed(4)}% (need >${(dynamicBreakoutThreshold*100).toFixed(4)}%) → ${breakoutDnPct > dynamicBreakoutThreshold ? "PASS" : "FAIL"}`);

// 5m trend
const url5m = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/5minute`;
const resp5m = await axios.get(url5m, { headers: { Accept: "application/json" }, timeout: 8000 });
const candles5m = (resp5m.data?.data?.candles ?? []).map(c => ({ timestamp: new Date(c[0]).getTime(), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
if (candles5m.length >= 5) {
  const c5 = candles5m.slice(-5);
  const bullish = c5.filter(c => c.close > c.open).length;
  const bearish = c5.filter(c => c.close < c.open).length;
  const trend5m = bullish >= 4 ? "bullish" : bearish >= 4 ? "bearish" : "neutral";
  console.log(`\n5m Trend: ${trend5m} (${bullish} bull / ${bearish} bear out of last 5)`);
}
