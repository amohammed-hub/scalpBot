import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const engineSource = readFileSync(join(here, "botEngine.ts"), "utf8");

describe("Remediation Brief recovery contracts", () => {
  it("keeps the globally approved Upstox product D selection", () => {
    expect(engineSource).toContain(
      'const product = "D"; // NRML for both MCX and NSE F&O (full premium margin, no broker auto-exit)',
    );
    expect(engineSource).not.toContain('const product = isMcx ? "D" : "I"');
  });

  it("keeps the vetoed premium fallback settings at 5 percent SL and 8 percent target", () => {
    expect(engineSource).toContain("const slDistPct = (state.optionSlPct ?? 5) / 100;");
    expect(engineSource).toContain("const optSlPct = (state.optionSlPct ?? 5) / 100;");
    expect(engineSource).toContain("const optTpPct = (state.optionTpPct ?? 8) / 100;");
    expect(engineSource).toContain("(state.optionSlPct ?? 5) / 100");
    expect(engineSource).toContain("(state.optionTpPct ?? 8) / 100");
    expect(engineSource).not.toContain("state.optionSlPct ?? 12");
    expect(engineSource).not.toContain("state.optionTpPct ?? 15");
  });
});
