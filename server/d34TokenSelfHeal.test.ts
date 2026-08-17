// D34 regression tests: option-token resolution self-heals an expired (401) Upstox token.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fakes ─────────────────────────────────────────────────────────────────────
const upstoxAxiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./upstoxHttp", () => ({
  upstoxAxios: upstoxAxiosMock,
  upstoxFetch: vi.fn(),
  ensureUpstoxLiveOrderEgress: vi.fn(),
  fetchUpstoxAssetBuffer: vi.fn(),
}));

// Minimal DB + schema stubs so the engine module can be imported without a
// real database (refreshTokenFromDB is lazy-imported only on 401 paths).
vi.mock("../drizzle/schema", () => ({
  upstoxCredentials: { sessionToken: "x", accessToken: "x" },
  tradingCredentials: {},
  bots: {},
  botStatus: {},
  botSettings: {},
  trades: {},
  tradeLog: {},
  users: {},
  userSettings: {},
  signalJournal: {},
  notificationPreferences: {},
  sessions: {},
  layerPerformance: {},
  mutualFunds: {},
  auditLog: {},
}));

vi.mock("./db", () => ({
  getDb: async () => {
    const fakeRow = { sessionToken: "sess-1234", accessToken: "FRESH_TOKEN_123" };
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [fakeRow],
          }),
        }),
      }),
    };
  },
}));

vi.mock("./upstoxWebSocket.ts", () => ({ emitActivity: vi.fn() }));

import { resolveAtmOptionToken } from "./botEngine";

// ── Test data: a minimal option-chain response ────────────────────────────────
// Expiry far enough ahead to satisfy isOptionExpiryTradable (>= IST today) in tests.
const EXPIRY = "2099-06-15";

function chainResponse() {
  return {
    data: {
      data: [
        {
          expiry: EXPIRY,
          strike_price: 24350,
          underlying_spot_price: 24360,
          call_options: { instrument_key: "NSE_FO|12345", market_data: { ltp: 45 } },
          put_options: { instrument_key: "NSE_FO|12346", market_data: { ltp: 40 } },
        },
      ],
    },
  };
}

function contractsResponse() {
  return {
    data: {
      data: [
        { expiry: EXPIRY },
        { expiry: "2099-07-01" },
      ],
    },
  };
}

function underlyingQuoteResponse() {
  return {
    data: {
      data: {
        "NSE_INDEX|Nifty 50": { instrument_token: "NSE_INDEX|Nifty 50", last_price: 24360 },
      },
    },
  };
}

const axiosErr401 = Object.assign(new Error("Unauthorized"), {
  isAxiosError: true,
  response: { status: 401 },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("D34 — resolveAtmOptionToken 401 self-heal", () => {
  it("retries with a fresh DB token when the access token is rejected (401)", async () => {
    // First quote call → 401. After refresh → real quote.
    upstoxAxiosMock.get
      .mockRejectedValueOnce(axiosErr401) // market-quote quotes (step 1)
      .mockResolvedValueOnce(underlyingQuoteResponse()) // market-quote quotes (step 1 retry)
      .mockResolvedValueOnce(contractsResponse()) // option-contract
      .mockResolvedValueOnce(chainResponse()); // option-chain

    const resolved = await resolveAtmOptionToken(
      "NSE_INDEX|Nifty 50",
      "CE",
      "STALE_TOKEN",
      [],
      "sess-1234",
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.token).toBe("NSE_FO|12345");
    expect(resolved!.premium).toBe(45);

    // The failing call must have been retried with the fresh DB token.
    const retriedCall = upstoxAxiosMock.get.mock.calls[1];
    expect(retriedCall[1].headers.Authorization).toBe("Bearer FRESH_TOKEN_123");
  });

  it("self-heals on the option-chain call, not only the first quote call", async () => {
    upstoxAxiosMock.get
      .mockResolvedValueOnce(underlyingQuoteResponse()) // quotes OK
      .mockRejectedValueOnce(axiosErr401) // option-contract 401
      .mockResolvedValueOnce(contractsResponse()) // option-contract retry
      .mockResolvedValueOnce(chainResponse()); // option-chain

    const resolved = await resolveAtmOptionToken(
      "NSE_INDEX|Nifty 50",
      "PE",
      "STALE_TOKEN",
      [],
      "sess-1234",
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.token).toBe("NSE_FO|12346");
  });

  it("returns null when the DB also has no fresher token (no infinite loops)", async () => {
    // DB refresh returns the same stale token → no retry, propagate failure.
    upstoxAxiosMock.get.mockRejectedValue(axiosErr401);

    const resolved = await resolveAtmOptionToken(
      "NSE_INDEX|Nifty 50",
      "CE",
      "STALE_TOKEN",
      [],
      "sess-1234",
    );

    expect(resolved).toBeNull();
    // Only the initial quote call plus the contract call may run; no repeated retries.
    expect(upstoxAxiosMock.get.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("does not attempt a refresh when no sessionToken is supplied", async () => {
    upstoxAxiosMock.get.mockRejectedValueOnce(axiosErr401);

    const resolved = await resolveAtmOptionToken(
      "NSE_INDEX|Nifty 50",
      "CE",
      "STALE_TOKEN",
      [],
    );

    expect(resolved).toBeNull();
    // refreshTokenFromDB must NOT have been invoked — quotes call happens once only.
    expect(upstoxAxiosMock.get).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh for the demo placeholder token", async () => {
    upstoxAxiosMock.get.mockRejectedValueOnce(axiosErr401);

    const resolved = await resolveAtmOptionToken(
      "NSE_INDEX|Nifty 50",
      "CE",
      "DEMO_NO_TOKEN",
      [],
      "sess-1234",
    );

    expect(resolved).toBeNull();
    expect(upstoxAxiosMock.get).toHaveBeenCalledTimes(1);
  });
});
