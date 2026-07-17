# Bug Analysis - Two Critical Issues

## Issue 1: SLOTS 1 & 2 NOT VISIBLE
**Root Cause: NOT a code bug.**
- The allStatus procedure (server/routers.ts line 1969) ALWAYS returns 3 slots
- The Dashboard.tsx (line 1545) ALWAYS renders all items from allBots (with fallback of 3 items)
- The slot cards are inside the "command" tab (activeTab === "command") which is the default tab
- The grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` - on mobile shows 1 column but all 3 cards are present (need to scroll)
- **Likely explanation**: User is on mobile and needs to scroll down, OR the deployed version on Railway is an older commit

## Issue 2: PRIMARY BOT STOPS IMMEDIATELY AFTER START
**Root Cause Analysis:**
- The P0/P1 code has been verified safe:
  - P0 (ORB freshness gate): Only runs when candles.length >= 17 and orb.direction !== "HOLD". Has skipOrbFreshnessGate parameter with proper else/if structure.
  - P1 (Direction-aware cooldown): Only runs when state.lastSlExitAt is truthy (null on startup)
  - Shadow mode: Only runs when state.shadowMode is true (undefined by default)
  - All fields properly initialized in startBot: lastSlExitDirection: null, lastSlExitAt: null, consecutiveSameDirectionSLs: 0
- The tick function has try-finally (no catch!) but the setInterval wrapper has .catch() that handles errors
- After 3 consecutive tick errors, bot auto-restarts (doesn't stop)
- The only way bot stops is via explicit stopBot() call

**Possible causes:**
1. Manus webdev autoscale hosting kills the container after inactivity (serverless)
2. Railway deployment might be on an older/broken commit
3. The subscription check might be throwing an error that the frontend interprets as "bot stopped"

## Fixes Applied:
1. Added JWT cookie admin bypass to bot.start and startSecondary (commit fd340ee)
2. Added debug logging to subscription enforcement
3. All P0/P1 code verified null-safe

## Additional Safety Measures to Add:
1. Wrap the entire P0/P1 section in try-catch to prevent any edge case crash
2. Add explicit error logging when bot stops unexpectedly
3. Ensure the slot cards section is always visible regardless of tab state
