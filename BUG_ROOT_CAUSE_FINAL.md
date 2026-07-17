# Bot 1 (slot0) Pausing Bug — Final Root Cause Analysis

## Date: Jul 17, 2026

## Railway Logs Evidence (16:55-16:58 UTC)
```
[allStatus] slot0 (8d17c6ad): inMem=paused | db=running → paused
[allStatus] slot1 (8d17c6ad): inMem=running | db=running → running
[allStatus] slot2 (8d17c6ad): inMem=running | db=running → running

[tick] START — 8d17c6ad | status=running | candles=400 | openTrade=false
[tick] CANDLES OK — 8d17c6ad | price=216581 | candles1m=400 | 5m=80
[tick] PRE-SIGNAL — 8d17c6ad | powerHour=false | mcxEve=false | mcxLate=true
[tick] SIGNAL OK — 8d17c6ad | dir=HOLD | conf=0.00 | layer=None
[tick] SKIP — status=paused (8d17c6ad)   ← 5 seconds later!

[tick] START — 712791db | status=running | candles=375 | openTrade=false
[tick] ⚠ Daily loss limit already reached — 712791db | dailyPnl=₹-1682 | maxLoss=₹-1500 — Bot will only pause on NEW losses
[tick] SIGNAL OK — 712791db | dir=HOLD | conf=0.00 | layer=None
```

## Root Cause: Portfolio Drawdown Check with GLOBAL Flag

### The Bug Flow:
1. Bot 3 (712791db) has dailyPnl = -₹1682
2. Bot 1 (8d17c6ad) also has some loss
3. When ANY bot's tick calls `checkPortfolioDrawdown()`:
   - It aggregates dailyPnl across ALL running bots for the same base session
   - If aggregate exceeds limit → sets MODULE-LEVEL `portfolioHalted = true`
4. Bot 1's tick passes the portfolio check on tick N (because tickCount was <= 1 on first tick)
5. But on tick N+1 (tickCount > 1), the `portfolioHalted` flag is STILL true
6. Bot 1 gets paused at line 3157: `state.status = "paused"`
7. The interval timer keeps running (NOT cleared on pause)
8. Next tick sees status=paused → SKIP

### Why the dailyLossAcknowledged Fix Didn't Cover This:
The fix at line 2374 only covers the INDIVIDUAL daily loss limit check.
The PORTFOLIO drawdown check at line 3155-3163 has a DIFFERENT grace mechanism:
- It only skips pause on `tickCount <= 1` (first tick)
- After the first tick, it pauses on EVERY tick where portfolioHalted is true
- The `dailyLossAcknowledged` flag is NOT checked here

### Why Bot 3 (slot2) Works But Bot 1 (slot0) Doesn't:
- Bot 3's individual dailyPnl (-₹1682) exceeds its own limit → dailyLossAcknowledged fires → warns but doesn't pause
- Bot 1's individual dailyPnl might be fine, but the PORTFOLIO aggregate (Bot 1 + Bot 3) exceeds the limit
- The portfolio check pauses Bot 1 because it's a different code path that doesn't use dailyLossAcknowledged

## The Fix

### Option A (Recommended): Never PAUSE on portfolio drawdown — just block new trades
The user's philosophy: "the bot is the servant, not the gatekeeper"
If the user manually started the bot knowing about losses, don't pause it.
Just prevent opening NEW trades when portfolio limit is hit.

### Implementation:
In botEngine.ts line 3155-3163, change from:
```typescript
if (ddCheck.halted) {
    if ((state.tickCount ?? 0) > 1) {
      state.status = "paused";
      state.lastError = ddCheck.reason ?? "Portfolio daily drawdown limit hit";
      emitActivity(state.sessionToken, "error", `🛑 ${ddCheck.reason}`);
      return;
    }
    // ... warning on first tick
}
```

To:
```typescript
if (ddCheck.halted) {
    // Never pause — just block new trade entries (handled below by returning HOLD signal)
    // Log warning periodically (every 10 ticks) so user knows
    if ((state.tickCount ?? 0) % 10 === 1) {
      console.warn(`[tick] ⚠ Portfolio drawdown active — ${state.sessionToken.slice(0,8)} | ${ddCheck.reason} — blocking new trades only`);
    }
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: ddCheck.reason ?? "Portfolio drawdown limit", layer: "None" };
    return; // Skip signal generation but DON'T pause
}
```

### Also fix maxTradesPerDay (line 3134-3142):
Same issue — don't pause, just block new trades:
```typescript
if (state.tradesCount >= state.maxTradesPerDay) {
    // Don't pause — just skip trade entry. Bot continues monitoring.
    state.lastSignal = { direction: "HOLD", confidence: 0, entryPrice: price, slPrice: price, targetPrice: price, atr: 0, reason: `Max trades reached (${state.tradesCount}/${state.maxTradesPerDay})`, layer: "None" };
    return;
}
```

## Additional Issue Found: Multiple Bot Instances
The logs show ticks 5 seconds apart for the same token (8d17c6ad), with DIFFERENT prices (216581 vs 113901).
This suggests multiple interval timers running for the same bot, possibly from:
- Watchdog restarting a bot that was already in memory (shouldn't happen based on code)
- Multiple bot_sessions rows in DB with status=running for the same token
- Auto-restart creating duplicate intervals

This is a secondary issue — the primary fix (don't pause on portfolio drawdown) will prevent the oscillation.
