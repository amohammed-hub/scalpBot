"""
Adeeb Strategy Backtest — Bank Nifty 15-min

Testing on Bank Nifty (^NSEBANK) with 15-minute candles.
Higher timeframe should reduce noise and give cleaner Renko signals.

Parameters same as Final version:
- Entry: ADX>25(BUY)/ADX>30(SELL) + CPR bias + 3-brick Renko + EMA cloud pullback
- Exit: Max hold (4 candles = 60 min) + Target (2×ATR) + SL + Trailing @+1ATR
- NO EMA cloud break exit
- Anti-chase: 0.25%, RSI confirmation
"""

import yfinance as yf
import numpy as np
from datetime import datetime, timedelta
import json

print("⚡ Adeeb Strategy — Bank Nifty 15-min Backtest")
print("Fetching Bank Nifty (^NSEBANK) 15-min data from Yahoo Finance...")
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

# Parameters (adjusted for 15-min timeframe)
ADX_BUY, ADX_SELL = 25, 30
ANTI_CHASE = 0.0025  # 0.25%
MIN_CONF = 0.72
MAX_HOLD = 4         # 4 × 15min = 60 min (1 hour max hold)
TARGET_ATR = 2.0
TRAIL_TRIGGER = 1.0  # After +1 ATR, move SL to breakeven
MAX_DAILY = 3
SKIP_S = 2           # Skip first 30 min (2 × 15min)
SKIP_E = 2           # Skip last 30 min

df['date'] = df.index.date
days = sorted(df['date'].unique())
print(f"Trading days: {len(days)}\n")

trades = []
signals = 0

for di in range(1, len(days)):
    today, yesterday = days[di], days[di-1]
    pd_ = df[df['date'] == yesterday]
    if pd_.empty: continue
    ph, pl, pc = pd_['High'].max(), pd_['Low'].min(), pd_['Close'].iloc[-1]
    pivot = (ph+pl+pc)/3; bc = (ph+pl)/2; tc = 2*pivot-bc
    
    td = df[df['date'] == today]
    if len(td) < 15: continue  # Need at least 15 candles (3.75 hours)
    C, H, L, V = td['Close'].values, td['High'].values, td['Low'].values, td['Volume'].values
    
    ot = None; ch = 0; dt = 0; trail = False
    
    for i in range(SKIP_S, len(C)-SKIP_E):
        p = C[i]
        
        if ot:
            ch += 1
            pnl_now = (p-ot['entry']) if ot['dir']=='BUY' else (ot['entry']-p)
            
            # Trailing stop activation
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
        
        if dt >= MAX_DAILY or i < 14: continue  # Need 14 candles for indicators
        
        adx = calc_adx(H[:i+1], L[:i+1], C[:i+1], 14)
        bull = p > tc; bear = p < bc
        if not bull and not bear: continue
        if bull and adx < ADX_BUY: continue
        if bear and adx < ADX_SELL: continue
        
        atr = calc_atr(H[:i+1], L[:i+1], C[:i+1], 14)
        if atr <= 0: continue
        bricks = build_renko(C[:i+1], atr)
        if len(bricks) < 3: continue
        
        lc = bricks[-1]
        cons = 0
        for b in reversed(bricks):
            if b == lc: cons += 1
            else: break
        
        rup = lc=='green' and cons >= 3
        rdn = lc=='red' and cons >= 3
        if not rup and not rdn: continue
        if rup and not bull: continue
        if rdn and not bear: continue
        
        e9 = calc_ema(C[:i+1], 9)
        e21 = calc_ema(C[:i+1], 21)
        if not e9 or not e21: continue
        ema9, ema21 = e9[-1], e21[-1]
        ct, cb = max(ema9,ema21), min(ema9,ema21)
        
        signals += 1
        rsi = calc_rsi(C[:i+1], 14)
        
        if rup:
            if ema9 < ema21: continue
            if (p-ct)/p > ANTI_CHASE: continue
            if p < cb: continue
            if rsi < 42: continue
            conf = 0.72
            if adx > 30: conf += 0.08
            elif adx > 25: conf += 0.05
            if cons >= 4: conf += 0.04
            if cons >= 5: conf += 0.03
            if 55 < rsi < 75: conf += 0.03
            if i >= 10:
                av = np.mean(V[max(0,i-10):i])
                if av > 0 and V[i] > av*1.5: conf += 0.08
            conf = min(0.95, conf)
            if conf < MIN_CONF: continue
            sl = cb - atr*0.3
            tgt = p + atr*TARGET_ATR
            ot = {'dir':'BUY','entry':p,'sl':sl,'target':tgt,'conf':round(conf,3),'atr':atr}
            ch=0; dt+=1; trail=False
        
        elif rdn:
            if ema9 > ema21: continue
            if (cb-p)/p > ANTI_CHASE: continue
            if p > ct: continue
            if rsi > 58: continue
            conf = 0.72
            if adx > 35: conf += 0.08
            elif adx > 30: conf += 0.05
            if cons >= 4: conf += 0.04
            if cons >= 5: conf += 0.03
            if 25 < rsi < 45: conf += 0.03
            if i >= 10:
                av = np.mean(V[max(0,i-10):i])
                if av > 0 and V[i] > av*1.5: conf += 0.08
            conf = min(0.95, conf)
            if conf < MIN_CONF: continue
            sl = ct + atr*0.3
            tgt = p - atr*TARGET_ATR
            ot = {'dir':'SELL','entry':p,'sl':sl,'target':tgt,'conf':round(conf,3),'atr':atr}
            ch=0; dt+=1; trail=False
    
    if ot:
        pnl = (C[-1]-ot['entry']) if ot['dir']=='BUY' else (ot['entry']-C[-1])
        trades.append({'date':str(today),'direction':ot['dir'],'entry':round(ot['entry'],2),'exit':round(C[-1],2),'pnl_pts':round(pnl,2),'pnl_pct':round(pnl/ot['entry']*100,4),'candles_held':ch,'exit_reason':'End of day','confidence':ot['conf']})
        ot=None

