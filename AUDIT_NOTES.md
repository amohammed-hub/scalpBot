# Adversarial Logic Audit — Signal Engine Architecture Notes

## generateSignal() — Lines 650-1087 in server/botEngine.ts

### INPUTS:
- candles: Candle[] (1-minute candles, full day)
- slMultiplier (default 1.5), tpMultiplier (default 3.0)
- minConf (default 0.55)
- candles5m: Candle[] (5-minute candles)
- prevDayHigh, prevDayLow, prevDayClose (for pivot S/R)

### COMPUTED INDICATORS:
- price = last close
- atr = ATR(14)
- vwap = VWAP of all candles
- rsi = RSI(14)
- adx = ADX(14)
- e9 = EMA(9), e21 = EMA(21)
- volRatio = lastVol / avg10Vol (1.5 if all volume is 0 for index instruments)
- trend5m = get5mTrend(candles5m) → "bullish" | "bearish" | "neutral"
- nearSR = isNearSupportResistance(price, pivotLevels, 0.0002)
- istMin = current IST time in minutes from midnight

### PRE-FILTERS (return HOLD immediately):
1. !inSession → "Market closed"
2. candles.length < 20 → "Collecting data"
3. tod.skip (9:15-9:30 AM) → "Opening Volatility"

### 5-MINUTE TREND GATES:
- allow5mBuy = trend5m is "bullish" OR "neutral" (or <5 candles)
- allow5mSell = trend5m is "bearish" OR "neutral" (or <5 candles)
- strict5mBuy = trend5m is "bullish" (or <5 candles)
- strict5mSell = trend5m is "bearish" (or <5 candles)

### SIGNAL LAYERS (evaluated in order, first match wins):

| # | Layer | BUY Conditions | SELL Conditions | VWAP Required? |
|---|-------|---------------|-----------------|----------------|
| 1 | Breakout | close > 20-bar high by dynamicThreshold, vol>=1.0, RSI 45-80, strict5mBuy | close < 20-bar low by dynamicThreshold, vol>=1.0, RSI 20-55, strict5mSell | NO |
| 2 | Pattern (Engulfing) | Bullish engulfing + vol>=1.0 + price>VWAP + allow5mBuy | Bearish engulfing + vol>=1.0 + price<VWAP + allow5mSell | YES |
| 2 | Pattern (Hammer) | Hammer + RSI<45 + allow5mBuy | Shooting Star + RSI>55 + allow5mSell | NO |
| 2 | Pattern (Marubozu) | Bull marubozu + vol>=1.5 + price>VWAP + allow5mBuy | Bear marubozu + vol>=1.5 + price<VWAP + allow5mSell | YES |
| 3 | Trend | e9>e21 + price>VWAP + (RSI>55 OR RSI<40) + ADX>20 + nearPullback + allow5mBuy | e9<e21 + price<VWAP + (RSI<45 OR RSI>60) + ADX>20 + nearPullback + allow5mSell | YES |
| 4 | Momentum | RSI>55 + ROC3>0.1% + price>VWAP + nearPullback + allow5mBuy | RSI<45 + ROC3<-0.1% + price<VWAP + nearPullback + allow5mSell | YES |
| 5 | MACD+BB | BB squeeze + MACD hist>0 + MACD>signal + price>BB middle + price>VWAP + allow5mBuy | BB squeeze + MACD hist<0 + MACD<signal + price<BB middle + price<VWAP + allow5mSell | YES |
| 6 | ORB | ORB breakout UP + range>=0.2% + regime not ranging/high_vol + 9:30-2:00 PM | ORB breakout DOWN + range>=0.2% + regime not ranging/high_vol + 9:30-2:00 PM | NO |
| 7 | VWAP Deviation | z-score extreme + ranging/low_vol regime + 10:30-2:30 PM + allow5mBuy | z-score extreme + ranging/low_vol regime + 10:30-2:30 PM + allow5mSell | IMPLICIT |
| 8 | InstFootprint | Large institutional candle detected (vol>2x, body>70%) + allow5mBuy | Same + allow5mSell | NO |
| 9 | VWAPPullback | Price pulled back to VWAP + reversal candle + allow5mBuy | Same + allow5mSell | IMPLICIT |
| 10 | Supertrend | HA-Supertrend(10,3) just flipped BUY + RSI 45-80 + allow5mBuy | Flipped SELL + RSI 20-55 + allow5mSell | NO |
| 11 | HourlyClose | 1H candle body>60% of range + bullish + allow5mBuy + 10:15-10:25 AM only | Same + bearish + allow5mSell | NO |
| 12 | BoomingBulls | ADX>20 + Supertrend BUY + pivot level broken upward + price>VWAP + allow5mBuy | ADX>20 + Supertrend SELL + pivot broken downward + price<VWAP + allow5mSell | YES |

