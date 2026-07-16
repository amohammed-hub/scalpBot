# Deep Codebase Audit — Findings

## Current State
- 0 TypeScript errors
- 122 tests passing (all 7 test files)
- Server running fine

## Bugs Found So Far

### BUG 1: `trades.clearAllHistory` is a PUBLIC endpoint with NO auth
- **File:** server/routers.ts line 1498-1507
- **Issue:** Anyone can call this mutation and wipe ALL trade history, bot sessions, and signal journal. No sessionToken, no admin check.
- **Fix:** Add admin-only guard (check scalpbot_auth cookie for admin role/mobile)

### BUG 2: `trades.closeAllOpen` with no sessionToken closes ALL users' open trades
- **File:** server/routers.ts line 1509-1587
- **Issue:** The sessionToken is optional. If called without it, it closes ALL open trades globally across all users.
- **Fix:** Make sessionToken required, or add admin-only guard for the global case

### BUG 3: `trades.openTrade` fallback returns ANY user's open trade
- **File:** server/routers.ts line 1202-1214
- **Issue:** If no open trade found for the current session, it returns the most recent open trade from ANY session with botSlot=0. In a multi-user scenario, User B could see User A's open trade.
- **Fix:** Remove the global fallback or restrict to same user (via app_users lookup)

### BUG 4: Admin panel button not showing (Railway DB role issue) — ALREADY FIXED
- **Status:** Fixed in previous checkpoint (mobileAuth.me now checks ADMIN_MOBILE)

### BUG 5: bot.restart fails with "No previous bot config found"
- **File:** server/routers.ts line 824
- **Issue:** After Railway redeploy, the bot_sessions row may have been cleaned up or the sessionToken in localStorage changed. The restart button on the dashboard calls bot.restart but there's no bot_sessions row for the current sessionToken.
- **Fix:** The "Restart Bot" button should call bot.start instead of bot.restart when there's no previous config. Frontend should handle this gracefully.

### BUG 6: `todayStart` timezone issue in bot.start and bot.restart
- **File:** server/routers.ts lines 365-366, 848
- **Issue:** `todayStart.setHours(0, 0, 0, 0)` uses server timezone (UTC on Railway), not IST. Trades entered at 9:15 AM IST would be counted as "yesterday" if server is UTC.
- **Fix:** Calculate IST midnight properly: `const istNow = new Date(Date.now() + 5.5*60*60*1000); istNow.setUTCHours(0,0,0,0); const todayStart = new Date(istNow.getTime() - 5.5*60*60*1000);`

### BUG 7: `credentials.get` exposes apiSecret partially (first 4 chars)
- **File:** server/routers.ts line 66
- **Issue:** Minor security concern — even 4 chars of the API secret is unnecessary exposure. Should just show "****" or a boolean.
- **Fix:** Change to `apiSecretMasked: "••••••••"` (just indicate it exists)

### BUG 8: Dead code — `client/src/pages/Admin.tsx` still exists
- **File:** client/src/pages/Admin.tsx (367 lines)
- **Issue:** The /admin route was removed from App.tsx but the file still exists. Dead code.
- **Fix:** Delete the file

### BUG 9: `botRestart.ts` — open trade lookup has no ordering
- **File:** server/botRestart.ts line 39-47
- **Issue:** When restoring open trades on server boot, the query doesn't have explicit ordering. If multiple open trades exist (shouldn't happen but can due to bugs), it picks an arbitrary one.
- **Fix:** Add `.orderBy(desc(tradeLog.enteredAt))` to the query

### BUG 10: Dashboard "Restart Bot" button calls bot.restart which requires bot_sessions row
- **File:** client/src/pages/Dashboard.tsx
- **Issue:** After a Railway redeploy, if the user's sessionToken in localStorage doesn't match any bot_sessions row, the restart fails. The UI should detect this and offer "Start Bot" instead.
- **Fix:** In the Dashboard, when restart fails with "No previous bot config found", show a toast suggesting to use "Start Bot" instead. Or better: make the restart button call bot.start with the last known config from the UI state.

## Items to Check Next
- [ ] Read remaining routers.ts (1600-3742) — subscription, scanner, mobileAuth, admin routes
- [ ] Read botEngine.ts (3232 lines) — core trading logic
- [ ] Read botRestart.ts (345 lines) — server boot recovery
- [ ] Read db.ts (584 lines) — database helpers
- [ ] Read Dashboard.tsx (3166 lines) — main UI
- [ ] Read Settings.tsx (1175 lines) — settings page
- [ ] Read AdminPanel.tsx (346 lines) — admin component
- [ ] Read all other client pages

