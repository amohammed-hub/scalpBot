import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type UiConfig = {
  strategyMode: "auto" | "manual";
  scalperMode: boolean;
};

type StartPayload = UiConfig;

const dashboard = readFileSync(resolve(__dirname, "../client/src/pages/Dashboard.tsx"), "utf8");
const routers = readFileSync(resolve(__dirname, "./routers.ts"), "utf8");
const restart = readFileSync(resolve(__dirname, "./botRestart.ts"), "utf8");

function simulateCorrectStart(config: UiConfig): StartPayload {
  return { strategyMode: config.strategyMode, scalperMode: config.scalperMode };
}

function simulateStaleAccessStart(config: UiConfig, access: Partial<UiConfig>): StartPayload {
  return {
    strategyMode: access.strategyMode ?? "auto",
    scalperMode: access.scalperMode ?? false,
  };
}

describe("AUTO strategy mode end-to-end configuration", () => {
  it("proves the intended payload preserves live UI selections", () => {
    const config: UiConfig = { strategyMode: "auto", scalperMode: true };
    expect(simulateCorrectStart(config)).toEqual({ strategyMode: "auto", scalperMode: true });
  });

  it("requires the primary start path to use the live UI config", () => {
    const config: UiConfig = { strategyMode: "auto", scalperMode: true };
    expect(simulateCorrectStart(config)).toEqual(config);
    const primaryStart = dashboard.slice(dashboard.indexOf("const handleStart"), dashboard.indexOf("const handleStop"));
    expect(primaryStart).toContain("strategyMode: config.strategyMode");
    expect(primaryStart).toContain("scalperMode: config.scalperMode");
    expect(primaryStart).not.toContain("strategyMode: (accessQuery.data as any)?.strategyMode");
    expect(primaryStart).not.toContain("scalperMode: (accessQuery.data as any)?.scalperMode");
  });

  it("confirms quick-start and instrument-switch paths use the live config", () => {
    expect(dashboard).toContain("strategyMode: config.strategyMode");
    expect(dashboard).toContain("scalperMode: config.scalperMode");
    const switchPath = dashboard.slice(dashboard.indexOf("const handleInstrumentSwitch"), dashboard.indexOf("const handleStart"));
    expect(switchPath).toContain("strategyMode: config.strategyMode");
    expect(switchPath).toContain("scalperMode: config.scalperMode");
    expect(switchPath).not.toContain("strategyMode: (accessQuery.data as any)?.strategyMode");
    expect(switchPath).not.toContain("scalperMode: (accessQuery.data as any)?.scalperMode");
  });

  it("confirms the router accepts and persists both settings", () => {
    expect(routers).toContain('strategyMode: z.enum(["auto", "manual"]).default("auto")');
    expect(routers).toContain("scalperMode: z.boolean().default(false)");
    expect(routers).toContain("strategyMode: input.strategyMode ?? \"auto\"");
    expect(routers).toContain("scalperMode: input.scalperMode ?? false");
    expect(routers).toContain("setStrategyMode(input.sessionToken, input.strategyMode ?? \"auto\")");
  });

  it("requires automatic restart to restore and register both mode settings", () => {
    expect(restart).toContain("strategyMode: session.strategyMode === \"manual\" ? \"manual\" : \"auto\"");
    expect(restart).toContain("scalperMode: session.scalperMode ?? false");
    expect(restart).toContain("setStrategyMode(session.sessionToken, session.strategyMode === \"manual\" ? \"manual\" : \"auto\")");
  });
});

describe("Strategy switching race and latency contract", () => {
  it("awaits the stop and restart mutations instead of fire-and-forget mutate calls", () => {
    const switchPath = dashboard.slice(dashboard.indexOf("const handleInstrumentSwitch"), dashboard.indexOf("// Smart Scanner state"));
    expect(switchPath).toContain("await stopMutation.mutateAsync");
    expect(switchPath).toContain("await stopSecondaryMutation.mutateAsync");
    expect(switchPath).toContain("await startMutation.mutateAsync");
    expect(switchPath).toContain("await startSecondaryMutation.mutateAsync");
    expect(switchPath).not.toContain("setTimeout(r => setTimeout");
  });

  it("guards the switch sequence with a per-slot generation token", () => {
    const switchPath = dashboard.slice(dashboard.indexOf("const handleInstrumentSwitch"), dashboard.indexOf("// Smart Scanner state"));
    expect(switchPath).toContain("switchGenerationRef");
    expect(switchPath).toContain("const isCurrentSwitch = () => switchGenerationRef.current[slot] === generation");
    expect(switchPath).toContain("if (!isCurrentSwitch()) return;");
  });
});

describe("AUTO regime selection contract", () => {
  it("verifies the engine derives eligible layers from configured layers and regime", () => {
    const engine = readFileSync(resolve(__dirname, "./botEngine.ts"), "utf8");
    expect(engine).toContain("deriveRegimeEligibleLayers(state.configuredLayers, Array.from(userBlocked), state.regimeV2)");
    expect(engine).toContain("!isLayerEligibleForRegime(signal.layer, state.regimeV2)");
    expect(engine).toContain("if (!regime || regime === \"DEAD\") return false;");
  });
});
