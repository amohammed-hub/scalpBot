# Full Codebase Audit Progress

## Phase 1: Manual Average Override Button
- Need to add a "Force Average" button in Dashboard.tsx next to the averaging indicator
- Need to add a backend procedure in routers.ts that triggers manual averaging
- The averaging logic is in botEngine.ts around the "AVERAGING / DCA" section

## Key File Locations
- botEngine.ts: ~3200 lines — signal engine, trade lifecycle, averaging logic
- routers.ts: ~2400 lines — all tRPC procedures
- Dashboard.tsx: ~3200 lines — main dashboard UI
- Settings.tsx: ~1220 lines — settings page
- schema.ts: drizzle schema with bot_sessions, trade_log, etc.
- db.ts: database query helpers
- shared/types.ts: shared type definitions
- shared/mcxInstruments.ts: MCX instrument registry

## Bugs Found So Far
(Will be populated during audit)

## Files Audited
- [ ] server/botEngine.ts
- [ ] server/routers.ts
- [ ] server/db.ts
- [ ] server/storage.ts
- [ ] server/botRestart.ts
- [ ] server/botWatchdog.ts
- [ ] server/activityLog.ts
- [ ] drizzle/schema.ts
- [ ] drizzle/relations.ts
- [ ] shared/types.ts
- [ ] shared/const.ts
- [ ] shared/mcxInstruments.ts
- [ ] client/src/pages/Dashboard.tsx
- [ ] client/src/pages/Settings.tsx
- [ ] client/src/pages/HeroZeroScanner.tsx
- [ ] client/src/pages/PnLAnalytics.tsx
- [ ] client/src/pages/Backtest.tsx
- [ ] client/src/pages/RiskCalculator.tsx
- [ ] client/src/pages/Home.tsx
- [ ] client/src/pages/UpstoxCallback.tsx
- [ ] client/src/App.tsx
- [ ] client/src/components/DashboardLayout.tsx
- [ ] client/src/components/Navbar.tsx
- [ ] client/src/components/ErrorBoundary.tsx
- [ ] client/src/index.css
- [ ] vite.config.ts
- [ ] server/_core/env.ts
