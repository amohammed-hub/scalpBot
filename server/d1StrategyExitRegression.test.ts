import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getStrategyExitDecision,
  getStrategyExitDirection,
  type Candle,
  type OpenTrade,
} from "./botEngine";

function makeTrendCandles(
  count: number,
  basePrice: number,
  direction: "up" | "down",
  stepSize: number,
): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i += 1) {
    price += direction === "up" ? stepSize : -stepSize;
    candles.push({
      open: price - stepSize * 0.3,
      high: price + stepSize * 0.5,
      low: price - stepSize * 0.5,
      close: price,
      volume: 100_000,
      timestamp: Date.now() - (count - i) * 60_000,
    });
  }
  return candles;
}

function bullishThenBearishReversal(): Candle[] {
  return [
    ...makeTrendCandles(15, 100, "up", 3),
    ...makeTrendCandles(10, 145, "down", 4),
  ];
}

function asTrade(overrides: Partial<OpenTrade>): OpenTrade {
  return {
    dbId: 1,
    symbol: "NIFTY",
    symbolLabel: "NIFTY",
    instrumentToken: "NSE_INDEX|Nifty 50",
    direction: "BUY",
    mode: "demo",
    entryPrice: 200,
    quantity: 1,
    slPrice: 150,
    targetPrice: 260,
    atr: 10,
    confidence: 0.8,
    enteredAt: new Date(),
    trailingSlEnabled: false,
    trailingSlPct: 0,
    currentSl: 150,
    partial1RPrice: 220,
    partial2RPrice: 240,
    partialBooked: 0,
    bookedQty: 0,
    bookedPnl: 0,
    ...overrides,
  };
}

describe("D1 strategy exit dispatcher", () => {
  it("dispatches Red Bar Theory to its existing Renko checker with a distinct reason", () => {
    const decision = getStrategyExitDecision(
      "RedBarTheory",
      "BUY",
      bullishThenBearishReversal(),
      10,
    );

    expect(decision?.reason).toMatch(/^Strategy Exit — Red Bar Theory —/);
    expect(decision?.reason).toContain("red brick");
  });

  it("dispatches Trikal Strategy to its existing Smart Renko checker with a distinct reason", () => {
    const decision = getStrategyExitDecision(
      "TrikalStrategy",
      "BUY",
      bullishThenBearishReversal(),
      10,
    );

    expect(decision?.reason).toMatch(/^Strategy Exit — Trikal Strategy —/);
    expect(decision?.reason).toContain("SmartRed Bar Theory Exit");
  });

  it("dispatches Adeeb only after its existing two-brick reversal condition", () => {
    const decision = getStrategyExitDecision(
      "Adeeb",
      "BUY",
      bullishThenBearishReversal(),
      10,
    );

    expect(decision?.reason).toMatch(/^Strategy Exit — Adeeb —/);
    expect(decision?.reason).toContain("2 consecutive red Renko bricks");
  });

  it("does not produce a strategy exit for a non-D1 layer or continuing trend", () => {
    const continuingBullTrend = makeTrendCandles(30, 100, "up", 2);
    expect(getStrategyExitDecision("Trend", "BUY", bullishThenBearishReversal(), 10)).toBeNull();
    expect(getStrategyExitDecision("RedBarTheory", "BUY", continuingBullTrend, 10)).toBeNull();
  });

  it("uses the underlying PE direction for options and refuses an ambiguous legacy option", () => {
    expect(getStrategyExitDirection(asTrade({
      isIndexOptions: true,
      optionMockKey: "NIFTY_PE",
      symbol: "NIFTY26AUG25000PE",
    }))).toBe("SELL");
    expect(getStrategyExitDirection(asTrade({
      isIndexOptions: true,
      optionMockKey: "NIFTY_CE",
      symbol: "NIFTY26AUG25000CE",
    }))).toBe("BUY");
    expect(getStrategyExitDirection(asTrade({
      isIndexOptions: true,
      optionMockKey: undefined,
      symbol: "PAPER_OPT|NIFTY",
      symbolLabel: "NIFTY option",
      signalReason: undefined,
    }))).toBeNull();
  });

  it("invokes the D1 dispatcher before the verified close block but preserves the generic exit reason first", () => {
    const source = readFileSync(resolve(__dirname, "botEngine.ts"), "utf8");
    const safetyCheck = source.indexOf('if (trade.direction === "BUY") { if (effectivePrice <= trade.currentSl) exitReason = "Stop Loss";');
    const dispatcher = source.indexOf("const strategyExitDecision = !isOptionsWithBrokenDelta && strategyExitDirection");
    const application = source.indexOf("if (!exitReason && strategyExitDecision)");
    const verifiedClose = source.indexOf("if (exitReason) {", dispatcher);

    expect(safetyCheck).toBeGreaterThan(-1);
    expect(dispatcher).toBeGreaterThan(safetyCheck);
    expect(application).toBeGreaterThan(dispatcher);
    expect(verifiedClose).toBeGreaterThan(application);
    expect(source.slice(dispatcher, verifiedClose)).toContain("trade.atr");
    expect(source.slice(dispatcher, verifiedClose)).toContain("state.candles");
  });
});
