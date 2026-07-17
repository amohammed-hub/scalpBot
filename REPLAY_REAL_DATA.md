# Real Data Replay — Fix #1 Applied
## Engine: 5m trend = soft bias (15% penalty instead of hard block)


## 2026-07-16

### Nifty 50 (375 candles, Open: 24142.10, Close: 24081.10)

| # | Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|---|------|-----|------|-------|-------|----|---------|---------| 
| 1 | 09:51 am | SELL | 89% | ORB | 24113.4 | 24129.4 | 24081.5 | [ORB] Below 15-min range | 0.017% | Low Volatility / Squeeze |
| 2 | 09:52 am | SELL | 86% | ORB | 24114.5 | 24129.1 | 24085.3 | [ORB] Below 15-min range | 0.013% | Low Volatility / Squeeze |
| 3 | 09:53 am | SELL | 82% | ORB | 24116.2 | 24130.2 | 24088.3 | [ORB] Below 15-min range | 0.006% | Low Volatility / Squeeze |
| 4 | 10:47 am | BUY | 83% | Breakout | 24141.8 | 24131.3 | 24162.9 | [Breakout] Above 24135.5 | Vol 1.5x | RSI(67) | 5m:neutral | |
| 5 | 11:24 am | SELL | 84% | Trend | 24151.8 | 24162.5 | 24130.3 | [Supertrend] HA-Supertrend(10,3) flipped SELL | band:24175.6 |
| 6 | 02:58 pm | BUY | 82% | Breakout | 24115.0 | 24105.0 | 24135.0 | [Breakout] Above 24109.5 | Vol 1.5x | RSI(69) | 5m:neutral | |
| 7 | 02:59 pm | SELL | 93% | ORB | 24111.7 | 24122.9 | 24089.3 | [ORB] Below 15-min range | 0.024% | Strong Trend — ride mome |
| 8 | 03:28 pm | BUY | 84% | Breakout | 24085.8 | 24074.1 | 24109.0 | [Breakout] Above 24078.6 | Vol 1.5x | RSI(62) | 5m:neutral | |
| 9 | 03:29 pm | SELL | 98% | ORB | 24081.1 | 24093.3 | 24056.8 | [ORB] Below 15-min range | 0.151% | Low Volatility / Squeeze |

**Summary:** 160 signals total (14 BUY, 146 SELL) out of 355 possible candles

**5m-penalty applied:** 0 signals (5m trend was aligned or neutral for all signals)

### BankNifty (375 candles, Open: 57831.10, Close: 57602.00)

| # | Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|---|------|-----|------|-------|-------|----|---------|---------| 
| 1 | 10:05 am | SELL | 89% | ORB | 57635.2 | 57671.6 | 57562.2 | [ORB] Below 15-min range | 0.017% | Weak Trend — use breakou |
| 2 | 10:25 am | SELL | 84% | ORB | 57640.1 | 57670.8 | 57578.6 | [ORB] Below 15-min range | 0.009% | Weak Trend — use breakou |
| 3 | 10:26 am | SELL | 87% | Breakout | 57608.5 | 57641.6 | 57542.4 | [Breakout] Below 57633.8 | Vol 1.5x | RSI(28) | 5m:neutral | |
| 4 | 10:34 am | BUY | 77% | Pattern | 57579.7 | 57543.6 | 57651.9 | [Pattern] Hammer | RSI(25) oversold | Vol 1.5x | Prime Morni |
| 5 | 10:35 am | SELL | 98% | ORB | 57584.0 | 57619.5 | 57513.0 | [ORB] Below 15-min range | 0.106% | Low Volatility / Squeeze |
| 6 | 10:46 am | BUY | 87% | Trend | 57678.4 | 57644.3 | 57746.7 | [Supertrend] HA-Supertrend(10,3) flipped BUY | band:57572.4  |
| 7 | 11:49 am | SELL | 84% | ORB | 57639.6 | 57678.4 | 57561.8 | [ORB] Below 15-min range | 0.010% | Low Volatility / Squeeze |
| 8 | 11:54 am | BUY | 77% | Pattern | 57634.3 | 57600.9 | 57700.9 | [Pattern] Hammer | RSI(35) oversold | Vol 1.5x | Prime Morni |
| 9 | 11:55 am | SELL | 94% | ORB | 57629.8 | 57663.2 | 57563.1 | [ORB] Below 15-min range | 0.027% | Low Volatility / Squeeze |
| 10 | 12:25 pm | BUY | 89% | Breakout | 57665.1 | 57630.7 | 57733.8 | [Breakout] Above 57633.0 | Vol 1.5x | RSI(64) | 5m:neutral | |
| 11 | 12:33 pm | SELL | 85% | ORB | 57639.0 | 57676.2 | 57564.6 | [ORB] Below 15-min range | 0.011% | Low Volatility / Squeeze |
| 12 | 02:55 pm | BUY | 82% | Breakout | 57571.9 | 57537.7 | 57640.3 | [Breakout] Above 57559.9 | Vol 1.5x | RSI(66) | 5m:neutral | |
| 13 | 02:56 pm | SELL | 98% | ORB | 57586.2 | 57619.5 | 57519.4 | [ORB] Below 15-min range | 0.102% | Strong Trend — ride mome |
| 14 | 02:58 pm | BUY | 83% | Breakout | 57607.4 | 57576.2 | 57669.9 | [Breakout] Above 57592.8 | Vol 1.5x | RSI(74) | 5m:neutral | |
| 15 | 02:59 pm | SELL | 98% | ORB | 57605.9 | 57640.8 | 57536.2 | [ORB] Below 15-min range | 0.068% | Low Volatility / Squeeze |

