export interface TradeExcursionInput {
  direction: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  bookedQty?: number;
  bookedPnl?: number;
  maxFavorablePnl?: number;
  maxAdversePnl?: number;
}

export interface TradeExcursions {
  maxFavorablePnl: number;
  maxAdversePnl: number;
}

/**
 * Record observed marked-to-market excursions for the complete trade in rupees.
 * Realised partial-booking P&L is retained while the remaining quantity is marked
 * at the current price. A missing prior extreme starts at zero, so a trade that
 * never moves in either direction exports 0 for both MFE and MAE.
 */
export function updateTradeExcursions(
  trade: TradeExcursionInput,
  markPrice: number,
): TradeExcursions {
  const remainingQuantity = Math.max(0, trade.quantity - (trade.bookedQty ?? 0));
  const unrealizedPnl = trade.direction === "BUY"
    ? (markPrice - trade.entryPrice) * remainingQuantity
    : (trade.entryPrice - markPrice) * remainingQuantity;
  const markedToMarketPnl = unrealizedPnl + (trade.bookedPnl ?? 0);

  return {
    maxFavorablePnl: Math.max(trade.maxFavorablePnl ?? 0, markedToMarketPnl),
    maxAdversePnl: Math.min(trade.maxAdversePnl ?? 0, markedToMarketPnl),
  };
}

/**
 * Include the final observed close P&L in the excursion range before persisting
 * MFE and MAE to the trade journal.
 */
export function finalizeTradeExcursions(
  trade: Pick<TradeExcursionInput, "maxFavorablePnl" | "maxAdversePnl">,
  totalPnl: number,
): TradeExcursions {
  return {
    maxFavorablePnl: Math.max(trade.maxFavorablePnl ?? 0, totalPnl),
    maxAdversePnl: Math.min(trade.maxAdversePnl ?? 0, totalPnl),
  };
}
