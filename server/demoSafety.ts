// ── Demo Safety Lock (D21) — Global authority for Demo/Live mode ─────────────
//
// Root cause this fixes (verified 13 Aug 2026):
//   A bot was started in Live mode; the user then flipped the dashboard toggle
//   to Demo. The toggle only affected NEW bot starts — the running Live bot kept
//   placing real Upstox orders because mode was frozen per-bot at start time and
//   NO server-side authority ever re-checked the user's Demo intent.
//
// Design (defense in depth):
//   1. The Demo Safety flag is owned by the SERVER, keyed per sessionToken.
//      The UI toggle writes it through a tRPC router; it is persisted to the
//      `admin_settings` DB table so it survives Railway restarts/redeploys.
//   2. Order egress (every real Upstox order path) consults this flag. If the
//      flag is ON for the session, ANY live order — entry, partial, averaging,
//      hero exit, or exit — is blocked at the function boundary, even if the
//      bot session itself is mode="live". The block is logged, telegraphed, and
//      surfaced in the activity feed.
//   3. Bot start (bot.start / multiBots.startSecondary) refuses mode="live"
//      while the flag is ON for the session.
//
// This module deliberately has no client-facing concept of "demo mode" beyond
// the flag itself: whether a bot is mode=demo (with sandbox fills) or the flag
// is on, the outcome is identical — zero real Upstox order traffic.


export const DEMO_SAFETY_KEY_PREFIX = "demoSafety_";

/**
 * In-memory per-session Demo Safety state.
 * Key: sessionToken (base token, i.e. slot bots share the owner's flag via
 *      the base-token normalization below).
 * Value: true = Demo Safety ON (no live Upstox orders may be placed by this
 *        session or any of its slot bots).
 */
const demoSafetyBySession = new Map<string, boolean>();

let _demoSafetyLoadedFromDb = false;

export function demoSafetyActiveFor(sessionToken: string): boolean {
  if (!sessionToken) return false;
  // Slot bots (abc-slotN) inherit the owner's Demo Safety flag.
  const base = sessionToken.replace(/-slot\d+$/, "");
  return demoSafetyBySession.get(base) === true;
}

export function setDemoSafety(sessionToken: string, active: boolean): void {
  const base = sessionToken.replace(/-slot\d+$/, "");
  demoSafetyBySession.set(base, active);
  console.log(`[DemoSafety] ${active ? "ON" : "OFF"} for ${base.slice(0, 8)}... (in-memory)`);
  persistDemoSafety(base, active).catch(err => {
    console.error(`[DemoSafety] DB persistence failed: ${(err as Error).message}`);
  });
}

async function persistDemoSafety(baseSessionToken: string, active: boolean): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { adminSettings } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    const key = `${DEMO_SAFETY_KEY_PREFIX}${baseSessionToken}`;
    const value = active ? "1" : "0";
    const existing = await db.select().from(adminSettings).where(eq(adminSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(adminSettings).set({ value }).where(eq(adminSettings.key, key));
    } else {
      await db.insert(adminSettings).values({ key, value });
    }
    console.log(`[DemoSafety] Persisted demoSafety=${value} for ${baseSessionToken.slice(0, 8)}...`);
  } catch (err) {
    console.warn(`[DemoSafety] Failed to persist demo safety to DB: ${(err as Error).message}`);
  }
}

/** Load persisted Demo Safety flags on server startup (call once during init). */
export async function loadDemoSafetyFromDb(): Promise<void> {
  if (_demoSafetyLoadedFromDb) return;
  _demoSafetyLoadedFromDb = true;
  try {
    const { getDb } = await import("./db");
    const { adminSettings } = await import("../drizzle/schema");
    const { like } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    const rows = await db.select().from(adminSettings).where(like(adminSettings.key, `${DEMO_SAFETY_KEY_PREFIX}%`));
    for (const row of rows) {
      const baseToken = row.key.replace(DEMO_SAFETY_KEY_PREFIX, "");
      demoSafetyBySession.set(baseToken, row.value === "1");
    }
    console.log(`[DemoSafety] Loaded ${rows.length} persisted demo-safety flag(s) from DB.`);
  } catch (err) {
    console.warn(`[DemoSafety] Failed to load demo safety from DB: ${(err as Error).message}`);
  }
}

/**
 * Egress assertion: throws if Demo Safety is active for this session.
 * Call sites MUST pass the bot's sessionToken so slot bots inherit the flag.
 * Returns false if blocked (used in async order paths where throwing would be
 * swallowed); prefer {@link assertDemoSafetyOff} when a thrown error propagates.
 */
export function isLiveOrderBlockedByDemoSafety(sessionToken: string): boolean {
  return demoSafetyActiveFor(sessionToken);
}

export function assertDemoSafetyOff(sessionToken: string): void {
  if (demoSafetyActiveFor(sessionToken)) {
    throw new Error(
      `Demo Safety is ON for this session — live Upstox orders are blocked. ` +
      `Turn Demo Safety OFF in the dashboard to resume live trading.`
    );
  }
}

/**
 * Convenience used by the UI status endpoint to show whether the flag is on.
 */
export function getAllDemoSafetyStates(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  demoSafetyBySession.forEach((v, k) => { out[k] = v; });
  return out;
}
