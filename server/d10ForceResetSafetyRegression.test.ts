import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
const clientSource = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/Dashboard.tsx"), "utf8");
const forceResetStart = routerSource.indexOf("forceReset: publicProcedure");
const forceResetEnd = routerSource.indexOf("setCarryForward: publicProcedure", forceResetStart);
const forceResetSource = routerSource.slice(forceResetStart, forceResetEnd);

describe("D10 force-reset safety contract", () => {
  it("rejects a reset before mutating an in-memory open trade", () => {
    const inMemoryGuard = forceResetSource.indexOf("if (state?.openTrade)");
    const stateMutation = forceResetSource.indexOf('state.status = "running"');
    expect(inMemoryGuard).toBeGreaterThan(-1);
    expect(stateMutation).toBeGreaterThan(inMemoryGuard);
    expect(forceResetSource).toContain("reset cannot discard position state");
  });

  it("fails closed when durable trade state is unavailable or contains an open trade", () => {
    expect(forceResetSource).toContain("if (!db)");
    expect(forceResetSource).toContain("trade state could not be verified");
    expect(forceResetSource).toContain('eq(tradeLog.status, "open")');
    expect(forceResetSource).toContain("durable ledger");
  });

  it("does not acknowledge daily loss or clear a position reference", () => {
    expect(forceResetSource).not.toContain("state.openTrade = null");
    expect(forceResetSource).not.toContain("state.dailyLossAcknowledged = true");
    expect(forceResetSource).toContain("Preserve dailyLossAcknowledged");
  });

  it("does not promise that reset clears a stale position in the dashboard", () => {
    expect(clientSource).not.toContain("stale position reference");
  });
});
