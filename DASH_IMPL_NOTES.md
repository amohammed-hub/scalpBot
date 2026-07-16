# Dashboard Improvements Implementation Notes

## Features to Implement:
1. Averaging Status Indicator — show in Open Positions panel when trade.averageCount > 0
2. Signal History/Rejected Signals — store in state.recentRejectedSignals (ring buffer of 10)
3. Market Session Timer — countdown to open/close with progress bar
4. Today's Best/Worst Trade — from todayClosed array, find max/min P&L
5. Averaging Toggle in Settings — averagingEnabled + averagingLossThreshold
6. Auto-hide Paper-to-Live Readiness — check if user has any live trades in DB

## Key Locations:
- BotState interface: line 99 (already added recentRejectedSignals + averaging settings)
- Signal rejection points (need to push to buffer):
  - Line 2735-2738: Layer disabled
  - Line 2742-2744: HourlyClose already fired
  - Line 2893-2897: Exposure cap (already logged to journal)
  - Line 2625-2628: Max trades per day
  - Line 2634-2636: StoplossGuard
  - Line 2642-2646: Portfolio drawdown halt
  - Line 2649-2652: Cooldown
  - Line 2659-2661: Re-entry cooldown
- liveData endpoint: line 1033-1119 (need to add recentRejectedSignals + averaging fields to response)
- Dashboard.tsx: 3189 lines
  - Top metrics: ~line 1140-1260
  - Open Positions: ~line 1335-1430
  - Paper-to-Live Readiness: ~line 2715-2754
  - Signal panel: ~line 1934-2010
  - Bot config: ~line 2272-2648

## Strategy for rejected signals:
- Add helper function pushRejectedSignal(state, signal, reason) that maintains a max-10 ring buffer
- Call it at each rejection point where signal.direction !== "HOLD"
- Expose via liveData endpoint
- Display in a small collapsible panel on dashboard

## Strategy for averaging toggle:
- Add to Settings page: enable/disable toggle + loss threshold slider (10-50%)
- Pass to bot start config
- In botEngine.ts averaging section (line ~2355), check state.averagingEnabled before proceeding

## Strategy for auto-hide readiness:
- In Dashboard.tsx, check if user has any live closed trades (mode === "live" && status === "closed")
- If yes, hide the Paper-to-Live Readiness panel entirely
- Can use the existing trade log data already fetched

## Strategy for market session timer:
- Calculate IST time, determine session start/end based on MCX vs NSE
- Show progress bar + countdown in minutes
- Place above or near the market status badge

## Strategy for best/worst trade:
- From todayClosed array (already computed in Dashboard), find max and min pnl
- Show as 2 small cards in the top metrics row
