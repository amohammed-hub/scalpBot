import { getDb } from "./server/db.ts";
import { upstoxCredentials, appUsers, botSessions, tradeLog } from "./drizzle/schema.ts";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("DB unavailable"); return; }
  
  const creds = await db.select().from(upstoxCredentials);
  console.log("=== CREDENTIALS ===");
  for (const c of creds) {
    console.log(`  token: ${c.sessionToken} | hasAccess: ${!!c.accessToken} | expires: ${c.tokenExpiresAt}`);
  }
  
  const users = await db.select().from(appUsers);
  console.log("\n=== USERS ===");
  for (const u of users) {
    console.log(`  id:${u.id} | mobile:${u.mobile} | role:${u.role} | token:${u.sessionToken}`);
  }
  
  const bots = await db.select().from(botSessions).orderBy(desc(botSessions.updatedAt)).limit(5);
  console.log("\n=== BOT SESSIONS ===");
  for (const b of bots) {
    console.log(`  token:${b.sessionToken} | status:${b.status} | instrument:${b.instrumentLabel} | slot:${b.botSlot}`);
  }
  
  const trades = await db.select().from(tradeLog).orderBy(desc(tradeLog.enteredAt)).limit(5);
  console.log("\n=== RECENT TRADES ===");
  for (const t of trades) {
    console.log(`  id:${t.id} | token:${t.sessionToken} | ${t.symbolLabel} | entry:${t.entryPrice} | exit:${t.exitPrice} | pnl:${t.pnl} | status:${t.status} | reason:${t.exitReason}`);
  }
  
  process.exit(0);
}
main();
