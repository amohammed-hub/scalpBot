"""
Stage 1 Backtester: 3 Proven Intraday Strategies for NIFTY 50
Uses 5-min candle data (38 trading days, May 25 - Jul 17, 2026)

Strategies:
1. Opening Range Breakout (ORB) — 15-min window
2. VWAP Mean Reversion — fade extreme deviations
3. EMA Pullback in Trend — enter on pullback to 9/21 EMA in trending market
"""

import json
import math
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple

# Load 5-min data
with open("/tmp/nifty_5m_6months.json") as f:
    raw_candles = json.load(f)

# Convert timestamps to IST (UTC+5:30)
IST_OFFSET = 5.5 * 3600  # seconds

def ts_to_ist(ts_ms):
    """Convert timestamp (ms) to IST datetime"""
    return datetime.utcfromtimestamp(ts_ms / 1000) + timedelta(hours=5, minutes=30)

def is_market_hours(dt):
    """Check if within NSE market hours (9:15 AM - 3:30 PM IST)"""
    t = dt.hour * 60 + dt.minute
    return 555 <= t <= 930  # 9:15 to 15:30

# Group candles by day
days_data: Dict[str, List[Dict]] = {}
for c in raw_candles:
    dt = ts_to_ist(c["timestamp"])
    if not is_market_hours(dt):
        continue
    day_key = dt.strftime("%Y-%m-%d")
    if day_key not in days_data:
        days_data[day_key] = []
    days_data[day_key].append({**c, "dt": dt})

print(f"Loaded {len(days_data)} trading days, {sum(len(v) for v in days_data.values())} candles")

# ============================================================
# INDICATOR CALCULATIONS
# ============================================================

def calc_ema(values, period):
    """Calculate EMA for a list of values"""
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema

def calc_vwap(candles):
    """Calculate VWAP from candles (cumulative)"""
    cum_vol = 0
    cum_tp_vol = 0
    vwaps = []
    for c in candles:
        tp = (c["high"] + c["low"] + c["close"]) / 3
        vol = max(c["volume"], 1)  # Avoid div by zero for index
        cum_vol += vol
        cum_tp_vol += tp * vol
        vwaps.append(cum_tp_vol / cum_vol if cum_vol > 0 else tp)
    return vwaps

def calc_atr(candles, period=14):
    """Calculate ATR"""
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(1, len(candles)):
        h = candles[i]["high"]
        l = candles[i]["low"]
        pc = candles[i-1]["close"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr

def calc_adx(candles, period=14):
    """Calculate ADX"""
    if len(candles) < period * 2 + 1:
        return None
    
    plus_dms = []
    minus_dms = []
    trs = []
    
    for i in range(1, len(candles)):
        h = candles[i]["high"]
        l = candles[i]["low"]
        ph = candles[i-1]["high"]
        pl = candles[i-1]["low"]
        pc = candles[i-1]["close"]
        
        plus_dm = max(h - ph, 0) if (h - ph) > (pl - l) else 0
        minus_dm = max(pl - l, 0) if (pl - l) > (h - ph) else 0
        tr = max(h - l, abs(h - pc), abs(l - pc))
        
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)
        trs.append(tr)
    
    if len(trs) < period:
        return None
    
    # Smoothed values
    smooth_plus_dm = sum(plus_dms[:period])
    smooth_minus_dm = sum(minus_dms[:period])
    smooth_tr = sum(trs[:period])
    
    dxs = []
    for i in range(period, len(trs)):
        smooth_plus_dm = smooth_plus_dm - smooth_plus_dm / period + plus_dms[i]
        smooth_minus_dm = smooth_minus_dm - smooth_minus_dm / period + minus_dms[i]
        smooth_tr = smooth_tr - smooth_tr / period + trs[i]
        
        if smooth_tr == 0:
            continue
        plus_di = 100 * smooth_plus_dm / smooth_tr
        minus_di = 100 * smooth_minus_dm / smooth_tr
        
        di_sum = plus_di + minus_di
        if di_sum == 0:
            dxs.append(0)
        else:
            dxs.append(100 * abs(plus_di - minus_di) / di_sum)
    
    if len(dxs) < period:
        return None
    
    adx = sum(dxs[:period]) / period
    for dx in dxs[period:]:
        adx = (adx * (period - 1) + dx) / period
    return adx

