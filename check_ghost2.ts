import { getDb } from "./server/db";
import { tradeLog, botSessions } from "./drizzle/schema";
import { eq, desc, like, or } from "drizzle-orm";

async function main() {
  const db = await getDb();
  
  // Find all open trades
  const openTrades = await db.select().from(tradeLog).where(eq(tradeLog.status, "open")).orderBy(desc(tradeLog.enteredAt)).limit(10);
  console.log(`\n=== OPEN TRADES (${openTrades.length}) ===`);
  for (const r of openTrades) {
    console.log(`  ID=${r.id} | ${r.mode} | ${r.symbol} | ${r.direction} | entry=${r.entryPrice} | qty=${r.quantity} | orderId=${r.upstoxOrderId || 'NULL'} | token=${r.instrumentToken} | at=${r.enteredAt}`);
  }
  
  // Find COPPER trades
  const copperTrades = await db.select().from(tradeLog).where(or(like(tradeLog.symbol, '%COPPER%'), like(tradeLog.instrumentToken, '%COPPER%'))).orderBy(desc(tradeLog.enteredAt)).limit(10);
  console.log(`\n=== COPPER TRADES (${copperTrades.length}) ===`);
  for (const r of copperTrades) {
    console.log(`  ID=${r.id} | ${r.mode} | ${r.symbol} | ${r.direction} | entry=${r.entryPrice} | qty=${r.quantity} | status=${r.status} | orderId=${r.upstoxOrderId || 'NULL'} | token=${r.instrumentToken} | at=${r.enteredAt}`);
  }
  
  // Running bot sessions
  const sessions = await db.select().from(botSessions).where(eq(botSessions.status, "running")).orderBy(desc(botSessions.id)).limit(10);
  console.log(`\n=== RUNNING BOT SESSIONS (${sessions.length}) ===`);
  for (const s of sessions) {
    console.log(`  ID=${s.id} | ${s.mode} | ${s.instrumentSymbol} (${s.instrumentLabel}) | token=${s.instrumentToken} | underlying=${s.underlyingToken} | session=${s.sessionToken.slice(0,12)}...`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
