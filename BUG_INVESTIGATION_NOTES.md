# Bug Investigation Notes (24 Jul 2026)

## SUMMARY OF ALL 4 BUGS — ROOT CAUSE ANALYSIS (24 Jul 2026)

### All bugs are interconnected via the option chain token/strike mismatch:

1. **Bug 2 (Wrong strike)**: Upstox option chain API returns strike_price=23800 in a row
   but the instrument_key in that SAME row actually maps to the 23900 CE contract.
   This is an Upstox API data inconsistency. Our code trusts both fields from the same row.
   FIX: Add post-resolution validation using /v2/option/contract to confirm the token's
   actual strike matches what the chain API reported.

2. **Bug 1 (Wrong P&L)**: Because the bot stores the wrong token (23900 CE token labeled as 23800),
   when it fetches the live premium via fetchFullQuote(token), it gets 23900 CE's premium.
   But the label says 23800 CE. If the bot is tracking 23800 CE's premium for P&L display
   (via delta approximation from the wrong base), the numbers won't match reality.
   FIX: Same as Bug 2 — fix the token/strike alignment.

3. **Bug 3 (Duplicate lots)**: The order_ids vs order_id parsing bug (already fixed) caused
   orders to be placed on Upstox but not recorded in DB. Next tick placed another order.
   The retry-loop prevention (cooldown + auto-pause after 3 rejections) is also deployed.
   REMAINING ISSUE: The thirdExclude in Capital-Aware OTM Fallback uses
   [...fallbackExclude, cheaperResolved.strike] instead of accumulating ALL excluded strikes.
   This means iteration 3 might re-select a previously tried strike.
   FIX: Accumulate excludes properly across iterations.

4. **Bug 4 (Trades not closing)**: Exit orders are placed using trade.instrumentToken.
   If this token maps to 23800 CE (wrong) but the actual Upstox position is 23900 CE,
   the exit order goes to the wrong contract → Upstox rejects (no position in 23800 CE).
   The bot then shows "EXIT ORDER FAILED" and keeps the trade open.
   FIX: Same as Bug 2 — fix the token so exits go to the correct contract.

### Additional fix needed:
- Capital-Aware OTM Fallback: accumulate excludeStrikes properly across all 3 iterations
- Add validation: after resolving option, fetch /v2/option/contract for the token to confirm strike
- Add detailed logging of resolved token + strike for debugging

## Bug 7: Wrong Strike Price (23800 in dashboard vs 23900 in Upstox)

**Root Cause:** The Upstox option chain API (`/v2/option/chain`) returns `strike_price` and `call_options.instrument_key` for each row. Our code at line 3378-3392 of botEngine.ts builds a sorted list by distance from underlying price, then picks 1-OTM. The `tradeLabel` uses `resolved.strike` (from the API's `strike_price` field) while the order is placed using `resolved.token` (from `call_options.instrument_key`).

**Hypothesis:** The Upstox API has a data inconsistency where `strike_price` in one row doesn't match the actual contract that `instrument_key` points to. OR the "Capital-Aware OTM Fallback" (line 5800+) re-resolves to a different strike but the label from the FIRST resolution is used.

**Key Code Flow:**
1. resolveAtmOptionToken (line 3314) → returns { token, premium, strike, expiry }
2. tradeLabel = formatOptionContractLabel(symbol, resolved.strike, ceOrPe, expiry) — line 5663
3. tradeInstrumentToken = resolved.token — line 5660
4. If premium × lotSize > capital → "Capital-Aware OTM Fallback" (line 5800+)
   - Re-resolves with excludeStrikes=[currentStrike]
   - Updates tradeInstrumentToken AND tradeLabel to the cheaper strike
5. Order placed with tradeInstrumentToken

**The fallback at line 5854 DOES update tradeLabel correctly.** So the mismatch must be in the initial resolution — the Upstox API returns wrong strike_price for the instrument_key.

**Fix needed:** After resolving the option, validate by fetching the instrument details for the token to confirm the strike matches. OR use the instrument_key to derive the strike (it's encoded in the key for NSE options).

## Bug 1: Incorrect Profit Display

**Root Cause:** The bot tracks P&L using `fetchFullQuote(realOptToken)` which fetches the premium for the token stored in `state.optionTradeToken`. But if the token corresponds to 23800 CE (wrong) while the actual Upstox position is 23900 CE, the P&L is calculated using the wrong option's premium.

**Calculation:** Entry=₹81.85, Dashboard P&L=+₹3507, qty=65. Implied current price = 81.85 + 3507/65 = ₹135.8. This is likely the LTP of 23800 CE (which is more ITM than 23900 CE). The actual position (23900 CE) has LTP ₹94.65.

**Fix:** Same as Bug 7 — fix the token/strike mismatch and P&L will be correct.

## Bug 3: Duplicate Lot Buying (130 qty = 2 lots)

**Root Cause:** The user's Upstox shows 130 qty for NIFTY 23900 CE (entry avg ₹81.50). 130 = 2 × 65 (2 lots). This is the same duplicate order bug from before — the order was placed, response parsed incorrectly (order_ids vs order_id), trade not recorded, next tick placed another order.

**Status:** Should be fixed by the order_ids parsing fix deployed earlier today. But the 130 qty position is from BEFORE the fix was deployed on Railway.

## Bug 4: Trades Not Auto-Closing

**Root Cause (multiple factors):**
1. **Wrong effectivePrice:** If the bot is tracking the wrong option token (23800 CE instead of 23900 CE), the effectivePrice will be wrong. SL/target comparison uses effectivePrice. If effectivePrice is ₹135.8 (23800 CE) but target is ₹94.13, the target would have been "hit" already (135.8 > 94.13). So the bot SHOULD have exited. Unless...
2. **Liquidity check freeze (line 4242):** If LTP hasn't moved >0.5% from entry, effectivePrice is frozen at entry. This prevents SL from ever firing in illiquid options.
3. **Exit order placement:** Even if exit is triggered, placeUpstoxOrder is called with `trade.instrumentToken` (line 4841). If this token is wrong (23800 CE token instead of 23900 CE), the exit order goes to the WRONG contract!
4. **Exit order for wrong qty:** If the bot recorded qty=65 but actual position is 130 (due to duplicate), the exit only closes half.

**Most likely scenario:** The exit DID trigger (target hit since effectivePrice=135.8 > target=94.13), but the exit order was placed on the WRONG instrument token (23800 CE instead of 23900 CE). Upstox rejected it because the user doesn't have a 23800 CE position. The bot then showed "EXIT ORDER FAILED" and kept the trade open.

## Upstox v3 API Notes
- Place order endpoint: `https://api-hft.upstox.com/v3/order/place`
- Response format: `{ status: "success", data: { order_ids: ["1644490272000"] } }` (ARRAY, not singular)
- v2 format was: `{ status: "success", data: { order_id: "1644490272000" } }` (singular string)
- Our code now handles both formats (fixed earlier today)

## Key Fix: Validate Option Token After Resolution

The instrument_key for NSE options encodes the strike. Example:
- `NSE_FO|NIFTY2572823800CE` → NIFTY 28 Jul 2026 23800 CE
- `NSE_FO|NIFTY2572823900CE` → NIFTY 28 Jul 2026 23900 CE

We should EXTRACT the strike from the instrument_key and compare with the API's strike_price field. If they don't match, use the one from the instrument_key (it's the truth).
