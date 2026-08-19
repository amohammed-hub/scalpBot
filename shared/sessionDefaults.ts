/**
 * SESSION-BASED DEFAULT INSTRUMENTS
 * 
 * Morning (9:15 AM – 3:30 PM IST): NSE Index Options
 * Evening (5:00 PM – 11:30 PM IST): MCX Commodity Options
 * 
 * These are DEFAULTS — user can override anytime via dropdown.
 * When session switches (3:30 → 5:00), bots auto-switch to MCX defaults
 * UNLESS user manually set a different instrument (don't override).
 */

export interface InstrumentDefault {
  token: string;
  symbol: string;
  label: string;
  lotSize: number;
  isIndexOptions: boolean;
  underlyingToken: string;
}

// Morning session: NSE Index Options
const MORNING_DEFAULTS: InstrumentDefault[] = [
  { token: "NSE_INDEX|Nifty 50",            symbol: "NIFTY",      label: "Nifty 50 → ITM Options (Auto)", lotSize: 25, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty 50" },
  { token: "NSE_INDEX|Nifty Bank",          symbol: "BANKNIFTY",  label: "BankNifty → ITM Options (Auto)", lotSize: 15, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Bank" },
  { token: "NSE_INDEX|Nifty Fin Service",   symbol: "FINNIFTY",   label: "FinNifty → ITM Options (Auto)", lotSize: 25, isIndexOptions: true, underlyingToken: "NSE_INDEX|Nifty Fin Service" },
  { token: "BSE_INDEX|SENSEX",              symbol: "SENSEX",     label: "Sensex → ITM Options (Auto)", lotSize: 20, isIndexOptions: true, underlyingToken: "BSE_INDEX|SENSEX" }
];

// Evening session: MCX Commodity Options
const EVENING_DEFAULTS: InstrumentDefault[] = [
  { token: "MCX_FO|563946",  symbol: "MCX_GOLD",   label: "Gold → ITM Options (Auto)",         lotSize: 100, isIndexOptions: true, underlyingToken: "MCX_FO|563946" },
  { token: "MCX_FO|560977",  symbol: "MCX_CRUDE",  label: "Crude Oil → ITM Options (Auto)",    lotSize: 100, isIndexOptions: true, underlyingToken: "MCX_FO|560977" },
  { token: "MCX_FO|471725",  symbol: "MCX_SILVER", label: "Silver → ITM Options (Auto)",       lotSize: 30,  isIndexOptions: true, underlyingToken: "MCX_FO|471725" },
  { token: "MCX_FO|561496",  symbol: "MCX_NATGAS", label: "Natural Gas → ITM Options (Auto)",  lotSize: 1250, isIndexOptions: true, underlyingToken: "MCX_FO|561496" },
  { token: "MCX_FO|568831",  symbol: "MCX_COPPER", label: "Copper → ITM Options (Auto)",       lotSize: 2500, isIndexOptions: true, underlyingToken: "MCX_FO|568831" },
  { token: "MCX_FO|568836",  symbol: "MCX_ZINC",   label: "Zinc → ITM Options (Auto)",         lotSize: 5000, isIndexOptions: true, underlyingToken: "MCX_FO|568836" },
];

export type TradingSession = "morning" | "evening" | "closed";

/**
 * Get the current trading session based on IST time.
 * Morning: 9:15 AM – 3:30 PM IST
 * Evening: 5:00 PM – 11:30 PM IST
 * Closed: Outside trading hours
 */
// D37 → D38 (CAPA): the time gate was removed. Root-cause analysis on the
// Aug 11-19 trade log and 15 days of BankNifty 5m data proved the hour was
// NOT the cause of late-session losses (follow-through early 35.5% vs late
// 35.3% — identical; TP-first rates 58.8% vs 57.4% — statistically the same).
// The true causes were entry quality: deep-OTM cheap premium entries and stops
// eaten by bid-ask spread noise. D38 replaces the time gate with entry-quality
// filters applied in the engine's execution-quality gate block.
// This constant is retained only for the historical diagnostic label and
// per-hour analytics; it no longer blocks entries.
export const LATE_SESSION_ENTRY_CUT_OFF = {
  nse: 840, // 14:00 IST — diagnostic reference only
  mcx: 1290, // 21:30 IST — diagnostic reference only
} as const;

// D38 (CAPA): entry-quality filter predicate — keeps entries enabled at all
// hours but blocks entries whose execution quality is provably bad.
// Root causes from the user's own 50-trade log:
//   - 6 entries under ₹10 premium: 1/6 wins, -₹1,984 (deep OTM decay + spread)
//   - stop-loss losers exited at -3.88% realized vs -3.52% paper SL (noise)
export function isEntryQualityBlocked(
  premium: number,
  spreadPct: number,
  spreadNoiseSlCheck: {
    slDistancePct: number; // |entry - SL| / entry as percent
    spreadPct: number;
  } | null,
): { blocked: boolean; reason: string | null } {
  // CA-1: premium floor — deep OTM options are structurally untradeable
  if (!Number.isFinite(premium) || premium <= 0) {
    return { blocked: true, reason: "premium unavailable" };
  }
  // CA-3: spread-noise check — the SL must survive the bid-ask noise.
  // Evidence: realized stop exits were 0.35pp past the paper SL on average,
  // i.e. the stop was hunted by spread noise before the move played out.
  // Require the SL distance to be >= 4x the half-spread, else the stop sits
  // inside the noise band and will be hit randomly.
  if (spreadNoiseSlCheck && spreadNoiseSlCheck.spreadPct > 0) {
    const halfSpreadPct = spreadNoiseSlCheck.spreadPct / 2;
    if (spreadNoiseSlCheck.slDistancePct < 4 * halfSpreadPct) {
      return {
        blocked: true,
        reason: `SL distance ${spreadNoiseSlCheck.slDistancePct.toFixed(1)}% inside spread-noise band (half-spread ${halfSpreadPct.toFixed(1)}% × 4)`,
      };
    }
  }
  void spreadPct; // wider-spread rejection already handled at the quote gate
  return { blocked: false, reason: null };
}

// D37: current IST time as total minutes from midnight, reusable for session
// and cut-off gates (e.g. 14:00 IST = 840 minutes).
export function istMinutesTotal(now: Date = new Date()): number {
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000);
  const ist = new Date(istMs);
  return ist.getHours() * 60 + ist.getMinutes();
}

export function getCurrentSession(): TradingSession {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000);
  const ist = new Date(istMs);
  const hours = ist.getHours();
  const mins = ist.getMinutes();
  const totalMins = hours * 60 + mins;

  // Morning: 9:15 (555) to 15:30 (930)
  if (totalMins >= 555 && totalMins <= 930) return "morning";
  // Evening: 17:00 (1020) to 23:30 (1410)
  if (totalMins >= 1020 && totalMins <= 1410) return "evening";
  return "closed";
}

