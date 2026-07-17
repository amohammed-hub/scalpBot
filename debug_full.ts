import { readFileSync } from "fs";
import { generateSignal, generateSignalV2, type Candle } from "./server/botEngine";

const DAYS = ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
const WINDOW = 60;

for (const day of DAYS) {
  const raw = JSON.parse(readFileSync(`/tmp/nifty_candles_${day}.json`, "utf-8")) as Candle[];
  let v1Count = 0, v2Count = 0;
  let v1Reasons: Record<string, number> = {};
  let v2Reasons: Record<string, number> = {};
  
  for (let i = WINDOW; i < raw.length; i++) {
    const window = raw.slice(Math.max(0, i - WINDOW), i + 1);
    const sig1 = generateSignal(window, 1.5, 3.0, 0.0);
    const sig2 = generateSignalV2(window, 1.5, 3.0, 0.0);
    
    if (sig1 && sig1.direction !== "HOLD") v1Count++;
    else {
      const r = sig1?.reason?.split("|")[0]?.trim() ?? "null";
      v1Reasons[r] = (v1Reasons[r] || 0) + 1;
    }
    
    if (sig2 && sig2.direction !== "HOLD") v2Count++;
    else {
      const r = sig2?.reason?.split("|")[0]?.trim() ?? "null";
      v2Reasons[r] = (v2Reasons[r] || 0) + 1;
    }
  }
  
  console.log(`\n${day}: ${raw.length} candles, checked ${raw.length - WINDOW} windows`);
  console.log(`  V1 signals: ${v1Count} | V2 signals: ${v2Count}`);
  console.log(`  V1 HOLD reasons:`, Object.entries(v1Reasons).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v]) => `${k}(${v})`).join(", "));
  console.log(`  V2 HOLD reasons:`, Object.entries(v2Reasons).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v]) => `${k}(${v})`).join(", "));
}

process.exit(0);
