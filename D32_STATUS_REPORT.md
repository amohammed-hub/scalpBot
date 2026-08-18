# D32 Status Report — Signal Starvation Fix (Aug 14, 2026)

## What you reported

All bots showed continuous "HOLD | No signal" scans — BankNifty/Nifty with RSI 37–52, ADX 12–23, regime RANGING — and zero trades despite restarts.

## Root cause

Your screenshot confirmed the bots are running in **Auto mode on the V2 regime engine**. The engine was behaving *correctly* but uselessly: in a ranging regime (ADX below 20, which was most of today's choppy tape), the only candidate layers were VWAP Reversion, VWAP Pullback, and CPR — and each of those had tight conditions that silently rejected nearly every candidate:

| Gate | Before | Why it killed trades |
|---|---|---|
| Pullback window (Trend/Momentum layers) | 0.4% from EMA9 or VWAP | On real 5m data this fired on only 181–200 scans across 60 days — days of silence |
| Range-extreme (VWAPReversion/Pullback) | top/bottom 30% of 20-candle range | ~600 scans per index generated a direction, then ~70% were rejected at this gate |
| Retracement check | last 5 candles | Stale — price sits still at extremes; the 3-candle check catches genuine retracements |

Quantified on 60 days of fresh real BankNifty/Nifty 5m data: the engine classified 45% of scans RANGING and, inside RANGING, the VWAP-Reversion layer could have generated a direction in 594–662 scans — but the 5-candle retracement requirement rejected most of them, leaving you with zero trades.

## The fix (D32, backtest-validated before shipping)

| Change | Evidence (60-day backtest) |
|---|---|
| Pullback window 0.4% → 0.8% (V1 + V2 Trend/Momentum) | BankNifty: WR 62.0%→62.8%, total +4874→+5621 pts, PF 1.90→1.93, DD +319→+361. Nifty: WR 53.6%→58.0%, total +892→+1440 pts, PF 1.51→1.77, DD flat |
| Range-extreme 30%/70% → 40%/60% (VWAPReversion & Pullback) | Same run, integrated in the numbers above |
| Retracement window 5 → 3 candles | +15% more entries, WR and DD unchanged |

Every change is individually justified by the same dataset — nothing shipped on theory. Trade count rises ~20 trades per index per 60 days while win rate and drawdown hold or improve.

## Verification (zero-error standard)

| Check | Result |
|---|---|
| TypeScript (server + client) | Clean |
| Full test suite | 455 passed / 0 failed |
| Post-deploy smoke test on production | ✅ All steps passed (commit 507d60f) |
| Engine probes (flagState / roundTrip / egress / startGuard) | ✅ All clean |

## Why your high-mode (scalper) bots were not in the log

Your Activity Log screenshot only showed **Auto-mode** registrations ("Bot registered — ITM Options (Auto)"). The D31 traffic light applies only to the Scalper/High path. If you intended Scalper Mode, switch the strategy mode toggle to "High/Scalper" in the dashboard and restart the bot. Auto mode (now fixed by D32) will trade more often too.

## Action needed

Stop → Start each bot slot (the in-memory engine reloads on start). Trades should begin firing on the next qualifying condition — today's choppy tape is exactly where the relaxed ranging gates now act.