def calc_rsi(closes, period=14):
    """Calculate RSI"""
    if len(closes) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    
    if len(gains) < period:
        return None
    
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

# ============================================================
# TRADE SIMULATION
# ============================================================

class Trade:
    def __init__(self, direction, entry_price, entry_time, sl, tp, strategy, lot_size=75):
        self.direction = direction  # "BUY" or "SELL"
        self.entry_price = entry_price
        self.entry_time = entry_time
        self.sl = sl
        self.tp = tp
        self.strategy = strategy
        self.lot_size = lot_size
        self.exit_price = None
        self.exit_time = None
        self.pnl = 0
        self.exit_reason = ""
    
    def check_exit(self, candle):
        """Check if trade should exit on this candle"""
        if self.direction == "BUY":
            if candle["low"] <= self.sl:
                self.exit_price = self.sl
                self.exit_time = candle["dt"]
                self.pnl = (self.sl - self.entry_price) * self.lot_size
                self.exit_reason = "SL"
                return True
            if candle["high"] >= self.tp:
                self.exit_price = self.tp
                self.exit_time = candle["dt"]
                self.pnl = (self.tp - self.entry_price) * self.lot_size
                self.exit_reason = "TP"
                return True
        else:  # SELL
            if candle["high"] >= self.sl:
                self.exit_price = self.sl
                self.exit_time = candle["dt"]
                self.pnl = (self.entry_price - self.sl) * self.lot_size
                self.exit_reason = "SL"
                return True
            if candle["low"] <= self.tp:
                self.exit_price = self.tp
                self.exit_time = candle["dt"]
                self.pnl = (self.entry_price - self.tp) * self.lot_size
                self.exit_reason = "TP"
                return True
        return False
    
    def force_exit(self, price, time, reason="EOD"):
        """Force exit at end of day"""
        self.exit_price = price
        self.exit_time = time
        if self.direction == "BUY":
            self.pnl = (price - self.entry_price) * self.lot_size
        else:
            self.pnl = (self.entry_price - price) * self.lot_size
        self.exit_reason = reason

# ============================================================
# STRATEGY 1: Opening Range Breakout (ORB)
# ============================================================

def strategy_orb(day_candles) -> List[Trade]:
    """
    Opening Range Breakout - 15 min window (first 3 five-min candles)
    Rules:
    - Define range: High/Low of first 15 minutes (9:15-9:30)
    - BUY: When 5m candle closes above range high
    - SELL: When 5m candle closes below range low
    - SL: Opposite end of range
    - TP: 1.5x the range size from entry
    - Time filter: Only enter before 12:00 IST
    - Max 1 trade per day
    """
    trades = []
    if len(day_candles) < 4:
        return trades
    
    # First 3 candles = 15 min opening range (9:15, 9:20, 9:25)
    or_candles = [c for c in day_candles if c["dt"].hour == 9 and c["dt"].minute < 30]
    if len(or_candles) < 3:
        return trades
    
    range_high = max(c["high"] for c in or_candles[:3])
    range_low = min(c["low"] for c in or_candles[:3])
    range_size = range_high - range_low
    
    # Skip if range is too small (< 10 pts) or too large (> 100 pts)
    if range_size < 10 or range_size > 100:
        return trades
    
    # Look for breakout after 9:30
    active_trade = None
    for c in day_candles:
        if c["dt"].hour == 9 and c["dt"].minute < 30:
            continue  # Skip opening range period
        
        # Time filter: no new entries after 12:00
        if c["dt"].hour >= 12 and active_trade is None:
            break
        
        # Check exit for active trade
        if active_trade:
            if active_trade.check_exit(c):
                trades.append(active_trade)
                active_trade = None
            continue
        
        # Look for breakout
        if c["close"] > range_high and active_trade is None:
            # Bullish breakout
            sl = range_low
            tp = c["close"] + 1.5 * range_size
            active_trade = Trade("BUY", c["close"], c["dt"], sl, tp, "ORB")
            
        elif c["close"] < range_low and active_trade is None:
            # Bearish breakout
            sl = range_high
            tp = c["close"] - 1.5 * range_size
            active_trade = Trade("SELL", c["close"], c["dt"], sl, tp, "ORB")
    
    # Force exit at EOD
    if active_trade and day_candles:
        last = day_candles[-1]
        active_trade.force_exit(last["close"], last["dt"])
        trades.append(active_trade)
    
    return trades

