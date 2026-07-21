"""
Adeeb Strategy Backtest — Bank Nifty 15-min V2

V1 had 0 trades because:
- 25 candles/day on 15-min is too few for 14-period ATR to build 3 Renko bricks
- ATR = 169 pts → 3 bricks = 508 pts move needed in a single day

V2 Fix:
- Use ROLLING multi-day data for indicators (last 3 days of candles)
- Use 0.5×ATR as brick size (smaller bricks = more signals)
- Reduce Renko requirement to 2 consecutive bricks (not 3)
- Use lookback of 10 candles for indicator minimum (not 14)
"""

import yfinance as yf
import numpy as np
from datetime import datetime, timedelta
import json

print("⚡ Adeeb Strategy — Bank Nifty 15-min V2 (Rolling Data)")
print("Fetching Bank Nifty (^NSEBANK) 15-min data...")
end_date = datetime.now()
start_date = end_date - timedelta(days=59)
ticker = yf.Ticker("^NSEBANK")
df = ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="15m")
if df.empty:
    print("ERROR: No data"); exit(1)
print(f"Data: {len(df)} candles | {df.index[0]} to {df.index[-1]}")

def calc_ema(values, period):
    if len(values) < period: return values.tolist()
    k = 2/(period+1)
    r = [np.mean(values[:period])]
    for i in range(period, len(values)):
        r.append(values[i]*k + r[-1]*(1-k))
    return r

def calc_atr(h, l, c, p=14):
    trs = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1, len(c))]
    return np.mean(trs[-p:]) if len(trs) >= p else (np.mean(trs) if trs else 0)

def calc_adx(h, l, c, p=14):
    if len(c) < p*2: return 0
    pdm, mdm, trs = [], [], []
    for i in range(1, len(c)):
        up, dn = h[i]-h[i-1], l[i-1]-l[i]
        pdm.append(up if up > dn and up > 0 else 0)
        mdm.append(dn if dn > up and dn > 0 else 0)
        trs.append(max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])))
    if len(trs) < p: return 0
    as_, ps, ms = np.mean(trs[:p]), np.mean(pdm[:p]), np.mean(mdm[:p])
    dx = []
    for i in range(p, len(trs)):
        as_ = (as_*(p-1)+trs[i])/p
        ps = (ps*(p-1)+pdm[i])/p
        ms = (ms*(p-1)+mdm[i])/p
        if as_ == 0: continue
        pdi, mdi = 100*ps/as_, 100*ms/as_
        d = pdi+mdi
        dx.append(100*abs(pdi-mdi)/d if d > 0 else 0)
    return np.mean(dx[-p:]) if len(dx) >= p else (np.mean(dx) if dx else 0)

def calc_rsi(c, p=14):
    if len(c) < p+1: return 50
    g = [max(0, c[i]-c[i-1]) for i in range(1, len(c))]
    l = [max(0, c[i-1]-c[i]) for i in range(1, len(c))]
    ag, al = np.mean(g[-p:]), np.mean(l[-p:])
    return 100 - (100/(1+ag/al)) if al > 0 else 100

def build_renko(closes, bs):
    if len(closes) < 2 or bs <= 0: return []
    bricks, base = [], closes[0]
    for p in closes[1:]:
        while p >= base+bs: bricks.append("green"); base += bs
        while p <= base-bs: bricks.append("red"); base -= bs
    return bricks

# Parameters (adjusted for 15-min Bank Nifty)
ADX_BUY, ADX_SELL = 22, 27    # Slightly relaxed for 15-min
ANTI_CHASE = 0.003             # 0.3% (Bank Nifty is more volatile)
MIN_CONF = 0.70               # Slightly relaxed
MAX_HOLD = 4                   # 4 × 15min = 60 min
TARGET_ATR = 1.8               # Slightly lower target (Bank Nifty mean-reverts faster)
TRAIL_TRIGGER = 0.8            # Trail earlier
MAX_DAILY = 3
SKIP_S = 2                     # Skip first 30 min
SKIP_E = 1                     # Skip last 15 min
RENKO_BRICK_MULT = 0.5         # Use 0.5×ATR as brick size
MIN_RENKO_BRICKS = 2           # Only need 2 consecutive bricks
LOOKBACK_DAYS = 3              # Use 3 days of rolling data for indicators

