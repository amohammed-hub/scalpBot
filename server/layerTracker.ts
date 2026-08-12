/**
 * Strategy Layer Performance Tracker
 *
 * D3: maintains tenant-scoped, bounded performance snapshots. A layer is
 * automatically disabled only after the minimum sample when realised expectancy
 * is negative. Win rate remains dashboard context, never the disable criterion.
 */

export interface LayerPerformanceTrade {
  layer?: string | null;
  signalReason: string | null;
  pnl: number | null;
  exitedAt: Date | null;
}

export interface LayerStats {
  layer: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  expectancy: number;
  profitFactor: number;
  disabled: boolean;
  disabledAt: number | null;
  disabledReason: string | null;
}

export const MIN_TRADES_FOR_DISABLE = 5;
export const LAYER_WINDOW_SIZE = 20;
export const REENABLE_AFTER_MS = 24 * 60 * 60 * 1000;

// State is keyed by the owning tenant, never by a bot's slot suffix.
const manualOverridesByTenant = new Map<string, Map<string, boolean>>();
const autoDisabledByTenant = new Map<string, Map<string, { at: number; reason: string }>>();
// Deliberately separate from manual overrides: this bounded, in-memory state exists
// only to collect Demo evidence when D3 has auto-disabled a layer. It must never
// alter the scorecard's disabled status or become a Live-trading permission.
const demoForceEnabledByTenant = new Map<string, Set<string>>();

export function getLayerTrackerTenantKey(sessionToken: string = "default"): string {
  return sessionToken.replace(/-slot[1-5]$/, "");
}

function getManualOverrides(sessionToken: string): Map<string, boolean> {
  const tenant = getLayerTrackerTenantKey(sessionToken);
  if (!manualOverridesByTenant.has(tenant)) manualOverridesByTenant.set(tenant, new Map());
  return manualOverridesByTenant.get(tenant)!;
}

function getAutoDisabled(sessionToken: string): Map<string, { at: number; reason: string }> {
  const tenant = getLayerTrackerTenantKey(sessionToken);
  if (!autoDisabledByTenant.has(tenant)) autoDisabledByTenant.set(tenant, new Map());
  return autoDisabledByTenant.get(tenant)!;
}

function getDemoForceEnabled(sessionToken: string): Set<string> {
  const tenant = getLayerTrackerTenantKey(sessionToken);
  if (!demoForceEnabledByTenant.has(tenant)) demoForceEnabledByTenant.set(tenant, new Set());
  return demoForceEnabledByTenant.get(tenant)!;
}

/** Prefer a journal layer; retain legacy parsing for historic trade rows. */
export function inferLayerFromTrade(trade: Pick<LayerPerformanceTrade, "layer" | "signalReason">): string {
  const explicit = trade.layer?.trim();
  if (explicit) return explicit;

  const reason = trade.signalReason ?? "";
  const tag = reason.match(/^(?:\[Re-entry\]\s*)?\[([^\]]+)\]/);
  if (tag?.[1]?.trim()) return tag[1].trim();

  const legacyPatterns: Array<{ layer: string; test: (text: string) => boolean }> = [
    { layer: "RedBarTheory", test: text => /red\s*bar/i.test(text) },
    { layer: "TrikalStrategy", test: text => /trikal/i.test(text) },
    { layer: "MeanReversionV13", test: text => /mean\s*reversion|v13/i.test(text) },
    { layer: "Adeeb", test: text => /adeeb/i.test(text) },
    { layer: "PremiumRenko", test: text => /premium\s*renko/i.test(text) },
    { layer: "VWAPReversion", test: text => /vwap\s*reversion/i.test(text) },
    { layer: "VWAPPullback", test: text => /vwap\s*pullback/i.test(text) },
    { layer: "Trend", test: text => /supertrend/i.test(text) },
    { layer: "MACD_BB", test: text => /macd|bollinger|\bbb\b/i.test(text) },
    { layer: "ORB", test: text => /\borb\b|opening range/i.test(text) },
    { layer: "InstFootprint", test: text => /institutional|footprint/i.test(text) },
    { layer: "CPR", test: text => /\bcpr\b|pivot/i.test(text) },
    { layer: "PowerHour", test: text => /power hour|\bpower\b/i.test(text) },
    { layer: "MCXEvening", test: text => /mcx/i.test(text) },
    { layer: "HeroZero", test: text => /hero/i.test(text) },
    { layer: "TrendMomentum", test: text => /momentum/i.test(text) },
    { layer: "Breakout", test: text => /breakout/i.test(text) },
    { layer: "VWAP", test: text => /vwap/i.test(text) },
    { layer: "EMA Cross", test: text => /ema/i.test(text) },
  ];

  return legacyPatterns.find(pattern => pattern.test(reason))?.layer ?? "Other";
}

