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
- [x] Remove Manus login from Home page — make it publicly accessible
- [x] Remove useAuth/protectedProcedure from Dashboard and Settings
- [x] Store Upstox API credentials in browser localStorage
- [x] Store bot session state (status, config, trades) in localStorage
- [x] Remove all redirects to Manus login portal
- [x] Make all tRPC routes public (no auth required)
- [x] Test full flow without any login — verified in browser
- [x] Save checkpoint (v8e941fd0)

## Critical Fix — Remove Login Wall (QR Code Access)
- [x] Confirmed root cause: server/routers.ts used protectedProcedure causing 401 "Please login (10001)" for all bot/credentials/trades routes
- [x] Rewrote server/routers.ts — all routes now use publicProcedure with sessionToken input
- [x] Updated botEngine.ts — keyed by sessionToken (string) instead of userId (number)
- [x] Updated drizzle/schema.ts — replaced userId column with sessionToken in upstox_credentials, bot_sessions, trade_log tables
- [x] Ran db:push — sessionToken columns added to all 3 tables
- [x] Rewrote client/src/main.tsx — removed redirectToLoginIfUnauthorized global handler
- [x] Fixed DashboardLayout.tsx TypeScript errors (null user type)
- [x] Verified: all recent network requests return HTTP 200, no 401 errors
- [x] Verified: Dashboard loads without any login redirect
- [x] Verified: Home page loads without any login redirect

## Fix — Remove Login Wall & Python References (Mobile QR Code Fix)
- [x] Root cause found: DashboardLayout.tsx had hard-coded auth gate (if !user → redirect to Manus login)
- [x] Rewrote DashboardLayout.tsx — removed all useAuth, getLoginUrl, and login redirect logic entirely
- [x] Removed "Sign in to continue" screen from DashboardLayout
- [x] Removed Python bot instruction from Settings.tsx step 5
- [x] Added direct "Get Token from Upstox" link button next to Access Token field
- [x] Updated Access Token placeholder text to be clear and non-technical
- [x] Verified: no getLoginUrl/useAuth calls remain in any page or component
- [x] Verified: no Python/coding references remain in any page

## New Features — Token Guide, Morning Reminder, Token Expiry Indicator
- [x] Settings: Add step-by-step visual guide for getting Upstox Access Token (numbered steps with icons, screenshots-style cards)
- [x] Dashboard: Add morning reminder banner after 9 AM IST reminding user to refresh Access Token before Live mode
- [x] Dashboard: Add token expiry/validity indicator (green/red dot) in Dashboard header showing if saved Access Token is valid

## Fix QR Login Wall + Auto OAuth + Segments
- [x] Permanently fix QR/mobile login wall on published URL — site visibility changed to Public
- [x] Build Upstox OAuth callback page (/upstox-callback) that auto-captures auth code and exchanges it for access token via server-side API call
- [x] Expanded instrument list from 6 to 14 (NSE Index, NSE Equity, BSE Index, BSE Equity), grouped by segment in dropdown

## New Features — F&O, Telegram, CSV Export
- [x] Dashboard: Add F&O options instruments (Nifty weekly options, Bank Nifty options) to instrument dropdown
- [x] Settings + Dashboard: Add Telegram alert integration — bot sends BUY/SELL/STOP signals to Telegram chat
- [x] Dashboard: Add CSV export button to trade log section for downloading trade history to Excel

## Database Migration — Trade Persistence Across Devices
- [x] Upgraded botEngine.ts: open trade tracking, SL/Target monitoring, trailing SL, MCX instruments, candle-based signal engine
- [x] Updated schema.ts: added symbolLabel, stopLossMultiplier, targetMultiplier, trailingSlEnabled, trailingSlPct, minConfidence, scanIntervalSec, instrumentLabel, bidPrice, askPrice, nextScanAt fields
- [x] Ran db:push — all new columns applied to MySQL
- [x] Added tRPC procedures: trades.openTrade, trades.todayStats, bot.manualExit, bot.liveData (with bid/ask/signal/openTrade)
- [x] Rewrote Dashboard.tsx — all state (trades, bot status, live data, open trade) from tRPC/DB, zero localStorage for trade data
- [x] Open trade panel: progress bar, SL/Target display, unrealized P&L, Exit button (paper + live)
- [x] Live P&L in trade log for open trades (updates every 3s)
- [x] Bot auto-restores open trade on server restart via DB query in startBot
- [x] All 8 vitest tests passing

## Auto Square-Off at Market Close
- [x] botEngine.ts: detect market close time (NSE 15:25 IST, MCX 23:25 IST) and auto-close open trade
- [x] botEngine.ts: stop scanning new signals 5 minutes before market close
- [x] Dashboard: show "Market Closed" badge when outside trading hours
- [x] Dashboard: show "Auto square-off at 15:25" warning banner when open trade exists near close
