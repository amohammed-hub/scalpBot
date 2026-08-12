import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDemoLayerOverrides,
  computeLayerStats,
  getDemoLayerOverrides,
  getLayerGateForMode,
  resetAllLayerOverrides,
  setDemoLayerOverride,
  setLayerOverride,
} from "./layerTracker";

const tenant = "tenant-demo-override";
const otherTenant = "other-tenant-demo-override";

function closed(layer: string, pnl: number, index: number) {
  return {
    layer,
    signalReason: `[${layer}] demo regression`,
    pnl,
    exitedAt: new Date(1_700_100_000_000 + index * 60_000),
  };
}

function makeAutoDisabled(layer: string, sessionToken: string) {
  computeLayerStats([
    closed(layer, -10, 1),
    closed(layer, -10, 2),
    closed(layer, -10, 3),
    closed(layer, -10, 4),
    closed(layer, -10, 5),
  ], sessionToken);
}

describe("Demo-only D3 layer override", () => {
  beforeEach(() => {
    resetAllLayerOverrides(tenant);
    resetAllLayerOverrides(otherTenant);
  });

  it("permits only an automatically disabled layer in Demo while preserving the D3 reason", () => {
    makeAutoDisabled("TrikalStrategy", tenant);
    setDemoLayerOverride("TrikalStrategy", true, tenant);

    const gate = getLayerGateForMode("TrikalStrategy", tenant, "demo");
    expect(gate.disabled).toBe(false);
    expect(gate.demoOverrideActive).toBe(true);
    expect(gate.source).toBe("auto");
    expect(gate.overriddenReason).toContain("Auto-disabled: expectancy");
  });

  it("cannot enable the same stored override in Live mode", () => {
    makeAutoDisabled("RedBarTheory", tenant);
    setDemoLayerOverride("RedBarTheory", true, tenant);

    const gate = getLayerGateForMode("RedBarTheory", tenant, "live");
    expect(gate.disabled).toBe(true);
    expect(gate.demoOverrideActive).toBe(false);
    expect(gate.source).toBe("auto");
  });

  it("never overrides an explicit user disable", () => {
    makeAutoDisabled("Adeeb", tenant);
    setLayerOverride("Adeeb", true, tenant);
    setDemoLayerOverride("Adeeb", true, tenant);

    const gate = getLayerGateForMode("Adeeb", tenant, "demo");
    expect(gate.disabled).toBe(true);
    expect(gate.source).toBe("manual");
    expect(gate.demoOverrideActive).toBe(false);
  });

  it("is tenant-scoped and clears without clearing the D3 automatic disable", () => {
    makeAutoDisabled("MeanReversionV13", tenant);
    setDemoLayerOverride("MeanReversionV13", true, tenant);

    expect(getDemoLayerOverrides(tenant)).toEqual(["MeanReversionV13"]);
    expect(getDemoLayerOverrides(otherTenant)).toEqual([]);
    expect(getLayerGateForMode("MeanReversionV13", otherTenant, "demo").disabled).toBe(false);

    clearDemoLayerOverrides(tenant);
    expect(getDemoLayerOverrides(tenant)).toEqual([]);
    expect(getLayerGateForMode("MeanReversionV13", tenant, "demo").disabled).toBe(true);
  });
});
