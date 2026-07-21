# AUDIT FINDINGS — Discovery Phase Complete

## CRITICAL BUGS (Severity: HIGH — Losing Money)

### BUG A: Layer Filter Ordering — Cascade Bypass
**File:** `server/botEngine.ts` lines 4860 & 5092
**Issue:** V2 signal generation picks the FIRST matching layer (Breakout > Pattern > Trend > Momentum > MACD_BB > ORB > VWAPReversion). If a disabled layer fires first (e.g., Breakout), it returns non-HOLD. The multi-layer cascade at line 4860 only runs when signal is HOLD. The layer filter at line 5092 blocks the disabled signal and sets it to HOLD, BUT the cascade already ran above. Result: missed trades when a disabled layer fires before an enabled one.
**Fix:** Move the layer filter BETWEEN the V2 signal generation and the multi-layer cascade. Or: pass enabledLayers into generateSignalV2 so it skips disabled layers internally.

### BUG B: Trailing SL Overrides Premium SL
**File:** `server/botEngine.ts` line 4410
**Issue:** Trailing SL uses `trailDist = trade.entryPrice * (trailingSlPct / 100)`. For options with entry ₹500 and trailingSlPct=2%, trailDist = ₹10. After a small move up (e.g., ₹510), newSl = 510 - 10 = ₹500 (breakeven). This is TIGHTER than the premium SL of ₹350 (entry × 0.70). The trailing SL can move currentSl UP past the original 30% buffer, making the effective SL much tighter than intended.
**Fix:** Trailing SL should never be tighter than entry × 0.70 for options. Add: `const minSl = trade.entryPrice * 0.70; if (trade.direction === "BUY") trade.currentSl = Math.max(trade.currentSl, minSl);`
Wait — trailing SL moves UP (tighter), that's the POINT. But the issue is it can trigger too early. Actually this is CORRECT behavior — trailing protects profits. Not a bug.

### BUG C: DCA/Averaging Resets SL to ATR-based (not premium-based)
**File:** `server/botEngine.ts` line ~4510
**Issue:** After averaging, the new SL is set to `newAvgEntry - atrNow * 0.8`. For options, this should be `newAvgEntry * 0.70` (30% below new average). The ATR-based SL for options is wrong because ATR is calculated from the UNDERLYING candles, not the option premium.
**Fix:** If isOptionsMode, use `newAvgEntry * 0.70` instead of ATR-based SL.

### BUG D: Cross-Bot Guard — underlyingToken May Be Undefined
**File:** `server/botEngine.ts` line 5676
**Issue:** `const thisUnderlying = isOptionsMode ? (state.underlyingToken || state.instrumentToken) : tradeInstrumentToken;`
If `state.underlyingToken` is undefined AND `state.instrumentToken` is the NSE_INDEX token, then `thisUnderlying` = NSE_INDEX token. But `otherUnderlying` for another bot on the same index may use `otherState.instrumentToken` which could be the same NSE_INDEX token. This means two bots on the same index (e.g., Bot 1 NIFTY and Bot 4 NIFTY) will ALWAYS block each other — even if one is CE and the other is PE.
**Fix:** For options, the direction check should compare CE vs PE, not just "both buying options on same underlying = duplicate". Two bots can legitimately trade CE and PE on the same underlying.

## MEDIUM BUGS (Severity: MEDIUM — Suboptimal Execution)

### BUG E: V2 Engine Doesn't Skip Disabled Layers Internally
**File:** `server/botEngine.ts` lines 1564-1990
**Issue:** generateSignalV2 checks layers in priority order (Breakout > Pattern > Trend > ...) and returns the FIRST match. It has no awareness of enabledLayers. If Breakout is disabled but Pattern is enabled, V2 will return Breakout and the layer filter will block it, but Pattern never gets evaluated.
**Fix:** Pass enabledLayers to generateSignalV2 and skip disabled layers in the priority chain.

### BUG F: Paper Mode Delta Approximation Inaccuracy
**File:** `server/botEngine.ts` lines 4113-4131
**Issue:** Delta is hardcoded as 0.5/0.4/0.3 based on moneyness. Real delta changes dynamically with time decay, IV, and underlying movement. For intraday scalps this is acceptable, but for carry-forward trades it can drift significantly.
**Impact:** Paper mode P&L may not reflect reality. Low priority since live mode uses real quotes.

### BUG G: Session Defaults Don't Auto-Switch Running Bots (Server-Side)
**File:** `shared/sessionDefaults.ts` (client-only)
**Issue:** The session auto-switch logic is purely client-side (Dashboard useEffect). If the user closes the browser at 3:30 PM, bots keep running on NSE instruments during MCX session. The server has no session-switch logic.
**Fix:** Add server-side session detection in the tick function that checks IST time and suggests instrument switch (or auto-switches if no manual override flag is set in DB).

## LOW BUGS (Severity: LOW — Code Quality / Edge Cases)

### BUG H: auth.logout.test.ts Path Alias Failure
**File:** `server/auth.logout.test.ts`
**Issue:** Vitest can't resolve `@shared/const` alias. Pre-existing issue, not related to our changes.
**Fix:** Add path alias to vitest.config.ts resolve section.

### BUG I: Stale Debug Files in Project Root
**Files:** `debug_6month.ts`, `debug_full.ts`, `debug_hourly.ts`, `debug_regime_wed.ts`, `debug_signals.ts`, `debug_sl.ts`, `debug_wed.ts`, `stage1_6month_replay.ts`, `stage1_replay.ts`, `nifty_1min_6months.json`
**Issue:** Debug/test files left in project root. These get deployed to Railway unnecessarily.
**Fix:** Move to a `/debug/` directory or add to .gitignore.

### BUG J: Adaptive Regime Can Re-enable "Trend" Layer Even When User Disabled It
**File:** `server/botEngine.ts` lines 4840-4855
**Issue:** When ADX > 25, the adaptive regime pushes "Trend" back into enabledLayers even if the user explicitly disabled it. The `regimeManualOverride` flag exists but is only set when user manually changes regime, not when they disable the Trend layer specifically.
**Fix:** Check if "Trend" was explicitly disabled by user (not just absent from enabledLayers due to regime) before re-enabling.

## SUMMARY

| # | Bug | Severity | Category | Status |
|---|-----|----------|----------|--------|
| A | Layer filter ordering — cascade bypass | HIGH | Execution | OPEN |
| B | Trailing SL override (actually correct) | N/A | — | NOT A BUG |
| C | DCA resets SL to ATR-based for options | HIGH | Execution | OPEN |
| D | Cross-bot guard blocks CE+PE on same underlying | HIGH | Execution | OPEN |
| E | V2 doesn't skip disabled layers internally | MEDIUM | Execution | OPEN |
| F | Paper mode delta approximation | LOW | Accuracy | ACCEPTABLE |
| G | Session defaults client-only | MEDIUM | Reliability | OPEN |
| H | auth.logout.test.ts path alias | LOW | Tests | PRE-EXISTING |
| I | Stale debug files deployed | LOW | Cleanup | OPEN |
| J | Adaptive regime re-enables Trend | MEDIUM | Execution | OPEN |