### POST-SIGNAL FILTERS:
1. S/R proximity: if nearSR (within 0.02% of pivot) → HOLD (rejects signal)
2. 2-Candle Confirmation: if layer is Trend/Momentum/MACD_BB AND ADX<=30 → need 2 consecutive candles in direction
3. Confidence check: if confidence < minConf (0.55) → HOLD

### CRITICAL OBSERVATION — VWAP DEPENDENCY:
Layers 2 (Engulfing/Marubozu), 3 (Trend), 4 (Momentum), 5 (MACD+BB), 12 (BoomingBulls) ALL require:
- BUY: price > VWAP
- SELL: price < VWAP

This means on a GAP UP day where price stays above VWAP all day:
- ALL SELL signals from layers 2,3,4,5,12 are IMPOSSIBLE
- Only layers 1 (Breakout), 6 (ORB), 7 (VWAPDev), 8 (InstFootprint), 9 (VWAPPullback), 10 (Supertrend), 11 (HourlyClose) can generate SELL

Similarly on a GAP DOWN day where price stays below VWAP all day:
- ALL BUY signals from layers 2,3,4,5,12 are IMPOSSIBLE

### SPECIAL SIGNAL GENERATORS (bypass generateSignal entirely):
- generatePowerHourSignal() — 3:00-3:25 PM IST (lines 1089-1200)
- generateMCXEveningSignal() — 7:30-9:30 PM IST for MCX (lines 1200-1310)
- generateMCXLateSessionSignal() — 9:30-11:20 PM IST for MCX (lines 1310-1440)
- generateHeroZeroSignal() — expiry day OTM options

### RISK MANAGER (server/riskManager.ts):
- StoplossGuard: pauses bot after 3 consecutive SLs (line 152-196)
- Portfolio Drawdown Halt: pauses all bots when aggregate dailyPnl exceeds -(capital * dailyLossLimitPct/100)
- Exposure Gate: limits total portfolio exposure
- Cooldown: 2-candle wait after any trade close
- Kill Switch: manual emergency stop
- Daily Reset: clears all flags at new trading day

### KEY ASYMMETRY RISKS IDENTIFIED:
1. VWAP as hard gate on 5/12 layers — trending days make one side unreachable
2. 5m trend gate — if 5m is "bullish", ALL sell signals from layers 1-12 are blocked (strict5mSell fails)
3. Pullback requirement (layers 3,4) — gradual trends with no pullbacks = no entries
4. HourlyClose (layer 11) only fires in 10-minute window (10:15-10:25) — extremely narrow
5. 2-candle confirmation blocks Trend/Momentum when ADX<=30 and candles are choppy

---

## PHASE 1: SYMMETRY ANALYSIS

### Layer-by-Layer BUY vs SELL Symmetry Check

