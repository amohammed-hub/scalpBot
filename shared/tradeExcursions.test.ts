import { describe, expect, it } from "vitest";
import { finalizeTradeExcursions, updateTradeExcursions } from "./tradeExcursions";

describe("D10 trade excursions", () => {
  it("records the best and worst marked-to-market P&L for a long trade", () => {
    const initial = {
      direction: "BUY" as const,
      entryPrice: 100,
      quantity: 10,
    };

    const afterGain = updateTradeExcursions(initial, 108);
    const afterLoss = updateTradeExcursions({ ...initial, ...afterGain }, 96);

    expect(afterGain).toEqual({ maxFavorablePnl: 80, maxAdversePnl: 0 });
    expect(afterLoss).toEqual({ maxFavorablePnl: 80, maxAdversePnl: -40 });
  });

  it("uses direction-aware P&L for a short trade", () => {
    const afterFavorableMove = updateTradeExcursions({
      direction: "SELL",
      entryPrice: 100,
      quantity: 10,
    }, 94);
    const afterAdverseMove = updateTradeExcursions({
      direction: "SELL",
      entryPrice: 100,
      quantity: 10,
      ...afterFavorableMove,
    }, 104);

    expect(afterFavorableMove).toEqual({ maxFavorablePnl: 60, maxAdversePnl: 0 });
    expect(afterAdverseMove).toEqual({ maxFavorablePnl: 60, maxAdversePnl: -40 });
  });

  it("retains realised partial P&L while marking only the remaining quantity", () => {
    const excursions = updateTradeExcursions({
      direction: "BUY",
      entryPrice: 100,
      quantity: 10,
      bookedQty: 5,
      bookedPnl: 40,
    }, 104);

    expect(excursions).toEqual({ maxFavorablePnl: 60, maxAdversePnl: 0 });
  });

  it("includes the final close P&L before the journal is persisted", () => {
    expect(finalizeTradeExcursions({ maxFavorablePnl: 80, maxAdversePnl: -40 }, -65))
      .toEqual({ maxFavorablePnl: 80, maxAdversePnl: -65 });
  });
});
