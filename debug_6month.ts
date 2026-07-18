import { generateSignal, generateSignalV2 } from "./server/botEngine";
import * as fs from "fs";

const rawData = JSON.parse(fs.readFileSync("/tmp/nifty50_1min_6months.json", "utf-8"));

// Get first day's candles
const firstDayCandles = rawData.filter((c: any) => c.timestamp.startsWith("2026-07-14"));
console.log(`Jul 14 candles: ${firstDayCandles.length}`);

// Convert to 5-min candles
interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }
const candles1m: Candle[] = firstDayCandles.map((c: any) => ({
  timestamp: new Date(c.timestamp).getTime(),
  open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0
}));

// Aggregate to 5m
const candles5m: Candle[] = [];
for (let i = 0; i <= candles1m.length - 5; i += 5) {
  const chunk = candles1m.slice(i, i + 5);
  candles5m.push({
    timestamp: chunk[0].timestamp,
    open: chunk[0].open,
    high: Math.max(...chunk.map(x => x.high)),
    low: Math.min(...chunk.map(x => x.low)),
    close: chunk[chunk.length - 1].close,
    volume: chunk.reduce((s, x) => s + x.volume, 0)
  });
}

console.log(`5m candles: ${candles5m.length}`);
console.log(`First 5m candle time: ${new Date(candles5m[0].timestamp).toISOString()}`);
console.log(`Last 5m candle time: ${new Date(candles5m[candles5m.length-1].timestamp).toISOString()}`);

// Try signal at various points
for (let i = 20; i < candles5m.length; i += 10) {
  const slice = candles5m.slice(0, i + 1);
  const v1 = generateSignal(slice, [], [], { minConfidence: 0.65 });
  const v2 = generateSignalV2(slice, [], [], { minConfidence: 0.65 });
  
  if (v1.direction !== "HOLD" || v2.direction !== "HOLD") {
    const dt = new Date(slice[slice.length-1].timestamp);
    console.log(`\n[${dt.toLocaleTimeString("en-IN", {timeZone:"Asia/Kolkata"})}] i=${i}`);
    console.log(`  V1: ${v1.direction} conf=${v1.confidence.toFixed(2)} entry=${v1.entryPrice.toFixed(1)} sl=${v1.slPrice.toFixed(1)} tp=${v1.targetPrice.toFixed(1)} | ${v1.reason?.substring(0,60)}`);
    console.log(`  V2: ${v2.direction} conf=${v2.confidence.toFixed(2)} entry=${v2.entryPrice.toFixed(1)} sl=${v2.slPrice.toFixed(1)} tp=${v2.targetPrice.toFixed(1)} | ${v2.reason?.substring(0,60)}`);
  }
}
