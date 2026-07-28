import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import {
  UPSTOX_EGRESS_ENV,
  ensureUpstoxLiveOrderEgress,
  getUpstoxEgressStatus,
  resetUpstoxHttpForTests,
  upstoxFetch,
  verifyUpstoxManagedEgress,
} from "./upstoxHttp";

const ENV_NAMES = Object.values(UPSTOX_EGRESS_ENV);
let sequence = 0;

function clearEgressEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

function configureManaged(overrides: Partial<Record<(typeof ENV_NAMES)[number], string>> = {}) {
  sequence += 1;
  process.env[UPSTOX_EGRESS_ENV.mode] = "managed-proxy";
  process.env[UPSTOX_EGRESS_ENV.proxyUrl] = "http://proxy-user:proxy-password@proxy.example.test:9293";
  process.env[UPSTOX_EGRESS_ENV.allowedIps] = "203.0.113.10,203.0.113.11";
  process.env[UPSTOX_EGRESS_ENV.checkUrl] = `https://api.ipify.org?format=json&test=${sequence}`;
  process.env[UPSTOX_EGRESS_ENV.verifyTtlMs] = "60000";
  process.env[UPSTOX_EGRESS_ENV.algoName] = "Manus-Testbot";
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

function mockAxiosRequest(observedIp: string) {
  const get = vi.fn().mockResolvedValue({ data: { ip: observedIp } });
  const request = vi.fn();
  const create = vi.spyOn(axios, "create").mockReturnValue({ get, request } as any);
  return { create, get, request };
}

beforeEach(() => {
  resetUpstoxHttpForTests();
  clearEgressEnv();
  sequence += 1;
  process.env[UPSTOX_EGRESS_ENV.checkUrl] = `https://api.ipify.org?format=json&reset=${sequence}`;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetUpstoxHttpForTests();
  clearEgressEnv();
});

describe("Upstox managed-egress configuration", () => {
  it("defaults to direct mode and exposes no proxy secret", () => {
    const status = getUpstoxEgressStatus();
    expect(status.mode).toBe("direct");
    expect(status.managedProxyConfigured).toBe(false);
    expect(status.proxyHost).toBeNull();
    expect(JSON.stringify(status)).not.toContain("proxy-password");
  });

  it("requires a proxy URL in managed mode", () => {
    process.env[UPSTOX_EGRESS_ENV.mode] = "managed-proxy";
    process.env[UPSTOX_EGRESS_ENV.allowedIps] = "203.0.113.10,203.0.113.11";
    expect(() => getUpstoxEgressStatus()).toThrow(UPSTOX_EGRESS_ENV.proxyUrl);
  });

  it("requires exactly two valid IPv4 addresses", () => {
    configureManaged({ [UPSTOX_EGRESS_ENV.allowedIps]: "203.0.113.10" });
    expect(() => getUpstoxEgressStatus()).toThrow("exactly two IPv4 addresses");

    configureManaged({ [UPSTOX_EGRESS_ENV.allowedIps]: "203.0.113.10,not-an-ip" });
    expect(() => getUpstoxEgressStatus()).toThrow("non-IPv4");
  });

  it("redacts proxy credentials from diagnostics", () => {
    configureManaged();
    const status = getUpstoxEgressStatus();
    expect(status.proxyHost).toBe("proxy.example.test:9293");
    expect(JSON.stringify(status)).not.toContain("proxy-user");
    expect(JSON.stringify(status)).not.toContain("proxy-password");
  });

  it("refuses to route non-Upstox hosts through the broker transport", async () => {
    await expect(upstoxFetch("https://api.telegram.org/bot-test/sendMessage")).rejects.toThrow(
      "refused non-Upstox host",
    );
  });
});

describe("Upstox live-order egress gate", () => {
  it("fails closed when managed proxy mode is not enabled", async () => {
    process.env[UPSTOX_EGRESS_ENV.mode] = "direct";
    await expect(ensureUpstoxLiveOrderEgress()).rejects.toThrow("Live Upstox orders are blocked");
  });

  it("fails closed when the configured Upstox Algo Name is missing", async () => {
    configureManaged({ [UPSTOX_EGRESS_ENV.algoName]: "" });
    await expect(ensureUpstoxLiveOrderEgress()).rejects.toThrow(UPSTOX_EGRESS_ENV.algoName);
  });

  it("returns the exact live-order header after successful egress verification", async () => {
    configureManaged({ [UPSTOX_EGRESS_ENV.algoName]: "  Manus-Testbot  " });
    mockAxiosRequest("203.0.113.10");

    await expect(ensureUpstoxLiveOrderEgress()).resolves.toEqual({
      "X-Algo-Name": "Manus-Testbot",
    });
  });

  it("verifies the proxy-observed IP and accepts an allowlisted address", async () => {
    configureManaged();
    const { create, get } = mockAxiosRequest("203.0.113.10");

    const result = await verifyUpstoxManagedEgress({ force: true });

    expect(result.observedIp).toBe("203.0.113.10");
    expect(result.allowedIps).toEqual(["203.0.113.10", "203.0.113.11"]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ proxy: false, httpsAgent: expect.anything() }));
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("api.ipify.org"),
      expect.objectContaining({ responseType: "text" }),
    );
  });

  it("blocks when the observed proxy IP is not registered in configuration", async () => {
    configureManaged();
    mockAxiosRequest("198.51.100.99");
    await expect(verifyUpstoxManagedEgress({ force: true })).rejects.toThrow("unapproved address");
  });

  it("caches successful verification within the configured TTL", async () => {
    configureManaged();
    const { get } = mockAxiosRequest("203.0.113.11");

    await ensureUpstoxLiveOrderEgress();
    await ensureUpstoxLiveOrderEgress();

    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("Managed-egress source contracts", () => {
  const serverDir = path.resolve(process.cwd(), "server");

  it("removes the ineffective non-whitelisted-IP retry loop and gates the live order first", () => {
    const source = fs.readFileSync(path.join(serverDir, "botEngine.ts"), "utf8");
    expect(source).not.toContain("MAX_STATIC_IP_RETRIES");
    expect(source).not.toContain("Order hit non-whitelisted IP");
    const gateIndex = source.indexOf("await ensureUpstoxLiveOrderEgress()");
    const orderIndex = source.indexOf("await upstoxAxios.post(", gateIndex);
    const headerIndex = source.indexOf("...liveOrderHeaders", orderIndex);
    expect(gateIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(gateIndex);
    expect(headerIndex).toBeGreaterThan(orderIndex);
  });

  it("has no direct fetch or axios call with a literal Upstox URL outside the transport", () => {
    const files = fs.readdirSync(serverDir).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "upstoxHttp.ts");
    const violations: string[] = [];
    const directCall = /(?:\bfetch|\baxios\.(?:get|post|put|delete|request))\s*\(\s*[`'"]https:\/\/[^`'"]*upstox\.com/gs;
    for (const file of files) {
      const source = fs.readFileSync(path.join(serverDir, file), "utf8");
      if (directCall.test(source)) violations.push(file);
      directCall.lastIndex = 0;
    }
    expect(violations).toEqual([]);
  });

  it("never routes a non-Upstox literal host through the broker-only transport", () => {
    const files = fs.readdirSync(serverDir).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "upstoxHttp.ts");
    const violations: string[] = [];
    const brokerCall = /\bupstoxFetch\s*\(\s*[`'"](https:\/\/[^`'"]+)/g;
    for (const file of files) {
      const source = fs.readFileSync(path.join(serverDir, file), "utf8");
      for (const match of source.matchAll(brokerCall)) {
        const host = new URL(match[1]).hostname.toLowerCase();
        if (host !== "upstox.com" && !host.endsWith(".upstox.com")) {
          violations.push(`${file}: ${host}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
