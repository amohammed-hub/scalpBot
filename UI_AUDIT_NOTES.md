# Full UI Audit Notes (Jul 25, 2026)

## Pages & Routes
- `/` — Home (landing page: hero, features, how-it-works, pricing section)
- `/login` — Phone+OTP login flow (mobile → otp → name steps)
- `/dashboard` — Command Center tab (trading mode, opening burst, parallel bots, stats, open positions, risk panel, signal card, open trade panel)
- `/dashboard/trades` — Trade Log tab (layer scorecard admin-only, trade history table)
- `/dashboard/config` — Config tab (trading mode duplicate, risk & strategy settings, strategy layers, presets, paper costs, layer scorecard)
- `/dashboard/log` — Activity Log tab
- `/risk-calculator` — 5 tabs: Calculator, Pre-Trade Checklist, Daily Limit, Expectancy, Trade Journal
- `/settings` — Sidebar (Dashboard, Risk Calc, Settings), main: API guide, credentials form, Telegram setup, notification prefs, referral section
- `/hero-zero` — Hero Zero Scanner (0DTE option candidates)
- `/pnl-analytics` — P&L charts, filters, export (Excel/CSV)
- `/backtest` — Backtester (equity curve, trades, distribution tabs)
- `/verification` — Precision Verification (overview, layers, daily tabs)
- `/upstox-callback` — OAuth callback handler
- `/terms` — Terms of service
- `/privacy` — Privacy policy
- ComponentShowcase.tsx exists but has NO route (dead code)

## Dashboard Sidebar Navigation
1. Dashboard (active)
2. Risk Calculator
3. Settings
4. Hero Zero Scanner (purple)
5. P&L Analytics (green)
6. Backtester (blue)
7. Precision Verify (amber)
8. Refer & Earn (component)
9. Admin Panel (admin-only, red)

## Dashboard Tabs (top bar)
1. Command Center 🎯
2. Trade Log 📊
3. Activity Log 📜
Note: "Config" tab exists in routes but NOT in the tab navigation bar (hidden/removed from UI?)
Actually checking: config tab IS in routes (/dashboard/config) but NOT in the tab buttons array. Only command, trades, log are shown.

## Admin Panel Tabs
1. Users — user list with revoke button, bot slots override button
2. Subscriptions — subscription list
3. Activity — activity log
4. Access Grants — manual grant form + active grants table with revoke/extend
5. Referrals — stats + referral log
6. System Health — DB status, running bots, memory, uptime
7. Notifications — notification list
8. Broadcast — broadcast messages
9. Templates — message templates

## Risk Calculator Tabs
1. Calculator — position size calculator
2. Pre-Trade Checklist — 10-point checklist
3. Daily Limit — daily max loss tracker
4. Expectancy — win rate × R:R calculator
5. Trade Journal — MANUAL trade logging (SHOULD BE REMOVED — bot logs automatically)

## Settings Page Sections
1. Privacy notice
2. How to Get API Key & Secret (collapsible guide)
3. Credentials form (API Key, Secret, Redirect URI, Connect button)
4. How to Set Up Telegram Alerts (collapsible guide)
5. Telegram config (Bot Token, Chat ID, Test button)
6. Notification Preferences (collapsible)
7. Sound Notifications toggle
8. Daily Summary toggle
9. Token Refresh Reminder toggle
10. Referral Section
11. Mobile bottom tab nav

## Key Findings

### BROKEN / NOT FUNCTIONAL
- Admin "Revoke" button: Backend sets isVerified=false but checkAccess relies on subscription status, not isVerified. May not actually block user.
- Config tab (/dashboard/config): Route exists but tab button was removed from UI. Dead route.
- Trade Journal in Risk Calculator: Manual trade logging — useless since bot auto-logs. Confuses users.
- ComponentShowcase.tsx: 58KB dead code file with no route.
- "No Login Required" feature card on homepage: Contradicts the actual login requirement.
- Home page pricing "Subscribe" buttons: Call handleSubscribe but unclear if payment flow works.

### SHOULD BE REMOVED
- Trade Journal tab from Risk Calculator
- ComponentShowcase.tsx (dead code)
- "No Login Required" feature card text on homepage (misleading)
- /dashboard/config route (orphaned, content duplicated in Command Center)

### SHOULD BE ADDED
- Trial flow: Require phone+OTP BEFORE paper mode starts (user's priority #5)
- Admin: "Bot Slots actually apply" verification
- Admin: Clear indication when revoke is successful and user is blocked

### SHOULD BE MOVED
- Strategy/Config settings: Currently duplicated between Command Center and Config tab. Should live in ONE place only (Command Center makes sense since user interacts with bot there).
- Precision Verify: Could be a tab in P&L Analytics instead of separate page (both analyze trade performance).
- Hero Zero Scanner: Niche feature, could be hidden behind "Advanced" or only shown to paid users.

### REDUNDANCY
- Trading Mode toggle appears in BOTH Command Center tab AND Config tab (duplicate)
- Risk & Strategy Settings panel appears in BOTH Command Center and Config tab
- Opening Burst toggle in Command Center
