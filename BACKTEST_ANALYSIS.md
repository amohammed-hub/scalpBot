# Backtest Results — 6 Instruments × 10 Strategies × 6 Months

**Period:** January 2026 – July 2026 (1-min candles from Upstox public API)
**Capital:** ₹1,00,000 per trade | **Risk:** 1% per trade

## Results Matrix (₹ P&L)

| Strategy | NIFTY | BANKNIFTY | FINNIFTY | GOLD | SILVER | CRUDEOIL |
|----------|-------|-----------|----------|------|--------|----------|
| Breakout | 0 | 0 | 0 | 0 | 0 | 0 |
| Pattern | +2,46,527 | -12,184 | +1,58,668 | +5,84,569 | +11,16,162 | +4,49,642 |
| Trend | +32,500 | +34,730 | +62,443 | +31,40,801 | +8,16,305 | +5,67,543 |
| Momentum | +1,50,972 | +96,900 | +6,006 | +27,94,892 | +12,89,581 | +9,16,109 |
| MACD_BB | -8,837 | +22,881 | +61,527 | +13,57,990 | +8,82,584 | +7,96,495 |
| ORB | -4,806 | -836 | -9,688 | -13,345 | -8,330 | +4,218 |
| VWAPReversion | +90,558 | +46,336 | +49,911 | +82,03,368 | +51,20,134 | +32,88,227 |
| RedBarTheory | +1,34,516 | +80,255 | +1,50,395 | +57,98,568 | +32,70,816 | +15,09,078 |
| TrikalStrategy | +66,296 | +67,923 | +1,64,075 | +80,20,670 | +31,24,460 | +18,58,061 |
| Adeeb | +11,733 | -4,701 | +5,432 | +39,843 | -6,915 | -6,277 |

## Key Findings

### MCX Instruments (Gold, Silver, Crude Oil) — MASSIVELY outperform NSE indices
- **VWAPReversion** is the #1 strategy on ALL MCX instruments (PF 2.97–3.85)
- **TrikalStrategy** is #2 on Gold (₹80L, PF 2.73) and Crude (₹18.5L, PF 1.79)
- **RedBarTheory** is strong across all MCX (PF 2.18–2.21)
- **Trend** works exceptionally on Gold (₹31L, PF 2.34)

### NSE Indices (Nifty, BankNifty, FinNifty) — Marginal edge, high trade count
- **Pattern** is best on NIFTY (₹2.46L) and FinNifty (₹1.58L)
- **RedBarTheory** consistent across all 3 (₹80K–₹1.5L)
- **TrikalStrategy** best on FinNifty (₹1.64L)
- **Adeeb** has highest win rate (70.6% on NIFTY) but few trades
- **ORB** is NEGATIVE on all instruments — should be DISABLED

### Strategies to DISABLE (negative or near-zero across all):
- **Breakout** — 0 trades generated (too strict conditions)
- **ORB** — Negative on 5/6 instruments

## Recommended Auto-Assignment (Profitable Combos)

### NIFTY: Pattern, Momentum, RedBarTheory, Adeeb
### BANKNIFTY: Momentum, RedBarTheory, TrikalStrategy
### FINNIFTY: Pattern, TrikalStrategy, RedBarTheory, MACD_BB
### GOLD: VWAPReversion, TrikalStrategy, RedBarTheory, Trend, Momentum, MACD_BB, Pattern, Adeeb
### SILVER: VWAPReversion, RedBarTheory, TrikalStrategy, Momentum, Pattern, MACD_BB, Trend
### CRUDEOIL: VWAPReversion, TrikalStrategy, RedBarTheory, Momentum, MACD_BB, Trend, Pattern

## Profit Factor Rankings (Top 5 combos)

1. GOLD + VWAPReversion: PF 3.85 (₹82L)
2. SILVER + VWAPReversion: PF 3.78 (₹51L)
3. CRUDEOIL + VWAPReversion: PF 2.97 (₹33L)
4. GOLD + TrikalStrategy: PF 2.73 (₹80L)
5. SILVER + Pattern: PF 2.69 (₹11L)
