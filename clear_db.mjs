import { createConnection } from 'mysql2/promise';

// Use DATABASE_URL from environment
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL not set in environment');

const conn = await createConnection(dbUrl);

console.log('Connected to Railway DB');

// 1. Delete ALL trades
const [r1] = await conn.execute('DELETE FROM trade_log');
console.log('Deleted all trades:', r1.affectedRows);

// 2. Reset all bot sessions: stop them, clear open trades, fix tokens
const [sessions] = await conn.execute('SELECT id, sessionToken, instrumentToken FROM bot_sessions');
console.log('Found sessions:', sessions.length);

for (const s of sessions) {
  await conn.execute(`
    UPDATE bot_sessions SET
      status = 'stopped',
      lastPrice = 0,
      dailyPnl = 0,
      tradesCount = 0,
      currentSl = 0,
      lastSignal = NULL,
      lastError = NULL,
      isIndexOptions = 1,
      underlyingToken = CASE
        WHEN instrumentToken LIKE 'NSE_INDEX%Nifty Bank%' THEN 'NSE_INDEX|Nifty Bank'
        WHEN instrumentToken LIKE 'NSE_INDEX%Nifty 50%' THEN 'NSE_INDEX|Nifty 50'
        WHEN instrumentToken LIKE 'MCX_FO%' THEN instrumentToken
        WHEN instrumentToken LIKE '%BANKNIFTY%' OR instrumentToken LIKE '%BNF%' THEN 'NSE_INDEX|Nifty Bank'
        WHEN instrumentToken LIKE '%NIFTY%' OR instrumentToken LIKE '%NFO%' THEN 'NSE_INDEX|Nifty 50'
        ELSE underlyingToken
      END,
      instrumentToken = CASE
        WHEN instrumentToken LIKE 'NSE_FO|BANKNIFTY%' OR instrumentToken LIKE 'NFO_FUT|BANKNIFTY%' THEN 'NSE_INDEX|Nifty Bank'
        WHEN instrumentToken LIKE 'NSE_FO|NIFTY%' OR instrumentToken LIKE 'NFO_FUT|NIFTY%' THEN 'NSE_INDEX|Nifty 50'
        ELSE instrumentToken
      END
    WHERE id = ?
  `, [s.id]);
  console.log(`Reset session ${s.id} (${s.sessionToken})`);
}

// 3. Show final state
const [finalSessions] = await conn.execute('SELECT id, sessionToken, instrumentToken, underlyingToken, isIndexOptions, status FROM bot_sessions');
console.log('\nFinal bot_sessions state:');
for (const s of finalSessions) {
  console.log(`  [${s.id}] ${s.sessionToken} | ${s.instrumentToken} | underlying=${s.underlyingToken} | isIndexOptions=${s.isIndexOptions} | status=${s.status}`);
}

const [tradeCount] = await conn.execute('SELECT COUNT(*) as cnt FROM trade_log');
console.log('\nTrades remaining:', tradeCount[0].cnt);

await conn.end();
console.log('\nDone. All data cleared and sessions reset.');
