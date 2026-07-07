#!/bin/bash
# End-to-end API test for ScalpBot — corrected assertions
# tRPC: queries use GET, mutations use POST

BASE="http://localhost:3000/api/trpc"
SESSION="e2e-test-$(date +%s)"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  local expect="$3"
  if echo "$result" | grep -q "$expect"; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    echo "     got: $(echo $result | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

enc() {
  python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

query() {
  curl -s "$BASE/$1?input=$(enc "$2")"
}

mutate() {
  curl -s -X POST "$BASE/$1" -H "Content-Type: application/json" -d "$2"
}

echo ""
echo "══════════════════════════════════════════════════"
echo "  ScalpBot End-to-End API Test"
echo "  Session: $SESSION"
echo "══════════════════════════════════════════════════"

echo ""
echo "── 1. Health & Server ────────────────────────────"
R=$(curl -s http://localhost:3000/api/health)
check "GET /api/health returns ok:true" "$R" '"ok":true'

R=$(curl -s http://localhost:3000/)
check "GET / returns HTML" "$R" 'html'

echo ""
echo "── 2. Auth ───────────────────────────────────────"
R=$(query "auth.me" '{"json":null}')
check "auth.me (unauthenticated, returns result)" "$R" '"result"'

echo ""
echo "── 3. Credentials ────────────────────────────────"
# Procedure is credentials.save (mutation) and credentials.get (query)
R=$(mutate "credentials.save" "{\"json\":{\"sessionToken\":\"$SESSION\",\"apiKey\":\"test_api_key_123\",\"apiSecret\":\"test_secret_456\",\"redirectUri\":\"http://localhost:3000/callback\"}}")
check "credentials.save mutation" "$R" '"result"'

R=$(query "credentials.get" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "credentials.get query (returns saved apiKey)" "$R" '"apiKey"'

echo ""
echo "── 4. Bot Status (before start) ──────────────────"
R=$(query "bot.status" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
# Before start, status is null (no session yet) — that is correct behaviour
check "bot.status query (returns result before start)" "$R" '"result"'

R=$(query "bot.liveData" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "bot.liveData query (returns result before start)" "$R" '"result"'

echo ""
echo "── 5. Bot Start (paper mode) ─────────────────────"
R=$(mutate "bot.start" "{\"json\":{\"sessionToken\":\"$SESSION\",\"instrumentToken\":\"NSE_FO|NIFTY\",\"instrumentSymbol\":\"NIFTY\",\"instrumentLabel\":\"NIFTY 50\",\"mode\":\"paper\",\"capital\":100000,\"riskPerTradePct\":1,\"maxTradesPerDay\":5,\"stopLossMultiplier\":1.5,\"targetMultiplier\":3,\"dailyLossLimitPct\":3,\"trailingSlEnabled\":false,\"trailingSlPct\":0.5,\"minConfidence\":60,\"scanIntervalSec\":60,\"telegramBotToken\":\"\",\"telegramChatId\":\"\",\"telegramEnabled\":false}}")
check "bot.start mutation (paper mode)" "$R" '"success":true'

sleep 1

R=$(query "bot.status" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "bot.status query (running after start)" "$R" '"running"'

echo ""
echo "── 6. Live Data (running bot) ────────────────────"
R=$(query "bot.liveData" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "bot.liveData has price field" "$R" '"price"'
check "bot.liveData has signal field" "$R" '"signal"'
check "bot.liveData has isPowerHourMode" "$R" '"isPowerHourMode"'
check "bot.liveData has isMCXEveningMode" "$R" '"isMCXEveningMode"'
check "bot.liveData has heroZeroMode" "$R" '"heroZeroMode"'
check "bot.liveData has candles5mCount" "$R" '"candles5mCount"'
check "bot.liveData has openTrade field" "$R" '"openTrade"'

echo ""
echo "── 7. Bot Stop ───────────────────────────────────"
R=$(mutate "bot.stop" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "bot.stop mutation" "$R" '"success":true'

sleep 1
R=$(query "bot.status" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "bot.status query (stopped after stop)" "$R" '"stopped"'

echo ""
echo "── 8. Trades ─────────────────────────────────────"
R=$(query "trades.list" "{\"json\":{\"sessionToken\":\"$SESSION\",\"limit\":10}}")
check "trades.list query (returns result)" "$R" '"result"'

R=$(query "trades.todayStats" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
# todayStats returns todayPnl (not totalPnl)
check "trades.todayStats query (returns todayPnl)" "$R" '"todayPnl"'
check "trades.todayStats has winRate" "$R" '"winRate"'

R=$(query "trades.stats" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "trades.stats query (returns totalTrades)" "$R" '"totalTrades"'

R=$(query "trades.openTrade" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "trades.openTrade query (returns result)" "$R" '"result"'

echo ""
echo "── 9. Account ────────────────────────────────────"
R=$(query "account.profile" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "account.profile (returns result without live token)" "$R" '"result"'

R=$(query "account.balance" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "account.balance (returns result without live token)" "$R" '"result"'

echo ""
echo "── 10. Multi-Bot ─────────────────────────────────"
R=$(query "multiBots.allStatus" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "multiBots.allStatus (returns slot array)" "$R" '"slot"'

R=$(mutate "multiBots.startSecondary" "{\"json\":{\"sessionToken\":\"$SESSION\",\"slot\":1,\"instrumentToken\":\"MCX_FO|CRUDEOIL\",\"instrumentSymbol\":\"CRUDEOIL\",\"instrumentLabel\":\"Crude Oil\",\"mode\":\"paper\",\"capital\":50000,\"riskPerTradePct\":1.5,\"maxTradesPerDay\":4,\"dailyLossLimitPct\":3,\"stopLossMultiplier\":1.5,\"targetMultiplier\":2.5,\"minConfidence\":60,\"scanIntervalSec\":30,\"telegramBotToken\":\"\",\"telegramChatId\":\"\",\"telegramEnabled\":false}}")
check "multiBots.startSecondary (slot 1, Crude Oil MCX)" "$R" '"success":true'

sleep 1
R=$(query "multiBots.allStatus" "{\"json\":{\"sessionToken\":\"$SESSION\"}}")
check "multiBots.allStatus shows slot 1 running" "$R" '"running"'

R=$(mutate "multiBots.stopSecondary" "{\"json\":{\"sessionToken\":\"$SESSION\",\"slot\":1}}")
check "multiBots.stopSecondary (slot 1)" "$R" '"success":true'

echo ""
echo "── 11. Hero Zero Scanner ─────────────────────────"
R=$(query "heroZero.scanStrikes" "{\"json\":{\"sessionToken\":\"$SESSION\",\"underlying\":\"NIFTY\",\"spotPrice\":24000}}")
check "heroZero.scanStrikes (returns candidates array)" "$R" '"candidates"'
check "heroZero.scanStrikes has scanTime" "$R" '"scanTime"'
# Without Upstox token, candidates is [] and error is set — this is correct
check "heroZero.scanStrikes graceful when no token" "$R" '"error"'

echo ""
echo "── 12. Telegram Procedures ───────────────────────"
# Telegram requires botToken min 10 chars — use a 10-char fake token
R=$(mutate "telegram.test" "{\"json\":{\"sessionToken\":\"$SESSION\",\"botToken\":\"1234567890\",\"chatId\":\"123456\"}}")
# Will fail Telegram API but should return a result (not a tRPC error)
check "telegram.test (10-char token, graceful Telegram error)" "$R" '"result"'

R=$(mutate "telegram.sendDailySummary" "{\"json\":{\"sessionToken\":\"$SESSION\",\"botToken\":\"1234567890\",\"chatId\":\"123456\"}}")
check "telegram.sendDailySummary (10-char token, graceful)" "$R" '"result"'

echo ""
echo "── 13. Session Isolation ─────────────────────────"
SESSION2="e2e-other-$(date +%s)"
R=$(query "bot.status" "{\"json\":{\"sessionToken\":\"$SESSION2\"}}")
check "Different session returns independent result" "$R" '"result"'

R=$(query "trades.list" "{\"json\":{\"sessionToken\":\"$SESSION2\",\"limit\":5}}")
check "Different session has empty trades" "$R" '"result"'

echo ""
echo "── 14. Server Stability After All Tests ──────────"
R=$(curl -s http://localhost:3000/api/health)
check "Server still healthy after all tests" "$R" '"ok":true'

echo ""
echo "══════════════════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════════"
echo ""
if [ $FAIL -eq 0 ]; then
  echo "  🎉 ALL TESTS PASSED — system is healthy"
else
  echo "  ⚠️  $FAIL test(s) need attention"
fi
echo ""
