import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");

describe("D4 regime manual-disable contract", () => {
  it("takes an immutable snapshot of manual disables and records skipped regime layers", () => {
    expect(source).toContain("const userBlocked = new Set(state.userDisabledLayers || [])");
    expect(source).toContain("const skippedUserLayers: string[] = []");
    expect(source).toContain("user-disabled skipped:");
    expect(source).toContain("preserved user-disabled=");
  });

  it("does not assign or mutate the userDisabledLayers setting inside the regime switcher", () => {
    const adaptiveSection = source.slice(source.indexOf("// ── Adaptive Regime Switching:"), source.indexOf("// ── Multi-Layer Strategy Cascade:"));
    expect(adaptiveSection).not.toMatch(/state\.userDisabledLayers\s*=/);
    expect(adaptiveSection).not.toMatch(/state\.userDisabledLayers\.(push|splice|pop|shift|unshift)/);
  });
});
