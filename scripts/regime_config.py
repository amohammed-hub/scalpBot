"""Extract signal_journal regime entries + bot_sessions for Aug 10-12, 2026."""
import pymysql, os, re, json, datetime

url = os.environ['DATABASE_URL']
m = re.match(r'mysql://(\w+):([^@]+)@([\w.-]+):(\d+)/(\w+)', url)
conn = pymysql.connect(host=m.group(3), port=int(m.group(4)), user=m.group(1),
                       password=m.group(2), database=m.group(5), connect_timeout=15)
c = conn.cursor()

c.execute("SHOW COLUMNS FROM signal_journal")
print("SJ COLS:", [r[0] for r in c.fetchall()])
c.execute("SHOW COLUMNS FROM bot_sessions")
print("BS COLS:", [r[0] for r in c.fetchall()])

c.execute("""SELECT * FROM signal_journal WHERE createdAt >= '2026-08-10' ORDER BY createdAt""")
rows = [dict(zip([d[0] for d in c.description], r)) for r in c.fetchall()]
for r in rows:
    for k, v in r.items():
        if isinstance(v, datetime.datetime):
            r[k] = v.isoformat()
        elif isinstance(v, (bytes, bytearray)):
            r[k] = r[k].decode('utf8', 'replace')
print(json.dumps(rows, indent=1))

c.execute("""SELECT * FROM bot_sessions ORDER BY createdAt DESC LIMIT 30""")
bs = [dict(zip([d[0] for d in c.description], r)) for r in c.fetchall()]
for r in bs:
    for k, v in r.items():
        if isinstance(v, datetime.datetime):
            r[k] = v.isoformat()
        elif isinstance(v, (bytes, bytearray)):
            r[k] = r[k].decode('utf8', 'replace')
print(json.dumps(bs, indent=1))
