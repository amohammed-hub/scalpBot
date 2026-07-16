# Deep Audit V2 — FINAL Fix Plan

## ROOT CAUSE of ₹85 Entry Price Bug
The BUG 16 fix (sessionToken sync) BROKE credential lookup:
1. User's localStorage had random UUID "old-token" with all their data (credentials, trades, bot sessions)
2. BUG 16 fix synced localStorage to app_users.sessionToken (a DIFFERENT UUID "new-token")
3. After sync, bot.start looks up credentials WHERE sessionToken = "new-token" → EMPTY
4. accessToken = null → falls into mock premium path → uses hardcoded MCX_CRUDE_CE = ₹85

## FIX: Remove BUG 16 sessionToken sync, reverse the direction
Instead of syncing localStorage → DB user token, sync DB user token → localStorage token.
On verifyOtp, UPDATE app_users.sessionToken to match the client's localStorage token (passed as input).
This way the user's existing data stays linked to their identity.

## Changes Required:
1. **Dashboard.tsx line 202-213**: REMOVE the BUG 16 fix useEffect that syncs localStorage
2. **server/routers.ts mobileAuth.verifyOtp**: Accept `sessionToken` input from client, 
   update app_users.sessionToken to match the client's localStorage token on login
3. **server/db.ts verifyOtp**: Accept sessionToken param, update user's sessionToken on login
4. **Also fix**: Slot bot credential lookup (line 2107 in routers.ts) — use baseToken for creds

## Additional Bugs Found in This Audit:
- BUG 22: Slot bot startSecondary (line 2107) looks up creds by "token-slot1" instead of base token
- BUG 23: mockPrices are STATIC — MCX_CRUDE_CE=85 never updates from real market data
- BUG 24: When option resolution fails in paper mode with token, trade is SKIPPED entirely (user misses signal)
- BUG 25: buildMockCandle only updates underlying prices, not option premiums

## Priority Fix Order:
1. Remove BUG 16 sessionToken sync (CRITICAL — causes ₹85 entry price)
2. Fix verifyOtp to update app_users.sessionToken from client's localStorage token
3. Fix slot bot credential lookup (BUG 22)
4. Make mock premiums dynamic based on underlying price (BUG 23/25)
5. Add fallback: when option resolve fails with token, try cached premium before skipping (BUG 24)
