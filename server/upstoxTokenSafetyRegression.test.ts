import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getUpstoxTokenDisplayLabel,
  getUpstoxTokenDisplayState,
  selectMarketDataAccessToken,
  tokenHealthBlocksAuthenticatedMarketData,
} from "../shared/upstoxTokenState";

const here = dirname(fileURLToPath(import.meta.url));
const routerSource = readFileSync(join(here, "routers.ts"), "utf8");
const engineSource = readFileSync(join(here, "botEngine.ts"), "utf8");
const dashboardSource = readFileSync(join(here, "../client/src/pages/Dashboard.tsx"), "utf8");

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("30 July Upstox token and no-trade incident regressions", () => {
  describe("market-data credential selection", () => {
    it("uses only the regular OAuth access token even when a sandbox order token exists", () => {
      expect(selectMarketDataAccessToken({
        accessToken: " live-market-data-token ",
        sandboxToken: "sandbox-order-token",
      } as any)).toBe("live-market-data-token");
    });

    it("fails closed when the regular token is absent", () => {
      expect(selectMarketDataAccessToken({ accessToken: "   " })).toBeNull();
      expect(selectMarketDataAccessToken(null)).toBeNull();
    });

    it("applies the selector to primary starts, restarts, and secondary slots", () => {
      expect(routerSource.match(/selectMarketDataAccessToken\(creds\[0\]\)/g)?.length).toBe(3);
      expect(routerSource).not.toContain("sandboxToken ?? creds[0].accessToken");
    });

    it("never hot-reloads a sandbox token into running market-data bots", () => {
      const saveDemoToken = between(routerSource, "saveDemoToken: publicProcedure", "exchangeCode: publicProcedure");
      expect(saveDemoToken).not.toContain("hotReloadAccessToken(");

      const hotReload = between(engineSource, "export function hotReloadAccessToken", "/**\n * Get total running bots");
      expect(hotReload).toContain("if (isSandbox)");
      expect(hotReload).toContain("return 0");
    });
  });

  describe("dashboard token status", () => {
    it("shows green only after a successful Upstox health probe", () => {
      expect(getUpstoxTokenDisplayState(true, "valid")).toBe("valid");
      expect(getUpstoxTokenDisplayState(true)).toBe("checking");
      expect(getUpstoxTokenDisplayState(true, "expired")).toBe("expired");
      expect(getUpstoxTokenDisplayState(true, "error")).toBe("error");
      expect(getUpstoxTokenDisplayState(true, "no_db")).toBe("error");
      expect(getUpstoxTokenDisplayState(false)).toBe("missing");
      expect(getUpstoxTokenDisplayState(false, "no_token")).toBe("missing");
    });

    it("treats every non-valid or unknown health state as blocking authenticated market data", () => {
      expect(tokenHealthBlocksAuthenticatedMarketData("valid")).toBe(false);
      expect(tokenHealthBlocksAuthenticatedMarketData("expired")).toBe(true);
      expect(tokenHealthBlocksAuthenticatedMarketData("error")).toBe(true);
      expect(tokenHealthBlocksAuthenticatedMarketData(undefined)).toBe(true);
    });

    it("provides explicit labels and uses the fail-closed display state in the dashboard", () => {
      expect(getUpstoxTokenDisplayLabel("valid")).toBe("Token OK");
      expect(getUpstoxTokenDisplayLabel("checking")).toBe("Checking Token");
      expect(getUpstoxTokenDisplayLabel("expired")).toBe("Token Expired");
      expect(getUpstoxTokenDisplayLabel("error")).toBe("Token Error");
      expect(getUpstoxTokenDisplayLabel("missing")).toBe("No Token");
      expect(dashboardSource).toContain("const tokenDisplayState = getUpstoxTokenDisplayState(");
      expect(dashboardSource).toContain('tokenDisplayState === "valid" ? "bg-emerald-500/10');
      expect(dashboardSource).not.toContain('tokenStatus === "valid" && tokenHealthStatus !== "expired"');
    });
  });

  it("does not tell users a rejected option lookup proves the token is valid", () => {
    expect(engineSource).not.toContain("fetched OK (token valid)");
    expect(engineSource).toContain("The access token may be expired or unauthorized");
    expect(engineSource).toContain("no price or trade was fabricated");
  });
});
