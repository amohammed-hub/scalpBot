import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { executeKillSwitch } from "./riskManager";
import {
  KILL_SWITCH_LAST_ERROR,
  canAutoRestartSession,
  getBaseSessionToken,
  hasKillSwitchMarker,
} from "./botSessionLifecycle";

describe("bot session lifecycle policy", () => {
  it("normalizes primary and secondary slot tokens to one owner base", () => {
    expect(getBaseSessionToken("owner-token")).toBe("owner-token");
    expect(getBaseSessionToken("owner-token-slot1")).toBe("owner-token");
    expect(getBaseSessionToken("owner-token-slot9")).toBe("owner-token");
  });

  it("recognizes kill-switch markers case-insensitively", () => {
    expect(hasKillSwitchMarker(KILL_SWITCH_LAST_ERROR)).toBe(true);
    expect(hasKillSwitchMarker("Emergency KILL SWITCH requested")).toBe(true);
    expect(hasKillSwitchMarker("Tick error: timeout")).toBe(false);
    expect(hasKillSwitchMarker(null)).toBe(false);
  });

  it("allows automatic recovery only for an explicitly running, non-killed row", () => {
    expect(canAutoRestartSession({ status: "running", lastError: null })).toBe(true);
    expect(canAutoRestartSession({ status: "running", lastError: "Tick error: timeout" })).toBe(true);
    expect(canAutoRestartSession({ status: "stopped", lastError: null })).toBe(false);
    expect(canAutoRestartSession({ status: "paused", lastError: null })).toBe(false);
    expect(canAutoRestartSession({ status: "running", lastError: KILL_SWITCH_LAST_ERROR })).toBe(false);
  });

  it("stops paused bots in memory during a kill switch", async () => {
    const stopBot = vi.fn();
    const pausedBot = {
      sessionToken: "owner-token-slot1",
      status: "paused",
      openTrade: null,
      dailyPnl: 0,
    } as any;

    const result = await executeKillSwitch(
      [pausedBot],
      stopBot,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(stopBot).toHaveBeenCalledOnce();
    expect(stopBot).toHaveBeenCalledWith("owner-token-slot1");
    expect(result).toEqual({ closedTrades: 0, stoppedBots: 1 });
  });
});

describe("kill-switch restart barriers", () => {
  const readSource = (name: string) =>
    readFileSync(new URL(name, import.meta.url), "utf8");

  it("persists all owned session rows before touching the in-memory bot map", () => {
    const routers = readSource("./routers.ts");
    const durableStopIndex = routers.indexOf("const killSwitchStoppedAt = new Date()");
    const inMemoryStopIndex = routers.indexOf("const allBots = getAllBotsForSession(baseSessionToken)");

    expect(routers).toContain("getBaseSessionToken(input.sessionToken)");
    expect(routers).toContain("like(botSessions.sessionToken, `${baseSessionToken}-slot%`)");
    expect(routers).toContain("lastError: KILL_SWITCH_LAST_ERROR");
    expect(durableStopIndex).toBeGreaterThan(-1);
    expect(inMemoryStopIndex).toBeGreaterThan(-1);
    expect(durableStopIndex).toBeLessThan(inMemoryStopIndex);
  });

  it("guards startup restart, watchdog restart, and engine self-recovery", () => {
    const restart = readSource("./botRestart.ts");
    const watchdog = readSource("./botWatchdog.ts");
    const engine = readSource("./botEngine.ts");

    expect(restart.match(/canAutoRestartSession\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(restart).toContain("const currentRows = await db");
    expect(watchdog).toContain("if (!canAutoRestartSession(session))");
    expect(engine).toContain('state.status === "stopped" || !bots.has(state.sessionToken)');
  });

  it("clears the tombstone only on explicit start/resume paths", () => {
    const routers = readSource("./routers.ts");

    expect(routers.match(/status: "running", stoppedAt: null, lastError: null/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(routers).toContain("startedAt: new Date(), stoppedAt: null, lastError: null");
  });
});
