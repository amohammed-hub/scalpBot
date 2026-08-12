#!/usr/bin/env python3
"""Run D17 migration logic live against production: re-key running legacy slot rows.
We implement the same logic as the TypeScript module in SQL so the deploy is not needed
to unblock the running bots right now. The TS module remains the canonical source for future deploys.
"""
import pymysql, re, os

url = os.environ["DATABASE_URL"]
m = re.match(r"mysql(?:es)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", url)
u, p, h, pt, d = m.groups()
c = pymysql.connect(host=h, port=int(pt), user=u, password=p, database=d)
cur = c.cursor()

# Identify base tokens that have multiple RUNNING sessions (the collision signature)
cur.execute("""
SELECT SUBSTRING(sessionToken,1,36) AS base, COUNT(*) FROM bot_sessions
WHERE status='running' GROUP BY SUBSTRING(sessionToken,1,36) HAVING COUNT(*) > 1""")
bases = cur.fetchall()
print("Base tokens with multiple running sessions:", bases)

actions = []
for row0 in bases:
    base = row0[0]
    cur.execute("SELECT id, botSlot, instrumentSymbol FROM bot_sessions WHERE sessionToken=%s AND status='running' AND botSlot>0 ORDER BY id", (base,))
    for rid, slot, sym in cur.fetchall():
        slotTok = f"{base}-slot{slot}"
        cur.execute("SELECT id, instrumentSymbol FROM bot_sessions WHERE sessionToken=%s LIMIT 1", (slotTok,))
        dup = cur.fetchone()
        if dup:
            print(f"slot{slot} {sym}: slot key already owned by {dup[1]} ({dup[0]}) — marking legacy row stopped")
            cur.execute("UPDATE bot_sessions SET status='stopped', stoppedAt=NOW() WHERE id=%s", (rid,))
            actions.append(f"stop {sym} slot{slot}")
        else:
            cur.execute("UPDATE bot_sessions SET sessionToken=%s WHERE id=%s", (slotTok, rid))
            print(f"slot{slot} {sym}: re-keyed to ...{slotTok[-12:]}")
            actions.append(f"rekey {sym} slot{slot}")
c.commit()

# Verify final state
cur.execute("SELECT SUBSTRING(sessionToken,1,36), botSlot, status, instrumentSymbol, tradesCount FROM bot_sessions ORDER BY id DESC LIMIT 12")
print("\nFinal bot_sessions:")
for r in cur.fetchall():
    print(" ", r[0][:20], f"slot={r[1]}", r[2], r[3], f"trades={r[4]}")
cur.close(); c.close()
