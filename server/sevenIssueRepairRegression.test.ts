import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  calcMeanReversionV13Deviation,
  generateMeanReversionV13Signal,
  type Candle,
} from "./botEngine";
import { partitionCanonicalSessionRows } from "./botSessionLifecycle";

const here = dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => readFileSync(resolve(here, relativePath), "utf8");
const expectSourceContains = (content: string, fragment: string) => {
  expect(content.includes(fragment), `missing source contract: ${fragment}`).toBe(true);
};
const expectSourceExcludes = (content: string, fragment: string) => {
  expect(content.includes(fragment), `forbidden source contract remains: ${fragment}`).toBe(false);
};

function meanReversionFixture(volume: number): Candle[] {
  const start = Date.UTC(2026, 6, 30, 4, 11); // final candle is 10:30 IST
  const candles: Candle[] = Array.from({ length: 48 }, (_, index) => {
    const isUpswing = index % 2 === 0;
    const declineStep = Math.max(0, index - 28);
    const close = 100 - declineStep * 0.45 + (isUpswing ? 0.05 : 0);
    return {
      open: close + 0.35,
      // Alternating broad ranges keep directional movement balanced while the
      // close series becomes genuinely oversold before the final rejection.
      high: isUpswing ? 112 : 108,
      low: isUpswing ? 92 : 88,
      close,
      volume,
      timestamp: start + index * 60_000,
    };
  });
  candles.push({
    open: candles[candles.length - 1].close,
    high: 100,
    low: 69.5,
    close: 70,
    volume,
    timestamp: start + 48 * 60_000,
  });
  candles.push({
    open: 69.5,
    high: 72,
    low: 68,
    close: 71,
    volume,
    timestamp: start + 49 * 60_000,
  });
  return candles;
}

