# MASTER BUG LIST — Full Codebase Audit V2

## Previously Fixed (17 bugs from earlier audit)
BUG-1 through BUG-17 were fixed in commit cad69c2.

---

## NEW BUGS FOUND IN THIS AUDIT

### BUG-18: CRITICAL — Force square-off in no-data path double-counts bookedPnl
- **File:** server/botEngine.ts, line 2153
- **Issue:** When candles return empty and force square-off triggers, code does:
  ```
  let pnl = (exitPx - entryPrice) * noDataRemQty + (trade.bookedPnl ?? 0);
  state.dailyPnl += pnl;
  ```
  But doesn't check `bookedPnlAddedToDaily`. If partial booking already added bookedPnl to dailyPnl in this session, it DOUBLE-COUNTS.
- **Impact:** Inflated daily P&L after server restart with partial-booked trade + no candle data

### BUG-19: MEDIUM — isOpeningTrade mutex never cleared on certain error paths
- **File:** server/botEngine.ts, line 3256
- **Issue:** `state.isOpeningTrade = false` is set at line 3256 (after successful trade open). But the mutex is set to `true` earlier in the trade open path. If an error occurs between setting it true and line 3256 (e.g., option resolution fails and returns early), the mutex stays true.
- **Actually:** Looking more carefully, the trade open section is inside the try/finally of the tick function (line 3301: `state.tickInProgress = false`). But isOpeningTrade is separate from tickInProgress. Let me check where isOpeningTrade is set to true...
- **Verification needed:** Check where `state.isOpeningTrade = true` is set. If it's set before the early-return paths (option resolution, exposure cap), those returns DON'T clear it.
- **Impact:** Bot permanently stops opening new trades until restart

### BUG-20: LOW — reEntryCandles increments per-tick not per-candle
- **File:** server/botEngine.ts, line 2845
- **Issue:** `state.reEntryCandles += 1` runs on every tick. If scanInterval=15s and candles are 1-min, it counts 4 ticks per candle, making re-entry trigger after 0.5 candles instead of 2.
- **Impact:** Re-entry happens too quickly on fast scan intervals (minor, most users use 60s)

### BUG-21: MEDIUM — forceAverageDown uses String() for float DB columns
- **File:** server/botEngine.ts, lines 3638-3644
- **Issue:** `entryPrice: String(newAvgEntry)`, `slPrice: String(trade.slPrice)` etc. These columns are float/double in the schema, not varchar. String wrapping may cause type mismatch.
- **Impact:** Same as original BUG-6 — potential data corruption in DB

### BUG-22: MEDIUM — precisionMetrics date filtering uses UTC boundaries for IST data
- **File:** server/precisionMetrics.ts, lines 115-118, 135-137
- **Issue:** Date range filtering uses `new Date(fromDate)` and `new Date(toDate + "T23:59:59")` which are UTC. But trades are timestamped in IST context. A trade at 11:30 PM IST on Jan 5 = 6:00 PM UTC Jan 5 — would be included. But a trade at 12:30 AM IST on Jan 6 = 7:00 PM UTC Jan 5 — would be INCLUDED in Jan 5 filter when it shouldn't be.
- **Impact:** Off-by-one day errors in analytics date filtering

### BUG-23: MEDIUM — precisionMetrics groups closed trades by enteredAt not exitedAt
- **File:** server/precisionMetrics.ts, lines 189, 204, 249, 418-427, 441
- **Issue:** Daily P&L reports bucket trades by entry date, not exit date. A trade entered on Monday but closed on Tuesday shows up in Monday's P&L.
- **Impact:** Daily P&L reports show incorrect day attribution

### BUG-24: LOW — precisionMetrics layer attribution uses regex on signalReason
- **File:** server/precisionMetrics.ts, lines 328-354
- **Issue:** Layer attribution uses regex patterns on `tradeLog.signalReason` text instead of the canonical `signalLayer` field or journal `tradeId` linkage.
- **Impact:** If signal reason text format changes, layer stats break silently

### BUG-25: MEDIUM — twilio.test.ts makes real network calls, blocks test suite
- **File:** server/twilio.test.ts
- **Issue:** Test requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER env vars and makes a real HTTP call to api.twilio.com. Fails in any environment without these secrets.
- **Impact:** `pnpm test` fails in CI/dev environments without Twilio credentials

### BUG-26: LOW — Settings.tsx averaging UI uses localStorage without React state
- **File:** client/src/pages/Settings.tsx, lines 1154-1192
- **Issue:** Averaging checkbox uses `checked={localStorage.getItem(...) !== "false"}` and slider uses `defaultValue` from localStorage. Changes to localStorage don't trigger re-renders.
- **Impact:** Stale UI values displayed until page refresh

### BUG-27: MEDIUM — optionsAnalytics cache key doesn't include expiry type
- **File:** server/optionsAnalytics.ts, lines 45-56
- **Issue:** Cache is keyed only by underlying token. If different expiry types (current_week vs current_month) are requested for the same underlying, stale data from previous expiry type is returned.
- **Impact:** Wrong options analytics data for different expiry selections (minor — 2 min cache)

---

## SUMMARY TABLE

| # | Severity | File | One-line Description |
|---|----------|------|---------------------|
| 18 | CRITICAL | botEngine.ts:2153 | Force square-off double-counts bookedPnl (no bookedPnlAddedToDaily check) |
| 19 | MEDIUM | botEngine.ts | isOpeningTrade mutex not cleared on early-return paths |
| 20 | LOW | botEngine.ts:2845 | reEntryCandles increments per-tick not per-candle |
| 21 | MEDIUM | botEngine.ts:3638 | forceAverageDown uses String() for float DB columns |
| 22 | MEDIUM | precisionMetrics.ts:115 | Date filtering uses UTC boundaries for IST-context data |
| 23 | MEDIUM | precisionMetrics.ts:189 | Closed trades grouped by enteredAt not exitedAt |
| 24 | LOW | precisionMetrics.ts:328 | Layer attribution uses fragile regex instead of canonical field |
| 25 | MEDIUM | twilio.test.ts | Real network call blocks test suite without credentials |
| 26 | LOW | Settings.tsx:1154 | Averaging UI reads localStorage without React state |
| 27 | MEDIUM | optionsAnalytics.ts:45 | Cache key missing expiry type dimension |

---

## FIX ORDER (dependency-based)
1. BUG-18 (critical P&L double-count)
2. BUG-19 (mutex deadlock)
3. BUG-21 (String() in forceAverage — same pattern as BUG-6)
4. BUG-22 + BUG-23 (precisionMetrics date issues — fix together)
5. BUG-24 (layer attribution — fix with BUG-22/23)
6. BUG-25 (test suite — skip Twilio test when no env vars)
7. BUG-20 (reEntry per-candle)
8. BUG-26 (Settings UI)
9. BUG-27 (cache key)
