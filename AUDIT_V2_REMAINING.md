# Audit V2 — Remaining Fixes Applied

## Bugs Fixed in This Pass:

### BUG A: precisionMetrics.ts — UTC timezone for IST trades
- All date grouping used `.toISOString().slice(0,10)` which is UTC, not IST
- Trades at 9:30 PM IST would be grouped to the NEXT day in UTC
- FIX: Added `toISTDateKey()` and `toISTHour()` helpers, replaced all date extraction

### BUG B: precisionMetrics.ts — Breakeven trades counted as losses in streak
- `else` branch counted breakeven (pnl=0) as losses
- FIX: Added explicit `else if (pnl < 0)` for losses, `else` resets both streaks

### BUG C: db.ts — OTP inserted before SMS send (orphan OTP rows on failure)
- FIX: Move DB insert AFTER successful Twilio send

### BUG D: db.ts — Token migration not wrapped in try-catch
- If any migration UPDATE fails, the entire login would fail
- FIX: Wrapped in try-catch, login succeeds even if migration fails

### BUG E: botRestart.ts — MCX_FO treated as index token
- `isIndexToken` check included MCX_FO which is NOT an index
- FIX: Only NSE_INDEX is treated as index token

### BUG F: botRestart.ts — enteredAt date comparison uses UTC not IST
- FIX: Added IST offset to enteredAt before comparing dates

### BUG G: UpstoxCallback.tsx — Double-decode of URL params
- URLSearchParams.get() already decodes, then decodeURIComponent was applied again
- FIX: Removed extra decodeURIComponent

### BUG H: Dashboard.tsx — Market timer shows "in session" on weekends
- FIX: Added weekend check (day 0 or 6) to show "Weekend — Market closed"

### BUG I: botEngine.ts — stopScanMin = squareOffMin for NSE (both 15:25)
- Bot would try to open trades at 15:24 and immediately square off at 15:25
- FIX: Set stopScanMin to 15:22 (3 min buffer before square-off)

### BUG J: Dashboard.tsx — activeTrade missing averageCount/originalEntryPrice
- The activeTrade construction from inMemOpenTrade didn't include these fields
- Dashboard used (activeTrade as any).averageCount which was always undefined
- FIX: Added averageCount and originalEntryPrice to activeTrade construction

### BUG K: UpstoxCallback.tsx — setTimeout not cleaned up on unmount
- FIX: Added cleanup return in useEffect

## Still to check:
- Run final TypeScript check and tests
- Push to GitHub for Railway deploy
