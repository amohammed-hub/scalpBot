import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("No DATABASE_URL"); process.exit(1); }
const pool = mysql.createPool(dbUrl);
const db = drizzle(pool);
const [rows] = await pool.execute("SELECT sessionToken, status, instrumentLabel, dailyPnl, capital, dailyLossLimitPct, botSlot, updatedAt FROM bot_sessions ORDER BY id DESC LIMIT 10");
console.log(JSON.stringify(rows, null, 2));
await pool.end();
process.exit(0);
