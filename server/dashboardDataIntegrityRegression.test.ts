import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(here, "../client/src/pages/Dashboard.tsx"), "utf8");
const routerSource = readFileSync(join(here, "routers.ts"), "utf8");
const restartSource = readFileSync(join(here, "botRestart.ts"), "utf8");
const coreIndexSource = readFileSync(join(here, "_core/index.ts"), "utf8");

describe("30 July dashboard data-integrity and five-slot regressions", () => {
  describe("financial metrics fail closed", () => {
    it("does not turn an unavailable portfolio response into fake zero exposure or P&L", () => {
      expect(dashboardSource).toContain('portfolioStatus ? `${portfolioStatus.exposurePct.toFixed(0)}%` : "—"');
      expect(dashboardSource).toContain('portfolioQuery.isError ? "Unavailable — portfolio query failed"');
      expect(dashboardSource).toContain('portfolioQuery.isError ? "Unavailable — P&L query failed"');
      expect(dashboardSource).not.toContain('(portfolioStatus?.exposurePct ?? 0).toFixed(0)');
      expect(dashboardSource).not.toContain('(portfolioStatus?.aggregateDailyPnl ?? 0).toFixed(0)');
    });

    it("computes server portfolio totals only from this session's running in-memory bots", () => {
      expect(routerSource).toContain("const allBots = getAllRunningBotsForSession(input.sessionToken);");
      expect(routerSource).toContain("return getPortfolioStatus(allBots, input.sessionToken);");
    });
  });

  describe("real Upstox account data", () => {
    it("loads profile and funds only after the regular token passes a live health probe", () => {
      expect(dashboardSource).toContain('trpc.account.profile.useQuery(');
      expect(dashboardSource).toContain('trpc.account.balance.useQuery(');
      expect(dashboardSource.match(/enabled: authReady && activeTab === "command" && tokenDisplayState === "valid"/g)?.length).toBe(2);
    });

    it("renders missing account fields as blank or unavailable rather than invented values", () => {
      expect(dashboardSource).toContain("accountProfileQuery.data.user_name &&");
      expect(dashboardSource).toContain("accountProfileQuery.data.email &&");
      expect(dashboardSource).toContain("Unavailable — Upstox returned no profile data.");
      expect(dashboardSource).toContain("Unavailable — Upstox returned no funds data.");
      expect(dashboardSource).not.toMatch(/accountProfileQuery\.data\.user_name\s*\|\|\s*["'][^"']+/);
    });
  });

  describe("fifth bot survives refresh and restart", () => {
    it("initializes and preserves configuration for every supported slot, not just four", () => {
      expect(dashboardSource).toContain("const MAX_CONFIGURABLE_BOT_SLOTS = 10;");
      expect(dashboardSource).toContain("Array.from({ length: MAX_CONFIGURABLE_BOT_SLOTS }");
      expect(dashboardSource).toContain("const slotsToPreserve = Math.max(MAX_CONFIGURABLE_BOT_SLOTS, highestPersistedSlot + 1);");
      expect(dashboardSource).not.toContain("for (let i = 0; i < 4; i++)");
      expect(dashboardSource).not.toContain("slot as 1 | 2 | 3");
      expect(dashboardSource).not.toContain("bot.slot as 1 | 2 | 3");
    });

    it("keeps authoritative server slots visible while entitlement data is loading", () => {
      expect(dashboardSource).toContain("const highestServerSlot = (allBots ?? []).reduce");
      expect(dashboardSource).toContain("const totalSlots = Math.max(entitledSlots, highestServerSlot);");
    });

    it("restores every durable running session row without a fixed slot limit", () => {
      expect(restartSource).toContain('.where(eq(botSessions.status, "running"))');
      expect(restartSource).toContain("for (const session of runningSessions)");
      expect(restartSource).toContain("await restartSingleSession(session);");
    });

    it("includes slot four in both daily summary data paths", () => {
      expect(coreIndexSource.match(/`\$\{token\}-slot4`/g)?.length).toBe(2);
    });
  });
});
