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

## Railway Deployment — Independent from Manus
- [x] Removed vitePluginManusRuntime from vite.config.ts (was forcing Manus login on all visitors)
- [x] Made QRModal LIVE_URL dynamic (window.location.origin) — works on any domain
- [x] Made Settings redirect URI note dynamic (window.location.origin) — correct for any domain
- [x] Created railway.json with build/deploy config
- [x] Created .nixpacks.toml for pnpm + Node 22 build
- [x] Created RAILWAY_DEPLOY.md with step-by-step deployment guide
- [x] All 8 tests passing after changes

## Fix — Auto Token Flow (Save to DB Before OAuth Redirect)
- [x] Root cause: "Get Token Automatically" button was an <a> tag that redirected immediately without saving API Key/Secret to DB first — so when /upstox-callback tried to look up credentials, it found nothing
- [x] Fixed: Converted auto-token button from <a> to <button> with handleGetTokenAuto handler
- [x] handleGetTokenAuto: saves apiKey/apiSecret to DB via credentials.save first, then redirects to Upstox OAuth
- [x] handleGetTokenAuto: shows clear error toast if DB save fails (no more silent swallowing)
- [x] handleSave: shows clear error toast if DB save fails instead of silently swallowing with .catch(() => {})
- [x] Button shows loading spinner while saving to DB before redirect
- [x] Push fix to GitHub and verify on Railway

## Feature — Upstox Account Balance & Profile on Dashboard
- [x] Server: tRPC procedure account.profile — calls GET /v2/user/profile with stored access token
- [x] Server: tRPC procedure account.balance — calls GET /v2/user/get-funds-and-margin with stored access token
- [x] Dashboard: Account widget showing profile name, email, broker, UCC
- [x] Dashboard: Balance widget showing available margin, used margin, total balance (equity + commodity)
- [x] Dashboard: Auto-refresh balance every 30 seconds when bot is running
- [x] Dashboard: Show "No Token" state gracefully if token not saved yet (widget hidden when no token)

