export type MomentumExitDirection = "BUY" | "SELL";

export interface MomentumTrailingResult {
  currentSl: number;
  stage: "NONE" | "BREAKEVEN" | "LOCK_5" | "LOCK_9" | "LOCK_14";
}

/**
 * Returns whether the Demo Momentum Scalper should apply its loser timeout.
 * Profitable trades are never time-exited by this rule; market-close handling
 * remains the independent hard exit in botEngine.
 */
export function shouldMomentumScalperLoserTimeout(
  entryPrice: number,
  effectivePrice: number,
  enteredAtMs: number,
  nowMs: number,
  maxLoserHoldMs = 60 * 60 * 1000,
): boolean {
  if (!(entryPrice > 0) || !(effectivePrice > 0) || !(enteredAtMs > 0)) return false;
  const pnlPerUnit = effectivePrice - entryPrice;
  const ageMs = nowMs - enteredAtMs;
  return pnlPerUnit <= 0 && ageMs >= maxLoserHoldMs;
}

/**
 * Premium-percentage trailing ladder for a BUY option premium. The same
 * percentage logic is mirrored for SELL positions. Stops only tighten.
 */
export function updateMomentumScalperTrailingStop(
  entryPrice: number,
  effectivePrice: number,
  currentSl: number,
  direction: MomentumExitDirection,
): MomentumTrailingResult {
  if (!(entryPrice > 0) || !(effectivePrice > 0) || !(currentSl > 0)) {
    return { currentSl, stage: "NONE" };
  }

  const gainPct = direction === "BUY"
    ? ((effectivePrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - effectivePrice) / entryPrice) * 100;

  let lockGainPct = -Infinity;
  let stage: MomentumTrailingResult["stage"] = "NONE";
  if (gainPct >= 20) { lockGainPct = 14; stage = "LOCK_14"; }
  else if (gainPct >= 15) { lockGainPct = 9; stage = "LOCK_9"; }
  else if (gainPct >= 10) { lockGainPct = 5; stage = "LOCK_5"; }
  else if (gainPct >= 5) { lockGainPct = 0; stage = "BREAKEVEN"; }

  if (!Number.isFinite(lockGainPct)) return { currentSl, stage };
  const proposedSl = direction === "BUY"
    ? entryPrice * (1 + lockGainPct / 100)
    : entryPrice * (1 - lockGainPct / 100);
  const tightenedSl = direction === "BUY"
    ? Math.max(currentSl, proposedSl)
    : Math.min(currentSl, proposedSl);
  return { currentSl: tightenedSl, stage };
}
