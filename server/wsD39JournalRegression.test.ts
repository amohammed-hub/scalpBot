import { describe, expect, it } from "vitest";
import { UPSTOX_WS_LIMITS, getUpstoxWebSocketStatus, resetUpstoxMarketDataFeedsForTests } from "./upstoxMarketDataFeed";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const engine = readFileSync(resolve(root, "server/botEngine.ts"), "utf8");
const schema = readFileSync(resolve(root, "drizzle/schema.ts"), "utf8");
const db = readFileSync(resolve(root, "server/db.ts"), "utf8");
const migration = readFileSync(resolve(root, "drizzle/0028_long_reject_reason.sql"), "utf8");

function has(text: string, fragment: string): boolean { return text.includes(fragment); }

describe("live feed, D39, and journal production contracts", () => {
  it("starts one shared feed per access token and prefers fresh websocket quotes", () => {
    expect(has(engine, "ensureUpstoxMarketDataFeed")).toBe(true);
    expect(has(engine, "getUpstoxWebSocketQuote")).toBe(true);
    expect(has(engine, "void ensureUpstoxMarketDataFeed(state.accessToken")).toBe(true);
    expect(has(engine, "const wsQuote = getUpstoxWebSocketQuote(accessToken, instrumentToken)")).toBe(true);
  });

  it("bounds the V3 subscription and exposes deterministic idle status", () => {
    expect(UPSTOX_WS_LIMITS.maxFullKeys).toBe(2000);
    expect(UPSTOX_WS_LIMITS.maxLtpcKeys).toBe(5000);
    resetUpstoxMarketDataFeedsForTests();
    expect(getUpstoxWebSocketStatus("missing-token").state).toBe("idle");
  });

  it("uses an explicit bounded MCX D39 budget floor, never an unlimited override", () => {
    expect(has(engine, "MCX_MIN_RISK_BUDGET_PCT")).toBe(true);
    expect(has(engine, "Math.min(5, Math.max(1")).toBe(true);
    expect(has(engine, "const effectiveRiskBudget")).toBe(true);
    expect(has(engine, "one-lot risk remains bounded")).toBe(true);
  });

  it("widens rejectReason in schema, migration, and startup repair", () => {
    expect(has(schema, 'rejectReason: varchar("rejectReason", { length: 1024 })')).toBe(true);
    expect(migration).toContain("MODIFY COLUMN `rejectReason` varchar(1024)");
    expect(db).toContain("signal_journal.rejectReason");
    expect(db).toContain("widening signal_journal.rejectReason to varchar(1024)");
  });
});
