const SIGNAL_JOURNAL_REGIME_MAX_LENGTH = 32;

/**
 * Convert descriptive strategy regime labels into stable journal values.
 * The production column is VARCHAR(32); strategy labels may include a long
 * human explanation (for example, "Ranging — use VWAP mean reversion").
 */
export function normalizeSignalJournalRegime(regime?: string | null): string | null {
  const value = regime?.trim();
  if (!value) return null;

  const upper = value.toUpperCase();
  if (upper.includes("RANG")) return "ranging";
  if (upper.includes("TREND")) return "trending";
  if (upper.includes("HIGH_VOL") || upper.includes("HIGH VOL")) return "high_vol";
  if (upper.includes("LOW_VOL") || upper.includes("LOW VOL")) return "low_vol";
  if (upper.includes("DEAD")) return "dead";
  if (upper.includes("UNKNOWN") || upper.includes("INSUFFICIENT")) return "unknown";

  return value.slice(0, SIGNAL_JOURNAL_REGIME_MAX_LENGTH);
}
