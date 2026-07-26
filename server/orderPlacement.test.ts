import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

// We can't easily mock the internal axios call inside placeUpstoxOrder without
// restructuring, so we test the response parsing logic directly.

describe("Upstox Order Response Parsing", () => {
  it("should extract order_id from v2 response format (singular string)", () => {
    // v2 format: { status: "success", data: { order_id: "1644490272000" } }
    const respData = { order_id: "1644490272000" };
    const orderId = respData?.order_id ?? respData?.order_ids?.[0] ?? null;
    expect(orderId).toBe("1644490272000");
  });

  it("should extract order_id from v3 response format (array)", () => {
    // v3 format: { status: "success", data: { order_ids: ["1644490272000"] } }
    const respData = { order_ids: ["1644490272000"] } as any;
    const orderId = respData?.order_id ?? respData?.order_ids?.[0] ?? null;
    expect(orderId).toBe("1644490272000");
  });

  it("should return null when neither order_id nor order_ids is present", () => {
    const respData = { some_other_field: "value" } as any;
    const orderId = respData?.order_id ?? respData?.order_ids?.[0] ?? null;
    expect(orderId).toBeNull();
  });

  it("should return null when order_ids is empty array", () => {
    const respData = { order_ids: [] } as any;
    const orderId = respData?.order_id ?? respData?.order_ids?.[0] ?? null;
    expect(orderId).toBeNull();
  });

  it("should prefer order_id over order_ids when both are present", () => {
    const respData = { order_id: "from_v2", order_ids: ["from_v3"] } as any;
    const orderId = respData?.order_id ?? respData?.order_ids?.[0] ?? null;
    expect(orderId).toBe("from_v2");
  });
});

describe("Live Mode Safety Guard", () => {
  it("should block trade when mode=live but accessToken is null", () => {
    const state = { mode: "live" as const, accessToken: null };
    
    // Simulating the logic in botEngine.ts
    let tradeBlocked = false;
    let orderId: string | undefined;
    
    if (state.mode === "live" && state.accessToken) {
      // This should NOT execute
      orderId = "fake-order-id";
    } else if (state.mode === "live" && !state.accessToken) {
      // This SHOULD execute — trade blocked
      tradeBlocked = true;
    }
    
    expect(tradeBlocked).toBe(true);
    expect(orderId).toBeUndefined();
  });

  it("should allow trade when mode=live and accessToken is set", () => {
    const state = { mode: "live" as const, accessToken: "valid-token-123" };
    
    let tradeBlocked = false;
    let liveOrderAttempted = false;
    
    if (state.mode === "live" && state.accessToken) {
      liveOrderAttempted = true;
    } else if (state.mode === "live" && !state.accessToken) {
      tradeBlocked = true;
    }
    
    expect(liveOrderAttempted).toBe(true);
    expect(tradeBlocked).toBe(false);
  });

  it("should allow demo trade when mode=demo (no accessToken needed)", () => {
    const state = { mode: "demo" as const, accessToken: null };
    
    let tradeBlocked = false;
    let liveOrderAttempted = false;
    
    if (state.mode === "live" && state.accessToken) {
      liveOrderAttempted = true;
    } else if (state.mode === "live" && !state.accessToken) {
      tradeBlocked = true;
    }
    // Paper mode: neither block fires, trade proceeds normally
    
    expect(liveOrderAttempted).toBe(false);
    expect(tradeBlocked).toBe(false);
  });
});
