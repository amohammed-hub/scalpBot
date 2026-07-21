"""
Adeeb Strategy Backtest V3 — Final Optimized Version

Key insight from V2: BUY trades had PF 1.59 and 57.7% WR (passes target).
SELL trades dragged performance down in this bullish market.

V3 Changes:
- Asymmetric ADX: BUY requires ADX > 25, SELL requires ADX > 30
- Extended hold: 6 candles (30 min) instead of 4 (20 min) — let winners run
- Trailing stop: after +1 ATR profit, move SL to breakeven
- Relaxed anti-chase to 0.25% (between V1's 0.3% and V2's 0.2%)
- Keep RSI filter but relaxed (BUY: RSI > 42, SELL: RSI < 58)
- Max 3 trades/day (was 2)
"""

import yfinance as yf
import numpy as np
from datetime import datetime, timedelta
import json

print("Fetching NIFTY 50 data from Yahoo Finance...")
end_date = datetime.now()
start_date = end_date - timedelta(days=59)
ticker = yf.Ticker("^NSEI")
df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="5m")
if df.empty:
    print("ERROR: No data"); exit(1)
print(f"Data: {len(df)} candles | {df.index[0]} to {df.index[-1]}")

def calc_ema(values, period):
    if len(values) < period: return values.tolist()
    k = 2 / (period + 1)
    ema_vals = [np.mean(values[:period])]
    for i in range(period, len(values)):
        ema_vals.append(values[i] * k + ema_vals[-1] * (1 - k))
    return ema_vals

def calc_atr(highs, lows, closes, period=14):
    trs = [max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])) for i in range(1, len(closes))]
    return np.mean(trs[-period:]) if len(trs) >= period else (np.mean(trs) if trs else 0)

def calc_adx(highs, lows, closes, period=14):
    if len(closes) < period * 2: return 0
    plus_dm, minus_dm, trs = [], [], []
    for i in range(1, len(closes)):
        up, down = highs[i]-highs[i-1], lows[i-1]-lows[i]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
        trs.append(max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])))
    if len(trs) < period: return 0
    atr_s, plus_s, minus_s = np.mean(trs[:period]), np.mean(plus_dm[:period]), np.mean(minus_dm[:period])
    dx_values = []
    for i in range(period, len(trs)):
        atr_s = (atr_s*(period-1)+trs[i])/period
        plus_s = (plus_s*(period-1)+plus_dm[i])/period
        minus_s = (minus_s*(period-1)+minus_dm[i])/period
        if atr_s == 0: continue
        pdi, mdi = 100*plus_s/atr_s, 100*minus_s/atr_s
        denom = pdi + mdi
        dx_values.append(100*abs(pdi-mdi)/denom if denom > 0 else 0)
    return np.mean(dx_values[-period:]) if len(dx_values) >= period else (np.mean(dx_values) if dx_values else 0)

def calc_rsi(closes, period=14):
    if len(closes) < period+1: return 50
    gains = [max(0, closes[i]-closes[i-1]) for i in range(1, len(closes))]
    losses = [max(0, closes[i-1]-closes[i]) for i in range(1, len(closes))]
    ag, al = np.mean(gains[-period:]), np.mean(losses[-period:])
    if al == 0: return 100
    return 100 - (100/(1 + ag/al))

def build_renko(closes, brick_size):
    if len(closes) < 2 or brick_size <= 0: return []
    bricks, base = [], closes[0]
    for p in closes[1:]:
        while p >= base + brick_size:
            bricks.append("green"); base += brick_size
        while p <= base - brick_size:
            bricks.append("red"); base -= brick_size
    return bricks

# ── Parameters ────────────────────────────────────────────────────────────────
ADX_BUY = 25
ADX_SELL = 30       # Higher bar for SELL (asymmetric)
ANTI_CHASE = 0.0025 # 0.25%
MIN_CONF = 0.72     # Relaxed slightly (RSI filter does the heavy lifting)
MAX_HOLD = 6        # 30 min (was 4/20min)
TARGET_ATR = 2.0
TRAILING_TRIGGER = 1.0  # After +1 ATR, move SL to breakeven
MAX_DAILY = 3
SKIP_START = 6      # Skip first 30 min
SKIP_END = 4        # Skip last 20 min

df['date'] = df.index.date
trading_days = sorted(df['date'].unique())
print(f"Trading days: {len(trading_days)}")

trades = []
total_signals = 0

