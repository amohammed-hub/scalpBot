# COMPREHENSIVE AUDIT FINDINGS — Jul 16, 2026

## BUG 1: Fallback credential lookup doesn't work if user hasn't re-logged in via OTP
**Location:** server/routers.ts line 351
**Problem:** The fallback checks `appUsers WHERE sessionToken = input.sessionToken`. But if user
hasn't re-logged in via OTP after the fix, their appUsers row still has the OLD sessionToken.
So `userRow.length === 0` and the fallback is SKIPPED entirely.
**Fix:** Remove the appUsers check. Just look for ANY credential with valid accessToken directly.
This is a single-user system — no need to verify identity.

## BUG 2: Mock prices still used in paper mode without token
**Location:** server/botEngine.ts line 2597-2622
**Problem:** When bot starts in PAPER mode with no access token, it uses mock prices (₹85 crude,
₹280 gold). This creates FAKE trades that confuse the user.
**Fix:** REFUSE to start bot (paper or live) if no access token is found. Show clear error message.
The mock price fallback was designed for testing but creates real confusion.

## BUG 3: Same fallback bug in botRestart.ts
**Location:** server/botRestart.ts — same pattern as routers.ts
**Fix:** Same fix — remove appUsers check, just look for any credential.

## BUG 4: Same fallback bug in secondary bot start (slot bots)
**Location:** server/routers.ts line ~2126
**Fix:** Same pattern fix.

## BUG 5: GOLD 114000 PE option doesn't exist
**Evidence:** User's Upstox screenshot shows GOLD 29JUL26 114000 PE = 0.00 price, no data
**Problem:** The bot resolved an ATM option that doesn't exist or has no liquidity
**Root cause:** Mock premium was used (₹280) — this wouldn't happen with real token
**Fix:** Already handled by BUG 2 fix — don't allow mock trades.

## IMPLEMENTATION PLAN:
1. Fix fallback in routers.ts bot.start — remove appUsers dependency
2. Fix fallback in routers.ts multiBots.startSecondary — remove appUsers dependency  
3. Fix fallback in botRestart.ts — remove appUsers dependency
4. Remove mock premium paper trading entirely — REFUSE to start if no token
5. Add clear console.log for debugging credential lookup on Railway
6. Run tests, push to GitHub
