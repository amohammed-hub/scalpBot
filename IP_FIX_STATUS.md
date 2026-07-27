# IP Fix Status - July 27, 2026

## Root Causes Found & Fixed:
1. **MCX Margin Check returning ₹0** — Upstox merged commodity into equity since July 2025. Fixed: now uses `equity.available_margin` for both NSE and MCX.
2. **Phantom price (₹496.60)** — livePrices endpoint had no sanity check + Dashboard used delta fallback. Fixed both.
3. **HTF filter was dead code** — nested inside unreachable block after `return`. Fixed: moved outside.
4. **Expired option auto-close** — Added: after 10 consecutive quote failures, phantom trade is auto-closed.

## Current Blocking Issue:
- **IP Restriction on Order Placement (UDAPI1154)**
- Upstox static IPs page shows: Primary=152.55.177.181, Secondary=162.220.232.251 (updated July 23)
- But the ERROR says: "configured static IP (162.220.232.251, 162.220.232.252) does not match origin IP (152.55.177.181)"
- This means the ACCESS TOKEN was generated BEFORE the IP update
- Per Upstox docs: "After a successful update, existing access tokens are invalidated — you must complete the OAuth flow again"
- The user needs to REFRESH the access token (get a new one via OAuth login)
- Market data APIs work fine (candles flowing), only ORDER PLACEMENT is blocked

## What's Needed:
- User must log into Upstox (mobile + OTP + PIN) to generate a fresh access token
- The ScalpBot OAuth callback URL is: https://scalpbot.up.railway.app/api/upstox-callback
- Once new token is obtained, it will be bound to the updated IP (152.55.177.181)
- Both NSE and MCX live orders will then work

## Railway Info:
- Project: disciplined-spontaneity (e80b3c31-9ba8-4531-a5c4-c2047211790c)
- Service: upstox-scalping-guide
- URL: https://scalpbot.up.railway.app
- Current outbound IP: 152.55.177.181

## Session Tokens (from Railway logs):
- 8d17c6ad — LIVE mode bot (the one that hits IP restriction)
- 712791db — DEMO mode bot
- f0d4ff4a — DEMO mode bot
- b9fe46ea — another bot session

## Signals ARE being generated (confirmed working):
- MCX_CRUDE BUY 84% confidence (MCXEvening layer)
- MCX_GOLD SELL 94% confidence
- MCX_SILVER SELL 92% confidence
- MCX_NATGAS BUY 74% confidence
- COPPER SELL 65% confidence

## Margin Fix Confirmed:
- MARGIN API: equity.available=116217.16 commodity.available=0 | using=116217.16 | isMcx=true
