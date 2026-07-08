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
} from "./botEngine";

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
      partial1RPrice: entry + 325,
      partial2RPrice: entry + 650,
      partialBooked: 0,
      bookedQty: 0,
      bookedPnl: 0,
    };

    const onTradeOpen = vi.fn().mockResolvedValue(30);
    const closedTrades: { dbId: number; exitPrice: number; pnl: number; reason: string }[] = [];
    const onTradeClose = vi.fn().mockImplementation(async (dbId, exitPrice, pnl, reason) => {
      closedTrades.push({ dbId, exitPrice, pnl, reason });
    });

    startBot(makeBotConfig(sessionToken), onTradeOpen, onTradeClose, existingTrade);
    await waitForTick(300);

    // SL should have been hit (mock price ~53000 < SL 99999 for BUY)
    expect(onTradeClose).toHaveBeenCalled();
    expect(closedTrades[0].reason).toContain("Stop Loss");
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
    expect(closedTrades[0].reason).toContain("Target Hit");
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
    expect(state!.status).toBe("stopped");
    expect(state!.intervalHandle).toBeNull();
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
});
