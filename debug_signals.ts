import { readFileSync } from "fs";
import { generateSignal, generateSignalV2, type Candle } from "./server/botEngine";

const raw = JSON.parse(readFileSync("/tmp/nifty_candles_2026-07-14.json", "utf-8")) as Candle[];
console.log(`Candles: ${raw.length}, Price range: ${raw[0].close} - ${raw[raw.length-1].close}`);

// Check what generateSignal actually returns at various points
const WINDOW = 60;
const window1 = raw.slice(0, 61);
console.log(`\nWindow size: ${window1.length}`);
const sig1 = generateSignal(window1, 1.5, 3.0, 0.0);
console.log(`V1 @candle60:`, JSON.stringify(sig1));

const sig2 = generateSignalV2(window1, 1.5, 3.0, 0.0);
console.log(`V2 @candle60:`, JSON.stringify(sig2));

// Mid-day
const window2 = raw.slice(140, 201);
const sig3 = generateSignal(window2, 1.5, 3.0, 0.0);
console.log(`\nV1 @candle200:`, JSON.stringify(sig3));
const sig4 = generateSignalV2(window2, 1.5, 3.0, 0.0);
console.log(`V2 @candle200:`, JSON.stringify(sig4));

// Late day
const window3 = raw.slice(280, 341);
const sig5 = generateSignal(window3, 1.5, 3.0, 0.0);
console.log(`\nV1 @candle340:`, JSON.stringify(sig5));

process.exit(0);
