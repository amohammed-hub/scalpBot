#!/usr/bin/env python3
"""
Backtest: CPR (Central Pivot Range) + Adaptive Regime (ADX-based) on NIFTY 50
Uses daily candles from Upstox API (56 trading days: May 4 - Jul 20, 2026)

Strategies tested:
1. CPR (Central Pivot Range) - new strategy
2. Breakout (existing winner)
3. VWAP Pullback (existing winner)
4. Failed Breakout (existing winner)
5. Supertrend (existing - underperformer)

Comparisons:
- CPR standalone results
- 4 winners WITH adaptive regime filter vs WITHOUT
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# ── Fetch Data ────────────────────────────────────────────────────────────────

def fetch_nifty_daily():
    """Fetch NIFTY 50 daily candles from Upstox (no auth needed for historical daily)"""
    import requests
    url = "https://api.upstox.com/v2/historical-candle/NSE_INDEX%7CNifty%2050/day/2026-07-21/2026-05-01"
    resp = requests.get(url, headers={"Accept": "application/json"}, timeout=10)
    data = resp.json()
    candles = data.get("data", {}).get("candles", [])
    # Upstox returns descending (newest first) — reverse to ascending
    candles.reverse()
    result = []
    for c in candles:
        result.append({
            "date": c[0][:10],  # YYYY-MM-DD
            "open": c[1],
            "high": c[2],
            "low": c[3],
            "close": c[4],
            "volume": c[5]
        })
    return result

# ── Technical Indicators ──────────────────────────────────────────────────────

def calc_atr(candles: list, period: int = 14) -> List[float]:
    """Calculate ATR for each candle"""
    atrs = [0.0] * len(candles)
    if len(candles) < period + 1:
        return atrs
    # True Range
    trs = []
    for i in range(1, len(candles)):
        c = candles[i]
        p = candles[i-1]
        tr = max(c["high"] - c["low"], abs(c["high"] - p["close"]), abs(c["low"] - p["close"]))
        trs.append(tr)
    # Initial ATR = SMA of first 'period' TRs
    atr = sum(trs[:period]) / period
    atrs[period] = atr
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
        atrs[i + 1] = atr
    return atrs

def calc_adx(candles: list, period: int = 14) -> List[float]:
    """Calculate ADX for each candle"""
    adx_values = [0.0] * len(candles)
    if len(candles) < period * 2 + 1:
        return adx_values
    
    plus_dm = []
    minus_dm = []
    tr_list = []
    
    for i in range(1, len(candles)):
        c = candles[i]
        p = candles[i-1]
        high_diff = c["high"] - p["high"]
        low_diff = p["low"] - c["low"]
        pdm = high_diff if high_diff > low_diff and high_diff > 0 else 0
        mdm = low_diff if low_diff > high_diff and low_diff > 0 else 0
        tr = max(c["high"] - c["low"], abs(c["high"] - p["close"]), abs(c["low"] - p["close"]))
        plus_dm.append(pdm)
        minus_dm.append(mdm)
        tr_list.append(tr)
    
    # Smoothed values
    smooth_pdm = sum(plus_dm[:period])
    smooth_mdm = sum(minus_dm[:period])
    smooth_tr = sum(tr_list[:period])
    
    dx_values = []
    for i in range(period - 1, len(plus_dm)):
        if i == period - 1:
            smooth_pdm = sum(plus_dm[:period])
            smooth_mdm = sum(minus_dm[:period])
            smooth_tr = sum(tr_list[:period])
        else:
            smooth_pdm = smooth_pdm - smooth_pdm / period + plus_dm[i]
            smooth_mdm = smooth_mdm - smooth_mdm / period + minus_dm[i]
            smooth_tr = smooth_tr - smooth_tr / period + tr_list[i]
        
        plus_di = 100 * smooth_pdm / smooth_tr if smooth_tr > 0 else 0
        minus_di = 100 * smooth_mdm / smooth_tr if smooth_tr > 0 else 0
        di_sum = plus_di + minus_di
        dx = 100 * abs(plus_di - minus_di) / di_sum if di_sum > 0 else 0
        dx_values.append(dx)
    
    # ADX = smoothed DX
    if len(dx_values) >= period:
        adx = sum(dx_values[:period]) / period
        adx_values[period * 2] = adx
        for i in range(period, len(dx_values)):
            adx = (adx * (period - 1) + dx_values[i]) / period
            idx = i + period + 1
            if idx < len(adx_values):
                adx_values[idx] = adx
    
    return adx_values

def calc_supertrend(candles: list, atr_period: int = 10, multiplier: float = 3.0) -> List[dict]:
    """Calculate Supertrend indicator"""
    results = [{"trend": 0, "value": 0.0} for _ in candles]
    if len(candles) < atr_period + 2:
        return results
    
    atrs = calc_atr(candles, atr_period)
    prev_upper = 0.0
    prev_lower = 0.0
    prev_trend = 1  # 1 = bullish, -1 = bearish
    
    for i in range(atr_period + 1, len(candles)):
        c = candles[i]
        atr = atrs[i]
        if atr == 0:
            results[i] = results[i-1]
            continue
        
        hl2 = (c["high"] + c["low"]) / 2
        upper = hl2 + multiplier * atr
        lower = hl2 - multiplier * atr
        
        # Adjust bands
        if prev_lower > 0:
            lower = max(lower, prev_lower) if candles[i-1]["close"] > prev_lower else lower
        if prev_upper > 0:
            upper = min(upper, prev_upper) if candles[i-1]["close"] < prev_upper else upper
        
        # Determine trend
        if prev_trend == 1:
            trend = -1 if c["close"] < lower else 1
        else:
            trend = 1 if c["close"] > upper else -1
        
        results[i] = {"trend": trend, "value": lower if trend == 1 else upper}
        prev_upper = upper
        prev_lower = lower
        prev_trend = trend
    
    return results

def calc_ema(values: list, period: int) -> List[float]:
    """Calculate EMA"""
    emas = [0.0] * len(values)
    if not values:
        return emas
    k = 2 / (period + 1)
    emas[0] = values[0]
    for i in range(1, len(values)):
        emas[i] = values[i] * k + emas[i-1] * (1 - k)
    return emas

# ── CPR (Central Pivot Range) Strategy ────────────────────────────────────────

def calc_cpr(prev_high: float, prev_low: float, prev_close: float) -> dict:
    """
    Calculate CPR levels from previous day's H/L/C
    
    Pivot = (H + L + C) / 3
    BC (Bottom Central) = (H + L) / 2
    TC (Top Central) = (Pivot - BC) + Pivot = 2*Pivot - BC
    
    Support/Resistance levels:
    S1 = 2*Pivot - H
    R1 = 2*Pivot - L
    S2 = Pivot - (H - L)
    R2 = Pivot + (H - L)
    """
    pivot = (prev_high + prev_low + prev_close) / 3
    bc = (prev_high + prev_low) / 2
    tc = 2 * pivot - bc
    
    # Ensure TC > BC (swap if needed)
    if tc < bc:
        tc, bc = bc, tc
    
    s1 = 2 * pivot - prev_high
    r1 = 2 * pivot - prev_low
    s2 = pivot - (prev_high - prev_low)
    r2 = pivot + (prev_high - prev_low)
    
    cpr_width = tc - bc
    day_range = prev_high - prev_low
    # Narrow CPR = width < 0.3% of price (high probability trending day)
    is_narrow = (cpr_width / pivot) < 0.003
    
    return {
        "pivot": pivot,
        "tc": tc,
        "bc": bc,
        "s1": s1, "s2": s2,
        "r1": r1, "r2": r2,
        "width": cpr_width,
        "is_narrow": is_narrow
    }

@dataclass
class Trade:
    entry_date: str
    direction: str  # "LONG" or "SHORT"
    entry_price: float
    exit_price: float
    pnl_pts: float
    strategy: str
    sl_pts: float = 0.0
    target_pts: float = 0.0

def backtest_cpr(candles: list) -> List[Trade]:
    """
    CPR Strategy Rules:
    1. Calculate CPR from previous day's H/L/C
    2. If today opens ABOVE TC → LONG bias (buy on pullback to TC/Pivot)
    3. If today opens BELOW BC → SHORT bias (sell on rally to BC/Pivot)
    4. If narrow CPR → expect trending day, use wider targets
    5. SL = below BC (for longs) or above TC (for shorts)
    6. Target = R1 (for longs) or S1 (for shorts)
    
    Entry simulation using daily OHLC:
    - For LONG: if price touches TC/Pivot during the day (low <= pivot) and closes above entry
    - For SHORT: if price touches BC/Pivot during the day (high >= pivot) and closes below entry
    """
    trades = []
    
    for i in range(1, len(candles)):
        prev = candles[i-1]
        today = candles[i]
        
        cpr = calc_cpr(prev["high"], prev["low"], prev["close"])
        
        # Determine bias based on open relative to CPR
        open_price = today["open"]
        
        # LONG: Open above TC, pullback to Pivot/TC area, target R1
        if open_price > cpr["tc"]:
            # Check if price pulled back to TC during the day
            if today["low"] <= cpr["tc"] + 5:  # Allow 5pt buffer
                entry = cpr["tc"]
                sl = cpr["bc"] - 5
                target = cpr["r1"]
                sl_pts = entry - sl
                target_pts = target - entry
                
                # Simulate: did price hit target or SL first?
                # If high >= target → win
                # If low <= sl → loss
                # Use close as proxy if neither hit
                if today["high"] >= target and today["low"] > sl:
                    pnl = target_pts
                elif today["low"] <= sl:
                    pnl = -sl_pts
                elif today["close"] > entry:
                    pnl = today["close"] - entry
                else:
                    pnl = today["close"] - entry
                
                trades.append(Trade(
                    entry_date=today["date"],
                    direction="LONG",
                    entry_price=entry,
                    exit_price=entry + pnl,
                    pnl_pts=pnl,
                    strategy="CPR",
                    sl_pts=sl_pts,
                    target_pts=target_pts
                ))
        
        # SHORT: Open below BC, rally to BC/Pivot area, target S1
        elif open_price < cpr["bc"]:
            # Check if price rallied to BC during the day
            if today["high"] >= cpr["bc"] - 5:  # Allow 5pt buffer
                entry = cpr["bc"]
                sl = cpr["tc"] + 5
                target = cpr["s1"]
                sl_pts = sl - entry
                target_pts = entry - target
                
                if today["low"] <= target and today["high"] < sl:
                    pnl = target_pts
                elif today["high"] >= sl:
                    pnl = -sl_pts
                elif today["close"] < entry:
                    pnl = entry - today["close"]
                else:
                    pnl = entry - today["close"]
                
                trades.append(Trade(
                    entry_date=today["date"],
                    direction="SHORT",
                    entry_price=entry,
                    exit_price=entry - pnl,
                    pnl_pts=pnl,
                    strategy="CPR",
                    sl_pts=sl_pts,
                    target_pts=target_pts
                ))
        
        # NARROW CPR: Breakout play — wait for breakout above TC or below BC
        elif cpr["is_narrow"]:
            # Breakout above TC
            if today["high"] > cpr["tc"] + 10:
                entry = cpr["tc"] + 10
                sl = cpr["pivot"] - 5
                target = cpr["r1"]
                sl_pts = entry - sl
                target_pts = target - entry
                
                if target_pts > 0:
                    if today["high"] >= target:
                        pnl = target_pts
                    elif today["low"] <= sl:
                        pnl = -sl_pts
                    else:
                        pnl = today["close"] - entry
                    
                    trades.append(Trade(
                        entry_date=today["date"],
                        direction="LONG",
                        entry_price=entry,
                        exit_price=entry + pnl,
                        pnl_pts=pnl,
                        strategy="CPR",
                        sl_pts=sl_pts,
                        target_pts=target_pts
                    ))
            # Breakout below BC
            elif today["low"] < cpr["bc"] - 10:
                entry = cpr["bc"] - 10
                sl = cpr["pivot"] + 5
                target = cpr["s1"]
                sl_pts = sl - entry
                target_pts = entry - target
                
                if target_pts > 0:
                    if today["low"] <= target:
                        pnl = target_pts
                    elif today["high"] >= sl:
                        pnl = -sl_pts
                    else:
                        pnl = entry - today["close"]
                    
                    trades.append(Trade(
                        entry_date=today["date"],
                        direction="SHORT",
                        entry_price=entry,
                        exit_price=entry - pnl,
                        pnl_pts=pnl,
                        strategy="CPR",
                        sl_pts=sl_pts,
                        target_pts=target_pts
                    ))
    
    return trades

# ── Breakout Strategy (simulated on daily) ────────────────────────────────────

def backtest_breakout(candles: list) -> List[Trade]:
    """
    Breakout: Price breaks above previous day's high (LONG) or below previous day's low (SHORT)
    Entry: Previous high + 10pts buffer
    SL: ATR-based (1.5x ATR)
    Target: 2x SL (2:1 RR)
    """
    trades = []
    atrs = calc_atr(candles)
    
    for i in range(15, len(candles)):
        prev = candles[i-1]
        today = candles[i]
        atr = atrs[i] if atrs[i] > 0 else 50
        
        # LONG breakout: today's high > prev high
        if today["high"] > prev["high"] + 10:
            entry = prev["high"] + 10
            sl_pts = min(atr * 1.5, 80)  # Cap SL at 80pts
            target_pts = sl_pts * 2
            sl = entry - sl_pts
            target = entry + target_pts
            
            if today["high"] >= target and today["low"] > sl:
                pnl = target_pts
            elif today["low"] <= sl:
                pnl = -sl_pts
            else:
                pnl = today["close"] - entry
            
            trades.append(Trade(
                entry_date=today["date"], direction="LONG",
                entry_price=entry, exit_price=entry + pnl,
                pnl_pts=pnl, strategy="Breakout",
                sl_pts=sl_pts, target_pts=target_pts
            ))
        
        # SHORT breakout: today's low < prev low
        elif today["low"] < prev["low"] - 10:
            entry = prev["low"] - 10
            sl_pts = min(atr * 1.5, 80)
            target_pts = sl_pts * 2
            sl = entry + sl_pts
            target = entry - target_pts
            
            if today["low"] <= target and today["high"] < sl:
                pnl = target_pts
            elif today["high"] >= sl:
                pnl = -sl_pts
            else:
                pnl = entry - today["close"]
            
            trades.append(Trade(
                entry_date=today["date"], direction="SHORT",
                entry_price=entry, exit_price=entry - pnl,
                pnl_pts=pnl, strategy="Breakout",
                sl_pts=sl_pts, target_pts=target_pts
            ))
    
    return trades

# ── VWAP Pullback Strategy ────────────────────────────────────────────────────

def backtest_vwap_pullback(candles: list) -> List[Trade]:
    """
    VWAP Pullback: Price pulls back to VWAP (approximated as daily pivot) in a trending market
    Entry: Near pivot on pullback
    SL: Below/above the pullback low/high
    Target: Previous high/low extension
    """
    trades = []
    ema20 = calc_ema([c["close"] for c in candles], 20)
    
    for i in range(21, len(candles)):
        prev = candles[i-1]
        today = candles[i]
        
        # Approximate VWAP as pivot of previous day
        vwap_approx = (prev["high"] + prev["low"] + prev["close"]) / 3
        
        # Uptrend: price above EMA20 and pullback to VWAP
        if today["close"] > ema20[i] and today["low"] <= vwap_approx + 15 and today["close"] > vwap_approx:
            entry = vwap_approx
            sl = today["low"] - 10
            sl_pts = entry - sl
            target_pts = sl_pts * 2.5
            target = entry + target_pts
            
            if sl_pts > 10 and sl_pts < 80:
                if today["high"] >= target:
                    pnl = target_pts
                elif today["low"] <= sl:
                    pnl = -sl_pts
                else:
                    pnl = today["close"] - entry
                
                trades.append(Trade(
                    entry_date=today["date"], direction="LONG",
                    entry_price=entry, exit_price=entry + pnl,
                    pnl_pts=pnl, strategy="VWAPPullback",
                    sl_pts=sl_pts, target_pts=target_pts
                ))
        
        # Downtrend: price below EMA20 and rally to VWAP
        elif today["close"] < ema20[i] and today["high"] >= vwap_approx - 15 and today["close"] < vwap_approx:
            entry = vwap_approx
            sl = today["high"] + 10
            sl_pts = sl - entry
            target_pts = sl_pts * 2.5
            target = entry - target_pts
            
            if sl_pts > 10 and sl_pts < 80:
                if today["low"] <= target:
                    pnl = target_pts
                elif today["high"] >= sl:
                    pnl = -sl_pts
                else:
                    pnl = entry - today["close"]
                
                trades.append(Trade(
                    entry_date=today["date"], direction="SHORT",
                    entry_price=entry, exit_price=entry - pnl,
                    pnl_pts=pnl, strategy="VWAPPullback",
                    sl_pts=sl_pts, target_pts=target_pts
                ))
    
    return trades

# ── Failed Breakout Strategy ──────────────────────────────────────────────────

def backtest_failed_breakout(candles: list) -> List[Trade]:
    """
    Failed Breakout: Price breaks above/below prev high/low but REVERSES back
    This is a mean-reversion play
    Entry: When price breaks above prev high then falls back below it
    SL: Above the false breakout high
    Target: Pivot or previous close
    """
    trades = []
    
    for i in range(2, len(candles)):
        prev = candles[i-1]
        today = candles[i]
        
        # Failed breakout above: high > prev high but close < prev high
        if today["high"] > prev["high"] + 5 and today["close"] < prev["high"]:
            entry = prev["high"]
            sl = today["high"] + 10
            sl_pts = sl - entry
            target = (prev["high"] + prev["low"] + prev["close"]) / 3  # pivot
            target_pts = entry - target
            
            if target_pts > 10 and sl_pts < 60:
                if today["low"] <= target:
                    pnl = target_pts
                elif today["high"] >= sl:
                    pnl = -sl_pts
                else:
                    pnl = entry - today["close"]
                
                trades.append(Trade(
                    entry_date=today["date"], direction="SHORT",
                    entry_price=entry, exit_price=entry - pnl,
                    pnl_pts=pnl, strategy="FailedBreakout",
                    sl_pts=sl_pts, target_pts=target_pts
                ))
        
        # Failed breakout below: low < prev low but close > prev low
        elif today["low"] < prev["low"] - 5 and today["close"] > prev["low"]:
            entry = prev["low"]
            sl = today["low"] - 10
            sl_pts = entry - sl
            target = (prev["high"] + prev["low"] + prev["close"]) / 3
            target_pts = target - entry
            
            if target_pts > 10 and sl_pts < 60:
                if today["high"] >= target:
                    pnl = target_pts
                elif today["low"] <= sl:
                    pnl = -sl_pts
                else:
                    pnl = today["close"] - entry
                
                trades.append(Trade(
                    entry_date=today["date"], direction="LONG",
                    entry_price=entry, exit_price=entry + pnl,
                    pnl_pts=pnl, strategy="FailedBreakout",
                    sl_pts=sl_pts, target_pts=target_pts
                ))
    
    return trades

# ── Supertrend Strategy ───────────────────────────────────────────────────────

def backtest_supertrend(candles: list) -> List[Trade]:
    """
    Supertrend: Buy when trend flips to bullish, sell when flips to bearish
    ATR period=10, multiplier=3.0
    """
    trades = []
    st = calc_supertrend(candles, 10, 3.0)
    atrs = calc_atr(candles, 10)
    
    for i in range(12, len(candles)):
        if st[i]["trend"] != st[i-1]["trend"] and st[i]["trend"] != 0:
            today = candles[i]
            atr = atrs[i] if atrs[i] > 0 else 50
            
            if st[i]["trend"] == 1:  # Bullish flip
                entry = today["close"]
                sl_pts = atr * 1.5
                target_pts = atr * 2.5
            else:  # Bearish flip
                entry = today["close"]
                sl_pts = atr * 1.5
                target_pts = atr * 2.5
            
            # Look ahead to next flip or end
            exit_price = entry
            for j in range(i+1, min(i+10, len(candles))):
                if st[j]["trend"] != st[i]["trend"]:
                    exit_price = candles[j]["close"]
                    break
                exit_price = candles[j]["close"]
            
            if st[i]["trend"] == 1:
                pnl = exit_price - entry
            else:
                pnl = entry - exit_price
            
            # Cap P&L at target/SL
            if pnl > target_pts:
                pnl = target_pts
            elif pnl < -sl_pts:
                pnl = -sl_pts
            
            trades.append(Trade(
                entry_date=today["date"],
                direction="LONG" if st[i]["trend"] == 1 else "SHORT",
                entry_price=entry, exit_price=entry + pnl if st[i]["trend"] == 1 else entry - pnl,
                pnl_pts=pnl, strategy="Supertrend",
                sl_pts=sl_pts, target_pts=target_pts
            ))
    
    return trades

# ── Adaptive Regime Filter ────────────────────────────────────────────────────

def apply_regime_filter(trades: List[Trade], candles: list, adx_threshold: float = 25.0) -> Tuple[List[Trade], List[Trade]]:
    """
    Apply ADX-based regime filter:
    - ADX > threshold → Trending market → Allow Supertrend, Breakout
    - ADX < threshold → Choppy market → Allow VWAP Pullback, Failed Breakout, CPR
    
    Returns: (filtered_trades, rejected_trades)
    """
    adx_values = calc_adx(candles)
    
    # Build date->ADX lookup
    date_adx = {}
    for i, c in enumerate(candles):
        date_adx[c["date"]] = adx_values[i]
    
    # Trending strategies (work when ADX > threshold)
    trending_strategies = {"Supertrend", "Breakout"}
    # Choppy/mean-reversion strategies (work when ADX < threshold)
    choppy_strategies = {"VWAPPullback", "FailedBreakout", "CPR"}
    
    filtered = []
    rejected = []
    
    for t in trades:
        adx = date_adx.get(t.entry_date, 0)
        
        if t.strategy in trending_strategies:
            if adx >= adx_threshold:
                filtered.append(t)
            else:
                rejected.append(t)
        elif t.strategy in choppy_strategies:
            if adx < adx_threshold:
                filtered.append(t)
            else:
                rejected.append(t)
        else:
            filtered.append(t)  # Unknown strategy — keep
    
    return filtered, rejected

# ── Results Calculation ───────────────────────────────────────────────────────

def calc_metrics(trades: List[Trade]) -> dict:
    """Calculate backtest metrics"""
    if not trades:
        return {"trades": 0, "win_rate": 0, "pf": 0, "total_pnl": 0, "avg_win": 0, "avg_loss": 0, "max_dd": 0}
    
    wins = [t for t in trades if t.pnl_pts > 0]
    losses = [t for t in trades if t.pnl_pts <= 0]
    
    total_win = sum(t.pnl_pts for t in wins)
    total_loss = abs(sum(t.pnl_pts for t in losses))
    
    # Max drawdown
    equity = 0
    peak = 0
    max_dd = 0
    for t in trades:
        equity += t.pnl_pts
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd
    
    return {
        "trades": len(trades),
        "win_rate": len(wins) / len(trades) * 100 if trades else 0,
        "pf": total_win / total_loss if total_loss > 0 else float('inf'),
        "total_pnl": sum(t.pnl_pts for t in trades),
        "avg_win": total_win / len(wins) if wins else 0,
        "avg_loss": -total_loss / len(losses) if losses else 0,
        "max_dd": max_dd
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 80)
    print("BACKTEST: CPR + Adaptive Regime Filter on NIFTY 50")
    print("Period: May 4 - Jul 20, 2026 (54 trading days)")
    print("=" * 80)
    
    # Fetch data
    print("\nFetching NIFTY 50 daily candles from Upstox...")
    candles = fetch_nifty_daily()
    print(f"Got {len(candles)} daily candles: {candles[0]['date']} to {candles[-1]['date']}")
    
    # Run all strategies
    print("\nRunning backtests...")
    
    cpr_trades = backtest_cpr(candles)
    breakout_trades = backtest_breakout(candles)
    vwap_trades = backtest_vwap_pullback(candles)
    failed_bo_trades = backtest_failed_breakout(candles)
    supertrend_trades = backtest_supertrend(candles)
    
    # ── SECTION 1: CPR Standalone Results ─────────────────────────────────────
    print("\n" + "=" * 80)
    print("SECTION 1: CPR (Central Pivot Range) — STANDALONE RESULTS")
    print("=" * 80)
    
    cpr_metrics = calc_metrics(cpr_trades)
    print(f"\n| Strategy | Trades | Win Rate | Profit Factor | Total P&L | Avg Win | Avg Loss | Max DD |")
    print(f"|----------|--------|----------|---------------|-----------|---------|----------|--------|")
    print(f"| CPR      | {cpr_metrics['trades']:>6} | {cpr_metrics['win_rate']:>6.1f}% | {cpr_metrics['pf']:>13.2f} | {cpr_metrics['total_pnl']:>+8.1f} | {cpr_metrics['avg_win']:>+6.1f} | {cpr_metrics['avg_loss']:>+7.1f} | {cpr_metrics['max_dd']:>5.1f} |")
    
    # Show individual CPR trades
    print(f"\nCPR Trade Details:")
    for t in cpr_trades:
        result = "WIN" if t.pnl_pts > 0 else "LOSS"
        print(f"  {t.entry_date} | {t.direction:5} | Entry: {t.entry_price:.1f} | Exit: {t.exit_price:.1f} | P&L: {t.pnl_pts:+.1f} pts | {result}")
    
    # ── SECTION 2: All Strategies Comparison ──────────────────────────────────
    print("\n" + "=" * 80)
    print("SECTION 2: ALL STRATEGIES — HEAD-TO-HEAD COMPARISON")
    print("=" * 80)
    
    all_strategies = {
        "CPR": cpr_trades,
        "Breakout": breakout_trades,
        "VWAPPullback": vwap_trades,
        "FailedBreakout": failed_bo_trades,
        "Supertrend": supertrend_trades,
    }
    
    print(f"\n| Strategy       | Trades | Win Rate | Profit Factor | Total P&L | Avg Win | Avg Loss | Max DD |")
    print(f"|----------------|--------|----------|---------------|-----------|---------|----------|--------|")
    for name, trades in all_strategies.items():
        m = calc_metrics(trades)
        print(f"| {name:<14} | {m['trades']:>6} | {m['win_rate']:>6.1f}% | {m['pf']:>13.2f} | {m['total_pnl']:>+8.1f} | {m['avg_win']:>+6.1f} | {m['avg_loss']:>+7.1f} | {m['max_dd']:>5.1f} |")
    
    # ── SECTION 3: Adaptive Regime Filter ─────────────────────────────────────
    print("\n" + "=" * 80)
    print("SECTION 3: ADAPTIVE REGIME FILTER (ADX > 25 = Trending)")
    print("=" * 80)
    
    # Combine the 4 winning strategies
    winners_no_filter = breakout_trades + vwap_trades + failed_bo_trades + cpr_trades
    winners_no_filter.sort(key=lambda t: t.entry_date)
    
    # Apply regime filter to all trades combined
    all_trades_combined = breakout_trades + vwap_trades + failed_bo_trades + cpr_trades + supertrend_trades
    all_trades_combined.sort(key=lambda t: t.entry_date)
    
    filtered_trades, rejected_trades = apply_regime_filter(all_trades_combined, candles, adx_threshold=25.0)
    
    # Also filter just the 4 winners
    winners_filtered, winners_rejected = apply_regime_filter(winners_no_filter, candles, adx_threshold=25.0)
    
    m_no_filter = calc_metrics(winners_no_filter)
    m_with_filter = calc_metrics(winners_filtered)
    m_all_filtered = calc_metrics(filtered_trades)
    m_all_no_filter = calc_metrics(all_trades_combined)
    
    print(f"\n4 Winners (Breakout + VWAP + FailedBO + CPR):")
    print(f"| Mode             | Trades | Win Rate | Profit Factor | Total P&L | Avg Win | Avg Loss | Max DD |")
    print(f"|------------------|--------|----------|---------------|-----------|---------|----------|--------|")
    print(f"| WITHOUT filter   | {m_no_filter['trades']:>6} | {m_no_filter['win_rate']:>6.1f}% | {m_no_filter['pf']:>13.2f} | {m_no_filter['total_pnl']:>+8.1f} | {m_no_filter['avg_win']:>+6.1f} | {m_no_filter['avg_loss']:>+7.1f} | {m_no_filter['max_dd']:>5.1f} |")
    print(f"| WITH regime      | {m_with_filter['trades']:>6} | {m_with_filter['win_rate']:>6.1f}% | {m_with_filter['pf']:>13.2f} | {m_with_filter['total_pnl']:>+8.1f} | {m_with_filter['avg_win']:>+6.1f} | {m_with_filter['avg_loss']:>+7.1f} | {m_with_filter['max_dd']:>5.1f} |")
    print(f"| Rejected trades  | {len(winners_rejected):>6} |")
    
    print(f"\nAll 5 Strategies (including Supertrend):")
    print(f"| Mode             | Trades | Win Rate | Profit Factor | Total P&L | Avg Win | Avg Loss | Max DD |")
    print(f"|------------------|--------|----------|---------------|-----------|---------|----------|--------|")
    print(f"| WITHOUT filter   | {m_all_no_filter['trades']:>6} | {m_all_no_filter['win_rate']:>6.1f}% | {m_all_no_filter['pf']:>13.2f} | {m_all_no_filter['total_pnl']:>+8.1f} | {m_all_no_filter['avg_win']:>+6.1f} | {m_all_no_filter['avg_loss']:>+7.1f} | {m_all_no_filter['max_dd']:>5.1f} |")
    print(f"| WITH regime      | {m_all_filtered['trades']:>6} | {m_all_filtered['win_rate']:>6.1f}% | {m_all_filtered['pf']:>13.2f} | {m_all_filtered['total_pnl']:>+8.1f} | {m_all_filtered['avg_win']:>+6.1f} | {m_all_filtered['avg_loss']:>+7.1f} | {m_all_filtered['max_dd']:>5.1f} |")
    print(f"| Rejected trades  | {len(rejected_trades):>6} |")
    
    # ── SECTION 4: ADX Values per Day ─────────────────────────────────────────
    print("\n" + "=" * 80)
    print("SECTION 4: DAILY ADX VALUES (for reference)")
    print("=" * 80)
    
    adx_values = calc_adx(candles)
    print(f"\n| Date       | Close   | ADX   | Regime    |")
    print(f"|------------|---------|-------|-----------|")
    for i in range(max(0, len(candles)-20), len(candles)):
        c = candles[i]
        adx = adx_values[i]
        regime = "TRENDING" if adx >= 25 else "CHOPPY"
        print(f"| {c['date']} | {c['close']:>7.1f} | {adx:>5.1f} | {regime:<9} |")
    
    # ── SECTION 5: VERDICT ────────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print("VERDICT")
    print("=" * 80)
    
    print(f"\nCPR Strategy:")
    if cpr_metrics['total_pnl'] > 0 and cpr_metrics['pf'] > 1.0:
        print(f"  ✅ PROFITABLE: P&L = {cpr_metrics['total_pnl']:+.1f} pts, PF = {cpr_metrics['pf']:.2f}")
        print(f"  → RECOMMENDATION: ENABLE as live strategy layer")
    else:
        print(f"  ❌ NOT PROFITABLE: P&L = {cpr_metrics['total_pnl']:+.1f} pts, PF = {cpr_metrics['pf']:.2f}")
        print(f"  → RECOMMENDATION: Keep in code but DISABLED")
    
    print(f"\nAdaptive Regime Filter:")
    improvement = m_with_filter['total_pnl'] - m_no_filter['total_pnl']
    if m_with_filter['pf'] > m_no_filter['pf']:
        print(f"  ✅ IMPROVES results: PF {m_no_filter['pf']:.2f} → {m_with_filter['pf']:.2f}")
        print(f"     P&L change: {improvement:+.1f} pts")
        print(f"     Trades reduced: {m_no_filter['trades']} → {m_with_filter['trades']} ({len(winners_rejected)} filtered out)")
        print(f"  → RECOMMENDATION: ENABLE adaptive regime switching")
    else:
        print(f"  ⚠️  NO IMPROVEMENT: PF {m_no_filter['pf']:.2f} → {m_with_filter['pf']:.2f}")
        print(f"     P&L change: {improvement:+.1f} pts")
        print(f"  → RECOMMENDATION: Keep regime filter DISABLED or adjust threshold")

if __name__ == "__main__":
    main()
