import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");

describe("D7 one-lot risk budget contract", () => {
  it("computes one-lot loss from the configured stop distance and refuses an over-budget entry", () => {
    expect(source).toContain("const oneLotRisk = slDist * lotSize;");
    expect(source).toContain("if (oneLotRisk > riskAmount)");
    expect(source).toContain("one lot risk ₹${oneLotRisk.toFixed(2)} exceeds risk budget");
    expect(source).toContain("state.isOpeningTrade = false;");
  });

  it("places the refusal before manual quantity can override automatic sizing", () => {
    const guardIndex = source.indexOf("if (oneLotRisk > riskAmount)");
    const manualIndex = source.indexOf("state.quantityMode === \"manual\"");
    const guardBody = source.slice(guardIndex, manualIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(manualIndex);
    expect(guardBody).toContain("state.isOpeningTrade = false;");
    expect(guardBody).toContain("return;");
  });

  it("does not retain the former minimum-lot risk override", () => {
    expect(source).not.toContain("Even 1 lot exceeds risk budget — still allow 1 lot");
  });
});
