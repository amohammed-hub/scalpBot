# Bot Crash Analysis - July 17, 2026

## User's Key Insight (from screenshots)
The user GUARANTEES there is an uncaught exception in the signal engine that kills the bot loop.

Most likely candidates identified by user:
1. `orbFreshnessGate` accessing `lastBreakoutCandle` which is undefined on first tick
2. `directionCooldown` accessing `lastSLDirection` which is undefined before any trade
3. Something in the P0/P1 code that assumes trade history exists when bot just started

## Fix Pattern
```js
// WRONG (crashes on fresh start):
if (candle.index - lastBreakoutCandle.index > 3) { ... }

// RIGHT (handles first-run):
if (lastBreakoutCandle && candle.index - lastBreakoutCandle.index > 3) { ... }
```

## Key Observation
- Bot 2 (slot1) works because it was RESTORED by watchdog (not fresh-started)
- Bot 1 (slot0) and Bot 3 (slot2) fail because they are FRESH starts
- Fresh starts have empty candles[], no trade history, undefined state fields
- The crash happens on the FIRST TICK after a fresh start

## Investigation Plan
1. Search for `lastBreakoutCandle` access without null guard
2. Search for `lastSLDirection` access without null guard  
3. Search for any property access on potentially undefined values in tick function
4. Focus on code that runs on FIRST tick (when candles are empty or just loaded)
