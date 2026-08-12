#!/usr/bin/env python3
"""Probe production MySQL for the Bot 4 (slot4) trade-count mismatch."""
import os, json, re, urllib.request, urllib.parse, ssl

# Railway DATABASE_URL: mysql://user:pass@host:port/dbname
url = os.environ.get("DATABASE_URL", "")
m = re.match(r"mysql(?:es)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", url)
if not m:
    raise SystemExit("bad DATABASE_URL")
user, pwd, host, port, db = m.groups()
port = port or "3306"

# Use Railway's MySQL HTTP proxy? Prefer native pymysql if available.
try:
    import pymysql  # noqa
except ImportError:
    os.system("sudo pip3 install -q pymysql 2>/dev/null")
    import pymysql

conn = pymysql.connect(host=host, port=int(port), user=user, password=pwd, database=db, ssl={"ca": None, "check_hostname": False})
cur = conn.cursor()

# 1. recent trade rows with session tokens
cur.execute("SELECT sessionToken, symbol, direction, status, pnl, enteredAt, exitedAt FROM trade_log ORDER BY enteredAt DESC LIMIT 20")
print("=== recent trade_log rows (last 20) ===")
for row in cur.fetchall():
    print(row)

# 2. per-token today counts
cur.execute("""
SELECT sessionToken, COUNT(*) FROM trade_log
WHERE enteredAt >= CURDATE() - INTERVAL 1 DAY
GROUP BY sessionToken ORDER BY 2 DESC LIMIT 20""")
print("\n=== per-token trade counts (since yesterday) ===")
for row in cur.fetchall():
    print(row[0][:16], row[1])

# 3. bot_sessions statuses
cur.execute("SELECT sessionToken, status, instrumentSymbol, tradesCount, dailyPnl FROM bot_sessions ORDER BY updatedAt DESC LIMIT 12")
print("\n=== bot_sessions ===")
for row in cur.fetchall():
    print(row[0][:16], "|", row[1], "|", row[2], "|", row[3], "|", row[4])

cur.close(); conn.close()
