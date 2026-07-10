/**
 * Strategy Presets — one-click risk profiles applied atomically to all active slots.
 */

export interface StrategyPreset {
  id: "conservative" | "balanced" | "aggressive";
  name: string;
  description: string;
  minConfidence: number; // %
  stopLossMultiplier: number; // ATR x
  targetMultiplier: number; // ATR x
  maxTradesPerDay: number;
  riskPerTradePct: number;
  dailyLossLimitPct: number;
  trailingSlEnabled: boolean;
  trailingSlPct: number;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "conservative",
    name: "Conservative",
    description: "High-confidence entries only, tight risk, fewer trades. Best for volatile or uncertain markets.",
    minConfidence: 75,
    stopLossMultiplier: 1.2,
    targetMultiplier: 2.4,
    maxTradesPerDay: 3,
    riskPerTradePct: 0.5,
    dailyLossLimitPct: 2,
    trailingSlEnabled: true,
    trailingSlPct: 0.4,
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Default profile — moderate confidence threshold with 1:2 risk-reward. Suited to most trending days.",
    minConfidence: 60,
    stopLossMultiplier: 1.5,
    targetMultiplier: 3.0,
    maxTradesPerDay: 5,
    riskPerTradePct: 1.0,
    dailyLossLimitPct: 3,
    trailingSlEnabled: true,
    trailingSlPct: 0.5,
  },
  {
    id: "aggressive",
    name: "Aggressive",
    description: "More trades, wider targets, higher risk per trade. Only for strong trending days with proven edge.",
    minConfidence: 50,
    stopLossMultiplier: 1.8,
    targetMultiplier: 4.0,
    maxTradesPerDay: 8,
    riskPerTradePct: 1.5,
    dailyLossLimitPct: 5,
    trailingSlEnabled: false,
    trailingSlPct: 0.5,
  },
];

export function getPreset(id: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find(p => p.id === id);
}

