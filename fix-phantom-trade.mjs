import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("No DATABASE_URL in env");
  process.exit(1);
}

console.log("Connecting to DB...");
const connection = await mysql.createConnection(DATABASE_URL);
const db = drizzle(connection);

// Find all open trades with entry < 5 (phantom trades)
const phantomTrades = await db.execute(sql`SELECT id, symbolLabel, entryPrice, direction, status FROM trade_log WHERE status = 'open' AND entryPrice < 5`);
console.log("Phantom trades (entry < ₹5):", JSON.stringify(phantomTrades[0], null, 2));

// Close them
if (phantomTrades[0].length > 0) {
  await db.execute(sql`UPDATE trade_log SET status = 'closed', exitReason = 'Phantom-auto-cleaned', exitPrice = 0, exitedAt = NOW() WHERE status = 'open' AND entryPrice < 5`);
  console.log("✅ Closed", phantomTrades[0].length, "phantom trades");
} else {
  console.log("No phantom trades found (entry < ₹5)");
}

// Also show ALL remaining open trades
const allOpen = await db.execute(sql`SELECT id, symbolLabel, entryPrice, direction, status, sessionToken FROM trade_log WHERE status = 'open'`);
console.log("\nAll remaining open trades:", JSON.stringify(allOpen[0], null, 2));

// Show today's trade count per session
const todayCounts = await db.execute(sql`SELECT sessionToken, COUNT(*) as cnt FROM trade_log WHERE DATE(enteredAt) = CURDATE() GROUP BY sessionToken`);
console.log("\nToday's trade counts per session:", JSON.stringify(todayCounts[0], null, 2));

await connection.end();
console.log("\nDone.");
