# Bug Analysis Notes — Jul 22 Session

## Bug 1: Anti-Duplicate Cross-Bot Guard STILL BROKEN

**Evidence from trade report:**
- Bot 1 and Bot 2 BOTH bought GOLD 29JUL26 147000 CE at exact same time (17:21:03) at same price (₹470.5)
- Both exited at same time/price with same P&L (₹1332.25)
- This is a clear duplicate trade that the guard should have blocked

**Root Cause Analysis:**
- The cross-bot guard at line 5720-5775 in botEngine.ts checks `bots.entries()` 
- BUT `state.isOpeningTrade = true` is only set at line 5781 — AFTER the cross-bot guard check!
- So when Bot 1 and Bot 2 process the same tick simultaneously:
  1. Bot 1 reaches cross-bot guard → checks Bot 2 → Bot 2 has no openTrade AND isOpeningTrade=false → passes
  2. Bot 2 reaches cross-bot guard → checks Bot 1 → Bot 1 has no openTrade AND isOpeningTrade=false → passes
  3. Both set isOpeningTrade=true at line 5781 → both open the same trade

**Fix Required:** Move `state.isOpeningTrade = true` to BEFORE the cross-bot guard check (right after the DB guard check at line 5713). This way when Bot 2 checks Bot 1, it will see isOpeningTrade=true and block.

**Also:** The primary bot.start in routers.ts does NOT have a duplicate instrument check against other running bots (only startSecondary has it at line 2458). Need to add it to primary too.

## Bug 2: Premium Floor — NatGas ₹4.28 and Copper ₹9.43 Should Be Blocked at ₹30

**Evidence:**
- 12 trades on Jul 22 with entry premium below ₹30 (all NatGas options: ₹3.67-₹5.73)
- Total P&L from these: ₹-1,939 (net loss)
- User says Copper ₹9.43 also passed (from a different day or not in this export)

**Current code:** Premium floor was previously removed per user feedback (checkpoint 897eb982)
- The user NOW wants it back at ₹30 for MCX options

**Fix:** Add a hard block: if MCX option premium < ₹30, reject the trade

## Bug 3: Crude Oil Won't Load/Trade — Token Expired

**Evidence:**
- Jul 20 trades show "CRUDEOIL 17AUG26" — meaning the August contract IS the right one
- Token MCX_FO|560977 was updated in code but the bot shows "No real candle data"
- Jul 20 data confirms Crude Oil was working (5 trades, various premiums ₹448-₹626)
- The auto-resolution code exists but may not be triggering correctly

**Fix:** Verify the auto-resolution logic fires correctly. The issue may be that the hardcoded token in mcxInstruments.ts is checked first, and if Upstox returns empty candles for an expired token, the auto-resolution should kick in but may have a logic gap.

## Time Exit Analysis

**30 trades exited at 20min with "no momentum":**
- Win rate: 37% (11 wins, 19 losses)
- Total P&L: ₹-7,131 (net loss from these trades)
- Avg P&L: ₹-238 per trade

**Target Hit trades (held 31-54 min):**
- 3 trades, avg P&L: ₹7,120
- Gold CE hit target at 31 min (₹15,094)
- BankNifty PE hit target at 54 min (₹3,425)
- FinNifty PE hit target at 42 min (₹2,843)

**Recommendation:** Increase time exit from 20min to 45min
