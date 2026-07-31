import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const serverDir = path.join(projectRoot, "server");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("Upstox fixed-IP proxy acceptance contracts", () => {
  it("constructs the shared Axios client with an HTTPS CONNECT proxy agent", () => {
    const source = read("server/upstoxHttp.ts");

    expect(source).toContain('import { HttpsProxyAgent } from "https-proxy-agent"');
    expect(source).toContain("httpsAgent: new HttpsProxyAgent(config.proxyUrl!)");
    expect(source).toContain("proxy: false");
  });

  it("does not call literal Upstox URLs through direct fetch or Axios outside the shared transport", () => {
    const violations: string[] = [];
    const directCall = /(?:\bfetch|\baxios\.(?:get|post|put|delete|request))\s*\(\s*[`'"]https:\/\/[^`'"]*upstox\.com/gs;

    for (const name of fs.readdirSync(serverDir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "upstoxHttp.ts") continue;
      const source = fs.readFileSync(path.join(serverDir, name), "utf8");
      if (directCall.test(source)) violations.push(name);
      directCall.lastIndex = 0;
    }

    expect(violations).toEqual([]);
  });

  it("forces the allowlisted-IP probe before the authenticated read-only profile GET", () => {
    const source = read("server/routers.ts");
    const start = source.indexOf("verifyUpstoxProfileEgress: publicProcedure");
    const end = source.indexOf("// ── System Health", start);
    const route = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(route).toContain("verifyAdminAccess(ctx)");
    expect(route).toContain("verifyUpstoxManagedEgress({ force: true })");
    expect(route).toContain('const upstreamUrl = "https://api.upstox.com/v2/user/profile"');
    expect(route).toContain('method: "GET"');
    expect(route).toContain("const profileResponse = await upstoxFetch(upstreamUrl");
    expect(route.indexOf("verifyUpstoxManagedEgress({ force: true })"))
      .toBeLessThan(route.indexOf("const profileResponse = await upstoxFetch(upstreamUrl"));
    expect(route).toContain("orderEndpointCalled: false as const");
    expect(route).not.toMatch(/\/v2\/order|placeUpstoxOrder|upstoxAxios\.post/);
  });

  it("exposes the proof only in the admin System Health UI and labels it no-order", () => {
    const source = read("client/src/components/AdminPanel.tsx");

    expect(source).toContain("trpc.admin.verifyUpstoxProfileEgress.useMutation");
    expect(source).toContain("Verify Proxy + Profile GET");
    expect(source).toContain("GET /v2/user/profile");
    expect(source).toContain("Order Endpoint Called");
    expect(source).toContain("No</span>");
  });
});
