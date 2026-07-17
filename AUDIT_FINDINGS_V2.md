# Full Codebase Audit V2 — Bug Findings

## Files Fully Read
- botEngine.ts: lines 1-750, 1800-2950
- routers.ts: previously audited (BUG-5, BUG-10 fixed)
- db.ts: previously audited (BUG-2 fixed)
- riskManager.ts: previously audited (BUG-4, BUG-11, BUG-12, BUG-13 fixed)
- layerTracker.ts: previously audited (BUG-3 fixed)
- botRestart.ts: previously audited (BUG-1 fixed)
- activityLog.ts: previously audited (BUG-9 fixed)

## NEW Bugs Found in This Audit

### BUG-18: CRITICAL — Force square-off in no-data path double-counts bookedPnl
File: botEngine.ts, line 2153
When candles return empty and force square-off triggers, the code adds bookedPnl to pnl then adds to dailyPnl without checking bookedPnlAddedToDaily flag.

### BUG-19: MEDIUM — isOpeningTrade mutex never cleared on error
File: botEngine.ts - if trade open path throws, mutex stays true, permanently blocking new trades.

### BUG-20: LOW — reEntryCandles increments per-tick not per-candle
File: botEngine.ts, line 2845 - if scanInterval < 60s, re-entry triggers too early.

### BUG-21: MEDIUM — Averaging qty may be 0 leading to divide-by-zero
File: botEngine.ts - Math.floor(riskAmount / avgPrice) could be 0 for small capital.

## Still To Read
- botEngine.ts: lines 750-1800 (signal layers), 2950-3711 (trade open, startBot, stopBot)
- precisionMetrics.ts
- Frontend pages
- Test files
