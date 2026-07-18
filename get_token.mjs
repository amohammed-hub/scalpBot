import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { upstoxCredentials } from "./drizzle/schema.ts";
import { desc } from "drizzle-orm";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

const creds = await db.select().from(upstoxCredentials).orderBy(desc(upstoxCredentials.tokenExpiresAt)).limit(3);

for (const c of creds) {
  console.log(`Session: ${c.sessionToken}`);
  console.log(`Token: ${c.accessToken ? c.accessToken.substring(0, 60) + '...' : 'NULL'}`);
  console.log(`Expires: ${c.tokenExpiresAt}`);
  console.log('---');
}

await conn.end();