df['date'] = df.index.date
days = sorted(df['date'].unique())
print(f"Trading days: {len(days)}")

trades = []
signals = 0
rejected = {}

for di in range(LOOKBACK_DAYS, len(days)):
    today = days[di]
    yesterday = days[di-1]
    
    # Previous day for CPR
    pd_ = df[df['date'] == yesterday]
    if pd_.empty: continue
    ph, pl, pc = pd_['High'].max(), pd_['Low'].min(), pd_['Close'].iloc[-1]
    pivot = (ph+pl+pc)/3; bc = (ph+pl)/2; tc = 2*pivot-bc
    
    # Rolling data: last LOOKBACK_DAYS days + today for indicators
    lookback_start = days[di - LOOKBACK_DAYS]
    rolling_data = df[(df['date'] >= lookback_start) & (df['date'] <= today)]
    
    today_data = df[df['date'] == today]
    if len(today_data) < 10: continue
    
    # Build full rolling arrays
    all_C = rolling_data['Close'].values
    all_H = rolling_data['High'].values
    all_L = rolling_data['Low'].values
    all_V = rolling_data['Volume'].values
    
    # Find where today starts in the rolling array
    today_start_idx = len(rolling_data) - len(today_data)
    
    C_today = today_data['Close'].values
    
    ot = None; ch = 0; dt = 0; trail = False
    
    for ti in range(SKIP_S, len(C_today) - SKIP_E):
        # Global index in rolling array
        gi = today_start_idx + ti
        p = all_C[gi]
        
        if ot:
            ch += 1
            pnl_now = (p-ot['entry']) if ot['dir']=='BUY' else (ot['entry']-p)
            
            if not trail and pnl_now >= ot['atr']*TRAIL_TRIGGER:
                trail = True
                ot['sl'] = ot['entry'] + (ot['atr']*0.2 if ot['dir']=='BUY' else -ot['atr']*0.2)
            
            ex = False; er = ""
            if ch >= MAX_HOLD: ex=True; er="Max hold (60 min)"
            if not ex and ot['dir']=='BUY' and p <= ot['sl']: ex=True; er="Trailing SL" if trail else "Stop Loss"
            if not ex and ot['dir']=='SELL' and p >= ot['sl']: ex=True; er="Trailing SL" if trail else "Stop Loss"
            if not ex and ot['dir']=='BUY' and p >= ot['target']: ex=True; er="Target hit"
            if not ex and ot['dir']=='SELL' and p <= ot['target']: ex=True; er="Target hit"
            
            if ex:
                pnl = (p-ot['entry']) if ot['dir']=='BUY' else (ot['entry']-p)
                trades.append({'date':str(today),'direction':ot['dir'],'entry':round(ot['entry'],2),'exit':round(p,2),'pnl_pts':round(pnl,2),'pnl_pct':round(pnl/ot['entry']*100,4),'candles_held':ch,'exit_reason':er,'confidence':ot['conf']})
                ot=None; ch=0; trail=False
            continue
        
        if dt >= MAX_DAILY: continue
        if gi < 28: continue  # Need at least 28 candles of rolling history
        
        # Use rolling data up to current candle
        slice_C = all_C[:gi+1]
        slice_H = all_H[:gi+1]
        slice_L = all_L[:gi+1]
        slice_V = all_V[:gi+1]
        
        adx = calc_adx(slice_H, slice_L, slice_C, 14)
        bull = p > tc; bear = p < bc
        if not bull and not bear:
            continue
        if bull and adx < ADX_BUY:
            continue
        if bear and adx < ADX_SELL:
            continue
        
        atr = calc_atr(slice_H, slice_L, slice_C, 14)
        if atr <= 0: continue
        
        brick_size = atr * RENKO_BRICK_MULT
        bricks = build_renko(slice_C[-50:], brick_size)  # Use last 50 candles for Renko
        if len(bricks) < MIN_RENKO_BRICKS: continue
        
        lc = bricks[-1]
        cons = 0
        for b in reversed(bricks):
            if b == lc: cons += 1
            else: break
        
        rup = lc=='green' and cons >= MIN_RENKO_BRICKS
        rdn = lc=='red' and cons >= MIN_RENKO_BRICKS
        if not rup and not rdn: continue
        if rup and not bull: continue
        if rdn and not bear: continue
        
        e9 = calc_ema(slice_C, 9)
        e21 = calc_ema(slice_C, 21)
        if not e9 or not e21: continue
        ema9, ema21 = e9[-1], e21[-1]
        ct, cb = max(ema9,ema21), min(ema9,ema21)
        
        signals += 1
        rsi = calc_rsi(slice_C, 14)
        
        if rup:
            if ema9 < ema21:
                rejected['EMA bearish'] = rejected.get('EMA bearish', 0) + 1
                continue
            if (p-ct)/p > ANTI_CHASE:
                rejected['Anti-chase'] = rejected.get('Anti-chase', 0) + 1
                continue
            if p < cb:
                rejected['Below cloud'] = rejected.get('Below cloud', 0) + 1
                continue
            if rsi < 42:
                rejected['RSI weak'] = rejected.get('RSI weak', 0) + 1
                continue
            conf = 0.70
            if adx > 30: conf += 0.08
            elif adx > 25: conf += 0.06
            elif adx > 22: conf += 0.03
            if cons >= 3: conf += 0.05
            if cons >= 4: conf += 0.03
            if 55 < rsi < 75: conf += 0.03
            if gi >= 10:
                av = np.mean(slice_V[max(0,gi-10):gi])
                if av > 0 and slice_V[gi] > av*1.3: conf += 0.06
            conf = min(0.95, conf)
            if conf < MIN_CONF:
                rejected['Low confidence'] = rejected.get('Low confidence', 0) + 1
                continue
            sl = cb - atr*0.3
            tgt = p + atr*TARGET_ATR
            ot = {'dir':'BUY','entry':p,'sl':sl,'target':tgt,'conf':round(conf,3),'atr':atr}
            ch=0; dt+=1; trail=False
        
        elif rdn:
            if ema9 > ema21:
                rejected['EMA bullish'] = rejected.get('EMA bullish', 0) + 1
                continue
            if (cb-p)/p > ANTI_CHASE:
                rejected['Anti-chase'] = rejected.get('Anti-chase', 0) + 1
                continue
            if p > ct:
                rejected['Above cloud'] = rejected.get('Above cloud', 0) + 1
                continue
            if rsi > 58:
                rejected['RSI weak'] = rejected.get('RSI weak', 0) + 1
                continue
            conf = 0.70
            if adx > 35: conf += 0.08
            elif adx > 30: conf += 0.06
            elif adx > 27: conf += 0.03
            if cons >= 3: conf += 0.05
            if cons >= 4: conf += 0.03
            if 25 < rsi < 45: conf += 0.03
            if gi >= 10:
                av = np.mean(slice_V[max(0,gi-10):gi])
                if av > 0 and slice_V[gi] > av*1.3: conf += 0.06
            conf = min(0.95, conf)
            if conf < MIN_CONF:
                rejected['Low confidence'] = rejected.get('Low confidence', 0) + 1
                continue
            sl = ct + atr*0.3
            tgt = p - atr*TARGET_ATR
            ot = {'dir':'SELL','entry':p,'sl':sl,'target':tgt,'conf':round(conf,3),'atr':atr}
            ch=0; dt+=1; trail=False
    
    if ot:
        pnl = (C_today[-1]-ot['entry']) if ot['dir']=='BUY' else (ot['entry']-C_today[-1])
        trades.append({'date':str(today),'direction':ot['dir'],'entry':round(ot['entry'],2),'exit':round(C_today[-1],2),'pnl_pts':round(pnl,2),'pnl_pct':round(pnl/ot['entry']*100,4),'candles_held':ch,'exit_reason':'End of day','confidence':ot['conf']})
        ot=None