# ============================================================
# STRATEGY 2: VWAP Mean Reversion
# ============================================================

def strategy_vwap_reversion(day_candles) -> List[Trade]:
    """
    VWAP Mean Reversion
    Rules:
    - Calculate running VWAP
    - BUY: When price drops > 0.3% below VWAP AND RSI < 30
    - SELL: When price rises > 0.3% above VWAP AND RSI > 70
    - SL: 0.2% beyond entry (tight)
    - TP: VWAP level (mean reversion target)
    - Time filter: Only 9:45 - 14:30 (skip first 30 min, last hour)
    - Max 3 trades per day
    """
    trades = []
    if len(day_candles) < 10:
        return trades
    
    vwaps = calc_vwap(day_candles)
    closes = [c["close"] for c in day_candles]
    
    active_trade = None
    trade_count = 0
    
    for i in range(6, len(day_candles)):  # Start after 30 min warmup
        c = day_candles[i]
        dt = c["dt"]
        
        # Time filter: 9:45 - 14:30
        t_min = dt.hour * 60 + dt.minute
        if t_min < 585 or t_min > 870:  # 9:45 to 14:30
            if active_trade:
                active_trade.force_exit(c["close"], dt)
                trades.append(active_trade)
                active_trade = None
            continue
        
        # Check exit
        if active_trade:
            if active_trade.check_exit(c):
                trades.append(active_trade)
                active_trade = None
            continue
        
        if trade_count >= 3:
            continue
        
        vwap = vwaps[i]
        price = c["close"]
        deviation = (price - vwap) / vwap
        
        # Calculate RSI on last 14 candles
        rsi = calc_rsi(closes[max(0, i-14):i+1], 14)
        if rsi is None:
            continue
        
        # BUY signal: price far below VWAP + oversold
        if deviation < -0.003 and rsi < 35:
            sl = price * 0.998  # 0.2% below
            tp = vwap  # Target VWAP
            active_trade = Trade("BUY", price, dt, sl, tp, "VWAP_Reversion")
            trade_count += 1
        
        # SELL signal: price far above VWAP + overbought
        elif deviation > 0.003 and rsi > 65:
            sl = price * 1.002  # 0.2% above
            tp = vwap  # Target VWAP
            active_trade = Trade("SELL", price, dt, sl, tp, "VWAP_Reversion")
            trade_count += 1
    
    # Force exit at EOD
    if active_trade and day_candles:
        last = day_candles[-1]
        active_trade.force_exit(last["close"], last["dt"])
        trades.append(active_trade)
    
    return trades

# ============================================================
# STRATEGY 3: EMA Pullback in Trend
# ============================================================

