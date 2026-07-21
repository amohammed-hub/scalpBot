"""
Adeeb Strategy Backtest V2 — Optimized Parameters

Changes from V1:
- ADX threshold: 25 (was 20) — stronger trend filter
- Anti-chase: 0.2% (was 0.3%) — tighter pullback requirement
- Renko exit: require 2 opposite bricks (was 1) — less whipsaw
- Min confidence: 0.75 (was 0.70) — higher quality bar
- Added: RSI filter (40-60 zone = skip, too neutral)
- Added: Time filter (skip first 30 min and last 30 min)
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json

print("Fetching NIFTY 50 data from Yahoo Finance (5-min interval, ~60 days)...")
end_date = datetime.now()
start_date = end_date - timedelta(days=59)

ticker = yf.Ticker("^NSEI")
df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="5m")

if df.empty:
    print("ERROR: No data. Exiting.")
    exit(1)

print(f"Data: {len(df)} candles | {df.index[0]} to {df.index[-1]}")
print(f"Trading days: {df.index.normalize().nunique()}")

# ── Indicators ────────────────────────────────────────────────────────────────

def calc_ema(values, period):
    if len(values) < period:
        return values.tolist()
    k = 2 / (period + 1)
    ema_vals = [np.mean(values[:period])]
    for i in range(period, len(values)):
        ema_vals.append(values[i] * k + ema_vals[-1] * (1 - k))
    return ema_vals

def calc_atr(highs, lows, closes, period=14):
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return np.mean(trs[-period:]) if len(trs) >= period else (np.mean(trs) if trs else 0)

def calc_adx(highs, lows, closes, period=14):
    if len(closes) < period * 2:
        return 0
    plus_dm, minus_dm, trs = [], [], []
    for i in range(1, len(closes)):
        up = highs[i] - highs[i-1]
        down = lows[i-1] - lows[i]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    if len(trs) < period:
        return 0
    atr_s = np.mean(trs[:period])
    plus_s = np.mean(plus_dm[:period])
    minus_s = np.mean(minus_dm[:period])
    dx_values = []
    for i in range(period, len(trs)):
        atr_s = (atr_s * (period - 1) + trs[i]) / period
        plus_s = (plus_s * (period - 1) + plus_dm[i]) / period
        minus_s = (minus_s * (period - 1) + minus_dm[i]) / period
        if atr_s == 0: continue
        plus_di = 100 * plus_s / atr_s
        minus_di = 100 * minus_s / atr_s
        denom = plus_di + minus_di
        dx_values.append(100 * abs(plus_di - minus_di) / denom if denom > 0 else 0)
    return np.mean(dx_values[-period:]) if len(dx_values) >= period else (np.mean(dx_values) if dx_values else 0)

def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(diff if diff > 0 else 0)
        losses.append(-diff if diff < 0 else 0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def build_renko_bricks(closes, brick_size):
    if len(closes) < 2 or brick_size <= 0:
        return []
    bricks = []
    base = closes[0]
    for price in closes[1:]:
        while price >= base + brick_size:
            bricks.append({"color": "green"})
            base += brick_size
        while price <= base - brick_size:
            bricks.append({"color": "red"})
            base -= brick_size
    return bricks

# ── Backtest ──────────────────────────────────────────────────────────────────

df['date'] = df.index.date
df['time'] = df.index.time
trading_days = sorted(df['date'].unique())
print(f"\nBacktesting OPTIMIZED Adeeb strategy across {len(trading_days)} days...")

# OPTIMIZED PARAMETERS
ADX_MIN = 25          # was 20
ANTI_CHASE_PCT = 0.002  # was 0.003 (0.2% instead of 0.3%)
MIN_CONFIDENCE = 0.75   # was 0.70
RENKO_EXIT_BRICKS = 2   # was 1 (need 2 opposite bricks to exit)
MAX_HOLD_CANDLES = 4    # 4 × 5min = 20 min
TARGET_MULT = 2.0       # ATR multiplier for target
SL_MULT = 1.2           # ATR multiplier for SL (tighter)
SKIP_FIRST_CANDLES = 6  # Skip first 30 min (6 × 5min)
SKIP_LAST_CANDLES = 6   # Skip last 30 min

trades = []
total_signals = 0
rejected_reasons = {}

for day_idx in range(1, len(trading_days)):
    today = trading_days[day_idx]
    yesterday = trading_days[day_idx - 1]
    
    prev_day_data = df[df['date'] == yesterday]
    if prev_day_data.empty:
        continue
    prev_high = prev_day_data['High'].max()
    prev_low = prev_day_data['Low'].min()
    prev_close = prev_day_data['Close'].iloc[-1]
    
    pivot = (prev_high + prev_low + prev_close) / 3
    bc = (prev_high + prev_low) / 2
    tc = 2 * pivot - bc
    
    today_data = df[df['date'] == today].copy()
    if len(today_data) < 30:
        continue
    
    closes = today_data['Close'].values
    highs = today_data['High'].values
    lows = today_data['Low'].values
    volumes = today_data['Volume'].values
    
    open_trade = None
    candles_held = 0
    daily_trades = 0
    MAX_DAILY_TRADES = 2  # Max 2 trades per day (quality over quantity)
    
    for i in range(SKIP_FIRST_CANDLES, len(closes) - SKIP_LAST_CANDLES):
        price = closes[i]
        
        if open_trade is not None:
            candles_held += 1
            should_exit = False
            exit_reason = ""
            
            # Max hold
            if candles_held >= MAX_HOLD_CANDLES:
                should_exit = True
                exit_reason = "Max hold (20 min)"
            
            # SL
            if open_trade['direction'] == 'BUY' and price <= open_trade['sl']:
                should_exit = True
                exit_reason = "Stop Loss"
            elif open_trade['direction'] == 'SELL' and price >= open_trade['sl']:
                should_exit = True
                exit_reason = "Stop Loss"
            
            # Target
            if open_trade['direction'] == 'BUY' and price >= open_trade['target']:
                should_exit = True
                exit_reason = "Target hit"
            elif open_trade['direction'] == 'SELL' and price <= open_trade['target']:
                should_exit = True
                exit_reason = "Target hit"
            
            # EMA cloud break
            if i >= 21 and not should_exit:
                ema9_v = calc_ema(closes[:i+1], 9)
                ema21_v = calc_ema(closes[:i+1], 21)
                if ema9_v and ema21_v:
                    ct = max(ema9_v[-1], ema21_v[-1])
                    cb = min(ema9_v[-1], ema21_v[-1])
                    if open_trade['direction'] == 'BUY' and price < cb:
                        should_exit = True
                        exit_reason = "EMA cloud break"
                    elif open_trade['direction'] == 'SELL' and price > ct:
                        should_exit = True
                        exit_reason = "EMA cloud break"
            
            # Opposite Renko (need 2 consecutive opposite bricks)
            if i >= 14 and not should_exit:
                atr_v = calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], 14)
                if atr_v > 0:
                    bricks = build_renko_bricks(closes[:i+1], atr_v)
                    if len(bricks) >= 2:
                        last2 = bricks[-2:]
                        if open_trade['direction'] == 'BUY' and all(b['color'] == 'red' for b in last2):
                            should_exit = True
                            exit_reason = "2 opposite Renko bricks"
                        elif open_trade['direction'] == 'SELL' and all(b['color'] == 'green' for b in last2):
                            should_exit = True
                            exit_reason = "2 opposite Renko bricks"
            
            if should_exit:
                pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
                trades.append({
                    'date': str(today),
                    'direction': open_trade['direction'],
                    'entry': round(open_trade['entry'], 2),
                    'exit': round(price, 2),
                    'pnl_pts': round(pnl, 2),
                    'pnl_pct': round(pnl / open_trade['entry'] * 100, 4),
                    'candles_held': candles_held,
                    'exit_reason': exit_reason,
                    'confidence': open_trade['confidence'],
                })
                open_trade = None
                candles_held = 0
            continue
        
        # ── Entry Logic ──
        if daily_trades >= MAX_DAILY_TRADES:
            continue
        if i < 21:
            continue
        
        # STEP 1: ADX
        adx = calc_adx(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        if adx < ADX_MIN:
            continue
        
        # STEP 2: CPR bias
        is_bullish = price > tc
        is_bearish = price < bc
        if not is_bullish and not is_bearish:
            continue
        
        # STEP 3: Renko
        atr_v = calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        if atr_v <= 0:
            continue
        bricks = build_renko_bricks(closes[:i+1], atr_v)
        if len(bricks) < 3:
            continue
        
        last_color = bricks[-1]['color']
        consecutive = 0
        for b in reversed(bricks):
            if b['color'] == last_color:
                consecutive += 1
            else:
                break
        
        renko_up = last_color == 'green' and consecutive >= 3
        renko_down = last_color == 'red' and consecutive >= 3
        if not renko_up and not renko_down:
            continue
        
        # STEP 4: Agreement
        if renko_up and not is_bullish:
            continue
        if renko_down and not is_bearish:
            continue
        
        # STEP 5: EMA cloud
        ema9_v = calc_ema(closes[:i+1], 9)
        ema21_v = calc_ema(closes[:i+1], 21)
        if not ema9_v or not ema21_v:
            continue
        
        ema9 = ema9_v[-1]
        ema21 = ema21_v[-1]
        cloud_top = max(ema9, ema21)
        cloud_bottom = min(ema9, ema21)
        
        total_signals += 1
        
        # RSI filter — skip neutral zone
        rsi = calc_rsi(closes[:i+1], 14)
        
        if renko_up:
            if ema9 < ema21:
                rejected_reasons['EMA bearish'] = rejected_reasons.get('EMA bearish', 0) + 1
                continue
            dist = (price - cloud_top) / price
            if dist > ANTI_CHASE_PCT:
                rejected_reasons['Anti-chase'] = rejected_reasons.get('Anti-chase', 0) + 1
                continue
            if price < cloud_bottom:
                rejected_reasons['Below cloud'] = rejected_reasons.get('Below cloud', 0) + 1
                continue
            if rsi < 45:  # RSI should confirm bullish
                rejected_reasons['RSI weak'] = rejected_reasons.get('RSI weak', 0) + 1
                continue
            
            confidence = 0.72
            if adx > 30: confidence += 0.08
            elif adx > 25: confidence += 0.05
            if consecutive >= 4: confidence += 0.04
            if consecutive >= 5: confidence += 0.03
            if rsi > 55 and rsi < 75: confidence += 0.03
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5:
                    confidence += 0.08
            confidence = min(0.95, confidence)
            
            if confidence < MIN_CONFIDENCE:
                rejected_reasons['Low confidence'] = rejected_reasons.get('Low confidence', 0) + 1
                continue
            
            sl = cloud_bottom - atr_v * 0.3
            target = price + atr_v * TARGET_MULT
            open_trade = {'direction': 'BUY', 'entry': price, 'sl': sl, 'target': target, 'confidence': round(confidence, 3)}
            candles_held = 0
            daily_trades += 1
        
        elif renko_down:
            if ema9 > ema21:
                rejected_reasons['EMA bullish'] = rejected_reasons.get('EMA bullish', 0) + 1
                continue
            dist = (cloud_bottom - price) / price
            if dist > ANTI_CHASE_PCT:
                rejected_reasons['Anti-chase'] = rejected_reasons.get('Anti-chase', 0) + 1
                continue
            if price > cloud_top:
                rejected_reasons['Above cloud'] = rejected_reasons.get('Above cloud', 0) + 1
                continue
            if rsi > 55:  # RSI should confirm bearish
                rejected_reasons['RSI weak'] = rejected_reasons.get('RSI weak', 0) + 1
                continue
            
            confidence = 0.72
            if adx > 30: confidence += 0.08
            elif adx > 25: confidence += 0.05
            if consecutive >= 4: confidence += 0.04
            if consecutive >= 5: confidence += 0.03
            if rsi < 45 and rsi > 25: confidence += 0.03
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5:
                    confidence += 0.08
            confidence = min(0.95, confidence)
            
            if confidence < MIN_CONFIDENCE:
                rejected_reasons['Low confidence'] = rejected_reasons.get('Low confidence', 0) + 1
                continue
            
            sl = cloud_top + atr_v * 0.3
            target = price - atr_v * TARGET_MULT
            open_trade = {'direction': 'SELL', 'entry': price, 'sl': sl, 'target': target, 'confidence': round(confidence, 3)}
            candles_held = 0
            daily_trades += 1
    
    # EOD close
    if open_trade is not None:
        price = closes[-1]
        pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
        trades.append({
            'date': str(today), 'direction': open_trade['direction'],
            'entry': round(open_trade['entry'], 2), 'exit': round(price, 2),
            'pnl_pts': round(pnl, 2), 'pnl_pct': round(pnl / open_trade['entry'] * 100, 4),
            'candles_held': candles_held, 'exit_reason': 'End of day',
            'confidence': open_trade['confidence'],
        })
        open_trade = None

# ── Results ───────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("⚡ ADEEB STRATEGY BACKTEST V2 — OPTIMIZED")
print("="*70)
print(f"Data: NIFTY 50 (^NSEI) | 5-min | {len(trading_days)} days")
print(f"Period: {trading_days[0]} to {trading_days[-1]}")
print(f"Parameters: ADX>{ADX_MIN} | Anti-chase<{ANTI_CHASE_PCT*100}% | MinConf>{MIN_CONFIDENCE} | RenkoExit={RENKO_EXIT_BRICKS} bricks")
print("-"*70)

if not trades:
    print("NO TRADES. Strategy too restrictive.")
    print(f"Signals: {total_signals} | Rejected reasons: {rejected_reasons}")
else:
    wins = [t for t in trades if t['pnl_pts'] > 0]
    losses = [t for t in trades if t['pnl_pts'] <= 0]
    
    total_pnl = sum(t['pnl_pts'] for t in trades)
    gross_profit = sum(t['pnl_pts'] for t in wins)
    gross_loss = abs(sum(t['pnl_pts'] for t in losses))
    
    win_rate = len(wins) / len(trades) * 100
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
    avg_win = np.mean([t['pnl_pts'] for t in wins]) if wins else 0
    avg_loss = np.mean([t['pnl_pts'] for t in losses]) if losses else 0
    max_win = max(t['pnl_pts'] for t in trades)
    max_loss = min(t['pnl_pts'] for t in trades)
    avg_hold = np.mean([t['candles_held'] for t in trades])
    avg_conf = np.mean([t['confidence'] for t in trades])
    
    cumulative = np.cumsum([t['pnl_pts'] for t in trades])
    peak = np.maximum.accumulate(cumulative)
    max_dd = np.max(peak - cumulative)
    
    trades_per_day = len(trades) / len(trading_days)
    
    print(f"Total Trades:       {len(trades)}")
    print(f"Winners:            {len(wins)} ({win_rate:.1f}%)")
    print(f"Losers:             {len(losses)} ({100-win_rate:.1f}%)")
    print(f"")
    print(f"Total P&L:          {total_pnl:+.2f} pts")
    print(f"Gross Profit:       +{gross_profit:.2f} pts")
    print(f"Gross Loss:         -{gross_loss:.2f} pts")
    print(f"Profit Factor:      {profit_factor:.2f}")
    print(f"")
    print(f"Avg Win:            +{avg_win:.2f} pts")
    print(f"Avg Loss:           {avg_loss:.2f} pts")
    print(f"Max Win:            +{max_win:.2f} pts")
    print(f"Max Loss:           {max_loss:.2f} pts")
    print(f"Max Drawdown:       {max_dd:.2f} pts")
    print(f"")
    print(f"Avg Hold:           {avg_hold:.1f} candles ({avg_hold*5:.0f} min)")
    print(f"Avg Confidence:     {avg_conf:.3f}")
    print(f"Trades/Day:         {trades_per_day:.2f}")
    print(f"Signals Generated:  {total_signals}")
    print("-"*70)
    
    from collections import Counter
    print("\nExit Reasons:")
    for reason, count in Counter(t['exit_reason'] for t in trades).most_common():
        rpnl = sum(t['pnl_pts'] for t in trades if t['exit_reason'] == reason)
        rwr = len([t for t in trades if t['exit_reason'] == reason and t['pnl_pts'] > 0]) / count * 100
        print(f"  {reason:25s} {count:3d} trades | P&L: {rpnl:+.2f} pts | WR: {rwr:.0f}%")
    
    print("\nRejection Reasons:")
    for reason, count in sorted(rejected_reasons.items(), key=lambda x: -x[1]):
        print(f"  {reason:20s} {count}")
    
    print("\nDirection:")
    buys = [t for t in trades if t['direction'] == 'BUY']
    sells = [t for t in trades if t['direction'] == 'SELL']
    print(f"  BUY:  {len(buys)} | P&L: {sum(t['pnl_pts'] for t in buys):+.2f} | WR: {len([t for t in buys if t['pnl_pts']>0])/max(1,len(buys))*100:.0f}%")
    print(f"  SELL: {len(sells)} | P&L: {sum(t['pnl_pts'] for t in sells):+.2f} | WR: {len([t for t in sells if t['pnl_pts']>0])/max(1,len(sells))*100:.0f}%")
    
    # Daily P&L
    daily_pnl = {}
    for t in trades:
        daily_pnl[t['date']] = daily_pnl.get(t['date'], 0) + t['pnl_pts']
    profitable_days = sum(1 for p in daily_pnl.values() if p > 0)
    print(f"\n  Profitable Days: {profitable_days}/{len(daily_pnl)} ({profitable_days/max(1,len(daily_pnl))*100:.0f}%)")
    
    # PASS/FAIL check
    print("\n" + "="*70)
    pf_pass = "✅" if profit_factor >= 1.5 else "❌"
    wr_pass = "✅" if win_rate >= 55 else "❌"
    print(f"  Profit Factor: {profit_factor:.2f} (target ≥ 1.5) {pf_pass}")
    print(f"  Win Rate:      {win_rate:.1f}% (target ≥ 55%) {wr_pass}")
    print(f"  Trades/Day:    {trades_per_day:.2f} (target < 3 = selective)")
    print("="*70)
    
    # Save
    results = {
        "strategy": "Adeeb_V2_Optimized",
        "period": f"{trading_days[0]} to {trading_days[-1]}",
        "trading_days": len(trading_days),
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2),
        "total_pnl_pts": round(total_pnl, 2),
        "max_drawdown": round(max_dd, 2),
        "avg_hold_min": round(avg_hold * 5, 0),
        "trades_per_day": round(trades_per_day, 2),
        "profitable_days_pct": round(profitable_days/max(1,len(daily_pnl))*100, 0),
        "parameters": {
            "adx_min": ADX_MIN,
            "anti_chase_pct": ANTI_CHASE_PCT,
            "min_confidence": MIN_CONFIDENCE,
            "renko_exit_bricks": RENKO_EXIT_BRICKS,
            "max_hold_candles": MAX_HOLD_CANDLES,
            "target_mult": TARGET_MULT,
            "sl_mult": SL_MULT,
            "max_daily_trades": MAX_DAILY_TRADES,
        },
        "trades": trades,
    }
    with open("backtest_adeeb_v2_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to backtest_adeeb_v2_results.json")
