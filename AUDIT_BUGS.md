# Full Codebase Audit — FINAL REPORT

**Date:** July 19, 2026
**Auditor:** Manus AI
**Scope:** All server, client, and shared source files
**TypeScript Errors:** 0
**Test Results:** 153/153 passing

---

## PREVIOUSLY REPORTED BUGS — ALL VERIFIED AS FIXED

| # | Bug | Status | Verification |
|---|-----|--------|--------------|
| 1 | 2R Partial Booking uses wrong quantity | ✅ FIXED | Line 3364: `(trade.quantity - trade.bookedQty) * 0.5` |
| 2 | forceAverageDown uses state.lastPrice for options | ✅ FIXED | Line 4718: uses `state.optionPremiumPrice ?? state.lastPrice` |
| 3 | Auto-restart doesn't carry averaging settings | ✅ FIXED | botRestart.ts line 268-269: passes averagingEnabled/averagingLossThreshold |
| 4 | precisionMetrics layer name mismatch | ✅ FIXED | Uses `[LayerName]` tag extraction from signalReason |
| 5 | riskManager kill switch doesn't check order success | ✅ FIXED | Line 377: `if (!killOrderId) { continue; }` |
| 6 | effectivePrice for options uses Math.max(bid, ltp) | NOT A BUG | Intentional conservative design |
| 7 | Trailing SL telegram shows wrong qty | NOT A BUG | No telegram alert is sent on trailing SL update (only on partial book) |
| 8 | Daily reset may not fire across midnight | ✅ WORKING | Uses IST date comparison on every tick — fires correctly on new day |

---

## NEW BUGS FOUND & FIXED IN THIS AUDIT

### BUG A: Auto-restart in botEngine.ts missing unlimitedTrades/averaging settings
**File:** server/botEngine.ts line 4639 (setInterval error handler restart)
**Issue:** When bot auto-restarts after 3 consecutive tick errors, the rebuilt config
was missing `unlimitedTrades`, `averagingEnabled`, and `averagingLossThreshold`.
**Impact:** After auto-restart, unlimited trades toggle would silently revert to OFF,
and averaging settings would reset to defaults.
**Fix:** Added all 3 fields to the auto-restart config object.

### BUG B: handleStart in Dashboard.tsx missing useV2Engine
**File:** client/src/pages/Dashboard.tsx line 916
**Issue:** The main `handleStart` function (used when clicking "Start Bot" in the config tab)
did NOT pass `useV2Engine` to the backend, while all other start paths (QuickStart, InstrumentSwitch) did.
**Impact:** Starting bot from config tab always used V1 engine regardless of toggle state.
**Fix:** Added `useV2Engine: localStorage.getItem("scalpbot_v2_engine") === "true"` to handleStart.

### BUG C: Inline scanner start mutations missing useV2Engine
**File:** client/src/pages/Dashboard.tsx lines 2043, 2057
**Issue:** When user clicks a Hero Zero Scanner result to auto-start a bot, the inline
`startMutation.mutate()` and `startSecondaryMutation.mutate()` calls were missing `useV2Engine`.
**Impact:** Bots started from scanner results always used V1 engine.
**Fix:** Added `useV2Engine` to both inline mutation calls.

---

## CODE QUALITY OBSERVATIONS (NOT BUGS)

1. **Import at bottom of App.tsx** — `Verification` page import is at the bottom after the export.
   ESM hoists imports so this works at runtime, but is unconventional. Low priority.

2. **Large file sizes** — botEngine.ts (4925 lines), routers.ts (3800+ lines), Dashboard.tsx (3200+ lines).
   Consider splitting into modules for maintainability.

3. **`(row as any).unlimitedTrades`** in routers.ts restart path — since unlimitedTrades is not in the
   DB schema, this always evaluates to `undefined ?? false`. Correct behavior (admin toggle is session-only)
   but the `as any` cast is a code smell.

4. **Twilio test timeout** — `server/botEngine.test.ts` Twilio test makes a real API call and
   occasionally times out. Should be mocked for CI reliability.

---

## FINAL VERIFICATION

- TypeScript: 0 errors (`npx tsc --noEmit`)
- Tests: 153/153 passing (`npx vitest run`)
- Dev server: Running without errors
- Browser console: No runtime errors
- All subscription tier gates working correctly
- All MCX lock icons rendering properly
- Admin bypass functioning for all restrictions
