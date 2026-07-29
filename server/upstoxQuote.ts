export type UpstoxQuoteIdentity = {
  instrument_token?: unknown;
  last_price?: number;
  depth?: {
    buy?: Array<{ price?: number }>;
    sell?: Array<{ price?: number }>;
  };
};

/**
 * Upstox V2 full-market-quote responses are keyed by exchange and trading symbol
 * (for example, `NSE_EQ:NHPC`), not by the requested instrument key. The quote
 * payload's `instrument_token` field is therefore the authoritative identity.
 *
 * Never fall back to the first response object: doing so can bind an option
 * request to an unrelated underlying quote and corrupt entry price and P&L.
 */
export function selectRequestedUpstoxQuote<T extends UpstoxQuoteIdentity>(
  data: Record<string, T> | null | undefined,
  requestedInstrumentToken: string,
): T | null {
  if (!data || !requestedInstrumentToken) return null;

  const matches = Object.values(data).filter(
    quote => quote?.instrument_token === requestedInstrumentToken,
  );

  return matches.length === 1 ? matches[0] : null;
}
