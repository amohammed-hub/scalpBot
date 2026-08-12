# Bot 4 trade-counter vs trade-log mismatch — investigation notes (Aug 12, 2026)

## Facts from production DB (Railway, project e80b3c31..., environment production)
- Running bot_sessions (all owned by admin token 8d17c6ad-...):
  - id=27 MCX_NATGAS botSlot=3 tradesCount=2 (user calls this "Bot 4" — slot3 = 4th bot)
  - id=26 MCX_SILVER botSlot=2 tradesCount=1
  - id=25 MCX_CRUDE botSlot=0 tradesCount=4
  - id=24 MCX_GOLD botSlot=1 tradesCount=2
  - id=23 MCX_COPPER botSlot=4 tradesCount=5
  - id=19-21 SENSEX/BANKNIFTY/NIFTY (botSlot 0/1/2) tradesCount=0
- ALL running sessions store the BASE sessionToken (no -slotN suffix!) in bot_sessions.sessionToken.
  Only botSlot distinguishes them. Old primary bot.start (line ~410) and possibly the older
  secondaryBot router insert/update sessionToken = input.sessionToken (base) without suffix.
- trade_log rows ARE written with correct -slotN tokens for secondary bots (secondaryBot.start
  at routers.ts ~3331 constructs slotToken = base-slotN and writes it; multiBots.startSlot at 2879
  also uses slotToken correctly). Example: slot4 has 10 trades today, slot0 9, slot1 7, slot3 7, slot2 4.
- BUT running bot_sessions rows use base token → allStatus tradesCount fallback:
  `tradesCount: inMem?.tradesCount ?? todayTradeCounts[tok] ?? 0`
  where todayTradeCounts keyed by slot token. In-memory tradesCount for NATGAS bot = 2 (legacy
  primary-bot counters that increment on entry and are restored from DB count under BASE token on
  restart — routers.ts bot.start line ~644 counts trades under input.sessionToken (base), so the
  legacy slot-3 bot's restored tradesCount includes base-token trades that don't belong to it.
  Also todayStats/trades.list include all tokens but the CARD counts come from allStatus which
  falls back to in-memory counts for running bots → shows stale/wrong counts.

## Root cause
Running secondary (MCX) bots were started via the OLD flow (primary bot.start with botSlot=N,
no slot suffix) — their bot_sessions.sessionToken is the BASE token. In-memory state is keyed by
base token too. Card tradesCount reads in-memory count (2) while the TRADE LOG groups by the
-slotN token (0 for slot4) — the two counts are computed against DIFFERENT token keys.

## Why no NATGAS trades triggered (related user complaint)
Slot-3 NATGAS bot uses base token in-memory; its state shares the token namespace with slot-0
CRUDE → cross-bot anti-chasing/regime counters shared? Actually in-memory states are per-token,
so NATGAS state is at base token — CRUDE bot (slot0) runs at base token? NO — CRUDE id=25 also
base token! Both MCX_CRUDE and MCX_NATGAS running at the SAME base token → they SHARE one
in-memory state → last instrument wins, signals for the other get lost, counters collide.
CRUDE has 4 trades today (consistent), NATGAS none — because NATGAS tick loop is the same
state object as CRUDE's; whichever started last owns the scan.

## Fix plan (multiBots.startSlot / legacy starts)
1. Migrate running bot_sessions rows whose sessionToken lacks -slotN suffix to use the correct
   slot-token key (botSlot>0 → base-slotN) in DB (bot_sessions + trade_log rows belonging to
   that bot should already be under slot token; verify).
2. Ensure multiBots.startSlot + primary bot.start cannot collide: if input.botSlot>0, force
   slotToken usage; block starting two bots under the same token key.
3. allStatus fallback should key by botSlot-aware token (already does via slotTokens = base +
   -slot1..-slotN; mismatch happens only when in-memory uses base token for a slot-N bot).
4. tradesCount restoration on restart for slot bots should count under slotToken only.
5. Add a one-time migration script: for each botSessions row where botSlot>0 and sessionToken
   == base, rewrite sessionToken to base-slotN (and stop/restart those bots so in-memory matches).

## Environment
- Railway CLI: ~/.railway/bin/railway, linked to project disciplined-spontaneity, env production,
  service upstox-scalping-guide. Run DB scripts via: railway run python3 scripts/probe_mismatch.py
