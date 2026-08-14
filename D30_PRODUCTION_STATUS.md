# D30 Production Status — verified 14 Aug 2026 ~11:30 IST

## Deployment
- Commit `d61389e` (D30: robust 401 auto-refresh) pushed to `main`, Railway auto-deployed.
- Post-Deploy Smoke Test workflow `31774034194`: ✅ all 4 probes passed (flagState, roundTrip, egress, startGuard).

## Live probes against https://scalpbot.up.railway.app (post-deploy)
- smoke.flagState → loadedFromDb:true, adminSessionDemoLocked:null, testSessionClean:true ✅
- smoke.egress → emptyTokenAllowed:true, randomTokenAllowed:true ✅
- smoke.startGuard → refusesLiveStartWhileOn:true, permitsLiveStartWhileOff:true ✅
- smoke.roundTrip → flippedOn:true, blockedWhileOn:true, flippedOff:true, clearAfterOff:true ✅
- /api/health → 200 (first hit cold-start ~5.4s)

## Typecheck + tests
- Server + client tsc --noEmit: clean
- npm test: 448 passed / 0 failed (451 total, 3 skipped)

## What D30 fixed
1. Candle fetches (1m / 5m / day) retry once with a fresh DB token on 401 — was missing entirely before.
2. Full-quote fetch passes sessionToken for demo/live refresh retry.
3. refreshTokenFromDB now used by Demo sessions too (previously Live-only).

## User-facing notes
- Scalper Mode kill zone: 11:00–13:00 IST, no entries allowed (expected silence until 13:00).
- Users must Start/Restart each bot slot to load the refreshed token + new retry logic into memory.
- Strategy Mode "Auto"/"Manual" and Scalper Mode toggles live in Dashboard (D26/D29).