| Layer | BUY Path | SELL Path | Symmetric? | Asymmetry Risk |
|-------|----------|-----------|------------|----------------|
| 1. Breakout | close > 20-bar high + vol>=1.0 + RSI 45-80 + strict5mBuy | close < 20-bar low + vol>=1.0 + RSI 20-55 + strict5mSell | ✅ Symmetric | None |
| 2. Pattern (Engulfing) | Bullish engulfing + vol>=1.0 + price>VWAP + allow5mBuy | Bearish engulfing + vol>=1.0 + price<VWAP + allow5mSell | ⚠️ VWAP-gated | On gap-up day, SELL engulfing impossible |
| 2. Pattern (Hammer) | Hammer + RSI<45 + allow5mBuy | Shooting Star + RSI>55 + allow5mSell | ✅ Symmetric | None |
| 2. Pattern (Marubozu) | Bull marubozu + vol>=1.5 + price>VWAP + allow5mBuy | Bear marubozu + vol>=1.5 + price<VWAP + allow5mSell | ⚠️ VWAP-gated | Same as engulfing |
| 3. Trend | e9>e21 + price>VWAP + (RSI>55 OR RSI<40) + ADX>20 + pullback + allow5mBuy | e9<e21 + price<VWAP + (RSI<45 OR RSI>60) + ADX>20 + pullback + allow5mSell | ⚠️ VWAP-gated | On gap-up day, SELL impossible |
| 4. Momentum | RSI>55 + ROC3>0.1% + price>VWAP + pullback + allow5mBuy | RSI<45 + ROC3<-0.1% + price<VWAP + pullback + allow5mSell | ⚠️ VWAP-gated | Same |
| 5. MACD+BB | Squeeze + MACD hist>0 + price>BB mid + price>VWAP + allow5mBuy | Squeeze + MACD hist<0 + price<BB mid + price<VWAP + allow5mSell | ⚠️ VWAP-gated | Same |
| 6. ORB | ORB breakout UP + regime ok | ORB breakout DOWN + regime ok | ✅ Symmetric | None |
| 7. VWAPDev | z-score < -1.5 (below VWAP) + ranging + allow5mBuy | z-score > 1.5 (above VWAP) + ranging + allow5mSell | ✅ Symmetric | Mean-reversion: BUY when below VWAP, SELL when above — correct |
| 8. InstFootprint | Bullish candle + vol>2x + body>70% + close>VWAP + allow5mBuy | Bearish candle + vol>2x + body>70% + close<VWAP + allow5mSell | ⚠️ VWAP-gated | Same issue |
| 9. VWAPPullback | 5 candles above VWAP + price returns to VWAP + bullish reversal | 5 candles below VWAP + price returns to VWAP + bearish reversal | ✅ Symmetric | But requires 5 consecutive candles on one side — slow to activate |
| 10. Supertrend | HA-Supertrend flipped BUY + RSI 45-80 + allow5mBuy | Flipped SELL + RSI 20-55 + allow5mSell | ✅ Symmetric | None |
| 11. HourlyClose | 1H candle bullish + body>60% + 10:15-10:25 AM + allow5mBuy | 1H candle bearish + body>60% + 10:15-10:25 AM + allow5mSell | ✅ Symmetric | Only fires in 10-min window |
| 12. BoomingBulls | ADX>20 + Supertrend BUY + pivot broken UP + price>VWAP + allow5mBuy | ADX>20 + Supertrend SELL + pivot broken DOWN + price<VWAP + allow5mSell | ⚠️ VWAP-gated | Same issue |

### CRITICAL FINDING #1: VWAP Hard Gate on 6/12 Layers

Layers 2 (Engulfing/Marubozu), 3 (Trend), 4 (Momentum), 5 (MACD+BB), 8 (InstFootprint), 12 (BoomingBulls) ALL require:
- BUY: price > VWAP
- SELL: price < VWAP

**THE PROBLEM (exactly what the PDF warned about):**
On a GAP UP day where price opens high and slowly fades BUT stays above VWAP:
- VWAP anchors low because of the high open
- Price is falling but still above VWAP
- ALL SELL signals from layers 2,3,4,5,8,12 are MATHEMATICALLY IMPOSSIBLE
- The system keeps generating BUY signals (because price > VWAP) even as the market is falling
- Result: repeated BUY CE entries into a falling market → consecutive stop losses

**Layers that CAN still generate SELL on a gap-up day:**
- Layer 1 (Breakout): needs close < 20-bar low — very unlikely on a gap-up day unless massive crash
- Layer 6 (ORB): needs close < ORB low — possible if gap-up then immediate dump
- Layer 7 (VWAPDev): z-score > 1.5 → SELL (mean reversion) — but only in ranging regime, and price above VWAP means z-score is POSITIVE, so this WOULD fire... BUT it requires regime="ranging" or "low_vol", and a gap-up trending day has ADX>30 = "strong_trend" regime → VWAPDev won't fire
- Layer 9 (VWAPPullback): needs 5 consecutive candles BELOW VWAP — impossible on gap-up day
- Layer 10 (Supertrend): CAN fire SELL if HA-Supertrend flips — this is the ONLY reliable SELL path on a gap-up day
- Layer 11 (HourlyClose): only fires 10:15-10:25 AM — one-shot

**CONCLUSION: On a gap-up-then-fade day, the ONLY reliable SELL path is Layer 10 (Supertrend flip).**
If Supertrend doesn't flip (which requires a significant move below the Supertrend band), the system is BLIND to the fade and keeps buying.

### CRITICAL FINDING #2: 5-Minute Trend Gate Creates Complete Blindness

The `allow5mSell` gate:
```
allow5mSell = candles5m.length < 5 || trend5m === "bearish" || trend5m === "neutral"
```

`get5mTrend()` returns "bullish" when: EMA9(5m) > EMA21(5m) AND price > VWAP(5m)

**THE PROBLEM:**
On a morning rally day, the 5m trend will be "bullish" for HOURS after the rally ends because:
- EMA9(5m) stays above EMA21(5m) for a long time (EMAs are lagging)
- Price stays above 5m VWAP (VWAP is anchored to the rally)