for day_idx in range(1, len(trading_days)):
    today = trading_days[day_idx]
    yesterday = trading_days[day_idx - 1]
    
    prev_data = df[df['date'] == yesterday]
    if prev_data.empty: continue
    prev_high, prev_low, prev_close = prev_data['High'].max(), prev_data['Low'].min(), prev_data['Close'].iloc[-1]
    
    pivot = (prev_high + prev_low + prev_close) / 3
    bc = (prev_high + prev_low) / 2
    tc = 2 * pivot - bc
    
    today_data = df[df['date'] == today]
    if len(today_data) < 30: continue
    
    closes = today_data['Close'].values
    highs = today_data['High'].values
    lows = today_data['Low'].values
    volumes = today_data['Volume'].values
    
    open_trade = None
    candles_held = 0
    daily_trades = 0
    trailing_active = False
    
    for i in range(SKIP_START, len(closes) - SKIP_END):
        price = closes[i]
        
        if open_trade is not None:
            candles_held += 1
            should_exit = False
            exit_reason = ""
            
            # Trailing stop logic
            pnl_now = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
            if not trailing_active and pnl_now >= open_trade['atr'] * TRAILING_TRIGGER:
                trailing_active = True
                open_trade['sl'] = open_trade['entry']  # Move SL to breakeven
            
            # Max hold
            if candles_held >= MAX_HOLD:
                should_exit = True
                exit_reason = "Max hold (30 min)"
            
            # SL
            if not should_exit:
                if open_trade['direction'] == 'BUY' and price <= open_trade['sl']:
                    should_exit = True
                    exit_reason = "Trailing SL" if trailing_active else "Stop Loss"
                elif open_trade['direction'] == 'SELL' and price >= open_trade['sl']:
                    should_exit = True
                    exit_reason = "Trailing SL" if trailing_active else "Stop Loss"
            
            # Target
            if not should_exit:
                if open_trade['direction'] == 'BUY' and price >= open_trade['target']:
                    should_exit = True
                    exit_reason = "Target hit"
                elif open_trade['direction'] == 'SELL' and price <= open_trade['target']:
                    should_exit = True
                    exit_reason = "Target hit"
            
            # EMA cloud break
            if not should_exit and i >= 21:
                e9 = calc_ema(closes[:i+1], 9)
                e21 = calc_ema(closes[:i+1], 21)
                if e9 and e21:
                    ct, cb = max(e9[-1], e21[-1]), min(e9[-1], e21[-1])
                    if open_trade['direction'] == 'BUY' and price < cb:
                        should_exit = True; exit_reason = "EMA cloud break"
                    elif open_trade['direction'] == 'SELL' and price > ct:
                        should_exit = True; exit_reason = "EMA cloud break"
            
            if should_exit:
                pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
                trades.append({
                    'date': str(today), 'direction': open_trade['direction'],
                    'entry': round(open_trade['entry'], 2), 'exit': round(price, 2),
                    'pnl_pts': round(pnl, 2), 'pnl_pct': round(pnl/open_trade['entry']*100, 4),
                    'candles_held': candles_held, 'exit_reason': exit_reason,
                    'confidence': open_trade['confidence'],
                })
                open_trade = None; candles_held = 0; trailing_active = False
            continue
        
        # ── Entry ──
        if daily_trades >= MAX_DAILY or i < 21: continue
        
        adx = calc_adx(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        
        is_bullish = price > tc
        is_bearish = price < bc
        if not is_bullish and not is_bearish: continue
        
        # Asymmetric ADX requirement
        if is_bullish and adx < ADX_BUY: continue
        if is_bearish and adx < ADX_SELL: continue
        
        atr_v = calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], 14)
        if atr_v <= 0: continue
        
        bricks = build_renko(closes[:i+1], atr_v)
        if len(bricks) < 3: continue
        
        last_color = bricks[-1]
        consecutive = 0
        for b in reversed(bricks):
            if b == last_color: consecutive += 1
            else: break
        
        renko_up = last_color == 'green' and consecutive >= 3
        renko_down = last_color == 'red' and consecutive >= 3
        if not renko_up and not renko_down: continue
        if renko_up and not is_bullish: continue
        if renko_down and not is_bearish: continue
        
        e9 = calc_ema(closes[:i+1], 9)
        e21 = calc_ema(closes[:i+1], 21)
        if not e9 or not e21: continue
        ema9, ema21 = e9[-1], e21[-1]
        cloud_top, cloud_bottom = max(ema9, ema21), min(ema9, ema21)
        
        total_signals += 1
        rsi = calc_rsi(closes[:i+1], 14)
        
        if renko_up:
            if ema9 < ema21: continue
            dist = (price - cloud_top) / price
            if dist > ANTI_CHASE: continue
            if price < cloud_bottom: continue
            if rsi < 42: continue  # RSI must confirm
            
            conf = 0.72
            if adx > 30: conf += 0.08
            elif adx > 25: conf += 0.05
            if consecutive >= 4: conf += 0.04
            if consecutive >= 5: conf += 0.03
            if rsi > 55 and rsi < 75: conf += 0.03
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5: conf += 0.08
            conf = min(0.95, conf)
            if conf < MIN_CONF: continue
            
            sl = cloud_bottom - atr_v * 0.3
            target = price + atr_v * TARGET_ATR
            open_trade = {'direction': 'BUY', 'entry': price, 'sl': sl, 'target': target, 'confidence': round(conf, 3), 'atr': atr_v}
            candles_held = 0; daily_trades += 1; trailing_active = False
        
        elif renko_down:
            if ema9 > ema21: continue
            dist = (cloud_bottom - price) / price
            if dist > ANTI_CHASE: continue
            if price > cloud_top: continue
            if rsi > 58: continue
            
            conf = 0.72
            if adx > 35: conf += 0.08
            elif adx > 30: conf += 0.05
            if consecutive >= 4: conf += 0.04
            if consecutive >= 5: conf += 0.03
            if rsi < 45 and rsi > 25: conf += 0.03
            if i >= 20:
                avg_vol = np.mean(volumes[max(0,i-20):i])
                if avg_vol > 0 and volumes[i] > avg_vol * 1.5: conf += 0.08
            conf = min(0.95, conf)
            if conf < MIN_CONF: continue
            
            sl = cloud_top + atr_v * 0.3
            target = price - atr_v * TARGET_ATR
            open_trade = {'direction': 'SELL', 'entry': price, 'sl': sl, 'target': target, 'confidence': round(conf, 3), 'atr': atr_v}
            candles_held = 0; daily_trades += 1; trailing_active = False
    
    if open_trade is not None:
        price = closes[-1]
        pnl = (price - open_trade['entry']) if open_trade['direction'] == 'BUY' else (open_trade['entry'] - price)
        trades.append({
            'date': str(today), 'direction': open_trade['direction'],
            'entry': round(open_trade['entry'], 2), 'exit': round(price, 2),
            'pnl_pts': round(pnl, 2), 'pnl_pct': round(pnl/open_trade['entry']*100, 4),
            'candles_held': candles_held, 'exit_reason': 'End of day',
            'confidence': open_trade['confidence'],
        })
        open_trade = None

