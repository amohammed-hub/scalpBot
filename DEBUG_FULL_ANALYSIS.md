# Full Debug Analysis - Bot Crash Investigation
## Date: July 17, 2026

## Problem Statement
Bot 1 (slot0) and Bot 3 (slot2) start successfully (success toast shows) but immediately revert to "Stopped" in the UI. Bot 2 (slot1) works fine because it was restored by the watchdog.

## User's Key Insight (from screenshots at 8:50 PM)
- User GUARANTEES there is an uncaught exception in the signal engine
- User suspects: orbFreshnessGate, directionCooldown, or P0/P1 code
- User says: "STOP fixing frontend. The problem is SERVER-SIDE."

## Code Path Analysis

### bot.start procedure (routers.ts line 324):
1. Checks if bot already running → throws if yes
2. Subscription check (admin bypass via cookie)
3. Credential lookup (with FALLBACK to any credential)
4. Writes "running" to DB
5. Calls startBot() → puts bot in Map
6. Returns { success: true, sessionId }

### startBot function (botEngine.ts line 3769):
1. Clears existing interval if any
2. Creates new BotState with status "running"
3. Sets up _pendingOptionResolve if needed
4. Creates setInterval for periodic ticks
5. `bots.set(config.sessionToken, state)` → bot is in Map
6. Calls initial tick with .catch()

### tick function (botEngine.ts line 2353):
1. Checks state.status !== "running" → return
2. Checks tickInProgress → return
3. Sets tickInProgress = true
4. TRY block starts
5. Daily loss limit check → can set "paused"
6. Fetches candles (Promise.all)
7. If candles empty → HOLD + return
8. Time calculations
9. Daily reset
10. Square-off check (only if openTrade exists)
11. Open trade management (only if openTrade exists)
12. Signal generation
13. Shadow mode (if enabled)
14. P1 direction cooldown
15. Layer filter
16. Options resolution
17. Trade entry
18. CATCH block → logs error, re-throws
19. FINALLY → tickInProgress = false

### allStatus query (routers.ts line 1970):
- Returns `inMem?.status ?? dbRow?.status ?? "stopped"`
- If bot is in Map with status "running" → returns "running"
- If bot NOT in Map but DB says "running" → returns "running"
- Only returns "stopped" if bot NOT in Map AND DB doesn't say "running"

## Findings
1. ORB freshness gate: `lastBreakoutCandle` doesn't exist in code
2. Direction cooldown: has proper null guard `if (state.lastSlExitAt && state.lastSlExitDirection)`
3. All open trade sections guarded by `state.openTrade` checks
4. generateSignal has guards for empty candles and < 20 candles
5. Shadow mode has try-catch wrapper
6. onTick callback has .catch(() => {})
7. Initial tick has .catch() handler
8. Interval ticks have .catch() handler
9. No unhandledRejection handler in the codebase
10. The tick catch block RE-THROWS the error (propagates to .catch handlers)

## Key Contradiction
- User sees SUCCESS toast → bot.start procedure completed without error
- 500ms later, UI shows "Stopped" → allStatus returns non-running status
- This means either:
  A. Bot was removed from Map (only stopBot() does this)
  B. Bot status changed to non-running (only "paused" possible from tick)
  C. allStatus is querying wrong token
  D. There's a race condition we haven't identified

## Most Likely Root Cause Theory
The Railway deployment may be on an OLDER version of the code. The commit 77d726c (which has the latest fixes) was pushed to GitHub but Railway may not have auto-deployed it yet. The user's Railway deploy hash is 9a18cc07 which doesn't match any commit in our history.

## Action Plan
1. Add comprehensive debug logging to BOTH bot.start procedure AND tick function
2. Add logging to allStatus to show what it returns and why
3. Push to GitHub for Railway auto-deploy
4. User checks Railway logs after clicking Start on Bot 1

## Files to Modify
- server/routers.ts: Add logging to bot.start and allStatus
- server/botEngine.ts: Add TICK START log, add logging to startBot
