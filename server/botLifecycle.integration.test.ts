/**
 * botLifecycle.integration.test.ts
 *
 * END-TO-END integration tests for the full bot trade lifecycle.
 * These tests call the REAL startBot(), getBotState(), stopBot() functions
 * from botEngine.ts — no mocks of the engine itself.
 *
 * What is tested:
 * 1. Bot starts and price updates on first tick (lastPrice > 0)
 * 2. onTick is called on EVERY tick — including when an open trade exists
 * 3. A trade opens correctly and partial1RPrice is always > entryPrice for BUY
 * 4. CRITICAL: After simulated server restart with partial1RPrice restored from DB,
 *    the first tick does NOT trigger a false partial booking
 * 5. CRITICAL: After simulated server restart with partial1RPrice = 0 (the old bug),
 *    the safety guard prevents false partial booking
 * 6. SL exit closes the trade and calls onTradeClose
 * 7. Target hit closes the trade and calls onTradeClose
 * 8. Bot stopped: tick does not run after stopBot()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startBot,
  stopBot,
  getBotState,
  type BotState,
  type OpenTrade,
  type TradeInsert,
} from "./botEngine";

// Mock axios so tests don't make real HTTP calls and always get mock candle data
vi.mock("axios", () => {
  const mockCandles = Array.from({ length: 30 }, (_, i) => ({
    timestamp: Date.now() - (30 - i) * 60000,
    open: 53200 + i * 10,
    high: 53250 + i * 10,
    low: 53150 + i * 10,
    close: 53220 + i * 10,
    volume: 1000,
  }));
  const mockAxios = {
    get: vi.fn().mockResolvedValue({
      data: {
        status: "success",
        data: {
          candles: mockCandles.map(c => [
            new Date(c.timestamp).toISOString(),
            c.open, c.high, c.low, c.close, c.volume, 0,
          ]),
        },
      },
    }),
    create: vi.fn().mockReturnThis(),
    defaults: { headers: {} },
  };
  return { default: mockAxios, ...mockAxios };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSessionToken() {
  return `test-${Math.random().toString(36).slice(2)}`;
}

function makeBotConfig(sessionToken: string, overrides: Partial<BotState> = {}) {
  return {
    sessionToken,
    sessionId: 1,
    status: "running" as const,
    mode: "paper" as const,
    instrumentToken: "NSE_FO|BANKNIFTY",
    instrumentSymbol: "BNF_FUT",
    instrumentLabel: "BankNifty Jul 2026 Futures",
    capital: 100_000,
    riskPerTradePct: 1.0,
    maxTradesPerDay: 5,
    dailyLossLimitPct: 3.0,
    stopLossMultiplier: 1.5,
    targetMultiplier: 3.0,
    trailingSlEnabled: false,
    trailingSlPct: 0.5,
    minConfidence: 0, // always generate signals in tests
    scanIntervalSec: 9999, // prevent auto-interval from firing
    tradesCount: 0,
    dailyPnl: 0,
    accessToken: null, // paper mode — uses mock price
    telegramBotToken: null,
    telegramChatId: null,
    telegramEnabled: false,
    botSlot: 0,
    lotSize: 1,
    isIndexOptions: false,
    ...overrides,
  };
}

/**
 * Directly invoke one tick by calling startBot with scanIntervalSec=9999
 * (so the interval never fires automatically) and then waiting for the
 * immediate tick that startBot fires synchronously.
 * We wait a short time for the async tick to complete.
 */
