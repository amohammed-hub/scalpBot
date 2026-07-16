# EXHAUSTIVE CODEBASE AUDIT V2 — July 16, 2026
# Status: In progress — botEngine.ts lines 1-2300 audited

## BUGS FOUND (NEW — not yet fixed):

### BUG A: precisionMetrics.ts — UTC timezone used instead of IST
- Lines 96-271 and 395-473 use `toISOString().slice(0,10)` and `getHours()` for grouping
- Trading days and best/worst hours are based on UTC, NOT IST
- Impact: Daily reports show wrong dates after 5:30 PM IST, wrong "best hour" analysis
- FIX: Convert to IST before date/hour extraction

### BUG B: precisionMetrics.ts — breakeven trades extend loss streak
- Lines 212-230: currentStreak logic counts any non-positive trade in loss branch
- Breakeven (P&L = 0) should break a loss streak, not extend it
- FIX: Treat P&L === 0 as neutral (break both streaks)

### BUG C: db.ts — OTP inserted before SMS send confirmation
- Lines 389-451: OTP row is inserted into DB before Twilio SMS is confirmed sent
- If SMS fails, a valid OTP code exists in DB but user never received it
- Impact: Rate limit consumed, stale codes in DB
- FIX: Send SMS first, only insert OTP row if send succeeds

### BUG D: db.ts — sessionToken migration not in transaction
- Lines 458-537: verifyOtp performs multi-table sessionToken migration without transaction
- If any UPDATE fails mid-way, some tables have old token, some have new
- Impact: Orphaned data, broken session continuity
- FIX: Wrap in transaction

### BUG E: botRestart.ts — MCX option trades treated as index tokens
- Lines 312-325: Stale trade cleanup treats MCX_FO tokens as index case
- Skips real quote fetching for MCX option trades, falls back to entry price
- Impact: Stale MCX option trades closed at entry price (wrong P&L)
- FIX: Only bypass quote for NSE_INDEX tokens, not MCX_FO

### BUG F: botRestart.ts — UTC vs IST day boundary check
- Lines 283-286: Uses toISOString().slice(0,10) mixed with manual IST shift
- Day boundary detection may fail during 00:00-05:30 UTC (5:30 AM-11:00 AM IST)
- FIX: Use consistent IST date computation

### BUG G: botEngine.ts line 2287 — 1R partial booking uses trade.quantity * 0.5 instead of remaining qty
- If trade was already averaged (qty doubled), booking 50% of ORIGINAL qty is wrong
- Should be: Math.max(1, Math.floor((trade.quantity - (trade.bookedQty ?? 0)) * 0.5))
- Impact: After averaging, partial booking books wrong amount

### BUG H: Dashboard.tsx — market timer doesn't account for weekends/holidays
- Timer shows countdown even on Saturday/Sunday when market is closed
- FIX: Check day of week before showing timer

### BUG I: botEngine.ts — stopScanMin for NSE is same as squareOffMin (15:25)
- Line 2065: stopScanMin = 15:25, squareOffMin = 15:25 for NSE
- This means the bot stops scanning AND square-offs at the SAME time
- Power Hour trades at 15:20-15:24 have 0-5 minutes to work before force-close
- FIX: Set stopScanMin to 15:20 for NSE (5 min buffer before square-off)

### BUG J: botEngine.ts line 2215-2218 — bookedPnlAddedToDaily double-counting
- When bookedPnlAddedToDaily is true, only remaining P&L is added to dailyPnl
- When false, both remaining + bookedPnl are added
- But bookedPnl was already added to dailyPnl during partial booking (line ~2305)
- So if bookedPnlAddedToDaily is true, the code is correct
- If false, it DOUBLE-COUNTS the booked P&L
- This flag seems to be set correctly at line ~2305, so this is actually OK
- VERIFY: check if bookedPnlAddedToDaily is always set when bookedPnl is added

## STILL TO AUDIT:
- botEngine.ts lines 2300-3533 (trailing SL, averaging, signal rejection, trade open, restart)
- routers.ts (3759 lines) — quick scan for critical issues
- Dashboard.tsx (3328 lines) — quick scan for UI bugs
- Settings.tsx, other pages
- db.ts OTP flow fix
- botRestart.ts MCX token fix

## ALREADY FIXED IN PREVIOUS SESSION:
- 2R partial booking wrong qty (FIX 1)
- forceAverageDown options price bug (FIX 2)
- Auto-restart averaging settings (FIX 3)
- precisionMetrics layer names (FIX 4)
- Kill switch order check (FIX 5)
- Bot stop race condition (status query)
- Dashboard startMutation not passing averaging settings (FIX 9)
- Telegram 1R/2R alerts wrong qty (FIX 10, 11)
- 2R trailing SL direction (FIX 12)
- Auto-averaging hardcoded threshold (FIX 13)
