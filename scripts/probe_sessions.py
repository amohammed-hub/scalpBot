"""List all bot_sessions with capital + enabledLayers + status for cleanup + cap planning."""
import pymysql, os, re

url = os.environ['DATABASE_URL']
m = re.match(r'mysql://(\w+):([^@]+)@([\w.-]+):(\d+)/(\w+)', url)
conn = pymysql.connect(host=m.group(3), port=int(m.group(4)), user=m.group(1),
                       password=m.group(2), database=m.group(5), connect_timeout=15)
c = conn.cursor()
c.execute("""SELECT id, sessionToken, botSlot, instrumentSymbol, mode, status,
                    capital, openingBurstEnabled, enabledLayers
             FROM bot_sessions ORDER BY id""")
for r in c.fetchall():
    print(r)
conn.close()
