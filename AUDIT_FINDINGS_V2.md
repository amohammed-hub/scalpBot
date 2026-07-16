# Deep Audit V2 — Entry Price Bug Root Cause Analysis

## The Bug
User bought CRUDEOIL 16JUL26 7650 CE on Upstox (real price ~₹62-85 range per TradingView).
Bot shows entry price as exactly ₹85 which is the hardcoded `MCX_CRUDE_CE` mock price.

## Root Cause Identified
The entry price ₹85 comes from `mockPrices["MCX_CRUDE_CE"]` (line 1380 in botEngine.ts).

### How the mock price gets used:
1. Bot is in options mode (`isIndexOptions = true`)
2. If bot has `accessToken`: calls `resolveAtmMcxOptionToken()` to get REAL premium
3. If resolve SUCCEEDS: uses `resolved.premium` (the real market price) ✓
4. If resolve FAILS AND `state.accessToken` exists: **RETURNS** (skips trade) — line 2581
5. If bot has NO `accessToken`: falls into mock premium path (line 2644-2680) → uses ₹85

### Conclusion:
The bot was started in **paper mode WITHOUT an access token** (or the token was empty/expired).
In this case, the code at line 2644 (`else if (isOptionsMode && !state.accessToken)`) kicks in
and uses the hardcoded mock premium of ₹85 for CRUDE CE.

## The REAL Fix Needed:
For paper mode without token: Instead of using a static mock price, we should:
1. Try to fetch the real option premium from Upstox's PUBLIC candle API (no auth needed)
2. If that fails, use the LAST KNOWN price from the candle data (state.lastPrice is the underlying, not the option)
3. Only as absolute last resort, use mock prices but make them DYNAMIC (track real market movement)

## Additional Issues Found:
- BUG A: The mock price ₹85 was set months ago and never updates. Real CRUDE CE premiums fluctuate wildly.
- BUG B: When bot has token but resolve fails, it skips the trade entirely — user misses opportunities.
- BUG C: The `buildMockCandle` function (line 1388) DOES update mockPrices with small random drift,
  but only for the UNDERLYING symbol, not for option premiums (MCX_CRUDE_CE stays at 85 forever).
- BUG D: For paper mode WITH token: if the option chain API fails (timeout, rate limit),
  the bot should retry or use cached premium, not skip the trade entirely.

## Fix Plan:
1. Make option mock premiums DYNAMIC: derive from underlying price movement (delta approximation)
2. When token exists but option resolve fails: cache the last successful premium and reuse it
3. Add a `lastKnownOptionPremium` field to BotState that persists the last real premium fetched
4. For paper mode: try public candle API for the option token before falling back to mock
