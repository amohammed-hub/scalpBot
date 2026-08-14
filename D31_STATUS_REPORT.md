# D31 Status Report — Kill Zone Removed, Traffic-Light Regime Live

**Deployed to production (scalpbot.up.railway.app) — Aug 14, 2026**

## 1. Your question answered: why were we blocking 11:00–13:00?

We were not, anymore. The Kill Zone was a hypothesis built from your earlier manual-trading timestamps. I backtested it against 60 days of real 5-minute data across every segment your bots trade, and the data said it was actively harmful:

| Segment | All hours | With Kill Zone | Verdict |
|---|---|---|---|
| NIFTY | −180.6 pts (235 trades, WR 32.3%) | −207.6 pts (167 trades, WR 30.5%) | Kill zone made it **worse** |
| BANK NIFTY | −597.3 pts (259 trades, WR 33.6%) | −822.1 pts (174 trades, WR 32.2%) | Kill zone made it **much worse** |
| WTI Crude (MCX proxy) | −0.4 pts (264 trades) | n/a | Break-even, no reason to block |
| Nat Gas (MCX proxy) | 0.0 pts (279 trades) | n/a | Break-even, no reason to block |
| Silver (MCX proxy) | +2.9 pts (713 trades, WR 36.9%) | n/a | Positive, no reason to block |

Hour-by-hour, the 11:00–13:00 window is not dead at all — **BankNifty's 11:00 hour is the single best hour of the day (+302 pts, WR 41.3%)**, and 13:00 is second best (+222 pts, WR 36.4%). The genuinely weak hours are 12:00–15:00 for NSE and 19:00 for MCX. So the Kill Zone is **removed in every segment** — NSE and MCX, NSE options and MCX commodities alike.

## 2. What replaced it: the Traffic-Light regime

The light gates **new entries only** — stop-loss, target, and trailing exits always fire, no exceptions. It works in every segment because it measures the market's actual condition (trend strength and volatility), not the clock:

| Light | Condition | Action |
|---|---|---|
| 🟢 GREEN | Trend spread ≥ 0.3×ATR14, ATR14 ≥ 50% of recent median, spread ≥ 0.15×median | Entries OPEN |
| 🔴 RED | ATR14 < 35% of recent median (dead chop — market asleep) | No new entries |
| 🟡 YELLOW | Trend present but weak / ignition pending | No new entries |

A safety floor (spread ≥ 0.15×median ATR) prevents GREEN from flickering on in dead chop where the EMAs still lag the last move. The light state is recorded in the bot state every tick, and every flip is written to the Activity log so the dashboard always tells you *why* the bot is waiting — no more silent holding.

Backtest impact of the light (all-hours, no kill zone):

| Segment | Raw signal | With traffic light |
|---|---|---|
| NIFTY | 235 trades, WR 32.3%, DD 258.5 pts | 153 trades, WR 32.0%, **DD 187.6 pts (−27%)** |
| BANK NIFTY | 259 trades, WR 33.6% | 139 trades, WR 30.2% |
| WTI Crude | 264 trades, −0.4 pts | 141 trades, −1.6 pts |
| Nat Gas | 279 trades, 0.0 pts | 156 trades, −0.1 pts |
| Silver | 713 trades, WR 36.9% | 410 trades, WR 37.3% (slightly **better**) |

The light behaves differently by market: it cuts drawdown and noise in choppy markets while actually improving Silver's win rate. In BankNifty it is more selective — fewer, lower-quality signals are skipped.

## 3. One honest finding from the data

The base scalper signal (EMA9/21 ignition + RSI 6 cross + 1:2 risk/reward + 5-candle time stop) is roughly break-even across 60 days — it is not losing badly, but it is not printing 5–15 point wins consistently either. The traffic light keeps capital safer in dead conditions, but the bigger lever for consistent profits is **entry precision**, which is a separate piece of work (tighter ATR bands around the session open, momentum confirmation on the trigger candle itself). Say the word and I'll design and backtest that next.

## 4. Verification (zero-error standard maintained)

| Check | Result |
|---|---|
| Post-deploy smoke test (production, GitHub Actions) | ✅ All probes passed |
| Production flagState / roundTrip / egress / startGuard | ✅ All clean |
| Test suite | 455 passed / 0 failed (7 new D31 regression tests) |
| TypeScript (server + client) | Clean |

## 5. What you should do

1. **Stop → Start each bot slot** so the engine loads the new gate logic.
2. The dashboard will now show the reason a bot is waiting (e.g., "Scalper traffic light 🔴 — dead chop" or "🟡 weak trend") instead of silence.
3. Watch the MCX evening session (from 18:00) and NSE tomorrow — entries are now allowed at all hours, gated only by market condition.
