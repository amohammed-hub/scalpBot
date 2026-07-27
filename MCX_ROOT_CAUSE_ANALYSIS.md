# MCX Live Trade Root Cause Analysis — July 27, 2026

## DEFINITIVE ROOT CAUSE

**The Upstox access token is returning 401 (Unauthorized) for ALL API calls** — market-quote, margin check, order placement, option validation. This is happening AFTER the user refreshed the token.

### Evidence from Railway logs (last 5 minutes):
1. `resolveAtmMcxOptionToken: market-quote failed for MCX_FO|560977: Request failed with status code 401`
2. `Margin check API failed (proceeding with order): Request failed with status code 401`
3. `validateOptionToken failed for MCX_FO|573618: Request failed with status code 401`
4. `OptionsAnalytics fetch failed: Request failed with status code 401`

### But CANDLE FETCH works:
- `tick CANDLES OK — 8d17c6ad | price=143019 | candles1m=400 | 5m=80` ✅
- Candles are fetched successfully for all MCX instruments

### Why candles work but orders don't:
- Upstox historical candle API (`/v2/historical-candle/`) is PUBLIC — no auth required
- Market-quote API (`/v2/market-quote/`) requires valid token
- Order placement API (`/v2/order/place`) requires valid token + whitelisted IP

### IP Restriction:
- Railway IP: 152.55.177.181
- Upstox configured IPs: 162.220.232.251, 162.220.232.252
- User's Static IPs page shows 152.55.177.181 (updated July 23) — BUT the API still enforces old IPs
- This means the IP update either didn't save properly or needs token regeneration

### Why NSE worked earlier today:
- The 31 NSE trades were placed from a PREVIOUS Railway deployment (before IP changed)
- OR from a different server entirely
- In the last 12h of Railway logs, there are ZERO successful live orders (all are DEMO)

### Current state (after user refreshed token):
- Token still returns 401 on market-quote and order placement
- Bot falls back to demo mode for orders
- Session 712791db: DEMO mode (user switched to demo)
- Session 8d17c6ad: LIVE mode but orders rejected by IP restriction
- Copper signal (83% conf) blocked by spread too wide (7.5% > 5% threshold)

### What needs to happen:
1. The Upstox static IP MUST actually be updated to 152.55.177.181 (verify it saved)
2. After IP update, a NEW access token must be generated (old tokens carry old IP binding)
3. The new token must be saved in ScalpBot Settings
4. Bots must be restarted to pick up the new token

### Alternative: The token itself may be invalid
- If the user generated a new token but it's still returning 401, the token may not have been saved correctly in the Railway DB
- Check if the ScalpBot Settings page actually saved the token to the DB
