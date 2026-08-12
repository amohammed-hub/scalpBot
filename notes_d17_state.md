# D17/D17b/D18 State — 2026-08-12 ~17:42 UTC

## Commits on main (all pushed & deployed)
- c69a328 D17: slot-token migration module (server/slotTokenMigration.ts), bot.start guard, botRestart migration hook
- a41cc0c D18: React.lazy code-splitting in client/src/App.tsx (initial bundle 1.9MB→~456KB)
- b8b3fba D17b: stale-in-memory cleanup pass in botRestart before restart loop

## DB state (verified live via railway run, host shortline.proxy.rlwy.net, db=railway)
Running rows 19-27 all correctly slot-keyed:
- 19 SENSEX -slot1, 20 NIFTY base (slot0), 21 BANKNIFTY -slot2 (base b9fe46ea-...)
- 23 COPPER -slot4, 24 GOLD -slot1, 25 CRUDE base, 26 SILVER -slot2, 27 NATGAS -slot3 (base 8d17c6ad-...)
- Rows 11-18 (stopped legacy dup rows, 17:33 timestamps)

## PROBLEM STILL OPEN
Live server logs after latest deploy (ae9249a5, SUCCESS 17:38:35) show:
"Found 8 running row(s) — 8 exact-token canonical row(s) — 8 eligible"
"Restarted bot for session 8d17c6ad — MCX_GOLD/SILVER/NATGAS/COPPER" and b9fe46ea — NIFTY/SENSEX/BANKNIFTY
→ still registering under BASE tokens in memory.

HYPOTHESIS: The restart log shows base token because restartSingleSession calls
stopBot(baseToken)?? No. More likely: getBaseBotSessionToken strips suffix in
reconcileDuplicateBrokerSessions → but that only triggers with >=2 bases...

ACTUAL LIKELY CAUSE: The startup logs may be from the 17:29 deploy (b5d9b0d8),
or the DB read in botRestart at startup happens on a DB view/transaction that
predates re-key. BUT live DB query (just now) shows slot keys.

NEXT STEPS to debug:
1. Confirm current live process logs are recent (grep timestamp via railway logs --follow).
2. Check if migrateLegacySlotTokens re-keys DB rows back (reads botSlot>0 rows
   under base token — after my SQL re-key rows are at slot keys, botSlot values
   still >0 but WHERE sessionToken=base fails → should be a no-op).
3. Verify restartSingleSession registers with session.sessionToken (it does).
4. Check partitionCanonicalSessionRows: groups by EXACT token (verified in code)
   → 8 rows → 8 canonical. reconcileDuplicateBrokerSessions returns early when
   sessionsByBase.size < 2 (only admin base token) → no decommission.
5. SO the mystery: why does restart register base tokens? Maybe the deploy at
   17:38 is NOT the latest commit (git push time check: D17b pushed ~17:38; build
   may have been queued from earlier commit). railway build may use pre-push cache.

## Key scripts
- scripts/run_migration_now.py — live SQL migration (already applied; re-key done)
- scripts/probe_mismatch.py, scripts/probe_bot4_trades.py — diagnostics
- notes_bot4_mismatch.md — original root-cause analysis

## Test status: 411 tests pass, tsc clean, build OK (all on main).
