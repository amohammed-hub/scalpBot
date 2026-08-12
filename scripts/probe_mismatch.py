#!/usr/bin/env python3
"""Diagnose Bot 4 (NATGAS) trade-count vs trade-log mismatch.

Key questions:
1. Do running bot sessions use the base sessionToken (old flow) instead of base-slotN?
2. Do their trade_log rows therefore land under the base token (shared with Bot 1)?
3. Card count = in-memory tradesCount (2) while log under the slot token = 0.
"""
import pymysql, re, os

url = os.environ["DATABASE_URL"]
m = re.match(r"mysql(?:es)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", url)
u, p, h, pt, d = m.groups()
pt = pt or 3306
c = pymysql.connect(host=h, port=int(pt), user=u, password=p, database=d)
cur = c.cursor()

# Running bot sessions with full token and slot
cur.execute("""
SELECT id, sessionToken, botSlot, status, instrumentSymbol, tradesCount, dailyPnl
FROM bot_sessions
WHERE status = 'running'
ORDER BY id DESC""")
print("=== RUNNING sessions ===")
for r in cur.fetchall():
    print(f"id={r[0]} tok_prefix={r[1][:14]} botSlot={r[2]} {r[3]} {r[4]} tradesCount={r[5]} pnl={r[6]}")

print()
# For each running session, count trade_log rows under its exact token TODAY
cur.execute("""
SELECT sessionToken, botSlot, COUNT(*), SUM(pnl) FROM trade_log
WHERE enteredAt >= CURDATE() - INTERVAL 1 DAY
GROUP BY sessionToken, botSlot
ORDER BY COUNT(*) DESC LIMIT 15""")
print("=== today's trade counts by (token, botSlot) ===")
for r in cur.fetchall():
    print(f"{r[0][:20]} slot={r[1]} n={r[2]} pnl={r[3]}")

print()
# How were the 2 'trades' on the NATGAS bot counted? tradesCount=2 in memory.
# Check in-memory via logs is not possible; check if there were opened+closed rows
# under the NATGAS bot's token prefix. NATGAS bot session id=27 token is base (botSlot unknown).
cur.execute("""
SELECT b.id, b.sessionToken, b.botSlot, b.instrumentSymbol,
       (SELECT COUNT(*) FROM trade_log t WHERE t.sessionToken = b.sessionToken) AS total_trades
FROM bot_sessions b
WHERE b.status = 'running' AND b.instrumentSymbol IN ('MCX_NATGAS','MCX_SILVER','MCX_CRUDE','MCX_GOLD','MCX_COPPER')
ORDER BY b.id DESC""")
print("=== running MCX bots: trade_log rows under their session token ===")
for r in cur.fetchall():
    print(f"id={r[0]} tok={r[1][:14]} botSlot={r[2]} {r[3]} total_trades={r[4]}")

cur.close(); c.close()
