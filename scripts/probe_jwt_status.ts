/**
 * One-off Railway-side probe: mint an admin JWT using the deployed JWT secret,
 * then call the local tRPC endpoint (no network hop) to read the live in-memory
 * bot state — exact token keys, slots, and per-bot trade counts.
 */
import jwt from "jsonwebtoken";
import { appRouter } from "../routers";
import { getDb } from "../db";
import { getBotState } from "../botEngine";

const secret = process.env.JWT_SECRET ?? process.env.JWT_SECRET_KEY ?? "";
if (!secret) {
  console.error("NO JWT SECRET FOUND");
  process.exit(1);
}

const token = jwt.sign(
  { userId: 1, role: "admin", mobile: process.env.ADMIN_MOBILE ?? "" },
  secret,
  { expiresIn: "5m" },
);

const input = { sessionToken: "8d17c6ad-934f-4c91-b47f-6d54926b8e0a", isAdmin: true };
const caller = appRouter.createCaller({
  req: { cookies: { scalpbot_auth: token }, headers: {} },
  res: {},
  sessionToken: input.sessionToken,
} as any);

const status = await (caller as any).multiBots.allStatus(input);
const bots = status.bots ?? [];
console.log(`\n=== LIVE IN-MEMORY BOTS: ${bots.length} ===`);
for (const b of bots) {
  console.log(
    `${String(b.instrumentLabel ?? "?").padEnd(14)} ` +
    `key=${b.sessionToken ?? "?"}` +
    `${String(b.botSlot ?? "-").padStart(3)} ` +
    `tradesToday=${b.tradesCount ?? "?"} ` +
    `status=${b.status ?? "?"} ` +
    `mode=${b.mode ?? "?"}`,
  );
}

// Cross-check: which in-memory keys exist that are NOT slot-keyed while slot rows run?
const db = await getDb();
if (db) {
  const running = await db.select().from((await import("../drizzle/schema")).botSessions)
    .where((await import("drizzle-orm")).eq((await import("../drizzle/schema")).botSessions.status, "running"));
  console.log("\n=== DB RUNNING ROWS ===");
  for (const r of running) {
    console.log(`${String(r.instrumentSymbol ?? "?").padEnd(12)} token=${r.sessionToken} slot=${r.botSlot ?? 0} inMem=${!!getBotState(r.sessionToken)}`);
  }
}
process.exit(0);