function expectancyDisableReason(expectancy: number, sampleSize: number): string {
  return `Auto-disabled: expectancy ₹${expectancy.toFixed(2)} per trade < ₹0.00 over last ${sampleSize} trades`;
}

/**
 * Hydrates the current disabled set from closed-trade history. The supplied
 * history must be bounded by the caller. Manual overrides are never mutated.
 */
export function computeLayerStats(closedTrades: LayerPerformanceTrade[], sessionToken: string = "default"): LayerStats[] {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  const first = closedTrades[0]?.exitedAt;
  const last = closedTrades[closedTrades.length - 1]?.exitedAt;
  const sorted = closedTrades.length > 1 && first && last && first > last
    ? [...closedTrades].reverse()
    : closedTrades;

  const byLayer = new Map<string, Array<{ pnl: number }>>();
  for (const trade of sorted) {
    if (trade.pnl === null || trade.pnl === undefined || !Number.isFinite(trade.pnl)) continue;
    const layer = inferLayerFromTrade(trade);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push({ pnl: trade.pnl });
  }

  const stats: LayerStats[] = [];
  for (const [layer, trades] of Array.from(byLayer.entries())) {
    const recent = trades.slice(-LAYER_WINDOW_SIZE);
    const wins = recent.filter(trade => trade.pnl > 0).length;
    const losses = recent.filter(trade => trade.pnl <= 0).length;
    const totalPnl = recent.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossProfit = recent.filter(trade => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(recent.filter(trade => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
    const expectancy = recent.length > 0 ? totalPnl / recent.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
    const winRate = recent.length > 0 ? (wins / recent.length) * 100 : 0;

    let disabled = manualOverrides.get(layer) ?? false;
    let disabledAt: number | null = null;
    let disabledReason: string | null = disabled ? "Manually disabled" : null;
    const existingAuto = autoDisabled.get(layer);

    if (!disabled && recent.length >= MIN_TRADES_FOR_DISABLE && expectancy < 0) {
      const reason = expectancyDisableReason(expectancy, recent.length);
      const at = existingAuto?.at ?? Date.now();
      autoDisabled.set(layer, { at, reason });
      disabled = true;
      disabledAt = at;
      disabledReason = reason;
    } else if (!disabled && existingAuto) {
      // A refreshed non-negative sample is explicit evidence to re-enable.
      autoDisabled.delete(layer);
    } else if (existingAuto) {
      disabledAt = existingAuto.at;
      disabledReason = existingAuto.reason;
    }

    stats.push({ layer, totalTrades: recent.length, wins, losses, winRate, totalPnl, grossProfit, grossLoss, expectancy, profitFactor, disabled, disabledAt, disabledReason });
  }

  // A stale entry may never be allowed to linger after its configured lifetime.
  for (const [layer, auto] of Array.from(autoDisabled.entries())) {
    if (Date.now() - auto.at > REENABLE_AFTER_MS && !byLayer.has(layer)) autoDisabled.delete(layer);
  }

  return stats.sort((a, b) => b.totalTrades - a.totalTrades || a.layer.localeCompare(b.layer));
}

export type LayerDisableSource = "none" | "manual" | "auto";

export interface LayerGateResult {
  disabled: boolean;
  reason: string | null;
  source: LayerDisableSource;
  demoOverrideActive: boolean;
  overriddenReason: string | null;
}

/** Returns the D3 gate and its source without applying any Demo exception. */
export function getLayerDisableState(layer: string, sessionToken: string = "default"): Omit<LayerGateResult, "demoOverrideActive" | "overriddenReason"> {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (manualOverrides.get(layer)) return { disabled: true, reason: "Manually disabled", source: "manual" };
  const auto = autoDisabled.get(layer);
  if (auto) {
    if (Date.now() - auto.at > REENABLE_AFTER_MS) {
      autoDisabled.delete(layer);
      return { disabled: false, reason: null, source: "none" };
    }
    return { disabled: true, reason: auto.reason, source: "auto" };
  }
  return { disabled: false, reason: null, source: "none" };
}

/**
 * Applies the only permitted exception to D3: a tenant's explicit, transient
 * Demo override may bypass an automatic expectancy disable. Manual disables
 * and all non-D3 safety gates remain authoritative.
 */
export function getLayerGateForMode(
  layer: string,
  sessionToken: string = "default",
  mode: "demo" | "live",
): LayerGateResult {
  const gate = getLayerDisableState(layer, sessionToken);
  const demoOverrideActive = mode === "demo" && gate.source === "auto" && getDemoForceEnabled(sessionToken).has(layer);
  if (demoOverrideActive) {
    return {
      disabled: false,
      reason: null,
      source: "auto",
      demoOverrideActive: true,
      overriddenReason: gate.reason,
    };
  }
  return { ...gate, demoOverrideActive: false, overriddenReason: null };
}

/** Checks the current manual/automatic disabled set before candidate selection. */
export function isLayerDisabled(layer: string, sessionToken: string = "default"): { disabled: boolean; reason: string | null } {
  const gate = getLayerDisableState(layer, sessionToken);
  return { disabled: gate.disabled, reason: gate.reason };
}

export function setLayerOverride(layer: string, disabled: boolean, sessionToken: string = "default"): void {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (disabled) manualOverrides.set(layer, true);
  else {
    manualOverrides.delete(layer);
    autoDisabled.delete(layer);
  }
}

export function setDemoLayerOverride(layer: string, enabled: boolean, sessionToken: string = "default"): void {
  const overrides = getDemoForceEnabled(sessionToken);
  if (enabled) overrides.add(layer);
  else overrides.delete(layer);
}

export function getDemoLayerOverrides(sessionToken: string = "default"): string[] {
  return Array.from(getDemoForceEnabled(sessionToken)).sort();
}

export function clearDemoLayerOverrides(sessionToken: string = "default"): void {
  getDemoForceEnabled(sessionToken).clear();
}

export function resetAllLayerOverrides(sessionToken: string = "default"): void {
  getManualOverrides(sessionToken).clear();
  getAutoDisabled(sessionToken).clear();
  clearDemoLayerOverrides(sessionToken);
}

/**
 * D12: Expose the current auto-disabled layers for a tenant.
 * Returns an array of { layer, reason } for all layers that are currently
 * auto-disabled (not manually disabled).
 */
export function getAutoDisabledLayers(sessionToken: string = "default"): Array<{ layer: string; reason: string }> {
  const autoDisabled = getAutoDisabled(sessionToken);
  const result: Array<{ layer: string; reason: string }> = [];
  autoDisabled.forEach((value, layer) => {
    // Only include if it hasn't expired (REENABLE_AFTER_MS)
    if (Date.now() - value.at < REENABLE_AFTER_MS) {
      result.push({ layer, reason: value.reason });
    }
  });
  return result;
}