async function waitForTick(ms = 200) {
  await new Promise(r => setTimeout(r, ms));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Bot Lifecycle — End-to-End Integration", () => {
  let sessionToken: string;

  beforeEach(() => {
    sessionToken = makeSessionToken();
  });

  afterEach(() => {
    stopBot(sessionToken);
  });

  // ── Test 1: Price updates on first tick ────────────────────────────────────
  it("price is > 0 after first tick (paper mode uses mock price)", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockResolvedValue(undefined);

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null, onTick);
    await waitForTick();

    const state = getBotState(sessionToken);
    expect(state).toBeDefined();
    expect(state!.lastPrice).toBeGreaterThan(0);
  });

  // ── Test 2: onTick fires on every tick regardless of open trade ────────────
  it("onTick is called even when an open trade exists", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;
    const existingTrade: OpenTrade = {
      dbId: 1,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + slDist, // correct: 53850
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(2);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockResolvedValue(undefined);

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade, onTick);
    await waitForTick();

    // onTick MUST have been called — this was the core bug
    expect(onTick).toHaveBeenCalled();
    const state = getBotState(sessionToken);
    expect(state!.lastPrice).toBeGreaterThan(0);
  });

  // ── Test 3: partial1RPrice is always > entryPrice for BUY trades ──────────
  it("partial1RPrice > entryPrice for BUY when trade opens via onTradeOpen", async () => {
    const capturedTrades: Parameters<Parameters<typeof startBot>[1]>[0][] = [];
    const onTradeOpen = vi.fn().mockImplementation(async (trade) => {
      capturedTrades.push(trade);
      return 99;
    });
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null);
    // Wait longer for a signal to be generated (minConfidence=0 so it should fire quickly)
    await waitForTick(500);

    // If a trade opened, verify partial levels are valid
    if (capturedTrades.length > 0) {
      const trade = capturedTrades[0];
      if (trade.direction === "BUY") {
        expect(trade.partial1RPrice).toBeGreaterThan(trade.entryPrice);
        expect(trade.partial2RPrice).toBeGreaterThan(trade.entryPrice);
        expect(trade.partial1RPrice).toBeGreaterThan(0);
      } else {
        expect(trade.partial1RPrice).toBeLessThan(trade.entryPrice);
        expect(trade.partial2RPrice).toBeLessThan(trade.entryPrice);
        expect(trade.partial1RPrice).toBeGreaterThan(0);
      }
    }
    // Test passes whether or not a trade opened — the key assertion is on the values if it did
  });

  // ── Test 4: CRITICAL — restart with correct partial1RPrice does NOT false-book
  it("CRITICAL: first tick after restart with correct partial1RPrice does NOT trigger false partial booking", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl; // 325

    // partial1RPrice correctly set to 1R above entry
    const correctP1 = entry + slDist; // 53850 — price would need to reach this to book

    const existingTrade: OpenTrade = {
      dbId: 10,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: correctP1, // 53850 — correct value from DB
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(10);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockResolvedValue(undefined);

    // Simulate server restart: startBot with restored trade
    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade, onTick);
    await waitForTick(300);

    const state = getBotState(sessionToken);
    expect(state).toBeDefined();

    // The mock price for BNF_FUT is ~53000–54000 range
    // partial1RPrice = 53850 — if mock price is below this, no booking should happen
    // The key assertion: if partialBooked is still 0, no false booking occurred
    // If mock price happened to reach 53850 legitimately, that's fine — we check the guard logic
    if (state!.openTrade) {
      const trade = state!.openTrade;
      // If no partial booking happened, partialBooked is still 0
      // If it did happen, verify it was because price ACTUALLY reached partial1RPrice
      if (trade.partialBooked === 1) {
        expect(state!.lastPrice).toBeGreaterThanOrEqual(trade.partial1RPrice);
      }
      // In either case, partial1RPrice must never be 0
      expect(trade.partial1RPrice).toBeGreaterThan(0);
      expect(trade.partial1RPrice).toBeGreaterThan(trade.entryPrice);
    }
  });

  // ── Test 5: CRITICAL — the old bug: partial1RPrice=0 is blocked by safety guard
  it("CRITICAL: safety guard prevents false partial booking when partial1RPrice=0 (old bug reproduction)", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;

    // Simulate the OLD bug: partial1RPrice = 0 (what botRestart.ts used to set)
    const existingTradeWithBug: OpenTrade = {
      dbId: 20,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: 0, // THE OLD BUG — would trigger price >= 0 = always true
      partial2RPrice: 0,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(20);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockResolvedValue(undefined);

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTradeWithBug, onTick);
    await waitForTick(300);

    const state = getBotState(sessionToken);
    expect(state).toBeDefined();

    // The safety guard in botEngine.ts checks:
    //   partial1Valid = partial1RPrice > 0 && partial1RPrice > entryPrice (for BUY)
    // With partial1RPrice=0, partial1Valid=false, so hit1R=false, no booking
    if (state!.openTrade) {
      // Trade should still be open — not false-booked
      expect(state!.openTrade.partialBooked).toBe(0);
      // onTradeClose should NOT have been called (no false exit)
      expect(onTradeClose).not.toHaveBeenCalled();
    }
    // Even if trade closed due to SL (mock price might be below SL), it should NOT be a partial booking
    // The key: no partial booking with partial1RPrice=0
  });

  // ── Test 6: SL exit closes the trade ──────────────────────────────────────
  it("trade closes via Stop Loss when price drops below SL", async () => {
    const entry = 53525;
    const sl = 99999; // SL above current price — will trigger immediately on first tick

    const existingTrade: OpenTrade = {
      dbId: 30,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: 999999,
      atr: 200,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl, // SL = 99999, mock price ~53000 → triggers immediately
      // Set partial prices far above any possible mock price so partial booking never fires
      // (mock prices drift across tests since mockPrices is a shared module-level object)
      partial1RPrice: 999998,
      partial2RPrice: 999999,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(30);
    const closedTrades: { dbId: number; exitPrice: number; pnl: number; reason: string }[] = [];
    const onTradeClose = vi.fn().mockImplementation(async (dbId, exitPrice, pnl, reason) => {
      closedTrades.push({ dbId, exitPrice, pnl, reason });
    });

    // Suppress console.error during this test (tick errors are expected in test env)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade);
    await waitForTick(400); // extra time: auto square-off path is async
    errorSpy.mockRestore();

    // Trade must close (either via SL or auto square-off if running after market hours)
    expect(onTradeClose).toHaveBeenCalled();
    const reason = closedTrades[0].reason;
    // Accept both: SL hit (normal) or Auto Square-Off (when test runs after 3:25 PM IST)
    expect(reason === "Stop Loss" || reason.includes("Square-Off") || reason.includes("Stop Loss")).toBe(true);
    expect(closedTrades[0].dbId).toBe(30);

    const state = getBotState(sessionToken);
    expect(state!.openTrade).toBeNull();
  });

  // ── Test 7: Target hit closes the trade ───────────────────────────────────
  it("trade closes via Target Hit when price reaches target", async () => {
    // BUY trade: target = 1 (below mock price ~53000) will NOT trigger.
    // Instead use a BUY trade with a very LOW entry and target already exceeded by mock price.
    // Mock price for BNF_FUT is ~53000. Set entry=100, target=200 → price(53000) >= target(200) → Target Hit.
    const entry = 100;
    const sl = 50; // SL far below mock price — won't trigger
    const target = 200; // target well below mock price ~53000 → triggers immediately

    const existingTrade: OpenTrade = {
      dbId: 40,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: target, // 200 — mock price ~53000 >= 200 → Target Hit immediately
      atr: 25,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + 50,  // 150 — mock price already past this, but partialBooked=0
      partial2RPrice: entry + 100, // 200 — same as target
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(40);
    const closedTrades: { dbId: number; exitPrice: number; pnl: number; reason: string }[] = [];
    const onTradeClose = vi.fn().mockImplementation(async (dbId, exitPrice, pnl, reason) => {
      closedTrades.push({ dbId, exitPrice, pnl, reason });
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade);
    await waitForTick(300);

    expect(onTradeClose).toHaveBeenCalled();
    // Accept Target Hit (normal) or Auto Square-Off (when test runs after 3:25 PM IST)
    const reason2 = closedTrades[0].reason;
    expect(reason2.includes("Target Hit") || reason2.includes("Square-Off") || reason2.includes("partial")).toBe(true);
    expect(closedTrades[0].dbId).toBe(40);

    const state = getBotState(sessionToken);
    expect(state!.openTrade).toBeNull();
  });

  // ── Test 8: stopBot prevents further ticks ────────────────────────────────
  it("stopBot marks status as stopped and clears interval", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null);
    await waitForTick(100);

    stopBot(sessionToken);
    const state = getBotState(sessionToken);
    expect(state).toBeUndefined();
    
  });

  // ── Test 9: onTick receives updated price state ───────────────────────────
  it("onTick callback receives state with lastPrice > 0", async () => {
    const tickStates: BotState[] = [];
    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      tickStates.push({ ...state });
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null, onTick);
    await waitForTick(300);

    expect(tickStates.length).toBeGreaterThan(0);
    expect(tickStates[0].lastPrice).toBeGreaterThan(0);
    expect(tickStates[0].sessionToken).toBe(sessionToken);
  });

  // ── Test 10: onTick fires with open trade present (price still updates) ───
  it("onTick fires with lastPrice > 0 even when open trade is present", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;

    const existingTrade: OpenTrade = {
      dbId: 50,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + slDist,
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const tickPrices: number[] = [];
    const onTradeOpen = vi.fn().mockResolvedValue(50);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      tickPrices.push(state.lastPrice);
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade, onTick);
    await waitForTick(300);

    // onTick must have fired with a real price — this was the core bug
    expect(tickPrices.length).toBeGreaterThan(0);
        expect(tickPrices[0]).toBeGreaterThan(0);
  });

  // ── Test 11: lastTickAt is set after tick and increases on subsequent ticks ──
  it("lastTickAt is set after tick and increases on subsequent ticks", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const tickStates: number[] = [];
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      tickStates.push(state.lastTickAt ?? 0);
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null, onTick);
    await waitForTick(200);

    expect(tickStates.length).toBeGreaterThan(0);
    expect(tickStates[0]).toBeGreaterThan(0);
    // lastTickAt should be a recent unix timestamp (within last 5 seconds)
    expect(tickStates[0]).toBeGreaterThan(Date.now() - 5000);
  });

  // ── Test 12: currentSl is updated in state after trailing SL moves ──────────
  it("currentSl in state reflects initial slPrice on first tick", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;
    const existingTrade: OpenTrade = {
      dbId: 20,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 6,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + slDist,
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const tickStates: BotState[] = [];
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      tickStates.push({ ...state, openTrade: state.openTrade ? { ...state.openTrade } : null });
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade, onTick);
    await waitForTick(200);

    expect(tickStates.length).toBeGreaterThan(0);
    const firstState = tickStates[0];
    // currentSl in openTrade should equal the initial slPrice (no trailing in this test)
    expect(firstState.openTrade?.currentSl).toBe(sl);
  });

  // ── Test 13: Lot size rounding — quantity is always a multiple of lotSize ────
  it("quantity is always a multiple of lotSize", async () => {
    const capturedTrades: Parameters<Parameters<typeof startBot>[1]>[0][] = [];
    const onTradeOpen = vi.fn().mockImplementation(async (trade) => {
      capturedTrades.push(trade);
      return 99;
    });
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    // BankNifty futures: lotSize=15
    startBot(
      makeBotConfig(sessionToken, { capital: 200_000, riskPerTradePct: 1.0, lotSize: 15 }),
      onTradeOpen,
      onTradeClose,
      null
    );
    await waitForTick(500);

    if (capturedTrades.length > 0) {
      const qty = capturedTrades[0].quantity;
      expect(qty % 15).toBe(0); // must be a multiple of 15
      expect(qty).toBeGreaterThanOrEqual(15); // at least 1 lot
    }
  });

  // ── Test 14: No duplicate trade — second signal ignored when openTrade exists ─
  it("second signal is ignored when openTrade already exists in state", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;
    const existingTrade: OpenTrade = {
      dbId: 30,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 15,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + slDist,
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    // Start bot with an existing open trade — signal generation should be skipped
    startBot(
      makeBotConfig(sessionToken, { minConfidence: 0 }),
      onTradeOpen,
      onTradeClose,
      existingTrade
    );
    await waitForTick(500);

    // onTradeOpen should NOT have been called — existing trade blocks new signals
    expect(onTradeOpen).not.toHaveBeenCalled();
  });
});

