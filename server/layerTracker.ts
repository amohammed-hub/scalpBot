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

/**
 * D25: canonical layer key — display names ("Red Bar Theory", "Trikal
 * Strategy", "MCX Evening") and camelCase IDs ("RedBarTheory", "TrikalStrategy")
 * must resolve to the SAME map key so auto-disable, stats, and the UI never
 * split one layer into duplicate entries.
 */
export function canonicalLayerKey(layer: string): string {
  const t = (layer ?? "").trim();
  if (!t) return "Other";
  // Identity pass-through for known camelCase layer IDs.
  if (/^[A-Z][A-Za-z0-9]+(_[A-Z0-9]+)?$/.test(t)) return t;
  const words = t
    .replace(/&/g, " And ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const joined = words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  return joined || "Other";
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
    { layer: "EmaCross", test: text => /ema/i.test(text) },
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
    // D25: canonical keying — display names and camelCase IDs merge into one entry.
    const layer = canonicalLayerKey(inferLayerFromTrade(trade));
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
  const key = canonicalLayerKey(layer);
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (manualOverrides.get(key)) return { disabled: true, reason: "Manually disabled", source: "manual" };
  const auto = autoDisabled.get(key);
  if (auto) {
    if (Date.now() - auto.at > REENABLE_AFTER_MS) {
      autoDisabled.delete(key);
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
  const key = canonicalLayerKey(layer);
  const gate = getLayerDisableState(key, sessionToken);
  const demoOverrideActive = mode === "demo" && gate.source === "auto" && getDemoForceEnabled(sessionToken).has(key);
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

export interface ViableCandidateResult {
  /** Layers allowed to trade this scan. */
  eligible: string[];
  /** Manually-disabled layers that remain blocked (manual is always authoritative). */
  manuallyDisabled: string[];
  /**
   * D25 deadlock bypass: when EVERY non-manually-disabled candidate layer is
   * auto-gated, the auto-gated candidate with the LEAST negative expectancy is
   * released once so the bot keeps trading instead of scanning forever without
   * entries. The caller removes that entry from the auto-disabled set, so the
   * bypass applies exactly once per negative-sample era.
   */
  deadlocked: { layer: string; reason: string } | null;
}

/**
 * D25: evaluates a candidate layer set against the D3 gate WITH deadlock
 * protection. Use this from the runtime candidate loop instead of gating
 * layers one-by-one with getLayerGateForMode.
 */
export function computeViableCandidates(
  candidateLayers: string[],
  sessionToken: string = "default",
  mode: "demo" | "live",
  options?: { selectedLayers?: string[] },
): ViableCandidateResult {
  const result: ViableCandidateResult = { eligible: [], manuallyDisabled: [], deadlocked: null };
  if (candidateLayers.length === 0) return result;
  const gated: Array<{ layer: string; reason: string; expectancy: number }> = [];
  // D26: in manual mode, the user's selected layers are never gated.
  const isManual = getStrategyMode(sessionToken) === "manual";
  const selectedKeys = isManual
    ? new Set((options?.selectedLayers ?? []).map(l => canonicalLayerKey(l)))
    : new Set<string>();
  for (const layer of candidateLayers) {
    const gate = getLayerGateForMode(layer, sessionToken, mode);
    if (gate.demoOverrideActive) {
      result.eligible.push(layer);
      continue;
    }
    if (gate.disabled) {
      if (gate.source === "manual") {
        result.manuallyDisabled.push(layer);
        continue;
      }
      // D26: manual mode — a user-selected layer can never be auto-gated.
      if (isManual && selectedKeys.has(canonicalLayerKey(layer))) {
        result.eligible.push(layer);
        continue;
      }
      gated.push({ layer, reason: gate.reason ?? "layer disabled", expectancy: extractExpectancy(gate.reason) });
    } else {
      result.eligible.push(layer);
    }
  }
  if (result.eligible.length === 0 && gated.length > 0) {
    // D25 deadlock: every candidate is auto-gated — release the least-negative.
    gated.sort((a, b) => b.expectancy - a.expectancy);
    const release = gated[0];
    result.deadlocked = { layer: release.layer, reason: release.reason };
    result.eligible.push(release.layer);
    const autoDisabled = getAutoDisabled(sessionToken);
    autoDisabled.delete(canonicalLayerKey(release.layer));
    result.manuallyDisabled.push(...gated.slice(1).map(g => g.layer));
  } else {
    result.manuallyDisabled.push(...gated.map(g => g.layer));
  }
  return result;
}

function extractExpectancy(reason: string | null): number {
  if (!reason) return Number.NEGATIVE_INFINITY;
  const m = reason.match(/expectancy\s*[\u20B9]?\s*([\d.,\-]+)\s*per trade/i);
  const raw = m?.[1]?.replace(/,/g, "");
  const v = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

// ── D26: strategy mode (auto vs manual) ──────────────────────────────────────
// "auto"  — engine manages layers; auto-disable may gate candidates but the D25
//           deadlock bypass always keeps at least one candidate alive.
// "manual"— ONLY the layers the user selected may trade. Auto-disable is
//           completely powerless against user-selected layers; manual disables
//           (user explicit toggle) remain authoritative.
export type StrategyMode = "auto" | "manual";
const strategyModes = new Map<string, StrategyMode>();
export function setStrategyMode(sessionToken: string, mode: StrategyMode): void {
  strategyModes.set(getLayerTrackerTenantKey(sessionToken), mode);
}
export function getStrategyMode(sessionToken: string = "default"): StrategyMode {
  return strategyModes.get(getLayerTrackerTenantKey(sessionToken)) ?? "auto";
}
export function clearStrategyModes(): void {
  strategyModes.clear();
}

/** D25: one-time admin recovery — clears every auto-disable entry for a tenant. */
export function clearAllAutoDisables(sessionToken: string = "default"): number {
  const autoDisabled = getAutoDisabled(sessionToken);
  const count = autoDisabled.size;
  autoDisabled.clear();
  return count;
}

export function setLayerOverride(layer: string, disabled: boolean, sessionToken: string = "default"): void {
  const key = canonicalLayerKey(layer);
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (disabled) manualOverrides.set(key, true);
  else {
    manualOverrides.delete(key);
    autoDisabled.delete(key);
  }
}

export function setDemoLayerOverride(layer: string, enabled: boolean, sessionToken: string = "default"): void {
  const key = canonicalLayerKey(layer);
  const overrides = getDemoForceEnabled(sessionToken);
  if (enabled) overrides.add(key);
  else overrides.delete(key);
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
      result.push({ layer: canonicalLayerKey(layer), reason: value.reason });
    }
  });
  return result;
}
