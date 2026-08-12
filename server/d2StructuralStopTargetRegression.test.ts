import { readFileSync } from "node:fs";
import {
  getPremiumSafetyExitDecision,
  getStructuralOptionExitDecision,
} from "./botEngine";

const botEngineSource = readFileSync(new URL("./botEngine.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const routersSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const analyticsSource = readFileSync(new URL("../client/src/pages/PnLAnalytics.tsx", import.meta.url), "utf8");

const ceTrade = {
  direction: "BUY" as const,
  isIndexOptions: true,
  optionMockKey: "NIFTY_CE",
  symbol: "NIFTY 25000 CE",
  symbolLabel: "NIFTY 25000 CE",
  signalReason: "D2 regression",
  structuralSlPrice: 24900,
  structuralTargetPrice: 25100,
  currentSl: 95,
  targetPrice: 108,
  premiumSafetySlPrice: 95,
  premiumSafetyTargetPrice: 108,
};

const peTrade = {
  ...ceTrade,
  optionMockKey: "NIFTY_PE",
  symbol: "NIFTY 25000 PE",
  symbolLabel: "NIFTY 25000 PE",
  structuralSlPrice: 25100,
  structuralTargetPrice: 24900,
};

describe("D2 — structural option stops and targets", () => {
  it("uses stored underlying levels with CE direction, not the broker BUY order direction", () => {
    expect(getStructuralOptionExitDecision(ceTrade, 24899)).toEqual({
      reason: "Structural Stop Loss",
      trigger: "STRUCTURAL_STOP",
    });
    expect(getStructuralOptionExitDecision(ceTrade, 25101)).toEqual({
      reason: "Structural Target Hit",
      trigger: "STRUCTURAL_TARGET",
    });
    expect(getStructuralOptionExitDecision(ceTrade, 25000)).toBeNull();
  });

  it("inverts structural comparisons correctly for PE while retaining a BUY option order", () => {
    expect(getStructuralOptionExitDecision(peTrade, 25101)).toEqual({
      reason: "Structural Stop Loss",
      trigger: "STRUCTURAL_STOP",
    });
    expect(getStructuralOptionExitDecision(peTrade, 24899)).toEqual({
      reason: "Structural Target Hit",
      trigger: "STRUCTURAL_TARGET",
    });
  });

  it("preserves the premium 5%/8% safety net as a separately attributed fallback", () => {
    expect(getPremiumSafetyExitDecision(ceTrade, 94.99)).toEqual({
      reason: "Premium Safety Stop Loss",
      trigger: "PREMIUM_SAFETY_STOP",
    });
    expect(getPremiumSafetyExitDecision(ceTrade, 108.01)).toEqual({
      reason: "Premium Safety Target Hit",
      trigger: "PREMIUM_SAFETY_TARGET",
    });

    const legacyOption = { ...ceTrade, premiumSafetySlPrice: undefined, premiumSafetyTargetPrice: undefined };
    expect(getPremiumSafetyExitDecision(legacyOption, 94.99)?.trigger).toBe("PREMIUM_SAFETY_STOP");
  });

  it("evaluates structural exits before premium safety and keeps the broken-premium grace limited to premium checks", () => {
    const structuralIndex = botEngineSource.indexOf("const structuralDecision = getStructuralOptionExitDecision(trade, price);");
    const premiumIndex = botEngineSource.indexOf("const premiumDecision = getPremiumSafetyExitDecision(trade, effectivePrice);");
    expect(structuralIndex).toBeGreaterThan(-1);
    expect(premiumIndex).toBeGreaterThan(structuralIndex);
    expect(botEngineSource).toContain("Structural exits remain active.");
  });

  it("durably records both level sets and exit attribution while exporting all five D2 audit fields", () => {
    for (const column of [
      "structuralSlPrice: float(\"structuralSlPrice\")",
      "structuralTargetPrice: float(\"structuralTargetPrice\")",
      "premiumSafetySlPrice: float(\"premiumSafetySlPrice\")",
      "premiumSafetyTargetPrice: float(\"premiumSafetyTargetPrice\")",
      "exitTrigger: varchar(\"exitTrigger\"",
    ]) expect(schemaSource).toContain(column);

    expect(routersSource).toContain("structuralStopLoss: t.structuralSlPrice ?? null");
    expect(routersSource).toContain("premiumSafetyTarget: t.premiumSafetyTargetPrice ?? null");
    expect(routersSource).toContain("exitTrigger: t.exitTrigger ?? \"\"");
    expect(analyticsSource).toContain("Structural SL (Underlying)");
    expect(analyticsSource).toContain("Premium Safety Target");
    expect(analyticsSource).toContain("Exit Trigger");
  });
});
