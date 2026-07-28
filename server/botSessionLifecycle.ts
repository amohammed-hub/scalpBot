export const KILL_SWITCH_LAST_ERROR = "Kill Switch activated";

export type RestartableSessionSnapshot = {
  status?: string | null;
  lastError?: string | null;
};

export function getBaseSessionToken(sessionToken: string): string {
  return sessionToken.replace(/-slot\d+$/, "");
}

export function hasKillSwitchMarker(lastError?: string | null): boolean {
  return typeof lastError === "string" && lastError.toLowerCase().includes("kill switch");
}

/**
 * Automatic recovery is allowed only for an explicitly running session that
 * has not been stopped by the emergency kill switch. Explicit user start and
 * resume paths clear lastError before making the row running again.
 */
export function canAutoRestartSession(session: RestartableSessionSnapshot): boolean {
  return session.status === "running" && !hasKillSwitchMarker(session.lastError);
}
