# MASTER BUG LIST — Full Codebase Audit (Phase 1 Discovery)

## Status: AWAITING USER APPROVAL TO FIX

---

## NEW BUGS FOUND (after previous 17-bug fix)

| # | Severity | File:Line | Description | Impact |
|---|----------|-----------|-------------|--------|
| 18 | **CRITICAL** | botEngine.ts:2153 | Force square-off adds `bookedPnl` to P&L without checking `bookedPnlAddedToDaily` flag | Double-counted P&L when partial-booked trade is force-closed at market end |
| 19 | ~~MEDIUM~~ | ~~botEngine.ts~~ | ~~isOpeningTrade mutex not cleared~~ | **FALSE POSITIVE — already handled by try/catch at line 3216** |
| 20 | LOW | botEngine.ts:2845 | `reEntryCandles += 1` runs per-tick not per-candle | Re-entry triggers too early on fast scan intervals (15s/30s) |
| 21 | MEDIUM | botEngine.ts:3638 | `forceAverageDown` uses `String()` for float DB columns | Data type mismatch — same pattern as previously fixed BUG-6 |
| 22 | MEDIUM | precisionMetrics.ts:115 | Date filtering uses UTC boundaries (`new Date(fromDate)`) for IST-context trade data | Off-by-one day errors in analytics (trades near midnight IST) |
| 23 | MEDIUM | precisionMetrics.ts:189 | Closed trades grouped by `enteredAt` not `exitedAt` | Daily P&L shows trade on wrong day (entered Mon, closed Tue → shows in Mon) |
| 24 | LOW | precisionMetrics.ts:328 | Layer attribution uses regex on `signalReason` text instead of canonical `signalLayer` field | Layer stats break if reason text format changes |
| 25 | MEDIUM | twilio.test.ts | Test makes real HTTP call to api.twilio.com — fails without env vars | `pnpm test` fails in any environment without Twilio credentials |
| 26 | LOW | Settings.tsx:1154 | Averaging UI reads `localStorage` directly without React state | Stale toggle/slider values until page refresh |
| 27 | LOW | optionsAnalytics.ts:45 | Cache key is only `underlyingToken` — doesn't include expiry type | Stale analytics if different expiry types queried within 2-min cache window |

---

## FIX ORDER (dependency-based)

1. **BUG-18** — Critical P&L double-count in force square-off (1 line fix)
2. **BUG-21** — String() in forceAverageDown (remove String wrappers)
3. **BUG-22 + BUG-23** — precisionMetrics date issues (fix together)
4. **BUG-24** — Layer attribution (use signalLayer field)
5. **BUG-25** — Skip Twilio test when no env vars
6. **BUG-20** — reEntry per-candle tracking
7. **BUG-26** — Settings UI React state
8. **BUG-27** — Cache key fix

---

## ESTIMATED EFFORT
- Total: ~45 minutes
- Critical fix (BUG-18): 2 minutes
- Medium fixes (21-25): 25 minutes
- Low fixes (20, 26, 27): 15 minutes

---

## NOTE
BUG-19 was a false positive. The `isOpeningTrade` mutex IS properly handled:
- Set to `true` at line 3204
- Cleared in `catch` at line 3218 (if DB insert fails)
- Cleared at line 3256 (after successful trade open)
- No async code between 3224-3256 that could throw uncaught
