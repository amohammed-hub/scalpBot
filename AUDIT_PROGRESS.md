# Full Codebase Audit — Progress Tracker

## Files Read So Far (Phase 1: Discovery)

### Server Files (Core Logic)
| File | Lines | Status | Bugs Found |
|------|-------|--------|------------|
| server/botEngine.ts | 3711 | Read 1-750, 1800-2050 | Need to finish reading |
| server/routers.ts | 3776 | Previously audited | BUG-5, BUG-10 fixed |
| server/db.ts | 620 | Previously audited | BUG-2 fixed |
| server/riskManager.ts | 396 | Previously audited | BUG-4, BUG-11, BUG-12, BUG-13 fixed |
| server/layerTracker.ts | 145 | Previously audited | BUG-3 fixed |
| server/botRestart.ts | 377 | Previously audited | BUG-1 fix applied |
| server/botWatchdog.ts | 99 | Read (overview) | No new bugs |
| server/activityLog.ts | 101 | Previously audited | BUG-9 fixed |
| server/optionsAnalytics.ts | 233 | Read (overview) | Need deep read |
| server/precisionMetrics.ts | 574 | NOT YET READ | HIGH PRIORITY |
| server/presets.ts | 64 | Read (overview) | No bugs |
| server/storage.ts | 97 | NOT YET READ | |
| server/index.ts | 33 | Read (overview) | No bugs |

### Test Files
| File | Status | Notes |
|------|--------|-------|
| server/botEngine.test.ts | NOT YET READ | |
| server/botLifecycle.integration.test.ts | Read (overview) | Tests may be unreliable |
| server/botRestart.test.ts | Read (overview) | Tests reimplements logic |
| server/riskManager.test.ts | Read (overview) | Uses default session |
| server/twilio.test.ts | Read (overview) | BLOCKS test suite without env vars |
| server/adminBypass.test.ts | Read (overview) | Trivial |
| server/auth.logout.test.ts | NOT YET READ | |

### Schema & Shared
| File | Status | Notes |
|------|--------|-------|
| drizzle/schema.ts | 218 | Previously read | No new bugs |
| drizzle/relations.ts | NOT YET READ | |
| shared/types.ts | 7 | Trivial | |
| shared/const.ts | 37 | NOT YET READ | |
| shared/mcxInstruments.ts | NOT YET READ | |

### Client/Frontend Files
| File | Lines | Status |
|------|-------|--------|
| client/src/pages/Dashboard.tsx | 3184 | Partially read |
| client/src/pages/PnLAnalytics.tsx | NOT YET READ | |
| client/src/pages/Settings.tsx | NOT YET READ | |
| client/src/pages/HeroZeroScanner.tsx | NOT YET READ | |
| client/src/pages/Backtest.tsx | NOT YET READ | |
| client/src/pages/RiskCalculator.tsx | NOT YET READ | |
| client/src/pages/Login.tsx | NOT YET READ | |
| client/src/pages/Verification.tsx | NOT YET READ | |
| client/src/pages/UpstoxCallback.tsx | NOT YET READ | |
| client/src/pages/Home.tsx | NOT YET READ | |
| client/src/App.tsx | NOT YET READ | |
| client/src/components/AdminPanel.tsx | NOT YET READ | |

## Bugs Already Fixed (from previous audit)
All 17 bugs from the previous audit have been fixed and pushed to GitHub.

## NEW Bugs Found in This Audit (so far)
Need to continue reading to find new bugs.

## Key Areas Still To Read
1. botEngine.ts lines 750-1800 (signal generation layers 3-7, trade open/close logic)
2. botEngine.ts lines 2050-3711 (tick loop, SL/target monitoring, partial booking, averaging)
3. precisionMetrics.ts (full file - analytics/P&L calculations)
4. routers.ts (full re-read after fixes applied)
5. All frontend pages
6. All test files (to verify they actually pass)

## Notes on Architecture
- Bot state is in-memory Map<sessionToken, BotState>
- DB is MySQL/TiDB via Drizzle ORM
- Frontend uses tRPC for all API calls
- Upstox API for market data and order placement
- Session tokens are browser-generated UUIDs stored in localStorage
- Multi-slot: primary + slot1 + slot2 (sessionToken + "-slot1" / "-slot2")
- Options mode: reads underlying price, resolves ATM CE/PE at trade time
- MCX instruments: fetches from Upstox public JSON, caches 6 hours
