# FINAL AUDIT FIXES TO APPLY

## CONFIRMED BUGS (5 critical fixes)

### FIX 1: 2R Partial Booking uses wrong quantity
**File:** server/botEngine.ts line 2333
**Current:** `const bookQty = Math.max(1, Math.floor(trade.quantity * 0.5));`
**Fix:** `const bookQty = Math.max(1, Math.floor((trade.quantity - trade.bookedQty) * 0.5));`
**Why:** At 2R, 50% was already booked. Using trade.quantity * 0.5 tries to sell same amount again (double-booking).

### FIX 2: forceAverageDown uses underlying price instead of option premium
**File:** server/botEngine.ts line 3391
**Current:** `const effectivePrice = state.lastPrice;`
**Fix:** 
```
const trade = state.openTrade;
const effectivePrice = (trade.isIndexOptions && state.optionPremiumPrice && state.optionPremiumPrice > 0)
  ? state.optionPremiumPrice
  : state.lastPrice;
```
**Why:** state.lastPrice is the underlying index (e.g. 53000), not the option premium (e.g. 59).

### FIX 3: Auto-restart doesn't carry averaging settings
**File:** server/botRestart.ts line 248 (before closing brace of config object)
**Add:**
```
averagingEnabled: session.averagingEnabled ?? true,
averagingLossThreshold: session.averagingLossThreshold ?? 0.20,
```
**Why:** On cold restart/watchdog restore, averaging settings are lost.

### FIX 4: precisionMetrics layer name mismatch
**File:** server/precisionMetrics.ts lines 314-339
**Current:** Uses regex patterns to match trades to layers via signalReason text.
**Fix:** First try to match via tradeLog's signalReason containing the layer name in brackets (e.g. "[Trend]", "[MACD+BB]", "[InstFootprint]"),
then fall back to regex. Also update the layerPatterns to match actual bot layer names:
- "Supertrend" → "Supertrend" (correct)
- "MACD/BB" → "MACD_BB" (fix key name to match bot)
- "EMA Cross" → "Trend" (fix - bot calls it "Trend" layer)
- "Institutional" → "InstFootprint" (fix key name)
- Add "BoomingBulls", "VWAPPullback", "VWAPReversion", "HourlyClose"

### FIX 5: riskManager executeKillSwitch doesn't check order success
**File:** server/riskManager.ts lines 296-299
**Current:**
```
if (trade.mode === "live" && bot.accessToken) {
  const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
  await placeUpstoxOrder(bot.accessToken, trade.instrumentToken, exitDir, (trade.quantity - (trade.bookedQty ?? 0)));
}
```
**Fix:**
```
if (trade.mode === "live" && bot.accessToken) {
  const exitDir = trade.direction === "BUY" ? "SELL" : "BUY";
  const killOrderId = await placeUpstoxOrder(bot.accessToken, trade.instrumentToken, exitDir, (trade.quantity - (trade.bookedQty ?? 0)));
  if (!killOrderId) {
    console.error(`[KillSwitch] EXIT ORDER FAILED for ${trade.symbolLabel ?? trade.symbol} — position still open on Upstox!`);
    continue; // Don't close in DB if order failed
  }
}
```
**Why:** If order is rejected, trade is closed in DB but position remains open on Upstox.

## ADDITIONAL ISSUES FOUND (lower priority)

### ISSUE 6: Telegram trailing SL alert shows total qty
**Status:** Verified NOT a bug — the trailing SL code doesn't send a Telegram alert, it only updates currentSl silently.

### ISSUE 7: Daily reset timing
**Status:** Verified CORRECT — daily reset uses `lastTradingDay` comparison with IST date string, fires at first tick of new trading day (9:15 AM).

### ISSUE 8: BotState interface missing tickCount and lastHeartbeatAt
**Status:** These are added dynamically (as `any` properties). Not critical but could add to interface for type safety.

## FRONTEND AUDIT NOTES
- Dashboard.tsx: No critical bugs found in UI logic. The new features (timer, rejected signals, averaging indicator) are correctly wired.
- Settings.tsx: Averaging toggle correctly saves to localStorage and passes to startBot.
- All other pages: Functional, no logic bugs detected.

## SCHEMA AUDIT
- drizzle/schema.ts: averagingEnabled and averagingLossThreshold columns added correctly.
- All foreign keys and relations are consistent.
