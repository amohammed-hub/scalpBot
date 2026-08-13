/**
 * D26 regression — Auto/Manual strategy mode switch.
 *
 * Invariants under test:
 *  - "auto" mode: behavior is identical to before D26 (D25 deadlock protection
 *    applies; auto-disabled layers remain gated until bypassed).
 *  - "manual" mode: every USER-SELECTED layer trades regardless of auto-disable
 *    statistics. Auto-disable can never silence a manually-selected layer.
 *  - A layer the USER explicitly disabled (manual disable) still blocks even
 *    in manual mode.
 *  - Mode persists per session (tenant) and survives stat recomputation.
 *  - Default mode is "auto" (fail-safe: new/legacy bots behave as before).
 */
import { describe, expect, it } from "vitest";
import {
  canonicalLayerKey,
  computeLayerStats,
  computeViableCandidates,
  getAutoDisabledLayers,
  resetAllLayerOverrides,
  setLayerOverride,
  setStrategyMode,
  clearStrategyModes,
  type LayerPerformanceTrade,
} from "./layerTracker";

const mkTrades = (layer: string, pnl: number[]): LayerPerformanceTrade[] =>
  pnl.map(p => ({ layer, signalReason: null, pnl: p, exitedAt: new Date() }));


function cleanup(token: string) {
  resetAllLayerOverrides(token);
  clearStrategyModes();
}

describe("D26 auto mode (default behavior)", () => {
  const token = "d26-auto-default-tenant";

  it("auto mode applies D25 deadlock protection unchanged", () => {
    cleanup(token);
    setStrategyMode(token, "auto");
    computeLayerStats(
      [
        ...mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]),
        ...mkTrades("TrikalStrategy", [-1000, -1200, -900, -1100, -1300]),
      ],
      token,
    );
    const viable = computeViableCandidates(
      ["RedBarTheory", "TrikalStrategy"],
      token,
      "demo",
    );
    expect(viable.eligible).toEqual(["RedBarTheory"]);
    expect(viable.deadlocked?.layer).toBe("RedBarTheory");
    expect(getAutoDisabledLayers(token).length).toBeGreaterThan(0);
    cleanup(token);
  });

  it("behaves as auto mode when no mode is registered (D25 bypass applies)", () => {
    cleanup(token);
    computeLayerStats(mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]), token);
    const viable = computeViableCandidates(["RedBarTheory"], token, "demo");
    // Unregistered mode behaves as auto: every candidate is gated, then the
    // D25 deadlock bypass releases the least-negative one.
    expect(viable.eligible).toEqual(["RedBarTheory"]);
    expect(viable.deadlocked?.layer).toBe("RedBarTheory");
    cleanup(token);
  });
});

describe("D26 manual mode", () => {
  const token = "d26-manual-tenant";

  it("user-selected layers bypass auto-disable statistics entirely", () => {
    cleanup(token);
    setStrategyMode(token, "manual");
    // Simulate horrible historical performance for both layers — the state the
    // user saw when everything was auto-disabled ("expectancy < 0").
    computeLayerStats(
      [
        ...mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]),
        ...mkTrades("TrikalStrategy", [-1000, -1200, -900, -1100, -1300]),
      ],
      token,
    );
    // Same stats would gate both layers in auto mode.
    const autoViable = computeViableCandidates(
      ["RedBarTheory", "TrikalStrategy"],
      token,
      "demo",
    );
    expect(autoViable.deadlocked?.layer).toBe("RedBarTheory");
    cleanup(token);
    // Now under manual mode: auto-disable stats exist but USER-SELECTED layers
    // remain eligible — manual mode is a true bypass, not a D25 fallback.
    setStrategyMode(token, "manual");
    const viable = computeViableCandidates(
      ["RedBarTheory", "TrikalStrategy"],
      token,
      "demo",
      { selectedLayers: ["RedBarTheory", "TrikalStrategy"] },
    );
    expect(viable.eligible.sort()).toEqual(["RedBarTheory", "TrikalStrategy"]);
    expect(viable.deadlocked).toBeNull();
    expect(viable.manuallyDisabled).toEqual([]);
    // No new auto-disable entries were created by the manual-mode scan.
    expect(getAutoDisabledLayers(token)).toEqual([]);
    cleanup(token);
  });

  it("explicit manual disables still block in manual mode", () => {
    cleanup(token);
    setStrategyMode(token, "manual");
    setLayerOverride("TrikalStrategy", true, token);
    const viable = computeViableCandidates(
      ["RedBarTheory", "TrikalStrategy"],
      token,
      "demo",
      { selectedLayers: ["RedBarTheory", "TrikalStrategy"] },
    );
    expect(viable.eligible).toEqual(["RedBarTheory"]);
    expect(viable.manuallyDisabled).toEqual(["TrikalStrategy"]);
    cleanup(token);
  });

  it("unselected layers stay governed by normal gates in manual mode", () => {
    cleanup(token);
    setStrategyMode(token, "manual");
    computeLayerStats(
      [
        ...mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]),
        ...mkTrades("HourlyClose", [120, 150, 110, 160, 140]),
      ],
      token,
    );
    const viable = computeViableCandidates(
      ["RedBarTheory", "HourlyClose"],
      token,
      "demo",
      { selectedLayers: ["RedBarTheory"] },
    );
    // Selected (poor-performing) layer trades anyway; healthy unselected layer
    // passes normally.
    expect(viable.eligible.sort()).toEqual(["HourlyClose", "RedBarTheory"]);
    expect(viable.deadlocked).toBeNull();
    cleanup(token);
  });

  it("canonical keys apply in manual mode too", () => {
    cleanup(token);
    // Simulate the real sequence: stats accumulate over days (registering
    // auto-disable entries), THEN the user switches to manual mode with the
    // layer still selected.
    computeLayerStats(
      [
        ...mkTrades("RedBarTheory", [-200, -300, -250, -400, -500]),
        ...mkTrades("Red Bar Theory", [-200, -300, -250, -400, -500]),
      ],
      token,
    );
    expect(getAutoDisabledLayers(token).length).toBeGreaterThan(0);
    setStrategyMode(token, "manual");
    const viable = computeViableCandidates(
      ["Red Bar Theory"],
      token,
      "demo",
      { selectedLayers: ["Red Bar Theory"] },
    );
    // Despite the auto-disable registry holding the layer (under any display
    // casing), the user's manual selection trades anyway.
    expect(viable.eligible.map(l => canonicalLayerKey(l))).toEqual(["RedBarTheory"]);
    expect(viable.deadlocked).toBeNull();
    expect(viable.manuallyDisabled).toEqual([]);
    cleanup(token);
  });
});
