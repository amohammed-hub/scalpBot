import { readFileSync } from "fs";
import { generateSignal, generateSignalV2, detectRegimeV2, type Candle } from "./server/botEngine";

const candles: Candle[] = JSON.parse(readFileSync("/tmp/nifty_candles_2026-07-16.json", "utf-8"));
const WINDOW = 60;

// Find V1's winning trades on Wednesday
console.log("Wednesday Jul 16 — V1 winning signals:");
for (let i = WINDOW; i < candles.length; i++) {
  const window = candles.slice(Math.max(0, i - WINDOW), i + 1);
  const sig1 = generateSignal(window, 1.5, 3.0, 0.6);
  if (sig1 && sig1.direction !== "HOLD" && sig1.confidence >= 0.6) {
    const dt = new Date(candles[i].timestamp);
    const istMin = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
    const time = `${Math.floor(istMin/60)}:${String(istMin%60).padStart(2,"0")}`;
    const regime = detectRegimeV2(window);
    console.log(`  ${time} | ${sig1.direction} @₹${candles[i].close.toFixed(1)} | ${sig1.layer}(${(sig1.confidence*100).toFixed(0)}%) | Regime: ${regime.regime}(ADX=${regime.adx.toFixed(0)})`);
  }
}

// Check: what if we allowed Breakout signals in RANGING when they have high confidence AND are at range extremes?
console.log("\n\nWednesday Jul 16 — V2 signals with Breakout in RANGING (hypothetical):");
let hypotheticalPnl = 0;
for (let i = WINDOW; i < candles.length; i++) {
  const window = candles.slice(Math.max(0, i - WINDOW), i + 1);
  const sig2 = generateSignalV2(window, 1.5, 3.0, 0.0); // minConf=0 to see all signals
  if (sig2 && sig2.direction !== "HOLD") {
    const dt = new Date(candles[i].timestamp);
    const istMin = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
    const time = `${Math.floor(istMin/60)}:${String(istMin%60).padStart(2,"0")}`;
    console.log(`  ${time} | ${sig2.direction} @₹${candles[i].close.toFixed(1)} | ${sig2.layer}(${(sig2.confidence*100).toFixed(0)}%) | ${sig2.reason?.substring(0, 60)}`);
  }
}

process.exit(0);
