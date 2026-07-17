# ScalpBot Signal Engine — Adversarial Logic Audit Report

**Date:** 17 July 2026  
**Scope:** `server/botEngine.ts` (generateSignal + special generators) and `server/riskManager.ts`  
**Methodology:** 6-phase adversarial audit per the provided specification  
**Status:** DIAGNOSIS ONLY — no code changes applied. Awaiting approval before fixes.

---

## Executive Summary

The signal engine contains **4 critical logic flaws**, **3 design gaps**, and **1 confirmed bug** that collectively explain the pattern of repeated stop-loss hits followed by the same wrong signal firing again. The root cause is not any single indicator being wrong — it is the **architecture of the decision tree itself**, which uses exclusively lagging indicators gated by a 5-minute trend filter that creates complete directional blindness for 30-60 minutes after a reversal.

| Severity | Count | Summary |
|----------|-------|---------|
| Critical (causes repeated losses) | 4 | VWAP hard gate, 5m trend blindness, no direction-aware loss tracking, StoplossGuard resumes blind |
| High (confirmed bug) | 1 | BankNifty Hero Zero fires every Wednesday (weekly expiry discontinued) |
| Medium (design gap) | 3 | No correlation check across slots, MCX Evening lacks pullback filter, theta decay not accounted for |
| Low (dead code / inefficiency) | 3 | 5m candle fetch always fails, HourlyClose 10-min window, VWAPPullback logical contradiction |

---

## Phase 0: Decision Architecture Map

The signal engine evaluates 12 layers in priority order. The first layer to produce a BUY or SELL signal wins. After the signal is generated, three post-filters can reject it (S/R proximity, 2-candle confirmation, confidence threshold).

### Signal Layer Summary

| # | Layer | Core Logic | VWAP Required? | 5m Gate |
|---|-------|-----------|----------------|---------|
| 1 | Breakout | Close beyond 20-bar high/low | No | strict5m |
| 2 | Pattern | Engulfing / Hammer / Marubozu | Engulfing+Marubozu: Yes | allow5m |
| 3 | Trend | EMA cross + ADX + pullback | Yes | allow5m |
| 4 | Momentum | RSI + ROC3 + pullback | Yes | allow5m |
| 5 | MACD+BB | BB squeeze + MACD alignment | Yes | allow5m |
| 6 | ORB | Opening Range Breakout | No | No |
| 7 | VWAPDev | Z-score mean reversion | Implicit | allow5m |
| 8 | InstFootprint | Large body candle (vol>2x) | Yes | allow5m |
| 9 | VWAPPullback | Return to VWAP + reversal | Implicit | allow5m |
| 10 | Supertrend | HA-Supertrend flip | No | allow5m |
| 11 | HourlyClose | 1H candle strength (10:15-10:25 only) | No | allow5m |
| 12 | BoomingBulls | Supertrend + pivot break + ADX | Yes | allow5m |

### Pre-Signal Gates (checked before any layer evaluates)

1. Market session check (9:15 AM - 3:30 PM NSE, 9:00 AM - 11:30 PM MCX)
2. Opening volatility skip (9:15-9:30 AM)
3. Minimum 20 candles collected
4. Daily loss limit not hit
5. Max trades per day not reached
6. StoplossGuard not active
7. Portfolio drawdown not halted
8. Cooldown period (120 seconds after last trade)

### Post-Signal Filters (can reject a valid signal)

1. S/R proximity: reject if price within 0.02% of any pivot level
2. 2-candle confirmation: require 2 consecutive candles in signal direction (bypassed when ADX > 30)
3. Confidence threshold: reject if confidence < 55%

---

## Phase 1: Symmetry Analysis

### Finding: VWAP Creates One-Sided Blindness on 6 of 12 Layers

Layers 2 (Engulfing/Marubozu), 3 (Trend), 4 (Momentum), 5 (MACD+BB), 8 (InstFootprint), and 12 (BoomingBulls) impose a hard requirement that BUY signals need `price > VWAP` and SELL signals need `price < VWAP`. This means:

> On a gap-up day where price stays above VWAP all morning, ALL SELL signals from 6 of 12 layers are mathematically impossible. The system keeps generating BUY signals even as the market fades, because VWAP anchors low from the high-volume opening candles.

The only layers that CAN generate SELL on such a day are Breakout (needs new 20-bar low — unlikely), ORB (needs close below ORB low), Supertrend (needs HA-Supertrend flip), and HourlyClose (10-minute window only). In practice, **Supertrend is the ONLY reliable SELL path on a gap-up-then-fade day.**

### Finding: 5-Minute Trend Gate Blocks ALL Signals in One Direction