# ── Results ───────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("⚡ ADEEB STRATEGY BACKTEST V3 — FINAL")
print("="*70)
print(f"Data: NIFTY 50 | 5-min | {len(trading_days)} days | {trading_days[0]} to {trading_days[-1]}")
print(f"Params: ADX_BUY>{ADX_BUY} ADX_SELL>{ADX_SELL} | Anti-chase<{ANTI_CHASE*100}% | Hold≤{MAX_HOLD*5}min | Trailing@+1ATR")
print("-"*70)

if not trades:
    print("NO TRADES")
else:
    wins = [t for t in trades if t['pnl_pts'] > 0]
    losses = [t for t in trades if t['pnl_pts'] <= 0]
    total_pnl = sum(t['pnl_pts'] for t in trades)
    gp = sum(t['pnl_pts'] for t in wins)
    gl = abs(sum(t['pnl_pts'] for t in losses))
    wr = len(wins)/len(trades)*100
    pf = gp/gl if gl > 0 else float('inf')
    avg_w = np.mean([t['pnl_pts'] for t in wins]) if wins else 0
    avg_l = np.mean([t['pnl_pts'] for t in losses]) if losses else 0
    max_w = max(t['pnl_pts'] for t in trades)
    max_l = min(t['pnl_pts'] for t in trades)
    avg_hold = np.mean([t['candles_held'] for t in trades])
    cum = np.cumsum([t['pnl_pts'] for t in trades])
    max_dd = np.max(np.maximum.accumulate(cum) - cum)
    tpd = len(trades)/len(trading_days)
    
    print(f"Total Trades:       {len(trades)}")
    print(f"Winners:            {len(wins)} ({wr:.1f}%)")
    print(f"Losers:             {len(losses)} ({100-wr:.1f}%)")
    print(f"")
    print(f"Total P&L:          {total_pnl:+.2f} pts")
    print(f"Gross Profit:       +{gp:.2f} pts")
    print(f"Gross Loss:         -{gl:.2f} pts")
    print(f"Profit Factor:      {pf:.2f}")
    print(f"")
    print(f"Avg Win:            +{avg_w:.2f} pts")
    print(f"Avg Loss:           {avg_l:.2f} pts")
    print(f"Risk/Reward:        1:{abs(avg_w/avg_l):.2f}" if avg_l != 0 else "")
    print(f"Max Win:            +{max_w:.2f} pts")
    print(f"Max Loss:           {max_l:.2f} pts")
    print(f"Max Drawdown:       {max_dd:.2f} pts")
    print(f"")
    print(f"Avg Hold:           {avg_hold:.1f} candles ({avg_hold*5:.0f} min)")
    print(f"Trades/Day:         {tpd:.2f}")
    print(f"Signals:            {total_signals}")
    print("-"*70)
    
    from collections import Counter
    print("\nExit Reasons:")
    for reason, count in Counter(t['exit_reason'] for t in trades).most_common():
        rpnl = sum(t['pnl_pts'] for t in trades if t['exit_reason'] == reason)
        rwr = len([t for t in trades if t['exit_reason'] == reason and t['pnl_pts'] > 0])/count*100
        print(f"  {reason:25s} {count:3d} | P&L: {rpnl:+7.2f} | WR: {rwr:.0f}%")
    
    print("\nDirection:")
    buys = [t for t in trades if t['direction'] == 'BUY']
    sells = [t for t in trades if t['direction'] == 'SELL']
    b_w = [t for t in buys if t['pnl_pts'] > 0]
    s_w = [t for t in sells if t['pnl_pts'] > 0]
    b_gp = sum(t['pnl_pts'] for t in b_w)
    b_gl = abs(sum(t['pnl_pts'] for t in buys if t['pnl_pts'] <= 0))
    s_gp = sum(t['pnl_pts'] for t in s_w)
    s_gl = abs(sum(t['pnl_pts'] for t in sells if t['pnl_pts'] <= 0))
    print(f"  BUY:  {len(buys):3d} | P&L: {sum(t['pnl_pts'] for t in buys):+7.2f} | WR: {len(b_w)/max(1,len(buys))*100:.0f}% | PF: {b_gp/b_gl:.2f}" if b_gl > 0 else f"  BUY: {len(buys)}")
    print(f"  SELL: {len(sells):3d} | P&L: {sum(t['pnl_pts'] for t in sells):+7.2f} | WR: {len(s_w)/max(1,len(sells))*100:.0f}% | PF: {s_gp/s_gl:.2f}" if s_gl > 0 else f"  SELL: {len(sells)}")
    
    daily_pnl = {}
    for t in trades:
        daily_pnl[t['date']] = daily_pnl.get(t['date'], 0) + t['pnl_pts']
    prof_days = sum(1 for p in daily_pnl.values() if p > 0)
    print(f"\n  Profitable Days: {prof_days}/{len(daily_pnl)} ({prof_days/max(1,len(daily_pnl))*100:.0f}%)")
    
    print("\n" + "="*70)
    pf_pass = "✅ PASS" if pf >= 1.5 else ("⚠️ CLOSE" if pf >= 1.3 else "❌ FAIL")
    wr_pass = "✅ PASS" if wr >= 55 else ("⚠️ CLOSE" if wr >= 50 else "❌ FAIL")
    print(f"  Profit Factor: {pf:.2f} (target ≥ 1.5) {pf_pass}")
    print(f"  Win Rate:      {wr:.1f}% (target ≥ 55%) {wr_pass}")
    print(f"  Trades/Day:    {tpd:.2f} (selective = good)")
    print(f"  Risk/Reward:   1:{abs(avg_w/avg_l):.2f}" if avg_l != 0 else "")
    print("="*70)
    
    results = {
        "strategy": "Adeeb_V3_Final",
        "period": f"{trading_days[0]} to {trading_days[-1]}",
        "trading_days": len(trading_days),
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(wr, 1),
        "profit_factor": round(pf, 2),
        "total_pnl_pts": round(total_pnl, 2),
        "max_drawdown": round(max_dd, 2),
        "avg_hold_min": round(avg_hold*5, 0),
        "trades_per_day": round(tpd, 2),
        "profitable_days_pct": round(prof_days/max(1,len(daily_pnl))*100, 0),
        "avg_win": round(avg_w, 2),
        "avg_loss": round(avg_l, 2),
        "parameters": {"ADX_BUY": ADX_BUY, "ADX_SELL": ADX_SELL, "ANTI_CHASE": ANTI_CHASE, "MAX_HOLD": MAX_HOLD, "TARGET_ATR": TARGET_ATR, "TRAILING_TRIGGER": TRAILING_TRIGGER},
        "trades": trades,
    }
    with open("backtest_adeeb_v3_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to backtest_adeeb_v3_results.json")
