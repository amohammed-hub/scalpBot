# ScalpBot — AI-Powered Options Scalping

## India's Most Advanced Algorithmic Scalping System

---

## What is ScalpBot?

ScalpBot is a fully automated options scalping system designed for NIFTY, BANKNIFTY, and MCX markets. It combines 15+ proven trading strategies into a single intelligent engine that monitors markets in real-time, identifies high-probability setups, and executes trades with precision.

**Key Highlights:**
- 15+ strategy layers running simultaneously
- Real-time market monitoring (1-min + 5-min candles)
- Automatic entry, exit, and risk management
- Paper trading mode for risk-free testing
- Live trading via Upstox API integration
- Telegram alerts for every trade

---

## ⚡ The Adeeb Engine — Our Proprietary Trading Brain

**The crown jewel of ScalpBot.** The Adeeb Strategy is our proprietary, multi-layer signal engine that combines 5 proven methods into one ultra-high-accuracy system. It's what sets ScalpBot apart from every other trading bot in India.

### How It Works — 5 Layers of Confirmation

| Step | Method | Purpose |
|------|--------|---------|
| 1 | **ADX Regime Detection** | Only trades when market is trending (ADX > 20) |
| 2 | **CPR Daily Bias** | Determines bullish/bearish direction from previous day's levels |
| 3 | **Renko Trend Confirmation** | Requires 3+ consecutive same-color bricks for trend validity |
| 4 | **EMA Cloud Pullback** | Enters ONLY on pullback to EMA(9/21) cloud — never chases |
| 5 | **Crude Oil Correlation** | Optional confidence boost from cross-market analysis |

### Why Adeeb is Different

- **Anti-Chase Logic:** Will NOT enter if price is more than 0.3% away from the EMA cloud. No FOMO trades.
- **Multi-Confirmation:** ALL 5 conditions must align before a trade is taken. This means fewer trades, but dramatically higher win rate.
- **Adaptive Exits:** Exits on opposite Renko brick, EMA cloud break, OR 20-minute max hold — whichever comes first.
- **Premium Target:** +40% premium gain target with -30% stop loss — asymmetric risk/reward.

### Backtest Performance (Target)

| Metric | Target |
|--------|--------|
| Profit Factor | > 1.5 |
| Win Rate | Higher than individual strategies |
| Trade Frequency | Fewer, more selective trades |
| Max Drawdown | Controlled via multi-layer confirmation |

*Backtest stats will be updated once 56-day validation is complete.*

### Availability

The Adeeb Strategy is available exclusively to **6-month plan subscribers and above**. It's enabled by default for premium users and represents the highest tier of ScalpBot's intelligence.

---

## Strategy Arsenal (15+ Layers)

ScalpBot doesn't rely on a single approach. It runs multiple strategies simultaneously and picks the highest-confidence signal at any given moment:

| # | Strategy | Type | Best For |
|---|----------|------|----------|
| 1 | Breakout | Momentum | Range breakouts with volume |
| 2 | Pattern | Price Action | Engulfing, hammer, doji patterns |
| 3 | Trend (Supertrend) | Trend Following | Strong directional moves |
| 4 | Momentum (RSI) | Mean Reversion | Overbought/oversold bounces |
| 5 | MACD + Bollinger | Squeeze | Volatility expansion trades |
| 6 | ORB (Opening Range) | Institutional | 9:15-9:30 AM breakout |
| 7 | VWAP Reversion | Institutional | Mean reversion to VWAP |
| 8 | VWAP Pullback | Institutional | Trend continuation at VWAP |
| 9 | Booming Bulls | Multi-Factor | ADX + Supertrend + Pivot |
| 10 | CPR | Pivot-Based | Central Pivot Range levels |
| 11 | Red Bar Theory | Renko | 3-brick trend confirmation |
| 12 | Trikal Strategy | Advanced Renko | EMA cloud + Renko pullback |
| 13 | Failed Breakout | Reversal | Trap detection |
| 14 | Opening Burst | Momentum | 9:15-9:25 AM momentum |
| 15 | **⚡ Adeeb** | **Proprietary** | **Multi-layer premium engine** |

---

## Risk Management

ScalpBot includes institutional-grade risk controls:

- **Daily Loss Limit:** Auto-stops bot when daily P&L hits -2% (configurable)
- **Per-Trade Risk:** Maximum 2% of capital per trade
- **Trailing Stop Loss:** Locks in profits as trade moves in your favor
- **Partial Profit Booking:** Books 50% at first target, 25% at second
- **Cooldown Logic:** Prevents revenge trading after stop losses
- **Direction-Aware Blocking:** Blocks same-direction re-entry after consecutive losses
- **Portfolio Drawdown Guard:** Pauses all bots if portfolio drops below threshold

---

## Multi-Bot Architecture

Run up to 3 bots simultaneously (4 with referral bonus):

- **Bot 1:** NIFTY 50 options
- **Bot 2:** BANKNIFTY options  
- **Bot 3:** MCX Crude/Gold/Silver

Each bot operates independently with its own strategy selection, risk parameters, and P&L tracking.

---

## Pricing Plans

| Plan | Duration | Bots | Strategies | Adeeb Engine |
|------|----------|------|------------|--------------|
| Starter | 1 Month | 2 | 12 layers | ❌ |
| Pro | 3 Months | 3 | All layers | ❌ |
| Elite | 6 Months | 3 | All layers | ✅ |
| Lifetime | 12 Months | 3 | All layers | ✅ |

---

## Technology Stack

- **Backend:** Node.js + Express + tRPC
- **Frontend:** React 19 + Tailwind CSS 4
- **Data:** Upstox API (real-time candles + order execution)
- **Alerts:** Telegram Bot API
- **Database:** TiDB (MySQL-compatible, cloud-native)
- **Hosting:** Railway (auto-scaling)

---

## Getting Started

1. Sign up at ScalpBot
2. Connect your Upstox account (API key)
3. Configure your risk parameters
4. Start with Paper Trading mode
5. Go live when confident

---

## Contact

- **Telegram:** @ScalpBotSupport
- **Email:** support@scalpbot.in

---

*ScalpBot is for educational and informational purposes. Trading involves risk. Past performance does not guarantee future results. Always trade with capital you can afford to lose.*