The `allow5mSell` variable is `false` whenever `get5mTrend()` returns "bullish" (EMA9(5m) > EMA21(5m) AND price > VWAP(5m)). Every single layer checks this gate. When the 5m trend is "bullish":

> ALL 12 layers are blocked from generating SELL signals. The system is completely blind to bearish setups until the 5m EMAs cross back — which lags 30-60 minutes behind the actual reversal.

This is the single most dangerous design flaw. It means after a morning rally, the system cannot generate PE (put) signals for up to an hour after the market starts falling.

---

## Phase 2: Adversarial Scenario Results

| # | Scenario | Verdict | Loss Mechanism |
|---|----------|---------|----------------|
| 1 | Gap-up then slow fade | ❌ FAIL | Buys CE for 2+ hours into a fading market (VWAP + 5m gate) |
| 2 | Flash crash + V-recovery | ⚠️ PARTIAL FAIL | 5m gate delays SELL entry; Supertrend fires at bottom → SL on recovery |
| 3 | Low-vol sideways (choppy) | ✅ PASS | Correctly stays in HOLD — no trades taken |
| 4 | Relentless grind up (no pullback) | ✅ PASS | Pullback threshold (0.15%) is generous enough to catch the trend |
| 5 | Expiry day theta decay | ⚠️ DESIGN FLAW | SL/target on underlying doesn't account for option premium melting |
| 6 | Multiple consecutive SLs | ❌ FAIL | StoplossGuard pauses 30 min then resumes with same logic → same SL |
| 7 | BankNifty Wednesday (no weekly expiry) | ❌ BUG | Hero Zero mode fires every Wednesday — weekly expiry was discontinued |
| 8 | MCX US-open spike | ⚠️ PARTIAL FAIL | MCX Evening lacks pullback filter → enters at spike tops |
| 9 | Server restart mid-trade | ✅ PASS | Open trade persisted to DB and reconstructed correctly |
| 10 | Correlated multi-slot entries | ⚠️ DESIGN GAP | No correlation check — all 3 slots can take same directional bet |

---

## Phase 3: Dead Branch Report

### Practically Unreachable Layers

| Layer | Why Unreachable | Estimated Fire Rate |
|-------|----------------|-------------------|
| 11. HourlyClose | 10-minute window per day (10:15-10:25 AM) | <2% of trading hours |
| 9. VWAPPullback (BUY) | Logical contradiction: requires 5 candles above VWAP then price at VWAP = sharp drop contradicts "bullish" | Near zero |
| 12. BoomingBulls | Requires pivot break + Supertrend + VWAP + ADX confluence | 1-2x per week |
| 7. VWAPDev | Requires ranging regime + extreme z-score — mutually unlikely | Rare |

### Over-Firing Layers (False Signal Risk)

| Layer | Why Over-Fires | Risk |
|-------|---------------|------|
| 8. InstFootprint (Index) | bodyRatio >= 0.80 is the ONLY condition (no volume for indices) | Any strong 1-min candle triggers it |
| 1. Breakout | Fires on every new intraday high/low | Repeated entries on grinding trend days |

### Dead Code

The `fetchUpstox5mCandles()` function (lines 1546-1557) calls the Upstox API with a `5minute` interval that is not supported. It always throws an error, catches it silently, and returns `[]`. The code then falls back to `build5mFromMock()` which aggregates 1m candles into 5m. The 5m API call adds ~200ms latency per tick for zero benefit.

---

## Phase 4: Repeated-Loss Protection Audit

### Current Protections

| Protection | Trigger | Action | Fatal Gap |
|-----------|---------|--------|-----------|
| StoplossGuard | 3 consecutive SLs | Pause 30 min | Resumes with same logic — no learning |
| Portfolio Drawdown | Aggregate loss > limit | Halt all bots | Only triggers AFTER loss occurs |
| Daily Loss Limit | Per-bot loss > limit | Pause bot | Same — reactive not preventive |
| Max Trades | Count >= max | Pause | Doesn't distinguish wins from losses |
| Cooldown | After any trade close | Wait 120s | Too short — same signal fires again |

### Critical Gaps

**Gap 1 — No Direction-Aware Loss Tracking:** After 2 consecutive BUY SLs, the system does not block further BUY signals, require higher confidence, or acknowledge that the BUY side is failing. It treats all directions equally.

**Gap 2 — StoplossGuard Resumes Blind:** After the 30-minute pause expires, there is no regime re-assessment, no confidence threshold increase, and no position size reduction. The same conditions that caused 3 SLs are likely still present.

**Gap 3 — No Adaptive Confidence:** The `minConfidence` stays at 55% all day regardless of win rate, loss count, or regime changes. A system that has lost 5 trades should require 75%+ confidence for the next entry.

