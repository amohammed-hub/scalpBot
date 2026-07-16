# Averaging/DCA Strategy Design

## User's Request:
- Bot entered CRUDEOIL 16JUL26 7750 CE at ₹59 (paper)
- Price dropped to ~₹28-30
- Then bounced to ₹51 (and now at ₹43.80)
- If bot had averaged down at ₹30 (when reversal candles appeared), avg entry would be ~₹44.5
- The bounce to ₹51 would have been profitable instead of still in loss
- User says: "If the candles give clear indicator then we can buy at the low price and do the averaging"

## Design:

### When to Average:
1. Open trade exists and is in LOSS (price dropped > 25% from entry for options)
2. Candles show CLEAR reversal signal at the bottom:
   - 2+ consecutive green candles (for BUY trades)
   - RSI < 30 (deeply oversold) turning up
   - Price near/at a support level or VWAP
   - Volume spike on the reversal candles (institutional buying)
3. Trade age is between 5-15 minutes (not too early, not too late for theta decay)

### How to Average:
1. Buy same quantity again at current lower price
2. New average entry = (old_entry * old_qty + new_price * new_qty) / (old_qty + new_qty)
3. Adjust SL: new SL = new_average - ATR * 1.0 (tighter than original)
4. Adjust Target: new target = new_average + ATR * 1.5 (lower target since we're recovering)
5. Update partial booking levels based on new average

### Safety Guards:
- MAX 1 averaging attempt per trade (don't keep averaging into oblivion)
- Only average if remaining capital allows (don't exceed risk limits)
- Don't average if price has dropped > 50% from entry (too far gone)
- Don't average in last 30 min before market close
- Don't average if daily loss limit is close to being hit

### Fields to Add to OpenTrade:
- averageCount: number (0 = no averaging done, 1 = averaged once)
- averagedAt?: number (timestamp of last averaging)
- originalEntryPrice: number (keep track of first entry for analytics)
- totalInvested: number (total capital deployed including averaging)

### Fields to Add to BotState:
- No new fields needed (use existing capital/risk settings)

### Implementation Location:
- In the open trade monitoring section (after partial booking, before trailing SL)
- Between lines ~2338 and ~2350 in current botEngine.ts
- Check if trade is in loss → check if reversal signal → execute averaging

### DB Persistence:
- Overwrite entryPrice with new weighted average (simplest approach)
- Overwrite quantity with new total quantity
- Overwrite slPrice/targetPrice with new levels
- This way botRestart.ts automatically picks up the averaged state

### Live Mode:
- Place a new BUY order via Upstox for the additional quantity
- If order fails, don't update state (same pattern as partial booking)

### Telegram Alert:
- Send alert when averaging: "📊 AVERAGING DOWN — bought X more @ ₹Y | New avg: ₹Z"
