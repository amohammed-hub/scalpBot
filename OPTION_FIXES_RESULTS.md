# Option Execution Quality Gates — 6-Month Backtest Results

## Data: 121 trading days (Jan 19 – Jul 17, 2026), 45,375 candles

## Results Summary

| Scenario | Trades | Win Rate | PF | Total P&L | Max DD |
|----------|--------|----------|-----|-----------|--------|
| BASELINE (no filters) | 363 | 34.4% | 1.11 | ₹20,457 | ₹14,771 |
| Fix 1: Spread > 5% → SKIP | 357 | 34.7% | 1.12 | ₹21,073 | ₹13,973 |
| Fix 2: Premium < ₹10 → SKIP | 363 | 34.4% | 1.11 | ₹20,457 | ₹14,771 |
| Fix 3: 0DTE → ATM only | 363 | 34.4% | 1.11 | ₹20,457 | ₹14,771 |
| ALL 3 COMBINED | 363 | 34.4% | 1.11 | ₹20,457 | ₹14,771 |

## Fix 1 (Spread Check) — Detailed Analysis
- Signals blocked by spread filter: 220
- Actual trades blocked: 59 (rest were blocked by other filters or max-trades-per-day)
- Of 59 blocked trades: 19 would have won, 40 would have lost
- Net P&L of blocked trades: ₹-1,584 (removing them IMPROVES P&L by ₹616)
- Average spread of blocked trades: 5.9%
- ALL 59 blocked trades were on EXPIRY DAYS (Thursday)
- Max Drawdown reduced: ₹14,771 → ₹13,973 (5.4% reduction)

## Fix 3 (0DTE ATM) — Key Insight
- 69 trades modified (forced ATM instead of OTM on expiry days)
- When combined with spread check: the 0DTE ATM fix makes spread narrower (ATM has tighter spreads), so the spread filter blocks FEWER trades
- This means Fix 3 actually PREVENTS Fix 1 from blocking trades (because ATM has better liquidity)

## Expiry Day Analysis
- Expiry days: 23 out of 121 trading days (19%)
- Trades on expiry: 69 | WR: 30.4% | P&L: ₹-4,945
- Trades non-expiry: 294 | WR: 35.4% | P&L: ₹25,403
- EXPIRY DAYS ARE NET NEGATIVE — the bot loses money on Thursdays

## Key Takeaways
1. Fix 1 (spread check) removes losing trades on expiry days → improves P&L by ₹616 and reduces DD by 5.4%
2. Fix 2 (premium floor) has ZERO impact on Nifty — ATM/1-OTM premiums are always >₹50
3. Fix 3 (0DTE ATM) has zero P&L impact in simulation (same underlying P&L) but in REAL trading it matters because ATM has better fills
4. The REAL value of these fixes is in LIVE execution, not backtesting — spread and slippage are not captured in underlying-price backtests
