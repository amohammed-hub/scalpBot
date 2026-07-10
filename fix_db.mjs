import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const url = process.env.DATABASE_URL || '';
const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('No DB URL'); process.exit(1); }
const [, user, pass, host, port, db] = m;

const conn = await createConnection({
  host, port: +port, user, password: pass, database: db,
  ssl: { rejectUnauthorized: false }
});

// Delete all wrong open trades
const [del] = await conn.execute("DELETE FROM trade_log WHERE status='open'");
console.log('Deleted open trades:', del.affectedRows);

// Reset primary bot sessions (not slot1 or slot2)
const [r1] = await conn.execute(
  "UPDATE bot_sessions SET instrumentToken='NSE_INDEX|Nifty Bank', instrumentSymbol='BANKNIFTY', instrumentLabel='BankNifty → ATM Options (Auto)', isIndexOptions=1, underlyingToken='NSE_INDEX|Nifty Bank', status='stopped', dailyPnl=0, tradesCount=0 WHERE sessionToken NOT LIKE '%-slot%'"
);
console.log('Primary sessions updated:', r1.affectedRows);

// Reset slot1 sessions
const [r2] = await conn.execute(
  "UPDATE bot_sessions SET instrumentToken='NSE_INDEX|Nifty 50', instrumentSymbol='NIFTY', instrumentLabel='Nifty 50 → ATM Options (Auto)', isIndexOptions=1, underlyingToken='NSE_INDEX|Nifty 50', status='stopped', dailyPnl=0, tradesCount=0 WHERE sessionToken LIKE '%-slot1'"
);
console.log('Slot1 sessions updated:', r2.affectedRows);

// Reset slot2 sessions
const [r3] = await conn.execute(
  "UPDATE bot_sessions SET instrumentToken='MCX_FO|CRUDEOIL', instrumentSymbol='CRUDEOIL', instrumentLabel='Crude Oil → ATM Options (Auto)', isIndexOptions=1, underlyingToken='MCX_FO|CRUDEOIL', status='stopped', dailyPnl=0, tradesCount=0 WHERE sessionToken LIKE '%-slot2'"
);
console.log('Slot2 sessions updated:', r3.affectedRows);

// Show current state
const [rows] = await conn.execute('SELECT sessionToken, instrumentSymbol, isIndexOptions, status FROM bot_sessions');
console.log('\nCurrent bot_sessions:');
for (const row of rows) console.log(JSON.stringify(row));

await conn.end();
console.log('\nDone.');
