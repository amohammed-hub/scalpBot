/**
 * activityLog.ts
 *
 * In-memory circular buffer for per-session bot activity events.
 * Stores the last MAX_EVENTS events per session token.
 * Events are emitted by botEngine callbacks and read by the tRPC activity.log procedure.
 */

export type ActivityEventType =
  | "tick"
  | "signal"
  | "trade_open"
  | "trade_close"
  | "bot_start"
  | "bot_stop"
  | "bot_crash"
  | "sl_update"
  | "partial_book"
  | "market_closed"
  | "error";

export interface ActivityEvent {
  id: number;
  ts: number; // Unix ms
  type: ActivityEventType;
  slot: number; // 0 = primary, 1 = slot1, 2 = slot2, 3 = slot3
  message: string;
  price?: number;
  pnl?: number;
  confidence?: number;
}

const MAX_EVENTS = 200;
const logs = new Map<string, ActivityEvent[]>();
let globalId = 0;

/**
 * Emit an activity event for a session.
 * sessionToken should be the ROOT token (without -slot1/-slot2 suffix).
 */
export function emitActivity(
  sessionToken: string,
  type: ActivityEventType,
  message: string,
  extras?: { price?: number; pnl?: number; confidence?: number; slot?: number }
): void {
  // Normalize: strip -slot1 / -slot2 / -slot3 suffix so all slots write to the same log
  const rootToken = sessionToken.replace(/-slot[123]$/, "");
  const slot = sessionToken.endsWith("-slot3") ? 3 : sessionToken.endsWith("-slot2") ? 2 : sessionToken.endsWith("-slot1") ? 1 : 0;

  if (!logs.has(rootToken)) logs.set(rootToken, []);
  const buf = logs.get(rootToken)!;

  buf.push({
    id: ++globalId,
    ts: Date.now(),
    type,
    slot: extras?.slot ?? slot,
    message,
    price: extras?.price,
    pnl: extras?.pnl,
    confidence: extras?.confidence,
  });

  // Trim to MAX_EVENTS
  if (buf.length > MAX_EVENTS) buf.splice(0, buf.length - MAX_EVENTS);
}

/**
 * Get the last `limit` events for a session, optionally after a given event id.
 */
export function getActivity(
  sessionToken: string,
  limit = 50,
  afterId = 0
): ActivityEvent[] {
  const rootToken = sessionToken.replace(/-slot[123]$/, "");
  const buf = logs.get(rootToken) ?? [];
  const filtered = afterId > 0 ? buf.filter(e => e.id > afterId) : buf;
  return filtered.slice(-limit);
}

/**
 * Clear activity log for a session (e.g. on bot stop).
 * Only clears events for the specific slot, not all slots' logs.
 */
export function clearActivity(sessionToken: string, clearAll = false): void {
  const rootToken = sessionToken.replace(/-slot[123]$/, "");
  if (clearAll) {
    logs.delete(rootToken);
    return;
  }
  // Only clear events for the specific slot
  const slot = sessionToken.endsWith("-slot3") ? 3 : sessionToken.endsWith("-slot2") ? 2 : sessionToken.endsWith("-slot1") ? 1 : 0;
  const buf = logs.get(rootToken);
  if (buf) {
    const filtered = buf.filter(e => e.slot !== slot);
    if (filtered.length === 0) logs.delete(rootToken);
    else logs.set(rootToken, filtered);
  }
}
