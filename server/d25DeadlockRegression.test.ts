/**
 * D25 regression — layer auto-disable deadlock protection.
 *
 * Scenario under test: D3 auto-disable must never silence every strategy
 * layer at once. When every non-manually-disabled candidate layer is
 * auto-gated, computeViableCandidates releases the least-negative one
 * exactly once (deleting its auto-disable entry). Manual disables remain
 * authoritative and canonical keying merges display-name/camelCase keys.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalLayerKey,
  computeLayerStats,
  computeViableCandidates,
  getAutoDisabledLayers,
  getLayerTrackerTenantKey,
  resetAllLayerOverrides,
  setLayerOverride,
  type LayerPerformanceTrade,
} from "./layerTracker";

// Module-level state lives per tenant; isolate each scenario on its own key.
function tenantOf(token: string): string {
  return getLayerTrackerTenantKey(token);
}

const mkTrades = (layer: string, pnl: number[], label = "layer"): LayerPerformanceTrade[] =>
  pnl.map(p => ({ layer, signalReason: null, pnl: p, exitedAt: new Date() }));

describe("D25 canonical layer key", () => {
  it("merges display names and camelCase IDs", () => {
    expect(canonicalLayerKey("Red Bar Theory")).toBe("RedBarTheory");
    expect(canonicalLayerKey("Trikal Strategy")).toBe("TrikalStrategy");
    expect(canonicalLayerKey("MCX Evening")).toBe("McxEvening");
    expect(canonicalLayerKey("RedBarTheory")).toBe("RedBarTheory");
    expect(canonicalLayerKey("Mean Reversion V13")).toBe("MeanReversionV13");
  });

  it("keeps underscored IDs intact and falls back to Other for empties", () => {
    expect(canonicalLayerKey("MACD_BB")).toBe("MACD_BB");
    expect(canonicalLayerKey("")).toBe("Other");
  });
});

describe("D25 deadlock protection", () => {
  it("releases the least-negative auto-gated layer when all candidates are gated", () => {
    const token = "d25-scenario-all-gated-tenant";
    resetAllLayerOverrides(token);
    computeLayerStats(
      [
        ...mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]),
        ...mkTrades("TrikalStrategy", [-1000, -1200, -900, -1100, -1300]),
        ...mkTrades("CPR", [-600, -700, -500, -800, -650]),
      ],
      token,
    );
    const viable = computeViableCandidates(
      ["RedBarTheory", "TrikalStrategy", "CPR"],
      token,
      "demo",
    );
    // RedBarTheory has the least-negative expectancy (₹-330) — it is released.
    expect(viable.eligible).toEqual(["RedBarTheory"]);
    expect(viable.deadlocked?.layer).toBe("RedBarTheory");
    expect(viable.deadlocked?.reason).toMatch(/expectancy/);
    // Manual disables are never bypassed.
    expect(viable.manuallyDisabled.sort()).toEqual(["CPR", "TrikalStrategy"]);
    resetAllLayerOverrides(token);
  });

  it("never releases a manually disabled layer", () => {
    const token = "d25-scenario-manual-authoritative-tenant";
    resetAllLayerOverrides(token);
    setLayerOverride("RedBarTheory", true, token);
    computeLayerStats(mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]), token);
    const viable = computeViableCandidates(["RedBarTheory"], token, "demo");
    expect(viable.eligible).toEqual([]);
    expect(viable.deadlocked).toBeNull();
    expect(viable.manuallyDisabled).toEqual(["RedBarTheory"]);
    resetAllLayerOverrides(token);
  });

  it("passes candidates through when at least one layer is healthy", () => {
    const token = "d25-scenario-healthy-tenant";
    resetAllLayerOverrides(token);
    computeLayerStats(
      [
        ...mkTrades("TrikalStrategy", [-800, -900, -700, -850, -750]),
        ...mkTrades("CPR", [120, 150, 110, 160, 140]),
      ],
      token,
    );
    const viable = computeViableCandidates(["TrikalStrategy", "CPR"], token, "demo");
    expect(viable.eligible).toEqual(["CPR"]);
    expect(viable.deadlocked).toBeNull();
    resetAllLayerOverrides(token);
  });

  it("handles empty candidate sets without throwing", () => {
    const token = "d25-scenario-empty-tenant";
    const viable = computeViableCandidates([], token, "demo");
    expect(viable.eligible).toEqual([]);
    expect(viable.deadlocked).toBeNull();
  });
});
