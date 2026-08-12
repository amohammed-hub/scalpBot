import { beforeEach, describe, expect, it } from "vitest";
import {
  computeLayerStats,
  isLayerDisabled,
  resetAllLayerOverrides,
  setLayerOverride,
} from "./layerTracker";

const tenant = "tenant-d3";
const otherTenant = "other-tenant-d3";

function closed(layer: string, pnl: number, index: number) {
  return {
    layer,
    signalReason: `[${layer}] test signal`,
    pnl,
    exitedAt: new Date(1_700_000_000_000 + index * 60_000),
  };
}

describe("D3 layer scorecard enforcement", () => {
  beforeEach(() => {
    resetAllLayerOverrides(tenant);
    resetAllLayerOverrides(otherTenant);
  });

  it("disables a negative-expectancy layer despite a high win rate once the minimum sample exists", () => {
    computeLayerStats([
      closed("Trend", 10, 1),
      closed("Trend", 10, 2),
      closed("Trend", 10, 3),
      closed("Trend", 10, 4),
      closed("Trend", -100, 5),
    ], tenant);

    const gate = isLayerDisabled("Trend", tenant);
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toContain("expectancy");
  });

  it("does not disable a negative layer before the five-trade minimum", () => {
    computeLayerStats([
      closed("VWAPReversion", -10, 1),
      closed("VWAPReversion", -10, 2),
      closed("VWAPReversion", -10, 3),
      closed("VWAPReversion", -10, 4),
    ], tenant);

    expect(isLayerDisabled("VWAPReversion", tenant).disabled).toBe(false);
  });

  it("uses tenant-normalized bot slots without leaking disabled layers to another tenant", () => {
    computeLayerStats([
      closed("TrikalStrategy", -10, 1),
      closed("TrikalStrategy", -10, 2),
      closed("TrikalStrategy", -10, 3),
      closed("TrikalStrategy", -10, 4),
      closed("TrikalStrategy", -10, 5),
    ], `${tenant}-slot3`);

    expect(isLayerDisabled("TrikalStrategy", `${tenant}-slot5`).disabled).toBe(true);
    expect(isLayerDisabled("TrikalStrategy", `${otherTenant}-slot3`).disabled).toBe(false);
  });

  it("keeps manual disablement authoritative even when refreshed data is profitable", () => {
    setLayerOverride("Adeeb", true, tenant);
    computeLayerStats([
      closed("Adeeb", 10, 1),
      closed("Adeeb", 10, 2),
      closed("Adeeb", 10, 3),
      closed("Adeeb", 10, 4),
      closed("Adeeb", 10, 5),
    ], tenant);

    expect(isLayerDisabled("Adeeb", tenant)).toEqual({ disabled: true, reason: "Manually disabled" });
  });
});