**Summary:** 234 signals total (7 BUY, 227 SELL) out of 355 possible candles

**5m-penalty applied:** 0 signals (5m trend was aligned or neutral for all signals)

### FinNifty (375 candles, Open: 26712.00, Close: 26553.15)

| # | Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|---|------|-----|------|-------|-------|----|---------|---------| 
| 1 | 09:49 am | SELL | 81% | ORB | 26591.7 | 26612.7 | 26549.8 | [ORB] Below 15-min range | 0.003% | Low Volatility / Squeeze |
| 2 | 09:51 am | SELL | 90% | ORB | 26587.2 | 26607.1 | 26547.3 | [ORB] Below 15-min range | 0.020% | Low Volatility / Squeeze |
| 3 | 10:05 am | SELL | 88% | ORB | 26588.4 | 26606.6 | 26552.0 | [ORB] Below 15-min range | 0.016% | Low Volatility / Squeeze |
| 4 | 10:47 am | BUY | 82% | Breakout | 26607.7 | 26592.4 | 26638.4 | [Breakout] Above 26601.8 | Vol 1.5x | RSI(75) | 5m:neutral | |
| 5 | 12:01 pm | SELL | 86% | ORB | 26589.3 | 26602.8 | 26562.3 | [ORB] Below 15-min range | 0.012% | Low Volatility / Squeeze |
| 6 | 12:04 pm | BUY | 77% | Pattern | 26580.7 | 26566.3 | 26609.5 | [Pattern] Hammer | RSI(37) oversold | Vol 1.5x | Prime Morni |
| 7 | 12:05 pm | SELL | 94% | ORB | 26585.2 | 26599.3 | 26557.1 | [ORB] Below 15-min range | 0.028% | Low Volatility / Squeeze |
| 8 | 12:25 pm | BUY | 84% | Breakout | 26604.6 | 26591.0 | 26631.9 | [Breakout] Above 26596.5 | Vol 1.5x | RSI(61) | 5m:neutral | |
| 9 | 12:41 pm | SELL | 84% | ORB | 26590.5 | 26604.7 | 26562.1 | [ORB] Below 15-min range | 0.008% | Low Volatility / Squeeze |
| 10 | 02:58 pm | BUY | 85% | Breakout | 26586.6 | 26572.1 | 26615.6 | [Breakout] Above 26576.7 | Vol 1.5x | RSI(77) | 5m:neutral | |
| 11 | 02:59 pm | SELL | 96% | ORB | 26584.3 | 26600.4 | 26552.1 | [ORB] Below 15-min range | 0.031% | Low Volatility / Squeeze |

**Summary:** 221 signals total (7 BUY, 214 SELL) out of 355 possible candles

**5m-penalty applied:** 0 signals (5m trend was aligned or neutral for all signals)


## 2026-07-17

### Nifty 50: Insufficient data (0 candles)

### BankNifty: Insufficient data (0 candles)

### FinNifty: Insufficient data (0 candles)

## 2026-07-17 (Intraday)

### Nifty 50 (375 candles, Open: 24127.60, Close: 24346.70)

| Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|------|-----|------|-------|-------|----|---------|---------| 
| 09:44 am | BUY | 98% | ORB | 24231.3 | 24217.6 | 24258.7 | [ORB] Above 15-min range | 0.081% | Low Volatility / Squeeze — wait fo |
| 09:45 am | BUY | 98% | ORB | 24234.5 | 24221.0 | 24261.4 | [ORB] Above 15-min range | 0.094% | Low Volatility / Squeeze — wait fo |
| 09:46 am | BUY | 98% | ORB | 24241.5 | 24228.2 | 24268.0 | [ORB] Above 15-min range | 0.123% | Low Volatility / Squeeze — wait fo |
| 10:01 am | SELL | 82% | Breakout | 24212.3 | 24227.1 | 24182.9 | [Breakout] Below 24217.3 | Vol 1.5x | RSI(36) | 5m:neutral | thr:0.020 |
| 10:02 am | BUY | 89% | ORB | 24216.0 | 24201.4 | 24245.0 | [ORB] Above 15-min range | 0.018% | Low Volatility / Squeeze — wait fo |
| 10:43 am | SELL | 82% | Breakout | 24248.2 | 24261.0 | 24222.5 | [Breakout] Below 24253.8 | Vol 1.5x | RSI(23) | 5m:neutral | thr:0.020 |
| 10:44 am | BUY | 98% | ORB | 24259.1 | 24246.1 | 24285.0 | [ORB] Above 15-min range | 0.196% | Low Volatility / Squeeze — wait fo |
| 11:08 am | SELL | 84% | Breakout | 24238.3 | 24251.0 | 24213.0 | [Breakout] Below 24245.7 | Vol 1.5x | RSI(35) | 5m:neutral | thr:0.020 |
| 11:09 am | BUY | 98% | ORB | 24241.9 | 24229.6 | 24266.5 | [ORB] Above 15-min range | 0.125% | Low Volatility / Squeeze — wait fo |
| 11:57 am | SELL | 77% | Pattern | 24279.3 | 24288.2 | 24261.7 | [Pattern] Shooting Star | RSI(73) overbought | Vol 1.5x | Prime Mornin |
| 11:58 am | BUY | 98% | ORB | 24275.0 | 24266.1 | 24292.9 | [ORB] Above 15-min range | 0.261% | Strong Trend — ride momentum, no m |
| 01:47 pm | SELL | 82% | Breakout | 24238.7 | 24249.7 | 24216.8 | [Breakout] Below 24243.8 | Vol 1.5x | RSI(28) | 5m:neutral | thr:0.020 |
| 01:48 pm | BUY | 98% | ORB | 24247.0 | 24235.7 | 24269.8 | [ORB] Above 15-min range | 0.146% | Weak Trend — use breakout + moment |
| 01:50 pm | SELL | 85% | Breakout | 24226.7 | 24239.5 | 24201.1 | [Breakout] Below 24235.8 | Vol 1.5x | RSI(23) | 5m:neutral | thr:0.020 |
| 01:52 pm | BUY | 98% | ORB | 24222.3 | 24208.4 | 24250.3 | [ORB] Above 15-min range | 0.044% | Low Volatility / Squeeze — wait fo |
| 02:28 pm | SELL | 77% | Pattern | 24309.5 | 24335.2 | 24258.1 | [Pattern] Shooting Star | RSI(58) overbought | Vol 1.5x | Prime Mornin |
| 02:29 pm | BUY | 98% | ORB | 24287.4 | 24259.9 | 24342.5 | [ORB] Above 15-min range | 0.313% | Weak Trend — use breakout + moment |

