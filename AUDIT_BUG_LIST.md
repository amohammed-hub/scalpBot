# MASTER BUG LIST — Phase 1 Discovery

## Severity Legend
- **CRITICAL**: Can cause financial loss, data corruption, or security breach
- **HIGH**: Functional defect that silently produces wrong results
- **MEDIUM**: Logic gap that may cause incorrect behavior under specific conditions
- **LOW**: Code quality issue, cosmetic, or minor inconsistency

---

| # | Severity | File | Line(s) | Description |
|---|----------|------|---------|-------------|
| 1 | **CRITICAL** | `server/activityLog.ts` | 48, 77, 88 | **Slot3 activity log orphaned.** Regex `/-slot[12]$/` only strips `-slot1` and `-slot2`. Slot3 bot events get a different `rootToken`, so they never appear in the shared activity feed. Should be `/-slot[123]$/`. |
| 2 | **CRITICAL** | `server/db.ts` | 819–834 | **Token migration misses slot3.** When a user logs in and gets a new session token, the migration remaps `upstoxCredentials`, `botSessions`, `tradeLog`, and `signalJournal` for primary + slot1 + slot2 only. Slot3 rows are orphaned — the admin bot loses its trade history and credentials after re-login. |
| 3 | **HIGH** | `server/precisionMetrics.ts` | 128, 304, 405 | **Analytics exclude slot3.** `computePrecisionMetrics`, `computeLayerAccuracy`, and `computeDailyReports` only query `[session, -slot1, -slot2]`. Slot3 trades/signals are invisible in performance reports. |
| 4 | **HIGH** | `server/riskManager.ts` | 64–66, 199–227, 487–497 | **Global portfolio halt state is not per-session.** `portfolioHalted` and `portfolioHaltReason` are module-level singletons. In a multi-user scenario (or even multi-slot), one user's drawdown halt affects all users. Additionally, `resetDailyState()` unconditionally clears the global halt — any single bot's daily reset clears the halt for everyone. |
| 5 | **HIGH** | `server/botEngine.ts` | 3951–3953 | **Opening Burst trade-taken flag set before entry gates.** `state.openingBurstTradeTaken = true` is set as soon as a non-HOLD burst signal is generated, BEFORE the signal passes through P1 cooldown, layer filter, direction block, max-trades check, exposure cap, option resolution, etc. If any gate rejects the signal, the burst is consumed for the day without a trade actually opening. |
| 6 | **MEDIUM** | `server/botEngine.ts` | 3180–3194 | **`dailyLossAcknowledged` not reset on new trading day.** The daily reset block resets `dailyPnl`, `tradesCount`, `status`, etc., but does NOT reset `dailyLossAcknowledged`. If a bot was started mid-day with existing losses (setting `dailyLossAcknowledged = true`), the next day it will never pause on new losses because the flag persists. |
| 7 | **MEDIUM** | `server/routers.ts` | 925–952 | **`setCarryForward` has no ownership check.** Unlike `bot.start`, `bot.stop`, `killSwitch`, and `startSecondary` which call `verifySessionOwnership()`, `setCarryForward` is a `publicProcedure` with no auth gate. Any caller who knows a session token can toggle carry-forward on another user's open trades. Same issue applies to `restart` (line 957), `forceAverage` (1238), `toggleShadow` (1249), `manualExit` (1278). |
| 8 | **MEDIUM** | `server/botEngine.ts` | 4750, 3956–3958 | **Opening Burst fast-scan is cosmetic.** Setting `state.nextScanAt = Date.now() + 15_000` has no effect because the tick loop runs on a fixed `setInterval` (line 4750). The interval is `Math.max(15, config.scanIntervalSec) * 1000`. If `scanIntervalSec` is 60, the bot still ticks every 60s regardless of `nextScanAt`. The `nextScanAt` field is only used for Dashboard display, not for actual scan scheduling. |
| 9 | **MEDIUM** | `server/botEngine.ts` | 3587, `drizzle/schema.ts` | **Averaging state not persisted to DB schema.** `averageCount`, `averagedAt`, and `originalEntryPrice` are tracked in-memory on `OpenTrade` but have no columns in `drizzle/schema.ts`. The DB persist block (line 3702–3724) writes `entryPrice`, `quantity`, `slPrice`, `targetPrice`, `partial1RPrice`, `partial2RPrice` but NOT `averageCount`. After a server restart, the bot can average the same trade AGAIN (double-averaging) because `averageCount` is lost. |
| 10 | **LOW** | `server/botEngine.ts` | 4750 | **`nextScanAt` misleads Dashboard.** The Dashboard shows "Next scan in Xs" based on `nextScanAt`, but the actual tick fires on a fixed interval. During Opening Burst, Dashboard shows "15s" but the real scan is 60s later. Minor UX confusion. |
| 11 | **LOW** | `server/routers.ts` | 927, 957, 1238, 1249, 1278 | **Multiple mutations missing `verifySessionOwnership`.** While the bot is single-user today, these endpoints accept any `sessionToken` without verifying the caller owns it. If multi-user is ever enabled, this becomes a security hole. Listed mutations: `setCarryForward`, `restart`, `forceAverage`, `toggleShadow`, `manualExit`. |
| 12 | **LOW** | `server/botRestart.ts` | 43–55 | **`restoredDailyPnl` uses `enteredAt` instead of `exitedAt`.** When computing today's P&L from closed trades, the query filters by `gte(tradeLog.enteredAt, todayStartUTC)`. A trade entered yesterday but closed today would be missed. Should filter by `exitedAt` (or both). |

---

## Summary

- **CRITICAL**: 2 bugs (slot3 orphaning in activity log + token migration)
- **HIGH**: 3 bugs (analytics exclude slot3, global portfolio halt, burst flag premature)
- **MEDIUM**: 4 bugs (dailyLossAcknowledged not reset, missing auth checks, burst fast-scan cosmetic, averaging not persisted)
- **LOW**: 3 bugs (nextScanAt misleading, auth gaps, restoredDailyPnl filter)

**Total: 12 bugs identified.**

---

## Recommended Fix Order (dependency-aware)

1. Bug #1 + #2 + #3 (slot3 consistency — all regex/token fixes together)
2. Bug #4 (portfolio halt per-session)
3. Bug #5 (Opening Burst flag after gates)
4. Bug #6 (dailyLossAcknowledged reset)
5. Bug #7 + #11 (auth checks)
6. Bug #9 (averaging schema + persistence)
7. Bug #12 (restoredDailyPnl filter)
8. Bug #8 + #10 (nextScanAt — cosmetic, low priority)
