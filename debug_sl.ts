import { generateSignal } from "./server/botEngine";
import * as fs from "fs";

const rawData = JSON.parse(fs.readFileSync("/tmp/nifty50_1min_6months.json", "utf-8"));
const dayCandles = rawData.filter((c: any) => c.timestamp.startsWith("2026-07-14"));

interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }
const candles1m: Candle[] = dayCandles.map((c: any) => ({
  timestamp: new Date(c.timestamp).getTime(),
  open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0
}));

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

// Check a signal at i=70 where V1 fired
const slice = candles5m.slice(0, 71);
const sig = generateSignal(slice, [], [], { minConfidence: 0.65 });
console.log("Signal:", JSON.stringify(sig, null, 2));
console.log("\nLast candle close:", slice[slice.length-1].close);
console.log("Entry:", sig.entryPrice, "SL:", sig.slPrice, "TP:", sig.targetPrice);
console.log("ATR:", sig.atr);