## Bot Engine Improvements — Phase 2 (All 6 + Power Hour)
- [x] Multi-timeframe confirmation: fetch 5-min candles, only enter if 5-min trend aligns with 1-min signal
- [x] Dynamic breakout threshold: replace fixed 0.0003 with ATR-relative threshold (atr/price * 0.5)
- [x] MACD + Bollinger Band squeeze: add Layer 5 — detect BB compression then expansion breakout
- [x] Support/Resistance proximity filter: calculate daily pivot points (prev day H/L/C), reject entries within 0.1% of S/R
- [x] Time-of-day bias filter: skip 9:15–9:30 AM, boost confidence for 10:00–11:30 AM and 2:00–3:00 PM
- [x] Re-entry logic: after SL hit, if signal still valid 2 candles later, allow second entry with tighter SL
- [x] Power Hour strategy (3:00–3:20 PM): fetch whole-day candles, identify day trend/range/VWAP position, apply high-conviction directional trades in final 20 min
- [x] Power Hour: separate generatePowerHourSignal() function using day-context (daily candles + day's VWAP, high, low, trend, 6-point scoring)
- [x] Dashboard: show "Power Hour Mode" banner + sidebar badge when in 3:00–3:20 PM window
- [x] Dashboard: show signal layer name including new Layer 5 (MACD/BB Squeeze) and Power Hour
- [x] Update vitest tests to cover new signal layers and power hour logic (22 tests passing)

## MCX Evening Power Hour + Partial Profit Booking + Hero Zero Strategy
- [x] botEngine.ts: MCX Evening Power Hour (7:30–9:30 PM IST) — generateMCXEveningSignal() with US-open context, 6-point scoring
- [x] botEngine.ts: EIA Wednesday filter — widen SL by 30% for Crude Oil on Wednesday 7:55–8:05 PM IST
- [x] botEngine.ts: Partial profit booking — book 50% at 1R (SL→BE), book 25% at 2R (SL→1R), trail rest to target
- [x] botEngine.ts: openTrade state — partialBooked (0/1/2), bookedQty, bookedPnl fields added
- [x] routers.ts: expose isMCXEveningMode, heroZeroMode in bot.liveData response
- [x] botEngine.ts: Hero Zero engine — generateHeroZeroSignal() for expiry-day OTM options (Nifty/BankNifty weekly expiry)
- [x] botEngine.ts: Hero Zero entry filter — premium ₹2–50, OTM 1–5%, direction confirmed by RSI/EMA/MACD
- [x] botEngine.ts: Hero Zero exit — 5× target, 50% cut, partial booking at 2.5× and 3.5×
- [x] Dashboard: MCX Evening amber banner (7:30–9:30 PM, US Open window, EIA Wednesday note)
- [x] Dashboard: Pyramid Exit Progress bar in open trade panel (Entry→1R→2R→Target, locked P&L shown)
- [x] Dashboard: Hero Zero Premium Tracker (entry, 2.5×, 3.5×, 5×, 50% cut levels)
- [x] Dashboard: MCXEvening + HeroZero layer badge colors in signal card
- [x] Dashboard sidebar: MCX Evening amber badge, Hero Zero purple badge
- [x] 22 vitest tests passing (all existing tests still green)

## Phase 4 — Telegram Alerts + Multi-Bot + Hero Zero Scanner

### Telegram Power Hour + Hero Zero Alerts
- [x] botEngine.ts: send Telegram alert when Power Hour mode activates (3:00 PM IST) — message includes instrument, day trend, VWAP position, score
- [x] botEngine.ts: send Telegram alert when MCX Evening mode activates (7:30 PM IST) — message includes instrument, US-open context, EIA note if Wednesday
- [x] botEngine.ts: send Telegram alert when Hero Zero signal fires — message includes option type, premium, 5× target, 50% cut
- [x] botEngine.ts: send Telegram alert when partial booking triggers (1R booked, 2R booked) — message includes locked P&L and remaining position
- [x] botEngine.ts: send Telegram alert on trade close — includes exit reason, total P&L, day P&L
- [x] routers.ts: telegramBotToken, telegramChatId, telegramEnabled added to bot.start and multiBots.startSecondary
- [x] Settings.tsx: Telegram Bot Token + Chat ID already exists in Settings page (localStorage-based client test)

### Multi-Instrument Parallel Bot
- [x] botEngine.ts: supports multiple simultaneous bot instances via Map<string, BotState> keyed by slotToken
- [x] routers.ts: multiBots.startSecondary, multiBots.stopSecondary, multiBots.allStatus procedures added
- [x] routers.ts: multiBots.allStatus returns live data for all 3 slots (primary + slot1 + slot2)
- [x] drizzle/schema.ts: botSlot column added to bot_sessions and trade_log, migration pushed
- [x] Dashboard: Hero Zero Scanner nav link in sidebar (purple, 🦸 icon)

### Hero Zero Option Scanner Panel
- [x] routers.ts: heroZero.scanStrikes — scans NIFTY/BANKNIFTY/FINNIFTY weekly option chain, returns top 10 candidates with direction score (0–8)
- [x] client/src/pages/HeroZeroScanner.tsx — new page with option chain table, direction badges, premium tracker, score badges
- [x] App.tsx: /hero-zero route added
- [x] HeroZeroScanner: auto-refresh toggle (60s interval during expiry window)
- [x] HeroZeroScanner: one-click "Start Bot on This Strike" button (launches Hero Zero bot on slot 1)
- [x] HeroZeroScanner: selected candidate detail panel with all exit levels (2.5×, 3.5×, 5×, 50% cut)
- [x] HeroZeroScanner: expiry day + trading window status banners
- [x] HeroZeroScanner: strategy rules guide at bottom

## Phase 5 — Telegram Test, Multi-Bot Panel, MCX Selector

### Telegram Test Connection
- [x] routers.ts: telegram.test procedure — sends a test message to the configured bot token + chat ID, returns success/error
- [x] routers.ts: telegram.sendDailySummary procedure — sends today's trade summary (P&L, win/loss, best/worst trade)
- [x] Settings.tsx: "Test Connection" button — calls telegram.test, shows green/red status badge
- [x] Settings.tsx: "Send Daily Summary" button — calls telegram.sendDailySummary
- [x] Settings.tsx: green/red badge indicating last test result (connected / failed)

### Multi-Bot Dashboard Panel
- [x] Dashboard.tsx: "Parallel Bots" card — shows all 3 slots side by side (instrument, status, day P&L, open trade, signal)
- [x] Dashboard.tsx: per-slot Stop button for secondary bots (slot 1 and 2)
- [x] Dashboard.tsx: combined total day P&L across all running bots shown at top of panel
- [x] Dashboard.tsx: mode badges (Power Hour, MCX Evening, Hero Zero) per slot

### MCX Instrument Selector
- [x] shared/mcxInstruments.ts: MCX instrument registry (9 instruments) with Upstox tokens, lot sizes, tick values, margins, best times
- [x] Settings.tsx: MCX Quick Launch section with category filter (All/Metals/Energy), slot selector (1/2), capital input
- [x] Settings.tsx: instrument grid with lot size, tick value, margin, best times, and one-click Start MCX Bot button
- [x] Settings.tsx: starts bot in Paper mode on selected slot with pre-configured MCX Evening risk parameters

### Phase 5 Gap Fixes
- [x] Dashboard.tsx: per-slot Quick Start mini-form inside Parallel Bots panel (slot 1 and 2) — instrument dropdown (NIFTY/BANKNIFTY/FINNIFTY/Crude/Gold/Silver), capital input, Start button
- [x] Settings.tsx: MCX Quick Launch grid with category filter (All/Metals/Energy) serves as the instrument selector with one-click launch
- [x] shared/mcxInstruments.ts: added contract month warning comment with Upstox instrument master CSV download URL

## Phase 6 — P&L Analytics & Export
- [x] routers.ts: trades.pnlByDay — group all trades by date, return daily P&L, trades count, win/loss, best/worst trade
- [x] routers.ts: trades.pnlByWeek — group by ISO week, return weekly summary with best day
- [x] routers.ts: trades.pnlByMonth — group by month, return monthly summary with consistency %
- [x] routers.ts: trades.exportData — return full trade data formatted for export (all fields, all time)
- [x] client/src/pages/PnLAnalytics.tsx — new page with 3 tabs: Daily / Weekly / Monthly
- [x] Daily tab: table with date, trades, wins, losses, win rate, total P&L, best trade, worst trade, avg P&L, instruments
- [x] Weekly tab: table with week range, trades, win rate, P&L, best trade, worst trade, best day
- [x] Monthly tab: table with month, trades, win rate, P&L, avg daily P&L, trading days, consistency %
- [x] Summary cards at top: total P&L, total trades, win rate, avg daily P&L, best day, worst day, trading days
- [x] Bar chart: daily P&L for last 30 days (green/red bars, recharts)
- [x] Export CSV button: downloads full trade log as CSV
- [x] Export Excel button: downloads XLSX with 4 sheets (All Trades, Daily, Weekly, Monthly)
- [x] App.tsx: /pnl-analytics route and sidebar nav link (green 📊)
- [x] Dashboard sidebar: P&L Analytics link added next to Hero Zero Scanner

## Phase 7 — Institutional Strategies (ORB, VWAP, Market Regime, Institutional Footprint)
- [x] botEngine.ts: calcORBSignal — Opening Range Breakout with volume confirmation (15-min ORB, 1.5× volume threshold)
- [x] botEngine.ts: calcVWAPDeviation — VWAP deviation bands with z-score (mean reversion when |z| > 1.5)
- [x] botEngine.ts: classifyMarketRegime — 5-regime classifier (strong_trend, weak_trend, ranging, high_vol, low_vol)
- [x] botEngine.ts: calcInstitutionalFootprint — volume-weighted momentum (2× vol + 70% body + VWAP alignment)
- [x] botEngine.ts: calcDayMomentumScore — intraday time-series momentum (last-half-hour effect)
- [x] botEngine.test.ts: 21 new tests for all 4 institutional strategy functions (64 total tests passing)
- [x] Settings.tsx: QR code warning added before Get Token Automatically button (critical OAuth fix)

## Phase 8 — Auto Token Refresh, Daily P&L Chart, Backtesting
- [x] Auto access token refresh at 8:30 AM daily (heartbeat job)
- [x] Daily P&L chart on Dashboard (7-day/30-day bar chart)
- [x] Backtesting tab (replay historical 1m candles)

## Phase 8 — Auto Token Refresh, Daily P&L Chart, Backtester
- [x] Settings.tsx: AutoRefreshSection component — daily 8:30 AM IST cron toggle with Telegram reminder
- [x] routers.ts: autoRefresh.enable/disable/status procedures with heartbeat cron integration
- [x] server/_core/index.ts: /api/scheduled/token-refresh handler for heartbeat callback
- [x] Dashboard.tsx: Daily P&L bar chart widget (7D/30D toggle, green/red bars, cumulative P&L, trading day stats)
- [x] routers.ts: backtest.run procedure — fetches Upstox historical 1m candles, replays signal engine, returns equity curve + trade log
- [x] Backtest.tsx: Full backtesting page (instrument selector, date range, params, equity curve, trade log, P&L distribution)
- [x] App.tsx: /backtest route added
- [x] Dashboard.tsx: Backtester sidebar link added (blue 🔬 icon)
- [x] botEngine.test.ts: Fixed flaky classifyMarketRegime test (64 tests passing)

## End-to-End Audit Fixes (Jul 8) — Round 1
- [x] botEngine.ts: add onTick callback to startBot — called after every scan to persist lastPrice/bidPrice/askPrice/nextScanAt to DB
- [x] routers.ts: restore tradesCount from today's DB trade count on bot restart (not hardcoded 0)
- [x] routers.ts: fix openTrade cross-session query to filter by botSlot to avoid showing wrong slot's trade
- [x] Dashboard.tsx: remove dead progressPct variable (replaced by inline calculation)

## Real Root Cause Fixes (Jul 8) — Round 2
- [x] botEngine.ts: onTick moved to fire IMMEDIATELY after price fetch — was only firing when no open trade existed (critical bug: price never updated during active trade)
- [x] botEngine.ts: added getBotStateByPrefix() export to find running bot even when sessionToken doesn't exactly match
- [x] routers.ts: liveData now uses getBotStateByPrefix() fallback + fetches open trade from DB when bot not in memory
- [x] routers.ts: manualExit now finds trade by ID alone (not requiring sessionToken match) to support cross-session exits
- [x] routers.ts: manualExit clears in-memory state using trade's actual sessionToken (not just input sessionToken)
- [x] Dashboard.tsx: activeTrade now prefers inMemOpenTrade (live trailing SL, partial bookings) over DB openTrade

## Critical Fix: Bot Auto-Restart + Unrealized P&L (Jul 8) — Round 3
- [x] Root cause identified: bot process dies on every server restart/deploy, liveData returns price:0, unrealizedPnl shows nothing
- [x] server/botRestart.ts: new module — on server startup, queries DB for status="running" sessions and restarts each bot engine with its open trade restored
- [x] server/_core/index.ts: calls restartRunningBots() after server.listen so bots auto-resume after every deploy
- [x] Dashboard.tsx: added red warning banner inside open trade panel when bot is not running — warns user that SL/Target are not being monitored

## Improvements Batch (Jul 9)
- [x] schema: add partial1RPrice and partial2RPrice float columns to trade_log
- [x] botEngine.ts: persist partial1RPrice/partial2RPrice to DB when trade opens
- [x] botRestart.ts: restore partial1RPrice/partial2RPrice exactly from DB (not recalculated)
- [x] Dashboard.tsx / TradeLog: add clickable Upstox hyperlink on each trade row (order ID links to Upstox order page)
- [x] Dashboard.tsx open trade panel: add Upstox order link next to the manual exit button
- [x] vitest: add botRestart safety rule tests (no open trade → marked stopped, partial1RPrice > entry for BUY)

## Feature Batch — Jul 9 (All with E2E tests)

### Feature 1: Persist currentSl to DB on every tick
- [x] schema: add currentSl float column to bot_sessions (written by onTick)
- [x] routers.ts onTick: write state.openTrade.currentSl to bot_sessions.currentSl
- [x] routers.ts liveData DB fallback: read currentSl from bot_sessions and use it when restoring open trade
- [x] botRestart.ts: restore currentSl from bot_sessions (not slPrice) so trailing SL survives restart
- [x] E2E test: trailing SL updated in state after tick, and restored correctly from DB

### Feature 2: Last-tick timestamp + staleness warning on Dashboard
- [x] schema: add lastTickAt bigint column to bot_sessions (unix ms, written by onTick)
- [x] routers.ts onTick: write Date.now() to bot_sessions.lastTickAt
- [x] routers.ts liveData: return lastTickAt in both in-memory and DB fallback paths
- [x] Dashboard.tsx: show "Last updated X seconds ago" next to live price
- [x] Dashboard.tsx: show amber warning badge when lastTickAt is stale (> 2x scanInterval)
- [x] E2E test: lastTickAt is set after tick and increases on subsequent ticks

### Feature 3: Restore dailyPnl from DB on bot restart
- [x] routers.ts bot.start: query today's closed trades sum for this sessionToken and use as initial dailyPnl (not 0)
- [x] botRestart.ts: same — restore dailyPnl from today's closed trades sum
- [x] E2E test: dailyPnl is correctly restored from DB trade history

### Feature 4: Paper-trade safety gate before going live
- [x] routers.ts bot.start: if mode=live and sessionToken has zero closed paper trades, return error "Complete at least 3 paper trades before going live"
- [x] Dashboard.tsx: show clear warning in the mode selector when switching to live with insufficient paper trades
- [x] E2E test: live mode blocked with 0 paper trades, allowed after 3+ paper trades

### Feature 5: Bot health watchdog
- [x] server/botWatchdog.ts: runs every 60s, checks all running bot sessions in DB, restarts any that are marked running but have no in-memory state (missed by botRestart)
- [x] server/_core/index.ts: start watchdog after server starts
- [x] E2E test: watchdog detects missing in-memory state and triggers restart

## Critical Bug Fixes — Jul 9 (Quantity / Duplicate Trade / Instrument)
- [x] botEngine.ts: fix quantity calculation to use lot size for futures (BankNifty lot=15, Nifty lot=25, etc.) — never trade fractional lots
- [x] botEngine.ts: hard block new signal if openTrade already exists in state — prevent duplicate open trades (server-side duplicate instrument check)
- [x] instrument selector: replace BankNifty Spot / Nifty Spot with their futures contracts (BANKNIFTY Jul Fut, NIFTY Jul Fut) — spot index is not directly tradeable
- [x] instrument definitions: add lotSize field to all instruments so quantity calculator uses it
- [x] integration tests: verify lot-size rounding, duplicate trade prevention, and futures instrument tokens

## Options Trading Fix — Jul 9 (Critical)

### Problem
- Bot was trading BankNifty/Nifty futures directly instead of reading them as trend and trading options
- Quantity calculation used underlying futures price (₹57,000) for SL distance → absurd lot sizes
- "Bank Nifty (Spot)" appearing in trade log — spot index is not tradeable

### Fix Plan
- [ ] schema: add underlyingToken, underlyingSymbol, optionType (CE/PE/auto) columns to bot_sessions
- [ ] botEngine.ts: add underlyingToken + optionTradeToken to BotState — fetch candles from underlying, place orders on option token
- [ ] botEngine.ts: fix quantity calc for options — use option premium price (not underlying price) for SL distance
- [ ] botEngine.ts: auto-select CE for BUY signal, PE for SELL signal when optionType="auto"
- [ ] routers.ts: extend bot.start schema to accept underlyingToken, optionType, tradeToken
- [ ] Dashboard.tsx: redesign instrument selector — "Index Options" group: user picks BankNifty/Nifty, bot auto-resolves ATM strike at runtime
- [ ] botRestart.ts: restore underlyingToken + tradeToken from DB on restart
- [ ] Tests: verify option quantity uses premium price, CE selected for BUY, PE for SELL
