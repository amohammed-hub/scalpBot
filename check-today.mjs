import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

// Check ALL trades from today
const today = await db.execute(sql`SELECT id, symbolLabel, entryPrice, direction, status, exitReason, sessionToken, enteredAt FROM trade_log WHERE DATE(enteredAt) = CURDATE() ORDER BY id DESC LIMIT 20`);
console.log("Today's trades:", JSON.stringify(today[0], null, 2));

// Check bot sessions
const sessions = await db.execute(sql`SELECT id, sessionToken, instrumentLabel, instrumentSymbol, status, enabledLayers, tradesCount FROM bot_sessions WHERE status = 'running' LIMIT 10`);
console.log("\nRunning bot sessions:", JSON.stringify(sessions[0], null, 2));

await connection.end();
