/**
 * Subscription Tier Limits Configuration
 * Used by both server (enforcement) and client (UI gating).
 */

export type PlanTier = "trial" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "admin";

export interface TierLimits {
  maxTradesPerDay: number; // 0 = unlimited
  mcxAccess: boolean;
  maxBots: number; // 0 = unlimited
  telegram: boolean;
  backtester: boolean;
  customStrategy: boolean;
  shadowMode: boolean;
  heroZeroScanner: boolean;
  paperTrading: boolean;
  pnlAnalytics: boolean;
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  trial: {
    maxTradesPerDay: 5,
    mcxAccess: false,
    maxBots: 3,
    telegram: false,
    backtester: false,
    customStrategy: false,
    shadowMode: false,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
  monthly: {
    maxTradesPerDay: 10,
    mcxAccess: false,
    maxBots: 3,
    telegram: true,
    backtester: false,
    customStrategy: false,
    shadowMode: false,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
  quarterly: {
    maxTradesPerDay: 15,
    mcxAccess: true,
    maxBots: 3,
    telegram: true,
    backtester: true,
    customStrategy: false,
    shadowMode: false,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
  half_yearly: {
    maxTradesPerDay: 20,
    mcxAccess: true,
    maxBots: 3,
    telegram: true,
    backtester: true,
    customStrategy: true,
    shadowMode: true,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
  yearly: {
    maxTradesPerDay: 0, // unlimited
    mcxAccess: true,
    maxBots: 3,
    telegram: true,
    backtester: true,
    customStrategy: true,
    shadowMode: true,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
  admin: {
    maxTradesPerDay: 0, // unlimited
    mcxAccess: true,
    maxBots: 0, // unlimited
    telegram: true,
    backtester: true,
    customStrategy: true,
    shadowMode: true,
    heroZeroScanner: true,
    paperTrading: true,
    pnlAnalytics: true,
  },
};

/**
 * Get tier limits for a given plan. Defaults to trial if unknown.
 */
export function getTierLimits(plan: string | null | undefined, isAdmin: boolean): TierLimits {
  if (isAdmin) return TIER_LIMITS.admin;
  if (!plan) return TIER_LIMITS.trial;
  const key = plan as PlanTier;
  return TIER_LIMITS[key] ?? TIER_LIMITS.trial;
}

/**
 * Human-readable plan names for display
 */
export const PLAN_DISPLAY_NAMES: Record<PlanTier, string> = {
  trial: "Free Trial",
  monthly: "Monthly",
  quarterly: "3-Month",
  half_yearly: "6-Month",
  yearly: "Annual",
  admin: "Admin",
};

/**
 * Minimum plan required for each feature (for upgrade messages)
 */
export const FEATURE_MIN_PLAN: Record<string, { minPlan: PlanTier; label: string }> = {
  mcxAccess: { minPlan: "quarterly", label: "MCX markets require 3-Month plan or higher" },
  backtester: { minPlan: "quarterly", label: "Backtester is available on 3-Month plan and above" },
  customStrategy: { minPlan: "half_yearly", label: "Custom Strategy Builder requires 6-Month plan or higher" },
  shadowMode: { minPlan: "half_yearly", label: "Shadow Mode requires 6-Month plan or higher" },
  telegram: { minPlan: "monthly", label: "Telegram Alerts require Monthly plan or higher" },
};
