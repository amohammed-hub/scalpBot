import pymysql, re, os
url = os.environ["DATABASE_URL"]
m = re.match(r"mysql(?:es)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", url)
u, p, h, pt, d = m.groups()
c = pymysql.connect(host=h, port=int(pt), user=u, password=p, database=d)
cur = c.cursor()
cur.execute("SELECT id, instrumentSymbol, botSlot, mode, LEFT(sessionToken,16) FROM bot_sessions WHERE status='running' ORDER BY id")
print("RUNNING SESSIONS:")
for r in cur.fetchall():
    print(" ", r)
cur.execute("SELECT id, symbol, direction, mode, status, entryPrice, quantity, pnl FROM trade_log WHERE status='open' ORDER BY id")
print("OPEN TRADES:")
for r in cur.fetchall():
    print(" ", r)
cur.execute("SELECT COUNT(*) FROM trade_log WHERE status='open'")
print("OPEN_TRADE_COUNT:", cur.fetchone()[0])
cur.execute("SELECT COALESCE(SUM(entryPrice*quantity),0) FROM trade_log WHERE status='open'")
print("GROSS_EXPOSURE:", cur.fetchone()[0])
# Upstox live positions (authentic) — query credentials and call positions API
cur.execute("SELECT sessionToken, accessToken FROM upstox_credentials WHERE accessToken IS NOT NULL ORDER BY id DESC LIMIT 3")
creds = cur.fetchall()
import urllib.request
print("UPSTOX LIVE POSITIONS (positions API):")
for sid, tok in creds:
    try:
        req = urllib.request.Request("https://api.upstox.com/v2/portfolio/short-term-positions",
            headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        positions = data.get("data", [])
        print(f"  session {sid}: {len(positions)} position(s)")
        for pos in positions:
            print(f"    {pos.get('instrument_token')} qty={pos.get('quantity')} ltp={pos.get('last_price')}")
    except Exception as e:
        print(f"  session {sid}: positions fetch failed: {e}")
