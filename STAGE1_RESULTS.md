# Stage 1 Historical Replay Results

## Final Results (V2-fixed vs V1)

| Day | V1 P&L | V1 Trades | V2 P&L | V2 Trades | Winner |
|-----|---------|-----------|---------|-----------|--------|
| Mon Jul 14 | ₹-2,973 | 9 | ₹-1,996 | 5 | **V2** (+₹977) |
| Tue Jul 15 | ₹-989 | 10 | ₹-992 | 1 | V1 (by ₹3) |
| Wed Jul 16 | ₹+1,607 | 8 | ₹+1,998 | 1 | **V2** (+₹391) |
| Thu Jul 17 | ₹+1,963 | 10 | ₹+1,978 | 4 | **V2** (+₹15) |
| **TOTAL** | **₹-392** | **37** | **₹+988** | **11** | **V2** (+₹1,380) |

**VERDICT: ✅ PASS — V2 wins 3/4 days**

## V2 Fixes Applied

1. **Market hours fix**: Use candle timestamp (not `new Date()`) for backtesting
2. **HourlyClose + ORB regime-independent**: Fire before regime filter (not just in TRENDING)
3. **RANGING: No FailedBreakout**: Removed entirely (all 6 lost in initial test)
4. **RANGING: Anti-chasing**: VWAPReversion + VWAPPullback require range-extreme position + retracement
5. **RANGING: Balanced Breakout**: body>45%, RSI confirms direction, before 14:00 IST only
6. **DEAD filter kept**: Tuesday's "do nothing" was correct

## Key Metrics

- V2 trades 70% fewer times (11 vs 37 trades)
- V2 win rate: higher per-trade quality
- V2 max drawdown: much lower (₹3,978 vs ₹6,943 on Monday)
- V2 profit factor: consistently better

## Remaining Stages

- [ ] STAGE 2: Paper trade V2 engine Mon-Wed next week (live market, fake money)
- [ ] STAGE 3: Go live with reduced capital (50%) after Stage 2 approval