describe("seven-issue production repair", () => {
  it("keeps one newest durable row per exact tenant-and-slot token", () => {
    const rows = [
      { id: 1, sessionToken: "tenant-a", updatedAt: new Date("2026-07-29T10:00:00Z") },
      { id: 2, sessionToken: "tenant-a", updatedAt: new Date("2026-07-30T10:00:00Z") },
      { id: 3, sessionToken: "tenant-a-slot1", updatedAt: new Date("2026-07-28T10:00:00Z") },
      { id: 4, sessionToken: "tenant-b", updatedAt: new Date("2026-07-30T09:00:00Z") },
    ];

    const result = partitionCanonicalSessionRows(rows);
    expect(result.canonicalRows.map(row => row.id)).toEqual([2, 3, 4]);
    expect(result.duplicateRows.map(row => row.id)).toEqual([1]);
  });

  it("gives zero-volume index candles a real price anchor instead of a permanent zero z-score", () => {
    const result = calcMeanReversionV13Deviation(meanReversionFixture(0));
    expect(result.volumeAvailable).toBe(false);
    expect(result.anchor).toBe("typical-price");
    expect(result.zScore).toBeLessThan(-1.8);
  });

  it("allows a genuinely qualifying zero-volume index reversal to reach Mean Reversion V13", () => {
    const signal = generateMeanReversionV13Signal(meanReversionFixture(0));
    expect(signal.direction, signal.reason).toBe("BUY");
    expect(signal.layer).toBe("MeanReversionV13");
    expect(signal.reason).toContain("IndexRejection(no-volume-feed)");
  });

  it("still requires a real volume spike when the feed supplies meaningful volume", () => {
    const signal = generateMeanReversionV13Signal(meanReversionFixture(100));
    expect(signal.direction).toBe("HOLD");
    expect(signal.reason).toContain("Volume ratio");
  });

  it("preserves the server-owned session on repeat OTP login", () => {
    const dbSource = source("db.ts");
    expectSourceContains(dbSource, "const durableToken = storedToken || clientSessionToken || crypto.randomUUID();");
    expectSourceContains(dbSource, "sessionToken: durableToken");
    expectSourceExcludes(dbSource, ".set({ sessionToken: clientSessionToken })");
  });

  it("isolates auth bootstrap, caps batches, and defers tenant queries until hydration", () => {
    const mainSource = source("../client/src/main.tsx");
    const dashboardSource = source("../client/src/pages/Dashboard.tsx");
    expectSourceContains(mainSource, "splitLink");
    expectSourceContains(mainSource, "maxItems: 4");
    expectSourceContains(mainSource, 'op.type === "mutation" || op.path === "mobileAuth.me"');
    expectSourceContains(dashboardSource, "const authReady =");
    expectSourceContains(dashboardSource, "enabled: authReady");
    expectSourceContains(dashboardSource, "localStorage.setItem(\"scalpbot_session\", durableToken)");
  });

  it("keeps OTP protection separate from authenticated dashboard traffic", () => {
    const serverSource = source("_core/index.ts");
    expectSourceContains(serverSource, 'req.originalUrl.includes("/api/trpc/mobileAuth.sendOtp")');
    expectSourceContains(serverSource, 'app.use("/api/trpc/mobileAuth.sendOtp", otpLimiter)');
    expectSourceContains(serverSource, 'app.use("/api/trpc/mobileAuth.verifyOtp", otpLimiter)');
  });

  it("derives multi-bot entitlement from authenticated ownership and batches database reads", () => {
    const routerSource = source("routers.ts");
    expectSourceContains(routerSource, "await verifySessionOwnership(ctx, input.sessionToken);");
    expectSourceContains(routerSource, "legacy\n        // client-supplied isAdmin flag remains in the input for wire compatibility but\n        // is intentionally ignored");
    expectSourceContains(routerSource, "livePrices: publicProcedure");
    expectSourceContains(routerSource, ".query(async ({ input, ctx }) => {\n        await verifySessionOwnership(ctx, input.sessionToken);\n        const slotTokens");
    expectSourceContains(routerSource, "inArray(botSessions.sessionToken, slotTokens)");
    expectSourceContains(routerSource, ".groupBy(tradeLog.sessionToken)");
    expectSourceExcludes(routerSource, "if (userRow.role === \"admin\" || input.isAdmin)");
  });

  it("waits for first-scan readiness and never reports success after an initial engine failure", () => {
    const engineSource = source("botEngine.ts");
    const routerSource = source("routers.ts");
    expectSourceContains(engineSource, "return { state, initialTick };");
    expectSourceContains(routerSource, "const readiness = await startResult.initialTick;");
    expectSourceContains(routerSource, "if (!readiness.ready");
    expectSourceContains(routerSource, "stopBot(input.sessionToken)");
    expectSourceContains(routerSource, "stopBot(slotToken)");
  });

  it("never manufactures an entry-price exit when an exact option quote is unavailable", () => {
    const engineSource = source("botEngine.ts");
    const restartSource = source("botRestart.ts");
    expectSourceExcludes(engineSource, '"Expired Option — Auto Close"');
    expectSourceContains(engineSource, "Position remains open; no synthetic exit was written");
    expectSourceContains(restartSource, "requires broker reconciliation — keeping it open");
    expectSourceContains(restartSource, "has no trustworthy exact-contract quote — keeping it open");
  });

  it("uses bounded parallel exact-token quotes and preserves stale marks", () => {
    const routerSource = source("routers.ts");
    expectSourceContains(routerSource, "Promise.all(runningBots.map");
    expectSourceContains(routerSource, "timeoutMs: 2500");
    expectSourceContains(routerSource, 'bot.optionQuoteStatus = "stale"');
  });

  it("exposes the admin panel on mobile only under the verified admin role", () => {
    const dashboardSource = source("../client/src/pages/Dashboard.tsx");
    expectSourceContains(dashboardSource, "{isAdmin && (");
    expectSourceContains(dashboardSource, 'aria-label="Open Admin Panel"');
    expectSourceContains(dashboardSource, "setShowAdminPanel(true)");
  });

  it("runs every advertised strategy in the backtest All mode", () => {
    const routerSource = source("routers.ts");
    const backtestSource = source("../client/src/pages/Backtest.tsx");
    for (const strategy of [
      "MeanReversionV13",
      "RedBarTheory",
      "BoxingStrategy",
      "ORB",
      "TrikalStrategy",
      "Adeeb",
      "V1",
      "V2",
    ]) {
      expectSourceContains(backtestSource, `value=\"${strategy}\"`);
      expectSourceContains(routerSource, `case \"${strategy}\"`);
    }
    for (const generator of [
      "generateSignal(window",
      "generateSignalV2(window",
      "generateMeanReversionV13Signal(window)",
      "generateRenkoSignal(window)",
      "generateBoxingSignal(window",
      "generateORBV8Signal(window",
      "generateSmartRenkoSignal(window)",
      "generateAdeebSignal(window",
    ]) {
      expectSourceContains(routerSource, generator);
    }
  });
});
