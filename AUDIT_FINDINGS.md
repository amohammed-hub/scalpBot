# Full Codebase Audit — Master Bug List

## Critical Bugs (Severity: HIGH)

### BUG-1: dailyPnl double-counting with partial profit bookings
- **File**: `server/botEngine.ts` line 2452, 2498, 2759-2762
- **Issue**: When partial profit is booked (50% at 1R, 25% at 2R), `state.dailyPnl += bookPnl` is called immediately. When the trade finally closes, the code checks `trade.bookedPnlAddedToDaily` flag — if true, only adds `remainPnl`. BUT if the server restarts between partial booking and trade close, `bookedPnlAddedToDaily` is NOT persisted to DB. On restart, the restored trade has `bookedPnl` from DB but `bookedPnlAddedToDaily` is false (in-memory only), so the close logic adds `totalPnl = remainPnl + bookedPnl` — double-counting the partial booking.
- **Fix**: Persist `bookedPnlAddedToDaily` to DB alongside `bookedPnl`, OR always compute dailyPnl from DB trade records on restart instead of accumulating.

### BUG-2: Session token migration without transaction (data corruption risk)
- **File**: `server/db.ts` lines 507-530
- **Issue**: `verifyOtp()` migrates session tokens across 5 tables (upstoxCredentials, botSessions, tradeLog, signalJournal, subscriptions) with 13 separate UPDATE statements, NO transaction wrapping. If any statement fails mid-way, data is split between old and new tokens — some records under old token, some under new. The `catch` block just logs and continues, leaving data in an inconsistent state.
- **Fix**: Wrap all migration UPDATEs in a single transaction. If any fails, rollback all.

### BUG-3: layerTracker global state shared across ALL users/sessions
- **File**: `server/layerTracker.ts` lines 24-26
- **Issue**: `manualOverrides` and `autoDisabled` Maps are keyed by layer name ONLY (e.g., "Breakout", "VWAP"). If one user's bot triggers auto-disable for "Breakout" layer, ALL other users' bots also see that layer as disabled. In a multi-user system, this is a critical cross-user interference bug.
- **Fix**: Key the maps by `sessionToken:layer` or pass sessionToken to all functions.

### BUG-4: riskManager global state shared across ALL bot slots
- **File**: `server/riskManager.ts` lines 52-65
- **Issue**: `stoplossGuard`, `portfolioHalted`, `cachedRiskScore` are module-level singletons. If Slot 1 hits 3 consecutive SLs, ALL slots (Primary, Slot 2) get paused by StoplossGuard. `resetDailyState()` clears ALL cooldowns for ALL sessions. This may be partially intentional (portfolio-level protection) but the StoplossGuard should be per-session.
- **Fix**: Make StoplossGuard per-session (Map keyed by sessionToken). Keep portfolio halt as global (intentional).

### BUG-5: allBots query returns empty when DB connection fails silently
- **File**: `server/routers.ts` lines 1911-1918
- **Issue**: The `allStatus` query loops through slotTokens doing individual DB queries. If `db` is null (line 1911 check), the `dbRows` object stays empty and the function returns 3 items with all-null data. BUT if `db` is truthy but a query throws (connection timeout, etc.), the error propagates and the entire query fails — returning undefined to the frontend. The frontend does `(allBots ?? []).map(...)` which renders nothing.
- **Fix**: Wrap the DB queries in try/catch so individual slot failures don't crash the entire query.

### BUG-6: Averaging DB persist uses String() for float columns
- **File**: `server/botEngine.ts` lines 2658-2664
- **Issue**: `await db.update(tl).set({ entryPrice: String(newAvgEntry), ... })` — the schema defines `entryPrice` as `float()`, but the persist code wraps values in `String()`. Drizzle ORM may coerce this correctly, but it's type-unsafe and could silently fail or store wrong values depending on locale (e.g., "1,234.56" vs "1234.56").
- **Fix**: Remove `String()` wrappers — pass raw numbers directly.

## Medium Bugs (Severity: MEDIUM)

### BUG-7: Timezone calculation inconsistency in averaging logic
- **File**: `server/botEngine.ts` line 2551
- **Issue**: Uses `new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }))` which is unreliable (depends on locale parsing, can fail on some Node.js versions/Docker images). The rest of the file uses proper UTC offset: `((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % 1440`.
- **Fix**: Replace with consistent UTC offset calculation.

### BUG-8: dailyLossUsed calculation counts profits as losses
- **File**: `server/botEngine.ts` line 2556
- **Issue**: `dailyLossUsed = Math.abs(state.dailyPnl) / (state.capital * state.dailyLossLimitPct / 100)` — `Math.abs()` means if dailyPnl is +5000 (profit), it counts as 5000 "loss used", blocking averaging even when the day is profitable.
- **Fix**: `Math.abs(Math.min(0, state.dailyPnl))` — only count actual losses.

