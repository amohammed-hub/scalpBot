/**
 * One-time cleanup script to delete false trade records caused by botRestart.ts bug.
 * Run with: node cleanup-false-trades.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = mysql.createPool({
  uri: url,
  waitForConnections: true,
  connectionLimit: 3,
  ssl: { rejectUnauthorized: false },
});

const conn = await pool.getConnection();

try {
  // 1. Show all trades first
  const [rows] = await conn.execute(
    "SELECT id, symbolLabel, direction, mode, entryPrice, exitPrice, quantity, pnl, status, enteredAt FROM trade_log ORDER BY id DESC LIMIT 20"
  );
  console.log("\n=== Current Trade Log ===");
  console.table(rows);

  // 2. Delete the BankNifty false trade (pnl=-161469, caused by partial1RPrice=0 bug)
  const [del1] = await conn.execute(
    "DELETE FROM trade_log WHERE symbol = 'BNF_FUT' AND pnl < -100000 AND status = 'closed' AND mode = 'paper'"
  );
  console.log(`\nDeleted BankNifty false trade: ${del1.affectedRows} row(s)`);

  // 3. Delete the Crude Oil SELL false trade (pnl=-22268, caused by botRestart creating phantom session)
  const [del2] = await conn.execute(
    "DELETE FROM trade_log WHERE symbol LIKE '%CRUDEOILM%' AND direction = 'SELL' AND pnl < -20000 AND status = 'closed' AND mode = 'paper'"
  );
  console.log(`Deleted Crude Oil SELL false trade: ${del2.affectedRows} row(s)`);

  // 4. Cancel the phantom Crude Oil BUY open trade (entry=1002.14, qty=363 — false restart artifact)
  const [upd1] = await conn.execute(
    "UPDATE trade_log SET status = 'cancelled', exitPrice = entryPrice, pnl = 0, exitedAt = NOW(), exitReason = 'Cancelled: false restart artifact' WHERE symbol LIKE '%CRUDEOILM%' AND direction = 'BUY' AND status = 'open' AND mode = 'paper' AND entryPrice < 1100"
  );
  console.log(`Cancelled Crude Oil BUY phantom open trade: ${upd1.affectedRows} row(s)`);

  // 5. Mark all bot_sessions as stopped so they don't auto-restart with wrong state
  const [upd2] = await conn.execute(
    "UPDATE bot_sessions SET status = 'stopped' WHERE status = 'running'"
  );
  console.log(`Stopped all running bot sessions (restart manually from Dashboard): ${upd2.affectedRows} row(s)`);

  // 6. Show final state
  const [final] = await conn.execute(
    "SELECT id, symbolLabel, direction, mode, entryPrice, exitPrice, quantity, pnl, status FROM trade_log ORDER BY id DESC LIMIT 20"
  );
  console.log("\n=== Trade Log After Cleanup ===");
  console.table(final);

} finally {
  conn.release();
  await pool.end();
}
