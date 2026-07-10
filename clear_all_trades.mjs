import mysql from 'mysql2/promise';

const db = await mysql.createConnection(process.env.DATABASE_URL);

const [trades] = await db.execute('SELECT COUNT(*) as cnt FROM trade_log');
console.log('Trades before:', trades[0].cnt);

await db.execute('DELETE FROM trade_log');
console.log('All trades deleted.');

// Also reset all bot sessions to stopped
await db.execute(`UPDATE bot_sessions SET status='stopped', openTradeDbId=NULL`);
console.log('All bot sessions stopped and openTradeDbId cleared.');

const [after] = await db.execute('SELECT COUNT(*) as cnt FROM trade_log');
console.log('Trades after:', after[0].cnt);

await db.end();
