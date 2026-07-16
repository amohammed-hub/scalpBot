# Full Codebase Audit — Bug List (Updated)

## Phase 1 DONE: Manual Average Override
- [x] forceAverageDown() in botEngine.ts
- [x] forceAverage procedure in routers.ts
- [x] Force Average button in Dashboard.tsx
- [x] TypeScript 0 errors

## CRITICAL BUGS FOUND

### BUG 1: 2R Partial Booking uses wrong quantity (botEngine.ts line 2333)
**File:** server/botEngine.ts line 2333
**Issue:** `const bookQty = Math.max(1, Math.floor(trade.quantity * 0.5));`
**Problem:** At 2R, 50% was already booked at 1R. The remaining is `trade.quantity - trade.bookedQty`.
The 2R should book 25% of ORIGINAL (which is 50% of remaining), NOT 50% of total.
So it should be: `Math.floor((trade.quantity - trade.bookedQty) * 0.5)` — this books 50% of remaining = 25% of original.
**Current behavior:** Books 50% of total qty AGAIN (double-booking — tries to sell more than remaining!)
**Fix:** `const bookQty = Math.max(1, Math.floor((trade.quantity - trade.bookedQty) * 0.5));`

### BUG 2: forceAverageDown uses state.lastPrice instead of option premium (botEngine.ts line 3391)
**File:** server/botEngine.ts line 3391
**Issue:** `const effectivePrice = state.lastPrice;`
**Problem:** For options trades (isIndexOptions=true), state.lastPrice is the UNDERLYING index price (e.g. 53000),
not the option premium (e.g. 59). Using this for averaging calculation gives completely wrong avg entry.
**Fix:** Use `state.optionPremiumPrice ?? state.lastPrice` for options trades, or fetch the real premium.

### BUG 3: Auto-restart config rebuild doesn't carry averaging settings
**File:** server/botRestart.ts (need to verify exact location)
**Issue:** When bot restarts from DB session, it rebuilds config but may not include averagingEnabled/averagingLossThreshold.
**Fix:** Add averagingEnabled and averagingLossThreshold to the config rebuild from DB session row.

### BUG 4: precisionMetrics layer name mismatch (precisionMetrics.ts)
**File:** server/precisionMetrics.ts lines 314-339
**Issue:** computeLayerAccuracy() uses regex-derived labels ("Supertrend", "MACD/BB", "EMA Cross", "Institutional")
that DON'T match the actual Signal.layer values ("Trend", "MACD_BB", "InstFootprint", "BoomingBulls").
**Impact:** Layer accuracy analytics are inaccurate/split across wrong categories.
**Fix:** Use the journal's `layer` field directly instead of regex-parsing signalReason.

### BUG 5: riskManager executeKillSwitch doesn't check order success (riskManager.ts)
**File:** server/riskManager.ts lines 296-313
**Issue:** Kill switch places live exit orders but doesn't check if placeUpstoxOrder() succeeded
before closing the trade in DB/in-memory state.
**Impact:** If order is rejected, trade is closed in DB but position remains open on Upstox.
**Fix:** Check return value of placeUpstoxOrder and only close in DB if order succeeded.

### BUG 6: effectivePrice for options uses Math.max(bid, ltp) — should use bid for exit
**File:** server/botEngine.ts line 2131
**Issue:** `const bestExitPrice = optQuote.bid > 0 ? Math.max(optQuote.bid, optQuote.ltp) : optQuote.ltp;`
**Problem:** For selling options (exit), the real price you get is the BID, not the max of bid/ltp.
If LTP > bid (common in illiquid options), using max gives inflated P&L display.
However, this was intentionally set to max for safety (bid can be stale/low).
**Decision:** Keep as-is — this is a conservative choice that prevents premature SL triggers from stale bids.
NOT A BUG — intentional design.

## MEDIUM BUGS

### BUG 7: Trailing SL message in Telegram shows wrong remaining qty
**File:** Need to check — the Telegram alert for trailing SL update may show total qty instead of remaining.
**Status:** Need to verify.

### BUG 8: Daily reset may not fire if bot runs across midnight
**File:** server/botEngine.ts — daily reset logic
**Issue:** If bot runs continuously past midnight IST, the daily reset check (lastTradingDay comparison)
should fire at 9:00 AM next day, not at midnight. Need to verify this is correct.
**Status:** Need to verify.

## AREAS STILL TO AUDIT
- Lines 2620-3100: Re-entry logic, new trade opening, signal processing
- Lines 3100-3340: Bot loop, startBot, stopBot
- server/routers.ts (3756 lines) — all procedures
- server/botRestart.ts (374 lines) — restart config rebuild
- server/riskManager.ts (361+ lines) — kill switch
- server/precisionMetrics.ts — layer accuracy
- client/src/pages/Dashboard.tsx (3200+ lines) — UI logic
- client/src/pages/Settings.tsx — settings
- All other pages
- drizzle/schema.ts — schema consistency
- server/db.ts — query helpers

## FIXES TO APPLY (BATCH)
1. Fix 2R partial booking qty (line 2333)
2. Fix forceAverageDown effectivePrice for options
3. Fix auto-restart averaging settings carry
4. Fix precisionMetrics layer name matching
5. Fix riskManager kill switch order check
