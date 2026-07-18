# Strategy Research — Top 3 Proven Intraday Strategies for NIFTY/BANKNIFTY Options

## Research Findings

### Strategy 1: Opening Range Breakout (ORB) — 15-min variant
- **Published evidence**: 5-year S&P500 backtest (74.56% win rate, PF 2.512), 6-month ES backtest (72.17% win rate, PF 1.623, 108% return)
- **Academic**: Holmberg et al. (2013, Finance Research Letters, 50 citations) — statistically significant ORB edge
- **Indian market**: SSRN paper (Wang & Gangwar, 2025) — "ORB is operationally appealing" on NSE
- **Edge source**: Opening auction creates information asymmetry; first 15 min captures overnight gap + institutional order flow
- **Failure mode**: Range-bound/choppy days where breakout fails and reverses (whipsaw)

### Strategy 2: VWAP Mean Reversion (Intraday)
- **Published evidence**: Reddit backtest 2.11 Sharpe over 25 years; QuantInsti research shows consistent edge
- **Academic**: Multiple papers on VWAP as institutional benchmark — price reverts to VWAP because institutions execute TO VWAP
- **Edge source**: Institutional algorithms target VWAP; when price deviates significantly, it gets pulled back by institutional flow
- **Failure mode**: Strong trending days where price never reverts (ADX > 30 days)

### Strategy 3: Intraday Short Straddle / Iron Condor (Theta Decay)
- **Published evidence**: SSRN (Pillai, 2026) — ATM short straddle on Nifty 50, 119 monthly cycles (2015-2025)
  - Put-write at k=0.94: 91.6% win rate BUT -0.9% annual return after costs
  - Straddle: loses ~44-45% per year after costs (STT kills it)
  - KEY FINDING: VRP exists but NOT capturable by retail due to Indian STT/costs
- **Reddit backtest**: Iron Condor on Bank Nifty — 68% win rate, but avg loss 2x avg win
- **Edge source**: Implied volatility > realized volatility (VRP); theta decay on weekly options
- **Failure mode**: Fat tail events (2-3 big moves wipe months of gains); Indian STT makes it unviable for retail

## CONCLUSION: Strategy 3 (Short Straddle) is PROVEN TO FAIL for Indian retail
The SSRN paper proves that even with 91.6% win rate, the strategy loses money after Indian costs.
Replace with: **EMA Pullback in Trend** — a momentum continuation strategy.

## Revised Top 3 (for Indian index options BUYING, not selling):

1. **Opening Range Breakout (ORB)** — 15-min window, trade breakout with options
2. **VWAP Mean Reversion** — fade extreme deviations from VWAP, enter on reversion
3. **EMA Pullback in Trend** — wait for trend (ADX>25), enter on pullback to 9/21 EMA

All three are OPTION BUYING strategies (limited risk, unlimited reward potential).
