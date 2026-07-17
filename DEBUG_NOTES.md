# Debug Notes - Bot Crash Investigation

## User's Report (Jul 17, 2026 8:50 PM IST)
- Bot 1 and Bot 3 start (success toast shows) then immediately show "Stopped/Inactive"
- Bot 2 (slot 1) runs fine with Crude Oil, +₹2114
- Railway deploy: commit 9a18cc07, scalpbot.up.railway.app
- Railway logs show ONLY slot1 activity, NO logs for slot0 or slot2 start

## Key Finding: startMutation for slot 0 is MISSING telegramBotToken/telegramChatId
Looking at handleQuickStart (Dashboard.tsx line 333-356):
- Slot 0 calls `startMutation.mutate({...})` but does NOT pass telegramBotToken, telegramChatId, telegramEnabled
- Slot 1/2 calls `startSecondaryMutation.mutate({...})` and DOES pass telegramBotToken, telegramChatId, telegramEnabled

The bot.start procedure's input schema has these as OPTIONAL (z.string().optional()), so this shouldn't cause a crash.

## Real Issue Theory
The bot.start procedure on the backend SUCCEEDS (writes "running" to DB, calls startBot). 
The first tick runs. But something in the tick crashes.

The Railway logs show NO error messages for slot0/slot2. This means either:
1. The bot.start API call never reaches the server (frontend issue)
2. The server crashes silently (no log output before crash)
3. The Railway deploy is on an older version without our latest fixes

## Code Path Analysis
- tick() has try-catch that logs errors
- setInterval catch handler counts errors, auto-restarts after 3
- generateSignal has empty candles guard
- All signal generators have insufficient data guards
- P1 cooldown has `if (state.lastSlExitAt && state.lastSlExitDirection)` guard
- P0 ORB freshness gate uses `orb.breakoutCandleIndex >= 0` guard

## MISSING: Telegram params for slot 0
The startMutation for slot 0 doesn't pass telegram params. The backend schema has defaults:
- telegramBotToken: z.string().optional()
- telegramChatId: z.string().optional()
- telegramEnabled: z.boolean().default(false)

This shouldn't crash but means slot 0 won't get Telegram alerts.

## Next Steps
1. Add telegram params to slot 0 startMutation call
2. Add more defensive logging at the VERY START of the tick function
3. Check if the issue is Railway-specific (process restart during deploy)
