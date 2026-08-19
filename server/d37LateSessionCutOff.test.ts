/**
 * D37 regression tests — late-session entry cut-off.
 *
 * Evidence: the Aug 11-19 trade log showed the largest losses in the
 * 14:00-18:00 IST NSE window and the 16:30-18:30 IST MCX window
 * (e.g. COPPER -₹18.9K at 16:30, CRUDE double-stops -₹6.5K at 16:20-16:30).
 * D37 blocks NEW entries after 14:00 IST (NSE) and after 21:30 IST (MCX);
 * exits, P&L tracking, and candle building continue.
 *
 * The guard predicate lives in shared/sessionDefaults.ts and is exercised by
 * the engine tick on every iteration (state.isOpeningTrade mutex prevents the
 * entry path from proceeding once the guard sets it false).
 */
import { describe, it, expect, vi } from "vitest";
import {
  istMinutesTotal,
  isLateSessionEntryBlocked,
  LATE_SESSION_ENTRY_CUT_OFF,
} from "../shared/sessionDefaults";

const NSE_TOKEN = "NSE_INDEX|Nifty Bank";
const MCX_TOKEN = "MCX_FO|560977";

// Fixed-UTC helpers: NSE window checks, MCX window checks, and inside-window
// checks use pinned UTC instants so results do not depend on sandbox TZ.
function utc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm, 0));
}

describe("D37 IST time conversion", () => {
  it("14:00 IST → 840 minutes", () => {
    expect(istMinutesTotal(utc(2026, 7, 19, 8, 30))).toBe(840);
  });

  it("21:30 IST → 1290 minutes", () => {
    expect(istMinutesTotal(utc(2026, 7, 19, 16, 0))).toBe(1290);
  });

  it("12:00 IST → 720 minutes", () => {
    expect(istMinutesTotal(utc(2026, 7, 19, 6, 30))).toBe(720);
  });

  it("19:00 IST → 1140 minutes", () => {
    expect(istMinutesTotal(utc(2026, 7, 19, 13, 30))).toBe(1140);
  });
});

describe("D37 cut-off boundaries", () => {
  it("cut-off constants match 14:00 NSE and 21:30 MCX", () => {
    expect(LATE_SESSION_ENTRY_CUT_OFF.nse).toBe(840);
    expect(LATE_SESSION_ENTRY_CUT_OFF.mcx).toBe(1290);
  });
});

describe("isLateSessionEntryBlocked", () => {
  it("blocks NSE entries at 14:01 IST (one minute past cut-off)", () => {
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, false, utc(2026, 7, 19, 8, 31)),
    ).toBe(true);
  });

  it("blocks NSE entries at 15:30 IST (market close edge)", () => {
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, false, utc(2026, 7, 19, 10, 0)),
    ).toBe(true);
  });

  it("allows NSE entries at 14:00 IST exactly (not past the boundary)", () => {
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, false, utc(2026, 7, 19, 8, 30)),
    ).toBe(false);
  });

  it("allows NSE entries at 12:00 IST (deep inside window)", () => {
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, false, utc(2026, 7, 19, 6, 30)),
    ).toBe(false);
  });

  it("blocks MCX entries at 21:31 IST (one minute past cut-off)", () => {
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, false, utc(2026, 7, 19, 16, 1)),
    ).toBe(true);
  });

  it("blocks MCX entries at 23:30 IST (session close edge)", () => {
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, false, utc(2026, 7, 19, 18, 0)),
    ).toBe(true);
  });

  it("allows MCX entries at 19:00 IST (power hour still open)", () => {
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, false, utc(2026, 7, 19, 13, 30)),
    ).toBe(false);
  });

  it("allows MCX entries at 21:30 IST exactly", () => {
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, false, utc(2026, 7, 19, 16, 0)),
    ).toBe(false);
  });

  it("never blocks when a position is already open — exits must keep running", () => {
    // The single worst loss in the log (COPPER -₹18.9K at 16:30) happened
    // after entry; the guarantee D37 makes is only on NEW entries. Any open
    // position must always remain fully exit-managed.
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, true, utc(2026, 7, 19, 8, 31)),
    ).toBe(false);
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, true, utc(2026, 7, 19, 16, 1)),
    ).toBe(false);
  });

  it("NSE cut-off never applies to MCX instruments after 14:00", () => {
    expect(
      isLateSessionEntryBlocked(MCX_TOKEN, false, utc(2026, 7, 19, 8, 31)),
    ).toBe(false);
  });

  it("MCX cut-off never applies to NSE instruments after 21:30", () => {
    expect(
      isLateSessionEntryBlocked(NSE_TOKEN, false, utc(2026, 7, 19, 16, 1)),
    ).toBe(true); // NSE after 14:00 stays blocked all evening
  });
});
