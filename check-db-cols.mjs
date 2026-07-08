import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute("SHOW COLUMNS FROM bot_sessions");
const cols = rows.map(r => r.Field);
console.log('bot_sessions columns:', cols.join(', '));
console.log('Has currentSl:', cols.includes('currentSl'));
console.log('Has lastTickAt:', cols.includes('lastTickAt'));
await conn.end();
