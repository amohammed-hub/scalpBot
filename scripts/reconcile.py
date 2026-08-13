import pymysql, os, json, sys
cfg = json.load(open('/tmp/dbcfg.json')) if os.path.exists('/tmp/dbcfg.json') else None
if cfg:
    conn = pymysql.connect(**cfg)
else:
    # fallback: fetch vars
    sys.exit('no config')
c = conn.cursor()
# show columns of trade_log
c.execute("SHOW COLUMNS FROM trade_log")
cols = [r[0] for r in c.fetchall()]
print("COLUMNS:", cols)
c.execute("SELECT COUNT(*) FROM trade_log WHERE enteredAt >= '2026-08-10'")
print("rows 10-12 Aug:", c.fetchone())
c.execute("SELECT COUNT(*) FROM trade_log WHERE mode='live' AND status='open'")
print("open live:", c.fetchone())
