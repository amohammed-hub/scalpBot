# Fresh Audit — MASTER BUG LIST (Post-Fix Round 2)

## Bug #1 — HIGH: livePrices slot3 reports as slot 2
**File:** `server/routers.ts` lines 2220, 2230
**Problem:** `const slot = tok === input.sessionToken ? 0 : tok.endsWith("-slot1") ? 1 : 2;`
Slot3 (ending with `-slot3`) falls through to the `2` case. The frontend matches livePrices
to bot slots by `.slot` number, so slot3's live price overwrites slot2's data.
**Fix:** Add `tok.endsWith("-slot2") ? 2 : 3` to the ternary chain.

## Bug #2 — HIGH: Primary bot UPDATE path doesn't persist averagingEnabled, useV2Engine, unlimitedTrades, openingBurstEnabled
**File:** `server/routers.ts` lines 570-600 (UPDATE path in bot.start)
**Problem:** The INSERT path (line 630-632) persists `averagingEnabled`, `averagingLossThreshold`, `useV2Engine`.
But the UPDATE path (existing session) does NOT include these fields. After a restart,
the bot reads from DB and gets stale/default values for these fields.
Additionally, `unlimitedTrades` and `openingBurstEnabled` have NO schema column at all —
they can never survive a restart.
**Fix:** Add `averagingEnabled`, `averagingLossThreshold`, `useV2Engine` to the UPDATE .set() block.
For `unlimitedTrades` and `openingBurstEnabled`: add columns to schema, generate migration, apply SQL.

## Bug #3 — HIGH: Slot bot UPDATE path same persistence gap
**File:** `server/routers.ts` lines 2449-2469 (UPDATE path in startSecondary)
**Problem:** Same as Bug #2 — the slot bot UPDATE path doesn't persist averagingEnabled,
averagingLossThreshold, useV2Engine, unlimitedTrades, openingBurstEnabled.
**Fix:** Same as Bug #2.

## Bug #4 — MEDIUM: restoredDailyPnl in routers.ts still uses enteredAt (3 places)
**File:** `server/routers.ts` lines 496, 506, 1002, 2430
**Problem:** Bug #12 was fixed in `botRestart.ts` (uses exitedAt), but the same pattern
in `routers.ts` (bot.start, restart, startSecondary) still uses `gte(tradeLog.enteredAt, todayStart)`.
A carry-forward trade entered yesterday but closed today won't count in today's P&L.
**Fix:** Change `tradeLog.enteredAt` to `tradeLog.exitedAt` in the P&L restore queries.

## Bug #5 — MEDIUM: Risk score/stoplossGuard endpoints use "default" sessionToken
**File:** `server/routers.ts` lines 3472, 3476, 3494
**Problem:** `computeMarketRiskScore(candles, recentTrades, "default")` and
`getCachedRiskScore("default")` and `updateStoplossGuard(recentTrades, "default")`.
These store/read from a "default" key in the per-session Maps, which means:
- The Dashboard risk score is always from the "default" bucket, not the user's session
- The stoploss guard shown on Dashboard is from "default", not the user's actual guard state
This is cosmetic (the actual bot uses the correct session key), but confusing.
**Fix:** Pass `input.sessionToken` instead of `"default"`.

## Bug #6 — MEDIUM: resetHalt and resetDaily mutations reset ALL sessions (no session scoping)
**File:** `server/routers.ts` lines 3514, 3611
**Problem:** `resetPortfolioHalt()` with no arg clears the entire Map.
`resetDailyState()` with no arg clears all stoploss guards and cooldowns.
Any user calling these endpoints resets state for ALL sessions.
**Fix:** Accept sessionToken input and pass it to the functions.

## Bug #7 — LOW: getSlotTokens excludes slot3 for non-admin users
**File:** `server/routers.ts` line 4628
**Problem:** `getSlotTokens(sessionToken, includeSlot3)` only includes slot3 when `includeSlot3=true`.
The `allStatus` endpoint passes `input.isAdmin` as the flag. Non-admin users never see slot3 status.
However, `livePrices` hardcodes all 4 tokens including slot3. Inconsistency.
**Fix:** Always include slot3 in getSlotTokens (remove the conditional).

## Bug #8 — LOW: Shadow log and notifPrefs endpoints have no ownership check
**File:** `server/routers.ts` lines 1264-1278, 4314-4363
**Problem:** `getShadowSummary`, `clearShadowLog`, `notifPrefs.get`, `notifPrefs.update`
accept any sessionToken without verifying ownership. Any user can read/modify another's data.
**Fix:** Add `verifySessionOwnership(ctx, input.sessionToken)` to mutations.
(Reads are less critical since sessionToken is a UUID, but clearShadowLog is destructive.)

## Summary
| # | Severity | Category |
|---|----------|----------|
| 1 | HIGH | Slot3 livePrices misreporting |
| 2 | HIGH | Persistence gap (primary UPDATE) |
| 3 | HIGH | Persistence gap (slot UPDATE) |
| 4 | MEDIUM | enteredAt vs exitedAt in routers.ts |
| 5 | MEDIUM | "default" sessionToken in risk endpoints |
| 6 | MEDIUM | resetHalt/resetDaily affect all sessions |
| 7 | LOW | getSlotTokens excludes slot3 for non-admin |
| 8 | LOW | Missing ownership on shadow/notifPrefs |