# ── Print Results ─────────────────────────────────────────────────────────────
print("="*70)
print("⚡ ADEEB STRATEGY — BANK NIFTY 15-MIN BACKTEST")
print("="*70)
print(f"Instrument: Bank Nifty (^NSEBANK) | Timeframe: 15-min")
print(f"Data: {len(df)} candles | {len(days)} trading days")
print(f"Period: {days[0]} to {days[-1]}")
print(f"Exit: Max hold 60min + Target 2×ATR + SL + Trailing @+1ATR")
print("-"*70)

if not trades:
    print("NO TRADES generated.")
    print(f"Signals evaluated: {signals}")
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
        bar = "█" * max(1, int(abs(cum_total) / 50))
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
    
    # Comparison with NIFTY 5-min
    print("\n📊 COMPARISON: Bank Nifty 15-min vs NIFTY 5-min")
    print("-"*70)
    print(f"  {'Metric':<20} {'Bank Nifty 15m':<20} {'NIFTY 5m':<20}")
    print(f"  {'Trades':<20} {len(trades):<20} {'57':<20}")
    print(f"  {'Win Rate':<20} {f'{wr:.1f}%':<20} {'50.9%':<20}")
    print(f"  {'Profit Factor':<20} {f'{pf:.2f}':<20} {'0.98':<20}")
    print(f"  {'Total P&L':<20} {f'{total_pnl:+.0f} pts':<20} {'-19 pts':<20}")
    print(f"  {'Max Drawdown':<20} {f'{max_dd:.0f} pts':<20} {'297 pts':<20}")
    print(f"  {'Avg Hold':<20} {f'{avg_hold*15:.0f} min':<20} {'26 min':<20}")
    print("-"*70)
    
    results = {
        "strategy": "Adeeb_BankNifty_15m",
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
        "parameters": {"ADX_BUY":ADX_BUY,"ADX_SELL":ADX_SELL,"ANTI_CHASE":ANTI_CHASE,"MAX_HOLD":MAX_HOLD,"TARGET_ATR":TARGET_ATR,"TRAIL_TRIGGER":TRAIL_TRIGGER,"MAX_DAILY":MAX_DAILY},
        "trades": trades,
    }
    with open("backtest_adeeb_banknifty_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to backtest_adeeb_banknifty_results.json")
