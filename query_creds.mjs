import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL');
  process.exit(1);
}

const conn = await mysql.createConnection(url);
const [rows] = await conn.execute('SELECT sessionToken, accessToken, tokenExpiresAt, apiKey FROM upstox_credentials ORDER BY id DESC LIMIT 3');

for (const row of rows) {
  console.log(JSON.stringify({
    sessionToken: row.sessionToken,
    accessToken: row.accessToken ? row.accessToken.substring(0, 80) + '...' : null,
    tokenExpiresAt: row.tokenExpiresAt,
    apiKey: row.apiKey ? row.apiKey.substring(0, 20) + '...' : null
  }, null, 2));
}

await conn.end();
