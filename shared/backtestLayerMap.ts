/**
 * BACKTEST-DRIVEN LAYER MAP — Auto-assign only profitable strategy combos per instrument
 * Based on 6-month backtest (Jan–Jul 2026) using Upstox 1-min historical data.
 * 
 * Criteria for inclusion: PnL > 0, Profit Factor > 1.2, Min 10 trades
 * Sorted by Profit Factor (best first)
 */

export const PROFITABLE_LAYERS_BY_INSTRUMENT: Record<string, string[]> = {
  // NSE Indices — marginal edge, only keep strategies with PF > 1.05
  "NIFTY": ["Pattern", "Momentum", "RedBarTheory", "Adeeb"],
  "Nifty 50": ["Pattern", "Momentum", "RedBarTheory", "Adeeb"],
  "BANKNIFTY": ["Momentum", "RedBarTheory", "TrikalStrategy"],
  "Nifty Bank": ["Momentum", "RedBarTheory", "TrikalStrategy"],
  "FINNIFTY": ["Pattern", "TrikalStrategy", "RedBarTheory", "MACD_BB"],
  "Nifty Fin Service": ["Pattern", "TrikalStrategy", "RedBarTheory", "MACD_BB"],
  
  // MCX — strong edge, include all profitable strategies (PF > 1.4)
  "GOLD": ["VWAPReversion", "TrikalStrategy", "Trend", "RedBarTheory", "Momentum", "MACD_BB", "Pattern", "Adeeb"],
  "SILVER": ["VWAPReversion", "RedBarTheory", "TrikalStrategy", "Momentum", "Pattern", "MACD_BB", "Trend"],
  "CRUDEOIL": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MACD_BB", "Trend", "Pattern"],
  "CRUDE OIL": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MACD_BB", "Trend", "Pattern"],
  "NATURALGAS": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum"],
  "NATURAL GAS": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum"],
};

/**
 * Get the recommended enabledLayers for a given instrument label.
 * Falls back to a conservative default if instrument not found.
 */
export function getRecommendedLayers(instrumentLabel: string): string[] {
  // Try exact match first
  if (PROFITABLE_LAYERS_BY_INSTRUMENT[instrumentLabel]) {
    return PROFITABLE_LAYERS_BY_INSTRUMENT[instrumentLabel];
  }
  // Try partial match (case-insensitive)
  const upper = instrumentLabel.toUpperCase();
  for (const [key, layers] of Object.entries(PROFITABLE_LAYERS_BY_INSTRUMENT)) {
    if (upper.includes(key.toUpperCase()) || key.toUpperCase().includes(upper)) {
      return layers;
    }
  }
  // Default: conservative set that works across most instruments
  return ["RedBarTheory", "TrikalStrategy", "Momentum", "VWAPReversion"];
}

/**
 * Strategies that should NEVER be auto-enabled (negative PnL across all instruments)
 */
export const DISABLED_STRATEGIES = ["Breakout", "ORB"];
