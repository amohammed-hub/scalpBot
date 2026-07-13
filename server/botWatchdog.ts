/**
 * botWatchdog.ts
 *
 * Runs every 60 seconds. For every session marked "running" in the DB,
 * checks whether an in-memory bot instance actually exists. If not,
 * it triggers botRestart to bring it back.
 *
 * This catches the edge case where botRestart.ts ran at startup but a
 * session was inserted AFTER startup (e.g. race condition), or where
 * the in-memory Map was cleared by an unhandled exception.
 */

import { getDb, resetDbConnection } from "./db";
import { botSessions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getBotState } from "./botEngine";
import { restartSingleSession } from "./botRestart";
import { emitActivity } from "./activityLog";

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startBotWatchdog(intervalMs = 60_000) {
  if (watchdogTimer) return; // already running

  watchdogTimer = setInterval(async () => {
    try {
      await runWatchdogCycle();
    } catch (err) {
      console.error("[BotWatchdog] Error during watchdog cycle:", err);
      const errMsg = String(err);
      if (errMsg.includes("Connection lost") || errMsg.includes("ECONNRESET") || errMsg.includes("PROTOCOL_CONNECTION_LOST")) {
        resetDbConnection();
      }
    }
  }, intervalMs);

  console.log(`[BotWatchdog] Started — checking every ${intervalMs / 1000}s`);
}

export function stopBotWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

export async function runWatchdogCycle(): Promise<{ checked: number; restarted: number; errors: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, restarted: 0, errors: 0 };

  // Find all sessions marked as running in DB
  const runningSessions = await db
    .select()
    .from(botSessions)
    .where(eq(botSessions.status, "running"));

  let restarted = 0;
  let errors = 0;

  for (const session of runningSessions) {
    const inMemory = getBotState(session.sessionToken);
    if (!inMemory) {
      // Bot is marked running in DB but not in memory — restart it
      console.warn(`[BotWatchdog] Session ${session.sessionToken.slice(0, 8)} marked running but not in memory — triggering restart`);
      emitActivity(session.sessionToken, "bot_crash", `⚠ Bot dropped from memory — watchdog restarting ${session.instrumentLabel ?? session.instrumentToken}`);
      // Send Telegram crash alert
      try {
        if (session.telegramEnabled && session.telegramBotToken && session.telegramChatId) {
          await fetch(`https://api.telegram.org/bot${session.telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: session.telegramChatId,
              text: `⚠️ <b>BOT CRASH DETECTED</b> — ${session.instrumentLabel ?? session.instrumentToken}\nWatchdog restarting automatically...`,
              parse_mode: "HTML",
            }),
          });
        }
      } catch { /* silent */ }
      try {
        const didRestart = await restartSingleSession(session);
        if (didRestart) {
          restarted++;
          emitActivity(session.sessionToken, "bot_start", `✅ Watchdog restarted bot — ${session.instrumentLabel ?? session.instrumentToken}`);
        }
      } catch (err) {
        console.error(`[BotWatchdog] Failed to restart session ${session.sessionToken.slice(0, 8)}:`, err);
        emitActivity(session.sessionToken, "error", `Watchdog restart failed: ${(err as Error).message}`);
        errors++;
      }
    }
  }

  if (restarted > 0 || errors > 0) {
    console.log(`[BotWatchdog] Cycle complete — checked: ${runningSessions.length}, restarted: ${restarted}, errors: ${errors}`);
  }

  return { checked: runningSessions.length, restarted, errors };
}
