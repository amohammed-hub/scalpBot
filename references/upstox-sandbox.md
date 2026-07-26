# Upstox Sandbox API Reference

## Key Facts
- **Sandbox Base URL:** `https://api-sandbox.upstox.com/v3`
- **Production Base URL:** `https://api.upstox.com/v2`
- **Token:** Generated from Upstox Developer Apps page → Sandbox section → "Generate" button
- **Token validity:** 30 days
- **Limit:** Only 1 sandbox app per user

## Supported Sandbox APIs (as of July 2026)
- Place Order (v3)
- Place Multi Order
- Modify Order (v3)
- Cancel Order (v3)

## Key Differences from Production
1. Different base URL (`api-sandbox` vs `api`)
2. Uses v3 endpoint path (not v2)
3. Separate access token (sandbox token, NOT live token)
4. No trading window restrictions (can test anytime)
5. Returns REAL fill prices (simulated but realistic)
6. Validates order format (catches product type/qty errors)
7. No real money at risk

## SDK Configuration (Node.js)
```javascript
// For SDK users: just set sandbox=true
const configuration = new Configuration({ sandbox: true });
configuration.accessToken = 'SANDBOX_ACCESS_TOKEN';
```

## For Direct HTTP Calls (our approach)
- Replace `https://api.upstox.com/v2/order/place` with `https://api-sandbox.upstox.com/v3/order/place`
- Same headers: `Authorization: Bearer <SANDBOX_TOKEN>`, `Content-Type: application/json`
- Same payload format

## Implementation Plan
1. Add `mode: "paper" | "sandbox" | "live"` to BotState (currently `mode: "paper" | "live"`)
2. In `placeUpstoxOrder()`: if mode === "sandbox", use sandbox base URL
3. Sandbox token stored separately in `upstox_credentials` table (new column `sandboxToken`)
4. UI: 3-way toggle in Dashboard (Paper / Sandbox / Live)
5. Settings page: section for sandbox app credentials + token generation
