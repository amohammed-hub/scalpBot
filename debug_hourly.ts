import { readFileSync } from "fs";
import { generateSignalV2, detectRegimeV2, type Candle } from "./server/botEngine";

// Thursday July 17 - V1 got HourlyClose BUY at 10:15 but V2 didn't
const candles: Candle[] = JSON.parse(readFileSync("/tmp/nifty_candles_2026-07-17.json", "utf-8"));

// Check what happens at candle 60 (10:15 AM = 615 IST minutes)
for (let i = 55; i <= 70; i++) {
  const window = candles.slice(0, i + 1);
  const dt = new Date(candles[i].timestamp);
  const istMin = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
  
  if (istMin >= 610 && istMin <= 630) {
    const regime = detectRegimeV2(window);
    const sig = generateSignalV2(window, 1.5, 3.0, 0.0);
    console.log(`Candle ${i} | IST ${Math.floor(istMin/60)}:${String(istMin%60).padStart(2,"0")} | Regime: ${regime.regime} | Signal: ${sig.direction} ${sig.layer} (${(sig.confidence*100).toFixed(0)}%) | ${sig.reason?.substring(0, 80)}`);
  }
}

// Also check Monday Jul 14 - V1 got ORB SELL at 10:17
console.log("\n--- Monday Jul 14 (ORB check) ---");
const candles14: Candle[] = JSON.parse(readFileSync("/tmp/nifty_candles_2026-07-14.json", "utf-8"));
for (let i = 55; i <= 70; i++) {
  const window = candles14.slice(0, i + 1);
  const dt = new Date(candles14[i].timestamp);
  const istMin = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
  
  if (istMin >= 570 && istMin <= 620) {
    const regime = detectRegimeV2(window);
    const sig = generateSignalV2(window, 1.5, 3.0, 0.0);
    if (sig.direction !== "HOLD" || istMin >= 610) {
      console.log(`Candle ${i} | IST ${Math.floor(istMin/60)}:${String(istMin%60).padStart(2,"0")} | Regime: ${regime.regime} | Signal: ${sig.direction} ${sig.layer} (${(sig.confidence*100).toFixed(0)}%) | ${sig.reason?.substring(0, 80)}`);
    }
  }
}

process.exit(0);
