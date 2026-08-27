import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => readFileSync(resolve(here, relativePath), "utf8");

function sliceBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

describe("full incident re-audit reproductions", () => {
  it("adopts the server-owned durable session and bearer token after OTP verification", () => {
    const login = source("../client/src/pages/Login.tsx");

    expect(login).toContain("const durableSessionToken = result.user?.sessionToken;");
    expect(login).toContain('localStorage.setItem("scalpbot_session", durableSessionToken);');
    expect(login).toContain('localStorage.setItem("scalpbot_auth_token", result.token');
    expect(login).not.toContain('localStorage.getItem("scalpbot_session_token")');
    expect(login).not.toContain('|| "admin_session"');
  });

  it("does not contain a universal OTP that can mint an admin identity", () => {
    const routers = source("routers.ts");
    const mobileAuth = sliceBetween(routers, "mobileAuth: router({", "// Admin Panel");

    expect(mobileAuth).not.toContain('input.code === "270290"');
    expect(mobileAuth).not.toContain("Admin Bypass");
  });

  it("never fabricates a tenant token from a JWT when the durable user row is unavailable", () => {
    const routers = source("routers.ts");
    const meProcedure = sliceBetween(routers, "me: publicProcedure", "updateName: publicProcedure");

    expect(meProcedure).not.toContain("`user_${decoded.userId}`");
    expect(meProcedure).not.toContain('decoded.role === "admin" ? "admin_session"');
    expect(meProcedure).toContain("return null;");
  });

  it("scopes in-memory cooldowns, entry locks, and recent-symbol queries to the owning tenant", () => {
    const engine = source("botEngine.ts");

    expect(engine).toContain("function getTenantInstrumentKey(sessionToken: string, symbol: string)");
    expect(engine).toContain("function getTenantSymbolLockKey(sessionToken: string, symbol: string)");
    // PDF Step 2 removes the entry-blocking cooldown lookup; tenant-scoped tracking remains for diagnostics/backward compatibility.
    expect(engine).toContain("instrumentCooldowns.set(getTenantInstrumentKey(state.sessionToken, (state.instrumentSymbol ?? \"\").toUpperCase()), Date.now())");
    expect(engine).toContain("isSymbolGloballyLocked(state.sessionToken, tradeLabel)");
    expect(engine).toContain("lockSymbolGlobally(state.sessionToken, tradeLabel)");
    expect(engine).toContain("eq(tradeLog.sessionToken, state.sessionToken)");
  });

  it("releases a tenant symbol lock on every guarded early return", () => {
    const engine = source("botEngine.ts");
    const entryGuard = sliceBetween(
      engine,
      "// DB-level guard: check if there's already an open trade for this session in the database.",
      "// ── CRITICAL FIX: Set mutex BEFORE cross-bot check",
    );

    const guardedReturns = entryGuard.split("return;").slice(0, -1);
    expect(guardedReturns.length).toBeGreaterThanOrEqual(2);
    for (const branch of guardedReturns) {
      expect(branch.slice(-300)).toContain("unlockSymbolGlobally(state.sessionToken, tradeLabel)");
    }
  });

  it("leaves the DB trade row open when a live broker exit order fails", () => {
    const riskManager = source("riskManager.ts");
    const killSwitchStart = riskManager.indexOf("export async function executeKillSwitch(");
    const killSwitchEnd = riskManager.indexOf("export function getDemoCostConfig", killSwitchStart);
    const killSwitchSource = riskManager.slice(killSwitchStart, killSwitchEnd);

    const missingOrderBranch = sliceBetween(
      killSwitchSource,
      "if (!killOrderId)",
      "if (upstoxOrderFailed) {",
    );

    // A failed LIVE exit order must never be papered over with a DB-only close —
    // the live position stays open on Upstox and the DB row stays open for retry.
    expect(missingOrderBranch).not.toContain("onTradeClose");
    expect(missingOrderBranch).not.toContain("bot.openTrade = null");
    expect(killSwitchSource).toContain("position still open on Upstox");
    expect(killSwitchSource).toContain("killSwitchExitFailed");
    expect(killSwitchSource).toContain("if (!upstoxOrderFailed) closedTrades++");
  });

  it("retains truthful first-scan readiness before reporting bot-start success", () => {
    const engine = source("botEngine.ts");
    const routers = source("routers.ts");

    expect(engine).toContain("return { state, initialTick };");
    expect(routers).toContain("const readiness = await startResult.initialTick;");
    expect(routers).toContain("if (!readiness.ready");
  });
});
