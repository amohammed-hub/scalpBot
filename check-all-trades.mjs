import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

// Check total trade count in DB
const total = await db.execute(sql`SELECT COUNT(*) as cnt FROM trade_log`);
console.log("Total trades in DB:", JSON.stringify(total[0]));

// Check total bot sessions
const sessions = await db.execute(sql`SELECT COUNT(*) as cnt FROM bot_sessions`);
console.log("Total bot sessions:", JSON.stringify(sessions[0]));

// Check last 5 trades regardless of date
const last5 = await db.execute(sql`SELECT id, symbolLabel, entryPrice, status, enteredAt FROM trade_log ORDER BY id DESC LIMIT 5`);
console.log("Last 5 trades:", JSON.stringify(last5[0], null, 2));

await connection.end();