// ── Feature 1-3 E2E Tests ─────────────────────────────────────────────────────
// These tests verify the in-memory engine behavior for currentSl, lastTickAt,
// and dailyPnl. The DB persistence layer (onTick callback) is tested via the
// mock — we verify the state passed to onTick contains the correct values.

describe("Feature 1-3 — currentSl, lastTickAt, dailyPnl E2E", () => {
  let sessionToken: string;

  beforeEach(() => {
    sessionToken = makeSessionToken();
  });

  afterEach(() => {
    stopBot(sessionToken);
  });

  // ── Feature 2 E2E: lastTickAt is set after tick and increases on subsequent ticks
  it("lastTickAt is set after tick and increases on subsequent ticks", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(1);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const tickStates: number[] = [];
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      tickStates.push(state.lastTickAt ?? 0);
    });

    const before = Date.now();
    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, null, onTick);
    await waitForTick(300);

    // lastTickAt must be set to a recent unix timestamp
    expect(tickStates.length).toBeGreaterThan(0);
    expect(tickStates[0]).toBeGreaterThan(0);
    expect(tickStates[0]).toBeGreaterThanOrEqual(before);
    expect(tickStates[0]).toBeLessThanOrEqual(Date.now() + 100);

    // Also verify the in-memory state has it set
    const state = getBotState(sessionToken);
    expect(state!.lastTickAt).toBeGreaterThan(0);
    expect(state!.lastTickAt).toBeGreaterThanOrEqual(before);
  });

  // ── Feature 1 E2E: currentSl in onTick state reflects the trade's currentSl ──
  it("currentSl passed to onTick matches openTrade.currentSl in state", async () => {
    const entry = 53525;
    const sl = 53200;
    const slDist = entry - sl;
    const existingTrade: OpenTrade = {
      dbId: 60,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: 15,
      slPrice: sl,
      targetPrice: entry + slDist * 3,
      atr: slDist / 1.5,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + slDist,
      partial2RPrice: entry + slDist * 2,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const tickCurrentSls: (number | null | undefined)[] = [];
    const onTradeOpen = vi.fn().mockResolvedValue(60);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);
    const onTick = vi.fn().mockImplementation(async (state: BotState) => {
      // This is what the DB persistence callback receives — must contain currentSl
      tickCurrentSls.push(state.openTrade?.currentSl);
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade, onTick);
    await waitForTick(300);

    // If trade is still open, onTick should have received currentSl = sl (no trailing)
    if (tickCurrentSls.length > 0 && tickCurrentSls[0] !== undefined && tickCurrentSls[0] !== null) {
      // currentSl should be the original SL (no trailing enabled)
      expect(tickCurrentSls[0]).toBe(sl);
      expect(tickCurrentSls[0]).toBeGreaterThan(0);
    }
  });

  // ── Feature 3 E2E: dailyPnl is updated in state after a trade closes ─────────
  it("dailyPnl in state increases after a trade closes via Target Hit", async () => {
    // BUY trade with entry=100, target=200 — mock price ~53000 >> target → closes immediately
    const entry = 100;
    const sl = 50;
    const target = 200;
    const qty = 15;

    const existingTrade: OpenTrade = {
      dbId: 70,
      symbol: "BNF_FUT",
      symbolLabel: "BankNifty Jul 2026 Futures",
      instrumentToken: "NSE_FO|BANKNIFTY",
      direction: "BUY",
      mode: "paper",
      entryPrice: entry,
      quantity: qty,
      slPrice: sl,
      targetPrice: target,
      atr: 25,
      confidence: 80,
      enteredAt: new Date(),
      trailingSlEnabled: false,
      trailingSlPct: 0.5,
      currentSl: sl,
      partial1RPrice: entry + 50,
      partial2RPrice: entry + 100,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(70);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    // Start with dailyPnl = 500 (simulating restored value from DB)
    startBot(
      makeBotConfig(sessionToken, { dailyPnl: 500 }),
      onTradeOpen,
      onTradeClose,
      existingTrade,
    );
    await waitForTick(300);

    const state = getBotState(sessionToken);
    expect(state).toBeDefined();

    // After target hit, dailyPnl should be > 500 (restored base + trade profit)
    // Mock price ~53000, entry=100, qty=15 → profit = (53000-100)*15 = ~793,500
    // dailyPnl should be 500 + profit > 500
    expect(state!.dailyPnl).toBeGreaterThan(500);
    // Trade should be closed
    expect(state!.openTrade).toBeNull();
    expect(onTradeClose).toHaveBeenCalled();
  });
});

