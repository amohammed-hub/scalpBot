# Full Codebase Audit — Bug List

## CONFIRMED BUGS TO FIX

### Bug 1: VWAPPullback layer uses wrong layer name (botEngine.ts line 844)
- **Impact**: Layer tracker conflates VWAPPullback and VWAPDeviation as same layer "VWAPReversion"
- **Fix**: Change `layer = "VWAPReversion"` to `layer = "VWAPPullback"` on line 844
- **Also requires**: Adding "VWAPPullback" to the Signal.layer union type on line 43

### Bug 2: Supertrend type cast smell (botEngine.ts line 856)
- **Impact**: `st.direction !== ("HOLD" as any)` — Supertrend returns "BUY"|"SELL" but line 217 returns `"HOLD" as any` for insufficient data
- **Fix**: Change line 217 to return `{ direction: "BUY", band: 0, flipped: false }` (safe default) OR add proper guard. Best fix: check `candles.length < atrPeriod + 2` already returns early, so the "HOLD" path is for insufficient data — just use `"BUY"` as neutral default since `flipped` will be false.

### Bug 3: resolveAtmOptionToken NSE — empty expiry_date param (botEngine.ts line 1317)
- **Impact**: `expiry_date=` empty string in URL may cause Upstox API to return unexpected results or error
- **Fix**: Remove `&expiry_date=` from the URL entirely (Upstox returns nearest expiry by default when omitted)

### Bug 4: manualExit does NOT apply paper costs (routers.ts lines 914-916)
- **Impact**: Manual exit in paper mode shows raw P&L without brokerage+slippage deduction, inconsistent with auto-exit
- **Fix**: Apply `applyPaperCosts()` when `trade.mode === "paper"`

### Bug 5: botRestart.ts onTradeOpen callback missing partial1RPrice/partial2RPrice (lines 141-159)
- **Impact**: If bot opens a NEW trade after restart, the trade_log row won't have partial levels stored
- **Fix**: Add `partial1RPrice` and `partial2RPrice` to the insert payload (they come from the trade parameter)

### Bug 6: botRestart.ts onTradeClose uses stale session counters (lines 176-179)
- **Impact**: After restart, trade close updates DB with stale `session.tradesCount` + 1 instead of live bot state
- **Fix**: Use `getBotState(session.sessionToken)` to get live values, fall back to session values

### Bug 7: Secondary slot onTradeClose doesn't refresh StoplossGuard (routers.ts lines 1688-1705)
- **Impact**: StoplossGuard only updates from primary bot trades, not secondary slot trades
- **Fix**: Add `updateStoplossGuard()` call in secondary onTradeClose (same as primary path at lines 561-569)

### Bug 8: Secondary slot open trade restore missing `entryUnderlyingPrice` (routers.ts line 1601-1612)
- **Impact**: After restart, secondary slot option trades can't calculate delta drift correctly
- **Fix**: Same as primary — approximate from bot_sessions.lastPrice when isIndexOptions is true

### Bug 9: Kill switch uses raw lastPrice for options exit (riskManager.ts line 275)
- **Impact**: For options trades, kill switch uses underlying spot price instead of option premium for P&L
- **Fix**: Use `bot.optionPremiumPrice` when `trade.isIndexOptions` is true

## LOWER PRIORITY (cosmetic/minor)

### Minor 1: Supertrend layer name is "Trend" (line 865) — could be "Supertrend" for better tracking
- Not fixing: it's intentional grouping with EMA/VWAP Trend layer

### Minor 2: MCX instruments JSON cache — no daily invalidation
- The instruments JSON is fetched fresh each time resolveAtmMcxOptionToken is called (no persistent cache)
- Not a bug — it's fetched on demand and MCX expiry dates don't change within a day

### Minor 3: entryUnderlyingPrice not persisted in DB (schema gap)
- Current workaround: approximated from session.lastPrice on restart
- Acceptable for paper mode — the drift is small over a restart window
- Would need schema migration to fix properly — deferring

## VERIFICATION ITEMS (confirmed OK)
- ✅ Paper costs applied on all 3 auto-exit paths (square-off line 1768, Hero Zero line 1803, SL/Target line 1891)
- ✅ isIndexOptions preserved on openTrade across restarts (botRestart.ts line 99)
- ✅ optionMockKey restored on restart (botRestart.ts lines 106-118)
- ✅ Readiness thresholds match spec (win rate ≥50%, PF ≥1.5, DD <10%, min 20 trades)
- ✅ Cooldown correctly uses 2 × scanIntervalSec (riskManager.ts line 243)
- ✅ Exposure cap at 80% (riskManager.ts line 235)
- ✅ StoplossGuard threshold = 3 consecutive SLs (riskManager.ts line 136)
- ✅ Daily candle fetch for S/R pivots works correctly
- ✅ MCX instruments JSON approach for option resolution is correct