def strategy_ema_pullback(day_candles) -> List[Trade]:
    """
    EMA Pullback in Trend
    Rules:
    - Trend: 9 EMA > 21 EMA (bullish) or 9 EMA < 21 EMA (bearish)
    - Confirmation: ADX > 20 (trending market)
    - BUY: In uptrend, when price pulls back to touch/cross 9 EMA then bounces
    - SELL: In downtrend, when price pulls back to touch/cross 9 EMA then rejects
    - SL: Beyond 21 EMA (or 0.15% from entry)
    - TP: 2x risk (2:1 RR)
    - Time filter: 9:45 - 14:30
    - Max 2 trades per day
    """
    trades = []
    if len(day_candles) < 22:
        return trades
    
    closes = [c["close"] for c in day_candles]
    active_trade = None
    trade_count = 0
    
    for i in range(21, len(day_candles)):
        c = day_candles[i]
        dt = c["dt"]
        
        # Time filter
        t_min = dt.hour * 60 + dt.minute
        if t_min < 585 or t_min > 870:
            if active_trade:
                active_trade.force_exit(c["close"], dt)
                trades.append(active_trade)
                active_trade = None
            continue
        
        # Check exit
        if active_trade:
            if active_trade.check_exit(c):
                trades.append(active_trade)
                active_trade = None
            continue
        
        if trade_count >= 2:
            continue
        
        # Calculate EMAs
        ema9 = calc_ema(closes[max(0, i-20):i+1], 9)
        ema21 = calc_ema(closes[max(0, i-30):i+1], 21)
        
        if ema9 is None or ema21 is None:
            continue
        
        # Calculate ADX (need enough history)
        adx_candles = day_candles[max(0, i-40):i+1]
        adx = calc_adx(adx_candles, 8)  # Use shorter period for intraday
        
        # Trend determination
        is_uptrend = ema9 > ema21
        is_downtrend = ema9 < ema21
        is_trending = adx is not None and adx > 20
        
        if not is_trending:
            continue
        
        price = c["close"]
        prev_close = closes[i-1]
        
        # BUY: Uptrend + price touched/crossed below 9 EMA then bounced back
        if is_uptrend and prev_close <= ema9 * 1.001 and price > ema9:
            # Pullback to EMA confirmed with bounce
            sl = ema21 - 5  # Below 21 EMA
            risk = price - sl
            if risk > 0 and risk < price * 0.003:  # Max 0.3% risk
                tp = price + 2 * risk  # 2:1 RR
                active_trade = Trade("BUY", price, dt, sl, tp, "EMA_Pullback")
                trade_count += 1
        
        # SELL: Downtrend + price touched/crossed above 9 EMA then rejected
        elif is_downtrend and prev_close >= ema9 * 0.999 and price < ema9:
            sl = ema21 + 5  # Above 21 EMA
            risk = sl - price
            if risk > 0 and risk < price * 0.003:
                tp = price - 2 * risk  # 2:1 RR
                active_trade = Trade("SELL", price, dt, sl, tp, "EMA_Pullback")
                trade_count += 1
    
    # Force exit at EOD
    if active_trade and day_candles:
        last = day_candles[-1]
        active_trade.force_exit(last["close"], last["dt"])
        trades.append(active_trade)
    
    return trades

# ============================================================
# RUN BACKTEST
# ============================================================

def compute_metrics(trades: List[Trade]) -> Dict:
    """Compute strategy performance metrics"""
    if not trades:
        return {"total_trades": 0, "win_rate": 0, "profit_factor": 0, 
                "total_pnl": 0, "max_drawdown": 0, "sharpe": 0, "avg_win": 0, "avg_loss": 0}
    
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    
    total_pnl = sum(t.pnl for t in trades)
    gross_profit = sum(t.pnl for t in wins) if wins else 0
    gross_loss = abs(sum(t.pnl for t in losses)) if losses else 1
    
    # Max drawdown
    equity_curve = []
    running_pnl = 0
    for t in trades:
        running_pnl += t.pnl
        equity_curve.append(running_pnl)
    
    peak = 0
    max_dd = 0
    for eq in equity_curve:
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
    
    # Sharpe ratio (daily returns)
    daily_pnls = {}
    for t in trades:
        day = t.entry_time.strftime("%Y-%m-%d")
        daily_pnls[day] = daily_pnls.get(day, 0) + t.pnl
    
    daily_returns = list(daily_pnls.values())
    if len(daily_returns) > 1:
        avg_return = sum(daily_returns) / len(daily_returns)
        std_return = (sum((r - avg_return)**2 for r in daily_returns) / (len(daily_returns) - 1)) ** 0.5
        sharpe = (avg_return / std_return * math.sqrt(252)) if std_return > 0 else 0
    else:
        sharpe = 0
    
    # Max drawdown as percentage of peak equity (use capital base of 500000)
    capital = 500000  # 5 lakh capital base
    max_dd_pct = (max_dd / capital) * 100
    
    return {
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": len(wins) / len(trades) * 100,
        "profit_factor": gross_profit / gross_loss if gross_loss > 0 else float('inf'),
        "total_pnl": round(total_pnl, 0),
        "avg_win": round(gross_profit / len(wins), 0) if wins else 0,
        "avg_loss": round(-gross_loss / len(losses), 0) if losses else 0,
        "max_drawdown": round(max_dd, 0),
        "max_dd_pct": round(max_dd_pct, 2),
        "sharpe": round(sharpe, 2),
        "expectancy": round(total_pnl / len(trades), 0)
    }

