import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("D10 export regression contract", () => {
  it("exports all five configured bot tokens, including Bots 4 and 5", () => {
    const routers = readProjectFile("server/routers.ts");
    const exportBlock = routers.slice(
      routers.indexOf("exportData: publicProcedure"),
      routers.indexOf("// Account — Upstox profile & funds"),
    );

    expect(exportBlock).toContain("`${input.sessionToken}-slot3`");
    expect(exportBlock).toContain("`${input.sessionToken}-slot4`");
  });

  it("persists per-tick MFE/MAE and joins the journal values into export rows", () => {
    const engine = readProjectFile("server/botEngine.ts");
    const routers = readProjectFile("server/routers.ts");

    expect(engine).toContain("updateTradeExcursions(state.openTrade, effectivePrice)");
    expect(engine).toContain("persistTradeClose(onTradeClose, trade");
    expect(routers).toContain("signalJournal.maxFavorableExcursion");
    expect(routers).toContain("signalJournal.maxAdverseExcursion");
    expect(routers).toContain("mfe: excursions?.mfe ?? null");
    expect(routers).toContain("mae: excursions?.mae ?? null");
    expect(routers).toContain("excursions?.maxFavorablePnl");
    expect(routers).toContain("excursions?.maxAdversePnl");
  });

  it("writes MFE/MAE and Bot 4–5 labels in both CSV and XLSX exports", () => {
    const analytics = readProjectFile("client/src/pages/PnLAnalytics.tsx");

    expect(analytics).toContain("const botLabelForSlot = (slot: number)");
    expect(analytics).toContain('"MFE (₹)", "MAE (₹)"');
    expect(analytics).toContain('"MFE", "MAE"');
    expect(analytics).toContain("r.mfe ??");
    expect(analytics).toContain("r.mae ??");
  });
});
