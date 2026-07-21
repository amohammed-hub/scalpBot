"""
Adeeb Strategy Backtest — Using Yahoo Finance NIFTY 50 data

Strategy Rules:
1. ADX > 20 (trending regime)
2. CPR daily bias (price > TC = bullish, price < BC = bearish)
3. Renko 3+ consecutive same-color bricks (trend confirmation)
4. EMA(9/21) cloud — price must be on correct side AND pulled back to cloud (anti-chase: max 0.3%)
5. Entry on bounce off cloud in trend direction

Exit Rules:
- Opposite Renko brick forms
- Price closes on wrong side of EMA cloud
- Max hold: 20 candles (simulating 20 minutes)
- Premium target: +40% (simulated as +2.5*ATR for index)
- Premium SL: -30% (simulated as cloud bottom - 0.3*ATR)

Data: Yahoo Finance ^NSEI (NIFTY 50) — 5-minute interval, last 56 trading days
(Yahoo only provides 1-min data for 7 days, so we use 5-min for longer backtest)
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json

# ── Fetch Data ────────────────────────────────────────────────────────────────
print("Fetching NIFTY 50 data from Yahoo Finance (5-min interval, ~60 days)...")

# Yahoo Finance allows max 60 days of 5-min data
end_date = datetime.now()
start_date = end_date - timedelta(days=59)

ticker = yf.Ticker("^NSEI")
df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="5m")

if df.empty:
    print("ERROR: No data returned from Yahoo Finance. Trying alternative ticker...")
    ticker = yf.Ticker("NIFTY_50.NS")
    df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="5m")

if df.empty:
    print("ERROR: Still no data. Trying ^NSEBANK...")
    ticker = yf.Ticker("^NSEBANK")
    df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="5m")

print(f"Data fetched: {len(df)} candles from {df.index[0]} to {df.index[-1]}")
print(f"Trading days: {df.index.normalize().nunique()}")

# ── Indicator Functions ───────────────────────────────────────────────────────

def calc_ema(values, period):
    """Calculate EMA array"""
    ema_vals = []
    k = 2 / (period + 1)
    if len(values) < period:
        return values.tolist()
    sma = np.mean(values[:period])
    ema_vals.append(sma)
    for i in range(period, len(values)):
        val = values[i] * k + ema_vals[-1] * (1 - k)
        ema_vals.append(val)
    return ema_vals

def calc_atr(highs, lows, closes, period=14):
    """Calculate ATR"""
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    if len(trs) < period:
        return np.mean(trs) if trs else 0
    return np.mean(trs[-period:])

def calc_adx(highs, lows, closes, period=14):
    """Calculate ADX"""
    if len(closes) < period * 2:
        return 0
    plus_dm = []
    minus_dm = []
    trs = []
    for i in range(1, len(closes)):
        up = highs[i] - highs[i-1]
        down = lows[i-1] - lows[i]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    
    if len(trs) < period:
        return 0
    
    # Smoothed averages
    atr_smooth = np.mean(trs[:period])
    plus_smooth = np.mean(plus_dm[:period])
    minus_smooth = np.mean(minus_dm[:period])
    
    dx_values = []
    for i in range(period, len(trs)):
        atr_smooth = (atr_smooth * (period - 1) + trs[i]) / period
        plus_smooth = (plus_smooth * (period - 1) + plus_dm[i]) / period
        minus_smooth = (minus_smooth * (period - 1) + minus_dm[i]) / period
        
        if atr_smooth == 0:
            continue
        plus_di = 100 * plus_smooth / atr_smooth
        minus_di = 100 * minus_smooth / atr_smooth
        
        if plus_di + minus_di == 0:
            dx_values.append(0)
        else:
            dx_values.append(100 * abs(plus_di - minus_di) / (plus_di + minus_di))
    
    if len(dx_values) < period:
        return np.mean(dx_values) if dx_values else 0
    return np.mean(dx_values[-period:])

def build_renko_bricks(closes, brick_size):
    """Build Renko bricks from close prices"""
    if len(closes) < 2 or brick_size <= 0:
        return []
    bricks = []
    base_price = closes[0]
    for price in closes[1:]:
        while price >= base_price + brick_size:
            bricks.append({"open": base_price, "close": base_price + brick_size, "color": "green"})
            base_price += brick_size
        while price <= base_price - brick_size:
            bricks.append({"open": base_price, "close": base_price - brick_size, "color": "red"})
            base_price -= brick_size
    return bricks

# ── Backtest Engine ───────────────────────────────────────────────────────────

# Group by trading day
df['date'] = df.index.date
trading_days = sorted(df['date'].unique())
print(f"\nBacktesting Adeeb strategy across {len(trading_days)} trading days...")

trades = []
total_signals = 0
rejected_signals = 0

for day_idx in range(1, len(trading_days)):
    today = trading_days[day_idx]
    yesterday = trading_days[day_idx - 1]
    
    # Get previous day's H/L/C for CPR
    prev_day_data = df[df['date'] == yesterday]
    if prev_day_data.empty:
        continue
    prev_day_high = prev_day_data['High'].max()
    prev_day_low = prev_day_data['Low'].min()
    prev_day_close = prev_day_data['Close'].iloc[-1]
    
    # CPR levels
    pivot = (prev_day_high + prev_day_low + prev_day_close) / 3
    bc = (prev_day_high + prev_day_low) / 2
    tc = 2 * pivot - bc
    
    # Today's candles
    today_data = df[df['date'] == today].copy()
    if len(today_data) < 30:
        continue
    
    closes = today_data['Close'].values
    highs = today_data['High'].values
    lows = today_data['Low'].values
    volumes = today_data['Volume'].values
    
    # Track open trade for this day
    open_trade = None
    candles_held = 0
    
    # Scan each candle (skip first 6 = first 30 min for market to settle)
    for i in range(6, len(closes)):
        price = closes[i]
        
        # If we have an open trade, check exit
        if open_trade is not None:
            candles_held += 1
            
            # Exit conditions
            should_exit = False
            exit_reason = ""
            
            # Max hold: 20 candles (= 100 min for 5-min candles, simulating 20 min for 1-min)
            # For 5-min data, use 4 candles = 20 min equivalent
            if candles_held >= 4:
                should_exit = True
                exit_reason = "Max hold (20 min)"
            
            # SL check
            if open_trade['direction'] == 'BUY' and price <= open_trade['sl']:
                should_exit = True
                exit_reason = "Stop Loss hit"
            elif open_trade['direction'] == 'SELL' and price >= open_trade['sl']:
                should_exit = True
                exit_reason = "Stop Loss hit"
            
            # Target check
            if open_trade['direction'] == 'BUY' and price >= open_trade['target']:
                should_exit = True
                exit_reason = "Target hit"
            elif open_trade['direction'] == 'SELL' and price <= open_trade['target']:
                should_exit = True
                exit_reason = "Target hit"
            
            # EMA cloud break
            if i >= 21:
                ema9_vals = calc_ema(closes[:i+1], 9)
                ema21_vals = calc_ema(closes[:i+1], 21)
                if ema9_vals and ema21_vals:
                    ema9 = ema9_vals[-1]
                    ema21 = ema21_vals[-1]
                    cloud_top = max(ema9, ema21)
                    cloud_bottom = min(ema9, ema21)
                    if open_trade['direction'] == 'BUY' and price < cloud_bottom:
                        should_exit = True
                        exit_reason = "Price below EMA cloud"
                    elif open_trade['direction'] == 'SELL' and price > cloud_top:
                        should_exit = True
                        exit_reason = "Price above EMA cloud"
            
            # Opposite Renko brick
            if i >= 14:
                atr_val = calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], 14)
                if atr_val > 0:
                    bricks = build_renko_bricks(closes[:i+1], atr_val)
                    if bricks:
                        last_brick = bricks[-1]
                        if open_trade['direction'] == 'BUY' and last_brick['color'] == 'red':
                            should_exit = True
                            exit_reason = "Opposite Renko brick (red)"
                        elif open_trade['direction'] == 'SELL' and last_brick['color'] == 'green':
                            should_exit = True
                            exit_reason = "Opposite Renko brick (green)"
            
            if should_exit:
                pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
                pnl_pct = pnl / open_trade['entry'] * 100
                trades.append({
                    'date': str(today),
                    'direction': open_trade['direction'],
                    'entry': open_trade['entry'],
                    'exit': price,
                    'pnl_pts': round(pnl, 2),
                    'pnl_pct': round(pnl_pct, 4),
                    'candles_held': candles_held,
                    'exit_reason': exit_reason,
                    'confidence': open_trade['confidence'],
                })
                open_trade = None
                candles_held = 0
            continue
        
        # No open trade — check for entry signal
        if i < 21:
            continue  # Need enough data for EMA21
        
        # STEP 1: ADX check
        adx = calc_adx(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        if adx < 20:
            continue
        
        # STEP 2: CPR daily bias
        is_bullish = price > tc
        is_bearish = price < bc
        if not is_bullish and not is_bearish:
            continue  # Price inside CPR range
        
        # STEP 3: Renko trend
        atr_val = calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        if atr_val <= 0:
            continue
        bricks = build_renko_bricks(closes[:i+1], atr_val)
        if len(bricks) < 3:
            continue
        
        # Count consecutive same-color bricks from end
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
        
        # STEP 4: Renko must agree with CPR bias
        if renko_up and not is_bullish:
            continue
        if renko_down and not is_bearish:
            continue
        
        # STEP 5: EMA cloud pullback
        ema9_vals = calc_ema(closes[:i+1], 9)
        ema21_vals = calc_ema(closes[:i+1], 21)
        if not ema9_vals or not ema21_vals:
            continue
        
        ema9 = ema9_vals[-1]
        ema21 = ema21_vals[-1]
        cloud_top = max(ema9, ema21)
        cloud_bottom = min(ema9, ema21)
        
        total_signals += 1
        
        if renko_up:
            # Cloud must be bullish (EMA9 > EMA21)
            if ema9 < ema21:
                rejected_signals += 1
                continue
            # Anti-chase: price must be within 0.3% of cloud
            dist = (price - cloud_top) / price
            if dist > 0.003:
                rejected_signals += 1
                continue
            # Price must be above cloud bottom
            if price < cloud_bottom:
                rejected_signals += 1
                continue
            
            # Calculate confidence
            confidence = 0.72
            if adx > 25: confidence += 0.05
            if adx > 30: confidence += 0.03
            if consecutive >= 4: confidence += 0.03
            # Volume boost
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5:
                    confidence += 0.10
            confidence = min(0.95, confidence)
            
            if confidence < 0.70:
                rejected_signals += 1
                continue
            
            # ENTRY: BUY
            sl = cloud_bottom - atr_val * 0.3
            target = price + atr_val * 2.5
            open_trade = {
                'direction': 'BUY',
                'entry': price,
                'sl': sl,
                'target': target,
                'confidence': round(confidence, 3),
            }
            candles_held = 0
        
        elif renko_down:
            # Cloud must be bearish (EMA9 < EMA21)
            if ema9 > ema21:
                rejected_signals += 1
                continue
            # Anti-chase
            dist = (cloud_bottom - price) / price
            if dist > 0.003:
                rejected_signals += 1
                continue
            if price > cloud_top:
                rejected_signals += 1
                continue
            
            confidence = 0.72
            if adx > 25: confidence += 0.05
            if adx > 30: confidence += 0.03
            if consecutive >= 4: confidence += 0.03
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5:
                    confidence += 0.10
            confidence = min(0.95, confidence)
            
            if confidence < 0.70:
                rejected_signals += 1
                continue
            
            # ENTRY: SELL
            sl = cloud_top + atr_val * 0.3
            target = price - atr_val * 2.5
            open_trade = {
                'direction': 'SELL',
                'entry': price,
                'sl': sl,
                'target': target,
                'confidence': round(confidence, 3),
            }
            candles_held = 0
    
    # Close any open trade at end of day
    if open_trade is not None:
        price = closes[-1]
        pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
        pnl_pct = pnl / open_trade['entry'] * 100
        trades.append({
            'date': str(today),
            'direction': open_trade['direction'],
            'entry': open_trade['entry'],
            'exit': price,
            'pnl_pts': round(pnl, 2),
            'pnl_pct': round(pnl_pct, 4),
            'candles_held': candles_held,
            'exit_reason': 'End of day',
            'confidence': open_trade['confidence'],
        })
        open_trade = None

# ── Results ───────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("⚡ ADEEB STRATEGY BACKTEST RESULTS")
print("="*70)
print(f"Data: NIFTY 50 (^NSEI) | Interval: 5-min | Days: {len(trading_days)}")
print(f"Period: {trading_days[0]} to {trading_days[-1]}")
print("-"*70)

if not trades:
    print("NO TRADES GENERATED. Strategy too restrictive for this data period.")
    print(f"Total signals that passed first 4 gates: {total_signals}")
    print(f"Rejected at EMA cloud/anti-chase gate: {rejected_signals}")
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
    max_win = max([t['pnl_pts'] for t in trades])
    max_loss = min([t['pnl_pts'] for t in trades])
    avg_hold = np.mean([t['candles_held'] for t in trades])
    avg_confidence = np.mean([t['confidence'] for t in trades])
    
    # Max drawdown
    cumulative = np.cumsum([t['pnl_pts'] for t in trades])
    peak = np.maximum.accumulate(cumulative)
    drawdown = peak - cumulative
    max_drawdown = np.max(drawdown) if len(drawdown) > 0 else 0
    
    # Trades per day
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
    print(f"Max Drawdown:       {max_drawdown:.2f} pts")
    print(f"")
    print(f"Avg Hold (candles): {avg_hold:.1f} (× 5min = {avg_hold*5:.0f} min)")
    print(f"Avg Confidence:     {avg_confidence:.3f}")
    print(f"Trades/Day:         {trades_per_day:.2f}")
    print(f"")
    print(f"Signals Generated:  {total_signals}")
    print(f"Rejected (filters): {rejected_signals}")
    print("-"*70)
    
    # Exit reason breakdown
    print("\nExit Reason Breakdown:")
    from collections import Counter
    reasons = Counter(t['exit_reason'] for t in trades)
    for reason, count in reasons.most_common():
        pnl_for_reason = sum(t['pnl_pts'] for t in trades if t['exit_reason'] == reason)
        print(f"  {reason:30s} {count:3d} trades  |  P&L: {pnl_for_reason:+.2f} pts")
    
    # Direction breakdown
    print("\nDirection Breakdown:")
    buys = [t for t in trades if t['direction'] == 'BUY']
    sells = [t for t in trades if t['direction'] == 'SELL']
    buy_pnl = sum(t['pnl_pts'] for t in buys)
    sell_pnl = sum(t['pnl_pts'] for t in sells)
    print(f"  BUY:  {len(buys)} trades | P&L: {buy_pnl:+.2f} pts | WR: {len([t for t in buys if t['pnl_pts']>0])/max(1,len(buys))*100:.1f}%")
    print(f"  SELL: {len(sells)} trades | P&L: {sell_pnl:+.2f} pts | WR: {len([t for t in sells if t['pnl_pts']>0])/max(1,len(sells))*100:.1f}%")
    
    # Daily P&L
    print("\nDaily P&L (last 10 days with trades):")
    daily_pnl = {}
    for t in trades:
        daily_pnl[t['date']] = daily_pnl.get(t['date'], 0) + t['pnl_pts']
    for date, pnl in sorted(daily_pnl.items())[-10:]:
        bar = "█" * int(abs(pnl) / 5) if pnl != 0 else ""
        sign = "+" if pnl > 0 else ""
        print(f"  {date}  {sign}{pnl:7.2f} pts  {'🟢' if pnl > 0 else '🔴'} {bar}")
    
    # Profitable days
    profitable_days = sum(1 for p in daily_pnl.values() if p > 0)
    total_trade_days = len(daily_pnl)
    print(f"\n  Profitable Days: {profitable_days}/{total_trade_days} ({profitable_days/max(1,total_trade_days)*100:.0f}%)")

print("\n" + "="*70)
print("Target: PF > 1.5, Win Rate > 55%, fewer trades than individual strategies")
print("="*70)

# Save results to JSON for later use
results = {
    "strategy": "Adeeb",
    "period": f"{trading_days[0]} to {trading_days[-1]}",
    "trading_days": len(trading_days),
    "total_trades": len(trades),
    "wins": len(wins) if trades else 0,
    "losses": len(losses) if trades else 0,
    "win_rate": round(win_rate, 1) if trades else 0,
    "profit_factor": round(profit_factor, 2) if trades else 0,
    "total_pnl_pts": round(total_pnl, 2) if trades else 0,
    "max_drawdown": round(max_drawdown, 2) if trades else 0,
    "avg_hold_min": round(avg_hold * 5, 0) if trades else 0,
    "trades_per_day": round(trades_per_day, 2) if trades else 0,
    "trades": trades,
}

with open("backtest_adeeb_results.json", "w") as f:
    json.dump(results, f, indent=2)

print(f"\nResults saved to backtest_adeeb_results.json")
