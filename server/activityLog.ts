/**
 * activityLog.ts
 *
 * In-memory circular buffer for per-session bot activity events.
 */

export type ActivityEventType =
  | "tick" | "signal" | "trade_open" | "trade_close" | "bot_start" | "bot_stop"
  | "bot_crash" | "sl_update" | "partial_book" | "market_closed" | "bot_pause"
  | "bot_resume" | "error";

export interface ActivityEvent {
  id: number;
  ts: number;
  type: ActivityEventType;
  slot: number;
  message: string;
  price?: number;
  pnl?: number;
  confidence?: number;
}

const MAX_EVENTS = 200;
const logs = new Map<string, ActivityEvent[]>();
let globalId = 0;

function rootAndSlot(sessionToken: string): { rootToken: string; slot: number } {
  const match = sessionToken.match(/-slot(\d+)$/);
  return { rootToken: sessionToken.replace(/-slot\d+$/, ""), slot: match ? Number(match[1]) : 0 };
}

export function emitActivity(
  sessionToken: string,
  type: ActivityEventType,
  message: string,
  extras?: { price?: number; pnl?: number; confidence?: number; slot?: number },
): void {
  const { rootToken, slot } = rootAndSlot(sessionToken);
  const buf = logs.get(rootToken) ?? [];
  buf.push({ id: ++globalId, ts: Date.now(), type, slot: extras?.slot ?? slot, message, price: extras?.price, pnl: extras?.pnl, confidence: extras?.confidence });
  if (buf.length > MAX_EVENTS) buf.splice(0, buf.length - MAX_EVENTS);
  logs.set(rootToken, buf);
}

export function getActivity(sessionToken: string, limit = 50, afterId = 0): ActivityEvent[] {
  const { rootToken } = rootAndSlot(sessionToken);
  const buf = logs.get(rootToken) ?? [];
  return (afterId > 0 ? buf.filter(event => event.id > afterId) : buf).slice(-limit);
}

export function clearActivity(sessionToken: string, clearAll = false): void {
  const { rootToken, slot } = rootAndSlot(sessionToken);
  if (clearAll) {
    logs.delete(rootToken);
    return;
  }
  const buf = logs.get(rootToken);
  if (!buf) return;
  const remaining = buf.filter(event => event.slot !== slot);
  if (remaining.length === 0) logs.delete(rootToken);
  else logs.set(rootToken, remaining);
}
