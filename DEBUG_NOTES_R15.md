# Round 15 Debug Analysis

## User's Issues:
1. **Slot 2 not starting** — Error: "Instrument already running in Slot 1"
   - This is INTENTIONAL safety logic (routers.ts:1648-1650)
   - User tried to start Crude Oil in Slot 2 but it was already running in Slot 1
   - NOT a bug — user needs to pick a different instrument for Slot 2

2. **Primary (BankNifty) + Slot 1 (Nifty 50) running 2+ hours with zero trades**
   - Bots started at 11:47 AM, screenshot at 2:06 PM — no trades
   - Activity log only shows "Bot started" messages

## Root Cause Analysis for Issue #2:

The tick function (botEngine.ts:1791) runs every scanIntervalSec (225s for BankNifty, 30s for Nifty).

On each tick:
1. Fetches candles from Upstox API (works without auth for NSE_INDEX)
2. If candles empty → emits "Waiting for market data" activity
3. If candles present → generates signal via generateSignal()
4. If signal is HOLD → returns silently (NO activity emitted!)
5. If signal is BUY/SELL → emits activity, then checks entry gates

The problem: **When signal is HOLD, NOTHING is logged to activity.** So the bot appears dead/stuck even though it's actively scanning every 30s.

## Why no signals are generated:
The generateSignal function has 12 layers of signal generation. Each has strict conditions:
- Breakout: needs vol >= 1.3x AND price above 20-candle high AND RSI 45-80 AND 5m bullish
- Pattern: needs engulfing/hammer/marubozu with vol >= 1.2x
- Trend: needs ADX > 20 AND EMA crossover AND VWAP alignment
- Momentum: needs RSI > 58 or < 42 AND ROC > 0.05%
- etc.

In a ranging/low-volatility market, ALL layers can produce HOLD for hours. This is normal.

## Fix Plan:
1. **Add periodic "heartbeat" activity** — emit a brief status every 5 ticks (or every 5 minutes) so user knows bot is alive
2. **Slot 2 error** — just needs better UX messaging (not a code bug)
3. **Consider loosening signal criteria** — but this is a strategy decision, not a bug

## Additional finding:
The `isOpeningTrade` mutex at line 2200 could get stuck if a trade open fails in a specific way,
but there's already a release in the catch block (line 2617). Not likely the issue here.

The DB open-trade guard (line 2582-2599) checks if there's already an "open" trade in the DB.
If the user had stale open trades from before Clear All History, they'd be deleted. So this shouldn't block.
