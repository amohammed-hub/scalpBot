# Fix #1: 5m Trend Gate → Soft Bias — Before/After Trace

## BEFORE (Baseline — Hard Gate)

| Scenario | Key Result | Status |
|----------|-----------|--------|
| 1. Gap-Up Fade | First SELL at candle 55 (25 candles after fade starts at 30) | ⚠️ SLOW but does fire |
| 1. Gap-Up Fade | 0 BUY signals after candle 50 | ✅ Stops buying eventually |
| 2. Flash Crash | 0 SELL at crash bottom (candles 23-26) | ✅ Doesn't sell at bottom |
| 2. Flash Crash | 2 BUY during recovery (first at candle 33) | ⚠️ Late recovery detection |
| 3. Choppy | 42 trades / 61 candles = 69% trade rate | ❌ Too aggressive |
| 4. Strong Uptrend | 59 BUY / 61 candles, avg conf 0.95 | ✅ Perfect |
| 4. Strong Uptrend | 0 SELL signals | ✅ No false counter-trend |
| 5. Flat Market | 43/61 trades | ❌ Too aggressive (pre-existing) |
| 6. Choppy Market | 40/61 trades | ❌ Too aggressive (pre-existing) |
| 7. BankNifty Uptrend | 59 BUY signals | ✅ Correct |
| 8. MCX Spike | 0 BUY at top | ✅ Correct |
| 9. Determinism | PASS | ✅ |
| 10. Downtrend | 59 SELL, first at candle 19 | ✅ Correct |

## KEY OBSERVATION FROM BASELINE

Scenario 1 shows the 5m gate IS allowing SELL eventually (at candle 55), which means the
5m trend DOES flip to "bearish" or "neutral" after enough candles. The issue is the DELAY:
- Fade starts at candle 30
- First SELL fires at candle 55
- That's a 25-candle (25 minute) delay

With Fix #1 (soft bias instead of hard gate), the SELL should fire MUCH earlier because:
- The signal won't be BLOCKED, just penalized by 15%
- A strong SELL signal (e.g., Trend layer at 0.75 confidence) would become 0.60 after penalty
- 0.60 > 0.55 (minConf) → STILL FIRES despite being against 5m trend

## FIX #1 IMPLEMENTATION

Location: server/botEngine.ts, lines 728-733

BEFORE:
```typescript
const allow5mBuy  = candles5m.length < 5 || trend5m === "bullish" || trend5m === "neutral";
const allow5mSell = candles5m.length < 5 || trend5m === "bearish" || trend5m === "neutral";
const strict5mBuy  = candles5m.length < 5 || trend5m === "bullish";
const strict5mSell = candles5m.length < 5 || trend5m === "bearish";
```

AFTER:
```typescript
// Soft bias: instead of blocking signals entirely, apply a confidence penalty
// when trading against the 5m trend. This allows strong counter-trend signals
// to still fire (with reduced confidence) while preserving the trend-following bias.
const against5mPenalty = 0.15; // 15% confidence reduction for counter-trend trades
const allow5mBuy  = true; // Never hard-block — use penalty instead
const allow5mSell = true; // Never hard-block — use penalty instead
const strict5mBuy  = true; // Never hard-block — use penalty instead
const strict5mSell = true; // Never hard-block — use penalty instead
// Apply penalty to confidence AFTER signal generation (see below)
const buyPenalty  = (candles5m.length >= 5 && trend5m === "bearish") ? against5mPenalty : 0;
const sellPenalty = (candles5m.length >= 5 && trend5m === "bullish") ? against5mPenalty : 0;
```

Then at the end of generateSignal, before the confidence threshold check:
```typescript
// Apply 5m trend soft bias penalty
if (direction === "BUY") confidence -= buyPenalty;
if (direction === "SELL") confidence -= sellPenalty;
```

## EXPECTED AFTER FIX

| Scenario | Expected Change |
|----------|----------------|
| 1. Gap-Up Fade | First SELL should fire at candle 35-40 (5-10 candles after fade, not 25) |
| 2. Flash Crash | May now generate SELL during crash (risk!) — need to verify |
| 3. Choppy | May increase trade count slightly (more signals pass through) |
| 4. Strong Uptrend | BUY confidence drops by 0 (5m trend is bullish = no penalty) |
| 10. Downtrend | SELL confidence stays same (5m trend is bearish = no penalty) |
