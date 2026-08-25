import { describe, expect, it } from "vitest";
import { scanPremiumFirstCandidates, selectPremiumChainCandidates, type PremiumCandidateQuote } from "./optionPremiumMomentum";
import { emitActivity, getActivity, clearActivity } from "./activityLog";

describe("premium-first scanner", () => {
  it("selects only bounded ATM/ITM candidates from both sides", () => {
    const selected = selectPremiumChainCandidates([
      { strike: 57000, ceLtp: 150, peLtp: 20, ceToken: "ce-57000", peToken: "pe-57000" },
      { strike: 57100, ceLtp: 100, peLtp: 30, ceToken: "ce-57100", peToken: "pe-57100" },
      { strike: 57200, ceLtp: 50, peLtp: 50, ceToken: "ce-57200", peToken: "pe-57200" },
      { strike: 57300, ceLtp: 30, peLtp: 100, ceToken: "ce-57300", peToken: "pe-57300" },
      { strike: 57400, ceLtp: 20, peLtp: 150, ceToken: "ce-57400", peToken: "pe-57400" },
    ], 57200, 2);
    expect(selected).toHaveLength(4);
    expect(selected.filter(candidate => candidate.optionType === "CE").every(candidate => candidate.strike >= 57200)).toBe(true);
    expect(selected.filter(candidate => candidate.optionType === "PE").every(candidate => candidate.strike <= 57200)).toBe(true);
  });

  it("rejects stale quotes and caps the candidate universe", () => {
    const now = 1_000_000;
    const quotes: PremiumCandidateQuote[] = Array.from({ length: 30 }, (_, index) => ({
      token: `t-${index}`, symbol: `CE_${index}`, optionType: "CE", strike: index, premium: 100 - index, spreadPercent: null,
      timestamp: index === 29 ? now - 20_000 : now,
    }));
    const histories = new Map();
    const result = scanPremiumFirstCandidates(quotes, histories, now, 12);
    expect(result).toHaveLength(12);
    expect(result.every(item => item.candidate.timestamp === now)).toBe(true);
  });
});

describe("activity log slot visibility", () => {
  it("normalizes slots 1 through 5 into the root session feed", () => {
    const root = `activity-test-${Date.now()}`;
    for (let slot = 1; slot <= 5; slot += 1) emitActivity(`${root}-slot${slot}`, "signal", `slot-${slot}`);
    const events = getActivity(root, 20, 0);
    expect(events.map(event => event.slot)).toEqual([1, 2, 3, 4, 5]);
    clearActivity(root, true);
  });

  it("supports incremental reads without duplicate IDs", () => {
    const root = `activity-test-${Date.now()}`;
    emitActivity(root, "bot_start", "start");
    const first = getActivity(root, 20, 0);
    emitActivity(root, "signal", "signal");
    const incremental = getActivity(root, 20, first[first.length - 1].id);
    expect(incremental).toHaveLength(1);
    expect(incremental[0].message).toBe("signal");
    clearActivity(root, true);
  });
});
