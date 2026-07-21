# MCX CrudeOil Morning Trading — Root Cause Analysis

## Problem
CrudeOil bot is not getting any trades during morning hours (9 AM - 7:30 PM IST).

## Root Cause: NO DEDICATED MCX DAY-SESSION STRATEGY EXISTS

The signal generation path for MCX during 9:00 AM - 7:30 PM:

1. `inOpeningBurst` = false (NSE only, line 4038: `!isMCX`)
2. `inPowerHour` = false (NSE only, line 3975: `!isMCX`)
3. `inMCXEvening` = false (only 7:30-9:30 PM, line 4004-4006)
4. `inMCXLateSession` = false (only 9:30-11:20 PM, line 4020-4022)
5. `inHeroZeroWindow` = false (not an option instrument)
6. Falls into ELSE branch (line 4757) → uses generic V1/V2 signal engine

The generic V1/V2 engine (generateSignalV2 / generateSignal) is designed for NSE instruments.
It uses:
- Previous day high/low/close (from candlesDay) — which may be empty for MCX
- ORB strategy (best for 9:30-11:30 AM NSE, 9:15-10:00 AM MCX per comment)
- Supertrend, Momentum, VWAP strategies

## WHY NO TRADES ARE FIRING:

### Issue 1: `useV2Engine` defaults to FALSE for MCX Quick Launch
Settings.tsx handleLaunchMCX (line 655-684) does NOT pass `useV2Engine: true`.
routers.ts startSecondary defaults `useV2Engine` to `false`.
So MCX uses V1 engine (generateSignal) which has HIGHER confidence thresholds.

### Issue 2: V1 engine's minConfidence check
The V1 engine requires `confidence >= minConfidence` (default 60%).
For MCX during morning hours, the generic strategies often produce signals below 60%
because they're tuned for NSE volatility patterns.

### Issue 3: The GLOBAL ANTI-CHASING GATE (just added today)
The new anti-chasing gate (3 consecutive same-direction candles + >0.3% move) may be
too aggressive for MCX CrudeOil which trends strongly. CrudeOil can easily have 5-10
consecutive same-direction candles during a trend — the gate would block ALL entries.

### Issue 4: MCX market data availability
MCX market opens at 9:00 AM IST. If the bot was started before 9 AM, candles1m would
return empty → "No real candle data" → HOLD. After 9 AM, candles should be available.

### Issue 5: The `isIndexOptions` mode for MCX
routers.ts startSecondary (line 2426-2458) force-converts MCX_FO tokens into options mode.
If the MCX instrument is launched as options mode, the bot tracks the UNDERLYING for signals
but trades the OPTION. If option premium resolution fails, the trade entry is blocked.

## MOST LIKELY ROOT CAUSE (ranked):
1. **Anti-chasing gate too aggressive for MCX trending instruments** — CrudeOil trends hard,
   3 same-direction candles is NORMAL for crude. The 0.3% threshold is also too tight for crude
   which moves 1-2% in a single candle.
2. **V1 engine (not V2) being used** — V1 has fewer strategies and higher bars
3. **No MCX-specific day session strategy** — only evening (7:30 PM+) has dedicated logic

## FIX PLAN:
1. Exempt MCX instruments from the anti-chasing gate OR raise the threshold to 1% for MCX
2. Enable V2 engine by default for MCX launches
3. Consider adding a dedicated MCX day-session strategy (9:00 AM - 7:30 PM)
