"""Deep trace of the Silver 24AUG26 239000 PE trade (12 Aug 22:28 IST)."""
import pymysql, os, re, json, datetime

url = os.environ['DATABASE_URL']
m = re.match(r'mysql://(\w+):([^@]+)@([\w.-]+):(\d+)/(\w+)', url)
conn = pymysql.connect(host=m.group(3), port=int(m.group(4)), user=m.group(1),
                       password=m.group(2), database=m.group(5), connect_timeout=15)
c = conn.cursor()

print("=== TRADE_LOG ROW ===")
c.execute("SELECT * FROM trade_log WHERE symbolLabel LIKE 'SILVER%' ORDER BY enteredAt DESC LIMIT 3")
cols = [d[0] for d in c.description]
for r in c.fetchall():
    row = dict(zip(cols, r))
    for k, v in row.items():
        if isinstance(v, datetime.datetime):
            row[k] = v.isoformat()
    print(json.dumps(row, indent=1))

print("\n=== SIGNAL_JOURNAL ROWS (SILVER, around trade) ===")
c.execute("""SELECT * FROM signal_journal WHERE symbol LIKE '%SILVER%' AND signalAt BETWEEN '2026-08-12 21:50:00' AND '2026-08-12 23:30:00' ORDER BY signalAt""")
for r in c.fetchall():
    row = dict(zip([d[0] for d in c.description], r))
    for k, v in row.items():
        if isinstance(v, datetime.datetime):
            row[k] = v.isoformat()
    print(json.dumps(row, indent=1))

print("\n=== BOT_SESSION that took it (sessionToken from trade row) ===")
c.execute("SELECT * FROM trade_log WHERE symbolLabel LIKE 'SILVER%' ORDER BY enteredAt DESC LIMIT 1")
r = c.fetchone()
token = r[cols.index('sessionToken')] if cols.index('sessionToken') is not None else None
print("sessionToken:", token)
c.execute("SELECT * FROM bot_sessions WHERE sessionToken = %s ORDER BY createdAt DESC LIMIT 1", (token,))
cols2 = [d[0] for d in c.description]
for rr in c.fetchall():
    row = dict(zip(cols2, rr))
    for k, v in row.items():
        if isinstance(v, datetime.datetime):
            row[k] = v.isoformat()
        elif isinstance(v, (bytes, bytearray)):
            row[k] = row[k].decode('utf8', 'replace')
    print(json.dumps(row, indent=1))

print("\n=== ALL SIGNAL_JOURNAL ROWS FOR THIS SESSION 12 AUG ===")
c.execute("""SELECT * FROM signal_journal WHERE sessionToken = %s AND signalAt BETWEEN '2026-08-12 00:00:00' AND '2026-08-13 00:00:00' ORDER BY signalAt""", (token,))
for r in c.fetchall():
    row = dict(zip([d[0] for d in c.description], r))
    for k, v in row.items():
        if isinstance(v, datetime.datetime):
            row[k] = v.isoformat()
    pnl = row.get('pnl') or 0
    print(f"{row.get('signalAt','')[11:19]} {row.get('symbol',''):10s} {row.get('layer',''):18s} regime={str(row.get('regime'))[:12]:12s} outcome={row.get('outcome'):8s} pnl={pnl:,.0f} rej={str(row.get('rejectReason'))[:50]}")
