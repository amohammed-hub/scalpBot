import { describe, expect, it } from "vitest";
import {
  detectDemoTrikalPhase,
  isDemoCoreNseProfile,
  isWithinDemoCoreNseWindow,
} from "./botEngine";

type TestCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

function candlesFromCloses(closes: number[]): TestCandle[] {
  const start = Date.UTC(2026, 7, 21, 3, 45);
  return closes.map((close, index) => ({
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 0,
    timestamp: start + index * 60_000,
  }));
}

describe("paper-demo Trikal controls", () => {
  it("recognizes only the three core NSE profile families", () => {
    expect(isDemoCoreNseProfile("NSE_INDEX|Nifty 50", "NIFTY", "Nifty 50")).toBe(true);
    expect(isDemoCoreNseProfile("NSE_INDEX|Nifty Bank", "BANKNIFTY", "BankNifty")).toBe(true);
    expect(isDemoCoreNseProfile("NSE_INDEX|Nifty Fin Service", "FINNIFTY", "FinNifty")).toBe(true);
    expect(isDemoCoreNseProfile("MCX_FO|CRUDEOIL", "CRUDEOIL", "Crude Oil")).toBe(false);
    expect(isDemoCoreNseProfile("NSE_EQ|COMMODITY", "COMMODITY", "NSE Commodity")).toBe(false);
    expect(isDemoCoreNseProfile("NSE_INDEX|SENSEX", "SENSEX", "Sensex")).toBe(false);
  });

  it("enforces the requested 09:45–14:30 IST window", () => {
    expect(isWithinDemoCoreNseWindow(9 * 60 + 44)).toBe(false);
    expect(isWithinDemoCoreNseWindow(9 * 60 + 45)).toBe(true);
    expect(isWithinDemoCoreNseWindow(12 * 60 + 45)).toBe(true);
    expect(isWithinDemoCoreNseWindow(14 * 60 + 30)).toBe(true);
    expect(isWithinDemoCoreNseWindow(14 * 60 + 31)).toBe(false);
  });

  it("classifies flat data as accumulation and a sustained trend as breakout", () => {
    const flat = detectDemoTrikalPhase(candlesFromCloses(Array.from({ length: 40 }, () => 100)));
    expect(flat.phase).toBe("ACCUMULATION");

    const trend = detectDemoTrikalPhase(candlesFromCloses(Array.from({ length: 40 }, (_, i) => 100 + i * 2)));
    expect(trend.phase).toBe("BREAKOUT");
    expect(trend.adx).toBeGreaterThan(25);
  });
});

export {};

// Keep the local candle type structurally compatible with the engine’s Candle interface.
void ({} as TestCandle);
