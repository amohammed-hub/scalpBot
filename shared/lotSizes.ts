// ── NSE Index F&O Lot Sizes — SINGLE SOURCE OF TRUTH ─────────────────────────
// Revised per NSE circular FAOP70616, effective for weekly/monthly contracts
// from Dec 30, 2025 EOD (i.e., all Jan 2026+ expiries):
//   NIFTY 50:        75 → 65
//   BANKNIFTY:       35 → 30
//   FINNIFTY:        65 → 60
//   MIDCPNIFTY:     140 → 120
// NOTE: These are FALLBACK values. The bot engine additionally fetches the
// live lot_size from Upstox /v2/option/contract at trade time and overrides
// these, so the system self-corrects when exchanges revise lots again.
// Last manually verified: Jul 17, 2026.

export const NSE_INDEX_LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  FINNIFTY: 60,
  MIDCPNIFTY: 120,
  SENSEX: 10,
  BANKEX: 15,
};

export function getNseIndexLotSize(symbol: string): number | null {
  const s = symbol.toUpperCase();
  if (s.includes("BANKNIFTY") || s.includes("NIFTY BANK")) return NSE_INDEX_LOT_SIZES.BANKNIFTY;
  if (s.includes("FINNIFTY") || s.includes("FIN SERVICE")) return NSE_INDEX_LOT_SIZES.FINNIFTY;
  if (s.includes("MIDCPNIFTY") || s.includes("MIDCAP")) return NSE_INDEX_LOT_SIZES.MIDCPNIFTY;
  if (s.includes("BANKEX")) return NSE_INDEX_LOT_SIZES.BANKEX;
  if (s.includes("SENSEX")) return NSE_INDEX_LOT_SIZES.SENSEX;
  if (s.includes("NIFTY")) return NSE_INDEX_LOT_SIZES.NIFTY;
  return null;
}
