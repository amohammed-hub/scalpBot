import { getDb } from "./server/db";
import { tradeLog, botSessions } from "./drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  
  // Last 10 trades (any status)
  const trades = await db.select().from(tradeLog).orderBy(desc(tradeLog.enteredAt)).limit(10);
  console.log(`\n=== LAST 10 TRADES ===`);
  for (const r of trades) {
    console.log(`  ID=${r.id} | ${r.mode} | ${r.symbol} | ${r.direction} | entry=${r.entryPrice} | status=${r.status} | orderId=${r.upstoxOrderId || 'NULL'} | at=${r.enteredAt}`);
  }
  
  // All bot sessions (any status)
  const sessions = await db.select().from(botSessions).orderBy(desc(botSessions.id)).limit(10);
  console.log(`\n=== LAST 10 BOT SESSIONS ===`);
  for (const s of sessions) {
    console.log(`  ID=${s.id} | ${s.status} | ${s.mode} | ${s.instrumentSymbol} (${s.instrumentLabel}) | token=${s.instrumentToken} | underlying=${s.underlyingToken} | session=${s.sessionToken.slice(0,12)}...`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
