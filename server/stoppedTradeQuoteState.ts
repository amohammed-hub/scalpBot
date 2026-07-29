import {
  isOptionTrade,
  type OptionTradeDescriptor,
} from "../shared/optionTradeIdentity";

export interface StoppedTradeQuoteState {
  isIndexOptions: boolean;
  optionPremiumPrice: null;
  optionQuoteStatus: "unavailable" | null;
  optionQuoteUpdatedAt: null;
}

/**
 * A stopped session has no in-memory quote tied to the exact open contract.
 * Persisted option trades must therefore be serialized as unavailable rather
 * than inheriting the last underlying/futures price from bot_sessions.
 */
export function getStoppedTradeQuoteState(
  descriptor: OptionTradeDescriptor,
): StoppedTradeQuoteState {
  const isIndexOptions = isOptionTrade(descriptor);

  return {
    isIndexOptions,
    optionPremiumPrice: null,
    optionQuoteStatus: isIndexOptions ? "unavailable" : null,
    optionQuoteUpdatedAt: null,
  };
}