When trend5m = "bullish":
- `allow5mSell` = FALSE
- ALL SELL signals from ALL 12 layers are BLOCKED (every layer checks allow5mSell)
- The system is COMPLETELY BLIND to any bearish signal until the 5m EMAs cross back

**This is the EXACT scenario from the PDF anti-patterns:**
> "price > VWAP was true all afternoon (because VWAP anchored low from morning rally), so every SELL branch was unreachable, so the system kept buying CE into a falling market."

The 5m trend gate makes this WORSE because even layers that don't check VWAP directly (Breakout, Supertrend, HourlyClose) are still blocked by `allow5mSell`/`strict5mSell`.

### CRITICAL FINDING #3: No "Trend Reversal Detection"

The system has NO mechanism to detect:
- "The 1m price is falling but the 5m trend is still bullish" → should override 5m gate
- "I've hit 2 consecutive SLs on BUY side → maybe the trend reversed" → should flip bias
- "Price has fallen X% from the day's high" → should at least stop buying

The stoploss guard pauses after 3 SLs, but it pauses ALL trading (both directions), not just the losing direction. After 30 minutes, it resumes and may immediately fire the SAME wrong signal again.

### CRITICAL FINDING #4: Institutional Footprint (Layer 8) False Signals on Index

For index instruments (volume=0), the code uses bodyRatio >= 0.80 as the ONLY condition:
```
if ((isIndex ? bodyRatio >= 0.80 : (volRatio >= 2.0 && bodyRatio >= 0.70)))
```

This means ANY strong 1-minute candle on an index (body > 80% of range) triggers the institutional footprint signal. On a volatile day, this fires constantly — it's just detecting "big candle" not "institutional order flow." Without volume confirmation, this is noise.

### Power Hour / MCX Evening Symmetry

Both `generatePowerHourSignal` and `generateMCXEveningSignal` use score-based approaches:
- 5 conditions for bull, 5 for bear (Power Hour)
- 6 conditions for bull, 6 for bear (MCX Evening)
- Threshold: 3/5 (Power Hour), 4/6 (MCX Evening)

These ARE symmetric in structure. However:
- Power Hour BUY requires `dayTrendStrength > 0.001` — on a gap-up-then-fade day, dayTrendStrength may still be positive (because open was low, current is still above open) → BUY fires even though afternoon is fading
- Power Hour SELL requires `dayTrendStrength < -0.001` — this correctly identifies down days

**Asymmetry in Power Hour:** On a day that rallied in the morning and is fading in the afternoon:
- dayTrendStrength = (Q4avg - Q1avg) / Q1avg → could still be positive if Q4 > Q1 (even though Q4 < Q3)
- This means Power Hour may fire BUY at 3 PM when the market has been falling since 1 PM


---

## PHASE 2: SCENARIO STRESS TESTING (10 Adversarial Scenarios)

### Scenario 1: Gap-Up Morning Rally → Slow Afternoon Fade
**Market:** NIFTY opens +1% gap up at 24400 (prev close 24160). Rallies to 24500 by 10:30 AM. Then slowly fades to 24350 by 3 PM. VWAP anchors around 24420 (weighted by morning volume).

**Trace through code:**
- 10:30 AM: price=24500, VWAP=24420, price>VWAP ✅ → BUY signals fire (Trend, Momentum, etc.)
- 11:30 AM: price=24450, VWAP=24430, price>VWAP ✅ → BUY signals STILL fire
- 12:30 PM: price=24400, VWAP=24425, price<VWAP (barely) → SELL paths NOW open
- BUT: 5m trend = "bullish" (EMA9(5m) still > EMA21(5m) from morning rally) → allow5mSell = FALSE → ALL SELL BLOCKED
- 1:30 PM: price=24380, VWAP=24420, price<VWAP ✅, 5m EMAs may have crossed → SELL possible
- **PROBLEM WINDOW: 10:30 AM - 12:30 PM** — system fires BUY signals into a fading market for 2 HOURS

**Outcome:** 2-3 BUY CE entries that hit stop loss. System is blind to the fade because:
1. VWAP stays below price for 2 hours (anchored by morning volume)
2. 5m trend stays "bullish" for even longer (EMAs lag)
3. No reversal detection mechanism

**VERDICT: ❌ SYSTEM FAILS — buys into a fade for 2+ hours**

---

### Scenario 2: Sharp V-Shaped Reversal (Flash Crash + Recovery)
**Market:** NIFTY at 24200, drops 150 points in 5 minutes to 24050, then recovers to 24180 in next 10 minutes.

