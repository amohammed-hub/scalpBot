/**
 * D17 — Slot Token Migration & Collision Guard
 *
 * Root cause (Aug 12, 2026): a number of running bot_sessions were created by the legacy
 * bot.start flow with botSlot > 0 but stored under the BASE session token (no -slotN suffix).
 * All slots then shared the SAME in-memory BotEngine state (the state map is keyed by
 * sessionToken), so:
 *   - Bot cards read in-memory tradesCount keyed by base token → counts include OTHER bots' trades
 *     ("Bot 4 showed 2 trades" that were actually CRUDE's trades)
 *   - The trade log (correctly keyed by -slotN token since the slot-aware router shipped) shows 0
 *     for the affected slot → card vs log mismatch
 *   - Two MCX bots running under the same base token shared one scan loop → the last-started bot
 *     owned the ticks and the other bot (Natural Gas) never got its own signals → "no trades
 *     triggered in the Natural Gas bot"
 *
 * This module:
 *   1. MigrateLegacySlotTokens()  — one-time migration: re-keys running bot_sessions rows with
 *      botSlot > 0 and a base token to the correct `${base}-slot${botSlot}` key. Also stops the
 *      legacy in-memory state so the slot-aware start flow re-registers under the slot key.
 *   2. GuardSameKeyStart()        — server-side guard: bot.start with botSlot > 0 and a base
 *      token is rejected (the secondary slot start flow must be used instead).
 */

import { getDb } from "./db";
import { botSessions } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { stopBot, getBotState } from "./botEngine";

export const SLOT_TOKEN_RE = /-slot(\d+)$/;

/** Expected slot token for a base token and slot number. */
export function expectedSlotToken(baseToken: string, slot: number): string {
  return slot === 0 ? baseToken : `${baseToken}-slot${slot}`;
}

/** True when the token already carries a -slotN suffix. */
export function hasSlotSuffix(token: string): boolean {
  return SLOT_TOKEN_RE.test(token);
}

/**
 * One-time migration: re-key running legacy sessions to their correct slot tokens.
 * Call this from the slot-aware start flow and from the allStatus/health path so the
 * migration self-heals on first access after deploy.
 *
 * Side effects:
 *   - bot_sessions.sessionToken updated to base-slotN for botSlot > 0 rows using the base token
 *   - the legacy in-memory bot state (keyed by base token) is stopped so the new slot key starts
 *     with a clean state on next start
 * Returns a human-readable summary of what was migrated.
 */
export async function migrateLegacySlotTokens(baseToken: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const actions: string[] = [];

  // Find running sessions under the base token whose botSlot > 0 (legacy mis-keyed slots)
  const rows = await db
    .select({ id: botSessions.id, botSlot: botSessions.botSlot, instrumentSymbol: botSessions.instrumentSymbol, status: botSessions.status })
    .from(botSessions)
    .where(and(eq(botSessions.sessionToken, baseToken), eq(botSessions.status, "running")))
    .orderBy(botSessions.id);

  const miskeyed = rows.filter((r: { botSlot: number }) => r.botSlot > 0);
  if (miskeyed.length === 0) return actions;

  for (const row of miskeyed) {
    const slotToken = expectedSlotToken(baseToken, Number(row.botSlot));
    // Safety: never overwrite an existing row's identity — if the slot key is already in use
    // by another running session, stop the legacy one instead of merging data.
    const existingAtSlotKey = await db
      .select({ id: botSessions.id, instrumentSymbol: botSessions.instrumentSymbol })
      .from(botSessions)
      .where(and(eq(botSessions.sessionToken, slotToken)))
      .limit(1);
    if (existingAtSlotKey.length > 0) {
      // Stop the legacy in-memory state; the DB row stays but no longer reports running here.
      await db.update(botSessions).set({ status: "stopped", stoppedAt: new Date() }).where(eq(botSessions.id, row.id));
      actions.push(`slot${row.botSlot} (${row.instrumentSymbol}): duplicated slot key ${slotToken.slice(-8)}… already owned by ${existingAtSlotKey[0].instrumentSymbol} — legacy row marked stopped`);
      continue;
    }
    // Re-key the DB row to its slot token
    await db
      .update(botSessions)
      .set({ sessionToken: slotToken })
      .where(eq(botSessions.id, row.id));
    actions.push(`slot${row.botSlot} (${row.instrumentSymbol}): re-keyed to ${slotToken.slice(-12)}…`);
  }

  // Stop the legacy in-memory state keyed by the base token so counters no longer collide.
  // The slot-aware start flow will register under the slot key on next start.
  const legacyState = getBotState(baseToken);
  if (legacyState && miskeyed.length > 0) {
    stopBot(baseToken);
    actions.push("legacy in-memory state (base token) stopped — slots must restart via the slot-aware start flow");
  }
  return actions;
}

/**
 * Guard: reject starts that would collide with an existing session key. Two bots must never
 * share the same sessionToken key in memory — that is the exact collision that made Bot 4's
 * scan loop shared with Crude Oil.
 * Returns a non-null error message when the start must be refused.
 */
export function guardSameKeyStart(sessionToken: string, botSlot: number): string | null {
  const expected = expectedSlotToken(sessionToken, botSlot);
  if (expected !== sessionToken) {
    return `Slot ${botSlot} bots must start through the slot start flow (token ${expected.slice(-12)}…).`;
  }
  const existing = getBotState(sessionToken);
  if (existing?.status === "running") {
    return `A bot is already running under this session key (${sessionToken.slice(-12)}…). Stop it first.`;
  }
  return null;
}

/**
 * Reconcile per-slot counts for the dashboard: returns today's closed-trade count strictly
 * for the given token key (no cross-slot leakage). Exported so routers can use the same
 * single source of truth as the trade log.
 */
export async function countTradesForToken(sessionToken: string): Promise<{ todayTrades: number; todayPnl: number }> {
  const db = await getDb();
  if (!db) return { todayTrades: 0, todayPnl: 0 };
  const nowMs_ = Date.now(); const istOff_ = 5.5 * 60 * 60 * 1000; const istN_ = new Date(nowMs_ + istOff_); istN_.setUTCHours(0, 0, 0, 0); const todayStart = new Date(istN_.getTime() - istOff_);
  const { tradeLog } = await import("../drizzle/schema");
  const counts = await db
    .select({ count: sql<number>`count(*)`, pnl: sql<number>`coalesce(sum(pnl),0)` })
    .from(tradeLog)
    .where(and(eq(tradeLog.sessionToken, sessionToken), eq(tradeLog.status, "closed"), sql`exited_at >= ${todayStart}`));
  const rows2 = await db
    .select({ count: sql<number>`count(*)` })
    .from(tradeLog)
    .where(and(eq(tradeLog.sessionToken, sessionToken), sql`entered_at >= ${todayStart}`));
  return { todayTrades: Number(rows2[0]?.count ?? 0), todayPnl: Number(counts[0]?.pnl ?? 0) };
}
