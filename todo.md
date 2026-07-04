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
- [x] Upstox OAuth helper: exchange code for access token (manual token entry in Settings)

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
- [x] Responsive design on mobile (sidebar collapses, cards stack)
- [x] Save checkpoint (v35711260)

## Independence from Manus Auth
- [ ] Remove Manus login from Home page — make it publicly accessible
- [ ] Remove useAuth/protectedProcedure from Dashboard and Settings
- [ ] Store Upstox API credentials in browser localStorage (encrypted)
- [ ] Store bot session state (status, config, trades) in localStorage
- [ ] Remove all redirects to Manus login portal
- [ ] Make all tRPC routes public (no auth required)
- [ ] Test full flow without any login
- [ ] Save checkpoint