/**
 * Get the default instrument for a given bot slot (0-indexed) based on current session.
 * Returns null if market is closed.
 */
export function getSessionDefault(botSlot: number, session?: TradingSession): InstrumentDefault | null {
  const s = session ?? getCurrentSession();
  if (s === "closed") return null;
  const defaults = s === "morning" ? MORNING_DEFAULTS : EVENING_DEFAULTS;
  // Clamp to available slots (0-3)
  const idx = Math.min(botSlot, defaults.length - 1);
  return defaults[idx];
}

/**
 * Get all session defaults for the current session.
 */
export function getAllSessionDefaults(session?: TradingSession): InstrumentDefault[] {
  const s = session ?? getCurrentSession();
  if (s === "closed") return MORNING_DEFAULTS; // fallback to morning
  return s === "morning" ? MORNING_DEFAULTS : EVENING_DEFAULTS;
}

/**
 * Check if the session has changed (morning → evening or vice versa).
 * Used to trigger auto-switch.
 */
export function hasSessionChanged(previousSession: TradingSession, currentSession: TradingSession): boolean {
  if (previousSession === currentSession) return false;
  if (previousSession === "closed") return false; // don't auto-switch on first load
  return true;
}

/**
 * Get the session switch time boundaries in IST minutes.
 */
export const SESSION_BOUNDARIES = {
  morningStart: 555,   // 9:15 AM
  morningEnd: 930,     // 3:30 PM
  eveningStart: 1020,  // 5:00 PM
  eveningEnd: 1410,    // 11:30 PM
} as const;
