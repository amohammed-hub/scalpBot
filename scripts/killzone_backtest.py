#!/usr/bin/env python3
"""Kill zone backtest for Scalper Mode.

Simulates the Scalper Mode signal engine on real 5-minute NIFTY/BANKNIFTY spot
candles for the last ~45 days, then compares outcomes with the 11:00-13:00 IST
kill zone ON vs OFF.

Signal model mirrors the engine's core scalper logic (simplified but faithful):
- Entry LONG: EMA9 > EMA21 and RSI(6) crosses above 40 from below (momentum ignition)
- Entry SHORT: EMA9 < EMA21 and RSI(6) crosses below 60 from above
- SL: 0.55 * ATR(14); TP: 2x SL (scalper B-style 1:2)
- Time stop: 5 candles (25 min) -> exit at market
- One position at a time; 20s-equivalent = 1 candle between entries
- NSE session only: 09:15-15:30 IST.

Outputs per-hour stats so we can decide if the kill zone helps or hurts.
"""
import json
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

def load(fname):
    rows = json.load(open(f"/home/ubuntu/scalpbot-probe/{fname}"))
    rows.sort(key=lambda r: r["time"])
    return rows

def ema(values, period):
    k = 2 / (period + 1)
    out = []
    e = None
    for v in values:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out

def rsi(closes, period=6):
    out = [None] * period
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i-1]
        gains.append(max(d, 0)); losses.append(max(-d, 0))
        if len(gains) >= period:
            avg_g = sum(gains[-period:]) / period
            avg_l = sum(losses[-period:]) / period
            out.append(100 - 100 / (1 + avg_g / avg_l) if avg_l else 100)
        else:
            out.append(None)
    return out

def atr(rows, period=14):
    tr, out = [], []
    for i in range(len(rows)):
        h, l, c = rows[i]["high"], rows[i]["low"], rows[i]["close"]
        prev_c = rows[i-1]["close"] if i > 0 else c
        tr.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
        if i >= period - 1:
            out.append(sum(tr[-period:]) / period)
        else:
            out.append(None)
    return out

def run_backtest(rows, kill_zone_on):
    closes = [r["close"] for r in rows]
    ema9, ema21 = ema(closes, 9), ema(closes, 21)
    r6 = rsi(closes, 6)
    a14 = atr(rows, 14)
    pos = None
    trades = []
    for i in range(21, len(rows)):
        if rows[i]["close"] is None: continue
        dt = datetime.fromtimestamp(rows[i]["time"], IST)
        day = dt.weekday()
        hhmm = dt.hour * 60 + dt.minute
        in_session = day < 5 and 555 <= hhmm < 930  # 09:15-15:30 IST weekdays
        if not in_session:
            if pos is not None:
                pos["exit"] = rows[i]["close"]; pos["reason"] = "eod"; trades.append(pos); pos = None
            continue
        sl_mult, tp_mult = 0.55, 1.1  # SL=0.55ATR, TP=2*SL=1.1ATR
        # Manage open position (time stop after 5 candles)
        if pos is not None:
            pos["hold"] += 1
            if pos["dir"] == "L":
                if rows[i]["low"] <= pos["sl"]:
                    pos["exit"] = pos["sl"]; pos["reason"] = "sl"; trades.append(pos); pos = None; continue
                if rows[i]["high"] >= pos["tp"]:
                    pos["exit"] = pos["tp"]; pos["reason"] = "tp"; trades.append(pos); pos = None; continue
            else:
                if rows[i]["high"] >= pos["sl"]:
                    pos["exit"] = pos["sl"]; pos["reason"] = "sl"; trades.append(pos); pos = None; continue
                if rows[i]["low"] <= pos["tp"]:
                    pos["exit"] = pos["tp"]; pos["reason"] = "tp"; trades.append(pos); pos = None; continue
            if pos is not None and pos["hold"] >= 5:
                pos["exit"] = rows[i]["close"]; pos["reason"] = "time"; trades.append(pos); pos = None
                continue
        # Kill zone gate
        if kill_zone_on and 660 <= hhmm < 780:
            continue
        # Signal: EMA trend + RSI ignition cross
        if r6[i] is None or r6[i-1] is None or a14[i] is None: continue
        e9, e21, rv, rprev, atrv = ema9[i], ema21[i], r6[i], r6[i-1], a14[i]
        if atrv <= 0: continue
        entry = rows[i]["close"]
        if e9 > e21 and rprev < 40 <= rv:
            pos = {"dir": "L", "entry": entry, "sl": entry - sl_mult * atrv, "tp": entry + tp_mult * atrv, "hold": 0, "t": dt, "idx": i}
        elif e9 < e21 and rprev > 60 >= rv:
            pos = {"dir": "S", "entry": entry, "sl": entry + sl_mult * atrv, "tp": entry - tp_mult * atrv, "hold": 0, "t": dt, "idx": i}
    if pos is not None:
        pos["exit"] = rows[-1]["close"]; pos["reason"] = "eod"; trades.append(pos)
    return trades

def stats(trades):
    if not trades: return None
    wins = sum(1 for t in trades if t["exit"] and (
        (t["dir"] == "L" and t["exit"] > t["entry"]) or (t["dir"] == "S" and t["exit"] < t["entry"])))
    n = len(trades)
    tot = sum((t["exit"] - t["entry"]) * (1 if t["dir"] == "L" else -1) for t in trades if t["exit"])
    return {"n": n, "wr": wins / n, "pnl_pts": tot, "avg_pts": tot / n}

def hour_stats(trades):
    from collections import defaultdict
    b = defaultdict(list)
    for t in trades:
        b[t["t"].hour].append(t)
    out = {}
    for h in sorted(b):
        v = b[h]
        s = stats(v)
        out[h] = s
    return out

for sym, fname, label in [("^NSEI", "nifty5m.json", "NIFTY 50"), ("^NSEBANK", "banknifty5m.json", "BANK NIFTY")]:
    rows = load(fname)
    print(f"\n===== {label} — {len(rows)} candles (~{ (rows[-1]['time']-rows[0]['time'])/86400:.0f} days) =====")
    on = stats(run_backtest(rows, kill_zone_on=True))
    off = stats(run_backtest(rows, kill_zone_on=False))
    print(f"KILL ZONE ON : {on['n']:>4} trades | WR {on['wr']*100:>5.1f}% | {on['pnl_pts']:>9.1f} pts | avg {on['avg_pts']:+.2f}")
    print(f"KILL ZONE OFF: {off['n']:>4} trades | WR {off['wr']*100:>5.1f}% | {off['pnl_pts']:>9.1f} pts | avg {off['avg_pts']:+.2f}")
    print("\nPer-hour (no kill zone):")
    for h, s in hour_stats(run_backtest(rows, False)).items():
        print(f"  {h:02d}:00  n={s['n']:>3} WR={s['wr']*100:>5.1f}% pnl={s['pnl_pts']:>8.1f} avg={s['avg_pts']:+.2f}")
