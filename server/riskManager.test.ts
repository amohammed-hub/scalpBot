import { describe, expect, it } from "vitest";
import {
  computeMarketRiskScore,
  getCachedRiskScore,
  getPortfolioStatus,
  updateStoplossGuard,
  getStoplossGuardState,
  checkPortfolioDrawdown,
  resetPortfolioHalt,
  canOpenNewTrade,
  recordTradeClose,
  isCooldownActive,
  applyPaperCosts,
} from "./riskManager";
import { computeLayerStats, isLayerDisabled, setLayerOverride, resetAllLayerOverrides } from "./layerTracker";
import { STRATEGY_PRESETS, getPreset } from "./presets";
import type { BotState } from "./botEngine";

// Helper to create a minimal BotState-like object for testing
function makeBotState(overrides: Record<string, unknown> = {}): BotState {
  return {
    sessionToken: "test-session",
    status: "running",
    mode: "paper",
    instrumentToken: "NSE_INDEX|Nifty 50",
    instrumentSymbol: "NIFTY",
    instrumentLabel: "Nifty 50",
    capital: 100000,
    riskPerTradePct: 1,
    maxTradesPerDay: 5,
    dailyLossLimitPct: 3,
    stopLossMultiplier: 1.5,
    targetMultiplier: 3,
    trailingSlEnabled: false,
    trailingSlPct: 0.5,
    minConfidence: 60,
    scanIntervalSec: 30,
    tradesCount: 0,
    dailyPnl: 0,
    openTrade: null,
    lastSignal: null,
    lastSignalAt: 0,
    lastPrice: 0,
    bidPrice: 0,
    askPrice: 0,
    nextScanAt: 0,
    lastError: null,
    lastTickAt: 0,
    currentSl: null,
    slot: 0,
    lotSize: 1,
    isIndexOptions: false,
    underlyingToken: null,
    optionType: null,
    telegramBotToken: "",
    telegramChatId: "",
    telegramEnabled: false,
    ...overrides,
  } as unknown as BotState;
}

function makeTrade(exitReason: string, pnl: number) {
  return { exitReason, pnl };
}

describe("Risk Manager — Market Risk Score", () => {
  it("computes a score between 0-100 with safe boolean and regime", async () => {
    const score = await computeMarketRiskScore(
      [], // no candles → unknown regime
      [], // no recent trades
      null, // no access token → VIX unavailable
    );
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(typeof score.safe).toBe("boolean");
    expect(typeof score.regime).toBe("string");
    expect(score.reasons).toBeInstanceOf(Array);
  });

  it("raises score with consecutive stop-losses", async () => {
    const slTrades = [
      makeTrade("Stop Loss Hit", -100),
      makeTrade("Stop Loss Hit", -120),
      makeTrade("Stop Loss Hit", -80),
    ];
    const score = await computeMarketRiskScore([], slTrades, null);
    expect(score.consecutiveSLs).toBe(3);
    expect(score.reasons.some(r => r.includes("consecutive"))).toBe(true);
  });

  it("getCachedRiskScore returns the last computed score", async () => {
    await computeMarketRiskScore([], [], null);
    const cached = getCachedRiskScore();
    expect(cached).toBeDefined();
    expect(cached.updatedAt).toBeGreaterThan(0);
  });
});

describe("Risk Manager — Portfolio Status", () => {
  it("calculates exposure percentage correctly", () => {
    const bots = [
      makeBotState({
        capital: 100000,
        openTrade: {
          entryPrice: 500, quantity: 100, direction: "BUY", slPrice: 490,
          targetPrice: 530, enteredAt: Date.now(), symbol: "NIFTY",
          currentSl: 490, partial1RPrice: 510, partial2RPrice: 520, partialBookedQty: 0,
        },
      }),
    ];
    const status = getPortfolioStatus(bots);
    expect(status.totalCapital).toBe(100000);
    expect(status.totalExposure).toBe(50000); // 500 * 100
    expect(status.exposurePct).toBe(50);
    expect(status.openTrades).toBe(1);
  });

  it("returns 0% exposure when no open trades", () => {
    const bots = [makeBotState(), makeBotState({ sessionToken: "test-2" })];
    const status = getPortfolioStatus(bots);
    expect(status.exposurePct).toBe(0);
    expect(status.openTrades).toBe(0);
  });
});

