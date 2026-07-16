# Audit V2 — Status & Remaining Work

## FIXES APPLIED (Critical):
1. ✅ Removed BUG 16 sessionToken sync from Dashboard.tsx (line 201-213)
2. ✅ Fixed Login.tsx: no longer overwrites localStorage with server token; passes localStorage token to server
3. ✅ Updated verifyOtp in db.ts: accepts clientSessionToken, updates user record to match
4. ✅ Updated verifyOtp in routers.ts: passes sessionToken input to db function
5. ✅ Fixed slot bot credential lookup (BUG 22): strips -slot suffix for credential lookup

## ROOT CAUSE EXPLAINED:
- User's Upstox credentials stored under localStorage UUID "old-token"
- Login flow was overwriting localStorage with DB user's different sessionToken "new-token"
- Bot.start looked up credentials by "new-token" → found nothing → used mock price ₹85
- Fix: keep localStorage token stable, update DB to match it (not the other way around)

## REMAINING AUDIT ITEMS:
- Mock premiums (BUG 23/25): Static values are acceptable for no-token paper mode. Not critical.
- Option price monitoring: Uses delta-drift approximation for paper mode. Acceptable.
- P&L calculation: Correct for both BUY and SELL directions.
- SL/Target: Uses effectivePrice which accounts for option premium vs underlying.

## STILL TO DO:
- Run full test suite
- TypeScript check (currently 0 errors)
- Save checkpoint
- Push to GitHub for Railway deploy
- User needs to LOGOUT and LOGIN again after deploy to trigger the verifyOtp fix
  (this will update their app_users.sessionToken to match their localStorage token)
