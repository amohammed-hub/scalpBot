# Upstox Trading Dashboard — TODO

## Backend
- [x] Database schema: upstox_credentials, bot_sessions, trade_log tables
- [x] tRPC router: upstox credentials save/load
- [x] tRPC router: bot start/stop/status
- [x] tRPC router: trade log CRUD
- [x] tRPC router: live market snapshot (mock + real)
- [x] tRPC router: signal generation (EMA/VWAP/ADX)
- [x] tRPC router: place order via Upstox API
- [x] Bot engine: in-memory signal loop with configurable interval
- [ ] Upstox OAuth helper: exchange code for access token (future enhancement)

## Frontend
- [x] App.tsx: add /dashboard route, dark theme
- [x] Dashboard Home: bot status card, P&L summary, quick stats
- [x] Bot Control Panel: start/stop toggle, instrument selector, mode (paper/live)
- [x] Live Price Feed: real-time price ticker for selected instrument
- [x] Signal Panel: latest signal card (BUY/SELL/HOLD) with confidence, SL, TP
- [x] Trade Log Table: all trades with entry/exit/P&L/status
- [x] Settings Page: Upstox API key/secret input, risk config
- [x] Risk Calculator: linked in sidebar
- [x] Landing Home page with CTA

## Tests
- [x] Vitest tests for bot engine signal logic (7 tests passing)
- [x] Vitest tests for auth logout (1 test passing)

## Polish
- [ ] Responsive design on mobile
- [ ] Save checkpoint