describe("Risk Manager — Portfolio Exposure Cap (80%)", () => {
  it("allows new trade when total exposure stays under 80%", () => {
    const bots = [makeBotState({ capital: 100000 })];
    const result = canOpenNewTrade(bots, 50000); // 50% — allowed
    expect(result.allowed).toBe(true);
  });

  it("rejects new trade when total exposure would exceed 80%", () => {
    const bots = [
      makeBotState({
        capital: 100000,
        openTrade: {
          entryPrice: 600, quantity: 100, direction: "BUY", slPrice: 590,
          targetPrice: 630, enteredAt: Date.now(), symbol: "NIFTY",
          currentSl: 590, partial1RPrice: 610, partial2RPrice: 620, partialBookedQty: 0,
        },
      }),
    ];
    // existing exposure 60,000 + new 30,000 = 90% > 80% cap
    const result = canOpenNewTrade(bots, 30000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe("Risk Manager — StoplossGuard", () => {
  it("does not pause with fewer than 3 consecutive SLs", () => {
    const trades = [
      makeTrade("Target Hit", 200),
      makeTrade("Stop Loss Hit", -100),
      makeTrade("Stop Loss Hit", -100),
    ];
    const guard = updateStoplossGuard(trades);
    expect(guard.consecutiveSLs).toBe(2);
  });

  it("pauses after 3 consecutive SLs within last 20 trades", () => {
    const trades = [
      makeTrade("Target Hit", 200),
      makeTrade("Stop Loss Hit", -100),
      makeTrade("Stop Loss Hit", -110),
      makeTrade("Stop Loss Hit", -90),
    ];
    const guard = updateStoplossGuard(trades);
    expect(guard.consecutiveSLs).toBe(3);
    expect(guard.isPaused).toBe(true);
    expect(guard.reason).toContain("StoplossGuard");
    expect(getStoplossGuardState().isPaused).toBe(true);
  });
});

describe("Risk Manager — MaxDrawdown Halt", () => {
  it("halts when aggregate daily loss exceeds limit", () => {
    resetPortfolioHalt();
    const bots = [
      makeBotState({ capital: 100000, dailyPnl: -4000, dailyLossLimitPct: 3 }),
    ];
    const halt = checkPortfolioDrawdown(bots, 3);
    expect(halt.halted).toBe(true);
    resetPortfolioHalt();
  });

  it("does not halt when losses are within limit", () => {
    resetPortfolioHalt();
    const bots = [
      makeBotState({ capital: 100000, dailyPnl: -1000, dailyLossLimitPct: 3 }),
    ];
    const halt = checkPortfolioDrawdown(bots, 3);
    expect(halt.halted).toBe(false);
    resetPortfolioHalt();
  });
});

describe("Risk Manager — Cooldown (2-candle wait)", () => {
  it("activates cooldown after trade close for 2 candles", () => {
    recordTradeClose("cooldown-test-1", 30); // 30s candles → 60s cooldown
    const cd = isCooldownActive("cooldown-test-1");
    expect(cd.active).toBe(true);
    expect(cd.remainingMs).toBeGreaterThan(55000);
    expect(cd.remainingMs).toBeLessThanOrEqual(60000);
  });

  it("returns inactive for sessions without cooldown", () => {
    const cd = isCooldownActive("never-traded-session");
    expect(cd.active).toBe(false);
    expect(cd.remainingMs).toBe(0);
  });
});

describe("Risk Manager — Paper Cost Simulation", () => {
  it("deducts brokerage and slippage from gross P&L", () => {
    // rawPnl=1000, entry=500, exit=510, qty=10, brokerage=20, slippage=0.05%
    const netPnl = applyPaperCosts(1000, 500, 510, 10, 20, 0.05);
    // slippage = (500*0.0005*10) + (510*0.0005*10) = 2.5 + 2.55 = 5.05; total = 25.05
    expect(netPnl).toBeLessThan(1000);
    expect(netPnl).toBeCloseTo(1000 - 25.05, 1);
  });

  it("uses default ₹20 brokerage and 0.05% slippage", () => {
    // rawPnl=500, entry=100, exit=100, qty=10 → slippage = 0.5+0.5=1; brokerage=20; total=21
    const netPnl = applyPaperCosts(500, 100, 100, 10);
    expect(netPnl).toBeCloseTo(500 - 21, 1);
  });
});

describe("Layer Tracker", () => {
  it("computes win rate per layer from closed trades", () => {
    resetAllLayerOverrides();
    const trades = [
      ...Array(5).fill(null).map(() => ({ signalReason: "VWAP bounce", pnl: 100, exitedAt: new Date() })),
      ...Array(5).fill(null).map(() => ({ signalReason: "VWAP bounce", pnl: -50, exitedAt: new Date() })),
    ];
    const stats = computeLayerStats(trades);
    const vwap = stats.find(s => s.layer === "VWAP");
    expect(vwap).toBeDefined();
    expect(vwap!.totalTrades).toBe(10);
    expect(vwap!.wins).toBe(5);
    expect(vwap!.winRate).toBe(50);
    expect(vwap!.disabled).toBe(false);
  });

  it("auto-disables layer with win rate below 30% over last 20 trades", () => {
    resetAllLayerOverrides();
    const trades = [
      ...Array(5).fill(null).map(() => ({ signalReason: "EMA crossover signal", pnl: 50, exitedAt: new Date() })),
      ...Array(15).fill(null).map(() => ({ signalReason: "EMA crossover signal", pnl: -30, exitedAt: new Date() })),
    ];
    const stats = computeLayerStats(trades);
    const ema = stats.find(s => s.layer === "EMA Cross");
    expect(ema).toBeDefined();
    expect(ema!.winRate).toBe(25);
    expect(ema!.disabled).toBe(true);
  });

  it("supports manual layer override", () => {
    resetAllLayerOverrides();
    setLayerOverride("VWAP", true);
    expect(isLayerDisabled("VWAP").disabled).toBe(true);
    resetAllLayerOverrides();
    expect(isLayerDisabled("VWAP").disabled).toBe(false);
  });
});

describe("Strategy Presets", () => {
  it("has 3 presets: conservative, balanced, aggressive", () => {
    expect(STRATEGY_PRESETS.length).toBe(3);
    expect(STRATEGY_PRESETS.map(p => p.id).sort()).toEqual(["aggressive", "balanced", "conservative"]);
  });

  it("getPreset returns correct preset by id", () => {
    const conservative = getPreset("conservative");
    expect(conservative).toBeDefined();
    expect(conservative!.minConfidence).toBeGreaterThanOrEqual(70);
    expect(conservative!.riskPerTradePct).toBeLessThanOrEqual(1);
  });

  it("getPreset returns undefined for unknown id", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });

  it("aggressive preset has higher risk and more trades than conservative", () => {
    const conservative = getPreset("conservative")!;
    const aggressive = getPreset("aggressive")!;
    expect(aggressive.riskPerTradePct).toBeGreaterThan(conservative.riskPerTradePct);
    expect(aggressive.maxTradesPerDay).toBeGreaterThan(conservative.maxTradesPerDay);
  });
});
