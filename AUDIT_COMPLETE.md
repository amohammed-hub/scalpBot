# DEEP AUDIT V2 — COMPLETE

## CRITICAL FIXES APPLIED:

### FIX 1: SessionToken Identity Mismatch (ROOT CAUSE of ₹85 entry price)
- **Problem:** Login flow was overwriting localStorage sessionToken with DB user's different token
- **Effect:** Upstox credentials stored under OLD token became inaccessible → bot used mock prices (₹85)
- **Files changed:**
  - Dashboard.tsx: Removed BUG 16 sessionToken sync useEffect
  - Login.tsx: Removed localStorage overwrite on login; now passes localStorage token to server
  - server/routers.ts: verifyOtp accepts optional sessionToken from client
  - server/db.ts: verifyOtp updates user's DB sessionToken to match client's localStorage token

### FIX 2: Slot Bot Credential Lookup (BUG 22)
- **Problem:** Slot bots (e.g. "abc-slot1") looked up credentials by full token including suffix
- **Effect:** Credentials stored under base token "abc" not found → no access token → mock prices
- **File:** server/routers.ts line ~2105: added `.replace(/-slot[12]$/, "")` for credential lookup

### Previous Audit Fixes (still in place):
- Security guards on clearAllHistory, closeAllOpen, correctTradeExit
- All admin endpoints check ADMIN_MOBILE env var
- Timezone fixes (IST midnight calculation in 5 places)
- botRestart.ts: MCX detection for paper trades, slot credential lookup, open trade ordering
- mobileAuth.me returns role=admin based on ADMIN_MOBILE match
- checkAccess bypasses subscription for admin (3 methods)

## REMAINING KNOWN ISSUES (non-critical):
- Mock premiums are static (only matters for users WITHOUT Upstox token - acceptable)
- Paper mode P&L uses delta-drift approximation (acceptable for paper trading)
- Already-closed trades with ₹0 P&L can be manually corrected via edit button

## TEST STATUS: 122 tests passing, 0 TypeScript errors
## DEPLOYMENT: Push to GitHub → Railway auto-deploys

## USER ACTION REQUIRED AFTER DEPLOY:
The user needs to LOGOUT and LOGIN again. This triggers the new verifyOtp which updates their
app_users.sessionToken to match their localStorage token. After that, all credential lookups
will work correctly and the bot will use real prices from Upstox API.