**Summary:** 346 signals (338 BUY, 8 SELL)
**5m-penalty applied:** 0 signals (would have been BLOCKED before Fix #1)

### BankNifty (375 candles, Open: 57662.00, Close: 58576.00)

| Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|------|-----|------|-------|-------|----|---------|---------| 
| 09:44 am | BUY | 98% | ORB | 57912.0 | 57860.0 | 58016.0 | [ORB] Above 15-min range | 0.136% | Low Volatility / Squeeze — wait fo |
| 09:45 am | BUY | 98% | ORB | 57936.3 | 57884.3 | 58040.4 | [ORB] Above 15-min range | 0.178% | Low Volatility / Squeeze — wait fo |
| 09:46 am | BUY | 98% | ORB | 57952.6 | 57903.7 | 58050.3 | [ORB] Above 15-min range | 0.206% | Low Volatility / Squeeze — wait fo |
| 12:28 pm | SELL | 77% | Pattern | 58122.3 | 58156.8 | 58053.2 | [Pattern] Shooting Star | RSI(56) overbought | Vol 1.5x | Prime Mornin |
| 12:29 pm | BUY | 98% | ORB | 58118.3 | 58085.8 | 58183.5 | [ORB] Above 15-min range | 0.493% | Low Volatility / Squeeze — wait fo |
| 01:24 pm | SELL | 88% | Breakout | 58035.8 | 58069.1 | 57969.3 | [Breakout] Below 58065.8 | Vol 1.5x | RSI(28) | 5m:neutral | thr:0.020 |
| 01:25 pm | BUY | 98% | ORB | 58055.8 | 58021.6 | 58124.3 | [ORB] Above 15-min range | 0.385% | Low Volatility / Squeeze — wait fo |
| 01:31 pm | SELL | 82% | Breakout | 58012.7 | 58049.1 | 57939.8 | [Breakout] Below 58025.6 | Vol 1.5x | RSI(26) | 5m:neutral | thr:0.021 |
| 01:33 pm | BUY | 98% | ORB | 57986.6 | 57937.5 | 58084.8 | [ORB] Above 15-min range | 0.265% | Low Volatility / Squeeze — wait fo |
| 02:34 pm | SELL | 77% | Pattern | 58407.8 | 58476.5 | 58270.3 | [Pattern] Shooting Star | RSI(57) overbought | Vol 1.5x | Prime Mornin |
| 02:35 pm | BUY | 98% | ORB | 58405.1 | 58339.9 | 58535.6 | [ORB] Above 15-min range | 0.989% | Strong Trend — ride momentum, no m |
| 02:43 pm | SELL | 77% | Pattern | 58427.9 | 58486.2 | 58311.3 | [Pattern] Shooting Star | RSI(57) overbought | Vol 1.5x | Prime Mornin |
| 02:44 pm | BUY | 98% | ORB | 58452.4 | 58400.8 | 58555.6 | [ORB] Above 15-min range | 1.070% | Low Volatility / Squeeze — wait fo |

**Summary:** 338 signals (332 BUY, 6 SELL)
**5m-penalty applied:** 0 signals (would have been BLOCKED before Fix #1)

### FinNifty (375 candles, Open: 26630.90, Close: 26919.95)

| Time | Dir | Conf | Layer | Entry | SL | Target | Reason |
|------|-----|------|-------|-------|----|---------|---------| 
| 09:44 am | BUY | 98% | ORB | 26728.1 | 26706.7 | 26771.0 | [ORB] Above 15-min range | 0.075% | Strong Trend — ride momentum, no m |
| 09:45 am | BUY | 98% | ORB | 26737.9 | 26716.1 | 26781.5 | [ORB] Above 15-min range | 0.112% | Low Volatility / Squeeze — wait fo |
| 09:46 am | BUY | 98% | ORB | 26750.7 | 26729.6 | 26792.7 | [ORB] Above 15-min range | 0.159% | Low Volatility / Squeeze — wait fo |
| 09:56 am | SELL | 86% | Breakout | 26702.3 | 26723.2 | 26660.7 | [Breakout] Below 26713.0 | Vol 1.5x | RSI(40) | 5m:neutral | thr:0.026 |
| 09:58 am | BUY | 98% | ORB | 26722.8 | 26700.5 | 26767.5 | [ORB] Above 15-min range | 0.055% | Low Volatility / Squeeze — wait fo |
| 11:08 am | SELL | 89% | Breakout | 26766.8 | 26785.5 | 26729.5 | [Breakout] Below 26781.7 | Vol 1.5x | RSI(28) | 5m:neutral | thr:0.023 |
| 11:09 am | BUY | 98% | ORB | 26774.7 | 26756.2 | 26811.6 | [ORB] Above 15-min range | 0.249% | Low Volatility / Squeeze — wait fo |
| 12:04 pm | SELL | 77% | Pattern | 26836.8 | 26852.2 | 26805.8 | [Pattern] Shooting Star | RSI(71) overbought | Vol 1.5x | Prime Mornin |
| 12:05 pm | BUY | 98% | ORB | 26835.8 | 26820.1 | 26867.3 | [ORB] Above 15-min range | 0.478% | Strong Trend — ride momentum, no m |
| 01:03 pm | SELL | 83% | Breakout | 26814.5 | 26830.0 | 26783.6 | [Breakout] Below 26821.3 | Vol 1.5x | RSI(22) | 5m:neutral | thr:0.020 |
| 01:04 pm | BUY | 98% | ORB | 26815.9 | 26800.9 | 26845.9 | [ORB] Above 15-min range | 0.404% | Low Volatility / Squeeze — wait fo |
| 01:24 pm | SELL | 85% | Breakout | 26788.0 | 26803.9 | 26756.0 | [Breakout] Below 26797.9 | Vol 1.5x | RSI(32) | 5m:neutral | thr:0.020 |
| 01:25 pm | BUY | 98% | ORB | 26794.7 | 26778.2 | 26827.6 | [ORB] Above 15-min range | 0.324% | Low Volatility / Squeeze — wait fo |
| 01:47 pm | SELL | 84% | Breakout | 26750.8 | 26766.9 | 26718.4 | [Breakout] Below 26759.3 | Vol 1.5x | RSI(21) | 5m:neutral | thr:0.020 |
| 01:48 pm | BUY | 98% | ORB | 26757.2 | 26741.0 | 26789.5 | [ORB] Above 15-min range | 0.184% | Low Volatility / Squeeze — wait fo |

**Summary:** 341 signals (335 BUY, 6 SELL)
**5m-penalty applied:** 0 signals (would have been BLOCKED before Fix #1)
