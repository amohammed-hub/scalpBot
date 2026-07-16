# Signal Engine Upgrade Plan

## User's Requirements:
1. REVERT the expiry-day ban — same-day expiry has highest gamma = biggest moves for scalping
2. Improve signal QUALITY to avoid bad entries (the real problem)
3. Target: ₹10-20K/day with ₹1,00,000 capital
4. Volume filter is HARDCODED to 1.5 (bypassed) — need to restore for MCX (which HAS volume data)

## Current Signal Engine Issues (from code review):
1. **volRatio hardcoded to 1.5** (line 642) — ALL volume checks are bypassed! This was done because NSE index instruments have 0 volume. But MCX crude/gold DO have volume. Need conditional bypass.
2. **RSI range too wide** — Layer 3 (Trend) allows RSI 42-75 for BUY, which includes no-man's land (40-60)
3. **Momentum layer too easy** — Layer 4 only needs roc3 > 0.0003 (0.03%) which is noise
4. **No pullback requirement** — Bot enters immediately on signal without waiting for price to pull back to EMA/VWAP
5. **ADX threshold too low** — Layer 3 uses ADX > 15 (comment says "raised to 20" but code says 15)
6. **Same-day expiry ban** (lines 1471-1500) — REMOVE this, user wants it

## Improvements to Implement:
1. **Restore volume filter for MCX** — Only bypass for NSE index instruments (volume=0), use real volume for MCX
2. **Tighten RSI requirements** — BUY needs RSI < 40 (oversold bounce) OR RSI > 60 with strong momentum. No entries in 40-60 zone.
3. **Add RSI(7) fast RSI** — Use 7-period RSI for scalping (more responsive than 14)
4. **Require pullback to EMA/VWAP** — Don't chase, wait for price to touch EMA9 or VWAP before entry
5. **Fix ADX threshold** — Use ADX > 20 for trend layers (not 15)
6. **Increase momentum threshold** — roc3 > 0.001 (0.1%) minimum
7. **Add consecutive candle confirmation** — Require 2 consecutive candles in direction before entry
8. **REMOVE same-day expiry ban** — Revert lines 1471-1500

## MCX-Specific Expiry Logic:
- MCX crude oil options expire on the 15th-17th of each month (monthly)
- On expiry day, theta is highest but gamma is also highest = biggest moves
- Professional scalpers PREFER expiry day for quick in-and-out trades
- The key is: TIGHTER SL + FASTER EXIT on expiry day, not avoiding it

## Files to Modify:
1. server/botEngine.ts — signal generation logic (main changes)
2. No other files needed

## Implementation Order:
1. Revert expiry-day ban (remove lines 1471-1500 for NSE, and the MCX filter)
2. Fix volRatio — conditional bypass only for index instruments
3. Tighten RSI ranges in all layers
4. Add pullback requirement to Layer 3 (Trend) and Layer 4 (Momentum)
5. Fix ADX threshold
6. Increase momentum threshold
7. Add 2-candle confirmation filter
