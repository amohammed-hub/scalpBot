import fs from "node:fs";
import path from "node:path";

const engineSource = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server", "routers.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(process.cwd(), "client", "src", "pages", "Dashboard.tsx"), "utf8");

describe("Multi-slot loss-cap-only controls", () => {
  it("does not enforce a fixed global open-position ceiling", () => {
    expect(engineSource).not.toContain("const MAX_OPEN_POSITIONS = 4;");
    expect(engineSource).not.toContain("Max ${MAX_OPEN_POSITIONS} open positions reached");
    expect(engineSource).toContain("no fixed global open-position ceiling");
  });

  it("does not enforce the fixed 80 percent portfolio exposure ceiling in the entry path", () => {
    expect(engineSource).not.toContain("Portfolio exposure cap (80% of combined capital)");
    expect(engineSource).not.toContain("const exposureCheck = canOpenNewTrade(");
    expect(engineSource).toContain("no fixed global portfolio exposure ceiling");
  });

  it("defaults primary and secondary starts to unlimited trades with daily loss as the stop", () => {
    expect(routerSource).toContain("maxTradesPerDay: z.number().default(0)");
    expect((routerSource.match(/maxTradesPerDay: z\.number\(\)\.default\(0\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((dashboardSource.match(/maxTradesPerDay: 0/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(dashboardSource).toContain("dailyLossLimitPct: 3");
  });

  it("retains per-slot affordability, D39, broker margin, and daily-loss guards", () => {
    expect(engineSource).toContain("const riskAmount = (state.capital * state.riskPerTradePct) / 100;");
    expect(engineSource).toContain("effectiveRiskBudget");
    expect(engineSource).toContain("Insufficient capital for 1 lot");
    expect(engineSource).toContain("dailyLossLimitPct");
    expect(engineSource).toContain("broker");
  });
});
