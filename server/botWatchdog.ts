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
import { isBotAutomationEnabled } from "./botAutomation";
import { canAutoRestartSession, partitionCanonicalSessionRows } from "./botSessionLifecycle";
import { botSessions } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { getBotState, stopBot } from "./botEngine";
import { restartSingleSession } from "./botRestart";
import { emitActivity } from "./activityLog";

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startBotWatchdog(intervalMs = 60_000) {
  if (!isBotAutomationEnabled()) {
    console.log("[BotWatchdog] Disabled: BOT_AUTOMATION_ENABLED is not true.");
    return;
  }

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
  if (!isBotAutomationEnabled()) {
    return { checked: 0, restarted: 0, errors: 0 };
  }

  const db = await getDb();
  if (!db) return { checked: 0, restarted: 0, errors: 0 };

  // Find all sessions marked as running in DB
  const runningSessions = await db
    .select()
    .from(botSessions)
    .where(eq(botSessions.status, "running"));

  // D17c — If a slot-keyed running row has no in-memory state but the stale shared
  // base-token bot is still alive in memory, stop the stale bot first. Otherwise the
  // restart below would spin up a second scan loop against the same instruments.
  for (const session of runningSessions) {
    if (!/-slot\d+$/.test(session.sessionToken)) continue;
    if (getBotState(session.sessionToken)) continue;
    const baseKey = session.sessionToken.replace(/-slot\d+$/, "");
    if (getBotState(baseKey)) {
      stopBot(baseKey);
      console.log(`[BotWatchdog] D17c stopped stale shared base-token bot ${baseKey.slice(0, 8)}… — ${session.instrumentLabel ?? session.sessionToken.slice(-6)} will restart under its own slot key`);
    }
  }

  const { canonicalRows, duplicateRows } = partitionCanonicalSessionRows<typeof runningSessions[number]>(runningSessions);
  if (duplicateRows.length > 0) {
    await db.update(botSessions).set({
      status: "stopped",
      stoppedAt: new Date(),
      lastError: "Duplicate durable session row decommissioned; newest exact-token row retained",
    }).where(inArray(botSessions.id, duplicateRows.map(row => row.id)));
    console.warn(`[BotWatchdog] Decommissioned ${duplicateRows.length} duplicate exact-token row(s)`);
  }

  let restarted = 0;
  let errors = 0;

  for (const session of canonicalRows) {
    if (!canAutoRestartSession(session)) {
      console.log(`[BotWatchdog] Session ${session.sessionToken.slice(0, 8)} skipped — durable kill-switch stop marker present`);
      continue;
    }

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
    console.log(`[BotWatchdog] Cycle complete — checked: ${canonicalRows.length}, restarted: ${restarted}, errors: ${errors}`);
  }

  return { checked: canonicalRows.length, restarted, errors };
}