### BUG 11: botRestart.ts line 39-47 — no ordering on open trade query
- **File:** server/botRestart.ts line 39-47
- **Issue:** Query for open trades doesn't have `.orderBy(desc(tradeLog.enteredAt))`. If multiple open trades exist (shouldn't but can), it picks an arbitrary one.
- **Fix:** Add `.orderBy(desc(tradeLog.enteredAt))` before `.limit(1)`

### BUG 12: multiBots.allStatus uses server-timezone todayStart
- **File:** server/routers.ts line 1825
- **Issue:** `todayStart.setHours(0, 0, 0, 0)` uses server timezone (UTC on Railway), not IST.
- **Fix:** Same IST fix as BUG 6

### BUG 13: admin.verify only checks JWT role claim, not ADMIN_MOBILE
- **File:** server/routers.ts line 3526-3544
- **Issue:** admin.verify checks `decoded.role === "admin"` from JWT. But if the JWT was issued before the user was promoted to admin (common on Railway), this returns false. Should also check mobile against ADMIN_MOBILE.
- **Fix:** Add DB lookup + ADMIN_MOBILE check in admin.verify

### BUG 14: admin endpoints don't check ADMIN_MOBILE for authorization
- **File:** server/routers.ts lines 3546-3738 (users, subscriptions, grantAccess, revokeAccess, stats, userActivity)
- **Issue:** All admin endpoints verify via JWT role="admin" OR scalpbot_admin cookie. But on Railway where the JWT has role="user", admin access fails. Should also check ADMIN_MOBILE.
- **Fix:** Add ADMIN_MOBILE-based bypass to all admin auth checks

### BUG 15: trades.correctTradeExit has NO auth check
- **File:** server/routers.ts line 1659-1689
- **Issue:** Anyone can correct any trade's exit price by just providing a tradeId. No session verification.
- **Fix:** Add sessionToken input and verify ownership, or add admin-only guard

### BUG 16: Dashboard uses localStorage UUID as sessionToken for bot operations
- **File:** client/src/pages/Dashboard.tsx
- **Issue:** The dashboard generates a random UUID in localStorage (`scalpbot_session`) and uses it for ALL bot/trade operations. After clearing browser data or using a new device, the user gets a new UUID and loses access to their existing bots/trades. The mobileAuth.me endpoint returns the user's actual sessionToken but the dashboard doesn't use it for bot operations.
- **Fix:** After successful login, sync the localStorage sessionToken with the one from mobileAuth.me, OR use the authenticated user's sessionToken from meQuery.data for all operations.

### BUG 17: botRestart.ts stale trade cleanup uses instrumentToken for option quote
- **File:** server/botRestart.ts line 292
- **Issue:** For options trades, `t.instrumentToken` might be the UNDERLYING token (e.g., "NSE_INDEX|Nifty Bank"), not the actual option contract token. Fetching quote for the underlying gives the index price, not the option premium.
- **Fix:** Need to resolve the actual option token from the trade symbol before fetching quote (same logic as bot.stop)

### BUG 18: Slot bot todayStart also has timezone issue
- **File:** server/routers.ts line 2124
- **Issue:** Same as BUG 6 — `slotTodayStart.setHours(0, 0, 0, 0)` uses server timezone.
- **Fix:** Use IST midnight calculation

## Summary of Critical Bugs to Fix
1. **Security:** clearAllHistory, correctTradeExit have NO auth (BUG 1, 15)
2. **Security:** closeAllOpen global mode has no auth (BUG 2)
3. **Security:** openTrade fallback leaks other users' trades (BUG 3)
4. **Timezone:** 5 places use server-local midnight instead of IST (BUG 6, 12, 18)
5. **Admin access:** Admin endpoints don't check ADMIN_MOBILE (BUG 13, 14)
6. **UX:** Restart button fails after deploy (BUG 5, 10)
7. **Dead code:** Admin.tsx file still exists (BUG 8)
8. **Data integrity:** botRestart open trade query has no ordering (BUG 11)
9. **Data integrity:** Stale trade cleanup uses wrong token for options (BUG 17)
10. **Identity:** Dashboard uses random UUID instead of authenticated sessionToken (BUG 16)

### BUG 19: botRestart.ts slot bot credential lookup uses wrong token
- **File:** server/botRestart.ts line 107-112
- **Issue:** Looks up upstoxCredentials by `session.sessionToken`. For slot bots (e.g. "abc-slot1"), creds are stored under the BASE token "abc". After a restart, slot bots won't have access tokens.
- **Fix:** Strip "-slot1"/"-slot2" suffix before looking up credentials

### BUG 20: _core/index.ts EOD summary uses server-timezone todayStart
- **File:** server/_core/index.ts line 265-266
- **Issue:** Same as BUG 6 — `todayStart.setHours(0, 0, 0, 0)` uses server timezone (UTC on Railway).
- **Fix:** Use IST midnight calculation

## FINAL BUG COUNT: 20 bugs found
## NOW STARTING COMPREHENSIVE FIX PASS