**Trace through code:**
- During crash: price drops rapidly, EMA9 < EMA21, price < VWAP, RSI < 30
- Layer 1 (Breakout SELL): close < 20-bar low ✅, vol>=1.0 ✅, RSI 20-55 ✅, strict5mSell?
  - 5m trend: was "bullish" before crash → takes 5+ candles to flip → strict5mSell = FALSE
  - **BLOCKED by 5m gate** — Breakout SELL cannot fire during the crash
- Layer 10 (Supertrend SELL): HA-Supertrend may flip after 3-5 candles of the drop → fires LATE
- By the time Supertrend flips SELL, price is already at 24050 (bottom) and about to reverse
- Bot enters SELL (BUY PE) at 24060 → price recovers to 24180 → SL hit

**Outcome:** Late SELL entry at the bottom of a V-reversal → immediate stop loss

**VERDICT: ⚠️ SYSTEM PARTIALLY FAILS — 5m gate delays entry, Supertrend fires too late at reversal bottom**

---

### Scenario 3: Low-Volatility Sideways Day (Choppy Range)
**Market:** NIFTY oscillates between 24180-24220 all day. ATR(14) = 8 points. ADX = 12.

**Trace through code:**
- ADX = 12 < 20 → Layer 3 (Trend) BLOCKED, Layer 12 (BoomingBulls) BLOCKED
- BB width < 0.8% → regime = "low_vol" → Layer 6 (ORB) BLOCKED (requires regime not ranging/high_vol... wait, ORB checks "not ranging and not high_vol" — low_vol is allowed? Let me re-check)
- Actually ORB checks: `regime !== "ranging" && regime !== "high_vol"` → low_vol IS allowed
- But ORB range = 24220-24180 = 40 pts = 0.16% < 0.2% minimum → ORB BLOCKED
- Layer 7 (VWAPDev): requires ranging/low_vol regime ✅, z-score extreme... on a tight range, z-score will oscillate between -1 and +1, rarely hitting ±1.5 → likely HOLD
- Layer 4 (Momentum): RSI oscillates 45-55 (no-man's land), ROC3 near 0 → BLOCKED
- Layer 5 (MACD+BB): BB squeeze ✅, but MACD histogram oscillates around 0 → signals cancel each other
- Layer 10 (Supertrend): Supertrend band is wide (3×ATR = 24 pts), price stays within band → no flip → HOLD

**Outcome:** Bot stays in HOLD all day. Zero trades. This is CORRECT behavior — no edge in a choppy market.

**VERDICT: ✅ SYSTEM CORRECT — correctly avoids choppy markets**

---

### Scenario 4: Trending Day with No Pullback (Relentless Grind Up)
**Market:** NIFTY opens 24200, grinds up steadily to 24400 by 3 PM. Never pulls back more than 10 points. EMA9 always > EMA21, price always > VWAP.

**Trace through code:**
- Layer 3 (Trend BUY): e9>e21 ✅, price>VWAP ✅, RSI>55 ✅, ADX>20 ✅, nearPullback?
  - nearPullback = price within 0.15% of EMA9 or VWAP
  - 0.15% of 24300 = 36.45 points
  - If price is always 10-20 pts above EMA9 → nearPullback = TRUE (within 36 pts)
  - **Actually this WOULD fire** because the pullback threshold is generous (0.15%)
- Layer 4 (Momentum BUY): RSI>55 ✅, ROC3>0.1% ✅, price>VWAP ✅, nearPullback ✅ → FIRES
- Layer 1 (Breakout BUY): close > 20-bar high → fires on each new high

**Outcome:** Bot takes BUY CE entries on the grind up. If SL is tight (1.5×ATR), small pullbacks may hit SL. But the direction is correct.

**VERDICT: ✅ SYSTEM CORRECT — catches the trend, though tight SL may cause early exits**

---

### Scenario 5: Expiry Day Theta Decay (Options Premium Melting)
**Market:** Thursday (NIFTY weekly expiry). NIFTY at 24200, moves sideways. ATM CE premium melts from ₹100 to ₹30 by 2 PM.

**Trace through code:**
- Bot is in OTM Options (Auto) mode → trades CE/PE based on signal direction
- Signal engine analyzes the UNDERLYING (NIFTY index) not the option premium
- NIFTY is sideways → ADX < 20 → most layers blocked → HOLD
- If a signal does fire (e.g., Momentum BUY) → bot buys CE at ₹80
- SL is set on UNDERLYING price (e.g., 24200 - 1.5×ATR = 24180)
- But CE premium decays from ₹80 to ₹50 even without underlying moving → unrealized loss
- SL on underlying never triggers because NIFTY stays at 24200
- Time exit (20 min) fires → exits CE at ₹60 → loss of ₹20 per lot

**PROBLEM:** The SL/target is calculated on the UNDERLYING but the P&L is on the OPTION PREMIUM. Theta decay causes option loss even when underlying doesn't move.

**VERDICT: ⚠️ DESIGN FLAW — SL/target based on underlying doesn't account for theta decay on expiry day. The bot should either:**
1. Not trade options on expiry day (or use Hero Zero mode which IS designed for this)
2. Set SL/target on the option premium itself, not the underlying

---

### Scenario 6: Multiple Consecutive Stop Losses (Losing Streak)
**Market:** Choppy morning, bot takes 3 trades, all hit SL.

**Trace through code:**
- Trade 1: BUY CE → SL hit → dailyPnl = -₹500
- Trade 2 (after 120s cooldown): BUY CE → SL hit → dailyPnl = -₹1000
- Trade 3 (after 120s cooldown): BUY CE → SL hit → dailyPnl = -₹1500
- StoplossGuard triggers: 3 consecutive SLs → bot paused for 30 minutes
- After 30 minutes: bot resumes → SAME market conditions → SAME signal fires → Trade 4: BUY CE → SL hit

**PROBLEM:** StoplossGuard pauses for 30 minutes but doesn't:
1. Flip the bias (if 3 SLs on BUY, maybe try SELL)
2. Increase the confidence threshold (require stronger signal after losses)
3. Reduce position size (risk management)
4. Check if the market regime changed during the pause

**VERDICT: ❌ SYSTEM FAILS — resumes with same logic after pause, likely hits SL again**

---

### Scenario 7: BankNifty Weekly Expiry Removed (No Wednesday Expiry)
**Market:** SEBI removed BankNifty weekly expiry in 2024. Code checks `dayOfWeek === 3` for BankNifty expiry.

**Trace through code (line 2929):**
```
const isBankNiftyOption = state.instrumentToken.includes("BNF") || state.instrumentToken.includes("BANKNIFTY");
const isExpiryDay = isOptionInstrument && (isBankNiftyOption ? dayOfWeek === 3 : dayOfWeek === 4);
```

**PROBLEM:** BankNifty no longer has Wednesday weekly expiry. It now expires on the last Thursday of the month (monthly only). The code still checks `dayOfWeek === 3` which means:
- Every Wednesday, if trading BankNifty options, the bot enters Hero Zero mode (11:00-1:30 PM)
- Hero Zero mode is designed for expiry-day OTM options with aggressive entries
- On a non-expiry Wednesday, this generates high-risk entries on options that still have days of time value

**VERDICT: ❌ BUG — Hero Zero fires every Wednesday for BankNifty even though weekly expiry was discontinued**

---

### Scenario 8: MCX Crude Oil — US Market Open Volatility Spike
**Market:** Crude Oil at ₹6500, US market opens at 7:00 PM IST, crude spikes ₹100 in 2 minutes then reverses.

**Trace through code:**
- MCX Evening window: 7:30-9:30 PM IST → generateMCXEveningSignal fires
- During spike: dayTrendStrength positive, price > VWAP, e9 > e21, MACD hist > 0
- Bull score = 5/6 → BUY fires at ₹6600 (top of spike)
- Price reverses → SL hit at ₹6600 - ATR*1.2

**PROBLEM:** The MCX Evening signal uses day-level metrics (dayTrendStrength, dayVwap) which are dominated by the spike. It doesn't have a "don't chase" filter like the regular generateSignal's pullback requirement.

**VERDICT: ⚠️ PARTIAL FAIL — MCX Evening lacks pullback/chase filter, enters at spike tops**

---

### Scenario 9: Server Restart Mid-Trade (Railway Redeploy)
**Market:** Bot has open trade (BUY CE at ₹100, SL at ₹85). Railway redeploys, server restarts.

**Trace through code:**
- Server restarts → `restartRunningBots()` fires
- Queries DB for sessions with status="running"
- Recreates BotState from DB row
- BUT: the open trade details (entryPrice, SL, target) are stored in memory only (state.openTrade)
- DB stores: `openTradeDbId`, `openTradeEntryPrice`, `openTradeDirection`, `openTradeSl`, `openTradeTarget`
- restartRunningBots reads these columns and reconstructs state.openTrade

**VERDICT: ✅ SYSTEM CORRECT — open trade is persisted to DB and reconstructed on restart**

---

### Scenario 10: Simultaneous Signal on Multiple Slots (Portfolio Correlation)
**Market:** NIFTY drops sharply. Primary (BankNifty), Slot 1 (Nifty), Slot 2 (FinNifty) all generate SELL signals simultaneously.

**Trace through code:**
- Each slot runs independently with its own tick() function
- All 3 fire SELL → all 3 buy PE simultaneously
- Portfolio exposure: 3 × capital per slot
- If market reverses → all 3 hit SL → combined loss = 3 × single SL

**Risk check:** `checkPortfolioDrawdown` calculates aggregate dailyPnl across all bots. If combined loss exceeds limit, it halts all bots. But this only triggers AFTER the loss occurs, not BEFORE the correlated entries.

**PROBLEM:** No pre-trade correlation check. The system doesn't ask "am I already exposed to NIFTY downside via Slot 1?" before entering the same direction on Slot 2 (FinNifty, which is 90% correlated with NIFTY).

**VERDICT: ⚠️ DESIGN GAP — no correlation-aware position sizing. All 3 slots can take the same directional bet simultaneously, tripling the risk.**


---

## PHASE 3: REACHABILITY ANALYSIS — Dead Branch Report

### Layers That Are Practically Unreachable

| Layer | Condition Making It Unreachable | Frequency |
|-------|-------------------------------|-----------|
| 11. HourlyClose | Only fires 10:15-10:25 AM (10-minute window per day) | ~2% of trading day |
| 7. VWAPDev | Requires regime="ranging" OR "low_vol" AND z-score > ±1.5 | Rare: trending days (ADX>20) block it, and on ranging days z-score rarely hits 1.5 |
| 9. VWAPPullback | Requires 5 consecutive candles ALL on one side of VWAP + return to VWAP + reversal candle | Very rare: 5 consecutive candles above VWAP is common, but then price must touch VWAP AND form a reversal candle in the same tick |
| 5. MACD+BB | Requires BB squeeze AND MACD alignment AND price>VWAP | Squeeze is rare (bottom 25% of 30-candle width range), and when it fires, price often hasn't broken out yet |
| 12. BoomingBulls | Requires ADX>20 + Supertrend BUY + pivot level broken + price>VWAP | Pivot break + Supertrend + VWAP alignment is a very specific confluence — fires maybe 1-2x per week |

### Layers That Fire Too Frequently (False Signal Risk)

| Layer | Why It Over-Fires | Risk |
|-------|-------------------|------|
| 8. InstFootprint (Index) | bodyRatio >= 0.80 is the ONLY condition for index instruments (no volume check) | Any strong 1-min candle triggers it — on volatile days, fires every few minutes |
| 3. Trend (with ADX>30 bypass) | After my recent fix, ADX>30 bypasses 2-candle confirmation → fires on first aligned candle | May enter too early before trend is confirmed |
| 1. Breakout | close > 20-bar high → fires on every new intraday high | On a grinding trend day, fires repeatedly as price makes new highs every 5-10 minutes |

### Dead Code / Unreachable Branches

1. **`fetchUpstox5mCandles` always fails silently** (line 1546-1557): The Upstox API doesn't support '5minute' interval for intraday. The function always catches the error and returns []. The code then falls back to `build5mFromMock()`. The 5m fetch is dead code that adds ~200ms latency per tick for no benefit.

2. **HourlyClose layer (10:15-10:25 only)**: This fires in a 10-minute window. Given the scan interval of 15-60 seconds, it gets ~10-40 chances to fire. But the condition requires a 1-hour candle with body > 60% of range. At 10:15 AM, the "1-hour candle" is only the 9:15-10:15 candle. If that candle is indecisive (doji), this layer NEVER fires that day.

3. **BoomingBulls pivot break detection**: Requires price to break above R1/R2/R3 or below S1/S2/S3. On a normal day, price stays between S1 and R1. Breaking R2/R3 or S2/S3 is a 1-2x per month event. This layer is practically dead on most days.

4. **VWAPPullback BUY path**: Requires `isBullishTrend = candles.slice(-5, -1).every(c => c.close > vwap)` — ALL of the last 5 candles (excluding current) must be above VWAP. Then price must return to within 0.15% of VWAP. But if all 5 candles were above VWAP, the current candle being near VWAP means a SHARP drop just happened — which contradicts the "bullish trend" premise. This is a logical contradiction that makes the BUY path nearly impossible.

---

## PHASE 4: REPEATED-LOSS PROTECTION AUDIT

### Current Protections (from riskManager.ts):

| Protection | Trigger | Action | Reset | Gap |
|-----------|---------|--------|-------|-----|
| StoplossGuard | 3 consecutive SLs in last 20 trades | Pause 30 min | Auto-expires after 30 min | Resumes with SAME logic — no learning |
| Portfolio Drawdown | Aggregate dailyPnl < -(capital × dailyLossLimitPct%) | Halt all bots | Manual reset OR new day | Doesn't prevent correlated entries |
| Daily Loss Limit (per bot) | dailyPnl < -(capital × dailyLossLimitPct%) | Pause single bot | New day | Only triggers AFTER loss occurs |
| Max Trades Per Day | tradesCount >= maxTradesPerDay | Pause | New day | Doesn't distinguish wins from losses |
| Cooldown | After any trade close | Wait 120 seconds | Auto | Too short to prevent same-direction re-entry |

### CRITICAL GAPS IN LOSS PROTECTION:

**GAP 1: No Direction-Aware Loss Tracking**
After 2 consecutive BUY SLs, the system doesn't:
- Block further BUY signals specifically
- Require higher confidence for BUY (e.g., 70% instead of 55%)
- Flip to SELL-only mode
- Even acknowledge that the BUY side is failing

**GAP 2: StoplossGuard Resumes Blind**
After 30-minute pause:
- No regime re-assessment
- No confidence threshold increase
- No position size reduction
- Same signal fires → same result

**GAP 3: No Intra-Day Adaptive Threshold**
The minConfidence stays at 55% all day regardless of:
- Number of losses
- Win rate so far today
- Market regime changes
- Consecutive SL count

**GAP 4: Cooldown Too Short**
120 seconds (2 candles) is not enough to:
- Let the market establish a new direction
- Allow lagging indicators (EMA, MACD) to update
- Prevent the same signal from firing again

**GAP 5: No "Same Signal Same Direction" Prevention**
After a BUY CE hits SL, the system can immediately (after 120s) fire the SAME layer's BUY signal again because:
- The conditions haven't changed in 2 minutes
- No memory of "I already tried this signal and it failed"

---

## PHASE 5: INDICATOR DEPENDENCY ANALYSIS

### Single Points of Failure

| Indicator | Used By Layers | Failure Mode | Impact |
|-----------|---------------|--------------|--------|
| VWAP | 2,3,4,5,7,8,9,12 (8/12 layers) | Anchored by morning volume → stale on afternoon fades | 67% of layers give wrong direction |
| 5m Trend (EMA9/21) | ALL 12 layers (via allow5mBuy/Sell gate) | Lags by 30-60 minutes after reversal | 100% of layers blocked in wrong direction |
| ADX | 3,5,6,12 + 2-candle bypass | ADX > 20 is common (fires most of the time) | Not a real filter — too permissive |
| RSI | 1,2,3,4,10 | RSI in 40-60 range → no-man's land blocks entries | Misses early trend entries |
| nearPullback | 3,4 | 0.15% threshold is generous for large-cap indices | May not filter enough |

### Indicator Correlation Problem

VWAP, EMA9, EMA21, and 5m trend are ALL derived from the SAME price data. They are NOT independent confirmations — they are correlated views of the same information. When price is trending up:
- VWAP is below price ✅
- EMA9 > EMA21 ✅
- 5m trend = "bullish" ✅
- Price > VWAP ✅

ALL confirm BUY simultaneously. When price reverses:
- VWAP stays below (lagging) → still says BUY
- EMA9 > EMA21 (lagging) → still says BUY
- 5m trend (lagging) → still says BUY
- Price < VWAP (first to flip) → says SELL

**The system has NO leading indicator.** All indicators are lagging. The first to detect a reversal is the raw price crossing VWAP, but even that is gated by the 5m trend which lags longer.

### Missing Indicators That Would Help

1. **Order flow / Volume profile** — not available for index instruments (volume=0)
2. **Options chain data (PCR, Max Pain, OI change)** — available via Upstox API but not used
3. **Tick-by-tick momentum** — faster than 1-min candles, would detect reversals earlier
4. **Intraday VWAP slope** — if VWAP slope turns negative while price is above VWAP, it's a warning
5. **Higher timeframe structure** — 15m/30m candle patterns for context (only 5m is used)

### The "Lagging Indicator Trap"

The system's decision tree is:
```
1. Check 5m trend (lagging 30-60 min)
2. Check VWAP position (lagging 15-30 min on gap days)
3. Check EMA cross (lagging 10-20 min)
4. Check RSI/ADX (lagging 5-10 min)
5. Check 2-candle confirmation (lagging 2 min)
```

By the time ALL these confirm a direction, the move is often 50-70% complete. The bot enters LATE and gets stopped out on the pullback/reversal.

**The fundamental problem:** The system is designed to confirm trends, not detect reversals. It has NO mechanism to say "the trend is about to end" — only "the trend has been going for a while."