# Run all strategies
print("=" * 70)
print("BACKTEST RESULTS — 3 STRATEGIES ON NIFTY 50 (5-min, 38 trading days)")
print("=" * 70)
print(f"Period: May 25 - Jul 17, 2026 | Lot size: 75 (Nifty futures)")
print(f"Capital base: ₹5,00,000 | Trading days: {len(days_data)}")
print()

strategies = {
    "ORB (15-min)": strategy_orb,
    "VWAP Mean Reversion": strategy_vwap_reversion,
    "EMA Pullback in Trend": strategy_ema_pullback
}

all_results = {}

for name, strategy_fn in strategies.items():
    all_trades = []
    for day_key in sorted(days_data.keys()):
        day_trades = strategy_fn(days_data[day_key])
        all_trades.extend(day_trades)
    
    metrics = compute_metrics(all_trades)
    all_results[name] = {"trades": all_trades, "metrics": metrics}
    
    print(f"\n{'─' * 50}")
    print(f"STRATEGY: {name}")
    print(f"{'─' * 50}")
    print(f"  Total Trades:    {metrics['total_trades']}")
    print(f"  Wins/Losses:     {metrics['wins']}/{metrics['losses']}")
    print(f"  Win Rate:        {metrics['win_rate']:.1f}%")
    print(f"  Profit Factor:   {metrics['profit_factor']:.2f}")
    print(f"  Total P&L:       ₹{metrics['total_pnl']:,.0f}")
    print(f"  Avg Win:         ₹{metrics['avg_win']:,.0f}")
    print(f"  Avg Loss:        ₹{metrics['avg_loss']:,.0f}")
    print(f"  Expectancy/Trade:₹{metrics['expectancy']:,.0f}")
    print(f"  Max Drawdown:    ₹{metrics['max_drawdown']:,.0f} ({metrics['max_dd_pct']:.2f}%)")
    print(f"  Sharpe Ratio:    {metrics['sharpe']:.2f}")
    
    # Show sample trades
    print(f"\n  Sample trades (first 5):")
    for t in all_trades[:5]:
        print(f"    {t.entry_time.strftime('%m/%d %H:%M')} {t.direction} @ {t.entry_price:.1f} → "
              f"{t.exit_price:.1f} ({t.exit_reason}) P&L: ₹{t.pnl:,.0f} [{t.strategy}]")

# Summary comparison
print(f"\n\n{'=' * 70}")
print("SUMMARY COMPARISON")
print(f"{'=' * 70}")
print(f"{'Strategy':<25} {'Trades':<8} {'Win%':<8} {'PF':<8} {'P&L':<12} {'MaxDD%':<8} {'Sharpe':<8}")
print(f"{'─' * 70}")
for name, data in all_results.items():
    m = data["metrics"]
    pf_str = f"{m['profit_factor']:.2f}" if m['profit_factor'] < 100 else "∞"
    print(f"{name:<25} {m['total_trades']:<8} {m['win_rate']:.1f}%{'':>2} {pf_str:<8} ₹{m['total_pnl']:>8,.0f}  {m['max_dd_pct']:.2f}%{'':>2} {m['sharpe']:.2f}")

# Deployment criteria check
print(f"\n\n{'=' * 70}")
print("DEPLOYMENT CRITERIA CHECK")
print(f"{'=' * 70}")
print(f"{'Strategy':<25} {'WR>55%':<10} {'PF>1.3':<10} {'DD<15%':<10} {'PASS?':<8}")
print(f"{'─' * 70}")
for name, data in all_results.items():
    m = data["metrics"]
    wr_pass = m["win_rate"] > 55
    pf_pass = m["profit_factor"] > 1.3
    dd_pass = m["max_dd_pct"] < 15
    all_pass = wr_pass and pf_pass and dd_pass
    print(f"{name:<25} {'✅' if wr_pass else '❌':<10} {'✅' if pf_pass else '❌':<10} {'✅' if dd_pass else '❌':<10} {'✅ DEPLOY' if all_pass else '❌ FAIL'}")

print(f"\nNote: These results are on 38 days of data. 6-month validation pending.")