### BUG-9: activityLog clearActivity wipes all slots
- **File**: `server/activityLog.ts` lines 83-89
- **Issue**: `clearActivity` deletes the root-token log. Since all 3 slots share one combined log (normalized to root token), clearing from one slot wipes the visible history for all slots.
- **Fix**: Either make logs per-slot, or don't expose clearActivity per-slot.

### BUG-10: Bot status shows "Start Bot" when bot IS running (frontend)
- **File**: `client/src/pages/Dashboard.tsx`
- **Issue**: `isRunning` is derived from `botStatus?.status === "running"`. If `bot.status` query returns null (DB row doesn't exist yet after first start), isRunning is false even though allBots might show the bot as running. The allBots fallback was added but may not be working on Railway due to the query failing (BUG-5).
- **Fix**: Ensure bot.status query always returns a row after bot.start creates one. Also fix BUG-5 so allBots doesn't fail.

### BUG-11: Paper cost config is global singleton (shared across all users)
- **File**: `server/riskManager.ts` lines 331-341
- **Issue**: `paperCostConfig` is a module-level object. If one user sets brokerage=50 and slippage=0.1, ALL users' paper trades use those values. `setPaperCostConfig` mutates the shared object.
- **Fix**: Store paper cost config per-session in the botSessions DB table.

## Low Bugs (Severity: LOW)

### BUG-12: Cooldown map grows unbounded
- **File**: `server/riskManager.ts` line 65
- **Issue**: `cooldowns` Map is never pruned. Every trade close adds an entry. Over time, this grows unbounded (memory leak). Each entry is small (~50 bytes) so it's slow but real.
- **Fix**: Prune expired entries periodically (e.g., in resetDailyState or on a timer).

### BUG-13: India VIX fetch uses hardcoded instrument key
- **File**: `server/riskManager.ts` line 78
- **Issue**: Uses `NSE_INDEX%7CIndia%20VIX` which is the correct key, but the API call has no auth header. Upstox public API may rate-limit or block after many requests. The 60s cache helps but under high load (many bots), this could still hit limits.
- **Fix**: Add the access token to the VIX fetch if available (better rate limits for authenticated requests).

### BUG-14: Fire-and-forget DB persists can silently fail
- **File**: `server/botEngine.ts` lines 2463-2470, 2509-2516, 2651-2668
- **Issue**: Partial booking and averaging state are persisted via fire-and-forget async IIFEs. If these fail (DB timeout), the in-memory state diverges from DB. On next restart, the trade is restored from DB without the partial booking state.
- **Fix**: At minimum, retry once. Better: make these awaited (they're fast single-row updates).

### BUG-15: Options delta approximation uses hardcoded delta=0.5
- **File**: `server/routers.ts` line 2041 and `server/botEngine.ts` (similar)
- **Issue**: ATM options have ~0.5 delta, but as price moves, delta changes. Using 0.5 for deep ITM/OTM options gives very inaccurate P&L estimates. This is a known limitation but can mislead the user.
- **Fix**: Use a simple Black-Scholes delta approximation based on moneyness, or fetch real quotes more aggressively.

## Frontend Issues

### BUG-16: Slot cards not rendering (allBots query failing)
- **Root cause**: BUG-5 (allStatus query throws on DB timeout → allBots is undefined → empty grid)
- **Fix**: Fix BUG-5 server-side + add fallback cards client-side

### BUG-17: Primary bot "Start Bot" shown when running
- **Root cause**: BUG-10 (bot.status returns null or stopped while bot is actually running in memory)
- **Fix**: Fix BUG-5 + ensure isRunning checks allBots as fallback

## Architecture Concerns (Not Bugs, But Design Issues)

1. **Single-process in-memory state**: All bot state lives in a Map in memory. Server restart = all state lost (mitigated by botRestart.ts, but imperfect).
2. **No WebSocket/SSE for real-time updates**: Dashboard polls every 5s via livePrices query. This adds latency and server load.
3. **No rate limiting on public procedures**: All bot procedures are `publicProcedure` — anyone with a sessionToken can start/stop bots.
4. **Autoscale hosting incompatible with stateful bots**: The bot runs in-process and needs to stay alive. Autoscale (serverless) will kill the instance after idle timeout. Railway (always-on) is correct for this use case.

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| HIGH | 6 | P&L double-counting, no-transaction migration, global state sharing |
| MEDIUM | 5 | Timezone bugs, status display issues, shared config |
| LOW | 4 | Memory leaks, hardcoded values, fire-and-forget failures |
| Frontend | 2 | Slot cards empty, status indicator wrong |

**Recommended fix order**: BUG-5 → BUG-10 → BUG-1 → BUG-6 → BUG-7 → BUG-8 → BUG-3 → BUG-4 → BUG-2 → rest
