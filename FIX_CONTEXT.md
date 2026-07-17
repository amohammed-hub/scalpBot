# ORB Freshness Gate Fix Context

## Problem
ORB layer fires on EVERY candle after breakout (341 signals on Jul 17 FinNifty).
User's FinNifty trade: BUY CE at 09:48 (candle 33), SL hit at 09:56 = -817 loss.
Price was 40pts above ORB edge by then = chasing.

## User's Rules
1. ORB may only fire within 3 candles of ACTUAL breakout candle
2. After 3 candles, require price within 0.1% of breakout level
3. If price moved 40+ pts from ORB edge = CHASING, reject

## Current Implementation Status
- calcORBSignal now returns breakoutCandleIndex (MOST RECENT crossing)
- Freshness gate in Layer 6: strict 3-candle window, no proximity exception after
- Hard reject if distPct > 0.15% within 3-candle window

## Current Issue
- breakoutCandleIndex finds candle 17 (09:32 AM) as breakout (close=26713.5 > orbHigh=26708.1)
- But engine needs 20 candles minimum to generate signals
- So candle 29 (09:44, first candle engine CAN act on) is already 12 candles after breakout
- Fix needed: don't count candles before the engine's minimum data requirement (20 candles)
- Solution: in the backward search for breakoutCandleIndex, set minimum to max(orbMinutes, 20)
  OR: in the freshness gate, cap candlesSinceBreakout to not count candles before 20

## Verification Targets
- 09:48 entry should NOT happen (chasing) ✅ DONE
- 09:44 entry SHOULD happen (real breakout) ❌ NEEDS FIX
- Signal count < 30 for FinNifty ✅ DONE (21 signals)

## After ORB fix: Implement P1 (direction-aware cooldown)
- After SL on BUY CE, don't immediately re-enter BUY CE
- Need cooldown or require higher confidence for same direction