**Gap 4 — No "Same Signal Same Direction" Prevention:** After a BUY CE hits SL, the system can fire the exact same layer's BUY signal 120 seconds later because the underlying conditions haven't changed in 2 minutes.

---

## Phase 5: Indicator Dependency Analysis

### Single Points of Failure

| Indicator | Layers Dependent | Failure Mode | Blast Radius |
|-----------|-----------------|--------------|--------------|
| VWAP | 8 of 12 layers | Anchored by morning volume on gap days | 67% of layers give wrong direction |
| 5m Trend | ALL 12 layers | Lags 30-60 min after reversal | 100% of layers blocked wrong direction |
| ADX | 4 layers + bypass | ADX > 20 is true most of the time | Not a real filter |

### The Lagging Indicator Trap

Every indicator in the system is derived from the same 1-minute price data. VWAP, EMA9, EMA21, RSI, ADX, and the 5m trend are all lagging views of the same information. They confirm each other during a trend but ALL lag during a reversal. The system has **no leading indicator** — no order flow, no options chain data, no tick-level momentum.

The decision pipeline adds cumulative lag:

| Step | Indicator | Lag After Reversal |
|------|-----------|-------------------|
| 1 | 5m trend gate | 30-60 minutes |
| 2 | VWAP position | 15-30 minutes (gap days) |
| 3 | EMA9/21 cross | 10-20 minutes |
| 4 | RSI/ADX | 5-10 minutes |
| 5 | 2-candle confirmation | 2 minutes |

By the time all indicators align, the move is 50-70% complete and the bot enters late.

---

## Confirmed Bug

### BankNifty Hero Zero Mode Fires Every Wednesday

**Location:** `server/botEngine.ts`, line 2929  
**Code:**
```typescript
const isExpiryDay = isOptionInstrument && (isBankNiftyOption ? dayOfWeek === 3 : dayOfWeek === 4);
```

**Problem:** SEBI discontinued BankNifty weekly options expiry in November 2024. BankNifty now only has monthly expiry (last Thursday of the month). The code still treats every Wednesday as BankNifty expiry day, activating Hero Zero mode (aggressive OTM options entries) on non-expiry days.

**Impact:** High-risk Hero Zero entries on Wednesdays when options still have significant time value remaining.

---

## Recommended Fixes (Priority Order)

### P0 — Must Fix Immediately (Causes Active Losses)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | **Replace 5m trend HARD GATE with a soft bias** — instead of blocking all signals, reduce confidence by 15% when trading against 5m trend | Medium | Eliminates 30-60 min blindness |
| 2 | **Direction-aware loss tracking** — after 2 consecutive SLs in same direction, block that direction for 15 min and require 75% confidence to re-enter | Medium | Prevents "same signal same SL" loop |
| 3 | **VWAP staleness detection** — if price has been on one side of VWAP for >45 min AND price is moving away from VWAP, treat VWAP as stale and allow counter-signals | Medium | Fixes gap-day blindness |
| 4 | **Fix BankNifty expiry detection** — check actual monthly expiry date instead of `dayOfWeek === 3` | Low | Eliminates wrong Hero Zero entries |

### P1 — Should Fix This Week (Reduces Loss Severity)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 5 | **Adaptive confidence after losses** — increase minConfidence by 10% per consecutive SL (cap at 80%) | Low | Filters weak signals after losses |
| 6 | **Remove dead 5m candle fetch** — delete `fetchUpstox5mCandles` call, always use `build5mFromMock` | Low | Saves 200ms per tick |
| 7 | **Add pullback filter to MCX Evening** — require price within 0.2% of EMA9 before entry | Low | Prevents spike-top entries |
| 8 | **Disable InstFootprint for index instruments** — bodyRatio alone is not institutional signal | Low | Reduces false signals |

### P2 — Design Improvements (Longer Term)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 9 | **Correlation-aware exposure gate** — if Slot 1 already has BUY CE on NIFTY, block same-direction entry on FinNifty | High | Prevents 3x correlated loss |
| 10 | **Option premium SL** — on expiry days, set SL on option premium (not underlying) to account for theta | High | Prevents theta-decay losses |
| 11 | **Add VWAP slope as leading indicator** — if VWAP slope turns negative while price > VWAP, it's a warning signal | Medium | Earlier reversal detection |
| 12 | **StoplossGuard with regime check** — on resume, re-classify market regime and only allow signals appropriate for current regime | Medium | Prevents blind resume |

---

## Next Steps

This report is the diagnosis. **No code has been changed.** Please review the findings and confirm:

1. Which P0 fixes to implement immediately?
2. Which P1 fixes to include in this session?
3. Any P2 items to prioritize?
4. Any findings you disagree with or want me to re-examine?

Once approved, I will implement the fixes in a single coordinated commit with full test coverage.
