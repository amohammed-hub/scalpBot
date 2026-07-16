# BUG 23: ₹0 P&L / ₹85 Mock Price — ROOT CAUSE & FIX PLAN

## Root Cause (CONFIRMED):
The `verifyOtp` function in `server/db.ts` updates `app_users.sessionToken` to match
the client's localStorage token. BUT it does NOT update:
- `upstox_credentials.sessionToken`
- `bot_sessions.sessionToken`  
- `trade_log.sessionToken`

So after re-login:
- Frontend sends localStorage token (e.g. "abc-123")
- app_users.sessionToken = "abc-123" (updated by fix)
- upstox_credentials.sessionToken = "old-token-456" (NEVER updated!)
- bot.start looks up credentials WHERE sessionToken = "abc-123"
- Finds NOTHING → accessToken = null → mock prices (₹85 for crude, ₹280 for gold)

## Fix Plan:
1. In `server/db.ts` verifyOtp: When clientSessionToken differs from existing user's token,
   migrate ALL related tables:
   - UPDATE upstox_credentials SET sessionToken = newToken WHERE sessionToken = oldToken
   - UPDATE bot_sessions SET sessionToken = newToken WHERE sessionToken = oldToken
   - UPDATE trade_log SET sessionToken = newToken WHERE sessionToken = oldToken
   - Also handle slot tokens: oldToken-slot1 → newToken-slot1, oldToken-slot2 → newToken-slot2

2. In `server/routers.ts` bot.start: Add FALLBACK credential lookup:
   - If no credentials found by sessionToken, look up the user via app_users (by sessionToken)
   - Then look up credentials by the user's mobile or any other linked token
   - This handles edge cases where migration didn't run

## Key Files to Edit:
- server/db.ts: verifyOtp function (line ~484)
- server/routers.ts: bot.start credential lookup (line ~338)

## Evidence from Screenshot:
- CRUDEOIL 23JUL26 7650 CE: entry ₹85.00 (mock), real price is ₹62-68
- GOLD 23JUL26 114000 PE: entry ₹280.00 (mock), real price unknown
- All trades show P&L: ₹0 because entry = exit (both mock)
- Exit reason: "Market Close — auto-closed on startup @ ₹85.00"