# ── Results ───────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("⚡ ADEEB STRATEGY — BANK NIFTY 15-MIN BACKTEST V2")
print("="*70)
print(f"Instrument: Bank Nifty (^NSEBANK) | Timeframe: 15-min")
print(f"Data: {len(df)} candles | {len(days)} trading days")
print(f"Period: {days[0]} to {days[-1]}")
print(f"Rolling lookback: {LOOKBACK_DAYS} days | Brick: {RENKO_BRICK_MULT}×ATR | Min bricks: {MIN_RENKO_BRICKS}")
print(f"Exit: Max hold 60min + Target {TARGET_ATR}×ATR + SL + Trailing @+{TRAIL_TRIGGER}ATR")
print("-"*70)

if not trades:
    print("NO TRADES generated.")
    print(f"Signals evaluated: {signals}")
    print(f"Rejection reasons: {rejected}")
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
    tpd = len(trades)/len(days)
    
    print(f"Total Trades:       {len(trades)}")
    print(f"Winners:            {len(wins)} ({wr:.1f}%)")
    print(f"Losers:             {len(losses)} ({100-wr:.1f}%)")
    print(f"")
    print(f"Total P&L:          {total_pnl:+.2f} pts (Bank Nifty index points)")
    print(f"Gross Profit:       +{gp:.2f} pts")
    print(f"Gross Loss:         -{gl:.2f} pts")
    print(f"Profit Factor:      {pf:.2f}")
    print(f"")
    print(f"Avg Win:            +{avg_w:.2f} pts")
    print(f"Avg Loss:           {avg_l:.2f} pts")
    if avg_l != 0:
        print(f"Risk/Reward:        1:{abs(avg_w/avg_l):.2f}")
    print(f"Max Win:            +{max_w:.2f} pts")
    print(f"Max Loss:           {max_l:.2f} pts")
    print(f"Max Drawdown:       {max_dd:.2f} pts")
    print(f"")
    print(f"Avg Hold:           {avg_hold:.1f} candles ({avg_hold*15:.0f} min)")
    print(f"Trades/Day:         {tpd:.2f}")
    print(f"Signals:            {signals}")
    print("-"*70)
    
    from collections import Counter
    print("\nExit Reasons:")
    for reason, count in Counter(t['exit_reason'] for t in trades).most_common():
        rpnl = sum(t['pnl_pts'] for t in trades if t['exit_reason'] == reason)
        rwr = len([t for t in trades if t['exit_reason'] == reason and t['pnl_pts'] > 0])/count*100
        print(f"  {reason:25s} {count:3d} | P&L: {rpnl:+8.2f} pts | WR: {rwr:.0f}%")
    
    print("\nDirection:")
    buys = [t for t in trades if t['direction'] == 'BUY']
    sells = [t for t in trades if t['direction'] == 'SELL']
    for label, grp in [("BUY", buys), ("SELL", sells)]:
        if not grp: continue
        gw = [t for t in grp if t['pnl_pts'] > 0]
        ggp = sum(t['pnl_pts'] for t in gw)
        ggl = abs(sum(t['pnl_pts'] for t in grp if t['pnl_pts'] <= 0))
        gpf = ggp/ggl if ggl > 0 else float('inf')
        print(f"  {label:5s} {len(grp):3d} | P&L: {sum(t['pnl_pts'] for t in grp):+8.2f} | WR: {len(gw)/len(grp)*100:.0f}% | PF: {gpf:.2f}")
    
    if rejected:
        print("\nRejection Reasons:")
        for r, c in sorted(rejected.items(), key=lambda x: -x[1]):
            print(f"  {r:20s} {c}")
    
    daily_pnl = {}
    for t in trades:
        daily_pnl[t['date']] = daily_pnl.get(t['date'], 0) + t['pnl_pts']
    prof_days = sum(1 for p in daily_pnl.values() if p > 0)
    print(f"\n  Profitable Days: {prof_days}/{len(daily_pnl)} ({prof_days/max(1,len(daily_pnl))*100:.0f}%)")
    
    # Equity curve
    print("\n  Equity Curve (cumulative P&L):")
    cum_total = 0
    for date in sorted(daily_pnl.keys()):
        cum_total += daily_pnl[date]
        bar = "█" * max(1, int(abs(cum_total) / 80))
        icon = '📈' if cum_total > 0 else '📉'
        print(f"    {date} {cum_total:+8.2f} {icon} {bar}")
    
    print("\n" + "="*70)
    pf_pass = "✅ PASS" if pf >= 1.5 else ("⚠️ CLOSE" if pf >= 1.3 else "❌ FAIL")
    wr_pass = "✅ PASS" if wr >= 55 else ("⚠️ CLOSE" if wr >= 50 else "❌ FAIL")
    print(f"  Profit Factor:   {pf:.2f}  (target ≥ 1.5)  {pf_pass}")
    print(f"  Win Rate:        {wr:.1f}%  (target ≥ 55%)  {wr_pass}")
    print(f"  Trades/Day:      {tpd:.2f}")
    if avg_l != 0:
        print(f"  Risk/Reward:     1:{abs(avg_w/avg_l):.2f}")
    print(f"  Profitable Days: {prof_days/max(1,len(daily_pnl))*100:.0f}%")
    print("="*70)
    
    # Comparison
    print("\n📊 COMPARISON: Bank Nifty 15-min vs NIFTY 5-min")
    print("-"*70)
    print(f"  {'Metric':<20} {'BN 15m (this)':<20} {'NIFTY 5m (prev)':<20}")
    print(f"  {'Trades':<20} {len(trades):<20} {'57':<20}")
    print(f"  {'Win Rate':<20} {f'{wr:.1f}%':<20} {'50.9%':<20}")
    print(f"  {'Profit Factor':<20} {f'{pf:.2f}':<20} {'0.98':<20}")
    print(f"  {'Total P&L':<20} {f'{total_pnl:+.0f} pts':<20} {'-19 pts':<20}")
    print(f"  {'Max Drawdown':<20} {f'{max_dd:.0f} pts':<20} {'297 pts':<20}")
    print(f"  {'Avg Hold':<20} {f'{avg_hold*15:.0f} min':<20} {'26 min':<20}")
    print("-"*70)
    
    results = {
        "strategy": "Adeeb_BankNifty_15m_V2",
        "instrument": "Bank Nifty (^NSEBANK)",
        "timeframe": "15-min",
        "period": f"{days[0]} to {days[-1]}",
        "trading_days": len(days),
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(wr, 1),
        "profit_factor": round(pf, 2),
        "total_pnl_pts": round(total_pnl, 2),
        "gross_profit": round(gp, 2),
        "gross_loss": round(gl, 2),
        "max_drawdown": round(max_dd, 2),
        "avg_win": round(avg_w, 2),
        "avg_loss": round(avg_l, 2),
        "avg_hold_min": round(avg_hold*15, 0),
        "trades_per_day": round(tpd, 2),
        "profitable_days_pct": round(prof_days/max(1,len(daily_pnl))*100, 0),
        "parameters": {"ADX_BUY":ADX_BUY,"ADX_SELL":ADX_SELL,"ANTI_CHASE":ANTI_CHASE,"MAX_HOLD":MAX_HOLD,"TARGET_ATR":TARGET_ATR,"TRAIL_TRIGGER":TRAIL_TRIGGER,"RENKO_BRICK_MULT":RENKO_BRICK_MULT,"MIN_RENKO_BRICKS":MIN_RENKO_BRICKS,"LOOKBACK_DAYS":LOOKBACK_DAYS},
        "trades": trades,
    }
    with open("backtest_adeeb_banknifty_v2_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to backtest_adeeb_banknifty_v2_results.json")
