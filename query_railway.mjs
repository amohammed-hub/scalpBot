import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await mysql.createConnection(url);

// First check what columns actually exist
console.log('\n=== COLUMNS in bot_sessions ===');
const [cols1] = await conn.execute(`SHOW COLUMNS FROM bot_sessions`);
console.log(cols1.map(c => c.Field).join(', '));

console.log('\n=== COLUMNS in trade_log ===');
const [cols2] = await conn.execute(`SHOW COLUMNS FROM trade_log`);
console.log(cols2.map(c => c.Field).join(', '));

console.log('\n=== BOT SESSIONS (last 10) ===');
const [sessions] = await conn.execute(`
  SELECT id, sessionToken, instrumentSymbol, instrumentLabel, mode, status, capital, 
         startedAt, stoppedAt, lastPrice, dailyPnl, tradesCount, lastSignal, lastError
  FROM bot_sessions 
  ORDER BY startedAt DESC 
  LIMIT 10
`);
for (const s of sessions) {
  console.log(`[${s.id}] ${s.instrumentLabel} | mode=${s.mode} | status=${s.status} | capital=₹${s.capital} | pnl=₹${s.dailyPnl ?? 0} | trades=${s.tradesCount ?? 0}`);
  console.log(`     started=${s.startedAt} | stopped=${s.stoppedAt ?? 'still running'}`);
  console.log(`     lastPrice=₹${s.lastPrice ?? 0} | lastSignal=${s.lastSignal ?? 'none'} | lastError=${s.lastError ?? 'none'}`);
  console.log('');
}

console.log('\n=== TRADE LOG (last 20) ===');
const [trades] = await conn.execute(`
  SELECT id, sessionToken, symbol, symbolLabel, direction, mode, entryPrice, exitPrice, pnl, status, enteredAt, exitedAt, exitReason
  FROM trade_log 
  ORDER BY enteredAt DESC 
  LIMIT 20
`);
if (trades.length === 0) {
  console.log('No trades found in DB');
} else {
  for (const t of trades) {
    console.log(`[${t.id}] ${t.symbolLabel} | ${t.direction} | mode=${t.mode} | status=${t.status}`);
    console.log(`     entry=₹${t.entryPrice} | exit=₹${t.exitPrice ?? '-'} | pnl=₹${t.pnl ?? '-'}`);
    console.log(`     entered=${t.enteredAt} | exited=${t.exitedAt ?? '-'} | reason=${t.exitReason ?? '-'}`);
    console.log('');
  }
}

await conn.end();
