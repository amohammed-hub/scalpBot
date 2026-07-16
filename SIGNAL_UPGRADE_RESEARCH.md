# Signal Engine Upgrade Research — Professional Scalping Strategies

## Key Sources:
1. https://www.sahi.com/blogs/best-scalping-indicators-how-to-combine — VWAP + EMA(9,21) + RSI(7)
2. https://futures.stonex.com/blog/scalping-strategies-for-wti-crude-oil — Fibonacci retracements + breakouts + range trading
3. https://www.tradezella.com/blog/scalping-strategies — 4 strategies with exact entry/exit rules
4. https://www.investopedia.com/articles/active-trading/012815/top-technical-indicators-scalping-trading-strategy.asp — Top indicators for scalping
5. https://www.scribd.com/document/882961936/Ema-9-21-Rsi-and-Vwap — EMA 9/21 + VWAP + RSI strategy PDF
6. Reddit r/FuturesTrading + r/Daytrading — VWAP usage in scalping
7. https://www.evest.com/en/trading-blog/one-minute-scalping — 1-min scalping rules

## Professional Scalping Strategy Framework (Synthesis):

### Entry Rules (ALL must be true for BUY signal):
1. **Trend Alignment (EMA 9 > EMA 21)** — Don't fight the trend
2. **VWAP Confirmation** — Price above VWAP for longs, below for shorts
3. **RSI(7) Oversold Bounce** — RSI crosses above 30 from below (for BUY)
4. **Volume Spike** — Current volume > 1.5x average volume (confirms institutional interest)
5. **Price Action** — Bullish engulfing or hammer candle at support level
6. **ADX > 20** — Confirms trend strength (avoid ranging markets)

### Entry Rules (ALL must be true for SELL signal):
1. **Trend Alignment (EMA 9 < EMA 21)** — Downtrend confirmed
2. **VWAP Confirmation** — Price below VWAP
3. **RSI(7) Overbought Rejection** — RSI crosses below 70 from above
4. **Volume Spike** — Current volume > 1.5x average
5. **Price Action** — Bearish engulfing or shooting star at resistance
6. **ADX > 20** — Trend has strength

### Key Filters to AVOID False Signals:
1. **No entry in first 15 minutes** (opening volatility — already implemented)
2. **No entry when ADX < 15** (choppy/ranging market)
3. **No entry against VWAP** (price below VWAP = no longs)
4. **No entry when RSI is between 40-60** (no-man's land, no momentum)
5. **Volume must confirm** — Low volume breakouts are fake
6. **Wait for pullback** — Don't chase, wait for price to retrace to EMA 9 or VWAP

### Exit Strategy:
1. **Initial SL**: Below the entry candle low (for BUY) or above entry candle high (for SELL)
2. **Move to breakeven**: After 1:1 R:R achieved
3. **Trail with EMA 9**: Exit when price closes below EMA 9 (for longs)
4. **Time exit**: If no movement after 15-20 candles (15-20 min on 1m chart)
5. **Partial booking**: 50% at 1.5R, trail rest with EMA 9

### Specific Crude Oil Scalping Rules (from StoneX + YouTube):
1. **Best times**: 5:00 PM - 8:30 PM IST (US session overlap, highest volume)
2. **Fibonacci retracements**: Enter at 38.2% or 50% pullback of the last swing
3. **Psychological levels**: ₹7700, ₹7750, ₹7800 — price reacts at these
4. **EIA report days (Wednesday)**: Wider SL, bigger moves expected
5. **Minimum 30-point move target** for crude oil futures (translate to options premium)

### What's WRONG with Current Bot Signal Engine:
- Uses EMA + VWAP + ADX but doesn't require ALL conditions simultaneously
- Confidence threshold is too low (60%) — should be higher for real money
- No volume confirmation requirement
- No RSI divergence check
- No support/resistance level awareness
- No "wait for pullback" logic — enters immediately on signal
- Doesn't check if price is at a key level (VWAP, EMA, Fibonacci)

### Proposed Improvements:
1. Add RSI(7) to signal generation — require RSI < 30 for BUY, > 70 for SELL
2. Add volume filter — require volume > 1.5x SMA(20) volume
3. Add "pullback to EMA" requirement — price must touch/cross EMA 9 before entry
4. Increase minimum confidence to 75% for live trading
5. Add support/resistance detection (recent swing highs/lows)
6. Add Fibonacci retracement levels for crude oil
7. REMOVE the expiry-day ban — same-day expiry has highest gamma = biggest moves
8. Add "no entry in ranging market" filter (ADX < 15 = skip)