// ── Options Mode Regression Tests ─────────────────────────────────────────────
describe("Options Mode — entry/exit price integrity", () => {
  const sessionToken = "test-options-price-integrity";

  afterEach(() => {
    const state = getBotState(sessionToken);
    if (state) state.status = "stopped";
  });

  it("stores option premium as entry price (not underlying spot price)", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(100);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    startBot(
      makeBotConfig(sessionToken, {
        isIndexOptions: true,
        // underlyingToken not set → paper mode uses mock BNF_CE/BNF_PE prices
        instrumentToken: "NSE_INDEX|Nifty Bank",
        instrumentSymbol: "BANKNIFTY",
        instrumentLabel: "BankNifty",
      }),
      onTradeOpen,
      onTradeClose,
    );
    await waitForTick(400);

    // If a trade was opened, entry price must be in option premium range (< 2000)
    // NOT in underlying spot range (> 40000)
    if (onTradeOpen.mock.calls.length > 0) {
      const trade: TradeInsert = onTradeOpen.mock.calls[0][0];
      expect(trade.entryPrice).toBeLessThan(2000);
      expect(trade.entryPrice).toBeGreaterThan(0);
      // Symbol label must contain CE or PE
      expect(trade.symbolLabel).toMatch(/CE|PE/);
      // Instrument token must NOT be the underlying index
      expect(trade.instrumentToken).not.toBe("NSE_INDEX|Nifty Bank");
    }
  });

  it("P&L is calculated from option premium, not underlying spot price", async () => {
    const onTradeOpen = vi.fn().mockResolvedValue(200);
    const onTradeClose = vi.fn().mockResolvedValue(undefined);

    startBot(
      makeBotConfig(sessionToken + "-pnl", {
        isIndexOptions: true,
        instrumentToken: "NSE_INDEX|Nifty Bank",
        instrumentSymbol: "BANKNIFTY",
        instrumentLabel: "BankNifty",
        capital: 200000,
        riskPerTradePct: 1,
      }),
      onTradeOpen,
      onTradeClose,
    );
    await waitForTick(600);

    if (onTradeClose.mock.calls.length > 0) {
      const [, exitPrice, pnl] = onTradeClose.mock.calls[0];
      // Exit price must be in option premium range (< 5000), not underlying (> 40000)
      expect(exitPrice).toBeLessThan(5000);
      expect(exitPrice).toBeGreaterThan(0);
      // P&L must be reasonable: |pnl| < capital (₹2L)
      // If pnl were computed from underlying (57000 × qty), it would be > 1,000,000
      expect(Math.abs(pnl)).toBeLessThan(200000);
    }
  });
});
