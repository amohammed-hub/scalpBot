import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const engineSource = readFileSync(join(here, "botEngine.ts"), "utf8");

function percentageFallbackValues(setting: "optionSlPct" | "optionTpPct"): number[] {
  return [...engineSource.matchAll(new RegExp(`\\b${setting}\\s*\\?\\?\\s*(\\d+(?:\\.\\d+)?)`, "g"))]
    .map((match) => Number(match[1]));
}

describe("Remediation Brief recovery contracts", () => {
  it("keeps the globally approved Upstox product D selection", () => {
    expect(engineSource).toContain(
      'const product = "D"; // NRML for both MCX and NSE F&O (full premium margin, no broker auto-exit)',
    );
    expect(engineSource).not.toContain('const product = isMcx ? "D" : "I"');
  });

  it("permits percentage fallbacks only at 5 percent SL and 8 percent target", () => {
    const slFallbacks = percentageFallbackValues("optionSlPct");
    const targetFallbacks = percentageFallbackValues("optionTpPct");

    expect(slFallbacks).not.toHaveLength(0);
    expect(targetFallbacks).not.toHaveLength(0);
    expect(slFallbacks.every((value) => value === 5)).toBe(true);
    expect(targetFallbacks.every((value) => value === 8)).toBe(true);
  });
});
