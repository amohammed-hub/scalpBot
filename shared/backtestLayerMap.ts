/**
 * BACKTEST-DRIVEN LAYER MAP — Auto-assign only profitable strategy combos per instrument
 * Based on 6-month backtest (Jan–Jul 2026) using Upstox 1-min historical data.
 * 
 * Criteria for inclusion: PnL > 0, Profit Factor > 1.2, Min 10 trades
 * Sorted by Profit Factor (best first)
 */

export const PROFITABLE_LAYERS_BY_INSTRUMENT: Record<string, string[]> = {
  // NSE Indices — marginal edge, only keep strategies with PF > 1.05
  "NIFTY": ["BoxingStrategy", "ORB", "Pattern", "Momentum", "RedBarTheory", "Adeeb", "MeanReversionV13"],
  "Nifty 50": ["BoxingStrategy", "ORB", "Pattern", "Momentum", "RedBarTheory", "Adeeb", "MeanReversionV13"],
  "BANKNIFTY": ["BoxingStrategy", "ORB", "Momentum", "RedBarTheory", "TrikalStrategy", "MeanReversionV13"],
  "Nifty Bank": ["BoxingStrategy", "ORB", "Momentum", "RedBarTheory", "TrikalStrategy", "MeanReversionV13"],
  "FINNIFTY": ["BoxingStrategy", "ORB", "Pattern", "TrikalStrategy", "RedBarTheory", "MACD_BB", "MeanReversionV13"],
  "Nifty Fin Service": ["BoxingStrategy", "ORB", "Pattern", "TrikalStrategy", "RedBarTheory", "MACD_BB", "MeanReversionV13"],
  
  // MCX — strong edge, include all profitable strategies (PF > 1.4)
    "GOLD": ["VWAPReversion", "TrikalStrategy", "Trend", "RedBarTheory", "Momentum", "MACD_BB", "Pattern", "Adeeb", "MeanReversionV13"],
  "SILVER": ["VWAPReversion", "RedBarTheory", "TrikalStrategy", "Momentum", "Pattern", "MACD_BB", "Trend", "MeanReversionV13"],
  "CRUDEOIL": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MACD_BB", "Trend", "Pattern", "MeanReversionV13"],
  "CRUDE OIL": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MACD_BB", "Trend", "Pattern", "MeanReversionV13"],
  "NATURALGAS": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MeanReversionV13"],
  "NATURAL GAS": ["VWAPReversion", "TrikalStrategy", "RedBarTheory", "Momentum", "MeanReversionV13"],
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
  return ["RedBarTheory", "VWAPReversion", "TrikalStrategy", "PremiumRenko"];
}

/**
 * Strategies that should NEVER be auto-enabled (negative PnL across all instruments)
 */
export const DISABLED_STRATEGIES = ["Breakout"];
