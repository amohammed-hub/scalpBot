# EXHAUSTIVE CODEBASE AUDIT V2 — FINAL FINDINGS
# Status: Complete — all files audited

## NEW BUGS TO FIX (not yet fixed):

### BUG A: precisionMetrics.ts — UTC timezone used instead of IST
- Lines 96-271 and 395-473 use `toISOString().slice(0,10)` and `getHours()` for grouping
- Impact: Daily reports show wrong dates after 5:30 PM IST, wrong "best hour" analysis
- FIX: Add IST offset (+330 min) before date/hour extraction

### BUG B: precisionMetrics.ts — breakeven trades extend loss streak
- Lines 212-230: currentStreak logic counts P&L <= 0 as loss
- FIX: Treat P&L === 0 as neutral (break both streaks)

### BUG C: db.ts — OTP inserted before SMS send confirmation
- Lines 389-451: OTP row inserted into DB before Twilio SMS send
- FIX: Send SMS first, only insert OTP row if send succeeds

### BUG D: db.ts — sessionToken migration not in transaction
- Lines 458-537: multi-table UPDATE without transaction
- FIX: Wrap in transaction (or at minimum, catch errors and log)

### BUG E: botRestart.ts — MCX option trades treated as index tokens in stale cleanup
- Lines 312-325: Any MCX_FO token skips quote fetching
- FIX: Only bypass quote for NSE_INDEX tokens (MCX_FO options have real quotes)

### BUG F: botRestart.ts — UTC vs IST day boundary check
- Lines 283-286: Uses toISOString().slice(0,10) (UTC) mixed with IST todayDate
- FIX: Use consistent IST date for both

### BUG G: botEngine.ts line 2287 — 1R partial booking uses trade.quantity * 0.5
- After averaging, trade.quantity is doubled but bookedQty is 0
- Should use: (trade.quantity - (trade.bookedQty ?? 0)) * 0.5
- Impact: After averaging, books wrong qty (50% of doubled qty = original qty, not half of remaining)
- WAIT: Actually this is CORRECT behavior — after averaging, trade.quantity includes the averaged qty,
  and bookedQty is 0, so 50% of total is correct. NOT A BUG.

### BUG H: Dashboard.tsx — market timer doesn't account for weekends
- Timer shows countdown even on Saturday/Sunday
- FIX: Check day of week (0=Sun, 6=Sat) and show "Market Closed" on weekends

### BUG I: botEngine.ts line 2065 — stopScanMin = squareOffMin for NSE (both 15:25)
- Bot stops scanning at same time it square-offs — no buffer for Power Hour trades
- FIX: Set stopScanMin to 15:22 for NSE (3 min buffer before square-off at 15:25)

### BUG K: botRestart.ts — auto-restart doesn't carry lotSize from resolved option
- Lines 213-255: restart config doesn't include lotSize
- Impact: After restart, MCX lot size resets to 1 instead of actual lot (e.g., 100 for crude)
- FIX: Add lotSize to restart config

### BUG L: botEngine.ts — forceAverageDown doesn't update partial1RPrice/partial2RPrice
- Lines 3377-3482: Manual average override updates entry/SL/target but not partial levels
- FIX: Recalculate partial1RPrice and partial2RPrice after manual averaging

### BUG M: Dashboard.tsx — forceAverage button visible even when no open trade
- The button should only show when there IS an open trade and averaging hasn't been done yet
- FIX: Wrap in conditional check for openTrade existence

## ALREADY FIXED (from previous session):
- FIX 1: 2R partial booking wrong qty
- FIX 2: forceAverageDown options price bug
- FIX 3: Auto-restart averaging settings
- FIX 4: precisionMetrics layer names
- FIX 5: Kill switch order check
- FIX 6: Bot stop race condition
- FIX 9: Dashboard startMutation averaging settings
- FIX 10-11: Telegram alerts wrong qty
- FIX 12: 2R trailing SL direction
- FIX 13: Auto-averaging hardcoded threshold

## FIX IMPLEMENTATION PLAN:
1. precisionMetrics.ts: Add IST helper, fix streak logic (BUG A, B)
2. db.ts: Reorder OTP flow, add try-catch to migration (BUG C, D)
3. botRestart.ts: Fix MCX token check, IST date, add lotSize (BUG E, F, K)
4. botEngine.ts: Fix stopScanMin, fix forceAverageDown partial levels (BUG I, L)
5. Dashboard.tsx: Fix market timer weekends, forceAverage visibility (BUG H, M)
