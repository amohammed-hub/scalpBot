import { readFileSync } from "fs";
import { detectRegimeV2, type Candle } from "./server/botEngine";

const candles: Candle[] = JSON.parse(readFileSync("/tmp/nifty_candles_2026-07-16.json", "utf-8"));
const WINDOW = 60;

// Check regime at key times where V1 got winning Breakout signals
const targetMins = [650, 810]; // 10:50 and 13:30

for (let i = WINDOW; i < candles.length; i++) {
  const dt = new Date(candles[i].timestamp);
  const istMin = ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) + 330) % (24 * 60);
  if (targetMins.includes(istMin)) {
    const window = candles.slice(Math.max(0, i - WINDOW), i + 1);
    const regime = detectRegimeV2(window);
    console.log(`IST ${Math.floor(istMin/60)}:${String(istMin%60).padStart(2,"0")} | Regime: ${regime.regime} (${regime.label}) | ADX: ${regime.adx.toFixed(1)} | ATR ratio: ${regime.atrRatio.toFixed(2)}`);
    targetMins.splice(targetMins.indexOf(istMin), 1);
    if (targetMins.length === 0) break;
  }
}
process.exit(0);
